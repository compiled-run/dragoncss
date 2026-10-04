// Continuous landing driver (owner decision 2026-10-03, process review): lands a queue of reviewed PRs one at a time, each on the
// current origin/master with its own regen, device evidence (the device run is skipped only when the tree's evidence stamp equals
// master's), typecheck, test, CI, pr:review, a Claude correctness review while Macroscope is at its limit, and a merge pinned
// with --match-head-commit. A PR that fails a step gets the landing-failed label and a comment, and the queue continues.
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
  isQuiet,
  isTransient,
  isUnreviewed,
  LandFailure,
  type Outcome,
  parseLandArgs,
  parseQueue,
  RETRIES,
  backoffMs,
  type ReviewRecord,
  runQueue,
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
const waitCi = (step: string, sha: string, what: string, conflicting?: () => boolean): void => {
  const t0 = Date.now();
  for (;;) {
    const s = ciState(checkRuns(sha));
    const next = ciStep(s, (Date.now() - t0) / 1000, { appearS: CI_APPEAR_S, waitS: CI_WAIT_S }, s.state === 'none' && conflicting !== undefined && conflicting());
    if (next === 'success') return log(`  CI checks success on ${what} ${sha}`);
    if (next === 'skip') return log(`  ${what} ${sha} is CONFLICTING with master and has no CI run (GitHub runs none on a conflicting PR); building anyway, CI on the landing commit is still required`);
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
const waitQuiet = (): void => {
  while (!isQuiet(otherHeavyHolders(), loadavg()[0]!)) sleep(30_000);
};

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

const resetWorktree = (master: string): void => {
  try {
    wtGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    wtGit(['merge', '--abort']);
  } catch {}
  wtGit(['checkout', '-q', '-f', '--detach', master]);
  wtGit(['clean', '-q', '-fd']);
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
    const r = spawnSync('gh', ['pr', 'merge', String(pr), '--repo', REPO, '--merge', '--delete-branch', '--match-head-commit', head], { encoding: 'utf8' });
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

// ---- one PR ----------------------------------------------------------------------------------------------------------
const landOne = (e: Entry): { result: 'landed' | 'merged before'; detail: string } => {
  current = e;
  const t0 = Date.now();
  log(`=== #${e.pr} ${e.branch} (clean head ${e.clean})`);
  let pr = prView(e.pr);
  if (pr.state === 'MERGED') return { result: 'merged before', detail: `merged as ${pr.mergeCommit ?? '?'}` };
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

  // The base: retarget a review/* copy or a landed parent to master.
  if (pr.base !== 'master') {
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
  waitCi('ci-before', pr.headOid, `#${e.pr} head`, () => parsePrHead(JSON.parse(gh(['pr', 'view', String(e.pr), '--repo', REPO, '--json', 'headRefOid,mergeable']))).mergeable === 'CONFLICTING');

  // Build: merge into master, regen, device evidence, regen, commit, test.
  const master = fetchMaster();
  resetWorktree(master);
  try {
    mergeMember(wtGit, master, member, 1, tip, 'Land');
  } catch (error) {
    throw new LandFailure('merge', msg(error));
  }
  const merge = text(wtGit, ['rev-parse', 'HEAD']);
  must('install', ['pnpm', 'install', '--frozen-lockfile'], WT);
  seedRegenCache(e, [clean, pr.headOid]);
  holdPriority();
  let device = 'skipped: the evidence stamp equals master\'s';
  const commands = [REGEN.join(' ')];
  try {
    let r = heavy('regen', REGEN);
    if (r.error !== undefined || r.status !== 0) failed('regen', r, 'pnpm regen');
    must('typecheck', ['pnpm', 'typecheck'], WT);
    r = run('stamp', ['pnpm', '-s', 'evidence:stamp', '--compare', master], WT);
    if (r.error !== undefined || (r.status !== 0 && r.status !== 1)) failed('stamp', r, 'pnpm evidence:stamp');
    let runDevices = r.status === 1;
    if (!runDevices) {
      // Equal stamps: the regen carried master's device records; they must judge exactly as master's.
      const problems = judgeDevices(master, null);
      if (problems.length > 0) {
        log(`  the stamp equals master's, but the carried device records differ; running the device lanes:\n    ${problems.join('\n    ')}`);
        runDevices = true;
      }
    }
    if (runDevices) {
      const started = Date.now();
      const d = run('devices', [DEVICE, ...DEVICES], WT);
      // master's device-pixels lane fails on purpose, so the exit code says nothing; the judgement against master decides.
      if (d.error !== undefined || d.signal !== null || (d.status !== 0 && d.status !== 1)) failed('devices', d, DEVICES.join(' '));
      const problems = judgeDevices(master, started);
      if (problems.length > 0) throw new LandFailure('judge-devices', `the device run differs from master's device evidence:\n  ${problems.join('\n  ')}`);
      r = heavy('regen-after-devices', REGEN);
      if (r.error !== undefined || r.status !== 0) failed('regen-after-devices', r, 'pnpm regen');
      commands.push(DEVICES.join(' '), REGEN.join(' '));
      device = 'ran; every lane passes or fails as on master';
    }
    log(`  device lanes: ${device}`);
    const head = commitRegen(wtGit, 1, member, commands, 'Land');
    const ignore = ignoreAt(wtGit, head);
    if ('error' in ignore) throw new LandFailure('regen-only', ignore.error);
    const regenProblems = regenOnlyProblems(wtGit, head, ignore);
    if (regenProblems.length > 0) throw new LandFailure('regen-only', `the regen commit ${head} is not regen-only:\n  ${regenProblems.join('\n  ')}`);
    const prediction = predictPosition(wtGit, member, { prev: master, merge, head, tip });
    log(`  Macroscope vouch prediction: ${prediction.vouch.ok ? 'an "already reviewed" skip will be vouched for' : `not vouchable (${prediction.vouch.reason}); a full review will run unless at the limit`}`);

    let t = heavy('test', ['pnpm', 'test']);
    if (t.error !== undefined || t.status !== 0) {
      log('  pnpm test failed; waiting for a quiet machine to run it once more');
      waitQuiet();
      t = heavy('test-quiet', ['pnpm', 'test']);
      if (t.error !== undefined || t.status !== 0) failed('test', t, 'pnpm test on a quiet machine');
      log('  pnpm test passed on a quiet machine');
    }
    requireTracked('test', 'pnpm test');
    releasePriority(); // publish waits on CI and review, so other lanes get the machine back
    return publish(e, member, { master, merge, head, tip, clean, prHead: pr.headOid, device, t0 });
  } finally {
    releasePriority();
  }
};

const publish = (
  e: Entry,
  member: Member,
  p: { master: string; merge: string; head: string; tip: string; clean: string; prHead: string; device: string; t0: number },
): { result: 'landed'; detail: string } => {
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

  let claude = 'not needed (Macroscope reviewed)';
  if (isUnreviewed(reviewOut)) {
    log(`  Macroscope is at its spending limit; Claude correctness review of clean head ${p.clean} (${REVIEW_CMD})`);
    const ignore = ignoreAt(git, p.head);
    if ('error' in ignore) throw new LandFailure('claude-review', ignore.error);
    mkdirSync(REVIEW_DIR, { recursive: true });
    const verdict = claudeReviewGate({
      pr: e.pr,
      head: p.head,
      patch: prDiff(e.pr, p.master, p.head),
      ignored: (path) => ignore.file.matches(path),
      command: REVIEW_CMD,
      review: (input) => runReviewer(REVIEW_CMD, input, WT, REVIEW_TIMEOUT_MS, reviewerEnv(e.pr, p.clean)),
      save: (r: ReviewRecord) => writeFileSync(join(REVIEW_DIR, `${e.pr}.json`), `${JSON.stringify(r, null, 2)}\n`),
    });
    const saved = join(REVIEW_DIR, `${e.pr}.json`);
    if (!verdict.pass) throw new LandFailure('claude-review', `${verdict.reason} (review ${saved})`, verdict.findings.length > 0 ? findingsComment(e.pr, p.head, verdict.findings) : undefined);
    claude = `${verdict.note} (review ${saved})`;
    log(`  Claude review passed: ${claude}`);
  }

  // Merge, pinned to the reviewed head, after re-reading the PR and master.
  const gate = mergeGate(git, prView(e.pr), member, { prev: p.master, merge: p.merge, head: p.head, tip: p.tip }, fetchMaster());
  if (gate.length > 0) throw new LandFailure('merge-gate', gate.join('\n'));
  const porcelain = text(git, ['worktree', 'list', '--porcelain']);
  // gh pr merge --delete-branch cannot delete a local branch a worktree has checked out.
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
  return {
    result: 'landed',
    detail: `merged as ${merged} (landing commit ${p.head}); device lanes ${p.device}; device-pixels ${devicePixels(p.head)}; Claude review ${claude}; in ${Math.round((Date.now() - p.t0) / 1000)}s${notes.length ? `; ${notes.join('; ')}` : ''}`,
  };
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
    log(`[dry-run]   merge into origin/master, pnpm regen, typecheck, evidence:stamp --compare (device lanes if it differs), test; push; CI; pr:review; Claude review if UNREVIEWED; merge --match-head-commit`);
  }
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
  lock();
  const cleanup = (): void => {
    releasePriority();
    unlock();
  };
  process.on('exit', cleanup);
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(s, () => {
      cleanup();
      process.exit(130);
    });
  }
  prepareWorktree();
  const startedAt = stamp();
  log(`=== pnpm land ${args.queue}: ${entries.map((e) => `#${e.pr}`).join(' ')} (pid ${process.pid}, worktree ${WT})`);
  let latest: readonly Outcome[] = [];
  const write = (done: boolean, fatal: string | null): void =>
    writeFileSync(STATUS, statusText({ queue: args.queue, startedAt, now: stamp(), running: done ? null : current, outcomes: latest, fatal, total: entries.length, done }));
  const result = runQueue(
    entries,
    (e) => {
      current = e;
      write(false, null);
      return landOne(e);
    },
    reportFailure,
    (o) => {
      latest = o;
      write(false, null);
    },
  );
  current = null;
  write(true, result.fatal);
  try {
    resetWorktree(fetchMaster());
  } catch {}
  log(readFileSync(STATUS, 'utf8').trimEnd());
  return result.exit;
};

try {
  process.exitCode = main();
} catch (error) {
  console.error(`\nland stopped: ${msg(error)}`);
  process.exitCode = 2;
}
