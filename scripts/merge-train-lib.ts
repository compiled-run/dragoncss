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
// A position: `merge` has parents [prev, tip], where tip is the member's clean head or its PR head from an earlier build
// (memberTip); `head` is the regen commit on top of it.
export type Position = { prev: string; merge: string; head: string; tip: string };
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
  build  merge each member's PR head (its clean head, or an earlier build's position on it) onto the previous position
         (position 0 is origin/master), run pnpm regen, pnpm typecheck, the device lanes (judged against origin/master's
         device evidence), pnpm regen again and pnpm test, and point train/<k> at the result; --from k reuses train/1..k-1
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

export const TRAIN_SUBJECT = 'Train position ';
// The landing driver (scripts/land.ts) makes the same merge and regen commits under this subject.
export const LAND_SUBJECT = 'Land: ';
const MAX_BUILDS = 10;

// The commit a member's position merges: its clean head, or a PR head that an earlier build of the train pushed (a position
// of that build), so the new position fast-forwards from it. Every commit between the clean head and that PR head must be one
// the train or the landing driver made (a "Train position" or "Land:" merge or regen commit); anything else is an unreviewed push.
export const tipProblem = (git: Git, member: Member, prHead: string): string | null => {
  checkSha(prHead, `${member.branch} PR head`);
  if (prHead === member.clean) return null;
  if (!isAncestor(git, member.clean, prHead)) return `${member.branch}'s PR head ${prHead} does not contain its clean head ${member.clean}`;
  // Each earlier build added a regen commit on a merge of [its previous position, the member's tip then]; walk that chain down.
  let at = prHead;
  for (let depth = 0; at !== member.clean; depth++) {
    if (depth >= 2 * MAX_BUILDS) return `${member.branch}'s PR head ${prHead} is more than ${MAX_BUILDS} train builds above its clean head`;
    const subject = text(git(['log', '-1', '--format=%s', at])).trim();
    if (!subject.startsWith(TRAIN_SUBJECT) && !subject.startsWith(LAND_SUBJECT)) return `${member.branch}'s PR head ${prHead} holds ${at}, which the train did not make ("${subject.slice(0, 80)}")`;
    const parents = parentsOf(git, at);
    if (parents.length === 1) at = parents[0]!;
    else if (parents.length === 2) at = parents[1]!;
    else return `${at} has ${parents.length} parents`;
  }
  return null;
};
export const memberTip = (git: Git, member: Member, prHead: string): string => {
  const problem = tipProblem(git, member, prHead);
  return problem === null ? prHead : fail(problem);
};

// Checks built positions (train/1..n, as shas) against the members, in order. Each member's clean head must be an ancestor
// of its position, and each position must be exactly: a merge of [previous position, member tip], then one regen commit.
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
    if (mergeParents.length !== 2 || tipProblem(git, m, mergeParents[1]!) !== null) {
      fail(`position ${k}: ${merge} is not a merge of the previous position and ${m.branch}'s clean head ${m.clean}`);
    }
    const tip = mergeParents[1]!;
    const prev = mergeParents[0]!;
    if (k === 1) base = prev;
    else if (prev !== positions[i - 1]!.head) fail(`position ${k} is not built on position ${k - 1} (${positions[i - 1]!.head})`);
    positions.push({ prev, merge, head, tip });
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

// Why PR k may not take position k now: wrong PR, wrong branch, or a head that is neither the clean head, the tip the position
// merged (an earlier build's position) nor the position.
export const prProblems = (pr: PrState, member: Member, head: string, remoteHead: string, tip: string = member.clean): string[] => {
  const problems: string[] = [];
  if (pr.number !== member.pr) problems.push(`gh returned PR #${pr.number}, not #${member.pr}`);
  if (pr.state !== 'OPEN') problems.push(`PR #${member.pr} is ${pr.state}, not OPEN`);
  if (pr.head !== member.branch) problems.push(`PR #${member.pr} is from ${pr.head}, not ${member.branch}`);
  if (pr.base.startsWith('review/')) problems.push(`PR #${member.pr} targets ${pr.base}, not master; retarget it first: gh pr edit ${member.pr} --base master`);
  else if (pr.base !== 'master') problems.push(`PR #${member.pr} targets ${pr.base}, not master`);
  if (pr.cross) problems.push(`PR #${member.pr} comes from a fork`);
  if (pr.headOid !== member.clean && pr.headOid !== tip && pr.headOid !== head) {
    problems.push(`PR #${member.pr} head ${pr.headOid} is neither the clean head ${member.clean}${tip === member.clean ? '' : `, the earlier position ${tip}`} nor position ${head}`);
  }
  if (remoteHead !== pr.headOid) problems.push(`origin/${member.branch} is at ${remoteHead}, but PR #${member.pr} reports ${pr.headOid}`);
  return problems;
};

