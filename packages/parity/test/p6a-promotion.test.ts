// P6a device gating (notes/T008-p5-review.md; T046 Amendment T075J): profile statuses follow the iOS rule and never read the lanes;
// the committed lanes verdict (profiles/native-lanes.ts) alone gates outputs.ready, and a ready output is device-proven on every
// row. The committed lanes record and failure lists are checked before they decide anything.
import { readFileSync } from 'node:fs';
import { androidProfile, iosProfile, PROPERTY_ASPECTS } from 'dragon';
import type { Longhand } from 'dragon';
import { describe, expect, it } from 'vitest';
import type { LaneFailure } from '../src/device-lanes.ts';
import { repoPath } from '../src/paths.ts';
import type { DeviceEvidence } from '../src/profile-rows.ts';
import { checkedFailures, checkedLanes, committedLanes, deriveRows, deviceCoverageProblems, deviceEvidence, nativeLanesSource, nativeVerdict, promotionBlocker } from '../src/profile-rows.ts';
import type { LanesFile } from '../src/lanes.ts';
import { staleEvidence, staleLanes } from '../src/lanes.ts';
import { nativeTargets } from '../src/targets.ts';
import { NATIVE_LANES } from '../../dragon/src/profiles/native-lanes.ts';

const lanes = committedLanes();
const committedFailures = (t: 'ios' | 'android'): LaneFailure[] => JSON.parse(readFileSync(repoPath(`packages/parity/out/device-failures-${t}.json`), 'utf8')) as LaneFailure[];

describe('the device evidence of the committed lanes', () => {
  it('is unavailable without a record, with a stale one, with a failed lane parity, without a failure list, or with a list that disagrees', () => {
    const configured = nativeTargets();
    const l = lanes.lanes;
    if (l === null) throw new Error('no committed lanes.json');
    const failures = committedFailures('ios');
    expect(deviceEvidence('ios', null, failures, configured, []).unavailable).toMatch(/no committed/);
    expect(deviceEvidence('ios', l, failures, configured, ['ios device-frames does not match']).unavailable).toMatch(/stale/);
    expect(deviceEvidence('ios', { ...l, parity: { pass: false, problems: ['x'] } }, failures, configured, []).unavailable).toMatch(/lane-parity failure: x/);
    expect(deviceEvidence('ios', l, null, configured, []).unavailable).toMatch(/device-failures-ios\.json/);
    expect(deviceEvidence('ios', l, failures.slice(1), configured, []).unavailable).toMatch(/lists \d+ device-\w+ failures, lanes\.json records \d+/);
  });
});

describe('Amendment T075J pins', () => {
  it('deriveRows does not read the lanes: it takes a target and the cases, and its source names no lanes input', () => {
    expect(deriveRows.length).toBe(2);
    const body = deriveRows.toString();
    for (const word of ['lanes.json', 'committedLanes', 'deviceEvidence', 'promotionBlocker', 'readLanesFile', 'NATIVE_LANES']) expect(body, word).not.toContain(word);
  });
  it('native-lanes.ts equals nativeLanesSource over the committed verdicts, each target\'s stale being staleLanes plus staleEvidence over it', () => {
    const l = lanes.lanes;
    if (l === null) throw new Error('no committed lanes.json');
    expect(lanes.stale).toEqual([...staleLanes(l, nativeTargets()), ...staleEvidence(l)]);
    for (const t of ['ios', 'android'] as const) for (const x of lanes.verdict(t).stale) expect(lanes.stale, t).toContain(x);
    expect(readFileSync(repoPath('packages/dragon/src/profiles/native-lanes.ts'), 'utf8')).toBe(nativeLanesSource({ ios: lanes.verdict('ios'), android: lanes.verdict('android') }));
  });
  it('a ready native output is device-proven on every row: when the committed verdict lets a target be ready, every proving case of every row passes every device lane it needs', () => {
    for (const [t, profile] of [['ios', iosProfile], ['android', androidProfile]] as const) {
      const v = NATIVE_LANES[t];
      if (!(v.recorded && v.stale.length === 0 && v.notPassing.length === 0)) continue;
      const ev = lanes.evidence(t);
      for (const row of profile.rows) {
        if (row.status === 'unsupported') continue;
        const proving = [...new Set(row.proofs.flatMap((p) => p.cases))];
        expect(promotionBlocker(ev, proving, PROPERTY_ASPECTS[row.feature.slice(0, row.feature.indexOf(':')) as Longhand].paint), `${t} ${row.feature}@${row.context}`).toBeNull();
      }
    }
  });
});

