// Continuous landing driver (owner decision 2026-10-03, process review): lands a queue of reviewed PRs in batches (runBatches in
// land-lib.ts). Each PR gets a position on the one before it, with its own regen and device evidence (the device run is skipped
// only when the position's evidence stamp equals the previous position's), typecheck, regen-only and floors checks; the batch's
// top position is proved once by the full test, and its prefixes are bisected when that fails. Then each PR in order is pushed,
// passes CI, pr:review and a Claude correctness review while Macroscope is at its limit, and merges pinned with
// --match-head-commit. A PR that fails a step gets the landing-failed label and a comment, and the queue continues.
// Run with: pnpm land <queue-file> [--dry-run]   (queue: one <branch>:<pr>:<clean-head> per line)
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import {
  baseAction,
  ciState,
  ciStep,
  claudeReviewGate,
  type Entry,
  errorText,
  Fatal,
  findingsComment,
  floorRegressions,
  isFloorFile,
  isQuiet,
  QUIET_FILE,
  cleanIgnoredArgs,
  provedTree,
  SOLO_RERUN_MAX,
  failingTestFiles,
  clearStaleQuiet,
  interruptedStatus,
  STOP_FILE,
  SUPERVISED_ENV,
  supervise,
  releaseQuiet,
  requestQuiet,
  waitForQuiet,
  isTransient,
  isUnreviewed,
  LandFailure,
  type Outcome,
  parseLandArgs,
  parseQueue,
  RETRIES,
  backoffMs,
  type ReviewRecord,
  parseBatchSize,
  runBatches,
  retargetChildrenThenDelete,
  reviewerEnv,
  runReviewer,
  statusText,
  withRetry,
  worktreesOf,
} from './land-lib.ts';
import {
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
import { checkSha, type Git, ignoreAt, parseCheckRunPages, parsePrHead, regenOnlyProblems } from './pr-review-vouch.ts';

const HEAVY = '/tmp/heavy-lease.sh';
const DEVICE = '/tmp/device-lease.sh';
const PRIORITY = '/tmp/dragon-train-priority';
const LOCK = '/tmp/dragon-land.lock';
const LABEL = 'landing-failed';
const env = process.env;
const WT = env['LAND_WORKTREE'] ?? '/tmp/dragon-land';
const STATUS = env['LAND_STATUS'] ?? '/tmp/land.status';
const LOG = env['LAND_LOG'] ?? '/tmp/land.log';
const REVIEW_DIR = env['LAND_REVIEW_DIR'] ?? '/tmp/land-reviews';
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
let BATCH = 1;
const REGEN = ['pnpm', 'regen'];
const DEVICES = ['pnpm', 'run', 'parity:devices'];

const stamp = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')} ${d.toTimeString().slice(0, 8)}`;
};
const log = (line: string): void => {
  const out = `${stamp().slice(11)} ${line}`;
  console.log(out);
  writeFileSync(LOG, `${out}\n`, { flag: 'a' });
};
const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
const msg = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---- git and gh ------------------------------------------------------------------------------------------------------
const gitAt =
  (dir: string): Git =>
  (args, input) =>
    execFileSync('git', ['-C', dir, ...args], { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
let MAIN = '';
const git: Git = (args, input) => gitAt(MAIN)(args, input);
const wtGit = gitAt(WT);
const text = (g: Git, args: string[]): string => g(args).toString('utf8').trim();
const net = (g: Git, args: string[]): string => withRetry(`git ${args[0]}`, () => g(args).toString('utf8'), sleep, log);
const gh = (args: string[]): string =>
  withRetry(`gh ${args.slice(0, 2).join(' ')}`, () => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }), sleep, log);
let REPO = '';
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
const proved: string[] = []; // every commit whose full test passed in this run // the position the last build left in the worktree, untouched since
const stepLog = (pr: number, step: string): string => `/tmp/land-${pr}-${step}.log`;
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
const heavy = (step: string, argv: string[]): Run => run(step, [HEAVY, ...argv], WT, { HEAVY_PRIORITY: '1' });

