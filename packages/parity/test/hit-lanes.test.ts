// SELD-R1b: the device-hit runner on the host, with fake device hit records: the TS answers pass, a missing record and a changed
// run fail, and the lane record passes only with every case's record at every declared DPR and no failure.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeviceSet, LaneFailure } from '../src/device-lanes.ts';
import { evaluateHits, HIT_LANE, hitFile } from '../src/device-lanes.ts';
import type { DeviceRecord } from '../src/device-run.ts';
import { parseOutcome } from '../src/device-jobs.ts';
import { deviceHitSource, expectedHitRuns, hitCases } from '../src/hit-capture.ts';
import type { DeviceRun } from '../src/lanes.ts';
import { lanesFile } from '../src/lanes.ts';
import { layoutCaseIds, nativeTargets } from '../src/targets.ts';

// Made in beforeAll: `vitest list` runs module scope but no hooks, so a module-scope folder would leak.
let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragon-hits-'));
});
afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});
const device = { name: 'fake' } as unknown as DeviceRecord;
const cases = hitCases().filter((n) => n.case.id.startsWith('hit-'));

describe('device-hit on fake records', () => {
  it('passes the TS answers, at a device DPR', () => {
    const at = join(dir, 'pass');
    mkdirSync(at);
    for (const n of cases) writeFileSync(hitFile(at, n.case.id, 3), expectedHitRuns(n, 3));
    const s = evaluateHits(3, at, device, cases);
    expect(s.failures).toEqual([]);
    expect(s.dumps).toBe(cases.length);
    expect(s.compared.b).toBeGreaterThan(cases.length);
  });
  it('fails a missing record and a changed run, naming the run', () => {
    const at = join(dir, 'fail');
    mkdirSync(at);
    const [a, b, ...rest] = cases;
    if (a === undefined || b === undefined) throw new Error('no hit cases');
    for (const n of rest) writeFileSync(hitFile(at, n.case.id, 2), expectedHitRuns(n, 2));
    const want = expectedHitRuns(b, 2);
    writeFileSync(hitFile(at, b.case.id, 2), want.replace(/^([^ ]+) /, 'html '));
    const s = evaluateHits(2, at, device, cases);
    expect(s.failures.map((f) => [f.case, f.kind, f.lane])).toEqual([[a.case.id, 'hit-missing', HIT_LANE], [b.case.id, 'hit-mismatch', HIT_LANE]]);
    expect(s.failures[1]?.detail).toMatch(/^run 0: device "html /);
  });
  it('generates the device facts for every layout case and the translated runner on both platforms', () => {
    const ios = deviceHitSource('ios').text;
    const android = deviceHitSource('android').text;
    for (const id of ['hit-order', 'hit-pointer-events-rtl']) {
      expect(ios).toContain(`${id}\\t`);
      expect(android).toContain(`${id}\\t`);
    }
    expect(ios).toContain('rtHit_hitTableOf(c.input(scale), measurer, map, HitTableFaults(false))');
    expect(android).toContain('rtHit_hitTableOf(c.input(scale), measurer, map, HitTableFaults(false))');
    // No JVM string constant may pass 64 KB.
    for (const lit of android.match(/^ {2}".*",$/gm) ?? []) expect(lit.length).toBeLessThan(65_535);
  });
});

describe('the device-hit lane record', () => {
  const t = nativeTargets().find((x) => x.target === 'android');
  // A device writes a hit record per hit case (runOneDevice evaluates hitCases), not per layout case.
  const set = (dpr: number, failures: readonly LaneFailure[] = [], n: number = hitCases().length): DeviceSet => ({ dpr, device: { name: `d${dpr}` } as DeviceRecord, cases: n, dumps: n, compared: { a: 0, b: 1, c: 0, d: 0, breaks: 0 }, dumpsSha256: '0', failures, faults: [] });
  const record = (hits: readonly DeviceSet[]) => {
    if (t === undefined) throw new Error('no android target');
    const run: DeviceRun = { vectors: null, sets: [], states: [], hits, trust: [], blocked: null, evidence: { laneCode: 'a', referenceData: 'b', app: 'c' } };
    return lanesFile([t], [], new Map(), null, new Map([['android', run]])).targets[0]?.lanes.find((l) => l.lane === HIT_LANE);
  };
  it('passes at every declared DPR, fails on a failure or a missing DPR', () => {
    expect(record([set(2), set(3), set(2.625)])?.state).toBe('pass');
    expect(record([set(2), set(3), set(2.625, [{ lane: HIT_LANE, case: 'x', dpr: 2.625, node: null, kind: 'hit-mismatch', detail: 'd' }])])?.state).toBe('fail');
    expect(record([set(2), set(3)])?.reason).toContain('DPR 2.625 was not run');
  });
  it('passes on a full run of the hit cases while the hit lane refuses some layout cases (PNT2 transforms), and fails a record short of a hit case', () => {
    const n = hitCases().length;
    expect(n).toBeLessThan(layoutCaseIds().length);
    expect(record([set(2), set(3), set(2.625)])?.reason ?? null).toBeNull();
    expect(record([set(2), set(3), set(2.625, [], n - 1)])?.reason).toContain(`DPR 2.625: ${n - 1}/${n} dumps`);
  });
});

describe('a device process\'s outcome', () => {
  const s = (failures: readonly LaneFailure[]): DeviceSet => ({ dpr: 2, device: { name: 'fake' } as DeviceRecord, cases: 1, dumps: 1, compared: { a: 0, b: 1, c: 0, d: 0, breaks: 0 }, dumpsSha256: '0', failures, faults: [] });
  const f = (lane: string): LaneFailure => ({ lane, case: 'x', dpr: 2, node: null, kind: 'hit-mismatch', detail: 'd' }) as LaneFailure;
  const o = (set: DeviceSet, states: DeviceSet, hits: DeviceSet): string => JSON.stringify({ device: 'fake', set, states, hits, trust: { device: 'fake', dpr: 2, rows: [] }, vectors: null, blocked: null });
  it('refuses a failure filed under another set\'s lane, which that lane\'s record would never count', () => {
    expect(parseOutcome(o(s([f('device-frames')]), s([f('device-states')]), s([f(HIT_LANE)])), 'fake').hits?.failures.length).toBe(1);
    expect(() => parseOutcome(o(s([]), s([]), s([f('device-frames')])), 'fake')).toThrow(/hits.failures holds a failure of lane device-frames, not device-hit/);
    expect(() => parseOutcome(o(s([]), s([f(HIT_LANE)]), s([])), 'fake')).toThrow(/states.failures holds a failure of lane device-hit, not device-states/);
    expect(() => parseOutcome(o(s([f('device-states')]), s([]), s([])), 'fake')).toThrow(/set.failures holds a failure of lane device-states, not device-frames, device-applied, device-lines or device-pixels/);
  });
});
