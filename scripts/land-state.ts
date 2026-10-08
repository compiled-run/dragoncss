// The landing driver's state kept on GitHub rather than in /tmp, so a fresh host (land.yml on ubuntu) knows what the last run
// left: the land-stop label on a tracking issue (LAND_STOP_ISSUE), the land/proof commit status on master (a merged position no
// full test has passed), the reconcile of merged PRs on start and the handoff of the rest of the queue (LAND_MAX_BATCHES).
// The precomputed review comment is read by land-review-lookup.ts. Every reader checks the shape of what GitHub returned.
import { type Entry, parseEntry, parseQueue } from './land-lib.ts';

export type Gh = (args: string[]) => string;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const checkRepo = (repo: string): string => {
  if (!REPO.test(repo)) throw new Error(`land-state: ${JSON.stringify(repo)} is not owner/name`);
  return repo;
};

// ---- the stop label ---------------------------------------------------------------------------------------------------
export const STOP_LABEL = 'land-stop';
/** LAND_STOP_ISSUE: the tracking issue whose land-stop label stops the driver after its current batch; unset or empty is none. */
export const parseStopIssue = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  if (!/^[1-9]\d{0,8}$/.test(v)) throw new Error(`land: LAND_STOP_ISSUE must be an issue number, not ${JSON.stringify(v)}`);
  return Number(v);
};
/** Whether the labels GitHub returned (GET issues/<n>/labels, pages slurped) include land-stop. */
export const hasStopLabel = (pages: unknown): boolean => {
  if (!Array.isArray(pages)) throw new Error('land-state: the issue labels are not a list of pages');
  return pages.some((page) => {
    if (!Array.isArray(page)) throw new Error('land-state: an issue labels page is not a list');
    return page.some((l) => {
      if (!isObject(l) || typeof l.name !== 'string') throw new Error('land-state: an issue label has no name');
      return l.name === STOP_LABEL;
    });
  });
};
export const stopLabelSet = (gh: Gh, repo: string, issue: number): boolean =>
  hasStopLabel(JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${checkRepo(repo)}/issues/${issue}/labels?per_page=100`])));

// ---- the land/proof commit status ---------------------------------------------------------------------------------------
// On master's merge commit (and, before a merge, on the position it merges): pending "unproved: #<pr> position <sha>" while no
// full test has passed on master's tree, success "proved" once one has. A later commit (a docs/goals push) carries none, so the
// reader walks master's first parents, and each merge commit's second parent, the position merged, for the newest record.
export const PROOF_CONTEXT = 'land/proof';
export type Unproved = { pr: number; head: string };
export type ProofRecord = { proved: true } | { proved: false; unproved: Unproved };
export const proofDescription = (u: Unproved | null): string => (u === null ? 'proved: a full test passed on this tree' : `unproved: #${u.pr} position ${u.head}`);
export const proofState = (u: Unproved | null): 'success' | 'pending' => (u === null ? 'success' : 'pending');
/**
 * The land/proof record among one commit's statuses (GET commits/<sha>/statuses): the newest written by a trusted creator (the
 * driver's own identity, LAND_PROOF_WRITERS); null when it has none. Anyone with statuses write can post a status, so another
 * creator's says nothing.
 */
export const proofOf = (statuses: unknown, sha: string, trusted: ReadonlySet<number>): ProofRecord | null => {
  if (!Array.isArray(statuses)) throw new Error(`land-state: the statuses of ${sha} are not a list`);
  const ours = statuses.filter((s) => {
    if (!isObject(s) || typeof s.context !== 'string') throw new Error(`land-state: a status of ${sha} has no context`);
    if (s.context !== PROOF_CONTEXT) return false;
    // A status with no creator id cannot be tied to a trusted writer: it is ignored, as another creator's is.
    return isObject(s.creator) && Number.isSafeInteger(s.creator.id) && trusted.has(s.creator.id as number);
  }) as Record<string, unknown>[];
  if (ours.length === 0) return null;
  const at = (s: Record<string, unknown>): string => {
    if (typeof s.created_at !== 'string' || typeof s.id !== 'number') throw new Error(`land-state: a ${PROOF_CONTEXT} status of ${sha} has no created_at or id`);
    return `${s.created_at} ${String(s.id).padStart(16, '0')}`;
  };
  const keyed = ours.map((s) => ({ s, key: at(s) }));
  const newest = keyed.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))[0]!.s;
  const description = typeof newest.description === 'string' ? newest.description : '';
  if (newest.state === 'success') return { proved: true };
  const m = /^unproved: #(\d{1,9}) position ([0-9a-f]{40})$/.exec(description);
  // Anything but a well-formed record counts as unproved at this commit, so master is proved again rather than trusted.
  return { proved: false, unproved: m ? { pr: Number(m[1]), head: m[2]! } : { pr: 0, head: sha } };
};
/** The newest land/proof record along `commits` (master first, then the commits it rests on, in order); null when none has one. */
export const readProof = (gh: Gh, repo: string, commits: readonly string[], trusted: ReadonlySet<number>): ProofRecord | null => {
  for (const c of commits) {
    if (!SHA.test(c)) throw new Error(`land-state: ${JSON.stringify(c)} is not a full sha`);
    const r = proofOf(JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${checkRepo(repo)}/commits/${c}/statuses?per_page=100`])).flat(), c, trusted);
    if (r !== null) return r;
  }
  return null;
};
export const writeProof = (gh: Gh, repo: string, sha: string, u: Unproved | null, targetUrl: string | null): void => {
  if (!SHA.test(sha)) throw new Error(`land-state: ${JSON.stringify(sha)} is not a full sha`);
  gh(['api', '-X', 'POST', `repos/${checkRepo(repo)}/statuses/${sha}`, '-f', `state=${proofState(u)}`, '-f', `context=${PROOF_CONTEXT}`, '-f', `description=${proofDescription(u)}`, ...(targetUrl === null ? [] : ['-f', `target_url=${targetUrl}`])]);
};
/**
 * What master's proof record says when the lookback found none: proved where the driver is not the only writer (a Mac driver,
 * whose /tmp file is the record), unproved under LAND_CI=only, so a fresh host proves master rather than trust it.
 */
export const missingProof = (ciOnly: boolean, master: string): Unproved | null => (ciOnly ? { pr: 0, head: master } : null);

/** The token's own identity (GET user): its numeric id and login. An App installation token cannot read it, so LAND_TOKEN_USER_ID names it. */
export const parseSelf = (userJson: string | null, fallbackId: string | undefined): { id: number; login: string } => {
  if (userJson !== null) {
    const v: unknown = JSON.parse(userJson);
    if (!isObject(v) || !Number.isSafeInteger(v.id) || typeof v.login !== 'string') throw new Error('land-state: GET user returned no id and login');
    return { id: v.id as number, login: v.login };
  }
  if (fallbackId === undefined || !/^[1-9]\d{0,15}$/.test(fallbackId)) throw new Error('land: GET user failed for this token (an App installation token cannot read it); set LAND_TOKEN_USER_ID to the id of the user it acts as');
  return { id: Number(fallbackId), login: `user ${fallbackId}` };
};
/** Refuses a reviewer allowlist that holds the token's own identity: the identity that merges must never also approve. */
export const checkNotReviewer = (self: { id: number; login: string }, reviewers: readonly number[]): void => {
  if (reviewers.includes(self.id)) throw new Error(`land: the token's identity ${self.login} (id ${self.id}) is on the reviewer allowlist; the identity that merges must never also approve, so reviews must come from another identity`);
};
/** LAND_PROOF_WRITERS: user ids besides the driver's own whose land/proof statuses are trusted (comma or space separated). */
export const parseIds = (name: string, v: string | undefined): number[] =>
  (v ?? '').split(/[\s,]+/).filter((x) => x !== '').map((x) => {
    if (!/^[1-9]\d{0,15}$/.test(x)) throw new Error(`land: ${name} entry ${JSON.stringify(x)} is not a user id`);
    return Number(x);
  });

/** The commits whose land/proof record speaks for master: each first parent, then its second parent (the position it merged). */
export const proofCommits = (firstParents: readonly { sha: string; parents: readonly string[] }[]): string[] =>
  firstParents.flatMap((c) => [c.sha, ...(c.parents.length === 2 ? [c.parents[1]!] : [])]);
/** `git log --first-parent --format='%H %P'` output, parsed. */
export const parseFirstParents = (out: string): { sha: string; parents: string[] }[] =>
  out
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const [sha, ...parents] = l.trim().split(' ');
      if (!SHA.test(sha ?? '') || parents.some((p) => !SHA.test(p))) throw new Error(`land-state: git log printed ${JSON.stringify(l.slice(0, 200))}`);
      return { sha: sha!, parents };
    });

