// Regenerates a branch on CI (regen-on-ci.yml in branch mode) and reports the outcome, for sessions without a Mac. Only REST
// (gh api), so it works whether or not the branch's PR conflicts and where GraphQL does not.
//   pnpm ci:regen <branch> [--head <sha>] [--from <branch>] [--once]   reuse this head's run or dispatch one, then wait
//   pnpm ci:regen <branch> --run <id> [--head <sha>] [--once]            wait for (or poll once) a run
// The dispatch names the head it must regenerate and a nonce, both in its run-name ("regen of branch <b> at <sha> (<nonce>)"),
// and the run refuses a branch that is not at that head, so the run is found exactly and judged against the head expected.
// Exit codes: 0 done (the regen commit pushed, or already at a fixed point), 1 failed, 2 usage or gh error, a cancelled run or a
// run that is not the one asked for, 3 pending.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { failedSteps, gh, repoOf, runIdOfDispatch } from './ci-test-files.ts';
import { type CiJob, DEFAULT_REGEN_WAIT_S, parseJobs } from './land-devices-ci.ts';

export const WORKFLOW = 'regen-on-ci.yml';
export const EXIT = { done: 0, failed: 1, error: 2, pending: 3 } as const;
export const PUSH_STEP = 'Commit and push the outputs, then start CI on the new commit';
export const FIXED_STEP = 'Already at a fixed point (no commit)';
export const COMMIT_SUBJECT = 'Regenerate on CI: pnpm regen (regen-on-ci)';
const USAGE = 'usage: pnpm ci:regen <branch> [--head <sha>] [--from <branch>] [--once] | <branch> --run <id> [--head <sha>] [--once]';

export const runTitle = (branch: string, head: string, nonce: string): string => `regen of branch ${branch} at ${head} (${nonce})`;
export type Title = { readonly branch: string; readonly head: string; readonly nonce: string };
/** The branch, head and nonce of a branch-mode run-name, or null for any other run (patch mode, a label run, master's). */
export function parseTitle(title: string): Title | null {
  const m = /^regen of branch (\S+) at ([0-9a-f]{40}) \(([0-9A-Za-z_-]+)\)$/.exec(title);
  return m === null ? null : { branch: m[1] as string, head: m[2] as string, nonce: m[3] as string };
}

export type Args = { readonly branch: string; readonly head: string | null; readonly from: string; readonly runId: number | null; readonly once: boolean };

const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA = /^[0-9a-f]{40}$/;

