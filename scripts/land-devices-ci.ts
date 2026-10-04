// LAND_DEVICES=ci: the landing driver's device step on GitHub runners, in the hybrid the PM ruled (2026-10-04). The landing tree
// is committed apart (never on the PR branch) and pushed to a temporary branch, device-lanes.yml is dispatched on master for that
// commit and its run found by its run-name; meanwhile the Mac runs the one lane kept local (android layout-vectors-device, the
// `during` step); then the run is waited for and its device-outcomes artifact handed back, for the driver to merge with the Mac's
// record (device-ci.ts merge --local-vectors) and judge against master as a local run is judged. The temporary branch is deleted
// whatever happens.
import { LandFailure } from './land-lib.ts';

export const DEVICE_WORKFLOW = 'device-lanes.yml';
export const OUTCOMES_ARTIFACT = 'device-outcomes';
export const tempBranch = (pr: number): string => `land-devices/pr-${pr}`;
export const runTitle = (sha: string): string => `device lanes of ${sha}`;

export type DevicesCiDeps = {
  /** gh with the given arguments (the repository is passed by the caller); returns stdout, throws on failure. */
  readonly gh: (args: string[]) => string;
  /** Commits the landing tree apart and pushes it to the branch; returns the commit sha. */
  readonly pushTemp: (branch: string) => string;
  readonly deleteTemp: (branch: string) => void;
  /** Downloads the run's named artifact into a fresh directory and returns its path and the names of the files in it. */
  readonly download: (runId: number, artifact: string) => { readonly dir: string; readonly files: readonly string[] };
  readonly sleep: (ms: number) => void;
  readonly now: () => number;
  readonly log: (line: string) => void;
};

export type DevicesCiResult = { readonly sha: string; readonly url: string; readonly outcomesDir: string };

type RunRow = { databaseId: number; displayTitle: string; createdAt: string; status: string; conclusion: string | null; url: string };
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** gh run list/view JSON, checked: a malformed answer stops the step instead of being read as "no run yet". */
export function parseRunRows(text: string): RunRow[] {
  const v: unknown = JSON.parse(text);
  const rows = Array.isArray(v) ? v : [v];
  return rows.map((r) => {
    if (!isObj(r) || typeof r['databaseId'] !== 'number' || typeof r['status'] !== 'string' || typeof r['url'] !== 'string' || !(r['conclusion'] === null || typeof r['conclusion'] === 'string') || (r['displayTitle'] !== undefined && typeof r['displayTitle'] !== 'string') || (r['createdAt'] !== undefined && typeof r['createdAt'] !== 'string')) {
      throw new Error(`unexpected gh run JSON: ${JSON.stringify(r).slice(0, 200)}`);
    }
    return { databaseId: r['databaseId'], displayTitle: (r['displayTitle'] as string | undefined) ?? '', createdAt: (r['createdAt'] as string | undefined) ?? '', status: r['status'], conclusion: r['conclusion'] as string | null, url: r['url'] };
  });
}

/** The device outcome files of the artifact: at least one, all JSON files (device-ci.ts merge checks each device and stamp). */
export function outcomeFiles(files: readonly string[]): string[] {
  const json = files.filter((f) => f.endsWith('.json'));
  if (json.length === 0 || json.length !== files.length) throw new Error(`the ${OUTCOMES_ARTIFACT} artifact holds ${files.length === 0 ? 'nothing' : files.join(', ')}, not device outcome files`);
  return json;
}

/**
 * Runs the device lanes of the landing tree on CI and returns its records. Throws a LandFailure('devices') when the run cannot
 * be started or found, does not finish within waitS, or does not succeed; the temporary branch is deleted in every case.
 */
export function runDevicesOnCi(o: { readonly pr: number; readonly deps: DevicesCiDeps; readonly appearS: number; readonly waitS: number; readonly pollS?: number; readonly during: () => void }): DevicesCiResult {
  const { deps } = o;
  const poll = (o.pollS ?? 30) * 1000;
  const branch = tempBranch(o.pr);
  let pushed = false;
  try {
    const sha = deps.pushTemp(branch);
    pushed = true;
    const t0 = deps.now();
    deps.gh(['workflow', 'run', DEVICE_WORKFLOW, '--ref', 'master', '-f', `sha=${sha}`]);
    deps.log(`  device lanes on CI: dispatched ${DEVICE_WORKFLOW} for ${sha} (branch ${branch})`);
    let run: RunRow | undefined;
    while (run === undefined) {
      const rows = parseRunRows(deps.gh(['run', 'list', '--workflow', DEVICE_WORKFLOW, '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,displayTitle,createdAt,status,conclusion,url']));
      // A run of an earlier dispatch for the same commit is not this one: it must start after this dispatch (2 min clock skew).
      run = rows.find((r) => r.displayTitle === runTitle(sha) && Date.parse(r.createdAt) >= t0 - 120_000);
      if (run !== undefined) break;
      if (deps.now() - t0 > o.appearS * 1000) throw new LandFailure('devices', `no ${DEVICE_WORKFLOW} run for ${sha} appeared within ${o.appearS}s of the dispatch`);
      deps.sleep(Math.min(poll, 10_000));
    }
    deps.log(`  device lanes on CI: ${run.url}`);
    // The Mac's half runs while the runners work; its own failure fails the step (and the branch is still deleted).
    o.during();
    while (run.status !== 'completed') {
      if (deps.now() - t0 > o.waitS * 1000) throw new LandFailure('devices', `the CI device run ${run.url} did not finish within ${o.waitS}s (status ${run.status})`);
      deps.sleep(poll);
      run = parseRunRows(deps.gh(['run', 'view', String(run.databaseId), '--json', 'databaseId,status,conclusion,url']))[0]!;
    }
    if (run.conclusion !== 'success') throw new LandFailure('devices', `the CI device run ${run.url} concluded ${run.conclusion ?? 'without a conclusion'}`);
    const got = deps.download(run.databaseId, OUTCOMES_ARTIFACT);
    const files = outcomeFiles(got.files);
    deps.log(`  device lanes on CI: ${files.length} device outcomes of ${run.url} in ${Math.round((deps.now() - t0) / 1000)}s`);
    return { sha, url: run.url, outcomesDir: got.dir };
  } catch (e) {
    // Every failure of this step (a refused push, a malformed gh answer, a bad artifact) fails the PR at the devices step.
    throw e instanceof LandFailure ? e : new LandFailure('devices', `the CI device lanes failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (pushed) {
      try {
        deps.deleteTemp(branch);
      } catch (e) {
        deps.log(`  device lanes on CI: could not delete ${branch}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