// ---- a run that hands on: reconciling on start, the handoff -------------------------------------------------------------
/** The queue without the PRs GitHub already reports merged (a cancelled run may have merged one), with what was skipped. */
export const reconcileQueue = (entries: readonly Entry[], stateOf: (pr: number) => { state: string; mergeCommit: string | null }): { queue: Entry[]; merged: { entry: Entry; detail: string }[] } => {
  const queue: Entry[] = [];
  const merged: { entry: Entry; detail: string }[] = [];
  for (const e of entries) {
    const s = stateOf(e.pr);
    if (s.state === 'MERGED') merged.push({ entry: e, detail: `merged as ${s.mergeCommit ?? '?'} before this run; skipped` });
    else queue.push(e);
  }
  return { queue, merged };
};

/** What one run leaves for the next (LAND_HANDOFF): the queue not handled and why the run ended. */
export type Handoff = { remainder: Entry[]; stopAsked: boolean; outage: string | null; fatal: string | null };
export const serializeHandoff = (h: Handoff): string => `${JSON.stringify(h, null, 2)}\n`;
export const parseHandoff = (text: string | null): Handoff | null => {
  if (text === null) return null;
  const v: unknown = JSON.parse(text);
  if (!isObject(v) || Object.keys(v).sort().join(',') !== 'fatal,outage,remainder,stopAsked') throw new Error('land-state: the handoff is not exactly { remainder, stopAsked, outage, fatal }');
  if (!Array.isArray(v.remainder) || typeof v.stopAsked !== 'boolean' || !(v.outage === null || typeof v.outage === 'string') || !(v.fatal === null || typeof v.fatal === 'string')) throw new Error('land-state: the handoff has a field of the wrong type');
  const remainder = v.remainder.map((e) => {
    if (!isObject(e) || typeof e.branch !== 'string' || typeof e.pr !== 'number' || typeof e.clean !== 'string') throw new Error('land-state: a handoff entry is not { branch, pr, clean }');
    return parseEntry(`${e.branch}:${e.pr}:${e.clean}`);
  });
  return { remainder, stopAsked: v.stopAsked, outage: v.outage, fatal: v.fatal };
};
/** LAND_MAX_BATCHES: the batches one run lands before it hands the rest on (land.yml sets 1); unset or empty is no limit. */
export const parseMaxBatches = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  if (!/^[1-9]\d{0,3}$/.test(v)) throw new Error(`land: LAND_MAX_BATCHES must be a positive number of batches, not ${JSON.stringify(v)}`);
  return Number(v);
};
/** The job summary for the status (GitHub Actions shows $GITHUB_STEP_SUMMARY as Markdown). */
export const statusSummary = (status: string): string => `## Landing driver\n\n\`\`\`\n${status.replaceAll('```', "'''").trimEnd()}\n\`\`\`\n`;

