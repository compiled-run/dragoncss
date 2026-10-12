// Typed helpers over `gh api`, REST only: Claude Code cloud sessions reach GitHub through a proxy that allows REST alone.
import { execFileSync } from 'node:child_process';
import { type CheckRun, type Mergeable, parseCheckRunPages, parseReviewCommentPages, type ReviewComment } from './pr-review-vouch.ts';

// Runs `gh` with the given arguments (and stdin), returning stdout; throws on a non-zero exit.
export type Gh = (args: string[], input?: string) => string;
export const execGh: Gh = (args, input) =>
  execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (what: string, v: unknown): never => {
  throw new Error(`gh-rest: unexpected ${what}: ${JSON.stringify(v)?.slice(0, 300)}`);
};
const obj = (o: Record<string, unknown>, key: string, what: string): Record<string, unknown> =>
  isObject(o[key]) ? (o[key] as Record<string, unknown>) : fail(`${what}.${key}`, o[key]);
const str = (o: Record<string, unknown>, key: string, what: string): string =>
  typeof o[key] === 'string' ? (o[key] as string) : fail(`${what}.${key}`, o[key]);
const strOrNull = (o: Record<string, unknown>, key: string, what: string): string | null =>
  o[key] === null || typeof o[key] === 'string' ? (o[key] as string | null) : fail(`${what}.${key}`, o[key]);
const bool = (o: Record<string, unknown>, key: string, what: string): boolean =>
  typeof o[key] === 'boolean' ? (o[key] as boolean) : fail(`${what}.${key}`, o[key]);
const int = (o: Record<string, unknown>, key: string, what: string): number =>
  Number.isSafeInteger(o[key]) && (o[key] as number) > 0 ? (o[key] as number) : fail(`${what}.${key}`, o[key]);
const checkSha = (v: unknown, what: string): string => (typeof v === 'string' && /^[0-9a-f]{40}$/.test(v) ? v : fail(what, v));
const arr = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : fail(what, v));
// `gh api --paginate --slurp` over a list endpoint: one array per page.
const listPages = (v: unknown, what: string): unknown[] => arr(v, `${what} pages`).flatMap((page) => arr(page, `${what} page`));

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// owner/name from a remote URL: https://github.com/o/r(.git), git@github.com:o/r(.git), ssh://git@host/o/r, or a proxy
// URL whose path ends in /o/r.
export const repoFromRemote = (url: string): string => {
  const trimmed = url.trim();
  const scp = /^[^/@:]+@[^/:]+:(.+)$/.exec(trimmed);
  let path: string;
  if (scp) path = scp[1]!;
  else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return fail('remote URL', url);
    }
    path = parsed.pathname;
  }
  const parts = path.replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter((p) => p !== '');
  const repo = parts.slice(-2).join('/');
  return parts.length >= 2 && REPO.test(repo) ? repo : fail('remote URL', url);
};

// GH_REPO wins, as it does for gh itself; otherwise the origin remote. Every call goes to github.com, so GH_REPO may name no other host.
export const resolveRepo = (env: NodeJS.ProcessEnv = process.env, originUrl: () => string = () => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })): string => {
  const fromEnv = env.GH_REPO?.trim();
  if (fromEnv) {
    // gh accepts [HOST/]OWNER/REPO.
    const parts = fromEnv.split('/');
    const repo = parts.slice(-2).join('/');
    if (parts.length === 3 && parts[0]!.toLowerCase() !== 'github.com') return fail('GH_REPO host (only github.com is supported)', fromEnv);
    return parts.length <= 3 && REPO.test(repo) ? repo : fail('GH_REPO', fromEnv);
  }
  return repoFromRemote(originUrl());
};

// REST reports mergeability as `mergeable` (null while GitHub computes it) and `mergeable_state`; "dirty" means conflicts.
export const mapMergeable = (mergeable: unknown, mergeableState: unknown): Mergeable => {
  if (mergeable !== null && typeof mergeable !== 'boolean') return fail('pull.mergeable', mergeable);
  if (typeof mergeableState !== 'string') return fail('pull.mergeable_state', mergeableState);
  if (mergeableState === 'dirty' || mergeable === false) return 'CONFLICTING';
  return mergeable === null ? 'UNKNOWN' : 'MERGEABLE';
};

