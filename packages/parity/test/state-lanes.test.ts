// SELD-R1b: the device-states runner on the host, with fake device dumps (the device run comes when the stack heads the queue).
// A script's dump is checked against its end assignment's references under the script's id: a dump equal to the end case's own
// dump (relabelled) fails exactly where that case's does, one taken from another assignment fails more, and a missing one fails
// as missing. The lane record passes only with every script's dump at every declared DPR and no failure.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectedDigest, expectedDump } from 'dragon';
import type { DeviceSet, LaneFailure } from '../src/device-lanes.ts';
import { evaluateSet, evaluateStates, scriptCases, STATE_LANE } from '../src/device-lanes.ts';
import type { DeviceRecord } from '../src/device-run.ts';
import type { DeviceRun } from '../src/lanes.ts';
import { lanesFile } from '../src/lanes.ts';
import { BACKEND_OF, expectedEngine, relabelledReferenceDumps } from '../src/native-host.ts';
import { stateEmits } from '../src/state-cases.ts';
import { nativeTargets, stateScriptIds } from '../src/targets.ts';

// Made in beforeAll: `vitest list` runs module scope but no hooks, so a module-scope folder would leak.
let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragon-states-'));
});
afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

const DPR = 2;
const device = { name: 'fake', platform: 'ios', os: 'host', build: 'host', profileScale: DPR, appScale: DPR, windowPx: [0, 0], stagePx: [0, 0], rootOriginPx: [0, 0], textScale: 'none' } as unknown as DeviceRecord;
const scripts = scriptCases('ios').filter((s) => s.end.spec.id === 'tree-branch-arms');
const dumps = new Map(relabelledReferenceDumps('ios', DPR).map((d) => [d.case.id, d]));

/** A fake device dump of a script: the end case's (or another case's) relabelled reference dump under the script's id. */
function write(at: string, scriptId: string, fromCase: string): void {
  const d = dumps.get(fromCase);
  if (d === undefined) throw new Error(`no reference dump of ${fromCase}`);
  const s = scripts.find((x) => x.script.case.id === scriptId);
  if (s === undefined) throw new Error(`no script ${scriptId}`);
  const e = expectedDump(s.end.programs[BACKEND_OF.ios], scriptId, s.end.case.environment.viewport, DPR, expectedEngine());
  writeFileSync(join(at, `${scriptId}@${DPR}.json`), JSON.stringify({ ...d, case: { ...d.case, id: scriptId, expectedDigest: expectedDigest(e) } }));
}

const sig = (fs: readonly LaneFailure[]): string[] => [...new Set(fs.map((f) => `${f.kind} ${f.node ?? ''} ${f.detail}`))].sort();

describe('device-states on fake dumps', () => {
  it('names every case script of the state programs, as targets.ts derives them', () => {
    expect(scriptCases('ios').map((s) => s.script.case.id)).toEqual([...stateScriptIds()]);
    expect(stateEmits('ios').flatMap((e) => e.scripts.map((s) => s.id))).toEqual([...stateScriptIds()]);
    expect(stateScriptIds().length).toBe(130);
    expect(scripts.length).toBe(6);
  });

  it('a script dump equal to its end case\'s fails exactly where that case does, under device-states', () => {
    const at = join(dir, 'same');
    mkdirSync(at);
    for (const s of scripts) write(at, s.script.case.id, s.end.case.id);
    const states = evaluateStates('ios', DPR, at, device, scripts);
    expect(states.dumps).toBe(scripts.length);
    expect(states.failures.every((f) => f.lane === STATE_LANE)).toBe(true);
    // The end cases' own dumps, checked as layout cases.
    const endDir = join(dir, 'ends');
    mkdirSync(endDir);
    for (const s of scripts) writeFileSync(join(endDir, `${s.end.case.id}@${DPR}.json`), JSON.stringify(dumps.get(s.end.case.id)));
    const ends = evaluateSet('ios', DPR, endDir, device, [...new Map(scripts.map((s) => [s.end.case.id, s.end])).values()]);
    for (const s of scripts) {
      expect([s.script.case.id, sig(states.failures.filter((f) => f.case === s.script.case.id))]).toEqual([s.script.case.id, sig(ends.failures.filter((f) => f.case === s.end.case.id))]);
    }
  });

  it('a script dump from another assignment, or none, fails', () => {
    const at = join(dir, 'wrong');
    mkdirSync(at);
    const [first, ...rest] = scripts;
    if (first === undefined) throw new Error('no scripts');
    const other = scripts.find((s) => s.end.case.id !== first.end.case.id && s.end.case.environment.direction === first.end.case.environment.direction);
    if (other === undefined) throw new Error('no other assignment');
    write(at, first.script.case.id, other.end.case.id);
    for (const s of rest.slice(1)) write(at, s.script.case.id, s.end.case.id);
    const missing = rest[0]?.script.case.id as string;
    const states = evaluateStates('ios', DPR, at, device, scripts);
    expect(states.failures.filter((f) => f.case === missing).map((f) => f.kind)).toEqual(['dump-missing']);
    const right = join(dir, 'right');
    mkdirSync(right);
    write(right, first.script.case.id, first.end.case.id);
    const clean = evaluateStates('ios', DPR, right, device, [first]);
    expect(sig(states.failures.filter((f) => f.case === first.script.case.id)).length).toBeGreaterThan(sig(clean.failures).length);
    expect(states.failures.filter((f) => f.case === first.script.case.id).some((f) => f.kind === 'applied' || f.kind === 'frame-engine' || f.kind === 'expected-digest')).toBe(true);
  });
});

describe('the device-states lane record', () => {
  const t = nativeTargets().find((x) => x.target === 'ios');
  const set = (dpr: number, failures: readonly LaneFailure[] = [], dumpCount = stateScriptIds().length): DeviceSet => ({ dpr, device: { ...device, name: `d${dpr}` } as DeviceRecord, cases: stateScriptIds().length, dumps: dumpCount, compared: { a: 0, b: 0, c: 0, d: 0, breaks: 0 }, dumpsSha256: '0', failures, faults: [] });
  const record = (states: readonly DeviceSet[]) => {
    if (t === undefined) throw new Error('no ios target');
    const run: DeviceRun = { vectors: null, sets: [], states, hits: [], trust: [], blocked: null, evidence: { laneCode: 'a', referenceData: 'b', app: 'c' } };
    return lanesFile([t], [], new Map(), null, new Map([['ios', run]])).targets[0]?.lanes.find((l) => l.lane === STATE_LANE);
  };
  it('passes with every script dumped at every declared DPR and no failure', () => {
    expect(record([set(2), set(3)])?.state).toBe('pass');
  });
  it('fails on a failure, a short set, or a DPR not run', () => {
    const f: LaneFailure = { lane: STATE_LANE, case: 'x', dpr: 2, node: null, kind: 'applied', detail: 'd' };
    expect(record([set(2, [f]), set(3)])?.state).toBe('fail');
    expect(record([set(2, [], 125), set(3)])?.reason).toContain('DPR 2: 125/130 dumps');
    expect(record([set(2)])?.reason).toContain('DPR 3 was not run');
  });
});
