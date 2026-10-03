// Merge train (Judge T-LANDING-TRAIN, Option B): builds positions train/1..N on one fixed origin/master, predicts each
// position's vouch locally, and lands them one PR at a time. Run in a clean, installed worktree of this repo.
// Run with: pnpm train <build|check|land> [--from <k>] <branch>:<pr>:<clean-head-sha>...
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  commitRegen,
  deviceRunProblems,
  failuresJson,
  isAncestor,
  LANES_JSON,
  type Member,
  mergeGate,
  memberTip,
  mergeMember,
  parseArgs,
  POSITION_STEPS,
  parseDeviceEvidence,
  parseLsRemote,
  parsePrState,
  planPositions,
  type Position,
  predictPosition,
  prProblems,
  type PrState,
  staleLines,
  treeMatches,
} from './merge-train-lib.ts';
import { checkSha, type Git, ignoreAt, regenOnlyProblems } from './pr-review-vouch.ts';

const HEAVY = '/tmp/heavy-lease.sh';
const DEVICE = '/tmp/device-lease.sh';
const REGEN = ['pnpm', 'regen'];
const DEVICES = ['pnpm', 'run', 'parity:devices'];
const LANES = ['pnpm', '-s', 'run', 'parity:lanes'];

class Stop extends Error {}
const stop = (why: string): never => {
  throw new Stop(why);
};

