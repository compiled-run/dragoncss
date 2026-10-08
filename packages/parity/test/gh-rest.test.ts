import { describe, expect, it } from 'vitest';
import { type Gh, ghRest, mapMergeable, parseCommitPages, parseFilePages, parseIssueCommentPages, parsePull, parsePullSummary, repoFromRemote, resolveRepo } from '../../../scripts/gh-rest.ts';

const sha = (c: string): string => c.repeat(40);
const REPO = 'compiled-run/dragoncss';
const pull = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  number: 7,
  state: 'open',
  merged_at: null,
  draft: false,
  body: 'body',
  labels: [{ name: 'regen' }],
  mergeable: true,
  mergeable_state: 'clean',
  head: { sha: sha('a'), ref: 'topic', repo: { full_name: REPO } },
  base: { ref: 'master', repo: { full_name: REPO } },
  ...over,
});

// A fake gh: answers each `gh api` call from a table keyed by the joined arguments, and records every call.
const fakeGh = (table: Record<string, unknown>) => {
  const calls: { args: string[]; input?: string }[] = [];
  const gh: Gh = (args, input) => {
    calls.push({ args, ...(input === undefined ? {} : { input }) });
    const key = args.join(' ');
    if (!(key in table)) throw new Error(`fake gh: no answer for ${key}`);
    const v = table[key];
    return typeof v === 'string' ? v : JSON.stringify(v);
  };
  return { gh, calls };
};

describe('repo resolution', () => {
  it('parses https, ssh, scp-style and proxy remote URLs', () => {
    expect(repoFromRemote('https://github.com/compiled-run/dragoncss.git')).toBe(REPO);
    expect(repoFromRemote('https://github.com/compiled-run/dragoncss')).toBe(REPO);
    expect(repoFromRemote('https://github.com/compiled-run/dragoncss/\n')).toBe(REPO);
    expect(repoFromRemote('git@github.com:compiled-run/dragoncss.git')).toBe(REPO);
    expect(repoFromRemote('ssh://git@github.com/compiled-run/dragoncss.git')).toBe(REPO);
    expect(repoFromRemote('http://local_proxy@127.0.0.1:41234/git/compiled-run/dragoncss')).toBe(REPO);
  });

  it('rejects a remote it cannot read an owner and name from', () => {
    for (const bad of ['', 'dragoncss', 'https://github.com/dragoncss', 'git@github.com:dragoncss.git', 'https://github.com/a b/c']) expect(() => repoFromRemote(bad), bad).toThrow(/remote URL/);
  });

  it('prefers GH_REPO, with or without a host, over the origin remote', () => {
    const origin = (): string => 'git@github.com:other/repo.git';
    expect(resolveRepo({ GH_REPO: REPO }, origin)).toBe(REPO);
    expect(resolveRepo({ GH_REPO: `github.com/${REPO}` }, origin)).toBe(REPO);
    expect(resolveRepo({}, origin)).toBe('other/repo');
    expect(resolveRepo({ GH_REPO: '' }, origin)).toBe('other/repo');
    expect(() => resolveRepo({ GH_REPO: 'a/b/c/d' }, origin)).toThrow(/GH_REPO/);
    expect(() => resolveRepo({ GH_REPO: 'nope' }, origin)).toThrow(/GH_REPO/);
    // Every call goes to github.com, so another host is refused rather than silently dropped.
    expect(() => resolveRepo({ GH_REPO: 'ghe.example.com/o/r' }, origin)).toThrow(/GH_REPO host/);
    expect(resolveRepo({ GH_REPO: 'GitHub.com/o/r' }, origin)).toBe('o/r');
  });
});

