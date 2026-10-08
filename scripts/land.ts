// Continuous landing driver (owner decision 2026-10-03, process review): lands a queue of reviewed PRs in batches (runBatches in
// land-lib.ts). Each PR gets a position on the one before it, with its own regen and device evidence (the device run is skipped
// only when the position's evidence stamp equals the previous position's), typecheck, regen-only and floors checks; the batch's
// top position is proved once by the full test, and its prefixes are bisected when that fails. Then each PR in order is pushed,
// passes CI, pr:review and a Claude correctness review while Macroscope is at its limit, and merges pinned with
// --match-head-commit. A PR that fails a step gets the landing-failed label and a comment, and the queue continues.
// Run with: pnpm land <queue-file> [--dry-run]   (queue: one <branch>:<pr>:<clean-head> per line)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { hostname, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  baseAction,
  ciState,
  ciStep,
  claudeReviewGate,
  defangReview,
  readInTree,
  removeInTree,
  symlinkEntries,
  writeInTree,
  treeCodeRefusal,
  trustedGitConfig,
  type Entry,
  errorText,
  Fatal,
  findingsComment,
  floorRegressions,
  isFloorFile,
  isQuiet,
  QUIET_FILE,
  ignoredFilesArgs,
  ignoredToRemove,
  provedTree,
  SOLO_RERUN_MAX,
  failingTestFiles,
  clearStaleQuiet,
  cleanUpAfterDriver,
  clearsUnproved,
  lockState,
  MERGES_LOG,
  parseLstart,
  parsePidFile,
  parseUnproved,
  proveRestingMaster,
  PUBLISH_MARK,
  SUPERVISOR_PID_ENV,
  STOP_FILE,
  SUPERVISED_ENV,
  supervise,
  releaseQuiet,
  requestQuiet,
  waitForQuiet,
  isTransient,
  isUnreviewed,
  LandFailure,
  MAX_BATCH,
  buildPositionsParallel,
  ciArchRebaseline,
  CiOutage,
  type CiMode,
  androidAbis,
  hostAbi,
  parseLandModes,
  parseMaxInflight,
  serializeFatal,
  preparedDifference,
  preparedFits,
  stopProcessGroup,
  type Outcome,
  parseLandArgs,
  parseQueue,
  RETRIES,
  backoffMs,
  type ReviewRecord,
  type NextRound,
  unsafeWorktree,
  parseBatchSize,
  parsePrepared,
  type Prepared,
  prepareRound,
  serializePrepared,
  runBatches,
  retargetChildrenThenDelete,
  reviewerEnv,
  runReviewer,
  statusText,
  withRetry,
  worktreesOf,
} from './land-lib.ts';
import {
  archRebaseline,
  commitRegen,
  deviceRunProblems,
  deviceRunWrote,
  failuresJson,
  isAncestor,
  LANES_JSON,
  type Member,
  mergeGate,
  mergeMember,
  memberTip,
  parseDeviceEvidence,
  parsePrState,
  planPositions,
  type PrState,
  predictPosition,
  staleLines,
  treeMatches,
} from './merge-train-lib.ts';
import { SETUP_GIT_CONFIG } from './floor-merge.ts';
import { reviewerIds } from './land-review-lookup.ts';
import { OUTAGE_CONTEXT, type OutageMark, parseOutageEject, readOutageStreak, writeOutage, checkLockFree, lockHolder, releaseLock, takeLock, checkNotReviewer, missingProof, parseIds, parseSelf, parseFirstParents, parseMaxBatches, parseStopIssue, proofCommits, readProof, reconcileQueue, serializeHandoff, statusSummary, stopLabelSet, type Unproved, writeProof } from './land-state.ts';
import { checkSha, type Git, ignoreAt, parseCheckRunPages, parsePrHead, regenOnlyProblems } from './pr-review-vouch.ts';
import { matcher, STEPS } from './regen.ts';
import { abandonInflight, CiUnavailable, DEFAULT_DEVICES_WAIT_S, DEFAULT_TEST_WAIT_S, staleScratchBranches, failedTestsOf, fullTestWorkflow, parseRunRows, runDevicesOnCi, runOnCi, scratchRef, testBranch } from './land-devices-ci.ts';
import { PatchRefused, checksBranch, checksWorkflow, type ChecksResult, type CheckRun, parseChecksResult, runIdOf, type TreeCheck, awaitOnCi } from './land-devices-ci.ts';
import { applyRegenPatch, awaitRegenOnCi, DEFAULT_QUEUE_WAIT_S, DEFAULT_REGEN_WAIT_S, type Dispatched, dispatchOnCi, landRegen, regenBranch, regenWorkflow } from './land-devices-ci.ts';

const HEAVY = '/tmp/heavy-lease.sh';
const DEVICE = '/tmp/device-lease.sh';
const PRIORITY = '/tmp/dragon-train-priority';
const LOCK = '/tmp/dragon-land.lock';
const LABEL = 'landing-failed';
const env = process.env;
// LAND_TRUSTED=1 (land.yml): this job holds the landing token, so it runs no code of a PR or a merged tree (treeCodeRefusal): no
// install in a landing worktree, the merge drivers are the trusted checkout's, and the tree's own commands (typecheck, the
// evidence stamp, the lane judgement, the device-outcome merge) run in land-checks.yml and come back as data. It needs LAND_CI=only.
const TRUSTED = env['LAND_TRUSTED'] === '1';
// LAND_TOKEN: read once and taken out of the environment, so no process this one starts inherits it. Only git push and this
// process's own gh calls get it, per call; without it, git and gh use the host's own login (a Mac).
const TOKEN = env['LAND_TOKEN'] || null;
delete env['LAND_TOKEN'];
const withToken = (e: NodeJS.ProcessEnv): NodeJS.ProcessEnv => (TOKEN === null ? e : { ...e, LAND_TOKEN: TOKEN });
const ghEnv = (): NodeJS.ProcessEnv => (TOKEN === null ? env : { ...env, GH_TOKEN: TOKEN });
const pushEnv = (): NodeJS.ProcessEnv =>
  TOKEN === null ? env : { ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}` };
// The driver's worktree. A position built in parallel is built in its own (posDir); WT and wtGit then name it while it builds.
const WT_HOME = env['LAND_WORKTREE'] ?? '/tmp/dragon-land';
let WT = WT_HOME;
// Pipelining (LAND_PIPELINE, default on): a builder process (LAND_ROLE=builder) prepares the next batch in its own worktree.
const ROLE = env['LAND_ROLE'] === 'builder' ? 'builder' : 'driver';
const WT_MAIN = env['LAND_WORKTREE_MAIN'] ?? WT_HOME;
const WT_NEXT = env['LAND_WORKTREE_NEXT'] ?? '/tmp/dragon-land-next';
const PIPELINE = env['LAND_PIPELINE'] !== '0';
// Parallel position builds (LAND_PARALLEL, default on): position k of a batch is prepared in its own worktree, reused across
// batches (<driver worktree>-pos<k>, 1.5–4 GB each).
const PARALLEL = env['LAND_PARALLEL'] !== '0';
const posDir = (k: number): string => `${WT_HOME}-pos${k}`;
// Worktrees the driver and its builder own, never a member's.
const OWN = (): string[] => [MAIN, WT_HOME, WT_MAIN, WT_NEXT, ...Array.from({ length: MAX_BATCH }, (_, i) => posDir(i + 1)), ...Array.from({ length: MAX_BATCH }, (_, i) => `${WT_NEXT}-pos${i + 1}`)];
// LAND_LOG_DIR (land.yml, uploaded as an artifact): the status, logs, reviews and run directory go there instead of /tmp.
const LOG_DIR = env['LAND_LOG_DIR'] || null;
if (LOG_DIR !== null) mkdirSync(LOG_DIR, { recursive: true });
const logPath = (name: string, tmp: string): string => (LOG_DIR === null ? tmp : join(LOG_DIR, name));
const STATUS = env['LAND_STATUS'] ?? logPath('land.status', '/tmp/land.status');
const LOG = env['LAND_LOG'] ?? logPath('land.log', '/tmp/land.log');
const REVIEW_DIR = env['LAND_REVIEW_DIR'] ?? logPath('reviews', '/tmp/land-reviews');
// The run directory (the driver's notes for its supervisor, emptied when a run starts) and the record of a merged position no
// full test has passed yet, which outlives the run (and is kept on GitHub too, as master's land/proof status).
const RUN_DIR = env['LAND_RUN_DIR'] ?? logPath('run', '/tmp/dragon-land.run');
const UNPROVED = env['LAND_UNPROVED'] ?? '/tmp/dragon-land.unproved.json';
// In GitHub Actions the status is the job summary too.
const SUMMARY = env['GITHUB_ACTIONS'] === 'true' && env['GITHUB_STEP_SUMMARY'] ? env['GITHUB_STEP_SUMMARY'] : null;
const putStatus = (text: string): void => {
  writeFileSync(STATUS, text);
  if (SUMMARY !== null) writeFileSync(SUMMARY, statusSummary(text));
};
const runFile = (name: string): string => join(RUN_DIR, name);
const NEXT_LOG = logPath('land-next.log', '/tmp/land-next.log');
/** The CI device run a driver has in flight (land-devices-ci.ts record), for the supervisor to cancel after an interrupt. */
const ciInflight = (role: 'driver' | 'builder'): string => runFile(`ci-inflight-${role}.json`);
const readOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};
// The land/proof record read from GitHub when the run started (loadProof), kept current by markUnproved and markProved; the
// file, written alongside, speaks first (a run on this host wrote it).
let githubUnproved: Unproved | null = null;
const readUnproved = (): Unproved | null => parseUnproved(readOrNull(UNPROVED)) ?? githubUnproved;
// A process's start time (`ps -o lstart=`), which tells it from a later process that reused its pid; null when it is gone.
const startOf = (pid: number): string | null => {
  try {
    return parseLstart(execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
};
let REVIEW_CMD = '';
const REVIEW_TIMEOUT_MS = 40 * 60_000;
const seconds = (name: string, fallback: number): number => {
  const v = env[name];
  if (v === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(v)) throw new Error(`land: ${name} must be a positive number of seconds, not ${JSON.stringify(v)}`);
  return Number(v);
};
let CI_WAIT_S = 0;
let CI_APPEAR_S = 0;
let QUIET_MAX_S = 0;
// LAND_DEVICES=ci runs a position's device lanes on GitHub runners (device-lanes.yml) instead of under the local device lease.
let DEVICES_ON: CiMode = 'local';
let DEVICES_WAIT_S = 0;
// LAND_TEST=ci proves each tree with full-test.yml on GitHub runners instead of pnpm test on this Mac.
let TEST_ON: CiMode = 'local';
let TEST_WAIT_S = 0;
// LAND_REGEN=ci runs every regen of a landing tree on GitHub runners (regen-on-ci.yml in patch mode) and applies its patch. When
// GitHub Actions does not run it, a Mac runs pnpm regen locally (as LAND_DEVICES=ci falls back) and any other host stops the
// driver without blaming a PR (landRegen in land-devices-ci.ts says why).
let REGEN_ON: CiMode = 'local';
let REGEN_WAIT_S = 0;
// ci-only (each of the three, or all three with LAND_CI=only; parseLandModes): the step never runs here, and GitHub Actions not
// running it stops the driver as a CI outage (CiOutage): no PR failed, the rest of the queue still queued. With all three
// ci-only (CI_ONLY) nothing heavy runs here, so the shared-Mac coordination (priority and quiet files) is skipped too.
let CI_ONLY = false;
// How long a CI run may go without starting any job, with none waiting for a runner, before GitHub Actions counts as not running
// it; and how long a run whose jobs wait for a runner (LAND_CI_QUEUE_WAIT) is waited for.
let CI_START_S = 0;
let CI_QUEUE_S = 0;
// How many positions of a batch have their CI regen dispatched at once (LAND_CI_MAX_INFLIGHT, default 2): a regen takes several
// macOS jobs and the free plan runs 5 at once, so the positions above it are built one by one, each regen dispatched in turn.
let CI_MAX_INFLIGHT = 2;
// How long a land-checks.yml run (LAND_TRUSTED) may run once started.
let CHECKS_WAIT_S = 0;
let BATCH = 1;
// LAND_MAX_BATCHES (land.yml: 1, for the 6-hour job limit): the batches this run lands; the rest goes to LAND_HANDOFF.
let MAX_BATCHES: number | undefined;
// LAND_STOP_ISSUE: a tracking issue whose land-stop label asks for the same graceful stop as STOP_FILE.
let STOP_ISSUE: number | null = null;
const HANDOFF = env['LAND_HANDOFF'] || null;
const REGEN = ['pnpm', 'regen'];
const DEVICES = ['pnpm', 'run', 'parity:devices'];

const stamp = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')} ${d.toTimeString().slice(0, 8)}`;
};
const log = (line: string): void => {
  const out = `${stamp().slice(11)} ${ROLE === 'builder' ? '[next] ' : ''}${line}`;
  console.log(out);
  writeFileSync(LOG, `${out}\n`, { flag: 'a' });
};
// The driver ends when its supervisor is gone (it was reparented), checked before every step and in every wait.
const exitIfOrphaned = (): void => {
  const sup = env[SUPERVISOR_PID_ENV];
  if (env[SUPERVISED_ENV] !== '1' || sup === undefined || String(process.ppid) === sup) return;
  log(`the supervisor (pid ${sup}) is gone; the driver stops here`);
  process.exit(3);
};
const sleep = (ms: number): void => {
  exitIfOrphaned();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  exitIfOrphaned();
};
const msg = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---- git and gh ------------------------------------------------------------------------------------------------------
const gitAt =
  (dir: string): Git =>
  (args, input) =>
    execFileSync('git', ['-C', dir, ...args], { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024, env: args[0] === 'push' ? pushEnv() : env });
let MAIN = '';
const git: Git = (args, input) => gitAt(MAIN)(args, input);
let wtGit = gitAt(WT);
/** Runs fn with WT (and wtGit) naming dir: a position built in its own worktree. */
const withWorktree = <R>(dir: string, fn: () => R): R => {
  const [wt, g] = [WT, wtGit];
  [WT, wtGit] = [dir, gitAt(dir)];
  try {
    return fn();
  } finally {
    [WT, wtGit] = [wt, g];
  }
};
const text = (g: Git, args: string[]): string => g(args).toString('utf8').trim();
const net = (g: Git, args: string[]): string => withRetry(`git ${args[0]}`, () => g(args).toString('utf8'), sleep, log);
const gh = (args: string[]): string =>
  withRetry(`gh ${args.slice(0, 2).join(' ')}`, () => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, env: ghEnv() }), sleep, log);