// ---- the cross-host lock (LAND_GLOBAL_LOCK=1) ---------------------------------------------------------------------------
// One landing driver at a time across hosts (a Mac and land.yml): the tag refs/tags/land-lock, an annotated tag whose message
// names its holder, created and deleted with git push --force-with-lease, which GitHub applies atomically. A holder that is gone
// (its land.yml run completed, or its process on this same host dead) is replaced, again under the lease.
export const LOCK_REF = 'refs/tags/land-lock';
export type LockHolder = { host: 'actions'; repo: string; run: number; started: string } | { host: 'local'; hostname: string; pid: number; pidStart: string; started: string };
export const lockHolder = (env: Readonly<Record<string, string | undefined>>, local: { hostname: string; pid: number; pidStart: string }, started: string): LockHolder => {
  if (env['GITHUB_ACTIONS'] === 'true') {
    const run = env['GITHUB_RUN_ID'] ?? '';
    if (!/^[1-9]\d*$/.test(run)) throw new Error(`land: GITHUB_RUN_ID ${JSON.stringify(run)} is not a run id`);
    return { host: 'actions', repo: checkRepo(env['GITHUB_REPOSITORY'] ?? ''), run: Number(run), started };
  }
  return { host: 'local', ...local, started };
};
export const parseLockHolder = (message: string): LockHolder | null => {
  let v: unknown;
  try {
    v = JSON.parse(message.trim());
  } catch {
    return null;
  }
  if (!isObject(v) || typeof v.started !== 'string') return null;
  if (v.host === 'actions' && typeof v.repo === 'string' && REPO.test(v.repo) && Number.isSafeInteger(v.run) && (v.run as number) > 0) return { host: 'actions', repo: v.repo, run: v.run as number, started: v.started };
  if (v.host === 'local' && typeof v.hostname === 'string' && Number.isSafeInteger(v.pid) && typeof v.pidStart === 'string') return { host: 'local', hostname: v.hostname, pid: v.pid as number, pidStart: v.pidStart, started: v.started };
  return null;
};
export const describeHolder = (h: LockHolder | null): string =>
  h === null ? 'an unreadable holder' : h.host === 'actions' ? `land.yml run ${h.run} of ${h.repo} (since ${h.started})` : `the driver pid ${h.pid} on ${h.hostname} (since ${h.started})`;