describe('mergeable mapping', () => {
  it('maps REST mergeable and mergeable_state onto MERGEABLE, CONFLICTING and UNKNOWN', () => {
    expect(mapMergeable(true, 'clean')).toBe('MERGEABLE');
    for (const state of ['blocked', 'unstable', 'behind', 'has_hooks', 'draft']) expect(mapMergeable(true, state), state).toBe('MERGEABLE');
    expect(mapMergeable(false, 'dirty')).toBe('CONFLICTING');
    expect(mapMergeable(null, 'dirty')).toBe('CONFLICTING');
    expect(mapMergeable(false, 'blocked')).toBe('CONFLICTING');
    expect(mapMergeable(null, 'unknown')).toBe('UNKNOWN');
  });

  it('rejects anything else, naming the field', () => {
    expect(() => mapMergeable('true', 'clean')).toThrow(/pull\.mergeable/);
    expect(() => mapMergeable(true, undefined)).toThrow(/pull\.mergeable_state/);
  });
});

describe('pull shape', () => {
  it('reads state, head, base, mergeable, labels, body, draft and fork', () => {
    expect(parsePull(pull())).toEqual({
      number: 7,
      state: 'OPEN',
      sha: sha('a'),
      headRef: 'topic',
      base: 'master',
      mergeable: 'MERGEABLE',
      labels: ['regen'],
      body: 'body',
      draft: false,
      crossRepository: false,
    });
    expect(parsePull(pull({ state: 'closed', merged_at: '2026-10-08T00:00:00Z', mergeable: null, mergeable_state: 'unknown' }))).toMatchObject({ state: 'MERGED', mergeable: 'UNKNOWN' });
    expect(parsePull(pull({ state: 'closed' })).state).toBe('CLOSED');
    expect(parsePull(pull({ body: null })).body).toBe('');
    expect(parsePull(pull({ mergeable: false, mergeable_state: 'dirty' })).mergeable).toBe('CONFLICTING');
    // The list endpoint carries no mergeability: the summary reads it without one, and the full view refuses it.
    const { mergeable: _m, mergeable_state: _s, ...listed } = pull();
    expect(parsePullSummary(listed)).not.toHaveProperty('mergeable');
    expect(parsePullSummary(listed).number).toBe(7);
    expect(() => parsePull(listed)).toThrow(/pull\.mergeable \(missing\)/);
    expect(parsePull(pull({ head: { sha: sha('a'), ref: 'topic', repo: { full_name: 'fork/dragoncss' } } })).crossRepository).toBe(true);
    expect(parsePull(pull({ head: { sha: sha('a'), ref: 'topic', repo: null } })).crossRepository).toBe(true);
  });

  it('throws on an unexpected shape, naming the field', () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ state: 'OPEN' }, /pull\.state/],
      [{ number: '7' }, /pull\.number/],
      [{ head: { sha: 'abc', ref: 'topic', repo: null } }, /pull\.head\.sha/],
      [{ head: null }, /pull\.head/],
      [{ base: { ref: 1, repo: { full_name: REPO } } }, /pull\.base\.ref/],
      [{ labels: [{}] }, /pull\.labels\[\]\.name/],
      [{ labels: null }, /pull\.labels/],
      [{ draft: 'false' }, /pull\.draft/],
      [{ body: 3 }, /pull\.body/],
      [{ merged_at: 0 }, /pull\.merged_at/],
      [{ mergeable: 'MERGEABLE' }, /pull\.mergeable/],
    ];
    for (const [over, field] of cases) expect(() => parsePull(pull(over)), JSON.stringify(over)).toThrow(field);
    expect(() => parsePull(null)).toThrow(/pull/);
    expect(() => parsePull([pull()])).toThrow(/pull/);
  });

  it('reads files, commits and issue comments across pages, and rejects bad entries', () => {
    expect(parseFilePages([[{ filename: 'a', status: 'added' }], [{ filename: 'b', status: 'renamed', previous_filename: 'c' }]])).toEqual([
      { path: 'a', status: 'added' },
      { path: 'b', status: 'renamed', previousPath: 'c' },
    ]);
    expect(() => parseFilePages([[{ status: 'added' }]])).toThrow(/pull file\.filename/);
    expect(() => parseFilePages([{ filename: 'a', status: 'added' }])).toThrow(/pull files page/);
    expect(() => parseFilePages({})).toThrow(/pull files pages/);
    expect(parseCommitPages([[{ sha: sha('a') }], [{ sha: sha('b') }]])).toEqual([sha('a'), sha('b')]);
    expect(() => parseCommitPages([[{ sha: 'abc' }]])).toThrow(/pull commit\.sha/);
    const comment = { id: 1, user: { login: 'u' }, body: 'b', created_at: 't', html_url: 'h' };
    expect(parseIssueCommentPages([[comment]])).toEqual([{ id: 1, user: 'u', body: 'b', createdAt: 't', htmlUrl: 'h' }]);
    expect(() => parseIssueCommentPages([[{ ...comment, user: null }]])).toThrow(/issue comment\.user/);
    expect(() => parseIssueCommentPages([[{ ...comment, id: 0 }]])).toThrow(/issue comment\.id/);
  });
});

