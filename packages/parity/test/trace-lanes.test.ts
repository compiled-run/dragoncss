// SELD-R2 (T064 R14): the device-traces runner on the host, with fake device trace records: every script's record present and
// evaluateTraces clean passes; a missing record, a failed line, and on Android a MotionEvent trace that is missing or differs
// from the entry-point trace fail; the lane record passes only with every script's record at every declared DPR and no failure,
// and reads "not run" (device step pending) with no device run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeviceSet, LaneFailure, TraceVerdict } from '../src/device-lanes.ts';
import { allRunFailures, evaluateTraceSet, mergeOutcomes, motionTraceFile, TRACE_LANE, traceFile } from '../src/device-lanes.ts';
import type { DeviceRecord } from '../src/device-run.ts';
import { parseOutcome } from '../src/device-jobs.ts';
import type { DeviceRun } from '../src/lanes.ts';
import { DEVICE_NOT_RUN, lanesFile } from '../src/lanes.ts';
import { nativeTargets } from '../src/targets.ts';

// Made in beforeAll: `vitest list` runs module scope but no hooks, so a module-scope folder would leak.
let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragon-traces-'));
});
afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});
const device = { name: 'fake' } as unknown as DeviceRecord;
const ids = ['ix-a~trace0', 'ix-b~trace1', 'ix-c~trace0-rtl'];
const line = (k: number): string => `${k}\t0\t1\t0,2\t-\t-1\t-1`;
const text = `${line(0)}\n${line(1)}\n`;
const clean = (n: number) => (): TraceVerdict => ({ passed: n, failed: 0, details: [] });

function folder(name: string, write: (id: string) => { trace?: string; motion?: string }): string {
  const at = join(dir, name);
  mkdirSync(at);
  for (const id of ids) {
    const w = write(id);
    if (w.trace !== undefined) writeFileSync(traceFile(at, id, 2), w.trace);
    if (w.motion !== undefined) writeFileSync(motionTraceFile(at, id, 2), w.motion);
  }
  return at;
}

describe('device-traces on fake records', () => {
  it('passes every record with evaluateTraces clean, counting the lines and, on Android, the scripts compared twice', () => {
    const at = folder('pass', () => ({ trace: text, motion: text }));
    const ios = evaluateTraceSet(2, at, device, ids, false, clean(6));
    expect([ios.failures, ios.cases, ios.dumps, ios.compared]).toEqual([[], 3, 3, { a: 0, b: 6, c: 0, d: 0, breaks: 0 }]);
    const android = evaluateTraceSet(2, at, device, ids, true, clean(6));
    expect([android.failures, android.dumps, android.compared.b]).toEqual([[], 3, 9]);
    expect(android.dumpsSha256).toBe(ios.dumpsSha256);
  });
  it('fails a missing record and every evaluateTraces failure, filed under its script when the detail names one', () => {
    const at = folder('fail', (id) => (id === ids[0] ? {} : { trace: text }));
    const s = evaluateTraceSet(2, at, device, ids, false, () => ({ passed: 3, failed: 2, details: [`${ids[1]}: trace 1: device hover 0, host 0,2`, 'no reference for ix-z'] }));
    expect(s.failures.map((f) => [f.case, f.kind, f.lane])).toEqual([[ids[0], 'trace-missing', TRACE_LANE], [ids[1], 'trace-mismatch', TRACE_LANE], ['-', 'trace-mismatch', TRACE_LANE]]);
    expect(s.dumps).toBe(2);
  });
  it('fails closed when evaluateTraces fails without a detail or compares nothing', () => {
    const at = folder('closed', () => ({ trace: text }));
    expect(evaluateTraceSet(2, at, device, ids, false, () => ({ passed: 0, failed: 1, details: [] })).failures.map((f) => f.detail)).toEqual(['evaluateTraces failed 1 without a detail']);
    expect(evaluateTraceSet(2, at, device, ids, false, clean(0)).failures.map((f) => f.detail)).toEqual(['evaluateTraces compared nothing in 3 trace records']);
  });
  it('on Android fails a missing MotionEvent trace and one that differs from the entry-point trace, naming the line', () => {
    const at = folder('motion', (id) => (id === ids[0] ? { trace: text } : id === ids[1] ? { trace: text, motion: `${line(0)}\n${line(1).replace('0,2', '0')}\n` } : { trace: text, motion: text }));
    const s = evaluateTraceSet(2, at, device, ids, true, clean(6));
    expect(s.failures.map((f) => [f.case, f.kind])).toEqual([[ids[0], 'trace-missing'], [ids[1], 'motion-mismatch']]);
    expect(s.failures[1]?.detail).toBe(`line 1: entry points ${JSON.stringify(line(1))}, MotionEvents ${JSON.stringify(line(1).replace('0,2', '0'))} (3 and 3 lines)`);
    // iOS runs the entry points only (simulators cannot synthesise pointer hover), so the same folder passes there.
    expect(evaluateTraceSet(2, at, device, ids, false, clean(6)).failures).toEqual([]);
  });
});

