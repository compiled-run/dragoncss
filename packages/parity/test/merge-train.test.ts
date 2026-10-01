import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  commitRegen,
  isAncestor,
  type Member,
  mergeMember,
  parseArgs,
  parseLsRemote,
  parseMember,
  parseMembers,
  parsePrState,
  planPositions,
  predictPosition,
  prProblems,
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