let REPO = '';
let SELF: { id: number; login: string } = { id: 0, login: '' };
let PROOF_WRITERS: ReadonlySet<number> = new Set();
let REVIEWER_IDS: number[] | null = null;
const prView = (pr: number): PrState & { mergeCommit: string | null } => {
  const v = JSON.parse(gh(['pr', 'view', String(pr), '--repo', REPO, '--json', 'number,state,headRefName,headRefOid,baseRefName,isCrossRepository,mergeCommit']));
  const merge = (v as { mergeCommit?: { oid?: unknown } | null }).mergeCommit?.oid;
  return { ...parsePrState(v), mergeCommit: typeof merge === 'string' ? checkSha(merge, 'mergeCommit') : null };
};
const checkRuns = (sha: string) => parseCheckRunPages(JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${REPO}/commits/${sha}/check-runs?per_page=100`])));
const fetchMaster = (): string => {
  net(git, ['fetch', '--quiet', 'origin', '+refs/heads/master:refs/remotes/origin/master']);
  return checkSha(text(git, ['rev-parse', '--verify', 'refs/remotes/origin/master^{commit}']), 'origin/master');
};
// ---- the land/proof status (land-state.ts) ---------------------------------------------------------------------------
const RUN_URL = env['GITHUB_ACTIONS'] === 'true' && env['GITHUB_RUN_ID'] ? `${env['GITHUB_SERVER_URL'] ?? 'https://github.com'}/${env['GITHUB_REPOSITORY']}/actions/runs/${env['GITHUB_RUN_ID']}` : null;
// Commits whose land/proof record can speak for master: its last 20 first parents and the positions they merged.
const loadProof = (master: string): void => {
  const commits = proofCommits(parseFirstParents(text(git, ['log', '--first-parent', '--max-count=20', '--format=%H %P', master])));
  const r = readProof(gh, REPO, commits, PROOF_WRITERS);
  githubUnproved = r === null ? missingProof(CI_ONLY, master) : r.proved ? null : r.unproved;
  const writers = [...PROOF_WRITERS].join(',');
  log(`land/proof on GitHub (statuses by user ${writers}): ${r === null ? `no record on master or the 20 commits it rests on${CI_ONLY ? '; under LAND_CI=only that counts as unproved' : ''}` : r.proved ? 'master is proved' : `master is unproved (#${r.unproved.pr}'s position ${r.unproved.head})`}`);
};
// A status that cannot be written is fatal where the file does not outlive the run (GitHub Actions); elsewhere the file holds it.
const putProof = (shas: readonly string[], u: Unproved | null): void => {
  for (const sha of new Set(shas)) {
    try {
      writeProof(gh, REPO, sha, u, RUN_URL);
    } catch (error) {
      const why = `could not write the land/proof status (${u === null ? 'proved' : 'unproved'}) on ${sha}: ${errorText(error).split('\n')[0]}`;
      if (env['GITHUB_ACTIONS'] === 'true') throw new Fatal(`${why}; the next run could not tell whether master is proved`);
      log(`  !!! ${why}; ${UNPROVED} keeps the record on this host`);
    }
  }
};
const markUnproved = (u: Unproved, shas: readonly string[]): void => {
  writeFileSync(UNPROVED, JSON.stringify(u));
  githubUnproved = u;
  putProof(shas, u);
};
// master (or the given merge commit) is on a proved tree: the record goes, and the position it named is marked proved too.
const markProved = (shas: readonly string[] = [fetchMaster()]): void => {
  const was = readUnproved();
  rmSync(UNPROVED, { force: true });
  githubUnproved = null;
  putProof([...shas, ...(was !== null && /^[0-9a-f]{40}$/.test(was.head) ? [was.head] : [])], null);
};
const remoteHead = (branch: string): string | null => {
  const out = net(git, ['ls-remote', 'origin', `refs/heads/${branch}`]).trim();
  if (out === '') return null;
  const [oid, ref] = out.split('\n').length === 1 ? out.split('\t') : [];
  if (ref !== `refs/heads/${branch}`) throw new Error(`git ls-remote for ${branch} printed ${JSON.stringify(out.slice(0, 200))}`);
  return checkSha(oid, `ls-remote ${branch}`);
};

// ---- steps -----------------------------------------------------------------------------------------------------------
let current: Entry | null = null;
let lastBuilt: string | null = null;
// The worktree the last build left its position in (the driver's, or a parallel position's).
let lastBuiltDir = WT_HOME;
const proved: string[] = []; // every commit whose full test passed in this run // the position the last build left in the worktree, untouched since
const stepLog = (pr: number, step: string): string => logPath(`land-${pr}-${step}.log`, `/tmp/land-${pr}-${step}.log`);
const tail = (path: string, n = 30): string => {
  try {
    return readFileSync(path, 'utf8').trimEnd().split('\n').slice(-n).join('\n');
  } catch {
    return '';
  }
};
type Run = { status: number | null; signal: string | null; error?: string; log: string };
// Runs a long step with its output in its own log file.
const run = (step: string, argv: string[], cwd: string, extraEnv: Record<string, string> = {}): Run => {
  exitIfOrphaned();
  const refusal = TRUSTED ? treeCodeRefusal(argv, cwd, MAIN, resolvePath) : null;
  if (refusal !== null) throw new Fatal(refusal);
  const path = stepLog(current?.pr ?? 0, step);
  log(`  ${step}: ${argv.join(' ')} (log ${path})`);
  const fd = openSync(path, 'w');
  try {
    const r = spawnSync(argv[0]!, argv.slice(1), { cwd, stdio: ['ignore', fd, fd], env: { ...env, ...extraEnv } });
    return { status: r.status, signal: r.signal, ...(r.error ? { error: r.error.message } : {}), log: path };
  } finally {
    closeSync(fd);
  }
};
const failed = (step: string, r: Run, what: string): never => {
  throw new LandFailure(step, `${what} ${r.error ?? r.signal ?? `exited ${r.status}`} (log ${r.log})\n${tail(r.log, 15)}`);
};
const must = (step: string, argv: string[], cwd: string, extraEnv: Record<string, string> = {}): void => {
  const r = run(step, argv, cwd, extraEnv);
  if (r.error !== undefined || r.status !== 0) failed(step, r, argv.join(' '));
};
// A landing worktree's install; under LAND_TRUSTED none (the tree's commands run on CI, which installs it there).
const install = (step: string, dir: string): void => {
  if (!TRUSTED) must(step, ['pnpm', 'install', '--frozen-lockfile'], dir);
};
// pnpm pr:review; under LAND_TRUSTED the trusted checkout's script itself, with node (no package.json command runs in that job).
const prReview = (): string[] => (TRUSTED ? [process.execPath, join(MAIN, 'scripts/pr-review.ts')] : ['pnpm', '-s', 'pr:review']);
const heavy = (step: string, argv: string[]): Run => run(step, [HEAVY, ...argv], WT, { HEAVY_PRIORITY: '1' });

const holdPriority = (): void => {
  if (!CI_ONLY) writeFileSync(PRIORITY, String(process.pid));
};
const releasePriority = (): void => {
  if (CI_ONLY) return;
  try {
    if (readFileSync(PRIORITY, 'utf8').trim() === String(process.pid)) rmSync(PRIORITY, { force: true });
  } catch {}
};

// `conflicting` (only before the build) re-reads whether the PR conflicts with master on every poll.
const waitCi = (step: string, sha: string, what: string, conflicting?: () => boolean): 'success' | 'skip' => {
  const t0 = Date.now();
  for (;;) {
    const s = ciState(checkRuns(sha));
    const next = ciStep(s, (Date.now() - t0) / 1000, { appearS: CI_APPEAR_S, waitS: CI_WAIT_S }, s.state === 'none' && conflicting !== undefined && conflicting());
    if (next === 'success') return log(`  CI checks success on ${what} ${sha}`), 'success';
    if (next === 'skip') return log(`  ${what} ${sha} is CONFLICTING with master and has no CI run (GitHub runs none on a conflicting PR); building anyway, CI on the landing commit is still required`), 'skip';
    // With every step ci-only, CI that never ran or never finished is an outage, as for the driver's own CI steps.
    if (typeof next === 'object' && next.outage === true && CI_ONLY) throw new CiOutage(`LAND_CI=only: GitHub Actions did not run the CI checks of ${what} ${sha}: it ${next.fail}. The driver stops; no PR is blamed`);
    if (typeof next === 'object') throw new LandFailure(step, `${what} ${sha} ${next.fail}`);
    sleep(30_000);
  }
};

const otherHeavyHolders = (): number => {
  let n = 0;
  for (const d of readdirSync('/tmp').filter((x) => x.startsWith('dragon-heavy.'))) {
    try {
      const pid = Number(readFileSync(join('/tmp', d, 'pid'), 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0) {
        process.kill(pid, 0);
        n++;
      }
    } catch {}
  }
  return n;
};
const waitQuiet = (): boolean =>
  waitForQuiet({
    quiet: () => isQuiet(otherHeavyHolders(), loadavg()[0]!),
    request: () => requestQuiet(QUIET_FILE, process.pid),
    release: () => releaseQuiet(QUIET_FILE, process.pid),
    sleep,
    now: Date.now,
    ceilingMs: QUIET_MAX_S * 1000,
    hold: true,
  });

const requireTracked = (step: string, what: string): void => {
  const dirty = text(wtGit, ['status', '--porcelain=v1', '--untracked-files=no']);
  if (dirty !== '') throw new LandFailure(step, `${what} changed tracked files:\n${dirty}`);
};

// A commit's committed device evidence.
const evidenceAt = (commit: string): ReturnType<typeof parseDeviceEvidence> => {
  const show = (path: string): unknown => JSON.parse(git(['show', `${commit}:${path}`]).toString('utf8'));
  return parseDeviceEvidence(show(LANES_JSON), (t) => show(failuresJson(t)), `master ${commit}`);
};
// The device run is judged on what it recorded, against master's committed device evidence, as merge-train judges a position.
// `onCi`: the run was device-lanes.yml's, so an Android image ABI change alone is an architecture rebaseline (ciArchRebaseline),
// whose note is returned for the landing's record.
// `ran`: the tree's parity:lanes as land-checks.yml ran it (LAND_TRUSTED); null runs it here.
type LanesRun = { status: number | null; signal: string | null; stdout: string; stderr: string; error?: string };
const judgeDevices = (master: string, startedMs: number | null, onCi = false, ran: LanesRun | null = null): { problems: string[]; rebaseline: string | null } => {
  const local = (path: string): unknown => JSON.parse(readInTree(WT, path));
  const before = evidenceAt(master);
  // The run's own records that cannot be read are the device step's failure, not the driver's.
  let after: ReturnType<typeof parseDeviceEvidence>;
  try {
    after = parseDeviceEvidence(local(LANES_JSON), (t) => local(failuresJson(t)), 'this tree');
  } catch (error) {
    return { problems: [`the device run's records cannot be judged: ${msg(error)}`], rebaseline: null };
  }
  if (startedMs !== null && !deviceRunWrote(statSync(join(WT, LANES_JSON)).mtimeMs, startedMs)) return { problems: [`the device run did not rewrite ${LANES_JSON}`], rebaseline: null };
  if (ran === null && TRUSTED) throw new Fatal(treeCodeRefusal(['pnpm', '-s', 'run', 'parity:lanes'], WT, MAIN, resolvePath) ?? 'LAND_TRUSTED: parity:lanes must come from land-checks.yml');
  const lanes: LanesRun = ran ?? (({ status, signal, stdout, stderr, error }) => ({ status, signal, stdout, stderr, ...(error ? { error: error.message } : {}) }))(spawnSync('pnpm', ['-s', 'run', 'parity:lanes'], { cwd: WT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  if (lanes.error || lanes.signal || (lanes.status !== 0 && lanes.status !== 1) || !/^parity:lanes: /m.test(lanes.stdout)) {
    return { problems: [`pnpm -s run parity:lanes did not judge the lanes: ${lanes.error ?? lanes.signal ?? `exit ${lanes.status}`} ${lanes.stderr.slice(0, 300)}`], rebaseline: null };
  }
  // An architecture change of a lane is judged as a rebaseline only for the PR LAND_ARCH_REBASELINE names, recorded in its body,
  // or (a CI device run) when every change is of the Android image ABI. Either way each changed lane must keep the previous
  // position's state and exactly its failures (deviceRunProblems); a verdict difference is never accepted.
  const pr = current?.pr ?? 0;
  const arch = archRebaseline(env['LAND_ARCH_REBASELINE'], pr, pr === 0 ? '' : JSON.parse(gh(['pr', 'view', String(pr), '--repo', REPO, '--json', 'body'])).body ?? '');
  if (arch.problem !== null) return { problems: [arch.problem], rebaseline: null };
  if (arch.rebaseline) log(`  LAND_ARCH_REBASELINE: #${pr} may change device lane architectures, with master's states and exact failure sets`);
  const auto = !arch.rebaseline && onCi ? ciArchRebaseline(before, after) : { rebaseline: false, changes: [] };
  const problems = deviceRunProblems(before, after, staleLines(lanes.stdout), { rebaseline: arch.rebaseline || auto.rebaseline });
  if (!auto.rebaseline) return { problems, rebaseline: arch.rebaseline ? `LAND_ARCH_REBASELINE=${pr}` : null };
  const note = `Android ABI rebaseline on CI (${[...androidAbis(before)].join(', ')} -> ${[...androidAbis(after)].join(', ')}) for ${auto.changes.length} device set(s)`;
  log(`  !!! ARCHITECTURE REBASELINE (LAND_DEVICES=${DEVICES_ON}): the CI device run's Android records are of another image ABI than the previous position's; ${problems.length === 0 ? 'every lane keeps its state and exact failures, so they replace them' : 'refused, a verdict differs'}:\n    ${auto.changes.join('\n    ')}`);
  return { problems, rebaseline: problems.length === 0 ? note : null };
};

// Every floor file on master or the landing commit, judged against master's version (floorRegressions).
const floorFileProblems = (master: string, head: string): string[] => {
  const files = (commit: string): string[] => text(git, ['ls-tree', '-r', '--name-only', commit, '--', 'packages']).split('\n').filter(isFloorFile);
  const at = (commit: string, path: string, present: string[]): string | null => (present.includes(path) ? git(['show', `${commit}:${path}`]).toString('utf8') : null);
  const [onMaster, onHead] = [files(master), files(head)];
  return [...new Set([...onMaster, ...onHead])].sort().flatMap((p) => floorRegressions(p, at(master, p, onMaster), at(head, p, onHead)));
};

// `ignored` also removes ignored outputs (test reports, lane outputs), keeping installs and build caches (KEEP_IGNORED).
// The landing tree as a commit apart from the worktree's HEAD and index (a scratch index).
const commitApart = (message: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'land-devices-'));
  try {
    const index = join(dir, 'index');
    copyFileSync(resolve(WT, text(wtGit, ['rev-parse', '--git-path', 'index'])), index);
    const at = (args: string[]): string => execFileSync('git', ['-C', WT, ...args], { encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: index } }).trim();
    at(['add', '-A']);
    const tree = at(['write-tree']);
    return checkSha(at(['commit-tree', tree, '-p', 'HEAD', '-m', message]), 'commit-tree');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
// The landing tree as a commit apart, pushed to a temporary branch for CI.
const ciDeviceDeps = (pr: number) => ({
  gh: (args: string[]) => gh([...args, '--repo', REPO]),
  pushTemp: (branch: string): string => {
    const sha = commitApart(`Landing tree of #${pr} for the CI device lanes (temporary; never merged)`);
    // Forced: the scratch branch is the driver's own (scratchRef refuses any other), and an interrupted run may have left it.
    net(wtGit, ['push', '--quiet', 'origin', `+${sha}:${scratchRef(branch)}`]);
    return sha;
  },
  deleteTemp: (branch: string): void => {
    net(wtGit, ['push', '--quiet', 'origin', `:${scratchRef(branch)}`]);
  },
  download: (runId: number, artifact: string): { dir: string; files: string[] } => {
    const dir = mkdtempSync(join(tmpdir(), 'land-device-outcomes-'));
    try {
      gh(['run', 'download', String(runId), '--repo', REPO, '-n', artifact, '-D', dir]);
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    return { dir, files: readdirSync(dir) };
  },
  remove: (dir: string): void => rmSync(dir, { recursive: true, force: true }),
  record: (inflight: { readonly branch: string; readonly runId: number | null } | null): void => {
    if (inflight === null) rmSync(ciInflight(ROLE), { force: true });
    else writeFileSync(ciInflight(ROLE), JSON.stringify(inflight));
  },
  sleep,
  now: () => Date.now(),
  log,
});

// LAND_DEVICES=ci is a no-op (the local device run) until master has the CI device workflow (it is dispatched from master) and
// the landing tree has its CLI.
const ciDevicesReady = (): boolean => {
  let workflow = true;
  try {
    git(['cat-file', '-e', `${fetchMaster()}:.github/workflows/device-lanes.yml`]);
  } catch {
    workflow = false;
  }
  const cli = existsSync(join(WT, 'packages/parity/src/cli/device-ci.ts'));
  if (workflow && cli) return true;
  const why = !workflow ? 'master has no .github/workflows/device-lanes.yml' : 'the landing tree has no packages/parity/src/cli/device-ci.ts';
  if (DEVICES_ON === 'ci-only') throw new CiOutage(`LAND_DEVICES=ci-only: ${why} yet, and no local device run may stand in. The driver stops; no PR is blamed`);
  log(`  LAND_DEVICES=ci: ${why} yet; running the device lanes locally`);
  return false;
};

// LAND_TEST=ci proves a commit with full-test.yml on GitHub runners, once master has it (it is dispatched from master).
const ciTestReady = (): boolean => {
  try {
    git(['cat-file', '-e', `${fetchMaster()}:.github/workflows/full-test.yml`]);
    return true;
  } catch {
    if (TEST_ON === 'ci-only') throw new CiOutage('LAND_TEST=ci-only: master has no .github/workflows/full-test.yml yet, and no local test may stand in. The driver stops; no PR is blamed');
    log('  LAND_TEST=ci: master has no .github/workflows/full-test.yml yet; running pnpm test locally');
    return false;
  }
};

// LAND_REGEN=ci needs master's regen-on-ci.yml to have the patch mode (it is dispatched from master).
const ciRegenReady = (): boolean => {
  try {
    return git(['show', `${fetchMaster()}:.github/workflows/regen-on-ci.yml`]).toString('utf8').includes("format('regen of {0}', inputs.sha)");
  } catch {
    return false;
  }
};
// The CI regen's deps: the tree's commit (made by dispatchRegen) pushed to its scratch branch, the run in flight recorded in `record`.
const regenCiDeps = (sha: string, record: string) => ({
  ...ciDeviceDeps(current?.pr ?? 0),
  pushTemp: (branch: string): string => (net(wtGit, ['push', '--quiet', 'origin', `+${sha}:${scratchRef(branch)}`]), sha),
  record: (inflight: { readonly branch: string; readonly runId: number | null } | null): void => {
    if (inflight === null) rmSync(record, { force: true });
    else writeFileSync(record, JSON.stringify(inflight));
  },
});
// Commits WT's tree apart and dispatches its CI regen; throws CiUnavailable when that fails (as the device path's push does).
const dispatchRegen = (record: string): Dispatched => {
  let sha: string;
  try {
    sha = commitApart('Landing tree for the CI regen (temporary; never merged)');
  } catch (error) {
    throw new CiUnavailable(`the CI regen could not be run: ${msg(error)}`);
  }
  return dispatchOnCi(regenWorkflow('regen'), { branch: regenBranch(sha), deps: regenCiDeps(sha, record) });
};
// How the latest regen of WT ran, for the regen commit's message: pnpm regen, or the CI run that ran it.
let regenRan = REGEN.join(' ');
// Waits for a dispatched CI regen and applies its patch to WT (whose tree must still be the dispatched commit's).
const finishRegen = (step: string, d: Dispatched, record: string): void => {
  const { url } = awaitRegenOnCi(step, d, { deps: regenCiDeps(d.sha, record), appearS: CI_APPEAR_S, waitS: REGEN_WAIT_S, startS: CI_START_S, queueS: CI_QUEUE_S, apply: (patch) => applyRegenPatch((args) => text(wtGit, args), d.sha, patch) });
  regenRan = `${REGEN.join(' ')} on CI (regen-on-ci.yml ${url})`;
};
// One `pnpm regen` of WT, locally under the heavy lease or (LAND_REGEN=ci) on CI; a failure fails the PR at failStep.
const regenTree = (step: string, failStep: string): void => {
  landRegen({
    mode: REGEN_ON,
    mac: process.platform === 'darwin',
    ready: ciRegenReady,
    log,
    ci: () => {
      log(`  ${step}: pnpm regen on CI (regen-on-ci.yml, patch mode)`);
      finishRegen(failStep, dispatchRegen(ciInflight(ROLE)), ciInflight(ROLE));
    },
    local: () => {
      regenRan = REGEN.join(' ');
      const r = heavy(step, REGEN);
      if (r.error !== undefined || r.status !== 0) failed(failStep, r, 'pnpm regen');
    },
  });
};

// The CI regens of a role's prepared positions still recorded in flight: cancelled, their scratch branches deleted.
const abandonPreparedCi = (role: 'driver' | 'builder'): void => {
  let names: string[] = [];
  try {
    names = readdirSync(RUN_DIR).filter((x) => x.startsWith(`ci-inflight-${role}-pos`));
  } catch {}
  for (const n of names) abandonCiRun(role, runFile(n));
};

// The failing tests of a full-test run, from its full-test-results artifact (for the failure message); null when unreadable.
const fullTestFailures = (runId: number): string | null => {
  const dir = mkdtempSync(join(tmpdir(), 'land-full-test-'));
  try {
    gh(['run', 'download', String(runId), '--repo', REPO, '-n', 'full-test-results', '-D', dir]);
    return failedTestsOf(readInTree(dir, 'full-test-results.json'));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Cancels the CI run a stopped driver or builder recorded in flight, and deletes its scratch branch; never throws. With no
// path, also the CI regens its prepared positions recorded (LAND_REGEN=ci).
const abandonCiRun = (role: 'driver' | 'builder', path = ciInflight(role)): void => {
  if (path === ciInflight(role)) abandonPreparedCi(role);
  try {
    const raw = readOrNull(path);
    if (raw === null) return;
    const repo = REPO !== '' ? REPO : execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8', env: ghEnv() }).trim();
    abandonInflight(raw, {
      cancel: (id) => void execFileSync('gh', ['run', 'cancel', String(id), '--repo', repo], { stdio: 'ignore', env: ghEnv() }),
      findRuns: (workflow, title) =>
        parseRunRows(execFileSync('gh', ['run', 'list', '--repo', repo, '--workflow', workflow, '--branch', 'master', '--limit', '30', '--json', 'databaseId,displayTitle,headBranch,status,conclusion,url'], { encoding: 'utf8', env: ghEnv() }))
          .filter((r) => r.displayTitle === title && r.headBranch === 'master' && r.status !== 'completed')
          .map((r) => r.databaseId),
      deleteBranch: (b) => void execFileSync('git', ['-C', MAIN, 'push', '--quiet', 'origin', `:${scratchRef(b)}`], { stdio: 'ignore', env: pushEnv() }),
      log,
    });
    rmSync(path, { force: true });
  } catch (error) {
    log(`the ${role}'s CI run left in flight could not be cleaned up: ${msg(error)}`);
  }
};

const resetWorktree = (master: string, ignored = false): void => {
  try {
    wtGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    wtGit(['merge', '--abort']);
  } catch {}
  wtGit(['checkout', '-q', '-f', '--detach', master]);
  wtGit(['clean', '-q', '-fd']);
  if (ignored) for (const p of ignoredToRemove(wtGit(ignoredFilesArgs()).toString('utf8'))) removeInTree(WT, p);
};

// The device records the driver writes into a worktree: a symlink at one of them, or at a directory above one, in a tree it takes
// them from or in the worktree's index, fails the PR (a tree's link would redirect the write; writeInTree refuses one on disk).
const refuseRecordSymlinks = (trees: readonly string[], paths: readonly string[]): void => {
  const links = [...trees.map((t) => wtGit(['ls-tree', '-r', '-z', t, '--', 'packages']).toString('utf8')), wtGit(['ls-files', '-s', '-z', '--', 'packages']).toString('utf8')].flatMap(symlinkEntries);
  const hit = links.filter((l) => paths.some((p) => p === l || p.startsWith(`${l}/`)));
  if (hit.length > 0) throw new LandFailure('records', `the tree has a symlink (mode 120000) at or above a device record the driver writes: ${[...new Set(hit)].join(', ')}`);
};
const seedRegenCache = (e: Entry, shas: string[]): void => {
  if (TRUSTED) return; // a local regen's cache; nothing of a tree's worktree is written outside git under LAND_TRUSTED
  const porcelain = text(git, ['worktree', 'list', '--porcelain']);
  for (const w of worktreesOf(porcelain, e.branch, shas, OWN())) {
    const from = join(w, 'node_modules/.cache/dragon-regen/state.json');
    if (!existsSync(from)) continue;
    mkdirSync(join(WT, 'node_modules/.cache/dragon-regen'), { recursive: true });
    copyFileSync(from, join(WT, 'node_modules/.cache/dragon-regen/state.json'));
    log(`  regen cache seeded from ${w}`);
    return;
  }
};

const devicePixels = (head: string): string => {
  try {
    const d = JSON.parse(git(['show', `${head}:${LANES_JSON}`]).toString('utf8')) as { targets: { target: string; lanes: { lane: string; state: string; reason: string | null }[] }[] };
    return d.targets.map((t) => `${t.target} ${t.lanes.find((l) => l.lane === 'device-pixels')?.state ?? '?'}`).join(', ');
  } catch {
    return '?';
  }
};

// The PR's diff for review: gh pr diff, or the same three-dot diff from git when GitHub will not render a diff that large.
const prDiff = (pr: number, master: string, head: string): string => {
  try {
    return gh(['pr', 'diff', String(pr), '--repo', REPO]);
  } catch (error) {
    if (!/too large|exceeded|maximum number|406/i.test(errorText(error))) throw error;
    log(`  gh pr diff #${pr} is too large for GitHub; using git diff ${master.slice(0, 12)}...${head.slice(0, 12)}`);
    return git(['diff', '--no-color', '--no-ext-diff', '--no-renames', `${master}...${head}`]).toString('utf8');
  }
};

// gh pr merge is not retried blindly: after an error the PR state decides whether it merged.
const ghMerge = (pr: number, head: string): void => {
  for (let retry = 0; ; retry++) {
    const r = spawnSync('gh', ['pr', 'merge', String(pr), '--repo', REPO, '--merge', '--match-head-commit', head], { encoding: 'utf8', env: ghEnv() });
    if (prView(pr).state === 'MERGED') {
      if (r.status !== 0) log(`  gh pr merge exited ${r.status ?? r.signal} but #${pr} is merged: ${r.stderr.trim().split('\n')[0]}`);
      return;
    }
    const error = Object.assign(new Error(r.error?.message ?? `exit ${r.status ?? r.signal}`), { stderr: r.stderr, stdout: r.stdout });
    if (retry >= RETRIES || !isTransient(error)) throw new LandFailure('merge', `gh pr merge #${pr} failed and the PR is not merged: ${errorText(error).slice(0, 500)}`);
    log(`  gh pr merge: transient error, retry ${retry + 1} of ${RETRIES}`);
    sleep(backoffMs(retry + 1));
  }
};

// ---- one batch -------------------------------------------------------------------------------------------------------
// What admission found for a PR, used by its build and its publish.
type Ticket = { member: Member; tip: string; clean: string; prHead: string; t0: number; parent: { pr: number; head: string } | null };
// One position of the batch's chain: merge of [prev, tip], then one regen commit (head).
type Built = { prev: string; merge: string; head: string; tip: string; device: string };

// Everything checked before a build is spent on the PR: the PR itself, its base, its own CI and its review at the current head.
const admit = (e: Entry, earlier: readonly Entry[]): { merged: string } | { ticket: Ticket } => {
  current = e;
  releasePriority(); // admission waits on CI and review, so other lanes get the machine back
  const t0 = Date.now();
  log(`=== #${e.pr} ${e.branch} (clean head ${e.clean}): admission`);
  let pr = prView(e.pr);
  if (pr.state === 'MERGED') return { merged: `merged as ${pr.mergeCommit ?? '?'}` };
  if (pr.state !== 'OPEN') throw new LandFailure('check', `PR #${e.pr} is ${pr.state}`);
  if (pr.head !== e.branch) throw new LandFailure('check', `PR #${e.pr} is from ${pr.head}, not ${e.branch}`);
  if (pr.cross) throw new LandFailure('check', `PR #${e.pr} comes from a fork`);
  // A PR whose own CI runs ended without a verdict LAND_OUTAGE_EJECT times in a row is ejected, so it cannot stall the queue.
  if (CI_ONLY) {
    const streak = readOutageStreak(gh, REPO, pr.headOid, PROOF_WRITERS);
    if (streak.count >= OUTAGE_EJECT) throw new LandFailure('ci-outage', `the builds of #${e.pr}'s position at ${pr.headOid} ended without a verdict ${streak.count} times in a row (LAND_OUTAGE_EJECT is ${OUTAGE_EJECT}): a CI outage, or a run killed or past its limit while building it:\n  ${streak.runs.join('\n  ')}\nEjected so the queue goes on. If CI was at fault, push a new head (it starts a new count) and queue it again.`);
    if (streak.count > 0) log(`  #${e.pr}: ${streak.count} build(s) of its position ended without a verdict so far (ejected at ${OUTAGE_EJECT})`);
  }
  net(git, ['fetch', '--quiet', 'origin', `+refs/heads/${e.branch}:refs/remotes/origin/${e.branch}`]);
  let clean: string;
  try {
    clean = checkSha(text(git, ['rev-parse', '--verify', '--quiet', `${e.clean}^{commit}`]), `clean head ${e.clean}`);
  } catch {
    throw new LandFailure('check', `the clean head ${e.clean} of ${e.branch} is not a commit here (ambiguous or missing)`);
  }
  const member: Member = { branch: e.branch, pr: e.pr, clean };
  let tip: string;
  try {
    tip = memberTip(git, member, pr.headOid);
  } catch (error) {
    throw new LandFailure('check', msg(error));
  }

  // The base: retarget a review/* copy or a landed parent to master. A parent earlier in this batch lands first, and its publish
  // moves this PR to master (retargetChildrenThenDelete); the merge gate refuses this PR if that did not happen.
  const parent = earlier.find((x) => x.branch === pr.base);
  let parentHead: { pr: number; head: string } | null = null;
  if (parent !== undefined) {
    const head = remoteHead(pr.base);
    if (head === null) throw new LandFailure('retarget', `PR targets ${pr.base}, which no longer exists and is not master`);
    parentHead = { pr: parent.pr, head };
    log(`  #${e.pr} is based on ${pr.base} (#${parent.pr}), which lands before it in this batch`);
  } else if (pr.base !== 'master') {
    const baseHead = remoteHead(pr.base);
    let inMaster: boolean | null = null;
    if (baseHead !== null) {
      net(git, ['fetch', '--quiet', 'origin', `+refs/heads/${pr.base}:refs/remotes/origin/${pr.base}`]);
      inMaster = isAncestor(git, baseHead, fetchMaster());
    }
    const action = baseAction(pr.base, inMaster);
    if (typeof action === 'object') throw new LandFailure('retarget', action.fail);
    gh(['pr', 'edit', String(e.pr), '--repo', REPO, '--base', 'master']);
    log(`  #${e.pr} retargeted from ${pr.base} to master`);
    pr = prView(e.pr);
    if (pr.base !== 'master') throw new LandFailure('retarget', `PR #${e.pr} still targets ${pr.base} after gh pr edit --base master`);
  }

  // The PR head's own CI must pass before a build is spent on it.
  const ci = waitCi('ci-before', pr.headOid, `#${e.pr} head`, () => parsePrHead(JSON.parse(gh(['pr', 'view', String(e.pr), '--repo', REPO, '--json', 'headRefOid,mergeable']))).mergeable === 'CONFLICTING');
  // Its review must be clean at the current head (GitHub runs no review of a conflicting head, so that waits for the landing commit).
  if (ci === 'success') {
    // --conflicts-ok: GitHub's CONFLICTING ignores the merge drivers; the merge train below decides (judgedHead).
    const review = run('review-before', [...prReview(), String(e.pr), '--wait', '--conflicts-ok'], MAIN);
    if (review.error !== undefined || review.status !== 0) failed('review-before', review, `pnpm -s pr:review ${e.pr} (before the build)`);
    const out = readFileSync(review.log, 'utf8');
    if (!out.includes(`PR #${e.pr} at ${pr.headOid}`)) throw new LandFailure('review-before', `pr:review judged another head than ${pr.headOid} (log ${review.log})`);
    if (isUnreviewed(out)) claudeReview(e, clean, pr.headOid, fetchMaster(), 'claude-review-before');
  }
  return { ticket: { member, tip, clean, prHead: pr.headOid, t0, parent: parentHead } };
};

// While Macroscope is at its limit: the Claude correctness review of the PR's diff at `head`, keyed to the clean head.
const claudeReview = (e: Entry, clean: string, head: string, master: string, step: string): string => {
  log(`  Macroscope is at its spending limit; Claude correctness review of clean head ${clean} (${REVIEW_CMD})`);
  const ignore = ignoreAt(git, head);
  if ('error' in ignore) throw new LandFailure(step, ignore.error);
  mkdirSync(REVIEW_DIR, { recursive: true });
  const saved = join(REVIEW_DIR, `${e.pr}.json`);
  const verdict = claudeReviewGate({
    pr: e.pr,
    head,
    patch: prDiff(e.pr, master, head),
    ignored: (path) => ignore.file.matches(path),
    command: REVIEW_CMD,
    review: (input) => runReviewer(REVIEW_CMD, input, WT, REVIEW_TIMEOUT_MS, { ...reviewerEnv(e.pr, clean), LAND_REVIEW_REPO: REPO, ...(REVIEWER_IDS === null ? {} : { LAND_REVIEWER_IDS: REVIEWER_IDS.join(',') }) }),
    save: (r: ReviewRecord) => writeFileSync(saved, `${JSON.stringify(r, null, 2)}\n`),
  });
  if (!verdict.pass) throw new LandFailure(step, `${verdict.reason} (review ${saved})`, verdict.findings.length > 0 ? findingsComment(e.pr, head, verdict.findings) : undefined);
  log(`  Claude review passed: ${verdict.note} (review ${saved})`);
  return `${verdict.note} (review ${saved})`;
};

// Builds position k on `prev`: merge, regen, typecheck, device evidence against `prev`, regen, commit, regen-only and floors.
// ---- outages at a PR's own CI runs (land-state.ts, LAND_OUTAGE_EJECT) -----------------------------------------------------
let OUTAGE_EJECT = 2;
const putOutage = (sha: string, mark: OutageMark, description: string): void => {
  try {
    writeOutage(gh, REPO, sha, mark, description, RUN_URL);
  } catch (error) {
    log(`  !!! could not record ${OUTAGE_CONTEXT} (${mark}) on ${sha}: ${errorText(error).split('\n')[0]}`);
  }
};
// Under ci-only, a position's build is recorded on the PR's head: building, then a verdict or a CI outage.
const tracked = <R>(e: Entry, t: Ticket, fn: () => R): R => {
  if (!CI_ONLY) return fn();
  putOutage(t.prHead, 'building', `building #${e.pr}'s position${RUN_URL === null ? ` on ${hostname()}` : ''}`);
  try {
    const r = fn();
    putOutage(t.prHead, 'verdict', 'built');
    return r;
  } catch (error) {
    if (error instanceof CiOutage) putOutage(t.prHead, 'outage', `CI outage: ${msg(error)}`);
    else if (error instanceof LandFailure) putOutage(t.prHead, 'verdict', `failed at ${error.step}`);
    throw error;
  }
};
const buildPosition = (prev: string, e: Entry, t: Ticket, k: number): Built => tracked(e, t, () => buildPositionHere(prev, e, t, k));
const buildPositionHere = (prev: string, e: Entry, t: Ticket, k: number): Built => {
  current = e;
  holdPriority();
  log(`=== #${e.pr} ${e.branch}: position ${k} on ${prev}`);
  lastBuilt = null;
  // A child of a PR earlier in the batch lands only on top of its parent's position, never with the parent's commits on their own.
  if (t.parent !== null && !isAncestor(git, t.parent.head, prev)) throw new LandFailure('retarget', `PR targets the branch of #${t.parent.pr}, which did not build in this batch; land its parent first`);
  resetWorktree(prev);
  let merge: string;
  try {
    merge = mergeMember(wtGit, prev, t.member, k, t.tip, 'Land');
  } catch (error) {
    throw new LandFailure('merge', msg(error));
  }
  install('install', WT);
  // Later positions keep the regen cache of the position below them, which is closer than any lane's.
  if (k === 1) seedRegenCache(e, [t.clean, t.prHead]);
  regenTree('regen', 'regen');
  return finishPosition(prev, e, t, k, merge, false);
};

// ---- LAND_TRUSTED: the tree's commands in land-checks.yml ---------------------------------------------------------------
const checkTail = (c: CheckRun): string => `${c.stdout}\n${c.stderr}`.trimEnd().split('\n').slice(-15).join('\n');
const asLanes = (c: CheckRun): LanesRun => ({ status: c.status, signal: null, stdout: c.stdout, stderr: c.stderr });
/**
 * Runs `checks` (and first the merge of a device run's outcomes) for WT's tree in land-checks.yml and returns the results, with
 * the merged records' patch applied to WT. An install that failed is the PR's failure at install, as a local install's is. GitHub
 * Actions not running it, or results that do not read, judged nothing: the driver stops (CiOutage), no PR blamed.
 */
const treeChecks = (prev: string, checks: TreeCheck[], devicesRun: number | null): { result: ChecksResult; url: string } => {
  let sha: string;
  try {
    sha = commitApart('Landing tree for the land checks (temporary; never merged)');
  } catch (error) {
    throw new CiOutage(`LAND_TRUSTED: the tree checks could not be run: ${msg(error)}. The driver stops; no PR is blamed`);
  }
  log(`  tree checks on CI (land-checks.yml): ${[...(devicesRun === null ? [] : [`merge of device run ${devicesRun}`]), ...checks].join(', ')} for ${sha}`);
  const w = checksWorkflow({ prev, checks, devicesRun });
  const deps = regenCiDeps(sha, ciInflight(ROLE));
  let r: ReturnType<typeof awaitOnCi>;
  try {
    r = awaitOnCi(w, dispatchOnCi(w, { branch: checksBranch(sha), deps }), { deps, appearS: CI_APPEAR_S, waitS: CHECKS_WAIT_S, startS: CI_START_S, queueS: CI_QUEUE_S });
  } catch (error) {
    if (error instanceof CiUnavailable) throw new CiOutage(`LAND_TRUSTED: GitHub Actions did not run the tree checks (${error.message}). The driver stops; no PR is blamed`);
    throw error;
  }
  try {
    // The run completed but its step wrote no results: the tree's commands ended it, so it is the PR's failure.
    if (!lstatSync(join(r.outcomesDir, 'result.json'), { throwIfNoEntry: false })) throw new LandFailure('checks', `the tree checks ${r.url} completed with no result.json: the tree's commands ended the step before it wrote its results`);
    // The run completed and its tree step finished: every byte of the artifact is the tree's doing (a process it left behind can
    // rewrite it), so results that do not read, or a patch that is refused, fail the PR. Only the driver's own precondition
    // (its worktree is the tree it sent) stays CI trouble.
    let result: ChecksResult;
    try {
      // An artifact is a run's files: read without following a link (a tree's run could have uploaded one).
      result = parseChecksResult(readInTree(r.outcomesDir, 'result.json'), { sha, checks, devicesRun });
    } catch (error) {
      throw new LandFailure('checks', `the results of the tree checks ${r.url} do not read: ${msg(error)}`);
    }
    if (result.install.status === 0 && result.merge !== null && (result.merge.status === 0 || result.merge.status === 1)) {
      try {
        const bytes = applyRegenPatch((args) => text(wtGit, args), sha, join(r.outcomesDir, 'outputs.patch'));
        log(`  tree checks: applied the ${bytes}-byte patch of the merged device records`);
      } catch (error) {
        if (error instanceof PatchRefused) throw new LandFailure('checks', `the merged device records of the tree checks ${r.url} are refused: ${error.message}`);
        throw new CiOutage(`LAND_TRUSTED: the patch of the tree checks ${r.url} could not be applied (${msg(error)}). The driver stops; no PR is blamed`);
      }
    }
    if (result.install.status !== 0) throw new LandFailure('install', `pnpm install --frozen-lockfile exited ${result.install.status} (${r.url})\n${checkTail(result.install)}`);
    log(`  tree checks: ${(['merge', ...checks] as const).flatMap((k) => (result[k] ? [`${k} ${result[k]!.status}`] : [])).join(', ')} (${r.url})`);
    return { result, url: r.url };
  } finally {
    rmSync(r.outcomesDir, { recursive: true, force: true });
  }
};

/**
 * A position from its regenerated tree in WT on: typecheck, the device step against the previous position, the regen commit and
 * its checks. `prepared`: the tree was regenerated in parallel from the same sources, so the previous position's device records
 * (which the one-by-one build's merge would have carried) are carried here, and the tree regenerated again, when the stamps are
 * equal.
 */
const finishPosition = (prev: string, e: Entry, t: Ticket, k: number, merge: string, prepared: boolean): Built => {
  let device = 'skipped: the evidence stamp equals the previous position\'s';
  const commands = [regenRan];
  // The tree's own lane judgement, from land-checks.yml (LAND_TRUSTED); null: judgeDevices runs it here.
  let lanesRan: LanesRun | null = null;
  let stamp: number | null;
  if (TRUSTED) {
    const c = treeChecks(prev, ['typecheck', 'stamp', 'lanes'], null);
    if (c.result.typecheck!.status !== 0) throw new LandFailure('typecheck', `pnpm typecheck exited ${c.result.typecheck!.status} (${c.url})\n${checkTail(c.result.typecheck!)}`);
    stamp = c.result.stamp!.status;
    if (stamp !== 0 && stamp !== 1) throw new LandFailure('stamp', `pnpm evidence:stamp exited ${stamp} (${c.url})\n${checkTail(c.result.stamp!)}`);
    lanesRan = asLanes(c.result.lanes!);
  } else {
    must('typecheck', ['pnpm', 'typecheck'], WT);
    const r = run('stamp', ['pnpm', '-s', 'evidence:stamp', '--compare', prev], WT);
    if (r.error !== undefined || (r.status !== 0 && r.status !== 1)) failed('stamp', r, 'pnpm evidence:stamp');
    stamp = r.status;
  }
  let runDevices = stamp === 1;
  if (!runDevices && prepared) {
    // Equal stamps: the one-by-one build's merge would have carried the previous position's device records into this tree, so
    // they are carried here, and the tree regenerated to its fixed point on them.
    const outs = [LANES_JSON, failuresJson('ios'), failuresJson('android')];
    refuseRecordSymlinks([prev], outs);
    const differ = outs.filter((p) => git(['show', `${prev}:${p}`]).toString('utf8') !== readInTree(WT, p));
    if (differ.length > 0) {
      for (const p of outs) writeInTree(WT, p, git(['show', `${prev}:${p}`]));
      log(`  carried the previous position's device records (${differ.join(', ')}); regenerating on them`);
      regenTree('regen-carried', 'regen');
      commands.push(regenRan);
      if (TRUSTED) lanesRan = asLanes(treeChecks(prev, ['lanes'], null).result.lanes!);
    }
  }
  if (!runDevices) {
    // Equal stamps: the regen carried the previous position's device records; they must judge exactly as its.
    const { problems } = judgeDevices(prev, null, false, lanesRan);
    if (problems.length > 0) {
      log(`  the stamp equals the previous position's, but the carried device records differ; running the device lanes:\n    ${problems.join('\n    ')}`);
      runDevices = true;
    }
  }
  if (runDevices) {
    const started = Date.now();
    let ran = DEVICES.join(' ');
    // CI that does not run the workflow (no run, or no job started) falls back to the local device run: nothing was judged there.
    let ci: ReturnType<typeof runDevicesOnCi> | null = null;
    if (DEVICES_ON !== 'local' && ciDevicesReady()) {
      try {
        ci = runDevicesOnCi({ pr: e.pr, deps: ciDeviceDeps(e.pr), appearS: CI_APPEAR_S, waitS: DEVICES_WAIT_S, startS: CI_START_S, queueS: CI_QUEUE_S });
      } catch (error) {
        if (!(error instanceof CiUnavailable)) throw error;
        const why = `GitHub Actions did not run the device lanes (${error.message})`;
        if (DEVICES_ON === 'ci-only') throw new CiOutage(`LAND_DEVICES=ci-only: ${why}. The driver stops; no PR is blamed`);
        // The local run is this host's Android ABI: against records of another ABI (a CI run's) it could only differ in
        // architecture, failing the PR for the host, so the driver stops instead.
        let prevAbis: Set<string>;
        try {
          prevAbis = androidAbis(evidenceAt(prev));
        } catch (cause) {
          throw new Fatal(`LAND_DEVICES=ci: ${why}, and the previous position ${prev}'s device records cannot be read to tell whether a local run may stand in (${msg(cause)}); the driver stops, no PR is blamed`);
        }
        const abis = [...prevAbis].filter((a) => a !== hostAbi(process.arch));
        if (abis.length > 0) throw new CiOutage(`LAND_DEVICES=ci: ${why}, and the previous position's Android records are of ${abis.join(', ')}, not this host's ${hostAbi(process.arch)}, so no local run may stand in. The driver stops; no PR is blamed`);
        log(`  !!! LAND_DEVICES=ci: ${why}; running them locally`);
      }
    }
    if (ci !== null && TRUSTED) {
      // The outcomes are merged into this tree's records in land-checks.yml (device-ci.ts is the tree's code), and come back
      // as a patch of the records, applied here; exit 3 is a refusal with its reasons.
      rmSync(ci.outcomesDir, { recursive: true, force: true });
      const m = treeChecks(prev, ['lanes'], runIdOf(ci.url));
      const merged = m.result.merge!;
      if (merged.status === 3) throw new LandFailure('devices-merge', `device-ci.ts merge refused the CI outcomes (${m.url}):\n${checkTail(merged)}`);
      if (merged.status !== 0 && merged.status !== 1) throw new LandFailure('devices-merge', `device-ci.ts merge exited ${merged.status} (${m.url})\n${checkTail(merged)}`);
      lanesRan = asLanes(m.result.lanes!);
      ran = `device-lanes.yml on CI for the position's tree ${ci.sha} (${ci.url}), merged with device-ci.ts merge in land-checks.yml (${m.url})`;
    } else if (ci !== null) {
      try {
        // Fails loudly unless every CI device's outcome is there, on this tree's evidence; exit 3 is a refusal with its reasons.
        const mergeCmd = ['node', '--conditions=dragon-internal', 'packages/parity/src/cli/device-ci.ts', 'merge', ci.outcomesDir];
        const m = run('devices-merge', mergeCmd, WT);
        if (m.status === 3) throw new LandFailure('devices-merge', `device-ci.ts merge refused the CI outcomes:\n${tail(m.log, 20)}`);
        if (m.error !== undefined || m.signal !== null || (m.status !== 0 && m.status !== 1)) failed('devices-merge', m, mergeCmd.join(' '));
      } finally {
        rmSync(ci.outcomesDir, { recursive: true, force: true });
      }
      ran = `device-lanes.yml on CI for the position's tree ${ci.sha} (${ci.url}), merged with device-ci.ts merge`;
    } else {
      const d = run('devices', [DEVICE, ...DEVICES], WT);
      // master's device-pixels lane fails on purpose, so the exit code says nothing; the judgement against the previous position decides.
      if (d.error !== undefined || d.signal !== null || (d.status !== 0 && d.status !== 1)) failed('devices', d, DEVICES.join(' '));
    }
    // Under LAND_TRUSTED the records came as land-checks.yml's patch, so their file times say nothing; its merge's exit did.
    const judged = judgeDevices(prev, TRUSTED ? null : started, ci !== null, lanesRan);
    if (judged.problems.length > 0) throw new LandFailure('judge-devices', `the device run differs from the previous position's device evidence:\n  ${judged.problems.join('\n  ')}`);
    regenTree('regen-after-devices', 'regen-after-devices');
    commands.push(ran, regenRan);
    device = `ran${ran === DEVICES.join(' ') ? '' : ' on CI'}; every lane passes or fails as on the previous position${judged.rebaseline === null ? '' : `; ${judged.rebaseline}`}`;
  }
  log(`  device lanes: ${device}`);
  const head = commitRegen(wtGit, k, t.member, commands, 'Land');
  const ignore = ignoreAt(wtGit, head);
  if ('error' in ignore) throw new LandFailure('regen-only', ignore.error);
  const regenProblems = regenOnlyProblems(wtGit, head, ignore);
  if (regenProblems.length > 0) throw new LandFailure('regen-only', `the regen commit ${head} is not regen-only:\n  ${regenProblems.join('\n  ')}`);
  // Stricter than the review-ignore list (which also covers hand-written package.json, lockfiles, .d.ts, vendor): every path the
  // regen commit changes is a regen step's declared output or a device record.
  const stray = pathsBetween(merge, head).filter((p) => !isStepOutput(p) && !isDeviceRecord(p));
  if (stray.length > 0) throw new LandFailure('regen-only', `the regen commit ${head} changes paths that are not a regen step's declared output:\n  ${stray.slice(0, 40).join('\n  ')}`);
  const floors = floorFileProblems(prev, head);
  if (floors.length > 0) throw new LandFailure('floors', `the landing commit lowers a floor below the previous position's:\n  ${floors.join('\n  ')}`);
  log('  floors: none below the previous position');
  const prediction = predictPosition(wtGit, t.member, { prev, merge, head, tip: t.tip });
  log(`  Macroscope vouch prediction: ${prediction.vouch.ok ? 'an "already reviewed" skip will be vouched for' : `not vouchable (${prediction.vouch.reason}); a full review will run unless at the limit`}`);
  lastBuilt = head;
  lastBuiltDir = WT;
  return { prev, merge, head, tip: t.tip, device };
};

// Regen's declared outputs (every step's), and the device records the device runs write; nothing else is a landing's to change.
const isStepOutput = matcher(STEPS.flatMap((s) => s.outputs));
const isDeviceRecord = matcher([failuresJson('*')]);
const pathsBetween = (a: string, b: string): string[] =>
  wtGit(['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--no-relative', a, b])
    .toString('utf8')
    .split('\0')
    .filter((p) => p !== '');

// ---- parallel position builds (land-lib buildPositionsParallel) --------------------------------------------------------
// A local preparation runs pnpm regen in its own process group; a CI one (LAND_REGEN=ci) has a regen dispatched (`ci`) instead.
type PreparedPosition = { k: number; dir: string; done: string; log: string; pgid: number; start: string | null; ci?: { d: Dispatched; record: string } };
const preparedPids = (): string => runFile(`prepare-${ROLE}.pids`);
// Disk: each position worktree takes 1.5 to 4 GB. They are reused batch to batch (installs kept); a batch is prepared in parallel
// only while the disk keeps LAND_PARALLEL_FREE_GB (default 40) free after the worktrees it adds, else they are removed and the
// batch is built one by one. A run's end removes them.
const PARALLEL_FREE_GB = Number(env['LAND_PARALLEL_FREE_GB'] ?? '40');
const POS_GB = 4;
const freeGb = (dir: string): number => {
  const s = statfsSync(dir);
  return (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
};
const removePositionWorktrees = (): void => {
  for (let k = 1; k <= MAX_BATCH; k++) {
    const dir = posDir(k);
    if (!existsSync(dir)) continue;
    try {
      git(['worktree', 'remove', '--force', dir]);
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
    log(`  parallel build: removed ${dir}`);
  }
  try {
    git(['worktree', 'prune']);
  } catch {}
};

// Prepares position k in its own worktree: master with the batch's first k PRs merged, installed, and `pnpm regen` started under
// the heavy lease in its own process group (recorded for the supervisor), its exit code written to a file when it ends.
const preparePosition = (base: string, k: number, items: readonly { entry: Entry; ticket: Ticket }[]): PreparedPosition => {
  const dir = posDir(k);
  current = items[k - 1]!.entry;
  if (REGEN_ON !== 'local' && k > CI_MAX_INFLIGHT) throw new Error(`LAND_CI_MAX_INFLIGHT is ${CI_MAX_INFLIGHT}: no more CI regens are dispatched at once`);
  log(`  parallel build: preparing position ${k} (#${current.pr}) in ${dir}`);
  if (!existsSync(join(dir, '.git'))) git(['worktree', 'add', '-q', '--detach', dir, base]);
  return withWorktree(dir, () => {
    resetWorktree(base);
    let cur = base;
    for (const [j, it] of items.entries()) cur = mergeMember(wtGit, cur, it.ticket.member, j + 1, it.ticket.tip, 'Prepare');
    install(`prepare-${k}-install`, dir);
    if (REGEN_ON !== 'local') {
      // Dispatched now and waited for in awaitPrepared, so the batch's regens run on CI side by side. When GitHub Actions does not
      // take it (or master has no patch mode yet), this preparation fails and the position builds one by one (regenTree decides).
      if (!ciRegenReady()) throw new Error(`master's regen-on-ci.yml has no patch mode yet`);
      const record = runFile(`ci-inflight-${ROLE}-pos${k}.json`);
      const d = dispatchRegen(record);
      log(`  parallel build: position ${k}'s regen dispatched on CI for ${d.sha}`);
      return { k, dir, done: '', log: '', pgid: 0, start: null, ci: { d, record } };
    }
    const done = runFile(`prepare-${ROLE}-${k}.done`);
    const logFile = logPath(`land-prepare-${ROLE}-${k}.log`, `/tmp/land-prepare-${ROLE}-${k}.log`);
    rmSync(done, { force: true });
    const child = spawn('/bin/bash', ['-c', `cd "$1" && HEAVY_PRIORITY=1 ${HEAVY} pnpm regen > "$2" 2>&1; echo $? > "$3"`, 'prepare', dir, logFile, done], { detached: true, stdio: 'ignore', env });
    child.unref();
    if (child.pid === undefined) throw new LandFailure('regen', `could not start the regen of position ${k}`);
    const start = startOf(child.pid);
    writeFileSync(preparedPids(), `${child.pid} ${start ?? ''}\n`, { flag: 'a' });
    log(`  parallel build: position ${k}'s regen started (pid ${child.pid}, log ${logFile})`);
    return { k, dir, done, log: logFile, pgid: child.pid, start };
  });
};

// Waits for a preparation's regen. Its failure does not eject the PR: the position is built one by one (buildPositionsParallel),
// since a run beside the batch's other regens can fail for the load's sake (disk, a capture timing out).
const awaitPrepared = (h: PreparedPosition): void => {
  const ci = h.ci;
  if (ci !== undefined) {
    try {
      return withWorktree(h.dir, () => finishRegen('regen', ci.d, ci.record));
    } catch (error) {
      if (REGEN_ON === 'ci-only' && error instanceof CiUnavailable) throw new CiOutage(`LAND_REGEN=ci-only: GitHub Actions did not run the regen (${error.message}). The driver stops; no PR is blamed`);
      throw error;
    }
  }
  regenRan = REGEN.join(' ');
  while (!existsSync(h.done)) sleep(5000);
  const code = readFileSync(h.done, 'utf8').trim();
  if (code !== '0') throw new LandFailure('regen', `pnpm regen exited ${code} (log ${h.log})\n${tail(h.log, 15)}`);
};

// Stops the regens of a role's parallel preparations (their own process groups), after its process died or was stopped.
// Returns whether every one is gone, so its worktree can be reused.
const killPrepared = (role: 'driver' | 'builder'): boolean => {
  let gone = true;
  for (const line of (readOrNull(runFile(`prepare-${role}.pids`)) ?? '').split('\n')) {
    const m = /^([1-9]\d*) ?(.*)$/.exec(line.trim());
    if (m === null) continue;
    if (!stopGroup(Number(m[1]), m[2] || null)) {
      gone = false;
      log(`!!! the ${role}'s position preparation (process group ${m[1]}) did not exit`);
    }
  }
  if (gone) rmSync(runFile(`prepare-${role}.pids`), { force: true });
  return gone;
};

// Stops a preparation that will not be used and waits for its process group to exit, so nothing still writes in its worktree.
const abandonPrepared = (h: PreparedPosition): void => {
  if (h.ci !== undefined) return abandonCiRun(ROLE, h.ci.record);
  if (!stopGroup(h.pgid, h.start)) log(`  !!! parallel build: position ${h.k}'s regen (process group ${h.pgid}) did not exit; ${h.dir} is not reused until it does`);
};

// Position k on the actual position below it, from its preparation: the one-by-one build's merge, then the prepared tree, whose
// sources must be the merge's (else it is built one by one here), then the device step and the checks (finishPosition).
const assemblePosition = (prev: string, it: { entry: Entry; ticket: Ticket }, k: number, h: PreparedPosition): Built => tracked(it.entry, it.ticket, () => assemblePositionHere(prev, it, k, h));
const assemblePositionHere = (prev: string, it: { entry: Entry; ticket: Ticket }, k: number, h: PreparedPosition): Built => {
  const { entry: e, ticket: t } = it;
  current = e;
  holdPriority();
  log(`=== #${e.pr} ${e.branch}: position ${k} on ${prev} (prepared in ${h.dir})`);
  lastBuilt = null;
  if (t.parent !== null && !isAncestor(git, t.parent.head, prev)) throw new LandFailure('retarget', `PR targets the branch of #${t.parent.pr}, which did not build in this batch; land its parent first`);
  return withWorktree(h.dir, () => {
    wtGit(['add', '-A']);
    const tree = text(wtGit, ['write-tree']);
    resetWorktree(prev);
    let merge: string;
    try {
      merge = mergeMember(wtGit, prev, t.member, k, t.tip, 'Land');
    } catch (error) {
      throw new LandFailure('merge', msg(error));
    }
    // Every path that is not a regen step's declared output must be the merge's (device records are taken from it below).
    const { sources, records } = preparedDifference(pathsBetween(merge, tree), isStepOutput, isDeviceRecord);
    if (sources.length > 0) {
      log(`  parallel build: the prepared tree's sources differ from the merge's (${sources.slice(0, 5).join(', ')}${sources.length > 5 ? ', ...' : ''}); building this position one by one here`);
      install('install', WT);
      regenTree('regen', 'regen');
      return finishPosition(prev, e, t, k, merge, false);
    }
    wtGit(['read-tree', '-u', '--reset', tree]);
    log(`  parallel build: the prepared tree (${tree}) is the merge's sources regenerated`);
    if (records.length > 0) {
      // The merge carries the device records of the position below; the prepared tree has the base's. Take the merge's, and
      // regenerate to the fixed point on them.
      refuseRecordSymlinks([merge, tree], records);
      for (const p of records) {
        const blob = wtGit(['ls-tree', '-z', merge, '--', p]).toString('utf8');
        if (blob === '') removeInTree(WT, p);
        else writeInTree(WT, p, wtGit(['show', `${merge}:${p}`]));
      }
      log(`  parallel build: took the merge's device records (${records.join(', ')}); regenerating on them`);
      regenTree('regen-records', 'regen');
    }
    return finishPosition(prev, e, t, k, merge, true);
  });
};

const buildAllPositions = (base: string, items: readonly { entry: Entry; ticket: Ticket }[], failed: (index: number, error: unknown) => void): ({ position: Built } | { error: unknown })[] | null => {
  if (!PARALLEL) return null;
  // The previous batch's preparations (abandoned, or left by a stopped process) must have exited before their worktrees are reused.
  if (!killPrepared(ROLE)) {
    log('  parallel build: an earlier preparation\'s regen is still running; building this batch one by one');
    return null;
  }
  const missing = items.filter((_, i) => !existsSync(posDir(i + 1))).length;
  const free = freeGb('/tmp');
  if (!preparedFits(free, missing, { floorGb: PARALLEL_FREE_GB, perGb: POS_GB })) {
    log(`  parallel build: ${Math.round(free)} GB free, under ${PARALLEL_FREE_GB} GB after ${missing} more worktree(s); removing the position worktrees and building this batch one by one`);
    removePositionWorktrees();
    return null;
  }
  const t0 = Date.now();
  try {
    return buildPositionsParallel<Ticket, Built, PreparedPosition>(base, items, {
      speculate: (k, its) => preparePosition(base, k, its),
      await: awaitPrepared,
      assemble: assemblePosition,
      sequential: (prev, it, k) => withWorktree(WT_HOME, () => buildPosition(prev, it.entry, it.ticket, k)),
      abandon: abandonPrepared,
      log,
    }, failed);
  } finally {
    // A CI regen a preparation dispatched that was neither awaited nor abandoned (a Fatal stopped the batch) is cancelled.
    abandonPreparedCi(ROLE);
    log(`  parallel build: ${items.length} position(s) in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
};

// The full test of one commit's tree, rerun once on a quiet machine when it fails. Only the tree the last build left is tested
// in place; any other commit (a bisect probe, master, a top whose later member was ejected) is checked out clean, ignored
// outputs of other trees included.
const proveCommit = (head: string, what: string): void => {
  holdPriority();
  let onCi: ReturnType<typeof runOnCi> | null = null;
  if (TEST_ON !== 'local' && ciTestReady()) {
    // The commit itself, pushed to its scratch branch: full-test.yml tests exactly this tree, the regen fixed point included.
    log(`  proving ${head} (${what}): full-test.yml on CI`);
    try {
      onCi = runOnCi(fullTestWorkflow(fullTestFailures), {
        branch: testBranch(head),
        deps: { ...ciDeviceDeps(current?.pr ?? 0), pushTemp: (branch: string) => (net(wtGit, ['push', '--quiet', 'origin', `+${head}:${scratchRef(branch)}`]), head) },
        appearS: CI_APPEAR_S,
        waitS: TEST_WAIT_S,
        startS: CI_START_S,
        queueS: CI_QUEUE_S,
      });
    } catch (error) {
      // GitHub Actions not running the workflow judged nothing: the local test proves the tree instead (ci), or nothing does
      // and the driver stops (ci-only).
      if (!(error instanceof CiUnavailable)) throw error;
      if (TEST_ON === 'ci-only') throw new CiOutage(`LAND_TEST=ci-only: GitHub Actions did not run the full test (${error.message}). The driver stops; no PR is blamed`);
      log(`  !!! LAND_TEST=ci: GitHub Actions did not run the full test (${error.message}); running pnpm test locally`);
    }
  }
  if (onCi !== null) {
    log(`  ${head} passed the full test on CI (${onCi.url})`);
    proved.push(head);
    if (clearsUnproved(readUnproved(), head, (c) => treeMatches(git, fetchMaster(), c).ok)) {
      markProved();
      log('  master has this proved tree; the unproved record is cleared');
    }
    return;
  }
  log(`  proving ${head} (${what}): pnpm test`);
  // The tree the last build left is tested where it was built; any other commit in the driver's own worktree.
  const where = lastBuilt === head ? lastBuiltDir : WT_HOME;
  withWorktree(where, () => proveIn(head));
  proved.push(head);
  if (clearsUnproved(readUnproved(), head, (c) => treeMatches(git, fetchMaster(), c).ok)) {
    markProved();
    log('  master has this proved tree; the unproved record is cleared');
  }
};
const proveIn = (head: string): void => {
  if (lastBuilt !== head || text(wtGit, ['rev-parse', 'HEAD']) !== head || text(wtGit, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    lastBuilt = null;
    resetWorktree(head, true);
    must('install', ['pnpm', 'install', '--frozen-lockfile'], WT);
  }
  let t = heavy('test', ['pnpm', 'test']);
  if (t.error !== undefined || t.status !== 0) {
    // Under load the suite's failures are mostly timeouts. Each failing file is rerun alone on a quiet machine, with the
    // same assertions and timeouts; every one must pass. A crashed run, or too many failing files, reruns the whole suite.
    const files = t.error === undefined ? failingTestFiles(readFileSync(t.log, 'utf8')) : null;
    const solo = files !== null && files.length > 0 && files.length <= SOLO_RERUN_MAX;
    log(`  pnpm test failed; waiting for a quiet machine to rerun ${solo ? `its ${files.length} failing file(s) one at a time` : 'it once more'}`);
    if (!waitQuiet()) throw new LandFailure('test', `pnpm test failed (log ${t.log}), and no quiet machine came within ${QUIET_MAX_S}s to run it once more\n${tail(t.log, 15)}`);
    try {
      if (solo) {
        for (const [i, f] of files.entries()) {
          const r = heavy(`test-solo-${i + 1}`, ['pnpm', 'vitest', 'run', f]);
          if (r.error !== undefined || r.status !== 0) failed('test', r, `${f}, rerun alone on a quiet machine,`);
        }
      } else {
        t = heavy('test-quiet', ['pnpm', 'test']);
      }
    } finally {
      releaseQuiet(QUIET_FILE, process.pid);
    }
    if (solo) log(`  pnpm test: each failing file passed alone on a quiet machine (${files.join(', ')})`);
    else if (t.error !== undefined || t.status !== 0) failed('test', t, 'pnpm test on a quiet machine');
    else log('  pnpm test passed on a quiet machine');
  }
  requireTracked('test', 'pnpm test');
};
const proveTree = (p: Built, e: Entry): void => {
  current = e;
  proveCommit(p.head, `#${e.pr}'s position`);
};
const proveMaster = (master: string): void => {
  current = null;
  const same = provedTree(proved, (h) => treeMatches(git, master, h).ok);
  if (same !== null) return log(`  master ${master} has the tree of ${same} outside docs/goals/**, which passed pnpm test in this run; not proving it again`);
  proveCommit(master, 'master');
};

// Publishes one PR at its position, once the PR before it has merged: push, CI, pr:review, Claude review, merge, tree check.
// From just before gh pr merge to the end of the post-merge cleanup it is a critical section (PUBLISH_MARK): an interrupt waits
// for it. Before that, an interrupt is safe at any point: at most the PR branch moved by a fast-forward, which admission accepts.
const publish = (e: Entry, b: Built, t: Ticket): string => {
  try {
    return publishInside(e, b, t);
  } finally {
    rmSync(runFile(PUBLISH_MARK), { force: true });
  }
};
const publishInside = (e: Entry, b: Built, t: Ticket): string => {
  current = e;
  log(`=== #${e.pr} ${e.branch}: publishing position ${b.head}`);
  const member = t.member;
  const p = { master: b.prev, merge: b.merge, head: b.head, tip: b.tip, clean: t.clean, prHead: t.prHead, device: b.device, t0: t.t0 };
  releasePriority(); // publish waits on CI and review, so other lanes get the machine back
  // The reviewer reads the repository at the PR's own position, not at a later one of the batch.
  resetWorktree(p.head);
  // Never push a position whose previous position is not in master: the branch would carry another PR's unlanded commits.
  const masterNow = fetchMaster();
  if (!isAncestor(git, p.master, masterNow)) throw new LandFailure('push', `the previous position ${p.master} is not in master ${masterNow}; not pushing ${p.head}`);
  // Push (a plain push: git refuses anything but a fast-forward of the PR head), then CI and pr:review on it.
  const before = prView(e.pr);
  if (before.headOid !== p.prHead) throw new LandFailure('push', `PR #${e.pr} moved from ${p.prHead} to ${before.headOid} during the build`);
  if (before.headOid !== p.head) {
    try {
      net(git, ['push', '--quiet', 'origin', `${p.head}:refs/heads/${e.branch}`]);
    } catch (error) {
      throw new LandFailure('push', `git push of ${p.head} to ${e.branch} failed (not a fast-forward?): ${errorText(error).slice(0, 400)}`);
    }
    log(`  pushed ${p.head} to ${e.branch}`);
  }
  waitCi('ci', p.head, `#${e.pr} landing commit`);
  const review = run('pr-review', [...prReview(), String(e.pr), '--wait'], MAIN);
  if (review.error !== undefined || review.status !== 0) failed('pr-review', review, `pnpm -s pr:review ${e.pr}`);
  const reviewOut = readFileSync(review.log, 'utf8');
  if (!reviewOut.includes(`PR #${e.pr} at ${p.head}`)) throw new LandFailure('pr-review', `pr:review judged another head than ${p.head} (log ${review.log})`);

  const claude = isUnreviewed(reviewOut) ? claudeReview(e, p.clean, p.head, p.master, 'claude-review') : 'not needed (Macroscope reviewed)';

  // Merge, pinned to the reviewed head, after re-reading the PR and master.
  const gate = mergeGate(git, prView(e.pr), member, { prev: p.master, merge: p.merge, head: p.head, tip: p.tip }, fetchMaster());
  if (gate.length > 0) throw new LandFailure('merge-gate', gate.join('\n'));
  const porcelain = text(git, ['worktree', 'list', '--porcelain']);
  // The local branch is deleted after the merge (git branch -D), which a worktree that has it checked out would block.
  for (const w of worktreesOf(porcelain, e.branch, [], OWN())) {
    try {
      if (text(gitAt(w), ['rev-parse', '--abbrev-ref', 'HEAD']) === e.branch) gitAt(w)(['checkout', '-q', '--detach']);
    } catch {}
  }
  writeFileSync(runFile(PUBLISH_MARK), JSON.stringify({ pr: e.pr, head: p.head, merged: null }));
  // Recorded on the position before the merge too: a run killed mid-merge (a cancelled land.yml job) leaves master's merge
  // commit, whose second parent is this position, with the record the next run reads (proofCommits).
  const unproved = proved.includes(p.head) ? null : { pr: e.pr, head: p.head };
  if (unproved !== null) markUnproved(unproved, [p.head]);
  ghMerge(e.pr, p.head);
  const mergeSha = prView(e.pr).mergeCommit ?? '0'.repeat(40);
  writeFileSync(runFile(MERGES_LOG), `${e.pr} ${mergeSha} ${p.head}\n`, { flag: 'a' });
  writeFileSync(runFile(PUBLISH_MARK), JSON.stringify({ pr: e.pr, head: p.head, merged: mergeSha }));
  // Until a full test passes on this tree, a run that dies here leaves master on an unproved position; the next run proves it.
  const mergedAt = /^0{40}$/.test(mergeSha) ? fetchMaster() : mergeSha;
  if (unproved === null) markProved([mergedAt]);
  else markUnproved(unproved, [mergedAt]);
  const after = fetchMaster();
  if (!isAncestor(git, p.head, after)) throw new Fatal(`#${e.pr} merged, but origin/master ${after} does not contain ${p.head}`);
  const same = treeMatches(git, after, p.head);
  if (!same.ok) throw new Fatal(`#${e.pr} merged, but origin/master ${after} differs from ${p.head} outside docs/goals/**: ${same.paths.slice(0, 20).join(', ')}`);
  log(`  #${e.pr} merged; origin/master ${after} has the landing commit's tree outside docs/goals/**`);

  const notes: string[] = [];
  // The branch is deleted only after every open PR based on it has moved to master; otherwise it is kept and reported.
  const cleanup = retargetChildrenThenDelete({ repo: REPO, branch: e.branch, gh, log });
  for (const problem of cleanup.problems) {
    notes.push(problem);
    log(`  WARNING ${problem}`);
  }
  // The trusted checkout stays master as it was at dispatch: what just merged never runs in this job.
  if (!TRUSTED) {
    try {
      net(git, ['pull', '-q', '--ff-only']);
    } catch (error) {
      notes.push(`git pull --ff-only in ${MAIN} failed: ${errorText(error).split('\n')[0]}`);
      log(`  WARNING ${notes.at(-1)}`);
    }
  }
  // Cleanup: the member's worktrees (only when clean) and its local branch.
  for (const w of worktreesOf(text(git, ['worktree', 'list', '--porcelain']), e.branch, [p.clean, p.prHead], OWN())) {
    try {
      if (text(gitAt(w), ['status', '--porcelain', '--untracked-files=no']) === '') {
        git(['worktree', 'remove', '--force', w]);
        log(`  removed worktree ${w}`);
      } else log(`  kept worktree ${w}: it has uncommitted changes`);
    } catch (error) {
      log(`  kept worktree ${w}: ${errorText(error).split('\n')[0]}`);
    }
  }
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${e.branch}`]);
    git(['branch', '-D', e.branch]);
  } catch {}
  try {
    gh(['pr', 'edit', String(e.pr), '--repo', REPO, '--remove-label', LABEL]);
  } catch {}
  return `merged as ${mergeSha} (landing commit ${p.head}); device lanes ${p.device}; device-pixels ${devicePixels(p.head)}; Claude review ${claude}; in ${Math.round((Date.now() - p.t0) / 1000)}s${notes.length ? `; ${notes.join('; ')}` : ''}`;
};

// ---- failure report --------------------------------------------------------------------------------------------------
let labelReady = false;
const reportFailure = (e: Entry, f: LandFailure): void => {
  log(`  FAILED #${e.pr} at ${f.step}: ${f.message}`);
  try {
    if (!labelReady) gh(['label', 'create', LABEL, '--repo', REPO, '--force', '--color', 'B60205', '--description', 'The landing driver stopped this PR; see its comment']);
    labelReady = true;
    gh(['pr', 'edit', String(e.pr), '--repo', REPO, '--add-label', LABEL]);
    const body = f.comment ?? `**Landing stopped at step \`${f.step}\`** (pnpm land)\n\n\`\`\`\n${f.message.slice(0, 6000)}\n\`\`\`\n\nFix the cause, then hand #${e.pr} back to the landing queue with the new clean head.`;
    gh(['pr', 'comment', String(e.pr), '--repo', REPO, '--body', defangReview(body)]);
  } catch (error) {
    log(`  could not label or comment on #${e.pr}: ${errorText(error).split('\n')[0]}`);
  }
};

// ---- dry run ---------------------------------------------------------------------------------------------------------
const dryRun = (entries: Entry[]): void => {
  const master = fetchMaster();
  log(`[dry-run] origin/master ${master}; driver worktree ${WT}`);
  for (const e of entries) {
    const pr = prView(e.pr);
    if (pr.state === 'MERGED') {
      log(`[dry-run] #${e.pr} ${e.branch}: already merged, skipped`);
      continue;
    }
    const ci = ciState(checkRuns(pr.headOid));
    log(`[dry-run] #${e.pr} ${e.branch}: ${pr.state}, base ${pr.base}, head ${pr.headOid}${pr.headOid.startsWith(e.clean) ? ' (the clean head)' : ` (clean head ${e.clean})`}, CI ${ci.state}`);
  }
  log(`[dry-run] in batches of up to ${BATCH}: admit each PR (CI, pr:review, Claude review if UNREVIEWED); build a position per PR on the one before (merge, pnpm regen, typecheck, evidence:stamp --compare, device lanes if it differs, regen-only, floors); pnpm test on the top position, bisecting the prefixes when it fails; then per PR in order: push, CI, pr:review, Claude review if UNREVIEWED, merge --match-head-commit, tree check`);
};

// ---- main ------------------------------------------------------------------------------------------------------------
// The lock holds the supervisor (pid, pid-start) and its driver (driver, driver-start); it is held while either lives (lockState).
const LOCK_PID = join(LOCK, 'pid');
const LOCK_DRIVER = join(LOCK, 'driver');
const groupAlive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};
const lockProc = (path: string): { pid: number; start: string } | null => {
  const pid = parsePidFile(readOrNull(path));
  return pid === null ? null : { pid, start: (readOrNull(`${path}-start`) ?? '').trim() };
};
// Each file is written whole (temp file, then rename); the start time first, so a pid file never names a stale start time.
const writeAtomic = (path: string, body: string): void => {
  writeFileSync(`${path}.tmp-${process.pid}`, body);
  renameSync(`${path}.tmp-${process.pid}`, path);
};
const recordProc = (path: string, pid: number): void => {
  writeAtomic(`${path}-start`, startOf(pid) ?? '');
  writeAtomic(path, String(pid));
};
// Takes the lock; returns the pid of a dead run's driver when one was recorded (its leftovers need cleaning), else null.
const lock = (): number | null => {
  let leftover: number | null = null;
  for (;;) {
    try {
      mkdirSync(LOCK);
      recordProc(LOCK_PID, process.pid);
      return leftover;
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    }
    const sup = lockProc(LOCK_PID);
    const driver = lockProc(LOCK_DRIVER);
    // A lock with no supervisor pid yet is being taken by another run (mkdir, then the pid file), unless it is old.
    let age: number;
    try {
      age = Date.now() - statSync(LOCK).mtimeMs;
    } catch {
      continue; // gone meanwhile: try again
    }
    if (sup === null && age < 60_000) throw new Error(`land: another run is taking ${LOCK} right now`);
    const state = lockState(sup, driver, startOf);
    if (state === 'held') throw new Error(`land: another driver (supervisor pid ${sup?.pid}, driver pid ${driver?.pid ?? 'none'}) holds ${LOCK}`);
    if (state === 'orphan') {
      // The pid and its start time both match the recorded driver, so this group is that driver's, not a reused pid's.
      log(`a driver (pid ${driver!.pid}, started ${driver!.start}) is still running without its supervisor; killing its process group`);
      try {
        process.kill(-driver!.pid, 'SIGTERM');
      } catch {}
      for (let i = 0; i < 80 && groupAlive(driver!.pid); i++) sleep(250);
      if (startOf(driver!.pid) === driver!.start) {
        try {
          process.kill(-driver!.pid, 'SIGKILL');
        } catch {}
      }
    }
    // The stale lock is moved aside atomically, so of two runs taking it over only one succeeds; it must still be the lock just
    // judged (another run may have replaced it meanwhile), else it is put back.
    const stale = `${LOCK}.stale-${process.pid}`;
    try {
      renameSync(LOCK, stale);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') continue;
      throw error;
    }
    const moved = lockProc(join(stale, 'pid'));
    if (moved?.pid !== sup?.pid || moved?.start !== sup?.start) {
      try {
        renameSync(stale, LOCK);
      } catch {}
      throw new Error(`land: another run took ${LOCK} while this one judged it stale`);
    }
    rmSync(stale, { recursive: true, force: true });
    leftover = driver?.pid ?? null;
  }
};
const unlock = (): void => {
  try {
    if (readFileSync(LOCK_PID, 'utf8').trim() === String(process.pid)) rmSync(LOCK, { recursive: true, force: true });
  } catch {}
};

const prepareWorktree = (): void => {
  // What pnpm setup:git sets (rerere off, the merge drivers of .gitattributes), in the shared config every worktree of this
  // repository reads, so a landing merge resolves generated outputs and raised floors the same way a lane's does.
  // Under LAND_TRUSTED git also checks out a tree's symlinks as plain files (core.symlinks=false), so none exists on disk.
  for (const [key, value] of TRUSTED ? [...trustedGitConfig(SETUP_GIT_CONFIG, resolvePath(MAIN)), ['core.symlinks', 'false'] as [string, string]] : SETUP_GIT_CONFIG) {
    let now = '';
    try {
      now = text(git, ['config', '--get', key]);
    } catch {}
    if (now !== value) {
      git(['config', key, value]);
      log(`set git config ${key} (pnpm setup:git)`);
    }
  }
  if (!existsSync(WT)) {
    net(git, ['fetch', '--quiet', 'origin', '+refs/heads/master:refs/remotes/origin/master']);
    git(['worktree', 'add', '-q', '--detach', WT, 'refs/remotes/origin/master']);
    log(`created the driver worktree ${WT}`);
    return;
  }
  const dirty = text(wtGit, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (dirty !== '') throw new Error(`land: the driver worktree ${WT} is not clean:\n${dirty}`);
};

const setUp = (): void => {
  CI_WAIT_S = seconds('LAND_CI_WAIT', 5400);
  CI_APPEAR_S = seconds('LAND_CI_APPEAR', 900);
  QUIET_MAX_S = seconds('LAND_QUIET_MAX', 5400);
  ({ devices: DEVICES_ON, test: TEST_ON, regen: REGEN_ON, ciOnly: CI_ONLY } = parseLandModes(env));
  if (TRUSTED && !CI_ONLY) throw new Error('land: LAND_TRUSTED=1 needs LAND_CI=only: nothing of a tree may run in this job');
  // Past land-checks.yml's own 150-minute job limit, so a run within its limits is never cut short.
  CHECKS_WAIT_S = seconds('LAND_CHECKS_WAIT', 150 * 60 + 900);
  OUTAGE_EJECT = parseOutageEject(env['LAND_OUTAGE_EJECT']);
  DEVICES_WAIT_S = seconds('LAND_DEVICES_WAIT', DEFAULT_DEVICES_WAIT_S);
  TEST_WAIT_S = seconds('LAND_TEST_WAIT', DEFAULT_TEST_WAIT_S);
  REGEN_WAIT_S = seconds('LAND_REGEN_WAIT', DEFAULT_REGEN_WAIT_S);
  CI_START_S = seconds('LAND_CI_START', 900);
  CI_QUEUE_S = seconds('LAND_CI_QUEUE_WAIT', DEFAULT_QUEUE_WAIT_S);
  CI_MAX_INFLIGHT = parseMaxInflight(env['LAND_CI_MAX_INFLIGHT']);
  BATCH = parseBatchSize(env['LAND_BATCH']);
  MAX_BATCHES = parseMaxBatches(env['LAND_MAX_BATCHES']);
  STOP_ISSUE = parseStopIssue(env['LAND_STOP_ISSUE']);
  MAIN = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  // The default reviewer is the main checkout's lookup script, never the PR's own copy in the driver worktree.
  REVIEW_CMD = env['LAND_REVIEW_CMD'] ?? `node --conditions=dragon-internal '${join(MAIN, 'scripts/land-review-lookup.ts')}'`;
  REPO = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) throw new Error(`land: gh repo view printed ${JSON.stringify(REPO)}`);
  // The identity this token acts as: the only writer whose land/proof statuses are trusted (with LAND_PROOF_WRITERS), and one
  // that may never be a reviewer, so the identity that merges can never also approve.
  let user: string | null = null;
  try {
    user = gh(['api', 'user']);
  } catch (error) {
    log(`GET user failed (${errorText(error).split('\n')[0]}); taking the token's identity from LAND_TOKEN_USER_ID`);
  }
  // In GitHub Actions with no LAND_TOKEN (an empty queue's start-up), gh acts as GITHUB_TOKEN: github-actions[bot], user 41898282.
  SELF = parseSelf(user, env['LAND_TOKEN_USER_ID'] || (TOKEN === null && env['GITHUB_ACTIONS'] === 'true' ? '41898282' : undefined));
  PROOF_WRITERS = new Set([SELF.id, ...parseIds('LAND_PROOF_WRITERS', env['LAND_PROOF_WRITERS'])]);
  if (env['LAND_REVIEW_SOURCE'] === 'comment') {
    REVIEWER_IDS = reviewerIds(env, REPO, (login) => Number(gh(['api', `users/${login}`, '--jq', '.id']).trim()));
    checkNotReviewer(SELF, REVIEWER_IDS);
  }
};

// Each position is exactly a merge of [previous position, the PR's tip] plus one regen commit, chained on its base.
const verifyChain = (built: readonly { entry: Entry; ticket: Ticket; position: Built }[]): void => {
  const plan = planPositions(git, built.map((b) => b.ticket.member), built.map((b) => b.position.head));
  const base = built[0]!.position.prev;
  if (plan.base !== base) throw new Error(`the chain starts on ${plan.base}, not ${base}`);
  plan.positions.forEach((q, i) => {
    const b = built[i]!.position;
    if (q.prev !== b.prev || q.merge !== b.merge || q.tip !== b.tip) throw new Error(`position ${i + 1} (#${built[i]!.entry.pr}) is not the merge it was built as`);
  });
};

// ---- pipelining ------------------------------------------------------------------------------------------------------
// The builder: prepares one round (admission, positions, proof and bisect) on the given base in WT_NEXT and writes it out.
// It publishes nothing, labels nothing and writes no status; the driver adopts its round or throws it away.
// A path with symlinks resolved (/tmp is /private/tmp on macOS), for the parts of it that exist.
const resolvePath = (p: string): string => {
  const parts = resolve(p).split('/');
  for (let i = parts.length; i > 0; i--) {
    const head = parts.slice(0, i).join('/') || '/';
    try {
      return join(realpathSync(head), ...parts.slice(i));
    } catch {}
  }
  return resolve(p);
};
// Refuses a builder worktree that is, contains or sits inside the main checkout, the driver's worktree or any listed worktree.
const checkNextWorktree = (next: string, driverWorktree: string): void => {
  const listed = text(git, ['worktree', 'list', '--porcelain']).split('\n').flatMap((l) => (l.startsWith('worktree ') ? [l.slice(9)] : []));
  const problem = unsafeWorktree(next, [MAIN, driverWorktree, ...listed.filter((w) => resolvePath(w) !== resolvePath(next))], resolvePath);
  if (problem !== null) throw new Error(`land: LAND_WORKTREE_NEXT: ${problem}; the builder removes and re-adds it, so it must be a worktree of its own`);
};

const builderMain = (): number => {
  setUp();
  const inPath = env['LAND_BUILDER_INPUT']!;
  const outPath = env['LAND_BUILDER_OUTPUT']!;
  process.on('exit', () => {
    if (!CI_ONLY) releaseQuiet(QUIET_FILE, process.pid);
    releasePriority();
  });
  const put = (body: string): void => {
    writeFileSync(`${outPath}.tmp`, body);
    renameSync(`${outPath}.tmp`, outPath);
  };
  try {
    const input = JSON.parse(readFileSync(inPath, 'utf8')) as { base: string; queue: Entry[]; earlier: Entry[]; size: number };
    const base = checkSha(input.base, 'builder base');
    checkNextWorktree(WT, WT_MAIN);
    const setUpWorktree = (): void => {
      if (!existsSync(WT)) git(['worktree', 'add', '-q', '--detach', WT, base]);
      // A builder stopped mid-step may have left its worktree's index lock behind.
      rmSync(join(text(wtGit, ['rev-parse', '--absolute-git-dir']), 'index.lock'), { force: true });
      resetWorktree(base);
    };
    try {
      setUpWorktree();
    } catch (error) {
      // A worktree a killed builder left broken: remove it, let git forget it, and add it again, once.
      log(`the builder worktree ${WT} is broken (${msg(error).split('\n')[0]}); removing it and adding it again`);
      rmSync(WT, { recursive: true, force: true });
      git(['worktree', 'prune']);
      setUpWorktree();
    }
    log(`preparing the next batch on ${base} in ${WT}`);
    const round = prepareRound<Ticket, Built>([...input.queue], input.size, () => base, { admit, build: buildPosition, buildAll: buildAllPositions, verify: verifyChain, prove: proveTree, proveMaster, log }, { earlier: input.earlier, baseProven: true });
    put(serializePrepared(round));
    log(`prepared: ${round.built.length} position(s), ${round.good} proven to land`);
    // Each builder prepares one batch: its position worktrees go with it (the driver proves its chain in its own worktree).
    if (killPrepared(ROLE)) removePositionWorktrees();
  } catch (error) {
    // A Fatal (a chain that is not what it claims) stops the run; anything else (its worktree, git, a full disk) is the
    // builder's own trouble: it writes nothing, and the driver prepares the batch itself.
    if (error instanceof Fatal) put(serializeFatal(error));
    else {
      log(`!!! the builder could not prepare the batch (${msg(error)}); the driver prepares it itself`);
      return 1;
    }
  }
  return 0;
};

// The live (not zombie) processes of a process group.
const groupMembers = (pgid: number): number[] =>
  execFileSync('ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .trim()
    .split('\n')
    .flatMap((l) => {
      const [pid, group, stat] = l.trim().split(/\s+/);
      return Number(group) === pgid && !/^Z/.test(stat ?? '') ? [Number(pid)] : [];
    });
// The builder runs in its own process group (so every process it starts, vitest workers included, goes with it). Its pid and
// start time are kept in the run directory, so the supervisor stops it too when the driver dies.
const BUILDER_FILE = 'builder.pid';
const stopBuilder = (pid: number, start: string | null): void => {
  // A leader that is another process now means the pid was reused, so the group is not the builder's. A leader that is gone
  // still leaves its group id reserved while any member lives, so the group signal can only reach the builder's processes.
  // With no recorded start time the group cannot be told from a reused pid's, so nothing is signalled.
  if (start === null || start === '') return log(`  not stopping the builder (pid ${pid}): its start time was not recorded`);
  if (!stopGroup(pid, start)) log(`  !!! the builder's process group ${pid} did not exit`);
  releaseQuiet(QUIET_FILE, pid);
  if (readOrNull(PRIORITY)?.trim() === String(pid)) rmSync(PRIORITY, { force: true });
};
const stopGroup = (pid: number, start: string | null): boolean =>
  stopProcessGroup(pid, start, {
    startOf,
    members: groupMembers,
    signal: (sig) => {
      try {
        process.kill(-pid, sig);
      } catch {}
    },
    sleep,
  });
// Alive and not a zombie (this synchronous driver never reaps its children).
const running = (pid: number): boolean => {
  try {
    return !/^Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return false;
  }
};

// Started with each builder, detached in its own session: it stops the builder's group if this driver dies, however it dies.
const startWatchdog = (builder: number, builderStart: string | null): void => {
  const driverStart = startOf(process.pid);
  if (builderStart === null || driverStart === null) return log('  !!! no watchdog for the builder: a start time is unknown');
  const w = spawn(process.execPath, [join(dirname(process.argv[1]!), 'land-watchdog.ts'), String(process.pid), driverStart, String(builder), builderStart, QUIET_FILE, PRIORITY, LOG], {
    detached: true,
    stdio: 'ignore',
  });
  w.unref();
};

const nextRound = (queueFile: string): NextRound<Ticket, Built> => {
  let pid: number | null = null;
  const inPath = runFile('next-input.json');
  const outPath = runFile('next-output.json');
  let start: string | null = null;
  const stop = (): void => {
    if (pid === null) return;
    stopBuilder(pid, start);
    rmSync(runFile(BUILDER_FILE), { force: true });
    pid = null;
  };
  return {
    start: (base, queue, earlier, size) => {
      stop();
      rmSync(outPath, { force: true });
      writeFileSync(inPath, JSON.stringify({ base, queue, earlier, size }));
      const fd = openSync(NEXT_LOG, 'a');
      try {
        const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, queueFile], {
          detached: true,
          stdio: ['ignore', fd, fd],
          env: { ...withToken(env), LAND_ROLE: 'builder', LAND_BUILDER_INPUT: inPath, LAND_BUILDER_OUTPUT: outPath, LAND_WORKTREE: WT_NEXT, LAND_WORKTREE_MAIN: WT, [SUPERVISOR_PID_ENV]: String(process.pid) },
        });
        pid = child.pid ?? null;
      } finally {
        closeSync(fd);
      }
      if (pid !== null) {
        start = startOf(pid);
        writeFileSync(runFile(BUILDER_FILE), `${pid} ${start ?? ''}`);
        startWatchdog(pid, start);
      }
      log(`pipelining: preparing the next batch on ${base} (builder pid ${pid}, log ${NEXT_LOG})`);
    },
    collect: () => {
      const empty: Prepared<Ticket, Built> = { base: '', consumed: [], results: [], built: [], good: 0, proven: [], culprit: null };
      log('pipelining: waiting for the prepared batch');
      while (!existsSync(outPath) && pid !== null && running(pid)) sleep(5000);
      // Done: whatever of its group is left (it wrote its output, or died without) goes.
      stop();
      const text = readOrNull(outPath);
      if (text === null) {
        log('!!! the builder ended without a prepared batch; preparing it here instead');
        // A builder that died mid-step left its CI run, if any, in flight.
        abandonCiRun('builder');
        killPrepared('builder');
        return empty;
      }
      let round: Prepared<Ticket, Built> | { fatal: string; outage: boolean };
      try {
        round = parsePrepared<Ticket, Built>(text);
      } catch (error) {
        log(`!!! the prepared batch is unreadable (${msg(error)}); preparing it here instead`);
        return empty;
      }
      if ('fatal' in round) throw round.outage ? new CiOutage(`while preparing the next batch: ${round.fatal}`) : new Fatal(`while preparing the next batch: ${round.fatal}`);
      for (const k of round.proven) proved.push(round.built[k - 1]!.position.head);
      return round;
    },
    cancel: () => {
      if (pid !== null) log('pipelining: stopping the builder; its batch is thrown away');
      stop();
      abandonCiRun('builder');
      killPrepared('builder');
    },
  };
};

// A stop asked for by STOP_FILE (consumed) or by the land-stop label on LAND_STOP_ISSUE (left for the PM to clear). A label that
// cannot be read counts as set: the driver stops rather than run on unasked.
const stopAsked = (): boolean => {
  if (existsSync(STOP_FILE)) {
    rmSync(STOP_FILE, { force: true });
    return true;
  }
  if (STOP_ISSUE === null) return false;
  try {
    if (!stopLabelSet(gh, REPO, STOP_ISSUE)) return false;
    log(`the ${REPO}#${STOP_ISSUE} issue has the land-stop label`);
  } catch (error) {
    log(`!!! could not read the labels of ${REPO}#${STOP_ISSUE} (${errorText(error).split('\n')[0]}); stopping as if land-stop were set`);
  }
  return true;
};
const writeHandoff = (h: Parameters<typeof serializeHandoff>[0]): void => {
  if (HANDOFF !== null) writeFileSync(HANDOFF, serializeHandoff(h));
};

const main = (): number => {
  const args = parseLandArgs(process.argv.slice(2));
  setUp();
  if (HANDOFF !== null) rmSync(HANDOFF, { force: true });
  const queued = parseQueue(readFileSync(args.queue, 'utf8'), { allowEmpty: env['LAND_QUEUE_EMPTY_OK'] === '1' });
  if (args.dryRun) {
    dryRun(queued);
    return 0;
  }
  // The supervisor (below) holds the lock and handles SIGINT, SIGTERM and SIGHUP by killing this process group; this process
  // keeps their default action, so a signal ends it at once, mid-step, without reporting the step as a PR failure.
  const cleanup = (): void => {
    if (!CI_ONLY) releaseQuiet(QUIET_FILE, process.pid);
    releasePriority();
  };
  if (!CI_ONLY && clearStaleQuiet(QUIET_FILE, alive)) log(`removed a stale ${QUIET_FILE} left by a driver that is gone`);
  process.on('exit', cleanup);
  // A synchronous driver cannot act on SIGUSR1 in time; it is kept from killing the driver, and the stop goes to the supervisor.
  process.on('SIGUSR1', () => log(`SIGUSR1 reached the driver, which ignores it; send it to the supervisor (pid ${env[SUPERVISOR_PID_ENV]}, in ${LOCK}/pid)`));
  prepareWorktree();
  if (PIPELINE) checkNextWorktree(WT_NEXT, WT);
  const startedAt = stamp();
  // Reconciled from GitHub first, for a host with no state from the run before (a land.yml job, maybe after a cancelled one):
  // master's land/proof record, and the queued PRs that are already merged, which are skipped.
  loadProof(fetchMaster());
  const reconciled = reconcileQueue(queued, (pr) => {
    const v = prView(pr);
    return { state: v.state, mergeCommit: v.mergeCommit };
  });
  const entries = reconciled.queue;
  const skipped: Outcome[] = reconciled.merged.map((m) => ({ entry: m.entry, result: 'merged before', detail: m.detail }));
  for (const m of reconciled.merged) log(`#${m.entry.pr} ${m.entry.branch}: ${m.detail}`);
  if (entries.length === 0) {
    const r = readUnproved();
    const why = `nothing to land: the queue ${queued.length === 0 ? 'is empty' : 'has only merged PRs'}${r === null ? '' : `; master is unproved (#${r.pr}'s position ${r.head}), so the next run with a queue proves it first`}`;
    putStatus(`${statusText({ queue: args.queue, startedAt, now: stamp(), running: null, outcomes: skipped, fatal: null, total: queued.length, done: true })}${why}\n`);
    writeHandoff({ remainder: [], stopAsked: false, outage: null, fatal: null });
    log(readFileSync(STATUS, 'utf8').trimEnd());
    return 0;
  }
  // Scratch branches a stopped or failed CI step left behind (per commit for the full test) are deleted now: none is in flight.
  try {
    for (const b of staleScratchBranches(net(git, ['ls-remote', 'origin', 'refs/heads/land-devices/*', 'refs/heads/land-test/*', 'refs/heads/land-regen/*', 'refs/heads/land-checks/*']))) {
      try {
        net(git, ['push', '--quiet', 'origin', `:${scratchRef(b)}`]);
        log(`deleted the stale scratch branch ${b}`);
      } catch (error) {
        log(`WARNING could not delete the stale scratch branch ${b}: ${msg(error)}`);
      }
    }
  } catch (error) {
    log(`WARNING could not list the scratch branches: ${msg(error)}`);
  }
  log(`=== pnpm land ${args.queue}: ${entries.map((e) => `#${e.pr}`).join(' ')} in batches of up to ${BATCH}${MAX_BATCHES === undefined ? '' : `, at most ${MAX_BATCHES} batch(es) this run`} (pid ${process.pid}, worktree ${WT}; devices ${DEVICES_ON}, test ${TEST_ON}, regen ${REGEN_ON}${CI_ONLY ? ', LAND_CI=only' : ''})`);
  let latest: readonly Outcome[] = skipped;
  // master left on an unproved position by an interrupted run is proved first; the result is logged loudly, never blocking.
  const resting = readUnproved();
  if (resting !== null && !/^[0-9a-f]{40}$/.test(resting.head)) {
    const master = fetchMaster();
    log(`!!! ${UNPROVED} is unreadable (${resting.head}); recording master ${master} as unproved instead`);
    writeFileSync(UNPROVED, JSON.stringify({ pr: 0, head: master }));
  }
  const write = (done: boolean, fatal: string | null, running: Entry | null = current): void =>
    putStatus(statusText({ queue: args.queue, startedAt, now: stamp(), running: done ? null : running, outcomes: latest, fatal, total: queued.length, done }));
  try {
    proveRestingMaster(readUnproved(), () => proveMaster(fetchMaster()), () => markProved(), log);
  } catch (error) {
    if (!(error instanceof CiOutage)) throw error;
    // No batch started: the whole queue stays queued.
    putStatus(statusText({ queue: args.queue, startedAt, now: stamp(), running: null, outcomes: skipped, fatal: null, outage: error.message, total: queued.length, done: true, stopped: entries }));
    writeHandoff({ remainder: entries, stopAsked: false, outage: error.message, fatal: null });
    try {
      resetWorktree(fetchMaster());
    } catch {}
    log(readFileSync(STATUS, 'utf8').trimEnd());
    return 1;
  }
  const result = runBatches<Ticket, Built>(entries, BATCH, {
    admit: (e, earlier) => (write(false, null, e), admit(e, earlier)),
    base: fetchMaster,
    build: (prev, e, t, k) => (write(false, null, e), buildPosition(prev, e, t, k)),
    buildAll: (base, items, failed) => buildAllPositions(base, items, failed),
    verify: verifyChain,
    prove: (p, e) => (write(false, null, e), proveTree(p, e)),
    proveMaster: (m) => (write(false, null, null), proveMaster(m)),
    publish: (e, p, t) => (write(false, null, e), publish(e, p, t)),
    onFail: reportFailure,
    stopRequested: stopAsked,
    ...(MAX_BATCHES === undefined ? {} : { maxBatches: MAX_BATCHES }),
    onOutcome: (o) => {
      latest = [...skipped, ...o];
      write(false, null);
    },
    log,
    ...(PIPELINE ? { next: nextRound(args.queue) } : {}),
  });
  current = null;
  putStatus(statusText({ queue: args.queue, startedAt, now: stamp(), running: null, outcomes: latest, fatal: result.fatal, outage: result.outage, total: queued.length, done: true, stopped: result.stopped, limited: result.limited }));
  writeHandoff({ remainder: result.stopped, stopAsked: result.stopAsked, outage: result.outage, fatal: result.fatal });
  try {
    resetWorktree(fetchMaster());
  } catch {}
  if (killPrepared(ROLE)) removePositionWorktrees();
  log(readFileSync(STATUS, 'utf8').trimEnd());
  return result.exit;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const requestStop = (): void => writeFileSync(STOP_FILE, `${process.pid}\n`);

// The supervisor: checks the arguments, holds the lock, runs the driver (this file, LAND_SUPERVISED=1) in its own process group,
// and on an interrupt records it and cleans up after the driver (its quiet request and priority, the driver worktree).
// After a driver died abnormally (interrupted, killed, orphaned): release what it held, reset the driver worktree, write the status.
const cleanUpAfter = (driverPid: number, how: string): void => {
  try {
    MAIN = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  } catch {}
  // The builder has its own process group, which an interrupt of the driver's group does not reach.
  const builder = /^([1-9]\d*) ?(.*)$/.exec(readOrNull(runFile(BUILDER_FILE))?.trim() ?? '');
  if (builder) {
    log(`stopping the driver's builder (pid ${builder[1]})`);
    try {
      stopBuilder(Number(builder[1]), builder[2] || null);
    } catch (error) {
      log(`WARNING could not stop the builder: ${errorText(error).split('\n')[0]}`);
    }
  }
  // A CI device run the interrupted driver or its builder had in flight is cancelled and its scratch branch deleted (they died by
  // signal, past their own cleanup).
  for (const role of ['builder', 'driver'] as const) {
    abandonCiRun(role);
    killPrepared(role);
  }
  cleanUpAfterDriver({
    how,
    now: stamp(),
    read: (name) => readOrNull(runFile(name)),
    unproved: readUnproved,
    release: () => {
      releaseQuiet(QUIET_FILE, driverPid);
      if (readOrNull(PRIORITY)?.trim() === String(driverPid)) rmSync(PRIORITY, { force: true });
    },
    reset: () => {
      if (existsSync(WT)) resetWorktree(text(wtGit, ['rev-parse', 'HEAD']));
    },
    status: { read: () => readOrNull(STATUS) ?? '', write: putStatus },
    log,
  });
  log(readOrNull(STATUS)?.trimEnd() ?? '');
};

// ---- the cross-host lock (LAND_GLOBAL_LOCK=1, land-state.ts) ------------------------------------------------------------
// Taken by the supervisor for the whole run, after the host's own lock; released when the run ends however the driver ended.
const takeGlobalLock = (): string => {
  MAIN = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  return takeLock({
    git: (args, input) => gitAt(MAIN)(args, input === undefined ? undefined : Buffer.from(input)).toString('utf8').trim(),
    me: lockHolder(env, { hostname: hostname(), pid: process.pid, pidStart: startOf(process.pid) ?? '' }, new Date().toISOString()),
    here: {
      hostname: hostname(),
      alive: (pid, start) => startOf(pid) === start,
      runCompleted: (repo, run) => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/actions/runs/${run}`], { encoding: 'utf8', env: ghEnv() })).status === 'completed',
    },
    now: () => Date.now(),
    log,
  });
};
// Without LAND_GLOBAL_LOCK=1 the lock is only read: a running land.yml driver that holds it stops this one.
const checkGlobalLock = (): void => {
  MAIN = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  checkLockFree({
    // The network reads are retried on a transient error, as every other git network call of the driver is.
    git: (args) => withRetry(`git ${args[0]}`, () => gitAt(MAIN)(args).toString('utf8').trim(), sleep, log),
    runCompleted: (repo, run) => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/actions/runs/${run}`], { encoding: 'utf8', env: ghEnv() })).status === 'completed',
    log,
  });
};
const releaseGlobalLock = (tag: string): void => releaseLock((args) => gitAt(MAIN)(args).toString('utf8').trim(), tag, log);

// The supervisor: checks the arguments, holds the lock, runs the driver (this file, LAND_SUPERVISED=1) in its own process group,
// and cleans up after it whenever it dies abnormally.
const supervisor = async (): Promise<number> => {
  const args = parseLandArgs(process.argv.slice(2));
  const driver = {
    command: process.execPath,
    args: [...process.execArgv, process.argv[1]!, ...process.argv.slice(2)],
    env: withToken(env),
    graceMs: seconds('LAND_KILL_GRACE', 60) * 1000,
    deferCapMs: seconds('LAND_INTERRUPT_CAP', 3 * 3600) * 1000,
    publishing: () => existsSync(runFile(PUBLISH_MARK)),
    onSpawn: (pid: number) => recordProc(LOCK_DRIVER, pid),
    onStop: requestStop,
    log,
  };
  if (args.dryRun) return (await supervise({ ...driver, onSpawn: () => {} })).code;
  const leftover = lock();
  let held: string | null = null;
  try {
    // An empty queue lands nothing, so it takes no lock (and needs no token to push one).
    const empty = parseQueue(readFileSync(args.queue, 'utf8'), { allowEmpty: env['LAND_QUEUE_EMPTY_OK'] === '1' }).length === 0;
    if (env['LAND_GLOBAL_LOCK'] === '1' && !empty) held = takeGlobalLock();
    else if (!empty) checkGlobalLock();
    if (leftover !== null) cleanUpAfter(leftover, `the death of an earlier run (driver pid ${leftover})`);
    rmSync(RUN_DIR, { recursive: true, force: true });
    mkdirSync(RUN_DIR, { recursive: true });
    if (existsSync(STOP_FILE)) {
      rmSync(STOP_FILE, { force: true });
      log(`removed ${STOP_FILE}, left from before this run`);
    }
    log(`land supervisor pid ${process.pid}: kill -TERM ${process.pid} interrupts (after a merge in progress); kill -USR1 ${process.pid} or touch ${STOP_FILE} stops after the current batch`);
    const r = await supervise(driver);
    if (r.interrupted !== null) cleanUpAfter(r.pid, r.interrupted);
    else if (r.signal !== null) cleanUpAfter(r.pid, `the driver's death by ${r.signal}`);
    else if (r.code === 3) cleanUpAfter(r.pid, 'the driver stopping without its supervisor');
    return r.code;
  } finally {
    if (held !== null) releaseGlobalLock(held);
    unlock();
  }
};

try {
  process.exitCode = ROLE === 'builder' ? builderMain() : env[SUPERVISED_ENV] === '1' ? main() : await supervisor();
} catch (error) {
  console.error(`\nland stopped: ${msg(error)}`);
  process.exitCode = 2;
}
