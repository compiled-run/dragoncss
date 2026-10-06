import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  commitRegen,
  archOf,
  archRebaseline,
  failureSummary,
  vectorsArchOf,
  deviceRunProblems,
  deviceRunWrote,
  isAncestor,
  type Member,
  mergeGate,
  memberTip,
  mergeMember,
  parseArgs,
  parseDeviceEvidence,
  parseLsRemote,
  parseMember,
  parseMembers,
  parsePrState,
  planPositions,
  POSITION_STEPS,
  predictPosition,
  prProblems,
  staleLines,
  treeMatches,
} from '../../../scripts/merge-train-lib.ts';
import { ALREADY_REVIEWED, type Git, ignoreAt, type Ignore, patchIdOver, regenOnlyProblems, vouchForSkip } from '../../../scripts/pr-review-vouch.ts';

const sha = (c: string): string => c.repeat(40);

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'merge-train-'));
  const config = ['user.name=t', 'user.email=t@t', 'commit.gpgsign=false', 'core.hooksPath=/dev/null'].flatMap((c) => ['-c', c]);
  const git: Git = (args, input) => execFileSync('git', [...config, ...args], { cwd: dir, input, stdio: ['pipe', 'pipe', 'pipe'] });
  const write = (files: Record<string, string | Buffer>): void => {
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
  };
  const head = (): string => git(['rev-parse', 'HEAD']).toString().trim();
  const commit = (files: Record<string, string | Buffer>, msg: string): string => {
    write(files);
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', msg]);
    return head();
  };
  const ignoreOf = (c: string): Ignore => {
    const i = ignoreAt(git, c);
    if ('error' in i) throw new Error(i.error);
    return i;
  };
  return { dir, git, write, head, commit, ignoreOf, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

const IGNORE_MD = '---\nignoreTests: false\n---\n**/out/**\n**/vectors/**\ndocs/goals/**\n';
const lines = (tag: string, n = 12): string => Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};\n`).join('');
const already = { name: 'Macroscope - Correctness Check', status: 'completed', conclusion: 'skipped', html_url: 'u', output: { title: ALREADY_REVIEWED } };
const reviewed = [{ name: 'Macroscope - Correctness Check', status: 'completed', conclusion: 'success', html_url: 'r' }];

// master O; member branches a (src/a.ts) and b (src/b.ts) off O; positions built the way `pnpm train build` builds them.
const train = (r: ReturnType<typeof scratch>) => {
  const { git, commit, write } = r;
  git(['init', '-q', '-b', 'master']);
  const base = commit({ '.macroscope/ignore.md': IGNORE_MD, 'src/a.ts': lines('a'), 'src/b.ts': lines('b'), 'out/x.json': '0\n' }, 'base');
  git(['checkout', '-q', '-b', 'a']);
  const a = commit({ 'src/a.ts': lines('a').replace('a3 = 3', 'a3 = 33') }, 'a change');
  git(['checkout', '-q', '-b', 'b', base]);
  const b = commit({ 'src/b.ts': lines('b').replace('b5 = 5', 'b5 = 55') }, 'b change');
  const A: Member = { branch: 'a', pr: 1, clean: a };
  const B: Member = { branch: 'b', pr: 2, clean: b };
  const position = (prev: string, m: Member, k: number, regen: Record<string, string | Buffer>): string => {
    mergeMember(git, prev, m, k);
    write(regen);
    return commitRegen(git, k, m, ['pnpm regen', 'pnpm run parity:devices']);
  };
  const p1 = position(base, A, 1, { 'out/x.json': '1\n' });
  const p2 = position(p1, B, 2, { 'out/x.json': '2\n', 'pkg/vectors/v.bin': Buffer.from([0, 1, 2]) });
  return { ...r, base, A, B, p1, p2, position };
};

describe('a train position on a scratch repository', () => {
  const r = scratch();
  afterAll(r.cleanup);
  const t = train(r);
  const { git } = t;

  it('(a) merge plus regen-only commit has the clean head patch id over reviewed paths, and the skip is vouched', () => {
    const plan = planPositions(git, [t.A, t.B], [t.p1, t.p2]);
    expect(plan.base).toBe(t.base);
    expect(plan.positions.map((p) => p.prev)).toEqual([t.base, t.p1]);
    const ignore = t.ignoreOf(t.p2);
    const head = patchIdOver(git, t.p2, t.p1, 'reviewed paths', ignore);
    const clean = patchIdOver(git, t.B.clean, t.p1, 'reviewed paths', ignore);
    expect(head).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(head).toEqual(clean);
    expect(vouchForSkip(already, head, [{ sha: t.B.clean, runs: reviewed, patchId: clean }])).toMatchObject({ ok: true, sha: t.B.clean });
    expect(regenOnlyProblems(git, t.p2, ignore)).toEqual([]);
    expect(predictPosition(git, t.A, plan.positions[0]!)).toMatchObject({ ok: true, regenProblems: [] });
    expect(predictPosition(git, t.B, plan.positions[1]!)).toMatchObject({ ok: true, regenProblems: [] });
  });

  it('(a) gives the same patch ids against master once position 1 has merged there, as pr:review computes them', () => {
    git(['checkout', '-q', 'master']);
    git(['merge', '-q', '--no-ff', '--no-edit', t.p1]);
    t.commit({ 'docs/goals/board.md': 'PM update\n' }, 'board');
    const ignore = t.ignoreOf(t.p2);
    const head = patchIdOver(git, t.p2, 'master', 'reviewed paths', ignore);
    expect(head).toMatchObject({ id: expect.any(String) });
    expect(head).toEqual(patchIdOver(git, t.B.clean, 'master', 'reviewed paths', ignore));
    expect(head).toEqual(patchIdOver(git, t.p2, t.p1, 'reviewed paths', ignore));
    expect(treeMatches(git, 'master', t.p1)).toEqual({ ok: true });
  });

  it('(b) a regen commit that also changes one line of reviewed code is neither vouched nor regen-only', () => {
    const bad = t.position(t.p1, t.B, 2, { 'out/x.json': '2\n', 'src/a.ts': lines('a').replace('a3 = 3', 'a3 = 34') });
    const [p] = planPositions(git, [t.B], [bad]).positions;
    const prediction = predictPosition(git, t.B, p!);
    expect(prediction.ok).toBe(false);
    expect(prediction.vouch).toMatchObject({ ok: false, reason: expect.stringContaining('matches no reviewed earlier commit') });
    expect(prediction.regenProblems).toEqual([expect.stringContaining('src/a.ts: not covered')]);
    expect(regenOnlyProblems(git, bad, t.ignoreOf(bad))).not.toEqual([]);
  });

  it('(b) a merge resolution that changes one line of reviewed code is not vouched, though its regen commit is clean', () => {
    git(['checkout', '-q', '--detach', t.p1]);
    git(['merge', '-q', '--no-ff', '--no-commit', t.B.clean]);
    t.write({ 'src/b.ts': lines('b').replace('b5 = 5', 'b5 = 55').replace('b9 = 9', 'b9 = 99') });
    git(['add', '-A']);
    git(['commit', '-q', '--no-edit']);
    t.write({ 'out/x.json': '2\n' });
    const bad = commitRegen(git, 2, t.B, ['pnpm regen']);
    const [p] = planPositions(git, [t.B], [bad]).positions;
    expect(p!.prev).toBe(t.p1);
    const prediction = predictPosition(git, t.B, p!);
    expect(prediction.vouch).toMatchObject({ ok: false });
    expect(prediction.ok).toBe(false);
    // The regen commit itself is clean: only the patch id comparison catches a bad merge resolution.
    expect(prediction.regenProblems).toEqual([]);
  });

  it('(f) rejects a member whose clean head is not an ancestor of its position, and any other shape', () => {
    git(['checkout', '-q', 'b']);
    const later = t.commit({ 'src/b.ts': 'later\n' }, 'unreviewed push');
    expect(() => planPositions(git, [t.A, { ...t.B, clean: later }], [t.p1, t.p2])).toThrow(/clean head .* is not an ancestor of position 2/);
    expect(() => planPositions(git, [t.B, t.A], [t.p1, t.p2])).toThrow(/not an ancestor of position 1/);
    // The merge alone, without a regen commit on top.
    const merge = git(['rev-parse', `${t.p2}^`]).toString().trim();
    expect(() => planPositions(git, [t.A, t.B], [t.p1, merge])).toThrow(/2 parents/);
    // Position 2 built on the base rather than position 1.
    const skipped = t.position(t.base, t.B, 2, { 'out/x.json': '9\n' });
    expect(() => planPositions(git, [t.A, t.B], [t.p1, skipped])).toThrow(/not built on position 1/);
    // A clean head that is an ancestor but not the merged parent (a's clean head sits under position 2 via position 1).
    expect(() => planPositions(git, [t.A, { ...t.B, clean: t.A.clean }], [t.p1, t.p2])).toThrow(/is not a merge/);
    expect(() => planPositions(git, [t.A], [t.p1, t.p2])).toThrow(/2 positions for 1 members/);
    expect(() => planPositions(git, [t.A], [])).toThrow();
  });

  it('aborts a conflicting merge and leaves the worktree clean', () => {
    git(['checkout', '-q', 'a']);
    const clash = t.commit({ 'src/b.ts': 'clash\n' }, 'clash');
    expect(() => mergeMember(git, t.p2, { branch: 'a', pr: 1, clean: clash }, 3)).toThrow(/conflicts in src\/b\.ts/);
    expect(git(['status', '--porcelain']).toString()).toBe('');
    expect(() => git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).toThrow();
    expect(() => mergeMember(git, t.p2, { branch: 'a', pr: 1, clean: sha('e') }, 3)).toThrow(/merging a/);
    expect(git(['status', '--porcelain']).toString()).toBe('');
  });

  it('refuses a member already in the previous position, before any regen runs', () => {
    expect(() => mergeMember(git, t.p1, t.A, 2)).toThrow(/not a merge of/);
  });

  it('gates the merge on the PR as re-read just before it, and on master still holding the previous position', () => {
    const position = planPositions(git, [t.A, t.B], [t.p1, t.p2]).positions[1]!;
    const pr = { number: 2, state: 'OPEN', head: 'b', headOid: t.p2, base: 'master', cross: false };
    git(['checkout', '-q', '--detach', t.p1]);
    const board = t.commit({ 'docs/goals/board.md': 'PM\n' }, 'board on master');
    expect(mergeGate(git, pr, t.B, position, board)).toEqual([]);
    expect(mergeGate(git, { ...pr, base: 'release' }, t.B, position, board)).toEqual([expect.stringContaining('targets release')]);
    expect(mergeGate(git, { ...pr, state: 'CLOSED' }, t.B, position, board)).toEqual([expect.stringContaining('CLOSED')]);
    expect(mergeGate(git, { ...pr, headOid: t.B.clean }, t.B, position, board)).toEqual([expect.stringContaining('not position')]);
    const moved = t.commit({ 'src/a.ts': 'landed meanwhile\n' }, 'code on master');
    expect(mergeGate(git, pr, t.B, position, moved)).toEqual([expect.stringContaining('differs from the previous position outside docs/goals/**: src/a.ts')]);
    expect(mergeGate(git, pr, t.B, position, t.base)).toEqual([expect.stringContaining('is not in master')]);
  });

  it('tells "not an ancestor" apart from a git failure', () => {
    expect(isAncestor(git, t.base, t.p2)).toBe(true);
    expect(isAncestor(git, t.p2, t.base)).toBe(false);
    expect(() => isAncestor(git, sha('e'), t.p2)).toThrow();
  });
});

describe('treeMatches', () => {
  const r = scratch();
  afterAll(r.cleanup);
  r.git(['init', '-q', '-b', 'master']);
  const x = r.commit({ 'src/a.ts': 'a\n', 'docs/goals/board.md': 'b\n', 'docs/other.md': 'o\n' }, 'x');
  const board = r.commit({ 'docs/goals/board.md': 'b2\n', 'docs/goals/notes/n.md': 'n\n' }, 'board only');
  const code = r.commit({ 'src/a.ts': 'a2\n' }, 'code');

  it('(e) passes on a docs/goals-only difference and fails on any other', () => {
    expect(treeMatches(r.git, x, board)).toEqual({ ok: true });
    expect(treeMatches(r.git, x, x)).toEqual({ ok: true });
    expect(treeMatches(r.git, board, code)).toEqual({ ok: false, paths: ['src/a.ts'] });
    expect(treeMatches(r.git, x, code)).toEqual({ ok: false, paths: ['src/a.ts'] });
    r.git(['rm', '-q', 'docs/other.md']);
    r.write({ 'docs/goalsx.md': 'not the board\n' });
    r.git(['add', '-A']);
    r.git(['commit', '-q', '-m', 'outside the board']);
    const outside = r.head();
    expect(treeMatches(r.git, code, outside)).toEqual({ ok: false, paths: ['docs/goalsx.md', 'docs/other.md'] });
    expect(() => treeMatches(r.git, x, sha('e'))).toThrow();
  });
});

describe('merge-train input checks', () => {
  const S = sha('a');

  it('parses members strictly', () => {
    expect(parseMember(`sel-d/r1a:12:${S}`)).toEqual({ branch: 'sel-d/r1a', pr: 12, clean: S });
    for (const bad of [
      `a:1`,
      `a:1:${S}:x`,
      `:1:${S}`,
      `a:0:${S}`,
      `a:01:${S}`,
      `a:x:${S}`,
      `a:1:${S.slice(1)}`,
      `a:1:${S.toUpperCase()}`,
      `-a:1:${S}`,
      `a..b:1:${S}`,
      `a b:1:${S}`,
      `a.lock:1:${S}`,
      `a/:1:${S}`,
      `master:1:${S}`,
      `train/1:1:${S}`,
      `a@{1}:1:${S}`,
    ]) {
      expect(() => parseMember(bad), bad).toThrow();
    }
  });

  it('caps a train at 5 members and rejects duplicates', () => {
    const m = (i: number, c = String(i)) => `b${i}:${i}:${c.repeat(40)}`;
    expect(parseMembers([1, 2, 3, 4, 5].map((i) => m(i)))).toHaveLength(5);
    expect(() => parseMembers([1, 2, 3, 4, 5, 6].map((i) => m(i)))).toThrow(/at most 5/);
    expect(() => parseMembers([])).toThrow();
    expect(() => parseMembers([m(1), `b1:2:${sha('2')}`])).toThrow(/branch/);
    expect(() => parseMembers([m(1), `b2:1:${sha('2')}`])).toThrow(/pr/);
    expect(() => parseMembers([m(1), `b2:2:${sha('1')}`])).toThrow(/clean/);
  });

  it('parses the command line strictly', () => {
    const one = `a:1:${S}`;
    const two = `b:2:${sha('b')}`;
    expect(parseArgs(['check', one, two])).toMatchObject({ command: 'check', from: 1 });
    expect(parseArgs(['land', '--from', '2', one, two])).toMatchObject({ command: 'land', from: 2 });
    expect(parseArgs(['build', one, '--from', '1'])).toMatchObject({ command: 'build', from: 1 });
    for (const bad of [[], ['merge', one], ['land', '--from', '3', one, two], ['land', '--from', '0', one], ['land', '--from', one], ['check', '--from', '1', one], ['land', '--force', one], ['land']]) {
      expect(() => parseArgs(bad), bad.join(' ')).toThrow();
    }
  });

  it('parses gh pr view and git ls-remote output strictly', () => {
    const pr = { number: 2, state: 'OPEN', headRefName: 'b', headRefOid: S, baseRefName: 'master', isCrossRepository: false };
    expect(parsePrState(pr)).toEqual({ number: 2, state: 'OPEN', head: 'b', headOid: S, base: 'master', cross: false });
    for (const bad of [null, [], { ...pr, number: '2' }, { ...pr, headRefOid: 'abc' }, { ...pr, isCrossRepository: 'false' }, { ...pr, state: undefined }]) {
      expect(() => parsePrState(bad), JSON.stringify(bad)).toThrow();
    }
    expect(parseLsRemote(`${S}\trefs/heads/b\n`, 'refs/heads/b')).toBe(S);
    for (const bad of ['', `${S}\trefs/heads/bb\n`, `${S}\trefs/heads/b\n${S}\trefs/heads/b\n`, `abc\trefs/heads/b\n`, `${S} refs/heads/b\n`]) {
      expect(() => parseLsRemote(bad, 'refs/heads/b'), bad).toThrow();
    }
  });

  it('lets PR k take position k only from its clean head or the position itself', () => {
    const m: Member = { branch: 'b', pr: 2, clean: S };
    const head = sha('c');
    const ok = { number: 2, state: 'OPEN', head: 'b', headOid: S, base: 'master', cross: false };
    expect(prProblems(ok, m, head, S)).toEqual([]);
    expect(prProblems({ ...ok, headOid: head }, m, head, head)).toEqual([]);
    expect(prProblems({ ...ok, headOid: sha('d') }, m, head, sha('d'))).toEqual([expect.stringContaining('neither the clean head')]);
    expect(prProblems(ok, m, head, sha('d'))).toEqual([expect.stringContaining('origin/b is at')]);
    expect(prProblems({ ...ok, number: 3, state: 'MERGED', head: 'x', base: 'main', cross: true }, m, head, S)).toHaveLength(5);
  });
});

// Train 1 (2026-10-02): #59's PR head was position 1 of a build whose land stopped; master then moved, so the next build must
// merge that head, keep the patch id of the clean head, and push a fast-forward of it.
describe('a member whose PR head is a position from an earlier build', () => {
  const r = scratch();
  afterAll(r.cleanup);
  const t = train(r);
  const { git } = t;
  git(['checkout', '-q', 'master']);
  const moved = t.commit({ 'scripts/tool.ts': 'export const fixed = true;\n' }, 'tooling lands on master');

  it('builds the new position on the old one, which it fast-forwards, with the clean head\'s patch id', () => {
    expect(memberTip(git, t.A, t.p1)).toBe(t.p1);
    const merge = mergeMember(git, moved, t.A, 1, t.p1);
    expect(git(['rev-list', '--parents', '-n', '1', merge]).toString().trim().split(' ').slice(1)).toEqual([moved, t.p1]);
    t.write({ 'out/x.json': '1b\n' });
    const head = commitRegen(git, 1, t.A, ['pnpm regen']);
    const plan = planPositions(git, [t.A], [head]);
    expect(plan.positions[0]).toMatchObject({ prev: moved, tip: t.p1, head });
    expect(predictPosition(git, t.A, plan.positions[0]!)).toMatchObject({ ok: true, regenProblems: [] });
    expect(isAncestor(git, t.p1, head)).toBe(true);
    const pr = { number: 1, state: 'OPEN', head: 'a', headOid: t.p1, base: 'master', cross: false };
    expect(prProblems(pr, t.A, head, t.p1, t.p1)).toEqual([]);
    expect(prProblems(pr, t.A, head, t.p1)).toEqual([expect.stringContaining('neither the clean head')]);
  });

  it('refuses a PR head with a commit the train did not make, or one that lost the clean head', () => {
    git(['checkout', '-q', '--detach', t.p1]);
    const pushed = t.commit({ 'src/a.ts': 'unreviewed\n' }, 'an unreviewed push');
    expect(() => memberTip(git, t.A, pushed)).toThrow(/the train did not make/);
    git(['checkout', '-q', '--detach', t.A.clean]);
    const sneaky = t.commit({ 'src/a.ts': 'unreviewed\n' }, 'Train position 1: not really');
    expect(() => memberTip(git, t.A, sneaky)).not.toThrow();
    // The subject check is only the shape; the patch id against the clean head catches the code.
    const merge = mergeMember(git, moved, t.A, 1, sneaky);
    expect(merge).toMatch(/^[0-9a-f]{40}$/);
    const head = commitRegen(git, 1, t.A, ['pnpm regen']);
    expect(predictPosition(git, t.A, planPositions(git, [t.A], [head]).positions[0]!).ok).toBe(false);
    expect(() => memberTip(git, t.A, t.B.clean)).toThrow(/does not contain its clean head/);
  });
});

describe('a review/* base stops land with the retarget command', () => {
  it('names gh pr edit <n> --base master', () => {
    const m: Member = { branch: 'b', pr: 75, clean: sha('a') };
    const pr = { number: 75, state: 'OPEN', head: 'b', headOid: sha('a'), base: 'review/seld-r1-base', cross: false };
    expect(prProblems(pr, m, sha('c'), sha('a'))).toEqual(['PR #75 targets review/seld-r1-base, not master; retarget it first: gh pr edit 75 --base master']);
  });
});

describe('a position\'s steps', () => {
  it('regenerate again after the device run and judge the run before that, never by its exit code', () => {
    expect(POSITION_STEPS).toEqual(['regen', 'typecheck', 'devices', 'judge-devices', 'regen-after-devices']);
  });
});

describe('the device run against the base\'s device evidence', () => {
  const lanes = (states: Record<string, Record<string, string>>, pass = true) => ({
    parity: { pass, problems: pass ? [] : ['ios: case lists differ'] },
    targets: Object.entries(states).map(([target, ls]) => ({ target, lanes: Object.entries(ls).map(([lane, state]) => ({ lane, state })) })),
  });
  const px = (c: string, node = 'edge:a') => ({ lane: 'device-pixels', case: c, dpr: 3, node, kind: 'pixel', detail: 'x' });
  const ev = (states: Record<string, Record<string, string>>, failures: Record<string, unknown[]>, pass = true) => parseDeviceEvidence(lanes(states, pass), (t) => failures[t], 't');
  const master = ev({ ios: { 'device-frames': 'pass', 'device-pixels': 'fail' }, android: { 'device-frames': 'pass', 'device-pixels': 'fail' } }, { ios: [px('a'), px('b')], android: [px('a')] });

  it('passes a run that fails exactly as master does (train 1 position 1: iOS 57, Android 86), or with fewer failures', () => {
    const same = ev({ ios: { 'device-frames': 'pass', 'device-pixels': 'fail' }, android: { 'device-frames': 'pass', 'device-pixels': 'fail' } }, { ios: [{ ...px('b'), detail: 'other values' }, px('a')], android: [px('a')] });
    expect(deviceRunProblems(master, same, [])).toEqual([]);
    const fewer = ev({ ios: { 'device-frames': 'pass', 'device-pixels': 'fail' }, android: { 'device-frames': 'pass', 'device-pixels': 'pass' } }, { ios: [px('a')], android: [] });
    expect(deviceRunProblems(master, fewer, [])).toEqual([]);
  });

  // Architecture binding (PM ruling on #132): device-pixels on master ran on the arm64 image.
  const withModels = (arch: string, pixels: string, failures: unknown[]) =>
    parseDeviceEvidence(
      {
        parity: { pass: true, problems: [] },
        targets: [
          { target: 'android', lanes: [
            { lane: 'device-frames', state: 'pass', device: { sets: [{ dpr: 2, device: { name: 'dragon-320', model: `Android SDK built for ${arch} / dragon-320` }, cases: 5, dumps: 5, failures: 0 }] } },
            { lane: 'device-pixels', state: pixels, device: { sets: [{ dpr: 2, device: { name: 'dragon-320', model: `Android SDK built for ${arch} / dragon-320` }, cases: 5, dumps: 5, failures: failures.length }] } },
          ] },
        ],
      },
      () => failures,
      arch,
    );
  const armMaster = withModels('arm64', 'fail', [px('a'), px('b')]);

  it('fails a run whose device lane ran on another architecture than master\'s record, naming both, even with fewer failures', () => {
    expect(archOf('Android SDK built for x86_64 / dragon-320')).toBe('x86_64');
    expect(archOf('iPhone 17')).toBe('iPhone 17');
    expect(deviceRunProblems(armMaster, withModels('arm64', 'fail', [px('a')]), [])).toEqual([]);
    expect(deviceRunProblems(armMaster, withModels('x86_64', 'fail', [px('a')]), [])).toEqual([
      'android device-frames: dragon-320 at DPR 2 ran on "Android SDK built for x86_64 / dragon-320" (x86_64), master\'s record on "Android SDK built for arm64 / dragon-320" (arm64): changing a lane\'s architecture is an explicit rebaseline (LAND_ARCH_REBASELINE)',
      'android device-pixels: dragon-320 at DPR 2 ran on "Android SDK built for x86_64 / dragon-320" (x86_64), master\'s record on "Android SDK built for arm64 / dragon-320" (arm64): changing a lane\'s architecture is an explicit rebaseline (LAND_ARCH_REBASELINE)',
    ]);
    // After a rebaseline to x86_64, a local arm64 fallback fails the same way instead of replacing the evidence.
    expect(deviceRunProblems(withModels('x86_64', 'fail', [px('a'), px('b')]), withModels('arm64', 'fail', [px('a'), px('b')]), [])).toHaveLength(2);
  });

  it('binds the android vectors lane to the ABI its toolchain names (it has no device sets)', () => {
    const vec = (abi: string | null) =>
      parseDeviceEvidence(
        { parity: { pass: true, problems: [] }, targets: [{ target: 'android', lanes: [{ lane: 'layout-vectors-device', state: 'pass', run: { toolchain: `kotlinc-jvm 2.4.20; d8 --min-api 31; ART app_process on dragon-smoke (Android 16${abi === null ? '' : `, ${abi}`})` }, device: null }] }] },
        () => [],
        't',
      );
    expect(vectorsArchOf('kotlinc; ART app_process on dragon-smoke (Android 16, x86_64)')).toEqual({ device: 'dragon-smoke', abi: 'x86_64' });
    expect(vectorsArchOf('kotlinc; ART app_process on dragon-smoke (Android 16)')).toBeNull();
    expect(deviceRunProblems(vec('arm64-v8a'), vec('arm64-v8a'), [])).toEqual([]);
    expect(deviceRunProblems(vec('arm64-v8a'), vec('x86_64'), [])).toEqual(["android layout-vectors-device: the vectors ran on dragon-smoke (x86_64), master's record on dragon-smoke (arm64-v8a): changing a lane's architecture is an explicit rebaseline (LAND_ARCH_REBASELINE)"]);
    // A record from before the ABI was written binds nothing until a run writes it.
    expect(deviceRunProblems(vec(null), vec('x86_64'), [])).toEqual([]);
    expect(deviceRunProblems(vec('arm64-v8a'), vec('x86_64'), [], { rebaseline: true })).toEqual([]);
  });

  it('rebaselines an architecture only with master\'s states and exactly master\'s failures', () => {
    expect(deviceRunProblems(armMaster, withModels('x86_64', 'fail', [px('b'), px('a')]), [], { rebaseline: true })).toEqual([]);
    expect(deviceRunProblems(armMaster, withModels('x86_64', 'fail', [px('a')]), [], { rebaseline: true })).toEqual(['android device-pixels: an architecture rebaseline needs master\'s state and exactly master\'s failures; master fail with 2, this run fail with 1']);
    expect(deviceRunProblems(armMaster, withModels('x86_64', 'pass', []), [], { rebaseline: true })[0]).toContain('master fail with 2, this run pass with 0');
  });

  it('takes LAND_ARCH_REBASELINE only for the PR it names, recorded in that PR\'s body', () => {
    const body = 'What changed\nArch rebaseline: android device-frames..device-hit from arm64 to x86_64 (CI)\n';
    expect(archRebaseline(undefined, 132, body)).toEqual({ rebaseline: false, problem: null });
    expect(archRebaseline('132', 132, body)).toEqual({ rebaseline: true, problem: null });
    expect(archRebaseline('132', 135, body)).toEqual({ rebaseline: false, problem: null });
    expect(archRebaseline('132', 132, 'no record')).toEqual({ rebaseline: false, problem: 'LAND_ARCH_REBASELINE names #132, but its body has no "Arch rebaseline: <lanes and architectures>" line' });
    expect(archRebaseline('x', 132, body).problem).toBe('LAND_ARCH_REBASELINE must be a PR number, not "x"');
  });

  // Real records (#91's landing): device-failures-<target>.json entries as device-lanes.ts writes them, a detail on each, and node
  // null for a failure of the whole case.
  const REAL = [{"lane": "device-pixels", "case": "position-relative-block", "dpr": 3, "node": "interior:a1", "kind": "pixel", "detail": "interior:a1 at 108,33: native [238,238,238,255], Chrome [204,204,204,255] (channel delta limit 0)"}, {"lane": "device-pixels", "case": "position-relative-block", "dpr": 3, "node": "edge:a1:right", "kind": "pixel", "detail": "edge:a1:right: Chrome shows an edge 3.000 device px along the scanline, the native capture none"}, {"lane": "device-pixels", "case": "position-relative-block", "dpr": 3, "node": "edge:a1:bottom", "kind": "pixel", "detail": "edge:a1:bottom: Chrome shows an edge 3.000 device px along the scanline, the native capture none"}, {"lane": "device-frames", "case": "-", "dpr": 3, "node": null, "kind": "device-record", "detail": "the host did not finish: timed out after 1896 s waiting for the iOS host to finish"}];
  it('reads the real failure records, node null and detail included, and stays strict about anything else (#91)', () => {
    const states = { ios: { 'device-frames': 'pass', 'device-pixels': 'fail' } };
    const parsed = ev(states, { ios: REAL });
    expect([...parsed.targets.get('ios')!.failures.get('device-frames')!]).toEqual(['device-frames - 3 null device-record']);
    expect(() => ev(states, { ios: [{ ...REAL[0], detail: 7 }] })).toThrow('entry 0 is not { lane, case, dpr, node (string or null), kind, detail }');
    expect(() => ev(states, { ios: [{ ...REAL[0], node: 3 }] })).toThrow('is not { lane, case, dpr, node');
    expect(() => ev(states, { ios: [{ ...REAL[0], severity: 'x' }] })).toThrow('entry 0 has unknown keys severity');
  });
  it('reports a device failure as a lane problem with a count per case and the first details, not a driver error (#91)', () => {
    const base = ev({ ios: { 'device-frames': 'pass', 'device-pixels': 'fail' } }, { ios: [REAL[0]] });
    const run = ev({ ios: { 'device-frames': 'fail', 'device-pixels': 'fail' } }, { ios: REAL });
    expect(deviceRunProblems(base, run, [])).toEqual([
      'ios device-frames: fail, on master pass; 1 failure(s): -@3 ×1; first: the host did not finish: timed out after 1896 s waiting for the iOS host to finish',
      'ios device-pixels: 2 failure(s) master does not have: position-relative-block@3 ×2; first: edge:a1:right: Chrome shows an edge 3.000 device px along the scanline, the native capture none | edge:a1:bottom: Chrome shows an edge 3.000 device px along the scanline, the native capture none',
    ]);
    expect(failureSummary(Array.from({ length: 10 }, (_, i) => `l c${i} 2 n k`))).toContain(', and 2 more cases; first: l c0 2 n k');
  });
  it('stops on a new failure, a lane that newly fails or did not run, a stale lane, failed lane parity, or a missing target', () => {
    const states = { ios: { 'device-frames': 'pass', 'device-pixels': 'fail' }, android: { 'device-frames': 'pass', 'device-pixels': 'fail' } };
    expect(deviceRunProblems(master, ev(states, { ios: [px('a'), px('b'), px('c')], android: [px('a')] }), [])).toEqual([expect.stringContaining('ios device-pixels: 1 failure(s) master does not have: c@3 ×1; first: x')]);
    expect(deviceRunProblems(master, ev(states, { ios: [px('a'), px('b', 'edge:b')], android: [px('a')] }), [])).toHaveLength(1);
    expect(deviceRunProblems(master, ev({ ...states, ios: { 'device-frames': 'fail', 'device-pixels': 'fail' } }, { ios: [px('a')], android: [px('a')] }), [])).toEqual(['ios device-frames: fail, on master pass']);
    expect(deviceRunProblems(master, ev({ ...states, android: { 'device-frames': 'not run', 'device-pixels': 'fail' } }, { ios: [], android: [] }), [])).toEqual(['android device-frames: not run, on master pass']);
    expect(deviceRunProblems(master, ev(states, { ios: [], android: [] }), ['ios device-pixels: evidence stamp'])).toEqual(['stale: ios device-pixels: evidence stamp']);
    expect(deviceRunProblems(master, ev(states, { ios: [], android: [] }, false), [])).toEqual(['lane parity fails: ios: case lists differ']);
    expect(deviceRunProblems(master, ev({ ios: states.ios }, { ios: [] }), [])).toEqual(['android: the run has no lanes']);
    expect(deviceRunProblems(master, ev({ ...states, ios: { ...states.ios, 'device-new': 'pass' } }, { ios: [], android: [] }), [])).toEqual([
      'ios device-new: a new lane (not on master) has no device run record',
      'android device-new: a new lane the run has on another target but not here',
    ]);
  });

  it('parses the evidence strictly and reads STALE lines', () => {
    const ok = lanes({ ios: { 'device-pixels': 'fail' } });
    expect(() => parseDeviceEvidence({}, () => [], 't')).toThrow(/no parity or targets/);
    expect(() => parseDeviceEvidence(ok, () => ({}), 't')).toThrow(/not a list/);
    expect(() => parseDeviceEvidence(ok, () => [{ ...px('a'), dpr: '3' }], 't')).toThrow(/is not \{ lane, case, dpr, node \(string or null\), kind, detail \}/);
    expect(() => parseDeviceEvidence(ok, () => [{ ...px('a'), lane: 'device-lines' }], 't')).toThrow(/lanes.json does not have/);
    expect(() => parseDeviceEvidence(lanes({ ios: {} }), () => [], 't')).not.toThrow();
    expect(() => parseDeviceEvidence({ ...ok, targets: [...ok.targets, ...ok.targets] }, () => [], 't')).toThrow(/twice/);
    expect(staleLines('ios (device DPRs 2, 3):\nSTALE ios device-pixels: x\n  STALE not at line start\n')).toEqual(['ios device-pixels: x']);
  });
});

// #111 added device-hit and device-states, which master has no evidence for; they passed on every device master runs on.
describe('a device lane master does not have', () => {
  const DEVICES: Record<string, [number, string][]> = { ios: [[3, 'iPhone 17'], [2, 'iPad (A16)']], android: [[2, 'dragon-320'], [2.625, 'dragon-smoke'], [3, 'dragon-480']] };
  type Set = { dpr: number; device: { name: string }; cases: number; dumps: number; failures: number };
  const sets = (target: string, cases = 507, over: Partial<Set> = {}): Set[] => DEVICES[target]!.map(([dpr, name]) => ({ dpr, device: { name }, cases, dumps: cases, failures: 0, ...over }));
  type Lane = { lane: string; state: string; device: { sets: Set[] } | null };
  const lane = (target: string, name: string, state: string, s: Set[] | null = sets(target)): Lane => ({ lane: name, state, device: s === null ? null : { sets: s } });
  const px = (c: string) => ({ lane: 'device-pixels', case: c, dpr: 3, node: 'edge:a', kind: 'pixel', detail: 'x' });
  const file = (extra: Record<string, Lane[]>) => ({
    parity: { pass: true, problems: [] },
    targets: ['ios', 'android'].map((t) => ({ target: t, lanes: [lane(t, 'layout-vectors-host', 'pass', null), lane(t, 'device-frames', 'pass'), lane(t, 'device-pixels', 'fail', sets(t, 507, { failures: 28 })), ...(extra[t] ?? [])] })),
  });
  const master = parseDeviceEvidence(file({}), () => [px('a')], 'master');
  const judge = (extra: Record<string, Lane[]>, failures: (t: string) => unknown[] = () => [px('a')]) => deviceRunProblems(master, parseDeviceEvidence(file(extra), failures, 'run'), []);
  const both = (f: (t: string) => Lane[]): Record<string, Lane[]> => ({ ios: f('ios'), android: f('android') });

  it('accepts new lanes that passed on every target and device master runs on, with no failure', () => {
    expect(judge(both((t) => [lane(t, 'device-hit', 'pass'), lane(t, 'device-states', 'pass', sets(t, 126))]))).toEqual([]);
  });

  it('fails a new lane with any failure, in its state, its failure list or a device set', () => {
    expect(judge(both((t) => [lane(t, 'device-hit', t === 'ios' ? 'fail' : 'pass')]))).toEqual(['ios device-hit: a new lane (not on master) is fail, not pass']);
    const listed = judge(both((t) => [lane(t, 'device-hit', 'pass')]), (t) => [px('a'), ...(t === 'android' ? [{ ...px('b'), lane: 'device-hit' }] : [])]);
    expect(listed).toEqual(['android device-hit: a new lane (not on master) lists 1 failure(s)']);
    expect(judge(both((t) => [lane(t, 'device-hit', 'pass', t === 'ios' ? sets(t, 507, { failures: 1 }) : sets(t))]))).toEqual([
      'ios device-hit: a new lane (not on master) has 1 failure(s) on iPhone 17 at DPR 3',
      'ios device-hit: a new lane (not on master) has 1 failure(s) on iPad (A16) at DPR 2',
    ]);
  });

  it('fails a new lane that missed a device or a target, or skipped runs', () => {
    expect(judge(both((t) => [lane(t, 'device-hit', 'pass', t === 'android' ? sets(t).slice(0, 2) : sets(t))]))).toEqual(['android device-hit: a new lane (not on master) did not run on dragon-480 at DPR 3']);
    expect(judge({ ios: [lane('ios', 'device-hit', 'pass')] })).toEqual(['android device-hit: a new lane the run has on another target but not here']);
    expect(judge(both((t) => [lane(t, 'device-hit', 'pass', t === 'ios' ? sets(t, 0) : sets(t))]))).toEqual([
      'ios device-hit: a new lane (not on master) ran no case on iPhone 17 at DPR 3',
      'ios device-hit: a new lane (not on master) ran no case on iPad (A16) at DPR 2',
    ]);
    expect(judge(both((t) => [lane(t, 'device-hit', 'pass', t === 'ios' ? sets(t, 507, { dumps: 506 }) : sets(t))]))).toHaveLength(2);
    expect(judge(both((t) => [lane(t, 'device-hit', 'not run', null)]))).toEqual([
      'ios device-hit: a new lane (not on master) is not run, not pass',
      'ios device-hit: a new lane (not on master) has no device run record',
      'android device-hit: a new lane (not on master) is not run, not pass',
      'android device-hit: a new lane (not on master) has no device run record',
    ]);
  });

  it('still fails a lane master has that the run lacks', () => {
    const run = file({});
    run.targets[0]!.lanes = run.targets[0]!.lanes.filter((l) => l.lane !== 'device-frames');
    expect(deviceRunProblems(master, parseDeviceEvidence(run, () => [px('a')], 'run'), [])).toEqual(['ios device-frames: missing from the run']);
  });

  it('parses device run records strictly', () => {
    const bad = (device: unknown) => () => parseDeviceEvidence({ parity: { pass: true, problems: [] }, targets: [{ target: 'ios', lanes: [{ lane: 'device-hit', state: 'pass', device }] }] }, () => [], 't');
    expect(bad(null)).not.toThrow();
    expect(bad(undefined)).not.toThrow();
    expect(bad({})).toThrow(/device is not null or \{ sets \}/);
    expect(bad({ sets: [{ dpr: 3, device: { name: 'x' }, cases: 1, dumps: 1 }] })).toThrow(/device set/);
    expect(bad({ sets: [{ dpr: 3, device: 'x', cases: 1, dumps: 1, failures: 0 }] })).toThrow(/device set/);
    expect(bad({ sets: [{ dpr: 3, device: { name: 'x' }, cases: -1, dumps: 1, failures: 0 }] })).toThrow(/device set/);
  });
});

// Train 1 rebuild (2026-10-03): position 1 merged #59's earlier position, whose lanes.json already held this tree's device run,
// so the new run wrote identical bytes and a content check said it had not run.
describe('whether the device run wrote lanes.json', () => {
  it('goes by the file time against the run start, whatever the content', () => {
    const start = Date.parse('2026-10-03T00:00:10.500Z');
    expect(deviceRunWrote(start + 60_000, start)).toBe(true);
    expect(deviceRunWrote(Date.parse('2026-10-03T00:00:10.000Z'), start)).toBe(true);
    expect(deviceRunWrote(start - 5_000, start)).toBe(false);
    expect(deviceRunWrote(start + 1, Number.POSITIVE_INFINITY)).toBe(false);
    expect(deviceRunWrote(Number.NaN, start)).toBe(false);
  });
});
