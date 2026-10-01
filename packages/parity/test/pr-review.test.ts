import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ALREADY_REVIEWED,
  type Git,
  ignoreAt,
  parseNulPaths,
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

  it('counts the skip as passed only when vouched', () => {
    const v = new Map<string, Vouch>([[already.html_url, { ok: true, sha: sha('a'), patchId: PATCH, scope: 'reviewed paths' }]]);
    expect(verdictOf(already, v)).toBe('passed');
    expect(verdictOf(already, new Map())).toBe('failed');
  });
});

describe('pr-review git output checks', () => {
  it('parses NUL-terminated path lists and rejects anything else', () => {
    expect(parseNulPaths('')).toEqual([]);
    expect(parseNulPaths('a/b.ts\0c d.ts\0')).toEqual(['a/b.ts', 'c d.ts']);
    expect(() => parseNulPaths('a/b.ts')).toThrow();
    expect(() => parseNulPaths('a\0\0')).toThrow();
    expect(() => parseNulPaths('a\0a\0')).toThrow();
    expect(() => parseNulPaths('a\nb\0')).toThrow();
  });

  it('turns malformed git output into a patch id error, never a pass', () => {
    const fake = (out: Record<string, string>): Git => (args) => {
      const hit = Object.entries(out).find(([k]) => args.join(' ').startsWith(k));
      if (!hit) throw new Error(`unexpected git ${args.join(' ')}`);
      return hit[1];
    };
    const ignore = { blob: sha('9'), file: { patterns: ['out/**'], ignoreTests: false, matches: (p: string) => p.startsWith('out/') } };
    const base = { 'merge-base': `${sha('5')}\n`, 'rev-parse': `${sha('9')}\n`, 'cat-file': 'out/**\n' };
    expect(patchIdOver(fake({ 'merge-base': 'fatal\n' }), sha('a'), 'm', 'reviewed paths', ignore)).toMatchObject({ error: expect.any(String) });
    expect(patchIdOver(fake({ ...base, 'diff --no-renames --name-only': 'src/a.ts' }), sha('a'), 'm', 'reviewed paths', ignore)).toMatchObject({ error: expect.any(String) });
    expect(patchIdOver(fake({ ...base, 'diff --no-renames --name-only': 'out/a\0' }), sha('a'), 'm', 'reviewed paths', ignore)).toMatchObject({
      error: expect.stringContaining('no reviewed path'),
    });
    const twoPaths = { ...base, 'diff --no-renames --name-only': 'src/a.ts\0src/b.ts\0', 'diff --no-renames --no-ext-diff': 'diff --git a/src/a.ts b/src/a.ts\n+x\n' };
    expect(patchIdOver(fake(twoPaths), sha('a'), 'm', 'reviewed paths', ignore)).toMatchObject({ error: expect.stringContaining('1 file diffs for 2') });
    expect(patchIdOver(fake({ ...base, 'rev-parse': `${sha('8')}\n` }), sha('a'), 'm', 'reviewed paths', ignore)).toMatchObject({ error: expect.stringContaining('differs') });
    expect(patchIdOver(fake(base), sha('a'), 'm', 'reviewed paths')).toMatchObject({ error: expect.any(String) });
    expect(ignoreAt(fake({ 'rev-parse': '' }), sha('a'))).toMatchObject({ error: expect.any(String) });
    expect(ignoreAt(fake({ 'rev-parse': `${sha('9')}\n`, 'cat-file': '!x\n' }), sha('a'))).toMatchObject({ error: expect.any(String) });
  });
});

describe('patchIdOver on a scratch repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-review-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git: Git = (args, input) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  const write = (files: Record<string, string>): void => {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
  };
  const commit = (files: Record<string, string>, msg: string): string => {
    write(files);
    git(['add', '-A']);
    git(['commit', '-q', '-m', msg]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  git(['init', '-q', '-b', 'master']);
  commit({ '.macroscope/ignore.md': '---\nignoreTests: false\n---\n**/out/**\n**/vectors/**\n', 'src/a.ts': 'a\n', 'src/m.ts': 'm\n', 'out/x.json': '1\n' }, 'base');
  git(['checkout', '-q', '-b', 'pr']);
  const reviewedCommit = commit({ 'src/a.ts': 'a2\n', 'pkg/vectors/v.json': '1\n' }, 'pr change');
  git(['checkout', '-q', 'master']);
  commit({ 'src/m.ts': 'm2\n', 'out/x.json': '2\n' }, 'master moves');
  git(['checkout', '-q', 'pr']);
  git(['merge', '-q', '--no-edit', 'master']);
  const regen = commit({ 'pkg/vectors/v.json': '2\n', 'out/x.json': '3\n' }, 'regen');
  const touched = commit({ 'src/a.ts': 'a3\n' }, 'reviewed code changes');
  const head = ignoreAt(git, regen);
  if ('error' in head) throw new Error(head.error);

  it('vouches for a merge-plus-regen push: reviewed paths identical, generated ones not', () => {
    const before = patchIdOver(git, reviewedCommit, 'master', 'reviewed paths', head);
    const after = patchIdOver(git, regen, 'master', 'reviewed paths', head);
    expect(before).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(after).toEqual(before);
    expect(patchIdOver(git, regen, 'master', 'all paths')).not.toEqual(patchIdOver(git, reviewedCommit, 'master', 'all paths'));
    const earlier: Earlier[] = [{ sha: reviewedCommit, runs: reviewed, patchId: before }];
    expect(vouchForSkip(run('skipped', ALREADY_REVIEWED), after, earlier)).toMatchObject({ ok: true, sha: reviewedCommit });
    expect(vouchForSkip(skipped, patchIdOver(git, regen, 'master', 'all paths'), [
      { sha: reviewedCommit, runs: reviewed, patchId: patchIdOver(git, reviewedCommit, 'master', 'all paths') },
    ])).toMatchObject({ ok: false });
  });

  it('refuses when a reviewed path changed, or the ignore file did', () => {
    const before = patchIdOver(git, reviewedCommit, 'master', 'reviewed paths', head);
    const after = patchIdOver(git, touched, 'master', 'reviewed paths', head);
    expect(after).toMatchObject({ id: expect.any(String) });
    expect(after).not.toEqual(before);
    expect(vouchForSkip(run('skipped', ALREADY_REVIEWED), after, [{ sha: reviewedCommit, runs: reviewed, patchId: before }])).toMatchObject({ ok: false });
    const widened = commit({ '.macroscope/ignore.md': '**/out/**\n**/vectors/**\nsrc/**\n' }, 'ignore more');
    const now = ignoreAt(git, widened);
    if ('error' in now) throw new Error(now.error);
    expect(patchIdOver(git, reviewedCommit, 'master', 'reviewed paths', now)).toMatchObject({ error: expect.stringContaining('differs') });
  });
});
