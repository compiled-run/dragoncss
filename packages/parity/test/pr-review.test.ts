import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ALREADY_REVIEWED,
  NO_CODE_REVIEWED,
  type Git,
  type Ignore,
  ignoreAt,
  isBinaryBlob,
  parseBlobBatch,
  parseCrossRepository,
  parseRawDiff,
  patchIdOver,
  type CheckRun,
  correctnessSucceeded,
  type Earlier,
  outcome,
  settled,
  verdictOf,
  type Vouch,
  parseCheckRunPages,
  parsePatchId,
  parsePrCommits,
  parseReviewCommentPages,
  regenOnlyProblems,
  vouchForSkip,
} from '../../../scripts/pr-review-vouch.ts';

const sha = (c: string): string => c.repeat(40);
const run = (conclusion: string | null, title: string | null, name = 'Macroscope - Correctness Check'): CheckRun => ({
  name,
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
  html_url: 'https://example.test/run',
  output: { title },
});
const skipped = run('skipped', 'Diff unchanged');
const reviewed = [run('success', 'No issues identified'), run('success', null, 'checks')];
const PATCH = sha('7');

describe('vouchForSkip on "Diff unchanged"', () => {
  it('passes when an earlier reviewed commit has the head patch id, naming that commit', () => {
    const earlier: Earlier[] = [
      { sha: sha('a'), runs: reviewed, patchId: { id: sha('1') } },
      { sha: sha('b'), runs: reviewed, patchId: { id: PATCH } },
      { sha: sha('c'), runs: [run('skipped', 'Prerequisite check(s) not found')] },
    ];
    expect(vouchForSkip(skipped, { id: PATCH }, earlier)).toEqual({ ok: true, sha: sha('b'), patchId: PATCH, scope: 'all paths' });
  });

  it('fails on a patch id mismatch', () => {
    const v = vouchForSkip(skipped, { id: PATCH }, [{ sha: sha('a'), runs: reviewed, patchId: { id: sha('1') } }]);
    expect(v).toMatchObject({ ok: false });
    expect(!v.ok && v.reason).toContain('matches no reviewed earlier commit');
  });

  it('fails when no earlier commit has a successful correctness check', () => {
    const earlier: Earlier[] = [
      { sha: sha('a'), runs: [run('skipped', 'Cost limit reached')], patchId: { id: PATCH } },
      { sha: sha('b'), runs: [run('success', null, 'checks')], patchId: { id: PATCH } },
      { sha: sha('c'), runs: [run(null, null)], patchId: { id: PATCH } },
      { sha: sha('d'), runs: [run('success', 'ok'), run('failure', 'rerun')], patchId: { id: PATCH } },
    ];
    expect(vouchForSkip(skipped, { id: PATCH }, earlier)).toEqual({
      ok: false,
      reason: 'no earlier commit of this PR has a successful correctness check',
    });
    expect(vouchForSkip(skipped, { id: PATCH }, [])).toMatchObject({ ok: false });
  });

  it('fails for any other skip title, conclusion or check name', () => {
    const earlier: Earlier[] = [{ sha: sha('a'), runs: reviewed, patchId: { id: PATCH } }];
    for (const other of [
      run('skipped', 'Prerequisite check(s) not found'),
      run('skipped', 'Cost limit reached'),
      run('skipped', 'diff unchanged'),
      run('skipped', 'Diff unchanged '),
      run('skipped', null),
      run('failure', 'Diff unchanged'),
      run('skipped', 'Diff unchanged', 'Macroscope - Proof guard'),
    ]) {
      expect(vouchForSkip(other, { id: PATCH }, earlier)).toMatchObject({ ok: false });
    }
  });

  it('fails when a reviewed earlier commit could not be fetched, or the head could not', () => {
    const lost = { error: `commit ${sha('b')} is not available locally even after fetching it` };
    const v = vouchForSkip(skipped, { id: PATCH }, [
      { sha: sha('a'), runs: reviewed, patchId: { id: PATCH } },
      { sha: sha('b'), runs: reviewed, patchId: lost },
    ]);
    expect(v).toEqual({ ok: false, reason: `${sha('b')}: ${lost.error}` });
    expect(vouchForSkip(skipped, lost, [{ sha: sha('a'), runs: reviewed, patchId: { id: PATCH } }])).toMatchObject({ ok: false });
    expect(vouchForSkip(skipped, { id: PATCH }, [{ sha: sha('a'), runs: reviewed }])).toMatchObject({ ok: false });
  });

  it('fails on an empty diff, even when both sides are empty', () => {
    const empty = parsePatchId('');
    expect(empty).toMatchObject({ error: expect.stringContaining('empty diff') });
    expect(vouchForSkip(skipped, empty, [{ sha: sha('a'), runs: reviewed, patchId: empty }])).toMatchObject({ ok: false });
    expect(vouchForSkip(skipped, { id: PATCH }, [{ sha: sha('a'), runs: reviewed, patchId: empty }])).toMatchObject({ ok: false });
  });
});

