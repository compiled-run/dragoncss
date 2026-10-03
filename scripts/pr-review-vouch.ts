// The checked parts of pr-review.ts: input checks for gh JSON and git output, and the decision on a skipped correctness check.
import { type IgnoreFile, parseIgnoreFile } from './macroscope-ignore.ts';
export const CORRECTNESS = 'Macroscope - Correctness Check';
export const DIFF_UNCHANGED = 'Diff unchanged';
export const ALREADY_REVIEWED = 'All code in this push has already been reviewed.';
// Macroscope's skip when every file changed since its last review is one it does not review (ignored or binary).
export const NO_CODE_REVIEWED = 'No code objects were reviewed.';

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

// Which diff a skip is vouched on: "Diff unchanged" on the whole three-dot diff, "already reviewed" and "no code objects
// reviewed" on the paths .macroscope/ignore.md leaves to review. Any other skip title is no review.
export type DiffScope = 'all paths' | 'reviewed paths';
export const skipScope = (run: CheckRun): DiffScope | null => {
  if (run.name !== CORRECTNESS || run.status !== 'completed' || run.conclusion !== 'skipped') return null;
  const title = run.output?.title;
  return title === DIFF_UNCHANGED ? 'all paths' : title === ALREADY_REVIEWED || title === NO_CODE_REVIEWED ? 'reviewed paths' : null;
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
      reason: `correctness check is ${run.status}/${run.conclusion ?? 'none'} (${run.output?.title ?? 'no title'}), not skipped as "${DIFF_UNCHANGED}", "${ALREADY_REVIEWED}" or "${NO_CODE_REVIEWED}"`,
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

// `gh pr view --json isCrossRepository`. A fork PR is reviewed with the base branch's ignore file, not its own, so it is never vouched for.
export const parseCrossRepository = (v: unknown): boolean =>
  isObject(v) && typeof v.isCrossRepository === 'boolean' ? v.isCrossRepository : fail('pr isCrossRepository', v);

// One entry of `git diff --raw -z --no-abbrev --no-renames`: ":<old mode> <new mode> <old blob> <new blob> <status>\0<path>\0".
export type RawEntry = { oldMode: string; newMode: string; oldBlob: string; newBlob: string; status: string; path: string };
const RAW_ENTRY = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([ADMT])$/;
export const parseRawDiff = (out: string): RawEntry[] => {
  if (out === '') return [];
  if (!out.endsWith('\0')) return fail('git diff --raw -z output (no trailing NUL)', out);
  const fields = out.slice(0, -1).split('\0');
  if (fields.length % 2 !== 0) return fail('git diff --raw -z output (odd field count)', out);
  const entries: RawEntry[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const m = RAW_ENTRY.exec(fields[i]!);
    const path = fields[i + 1]!;
    if (!m || path === '' || path.includes('\n')) return fail('git diff --raw -z entry', `${fields[i]} ${path}`);
    entries.push({ oldMode: m[1]!, newMode: m[2]!, oldBlob: m[3]!, newBlob: m[4]!, status: m[5]!, path });
  }
  if (new Set(entries.map((e) => e.path)).size !== entries.length) return fail('git diff --raw -z output (a path listed twice)', out);
  return entries;
};

// Output of `git cat-file --batch`: "<sha> blob <size>\n<bytes>\n" per requested blob, in request order.
export const parseBlobBatch = (out: Buffer, shas: string[]): Map<string, Buffer> => {
  const blobs = new Map<string, Buffer>();
  let at = 0;
  for (const sha of shas) {
    const eol = out.indexOf(0x0a, at);
    const header = eol < 0 ? '' : out.subarray(at, eol).toString('latin1');
    const m = /^([0-9a-f]{40}) blob (\d+)$/.exec(header);
    if (!m || m[1] !== sha) return fail('git cat-file --batch header', header);
    const start = eol + 1;
    const end = start + Number(m[2]);
    if (end >= out.length || out[end] !== 0x0a) return fail('git cat-file --batch body', header);
    blobs.set(sha, out.subarray(start, end));
    at = end + 1;
  }
  if (at !== out.length) return fail('git cat-file --batch output (trailing bytes)', out.subarray(at, at + 100).toString('latin1'));
  return blobs;
};

// Git's own test for binary content: a NUL byte in the first 8000 bytes.
export const isBinaryBlob = (content: Buffer): boolean => content.subarray(0, 8000).includes(0);

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
// Git output is bytes; text is decoded as strict UTF-8, so nothing is changed or dropped before it is hashed.
export type Git = (args: string[], input?: Buffer) => Buffer;
export const IGNORE_FILE = '.macroscope/ignore.md';
export type Ignore = { blob: string; file: IgnoreFile };

const utf8 = new TextDecoder('utf-8', { fatal: true });
const text = (out: Buffer): string => utf8.decode(out);
const errorText = (error: unknown): string => {
  const stderr = (error as { stderr?: unknown }).stderr;
  const err = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr;
  return typeof err === 'string' && err.trim() !== '' ? err.trim() : error instanceof Error ? error.message : String(error);
};

// The ignore file Macroscope reads for a review of `commit` is the one in that commit; a missing one fails closed,
// since Macroscope's fallbacks then apply. An ignore file that ignores itself could hide its own edits, so it fails too.
export const ignoreAt = (git: Git, commit: string): Ignore | { error: string } => {
  try {
    const blob = checkSha(text(git(['rev-parse', '--verify', '--quiet', `${commit}:${IGNORE_FILE}`])).trim(), `${IGNORE_FILE} blob at ${commit}`);
    const file = parseIgnoreFile(text(git(['cat-file', 'blob', blob])));
    if (file.matches(IGNORE_FILE)) return { error: `${IGNORE_FILE} at ${commit} ignores itself` };
    return { blob, file };
  } catch (error) {
    return { error: `${IGNORE_FILE} at ${commit}: ${errorText(error)}` };
  }
};

// Pinned so the user's git config (diff.ignoreSubmodules, diff.relative, diff.submodule, diff.external, color, renames)
// can neither hide a change nor alter the patch text; --binary --full-index puts binary content in the patch id.
const PINNED = ['--ignore-submodules=none', '--submodule=short', '--no-relative', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color'];
const DIFF = ['diff', ...PINNED, '--binary', '--full-index'];
const RAW = ['diff', ...PINNED, '--raw', '-z', '--no-abbrev'];
const ZERO = '0'.repeat(40);
const PATHS_PER_DIFF = 200;

// Macroscope always skips binary files; a regular file counts as one here only when every side of its change is binary content.
const binaryPaths = (git: Git, entries: RawEntry[]): Set<string> => {
  const regular = (mode: string): boolean => mode === '100644' || mode === '100755';
  const sides = (e: RawEntry): string[] => [e.oldBlob, e.newBlob].filter((b) => b !== ZERO);
  const candidates = entries.filter((e) => [e.oldMode, e.newMode].every((m) => m === '000000' || regular(m)) && sides(e).length > 0);
  const shas = [...new Set(candidates.flatMap(sides))];
  if (shas.length === 0) return new Set();
  const blobs = parseBlobBatch(git(['cat-file', '--batch'], Buffer.from(`${shas.join('\n')}\n`)), shas);
  return new Set(candidates.filter((e) => sides(e).every((b) => isBinaryBlob(blobs.get(b)!))).map((e) => e.path));
};

const countFileDiffs = (diff: Buffer): number => {
  let n = 0;
  for (let at = 0; at < diff.length; ) {
    if (diff.subarray(at, at + 11).toString('latin1') === 'diff --git ') n++;
    const eol = diff.indexOf(0x0a, at);
    at = eol < 0 ? diff.length : eol + 1;
  }
  return n;
};

// The three-dot diff of a commit (against its merge-base with the base ref) over `scope`, reduced to its stable patch id.
// For 'reviewed paths' the commit must carry the same ignore file as `ignore`, which is the head's, and binary files are left out.
export const patchIdOver = (git: Git, commit: string, baseRef: string, scope: DiffScope, ignore?: Ignore): PatchId => {
  try {
    const mergeBase = checkSha(text(git(['merge-base', commit, baseRef])).trim(), `merge-base of ${commit} and ${baseRef}`);
    const entries = parseRawDiff(text(git([...RAW, mergeBase, commit])));
    let paths = entries.map((e) => e.path);
    if (scope === 'reviewed paths') {
      if (ignore === undefined) return { error: 'no ignore file to restrict the diff to reviewed paths' };
      const own = ignoreAt(git, commit);
      if ('error' in own) return own;
      if (own.blob !== ignore.blob) return { error: `${IGNORE_FILE} differs from the head's (${own.blob} vs ${ignore.blob})` };
      const reviewed = entries.filter((e) => !ignore.file.matches(e.path));
      const binary = binaryPaths(git, reviewed);
      paths = reviewed.map((e) => e.path).filter((p) => !binary.has(p));
    }
    if (paths.length === 0) return { error: `no path in ${scope} differs from its merge-base, so there is no patch id to compare` };
    const chunks: Buffer[] = [];
    for (let i = 0; i < paths.length; i += PATHS_PER_DIFF) {
      chunks.push(git([...DIFF, mergeBase, commit, '--', ...paths.slice(i, i + PATHS_PER_DIFF).map((p) => `:(literal)${p}`)]));
    }
    const diff = Buffer.concat(chunks);
    const files = countFileDiffs(diff);
    if (files !== paths.length) return { error: `git diff printed ${files} file diffs for ${paths.length} paths` };
    return parsePatchId(text(git(['patch-id', '--stable'], diff)));
  } catch (error) {
    return { error: `${commit}: ${errorText(error)}` };
  }
};

// Every path that differs between two commits, with the same pinned diff options patchIdOver uses.
export const rawDiff = (git: Git, from: string, to: string): RawEntry[] => parseRawDiff(text(git([...RAW, from, to])));

// A merge-train regen commit: exactly one parent, and every path it changes is one `ignore` leaves out of review, never
// .macroscope/ignore.md itself. Binary files count too, since patchIdOver leaves them out. Returns one line per problem.
export const regenOnlyProblems = (git: Git, commit: string, ignore: Ignore): string[] => {
  try {
    const [self, ...parents] = text(git(['rev-list', '--parents', '-n', '1', commit])).trim().split(' ');
    checkSha(self, `rev-list of ${commit}`);
    if (parents.length !== 1) return [`${commit} has ${parents.length} parents; a regen commit has exactly one`];
    const problems: string[] = [];
    const own = ignoreAt(git, commit);
    if ('error' in own) problems.push(own.error);
    else if (own.blob !== ignore.blob) problems.push(`${IGNORE_FILE} at ${commit} differs from the one given (${own.blob} vs ${ignore.blob})`);
    for (const e of rawDiff(git, checkSha(parents[0], `parent of ${commit}`), commit)) {
      if (e.path === IGNORE_FILE) problems.push(`${e.path}: a regen commit may not edit ${IGNORE_FILE}`);
      else if (!ignore.file.matches(e.path)) problems.push(`${e.path}: not covered by ${IGNORE_FILE}, so a regen commit may not change it`);
    }
    return problems;
  } catch (error) {
    return [`${commit}: ${errorText(error)}`];
  }
};
