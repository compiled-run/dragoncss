// LAND_DEVICES=ci (scripts/land-devices-ci.ts), against a fake GitHub: the dispatch, finding this dispatch's run by its run-name,
// the wait, the records handed back, and every failure path failing the PR at the devices step with the temporary branch deleted.
import { describe, expect, it } from 'vitest';
import { LandFailure } from '../../../scripts/land-lib.ts';
import { DEVICE_RECORDS, type DevicesCiDeps, deviceRecords, parseRunRows, runDevicesOnCi, runTitle, tempBranch } from '../../../scripts/land-devices-ci.ts';

const SHA = 'a'.repeat(40);
const T0 = Date.parse('2026-10-04T12:00:00Z');
type Run = { databaseId: number; displayTitle: string; createdAt: string; status: string; conclusion: string | null; url: string };
const RECORDS: Record<string, string> = Object.fromEntries(DEVICE_RECORDS.map((n) => [n, `{"file":"${n}"}\n`]));

/** A fake GitHub: runs appear after `appearAfter` list calls and complete after `doneAfter` view calls. */
function fake(o: { runs?: Run[]; appearAfter?: number; doneAfter?: number; conclusion?: string | null; records?: Record<string, string>; pushFails?: boolean; ghBad?: boolean } = {}) {
  const calls: string[] = [];
  let clock = T0;
  let lists = 0;
  let views = 0;
  const mine: Run = { databaseId: 7, displayTitle: runTitle(SHA), createdAt: new Date(T0 + 5_000).toISOString(), status: 'queued', conclusion: null, url: 'https://ci/run/7' };
  const deps: DevicesCiDeps = {
    gh: (args) => {
      calls.push(args.slice(0, 2).join(' '));
      if (args[0] === 'workflow') return '';
      if (o.ghBad === true) return '{"oops":1}';
      if (args[1] === 'list') return JSON.stringify([...(o.runs ?? []), ...(++lists > (o.appearAfter ?? 0) ? [mine] : [])]);
      const done = ++views > (o.doneAfter ?? 1);
      return JSON.stringify({ ...mine, status: done ? 'completed' : 'in_progress', conclusion: done ? (o.conclusion === undefined ? 'success' : o.conclusion) : null });
    },
    pushTemp: (branch) => {
      calls.push(`push ${branch}`);
      if (o.pushFails === true) throw new Error('push refused');
      return SHA;
    },
    deleteTemp: (branch) => void calls.push(`delete ${branch}`),
    download: (id, name) => {
      calls.push(`download ${id} ${name}`);
      return o.records ?? RECORDS;
    },
    sleep: (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: () => {},
  };
  return { deps, calls };
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
  it('dispatches on master for the landing tree, waits for its run, hands back the records and deletes the branch', () => {
    const f = fake({ appearAfter: 1, doneAfter: 2 });
    const r = run(f);
    expect(r).toEqual({ sha: SHA, url: 'https://ci/run/7', files: RECORDS });
    expect(f.calls).toEqual([`push ${tempBranch(42)}`, 'workflow run', 'run list', 'run list', 'run view', 'run view', 'run view', 'download 7 device-records', `delete ${tempBranch(42)}`]);
  });
  it('takes only a run of this dispatch, not an older run for the same commit', () => {
    const old: Run = { databaseId: 3, displayTitle: runTitle(SHA), createdAt: new Date(T0 - 3_600_000).toISOString(), status: 'completed', conclusion: 'failure', url: 'https://ci/run/3' };
    expect(run(fake({ runs: [old] })).url).toBe('https://ci/run/7');
  });
  it('fails the PR at the devices step, deleting the branch, when the run never appears, times out or does not succeed', () => {
    const never = fake({ appearAfter: 1e9 });
    expect(failure(() => run(never))).toMatchObject({ step: 'devices', message: expect.stringContaining('appeared within 300s') });
    expect(never.calls.at(-1)).toBe(`delete ${tempBranch(42)}`);
    const slow = fake({ doneAfter: 1e9 });
    expect(failure(() => run(slow, 600))).toMatchObject({ step: 'devices', message: 'the CI device run https://ci/run/7 did not finish within 600s (status in_progress)' });
    expect(slow.calls.at(-1)).toBe(`delete ${tempBranch(42)}`);
    const red = fake({ conclusion: 'failure' });
    expect(failure(() => run(red))).toMatchObject({ step: 'devices', message: 'the CI device run https://ci/run/7 concluded failure' });
    expect(red.calls).not.toContain('download 7 device-records');
  });
  it('fails on a malformed gh answer, a refused push or an artifact without the records, never reading them as no run', () => {
    expect(failure(() => run(fake({ ghBad: true })))).toMatchObject({ step: 'devices', message: expect.stringContaining('unexpected gh run JSON') });
    const refused = fake({ pushFails: true });
    expect(failure(() => run(refused))).toMatchObject({ step: 'devices', message: 'the CI device lanes failed: push refused' });
    expect(refused.calls).toEqual([`push ${tempBranch(42)}`]);
    expect(failure(() => run(fake({ records: { 'lanes.json': '{}' } })))).toMatchObject({ message: expect.stringContaining('device-failures-ios.json is missing; device-failures-android.json is missing') });
  });
  it('checks gh run rows and the record files field by field', () => {
    expect(parseRunRows('{"databaseId":1,"status":"completed","conclusion":null,"url":"u"}')).toEqual([{ databaseId: 1, displayTitle: '', createdAt: '', status: 'completed', conclusion: null, url: 'u' }]);
    expect(() => parseRunRows('[{"databaseId":"1","status":"x","conclusion":null,"url":"u"}]')).toThrow('unexpected gh run JSON');
    expect(() => deviceRecords({ ...RECORDS, 'lanes.json': '{' })).toThrow('lanes.json is not JSON');
  });
});
