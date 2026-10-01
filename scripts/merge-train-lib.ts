// The checked parts of merge-train.ts: member and gh input checks, position structure, the local vouch prediction and the tree check.
import {
  ALREADY_REVIEWED,
  CORRECTNESS,
  checkSha,
  type Git,
  ignoreAt,
  patchIdOver,
  rawDiff,
  regenOnlyProblems,
  type Vouch,
  vouchForSkip,
} from './pr-review-vouch.ts';

export const MAX_MEMBERS = 5;
export const BOARD = 'docs/goals/';

export type Member = { branch: string; pr: number; clean: string };
// A position: `merge` has parents [prev, member.clean]; `head` is the regen commit on top of it.
export type Position = { prev: string; merge: string; head: string };
export type Plan = { base: string; positions: Position[] };

const fail = (what: string): never => {
  throw new Error(`merge-train: ${what}`);
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (out: Buffer): string => new TextDecoder('utf-8', { fatal: true }).decode(out);

// A branch name as `git check-ref-format --branch` would take it, minus anything that needs quoting or names a ref range.
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock(?:\/|$))(?!.*\/\.)(?!\.)[A-Za-z0-9._\/-]+(?<![./])$/;

export const parseMember = (spec: string): Member => {
  const parts = spec.split(':');
  if (parts.length !== 3) return fail(`member ${JSON.stringify(spec)} is not <branch>:<pr>:<clean-head-sha>`);
  const [branch, pr, clean] = parts as [string, string, string];
  if (!BRANCH.test(branch) || branch === 'master' || branch.startsWith('train/')) return fail(`member ${JSON.stringify(spec)}: bad branch name`);
  if (!/^[1-9]\d{0,8}$/.test(pr)) return fail(`member ${JSON.stringify(spec)}: bad PR number`);
  if (!/^[0-9a-f]{40}$/.test(clean)) return fail(`member ${JSON.stringify(spec)}: clean head must be a full 40-hex sha`);
  return { branch, pr: Number(pr), clean };
};

export const parseMembers = (specs: string[]): Member[] => {
  if (specs.length === 0) return fail('no members given');
  if (specs.length > MAX_MEMBERS) return fail(`${specs.length} members; a train has at most ${MAX_MEMBERS}`);
  const members = specs.map(parseMember);
  for (const key of ['branch', 'pr', 'clean'] as const) {
    if (new Set(members.map((m) => m[key])).size !== members.length) fail(`two members share a ${key}`);
  }
  return members;
};

export type Args = { command: 'build' | 'check' | 'land'; from: number; members: Member[] };
export const USAGE = `usage: pnpm train <build|check|land> [--from <k>] <branch>:<pr>:<clean-head-sha>...
  build  merge each member onto the previous position (position 0 is origin/master), run pnpm regen, pnpm typecheck,
         the device lanes and pnpm test, and point train/<k> at the result; --from k reuses train/1..k-1
  check  predict, without pushing, whether pr:review will vouch for each position (exit 1 if any will not)
  land   push position k to its PR branch (fast-forward) once PR k-1 has merged, run pr:review --wait, merge with
         --match-head-commit, and check master's tree equals the position's outside ${BOARD}**; --from k resumes`;

export const parseArgs = (argv: string[]): Args => {
  const [command, ...rest] = argv;
  if (command !== 'build' && command !== 'check' && command !== 'land') return fail(`unknown command ${JSON.stringify(command)}\n${USAGE}`);
  let from = 1;
  const specs: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--from') {
      const v = rest[++i];
      if (command === 'check' || v === undefined || !/^[1-9]\d*$/.test(v)) return fail(`--from needs a position number and build or land\n${USAGE}`);
      from = Number(v);
    } else if (a.startsWith('-')) return fail(`unknown option ${JSON.stringify(a)}\n${USAGE}`);
    else specs.push(a);
  }
  const members = parseMembers(specs);
  if (from > members.length) return fail(`--from ${from} is past the last of ${members.length} members`);
  return { command, from, members };
};

