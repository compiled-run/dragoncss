// The landing driver's state kept on GitHub rather than in /tmp, so a fresh host (land.yml on ubuntu) knows what the last run
// left: the land-stop label on a tracking issue (LAND_STOP_ISSUE), the land/proof commit status on master (a merged position no
// full test has passed), and, for land.yml, the queue input, the reconcile of merged PRs on start and the re-dispatch decision.
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
/** The land/proof record among one commit's statuses (GET commits/<sha>/statuses), the newest first; null when it has none. */
export const proofOf = (statuses: unknown, sha: string): ProofRecord | null => {
  if (!Array.isArray(statuses)) throw new Error(`land-state: the statuses of ${sha} are not a list`);
  const ours = statuses.filter((s) => {
    if (!isObject(s) || typeof s.context !== 'string') throw new Error(`land-state: a status of ${sha} has no context`);
    return s.context === PROOF_CONTEXT;
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
export const readProof = (gh: Gh, repo: string, commits: readonly string[]): ProofRecord | null => {
  for (const c of commits) {
    if (!SHA.test(c)) throw new Error(`land-state: ${JSON.stringify(c)} is not a full sha`);
    const r = proofOf(JSON.parse(gh(['api', `repos/${checkRepo(repo)}/commits/${c}/statuses?per_page=100`])), c);
    if (r !== null) return r;
  }
  return null;
};
export const writeProof = (gh: Gh, repo: string, sha: string, u: Unproved | null, targetUrl: string | null): void => {
  if (!SHA.test(sha)) throw new Error(`land-state: ${JSON.stringify(sha)} is not a full sha`);
  gh(['api', '-X', 'POST', `repos/${checkRepo(repo)}/statuses/${sha}`, '-f', `state=${proofState(u)}`, '-f', `context=${PROOF_CONTEXT}`, '-f', `description=${proofDescription(u)}`, ...(targetUrl === null ? [] : ['-f', `target_url=${targetUrl}`])]);
};
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

// ---- land.yml: the queue input, reconciling on start, re-dispatching the rest -----------------------------------------
/** The workflow_dispatch `queue` input (entries separated by newlines or spaces) as a queue file; '' for an empty input. */
export const queueFromInput = (input: string): string => {
  const lines = input.split(/\s+/).filter((t) => t !== '');
  if (lines.length === 0) return '';
  for (const l of lines) parseEntry(l);
  const text = `${lines.join('\n')}\n`;
  parseQueue(text); // duplicates
  return text;
};

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

/** What one land.yml job leaves for the next (LAND_HANDOFF): the queue not handled and why the run ended. */
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

/** LAND_MAX_BATCHES: the batches one run lands before it hands the rest on (land.yml sets 1); unset or empty is no limit. */
export const parseMaxBatches = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  if (!/^[1-9]\d{0,3}$/.test(v)) throw new Error(`land: LAND_MAX_BATCHES must be a positive number of batches, not ${JSON.stringify(v)}`);
  return Number(v);
};
/** The job summary for the status (GitHub Actions shows $GITHUB_STEP_SUMMARY as Markdown). */
export const statusSummary = (status: string): string => `## Landing driver\n\n\`\`\`\n${status.replaceAll('```', "'''").trimEnd()}\n\`\`\`\n`;
