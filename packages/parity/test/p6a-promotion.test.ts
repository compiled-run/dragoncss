// P6a promotion rule (notes/T008-p5-review.md, T046 §5.5 item 2): a native row is exact only when every proving case passes every
// device lane of its target at every DPR (device-pixels too for a paint row); the committed lanes record and failure lists are
// checked before they decide anything, and any doubt about them (missing, stale, a failed lane parity, a count that disagrees)
// makes every native row caveat.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LaneFailure } from '../src/device-lanes.ts';
import { repoPath } from '../src/paths.ts';
import type { DeviceEvidence } from '../src/profile-rows.ts';
import { checkedFailures, checkedLanes, committedLanes, deviceEvidence, promotionBlocker } from '../src/profile-rows.ts';
import { nativeTargets } from '../src/targets.ts';

const lanes = committedLanes();
const committedFailures = (t: 'ios' | 'android'): LaneFailure[] => JSON.parse(readFileSync(repoPath(`packages/parity/out/device-failures-${t}.json`), 'utf8')) as LaneFailure[];

describe('the device evidence of the committed lanes', () => {
  it('is available on both targets: the record is current, lane parity passed and each failure list matches its counts', () => {
    for (const t of ['ios', 'android'] as const) expect(lanes.evidence(t).unavailable, t).toBeNull();
    expect(lanes.stale).toEqual([]);
  });
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