export function parseArgs(argv: readonly string[]): Args {
  const pos: string[] = [];
  let once = false;
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--once') once = true;
    else if (a === '--head' || a === '--from' || a === '--run') {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value\n${USAGE}`);
      if (opt[a] !== undefined) throw new Error(`${a} given twice\n${USAGE}`);
      opt[a] = v;
    } else if (a.startsWith('-')) throw new Error(`unknown option ${a}\n${USAGE}`);
    else pos.push(a);
  }
  if (pos.length !== 1) throw new Error(USAGE);
  const branch = pos[0] as string;
  for (const b of [branch, opt['--from'] ?? 'master']) if (!REF.test(b) || b.includes('..') || b.endsWith('/') || b.endsWith('.lock')) throw new Error(`${JSON.stringify(b)} is not a branch name`);
  if (branch === 'master') throw new Error('regen-on-ci never pushes master');
  const head = opt['--head'] ?? null;
  if (head !== null && !SHA.test(head)) throw new Error(`--head ${JSON.stringify(head)} is not a full commit sha`);
  const run = opt['--run'] ?? null;
  if (run !== null && !/^[1-9]\d*$/.test(run)) throw new Error(`--run ${JSON.stringify(run)} is not a run id`);
  if (run !== null && opt['--from'] !== undefined) throw new Error(`--run takes no --from\n${USAGE}`);
  return { branch, head, from: opt['--from'] ?? 'master', runId: run === null ? null : Number(run), once };
}

export type Deps = {
  /** gh with the given arguments; returns stdout, throws on failure. */
  readonly gh: (args: string[]) => string;
  readonly sleep: (ms: number) => void;
  readonly now: () => number;
  readonly log: (line: string) => void;
  /** A fresh token for one dispatch. */
  readonly nonce: () => string;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const json = (text: string, what: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`unexpected ${what}: ${text.slice(0, 200)}`);
  }
};

export type Run = { readonly id: number; readonly title: string; readonly event: string; readonly path: string; readonly status: string; readonly conclusion: string | null; readonly url: string };
function toRun(r: unknown): Run {
  if (!isObj(r) || typeof r['id'] !== 'number' || typeof r['display_title'] !== 'string' || typeof r['event'] !== 'string' || typeof r['path'] !== 'string' || typeof r['status'] !== 'string' || !(r['conclusion'] === null || typeof r['conclusion'] === 'string') || typeof r['html_url'] !== 'string') {
    throw new Error(`unexpected workflow run: ${JSON.stringify(r).slice(0, 200)}`);
  }
  return { id: r['id'], title: r['display_title'], event: r['event'], path: r['path'], status: r['status'], conclusion: r['conclusion'] as string | null, url: r['html_url'] };
}
export const parseRun = (text: string): Run => toRun(json(text, 'workflow run'));
export function parseRuns(text: string): Run[] {
  const v = json(text, 'workflow runs');
  if (!isObj(v) || !Array.isArray(v['workflow_runs'])) throw new Error(`unexpected workflow runs: ${text.slice(0, 200)}`);
  return v['workflow_runs'].map(toRun);
}

/** A run of this workflow, dispatched in branch mode, for this branch (and head and nonce, when given). */
export function checkRun(run: Run, want: { readonly branch: string; readonly head: string | null; readonly nonce?: string }): Title {
  if (run.event !== 'workflow_dispatch' || !run.path.startsWith(`.github/workflows/${WORKFLOW}`)) throw new Error(`run ${run.id} is a ${run.event} run of ${run.path}, not a dispatched ${WORKFLOW} run`);
  const t = parseTitle(run.title);
  if (t === null) throw new Error(`run ${run.id} (${JSON.stringify(run.title)}) is not a branch regen dispatched with a head and a nonce`);
  if (t.branch !== want.branch || (want.head !== null && t.head !== want.head) || (want.nonce !== undefined && t.nonce !== want.nonce)) {
    throw new Error(`run ${run.id} regenerates ${t.branch} at ${t.head} (${t.nonce}), not ${want.branch} at ${want.head ?? 'any head'}${want.nonce === undefined ? '' : ` (${want.nonce})`}`);
  }
  return t;
}

/** The branch's head commit. */
export function branchHead(deps: Deps, repo: string, branch: string): string {
  const text = deps.gh(['api', `repos/${repo}/branches/${branch}`]);
  const v = json(text, 'branch');
  const sha = isObj(v) && isObj(v['commit']) ? v['commit']['sha'] : undefined;
  if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error(`unexpected branch answer for ${branch}: ${text.slice(0, 200)}`);
  return sha;
}

const listRuns = (deps: Deps, repo: string, from: string): Run[] =>
  parseRuns(deps.gh(['api', `repos/${repo}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=${from}&per_page=100`]));

/**
 * The newest run already regenerating (or done regenerating) this branch at this head, so a resumed lane never dispatches twice.
 * A run that ended in anything but success is not reused: dispatching again is the retry.
 */
export function findReusable(runs: readonly Run[], branch: string, head: string): Run | null {
  for (const r of runs) {
    const t = parseTitle(r.title);
    if (r.event !== 'workflow_dispatch' || t === null || t.branch !== branch || t.head !== head) continue;
    return r.status !== 'completed' || r.conclusion === 'success' ? r : null;
  }
  return null;
}

/** Dispatches a branch regen of `head` and returns its run: from the dispatch's answer, else found by its run-name. */
export function dispatch(deps: Deps, repo: string, a: Args, head: string, appearS = 180): { readonly runId: number; readonly nonce: string } {
  const nonce = deps.nonce();
  if (!/^[0-9a-f]{8,}$/.test(nonce)) throw new Error(`bad nonce ${JSON.stringify(nonce)}`);
  const t0 = deps.now();
  const out = deps.gh(['api', '-X', 'POST', `repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, '-f', `ref=${a.from}`, '-f', `inputs[branch]=${a.branch}`, '-f', `inputs[head]=${head}`, '-f', `inputs[nonce]=${nonce}`, '-F', 'return_run_details=true']);
  const id = runIdOfDispatch(out);
  if (id !== null) return { runId: id, nonce };
  const title = runTitle(a.branch, head, nonce);
  for (;;) {
    const run = listRuns(deps, repo, a.from).find((r) => r.title === title);
    if (run !== undefined) return { runId: run.id, nonce };
    if (deps.now() - t0 > appearS * 1000) throw new Error(`no ${WORKFLOW} run named ${JSON.stringify(title)} appeared within ${appearS}s of the dispatch`);
    deps.sleep(10_000);
  }
}

