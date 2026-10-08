// The checked parts of land.ts: queue and argument parsing, retries of network calls, the CI verdict, the Claude review gate and
// the queue loop that records a failed PR and continues. The git and device judgements come from merge-train-lib.ts.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, constants as fsConstants, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { type CheckRun, CI_CHECK } from './pr-review-vouch.ts';
import { type DeviceEvidence, modelChanges } from './merge-train-lib.ts';

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

// `allowEmpty` (land.yml, LAND_QUEUE_EMPTY_OK=1): an empty queue is nothing to land rather than a mistake.
export const parseQueue = (text: string, o: { allowEmpty?: boolean } = {}): Entry[] => {
  const entries: Entry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '') continue;
    if (/^train\b/.test(line)) return fail(`"${line}": trains are gone; the queue is a plain list of <branch>:<pr>:<clean-head> lines`);
    entries.push(parseEntry(line));
  }
  if (entries.length === 0 && o.allowEmpty !== true) return fail('the queue has no entries');
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
  full test, 1 to 8, default 4; 1 lands one PR per proof), LAND_PIPELINE (0 turns off preparing the next batch, in
  LAND_WORKTREE_NEXT, default /tmp/dragon-land-next, while a batch publishes), LAND_DEVICES (local, the default: the device lanes
  under /tmp/device-lease.sh; ci: device-lanes.yml on GitHub runners for each position's tree; the local run until master has
  device-lanes.yml), LAND_DEVICES_WAIT (seconds, 9000), LAND_TEST (local, the default: pnpm test here; ci: full-test.yml on GitHub
  runners for each proved tree; the local test until master has full-test.yml), LAND_TEST_WAIT (seconds, 22500), LAND_REGEN (local,
  the default: pnpm regen here; ci: regen-on-ci.yml in patch mode), LAND_REGEN_WAIT (seconds, default past regen-on-ci.yml's chain of round timeouts). Each of LAND_DEVICES,
  LAND_TEST and LAND_REGEN may also be ci-only: the step never runs here, and when GitHub Actions does not run it the driver stops
  as a CI outage, failing no PR and leaving the rest of the queue queued. LAND_CI=only sets all three to ci-only (the setting for a
  host that is not this Mac): no lease, quiet-machine or priority file, and no /tmp helper script is used. LAND_CI_START (seconds
  a CI run may go without starting a job, with none waiting for a runner, before GitHub Actions counts as not running it, default
  900), LAND_CI_QUEUE_WAIT (seconds a run whose jobs wait for a runner, as behind the macOS concurrency cap, is waited for before
  that counts as not running it, default 10800), LAND_CI_MAX_INFLIGHT (positions of a batch whose CI regens are dispatched at once,
  1 to 8, default 2; the positions above are built one by one). For a host with no state of its own (land.yml): LAND_REVIEW_SOURCE=comment
  (the default reviewer reads the review from a PR comment, pnpm land:post-review), LAND_STOP_ISSUE
  (an issue whose land-stop label stops the driver after its batch, as the stop file does), LAND_MAX_BATCHES (batches this run
  lands; the rest goes to LAND_HANDOFF for the next run), LAND_LOG_DIR (the status, logs, reviews and run directory, instead of /tmp),
  LAND_QUEUE_EMPTY_OK=1 (an empty queue is nothing to land). Reviewers are matched by user id (LAND_REVIEWER_IDS, or LAND_REVIEWERS
  ids or logins), and the token's own identity (GET user, or LAND_TOKEN_USER_ID for an App token) may not be one. Every run reads and
  writes master's land/proof commit status, trusting only statuses by that identity or LAND_PROOF_WRITERS ids. Under LAND_CI=only
  each run records on each PR's head (land/outage) whether it ended with a verdict about the PR or an outage in a step that ran its
  tree (or was killed); LAND_OUTAGE_EJECT such runs in a row (default 2) eject the PR at admission, and a PR with any is built alone
  until it gets a verdict. pnpm land:clear-outage <pr> ends a streak after a real outage.`;
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
  // Two processes of one run (the driver and its builder) fetching at once contend for a ref lock.
  /cannot lock ref/i,
  /Unable to create '.*\.lock'/i,
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
// `outage`: GitHub Actions ran no verdict (no run appeared, or it never finished), as opposed to a run that did not succeed.
export type CiStep = 'success' | 'wait' | 'skip' | { fail: string; outage?: true };
export const ciStep = (s: CiState, waitedS: number, limits: { appearS: number; waitS: number }, conflicting = false): CiStep => {
  if (s.state === 'success') return 'success';
  if (s.state === 'failure') return { fail: `did not succeed: ${s.conclusions.join('; ')}` };
  if (s.state === 'none' && conflicting) return 'skip';
  if (s.state === 'none' && waitedS >= limits.appearS) return { fail: `has no CI checks run after ${limits.appearS}s`, outage: true };
  if (waitedS >= limits.waitS) return { fail: `CI checks still ${s.state} after ${limits.waitS}s`, outage: true };
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
// A machine this idle is quiet even with a heavy slot held: a holder sitting near-idle (a profiling run, a job waiting on a
// device) kept the gate shut for over an hour at load ~1. The quiet request still stops new jobs from starting meanwhile.
export const IDLE_LOAD = 6;
export const isQuiet = (otherHeavyHolders: number, load1: number): boolean => load1 < IDLE_LOAD || (otherHeavyHolders === 0 && load1 < QUIET_LOAD);

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

// The test files a vitest run reports as failing, from its log; null when the log has no summary (the run crashed or was
// killed), so the caller reruns the whole suite instead of trusting a partial list.
export const SOLO_RERUN_MAX = 40;
export const failingTestFiles = (logText: string): string[] | null => {
  const plain = logText.replace(/\x1b\[[0-9;]*m/g, '');
  if (!/^\s*Test Files\s/m.test(plain)) return null;
  const files = new Set<string>();
  for (const m of plain.matchAll(/^ FAIL\s+(\S+\.test\.ts)/gm)) files.add(m[1]!);
  return [...files].sort();
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

// Before proving a tree other than the one just built, ignored outputs of other trees go (reports, lane outputs, tsbuildinfo);
// installs, fetched WPT and native build caches stay, since no test reads them as results.
// packages/translate/out/{kotlin,swift}/ are content-keyed harness build caches (native.ts buildKotlin/buildSwift): valid for any
// tree, and removing their files (but not their directories) once left stale entries that blocked every later build (#164).
export const KEEP_IGNORED = ['node_modules/', 'vendor/wpt/', 'build/', '.build/', '.swiftpm/', '.zig-cache/', 'zig-out/', 'Cargo.lock', '.vercel/', 'packages/translate/out/kotlin/', 'packages/translate/out/swift/'];
// Lists every ignored file (NUL-separated). `git clean -X` with `-e !kept/` negations (the first version) un-ignores a kept
// directory, so git descends into it and deletes the ignored files nested inside: node_modules/.pnpm/*/dist/ (every installed
// package's code) went, and every later test run failed to start. Pathspec excludes don't help either: git clean removes a
// whole ignored directory as one unit. So the driver lists the ignored files and removes those outside the kept trees itself.
export const ignoredFilesArgs = (): string[] => ['ls-files', '-z', '--others', '--ignored', '--exclude-standard'];
const keptIgnored = (path: string): boolean =>
  KEEP_IGNORED.some((k) => (k.endsWith('/') ? `/${path}`.includes(`/${k}`) : path === k || path.endsWith(`/${k}`)));
export const ignoredToRemove = (lsFilesZ: string): string[] => lsFilesZ.split('\0').filter((p) => p !== '' && !keptIgnored(p));

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
// LAND_TRUSTED (land.yml): the job that holds the landing token runs no code of a PR or a merged tree. Its own commands run only in
// its trusted checkout (MAIN, master at dispatch time), and git's merge drivers, which git runs inside the landing worktree, are
// the trusted checkout's scripts by absolute path, never the tree's own scripts/.

/** pnpm setup:git's config with each `node scripts/<x>` driver pointed at the trusted checkout's copy. */
export const trustedGitConfig = (entries: readonly (readonly [string, string])[], main: string): [string, string][] => {
  if (!main.startsWith('/') || /['"\\$`\s]/.test(main)) throw new Error(`land: the trusted checkout ${JSON.stringify(main)} must be an absolute path with no quotes, spaces or shell characters`);
  const out = entries.map(([k, v]): [string, string] => [k, v.replace(/^node scripts\//, `node '${main}/scripts/`).replace(/^(node '[^']+\.ts)( |$)/, "$1'$2")]);
  // Every driver is a no-op or the trusted checkout's script; anything else would run code from the tree being merged.
  for (const [k, v] of out) if (k.endsWith('.driver') && v !== 'true' && !v.startsWith(`node '${main}/scripts/`)) throw new Error(`land: the merge driver ${k} = ${JSON.stringify(v)} is not the trusted checkout's script`);
  return out;
};
/** Why a command may not run in `cwd` under LAND_TRUSTED (any directory but the trusted checkout holds a tree's code), or null. */
// A package manager runs package.json commands, which review does not read as code, so none runs anywhere in the token job.
const PACKAGE_MANAGERS = new Set(['pnpm', 'npx', 'npm', 'yarn', 'pnpx', 'corepack']);
export const treeCodeRefusal = (argv: readonly string[], cwd: string, main: string, resolve: (p: string) => string): string | null => {
  const bin = (argv[0] ?? '').split('/').at(-1)!;
  if (PACKAGE_MANAGERS.has(bin)) return `LAND_TRUSTED: refusing to run ${argv.join(' ')}: in the job that holds the landing token no package manager runs (its scripts are package.json commands); run the script with node`;
  return resolve(cwd) === resolve(main) ? null : `LAND_TRUSTED: refusing to run ${argv.join(' ')} in ${cwd}: in the job that holds the landing token only the trusted checkout's own commands run; a tree's commands run in land-checks.yml`;
};

/**
 * Writes a file inside a tree's worktree without following a symlink anywhere on its path (a tree can plant one, pointing at the
 * trusted checkout): every directory on the way must be a real directory, and the file is opened with O_NOFOLLOW.
 */
// The directories on the way to `rel`, each a real directory (created when `create`), never a symlink.
const realParents = (root: string, rel: string, create: boolean, what: string): void => {
  const parts = rel.split('/');
  if (rel === '' || rel.startsWith('/') || parts.some((x) => x === '' || x === '.' || x === '..')) throw new Error(`land: ${JSON.stringify(rel)} is not a plain relative path`);
  let at = root;
  for (const part of parts.slice(0, -1)) {
    at = `${at}/${part}`;
    const st = lstatSync(at, { throwIfNoEntry: false });
    if (st === undefined && create) mkdirSync(at);
    else if (st === undefined) return;
    else if (!st.isDirectory()) throw new Error(`land: ${at} is ${st.isSymbolicLink() ? 'a symlink' : 'not a directory'}; refusing to ${what} ${rel} through it`);
  }
};
const noFollow = (path: string, flags: number, what: string): number => {
  try {
    return openSync(path, flags | fsConstants.O_NOFOLLOW, 0o644);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ELOOP') throw new Error(`land: ${path} is a symlink; refusing to ${what} it`);
    throw error;
  }
};
export const writeInTree = (root: string, rel: string, data: string | Buffer): void => {
  realParents(root, rel, true, 'write');
  const fd = noFollow(`${root}/${rel}`, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC, 'write');
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data) : data);
  } finally {
    closeSync(fd);
  }
};
/** Reads a file inside a tree's worktree without following a symlink (a tree's link could name any file the runner can read). */
export const readInTree = (root: string, rel: string): string => {
  realParents(root, rel, false, 'read');
  const fd = noFollow(`${root}/${rel}`, fsConstants.O_RDONLY, 'read');
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
};
/** Removes a file inside a tree's worktree; a symlinked directory on its way is refused, and a symlink itself is removed, not its target. */
export const removeInTree = (root: string, rel: string): void => {
  realParents(root, rel, false, 'remove');
  rmSync(`${root}/${rel}`, { force: true });
};
/** `git ls-tree` or `git ls-files -s` output: the paths that are symlinks (mode 120000). */
export const symlinkEntries = (lsOutput: string): string[] =>
  lsOutput.split(/\0|\n/).flatMap((l) => {
    const m = /^120000 [0-9a-f]+(?: \d+)?\t(.*)$/.exec(l);
    return m ? [m[1]!] : [];
  });