describe('pr-review input checks', () => {
  it('parses git patch-id output and rejects anything else', () => {
    expect(parsePatchId(`${PATCH} ${sha('0')}\n`)).toEqual({ id: PATCH });
    expect(parsePatchId('fatal: bad revision')).toMatchObject({ error: expect.any(String) });
    expect(parsePatchId(`${PATCH} ${sha('0')}\n${PATCH} ${sha('0')}`)).toMatchObject({ error: expect.any(String) });
  });

  it('requires every correctness run on a commit to have succeeded', () => {
    expect(correctnessSucceeded(reviewed)).toBe(true);
    expect(correctnessSucceeded([run('success', null, 'checks')])).toBe(false);
    expect(correctnessSucceeded([run('success', 'ok'), run('skipped', 'Diff unchanged')])).toBe(false);
  });

  it('rejects malformed gh JSON', () => {
    const good = { name: 'checks', status: 'completed', conclusion: 'success', html_url: 'u', output: { title: null } };
    expect(parseCheckRunPages([{ check_runs: [good] }])).toEqual([good]);
    expect(() => parseCheckRunPages({ check_runs: [good] })).toThrow();
    expect(() => parseCheckRunPages([{ check_runs: [{ ...good, conclusion: 3 }] }])).toThrow();
    expect(() => parseCheckRunPages([{ total_count: 0 }])).toThrow();
    expect(() => parsePrCommits({ baseRefName: 'master', commits: [{ oid: 'abc' }] })).toThrow();
    expect(() => parsePrCommits({ baseRefName: '', commits: [{ oid: sha('a') }] })).toThrow();
    expect(() => parsePrCommits({ baseRefName: 'master', commits: [] })).toThrow();
    expect(parsePrCommits({ baseRefName: 'master', commits: [{ oid: sha('a') }] })).toEqual({ base: 'master', commits: [sha('a')] });
    const comment = { id: 1, user: { login: 'x' }, path: 'p', line: null, body: 'b', html_url: 'u' };
    expect(parseReviewCommentPages([[comment]])).toEqual([comment]);
    expect(() => parseReviewCommentPages([[{ ...comment, id: '1' }]])).toThrow();
    expect(() => parseReviewCommentPages([[{ ...comment, in_reply_to_id: 'x' }]])).toThrow();
  });
});

describe('pr-review wait loop and verdict', () => {
  const ci = (conclusion: string | null): CheckRun => run(conclusion, null, 'checks');
  const vouches = (v: Vouch): Map<string, Vouch> => new Map([[skipped.html_url, v]]);
  const ok = vouches({ ok: true, sha: sha('b'), patchId: PATCH, scope: 'all paths' });
  const no = vouches({ ok: false, reason: 'no earlier commit of this PR has a successful correctness check' });

  it('keeps waiting on a vouched skip while CI is pending', () => {
    const runs = [ci(null), skipped];
    expect(verdictOf(skipped, ok)).toBe('passed');
    expect(settled(runs, ok)).toBe(false);
    expect(outcome(runs, ok)).toEqual({ pending: ['checks'], failed: [] });
  });

  it('passes a vouched skip once CI is green', () => {
    const runs = [ci('success'), skipped];
    expect(settled(runs, ok)).toBe(true);
    expect(outcome(runs, ok)).toEqual({ pending: [], failed: [] });
  });

  it('fails an unvouched skip, and a skip nobody judged', () => {
    for (const v of [no, new Map<string, Vouch>()]) {
      expect(verdictOf(skipped, v)).toBe('failed');
      expect(settled([ci(null), skipped], v)).toBe(true);
      expect(outcome([ci('success'), skipped], v)).toEqual({ pending: [], failed: [skipped.name] });
    }
  });

  it('ends the wait on a genuine failure', () => {
    const runs = [ci('failure'), run(null, null)];
    expect(settled(runs, ok)).toBe(true);
    expect(outcome(runs, ok)).toEqual({ pending: [run(null, null).name], failed: ['checks'] });
  });

  it('keeps waiting until the correctness check exists, and reports it as not started', () => {
    expect(settled([ci('success')], ok)).toBe(false);
    expect(settled([], ok)).toBe(false);
    expect(outcome([ci('success')], ok)).toEqual({ pending: ['Macroscope - Correctness Check'], failed: [] });
  });
});

