// LAND_DEVICES=ci and LAND_TEST=ci (scripts/land-devices-ci.ts), against a fake GitHub: the dispatch, finding this dispatch's run
// by its run-name, the wait, the outcomes handed back; only failed jobs failing the PR, everything else falling back to the local
// step (CiUnavailable); the scratch branch deleted in every case.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LandFailure } from '../../../scripts/land-lib.ts';
import { repoPath } from '../src/paths.ts';
import { abandonInflight, awaitRegenOnCi, CiUnavailable, DEFAULT_QUEUE_WAIT_S, DEFAULT_REGEN_WAIT_S, dispatchOnCi, PATCH_ARTIFACT, patchFiles, regenBranch, regenTitle, regenWorkflow, titleOf, DEFAULT_DEVICES_WAIT_S, DEFAULT_TEST_WAIT_S, failedJobs, failedTestsOf, parseJobs, staleScratchBranches, fullTestWorkflow, runOnCi, testBranch, type DevicesCiDeps, outcomeFiles, OUTCOMES_ARTIFACT, parseRunRows, runDevicesOnCi, runTitle, scratchRef, tempBranch } from '../../../scripts/land-devices-ci.ts';

const SHA = 'a'.repeat(40);
const T0 = Date.parse('2026-10-04T12:00:00Z');
type Run = { databaseId: number; displayTitle: string; createdAt: string; headBranch: string; status: string; conclusion: string | null; url: string };
const OUTCOMES = ['android-dragon-320.json', 'android-dragon-480.json', 'android-dragon-smoke.json', 'ios-iPad__A16__.json', 'ios-iPhone_17.json'];