// Checked immediately before `gh pr merge`, which pins only the PR head: the PR still targets master from the member's branch
// at the position, and master still holds exactly the previous position outside the board.
export const mergeGate = (git: Git, pr: PrState, member: Member, position: Position, master: string): string[] => {
  const problems = prProblems(pr, member, position.head, pr.headOid, position.tip);
  if (pr.headOid !== position.head) problems.push(`PR #${member.pr} head is ${pr.headOid}, not position ${position.head}`);
  if (!isAncestor(git, position.prev, master)) problems.push(`the previous position ${position.prev} is not in master ${master}`);
  else {
    const same = treeMatches(git, master, position.prev);
    if (!same.ok) problems.push(`master ${master} differs from the previous position outside ${BOARD}**: ${same.paths.slice(0, 20).join(', ')}`);
  }
  return problems;
};

// `git ls-remote origin refs/heads/<branch>`: exactly one "<sha>\t<ref>" line.
export const parseLsRemote = (out: string, ref: string): string => {
  const lines = out.split('\n').filter((l) => l !== '');
  const [oid, name] = lines.length === 1 ? lines[0]!.split('\t') : [];
  if (name !== ref) return fail(`git ls-remote for ${ref} printed ${JSON.stringify(out.slice(0, 300))}`);
  return checkSha(oid, `ls-remote ${ref}`);
};