/** A git patch that creates or keeps a symlink (mode 120000). A regen's outputs are never symlinks. */
// Line ends are normalised first: git apply takes a CRLF patch, so a "mode 120000\r" line must not slip past.
export const patchHasSymlink = (patch: string): boolean => /^(?:new file mode|new mode|old mode|deleted file mode)[ \t]+120000[ \t]*$|^index [0-9a-f]+\.\.[0-9a-f]+[ \t]+120000[ \t]*$/m.test(patch.replace(/\r/g, ''));

/** The marker line of a precomputed review comment (land-review-lookup.ts reads it, pnpm land:post-review writes it). */
export const REVIEW_MARKER = '<!-- dragon-land-review v1 -->';
/**
 * A comment body the driver posts, made unreadable as a review: no HTML comment can open (so no marker line), and no code fence
 * is a json block. The driver posts log tails and finding texts a PR controls, under an identity a reviewer allowlist must not hold.
 */
export const defangReview = (body: string): string =>
  body.replaceAll('<!--', '&lt;!--').replace(/^([ \t]*)(`{3,}|~{3,})([ \t]*)json\b/gim, '$1$2$3text');

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
/**
 * A CI step GitHub Actions did not run under ci-only (no run, jobs that never started or waited past LAND_CI_QUEUE_WAIT, setup
 * failures): nothing was judged and nothing may run locally instead, so the driver stops. No PR is failed for it, and every PR
 * not landed yet stays queued (runBatches' `stopped`).
 */
export class CiOutage extends Fatal {}

// ---------------------------------------------------------------------------------------------------------------------
// Where each heavy step runs: LAND_DEVICES, LAND_TEST and LAND_REGEN, each local (here), ci (on GitHub runners, falling back to a
// local run when GitHub Actions does not run it) or ci-only (on GitHub runners, never here: a CI outage stops the driver).
// LAND_CI=only sets all three to ci-only; with it set, any of them set to anything else is refused.

export type CiMode = 'local' | 'ci' | 'ci-only';
export type LandModes = { devices: CiMode; test: CiMode; regen: CiMode; ciOnly: boolean };
const MODES: readonly CiMode[] = ['local', 'ci', 'ci-only'];
export const parseLandModes = (env: Readonly<Record<string, string | undefined>>): LandModes => {
  const all = env['LAND_CI'];
  if (all !== undefined && all !== 'only') return fail(`LAND_CI must be only (or unset), not ${JSON.stringify(all)}`);
  const one = (name: string): CiMode => {
    const v = env[name];
    if (v === undefined) return all === 'only' ? 'ci-only' : 'local';
    if (!(MODES as readonly string[]).includes(v)) return fail(`${name} must be local, ci or ci-only, not ${JSON.stringify(v)}`);
    if (all === 'only' && v !== 'ci-only') return fail(`LAND_CI=only runs every step on CI only, but ${name} is ${JSON.stringify(v)}`);
    return v as CiMode;
  };
  const devices = one('LAND_DEVICES');
  const test = one('LAND_TEST');
  const regen = one('LAND_REGEN');
  return { devices, test, regen, ciOnly: devices === 'ci-only' && test === 'ci-only' && regen === 'ci-only' };
};
/** LAND_CI_MAX_INFLIGHT: how many positions of a batch have a CI regen dispatched at once, 1 to MAX_BATCH (default 2). */
export const parseMaxInflight = (v: string | undefined): number => {
  if (v === undefined) return 2;
  if (!/^[1-9]\d*$/.test(v) || Number(v) > MAX_BATCH) return fail(`LAND_CI_MAX_INFLIGHT must be a whole number from 1 to ${MAX_BATCH}, not ${JSON.stringify(v)}`);
  return Number(v);
};

// ---------------------------------------------------------------------------------------------------------------------
// The Android image ABI of device records (R3 of the cloud migration's parity proof). CI's Android emulator is x86_64 and this
// Mac's arm64, and merge-train-lib's modelChanges binds each lane to master's device model, so the first device run on CI after
// records made here differs in architecture only. Under LAND_DEVICES=ci or ci-only that one transition is an automatic
// architecture rebaseline (ciArchRebaseline); any other model change still needs LAND_ARCH_REBASELINE.

/** An Android ABI (or a process.arch), with arm64-v8a and aarch64 read as arm64 and x64 as x86_64. */
export const normalAbi = (abi: string): string => (/^(arm64-v8a|aarch64)$/.test(abi) ? 'arm64' : abi === 'x64' ? 'x86_64' : abi);
/** The Android emulator ABI a host runs (process.arch), as normalAbi names it. */
export const hostAbi = (arch: string): string => normalAbi(arch);
const ANDROID_MODEL = /^(.*\bbuilt for )(\S+)(.*)$/;

/** The Android ABIs a position's device records ran on: each device set's model and each vectors run's toolchain. */
export const androidAbis = (e: DeviceEvidence): Set<string> => {
  const out = new Set<string>();
  for (const t of e.targets.values()) {
    for (const sets of t.runs.values()) for (const s of sets) {
      const m = s.model === null ? null : ANDROID_MODEL.exec(s.model);
      if (m !== null) out.add(normalAbi(m[2]!));
    }
    for (const v of t.vectorsArch?.values() ?? []) out.add(normalAbi(v.abi));
  }
  return out;
};

/**
 * Every model change of `run` against `base`, as modelChanges finds them, split into Android ABI changes (the same model and
 * device but for the image ABI) and anything else. A count that differs from modelChanges' is reported under `other`, so a
 * change this split does not see is never let through.
 */
export const archChanges = (base: DeviceEvidence, run: DeviceEvidence): { abi: string[]; other: string[] } => {
  const abi: string[] = [];
  const other: string[] = [];
  let expected = 0;
  for (const [target, b] of base.targets) {
    const r = run.targets.get(target);
    if (r === undefined) continue;
    expected += modelChanges(b, r, target).length;
    for (const [lane, sets] of r.runs) {
      const was = b.runs.get(lane);
      if (was === undefined) continue;
      for (const s of sets) {
        const x = was.find((y) => y.dpr === s.dpr && y.device === s.device);
        if (x === undefined || x.model === null || s.model === null || x.model === s.model) continue;
        const [m, n] = [ANDROID_MODEL.exec(x.model), ANDROID_MODEL.exec(s.model)];
        const what = `${target} ${lane}: ${s.device} at DPR ${s.dpr} "${x.model}" -> "${s.model}"`;
        if (m !== null && n !== null && m[1] === n[1] && m[3] === n[3] && normalAbi(m[2]!) !== normalAbi(n[2]!)) abi.push(what);
        else other.push(what);
      }
    }
    for (const [lane, now] of r.vectorsArch ?? []) {
      const was = b.vectorsArch?.get(lane);
      if (was === undefined || (was.abi === now.abi && was.device === now.device)) continue;
      const what = `${target} ${lane}: vectors on ${was.device} (${was.abi}) -> ${now.device} (${now.abi})`;
      if (was.device === now.device && normalAbi(was.abi) !== normalAbi(now.abi)) abi.push(what);
      else other.push(what);
    }
  }
  if (abi.length + other.length !== expected) other.push(`${expected} model change(s), of which ${abi.length + other.length} were classified`);
  return { abi, other };
};

/**
 * Whether a CI device run's records may replace the previous position's as an architecture rebaseline: every model change is
 * an Android image ABI change, and there is at least one. The verdicts are judged by deviceRunProblems with rebaseline, which
 * requires each changed lane to keep the previous state and exactly the previous failures.
 */
export const ciArchRebaseline = (base: DeviceEvidence, run: DeviceEvidence): { rebaseline: boolean; changes: string[] } => {
  const c = archChanges(base, run);
  return c.abi.length > 0 && c.other.length === 0 ? { rebaseline: true, changes: c.abi } : { rebaseline: false, changes: [] };
};

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
  /**
   * Builds the positions of a batch at once (parallel position builds): the same results, in the same order, as `build` on each
   * in turn, each slot a position or the error that ejects its PR. Absent, or returning null, the positions build one by one.
   * `failed` is called with each ejection as it happens (its slot index), so the PR is reported then (FAILED, label, comment), as
   * the one-by-one build reports it, not only once the whole batch has built.
   */
  buildAll?: (base: string, items: readonly { entry: Entry; ticket: T }[], failed: (index: number, error: unknown) => void) => readonly ({ position: P } | { error: unknown })[] | null;
  /** Checks the built chain is exactly the positions it claims to be; any error is fatal. */
  verify: (built: readonly { entry: Entry; ticket: T; position: P }[]) => void;
  /** Proves the tree of one position (the full test). Throws LandFailure at step "test" when the test fails. */
  prove: (position: P, e: Entry) => void;
  /** True when the PM asked for a graceful stop (STOP_FILE, SIGUSR1 or the land-stop label): no new batch starts. */
  stopRequested?: () => boolean;
  /** At most this many batches that built a position (LAND_MAX_BATCHES; land.yml runs one per job): the rest stays queued. */
  maxBatches?: number;
  /**
   * True for a PR that must be built and proved alone (a batch of 1), asked before its admission: one whose earlier build or
   * proof ended without a verdict, which a batch could not pin on one PR. It starts a batch of its own, never joins one.
   */
  solo?: (e: Entry) => boolean;
  /** Proves master's own tree, before a bisect blames the first PR of a batch. Throws LandFailure at step "test" when it fails. */
  proveMaster: (master: string) => void;
  /** Pushes, reviews and merges one PR at its position. Throws LandFailure (that PR fails) or Fatal. */
  publish: (e: Entry, position: P, ticket: T) => string;
  onFail: (e: Entry, f: LandFailure) => void;
  onOutcome: (outcomes: readonly Outcome[]) => void;
  log: (line: string) => void;
};

/**
 * Parallel position builds. Position k's sources are master with the PRs 1..k merged, whatever the builds of the positions below
 * it do, so each is prepared at once in its own worktree (the merges, the install and a regen to its fixed point, under the heavy
 * lease's slots): `speculate`. Then, in order, each position is assembled on the actual position below it (`assemble`: the same
 * merge the one-by-one build makes, its tree the prepared one, then the device step and the checks), so its commit is exactly
 * the chain's. When a position is ejected, every prepared position above it included that PR, so they are abandoned and built
 * one by one on the chain without it (`sequential`); so are positions whose preparation failed. The device runs, on the device
 * lease, take turns in order while the later preparations run.
 */
export type ParallelHooks<T, P, H> = {
  /** Starts preparing position k (1-based) from the first k items; a throw marks it unprepared. */
  speculate: (k: number, items: readonly { entry: Entry; ticket: T }[]) => H;
  /** Waits for a preparation; a throw (its regen failed) builds that position one by one, and only that build's failure ejects
   * the PR: the prepared run's failure may be the parallel load's (disk, a capture timing out), not the PR's. */
  await: (handle: H) => void;
  /** Assembles position k on `prev` from its preparation. */
  assemble: (prev: string, item: { entry: Entry; ticket: T }, k: number, handle: H) => P;
  /** The one-by-one build of position k on `prev`. */
  sequential: (prev: string, item: { entry: Entry; ticket: T }, k: number) => P;
  /** Stops a preparation that will not be used. */
  abandon: (handle: H) => void;
  log: (line: string) => void;
};

export const buildPositionsParallel = <T, P extends { head: string }, H>(
  base: string,
  items: readonly { entry: Entry; ticket: T }[],
  hooks: ParallelHooks<T, P, H>,
  failed: (index: number, error: unknown) => void = () => {},
): ({ position: P } | { error: unknown })[] => {
  const handles: ({ ok: H } | { failed: unknown })[] = items.map((_, i) => {
    try {
      return { ok: hooks.speculate(i + 1, items.slice(0, i + 1)) };
    } catch (error) {
      return { failed: error };
    }
  });
  const slots: ({ position: P } | { error: unknown })[] = [];
  let prev = base;
  let k = 0;
  // Speculation holds while every position below built from its preparation: the prepared sources are the chain's.
  let speculating = true;
  for (const [i, item] of items.entries()) {
    const h = handles[i]!;
    try {
      let position: P;
      if (speculating && 'ok' in h) {
        let prepared = true;
        try {
          hooks.await(h.ok);
        } catch (error) {
          if (error instanceof Fatal) throw error;
          hooks.log(`parallel build: #${item.entry.pr}'s prepared regen failed (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); building its position one by one`);
          prepared = false;
        }
        // A one-by-one rebuild leaves the chain the preparations above were made for (the same PRs), so they still hold.
        position = prepared ? hooks.assemble(prev, item, k + 1, h.ok) : hooks.sequential(prev, item, k + 1);
      } else {
        if (speculating) {
          hooks.log(`parallel build: #${item.entry.pr}'s preparation failed (${'failed' in h ? (h.failed instanceof Error ? h.failed.message : String(h.failed)) : ''}); building it and the positions above it one by one`);
          speculating = false;
        }
        position = hooks.sequential(prev, item, k + 1);
      }
      slots.push({ position });
      prev = position.head;
      k++;
    } catch (error) {
      if (error instanceof Fatal) throw error;
      slots.push({ error });
      failed(i, error);
      if (speculating) hooks.log(`parallel build: #${item.entry.pr} is ejected; the positions above it are built one by one without it`);
      speculating = false;
    }
    // Once speculation ends, the preparations above are of chains that are not the actual one.
    if (!speculating) for (const later of handles.slice(i + 1)) if ('ok' in later) hooks.abandon(later.ok);
    if (!speculating) for (let j = i + 1; j < handles.length; j++) handles[j] = { failed: 'abandoned' };
  }
  return slots;
};

