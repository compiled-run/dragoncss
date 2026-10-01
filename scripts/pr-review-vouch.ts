// The checked parts of pr-review.ts: input checks for gh JSON and git output, and the decision on a skipped correctness check.
import { type IgnoreFile, parseIgnoreFile } from './macroscope-ignore.ts';
export const CORRECTNESS = 'Macroscope - Correctness Check';
export const DIFF_UNCHANGED = 'Diff unchanged';
export const ALREADY_REVIEWED = 'All code in this push has already been reviewed.';

export type CheckRun = { name: string; status: string; conclusion: string | null; html_url: string; output?: { title: string | null } };
export type ReviewComment = {
  id: number;
  in_reply_to_id?: number;
  user: { login: string };
  path: string;
  line: number | null;
  body: string;
  html_url: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (what: string, v: unknown): never => {
  throw new Error(`pr-review: unexpected ${what}: ${JSON.stringify(v)?.slice(0, 300)}`);
};
const str = (o: Record<string, unknown>, key: string, what: string): string =>
  typeof o[key] === 'string' ? (o[key] as string) : fail(`${what}.${key}`, o);
const strOrNull = (o: Record<string, unknown>, key: string, what: string): string | null =>
  o[key] === null || typeof o[key] === 'string' ? (o[key] as string | null) : fail(`${what}.${key}`, o);
const SHA = /^[0-9a-f]{40}$/;
export const checkSha = (v: unknown, what: string): string => (typeof v === 'string' && SHA.test(v) ? v : fail(what, v));

export const parseCheckRun = (v: unknown): CheckRun => {
  if (!isObject(v)) return fail('check run', v);
  const output = v.output;
  if (output !== undefined && output !== null && !isObject(output)) return fail('check run output', v);
  return {
    name: str(v, 'name', 'check run'),
    status: str(v, 'status', 'check run'),
    conclusion: strOrNull(v, 'conclusion', 'check run'),
    html_url: str(v, 'html_url', 'check run'),
    ...(isObject(output) ? { output: { title: output.title === undefined ? null : strOrNull(output, 'title', 'check run output') } } : {}),
  };
};

// gh api --paginate --slurp returns one array element per page.
export const parseCheckRunPages = (v: unknown): CheckRun[] => {
  if (!Array.isArray(v)) return fail('check-runs pages', v);
  return v.flatMap((page) => {
    if (!isObject(page) || !Array.isArray(page.check_runs)) return fail('check-runs page', page);
    return page.check_runs.map(parseCheckRun);
  });
};

export const parseReviewCommentPages = (v: unknown): ReviewComment[] => {
  if (!Array.isArray(v)) return fail('review comment pages', v);
  return v.flatMap((page) => {
    if (!Array.isArray(page)) return fail('review comment page', page);
    return page.map((c: unknown): ReviewComment => {
      if (!isObject(c) || typeof c.id !== 'number' || !isObject(c.user)) return fail('review comment', c);
      if (c.in_reply_to_id !== undefined && typeof c.in_reply_to_id !== 'number') return fail('review comment in_reply_to_id', c);
      if (c.line !== null && typeof c.line !== 'number') return fail('review comment line', c);
      return {
        id: c.id,
        ...(c.in_reply_to_id === undefined ? {} : { in_reply_to_id: c.in_reply_to_id }),
        user: { login: str(c.user, 'login', 'review comment user') },
        path: str(c, 'path', 'review comment'),
        line: c.line,
        body: str(c, 'body', 'review comment'),
        html_url: str(c, 'html_url', 'review comment'),
      };
    });
  });
};

// `gh pr view --json commits,baseRefName`.
export const parsePrCommits = (v: unknown): { base: string; commits: string[] } => {
  if (!isObject(v) || !Array.isArray(v.commits) || v.commits.length === 0) return fail('pr commits', v);
  const base = str(v, 'baseRefName', 'pr');
  if (base === '') return fail('pr baseRefName', v);
  return { base, commits: v.commits.map((c: unknown) => checkSha(isObject(c) ? c.oid : c, 'pr commit oid')) };
};

// Output of `git diff <merge-base> <sha> | git patch-id --stable`: "<patch id> <commit id>", or nothing for an empty diff.
export const parsePatchId = (out: string): PatchId => {
  const trimmed = out.trim();
  if (trimmed === '') return { error: 'empty diff against its merge-base, so there is no patch id to compare' };
  const lines = trimmed.split('\n');
  const id = lines[0]!.split(' ')[0]!;
  if (lines.length !== 1 || !SHA.test(id)) return { error: `unexpected git patch-id output: ${JSON.stringify(trimmed.slice(0, 200))}` };
  return { id };
};

export type PatchId = { id: string } | { error: string };

const correctnessRuns = (runs: CheckRun[]): CheckRun[] => runs.filter((r) => r.name === CORRECTNESS);
// A commit's correctness review passed only if it has one and every correctness run on it completed with success.
export const correctnessSucceeded = (runs: CheckRun[]): boolean => {
  const own = correctnessRuns(runs);
  return own.length > 0 && own.every((r) => r.status === 'completed' && r.conclusion === 'success');
};

// Which diff a skip is vouched on: "Diff unchanged" on the whole three-dot diff, "already reviewed" on the paths
// .macroscope/ignore.md leaves to review. Any other skip title is no review.
export type DiffScope = 'all paths' | 'reviewed paths';
export const skipScope = (run: CheckRun): DiffScope | null => {
  if (run.name !== CORRECTNESS || run.status !== 'completed' || run.conclusion !== 'skipped') return null;
  return run.output?.title === DIFF_UNCHANGED ? 'all paths' : run.output?.title === ALREADY_REVIEWED ? 'reviewed paths' : null;
};
export const isVouchableSkip = (run: CheckRun): boolean => skipScope(run) !== null;

export type Earlier = { sha: string; runs: CheckRun[]; patchId?: PatchId };
export type Vouch = { ok: true; sha: string; patchId: string; scope: DiffScope } | { ok: false; reason: string };

// A vouchable skip passes only when an earlier commit of the PR with a successful correctness check has the same patch id
// as the head, both taken over the skip's DiffScope. `earlier` is oldest first; the caller computes patchId, over that
// scope, for every commit correctnessSucceeded accepts.
export const vouchForSkip = (run: CheckRun, head: PatchId, earlier: Earlier[]): Vouch => {
  const scope = skipScope(run);
  if (scope === null) {
    return {
      ok: false,
      reason: `correctness check is ${run.status}/${run.conclusion ?? 'none'} (${run.output?.title ?? 'no title'}), not skipped as "${DIFF_UNCHANGED}" or "${ALREADY_REVIEWED}"`,
    };
  }
  if ('error' in head) return { ok: false, reason: `head: ${head.error}` };
  const reviewed = earlier.filter((c) => correctnessSucceeded(c.runs)).reverse();
  if (reviewed.length === 0) return { ok: false, reason: 'no earlier commit of this PR has a successful correctness check' };
  const seen: string[] = [];
  for (const c of reviewed) {
    if (c.patchId === undefined) return { ok: false, reason: `${c.sha}: patch id was not computed` };
    if ('error' in c.patchId) return { ok: false, reason: `${c.sha}: ${c.patchId.error}` };
    if (c.patchId.id === head.id) return { ok: true, sha: c.sha, patchId: head.id, scope };
    seen.push(`${c.sha.slice(0, 8)}=${c.patchId.id}`);
  }
  return { ok: false, reason: `head patch id ${head.id} over ${scope} matches no reviewed earlier commit (${seen.join(', ')})` };
};

// Output of `git diff --name-only -z`: NUL-terminated repository paths, each non-empty and listed once.
export const parseNulPaths = (out: string): string[] => {
  if (out === '') return [];
  if (!out.endsWith('\0')) return fail('git --name-only -z output (no trailing NUL)', out);
  const paths = out.slice(0, -1).split('\0');
  if (paths.some((p) => p === '' || p.includes('\n'))) return fail('git --name-only -z path', out);
  if (new Set(paths).size !== paths.length) return fail('git --name-only -z output (a path listed twice)', out);
  return paths;
};

// The one verdict every path of pr-review.ts uses. `vouches` maps a vouchable skip's html_url to its vouch.
export type Verdict = 'pending' | 'passed' | 'failed';
export const verdictOf = (run: CheckRun, vouches: ReadonlyMap<string, Vouch>): Verdict => {
  if (run.status !== 'completed') return 'pending';
  if (run.name === CORRECTNESS) return run.conclusion === 'success' || vouches.get(run.html_url)?.ok === true ? 'passed' : 'failed';
  return ['success', 'neutral', 'skipped'].includes(run.conclusion ?? '') ? 'passed' : 'failed';
};

// Macroscope's correctness review starts only after CI passes, so a green CI alone is not "done"; a failed check ends the wait.
export const settled = (runs: CheckRun[], vouches: ReadonlyMap<string, Vouch>): boolean =>
  runs.some((r) => verdictOf(r, vouches) === 'failed') ||
  (runs.length > 0 && runs.every((r) => verdictOf(r, vouches) !== 'pending') && runs.some((r) => r.name === CORRECTNESS));

export const outcome = (runs: CheckRun[], vouches: ReadonlyMap<string, Vouch>): { pending: string[]; failed: string[] } => {
  const pending = runs.filter((r) => verdictOf(r, vouches) === 'pending').map((r) => r.name);
  if (!runs.some((r) => r.name === CORRECTNESS)) pending.push(CORRECTNESS);
  return { pending, failed: runs.filter((r) => verdictOf(r, vouches) === 'failed').map((r) => r.name) };
};

// The git side, with git passed in so tests can run it on a scratch repository. Every failure becomes a PatchId error.
export type Git = (args: string[], input?: string) => string;
export const IGNORE_FILE = '.macroscope/ignore.md';
export type Ignore = { blob: string; file: IgnoreFile };

const errorText = (error: unknown): string => {
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === 'string' && stderr.trim() !== '' ? stderr.trim() : error instanceof Error ? error.message : String(error);
};

// The ignore file Macroscope reads for a review of `commit` is the one in that commit; a missing one fails closed,
// since Macroscope's fallbacks then apply.
export const ignoreAt = (git: Git, commit: string): Ignore | { error: string } => {
  try {
    const blob = checkSha(git(['rev-parse', '--verify', '--quiet', `${commit}:${IGNORE_FILE}`]).trim(), `${IGNORE_FILE} blob at ${commit}`);
    return { blob, file: parseIgnoreFile(git(['cat-file', 'blob', blob])) };
  } catch (error) {
    return { error: `${IGNORE_FILE} at ${commit}: ${errorText(error)}` };
  }
};

const PATHS_PER_DIFF = 200;
// The three-dot diff of a commit (against its merge-base with the base ref) over `scope`, reduced to its stable patch id.
// For 'reviewed paths' the commit must carry the same ignore file as `ignore`, which is the head's.
export const patchIdOver = (git: Git, commit: string, baseRef: string, scope: DiffScope, ignore?: Ignore): PatchId => {
  try {
    const mergeBase = checkSha(git(['merge-base', commit, baseRef]).trim(), `merge-base of ${commit} and ${baseRef}`);
    if (scope === 'all paths') return parsePatchId(git(['patch-id', '--stable'], git(['diff', mergeBase, commit])));
    if (ignore === undefined) return { error: 'no ignore file to restrict the diff to reviewed paths' };
    const own = ignoreAt(git, commit);
    if ('error' in own) return own;
    if (own.blob !== ignore.blob) return { error: `${IGNORE_FILE} differs from the head's (${own.blob} vs ${ignore.blob})` };
    const paths = parseNulPaths(git(['diff', '--no-renames', '--name-only', '-z', mergeBase, commit])).filter((p) => !ignore.file.matches(p));
    if (paths.length === 0) return { error: 'no reviewed path differs from its merge-base, so there is no patch id to compare' };
    let diff = '';
    for (let i = 0; i < paths.length; i += PATHS_PER_DIFF) {
      const chunk = paths.slice(i, i + PATHS_PER_DIFF).map((p) => `:(literal)${p}`);
      diff += git(['diff', '--no-renames', '--no-ext-diff', '--no-textconv', mergeBase, commit, '--', ...chunk]);
    }
    const files = diff.split('\n').filter((l) => l.startsWith('diff --git ')).length;
    if (files !== paths.length) return { error: `git diff printed ${files} file diffs for ${paths.length} reviewed paths` };
    return parsePatchId(git(['patch-id', '--stable'], diff));
  } catch (error) {
    return { error: `${commit}: ${errorText(error)}` };
  }
};