describe('vouchForSkip on "already reviewed"', () => {
  const already = run('skipped', ALREADY_REVIEWED);
  const earlier: Earlier[] = [{ sha: sha('a'), runs: reviewed, patchId: { id: PATCH } }];

  it('passes on a matching reviewed-paths patch id and names the scope', () => {
    expect(vouchForSkip(already, { id: PATCH }, earlier)).toEqual({ ok: true, sha: sha('a'), patchId: PATCH, scope: 'reviewed paths' });
  });

  it('fails on a mismatch, with no reviewed earlier commit, or on a near-miss title', () => {
    expect(vouchForSkip(already, { id: sha('1') }, earlier)).toMatchObject({ ok: false, reason: expect.stringContaining('over reviewed paths') });
    expect(vouchForSkip(already, { id: PATCH }, [{ sha: sha('a'), runs: [run('neutral', '2 issues identified')], patchId: { id: PATCH } }])).toMatchObject({ ok: false });
    for (const title of ['All code in this push has already been reviewed', 'all code in this push has already been reviewed.', ` ${ALREADY_REVIEWED}`]) {
      expect(vouchForSkip(run('skipped', title), { id: PATCH }, earlier)).toMatchObject({ ok: false });
    }
    expect(vouchForSkip(run('neutral', ALREADY_REVIEWED), { id: PATCH }, earlier)).toMatchObject({ ok: false });
  });

  it('treats "No code objects were reviewed." (train 1, #59 at 2d47e5d) under the same reviewed-paths guard', () => {
    const none = run('skipped', NO_CODE_REVIEWED);
    expect(NO_CODE_REVIEWED).toBe('No code objects were reviewed.');
    expect(vouchForSkip(none, { id: PATCH }, earlier)).toEqual({ ok: true, sha: sha('a'), patchId: PATCH, scope: 'reviewed paths' });
    expect(vouchForSkip(none, { id: sha('1') }, earlier)).toMatchObject({ ok: false, reason: expect.stringContaining('over reviewed paths') });
    expect(vouchForSkip(none, { id: PATCH }, [])).toMatchObject({ ok: false });
    expect(vouchForSkip(run('skipped', 'No code objects were reviewed'), { id: PATCH }, earlier)).toMatchObject({ ok: false });
    expect(vouchForSkip(run('neutral', NO_CODE_REVIEWED), { id: PATCH }, earlier)).toMatchObject({ ok: false });
  });

  it('counts the skip as passed only when vouched', () => {
    const v = new Map<string, Vouch>([[already.html_url, { ok: true, sha: sha('a'), patchId: PATCH, scope: 'reviewed paths' }]]);
    expect(verdictOf(already, v)).toBe('passed');
    expect(verdictOf(already, new Map())).toBe('failed');
  });
});