/** A fake GitHub: runs appear after `appearAfter` list calls and complete after `doneAfter` view calls. */
function fake(o: { runs?: Run[]; appearAfter?: number; doneAfter?: number; conclusion?: string | null; files?: string[]; pushFails?: boolean; ghBad?: boolean; deleteFails?: boolean; title?: string; jobsQueued?: boolean; dispatchFails?: boolean; failedEarly?: boolean; setupFails?: boolean; queuedFor?: number; noneWaiting?: boolean; runPendingNoJobs?: boolean; ubuntu?: 'in_progress' | 'completed' } = {}) {
  const calls: string[] = [];
  const dispatched: string[][] = [];
  let clock = T0;
  let lists = 0;
  let views = 0;
  let finished = false;
  let jobCalls = 0;
  const mine: Run = { databaseId: 7, displayTitle: o.title ?? runTitle(SHA), createdAt: new Date(T0 + 5_000).toISOString(), headBranch: 'master', status: 'queued', conclusion: null, url: 'https://ci/run/7' };
  const logs: string[] = [];
  const deps: DevicesCiDeps = {
    gh: (args) => {
      calls.push(args.slice(0, 2).join(' '));
      if (args[0] === 'workflow') dispatched.push(args);
      if (args[0] === 'workflow' && o.dispatchFails === true) throw new Error('HTTP 503');
      if (args[0] === 'workflow' || args[1] === 'cancel') return '';
      if (args.includes('jobs')) {
        // queuedFor: the real job waits for a runner for that many looks, then runs (the macOS cap); noneWaiting: the run has no
        // real job and none waiting; runPendingNoJobs: the run itself waits (a concurrency group), with no job yet.
        if (o.runPendingNoJobs === true) return JSON.stringify({ jobs: [] });
        if (o.noneWaiting === true) return JSON.stringify({ jobs: [{ name: 'resolve', status: 'completed', conclusion: 'success' }, ...(o.ubuntu === 'completed' ? [{ name: 'platform-free', status: 'completed', conclusion: 'success' }] : [])] });
        // ubuntu: an Ubuntu job of the run, running or done, beside the macOS job (it gets a runner at once).
        const ubuntu = o.ubuntu === undefined ? [] : [{ name: 'platform-free', status: o.ubuntu, conclusion: o.ubuntu === 'completed' ? 'success' : null }];
        if (o.queuedFor !== undefined && ++jobCalls <= o.queuedFor) return JSON.stringify({ jobs: [{ name: 'resolve', status: 'completed', conclusion: 'success' }, ...ubuntu, { name: 'chrome (1)', status: 'queued', conclusion: null }] });
        // The real jobs as the run's state says: queued, running, or done with the run's conclusion (a failure is chrome (1)'s).
        const failed = o.failedEarly === true || (finished && o.conclusion === 'failure');
        // A failed job failed at its test step, or (setupFails) at a setup step before it.
        const steps = failed
          ? [{ name: 'Set up job', status: 'completed', conclusion: 'success' }, o.setupFails === true ? { name: 'Playwright 1.58.2 Chromium, the pinned WPT copy and kotlinc 2.4.20', status: 'completed', conclusion: 'failure' } : { name: 'Playwright 1.58.2 Chromium, the pinned WPT copy and kotlinc 2.4.20', status: 'completed', conclusion: 'success' }, { name: 'vitest run (every other file, shard 1/3)', status: 'completed', conclusion: o.setupFails === true ? 'skipped' : 'failure' }]
          : [];
        const chrome = o.jobsQueued === true ? { status: 'queued', conclusion: null, steps } : failed ? { status: 'completed', conclusion: 'failure', steps } : finished ? { status: 'completed', conclusion: o.conclusion === 'cancelled' ? 'cancelled' : 'success', steps } : { status: 'in_progress', conclusion: null, steps };
        return JSON.stringify({ jobs: [{ name: 'resolve', status: 'completed', conclusion: 'success' }, ...ubuntu, { name: 'chrome (1)', ...chrome }, ...(o.failedEarly === true ? [{ name: 'chrome (2)', status: 'queued', conclusion: null }] : [])] });
      }
      if (o.ghBad === true) return '{"oops":1}';
      if (args[1] === 'list') return JSON.stringify([...(o.runs ?? []), ...(++lists > (o.appearAfter ?? 0) ? [mine] : [])]);
      const done = ++views > (o.doneAfter ?? 1);
      finished = done;
      return JSON.stringify({ databaseId: 7, url: mine.url, status: done ? 'completed' : o.runPendingNoJobs === true ? 'pending' : 'in_progress', conclusion: done ? (o.conclusion === undefined ? 'success' : o.conclusion) : null });
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
  return { deps, calls, logs, dispatched };
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
    for (const bad of ['master', 'land-devices/pr-0', 'land-devices/pr-42/x', 'feature', 'land-devices/pr-']) expect(() => scratchRef(bad)).toThrow('is not a land-devices/pr-<n>, land-test/c-<sha>, land-regen/c-<sha> or land-checks/c-<sha> scratch branch');
  });
  it('treats a failed delete of the scratch branch as a warning the next driver start sweeps (#193 review)', () => {
    const f = fake({ deleteFails: true });
    expect(run(f).url).toBe('https://ci/run/7');
    expect(f.logs.at(-1)).toContain('WARNING could not delete land-devices/pr-42; the next driver start sweeps it: network down');
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
    expect(calls).toEqual(['could not cancel the CI run 7 (it may have ended)', 'could not delete land-devices/pr-42; the next driver start sweeps it']);
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
});

describe('a run queued for a runner is not a run that never started (LAND_CI_QUEUE_WAIT)', () => {
  const unavailable = (f: () => unknown): CiUnavailable => {
    try {
      f();
    } catch (e) {
      if (e instanceof CiUnavailable) return e;
      throw e;
    }
    throw new Error('no CiUnavailable');
  };
  const at = (f: ReturnType<typeof fake>, o: { queueS?: number; waitS?: number; doneAfter?: number } = {}) => runDevicesOnCi({ pr: 42, deps: f.deps, appearS: 300, waitS: o.waitS ?? 3600, startS: 600, pollS: 30, ...(o.queueS === undefined ? {} : { queueS: o.queueS }) });
  it('waits past LAND_CI_START for jobs queued behind busy runners, then judges the run as usual', () => {
    // Queued for about an hour (120 looks at 30 s), far past the 600 s start limit, then runs and passes.
    const f = fake({ queuedFor: 120, doneAfter: 200 });
    const r = at(f);
    expect(r.url).toBe('https://ci/run/7');
    expect(f.logs).toContain('  device lanes on CI: queued, waiting for a runner (chrome (1)); each job waits up to 10800s for one');
    expect(f.logs.filter((l) => l.includes('queued, waiting for a runner'))).toHaveLength(1);
    expect(f.calls).not.toContain('run cancel');
    // The run's own wait counts from its first job's start, so the hour queued is not taken from it.
    // (It starts about 4200 s after the dispatch and ends about 6000 s after it, past a 3000 s wait counted from the dispatch.)
    const late = fake({ queuedFor: 120, doneAfter: 200 });
    expect(at(late, { waitS: 3000 }).url).toBe('https://ci/run/7');
    // A run waiting as a whole (a concurrency group), with no job yet, is queued too.
    const pending = fake({ runPendingNoJobs: true, doneAfter: 100 });
    expect(at(pending).url).toBe('https://ci/run/7');
    expect(pending.logs.some((l) => l.includes('queued, waiting for a runner (none listed)'))).toBe(true);
  });
  it('judges each job on its own: macOS jobs queued while the Ubuntu jobs ran or finished are queued, not "never started"', () => {
    // The Ubuntu job is done at once; the macOS job waits about an hour for a runner, longer than the run's 1200 s wait.
    const done = fake({ ubuntu: 'completed', queuedFor: 120, doneAfter: 160 });
    expect(at(done, { waitS: 1200 }).url).toBe('https://ci/run/7');
    expect(done.calls).not.toContain('run cancel');
    // The Ubuntu job still running beside it, within its own wait.
    const busy = fake({ ubuntu: 'in_progress', queuedFor: 60, doneAfter: 100 });
    expect(at(busy, { waitS: 3600 }).url).toBe('https://ci/run/7');
    // The macOS job past the queue wait is still not run, however the Ubuntu jobs went.
    const stuck = fake({ ubuntu: 'completed', queuedFor: 1e9, doneAfter: 1e9 });
    expect(unavailable(() => at(stuck, { waitS: 1200, queueS: 1800 })).message).toMatch(/has jobs that never started \(chrome \(1\)\) after 18\d\ds, waiting for a runner past the queue wait of 1800s/);
    // A job running past the wait from its own start is cut off, naming it.
    const slow = fake({ ubuntu: 'in_progress', queuedFor: 1e9, doneAfter: 1e9 });
    expect(unavailable(() => at(slow, { waitS: 1200 })).message).toContain('did not finish within 1200s, and no job of it failed (platform-free running past 1200s from its own start)');
    // Every job done but the run not yet completed (its own end, or the next job not queued yet) is not "never started".
    const between = fake({ ubuntu: 'completed', noneWaiting: true, doneAfter: 40 });
    expect(at(between).url).toBe('https://ci/run/7');
    const hung = fake({ ubuntu: 'completed', noneWaiting: true, doneAfter: 1e9 });
    expect(unavailable(() => at(hung, { queueS: 1800 })).message).toMatch(/has had no job running or waiting for a runner for 18\d\ds, and is not completed/);
  });
  it('counts a run still queued past the queue wait as not run (default 3 h), cancelling it', () => {
    const f = fake({ queuedFor: 1e9, doneAfter: 1e9 });
    const e = unavailable(() => at(f, { queueS: 1800 }));
    expect(e.message).toMatch(/has jobs that never started \(chrome \(1\)\) after (18\d\d)s, waiting for a runner past the queue wait of 1800s \(LAND_CI_QUEUE_WAIT\)/);
    expect(f.calls.slice(-3)).toEqual(['run cancel', 'record null', `delete ${tempBranch(42)}`]);
    const d = fake({ queuedFor: 1e9, doneAfter: 1e9 });
    expect(unavailable(() => at(d)).message).toContain('past the queue wait of 10800s');
    expect(DEFAULT_QUEUE_WAIT_S).toBe(3 * 3600);
  });
  it('still counts a run that was never created, or exists with no job started and none waiting, as not run at LAND_CI_START', () => {
    expect(unavailable(() => at(fake({ appearAfter: 1e9 }))).message).toContain('no device-lanes.yml run for');
    const none = fake({ noneWaiting: true, doneAfter: 1e9 });
    const e = unavailable(() => at(none));
    expect(e.message).toMatch(/has jobs that never started \(none waiting for a runner; run in_progress\) after (6[0-4]\d)s/);
    expect(none.calls).toContain('run cancel');
  });
  it('covers the CI regen and the full test too: they share the wait', () => {
    const f = fake({ title: regenTitle(SHA), files: ['outputs.patch'], queuedFor: 120, doneAfter: 200 });
    const d = dispatchOnCi(regenWorkflow('regen'), { branch: regenBranch(SHA), deps: f.deps });
    expect(awaitRegenOnCi('regen', d, { deps: f.deps, appearS: 300, waitS: 3600, startS: 600, queueS: 10800, pollS: 30, apply: () => 0 }).url).toBe('https://ci/run/7');
    expect(f.logs).toContain('  regen on CI: queued, waiting for a runner (chrome (1)); each job waits up to 10800s for one');
  });
});

describe('only failed jobs are a verdict (#193 review)', () => {
  const unavailable = (f: () => unknown): CiUnavailable => {
    try {
      f();
    } catch (e) {
      if (e instanceof CiUnavailable) return e;
      throw e;
    }
    throw new Error('no CiUnavailable');
  };
  it('a run whose real job concluded failure fails the PR at the step, and a downloaded artifact is not read', () => {
    const red = fake({ conclusion: 'failure' });
    expect(failure(() => run(red))).toMatchObject({ step: 'devices', message: 'the CI device lanes run https://ci/run/7 concluded failure; failed jobs: chrome (1) (vitest run (every other file, shard 1/3))' });
    expect(red.calls).not.toContain(`download 7 ${OUTCOMES_ARTIFACT}`);
  });
  it('a job that already failed when the wait runs out is still a verdict, not a fallback', () => {
    const early = fake({ doneAfter: 1e9, failedEarly: true });
    expect(failure(() => runDevicesOnCi({ pr: 42, deps: early.deps, appearS: 300, waitS: 1200, startS: 600, pollS: 30 }))).toMatchObject({ step: 'devices', message: expect.stringContaining('has failed jobs (chrome (1) (vitest run (every other file, shard 1/3)))') });
    expect(early.calls).toContain('run cancel');
  });
  it('everything that judged nothing is CiUnavailable: a wait past its limit with no failed job, a cancelled run, a refused push, gh outages and malformed answers, a bad artifact', () => {
    const slow = fake({ doneAfter: 1e9 });
    expect(unavailable(() => runDevicesOnCi({ pr: 42, deps: slow.deps, appearS: 300, waitS: 1200, startS: 600, pollS: 30 })).message).toContain('did not finish within 1200s, and no job of it failed');
    expect(slow.calls.slice(-3)).toEqual(['run cancel', 'record null', `delete ${tempBranch(42)}`]);
    expect(unavailable(() => run(fake({ conclusion: 'cancelled' }))).message).toContain('concluded cancelled with no failed test or device step');
    const refused = fake({ pushFails: true });
    expect(unavailable(() => run(refused)).message).toBe('the CI device lanes could not be run: push refused');
    expect(refused.calls).toEqual([`record ${tempBranch(42)} - -`, `push ${tempBranch(42)}`, 'record null']);
    expect(unavailable(() => run(fake({ ghBad: true }))).message).toContain('unexpected gh run JSON');
    const empty = fake({ files: [] });
    expect(unavailable(() => run(empty)).message).toContain('the device-outcomes artifact holds nothing');
    expect(empty.calls).toContain('remove /tmp/outcomes');
    expect(parseJobs('{"jobs":[{"name":"a","status":"queued"}]}')).toEqual([{ name: 'a', status: 'queued', conclusion: null, steps: [] }]);
    expect(() => parseJobs('{"jobs":[{"name":1}]}')).toThrow('unexpected gh run job');
  });
  it('judges a failed job by its failed step: only a test, regen or device step blames the tree; setup falls back (#193 review)', () => {
    const step = (name: string, conclusion: string, status = 'completed') => ({ name, status, conclusion });
    const job = (name: string, conclusion: string, steps: ReturnType<typeof step>[]) => ({ name, status: 'completed', conclusion, steps });
    const jobs = [
      job('resolve', 'failure', [step('Run echo', 'failure')]),
      job('chrome (1)', 'failure', [step('Set up job', 'success'), step('Run pnpm install --frozen-lockfile', 'failure'), step('vitest run (every other file, shard 1/3)', 'skipped')]),
      job('native (2)', 'failure', [step('Swift 6.4.0 (swift.org) and kotlinc 2.4.20', 'failure')]),
      job('chrome (2)', 'failure', [step('Playwright 1.58.2 Chromium and the WPT copy', 'success'), step('vitest run (every other file, shard 2/3)', 'failure')]),
      job('regen-chrome', 'failure', [step('pnpm regen --check (every step but lanes-host)', 'failure')]),
      job('ios (iPhone 17)', 'failure', [step('The pinned iOS 26.5 (23F77) simulator runtime', 'failure')]),
      job('android (dragon-320)', 'failure', [step('Device run dragon-320', 'failure')]),
      job('native (3)', 'timed_out', [step('vitest run (native files, shard 3/4)', 'cancelled')]),
      job('chrome (3)', 'cancelled', [step('vitest run (every other file, shard 3/3)', 'cancelled')]),
    ];
    expect(failedJobs(jobs)).toEqual({
      verdict: ['chrome (2) (vitest run (every other file, shard 2/3))', 'regen-chrome (pnpm regen --check (every step but lanes-host))', 'android (dragon-320) (Device run dragon-320)', 'native (3) (vitest run (native files, shard 3/4))'],
      setup: ['chrome (1) (Run pnpm install --frozen-lockfile)', 'native (2) (Swift 6.4.0 (swift.org) and kotlinc 2.4.20)', 'ios (iPhone 17) (The pinned iOS 26.5 (23F77) simulator runtime)'],
    });
    // A run whose only failure is in setup never blames the PR: the step runs locally instead.
    const setup = fake({ conclusion: 'failure', setupFails: true });
    expect(unavailable(() => run(setup)).message).toContain('with no failed test or device step (failed in setup: chrome (1) (Playwright 1.58.2 Chromium, the pinned WPT copy and kotlinc 2.4.20))');
    const early = fake({ doneAfter: 1e9, failedEarly: true, setupFails: true });
    expect(unavailable(() => runDevicesOnCi({ pr: 42, deps: early.deps, appearS: 300, waitS: 1200, startS: 600, pollS: 30 })).message).toContain('failed in setup (chrome (1) (Playwright');
    expect(() => parseJobs('{"jobs":[{"name":"a","status":"completed","steps":[{"name":1}]}]}')).toThrow('unexpected gh run step');
  });
  it('does not blame the tree for a summary that failed because a shard died in setup and wrote no report (#199 review)', () => {
    const job = (name: string, stepName: string) => ({ name, status: 'completed', conclusion: 'failure', steps: [{ name: stepName, status: 'completed', conclusion: 'failure' }] });
    const swift = job('native (2)', 'Swift 6.4.0 (swift.org) and kotlinc 2.4.20');
    const summary = job('summary', "Every test's state, and the failures");
    expect(failedJobs([swift, summary])).toEqual({ verdict: [], setup: ['native (2) (Swift 6.4.0 (swift.org) and kotlinc 2.4.20)', "summary (Every test's state, and the failures)"] });
    // With every shard through its setup, a failing summary is the tree's (a failed test, a file not run).
    expect(failedJobs([summary]).verdict).toEqual(["summary (Every test's state, and the failures)"]);
    // A shard's own failed tests still blame the tree beside another shard's setup failure.
    expect(failedJobs([swift, job('chrome (1)', 'vitest run (every other file, shard 1/3)'), summary]).verdict).toEqual(['chrome (1) (vitest run (every other file, shard 1/3))']);
  });
  it('waits at least as long as the longest chain of job timeouts in each workflow', () => {
    const minutes = (f: string): number[] => [...readFileSync(repoPath(`.github/workflows/${f}`), 'utf8').matchAll(/timeout-minutes: (\d+)/g)].map((m) => Number(m[1]));
    const full = minutes('full-test.yml');
    // A Chrome shard, then regen-chrome after it: the two longest timeouts in a row.
    const [a, b] = [...full].sort((x, y) => y - x);
    expect(DEFAULT_TEST_WAIT_S).toBeGreaterThanOrEqual(((a ?? 0) + (b ?? 0)) * 60);
    expect(DEFAULT_DEVICES_WAIT_S).toBeGreaterThanOrEqual(Math.max(...minutes('device-lanes.yml')) * 60 + 15 * 60);
  });
  it('sweeps only the driver\'s scratch branches left on the remote', () => {
    const ls = [`${SHA}\trefs/heads/land-devices/pr-42`, `${SHA}\trefs/heads/land-test/c-${SHA.slice(0, 12)}`, `${SHA}\trefs/heads/land-regen/c-${SHA.slice(0, 12)}`, `${SHA}\trefs/heads/land-regen/other`, `${SHA}\trefs/heads/land-test/other`, `${SHA}\trefs/heads/master`, `${SHA}\trefs/heads/land-devices/pr-42/x`].join('\n');
    expect(staleScratchBranches(ls)).toEqual(['land-devices/pr-42', `land-regen/c-${SHA.slice(0, 12)}`, `land-test/c-${SHA.slice(0, 12)}`]);
  });
});

describe('the driver\'s full test skips the regen check its build already made', () => {
  it('dispatches full-test.yml with regen=false, an input whose regen jobs run only when it is true', () => {
    expect(fullTestWorkflow(() => null).inputs).toEqual(['regen=false']);
    const yml = readFileSync(repoPath('.github/workflows/full-test.yml'), 'utf8');
    expect(yml).toMatch(/\n {6}regen:\n {8}description: [^\n]+\n {8}required: false\n {8}default: true\n {8}type: boolean\n/);
    for (const job of ['regen-chrome', 'regen-host']) {
      const block = yml.slice(yml.indexOf(`\n  ${job}:\n`), yml.indexOf(`\n  ${job}:\n`) + 300);
      // Beside the shards (needs only resolve), and skipped for a dispatch with regen=false.
      expect(block, job).toContain(`  ${job}:\n    needs: resolve\n    if: github.event_name != 'workflow_dispatch' || inputs.regen\n`);
    }
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
    expect(failure(() => runOnCi(w, { branch: testBranch(SHA), deps: red.deps, appearS: 300, waitS: 3600, pollS: 30 }))).toMatchObject({ step: 'test', message: 'the CI full test run https://ci/run/7 concluded failure; failed jobs: chrome (1) (vitest run (every other file, shard 1/3)):\nFAILED a > b' });
  });
  it('lists the failing tests of full-test-results, or says none is listed', () => {
    const rows = [{ file: 'packages/x/test/a.test.ts', test: 'a', state: 'passed' }, { file: 'packages/x/test/b.test.ts', test: 'b fails', state: 'failed' }];
    expect(failedTestsOf(JSON.stringify(rows))).toBe('FAILED packages/x/test/b.test.ts > b fails');
    expect(failedTestsOf('[]')).toContain('no failing test is listed');
    expect(() => failedTestsOf('{}')).toThrow('not a list');
  });
});

describe('LAND_REGEN=ci (the regen on CI, regen-on-ci.yml in patch mode)', () => {
  const yml = readFileSync(repoPath('.github/workflows/regen-on-ci.yml'), 'utf8');
  const round = readFileSync(repoPath('.github/workflows/regen-on-ci-round.yml'), 'utf8');
  const regen = (f: ReturnType<typeof fake>, step = 'regen', apply: (patch: string) => number = () => 0) => {
    const d = dispatchOnCi(regenWorkflow(step), { branch: regenBranch(SHA), deps: f.deps });
    return awaitRegenOnCi(step, d, { deps: f.deps, appearS: 300, waitS: 3600, pollS: 30, apply });
  };
  it('names its scratch branch land-regen/c-<sha12>, the only other ref the driver may push or delete', () => {
    expect(regenBranch(SHA)).toBe(`land-regen/c-${SHA.slice(0, 12)}`);
    expect(scratchRef(regenBranch(SHA))).toBe(`refs/heads/land-regen/c-${SHA.slice(0, 12)}`);
    for (const bad of ['land-regen/c-xyz', `land-regen/c-${SHA}`, 'land-regen/pr-42', 'land-regen/c-', `land-regen/c-${SHA.slice(0, 12)}/x`]) expect(() => scratchRef(bad), bad).toThrow('scratch branch');
  });
  it('dispatches regen-on-ci.yml on master with the commit alone, finds its run by "regen of <sha>", applies its patch and logs the run URL', () => {
    const f = fake({ title: regenTitle(SHA), files: ['outputs.patch'] });
    const applied: string[] = [];
    const r = regen(f, 'regen', (p) => (applied.push(p), 1234));
    expect(r).toEqual({ url: 'https://ci/run/7', bytes: 1234 });
    expect(f.dispatched).toEqual([['workflow', 'run', 'regen-on-ci.yml', '--ref', 'master', '-f', `sha=${SHA}`]]);
    expect(applied).toEqual(['/tmp/outcomes/outputs.patch']);
    expect(f.calls).toContain(`download 7 ${PATCH_ARTIFACT}`);
    // The patch is applied before the artifact is removed and the scratch branch deleted.
    expect(f.calls.slice(-3)).toEqual(['record null', `delete ${regenBranch(SHA)}`, 'remove /tmp/outcomes']);
    expect(f.logs).toContain('  regen on CI: https://ci/run/7');
    expect(f.logs.at(-1)).toBe('  regen on CI: applied the 1234-byte outputs.patch of https://ci/run/7');
    const fixed = fake({ title: regenTitle(SHA), files: ['outputs.patch'] });
    expect(regen(fixed).bytes).toBe(0);
    expect(fixed.logs.at(-1)).toBe(`  regen on CI: ${SHA} is at its fixed point; nothing to apply (https://ci/run/7)`);
  });
  it('takes exactly outputs.patch from the regen-patch artifact', () => {
    expect(patchFiles(['outputs.patch'])).toEqual(['outputs.patch']);
    for (const bad of [[], ['store.tgz'], ['outputs.patch', 'store.tgz']]) expect(() => patchFiles(bad), bad.join()).toThrow('not exactly outputs.patch');
  });
  it('blames the PR at the call site\'s step only when a regen round failed on CI; a patch that does not apply, a bad artifact or no run judged nothing', () => {
    expect(failure(() => regen(fake({ title: regenTitle(SHA), conclusion: 'failure' }), 'regen-after-devices'))).toMatchObject({ step: 'regen-after-devices', message: expect.stringContaining('the CI regen run https://ci/run/7 concluded failure') });
    const step = (name: string) => [{ name: 'chrome-1 / round', status: 'completed', conclusion: 'failure', steps: [{ name, status: 'completed', conclusion: 'failure' }] }];
    expect(failedJobs(step('pnpm regen --skip lanes-host --skip tw-sweep')).verdict).toHaveLength(1);
    expect(failedJobs(step('pnpm regen --only lanes-host')).verdict).toHaveLength(1);
    expect(failedJobs([{ name: 'converge', status: 'completed', conclusion: 'failure', steps: [{ name: 'Pick the last round', status: 'completed', conclusion: 'failure' }] }]).verdict).toHaveLength(1);
    expect(failedJobs(step('Host side - JDK 17 and kotlinc, checked against the toolchains lanes.json records')).setup).toHaveLength(1);
    expect(failedJobs(step('Chrome side - fetch the WPT copy when the cache missed')).setup).toHaveLength(1);
    // A regen cut off (the job's 300-min timeout, a lost runner, a cancel) judged nothing: only a regen step that ran to its end
    // and failed blames the tree (#220 review).
    const cut = (jobConclusion: string, stepStatus: string, stepConclusion: string | null) => failedJobs([{ name: 'chrome-1 / round', status: 'completed', conclusion: jobConclusion, steps: [{ name: 'Set up job', status: 'completed', conclusion: 'success' }, { name: 'pnpm regen --skip lanes-host --skip tw-sweep', status: stepStatus, conclusion: stepConclusion }] }]);
    expect(cut('timed_out', 'completed', 'cancelled')).toEqual({ verdict: [], setup: ['chrome-1 / round (pnpm regen --skip lanes-host --skip tw-sweep)'] });
    expect(cut('failure', 'in_progress', null).verdict).toEqual([]);
    expect(cut('failure', 'completed', 'cancelled').verdict).toEqual([]);
    expect(cut('failure', 'completed', 'failure').verdict).toEqual(['chrome-1 / round (pnpm regen --skip lanes-host --skip tw-sweep)']);
    // Other workflows' verdicts are judged as before: a timed-out test shard is still the tree's.
    expect(failedJobs([{ name: 'native (3)', status: 'completed', conclusion: 'timed_out', steps: [{ name: 'vitest run (native files, shard 3/4)', status: 'completed', conclusion: 'cancelled' }] }]).verdict).toHaveLength(1);
    const unavailable = (f: () => unknown): CiUnavailable => {
      try {
        f();
      } catch (e) {
        if (e instanceof CiUnavailable) return e;
        throw e;
      }
      throw new Error('no CiUnavailable');
    };
    const bad = fake({ title: regenTitle(SHA), files: ['outputs.patch'] });
    expect(unavailable(() => regen(bad, 'regen', () => { throw new Error('patch does not apply'); })).message).toBe('the patch of the CI regen https://ci/run/7 could not be applied: patch does not apply');
    expect(bad.calls.at(-1)).toBe('remove /tmp/outcomes');
    expect(unavailable(() => regen(fake({ title: regenTitle(SHA), files: ['outputs.patch', 'store.tgz'] }))).message).toContain('not exactly outputs.patch');
    const none = fake({ title: regenTitle(SHA), appearAfter: 1e9 });
    expect(unavailable(() => regen(none)).message).toContain('no regen-on-ci.yml run for');
    expect(none.calls.slice(-2)).toEqual(['record null', `delete ${regenBranch(SHA)}`]);
    const refused = fake({ dispatchFails: true });
    expect(unavailable(() => dispatchOnCi(regenWorkflow('regen'), { branch: regenBranch(SHA), deps: refused.deps })).message).toContain('the dispatch of regen-on-ci.yml failed');
    expect(refused.calls.slice(-2)).toEqual(['record null', `delete ${regenBranch(SHA)}`]);
  });
  it('an interrupted driver\'s CI regen is found by its run-name and cancelled', () => {
    expect(titleOf('regen-on-ci.yml', SHA)).toBe(`regen of ${SHA}`);
    const calls: string[] = [];
    abandonInflight(JSON.stringify({ branch: regenBranch(SHA), runId: null, sha: SHA, workflow: 'regen-on-ci.yml' }), { cancel: (id) => void calls.push(`cancel ${id}`), findRuns: (w, t) => (calls.push(`find ${w} ${t}`), [9]), deleteBranch: (b) => void calls.push(`delete ${b}`), log: () => {} });
    expect(calls).toEqual([`find regen-on-ci.yml regen of ${SHA}`, 'cancel 9', `delete ${regenBranch(SHA)}`]);
  });
  it('waits at least as long as the longest chain of regen rounds may run', () => {
    const minutes = [...round.matchAll(/timeout-minutes: (\d+)/g)].map((m) => Number(m[1]));
    expect(minutes.length).toBeGreaterThan(0);
    const rounds = [...yml.matchAll(/uses: \.\/\.github\/workflows\/regen-on-ci-round\.yml/g)].length;
    expect(rounds).toBe(6);
    expect(DEFAULT_REGEN_WAIT_S).toBeGreaterThanOrEqual(rounds * Math.max(...minutes) * 60);
  });
  it('master\'s warm cache run yields to branch regens but never to the driver\'s patch-mode runs (#220 review)', () => {
    const resolve = yml.slice(yml.indexOf('\n  resolve:\n'), yml.indexOf('\n  chrome-1:\n'));
    const filter = /gh api "repos\/\$REPO\/actions\/workflows\/regen-on-ci\.yml\/runs\?status=\$st&per_page=100" -q '([^']+)'/.exec(resolve)?.[1];
    expect(filter).toBe('[.workflow_runs[] | select(.event != "push" and (.event != "workflow_dispatch" or ((.display_title // "") | startswith("regen of ") | not)))] | length');
    // The patch-mode run-name is the prefix the filter skips, and only patch mode gets it.
    expect(regenTitle(SHA).startsWith('regen of ')).toBe(true);
    expect(yml).toContain("run-name: ${{ inputs.sha && format('regen of {0}', inputs.sha) ||");
  });
  it('the workflow\'s patch mode: run-name "regen of <sha>", no push, the patch as an artifact, caches restored only; branch mode unchanged', () => {
    expect(yml).toContain("run-name: ${{ inputs.sha && format('regen of {0}', inputs.sha) ||");
    expect(yml).toMatch(/\n {6}sha:\n {8}description: [^\n]+\n {8}required: false\n {8}type: string\n/);
    expect(yml).toContain('echo "mode=patch"');
    // Each round is told not to save in patch mode, and the round saves only when told to.
    const calls = [...yml.matchAll(/uses: \.\/\.github\/workflows\/regen-on-ci-round\.yml\n {4}with: \{([^\n]*)\}/g)].map((m) => m[1]!);
    expect(calls).toHaveLength(6);
    for (const c of calls) expect(c).toContain(`save_cache: "\${{ needs.resolve.outputs.mode != 'patch' }}"`);
    expect(round).toContain('save_cache: { type: boolean, required: false, default: true }');
    expect(round).toMatch(/- name: Save the regen cache\n {8}if: success\(\) && inputs\.save_cache\n {8}uses: actions\/cache\/save@v4/);
    // setup-node's pnpm cache saves in a post step: off unless the round may save (#220 review).
    expect([...round.matchAll(/\n {10}cache: ([^\n]+)/g)].map((m) => m[1])).toEqual(["${{ inputs.save_cache && 'pnpm' || '' }}"]);
    // Every cache step that saves (actions/cache or actions/cache/save) is gated on save_cache.
    const steps = round.split(/\n {6}- /).filter((st) => /uses: actions\/cache(\/save)?@/.test(st));
    expect(steps.length).toBe(2);
    for (const st of steps) expect(st, st.split('\n')[0]).toMatch(/if: [^\n]*inputs\.save_cache/);
    // The push job runs only in branch mode; the patch job only in patch mode, and uploads the combined patch.
    expect(yml).toContain("if: always() && needs.sweep.result == 'success' && needs.resolve.outputs.mode == 'push'");
    expect(yml).toContain("if: always() && needs.sweep.result == 'success' && needs.resolve.outputs.mode == 'patch'");
    const from = yml.indexOf('\n  patch:\n');
    const patch = yml.slice(from, yml.indexOf('\n  push:\n', from));
    expect(from).toBeGreaterThan(yml.indexOf('\njobs:\n'));
    expect(patch).toContain(`name: ${PATCH_ARTIFACT}`);
    expect(patch).toContain('path: ${{ runner.temp }}/patch/outputs.patch');
    expect(patch).not.toMatch(/git push|contents: write/);
  });
});