describe('the device-traces lane record', () => {
  const t = nativeTargets().find((x) => x.target === 'android');
  const declared = t?.lanes.find((l) => l.lane === TRACE_LANE);
  const n = declared?.sets[0]?.ids.length ?? 0;
  const set = (dpr: number, failures: readonly LaneFailure[] = [], dumps: number = n): DeviceSet => ({ dpr, device: { name: `d${dpr}` } as DeviceRecord, cases: n, dumps, compared: { a: 0, b: 1, c: 0, d: 0, breaks: 0 }, dumpsSha256: '0', failures, faults: [] });
  const record = (traces: readonly DeviceSet[] | undefined) => {
    if (t === undefined) throw new Error('no android target');
    const run: DeviceRun = { vectors: null, sets: [], states: [], hits: [], ...(traces === undefined ? {} : { traces }), trust: [], blocked: null, evidence: { laneCode: 'a', referenceData: 'b', app: 'c' } };
    return lanesFile([t], [], new Map(), null, new Map([['android', run]])).targets[0]?.lanes.find((l) => l.lane === TRACE_LANE);
  };
  it('is declared at every device DPR of both targets with the same scripts', () => {
    expect(declared?.sets.map((s) => s.dpr)).toEqual(t?.dprs);
    const ios = nativeTargets().find((x) => x.target === 'ios')?.lanes.find((l) => l.lane === TRACE_LANE);
    expect(ios?.sets[0]?.ids).toEqual(declared?.sets[0]?.ids);
  });
  it('passes at every declared DPR, fails on a failure, a missing DPR or a short set', () => {
    expect(record([set(2), set(3), set(2.625)])?.state).toBe('pass');
    expect(record([set(2), set(3), set(2.625, [{ lane: TRACE_LANE, case: 'x', dpr: 2.625, node: null, kind: 'motion-mismatch', detail: 'd' }])])?.state).toBe('fail');
    expect(record([set(2), set(3)])?.reason).toContain('DPR 2.625 was not run');
    expect(record([set(2), set(3), set(2.625, [], n - 1)])?.reason).toContain(`DPR 2.625: ${n - 1}/${n} dumps`);
  });
  it('reads "not run" (device step pending), never fail, when no device run is recorded', () => {
    if (t === undefined) throw new Error('no android target');
    const l = lanesFile([t], [], new Map(), null).targets[0]?.lanes.find((x) => x.lane === TRACE_LANE);
    expect([l?.state, l?.reason]).toEqual(['not run', DEVICE_NOT_RUN]);
  });
  it('a device run merges each device\'s trace set and lists its failures with the others', () => {
    const o = (name: string, traces: DeviceSet) => ({ device: name, set: null, states: null, hits: null, traces, trust: null, vectors: null, blocked: null });
    const bad = set(3, [{ lane: TRACE_LANE, case: 'x', dpr: 3, node: null, kind: 'trace-missing', detail: 'd' }]);
    const run = mergeOutcomes([o('d2', set(2)), o('d3', bad)], { laneCode: 'a', referenceData: 'b', app: 'c' });
    expect(run.traces?.map((s) => s.dpr)).toEqual([2, 3]);
    expect(allRunFailures(run).map((f) => f.kind)).toEqual(['trace-missing']);
  });
});

describe('a device process\'s outcome', () => {
  const s = (failures: readonly LaneFailure[]): DeviceSet => ({ dpr: 2, device: { name: 'fake' } as DeviceRecord, cases: 1, dumps: 1, compared: { a: 0, b: 1, c: 0, d: 0, breaks: 0 }, dumpsSha256: '0', failures, faults: [] });
  const f = (lane: string): LaneFailure => ({ lane, case: 'x', dpr: 2, node: null, kind: 'trace-mismatch', detail: 'd' }) as LaneFailure;
  const o = (traces: DeviceSet | undefined): string => JSON.stringify({ device: 'fake', set: s([]), states: s([]), hits: s([]), traces, trust: { device: 'fake', dpr: 2, rows: [] }, vectors: null, blocked: null });
  it('carries its trace set, refuses a set without one and a failure filed under another lane', () => {
    expect(parseOutcome(o(s([f(TRACE_LANE)])), 'fake').traces?.failures.length).toBe(1);
    expect(() => parseOutcome(o(undefined), 'fake')).toThrow(/a set without its traces set/);
    expect(() => parseOutcome(o(s([f('device-hit')])), 'fake')).toThrow(/traces.failures holds a failure of lane device-hit, not device-traces/);
  });
});
