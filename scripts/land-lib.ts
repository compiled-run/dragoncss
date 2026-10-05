// The checked parts of land.ts: queue and argument parsing, retries of network calls, the CI verdict, the Claude review gate and
// the queue loop that records a failed PR and continues. The git and device judgements come from merge-train-lib.ts.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type CheckRun, CI_CHECK } from './pr-review-vouch.ts';

const fail = (what: string): never => {
  throw new Error(`land: ${what}`);
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------------
// The queue: one "<branch>:<pr>:<clean-head>" per line, landed in order. "#" starts a comment; blank lines are ignored.

export type Entry = { branch: string; pr: number; clean: string };
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock(?:\/|$))(?!.*\/\.)(?!\.)[A-Za-z0-9._\/-]+(?<![./])$/;

export const parseEntry = (line: string): Entry => {
  const parts = line.split(':');
  if (parts.length !== 3) return fail(`queue line ${JSON.stringify(line)} is not <branch>:<pr>:<clean-head>`);
  const [branch, pr, clean] = parts as [string, string, string];
  if (!BRANCH.test(branch) || branch === 'master' || branch.startsWith('train/')) return fail(`queue line ${JSON.stringify(line)}: bad branch name`);
  if (!/^[1-9]\d{0,8}$/.test(pr)) return fail(`queue line ${JSON.stringify(line)}: bad PR number`);
  if (!/^[0-9a-f]{7,40}$/.test(clean)) return fail(`queue line ${JSON.stringify(line)}: the clean head must be 7 to 40 lowercase hex digits`);
  return { branch, pr: Number(pr), clean };
};

export const parseQueue = (text: string): Entry[] => {
  const entries: Entry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '') continue;
    if (/^train\b/.test(line)) return fail(`"${line}": trains are gone; the queue is a plain list of <branch>:<pr>:<clean-head> lines`);
    entries.push(parseEntry(line));
  }
  if (entries.length === 0) return fail('the queue has no entries');
  for (const key of ['branch', 'pr'] as const) {
    if (new Set(entries.map((e) => e[key])).size !== entries.length) fail(`two queue entries share a ${key}`);
  }
  return entries;
};

export type LandArgs = { queue: string; dryRun: boolean };
export const LAND_USAGE = `usage: pnpm land <queue-file> [--dry-run]
  queue file: one <branch>:<pr>:<clean-head> per line, landed in order ("#" comments and blank lines ignored)
  environment: LAND_WORKTREE (driver worktree, default /tmp/dragon-land), LAND_STATUS (/tmp/land.status), LAND_LOG (/tmp/land.log),
  LAND_REVIEW_CMD (the reviewer: reads the prompt on stdin, gets LAND_REVIEW_PR and LAND_REVIEW_HEAD, prints JSON; default the main
  checkout's scripts/land-review-lookup.ts, which prints the review a review agent precomputed in LAND_REVIEW_PRECOMPUTED_DIR,
  default /tmp/land-reviews/precomputed), LAND_REVIEW_DIR (/tmp/land-reviews), LAND_CI_WAIT and LAND_CI_APPEAR (seconds, default 5400 and 900), LAND_QUIET_MAX
  (seconds the test gate waits for a quiet machine before failing the PR, default 5400), LAND_BATCH (PRs proved together by one
  full test, 1 to 8, default 4; 1 lands one PR per proof)`;
export const parseLandArgs = (argv: string[]): LandArgs => {
  let queue: string | undefined;
  let dryRun = false;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('-')) return fail(`unknown option ${JSON.stringify(a)}\n${LAND_USAGE}`);
    else if (queue !== undefined) return fail(`one queue file only\n${LAND_USAGE}`);
    else queue = a;
  }
  return queue === undefined ? fail(LAND_USAGE) : { queue, dryRun };
};

// ---------------------------------------------------------------------------------------------------------------------
// Retries: every gh and git network call is retried 3 times, with backoff, on a transient error (timeouts, resets, 5xx).

const TRANSIENT = [
  /TLS handshake timeout/i,
  /i\/o timeout/i,
  /timed? ?out/i,
  /connection (reset|refused|closed)/i,
  /\bEOF\b/,
  /\b5\d\d\b.*(error|gateway|unavailable|server)/i,
  /HTTP 5\d\d/i,
  /(bad gateway|service unavailable|gateway time-?out|internal server error)/i,
  /could not resolve host/i,
  /RPC failed/i,
  /the remote end hung up unexpectedly/i,
  /network is unreachable/i,
];
export const errorText = (error: unknown): string => {
  const parts: string[] = [];
  for (const k of ['stderr', 'stdout'] as const) {
    const v = (error as Record<string, unknown> | null)?.[k];
    const s = Buffer.isBuffer(v) ? v.toString('utf8') : v;
    if (typeof s === 'string' && s.trim() !== '') parts.push(s.trim());
  }
  if (error instanceof Error) parts.push(error.message);
  return parts.length > 0 ? parts.join('\n') : String(error);
};
export const isTransient = (error: unknown): boolean => {
  const t = errorText(error);
  return TRANSIENT.some((re) => re.test(t));
};

