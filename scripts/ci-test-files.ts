// Runs chosen test files of a ref on their CI runners (.github/workflows/test-files.yml) and reports the outcome, for sessions
// without a Mac or the native toolchains. Only REST gh calls (gh api, gh run view/download), so it works where GraphQL does not.
//   pnpm ci:test-files <ref> <file>... [--floor-write] [--from <branch>] [--once]   dispatch, then wait (--once: poll one time)
//   pnpm ci:test-files --run <id> [--once]                                          wait for (or poll once) a dispatched run
// --from is the branch whose workflow file runs (default master). GitHub files the run's checks under that branch's head commit,
// so a run dispatched from a PR branch shows on the PR's checks. Exit codes: 0 passed, 1 failed, 2 usage or gh error, 3 pending.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CiJob, dispatchedRun, parseJobs, parseRunRows, type RunRow } from './land-devices-ci.ts';

export const WORKFLOW = 'test-files.yml';
export const EXIT = { passed: 0, failed: 1, error: 2, pending: 3 } as const;
export const runTitle = (ref: string): string => `test files of ${ref}`;
/** Past the workflow's longest job (120 min) behind a busy macOS pool; a run still going after it is reported as pending. */
export const WAIT_S = 4 * 3600;
const USAGE = 'usage: pnpm ci:test-files <ref> <file>... [--floor-write] [--from <branch>] [--once] | --run <id> [--once]';

export type Args =
  | { readonly kind: 'dispatch'; readonly ref: string; readonly files: readonly string[]; readonly floorWrite: boolean; readonly from: string; readonly once: boolean }
  | { readonly kind: 'attach'; readonly runId: number; readonly once: boolean };

const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
/** A test file path as the workflow's space-separated input carries it: no spaces, no flags, ending in .test.ts. */
const FILE = /^[A-Za-z0-9_.@+-][A-Za-z0-9_./@+-]*\.test\.ts$/;

export function parseArgs(argv: readonly string[]): Args {
  const pos: string[] = [];
  let once = false;
  let floorWrite = false;
  let from: string | null = null;
  let run: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--once') once = true;
    else if (a === '--floor-write') floorWrite = true;
    else if (a === '--from' || a === '--run') {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value\n${USAGE}`);
      if (a === '--from') from = v;
      else run = v;
    } else if (a.startsWith('-')) throw new Error(`unknown option ${a}\n${USAGE}`);
    else pos.push(a);
  }
  if (run !== null) {
    if (pos.length > 0 || floorWrite || from !== null) throw new Error(`--run takes no ref, files, --floor-write or --from\n${USAGE}`);
    if (!/^[1-9]\d*$/.test(run)) throw new Error(`--run ${JSON.stringify(run)} is not a run id`);
    return { kind: 'attach', runId: Number(run), once };
  }
  const [ref, ...files] = pos;
  if (ref === undefined || files.length === 0) throw new Error(USAGE);
  for (const r of [ref, from ?? 'master']) if (!REF.test(r) || r.includes('..')) throw new Error(`${JSON.stringify(r)} is not a commit sha or branch name`);
  const bad = files.filter((f) => !FILE.test(f) || f.split('/').includes('..'));
  if (bad.length > 0) throw new Error(`not test file paths (packages/<pkg>/test/....test.ts): ${bad.map((f) => JSON.stringify(f)).join(', ')}`);
  return { kind: 'dispatch', ref, files, floorWrite, from: from ?? 'master', once };
}

/** owner/name from GH_REPO, else from the origin remote's GitHub URL. */
export function repoOf(ghRepo: string | undefined, originUrl: string): string {
  const r = ghRepo?.trim() || /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(originUrl.trim())?.[1];
  if (r === undefined || !/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error(`no GitHub repository: set GH_REPO=owner/name (origin is ${JSON.stringify(originUrl.trim())})`);
  return r;
}

export type Deps = {
  /** gh with the given arguments; returns stdout, throws on failure. */
  readonly gh: (args: string[]) => string;
  readonly sleep: (ms: number) => void;
  readonly now: () => number;
  readonly log: (line: string) => void;
  /** Downloads a run's named artifact into a fresh directory; returns the directory. */
  readonly download: (runId: number, artifact: string) => string;
};

/** The run id in the dispatch API's answer (return_run_details), or null when the answer carries none. */
export function runIdOfDispatch(text: string): number | null {
  if (text.trim() === '') return null;
  const v = JSON.parse(text) as { workflow_run_id?: unknown };
  if (typeof v !== 'object' || v === null) throw new Error(`unexpected dispatch answer: ${text.slice(0, 200)}`);
  if (v.workflow_run_id === undefined) return null;
  if (typeof v.workflow_run_id !== 'number' || !Number.isInteger(v.workflow_run_id) || v.workflow_run_id <= 0) throw new Error(`unexpected dispatch answer: ${text.slice(0, 200)}`);
  return v.workflow_run_id;
}

/** Dispatches the workflow and returns its run: from the dispatch's answer, else found by its run-name. */
export function dispatch(deps: Deps, repo: string, a: Extract<Args, { kind: 'dispatch' }>, appearS = 180): number {
  const t0 = deps.now();
  const out = deps.gh(['api', '-X', 'POST', `repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, '-f', `ref=${a.from}`, '-f', `inputs[ref]=${a.ref}`, '-f', `inputs[files]=${a.files.join(' ')}`, '-f', `inputs[floor_write]=${a.floorWrite}`, '-F', 'return_run_details=true']);
  const id = runIdOfDispatch(out);
  if (id !== null) return id;
  for (;;) {
    const rows = parseRunRows(deps.gh(['run', 'list', '-R', repo, '--workflow', WORKFLOW, '--event', 'workflow_dispatch', '--branch', a.from, '--limit', '20', '--json', 'databaseId,displayTitle,createdAt,headBranch,status,conclusion,url']));
    const run = dispatchedRun(rows, { branch: a.from, title: runTitle(a.ref), since: t0 });
    if (run !== undefined) return run.databaseId;
    if (deps.now() - t0 > appearS * 1000) throw new Error(`no ${WORKFLOW} run for ${a.ref} appeared within ${appearS}s of the dispatch`);
    deps.sleep(10_000);
  }
}

