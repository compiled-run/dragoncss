// pnpm ci:test-files (scripts/ci-test-files.ts): its arguments, the dispatch and run lookup, and the verdict read from the run,
// against a fake gh.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { artifactNames, checkRan, type Deps, describeReports, dispatch, EXIT, main, parseArgs, parseList, parseReport, parseRequest, repoOf, runIdOfDispatch, waitFor } from '../../../scripts/ci-test-files.ts';

const CHROME = 'packages/parity/test/grid-computed.test.ts';
const NATIVE = 'packages/dragon/test/native-backends.test.ts';
const SHA = 'a'.repeat(40);
const NONCE = '0123456789ab';
const report = (failed: boolean, file = CHROME): string =>
  JSON.stringify({ testResults: [{ name: `/w/r/${file}`, status: failed ? 'failed' : 'passed', assertionResults: [{ fullName: 'grid > a', status: 'passed' }, { fullName: 'grid > b', status: failed ? 'failed' : 'passed', failureMessages: ['expected 1 to be 2\n  at x'] }] }] });
const list = (n = 2, file = CHROME): string => JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: `grid > ${i}`, file: `/w/r/${file}` })));
const request = (o: { ref?: string; nonce?: string; files?: string[] } = {}): string => {
  const files = o.files ?? [CHROME];
  return JSON.stringify({ ref: o.ref ?? 'ci-test-files', sha: SHA, nonce: o.nonce ?? NONCE, files, groups: Object.fromEntries(files.map((f) => [f, 'chrome'])) });
};
type Artifact = Record<string, string>;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fake gh: the run moves through the given states, one per view; each artifact holds the given files. */
function fake(o: { states?: readonly { status: string; conclusion: string | null }[]; artifacts?: Record<string, Artifact>; dispatchAnswer?: string; runList?: string }) {
  const calls: string[] = [];
  const logs: string[] = [];
  let views = 0;
  let clock = 1_000_000;
  const states = o.states ?? [{ status: 'completed', conclusion: 'success' }];
  const artifacts = o.artifacts ?? { 'test-files-request': { 'request.json': request() }, 'test-files-report-chrome': { 'chrome.json': report(false), 'chrome.list.json': list() } };
  const deps: Deps = {
    gh: (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'api' && args[2] === 'POST') return o.dispatchAnswer ?? JSON.stringify({ workflow_run_id: 77, run_url: 'x', html_url: 'y' });
      if (args[0] === 'api' && args[1]?.endsWith('/artifacts?per_page=100')) return JSON.stringify({ artifacts: Object.keys(artifacts).map((name) => ({ name })) });
      if (args[0] === 'run' && args[1] === 'list') return o.runList ?? '[]';
      if (args[0] === 'run' && args[1] === 'view') {
        const s = states[Math.min(views++, states.length - 1)]!;
        return JSON.stringify({ databaseId: 77, displayTitle: `test files of ci-test-files (${NONCE})`, headBranch: 'master', headSha: 'b'.repeat(40), ...s, url: 'https://ci/run/77', jobs: s.conclusion === 'failure' ? [{ name: 'chrome', status: 'completed', conclusion: 'failure', steps: [{ name: 'vitest run (the requested files)', status: 'completed', conclusion: 'failure' }] }] : [] });
      }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    sleep: (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: (l) => logs.push(l),
    nonce: () => NONCE,
    download: (_id, name) => {
      const dir = mkdtempSync(join(tmpdir(), 'ci-test-files-test-'));
      dirs.push(dir);
      for (const [f, text] of Object.entries(artifacts[name]!)) writeFileSync(join(dir, f), text);
      return dir;
    },
  };
  return { deps, calls, logs };
}
const expected = { ref: 'ci-test-files', nonce: NONCE, files: [CHROME] };

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
  it('dispatches over REST with the inputs and a nonce, and takes the run from the answer', () => {
    const f = fake({});
    expect(dispatch(f.deps, 'o/r', args)).toEqual({ runId: 77, expected: { ref: 'ci-test-files', nonce: NONCE, files: [NATIVE, CHROME] } });
    expect(f.calls).toEqual([`api -X POST repos/o/r/actions/workflows/test-files.yml/dispatches -f ref=ci-test-files -f inputs[ref]=ci-test-files -f inputs[files]=${CHROME} ${NATIVE} -f inputs[floor_write]=false -f inputs[nonce]=${NONCE} -F return_run_details=true`]);
  });
  it('finds the run by its run-name with the nonce when the answer has no run id, never an earlier run of the same ref', () => {
    const row = (id: number, title: string, branch: string) => ({ databaseId: id, displayTitle: title, createdAt: new Date(1_000_000).toISOString(), headBranch: branch, status: 'queued', conclusion: null, url: `u${id}` });
    const runList = JSON.stringify([row(1, `test files of ci-test-files (${NONCE})`, 'master'), row(2, 'test files of ci-test-files (ffffffffffff)', 'ci-test-files'), row(4, 'test files of ci-test-files', 'ci-test-files'), row(3, `test files of ci-test-files (${NONCE})`, 'ci-test-files')]);
    expect(dispatch(fake({ dispatchAnswer: '', runList }).deps, 'o/r', args).runId).toBe(3);
    const earlier = JSON.stringify([row(2, 'test files of ci-test-files (ffffffffffff)', 'ci-test-files')]);
    expect(() => dispatch(fake({ dispatchAnswer: '', runList: earlier }).deps, 'o/r', args, 30)).toThrow('appeared within 30s');
    expect(() => runIdOfDispatch('{"workflow_run_id":"7"}')).toThrow('unexpected dispatch answer');
    expect(runIdOfDispatch('{}')).toBeNull();
    expect(() => dispatch({ ...fake({}).deps, nonce: () => 'x y' }, 'o/r', args)).toThrow('bad nonce');
  });
  it('exits 0 for a passed run, naming what it tested, 1 for a failed one with its failing tests, 3 while pending with --once', () => {
    const ok = fake({});
    expect(waitFor(ok.deps, 'o/r', 77, { once: false, expected })).toBe(EXIT.passed);
    expect(ok.logs).toContain(`run https://ci/run/77: test-files.yml of master at ${'b'.repeat(40)}`);
    expect(ok.logs).toContain(`tested ci-test-files at ${SHA}: ${CHROME} (chrome)`);
    expect(ok.logs.at(-1)).toBe('PASSED https://ci/run/77');
    const bad = fake({ states: [{ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'failure' }], artifacts: { 'test-files-request': { 'request.json': request() }, 'test-files-report-chrome': { 'chrome.json': report(true), 'chrome.list.json': list() } } });
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
  it('refuses a run that is not the one dispatched (another ref, nonce or file set) as an error', () => {
    for (const r of [request({ ref: 'other' }), request({ nonce: 'ffffffffffff' }), request({ files: [CHROME, NATIVE] })]) {
      const f = fake({ artifacts: { 'test-files-request': { 'request.json': r }, 'test-files-report-chrome': { 'chrome.json': report(false), 'chrome.list.json': list() } } });
      expect(() => waitFor(f.deps, 'o/r', 77, { once: false, expected }), r).toThrow('not the dispatched ci-test-files');
    }
  });
  it('reports a cancelled run as an error: nothing was judged', () => {
    const f = fake({ states: [{ status: 'completed', conclusion: 'cancelled' }] });
    expect(waitFor(f.deps, 'o/r', 77, { once: false })).toBe(EXIT.error);
    expect(f.logs.at(-1)).toContain('CANCELLED https://ci/run/77');
  });
  it('fails a successful run whose reports do not show every requested file run in full, or that has no request', () => {
    const run = (artifacts: Record<string, Artifact>) => {
      const f = fake({ artifacts });
      return { code: waitFor(f.deps, 'o/r', 77, { once: false }), logs: f.logs };
    };
    const req = { 'test-files-request': { 'request.json': request() } };
    expect(run({ 'test-files-report-chrome': { 'chrome.json': report(false), 'chrome.list.json': list() } })).toMatchObject({ code: EXIT.failed });
    expect(run(req)).toMatchObject({ code: EXIT.failed });
    // A filter that left one test of the three vitest collects.
    const filtered = run({ ...req, 'test-files-report-chrome': { 'chrome.json': report(false), 'chrome.list.json': list(3) } });
    expect(filtered.code).toBe(EXIT.failed);
    expect(filtered.logs).toContain(`NOT EVERY TEST RAN ${CHROME}: 2 passed or failed, but vitest collects 3 without filters`);
    const stray = run({ ...req, 'test-files-report-chrome': { 'chrome.json': report(false, NATIVE), 'chrome.list.json': list(2, NATIVE) } });
    expect(stray.logs).toEqual(expect.arrayContaining([`NOT RUN ${CHROME}`, `NOT REQUESTED ${NATIVE}`]));
  });
  it('refuses a report artifact without one report and one list, and removes every downloaded report', () => {
    const f = fake({ artifacts: { 'test-files-request': { 'request.json': request() }, 'test-files-report-chrome': { 'chrome.json': report(false) } } });
    expect(main(['--run', '77'], f.deps, () => 'o/r')).toBe(EXIT.error);
    expect(f.logs.at(-1)).toBe('ERROR the test-files-report-chrome artifact holds 1 vitest reports and 0 vitest lists, not 1 of each');
    const g = fake({});
    const got: string[] = [];
    expect(waitFor({ ...g.deps, download: (id, name) => (got.push(g.deps.download(id, name)), got.at(-1) as string) }, 'o/r', 77, { once: false })).toBe(EXIT.passed);
    expect(got.length).toBe(2);
    expect(got.some((d) => existsSync(d))).toBe(false);
  });
  it('points at the floor patch', () => {
    const f = fake({ artifacts: { 'test-files-request': { 'request.json': request() }, 'test-files-report-chrome': { 'chrome.json': report(false), 'chrome.list.json': list() }, 'test-files-floor-chrome': { 'floor.patch': 'diff --git a b' } } });
    expect(waitFor(f.deps, 'o/r', 77, { once: false })).toBe(EXIT.passed);
    expect(f.logs.some((l) => /^floor and pin patch \(chrome\): git apply .*floor\.patch$/.test(l))).toBe(true);
  });
  it('reports a usage error and a gh error as 2, never as a verdict', () => {
    const f = fake({});
    expect(main(['master'], f.deps, () => 'o/r')).toBe(EXIT.error);
    const broken = fake({});
    expect(main(['ci-test-files', CHROME], { ...broken.deps, gh: () => { throw new Error('HTTP 502'); } }, () => 'o/r')).toBe(EXIT.error);
    expect(main(['ci-test-files', CHROME], f.deps, () => 'o/r')).toBe(EXIT.passed);
  });
  it('reads reports, lists, requests and artifact lists strictly', () => {
    expect(() => parseReport('{}')).toThrow('not a vitest JSON report');
    expect(() => parseReport('{"testResults":[{"name":"a","status":"passed"}]}')).toThrow('file entry');
    expect(() => parseReport('{"testResults":[{"name":"a","status":"failed","assertionResults":[{"fullName":"x","status":"failed","failureMessages":[1]}]}]}')).toThrow('test entry');
    expect(() => parseList('[{"name":"a"}]')).toThrow('not a vitest list');
    expect(() => parseRequest(JSON.stringify({ ref: 'x', sha: 'abc', nonce: '', files: [CHROME], groups: { [CHROME]: 'chrome' } }))).toThrow('not a test-files request');
    expect(() => parseRequest(JSON.stringify({ ref: 'x', sha: SHA, nonce: '', files: [CHROME], groups: {} }))).toThrow('not a test-files request');
    expect(() => artifactNames('{"artifacts":[{}]}')).toThrow('unexpected artifact');
    const collect = describeReports([{ group: 'native', report: parseReport(JSON.stringify({ testResults: [{ name: `/w/${NATIVE}`, status: 'failed', message: 'SyntaxError: x\nmore', assertionResults: [] }] })) }]);
    expect(collect).toEqual({ lines: [`native: ${NATIVE}: 0 passed, 0 failed, 0 skipped`, `  FAILED ${NATIVE} > (file) SyntaxError: x`], failed: 1 });
    // Every test skipped (a -t filter that matched nothing in the file) is not a run.
    const skipped = parseReport(JSON.stringify({ testResults: [{ name: `/w/${CHROME}`, status: 'passed', assertionResults: [{ fullName: 'a', status: 'skipped' }] }] }));
    expect(checkRan([CHROME], [skipped], [parseList(list(1))])).toEqual([`NO TEST RAN ${CHROME} (every test skipped)`]);
  });
});
