// The lanes file's own checks (PR #10 round 7): a committed file is stale when the constants it was judged by differ; a stale
// constant drops every carried lane, a stale projection its target's; run-record parity is checked in both directions and every
// DPR set that ran has fault rows; duplicate or undeclared DPR sets fail the lane; and the CLI status includes the file's own
// parity and run-record problems.
import { describe, expect, it } from 'vitest';
import type { DeviceSet } from '../src/device-lanes.ts';
import type { DeviceRun, LanesFile } from '../src/lanes.ts';
import { deviceEvidence, evidenceProblems } from '../src/device-evidence.ts';
import { fileStatusProblems, LANES_JSON, lanesFile, readLanesFile, runRecordProblems, staleCovers, staleEvidence, staleLanes } from '../src/lanes.ts';
import type { TargetConfig } from '../src/targets.ts';
import { nativeTargets } from '../src/targets.ts';

const targets = nativeTargets();
const committed = readLanesFile() as LanesFile;
const clone = (): LanesFile => JSON.parse(JSON.stringify(committed)) as LanesFile;
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

describe('staleness covers the constants lanes are judged by', () => {
  it('the committed file is current', () => {
    expect(staleLanes(committed, targets)).toEqual([]);
  });
  it('changed sample rules, dump faults, tolerances, DPR sets, schema or projection make it stale', () => {
    const cases: [string, (f: Mutable<LanesFile>) => void, RegExp][] = [
      ['sample rules', (f) => { f.sampleRules = f.sampleRules.slice(0, -1); }, /sample rules .* are not SAMPLE_RULES/],
      ['dump faults', (f) => { f.dumpFaults = f.dumpFaults.slice(0, -1); }, /dump faults .* are not DUMP_FAULTS/],
      ['tolerances', (f) => { f.tolerances.gateDevicePx = 2; }, /tolerances .* are not the current gates/],
      ['DPR sets', (f) => { f.sharedDprs = [2]; }, /the DPR sets are not SHARED_DPRS and EXTRA_DPRS/],
      ['schema', (f) => { (f as { schema: string }).schema = 'dragon.lanes/1'; }, /schema dragon\.lanes\/1, not dragon\.lanes\/2/],
      ['projection', (f) => { (f.targets[1] as { projection: string }).projection = 'other'; }, /android projection other, configured nativeLayoutProjection/],
    ];
    for (const [what, mutate, re] of cases) {
      const f = clone() as Mutable<LanesFile>;
      mutate(f);
      expect(staleLanes(f as LanesFile, targets).some((p) => re.test(p)), what).toBe(true);
    }
  });
  it('a stale constant drops every carried lane; a stale projection only its target; a stale case list only its lane', () => {
    expect(staleCovers(`${LANES_JSON}: sample rules [] are not SAMPLE_RULES`, 'ios', 'device-lines')).toBe(true);
    expect(staleCovers(`${LANES_JSON}: android projection x, configured y`, 'ios', 'device-lines')).toBe(false);
    expect(staleCovers(`${LANES_JSON}: android projection x, configured y`, 'android', 'device-lines')).toBe(true);
    expect(staleCovers(`${LANES_JSON}: ios device-frames does not match the configured case list`, 'ios', 'device-lines')).toBe(false);
    expect(staleCovers(`${LANES_JSON} has no target android`, 'android', 'device-lines')).toBe(true);
    const f = clone() as Mutable<LanesFile>;
    f.sampleRules = f.sampleRules.slice(0, -1);
    const out = lanesFile(targets, [], new Map(), null, new Map(), f as LanesFile);
    for (const t of out.targets) for (const l of t.lanes) expect(l.state, `${t.target} ${l.lane}`).toBe('not run');
    const kept = lanesFile(targets, [], new Map(), null, new Map(), committed);
    expect(kept.targets.flatMap((t) => t.lanes.map((l) => l.state))).toEqual(committed.targets.flatMap((t) => t.lanes.map((l) => l.state)));
  });
});