export type PrState = 'OPEN' | 'CLOSED' | 'MERGED';
// The list endpoints and write answers; only `GET pulls/<n>` carries mergeability.
export type PrSummary = {
  number: number;
  state: PrState;
  sha: string;
  headRef: string;
  base: string;
  labels: string[];
  body: string;
  draft: boolean;
  crossRepository: boolean;
};
export type PrView = PrSummary & { mergeable: Mergeable };
export const parsePullSummary = (v: unknown): PrSummary => {
  if (!isObject(v)) return fail('pull', v);
  const state = str(v, 'state', 'pull');
  if (state !== 'open' && state !== 'closed') return fail('pull.state', state);
  const merged = strOrNull(v, 'merged_at', 'pull') !== null;
  const head = obj(v, 'head', 'pull');
  const base = obj(v, 'base', 'pull');
  const baseRepo = obj(base, 'repo', 'pull.base');
  // head.repo is null once a fork is deleted; that is still a fork PR.
  const headRepo = head.repo === null ? null : obj(head, 'repo', 'pull.head');
  return {
    number: int(v, 'number', 'pull'),
    state: merged ? 'MERGED' : state === 'open' ? 'OPEN' : 'CLOSED',
    sha: checkSha(head.sha, 'pull.head.sha'),
    headRef: str(head, 'ref', 'pull.head'),
    base: str(base, 'ref', 'pull.base'),
    labels: arr(v.labels, 'pull.labels').map((l) => (isObject(l) ? str(l, 'name', 'pull.labels[]') : fail('pull.labels[]', l))),
    body: strOrNull(v, 'body', 'pull') ?? '',
    draft: bool(v, 'draft', 'pull'),
    crossRepository: headRepo === null || str(headRepo, 'full_name', 'pull.head.repo') !== str(baseRepo, 'full_name', 'pull.base.repo'),
  };
};

export const parsePull = (v: unknown): PrView => {
  const summary = parsePullSummary(v);
  const o = v as Record<string, unknown>;
  if (!('mergeable' in o)) return fail('pull.mergeable (missing)', undefined);
  return { ...summary, mergeable: mapMergeable(o.mergeable, o.mergeable_state) };
};

export type PrFile = { path: string; status: string; previousPath?: string };
export const parseFilePages = (v: unknown): PrFile[] =>
  listPages(v, 'pull files').map((f) => {
    if (!isObject(f)) return fail('pull file', f);
    const previous = f.previous_filename === undefined ? undefined : str(f, 'previous_filename', 'pull file');
    return { path: str(f, 'filename', 'pull file'), status: str(f, 'status', 'pull file'), ...(previous === undefined ? {} : { previousPath: previous }) };
  });

export const parseCommitPages = (v: unknown): string[] =>
  listPages(v, 'pull commits').map((c) => (isObject(c) ? checkSha(c.sha, 'pull commit.sha') : fail('pull commit', c)));

export type IssueComment = { id: number; user: string; body: string; createdAt: string; htmlUrl: string };
export const parseIssueCommentPages = (v: unknown): IssueComment[] =>
  listPages(v, 'issue comments').map((c) => {
    if (!isObject(c)) return fail('issue comment', c);
    return {
      id: int(c, 'id', 'issue comment'),
      user: str(obj(c, 'user', 'issue comment'), 'login', 'issue comment.user'),
      body: str(c, 'body', 'issue comment'),
      createdAt: str(c, 'created_at', 'issue comment'),
      htmlUrl: str(c, 'html_url', 'issue comment'),
    };
  });

const parseJson = (out: string, what: string): unknown => {
  try {
    return JSON.parse(out);
  } catch {
    return fail(`${what} (not JSON)`, out.slice(0, 300));
  }
};