// `git merge-base --is-ancestor` exits 1 for "no"; any other failure is an error, never a "no".
export const isAncestor = (git: Git, a: string, b: string): boolean => {
  try {
    git(['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch (error) {
    if ((error as { status?: unknown }).status === 1) return false;
    throw error;
  }
};

export const parentsOf = (git: Git, commit: string): string[] => {
  const [self, ...parents] = text(git(['rev-list', '--parents', '-n', '1', commit])).trim().split(' ');
  checkSha(self, `rev-list of ${commit}`);
  return parents.map((p) => checkSha(p, `parent of ${commit}`));
};

// Checks built positions (train/1..n, as shas) against the members, in order. Each member's clean head must be an ancestor
// of its position, and each position must be exactly: a merge of [previous position, clean head], then one regen commit.
export const planPositions = (git: Git, members: Member[], heads: string[]): Plan => {
  if (heads.length === 0 || heads.length > members.length) return fail(`${heads.length} positions for ${members.length} members`);
  const positions: Position[] = [];
  let base = '';
  heads.forEach((h, i) => {
    const k = i + 1;
    const m = members[i]!;
    const head = checkSha(h, `train/${k}`);
    if (!isAncestor(git, m.clean, head)) fail(`member ${k} (${m.branch}): clean head ${m.clean} is not an ancestor of position ${k} (${head})`);
    const headParents = parentsOf(git, head);
    if (headParents.length !== 1) fail(`position ${k} (${head}) has ${headParents.length} parents; its regen commit has exactly one`);
    const merge = headParents[0]!;
    const mergeParents = parentsOf(git, merge);
    if (mergeParents.length !== 2 || mergeParents[1] !== m.clean) {
      fail(`position ${k}: ${merge} is not a merge of the previous position and ${m.branch}'s clean head ${m.clean}`);
    }
    const prev = mergeParents[0]!;
    if (k === 1) base = prev;
    else if (prev !== positions[i - 1]!.head) fail(`position ${k} is not built on position ${k - 1} (${positions[i - 1]!.head})`);
    positions.push({ prev, merge, head });
  });
  return { base, positions };
};

// What pr:review will decide for position k once it is PR k's head and position k-1 is in master: Macroscope's "already
// reviewed" skip is vouched for only if the position and the clean head have one patch id over reviewed paths. It assumes
// the clean head passed its correctness review; land confirms that with pr:review.
export type Prediction = { ok: boolean; vouch: Vouch; regenProblems: string[] };
export const predictPosition = (git: Git, member: Member, position: Position): Prediction => {
  const ignore = ignoreAt(git, position.head);
  if ('error' in ignore) return { ok: false, vouch: { ok: false, reason: ignore.error }, regenProblems: [] };
  const regenProblems = regenOnlyProblems(git, position.head, ignore);
  const skip = { name: CORRECTNESS, status: 'completed', conclusion: 'skipped', html_url: '', output: { title: ALREADY_REVIEWED } };
  const reviewed = [{ name: CORRECTNESS, status: 'completed', conclusion: 'success', html_url: '' }];
  const head = patchIdOver(git, position.head, position.prev, 'reviewed paths', ignore);
  const clean = patchIdOver(git, member.clean, position.prev, 'reviewed paths', ignore);
  const vouch = vouchForSkip(skip, head, [{ sha: member.clean, runs: reviewed, patchId: clean }]);
  return { ok: vouch.ok && regenProblems.length === 0, vouch, regenProblems };
};

// Two commits have the same tree apart from the board (docs/goals/**), which PM board updates change straight on master.
export const treeMatches = (git: Git, a: string, b: string): { ok: true } | { ok: false; paths: string[] } => {
  const paths = rawDiff(git, a, b)
    .map((e) => e.path)
    .filter((p) => !p.startsWith(BOARD));
  return paths.length === 0 ? { ok: true } : { ok: false, paths };
};

// `gh pr view <n> --json number,state,headRefName,headRefOid,baseRefName,isCrossRepository`.
export type PrState = { number: number; state: string; head: string; headOid: string; base: string; cross: boolean };
export const parsePrState = (v: unknown): PrState => {
  if (!isObject(v)) return fail(`unexpected gh pr view output: ${JSON.stringify(v)?.slice(0, 300)}`);
  const { number, state, headRefName, headRefOid, baseRefName, isCrossRepository } = v;
  if (typeof number !== 'number' || typeof state !== 'string' || typeof headRefName !== 'string' || typeof baseRefName !== 'string' || typeof isCrossRepository !== 'boolean') {
    return fail(`unexpected gh pr view output: ${JSON.stringify(v).slice(0, 300)}`);
  }
  return { number, state, head: headRefName, headOid: checkSha(headRefOid, 'PR headRefOid'), base: baseRefName, cross: isCrossRepository };
};

// Why PR k may not take position k now: wrong PR, wrong branch, or a head that is neither the clean head nor the position.
export const prProblems = (pr: PrState, member: Member, head: string, remoteHead: string): string[] => {
  const problems: string[] = [];
  if (pr.number !== member.pr) problems.push(`gh returned PR #${pr.number}, not #${member.pr}`);
  if (pr.state !== 'OPEN') problems.push(`PR #${member.pr} is ${pr.state}, not OPEN`);
  if (pr.head !== member.branch) problems.push(`PR #${member.pr} is from ${pr.head}, not ${member.branch}`);
  if (pr.base !== 'master') problems.push(`PR #${member.pr} targets ${pr.base}, not master`);
  if (pr.cross) problems.push(`PR #${member.pr} comes from a fork`);
  if (pr.headOid !== member.clean && pr.headOid !== head) problems.push(`PR #${member.pr} head ${pr.headOid} is neither the clean head ${member.clean} nor position ${head}`);
  if (remoteHead !== pr.headOid) problems.push(`origin/${member.branch} is at ${remoteHead}, but PR #${member.pr} reports ${pr.headOid}`);
  return problems;
};

// `git ls-remote origin refs/heads/<branch>`: exactly one "<sha>\t<ref>" line.
export const parseLsRemote = (out: string, ref: string): string => {
  const lines = out.split('\n').filter((l) => l !== '');
  const [oid, name] = lines.length === 1 ? lines[0]!.split('\t') : [];
  if (name !== ref) return fail(`git ls-remote for ${ref} printed ${JSON.stringify(out.slice(0, 300))}`);
  return checkSha(oid, `ls-remote ${ref}`);
};

// Merges the member's clean head onto `prev` with a merge commit, in a clean worktree. A conflict aborts the merge and throws.
export const mergeMember = (git: Git, prev: string, member: Member, k: number): string => {
  git(['checkout', '-q', '--detach', prev]);
  try {
    git(['-c', 'rerere.enabled=false', 'merge', '-q', '--no-ff', '--no-edit', '-m', `Train position ${k}: merge ${member.branch} (#${member.pr})`, member.clean]);
  } catch (error) {
    const conflicted = text(git(['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter((p) => p !== '');
    let merging = true;
    try {
      git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    } catch {
      merging = false;
    }
    if (merging) git(['merge', '--abort']);
    return fail(`merging ${member.branch} onto ${prev} failed${conflicted.length ? `; conflicts in ${conflicted.join(', ')}` : `: ${(error as Error).message}`}`);
  }
  return checkSha(text(git(['rev-parse', 'HEAD'])).trim(), 'merge commit');
};

// Commits everything the regen and device steps left in the worktree, as one commit that names the commands.
export const commitRegen = (git: Git, k: number, member: Member, commands: string[]): string => {
  git(['add', '-A']);
  git(['commit', '-q', '--allow-empty', '-m', `Train position ${k}: regenerate after merging ${member.branch} (#${member.pr})\n\nCommands: ${commands.join('; ')}`]);
  return checkSha(text(git(['rev-parse', 'HEAD'])).trim(), 'regen commit');
};