export type Polled = { readonly run: RunRow; readonly jobs: readonly CiJob[] };
export const poll = (deps: Deps, repo: string, runId: number): Polled => {
  const text = deps.gh(['run', 'view', String(runId), '-R', repo, '--json', 'databaseId,status,conclusion,url,jobs']);
  return { run: parseRunRows(text)[0] as RunRow, jobs: parseJobs(text) };
};

type Report = { testResults: { name: string; status: string; message?: string; assertionResults: { fullName: string; status: string; failureMessages?: string[] }[] }[] };

/** A vitest JSON report, checked enough to list its files and failures. */
export function parseReport(text: string): Report {
  const v = JSON.parse(text) as Report;
  if (typeof v !== 'object' || v === null || !Array.isArray(v.testResults)) throw new Error('not a vitest JSON report');
  for (const f of v.testResults) {
    if (typeof f?.name !== 'string' || typeof f.status !== 'string' || !(f.message === undefined || typeof f.message === 'string') || !Array.isArray(f.assertionResults)) throw new Error(`not a vitest JSON report file entry: ${JSON.stringify(f).slice(0, 200)}`);
    for (const t of f.assertionResults) if (typeof t?.fullName !== 'string' || typeof t.status !== 'string' || !(t.failureMessages === undefined || (Array.isArray(t.failureMessages) && t.failureMessages.every((m) => typeof m === 'string')))) throw new Error(`not a vitest JSON report test entry: ${JSON.stringify(t).slice(0, 200)}`);
  }
  return v;
}

/** One line per file and test state, then every failing test with its first message line. */
export function describeReports(reports: readonly { readonly group: string; readonly report: Report }[]): { readonly lines: string[]; readonly failed: number } {
  const lines: string[] = [];
  let failed = 0;
  for (const { group, report } of reports) {
    for (const f of report.testResults) {
      const file = f.name.replace(/^.*?\/(packages\/)/, '$1');
      const count = (s: string): number => f.assertionResults.filter((t) => t.status === s).length;
      lines.push(`${group}: ${file}: ${count('passed')} passed, ${count('failed')} failed, ${f.assertionResults.length - count('passed') - count('failed')} skipped`);
      if (f.status === 'failed' && f.assertionResults.length === 0) {
        failed++;
        lines.push(`  FAILED ${file} > (file) ${(f.message ?? '').split('\n')[0]}`);
      }
      for (const t of f.assertionResults.filter((x) => x.status === 'failed')) {
        failed++;
        lines.push(`  FAILED ${file} > ${t.fullName}${t.failureMessages?.[0] ? `: ${t.failureMessages[0].split('\n')[0]}` : ''}`);
      }
    }
  }
  return { lines, failed };
}