describe('promotionBlocker', () => {
  const ev: DeviceEvidence = {
    target: 'ios',
    unavailable: null,
    lanes: [
      { lane: 'device-frames', perCase: true, passed: true, cases: new Set(['a', 'b', 'c']), failing: new Set() },
      { lane: 'device-pixels', perCase: true, passed: false, cases: new Set(['a', 'b']), failing: new Set(['b']) },
    ],
  };
  it('passes a row whose proving cases pass every lane it needs, device-pixels only for paint rows', () => {
    expect(promotionBlocker(ev, ['a'], true)).toBeNull();
    expect(promotionBlocker(ev, ['b'], false)).toBeNull();
    expect(promotionBlocker(ev, ['c'], false)).toBeNull();
  });
  it('names a failing case, a case a lane does not run at every DPR, no proving case, and unavailable evidence', () => {
    expect(promotionBlocker(ev, ['a', 'b'], true)).toBe('b fails ios device-pixels');
    expect(promotionBlocker(ev, ['c'], true)).toBe('c is not run by ios device-pixels at every DPR');
    expect(promotionBlocker(ev, [], false)).toBe('no proving case');
    expect(promotionBlocker({ ...ev, unavailable: 'why' }, ['a'], false)).toBe('why');
  });
});

describe('the committed inputs are checked before they decide', () => {
  it('accepts the committed lanes record and failure lists', () => {
    expect(() => checkedLanes(JSON.parse(readFileSync(repoPath('packages/parity/out/lanes.json'), 'utf8')), 'lanes.json')).not.toThrow();
    for (const t of ['ios', 'android'] as const) expect(checkedFailures(committedFailures(t), t)).toHaveLength(committedFailures(t).length);
  });
  it('rejects a malformed failure entry, naming it', () => {
    const good: LaneFailure = { lane: 'device-pixels', case: 'a', dpr: 2, node: null, kind: 'pixel', detail: 'x' };
    expect(() => checkedFailures({}, 'f')).toThrow(/not a list/);
    for (const [bad, why] of [
      [{ ...good, lane: 'frames' }, /lane "frames"/],
      [{ ...good, case: '' }, /case/],
      [{ ...good, dpr: 0 }, /dpr/],
      [{ ...good, node: 3 }, /node/],
      [{ ...good, kind: 7 }, /kind/],
      [{ ...good, detail: null }, /detail/],
      [null, /not an object/],
    ] as const) expect(() => checkedFailures([good, bad], 'f'), JSON.stringify(bad)).toThrow(new RegExp(`f\\[1\\]: ${why.source}`));
  });
  it('rejects a lanes record whose parity, targets, lanes or device sets are malformed', () => {
    const l = JSON.parse(readFileSync(repoPath('packages/parity/out/lanes.json'), 'utf8')) as Record<string, unknown>;
    const t0 = (l['targets'] as Record<string, unknown>[])[0] as Record<string, unknown>;
    const lane0 = (t0['lanes'] as Record<string, unknown>[])[0] as Record<string, unknown>;
    const withLane = (x: Record<string, unknown>) => ({ ...l, targets: [{ ...t0, lanes: [x] }] });
    expect(() => checkedLanes([], 'l')).toThrow(/l: not an object/);
    expect(() => checkedLanes({ ...l, parity: { pass: 'yes', problems: [] } }, 'l')).toThrow(/parity/);
    expect(() => checkedLanes({ ...l, targets: {} }, 'l')).toThrow(/targets is not a list/);
    expect(() => checkedLanes(withLane({ ...lane0, state: 1 }), 'l')).toThrow(/lanes\[0\] is not/);
    expect(() => checkedLanes(withLane({ ...lane0, reason: 5 }), 'l')).toThrow(/reason/);
    expect(() => checkedLanes(withLane({ ...lane0, device: { sets: [{ failures: -1 }] } }), 'l')).toThrow(/device is not/);
  });
});