export type Commit = { readonly sha: string; readonly parents: readonly string[]; readonly message: string };
export function parseCommits(text: string): Commit[] {
  const v = json(text, 'commit list');
  if (!Array.isArray(v)) throw new Error(`unexpected commit list: ${text.slice(0, 200)}`);
  return v.map((c: unknown) => {
    const parents = isObj(c) && Array.isArray(c['parents']) ? c['parents'].map((p: unknown) => (isObj(p) ? p['sha'] : undefined)) : undefined;
    const message = isObj(c) && isObj(c['commit']) ? c['commit']['message'] : undefined;
    if (!isObj(c) || typeof c['sha'] !== 'string' || !SHA.test(c['sha']) || parents === undefined || !parents.every((p): p is string => typeof p === 'string' && SHA.test(p)) || typeof message !== 'string') {
      throw new Error(`unexpected commit: ${JSON.stringify(c).slice(0, 200)}`);
    }
    return { sha: c['sha'], parents, message };
  });
}

/**
 * The regen commit the run pushed, checked: its message names the run and the head as its base, and its only parent is that head.
 * Throws when the branch's newest commits hold no commit naming the run, or when that commit is not on top of the head expected.
 */
export function pushedCommit(commits: readonly Commit[], runUrl: string, head: string, branch: string): string {
  const mine = commits.filter((c) => c.message.split('\n').some((l) => l.trim() === `Run: ${runUrl}`));
  if (mine.length !== 1) throw new Error(`${mine.length === 0 ? 'no' : mine.length} commit${mine.length === 1 ? '' : 's'} among the newest ${commits.length} of ${branch} name${mine.length === 1 ? 's' : ''} the run ${runUrl}; expected exactly 1`);
  const c = mine[0] as Commit;
  const lines = c.message.split('\n').map((l) => l.trim());
  if (lines[0] !== COMMIT_SUBJECT || !lines.includes(`Base: ${head}`) || c.parents.length !== 1 || c.parents[0] !== head) {
    throw new Error(`the commit ${c.sha} naming ${runUrl} is not a regen commit on top of ${head} (parents ${c.parents.join(', ') || 'none'})`);
  }
  return c.sha;
}

type Job = CiJob & { readonly id: number | null };
const jobsOf = (text: string): Job[] => {
  const ids = ((json(text, 'jobs') as { jobs?: unknown[] }).jobs ?? []).map((j) => (isObj(j) && typeof j['id'] === 'number' ? j['id'] : null));
  return parseJobs(text).map((j, i) => ({ ...j, id: ids[i] ?? null }));
};

