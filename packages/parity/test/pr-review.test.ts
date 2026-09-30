import { describe, expect, it } from 'vitest';
import {
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
  vouchForDiffUnchanged,
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

describe('vouchForDiffUnchanged', () => {
  it('passes when an earlier reviewed commit has the head patch id, naming that commit', () => {
    const earlier: Earlier[] = [
      { sha: sha('a'), runs: reviewed, patchId: { id: sha('1') } },
      { sha: sha('b'), runs: reviewed, patchId: { id: PATCH } },
      { sha: sha('c'), runs: [run('skipped', 'Prerequisite check(s) not found')] },
    ];
    expect(vouchForDiffUnchanged(skipped, { id: PATCH }, earlier)).toEqual({ ok: true, sha: sha('b'), patchId: PATCH });
  });

  it('fails on a patch id mismatch', () => {
    const v = vouchForDiffUnchanged(skipped, { id: PATCH }, [{ sha: sha('a'), runs: reviewed, patchId: { id: sha('1') } }]);
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
    expect(vouchForDiffUnchanged(skipped, { id: PATCH }, earlier)).toEqual({
      ok: false,
      reason: 'no earlier commit of this PR has a successful correctness check',
    });
    expect(vouchForDiffUnchanged(skipped, { id: PATCH }, [])).toMatchObject({ ok: false });
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
      expect(vouchForDiffUnchanged(other, { id: PATCH }, earlier)).toMatchObject({ ok: false });
    }
  });

  it('fails when a reviewed earlier commit could not be fetched, or the head could not', () => {
    const lost = { error: `commit ${sha('b')} is not available locally even after fetching it` };
    const v = vouchForDiffUnchanged(skipped, { id: PATCH }, [
      { sha: sha('a'), runs: reviewed, patchId: { id: PATCH } },
      { sha: sha('b'), runs: reviewed, patchId: lost },
    ]);
    expect(v).toEqual({ ok: false, reason: `${sha('b')}: ${lost.error}` });
    expect(vouchForDiffUnchanged(skipped, lost, [{ sha: sha('a'), runs: reviewed, patchId: { id: PATCH } }])).toMatchObject({ ok: false });
    expect(vouchForDiffUnchanged(skipped, { id: PATCH }, [{ sha: sha('a'), runs: reviewed }])).toMatchObject({ ok: false });
  });

  it('fails on an empty diff, even when both sides are empty', () => {
    const empty = parsePatchId('');
    expect(empty).toMatchObject({ error: expect.stringContaining('empty diff') });
    expect(vouchForDiffUnchanged(skipped, empty, [{ sha: sha('a'), runs: reviewed, patchId: empty }])).toMatchObject({ ok: false });
    expect(vouchForDiffUnchanged(skipped, { id: PATCH }, [{ sha: sha('a'), runs: reviewed, patchId: empty }])).toMatchObject({ ok: false });
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
  const ok = vouches({ ok: true, sha: sha('b'), patchId: PATCH });
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
