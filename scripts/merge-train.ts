// Merge train (Judge T-LANDING-TRAIN, Option B): builds positions train/1..N on one fixed origin/master, predicts each
// position's vouch locally, and lands them one PR at a time. Run in a clean, installed worktree of this repo.
// Run with: pnpm train <build|check|land> [--from <k>] <branch>:<pr>:<clean-head-sha>...
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  commitRegen,
  isAncestor,
  type Member,
  mergeMember,
  parseArgs,
  parseLsRemote,
  parsePrState,
  planPositions,
  type Position,
  predictPosition,
  prProblems,
  type PrState,
  treeMatches,
} from './merge-train-lib.ts';
import { checkSha, type Git, ignoreAt, regenOnlyProblems } from './pr-review-vouch.ts';

const HEAVY = '/tmp/heavy-lease.sh';
const DEVICE = '/tmp/device-lease.sh';
const REGEN = ['pnpm', 'regen'];
const DEVICES = ['pnpm', 'run', 'parity:devices'];

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

// The clean heads must be the PR branches' current heads, so the pushes later are fast-forwards of reviewed commits.
const fetchMembers = (members: Member[]): void => {
  for (const m of members) {
    const at = remoteHead(m.branch);
    if (at !== m.clean) stop(`origin/${m.branch} is at ${at}, not the recorded clean head ${m.clean}`);
    git(['fetch', '--quiet', 'origin', `refs/heads/${m.branch}`]);
  }
};

const build = (members: Member[], from: number): void => {
  requireClean();
  requireLeases();
  const master = fetchMaster();
  fetchMembers(members);
  const reused = from > 1 ? planPositions(git, members, trainHeads(from - 1)) : null;
  if (reused && !isAncestor(git, reused.base, master)) stop(`train/1's base ${reused.base} is not in origin/master; rebuild from 1`);
  let prev = reused ? reused.positions.at(-1)!.head : master;
  console.log(`Train base ${reused ? reused.base : master}${reused ? ` (reusing positions 1..${from - 1})` : ' (origin/master)'}`);
  const branch = gitText(['rev-parse', '--abbrev-ref', 'HEAD']);
  const start = branch === 'HEAD' ? gitText(['rev-parse', 'HEAD']) : branch;
  let k = from;
  try {
    for (; k <= members.length; k++) prev = buildPosition(members, k, prev);
  } catch (error) {
    const at = gitText(['rev-parse', 'HEAD']);
    throw new Stop(`position ${k}: ${error instanceof Error ? error.message : String(error)}\n(worktree left detached at ${at} for inspection; it was on ${start})`);
  }
  git(['checkout', '-q', start]);
  console.log(`\nBuilt train/1..${members.length}. Next: pnpm train check ${members.map((m) => `${m.branch}:${m.pr}:${m.clean}`).join(' ')}`);
};

const buildPosition = (members: Member[], k: number, prev: string): string => {
  const m = members[k - 1]!;
  console.log(`\n=== Position ${k}: ${m.branch} (#${m.pr}) at ${m.clean}`);
  mergeMember(git, prev, m, k);
  run([HEAVY, ...REGEN]);
  run(['pnpm', 'typecheck']);
  run([DEVICE, ...DEVICES]);
  const head = commitRegen(git, k, m, [REGEN.join(' '), DEVICES.join(' ')]);
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
    const problems = prProblems(pr, m, head, remoteHead(m.branch));
    if (problems.length > 0) stop(problems.join('\n'));
    // A plain push: git refuses anything but a fast-forward of the clean head.
    if (pr.headOid !== head) run(['git', 'push', 'origin', `${head}:refs/heads/${m.branch}`]);
    run(['pnpm', '-s', 'pr:review', String(m.pr), '--wait']);
    const reviewed = prState(m);
    if (reviewed.headOid !== head) stop(`PR #${m.pr} head moved to ${reviewed.headOid} during review`);
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