/** The jobs that failed, each with the step it failed at. */
export const failedSteps = (jobs: readonly CiJob[]): string[] =>
  jobs.filter((j) => j.conclusion === 'failure' || j.conclusion === 'timed_out' || j.conclusion === 'cancelled').map((j) => `${j.name}: ${j.conclusion} at ${j.steps.find((s) => s.conclusion === 'failure' || s.conclusion === 'cancelled')?.name ?? 'no step'}`);

/** The outcome of a completed run: its reports and floor patches read, and its exit code. A passed run without a report failed. */
export function settle(deps: Deps, repo: string, p: Polled): number {
  const names = artifactNames(deps.gh(['api', `repos/${repo}/actions/runs/${p.run.databaseId}/artifacts?per_page=100`]));
  const reports: { group: string; report: Report }[] = [];
  for (const n of names.filter((x) => x.startsWith('test-files-report-'))) {
    const dir = deps.download(p.run.databaseId, n);
    try {
      const json = readdirSync(dir).filter((x) => x.endsWith('.json'));
      if (json.length !== 1) throw new Error(`the ${n} artifact holds ${json.length} JSON reports, not 1`);
      reports.push({ group: n.slice('test-files-report-'.length), report: parseReport(readFileSync(join(dir, json[0] as string), 'utf8')) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const d = describeReports(reports);
  for (const l of d.lines) deps.log(l);
  for (const n of names.filter((x) => x.startsWith('test-files-floor-'))) deps.log(`floor and pin patch (${n.slice('test-files-floor-'.length)}): git apply ${join(deps.download(p.run.databaseId, n), 'floor.patch')}`);
  if (p.run.conclusion === 'success' && reports.length > 0 && d.failed === 0) {
    deps.log(`PASSED ${p.run.url}`);
    return EXIT.passed;
  }
  for (const s of failedSteps(p.jobs)) deps.log(`failed job ${s}`);
  if (reports.length === 0) deps.log('no test report was uploaded (the files were refused, or no test job ran)');
  deps.log(`FAILED (${p.run.conclusion ?? 'no conclusion'}) ${p.run.url}`);
  return EXIT.failed;
}

export function artifactNames(text: string): string[] {
  const v = JSON.parse(text) as { artifacts?: unknown };
  if (typeof v !== 'object' || v === null || !Array.isArray(v.artifacts)) throw new Error(`unexpected artifacts answer: ${text.slice(0, 200)}`);
  return v.artifacts.map((a: unknown) => {
    const name = (a as { name?: unknown })?.name;
    if (typeof name !== 'string') throw new Error(`unexpected artifact: ${JSON.stringify(a).slice(0, 200)}`);
    return name;
  });
}

/** Waits for the run (or polls it once) and returns the exit code. */
export function waitFor(deps: Deps, repo: string, runId: number, o: { readonly once: boolean; readonly waitS?: number; readonly pollS?: number }): number {
  const t0 = deps.now();
  for (;;) {
    const p = poll(deps, repo, runId);
    if (p.run.status === 'completed') return settle(deps, repo, p);
    if (o.once || deps.now() - t0 > (o.waitS ?? WAIT_S) * 1000) {
      deps.log(`PENDING (${p.run.status}) ${p.run.url}; poll again with: pnpm ci:test-files --run ${runId} --once`);
      return EXIT.pending;
    }
    deps.sleep((o.pollS ?? 30) * 1000);
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
    const runId = a.kind === 'attach' ? a.runId : dispatch(deps, r, a);
    if (a.kind === 'dispatch') deps.log(`dispatched ${WORKFLOW} from ${a.from} for ${a.ref}: run ${runId}`);
    return waitFor(deps, r, runId, { once: a.once });
  } catch (e) {
    deps.log(`ERROR ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.error;
  }
}

const READS = new Set(['run', 'api']);
/** gh, with reads retried on transient failures (never the dispatch, which is not idempotent). */
const gh = (args: string[]): string => {
  const read = READS.has(args[0] as string) && !args.includes('POST');
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      if (!read || attempt >= 4) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(e as { stderr?: string }).stderr?.trim() || (e instanceof Error ? e.message : String(e))}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 5_000);
    }
  }
};

if (import.meta.main) {
  const repo = (): string => repoOf(process.env['GH_REPO'], execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }));
  let r = '';
  const deps: Deps = {
    gh,
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    now: () => Date.now(),
    log: (l) => console.log(l),
    download: (runId, artifact) => {
      const dir = mkdtempSync(join(tmpdir(), `ci-test-files-${runId}-`));
      gh(['run', 'download', String(runId), '-R', (r ||= repo()), '-n', artifact, '-D', dir]);
      return dir;
    },
  };
  process.exit(main(process.argv.slice(2), deps, () => (r ||= repo())));
}