describe('pr-review git output checks', () => {
  const R = (path: string, old = sha('1'), now = sha('2'), status = 'M', modes = '100644 100644') => `:${modes} ${old} ${now} ${status}\0${path}\0`;

  it('parses git diff --raw -z output and rejects anything else', () => {
    expect(parseRawDiff('')).toEqual([]);
    expect(parseRawDiff(R('a/b.ts') + R('c d.ts', sha('0'), sha('3'), 'A', '000000 100644'))).toEqual([
      { oldMode: '100644', newMode: '100644', oldBlob: sha('1'), newBlob: sha('2'), status: 'M', path: 'a/b.ts' },
      { oldMode: '000000', newMode: '100644', oldBlob: sha('0'), newBlob: sha('3'), status: 'A', path: 'c d.ts' },
    ]);
    for (const bad of [
      R('a').slice(0, -1),
      `${R('a')}x\0`,
      R(''),
      R('a\nb'),
      R('a') + R('a'),
      R('a', 'abc'),
      R('a', sha('1'), sha('2'), 'R100'),
      R('a', sha('1'), sha('2'), 'M', '100644 1006440'),
      `${R('a').split('\0')[0]}\0`,
    ]) {
      expect(() => parseRawDiff(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('parses git cat-file --batch output by size and rejects anything else', () => {
    const one = (id: string, body: string) => Buffer.from(`${id} blob ${Buffer.byteLength(body)}\n${body}\n`);
    const out = Buffer.concat([one(sha('1'), 'a\nb'), one(sha('2'), '')]);
    const blobs = parseBlobBatch(out, [sha('1'), sha('2')]);
    expect(blobs.get(sha('1'))!.toString()).toBe('a\nb');
    expect(blobs.get(sha('2'))!.length).toBe(0);
    expect(() => parseBlobBatch(out, [sha('2'), sha('1')])).toThrow();
    expect(() => parseBlobBatch(out, [sha('1')])).toThrow();
    expect(() => parseBlobBatch(Buffer.from(`${sha('1')} missing\n`), [sha('1')])).toThrow();
    expect(() => parseBlobBatch(Buffer.from(`${sha('1')} blob 9\nab\n`), [sha('1')])).toThrow();
    expect(() => parseBlobBatch(Buffer.from(`${sha('1')} blob 2\nabc`), [sha('1')])).toThrow();
    expect(isBinaryBlob(Buffer.from('a\0b'))).toBe(true);
    expect(isBinaryBlob(Buffer.from('ab'))).toBe(false);
    expect(isBinaryBlob(Buffer.concat([Buffer.alloc(8000, 'a'), Buffer.from('\0')]))).toBe(false);
  });

  it('reads isCrossRepository strictly', () => {
    expect(parseCrossRepository({ isCrossRepository: false })).toBe(false);
    expect(parseCrossRepository({ isCrossRepository: true })).toBe(true);
    for (const bad of [{}, { isCrossRepository: 'false' }, null, [false]]) expect(() => parseCrossRepository(bad)).toThrow();
  });

  it('turns malformed git output into a patch id error, never a pass', () => {
    const fake = (out: Record<string, string>): Git => (args) => {
      const hit = Object.entries(out).find(([k]) => args.join(' ').includes(k));
      if (!hit) throw new Error(`unexpected git ${args.join(' ')}`);
      return Buffer.from(hit[1]);
    };
    const ignore = { blob: sha('9'), file: { patterns: ['out/**'], ignoreTests: false, matches: (p: string) => p.startsWith('out/') } };
    const base = { 'merge-base': `${sha('5')}\n`, 'rev-parse': `${sha('9')}\n`, 'cat-file blob': 'out/**\n', 'cat-file --batch': '' };
    const at = (git: Git) => patchIdOver(git, sha('a'), 'm', 'reviewed paths', ignore);
    expect(at(fake({ 'merge-base': 'fatal\n' }))).toMatchObject({ error: expect.any(String) });
    expect(at(fake({ ...base, '--raw': 'src/a.ts' }))).toMatchObject({ error: expect.any(String) });
    expect(at(fake({ ...base, '--raw': R('out/a') }))).toMatchObject({ error: expect.stringContaining('no path in reviewed paths') });
    const twoPaths = { ...base, '--raw': R('src/a.ts', sha('1'), sha('2'), 'M', '160000 160000') + R('src/b.ts', sha('3'), sha('4'), 'M', '160000 160000'), ':(literal)': 'diff --git a/src/a.ts b/src/a.ts\n+x\n' };
    expect(at(fake(twoPaths))).toMatchObject({ error: expect.stringContaining('1 file diffs for 2') });
    expect(at(fake({ ...base, '--raw': R('src/a.ts'), 'cat-file --batch': 'garbage\n' }))).toMatchObject({ error: expect.stringContaining('cat-file') });
    const invalidUtf8: Git = (args) => (args.join(' ').includes('--raw') ? Buffer.from([0x3a, 0xff, 0]) : fake(base)(args));
    expect(at(invalidUtf8)).toMatchObject({ error: expect.any(String) });
    expect(at(fake({ ...base, '--raw': R('src/a.ts'), 'rev-parse': `${sha('8')}\n` }))).toMatchObject({ error: expect.stringContaining('differs') });
    expect(patchIdOver(fake({ ...base, '--raw': R('src/a.ts') }), sha('a'), 'm', 'reviewed paths')).toMatchObject({ error: expect.any(String) });
    expect(ignoreAt(fake({ 'rev-parse': '' }), sha('a'))).toMatchObject({ error: expect.any(String) });
    expect(ignoreAt(fake({ 'rev-parse': `${sha('9')}\n`, 'cat-file blob': '!x\n' }), sha('a'))).toMatchObject({ error: expect.any(String) });
    expect(ignoreAt(fake({ 'rev-parse': `${sha('9')}\n`, 'cat-file blob': '.macroscope/**\n' }), sha('a'))).toMatchObject({ error: expect.stringContaining('ignores itself') });
  });
});

// A scratch repository: master and a PR branch. `hostile` is git config a user might have that hides or reshapes diffs.
const HOSTILE = ['diff.ignoreSubmodules=all', 'diff.relative=true', 'color.diff=always', 'color.ui=always', 'diff.noprefix=true', 'diff.submodule=log', 'diff.renames=copies'];
const scratch = (hostile: boolean) => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-review-'));
  const config = ['user.name=t', 'user.email=t@t', 'commit.gpgsign=false', ...(hostile ? HOSTILE : [])].flatMap((c) => ['-c', c]);
  const git: Git = (args, input) => execFileSync('git', [...config, ...args], { cwd: dir, input, stdio: ['pipe', 'pipe', 'pipe'] });
  const write = (files: Record<string, string | Buffer>): void => {
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
  };
  const commit = (files: Record<string, string | Buffer>, msg: string): string => {
    write(files);
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', msg]);
    return git(['rev-parse', 'HEAD']).toString().trim();
  };
  const ignoreOf = (c: string): Ignore => {
    const i = ignoreAt(git, c);
    if ('error' in i) throw new Error(i.error);
    return i;
  };
  return { dir, git, commit, ignoreOf, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};
const IGNORE_MD = '---\nignoreTests: false\n---\n**/out/**\n**/vectors/**\n';
const PNG = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, n]);

describe('patchIdOver on a scratch repository', () => {
  const r = scratch(false);
  afterAll(r.cleanup);
  const { git, commit } = r;
  git(['init', '-q', '-b', 'master']);
  commit({ '.macroscope/ignore.md': IGNORE_MD, 'src/a.ts': 'a\n', 'src/m.ts': 'm\n', 'out/x.json': '1\n' }, 'base');
  git(['checkout', '-q', '-b', 'pr']);
  const reviewedCommit = commit({ 'src/a.ts': 'a2\n', 'pkg/vectors/v.json': '1\n' }, 'pr change');
  git(['checkout', '-q', 'master']);
  commit({ 'src/m.ts': 'm2\n', 'out/x.json': '2\n' }, 'master moves');
  git(['checkout', '-q', 'pr']);
  git(['merge', '-q', '--no-edit', 'master']);
  const regen = commit({ 'pkg/vectors/v.json': '2\n', 'out/x.json': '3\n' }, 'regen');
  const touched = commit({ 'src/a.ts': 'a3\n' }, 'reviewed code changes');
  const head = r.ignoreOf(regen);

  it('vouches for a merge-plus-regen push: reviewed paths identical, generated ones not', () => {
    const before = patchIdOver(git, reviewedCommit, 'master', 'reviewed paths', head);
    const after = patchIdOver(git, regen, 'master', 'reviewed paths', head);
    expect(before).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(after).toEqual(before);
    expect(patchIdOver(git, regen, 'master', 'all paths')).not.toEqual(patchIdOver(git, reviewedCommit, 'master', 'all paths'));
    const earlier: Earlier[] = [{ sha: reviewedCommit, runs: reviewed, patchId: before }];
    expect(vouchForSkip(run('skipped', ALREADY_REVIEWED), after, earlier)).toMatchObject({ ok: true, sha: reviewedCommit });
    expect(
      vouchForSkip(skipped, patchIdOver(git, regen, 'master', 'all paths'), [
        { sha: reviewedCommit, runs: reviewed, patchId: patchIdOver(git, reviewedCommit, 'master', 'all paths') },
      ]),
    ).toMatchObject({ ok: false });
  });

  it('refuses when a reviewed path changed, or the ignore file did', () => {
    const before = patchIdOver(git, reviewedCommit, 'master', 'reviewed paths', head);
    const after = patchIdOver(git, touched, 'master', 'reviewed paths', head);
    expect(after).toMatchObject({ id: expect.any(String) });
    expect(after).not.toEqual(before);
    expect(vouchForSkip(run('skipped', ALREADY_REVIEWED), after, [{ sha: reviewedCommit, runs: reviewed, patchId: before }])).toMatchObject({ ok: false });
    const widened = commit({ '.macroscope/ignore.md': '**/out/**\n**/vectors/**\nsrc/**\n' }, 'ignore more');
    expect(patchIdOver(git, reviewedCommit, 'master', 'reviewed paths', r.ignoreOf(widened))).toMatchObject({ error: expect.stringContaining('differs') });
  });
});

describe('patchIdOver under git config that hides or reshapes diffs', () => {
  for (const hostile of [false, true]) {
    const r = scratch(hostile);
    afterAll(r.cleanup);
    const { git, commit } = r;
    git(['init', '-q', '-b', 'master']);
    commit({ '.macroscope/ignore.md': IGNORE_MD, '.gitattributes': 'src/opaque.ts -diff\n', 'src/a.ts': 'a\n', 'src/opaque.ts': 'o\n', 'src/latin.txt': Buffer.from([0x61, 0xe9, 0x0a]), 'img/logo.png': PNG(0) }, 'base');
    git(['checkout', '-q', '-b', 'pr']);
    const reviewedCommit = commit({ 'src/a.ts': 'a2\n' }, 'pr change');
    const ignore = r.ignoreOf(reviewedCommit);
    const id = (c: string) => patchIdOver(git, c, 'master', 'reviewed paths', ignore);
    const at = (files: Record<string, string | Buffer>, msg: string) => {
      git(['checkout', '-q', '--detach', reviewedCommit]);
      return commit(files, msg);
    };
    const sub = (() => {
      git(['checkout', '-q', '--detach', reviewedCommit]);
      git(['update-index', '--add', '--cacheinfo', `160000,${sha('c')},lib/sub`]);
      git(['commit', '-q', '-m', 'add submodule']);
      return git(['rev-parse', 'HEAD']).toString().trim();
    })();
    const subMoved = (() => {
      git(['update-index', '--cacheinfo', `160000,${sha('d')},lib/sub`]);
      git(['commit', '-q', '-m', 'move submodule']);
      return git(['rev-parse', 'HEAD']).toString().trim();
    })();
    const label = hostile ? 'with hostile config' : 'with default config';

    it(`counts a submodule pointer change as a reviewed change (${label})`, () => {
      expect(id(sub)).toMatchObject({ id: expect.any(String) });
      expect(id(sub)).not.toEqual(id(reviewedCommit));
      expect(id(subMoved)).not.toEqual(id(sub));
    });

    it(`leaves binary files out, as Macroscope does (${label})`, () => {
      expect(id(at({ 'img/logo.png': PNG(1) }, 'new logo'))).toEqual(id(reviewedCommit));
      expect(id(at({ 'img/new.png': PNG(2) }, 'add a logo'))).toEqual(id(reviewedCommit));
      expect(id(at({ 'img/logo.png': 'now text\n' }, 'logo becomes text'))).not.toEqual(id(reviewedCommit));
    });

    it(`hashes the content of text files git is told not to diff, and of non-UTF-8 text (${label})`, () => {
      const o1 = id(at({ 'src/opaque.ts': 'o1\n' }, 'opaque 1'));
      const o2 = id(at({ 'src/opaque.ts': 'o2\n' }, 'opaque 2'));
      expect(o1).toMatchObject({ id: expect.any(String) });
      expect(o1).not.toEqual(o2);
      const l1 = id(at({ 'src/latin.txt': Buffer.from([0x61, 0xe8, 0x0a]) }, 'latin 1'));
      const l2 = id(at({ 'src/latin.txt': Buffer.from([0x61, 0xea, 0x0a]) }, 'latin 2'));
      expect(l1).toMatchObject({ id: expect.any(String) });
      expect(l1).not.toEqual(l2);
    });

    it(`matches the default-config patch id (${label})`, () => {
      expect(id(reviewedCommit)).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{40}$/) });
    });
  }
});