/** The outcome of a completed run and its exit code. */
export function settle(deps: Deps, repo: string, run: Run, t: Title): number {
  if (run.conclusion === 'cancelled') {
    deps.log(`CANCELLED ${run.url}: nothing was regenerated (cancelled by hand or by a newer run in its concurrency group)`);
    return EXIT.error;
  }
  const jobs = jobsOf(deps.gh(['api', `repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`]));
  if (run.conclusion !== 'success') {
    const failed = failedSteps(jobs);
    for (const s of failed) deps.log(`failed job ${s}`);
    for (const j of jobs.filter((x) => x.conclusion === 'failure' && x.id !== null)) {
      try {
        const notes = json(deps.gh(['api', `repos/${repo}/check-runs/${j.id}/annotations?per_page=100`]), 'annotations');
        if (!Array.isArray(notes)) throw new Error('not a list');
        for (const n of notes) if (isObj(n) && n['annotation_level'] === 'failure' && typeof n['message'] === 'string') deps.log(`  ${j.name}: ${n['message'].split('\n')[0]}`);
      } catch (e) {
        deps.log(`  ${j.name}: no annotations (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (failed.length === 0) deps.log('no failed job: the run ended without a job failing');
    deps.log(`FAILED (${run.conclusion ?? 'no conclusion'}) ${run.url}: regen of ${t.branch} at ${t.head}`);
    return EXIT.failed;
  }
  const push = jobs.find((j) => j.name === 'push');
  const step = (name: string): string | null => push?.steps.find((s) => s.name === name)?.conclusion ?? null;
  if (push?.conclusion !== 'success') throw new Error(`the run ${run.url} succeeded but its push job ${push === undefined ? 'is missing' : `ended ${push.conclusion ?? push.status}`}`);
  if (step(PUSH_STEP) === 'success' && step(FIXED_STEP) === 'success') {
    deps.log(`DONE ${t.branch} at ${t.head} is already at a fixed point; no commit (${run.url})`);
    deps.log(`head ${t.head}`);
    return EXIT.done;
  }
  if (step(PUSH_STEP) === 'success' && step(FIXED_STEP) === 'skipped') {
    const sha = pushedCommit(parseCommits(deps.gh(['api', `repos/${repo}/commits?sha=${t.branch}&per_page=100`])), run.url, t.head, t.branch);
    deps.log(`DONE pushed the regen commit ${sha} on top of ${t.head} to ${t.branch} (${run.url}); git pull --ff-only`);
    deps.log(`regen commit ${sha}`);
    return EXIT.done;
  }
  throw new Error(`the run ${run.url} succeeded but its push job's steps say neither pushed nor fixed point (${PUSH_STEP}: ${step(PUSH_STEP)}, ${FIXED_STEP}: ${step(FIXED_STEP)})`);
}

/** Waits for the run (or polls it once) and returns the exit code. */
export function waitFor(deps: Deps, repo: string, runId: number, want: Parameters<typeof checkRun>[1], o: { readonly once: boolean; readonly waitS?: number; readonly pollS?: number }): number {
  const t0 = deps.now();
  for (;;) {
    const run = parseRun(deps.gh(['api', `repos/${repo}/actions/runs/${runId}`]));
    if (run.id !== runId) throw new Error(`asked for run ${runId}, got ${run.id}`);
    const t = checkRun(run, want);
    if (run.status === 'completed') return settle(deps, repo, run, t);
    if (o.once || deps.now() - t0 > (o.waitS ?? DEFAULT_REGEN_WAIT_S) * 1000) {
      deps.log(`PENDING (${run.status}) ${run.url}: regen of ${t.branch} at ${t.head}; poll again with: pnpm ci:regen ${t.branch} --run ${runId} --once`);
      return EXIT.pending;
    }
    deps.sleep((o.pollS ?? 60) * 1000);
  }
}

export function main(argv: readonly string[], deps: Deps, repo: () => string): number {
  let a: Args;
  try {
    a = parseArgs(argv);
  } catch (e) {
    deps.log(e instanceof Error ? e.message : String(e));
    return EXIT.error;
  }
  try {
    const r = repo();
    if (a.runId !== null) return waitFor(deps, r, a.runId, { branch: a.branch, head: a.head }, { once: a.once });
    const head = branchHead(deps, r, a.branch);
    if (a.head !== null && head !== a.head) throw new Error(`${a.branch} is at ${head}, not --head ${a.head}; push it first`);
    const reuse = findReusable(listRuns(deps, r, a.from), a.branch, head);
    if (reuse !== null) {
      deps.log(`run ${reuse.id} already regenerates ${a.branch} at ${head}: ${reuse.url}`);
      return waitFor(deps, r, reuse.id, { branch: a.branch, head }, { once: a.once });
    }
    const d = dispatch(deps, r, a, head);
    deps.log(`dispatched ${WORKFLOW} from ${a.from} for ${a.branch} at ${head} (${d.nonce}): run ${d.runId}`);
    return waitFor(deps, r, d.runId, { branch: a.branch, head, nonce: d.nonce }, { once: a.once });
  } catch (e) {
    deps.log(`ERROR ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.error;
  }
}

if (import.meta.main) {
  let r = '';
  const repo = (): string => (r ||= repoOf(process.env['GH_REPO'], execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })));
  const deps: Deps = {
    gh,
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    now: () => Date.now(),
    log: (l) => console.log(l),
    nonce: () => randomBytes(6).toString('hex'),
  };
  process.exit(main(process.argv.slice(2), deps, repo));
}