/**
 * Whether a held lock may be replaced: its land.yml run has completed, or its process on this host is gone. An unreadable holder,
 * or a process on another host, is never judged gone from here: the PM removes that lock by hand.
 */
export const lockStale = (h: LockHolder | null, here: { hostname: string; runCompleted: (repo: string, run: number) => boolean; alive: (pid: number, start: string) => boolean }): boolean => {
  if (h === null) return false;
  if (h.host === 'actions') return here.runCompleted(h.repo, h.run);
  return h.hostname === here.hostname && !here.alive(h.pid, h.pidStart);
};
/** The annotated tag object of the lock (git mktag input), on master's commit, its message the holder. */
export const lockTag = (master: string, holder: LockHolder, epochS: number): string => {
  if (!SHA.test(master)) throw new Error(`land-state: ${JSON.stringify(master)} is not a full sha`);
  return `object ${master}\ntype commit\ntag land-lock\ntagger dragon landing driver <land@users.noreply.github.com> ${epochS} +0000\n\n${JSON.stringify(holder)}\n`;
};

type LockGit = (args: string[], input?: string) => string;
// The lock's current tag object and its holder (fetched into refs/land/lock-seen), or null when no lock is set.
const currentLock = (git: LockGit): { tag: string; holder: LockHolder | null } | null => {
  const out = git(['ls-remote', 'origin', LOCK_REF]);
  if (out === '') return null;
  const tag = out.split('\t')[0] ?? '';
  if (!SHA.test(tag)) throw new Error(`land-state: ls-remote land-lock printed ${JSON.stringify(out.slice(0, 100))}`);
  git(['fetch', '--quiet', '--no-tags', 'origin', `+${LOCK_REF}:refs/land/lock-seen`]);
  const body = git(['cat-file', 'tag', 'refs/land/lock-seen']);
  return { tag, holder: body.includes('\n\n') ? parseLockHolder(body.slice(body.indexOf('\n\n') + 2)) : null };
};
/**
 * The check every run makes when it does not take the lock itself (a Mac run without LAND_GLOBAL_LOCK=1): it only reads. With no
 * lock set nothing changes; a land.yml run that holds it and has not completed stops this run before it touches anything.
 */