const git: Git = (args, input) => execFileSync('git', args, { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
const gitText = (args: string[]): string => git(args).toString('utf8').trim();
const gh = (args: string[]): string => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
// Long steps stream their output; any non-zero exit or signal stops the train.
const run = (argv: string[]): void => {
  console.log(`\n$ ${argv.join(' ')}`);
  const r = spawnSync(argv[0]!, argv.slice(1), { stdio: 'inherit' });
  if (r.error) stop(`${argv.join(' ')}: ${r.error.message}`);
  if (r.status !== 0) stop(`${argv.join(' ')} exited ${r.status ?? r.signal}`);
};

const fetchMaster = (): string => {
  git(['fetch', '--quiet', 'origin', '+refs/heads/master:refs/remotes/origin/master']);
  return checkSha(gitText(['rev-parse', '--verify', 'refs/remotes/origin/master^{commit}']), 'origin/master');
};
const remoteHead = (branch: string): string => parseLsRemote(gitText(['ls-remote', 'origin', `refs/heads/${branch}`]), `refs/heads/${branch}`);
const trainRef = (k: number): string => `refs/heads/train/${k}`;
const trainHeads = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => {
    try {
      return checkSha(gitText(['rev-parse', '--verify', '--quiet', `${trainRef(i + 1)}^{commit}`]), `train/${i + 1}`);
    } catch {
      return stop(`train/${i + 1} does not exist; run build first`);
    }
  });
const prState = (m: Member): PrState =>
  parsePrState(JSON.parse(gh(['pr', 'view', String(m.pr), '--json', 'number,state,headRefName,headRefOid,baseRefName,isCrossRepository'])));

const requireClean = (): void => {
  const dirty = gitText(['status', '--porcelain=v1', '--untracked-files=all']);
  if (dirty !== '') stop(`the worktree is not clean:\n${dirty}`);
};
const requireTracked = (what: string): void => {
  const dirty = gitText(['status', '--porcelain=v1', '--untracked-files=no']);
  if (dirty !== '') stop(`${what} changed tracked files:\n${dirty}`);
};
const requireLeases = (): void => {
  for (const lease of [HEAVY, DEVICE]) if (!existsSync(lease)) stop(`${lease} is missing; heavy and device steps run only under the machine leases`);
};

// Each PR branch must be at its clean head, or at a position an earlier build of the train pushed on top of it (memberTip);
// the new position merges that head, so the push at landing is a fast-forward.
const fetchMembers = (members: Member[]): string[] =>
  members.map((m) => {
    const at = remoteHead(m.branch);
    git(['fetch', '--quiet', 'origin', `refs/heads/${m.branch}`]);
    try {
      return memberTip(git, m, at);
    } catch (error) {
      return stop(`origin/${m.branch} is at ${at}, not at the recorded clean head ${m.clean}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

// The device run is judged on what it recorded, against the device evidence committed on the train's base.
const judgeDevices = (base: string): void => {
  const show = (path: string): unknown => JSON.parse(git(['show', `${base}:${path}`]).toString('utf8'));
  const local = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
  const before = parseDeviceEvidence(show(LANES_JSON), (t) => show(failuresJson(t)), `base ${base}`);
  const after = parseDeviceEvidence(local(LANES_JSON), (t) => local(failuresJson(t)), 'this run');
  if (git(['status', '--porcelain=v1', '--', LANES_JSON]).toString('utf8').trim() === '') stop(`the device run did not rewrite ${LANES_JSON}`);
  const lanes = spawnSync(LANES[0]!, LANES.slice(1), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // It exits 1 for master's failing lanes too; anything else, or no verdict line, means it did not judge the file.
  if (lanes.error || lanes.signal || (lanes.status !== 0 && lanes.status !== 1) || !/^parity:lanes: /m.test(lanes.stdout)) {
    stop(`${LANES.join(' ')} did not judge the committed lanes: ${lanes.error?.message ?? lanes.signal ?? `exit ${lanes.status}`}\n${lanes.stderr}`);
  }
  const problems = deviceRunProblems(before, after, staleLines(lanes.stdout));
  if (problems.length > 0) stop(`the device run differs from the device evidence on ${base}:\n  ${problems.join('\n  ')}`);
  console.log(`Device run: every lane passes or fails as on ${base}, with no failure it does not list`);
};

const build = (members: Member[], from: number): void => {
  requireClean();
  requireLeases();
  const master = fetchMaster();
  const tips = fetchMembers(members);
  const reused = from > 1 ? planPositions(git, members, trainHeads(from - 1)) : null;
  if (reused && !isAncestor(git, reused.base, master)) stop(`train/1's base ${reused.base} is not in origin/master; rebuild from 1`);
  let prev = reused ? reused.positions.at(-1)!.head : master;
  console.log(`Train base ${reused ? reused.base : master}${reused ? ` (reusing positions 1..${from - 1})` : ' (origin/master)'}`);
  const branch = gitText(['rev-parse', '--abbrev-ref', 'HEAD']);
  const start = branch === 'HEAD' ? gitText(['rev-parse', 'HEAD']) : branch;
  let k = from;
  try {
    const base = reused ? reused.base : master;
    for (; k <= members.length; k++) prev = buildPosition(members, k, prev, tips[k - 1]!, base);
  } catch (error) {
    const at = gitText(['rev-parse', 'HEAD']);
    throw new Stop(`position ${k}: ${error instanceof Error ? error.message : String(error)}\n(worktree left detached at ${at} for inspection; it was on ${start})`);
  }
  git(['checkout', '-q', start]);
  console.log(`\nBuilt train/1..${members.length}. Next: pnpm train check ${members.map((m) => `${m.branch}:${m.pr}:${m.clean}`).join(' ')}`);
};

const buildPosition = (members: Member[], k: number, prev: string, tip: string, base: string): string => {
  const m = members[k - 1]!;
  console.log(`\n=== Position ${k}: ${m.branch} (#${m.pr}) at ${tip}${tip === m.clean ? '' : ` (an earlier position on clean head ${m.clean})`}`);
  mergeMember(git, prev, m, k, tip);
  for (const step of POSITION_STEPS) {
    if (step === 'regen' || step === 'regen-after-devices') run([HEAVY, ...REGEN]);
    else if (step === 'typecheck') run(['pnpm', 'typecheck']);
    else if (step === 'judge-devices') judgeDevices(base);
    else {
      // master's own lanes fail (device-pixels lists its failures), so the exit code says nothing; judge-devices decides.
      const device = spawnSync(DEVICE, DEVICES, { stdio: 'inherit' });
      if (device.error || device.signal || (device.status !== 0 && device.status !== 1)) stop(`${DEVICES.join(' ')}: ${device.error?.message ?? device.signal ?? `exit ${device.status}`}`);
    }
  }
  const head = commitRegen(git, k, m, [REGEN.join(' '), DEVICES.join(' '), REGEN.join(' ')]);
  const ignore = ignoreAt(git, head);
  if ('error' in ignore) return stop(ignore.error);
  const problems = regenOnlyProblems(git, head, ignore);
  if (problems.length > 0) stop(`position ${k}'s regen commit ${head} is not regen-only:\n  ${problems.join('\n  ')}`);
  run([HEAVY, 'pnpm', 'test']);
  requireTracked('pnpm test');
  git(['update-ref', trainRef(k), head]);
  console.log(`train/${k} = ${head}`);
  return head;
};

const predictAll = (members: Member[], from: number): { positions: Position[]; base: string } => {
  const plan = planPositions(git, members, trainHeads(members.length));
  let ok = true;
  plan.positions.forEach((p, i) => {
    if (i + 1 < from) return;
    const m = members[i]!;
    const v = predictPosition(git, m, p);
    ok &&= v.ok;
    console.log(`position ${i + 1} ${p.head} (${m.branch} #${m.pr}): ${v.ok ? 'will be vouched' : 'will NOT be vouched'}`);
    console.log(`  ${v.vouch.ok ? `same patch id as clean head ${m.clean} (${v.vouch.patchId}) over reviewed paths` : v.vouch.reason}`);
    for (const p of v.regenProblems) console.log(`  regen: ${p}`);
  });
  if (!ok) stop('a position will not be vouched; fix it and rebuild from there');
  return plan;
};

// The master side of "PR k-1 merged": the previous position is in master, and master's tree equals it outside the board.
const requireMasterAt = (prev: string, what: string): string => {
  const master = fetchMaster();
  if (!isAncestor(git, prev, master)) stop(`${what} ${prev} is not in origin/master ${master}`);
  const same = treeMatches(git, master, prev);
  if (!same.ok) stop(`origin/master ${master} differs from ${what} ${prev} outside docs/goals/**: ${same.paths.slice(0, 20).join(', ')}`);
  return master;
};

const land = (members: Member[], from: number): void => {
  fetchMaster();
  const plan = predictAll(members, from);
  for (let k = from; k <= members.length; k++) {
    const m = members[k - 1]!;
    const { prev, head } = plan.positions[k - 1]!;
    console.log(`\n=== Landing position ${k}: ${m.branch} (#${m.pr}) as ${head}`);
    if (k > 1) {
      const before = prState(members[k - 2]!);
      if (before.state !== 'MERGED') stop(`PR #${before.number} (position ${k - 1}) is ${before.state}, not MERGED`);
    }
    requireMasterAt(prev, k === 1 ? 'the train base' : `position ${k - 1}`);
    const pr = prState(m);
    const problems = prProblems(pr, m, head, remoteHead(m.branch), plan.positions[k - 1]!.tip);
    if (problems.length > 0) stop(problems.join('\n'));
    // A plain push: git refuses anything but a fast-forward of the PR head (the clean head or an earlier build's position).
    if (pr.headOid !== head) run(['git', 'push', 'origin', `${head}:refs/heads/${m.branch}`]);
    run(['pnpm', '-s', 'pr:review', String(m.pr), '--wait']);
    // Re-read right before merging: the PR may have been retargeted or master moved during the review wait.
    const gate = mergeGate(git, prState(m), m, plan.positions[k - 1]!, fetchMaster());
    if (gate.length > 0) stop(`not merging PR #${m.pr}:\n${gate.join('\n')}`);
    const merge = spawnSync('gh', ['pr', 'merge', String(m.pr), '--merge', '--delete-branch', '--match-head-commit', head], { stdio: 'inherit' });
    const merged = prState(m).state === 'MERGED';
    if (!merged) stop(`gh pr merge #${m.pr} exited ${merge.status ?? merge.signal} and the PR is not merged`);
    const master = requireMasterAt(head, `position ${k}`);
    console.log(`PR #${m.pr} merged; origin/master ${master} has position ${k}'s tree outside docs/goals/**`);
    if (merge.status !== 0) {
      stop(`gh pr merge #${m.pr} merged but exited ${merge.status ?? merge.signal}; master is valid${k < members.length ? `. Resume with land --from ${k + 1}` : ''}`);
    }
  }
  console.log(`\nTrain landed: ${members.map((m) => `#${m.pr}`).join(', ')}`);
};

try {
  const { command, from, members } = parseArgs(process.argv.slice(2));
  if (command === 'build') build(members, from);
  else if (command === 'check') predictAll(members, 1);
  else land(members, from);
} catch (error) {
  console.error(`\nmerge-train stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