export const RETRIES = 3;
export const backoffMs = (retry: number): number => 5_000 * 3 ** (retry - 1);
export const withRetry = <T>(what: string, fn: () => T, sleep: (ms: number) => void, log: (line: string) => void = () => {}): T => {
  for (let retry = 0; ; retry++) {
    try {
      return fn();
    } catch (error) {
      if (retry >= RETRIES || !isTransient(error)) throw error;
      const ms = backoffMs(retry + 1);
      log(`${what}: transient error, retry ${retry + 1} of ${RETRIES} in ${ms / 1000}s: ${errorText(error).split('\n')[0]}`);
      sleep(ms);
    }
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// CI on a commit: every "checks" run on it (a push run and a pull_request run may both exist) must complete with success.

export type CiState = { state: 'none' } | { state: 'pending' } | { state: 'success' } | { state: 'failure'; conclusions: string[] };
export const ciState = (runs: CheckRun[]): CiState => {
  const ci = runs.filter((r) => r.name === CI_CHECK);
  if (ci.length === 0) return { state: 'none' };
  const bad = ci.filter((r) => r.status === 'completed' && r.conclusion !== 'success');
  if (bad.length > 0) return { state: 'failure', conclusions: bad.map((r) => `${r.conclusion ?? 'none'} ${r.html_url}`) };
  return ci.every((r) => r.status === 'completed') ? { state: 'success' } : { state: 'pending' };
};

// One poll of a CI wait. GitHub runs no pull_request CI on a PR that is CONFLICTING with its base, so before the build
// (`conflicting` is passed only there) a conflicting PR whose clean head has no CI run proceeds; the landing commit, which contains
// master, must still pass CI before the merge. A failed run always fails; a missing run past `appearS` fails otherwise.
export type CiStep = 'success' | 'wait' | 'skip' | { fail: string };
export const ciStep = (s: CiState, waitedS: number, limits: { appearS: number; waitS: number }, conflicting = false): CiStep => {
  if (s.state === 'success') return 'success';
  if (s.state === 'failure') return { fail: `did not succeed: ${s.conclusions.join('; ')}` };
  if (s.state === 'none' && conflicting) return 'skip';
  if (s.state === 'none' && waitedS >= limits.appearS) return { fail: `has no CI checks run after ${limits.appearS}s` };
  if (waitedS >= limits.waitS) return { fail: `CI checks still ${s.state} after ${limits.waitS}s` };
  return 'wait';
};

// What to do with a PR's base before landing: master is ready; a parent branch (or its review/* copy) whose head is already in
// master is retargeted to master (GitHub has not moved it); a parent that has not landed is a failure, since landing the child
// would carry the parent's commits in with it.
export type BaseAction = 'ready' | 'retarget' | { fail: string };
export const baseAction = (base: string, baseInMaster: boolean | null): BaseAction => {
  if (base === 'master') return 'ready';
  if (baseInMaster === true) return 'retarget';
  return { fail: baseInMaster === null ? `PR targets ${base}, which no longer exists and is not master` : `PR targets ${base}, whose changes are not in master yet; land its parent first` };
};

// `git worktree list --porcelain`: the worktrees on `branch` or at one of `shas`, except the given paths.
export const worktreesOf = (porcelain: string, branch: string, shas: readonly string[], except: readonly string[]): string[] => {
  const out: string[] = [];
  for (const block of porcelain.split('\n\n')) {
    let path = '';
    let head = '';
    let ref = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice(9);
      else if (line.startsWith('HEAD ')) head = line.slice(5);
      else if (line.startsWith('branch ')) ref = line.slice(7);
    }
    if (path === '' || except.includes(path) || except.includes(path.replace(/^\/private/, ''))) continue;
    if (ref === `refs/heads/${branch}` || shas.includes(head)) out.push(path);
  }
  return out;
};

// The quiet-machine gate: no heavy slot held by a live process of anyone else, and a 1-minute load under 20.
export const QUIET_LOAD = 20;
export const isQuiet = (otherHeavyHolders: number, load1: number): boolean => otherHeavyHolders === 0 && load1 < QUIET_LOAD;

// While the driver waits for quiet it holds /tmp/dragon-train-quiet (its pid), which stops /tmp/heavy-lease.sh from starting
// new jobs beside the train. It keeps holding it through the quiet rerun (waitForQuiet's `hold`), so jobs queued behind the
// request don't start beside the rerun and load the machine again; it is removed when the rerun ends, or when the wait fails,
// and never another process's file.
export const QUIET_FILE = '/tmp/dragon-train-quiet';
export const requestQuiet = (path: string, pid: number): void => writeFileSync(path, String(pid));
export const releaseQuiet = (path: string, pid: number): void => {
  try {
    if (readFileSync(path, 'utf8').trim() === String(pid)) rmSync(path, { force: true });
  } catch {}
};
// A request left by a driver that died (SIGKILL skips its cleanup) would hold every lane forever.
export const clearStaleQuiet = (path: string, alive: (pid: number) => boolean): boolean => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8').trim();
  } catch {
    return false;
  }
  const pid = Number(text);
  if (/^[1-9]\d*$/.test(text) && alive(pid)) return false;
  rmSync(path, { force: true });
  return true;
};