describe('run-record parity and status', () => {
  it('a shared DPR that one target ran and the other did not is found in both directions', () => {
    for (const [drop, other] of [['android', 'ios'], ['ios', 'android']] as const) {
      const f = clone() as Mutable<LanesFile>;
      const t = f.targets.find((x) => x.target === drop);
      const lane = t?.lanes.find((l) => l.lane === 'device-frames');
      if (lane?.device === null || lane?.device === undefined) throw new Error('no device run');
      (lane.device as unknown as { sets: unknown[] }).sets = lane.device.sets.filter((s) => s.dpr !== 2);
      expect(runRecordProblems(f as LanesFile), drop).toContain(`run records: device-frames at DPR 2 ran on ${other} but not on ${drop}`);
    }
  });
  it('a DPR set that ran device lanes needs its dump fault rows', () => {
    const f = clone() as Mutable<LanesFile>;
    const t = f.targets.find((x) => x.target === 'android');
    if (t === undefined || t.dumpFaults === null) throw new Error('no fault rows');
    t.dumpFaults = t.dumpFaults.filter((r) => r.dpr !== 2.625);
    expect(runRecordProblems(f as LanesFile)).toContain('run records: android DPR 2.625 ran device lanes but has no dump fault rows');
  });
  it('the CLI status holds the committed file parity and its run-record problems, not only the configuration problems', () => {
    expect(fileStatusProblems(committed, [])).toEqual([]);
    const f = clone() as Mutable<LanesFile>;
    const row = f.targets[0]?.dumpFaults?.[0]?.rows[0];
    if (row === undefined) throw new Error('no fault row');
    (row as { caught: number }).caught = row.applicable - 1;
    expect(fileStatusProblems(f as LanesFile, [])[0]).toMatch(/uncaught in 1 of/);
    expect(fileStatusProblems({ ...committed, parity: { pass: false, problems: ['recorded problem'] } }, [])).toEqual(['recorded problem']);
  });
  it('a DPR run twice, or run outside the declared DPRs, fails the lane', () => {
    const ios = targets.find((t) => t.target === 'ios') as TargetConfig;
    const committedSet = committed.targets[0]?.lanes.find((l) => l.lane === 'device-frames')?.device?.sets[0];
    if (committedSet === undefined) throw new Error('no committed set');
    const set = (dpr: number, name: string): DeviceSet => ({ dpr, device: { ...committedSet.device, name }, cases: committedSet.cases, dumps: committedSet.cases, compared: committedSet.compared, dumpsSha256: '0', failures: [], faults: [] });
    const run: DeviceRun = { vectors: null, sets: [set(3, 'iPhone 17'), set(3, 'other'), set(2, 'iPad (A16)'), set(5, 'odd')], trust: [], blocked: null, evidence: { laneCode: 'a', referenceData: 'b', app: 'c' } };
    const f = lanesFile([ios], [], new Map(), null, new Map([['ios', run]]));
    const reason = f.targets[0]?.lanes.find((l) => l.lane === 'device-frames')?.reason ?? '';
    expect(reason).toMatch(/DPR 3 was run 2 times \(iPhone 17, other\)/);
    expect(reason).toMatch(/DPR 5 \(odd\) is not a declared DPR of the lane/);
  });
});

describe('the evidence stamp (finding 4131217867)', () => {
  it('a missing or different stamp is never current', () => {
    const cur = { laneCode: 'a'.repeat(64), referenceData: 'b'.repeat(64), app: 'c'.repeat(64) };
    expect(evidenceProblems(cur, cur)).toEqual([]);
    expect(evidenceProblems(null, cur)).toEqual(['the record has no evidence stamp']);
    expect(evidenceProblems(undefined, cur)).toEqual(['the record has no evidence stamp']);
    expect(evidenceProblems({ ...cur, app: 'd'.repeat(64) }, cur)).toEqual(['app dddddddddddd is not the current cccccccccccc']);
  });
  it('the committed device lanes carry the current stamp: the code, reference data and app they were made and judged with', () => {
    expect(staleEvidence(committed)).toEqual([]);
    for (const t of committed.targets) for (const l of t.lanes.filter((x) => x.where === 'device' && x.state !== 'not run')) expect(l.evidence, `${t.target} ${l.lane}`).toEqual(deviceEvidence(t.target));
  });
  it('a device lane without the current stamp is not carried (no grandfathering); host lanes are carried as before', () => {
    for (const drop of ['missing', 'changed'] as const) {
      const f = clone() as Mutable<LanesFile>;
      for (const t of f.targets) for (const l of t.lanes) if (l.where === 'device') (l as { evidence: unknown }).evidence = drop === 'missing' ? null : { ...(l.evidence as object), laneCode: '0'.repeat(64) };
      expect(staleEvidence(f as LanesFile).length).toBeGreaterThan(0);
      const out = lanesFile(targets, [], new Map(), null, new Map(), f as LanesFile);
      for (const t of out.targets) {
        for (const l of t.lanes) expect(l.state, `${drop} ${t.target} ${l.lane}`).toBe(l.where === 'host' ? 'pass' : 'not run');
      }
    }
  });
});
