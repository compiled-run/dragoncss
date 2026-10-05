// LAND_DEVICES=ci: the landing driver's device step on GitHub runners. A position's tree is committed apart (never on the PR
// branch) and force-pushed to the driver's scratch branch, device-lanes.yml is dispatched on master for that commit and its run
// found by its run-name, waited for, and its device-outcomes artifact handed back, for the driver to merge (device-ci.ts merge)
// and judge against the previous position as a local run is judged. The scratch branch is deleted whatever happens.
import { LandFailure } from './land-lib.ts';

export const DEVICE_WORKFLOW = 'device-lanes.yml';
export const OUTCOMES_ARTIFACT = 'device-outcomes';
export const TEMP_PREFIX = 'land-devices/pr-';
export const tempBranch = (pr: number): string => `${TEMP_PREFIX}${pr}`;
/** The full test's scratch branch of a commit (a position, master, or a bisect probe). */
export const testBranch = (sha: string): string => `land-test/c-${sha.slice(0, 12)}`;
/**
 * The driver's scratch branches, the only refs it force-pushes or deletes: exactly land-devices/pr-<n> or land-test/c-<12 hex>,
 * never a PR branch.
 */
export function scratchRef(branch: string): string {
  if (!/^land-devices\/pr-[1-9]\d*$|^land-test\/c-[0-9a-f]{12}$/.test(branch)) throw new Error(`${JSON.stringify(branch)} is not a land-devices/pr-<n> or land-test/c-<sha> scratch branch`);
  return `refs/heads/${branch}`;
}
export const runTitle = (sha: string): string => `device lanes of ${sha}`;

/** A CI run in flight: its scratch branch, the commit once pushed, and the run once found (else it is found by its run-name). */
export type Inflight = { readonly branch: string; readonly runId: number | null; readonly sha: string | null; readonly workflow: string };

export type DevicesCiDeps = {
  /** gh with the given arguments (the repository is passed by the caller); returns stdout, throws on failure. */
  readonly gh: (args: string[]) => string;
  /**
   * Commits the landing tree apart and force-pushes it to the scratch branch (scratchRef), so a branch an interrupted run left
   * behind never blocks the next; returns the commit sha.
   */
  readonly pushTemp: (branch: string) => string;
  readonly deleteTemp: (branch: string) => void;
  /** Downloads the run's named artifact into a fresh directory and returns its path and the names of the files in it. */
  readonly download: (runId: number, artifact: string) => { readonly dir: string; readonly files: readonly string[] };
  /** Removes a downloaded directory. */
  readonly remove: (dir: string) => void;
  /**
   * Records the CI run in flight (its scratch branch, and its run once found), or null once it is settled, so a supervisor that
   * kills an interrupted driver can cancel the run and delete the branch (the driver dies by signal, past every finally).
   */
  readonly record: (inflight: Inflight | null) => void;
  readonly sleep: (ms: number) => void;
  readonly now: () => number;
  readonly log: (line: string) => void;
};

export type DevicesCiResult = { readonly sha: string; readonly url: string; readonly outcomesDir: string };

type RunRow = { databaseId: number; displayTitle: string; createdAt: string; headBranch: string; status: string; conclusion: string | null; url: string };
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** gh run list/view JSON, checked: a malformed answer stops the step instead of being read as "no run yet". */
export function parseRunRows(text: string): RunRow[] {
  const v: unknown = JSON.parse(text);
  const rows = Array.isArray(v) ? v : [v];
  return rows.map((r) => {
    const opt = (k: string): boolean => r[k] === undefined || typeof r[k] === 'string';
    if (!isObj(r) || typeof r['databaseId'] !== 'number' || typeof r['status'] !== 'string' || typeof r['url'] !== 'string' || !(r['conclusion'] === null || typeof r['conclusion'] === 'string') || !opt('displayTitle') || !opt('createdAt') || !opt('headBranch')) {
      throw new Error(`unexpected gh run JSON: ${JSON.stringify(r).slice(0, 200)}`);
    }
    return { databaseId: r['databaseId'], displayTitle: (r['displayTitle'] as string | undefined) ?? '', createdAt: (r['createdAt'] as string | undefined) ?? '', headBranch: (r['headBranch'] as string | undefined) ?? '', status: r['status'], conclusion: r['conclusion'] as string | null, url: r['url'] };
  });
}