// Waits for a quiet machine with the quiet request held, up to `ceilingMs`; true when quiet, false at the ceiling.
// With `hold`, a quiet result keeps the request held and the caller releases it after its rerun; a failed wait always releases.
export const waitForQuiet = (o: { quiet: () => boolean; request: () => void; release: () => void; sleep: (ms: number) => void; now: () => number; ceilingMs: number; pollMs?: number; hold?: boolean }): boolean => {
  o.request();
  let keep = false;
  try {
    const t0 = o.now();
    for (;;) {
      if (o.quiet()) return (keep = o.hold === true), true;
      if (o.now() - t0 >= o.ceilingMs) return false;
      o.sleep(o.pollMs ?? 30_000);
    }
  } finally {
    if (!keep) o.release();
  }
};

// pr:review's banner when every Macroscope check of the head was skipped for the spending limit.
export const isUnreviewed = (prReviewOutput: string): boolean => /^!!! UNREVIEWED: Macroscope spending limit/m.test(prReviewOutput);

// ---------------------------------------------------------------------------------------------------------------------
// The Claude review gate: while Macroscope is at its limit, Claude reviews the PR's own diff (reviewed paths only) and any
// finding of Medium severity or higher stops the PR. Output that is not exactly the JSON asked for fails the gate.

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export type Finding = { severity: Severity; file: string; line: number | null; summary: string; failure_scenario: string };
export const BLOCKING: readonly Severity[] = ['medium', 'high', 'critical'];

export const REVIEW_PROMPT = `You are the correctness reviewer for a pull request to Dragon CSS, which compiles CSS into native view properties and
proves every supported feature against Chrome. Macroscope, the usual reviewer, is at its spending limit, so your findings decide
whether this PR merges. The PR's diff follows (source and tests only; generated outputs are left out). The repository at the PR
head is the current directory; read files from it when the diff alone does not show enough context.

Report only real defects of Medium severity or higher, each one a concrete way the code gives a wrong result. Look for:
- external input used unchecked (JSON, CLI arguments, dumps, device records, gh or git output);
- error paths that pass silently (a failure that ends as success, a caught error that is dropped);
- checks judged on a subset of the data (a gate that reads only some of the records it must cover);
- missing cleanup on failure (a lock, temp file, worktree or process left behind);
- a loosened tolerance, a deleted or skipped check or test, or a support claim without a passing comparison test;
- behaviour that differs from Chrome or from the CSS specification it implements.
Do not report style, naming, comments, performance, refactoring ideas, missing features, or anything you cannot tie to a
concrete failure.

Answer with JSON only, no prose and no code fence, exactly:
{"findings": [{"severity": "medium" | "high" | "critical", "file": "<path>", "line": <number or null>, "summary": "<one sentence>", "failure_scenario": "<the input or sequence that fails, and the wrong result>"}]}
Use {"findings": []} when there is nothing of Medium severity or higher.

The diff:
`;

// One file section of a unified git diff: its path (the b/ side, or the a/ side for a deletion) and its text.
export type DiffFile = { path: string; text: string };
export const splitPatch = (patch: string): DiffFile[] => {
  if (patch.trim() === '') return [];
  if (!patch.startsWith('diff --git ')) return fail(`the PR diff does not start with "diff --git": ${JSON.stringify(patch.slice(0, 120))}`);
  const files: DiffFile[] = [];
  for (const section of patch.split(/^(?=diff --git )/m)) {
    const header = /^diff --git a\/(.+) b\/(.+)$/m.exec(section.split('\n')[0] ?? '');
    if (header === null) return fail(`unparsable diff header ${JSON.stringify(section.split('\n')[0]?.slice(0, 200))}`);
    const plus = /^\+\+\+ b\/(.+)$/m.exec(section);
    const minus = /^--- a\/(.+)$/m.exec(section);
    const path = plus?.[1] ?? minus?.[1] ?? header[2]!;
    files.push({ path, text: section });
  }
  return files;
};
const isBinarySection = (text: string): boolean => /^(GIT binary patch|Binary files .* differ)$/m.test(text);
// The sections review reads: not ignored by .macroscope/ignore.md and not binary.
export const reviewedPatch = (patch: string, ignored: (path: string) => boolean): { text: string; paths: string[] } => {
  const kept = splitPatch(patch).filter((f) => !ignored(f.path) && !isBinarySection(f.text));
  return { text: kept.map((f) => f.text).join(''), paths: kept.map((f) => f.path) };
};