// Merges the member's tip (its clean head, or its PR head from an earlier build; memberTip) onto `prev` with a merge commit, in
// a clean worktree. A conflict aborts the merge and throws. `label` starts the subject (the landing driver passes "Land").
export const mergeMember = (git: Git, prev: string, member: Member, k: number, tip: string = member.clean, label = `${TRAIN_SUBJECT}${k}`): string => {
  git(['checkout', '-q', '--detach', prev]);
  try {
    git(['-c', 'rerere.enabled=false', 'merge', '-q', '--no-ff', '--no-edit', '-m', `${label}: merge ${member.branch} (#${member.pr})`, tip]);
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
  const merge = checkSha(text(git(['rev-parse', 'HEAD'])).trim(), 'merge commit');
  // `merge --no-ff` of a commit already in `prev` succeeds without making a merge commit.
  const parents = parentsOf(git, merge);
  if (parents.length !== 2 || parents[0] !== prev || parents[1] !== tip) {
    return fail(`merging ${member.branch} onto ${prev} made ${merge} with parents [${parents.join(', ')}], not a merge of [${prev}, ${tip}]`);
  }
  return merge;
};

// Commits everything the regen and device steps left in the worktree, as one commit that names the commands.
export const commitRegen = (git: Git, k: number, member: Member, commands: string[], label = `${TRAIN_SUBJECT}${k}`): string => {
  git(['add', '-A']);
  git(['commit', '-q', '--allow-empty', '-m', `${label}: regenerate after merging ${member.branch} (#${member.pr})\n\nCommands: ${commands.join('; ')}`]);
  return checkSha(text(git(['rev-parse', 'HEAD'])).trim(), 'regen commit');
};

// ---------------------------------------------------------------------------------------------------------------------
// The device run of a position, judged against the device evidence committed on the train's base (master), not by the lanes
// command's exit code: master's device-pixels lane fails on purpose (its failures are listed), so every run exits 1.

export const LANES_JSON = 'packages/parity/out/lanes.json';
export const failuresJson = (target: string): string => `packages/parity/out/device-failures-${target}.json`;

/**
 * One DPR set of a device lane's run: the device it ran on, the device model it reported (an Android model names the image's
 * architecture, "Android SDK built for arm64"), the cases it had, the dumps it got and the failures it judged.
 */
export type DeviceSet = { dpr: number; device: string; model: string | null; cases: number; dumps: number; failures: number };
/**
 * One target's lane states, its listed device failures (each as "<lane> <case> <dpr> <node> <kind>") and, per lane with a
 * device run record, the DPR sets it ran.
 */
export type TargetEvidence = { lanes: Map<string, string>; failures: Map<string, Set<string>>; runs: Map<string, DeviceSet[]> };
export type DeviceEvidence = { parityPass: boolean; parityProblems: string[]; targets: Map<string, TargetEvidence> };

export const parseDeviceEvidence = (lanes: unknown, failures: (target: string) => unknown, what: string): DeviceEvidence => {
  const bad = (why: string): never => fail(`${what}: ${why}`);
  if (!isObject(lanes) || !isObject(lanes.parity) || !Array.isArray(lanes.targets)) return bad('lanes.json has no parity or targets');
  const { pass, problems } = lanes.parity;
  if (typeof pass !== 'boolean' || !Array.isArray(problems) || !problems.every((p) => typeof p === 'string')) return bad('lanes.json parity is not { pass, problems }');
  const targets = new Map<string, TargetEvidence>();
  for (const t of lanes.targets) {
    if (!isObject(t) || typeof t.target !== 'string' || !Array.isArray(t.lanes)) return bad('a lanes.json target is not { target, lanes }');
    if (targets.has(t.target)) return bad(`target ${t.target} is listed twice`);
    const states = new Map<string, string>();
    const runs = new Map<string, DeviceSet[]>();
    for (const l of t.lanes) {
      if (!isObject(l) || typeof l.lane !== 'string' || typeof l.state !== 'string') return bad(`a ${t.target} lane is not { lane, state }`);
      if (states.has(l.lane)) return bad(`${t.target} lists lane ${l.lane} twice`);
      states.set(l.lane, l.state);
      if (l.device === undefined || l.device === null) continue;
      if (!isObject(l.device) || !Array.isArray(l.device.sets)) return bad(`${t.target} ${l.lane}: device is not null or { sets }`);
      const sets: DeviceSet[] = [];
      for (const d of l.device.sets) {
        const ok = isObject(d) && typeof d.dpr === 'number' && isObject(d.device) && typeof d.device.name === 'string' && d.device.name !== '';
        const counts = ok && [d.cases, d.dumps, d.failures].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0);
        if (!ok || !counts) return bad(`${t.target} ${l.lane}: a device set is not { dpr, device: { name }, cases, dumps, failures }`);
        const model = (d.device as { model?: unknown }).model;
        if (model !== undefined && typeof model !== 'string') return bad(`${t.target} ${l.lane}: a device set's model is not a string`);
        sets.push({ dpr: d.dpr as number, device: (d.device as { name: string }).name, model: model ?? null, cases: d.cases as number, dumps: d.dumps as number, failures: d.failures as number });
      }
      runs.set(l.lane, sets);
    }
    const list = failures(t.target);
    if (!Array.isArray(list)) return bad(`${failuresJson(t.target)} is not a list`);
    const byLane = new Map<string, Set<string>>();
    for (const f of list) {
      if (!isObject(f) || typeof f.lane !== 'string' || typeof f.case !== 'string' || typeof f.dpr !== 'number' || typeof f.node !== 'string' || typeof f.kind !== 'string') {
        return bad(`${failuresJson(t.target)} has an entry that is not { lane, case, dpr, node, kind }`);
      }
      if (!states.has(f.lane)) return bad(`${failuresJson(t.target)} lists a failure of ${f.lane}, which lanes.json does not have`);
      const own = byLane.get(f.lane) ?? new Set<string>();
      own.add(`${f.lane} ${f.case} ${f.dpr} ${f.node} ${f.kind}`);
      byLane.set(f.lane, own);
    }
    targets.set(t.target, { lanes: states, failures: byLane, runs });
  }
  return { parityPass: pass, parityProblems: problems as string[], targets };
};

