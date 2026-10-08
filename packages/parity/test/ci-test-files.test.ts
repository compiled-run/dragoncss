// pnpm ci:test-files (scripts/ci-test-files.ts): its arguments, the dispatch and run lookup, and the verdict read from the run,
// against a fake gh.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { artifactNames, type Deps, describeReports, dispatch, EXIT, main, parseArgs, parseReport, repoOf, runIdOfDispatch, waitFor } from '../../../scripts/ci-test-files.ts';

const CHROME = 'packages/parity/test/grid-computed.test.ts';
const NATIVE = 'packages/dragon/test/native-backends.test.ts';
const report = (failed: boolean): string =>
  JSON.stringify({ testResults: [{ name: `/w/r/${CHROME}`, status: failed ? 'failed' : 'passed', assertionResults: [{ fullName: 'grid > a', status: 'passed' }, { fullName: 'grid > b', status: failed ? 'failed' : 'passed', failureMessages: ['expected 1 to be 2\n  at x'] }] }] });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fake gh: the run moves through the given states, one per view; artifacts hold the given reports. */
function fake(o: { states?: readonly { status: string; conclusion: string | null }[]; artifacts?: Record<string, string>; dispatchAnswer?: string; runList?: string }) {
  const calls: string[] = [];
  const logs: string[] = [];
  let views = 0;
  let clock = 1_000_000;
  const states = o.states ?? [{ status: 'completed', conclusion: 'success' }];
  const artifacts = o.artifacts ?? { 'test-files-report-chrome': report(false) };
  const deps: Deps = {
    gh: (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'api' && args[2] === 'POST') return o.dispatchAnswer ?? JSON.stringify({ workflow_run_id: 77, run_url: 'x', html_url: 'y' });
      if (args[0] === 'api' && args[1]?.endsWith('/artifacts?per_page=100')) return JSON.stringify({ artifacts: Object.keys(artifacts).map((name) => ({ name })) });
      if (args[0] === 'run' && args[1] === 'list') return o.runList ?? '[]';
      if (args[0] === 'run' && args[1] === 'view') {
        const s = states[Math.min(views++, states.length - 1)]!;
        return JSON.stringify({ databaseId: 77, ...s, url: 'https://ci/run/77', jobs: s.conclusion === 'failure' ? [{ name: 'chrome', status: 'completed', conclusion: 'failure', steps: [{ name: 'vitest run (the requested files)', status: 'completed', conclusion: 'failure' }] }] : [] });
      }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    sleep: (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: (l) => logs.push(l),
    download: (_id, name) => {
      const dir = mkdtempSync(join(tmpdir(), 'ci-test-files-test-'));
      dirs.push(dir);
      if (name.startsWith('test-files-report-')) writeFileSync(join(dir, `${name.slice(18)}.json`), artifacts[name]!);
      else writeFileSync(join(dir, 'floor.patch'), artifacts[name]!);
      return dir;
    },
  };
  return { deps, calls, logs };
}

describe('pnpm ci:test-files arguments', () => {
  it('takes a ref and test files, and refuses flags, spaces and paths outside the test files', () => {
    expect(parseArgs(['ci-test-files', CHROME, NATIVE, '--once', '--from', 'ci-test-files', '--floor-write'])).toEqual({ kind: 'dispatch', ref: 'ci-test-files', files: [CHROME, NATIVE], floorWrite: true, from: 'ci-test-files', once: true });
    expect(parseArgs(['abc123', CHROME])).toMatchObject({ from: 'master', once: false, floorWrite: false });
    expect(parseArgs(['--run', '123', '--once'])).toEqual({ kind: 'attach', runId: 123, once: true });
    expect(() => parseArgs(['master'])).toThrow('usage');
    expect(() => parseArgs([])).toThrow('usage');
    expect(() => parseArgs(['master', '-t', CHROME])).toThrow('unknown option -t');
    expect(() => parseArgs(['master', 'packages/parity/test/a b.test.ts'])).toThrow('not test file paths');
    expect(() => parseArgs(['master', 'packages/parity/src/chrome.ts'])).toThrow('not test file paths');
    expect(() => parseArgs(['master', '../x/packages/a.test.ts'])).toThrow('not test file paths');
    expect(() => parseArgs(['-x', CHROME])).toThrow('unknown option');
    expect(() => parseArgs(['a..b', CHROME])).toThrow('not a commit sha or branch name');
    expect(() => parseArgs(['master', CHROME, '--from'])).toThrow('--from needs a value');
    expect(() => parseArgs(['--run', '12x'])).toThrow('not a run id');
    expect(() => parseArgs(['--run', '12', 'master'])).toThrow('--run takes no ref');
  });
  it('takes the repository from GH_REPO or the origin URL', () => {
    expect(repoOf(undefined, 'git@github.com:compiled-run/dragoncss.git\n')).toBe('compiled-run/dragoncss');
    expect(repoOf('', 'https://github.com/compiled-run/dragoncss')).toBe('compiled-run/dragoncss');
    expect(repoOf('a/b', 'whatever')).toBe('a/b');
    expect(() => repoOf(undefined, '/local/path')).toThrow('set GH_REPO');
  });
});

describe('pnpm ci:test-files dispatch and verdict', () => {
  const args = parseArgs(['ci-test-files', CHROME, NATIVE, '--from', 'ci-test-files']) as Extract<ReturnType<typeof parseArgs>, { kind: 'dispatch' }>;
  it('dispatches over REST with the inputs and takes the run from the answer', () => {
    const f = fake({});
    expect(dispatch(f.deps, 'o/r', args)).toBe(77);
    expect(f.calls).toEqual([`api -X POST repos/o/r/actions/workflows/test-files.yml/dispatches -f ref=ci-test-files -f inputs[ref]=ci-test-files -f inputs[files]=${CHROME} ${NATIVE} -f inputs[floor_write]=false -F return_run_details=true`]);
  });
  it('finds the run by its run-name when the answer has no run id, only one dispatched after it from the same branch', () => {
    const row = (id: number, title: string, branch: string, at: number) => ({ databaseId: id, displayTitle: title, createdAt: new Date(at).toISOString(), headBranch: branch, status: 'queued', conclusion: null, url: `u${id}` });
    const runList = JSON.stringify([row(1, 'test files of ci-test-files', 'master', 1_000_000), row(2, 'test files of ci-test-files', 'ci-test-files', 1_000_000 - 600_000), row(3, 'test files of ci-test-files', 'ci-test-files', 1_000_000)]);
    expect(dispatch(fake({ dispatchAnswer: '', runList }).deps, 'o/r', args)).toBe(3);
    expect(() => dispatch(fake({ dispatchAnswer: '', runList: '[]' }).deps, 'o/r', args, 30)).toThrow('appeared within 30s');
    expect(() => runIdOfDispatch('{"workflow_run_id":"7"}')).toThrow('unexpected dispatch answer');
    expect(runIdOfDispatch('{}')).toBeNull();
  });
  it('exits 0 for a passed run, 1 for a failed one with its failing tests, 3 while pending with --once', () => {
    const ok = fake({});
    expect(waitFor(ok.deps, 'o/r', 77, { once: false })).toBe(EXIT.passed);
    expect(ok.logs.at(-1)).toBe('PASSED https://ci/run/77');
    const bad = fake({ states: [{ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'failure' }], artifacts: { 'test-files-report-chrome': report(true) } });
    expect(waitFor(bad.deps, 'o/r', 77, { once: false })).toBe(EXIT.failed);
    expect(bad.logs).toContain(`  FAILED ${CHROME} > grid > b: expected 1 to be 2`);
    expect(bad.logs).toContain('failed job chrome: failure at vitest run (the requested files)');
    const pending = fake({ states: [{ status: 'queued', conclusion: null }] });
    expect(waitFor(pending.deps, 'o/r', 77, { once: true })).toBe(EXIT.pending);
    expect(pending.logs.at(-1)).toContain('pnpm ci:test-files --run 77 --once');
    expect(pending.calls.filter((c) => c.startsWith('run view'))).toHaveLength(1);
    // A wait past its limit is pending, never a verdict.
    expect(waitFor(fake({ states: [{ status: 'queued', conclusion: null }] }).deps, 'o/r', 77, { once: false, waitS: 60 })).toBe(EXIT.pending);
  });
  it('refuses a report artifact without exactly one report, and removes every downloaded report', () => {
    const f = fake({ artifacts: { 'test-files-report-chrome': report(false) } });
    const empty = { ...f.deps, download: (id: number, name: string): string => { const d = f.deps.download(id, name); rmSync(join(d, 'chrome.json')); return d; } };
    expect(main(['--run', '77'], empty, () => 'o/r')).toBe(EXIT.error);
    expect(f.logs.at(-1)).toBe('ERROR the test-files-report-chrome artifact holds 0 JSON reports, not 1');
    const g = fake({});
    let got = '';
    expect(waitFor({ ...g.deps, download: (id, name) => (got = g.deps.download(id, name)) }, 'o/r', 77, { once: false })).toBe(EXIT.passed);
    expect(existsSync(got)).toBe(false);
  });
  it('fails a successful run that uploaded no report, and points at the floor patch', () => {
    expect(waitFor(fake({ artifacts: {} }).deps, 'o/r', 77, { once: false })).toBe(EXIT.failed);
    const f = fake({ artifacts: { 'test-files-report-chrome': report(false), 'test-files-floor-chrome': 'diff --git a b' } });
    expect(waitFor(f.deps, 'o/r', 77, { once: false })).toBe(EXIT.passed);
    expect(f.logs.some((l) => /^floor and pin patch \(chrome\): git apply .*floor\.patch$/.test(l))).toBe(true);
  });
  it('reports a usage error and a gh error as 2, never as a verdict', () => {
    const f = fake({});
    expect(main(['master'], f.deps, () => 'o/r')).toBe(EXIT.error);
    const broken = fake({});
    expect(main(['master', CHROME], { ...broken.deps, gh: () => { throw new Error('HTTP 502'); } }, () => 'o/r')).toBe(EXIT.error);
    expect(main(['master', CHROME], f.deps, () => 'o/r')).toBe(EXIT.passed);
  });
  it('reads reports and artifact lists strictly', () => {
    expect(() => parseReport('{}')).toThrow('not a vitest JSON report');
    expect(() => parseReport('{"testResults":[{"name":"a","status":"passed"}]}')).toThrow('file entry');
    expect(() => artifactNames('{"artifacts":[{}]}')).toThrow('unexpected artifact');
    expect(() => parseReport('{"testResults":[{"name":"a","status":"failed","assertionResults":[{"fullName":"x","status":"failed","failureMessages":[1]}]}]}')).toThrow('test entry');
    const collect = describeReports([{ group: 'native', report: parseReport(JSON.stringify({ testResults: [{ name: `/w/${NATIVE}`, status: 'failed', message: 'SyntaxError: x\nmore', assertionResults: [] }] })) }]);
    expect(collect).toEqual({ lines: [`native: ${NATIVE}: 0 passed, 0 failed, 0 skipped`, `  FAILED ${NATIVE} > (file) SyntaxError: x`], failed: 1 });
  });
});