export type ReviewParse = { ok: true; findings: Finding[] } | { ok: false; error: string };
export const parseReview = (stdout: string): ReviewParse => {
  const bad = (error: string): ReviewParse => ({ ok: false, error });
  let text = stdout.trim();
  const fence = /^```(?:json)?\n([\s\S]*)\n```$/.exec(text);
  if (fence) text = fence[1]!.trim();
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (error) {
    return bad(`the reviewer did not print JSON (${error instanceof Error ? error.message : String(error)}): ${JSON.stringify(stdout.slice(0, 300))}`);
  }
  if (!isObject(v) || !Array.isArray(v.findings) || Object.keys(v).length !== 1) return bad(`the reviewer's JSON is not {"findings": [...]}: ${JSON.stringify(v)?.slice(0, 300)}`);
  const findings: Finding[] = [];
  for (const f of v.findings) {
    if (!isObject(f)) return bad(`a finding is not an object: ${JSON.stringify(f)?.slice(0, 200)}`);
    const severity = typeof f.severity === 'string' ? f.severity.toLowerCase() : '';
    if (!(SEVERITIES as readonly string[]).includes(severity)) return bad(`a finding has severity ${JSON.stringify(f.severity)}`);
    if (typeof f.file !== 'string' || f.file === '') return bad(`a finding has no file: ${JSON.stringify(f).slice(0, 200)}`);
    if (f.line !== null && f.line !== undefined && !(typeof f.line === 'number' && Number.isInteger(f.line) && f.line >= 0)) return bad(`a finding has line ${JSON.stringify(f.line)}`);
    if (typeof f.summary !== 'string' || f.summary.trim() === '') return bad(`a finding has no summary: ${JSON.stringify(f).slice(0, 200)}`);
    if (typeof f.failure_scenario !== 'string' || f.failure_scenario.trim() === '') return bad(`a finding has no failure_scenario: ${JSON.stringify(f).slice(0, 200)}`);
    findings.push({ severity: severity as Severity, file: f.file, line: typeof f.line === 'number' ? f.line : null, summary: f.summary.trim(), failure_scenario: f.failure_scenario.trim() });
  }
  return { ok: true, findings };
};

export type ReviewerRun = { status: number | null; signal: string | null; stdout: string; stderr: string; error?: string };
// Runs the reviewer command through sh, with the prompt on stdin, in `cwd` (the driver worktree at the PR head), with
// LAND_REVIEW_PR and LAND_REVIEW_HEAD (the queue line's clean head) in its environment.
export const reviewerEnv = (pr: number, cleanHead: string): Record<string, string> => ({ LAND_REVIEW_PR: String(pr), LAND_REVIEW_HEAD: cleanHead });
export const runReviewer = (command: string, input: string, cwd: string, timeoutMs: number, extraEnv: Record<string, string> = {}): ReviewerRun => {
  const r = spawnSync('/bin/sh', ['-c', command], { cwd, input, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...extraEnv } });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error.message } : {}) };
};

export type ReviewVerdict = { pass: true; findings: Finding[]; note: string } | { pass: false; findings: Finding[]; reason: string };
// The verdict on one reviewer run: a failed run or malformed output fails; any Medium+ finding fails; Low findings are kept.
export const reviewVerdict = (run: ReviewerRun): ReviewVerdict => {
  if (run.error !== undefined || run.signal !== null || run.status !== 0) {
    return { pass: false, findings: [], reason: `the reviewer did not finish: ${run.error ?? run.signal ?? `exit ${run.status}`}${run.stderr.trim() ? `: ${run.stderr.trim().slice(0, 300)}` : ''}` };
  }
  const parsed = parseReview(run.stdout);
  if (!parsed.ok) return { pass: false, findings: [], reason: parsed.error };
  const blocking = parsed.findings.filter((f) => BLOCKING.includes(f.severity));
  if (blocking.length > 0) return { pass: false, findings: parsed.findings, reason: `${blocking.length} finding(s) of Medium severity or higher` };
  return { pass: true, findings: parsed.findings, note: parsed.findings.length === 0 ? 'no findings' : `${parsed.findings.length} Low finding(s), not blocking` };
};

export type ReviewRecord = {
  pr: number;
  head: string;
  command: string;
  paths: string[];
  verdict: 'pass' | 'fail';
  reason: string;
  findings: Finding[];
  stdout: string;
  stderr: string;
};

// The whole gate for one PR: the reviewed part of its diff goes to the reviewer; a diff with no reviewed path passes without
// a run (Macroscope reviews nothing there either). `save` records every review; the PR's comment lists the blocking findings.
export const claudeReviewGate = (o: {
  pr: number;
  head: string;
  patch: string;
  ignored: (path: string) => boolean;
  command: string;
  review: (input: string) => ReviewerRun;
  save: (record: ReviewRecord) => void;
}): ReviewVerdict => {
  const { text, paths } = reviewedPatch(o.patch, o.ignored);
  const base = { pr: o.pr, head: o.head, command: o.command, paths };
  if (paths.length === 0) {
    const v: ReviewVerdict = { pass: true, findings: [], note: 'no reviewed path in the diff' };
    o.save({ ...base, verdict: 'pass', reason: v.note, findings: [], stdout: '', stderr: '' });
    return v;
  }
  const run = o.review(`${REVIEW_PROMPT}${text}`);
  const v = reviewVerdict(run);
  o.save({ ...base, verdict: v.pass ? 'pass' : 'fail', reason: v.pass ? v.note : v.reason, findings: v.findings, stdout: run.stdout, stderr: run.stderr });
  return v;
};