/** The architecture a device model names: the image ABI of an Android model, else the model itself (an iOS simulator). */
export const archOf = (model: string): string => /built for (\S+)/.exec(model)?.[1] ?? model;

/**
 * Architecture binding (PM ruling on #132): every DPR set of a lane must have run on the device model, so the architecture, of
 * master's record for that set. A run on another model would replace master's evidence with another architecture's, against
 * which later landings on the first are judged; that is only an explicit rebaseline. Returns the lanes whose model changed.
 */
export const modelChanges = (base: TargetEvidence, run: TargetEvidence, target: string): { lane: string; detail: string }[] => {
  const out: { lane: string; detail: string }[] = [];
  for (const [lane, sets] of run.runs) {
    const was = base.runs.get(lane);
    if (was === undefined) continue;
    for (const s of sets) {
      const b = was.find((x) => x.dpr === s.dpr && x.device === s.device);
      if (b === undefined || b.model === null || s.model === null || b.model === s.model) continue;
      out.push({ lane, detail: `${target} ${lane}: ${s.device} at DPR ${s.dpr} ran on "${s.model}" (${archOf(s.model)}), master's record on "${b.model}" (${archOf(b.model)})` });
    }
  }
  return out;
};

// A position's device run passes when lane parity passes, nothing is stale, every lane of every target that master has
// passes or fails as it does on master, and a failing lane lists no failure master does not (it may list fewer). Each lane runs
// on master's device models (modelChanges); with rebaseline (the landing of the PR that switches a lane's architecture), a lane
// may change model only with master's state and exactly master's failures, so the new architecture's baseline equals the old.
export const deviceRunProblems = (base: DeviceEvidence, run: DeviceEvidence, stale: readonly string[], opts: { readonly rebaseline?: boolean } = {}): string[] => {
  const problems: string[] = [];
  for (const [target, b] of base.targets) {
    const r = run.targets.get(target);
    if (r === undefined) continue;
    const changes = modelChanges(b, r, target);
    if (opts.rebaseline !== true) {
      for (const c of changes) problems.push(`${c.detail}: changing a lane's architecture is an explicit rebaseline (LAND_ARCH_REBASELINE)`);
      continue;
    }
    for (const lane of new Set(changes.map((c) => c.lane))) {
      const [was, now] = [b.lanes.get(lane), r.lanes.get(lane)];
      const known = [...(b.failures.get(lane) ?? [])].sort();
      const listed = [...(r.failures.get(lane) ?? [])].sort();
      if (was !== now || JSON.stringify(known) !== JSON.stringify(listed)) problems.push(`${target} ${lane}: an architecture rebaseline needs master's state and exactly master's failures; master ${was} with ${known.length}, this run ${now} with ${listed.length}`);
    }
  }
  if (!run.parityPass) problems.push(`lane parity fails: ${run.parityProblems.join('; ')}`);
  for (const s of stale) problems.push(`stale: ${s}`);
  for (const [target, b] of base.targets) {
    const r = run.targets.get(target);
    if (r === undefined) {
      problems.push(`${target}: the run has no lanes`);
      continue;
    }
    for (const [lane, was] of b.lanes) {
      const now = r.lanes.get(lane);
      if (now === undefined) problems.push(`${target} ${lane}: missing from the run`);
      else if (now === 'pass') continue;
      else if (now !== 'fail' || was !== 'fail') problems.push(`${target} ${lane}: ${now}, on master ${was}`);
      else {
        const known = b.failures.get(lane) ?? new Set<string>();
        const added = [...(r.failures.get(lane) ?? new Set<string>())].filter((f) => !known.has(f));
        if (added.length > 0) problems.push(`${target} ${lane}: ${added.length} failure(s) master does not have, e.g. ${added.slice(0, 3).join(' | ')}`);
      }
    }
    for (const lane of r.lanes.keys()) if (!b.lanes.has(lane)) problems.push(...newLaneProblems(target, lane, b, r));
  }
  // A lane new on some target must be on every target.
  const added = new Set([...run.targets.values()].flatMap((r) => [...r.lanes.keys()]).filter((l) => ![...base.targets.values()].some((b) => b.lanes.has(l))));
  for (const lane of added) {
    for (const [target, r] of run.targets) if (base.targets.has(target) && !r.lanes.has(lane)) problems.push(`${target} ${lane}: a new lane the run has on another target but not here`);
  }
  for (const target of run.targets.keys()) if (!base.targets.has(target)) problems.push(`${target}: not a target on master`);
  return problems;
};