export type GhRestOptions = { gh?: Gh; repo?: string; attempts?: number; sleep?: (ms: number) => void };
const blockFor = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export const ghRest = (options: GhRestOptions = {}) => {
  const gh = options.gh ?? execGh;
  const attempts = options.attempts ?? 5;
  const sleep = options.sleep ?? blockFor;
  let resolved = options.repo;
  const repo = (): string => (resolved ??= resolveRepo());
  // GitHub's API times out now and then, so reads retry; writes never do, since a retried POST could post twice.
  const read = (args: string[], what: string): unknown => {
    for (let attempt = 1; ; attempt++) {
      try {
        return parseJson(gh(['api', ...args]), what);
      } catch (error) {
        if (attempt >= attempts || (error instanceof Error && error.message.startsWith('gh-rest:'))) throw error;
        sleep(attempt * 5_000);
      }
    }
  };
  const get = (path: string, what: string): unknown => read([`repos/${repo()}/${path}`], what);
  const pages = (path: string, what: string): unknown => read(['--paginate', '--slurp', `repos/${repo()}/${path}`], what);
  const write = (method: string, path: string, body?: Record<string, unknown>, what = path): unknown => {
    const args = ['api', '-X', method, `repos/${repo()}/${path}`, ...(body === undefined ? [] : ['--input', '-'])];
    const out = gh(args, body === undefined ? undefined : JSON.stringify(body));
    return out.trim() === '' ? null : parseJson(out, what);
  };
  const n = (pr: number): number => (Number.isSafeInteger(pr) && pr > 0 ? pr : fail('PR number', pr));

  return {
    repo,
    prView: (pr: number): PrView => parsePull(get(`pulls/${n(pr)}`, 'pull')),
    prFiles: (pr: number): PrFile[] => parseFilePages(pages(`pulls/${n(pr)}/files?per_page=100`, 'pull files')),
    prCommits: (pr: number): string[] => parseCommitPages(pages(`pulls/${n(pr)}/commits?per_page=100`, 'pull commits')),
    prList: (base?: string): PrSummary[] =>
      listPages(pages(`pulls?state=open&per_page=100${base === undefined ? '' : `&base=${encodeURIComponent(base)}`}`, 'pulls'), 'pulls').map(parsePullSummary),
    // The open PR whose head is `branch` in this repository, or null; a closed or merged one is never picked.
    prForBranch: (branch: string): PrSummary | null => {
      const owner = repo().split('/')[0]!;
      const found = listPages(pages(`pulls?state=open&per_page=100&head=${encodeURIComponent(`${owner}:${branch}`)}`, 'pulls'), 'pulls').map(parsePullSummary);
      if (found.length > 1) return fail(`open pulls for ${owner}:${branch} (more than one)`, found.map((p) => p.number));
      return found[0] ?? null;
    },
    prCreate: (p: { title: string; body: string; head: string; base: string; draft?: boolean }): { number: number; url: string } => {
      const v = write('POST', 'pulls', { title: p.title, body: p.body, head: p.head, base: p.base, draft: p.draft ?? false }, 'created pull');
      return isObject(v) ? { number: int(v, 'number', 'created pull'), url: str(v, 'html_url', 'created pull') } : fail('created pull', v);
    },
    addLabels: (pr: number, labels: string[]): void => {
      write('POST', `issues/${n(pr)}/labels`, { labels });
    },
    removeLabel: (pr: number, label: string): void => {
      write('DELETE', `issues/${n(pr)}/labels/${encodeURIComponent(label)}`);
    },
    issueComment: (pr: number, body: string): { id: number; url: string } => {
      const v = write('POST', `issues/${n(pr)}/comments`, { body }, 'created comment');
      return isObject(v) ? { id: int(v, 'id', 'created comment'), url: str(v, 'html_url', 'created comment') } : fail('created comment', v);
    },
    prSetBase: (pr: number, base: string): void => {
      const v = parsePullSummary(write('PATCH', `pulls/${n(pr)}`, { base }, 'pull'));
      if (v.base !== base) fail(`pull.base.ref after setting it to ${base}`, v.base);
    },
    // Merges only if the PR's head is still `sha`; GitHub refuses (409) otherwise.
    prMerge: (pr: number, sha: string): { sha: string } => {
      const v = write('PUT', `pulls/${n(pr)}/merge`, { sha: checkSha(sha, 'merge head sha'), merge_method: 'merge' }, 'merge result');
      if (!isObject(v) || v.merged !== true) return fail('merge result.merged', v);
      return { sha: checkSha(v.sha, 'merge result.sha') };
    },
    checkRuns: (sha: string): CheckRun[] => parseCheckRunPages(pages(`commits/${checkSha(sha, 'commit sha')}/check-runs?per_page=100`, 'check runs')),
    prComments: (pr: number): IssueComment[] => parseIssueCommentPages(pages(`issues/${n(pr)}/comments?per_page=100`, 'issue comments')),
    reviewComments: (pr: number): ReviewComment[] => parseReviewCommentPages(pages(`pulls/${n(pr)}/comments?per_page=100`, 'review comments')),
  };
};
export type GhRest = ReturnType<typeof ghRest>;