export const checkLockFree = (o: { git: LockGit; runCompleted: (repo: string, run: number) => boolean; log: (line: string) => void }): void => {
  const lock = currentLock(o.git);
  if (lock === null) return;
  const h = lock.holder;
  if (h?.host === 'actions' && !o.runCompleted(h.repo, h.run)) throw new Error(`land: ${describeHolder(h)} holds ${LOCK_REF} and is still running; a second driver would land the same queue against it. Wait for it, or stop it with the land-stop label`);
  o.log(`!!! ${LOCK_REF} is held by ${describeHolder(h)}; this run does not take the lock (LAND_GLOBAL_LOCK is not 1), so make sure that driver is not running`);
};
/** Takes the lock for `me` (a push under the lease of what was seen), replacing a stale holder; returns the lock's tag object. */
export const takeLock = (o: { git: LockGit; me: LockHolder; here: Parameters<typeof lockStale>[1]; now: () => number; log: (line: string) => void }): string => {
  const sha = (v: string, what: string): string => {
    if (!SHA.test(v)) throw new Error(`land-state: ${what} printed ${JSON.stringify(v.slice(0, 100))}`);
    return v;
  };
  const master = sha(o.git(['ls-remote', 'origin', 'refs/heads/master']).split('\t')[0] ?? '', 'ls-remote master');
  const tag = sha(o.git(['mktag'], lockTag(master, o.me, Math.floor(o.now() / 1000))), 'mktag');
  for (let attempt = 0; attempt < 3; attempt++) {
    const lock = currentLock(o.git);
    const seen = lock?.tag ?? null;
    if (lock !== null) {
      const holder = lock.holder;
      if (!lockStale(holder, o.here)) throw new Error(`land: another landing driver holds ${LOCK_REF}: ${describeHolder(holder)}. Wait for it, or stop it; if it is gone, delete the lock with git push origin :${LOCK_REF}`);
      o.log(`the landing lock ${LOCK_REF} is held by ${describeHolder(holder)}, which is gone; taking it over`);
    }
    try {
      o.git(['push', '--quiet', `--force-with-lease=${LOCK_REF}:${seen ?? ''}`, 'origin', `${tag}:${LOCK_REF}`]);
      o.log(`took the landing lock ${LOCK_REF} (${describeHolder(o.me)})`);
      return tag;
    } catch (error) {
      o.log(`could not take ${LOCK_REF} (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); looking again`);
    }
  }
  throw new Error(`land: could not take the landing lock ${LOCK_REF} after 3 attempts`);
};
/** Deletes the lock only while it is still `tag` (the lease); a failure is logged, and the next run replaces a gone holder. */
export const releaseLock = (git: LockGit, tag: string, log: (line: string) => void): void => {
  try {
    git(['push', '--quiet', `--force-with-lease=${LOCK_REF}:${tag}`, 'origin', `:${LOCK_REF}`]);
    log(`released the landing lock ${LOCK_REF}`);
  } catch (error) {
    log(`!!! could not release the landing lock ${LOCK_REF} (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); the next run replaces it once this run is gone`);
  }
};