/** The paths where a prepared tree differs from the merge it is assembled on, split by what may differ there. `outputs` (a regen
 * step's declared outputs) are the prepared regen's to set; `records` (the device records, written by device runs and carried by
 * the merge from the position below) are taken from the merge, and the tree regenerated on them; anything else (`sources`: code,
 * package.json, the lockfile, a .d.ts, vendor) means the preparation was not of this merge's sources. */
export const preparedDifference = (paths: readonly string[], isOutput: (p: string) => boolean, isRecord: (p: string) => boolean): { sources: string[]; records: string[] } => ({
  sources: paths.filter((p) => !isOutput(p) && !isRecord(p)),
  records: paths.filter((p) => isRecord(p)),
});

/** Whether a prepared position's worktrees fit the disk: `freeGb` must stay at least `floorGb` after `missing` new worktrees of
 * `perGb` each. */
export const preparedFits = (freeGb: number, missing: number, o: { floorGb: number; perGb: number }): boolean => freeGb - missing * o.perGb >= o.floorGb;

/** Stops the process group led by `pid` (SIGTERM, then SIGKILL after 30s) and waits for it to exit; returns whether it is gone, so
 * the worktree it ran in can be reused. A leader that is another process now (its start time differs) means the pid was reused:
 * that group is not ours, and nothing is signalled. A leader that is gone keeps its group id reserved while any member lives, so
 * the group signal reaches only ours. */