/** The device outcome files of the artifact: at least one, all JSON files (device-ci.ts merge checks each device and stamp). */
export function outcomeFiles(files: readonly string[]): string[] {
  const json = files.filter((f) => f.endsWith('.json'));
  if (json.length === 0 || json.length !== files.length) throw new Error(`the ${OUTCOMES_ARTIFACT} artifact holds ${files.length === 0 ? 'nothing' : files.join(', ')}, not device outcome files`);
  return json;
}

/**
 * GitHub Actions did not run the workflow: the dispatch was refused, no run appeared, or a job of the run never started (runners
 * not picking up jobs). Nothing was judged, so the caller falls back to the local run instead of failing the PR.
 */
export class CiUnavailable extends Error {}

export type CiStep = { name: string; status: string; conclusion: string | null };
export type CiJob = { name: string; status: string; conclusion: string | null; steps: CiStep[] };

const optStr = (x: unknown): boolean => x === undefined || x === null || typeof x === 'string';

/** The jobs of a run (gh run view --json jobs), checked: each with a name, a status, a conclusion and its steps. */
export function parseJobs(text: string): CiJob[] {
  const v = JSON.parse(text) as { jobs?: unknown };
  if (typeof v !== 'object' || v === null || !Array.isArray(v.jobs)) throw new Error(`unexpected gh run jobs JSON: ${text.slice(0, 200)}`);
  return v.jobs.map((j: unknown) => {
    const o = j as { name?: unknown; status?: unknown; conclusion?: unknown; steps?: unknown };
    if (typeof o?.name !== 'string' || typeof o.status !== 'string' || !optStr(o.conclusion) || !(o.steps === undefined || Array.isArray(o.steps))) throw new Error(`unexpected gh run job: ${JSON.stringify(j).slice(0, 200)}`);
    const steps = ((o.steps as unknown[] | undefined) ?? []).map((st: unknown): CiStep => {
      const x = st as { name?: unknown; status?: unknown; conclusion?: unknown };
      if (typeof x?.name !== 'string' || typeof x.status !== 'string' || !optStr(x.conclusion)) throw new Error(`unexpected gh run step: ${JSON.stringify(st).slice(0, 200)}`);
      return { name: x.name, status: x.status, conclusion: (x.conclusion as string | null | undefined) || null };
    });
    return { name: o.name, status: o.status, conclusion: (o.conclusion as string | null | undefined) || null, steps };
  });
}

/**
 * The steps whose failure judges the tree: the tests, the summary, the regen check, the blocked scan (full-test.yml) and a device
 * run, its merge and comparison (device-lanes.yml). Every other step (checkout, pnpm install, the toolchain and Chromium and WPT
 * downloads, the runtime and SDK installs, cache and artifact steps) is setup: its failure says nothing about the tree.
 */