describe('regenOnlyProblems on a scratch repository', () => {
  const r = scratch(false);
  afterAll(r.cleanup);
  const { git, commit } = r;
  git(['init', '-q', '-b', 'master']);
  commit({ '.macroscope/ignore.md': IGNORE_MD, 'src/a.ts': 'a\n', 'out/x.json': '1\n', 'img/logo.png': PNG(0) }, 'base');
  git(['checkout', '-q', '-b', 'pr']);
  const reviewedCommit = commit({ 'src/a.ts': 'a2\n' }, 'pr change');
  const ignore = r.ignoreOf(reviewedCommit);
  const at = (files: Record<string, string | Buffer>, msg: string) => {
    git(['checkout', '-q', '--detach', reviewedCommit]);
    return commit(files, msg);
  };

  it('accepts a commit that changes only ignored paths, or nothing', () => {
    expect(regenOnlyProblems(git, at({ 'out/x.json': '2\n', 'pkg/vectors/v.json': '1\n' }, 'regen'), ignore)).toEqual([]);
    expect(regenOnlyProblems(git, at({}, 'empty regen'), ignore)).toEqual([]);
  });

  it('(c) refuses a commit that edits .macroscope/ignore.md, and patchIdOver errors across it', () => {
    const edited = at({ '.macroscope/ignore.md': `${IGNORE_MD}src/**\n`, 'out/x.json': '2\n' }, 'regen widens the ignore file');
    const own = r.ignoreOf(edited);
    expect(regenOnlyProblems(git, edited, own)).toEqual([expect.stringContaining('may not edit .macroscope/ignore.md')]);
    expect(regenOnlyProblems(git, edited, ignore)).toEqual([expect.stringContaining('differs from the one given'), expect.stringContaining('may not edit')]);
    expect(patchIdOver(git, reviewedCommit, 'master', 'reviewed paths', own)).toMatchObject({ error: expect.stringContaining('differs') });
    expect(patchIdOver(git, edited, 'master', 'reviewed paths', ignore)).toMatchObject({ error: expect.stringContaining('differs') });
  });

  it('(d) allows a binary in an ignored path and refuses one in a reviewed path', () => {
    expect(regenOnlyProblems(git, at({ 'out/frame.png': PNG(1) }, 'binary output'), ignore)).toEqual([]);
    const logo = at({ 'img/logo.png': PNG(2) }, 'binary in a reviewed path');
    expect(regenOnlyProblems(git, logo, ignore)).toEqual([expect.stringContaining('img/logo.png: not covered')]);
    // patchIdOver leaves binary files out, so only regenOnlyProblems sees this change.
    expect(patchIdOver(git, logo, 'master', 'reviewed paths', ignore)).toEqual(patchIdOver(git, reviewedCommit, 'master', 'reviewed paths', ignore));
  });

  it('refuses a reviewed-path change, a merge, a root commit and git failures', () => {
    expect(regenOnlyProblems(git, at({ 'out/x.json': '3\n', 'src/a.ts': 'a3\n' }, 'regen plus code'), ignore)).toEqual([expect.stringContaining('src/a.ts')]);
    git(['checkout', '-q', 'master']);
    git(['merge', '-q', '--no-ff', '--no-edit', 'pr']);
    expect(regenOnlyProblems(git, 'HEAD', ignore)).toEqual([expect.stringContaining('has 2 parents')]);
    const root = git(['rev-list', '--max-parents=0', 'HEAD']).toString().trim();
    expect(regenOnlyProblems(git, root, ignore)).toEqual([expect.stringContaining('has 0 parents')]);
    expect(regenOnlyProblems(git, sha('e'), ignore)).toEqual([expect.any(String)]);
    const garbage: Git = (args) => (args[0] === 'rev-list' ? Buffer.from(`${sha('a')} ${sha('b')}\n`) : Buffer.from('nonsense'));
    expect(regenOnlyProblems(garbage, sha('a'), ignore)).not.toEqual([]);
  });
});