export const stopProcessGroup = (
  pid: number,
  start: string | null,
  o: { startOf: (pid: number) => string | null; members: (pgid: number) => readonly number[]; signal: (sig: 'SIGTERM' | 'SIGKILL') => void; sleep: (ms: number) => void },
): boolean => {
  const now = o.startOf(pid);
  if (now !== null && start !== null && now !== start) return true;
  if (o.members(pid).length === 0) return true;
  o.signal('SIGTERM');
  for (let i = 0; i < 120 && o.members(pid).length > 0; i++) o.sleep(250);
  if (o.members(pid).length === 0) return true;
  o.signal('SIGKILL');
  for (let i = 0; i < 40 && o.members(pid).length > 0; i++) o.sleep(250);
  return o.members(pid).length === 0;
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
// Only a failed test is a verdict on a tree; a failed install, checkout or anything else is the driver's, and stops it.
export const isTestVerdict = (f: LandFailure): boolean => f.step === 'test';
// One proof whose result is a verdict on the tree: true when it passes, the failure when its test fails; any other error is Fatal.
export const proofVerdict = (what: string, prove: () => void): true | LandFailure => {
  try {
    prove();
    return true;
  } catch (error) {
    if (error instanceof Fatal) throw error;
    const f = asFailure(error);
    if (isTestVerdict(f)) return f;
    throw new Fatal(`proving ${what} failed outside the test, at ${f.step}, so it says nothing about the tree: ${f.message}`);
  }
};

// A commit this run proved whose tree equals master's (outside docs/goals/**, by `same`), newest first; null when none does.
export const provedTree = (proved: readonly string[], same: (commit: string) => boolean): string | null => [...proved].reverse().find(same) ?? null;

export const bisectPrefixes = (
  n: number,
  top: LandFailure,
  prove: (k: number) => void,
): { culprit: number; failure: LandFailure; proofs: number; passed: number[] } => {
  let [lo, hi, failure, proofs] = [0, n, top, 0];
  const passed: number[] = [];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    proofs++;
    const v = proofVerdict(`position ${mid}`, () => prove(mid));
    if (v === true) {
      lo = mid;
      passed.push(mid);
    } else {
      hi = mid;
      failure = v;
    }
  }
  return { culprit: hi, failure, proofs, passed };
};

// One round's preparation: admission of up to `size` PRs from the front of `queue` (which it consumes), the chain of positions
// on `base`, and the proof of the top with the bisect of its prefixes. It publishes nothing and reports nothing: its results
// are returned in order, so the same code runs in the driver or, pipelined, in a builder process whose round may be thrown away.
export type RoundResult = { entry: Entry; merged: string } | { entry: Entry; failure: LandFailure };
export type Prepared<T, P> = {
  base: string;
  consumed: Entry[];
  results: RoundResult[];
  built: { entry: Entry; ticket: T; position: P }[];
  /** Positions 1..good are proven to land (the top passed, or the bisect's passing prefix). */
  good: number;
  proven: number[];
  culprit: { index: number; failure: LandFailure } | null;
};
export type PrepareOps<T, P extends { head: string }> = Pick<BatchOps<T, P>, 'admit' | 'build' | 'buildAll' | 'verify' | 'prove' | 'proveMaster' | 'log' | 'solo'>;