describe('the native verdict (Macroscope 4162261789, 4162261796, 4162261800)', () => {
  const committed = (): LanesFile => JSON.parse(readFileSync(repoPath('packages/parity/out/lanes.json'), 'utf8')) as LanesFile;
  const configured = nativeTargets();
  /** The committed record with every lane passing and no device failure: the one shape a ready verdict comes from. */
  const allPass = (): LanesFile => {
    const l = committed();
    return { ...l, parity: { pass: true, problems: [] }, targets: l.targets.map((t) => ({ ...t, lanes: t.lanes.map((x) => ({ ...x, state: 'pass' as const, reason: null, device: x.device === null ? null : { ...x.device, sets: x.device.sets.map((d) => ({ ...d, failures: 0, failuresByKind: {} })) } })) })) };
  };
  it('is ready for an all-passing, covering record with an agreeing empty failure list', () => {
    for (const t of ['ios', 'android'] as const) expect(nativeVerdict(t, allPass(), [], configured), t).toEqual({ recorded: true, stale: [], notPassing: [] });
  });
  it('keeps a stale message about one target out of the other target\'s verdict', () => {
    const l = allPass();
    const noIos = { ...l, targets: l.targets.filter((t) => t.target !== 'ios') };
    expect(nativeVerdict('ios', noIos, [], configured).stale).toContain('packages/parity/out/lanes.json has no target ios');
    expect(nativeVerdict('android', noIos, [], configured)).toEqual({ recorded: true, stale: [], notPassing: [] });
  });
  it('is not ready when the failure list is missing or disagrees with the record, even with every lane passing', () => {
    expect(nativeVerdict('ios', allPass(), null, configured).notPassing).toEqual(['device evidence: no committed packages/parity/out/device-failures-ios.json']);
    const extra: LaneFailure = { lane: 'device-pixels', case: 'a', dpr: 2, node: null, kind: 'pixel', detail: 'x' };
    expect(nativeVerdict('ios', allPass(), [extra], configured).notPassing).toEqual(['device evidence: device-failures-ios.json lists 1 device-pixels failures, lanes.json records 0']);
  });
  it('is not ready when a passing device lane\'s recorded sets do not cover every configured DPR and case', () => {
    const l = allPass();
    const ios = configured.find((t) => t.target === 'ios');
    if (ios === undefined) throw new Error('no ios target');
    const lane = ios.lanes.find((x) => x.lane === 'device-frames');
    const first = lane?.sets[0];
    if (lane === undefined || first === undefined) throw new Error('no ios device-frames set');
    type Sets = NonNullable<LanesFile['targets'][number]['lanes'][number]['device']>['sets'];
    const edit = (f: (sets: Sets) => Sets): LanesFile => ({
      ...l,
      targets: l.targets.map((t) => (t.target !== 'ios' ? t : { ...t, lanes: t.lanes.map((x) => (x.lane !== 'device-frames' || x.device === null ? x : { ...x, device: { ...x.device, sets: f(x.device.sets) } })) })),
    });
    const dropped = edit((sets) => sets.filter((d) => d.dpr !== first.dpr));
    expect(deviceCoverageProblems(dropped, ios)).toEqual([`ios device-frames records 0 sets at DPR ${first.dpr}, not 1`]);
    expect(nativeVerdict('ios', dropped, [], configured).notPassing).toEqual([`ios device-frames records 0 sets at DPR ${first.dpr}, not 1`]);
    const short = edit((sets) => sets.map((d) => (d.dpr === first.dpr ? { ...d, dumps: d.dumps - 1 } : d)));
    expect(nativeVerdict('ios', short, [], configured).notPassing).toEqual([`ios device-frames at DPR ${first.dpr} records ${first.ids.length - 1} dumps of ${first.ids.length} cases, not ${first.ids.length}`]);
    const twice = edit((sets) => [...sets, ...sets.filter((d) => d.dpr === first.dpr)]);
    expect(nativeVerdict('ios', twice, [], configured).notPassing).toEqual([`ios device-frames records 2 sets at DPR ${first.dpr}, not 1`]);
    const undeclared = edit((sets) => [...sets, { ...(sets[0] as (typeof sets)[number]), dpr: 7 }]);
    expect(nativeVerdict('ios', undeclared, [], configured).notPassing).toEqual(['ios device-frames records DPR 7, which it does not declare']);
  });
});
