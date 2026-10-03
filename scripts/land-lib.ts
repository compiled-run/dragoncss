// The checked parts of land.ts: queue and argument parsing, retries of network calls, the CI verdict, the Claude review gate and
// the queue loop that records a failed PR and continues. The git and device judgements come from merge-train-lib.ts.
import { spawnSync } from 'node:child_process';
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
  LAND_REVIEW_CMD (the Claude reviewer, default ${JSON.stringify('claude -p')}; reads the prompt on stdin, prints JSON), LAND_REVIEW_DIR
  (/tmp/land-reviews), LAND_CI_WAIT and LAND_CI_APPEAR (seconds, default 5400 and 900)`;
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
// Runs the reviewer command through sh, with the prompt on stdin, in `cwd` (the driver worktree at the PR head).
export const runReviewer = (command: string, input: string, cwd: string, timeoutMs: number): ReviewerRun => {
  const r = spawnSync('/bin/sh', ['-c', command], { cwd, input, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
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