describe('ghRest over a fake gh', () => {
  const opts = { repo: REPO, sleep: () => {} };

  it('reads a PR with one REST call and never asks gh to resolve the repo', () => {
    const { gh, calls } = fakeGh({ [`api repos/${REPO}/pulls/7`]: pull() });
    expect(ghRest({ ...opts, gh }).prView(7).sha).toBe(sha('a'));
    expect(calls.map((c) => c.args)).toEqual([['api', `repos/${REPO}/pulls/7`]]);
  });

  it('paginates list endpoints and flattens the pages', () => {
    const page = (n: number) => [{ id: n, user: { login: 'macroscope-app[bot]' }, path: 'p', line: n, body: 'b', html_url: 'h' }];
    const { gh, calls } = fakeGh({
      [`api --paginate --slurp repos/${REPO}/pulls/7/comments?per_page=100`]: [page(1), page(2)],
      [`api --paginate --slurp repos/${REPO}/commits/${sha('a')}/check-runs?per_page=100`]: [
        { total_count: 2, check_runs: [{ name: 'checks', status: 'completed', conclusion: 'success', html_url: 'u', output: { title: null } }] },
        { total_count: 2, check_runs: [{ name: 'x', status: 'queued', conclusion: null, html_url: 'v' }] },
      ],
      [`api --paginate --slurp repos/${REPO}/pulls/7/files?per_page=100`]: [[{ filename: 'a', status: 'modified' }], [{ filename: 'b', status: 'added' }]],
      [`api --paginate --slurp repos/${REPO}/pulls?state=open&per_page=100&base=feature%2Fx`]: [[pull({ number: 8 })], [pull({ number: 9 })]],
      [`api --paginate --slurp repos/${REPO}/pulls/7/commits?per_page=100`]: [[{ sha: sha('a') }]],
    });
    const rest = ghRest({ ...opts, gh });
    expect(rest.reviewComments(7).map((c) => c.id)).toEqual([1, 2]);
    expect(rest.checkRuns(sha('a')).map((r) => r.name)).toEqual(['checks', 'x']);
    expect(rest.prFiles(7).map((f) => f.path)).toEqual(['a', 'b']);
    expect(rest.prList('feature/x').map((p) => p.number)).toEqual([8, 9]);
    expect(rest.prCommits(7)).toEqual([sha('a')]);
    expect(calls.every((c) => c.args[0] === 'api')).toBe(true);
  });

  it('finds only the open PR for a branch, and refuses two', () => {
    const key = `api --paginate --slurp repos/${REPO}/pulls?state=open&per_page=100&head=compiled-run%3Atopic`;
    expect(ghRest({ ...opts, gh: fakeGh({ [key]: [[pull({ number: 2 })]] }).gh }).prForBranch('topic')?.number).toBe(2);
    expect(ghRest({ ...opts, gh: fakeGh({ [key]: [[]] }).gh }).prForBranch('topic')).toBeNull();
    expect(() => ghRest({ ...opts, gh: fakeGh({ [key]: [[pull({ number: 2 })], [pull({ number: 3 })]] }).gh }).prForBranch('topic')).toThrow(/more than one/);
  });

  it('retries a failed read, but not a malformed answer or a write', () => {
    let n = 0;
    const flaky: Gh = () => {
      n++;
      if (n < 3) throw new Error('HTTP 502');
      return JSON.stringify(pull());
    };
    const slept: number[] = [];
    expect(ghRest({ repo: REPO, gh: flaky, sleep: (ms) => slept.push(ms) }).prView(7).number).toBe(7);
    expect(slept).toEqual([5_000, 10_000]);
    let reads = 0;
    const bad: Gh = () => {
      reads++;
      return '{"number": 7}';
    };
    expect(() => ghRest({ ...opts, gh: bad }).prView(7)).toThrow(/pull\.state/);
    expect(reads).toBe(1);
    let garbled = 0;
    expect(() => ghRest({ ...opts, gh: () => (garbled++, '<html>') }).prView(7)).toThrow(/not JSON/);
    expect(garbled).toBe(1);
    let writes = 0;
    const down: Gh = () => {
      writes++;
      throw new Error('HTTP 502');
    };
    expect(() => ghRest({ ...opts, gh: down }).issueComment(7, 'hi')).toThrow(/502/);
    expect(writes).toBe(1);
    expect(() => ghRest({ ...opts, gh: down, attempts: 2 }).prView(7)).toThrow(/502/);
    expect(writes).toBe(3);
  });

  it('sends writes as JSON on stdin and checks their answers', () => {
    const { gh, calls } = fakeGh({
      [`api -X POST repos/${REPO}/pulls --input -`]: { number: 12, html_url: 'https://github.com/x/pull/12' },
      [`api -X POST repos/${REPO}/issues/12/labels --input -`]: [{ name: 'regen' }],
      [`api -X DELETE repos/${REPO}/issues/12/labels/landing%20failed`]: [],
      [`api -X POST repos/${REPO}/issues/12/comments --input -`]: { id: 99, html_url: 'c' },
      [`api -X PATCH repos/${REPO}/pulls/12 --input -`]: pull({ number: 12 }),
      [`api -X PUT repos/${REPO}/pulls/12/merge --input -`]: { merged: true, sha: sha('e'), message: 'Pull Request successfully merged' },
    });
    const rest = ghRest({ ...opts, gh });
    expect(rest.prCreate({ title: 't', body: 'b', head: 'topic', base: 'master' })).toEqual({ number: 12, url: 'https://github.com/x/pull/12' });
    rest.addLabels(12, ['regen']);
    rest.removeLabel(12, 'landing failed');
    expect(rest.issueComment(12, 'hello')).toEqual({ id: 99, url: 'c' });
    rest.prSetBase(12, 'master');
    expect(rest.prMerge(12, sha('a'))).toEqual({ sha: sha('e') });
    expect(calls.map((c) => (c.input === undefined ? undefined : JSON.parse(c.input)))).toEqual([
      { title: 't', body: 'b', head: 'topic', base: 'master', draft: false },
      { labels: ['regen'] },
      undefined,
      { body: 'hello' },
      { base: 'master' },
      { sha: sha('a'), merge_method: 'merge' },
    ]);
  });

  it('refuses a merge without a full head sha, and reports a merge GitHub did not make', () => {
    const { gh } = fakeGh({ [`api -X PUT repos/${REPO}/pulls/12/merge --input -`]: { merged: false, message: 'Head branch was modified' } });
    const rest = ghRest({ ...opts, gh });
    expect(() => rest.prMerge(12, 'abc')).toThrow(/merge head sha/);
    expect(() => rest.prMerge(12, sha('a'))).toThrow(/merge result\.merged/);
    expect(() => rest.prSetBase(12, 'other')).toThrow(/no answer/);
    const moved = fakeGh({ [`api -X PATCH repos/${REPO}/pulls/12 --input -`]: pull({ number: 12 }) });
    expect(() => ghRest({ ...opts, gh: moved.gh }).prSetBase(12, 'other')).toThrow(/base\.ref/);
  });

  it('rejects a PR number that is not a positive integer before calling gh', () => {
    const { gh, calls } = fakeGh({});
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => ghRest({ ...opts, gh }).prView(bad)).toThrow(/PR number/);
    expect(calls).toEqual([]);
  });
});
