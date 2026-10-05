// LAND_DEVICES=ci (scripts/land-devices-ci.ts), against a fake GitHub: the dispatch, finding this dispatch's run by its run-name,
// the Mac's half run meanwhile, the wait, the outcomes handed back, and every failure path failing the PR at the devices step
// with the temporary branch deleted.
import { describe, expect, it } from 'vitest';
import { LandFailure } from '../../../scripts/land-lib.ts';
import { abandonInflight, CiUnavailable, failedTestsOf, parseJobs, fullTestWorkflow, runOnCi, testBranch, type DevicesCiDeps, outcomeFiles, OUTCOMES_ARTIFACT, parseRunRows, runDevicesOnCi, runTitle, scratchRef, tempBranch } from '../../../scripts/land-devices-ci.ts';

const SHA = 'a'.repeat(40);
const T0 = Date.parse('2026-10-04T12:00:00Z');
type Run = { databaseId: number; displayTitle: string; createdAt: string; headBranch: string; status: string; conclusion: string | null; url: string };
const OUTCOMES = ['android-dragon-320.json', 'android-dragon-480.json', 'android-dragon-smoke.json', 'ios-iPad__A16__.json', 'ios-iPhone_17.json'];

/** A fake GitHub: runs appear after `appearAfter` list calls and complete after `doneAfter` view calls. */
function fake(o: { runs?: Run[]; appearAfter?: number; doneAfter?: number; conclusion?: string | null; files?: string[]; pushFails?: boolean; ghBad?: boolean; deleteFails?: boolean; title?: string; jobsQueued?: boolean; dispatchFails?: boolean } = {}) {
  const calls: string[] = [];
  let clock = T0;
  let lists = 0;
  let views = 0;
  const mine: Run = { databaseId: 7, displayTitle: o.title ?? runTitle(SHA), createdAt: new Date(T0 + 5_000).toISOString(), headBranch: 'master', status: 'queued', conclusion: null, url: 'https://ci/run/7' };
  const logs: string[] = [];
  const deps: DevicesCiDeps = {
    gh: (args) => {
      calls.push(args.slice(0, 2).join(' '));
      if (args[0] === 'workflow' && o.dispatchFails === true) throw new Error('HTTP 503');
      if (args[0] === 'workflow' || args[1] === 'cancel') return '';
      if (args.includes('jobs')) return JSON.stringify({ jobs: [{ name: 'resolve', status: 'completed' }, { name: 'chrome (1)', status: o.jobsQueued === true ? 'queued' : 'in_progress' }] });
      if (o.ghBad === true) return '{"oops":1}';
      if (args[1] === 'list') return JSON.stringify([...(o.runs ?? []), ...(++lists > (o.appearAfter ?? 0) ? [mine] : [])]);
      const done = ++views > (o.doneAfter ?? 1);
      return JSON.stringify({ databaseId: 7, url: mine.url, status: done ? 'completed' : 'in_progress', conclusion: done ? (o.conclusion === undefined ? 'success' : o.conclusion) : null });
    },
    pushTemp: (branch) => {
      calls.push(`push ${branch}`);
      if (o.pushFails === true) throw new Error('push refused');
      return SHA;
    },
    deleteTemp: (branch) => {
      calls.push(`delete ${branch}`);
      if (o.deleteFails === true) throw new Error('network down');
    },
    download: (id, name) => {
      calls.push(`download ${id} ${name}`);
      return { dir: '/tmp/outcomes', files: o.files ?? OUTCOMES };
    },
    remove: (dir) => void calls.push(`remove ${dir}`),
    record: (x) => void calls.push(`record ${x === null ? 'null' : `${x.branch} ${x.sha === null ? '-' : 'sha'} ${x.runId ?? '-'}`}`),
    sleep: (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: (l) => void logs.push(l),
  };
  return { deps, calls, logs };
}
const run = (f: ReturnType<typeof fake>, waitS = 3600) => runDevicesOnCi({ pr: 42, deps: f.deps, appearS: 300, waitS, pollS: 30 });
const failure = (f: () => unknown): LandFailure => {
  try {
    f();
  } catch (e) {
    if (e instanceof LandFailure) return e;
    throw e;
  }
  throw new Error('no failure');
};

describe('LAND_DEVICES=ci', () => {
  it('dispatches on master for the landing tree, waits, hands back the outcomes and deletes the branch', () => {
    const f = fake({ appearAfter: 1, doneAfter: 2 });
    const r = run(f);
    expect(r).toEqual({ sha: SHA, url: 'https://ci/run/7', outcomesDir: '/tmp/outcomes' });
    expect(f.calls).toEqual([`record ${tempBranch(42)} - -`, `push ${tempBranch(42)}`, `record ${tempBranch(42)} sha -`, 'workflow run', 'run list', 'run list', `record ${tempBranch(42)} sha 7`, 'run view', 'run view', 'run view', `download 7 ${OUTCOMES_ARTIFACT}`, 'record null', `delete ${tempBranch(42)}`]);
  });
  it('takes only a run of this dispatch, not an older run for the same commit', () => {
    const old: Run = { databaseId: 3, displayTitle: runTitle(SHA), createdAt: new Date(T0 - 3_600_000).toISOString(), headBranch: 'master', status: 'completed', conclusion: 'failure', url: 'https://ci/run/3' };
    expect(run(fake({ runs: [old] })).url).toBe('https://ci/run/7');
  });
  it('takes only a run of master\'s workflow, not one dispatched from another branch for the same commit', () => {
    const other: Run = { databaseId: 4, displayTitle: runTitle(SHA), createdAt: new Date(T0 + 1_000).toISOString(), headBranch: 'evil', status: 'completed', conclusion: 'success', url: 'https://ci/run/4' };
    const f = fake({ runs: [other] });
    expect(run(f).url).toBe('https://ci/run/7');
  });
  it('force-pushes only the scratch branch, so one an interrupted run left behind never blocks the next (#135 review)', () => {
    expect(scratchRef(tempBranch(42))).toBe('refs/heads/land-devices/pr-42');
    for (const bad of ['master', 'land-devices/pr-0', 'land-devices/pr-42/x', 'feature', 'land-devices/pr-']) expect(() => scratchRef(bad)).toThrow('is not a land-devices/pr-<n> or land-test/c-<sha> scratch branch');
  });
  it('treats a failed delete of the scratch branch as a warning the next run cleans', () => {
    const f = fake({ deleteFails: true });
    expect(run(f).url).toBe('https://ci/run/7');
    expect(f.logs.at(-1)).toContain('WARNING could not delete land-devices/pr-42 (the next run replaces it): network down');
  });
  it('cancels the CI run when the step fails while it runs, and removes downloaded outcomes it rejects', () => {
    const slow = fake({ doneAfter: 1e9 });
    failure(() => run(slow, 600));
    expect(slow.calls.slice(-3)).toEqual(['run cancel', 'record null', `delete ${tempBranch(42)}`]);
    const red = fake({ ghBad: false, conclusion: null, doneAfter: 1e9 });
    failure(() => run(red, 60));
    expect(red.calls).toContain('run cancel');
    const empty = fake({ files: ['notes.txt'] });
    failure(() => run(empty));
    expect(empty.calls).toContain('remove /tmp/outcomes');
    expect(empty.calls).not.toContain('run cancel');
  });
  it('fails the PR at the devices step, deleting the branch, when the run times out after its jobs started or does not succeed', () => {
    const slow = fake({ doneAfter: 1e9 });
    expect(failure(() => run(slow, 600))).toMatchObject({ step: 'devices', message: 'the CI device lanes run https://ci/run/7 did not finish within 600s (status in_progress)' });
    expect(slow.calls.at(-1)).toBe(`delete ${tempBranch(42)}`);
    const red = fake({ conclusion: 'failure' });
    expect(failure(() => run(red))).toMatchObject({ step: 'devices', message: 'the CI device lanes run https://ci/run/7 concluded failure' });
    expect(red.calls).not.toContain(`download 7 ${OUTCOMES_ARTIFACT}`);
  });
  it('fails on a malformed gh answer, a refused push or an artifact without the records, never reading them as no run', () => {
    expect(failure(() => run(fake({ ghBad: true })))).toMatchObject({ step: 'devices', message: expect.stringContaining('unexpected gh run JSON') });
    const refused = fake({ pushFails: true });
    expect(failure(() => run(refused))).toMatchObject({ step: 'devices', message: 'the CI device lanes failed: push refused' });
    expect(refused.calls).toEqual([`record ${tempBranch(42)} - -`, `push ${tempBranch(42)}`, 'record null']);
    expect(failure(() => run(fake({ files: [] })))).toMatchObject({ message: expect.stringContaining('the device-outcomes artifact holds nothing') });
  });
  it('checks gh run rows and the outcome files', () => {
    expect(parseRunRows('{"databaseId":1,"status":"completed","conclusion":null,"url":"u"}')).toEqual([{ databaseId: 1, displayTitle: '', createdAt: '', headBranch: '', status: 'completed', conclusion: null, url: 'u' }]);
    expect(() => parseRunRows('[{"databaseId":"1","status":"x","conclusion":null,"url":"u"}]')).toThrow('unexpected gh run JSON');
    expect(outcomeFiles(OUTCOMES)).toEqual(OUTCOMES);
    expect(() => outcomeFiles([...OUTCOMES, 'notes.txt'])).toThrow('not device outcome files');
  });
});

describe('an interrupted driver\'s CI run (#135 review)', () => {
  const setup = () => {
    const calls: string[] = [];
    const o = { cancel: (id: number) => void calls.push(`cancel ${id}`), findRuns: (w: string, t: string) => (calls.push(`find ${w} ${t}`), [9]), deleteBranch: (b: string) => void calls.push(`delete ${b}`), log: (l: string) => void calls.push(l) };
    return { calls, o };
  };
  it('is cancelled and its scratch branch deleted by the supervisor; a failure of either is logged, a bad record dropped', () => {
    const { calls, o } = setup();
    abandonInflight(JSON.stringify({ branch: tempBranch(42), runId: 7, sha: SHA, workflow: 'device-lanes.yml' }), o);
    expect(calls).toEqual(['cancel 7', 'cancelled the CI run 7 the interrupted driver left', `delete ${tempBranch(42)}`]);
    calls.length = 0;
    abandonInflight(JSON.stringify({ branch: tempBranch(42), runId: 7 }), { ...o, cancel: () => { throw new Error('ended'); }, deleteBranch: () => { throw new Error('net'); } });
    expect(calls).toEqual(['could not cancel the CI run 7 (it may have ended)', 'could not delete land-devices/pr-42; the next CI run replaces it']);
    calls.length = 0;
    abandonInflight('{', o);
    expect(calls).toEqual(['the CI run record left in flight is not JSON; dropped']);
  });
  it('finds a run whose id was not yet recorded by its unique run-name, for either workflow', () => {
    const { calls, o } = setup();
    abandonInflight(JSON.stringify({ branch: tempBranch(42), runId: null, sha: SHA, workflow: 'device-lanes.yml' }), o);
    expect(calls).toEqual([`find device-lanes.yml ${runTitle(SHA)}`, 'cancel 9', 'cancelled the CI run 9 the interrupted driver left', `delete ${tempBranch(42)}`]);
    calls.length = 0;
    abandonInflight(JSON.stringify({ branch: testBranch(SHA), runId: null, sha: SHA, workflow: 'full-test.yml' }), o);
    expect(calls[0]).toBe(`find full-test.yml full test of ${SHA}`);
    calls.length = 0;
    // Before the push there is no commit yet, so no run either: only the branch is deleted.
    abandonInflight(JSON.stringify({ branch: tempBranch(42), runId: null, sha: null, workflow: 'device-lanes.yml' }), o);
    expect(calls).toEqual([`delete ${tempBranch(42)}`]);
  });
});

describe('GitHub Actions not running the workflow (runners not picking up jobs)', () => {
  const unavailable = (f: () => unknown): CiUnavailable => {
    try {
      f();
    } catch (e) {
      if (e instanceof CiUnavailable) return e;
      throw e;
    }
    throw new Error('no CiUnavailable');
  };
  it('is CiUnavailable, so the driver runs the step locally: a refused dispatch, no run, or no job started', () => {
    const refused = fake({ dispatchFails: true });
    expect(unavailable(() => run(refused)).message).toContain('the dispatch of device-lanes.yml failed: HTTP 503');
    expect(refused.calls.at(-1)).toBe(`delete ${tempBranch(42)}`);
    const never = fake({ appearAfter: 1e9 });
    expect(unavailable(() => run(never)).message).toContain('appeared within 300s');
    const stuck = fake({ doneAfter: 1e9, jobsQueued: true });
    expect(unavailable(() => runDevicesOnCi({ pr: 42, deps: stuck.deps, appearS: 300, waitS: 3600, startS: 600, pollS: 30 })).message).toMatch(/has jobs that never started \(chrome \(1\)\) after \d+s/);
    // The queued run is cancelled and the scratch branch deleted.
    expect(stuck.calls.slice(-3)).toEqual(['run cancel', 'record null', `delete ${tempBranch(42)}`]);
  });
  it('waits for a run whose jobs started, and fails it (not unavailable) when it then runs out of time', () => {
    const slow = fake({ doneAfter: 1e9 });
    expect(failure(() => runDevicesOnCi({ pr: 42, deps: slow.deps, appearS: 300, waitS: 1200, startS: 600, pollS: 30 }))).toMatchObject({ step: 'devices', message: expect.stringContaining('did not finish within 1200s') });
    expect(parseJobs('{"jobs":[{"name":"a","status":"queued"}]}')).toEqual([{ name: 'a', status: 'queued' }]);
    expect(() => parseJobs('{"jobs":[{"name":1}]}')).toThrow('unexpected gh run job');
  });
});

describe('LAND_TEST=ci (the full test on CI)', () => {
  it('proves a commit on its own scratch branch, and a failed run names its failing tests', () => {
    expect(scratchRef(testBranch(SHA))).toBe(`refs/heads/land-test/c-${SHA.slice(0, 12)}`);
    expect(() => scratchRef('land-test/c-xyz')).toThrow('scratch branch');
    const ok = fake({ files: [], title: `full test of ${SHA}` });
    const w = fullTestWorkflow(() => 'FAILED a > b');
    expect(runOnCi(w, { branch: testBranch(SHA), deps: ok.deps, appearS: 300, waitS: 3600, pollS: 30 })).toMatchObject({ sha: SHA, url: 'https://ci/run/7' });
    expect(ok.calls).not.toContain(`download 7 ${OUTCOMES_ARTIFACT}`);
    const red = fake({ conclusion: 'failure', title: `full test of ${SHA}` });
    expect(failure(() => runOnCi(w, { branch: testBranch(SHA), deps: red.deps, appearS: 300, waitS: 3600, pollS: 30 }))).toMatchObject({ step: 'test', message: 'the CI full test run https://ci/run/7 concluded failure:\nFAILED a > b' });
  });
  it('lists the failing tests of full-test-results, or says none is listed', () => {
    const rows = [{ file: 'packages/x/test/a.test.ts', test: 'a', state: 'passed' }, { file: 'packages/x/test/b.test.ts', test: 'b fails', state: 'failed' }];
    expect(failedTestsOf(JSON.stringify(rows))).toBe('FAILED packages/x/test/b.test.ts > b fails');
    expect(failedTestsOf('[]')).toContain('no failing test is listed');
    expect(() => failedTestsOf('{}')).toThrow('not a list');
  });
});