export const prepareRound = <T, P extends { head: string }>(
  queue: Entry[],
  size: number,
  base: () => string,
  ops: PrepareOps<T, P>,
  o: { earlier?: readonly Entry[]; baseProven?: boolean; at?: (e: Entry | null) => void; report?: (r: RoundResult) => void } = {},
): Prepared<T, P> => {
  const at = o.at ?? (() => {});
  const consumed: Entry[] = [];
  const results: RoundResult[] = [];
  // With `report`, each result is reported as it happens (the driver's own round); without, they are returned (a builder's).
  const result = (r: RoundResult): void => (o.report ? o.report(r) : void results.push(r));
  const failure = (e: Entry, error: unknown): void => {
    if (error instanceof Fatal) throw error;
    result({ entry: e, failure: asFailure(error) });
  };
  const admitted: { entry: Entry; ticket: T }[] = [];
  let alone = false;
  while (admitted.length < size && queue.length > 0 && !alone) {
    const e = queue[0]!;
    const solo = ops.solo?.(e) === true;
    // A PR that must be alone waits for the next batch when this one already has a PR.
    if (solo && admitted.length > 0) break;
    queue.shift();
    consumed.push(e);
    at(e);
    try {
      const a = ops.admit(e, [...(o.earlier ?? []), ...admitted.map((x) => x.entry)]);
      if ('merged' in a) result({ entry: e, merged: a.merged });
      else {
        admitted.push({ entry: e, ticket: a.ticket });
        alone = solo;
      }
    } catch (error) {
      failure(e, error);
    }
  }
  if (alone) ops.log(`batch: #${admitted[0]!.entry.pr} is built and proved alone (an earlier build or proof of it ended without a verdict)`);
  const none = (b: string): Prepared<T, P> => ({ base: b, consumed, results, built: [], good: 0, proven: [], culprit: null });
  if (admitted.length === 0) return none('');
  let b: string;
  try {
    b = base();
  } catch (error) {
    throw error instanceof Fatal ? error : new Fatal(`could not read master: ${error instanceof Error ? error.message : String(error)}`);
  }
  let prev = b;
  const built: { entry: Entry; ticket: T; position: P }[] = [];
  // An ejection in the parallel build is reported as it happens; the slots then skip it.
  const reported = new Set<number>();
  const failedNow = (i: number, error: unknown): void => {
    const m = admitted[i];
    if (m === undefined || reported.has(i)) return;
    reported.add(i);
    at(m.entry);
    failure(m.entry, error);
  };
  const all = admitted.length > 1 && ops.buildAll !== undefined ? ops.buildAll(b, admitted, failedNow) : null;
  if (all !== null) {
    if (all.length !== admitted.length) throw new Fatal(`the parallel build returned ${all.length} slots for ${admitted.length} PRs`);
    for (const [i, m] of admitted.entries()) {
      at(m.entry);
      const slot = all[i]!;
      if ('position' in slot) {
        built.push({ ...m, position: slot.position });
        prev = slot.position.head;
      } else if (!reported.has(i)) failedNow(i, slot.error);
    }
  } else {
    for (const m of admitted) {
      at(m.entry);
      try {
        const position = ops.build(prev, m.entry, m.ticket, built.length + 1);
        built.push({ ...m, position });
        prev = position.head;
      } catch (error) {
        failure(m.entry, error);
      }
    }
  }
  if (built.length === 0) return none(b);
  at(built[0]!.entry);
  try {
    ops.verify(built);
  } catch (error) {
    throw error instanceof Fatal ? error : new Fatal(`the batch ${prs(built.map((x) => x.entry))} is not the chain of positions it claims: ${error instanceof Error ? error.message : String(error)}`);
  }
  ops.log(`batch ${prs(built.map((x) => x.entry))}: ${built.length} position(s) built on ${b}; proving the top ${built.at(-1)!.position.head}`);

  // Prove the top; when it fails, bisect the prefixes for the first failing position.
  let good = built.length;
  let culprit: { index: number; failure: LandFailure } | null = null;
  const proven: number[] = [];
  const proveAt = (k: number): void => {
    const x = built[k - 1]!;
    at(x.entry);
    ops.prove(x.position, x.entry);
  };
  const top = proofVerdict(`#${built.at(-1)!.entry.pr}'s position (the batch top)`, () => proveAt(built.length));
  if (top === true) proven.push(built.length);
  else {
    const found = bisectPrefixes(built.length, top, proveAt);
    proven.push(...found.passed);
    if (found.culprit === 1 && o.baseProven !== true) {
      // Before blaming the first PR, master itself must pass: a red master fails every position and blames nobody.
      at(null);
      ops.log(`batch: position 1 fails; proving master ${b} before blaming #${built[0]!.entry.pr}`);
      const m = proofVerdict(`master ${b}`, () => ops.proveMaster(b));
      if (m !== true) throw new Fatal(`master is red: master ${b} itself fails pnpm test, so no PR of the batch ${prs(built.map((x) => x.entry))} is blamed:\n${m.message}`);
    }
    good = found.culprit - 1;
    const passing = built.slice(0, good).map((x) => x.entry);
    const note =
      built.length === 1
        ? ''
        : `\n\nFound by bisecting the batch ${prs(built.map((x) => x.entry))} (${found.proofs + 1} proofs): ${passing.length === 0 ? 'master' : `master with ${prs(passing)}`} passes, adding #${built[good]!.entry.pr} fails.`;
    culprit = { index: good, failure: new LandFailure(found.failure.step, `${found.failure.message}${note}`, found.failure.comment) };
    ops.log(`batch: the top failed at ${top.step}; culprit #${built[good]!.entry.pr} after ${found.proofs} more proof(s)`);
  }
  return { base: b, consumed, results, built, good, proven, culprit };
};

// Pipelining: while batch K publishes, the next batch is prepared on K's proven top by a builder (another process, in its own
// worktree). It is used only if all of K landed, so master then has exactly the tree it was built on; otherwise it is thrown
// away and its PRs are prepared again on the new master. Admission, build and proof results of a discarded round are never
// reported.
export type NextRound<T, P> = {
  /** Starts preparing the next round on `base` (batch K's top) from a snapshot of the queue; K's PRs are `earlier`. */
  start: (base: string, queue: readonly Entry[], earlier: readonly Entry[], size: number) => void;
  /** Waits for it and returns it (a Fatal in the builder throws Fatal here). */
  collect: () => Prepared<T, P>;
  /** Throws it away (stops the builder). */
  cancel: () => void;
};

/** A builder's Fatal as JSON (parsePrepared reads it back): a CiOutage stays one. */
export const serializeFatal = (error: Fatal): string => JSON.stringify({ fatal: error.message, outage: error instanceof CiOutage });
// A builder's round as JSON, and back. LandFailures keep their step, message and comment; anything malformed is an error.
export const serializePrepared = <T, P>(p: Prepared<T, P>): string =>
  JSON.stringify({
    ...p,
    results: p.results.map((r) => ('merged' in r ? r : { entry: r.entry, failure: { step: r.failure.step, message: r.failure.message, comment: r.failure.comment ?? null } })),
    culprit: p.culprit && { index: p.culprit.index, failure: { step: p.culprit.failure.step, message: p.culprit.failure.message, comment: p.culprit.failure.comment ?? null } },
  });
const isEntry = (v: unknown): v is Entry => isObject(v) && typeof v.branch === 'string' && typeof v.pr === 'number' && typeof v.clean === 'string';
const toFailure = (v: unknown): LandFailure => {
  if (!isObject(v) || typeof v.step !== 'string' || typeof v.message !== 'string' || !(v.comment === null || typeof v.comment === 'string')) return fail(`a prepared failure is malformed: ${JSON.stringify(v)?.slice(0, 200)}`);
  return new LandFailure(v.step, v.message, v.comment ?? undefined);
};
export const parsePrepared = <T, P extends { head: string }>(text: string): Prepared<T, P> | { fatal: string; outage: boolean } => {
  const v: unknown = JSON.parse(text);
  if (isObject(v) && typeof v.fatal === 'string') {
    if (v.outage !== undefined && typeof v.outage !== 'boolean') return fail(`a prepared round's outage is not a boolean: ${text.slice(0, 200)}`);
    return { fatal: v.fatal, outage: v.outage === true };
  }
  if (!isObject(v) || typeof v.base !== 'string' || !Array.isArray(v.consumed) || !v.consumed.every(isEntry) || !Array.isArray(v.results) || !Array.isArray(v.built) || !Array.isArray(v.proven)) {
    return fail(`a prepared round is malformed: ${text.slice(0, 200)}`);
  }
  const results: RoundResult[] = v.results.map((r: unknown) => {
    if (!isObject(r) || !isEntry(r.entry)) return fail(`a prepared result is malformed: ${JSON.stringify(r)?.slice(0, 200)}`);
    return typeof r.merged === 'string' ? { entry: r.entry, merged: r.merged } : { entry: r.entry, failure: toFailure(r.failure) };
  });
  const built = v.built.map((b: unknown) => {
    if (!isObject(b) || !isEntry(b.entry) || !isObject(b.ticket) || !isObject(b.position) || typeof b.position.head !== 'string') return fail(`a prepared position is malformed: ${JSON.stringify(b)?.slice(0, 200)}`);
    return b as { entry: Entry; ticket: T; position: P };
  });
  const n = built.length;
  if (typeof v.good !== 'number' || !Number.isInteger(v.good) || v.good < 0 || v.good > n) return fail(`a prepared round has good ${JSON.stringify(v.good)} of ${n}`);
  if (!v.proven.every((k: unknown) => typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= n)) return fail('a prepared round has a proven position out of range');
  let culprit: Prepared<T, P>['culprit'] = null;
  if (v.culprit !== null) {
    if (!isObject(v.culprit) || v.culprit.index !== v.good) return fail(`a prepared round's culprit is not position ${v.good + 1}`);
    culprit = { index: v.good, failure: toFailure(v.culprit.failure) };
  } else if (v.good !== n) return fail(`a prepared round proves ${v.good} of ${n} positions without a culprit`);
  return { base: v.base, consumed: v.consumed, results, built, good: v.good, proven: v.proven as number[], culprit };
};