export const VERDICT_STEP = /^(vitest run|Every test's state|pnpm regen --check|No native run was blocked|Device run |Merge the device outcomes|Compare every device lane)/;

/**
 * The real jobs (not the resolve job) that failed, split by the step that failed: a verdict step (a failure of the tree) or a
 * setup step (CI's own trouble). A job that failed or timed out with no failed step is judged by the step it stopped in.
 */
export function failedJobs(jobs: readonly CiJob[]): { verdict: string[]; setup: string[] } {
  const verdict: string[] = [];
  const setup: string[] = [];
  for (const j of jobs) {
    if (j.name === 'resolve' || j.status !== 'completed' || (j.conclusion !== 'failure' && j.conclusion !== 'timed_out')) continue;
    const step = j.steps.find((st) => st.conclusion === 'failure') ?? j.steps.find((st) => st.status !== 'completed' || (st.conclusion !== 'success' && st.conclusion !== 'skipped'));
    if (step !== undefined && VERDICT_STEP.test(step.name)) verdict.push(`${j.name} (${step.name})`);
    else setup.push(`${j.name} (${step?.name ?? 'no step'})`);
  }
  return { verdict, setup };
}

/** A workflow the driver runs for one commit: dispatched on master with the commit, found by its run-name, waited for. */
export type CiWorkflow = {
  readonly workflow: string;
  /** The landing step a failure is reported at. */
  readonly step: string;
  readonly what: string;
  readonly title: (sha: string) => string;
  /** The dispatch inputs besides sha. */
  readonly inputs: readonly string[];
  /** The artifact handed back on success, or null for none. */
  readonly artifact: string | null;
  readonly check: (files: readonly string[]) => unknown;
  /** More about a run that did not succeed (its failing tests), or null. */
  readonly explain?: (runId: number) => string | null;
};

export const DEVICES_WORKFLOW: CiWorkflow = { workflow: DEVICE_WORKFLOW, step: 'devices', what: 'device lanes', title: runTitle, inputs: ['judge=false'], artifact: OUTCOMES_ARTIFACT, check: outcomeFiles };

/**
 * Runs a workflow for the commit the driver pushes to its scratch branch and returns the run and its artifact. Only a verdict on
 * the tree is a LandFailure at the workflow's step: a run some of whose real jobs ran and concluded failure. Everything else
 * (the push, gh, malformed answers, no run, jobs never started, a wait past waitS with no job failed, a cancelled run, a bad
 * artifact) judged nothing and is CiUnavailable, for the caller to run the step locally. A run in flight is cancelled on any
 * failure and the scratch branch is deleted in every case.
 */
export function runOnCi(w: CiWorkflow, o: { readonly branch: string; readonly deps: DevicesCiDeps; readonly appearS: number; readonly waitS: number; readonly startS?: number; readonly pollS?: number }): DevicesCiResult {
  const startS = o.startS ?? 900;
  const { deps, branch } = o;
  const poll = (o.pollS ?? 30) * 1000;
  let pushed = false;
  let run: RunRow | undefined;
  let outcomesDir: string | null = null;
  const explainOf = (id: number): string => {
    try {
      const more = w.explain?.(id) ?? null;
      return more === null ? '' : `:\n${more}`;
    } catch {
      return '';
    }
  };
  try {
    deps.record({ branch, runId: null, sha: null, workflow: w.workflow });
    const sha = deps.pushTemp(branch);
    pushed = true;
    deps.record({ branch, runId: null, sha, workflow: w.workflow });
    const t0 = deps.now();
    try {
      deps.gh(['workflow', 'run', w.workflow, '--ref', 'master', '-f', `sha=${sha}`, ...w.inputs.flatMap((i) => ['-f', i])]);
    } catch (e) {
      throw new CiUnavailable(`the dispatch of ${w.workflow} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    deps.log(`  ${w.what} on CI: dispatched ${w.workflow} for ${sha} (branch ${branch})`);
    while (run === undefined) {
      const rows = parseRunRows(deps.gh(['run', 'list', '--workflow', w.workflow, '--event', 'workflow_dispatch', '--branch', 'master', '--limit', '20', '--json', 'databaseId,displayTitle,createdAt,headBranch,status,conclusion,url']));
      // Only master's workflow, dispatched after this dispatch (2 min clock skew): not an earlier run for the same commit, and not
      // a run of the workflow dispatched from another branch.
      run = rows.find((r) => r.headBranch === 'master' && r.displayTitle === w.title(sha) && Date.parse(r.createdAt) >= t0 - 120_000);
      if (run !== undefined) break;
      if (deps.now() - t0 > o.appearS * 1000) throw new CiUnavailable(`no ${w.workflow} run for ${sha} appeared within ${o.appearS}s of the dispatch`);
      deps.sleep(Math.min(poll, 10_000));
    }
    deps.log(`  ${w.what} on CI: ${run.url}`);
    deps.record({ branch, runId: run.databaseId, sha, workflow: w.workflow });
    // "CI never starts a job": no job of the run started within startS (runners not picking up jobs), or a job is still queued
    // when waitS runs out. Either way nothing was judged. A run some of whose jobs wait for a busy runner pool is waited for.
    let started = false;
    const jobsOf = (id: number) => parseJobs(deps.gh(['run', 'view', String(id), '--json', 'jobs']));
    while (run.status !== 'completed') {
      const over = deps.now() - t0 > o.waitS * 1000;
      if (over || (!started && deps.now() - t0 > startS * 1000)) {
        const jobs = jobsOf(run.databaseId);
        // A job that already failed at a verdict step is a verdict, whatever the rest of the run is doing; one that failed at a
        // setup step judged nothing.
        const failed = failedJobs(jobs);
        if (failed.verdict.length > 0) throw new LandFailure(w.step, `the CI ${w.what} run ${run.url} has failed jobs (${failed.verdict.join(', ')})${explainOf(run.databaseId)}`);
        if (failed.setup.length > 0) throw new CiUnavailable(`the CI ${w.what} run ${run.url} failed in setup (${failed.setup.join(', ')})`);
        // The resolve job (ubuntu, seconds) does not count: the work is in the jobs after it.
        started ||= jobs.some((j) => j.name !== 'resolve' && (j.status === 'in_progress' || j.status === 'completed'));
        const queued = jobs.filter((j) => j.status === 'queued' || j.status === 'waiting' || j.status === 'pending');
        if (!started || (over && queued.length > 0)) throw new CiUnavailable(`the CI ${w.what} run ${run.url} has jobs that never started (${queued.map((j) => j.name).join(', ') || 'none listed'}) after ${Math.round((deps.now() - t0) / 1000)}s`);
        if (over) throw new CiUnavailable(`the CI ${w.what} run ${run.url} did not finish within ${o.waitS}s, and no job of it failed`);
      }
      deps.sleep(poll);
      run = { ...run, ...parseRunRows(deps.gh(['run', 'view', String(run.databaseId), '--json', 'databaseId,status,conclusion,url']))[0]! };
    }
    if (run.conclusion !== 'success') {
      // Only a real job that failed at a verdict step judges the tree; a cancelled run, or failures only in setup steps (an install,
      // a download), judged nothing and never blame the PR.
      const failed = failedJobs(jobsOf(run.databaseId));
      if (failed.verdict.length === 0) throw new CiUnavailable(`the CI ${w.what} run ${run.url} concluded ${run.conclusion ?? 'without a conclusion'} with no failed test or device step${failed.setup.length === 0 ? '' : ` (failed in setup: ${failed.setup.join(', ')})`}`);
      throw new LandFailure(w.step, `the CI ${w.what} run ${run.url} concluded ${run.conclusion ?? 'without a conclusion'}; failed jobs: ${failed.verdict.join(', ')}${explainOf(run.databaseId)}`);
    }
    if (w.artifact === null) {
      deps.log(`  ${w.what} on CI: passed, ${run.url} in ${Math.round((deps.now() - t0) / 1000)}s`);
      return { sha, url: run.url, outcomesDir: '' };
    }
    const got = deps.download(run.databaseId, w.artifact);
    outcomesDir = got.dir;
    const files = w.check(got.files) as readonly string[];
    deps.log(`  ${w.what} on CI: ${files.length} files of ${run.url} in ${Math.round((deps.now() - t0) / 1000)}s`);
    outcomesDir = null;
    return { sha, url: run.url, outcomesDir: got.dir };
  } catch (e) {
    // Nothing of a failed step is left running or on disk: the run is cancelled, its downloaded files removed.
    if (run !== undefined && run.status !== 'completed') {
      try {
        deps.gh(['run', 'cancel', String(run.databaseId)]);
        deps.log(`  ${w.what} on CI: cancelled ${run.url}`);
      } catch (c) {
        deps.log(`  ${w.what} on CI: could not cancel ${run.url}: ${c instanceof Error ? c.message : String(c)}`);
      }
    }
    if (outcomesDir !== null) deps.remove(outcomesDir);
    // Only a verdict (a LandFailure from failed jobs) fails the PR; anything else judged nothing, and the caller runs the step locally.
    if (e instanceof LandFailure || e instanceof CiUnavailable) throw e;
    throw new CiUnavailable(`the CI ${w.what} could not be run: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    deps.record(null);
    if (pushed) {
      try {
        deps.deleteTemp(branch);
      } catch (e) {
        // A branch left behind is swept when the next driver starts (staleScratchBranches).
        deps.log(`  ${w.what} on CI: WARNING could not delete ${branch}; the next driver start sweeps it: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

/** The device lanes of a landing position on CI (device-lanes.yml); judged by the driver, so the workflow does not judge. */
export const runDevicesOnCi = (o: { readonly pr: number; readonly deps: DevicesCiDeps; readonly appearS: number; readonly waitS: number; readonly startS?: number; readonly pollS?: number }): DevicesCiResult =>
  runOnCi(DEVICES_WORKFLOW, { ...o, branch: tempBranch(o.pr) });

export const FULL_TEST_WORKFLOW_FILE = 'full-test.yml';
/**
 * The default waits for a CI run: past the longest chain of job timeouts in the workflow (full-test.yml: a Chrome shard, 120 min,
 * then regen-chrome, 240 min; device-lanes.yml: a device job, 120 min, then the merge), so a run still within its own limits is
 * never cut short. land-devices-ci.test.ts reads the workflows' timeouts to keep these above them.
 */
export const DEFAULT_TEST_WAIT_S = 6 * 3600 + 900;
export const DEFAULT_DEVICES_WAIT_S = 2 * 3600 + 1800;
export const fullTestTitle = (sha: string): string => `full test of ${sha}`;
/** The failing tests listed in full-test.yml's full-test-results, one per line (at most 30), or a note that none are listed. */
export function failedTestsOf(text: string): string {
  const rows = JSON.parse(text) as unknown;
  if (!Array.isArray(rows)) throw new Error('full-test-results is not a list');
  const failed = rows.filter((r): r is { file: string; test: string; state: string } => typeof r === 'object' && r !== null && (r as { state?: unknown }).state === 'failed');
  if (failed.length === 0) return 'no failing test is listed (a shard, the summary or the regen check failed; see the run)';
  return [...failed.slice(0, 30).map((r) => `FAILED ${r.file} > ${r.test}`), ...(failed.length > 30 ? [`and ${failed.length - 30} more`] : [])].join('\n');
}

/** full-test.yml for one commit: no artifact on success; a failure names its failing tests. */
export const fullTestWorkflow = (explain: (runId: number) => string | null): CiWorkflow => ({ workflow: FULL_TEST_WORKFLOW_FILE, step: 'test', what: 'full test', title: fullTestTitle, inputs: [], artifact: null, check: (f) => f, explain });

/** The run-name a workflow gives a dispatch for a commit, to find a run whose id was never recorded. */
export const titleOf = (workflow: string, sha: string): string | null => (workflow === DEVICE_WORKFLOW ? runTitle(sha) : workflow === FULL_TEST_WORKFLOW_FILE ? fullTestTitle(sha) : null);

/**
 * After an interrupted driver: cancels the CI run it recorded in flight and deletes its scratch branch. A run whose id was not yet
 * recorded is found by its run-name (the commit is unique to it). A malformed record is logged and dropped; each failure is
 * logged (the run may have ended; the next run replaces the branch).
 */
export function abandonInflight(text: string, o: { readonly cancel: (runId: number) => void; readonly findRuns: (workflow: string, title: string) => readonly number[]; readonly deleteBranch: (branch: string) => void; readonly log: (line: string) => void }): void {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    o.log('the CI run record left in flight is not JSON; dropped');
    return;
  }
  const r = (typeof v === 'object' && v !== null ? v : {}) as { branch?: unknown; runId?: unknown; sha?: unknown; workflow?: unknown };
  let ids: readonly number[] = typeof r.runId === 'number' ? [r.runId] : [];
  if (ids.length === 0 && typeof r.sha === 'string' && typeof r.workflow === 'string') {
    const title = titleOf(r.workflow, r.sha);
    try {
      if (title !== null) ids = o.findRuns(r.workflow, title);
    } catch {
      o.log(`could not look up the ${r.workflow} run of ${r.sha}`);
    }
  }
  for (const id of ids) {
    try {
      o.cancel(id);
      o.log(`cancelled the CI run ${id} the interrupted driver left`);
    } catch {
      o.log(`could not cancel the CI run ${id} (it may have ended)`);
    }
  }
  if (typeof r.branch === 'string') {
    try {
      o.deleteBranch(r.branch);
    } catch {
      o.log(`could not delete ${r.branch}; the next driver start sweeps it`);
    }
  }
}

/**
 * The driver's scratch branches in `git ls-remote origin` output: every land-devices/pr-<n> and land-test/c-<sha12>. At the
 * driver's start none is in flight (it holds the lock), so each is a leftover to delete.
 */
export function staleScratchBranches(lsRemote: string): string[] {
  const out: string[] = [];
  for (const line of lsRemote.split('\n')) {
    const ref = line.split('\t')[1]?.trim();
    if (ref === undefined || !ref.startsWith('refs/heads/')) continue;
    const branch = ref.slice('refs/heads/'.length);
    try {
      scratchRef(branch);
      out.push(branch);
    } catch {
      // Not one of the driver's scratch branches: never touched.
    }
  }
  return out.sort();
}