// A lane master does not have has no baseline, so it is accepted only as a full pass: it passes, lists no failure, and ran
// every case on every device (DPR and device name) that master's device lanes ran on for that target, with every dump taken.
const newLaneProblems = (target: string, lane: string, b: TargetEvidence, r: TargetEvidence): string[] => {
  const what = `${target} ${lane}: a new lane (not on master)`;
  const problems: string[] = [];
  const state = r.lanes.get(lane);
  if (state !== 'pass') problems.push(`${what} is ${state}, not pass`);
  const listed = r.failures.get(lane)?.size ?? 0;
  if (listed > 0) problems.push(`${what} lists ${listed} failure(s)`);
  const sets = r.runs.get(lane);
  if (sets === undefined) return [...problems, `${what} has no device run record`];
  const key = (s: { dpr: number; device: string }): string => `${s.device} at DPR ${s.dpr}`;
  const expected = new Set([...b.runs.values()].flatMap((ss) => ss.map(key)));
  if (expected.size === 0) problems.push(`${what}: master has no device run on ${target} to compare devices with`);
  const ran = new Set(sets.map(key));
  for (const d of expected) if (!ran.has(d)) problems.push(`${what} did not run on ${d}`);
  for (const s of sets) {
    if (s.cases === 0) problems.push(`${what} ran no case on ${key(s)}`);
    else if (s.dumps !== s.cases) problems.push(`${what} got ${s.dumps} dumps of ${s.cases} cases on ${key(s)}`);
    if (s.failures > 0) problems.push(`${what} has ${s.failures} failure(s) on ${key(s)}`);
  }
  return problems;
};

/**
 * LAND_ARCH_REBASELINE: the PR number whose landing may change a device lane's architecture. It applies only to that PR, and only
 * when its body records it on a line starting "Arch rebaseline:". Returns whether this landing rebaselines, or why the setting is
 * refused.
 */
export const archRebaseline = (setting: string | undefined, pr: number, body: string): { rebaseline: boolean; problem: string | null } => {
  if (setting === undefined || setting === '') return { rebaseline: false, problem: null };
  if (!/^[1-9]\d*$/.test(setting)) return { rebaseline: false, problem: `LAND_ARCH_REBASELINE must be a PR number, not ${JSON.stringify(setting)}` };
  if (Number(setting) !== pr) return { rebaseline: false, problem: null };
  if (!/^Arch rebaseline: \S/m.test(body)) return { rebaseline: false, problem: `LAND_ARCH_REBASELINE names #${pr}, but its body has no "Arch rebaseline: <lanes and architectures>" line` };
  return { rebaseline: true, problem: null };
};

// Whether the device run wrote lanes.json: by its modification time, not its content, since a run of a tree whose evidence is
// already committed (a member rebuilt from an earlier build's position) writes the same bytes. Filesystem times are kept to
// the second on some systems, so the start is taken back one second.
export const deviceRunWrote = (mtimeMs: number, startedMs: number): boolean =>
  Number.isFinite(mtimeMs) && Number.isFinite(startedMs) && mtimeMs >= Math.floor(startedMs / 1000) * 1000 - 1000;

/** `pnpm run parity:lanes` on the committed file prints one "STALE <why>" line per stale lane or evidence. */
export const staleLines = (out: string): string[] => out.split('\n').filter((l) => l.startsWith('STALE ')).map((l) => l.slice(6));

// The steps of one position after its merge, in order. The second regen rebuilds what reads the device run's lanes.json
// (native-lanes.ts), so the position's regen commit carries it; judge-devices compares the run with the base's evidence.
export type PositionStep = 'regen' | 'typecheck' | 'devices' | 'judge-devices' | 'regen-after-devices';
export const POSITION_STEPS: readonly PositionStep[] = ['regen', 'typecheck', 'devices', 'judge-devices', 'regen-after-devices'];