export const runBatches = <T, P extends { head: string }>(
  entries: readonly Entry[],
  size: number,
  ops: BatchOps<T, P> & { next?: NextRound<T, P> },
): { outcomes: Outcome[]; fatal: string | null; outage: string | null; exit: 0 | 1; stopped: Entry[]; stopAsked: boolean; limited: boolean } => {
  if (!Number.isInteger(size) || size < 1) return fail(`batch size ${size}`);
  const max = ops.maxBatches ?? Infinity;
  if (max !== Infinity && (!Number.isInteger(max) || max < 1)) return fail(`batch limit ${max}`);
  let batches = 0;
  let limited = false;
  const queue = [...entries];
  const outcomes: Outcome[] = [];
  let fatal: string | null = null;
  let outage: string | null = null;
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
  const report = (r: RoundResult): void => ('merged' in r ? done({ entry: r.entry, result: 'merged before', detail: r.merged }) : failed(r.entry, r.failure));
  // A stop request is read once (reading it consumes STOP_FILE) and then holds for the rest of the run.
  let stopAsked = false;
  const stopping = (): boolean => (stopAsked ||= ops.stopRequested?.() === true);
  let at: Entry | null = null;
  // The next round, being prepared on the current batch's top; usable once the whole batch has landed.
  let pending = false;
  let usable = false;
  const cancel = (): void => {
    if (!pending) return;
    pending = false;
    ops.next!.cancel();
  };
  try {
    while (queue.length > 0) {
      // A graceful stop: the batch before has landed what it could; nothing new starts.
      if (stopping()) {
        if (pending) ops.log('stop requested: the next batch being prepared is discarded');
        cancel();
        ops.log(`stop requested: not starting ${prs(queue)}`);
        break;
      }
      if (batches >= max) {
        limited = true;
        ops.log(`batch limit (${max}) reached: ${prs(queue)} stay queued for the next run`);
        break;
      }
      let round: Prepared<T, P>;
      if (pending && usable) {
        pending = false;
        round = ops.next!.collect();
        // The builder consumed the front of the queue snapshot; nothing else has touched the queue since.
        for (const [i, e] of round.consumed.entries()) {
          if (queue[i]?.pr !== e.pr) throw new Fatal(`the prepared batch consumed #${e.pr}, which is not at the front of the queue`);
        }
        queue.splice(0, round.consumed.length);
        ops.log(`batch: using the batch prepared on the previous top ${round.base}`);
        if (round.built.length > 0) {
          at = round.built[0]!.entry;
          try {
            ops.verify(round.built);
          } catch (error) {
            throw error instanceof Fatal ? error : new Fatal(`the prepared batch is not the chain of positions it claims: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        if (pending) ops.log('batch: the batch prepared on the previous top is discarded; master did not reach that top');
        cancel();
        round = prepareRound(queue, size, ops.base, ops, { at: (e) => (at = e), report });
      }
      for (const r of round.results) {
        at = r.entry;
        report(r);
      }
      const { built, good, culprit } = round;
      if (built.length === 0) continue;
      batches++;
      const proven = new Set(round.proven);

      // The whole batch is proven and the queue has more: start preparing the next batch on this top while this one publishes.
      if (ops.next !== undefined && good === built.length && queue.length > 0 && batches < max && !stopping()) {
        ops.next.start(built.at(-1)!.position.head, [...queue], built.map((b) => b.entry), size);
        pending = true;
        usable = false;
      }

      // Publish the proven prefix in order. A failure stops the batch there; the PRs after it go back to the queue.
      let published = 0;
      for (; published < good; published++) {
        const b = built[published]!;
        at = b.entry;
        try {
          done({ entry: b.entry, result: 'landed', detail: ops.publish(b.entry, b.position, b.ticket) });
        } catch (error) {
          // The next batch stood on this batch's top, which will not land: stop its builder now, before anything else runs,
          // so its proofs never compete with the resting-tree proof below.
          if (pending) ops.log('batch: a publish failed; the batch being prepared on its top is thrown away');
          cancel();
          failed(b.entry, error);
          break;
        }
      }
      // Publishing stopped part-way: master rests on the last landed position, which must pass the full test itself.
      if (published < good && published > 0 && !proven.has(published)) {
        const last = built[published - 1]!;
        at = last.entry;
        ops.log(`batch: publishing stopped after #${last.entry.pr}; proving master's new tree (its position ${last.position.head})`);
        const v = proofVerdict(`master's new tree (#${last.entry.pr}'s position)`, () => ops.prove(last.position, last.entry));
        if (v !== true) {
          const red = new LandFailure('master-red', `master now rests on #${last.entry.pr}'s position ${last.position.head}, which was not the batch's proven top, and it fails pnpm test. The driver stopped.\n${v.message}`);
          ops.onFail(last.entry, red);
          throw new Fatal(red.message);
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
      // The prepared next batch stands on this top: usable only when every PR of this batch landed.
      usable = published === built.length;
    }
  } catch (error) {
    if (!(error instanceof Fatal)) throw error;
    if (error instanceof CiOutage) outage = error.message;
    else {
      fatal = error.message;
      if (at !== null) outcomes.push({ entry: at, result: 'failed', step: 'fatal', detail: fatal });
    }
    ops.onOutcome(outcomes);
  } finally {
    cancel();
  }
  // After an outage every PR with no outcome stays queued (those of the batch it hit included), in queue order.
  const stopped = outage !== null ? entries.filter((e) => !outcomes.some((o) => o.entry.pr === e.pr)) : fatal === null ? queue : [];
  return { outcomes, fatal, outage, exit: fatal === null && outage === null && outcomes.every((o) => o.result !== 'failed') ? 0 : 1, stopped, stopAsked, limited };
};

export const statusText = (o: {
  queue: string;
  startedAt: string;
  now: string;
  running: Entry | null;
  outcomes: readonly Outcome[];
  fatal: string | null;
  outage?: string | null;
  total: number;
  done: boolean;
  stopped?: readonly Entry[];
  /** The run ended at its batch limit (LAND_MAX_BATCHES), not on a stop request: `stopped` goes to the next run. */
  limited?: boolean;
}): string => {
  const outage = o.done && !o.fatal && typeof o.outage === 'string';
  const rest = o.done && !o.fatal && !outage && (o.stopped?.length ?? 0) > 0;
  const handOff = rest && o.limited === true;
  const asked = rest && !handOff;
  const lines = [`land ${o.done ? (o.fatal ? 'STOPPED' : outage ? 'STOPPED BY A CI OUTAGE' : asked ? 'STOPPED ON REQUEST' : handOff ? 'BATCH DONE' : 'DONE') : 'RUNNING'} ${o.now} (started ${o.startedAt}) queue ${o.queue}: ${o.outcomes.length} of ${o.total} handled`];
  if (o.fatal) lines.push(`fatal: ${o.fatal}`);
  if (outage) lines.push(`CI outage: ${o.outage}`, `no PR was failed for it; still queued, not landed: ${(o.stopped ?? []).map((e) => `#${e.pr}`).join(' ') || 'none'}`);
  if (o.running) lines.push(`landing now: #${o.running.pr} ${o.running.branch}`);
  for (const r of o.outcomes) {
    const id = `#${r.entry.pr} ${r.entry.branch}`;
    lines.push(r.result === 'failed' ? `  FAILED ${id} at ${r.step}: ${r.detail}` : `  ${r.result === 'landed' ? 'landed' : 'merged before'} ${id}: ${r.detail}`);
  }
  const failed = o.outcomes.filter((r) => r.result === 'failed').length;
  if (asked) lines.push(`stop requested: not started ${o.stopped!.map((e) => `#${e.pr}`).join(' ')} (no PR failed for it)`);
  if (handOff) lines.push(`batch limit reached: the next run gets ${o.stopped!.map((e) => `#${e.pr}`).join(' ')} (no PR failed for it)`);
  if (o.done) lines.push(failed === 0 && !o.fatal ? (rest || outage ? 'every PR handled landed' : 'every PR landed') : `${failed} PR(s) failed; each has the landing-failed label and a comment naming the step`);
  return `${lines.join('\n')}\n`;
};

// ---------------------------------------------------------------------------------------------------------------------
// Stopping. A synchronous driver cannot run a signal handler while a step runs (spawnSync), so `pnpm land` is a supervisor:
// it holds the lock (recording its own pid and the driver's) and runs the driver in its own process group with the default
// action for SIGINT, SIGTERM and SIGHUP. An interrupt to the supervisor kills that whole group (driver and running step), so no
// step fails into a PR failure; while the driver is inside a merge (from just before gh pr merge to the post-merge tree check
// and branch cleanup, PUBLISH_MARK) the interrupt waits for it to finish, up to a cap. SIGUSR1 to the supervisor (or touching STOP_FILE) asks for a graceful
// stop: the driver finishes the batch it is on and starts no other. Whenever the driver dies abnormally the supervisor cleans
// up after it: its quiet request and priority, the driver worktree, and the status. Devices belong to the device lease's own
// run and are never touched here.

export const STOP_FILE = '/tmp/dragon-land.stop';
export const SUPERVISED_ENV = 'LAND_SUPERVISED';
export const SUPERVISOR_PID_ENV = 'LAND_SUPERVISOR_PID';
// Files the driver writes in the run directory for its supervisor.
export const PUBLISH_MARK = 'publish.json'; // { pr, head, merged: <merge sha> | null } while inside a merge
export const MERGES_LOG = 'merges.log'; // "<pr> <merge sha> <position head>" per merge, appended right after it

const isPid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 1;

export type PublishMark = { pr: number; head: string; merged: string | null };
export const parsePublishMark = (text: string | null): PublishMark | null => {
  if (text === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(v) || typeof v.pr !== 'number' || typeof v.head !== 'string' || !(v.merged === null || typeof v.merged === 'string')) return null;
  return { pr: v.pr, head: v.head, merged: v.merged };
};
// The record of a merged position no full test has passed: { pr, head }. Unreadable is treated as present (proved again).
export const parseUnproved = (text: string | null): { pr: number; head: string } | null => {
  if (text === null) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (isObject(v) && typeof v.pr === 'number' && typeof v.head === 'string' && /^[0-9a-f]{40}$/.test(v.head)) return { pr: v.pr, head: v.head };
  } catch {}
  return { pr: 0, head: `unreadable ${JSON.stringify(text.slice(0, 80))}` };
};
export type Merge = { pr: number; merge: string; head: string };
export const parseMerges = (text: string | null): Merge[] =>
  (text ?? '').split('\n').flatMap((l) => {
    const m = /^([1-9]\d*) ([0-9a-f]{40}) ([0-9a-f]{40})$/.exec(l.trim());
    return m ? [{ pr: Number(m[1]), merge: m[2]!, head: m[3]! }] : [];
  });

// The status after the driver died mid-run: it names what merged in this run, and never calls a merged PR "not failed".
export const interruptedStatus = (o: { previous: string; how: string; now: string; publishing: PublishMark | null; merges: readonly Merge[]; unproved: { pr: number; head: string } | null }): string => {
  const lines = o.previous.trimEnd().split('\n').filter((l) => l !== '');
  const first = lines[0]?.startsWith('land ') ? lines.shift()! : null;
  const running = lines.find((l) => l.startsWith('landing now: '));
  const rest = lines.filter((l) => !l.startsWith('landing now: '));
  const out = [`land INTERRUPTED ${o.now} by ${o.how}${first ? ` (was: ${first})` : ''}`];
  const merged = new Map(o.merges.map((m) => [m.pr, m]));
  if (o.publishing !== null) {
    const m = o.publishing.merged ?? merged.get(o.publishing.pr)?.merge ?? null;
    out.push(m !== null ? `#${o.publishing.pr} MERGED as ${m} when interrupted; its post-merge tree check and branch cleanup did not run` : `interrupted while merging #${o.publishing.pr} (position ${o.publishing.head}); check whether it merged`);
  } else out.push(running ? `interrupted while ${running.slice('landing now: '.length)} was landing; it was not failed, and its step's work is discarded` : 'interrupted between PRs');
  if (o.merges.length > 0) out.push(`merged in this run: ${o.merges.map((m) => `#${m.pr} (${m.merge.slice(0, 12)})`).join(', ')}`);
  if (o.unproved !== null) out.push(`master rests on #${o.unproved.pr}'s position ${o.unproved.head}, which no full test has proved; the next run proves it before anything else`);
  return `${[...out, ...rest].join('\n')}\n`;
};

// The lock records the supervisor and the driver, each as a pid and its start time (`ps -o lstart=`), so a reused pid is never
// taken for them. It is held while either lives; a live driver whose supervisor is gone is an orphan the next run kills.
export type LockProc = { pid: number; start: string };
export type LockState = 'free' | 'held' | 'orphan';
// A recorded process with no start time (a run that died between writing the pid and the start) counts as live while its pid is:
// it holds the lock and is never killed.
export const lockState = (supervisor: LockProc | null, driver: LockProc | null, startOf: (pid: number) => string | null): LockState => {
  const live = (p: LockProc | null): 'same' | 'unknown' | 'gone' => {
    if (p === null) return 'gone';
    const now = startOf(p.pid);
    if (now === null) return 'gone';
    return p.start === '' ? 'unknown' : now === p.start ? 'same' : 'gone';
  };
  const [sup, drv] = [live(supervisor), live(driver)];
  if (sup !== 'gone' || drv === 'unknown') return 'held';
  return drv === 'same' ? 'orphan' : 'free';
};
// `ps -o lstart= -p <pid>`: the start time, or null when no such process.
export const parseLstart = (out: string): string | null => {
  const t = out.trim();
  return t === '' || t.includes('\n') ? null : t;
};
export const parsePidFile = (text: string | null): number | null => {
  const t = (text ?? '').trim();
  return /^[1-9]\d*$/.test(t) && isPid(Number(t)) ? Number(t) : null;
};

// Everything the supervisor does after the driver died abnormally; each part runs even when another fails.
export const cleanUpAfterDriver = (o: {
  how: string;
  now: string;
  read: (runFile: string) => string | null;
  unproved: () => { pr: number; head: string } | null;
  release: () => void;
  reset: () => void;
  status: { read: () => string; write: (text: string) => void };
  log: (line: string) => void;
}): string[] => {
  const problems: string[] = [];
  const step = (what: string, fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      problems.push(`${what}: ${errorText(error).split('\n')[0]}`);
    }
  };
  step('releasing the quiet request and priority', o.release);
  step('resetting the driver worktree', o.reset);
  step('writing the status', () =>
    o.status.write(interruptedStatus({ previous: o.status.read(), how: o.how, now: o.now, publishing: parsePublishMark(o.read(PUBLISH_MARK)), merges: parseMerges(o.read(MERGES_LOG)), unproved: o.unproved() })),
  );
  for (const p of problems) o.log(`WARNING after the driver died: ${p}`);
  return problems;
};

// A run that starts with master on a merged position no full test has passed (an interrupted run) proves master first. The
// result is logged loudly and never blocks the queue: a batch whose top passes still lands (that is how a fix lands).
// Returns whether master passed; the record is cleared only by a passing proof that contains it (clearsUnproved).
export const proveRestingMaster = (unproved: { pr: number; head: string } | null, prove: () => void, clear: () => void, log: (line: string) => void): boolean | null => {
  if (unproved === null) return null;
  log(`master rests on #${unproved.pr}'s position ${unproved.head}, merged by an interrupted run without a full test; proving master first`);
  let v: true | LandFailure;
  try {
    v = proofVerdict(`master (left on #${unproved.pr}'s position by an interrupted run)`, prove);
  } catch (error) {
    // A CI outage stops the driver here as anywhere else: the batch's own proofs could not run either.
    if (error instanceof CiOutage) throw error;
    log(`!!! could not prove master: ${error instanceof Error ? error.message : String(error)}; carrying on, the next passing proof that contains it clears the record`);
    return false;
  }
  if (v === true) {
    clear();
    log('master passes pnpm test');
    return true;
  }
  log(`!!! MASTER IS RED: it rests on #${unproved.pr}'s position ${unproved.head} and fails pnpm test; carrying on, so a batch whose top passes can land the fix:\n${v.message}`);
  return false;
};
// The record is cleared only once master is on a proven tree: a passing proof of a commit with master's current tree (outside
// docs/goals/**), whether master got there by a publish or was proved where it rests. A proof of any other tree leaves it.
export const clearsUnproved = (unproved: { head: string } | null, proved: string, isMastersTree: (commit: string) => boolean): boolean =>
  unproved !== null && isMastersTree(proved);

export type Supervised = { code: number; interrupted: NodeJS.Signals | null; signal: NodeJS.Signals | null; pid: number };
export const supervise = (o: {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  /** SIGTERM to SIGKILL, for the whole process group (device runs tear down in it). */
  graceMs: number;
  /** How long an interrupt waits for a merge in progress (PUBLISH_MARK) before killing it anyway. */
  deferCapMs: number;
  /** Whether the driver is inside a merge now. */
  publishing: () => boolean;
  onSpawn: (pid: number) => void;
  /** Called once the supervisor handles signals for the spawned driver (a signal before that was buffered, not lost). */
  onReady?: (pid: number) => void;
  onStop: () => void;
  log: (line: string) => void;
  pollMs?: number;
}): Promise<Supervised> =>
  new Promise((resolve, reject) => {
    // Signals are taken over before the spawn: one that arrives before the driver's pid is known is buffered, then acted on.
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    const early: NodeJS.Signals[] = [];
    const buffer = (sig: NodeJS.Signals): number => early.push(sig);
    for (const s of [...signals, 'SIGUSR1'] as const) process.on(s, buffer);
    const unbuffer = (): void => {
      for (const s of [...signals, 'SIGUSR1'] as const) process.off(s, buffer);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(o.command, [...o.args], { detached: true, stdio: 'inherit', env: { ...o.env, [SUPERVISED_ENV]: '1', [SUPERVISOR_PID_ENV]: String(process.pid) } });
    } catch (error) {
      unbuffer();
      return reject(error);
    }
    const pid = child.pid;
    if (pid === undefined) {
      unbuffer();
      child.once('error', reject);
      return;
    }
    try {
      o.onSpawn(pid);
    } catch (error) {
      o.log(`recording the driver (pid ${pid}) failed: ${errorText(error).split('\n')[0]}; killing it`);
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {}
      unbuffer();
      return reject(error);
    }
    const poll = o.pollMs ?? 250;
    let interrupted: NodeJS.Signals | null = null;
    let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let killing = false;
    const timers: NodeJS.Timeout[] = [];
    const group = (sig: NodeJS.Signals | 0): boolean => {
      try {
        process.kill(-pid, sig);
        return true;
      } catch {
        return false;
      }
    };
    // SIGTERM to the group, then SIGKILL once the grace period is over; done when no process of the group is left.
    const kill = (): void => {
      if (killing) return;
      killing = true;
      group('SIGTERM');
      const t0 = Date.now();
      const tick = setInterval(() => {
        if (!group(0)) {
          clearInterval(tick);
          finish();
        } else if (Date.now() - t0 >= o.graceMs) group('SIGKILL');
      }, poll);
      timers.push(tick);
    };
    const onSignal = (sig: NodeJS.Signals): void => {
      if (interrupted !== null) {
        o.log(`${sig} again: killing the driver group now`);
        group('SIGKILL');
        killing = false;
        return kill();
      }
      interrupted = sig;
      if (!o.publishing()) {
        o.log(`${sig}: interrupting the driver (pid ${pid}) and its running step`);
        return kill();
      }
      o.log(`${sig}: the driver is merging a PR; interrupting once that merge and its checks end (at most ${Math.round(o.deferCapMs / 1000)}s; send ${sig} again to kill it now)`);
      const t0 = Date.now();
      const wait = setInterval(() => {
        if (exited !== null || killing) return clearInterval(wait);
        if (!o.publishing()) {
          clearInterval(wait);
          o.log('the merge ended; interrupting the driver');
          kill();
        } else if (Date.now() - t0 >= o.deferCapMs) {
          clearInterval(wait);
          o.log(`!!! the merge did not end within ${Math.round(o.deferCapMs / 1000)}s; killing the driver INSIDE a merge: master and the PR may be half-landed, see the status`);
          kill();
        }
      }, poll);
      timers.push(wait);
    };
    const onUsr1 = (): void => {
      o.log('SIGUSR1: graceful stop requested; the driver finishes its batch and starts no other');
      o.onStop();
    };
    for (const s of signals) process.on(s, onSignal);
    process.on('SIGUSR1', onUsr1);
    unbuffer();
    o.onReady?.(pid);
    for (const sig of early) (sig === 'SIGUSR1' ? onUsr1 : onSignal)(sig);
    let done = false;
    const finish = (): void => {
      if (done || exited === null) return;
      done = true;
      for (const s of signals) process.off(s, onSignal);
      process.off('SIGUSR1', onUsr1);
      for (const t of timers) clearInterval(t);
      // An interrupt that never had to kill (the driver ended on its own while it waited for a publish) is no interrupt.
      const killed = killing ? interrupted : null;
      resolve({ code: killed !== null ? 130 : (exited.code ?? 128), interrupted: killed, signal: killed !== null ? null : exited.signal, pid });
    };
    child.once('exit', (code, signal) => {
      exited = { code, signal };
      // After an interrupt or a death by signal, whatever of the group outlived the driver gets its grace period, then SIGKILL.
      if (killing || signal !== null) {
        if (!group(0)) return finish();
        if (!killing) kill();
        return;
      }
      finish();
    });
  });

// ---------------------------------------------------------------------------------------------------------------------
// The builder's watchdog (scripts/land-watchdog.ts): a detached process in its own session that stops the builder's process
// group once the driver is gone, however it died (kill -9 of supervisor and driver included), so no builder finishes a long
// step holding the heavy priority, a quiet request or the device lease. It ends by itself once the builder's group is gone.

export type Liveness = 'alive' | 'gone' | 'unknown';
// The builder from its leader and its group. A leader that exited (gone or a zombie) leaves the group id reserved while any
// member lives, so live members are still the builder's and still watched; a leader pid that is another process now means
// the group was empty and its id freed, so the builder ended.
export type Leader = 'alive' | 'exited' | 'reused' | 'unknown';
export const builderLiveness = (leader: Leader, groupLeft: () => boolean | null): Liveness => {
  if (leader === 'alive' || leader === 'unknown') return leader;
  if (leader === 'reused') return 'gone';
  const left = groupLeft();
  return left === null ? 'unknown' : left ? 'alive' : 'gone';
};
export type WatchdogOps = {
  /** The driver: alive (the recorded process), gone (no such pid, or another start time), or unknown (ps or kill failed). */
  driver: () => Liveness;
  /** The builder's leader, judged the same way: gone means the builder ended (or its pid is another process now). */
  builder: () => Liveness;
  /** Whether any live process is left in the builder's group, or null when that could not be read. */
  groupLeft: () => boolean | null;
  signal: (sig: 'SIGTERM' | 'SIGKILL') => void;
  /** Releases what the builder held (quiet request, priority), each only if it names the builder. */
  release: () => void;
  sleep: (ms: number) => void;
  log: (line: string) => void;
  pollMs?: number;
  graceMs?: number;
};
// Only a definite answer acts: an unknown liveness (a failed ps or kill under load) is asked again, never taken as a death.
export const runWatchdog = (o: WatchdogOps): 'builder ended' | 'stopped the builder' => {
  const poll = o.pollMs ?? 1000;
  for (;;) {
    const b = o.builder();
    if (b === 'gone') return 'builder ended';
    const d = b === 'alive' ? o.driver() : 'unknown';
    if (d === 'gone') break;
    if (d === 'unknown' || b === 'unknown') o.log(`could not tell whether the ${b === 'unknown' ? 'builder' : 'driver'} lives; asking again`);
    o.sleep(poll);
  }
  o.log('the driver is gone; stopping the builder\'s process group');
  o.signal('SIGTERM');
  for (let waited = 0; waited < (o.graceMs ?? 30_000) && o.groupLeft() !== false; waited += poll) o.sleep(poll);
  if (o.groupLeft() !== false) o.signal('SIGKILL');
  o.release();
  return 'stopped the builder';
};

// LAND_WORKTREE_NEXT is removed and re-added by the builder's repair, so it may not be, contain or sit inside a protected
// worktree (the main checkout, the driver's worktree, any other listed worktree; the caller leaves the candidate's own
// listing out). Paths are compared after resolving.
export const unsafeWorktree = (path: string, protectedPaths: readonly string[], resolve: (p: string) => string): string | null => {
  const norm = (p: string): string => resolve(p).replace(/\/+$/, '');
  const me = norm(path);
  if (me === '' || me === '/') return `${path} is the filesystem root`;
  const under = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`);
  for (const raw of protectedPaths) {
    const p = norm(raw);
    if (p === '') continue;
    if (p === me) return `${path} is the worktree ${raw}`;
    if (under(p, me)) return `${path} contains the worktree ${raw}`;
    if (under(me, p)) return `${path} is inside the worktree ${raw}`;
  }
  return null;
};