// ---- land.yml: the queue input, re-dispatching the rest, dispatching safely ------------------------------------------------
/** The workflow_dispatch `queue` input (entries separated by newlines or spaces) as a queue file; '' for an empty input. */
export const queueFromInput = (input: string): string => {
  const lines = input.split(/\s+/).filter((t) => t !== '');
  if (lines.length === 0) return '';
  for (const l of lines) parseEntry(l);
  const text = `${lines.join('\n')}\n`;
  parseQueue(text); // duplicates
  return text;
};
export type Redispatch = { dispatch: true; queue: string } | { dispatch: false; why: string };
/** Whether land.yml dispatches itself again with the rest of the queue: only after a batch that ended normally, with no stop. */
export const redispatchDecision = (h: Handoff | null, stopNow: boolean): Redispatch => {
  if (h === null) return { dispatch: false, why: 'the driver left no handoff (it did not end normally); read its log, then dispatch the rest by hand' };
  if (h.fatal !== null) return { dispatch: false, why: `the driver stopped: ${h.fatal}` };
  if (h.outage !== null) return { dispatch: false, why: `the driver stopped on a CI outage: ${h.outage}` };
  if (h.stopAsked || stopNow) return { dispatch: false, why: `a stop was requested; still queued: ${h.remainder.map((e) => `#${e.pr}`).join(' ') || 'none'}` };
  if (h.remainder.length === 0) return { dispatch: false, why: 'the queue is done' };
  return { dispatch: true, queue: h.remainder.map((e) => `${e.branch}:${e.pr}:${e.clean}`).join('\n') };
};

// GitHub keeps one pending run per concurrency group and cancels the older pending one when another is queued, so a dispatch
// while a land.yml run waits would silently drop that run's queue. Every dispatch (the PM's, pnpm land:dispatch, and the
// re-dispatch) first waits until no land.yml run is pending, then dispatches, then watches its run until it is past the window
// in which a racing dispatch could still replace it.
export type LandRun = { id: number; status: string; landJob: string | null };
const WAITING = new Set(['queued', 'waiting', 'pending', 'requested']);
/** The land.yml runs (but `self`) whose land job has not started: a run with no land job listed yet counts as not started. */
export const pendingRuns = (runs: readonly LandRun[], self: number | null): number[] =>
  runs.filter((r) => r.id !== self && r.status !== 'completed' && (r.landJob === null || WAITING.has(r.landJob))).map((r) => r.id);
/** A run's jobs page (GET actions/runs/<id>/jobs): the status of its job named land, or null. */
export const landJobStatus = (jobsJson: unknown): string | null => {
  if (!isObject(jobsJson) || !Array.isArray(jobsJson.jobs)) throw new Error('land-state: a run\'s jobs are not { jobs: [...] }');
  for (const j of jobsJson.jobs) {
    if (!isObject(j) || typeof j.name !== 'string' || typeof j.status !== 'string') throw new Error('land-state: a job has no name or status');
    if (j.name === 'land') return j.status;
  }
  return null;
};
/** The workflow's runs (GET actions/workflows/<f>/runs pages, slurped): each id and status, checked. */
export const workflowRuns = (pages: unknown): { id: number; status: string }[] => {
  if (!Array.isArray(pages)) throw new Error('land-state: the workflow runs are not a list of pages');
  return pages.flatMap((p) => {
    if (!isObject(p) || !Array.isArray(p.workflow_runs)) throw new Error('land-state: a workflow runs page has no workflow_runs');
    return p.workflow_runs.map((r) => {
      if (!isObject(r) || !Number.isSafeInteger(r.id) || typeof r.status !== 'string') throw new Error('land-state: a workflow run has no id or status');
      return { id: r.id as number, status: r.status };
    });
  });
};
export type DispatchDeps = {
  readonly gh: Gh;
  readonly repo: string;
  readonly ref: string;
  readonly self: number | null;
  readonly sleep: (ms: number) => void;
  readonly now: () => number;
  readonly log: (line: string) => void;
  readonly waitS: number;
  readonly watchS?: number;
};
const listLandRuns = (d: DispatchDeps): LandRun[] => {
  // The newest 100 runs: a run that waits to start is among the newest.
  const runs = workflowRuns([JSON.parse(d.gh(['api', `repos/${checkRepo(d.repo)}/actions/workflows/land.yml/runs?per_page=100&exclude_pull_requests=true`]))]);
  return runs.filter((r) => r.status !== 'completed').map((r) => ({ ...r, landJob: landJobStatus(JSON.parse(d.gh(['api', `repos/${d.repo}/actions/runs/${r.id}/jobs?per_page=100`]))) }));
};
/** Dispatches land.yml with `queue` once no land.yml run is pending, and makes sure no racing dispatch replaced it; returns its run id. */
export const dispatchLand = (queue: string, d: DispatchDeps): number => {
  queueFromInput(queue);
  if (!/^[\w./-]+$/.test(d.ref)) throw new Error(`land-state: ref ${JSON.stringify(d.ref)}`);
  const t0 = d.now();
  for (;;) {
    const pending = pendingRuns(listLandRuns(d), d.self);
    if (pending.length > 0) {
      if (d.now() - t0 > d.waitS * 1000) throw new Error(`land: land.yml run(s) ${pending.join(', ')} still wait to start after ${d.waitS}s; a dispatch now would cancel one. Dispatch again once it starts`);
      d.log(`land.yml run(s) ${pending.join(', ')} wait to start; a dispatch now would make GitHub cancel one, so waiting`);
      d.sleep(60_000);
      continue;
    }
    const out: unknown = JSON.parse(d.gh(['api', '-X', 'POST', `repos/${checkRepo(d.repo)}/actions/workflows/land.yml/dispatches`, '-f', `ref=${d.ref}`, '-f', `inputs[queue]=${queue}`, '-F', 'return_run_details=true']));
    if (!isObject(out) || !Number.isSafeInteger(out.workflow_run_id)) throw new Error('land: the dispatch returned no workflow_run_id');
    const id = out.workflow_run_id as number;
    d.log(`dispatched land.yml run ${id} on ${d.ref}`);
    // A racing dispatch (another dispatcher between our look and our dispatch) makes GitHub cancel the older pending run.
    const watchT0 = d.now();
    let replaced = false;
    while (d.now() - watchT0 < (d.watchS ?? 120) * 1000) {
      d.sleep(15_000);
      const r: unknown = JSON.parse(d.gh(['api', `repos/${d.repo}/actions/runs/${id}`]));
      if (!isObject(r) || typeof r.status !== 'string') throw new Error(`land: run ${id} has no status`);
      if (r.status === 'completed' && r.conclusion === 'cancelled') {
        replaced = true;
        break;
      }
      if (r.status !== 'queued' && r.status !== 'pending' && r.status !== 'waiting' && r.status !== 'requested') break;
    }
    if (!replaced) return id;
    d.log(`land.yml run ${id} was cancelled before it started (another dispatch replaced it); dispatching again`);
  }
};

// ---- outages at a PR's own CI runs (LAND_OUTAGE_EJECT) ---------------------------------------------------------------------
// A tree can end its own CI runs without a verdict (kill the runner, run each step just under its timeout until the job's limit),
// which stops the driver as a CI outage, blaming no PR, at that PR every time. So each build of a PR's position is recorded on
// the PR's head as the commit status land/outage: pending while it builds, error when it ended in a CI outage, success when it
// came to a verdict (built, or failed). A run killed mid-build leaves its pending. At admission, N of those in a row with no
// success between (LAND_OUTAGE_EJECT, default 2) eject the PR, naming the runs.
export const OUTAGE_CONTEXT = 'land/outage';
export type OutageMark = 'building' | 'outage' | 'verdict';
const OUTAGE_STATE: Record<OutageMark, 'pending' | 'error' | 'success'> = { building: 'pending', outage: 'error', verdict: 'success' };
export const parseOutageEject = (v: string | undefined): number => {
  if (v === undefined || v === '') return 2;
  if (!/^[1-9]\d{0,2}$/.test(v)) throw new Error(`land: LAND_OUTAGE_EJECT must be a positive number of outages, not ${JSON.stringify(v)}`);
  return Number(v);
};
/** The trusted land/outage statuses of one commit (GET commits/<sha>/statuses pages, flattened), newest first, since the last verdict. */
export const outageStreak = (statuses: unknown, sha: string, trusted: ReadonlySet<number>): { count: number; runs: string[] } => {
  if (!Array.isArray(statuses)) throw new Error(`land-state: the statuses of ${sha} are not a list`);
  const ours = statuses.flatMap((s) => {
    if (!isObject(s) || typeof s.context !== 'string') throw new Error(`land-state: a status of ${sha} has no context`);
    if (s.context !== OUTAGE_CONTEXT || !isObject(s.creator) || !Number.isSafeInteger(s.creator.id) || !trusted.has(s.creator.id as number)) return [];
    if (typeof s.created_at !== 'string' || typeof s.id !== 'number' || typeof s.state !== 'string') throw new Error(`land-state: a ${OUTAGE_CONTEXT} status of ${sha} has no created_at, id or state`);
    return [{ key: `${s.created_at} ${String(s.id).padStart(16, '0')}`, state: s.state, url: typeof s.target_url === 'string' ? s.target_url : '', description: typeof s.description === 'string' ? s.description : '' }];
  });
  ours.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const streak = [];
  for (const s of ours) {
    if (s.state === 'success') break;
    streak.push(s);
  }
  return { count: streak.length, runs: streak.map((s) => `${s.url || 'a run with no URL'} (${s.state === 'pending' ? 'ended mid-build' : s.description})`) };
};
export const readOutageStreak = (gh: Gh, repo: string, sha: string, trusted: ReadonlySet<number>): { count: number; runs: string[] } => {
  if (!SHA.test(sha)) throw new Error(`land-state: ${JSON.stringify(sha)} is not a full sha`);
  return outageStreak((JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${checkRepo(repo)}/commits/${sha}/statuses?per_page=100`])) as unknown[]).flat(), sha, trusted);
};
export const writeOutage = (gh: Gh, repo: string, sha: string, mark: OutageMark, description: string, targetUrl: string | null): void => {
  if (!SHA.test(sha)) throw new Error(`land-state: ${JSON.stringify(sha)} is not a full sha`);
  gh(['api', '-X', 'POST', `repos/${checkRepo(repo)}/statuses/${sha}`, '-f', `state=${OUTAGE_STATE[mark]}`, '-f', `context=${OUTAGE_CONTEXT}`, '-f', `description=${description.replace(/\s+/g, ' ').slice(0, 139)}`, ...(targetUrl === null ? [] : ['-f', `target_url=${targetUrl}`])]);
};

/** Ends a PR's land/outage streak at its current head (pnpm land:clear-outage), as the identity gh acts as; returns who and where. */
export const clearOutage = (gh: Gh, repo: string, pr: string): { context: string; head: string; login: string; id: number } => {
  if (!/^[1-9]\d{0,8}$/.test(pr)) throw new Error(`land: ${JSON.stringify(pr)} is not a PR number`);
  const p: unknown = JSON.parse(gh(['api', `repos/${checkRepo(repo)}/pulls/${pr}`]));
  if (!isObject(p) || !isObject(p.head) || typeof p.head.sha !== 'string' || !SHA.test(p.head.sha)) throw new Error(`land: PR #${pr} has no head sha`);
  if (p.state !== 'open') throw new Error(`land: PR #${pr} is ${String(p.state)}, not open`);
  const me: unknown = JSON.parse(gh(['api', 'user']));
  if (!isObject(me) || !Number.isSafeInteger(me.id) || typeof me.login !== 'string') throw new Error('land: GET user returned no id and login');
  writeOutage(gh, repo, p.head.sha, 'verdict', `cleared by ${me.login} after a GitHub outage (pnpm land:clear-outage)`, null);
  return { context: OUTAGE_CONTEXT, head: p.head.sha, login: me.login, id: me.id as number };
};