export const findingsComment = (pr: number, head: string, findings: readonly Finding[]): string => {
  const blocking = findings.filter((f) => BLOCKING.includes(f.severity));
  const lines = [`**Landing stopped: Claude correctness review of ${head.slice(0, 12)}** (Macroscope is at its spending limit)`, ''];
  for (const f of blocking) {
    lines.push(`- **${f.severity}** \`${f.file}${f.line === null ? '' : `:${f.line}`}\`: ${f.summary}`, `  Failure: ${f.failure_scenario}`);
  }
  lines.push('', `Fix each with a test, or reply with why it does not apply, then hand #${pr} back to the landing queue with the new clean head.`);
  return lines.join('\n');
};

// ---------------------------------------------------------------------------------------------------------------------
// After a merge: GitHub closes, rather than retargets, an open PR whose base branch is deleted. So every open PR based on the
// merged branch is moved to master first, the list is read again, and the branch is deleted last, only when none is left.

export type GhRun = (args: string[]) => string;
export const parseChildPrs = (out: string, branch: string): number[] => {
  const v: unknown = JSON.parse(out);
  if (!Array.isArray(v)) return fail(`gh pr list printed ${out.slice(0, 200)}`);
  return v.map((p: unknown) => {
    if (!isObject(p) || typeof p.number !== 'number' || !Number.isInteger(p.number) || p.baseRefName !== branch) return fail(`gh pr list --base ${branch} printed ${JSON.stringify(p).slice(0, 200)}`);
    return p.number;
  });
};
export type BranchCleanup = { retargeted: number[]; deleted: boolean; problems: string[] };
export const retargetChildrenThenDelete = (o: { repo: string; branch: string; gh: GhRun; log: (line: string) => void }): BranchCleanup => {
  const list = (): number[] => parseChildPrs(o.gh(['pr', 'list', '--repo', o.repo, '--base', o.branch, '--state', 'open', '--limit', '1000', '--json', 'number,baseRefName']), o.branch);
  const retargeted: number[] = [];
  const problems: string[] = [];
  const errorLine = (error: unknown): string => errorText(error).split('\n')[0]!;
  let children: number[];
  try {
    children = list();
  } catch (error) {
    return { retargeted, deleted: false, problems: [`kept branch ${o.branch}: could not list the open PRs based on it: ${errorLine(error)}`] };
  }
  for (const n of children) {
    try {
      o.gh(['pr', 'edit', String(n), '--repo', o.repo, '--base', 'master']);
      retargeted.push(n);
      o.log(`  #${n} was based on ${o.branch}; retargeted to master`);
    } catch (error) {
      problems.push(`#${n} is based on ${o.branch} and could not be retargeted to master: ${errorLine(error)}`);
    }
  }
  let left: number[];
  try {
    left = list();
  } catch (error) {
    problems.push(`could not list the open PRs based on ${o.branch} again: ${errorLine(error)}`);
    left = [];
  }
  if (problems.length === 0 && left.length > 0) problems.push(`open PRs still based on ${o.branch}: ${left.map((n) => `#${n}`).join(', ')}`);
  if (problems.length > 0) {
    problems.unshift(`kept branch ${o.branch} so no PR based on it is closed`);
    return { retargeted, deleted: false, problems };
  }
  try {
    o.gh(['api', '-X', 'DELETE', `repos/${o.repo}/git/refs/heads/${o.branch}`]);
  } catch (error) {
    return { retargeted, deleted: false, problems: [`could not delete branch ${o.branch}: ${errorLine(error)}`] };
  }
  o.log(`  deleted branch ${o.branch}`);
  return { retargeted, deleted: true, problems };
};

// ---------------------------------------------------------------------------------------------------------------------
// Floors may only rise (PIN-DERIVE). A floor is a minimum checked against the tree, so a merge resolution that lowers one passes
// every test and silently stops protecting; the landing commit's floors are therefore compared with origin/master's.
// Formats, from the helpers that read them:
// - packages/{dragon,parity}/test/floor.ts: { key: [names] }. Every name stays; an ordered floor keeps its order, and an unordered
//   one is written sorted, so keeping master's names in master's relative order is required of every list.
// - packages/translate/test/floor.ts: { key: { order: [suites], counts: { suite: n } } }. Suites stay in order; counts never fall.
// - css-escapes-floor.json (css-escapes.test.ts): { key: n }. Keys stay; counts never fall.
// - glyph-clearance-pins.json (pixel-reference.test.ts): { case: { "<target>@<dpr>": { dropped: { kind: n }, rescued: { kind: n } } } },
//   exact pins of the rules a case's comparison drops and rescues. For a case master pins, no rescued count falls and no dropped
//   count rises (a missing count is 0), so the comparison never covers less; a new case is free.

export const isFloorFile = (path: string): boolean => /^packages\/[^/]+\/test\/([^/]+-floor|glyph-clearance-pins)\.json$/.test(path);

const isCounts = (v: unknown): v is Record<string, number> => isObject(v) && Object.values(v).every((n) => typeof n === 'number' && Number.isFinite(n));
const isNames = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isSuiteFloor = (v: unknown): v is { order: string[]; counts: Record<string, number> } => isObject(v) && isNames(v.order) && isCounts(v.counts);

const namesProblems = (key: string, was: string[], now: string[]): string[] => {
  const gone = was.filter((x) => !now.includes(x));
  const problems = gone.map((x) => `${key}: ${JSON.stringify(x)} removed`);
  const kept = was.filter((x) => now.includes(x));
  const at = kept.map((x) => now.indexOf(x));
  for (let i = 1; i < at.length; i++) if (at[i]! < at[i - 1]!) problems.push(`${key}: ${JSON.stringify(kept[i])} now comes before ${JSON.stringify(kept[i - 1])}`);
  return problems;
};
const countsProblems = (key: string, was: Record<string, number>, now: Record<string, number>): string[] =>
  Object.entries(was).flatMap(([k, n]) => (now[k] === undefined ? [`${key}.${k}: removed (was ${n})`] : now[k]! < n ? [`${key}.${k}: lowered ${n} -> ${now[k]}`] : []));

const pinsProblems = (was: Record<string, unknown>, now: Record<string, unknown>): string[] => {
  const problems: string[] = [];
  const tally = (v: unknown, side: 'dropped' | 'rescued'): Record<string, number> => (isObject(v) && isCounts(v[side]) ? v[side] : {});
  for (const [c, wasAt] of Object.entries(was)) {
    const nowAt = isObject(now[c]) ? now[c] : {};
    if (!isObject(wasAt)) continue;
    for (const at of new Set([...Object.keys(wasAt), ...Object.keys(nowAt)])) {
      const [wr, nr] = [tally(wasAt[at], 'rescued'), tally(nowAt[at], 'rescued')];
      for (const [k, n] of Object.entries(wr)) if ((nr[k] ?? 0) < n) problems.push(`${c} ${at} rescued.${k}: lowered ${n} -> ${nr[k] ?? 0}`);
      const [wd, nd] = [tally(wasAt[at], 'dropped'), tally(nowAt[at], 'dropped')];
      for (const [k, n] of Object.entries(nd)) if (n > (wd[k] ?? 0)) problems.push(`${c} ${at} dropped.${k}: raised ${wd[k] ?? 0} -> ${n}`);
    }
  }
  return problems;
};

/** Why the landing commit's version of a floor file (`now`, null when absent) is below master's (`was`, null when absent). */
export const floorRegressions = (path: string, was: string | null, now: string | null): string[] => {
  if (was === null) return [];
  if (now === null) return [`${path}: removed (it is on master)`];
  let w: unknown;
  let n: unknown;
  try {
    w = JSON.parse(was);
    n = JSON.parse(now);
  } catch (error) {
    return [`${path}: not JSON on one side: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!isObject(w) || !isObject(n)) return [`${path}: not a JSON object on one side`];
  const problems: string[] = [];
  const out = (p: string): number => problems.push(`${path}: ${p}`);
  if (/glyph-clearance-pins\.json$/.test(path)) {
    const shape = (v: Record<string, unknown>): boolean => Object.values(v).every((at) => isObject(at) && Object.values(at).every((t) => isObject(t) && isCounts(t.dropped) && isCounts(t.rescued)));
    if (!shape(w) || !shape(n)) return [`${path}: not { case: { at: { dropped, rescued } } } on one side`];
    for (const p of pinsProblems(w, n)) out(p);
    return problems;
  }
  for (const [key, wv] of Object.entries(w)) {
    const nv = n[key];
    if (nv === undefined) out(`${key}: removed`);
    else if (isNames(wv)) isNames(nv) ? namesProblems(key, wv, nv).forEach(out) : out(`${key}: no longer a list of names`);
    else if (typeof wv === 'number') typeof nv !== 'number' ? out(`${key}: no longer a number`) : nv < wv ? out(`${key}: lowered ${wv} -> ${nv}`) : 0;
    else if (isSuiteFloor(wv)) {
      if (!isSuiteFloor(nv)) out(`${key}: no longer { order, counts }`);
      else {
        namesProblems(`${key}.order`, wv.order, nv.order).forEach(out);
        countsProblems(`${key}.counts`, wv.counts, nv.counts).forEach(out);
      }
    } else out(`${key}: a floor shape the driver cannot judge`);
  }
  return problems;
};

// ---------------------------------------------------------------------------------------------------------------------
// The queue loop: a failed PR is recorded and the queue continues; only a Fatal error (master in an unexpected state) stops it.

export class LandFailure extends Error {
  readonly step: string;
  readonly comment: string | undefined;
  constructor(step: string, reason: string, comment?: string) {
    super(reason);
    this.step = step;
    this.comment = comment;
  }
}
export class Fatal extends Error {}

export type Outcome = { entry: Entry; result: 'landed' | 'merged before' | 'failed'; step?: string; detail: string };
export const runQueue = (
  entries: readonly Entry[],
  landOne: (e: Entry) => { result: 'landed' | 'merged before'; detail: string },
  onFail: (e: Entry, f: LandFailure) => void,
  onOutcome: (outcomes: readonly Outcome[]) => void,
): { outcomes: Outcome[]; fatal: string | null; exit: 0 | 1 } => {
  const outcomes: Outcome[] = [];
  let fatal: string | null = null;
  for (const e of entries) {
    try {
      outcomes.push({ entry: e, ...landOne(e) });
    } catch (error) {
      if (error instanceof Fatal) {
        fatal = error.message;
        outcomes.push({ entry: e, result: 'failed', step: 'fatal', detail: fatal });
        onOutcome(outcomes);
        break;
      }
      // Anything else (a gh outage past its retries, unreadable output) fails this PR only.
      const f = error instanceof LandFailure ? error : new LandFailure('error', error instanceof Error ? error.message : String(error));
      outcomes.push({ entry: e, result: 'failed', step: f.step, detail: f.message });
      onFail(e, f);
    }
    onOutcome(outcomes);
  }
  return { outcomes, fatal, exit: fatal === null && outcomes.every((o) => o.result !== 'failed') ? 0 : 1 };
};

// ---------------------------------------------------------------------------------------------------------------------
// Batched landing. Up to `size` admitted PRs are built as a chain of positions on master: position k merges PR k's tip onto
// position k-1 and adds its own regen commit, with its own device evidence (devices run at a position whose evidence stamp
// differs from the position before it). The top position is proved once (`prove`: the full test). On success every PR is
// published in order: its position is pushed to its branch only after the PR before it merged, so a PR branch never carries
// another PR's unlanded commits, and each merge is pinned to that position (--match-head-commit). When the top fails, the
// prefixes are bisected: the first failing position is the culprit, found in ceil(log2 n) more proofs; the passing prefix
// lands, the culprit fails with its own failing run, and the PRs after it go back to the front of the queue. A failure while
// building a position ejects that PR only, and the chain continues on the position before it.

export type BatchOps<T, P extends { head: string }> = {
  /** Checks a PR before any build: the PR, its base, its CI and its review at the current head. Throws LandFailure to eject.
   *  `earlier` are the PRs admitted to this batch before it, which land first (a PR may be based on one of their branches). */
  admit: (e: Entry, earlier: readonly Entry[]) => { merged: string } | { ticket: T };
  /** The commit the batch builds on (origin/master). */
  base: () => string;
  /** Builds the position of `e` on `prev`. Throws LandFailure to eject `e`; the chain continues on `prev`. */
  build: (prev: string, e: Entry, ticket: T, k: number) => P;
  /** Checks the built chain is exactly the positions it claims to be; any error is fatal. */
  verify: (built: readonly { entry: Entry; ticket: T; position: P }[]) => void;
  /** Proves the tree of one position (the full test). Throws LandFailure when it fails. */
  prove: (position: P, e: Entry) => void;
  /** Pushes, reviews and merges one PR at its position. Throws LandFailure (that PR fails) or Fatal. */
  publish: (e: Entry, position: P, ticket: T) => string;
  onFail: (e: Entry, f: LandFailure) => void;
  onOutcome: (outcomes: readonly Outcome[]) => void;
  log: (line: string) => void;
};

export const MAX_BATCH = 8;
export const parseBatchSize = (v: string | undefined): number => {
  if (v === undefined) return 4;
  if (!/^[1-9]\d*$/.test(v) || Number(v) > MAX_BATCH) return fail(`LAND_BATCH must be a whole number from 1 to ${MAX_BATCH}, not ${JSON.stringify(v)}`);
  return Number(v);
};

const asFailure = (error: unknown): LandFailure =>
  error instanceof LandFailure ? error : new LandFailure('error', error instanceof Error ? error.message : String(error));
const prs = (es: readonly Entry[]): string => es.map((e) => `#${e.pr}`).join(' ');

// The first failing prefix of `n` positions whose top (position n) failed with `top`: positions are 1-based, position 0 is the
// base (taken to pass). Returns the culprit's position, the culprit's own failure, and how many proofs the search ran.
export const bisectPrefixes = (n: number, top: LandFailure, prove: (k: number) => void): { culprit: number; failure: LandFailure; proofs: number } => {
  let [lo, hi, failure, proofs] = [0, n, top, 0];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    proofs++;
    try {
      prove(mid);
      lo = mid;
    } catch (error) {
      if (error instanceof Fatal) throw error;
      hi = mid;
      failure = asFailure(error);
    }
  }
  return { culprit: hi, failure, proofs };
};

export const runBatches = <T, P extends { head: string }>(
  entries: readonly Entry[],
  size: number,
  ops: BatchOps<T, P>,
): { outcomes: Outcome[]; fatal: string | null; exit: 0 | 1 } => {
  if (!Number.isInteger(size) || size < 1) return fail(`batch size ${size}`);
  const queue = [...entries];
  const outcomes: Outcome[] = [];
  let fatal: string | null = null;
  const done = (o: Outcome): void => {
    outcomes.push(o);
    ops.onOutcome(outcomes);
  };
  const failed = (e: Entry, error: unknown): void => {
    if (error instanceof Fatal) throw error;
    const f = asFailure(error);
    outcomes.push({ entry: e, result: 'failed', step: f.step, detail: f.message });
    ops.onFail(e, f);
    ops.onOutcome(outcomes);
  };
  let at: Entry | null = null;
  try {
    while (queue.length > 0) {
      const admitted: { entry: Entry; ticket: T }[] = [];
      while (admitted.length < size && queue.length > 0) {
        const e = (at = queue.shift()!);
        try {
          const a = ops.admit(e, admitted.map((x) => x.entry));
          if ('merged' in a) done({ entry: e, result: 'merged before', detail: a.merged });
          else admitted.push({ entry: e, ticket: a.ticket });
        } catch (error) {
          failed(e, error);
        }
      }
      if (admitted.length === 0) continue;

      let prev: string;
      try {
        prev = ops.base();
      } catch (error) {
        throw error instanceof Fatal ? error : new Fatal(`could not read master: ${error instanceof Error ? error.message : String(error)}`);
      }
      const built: { entry: Entry; ticket: T; position: P }[] = [];
      for (const m of admitted) {
        at = m.entry;
        try {
          const position = ops.build(prev, m.entry, m.ticket, built.length + 1);
          built.push({ ...m, position });
          prev = position.head;
        } catch (error) {
          failed(m.entry, error);
        }
      }
      if (built.length === 0) continue;
      at = built[0]!.entry;
      try {
        ops.verify(built);
      } catch (error) {
        throw error instanceof Fatal ? error : new Fatal(`the batch ${prs(built.map((b) => b.entry))} is not the chain of positions it claims: ${error instanceof Error ? error.message : String(error)}`);
      }
      ops.log(`batch ${prs(built.map((b) => b.entry))}: ${built.length} position(s) built; proving the top ${built.at(-1)!.position.head}`);

      // Prove the top; when it fails, bisect the prefixes for the first failing position.
      let good = built.length;
      let culprit: { index: number; failure: LandFailure } | null = null;
      const proveAt = (k: number): void => {
        const b = built[k - 1]!;
        at = b.entry;
        ops.prove(b.position, b.entry);
      };
      try {
        proveAt(built.length);
      } catch (error) {
        if (error instanceof Fatal) throw error;
        const top = asFailure(error);
        const found = bisectPrefixes(built.length, top, proveAt);
        good = found.culprit - 1;
        const passing = built.slice(0, good).map((b) => b.entry);
        const note =
          built.length === 1
            ? ''
            : `\n\nFound by bisecting the batch ${prs(built.map((b) => b.entry))} (${found.proofs + 1} proofs): ${passing.length === 0 ? 'master' : `master with ${prs(passing)}`} passes, adding #${built[good]!.entry.pr} fails.`;
        culprit = { index: good, failure: new LandFailure(found.failure.step, `${found.failure.message}${note}`, found.failure.comment) };
        ops.log(`batch: the top failed at ${top.step}; culprit #${built[good]!.entry.pr} after ${found.proofs} more proof(s)`);
      }

      // Publish the proven prefix in order. A failure stops the batch there; the PRs after it go back to the queue.
      let published = 0;
      for (; published < good; published++) {
        const b = built[published]!;
        at = b.entry;
        try {
          done({ entry: b.entry, result: 'landed', detail: ops.publish(b.entry, b.position, b.ticket) });
        } catch (error) {
          failed(b.entry, error);
          break;
        }
      }
      let requeue: Entry[];
      if (published < good) requeue = built.slice(published + 1).map((b) => b.entry); // the culprit's verdict assumed this prefix lands
      else {
        if (culprit !== null) failed(built[culprit.index]!.entry, culprit.failure);
        requeue = built.slice(good + 1).map((b) => b.entry);
      }
      if (requeue.length > 0) ops.log(`batch: ${prs(requeue)} go back to the front of the queue, to be built on the new master`);
      queue.unshift(...requeue);
    }
  } catch (error) {
    if (!(error instanceof Fatal)) throw error;
    fatal = error.message;
    if (at !== null) outcomes.push({ entry: at, result: 'failed', step: 'fatal', detail: fatal });
    ops.onOutcome(outcomes);
  }
  return { outcomes, fatal, exit: fatal === null && outcomes.every((o) => o.result !== 'failed') ? 0 : 1 };
};

export const statusText = (o: { queue: string; startedAt: string; now: string; running: Entry | null; outcomes: readonly Outcome[]; fatal: string | null; total: number; done: boolean }): string => {
  const lines = [`land ${o.done ? (o.fatal ? 'STOPPED' : 'DONE') : 'RUNNING'} ${o.now} (started ${o.startedAt}) queue ${o.queue}: ${o.outcomes.length} of ${o.total} handled`];
  if (o.fatal) lines.push(`fatal: ${o.fatal}`);
  if (o.running) lines.push(`landing now: #${o.running.pr} ${o.running.branch}`);
  for (const r of o.outcomes) {
    const id = `#${r.entry.pr} ${r.entry.branch}`;
    lines.push(r.result === 'failed' ? `  FAILED ${id} at ${r.step}: ${r.detail}` : `  ${r.result === 'landed' ? 'landed' : 'merged before'} ${id}: ${r.detail}`);
  }
  const failed = o.outcomes.filter((r) => r.result === 'failed').length;
  if (o.done) lines.push(failed === 0 && !o.fatal ? 'every PR landed' : `${failed} PR(s) failed; each has the landing-failed label and a comment naming the step`);
  return `${lines.join('\n')}\n`;
};