const holdPriority = (): void => writeFileSync(PRIORITY, String(process.pid));
const releasePriority = (): void => {
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

// The device run is judged on what it recorded, against master's committed device evidence, as merge-train judges a position.
const judgeDevices = (master: string, startedMs: number | null): string[] => {
  const show = (path: string): unknown => JSON.parse(git(['show', `${master}:${path}`]).toString('utf8'));
  const local = (path: string): unknown => JSON.parse(readFileSync(join(WT, path), 'utf8'));
  const before = parseDeviceEvidence(show(LANES_JSON), (t) => show(failuresJson(t)), `master ${master}`);
  const after = parseDeviceEvidence(local(LANES_JSON), (t) => local(failuresJson(t)), 'this tree');
  if (startedMs !== null && !deviceRunWrote(statSync(join(WT, LANES_JSON)).mtimeMs, startedMs)) return [`the device run did not rewrite ${LANES_JSON}`];
  const lanes = spawnSync('pnpm', ['-s', 'run', 'parity:lanes'], { cwd: WT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (lanes.error || lanes.signal || (lanes.status !== 0 && lanes.status !== 1) || !/^parity:lanes: /m.test(lanes.stdout)) {
    return [`pnpm -s run parity:lanes did not judge the lanes: ${lanes.error?.message ?? lanes.signal ?? `exit ${lanes.status}`} ${lanes.stderr.slice(0, 300)}`];
  }
  return deviceRunProblems(before, after, staleLines(lanes.stdout));
};

// Every floor file on master or the landing commit, judged against master's version (floorRegressions).
const floorFileProblems = (master: string, head: string): string[] => {
  const files = (commit: string): string[] => text(git, ['ls-tree', '-r', '--name-only', commit, '--', 'packages']).split('\n').filter(isFloorFile);
  const at = (commit: string, path: string, present: string[]): string | null => (present.includes(path) ? git(['show', `${commit}:${path}`]).toString('utf8') : null);
  const [onMaster, onHead] = [files(master), files(head)];
  return [...new Set([...onMaster, ...onHead])].sort().flatMap((p) => floorRegressions(p, at(master, p, onMaster), at(head, p, onHead)));
};

// `ignored` also removes ignored outputs (test reports, lane outputs), keeping installs and build caches (KEEP_IGNORED).
const resetWorktree = (master: string, ignored = false): void => {
  try {
    wtGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    wtGit(['merge', '--abort']);
  } catch {}
  wtGit(['checkout', '-q', '-f', '--detach', master]);
  wtGit(['clean', '-q', '-fd']);
  if (ignored) wtGit(cleanIgnoredArgs());
};

const seedRegenCache = (e: Entry, shas: string[]): void => {
  const porcelain = text(git, ['worktree', 'list', '--porcelain']);
  for (const w of worktreesOf(porcelain, e.branch, shas, [MAIN, WT])) {
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
    const r = spawnSync('gh', ['pr', 'merge', String(pr), '--repo', REPO, '--merge', '--match-head-commit', head], { encoding: 'utf8' });
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
    const review = run('review-before', ['pnpm', '-s', 'pr:review', String(e.pr), '--wait'], MAIN);
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
    review: (input) => runReviewer(REVIEW_CMD, input, WT, REVIEW_TIMEOUT_MS, reviewerEnv(e.pr, clean)),
    save: (r: ReviewRecord) => writeFileSync(saved, `${JSON.stringify(r, null, 2)}\n`),
  });
  if (!verdict.pass) throw new LandFailure(step, `${verdict.reason} (review ${saved})`, verdict.findings.length > 0 ? findingsComment(e.pr, head, verdict.findings) : undefined);
  log(`  Claude review passed: ${verdict.note} (review ${saved})`);
  return `${verdict.note} (review ${saved})`;
};

// Builds position k on `prev`: merge, regen, typecheck, device evidence against `prev`, regen, commit, regen-only and floors.
const buildPosition = (prev: string, e: Entry, t: Ticket, k: number): Built => {
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
  must('install', ['pnpm', 'install', '--frozen-lockfile'], WT);
  // Later positions keep the regen cache of the position below them, which is closer than any lane's.
  if (k === 1) seedRegenCache(e, [t.clean, t.prHead]);
  let device = 'skipped: the evidence stamp equals the previous position\'s';
  const commands = [REGEN.join(' ')];
  let r = heavy('regen', REGEN);
  if (r.error !== undefined || r.status !== 0) failed('regen', r, 'pnpm regen');
  must('typecheck', ['pnpm', 'typecheck'], WT);
  r = run('stamp', ['pnpm', '-s', 'evidence:stamp', '--compare', prev], WT);
  if (r.error !== undefined || (r.status !== 0 && r.status !== 1)) failed('stamp', r, 'pnpm evidence:stamp');
  let runDevices = r.status === 1;
  if (!runDevices) {
    // Equal stamps: the regen carried the previous position's device records; they must judge exactly as its.
    const problems = judgeDevices(prev, null);
    if (problems.length > 0) {
      log(`  the stamp equals the previous position's, but the carried device records differ; running the device lanes:\n    ${problems.join('\n    ')}`);
      runDevices = true;
    }
  }
  if (runDevices) {
    const started = Date.now();
    const d = run('devices', [DEVICE, ...DEVICES], WT);
    // master's device-pixels lane fails on purpose, so the exit code says nothing; the judgement against the previous position decides.
    if (d.error !== undefined || d.signal !== null || (d.status !== 0 && d.status !== 1)) failed('devices', d, DEVICES.join(' '));
    const problems = judgeDevices(prev, started);
    if (problems.length > 0) throw new LandFailure('judge-devices', `the device run differs from the previous position's device evidence:\n  ${problems.join('\n  ')}`);
    r = heavy('regen-after-devices', REGEN);
    if (r.error !== undefined || r.status !== 0) failed('regen-after-devices', r, 'pnpm regen');
    commands.push(DEVICES.join(' '), REGEN.join(' '));
    device = 'ran; every lane passes or fails as on the previous position';
  }
  log(`  device lanes: ${device}`);
  const head = commitRegen(wtGit, k, t.member, commands, 'Land');
  const ignore = ignoreAt(wtGit, head);
  if ('error' in ignore) throw new LandFailure('regen-only', ignore.error);
  const regenProblems = regenOnlyProblems(wtGit, head, ignore);
  if (regenProblems.length > 0) throw new LandFailure('regen-only', `the regen commit ${head} is not regen-only:\n  ${regenProblems.join('\n  ')}`);
  const floors = floorFileProblems(prev, head);
  if (floors.length > 0) throw new LandFailure('floors', `the landing commit lowers a floor below the previous position's:\n  ${floors.join('\n  ')}`);
  log('  floors: none below the previous position');
  const prediction = predictPosition(wtGit, t.member, { prev, merge, head, tip: t.tip });
  log(`  Macroscope vouch prediction: ${prediction.vouch.ok ? 'an "already reviewed" skip will be vouched for' : `not vouchable (${prediction.vouch.reason}); a full review will run unless at the limit`}`);
  lastBuilt = head;
  return { prev, merge, head, tip: t.tip, device };
};

// The full test of one commit's tree, rerun once on a quiet machine when it fails. Only the tree the last build left is tested
// in place; any other commit (a bisect probe, master, a top whose later member was ejected) is checked out clean, ignored
// outputs of other trees included.
const proveCommit = (head: string, what: string): void => {
  holdPriority();
  log(`  proving ${head} (${what}): pnpm test`);
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
  proved.push(head);
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
const publish = (e: Entry, b: Built, t: Ticket): string => {
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
  const review = run('pr-review', ['pnpm', '-s', 'pr:review', String(e.pr), '--wait'], MAIN);
  if (review.error !== undefined || review.status !== 0) failed('pr-review', review, `pnpm -s pr:review ${e.pr}`);
  const reviewOut = readFileSync(review.log, 'utf8');
  if (!reviewOut.includes(`PR #${e.pr} at ${p.head}`)) throw new LandFailure('pr-review', `pr:review judged another head than ${p.head} (log ${review.log})`);

  const claude = isUnreviewed(reviewOut) ? claudeReview(e, p.clean, p.head, p.master, 'claude-review') : 'not needed (Macroscope reviewed)';

  // Merge, pinned to the reviewed head, after re-reading the PR and master.
  const gate = mergeGate(git, prView(e.pr), member, { prev: p.master, merge: p.merge, head: p.head, tip: p.tip }, fetchMaster());
  if (gate.length > 0) throw new LandFailure('merge-gate', gate.join('\n'));
  const porcelain = text(git, ['worktree', 'list', '--porcelain']);
  // The local branch is deleted after the merge (git branch -D), which a worktree that has it checked out would block.
  for (const w of worktreesOf(porcelain, e.branch, [], [MAIN, WT])) {
    try {
      if (text(gitAt(w), ['rev-parse', '--abbrev-ref', 'HEAD']) === e.branch) gitAt(w)(['checkout', '-q', '--detach']);
    } catch {}
  }
  ghMerge(e.pr, p.head);
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
  try {
    net(git, ['pull', '-q', '--ff-only']);
  } catch (error) {
    notes.push(`git pull --ff-only in ${MAIN} failed: ${errorText(error).split('\n')[0]}`);
    log(`  WARNING ${notes.at(-1)}`);
  }
  // Cleanup: the member's worktrees (only when clean) and its local branch.
  for (const w of worktreesOf(text(git, ['worktree', 'list', '--porcelain']), e.branch, [p.clean, p.prHead], [MAIN, WT])) {
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
  const merged = prView(e.pr).mergeCommit ?? '?';
  return `merged as ${merged} (landing commit ${p.head}); device lanes ${p.device}; device-pixels ${devicePixels(p.head)}; Claude review ${claude}; in ${Math.round((Date.now() - p.t0) / 1000)}s${notes.length ? `; ${notes.join('; ')}` : ''}`;
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
    gh(['pr', 'comment', String(e.pr), '--repo', REPO, '--body', body]);
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
const lock = (): void => {
  try {
    mkdirSync(LOCK);
  } catch {
    const holder = Number(readFileSync(join(LOCK, 'pid'), 'utf8').trim() || '0');
    let alive = false;
    try {
      if (holder > 0) process.kill(holder, 0);
      alive = holder > 0;
    } catch {}
    if (alive) throw new Error(`land: another driver (pid ${holder}) holds ${LOCK}`);
    rmSync(LOCK, { recursive: true, force: true });
    mkdirSync(LOCK);
  }
  writeFileSync(join(LOCK, 'pid'), String(process.pid));
};
const unlock = (): void => {
  try {
    if (readFileSync(join(LOCK, 'pid'), 'utf8').trim() === String(process.pid)) rmSync(LOCK, { recursive: true, force: true });
  } catch {}
};

const prepareWorktree = (): void => {
  if (!existsSync(WT)) {
    net(git, ['fetch', '--quiet', 'origin', '+refs/heads/master:refs/remotes/origin/master']);
    git(['worktree', 'add', '-q', '--detach', WT, 'refs/remotes/origin/master']);
    log(`created the driver worktree ${WT}`);
    return;
  }
  const dirty = text(wtGit, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (dirty !== '') throw new Error(`land: the driver worktree ${WT} is not clean:\n${dirty}`);
};

const main = (): number => {
  const args = parseLandArgs(process.argv.slice(2));
  CI_WAIT_S = seconds('LAND_CI_WAIT', 5400);
  CI_APPEAR_S = seconds('LAND_CI_APPEAR', 900);
  QUIET_MAX_S = seconds('LAND_QUIET_MAX', 5400);
  BATCH = parseBatchSize(env['LAND_BATCH']);
  MAIN = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  // The default reviewer is the main checkout's lookup script, never the PR's own copy in the driver worktree.
  REVIEW_CMD = env['LAND_REVIEW_CMD'] ?? `node --conditions=dragon-internal '${join(MAIN, 'scripts/land-review-lookup.ts')}'`;
  REPO = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) throw new Error(`land: gh repo view printed ${JSON.stringify(REPO)}`);
  const entries = parseQueue(readFileSync(args.queue, 'utf8'));
  if (args.dryRun) {
    dryRun(entries);
    return 0;
  }
  // The supervisor (below) holds the lock and handles SIGINT, SIGTERM and SIGHUP by killing this process group; this process
  // keeps their default action, so a signal ends it at once, mid-step, without reporting the step as a PR failure.
  const cleanup = (): void => {
    releaseQuiet(QUIET_FILE, process.pid);
    releasePriority();
  };
  if (clearStaleQuiet(QUIET_FILE, alive)) log(`removed a stale ${QUIET_FILE} left by a driver that is gone`);
  process.on('exit', cleanup);
  // SIGUSR1 sent here rather than to the supervisor still asks for a graceful stop (its default action would kill the driver).
  process.on('SIGUSR1', requestStop);
  prepareWorktree();
  const startedAt = stamp();
  log(`=== pnpm land ${args.queue}: ${entries.map((e) => `#${e.pr}`).join(' ')} in batches of up to ${BATCH} (pid ${process.pid}, worktree ${WT})`);
  let latest: readonly Outcome[] = [];
  const write = (done: boolean, fatal: string | null, running: Entry | null = current): void =>
    writeFileSync(STATUS, statusText({ queue: args.queue, startedAt, now: stamp(), running: done ? null : running, outcomes: latest, fatal, total: entries.length, done }));
  const result = runBatches<Ticket, Built>(entries, BATCH, {
    admit: (e, earlier) => (write(false, null, e), admit(e, earlier)),
    base: fetchMaster,
    build: (prev, e, t, k) => (write(false, null, e), buildPosition(prev, e, t, k)),
    // Each position is exactly a merge of [previous position, the PR's tip] plus one regen commit, chained on master.
    verify: (built) => {
      const plan = planPositions(git, built.map((b) => b.ticket.member), built.map((b) => b.position.head));
      const base = built[0]!.position.prev;
      if (plan.base !== base) throw new Error(`the chain starts on ${plan.base}, not ${base}`);
      plan.positions.forEach((q, i) => {
        const b = built[i]!.position;
        if (q.prev !== b.prev || q.merge !== b.merge || q.tip !== b.tip) throw new Error(`position ${i + 1} (#${built[i]!.entry.pr}) is not the merge it was built as`);
      });
    },
    prove: (p, e) => (write(false, null, e), proveTree(p, e)),
    proveMaster: (m) => (write(false, null, null), proveMaster(m)),
    publish: (e, p, t) => (write(false, null, e), publish(e, p, t)),
    onFail: reportFailure,
    stopRequested: () => {
      if (!existsSync(STOP_FILE)) return false;
      rmSync(STOP_FILE, { force: true });
      return true;
    },
    onOutcome: (o) => {
      latest = o;
      write(false, null);
    },
    log,
  });
  current = null;
  writeFileSync(STATUS, statusText({ queue: args.queue, startedAt, now: stamp(), running: null, outcomes: latest, fatal: result.fatal, total: entries.length, done: true, stopped: result.stopped }));
  try {
    resetWorktree(fetchMaster());
  } catch {}
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
const supervisor = async (): Promise<number> => {
  const args = parseLandArgs(process.argv.slice(2));
  const driver = { command: process.execPath, args: [...process.execArgv, process.argv[1]!, ...process.argv.slice(2)], env, graceMs: 20_000, onStop: requestStop, log };
  if (args.dryRun) return (await supervise(driver)).code;
  lock();
  try {
    if (existsSync(STOP_FILE)) {
      rmSync(STOP_FILE, { force: true });
      log(`removed ${STOP_FILE}, left from before this run`);
    }
    log(`land supervisor pid ${process.pid}: kill -TERM ${process.pid} interrupts; kill -USR1 ${process.pid} or touch ${STOP_FILE} stops after the current batch`);
    const r = await supervise(driver);
    if (r.interrupted !== null) {
      releaseQuiet(QUIET_FILE, r.pid);
      try {
        if (readFileSync(PRIORITY, 'utf8').trim() === String(r.pid)) rmSync(PRIORITY, { force: true });
      } catch {}
      try {
        MAIN = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
        if (existsSync(WT)) resetWorktree(text(wtGit, ['rev-parse', 'HEAD']));
      } catch (error) {
        log(`could not reset the driver worktree ${WT}: ${errorText(error).split('\n')[0]}`);
      }
      let previous = '';
      try {
        previous = readFileSync(STATUS, 'utf8');
      } catch {}
      writeFileSync(STATUS, interruptedStatus(previous, r.interrupted, stamp()));
      log(readFileSync(STATUS, 'utf8').trimEnd());
    }
    return r.code;
  } finally {
    unlock();
  }
};

try {
  process.exitCode = env[SUPERVISED_ENV] === '1' ? main() : await supervisor();
} catch (error) {
  console.error(`\nland stopped: ${msg(error)}`);
  process.exitCode = 2;
}
