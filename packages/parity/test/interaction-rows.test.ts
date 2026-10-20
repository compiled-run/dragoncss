// SELD-R2 PR 5 (step 5a): the forced-only interaction rows (profile-rows.ts deriveInteractionRows) are exact on a native target only
// for forced cases that pass every INTERACTION_ROW_LANES lane there, claim only :focus and :focus-visible, and never reach web.
import { describe, expect, it } from 'vitest';
import type { DeviceEvidence } from '../src/profile-rows.ts';
import { deriveInteractionRows, INTERACTION_ROW_LANES, interactionDeviceBlocker } from '../src/profile-rows.ts';

const FOCUS = 'selector:pseudo-class(:focus)';
const VISIBLE = 'selector:pseudo-class(:focus-visible)';
const ids = ['interaction-focus~ix0', 'interaction-focus~ix1-rtl'];
const passing = [{ id: ids[0] as string, features: [FOCUS] }, { id: ids[1] as string, features: [FOCUS, VISIBLE, 'selector:pseudo-class(:hover)'] }];
/** Every row lane runs cases; skip leaves one lane out, failing fails ids on lane. */
const ev = (cases: readonly string[], o: { failing?: readonly string[]; lane?: string; skip?: string; unavailable?: string } = {}): DeviceEvidence => ({
  target: 'ios',
  unavailable: o.unavailable ?? null,
  lanes: INTERACTION_ROW_LANES.filter((l) => l !== o.skip).map((lane) => ({ lane, perCase: true, passed: true, cases: new Set(cases), failing: new Set(lane === (o.lane ?? lane) ? (o.failing ?? []) : []) })),
});
const proof = (feature: string, cases: readonly string[]) => ({ aspect: 'computed-value', lane: 'chrome-dual', valueSubset: feature.slice(feature.indexOf(':') + 1), context: 'interaction/forced-only', cases });

describe('the forced-only interaction rows', () => {
  it('are exact for the focus pseudo-classes of the cases that pass every row lane, and leave other features out', () => {
    expect(INTERACTION_ROW_LANES).toEqual(['device-states', 'device-frames', 'device-applied', 'device-pixels']);
    for (const id of ids) expect(interactionDeviceBlocker(ev(ids), id)).toBeNull();
    expect(deriveInteractionRows('ios', passing, ev(ids))).toEqual([
      { feature: FOCUS, context: 'interaction/forced-only', status: 'exact', proofs: [proof(FOCUS, ids)] },
      { feature: VISIBLE, context: 'interaction/forced-only', status: 'exact', proofs: [proof(VISIBLE, [ids[1] as string])] },
    ]);
  });

  it('drop a case that fails, was not run, or lacks a lane, and give nothing without evidence or on web', () => {
    for (const lane of INTERACTION_ROW_LANES) {
      expect(interactionDeviceBlocker(ev(ids, { failing: [ids[1] as string], lane }), ids[1] as string), lane).toBe(`${ids[1]} fails ios ${lane}`);
      expect(interactionDeviceBlocker(ev(ids, { skip: lane }), ids[0] as string), lane).toBe(`ios has no ${lane} lane`);
    }
    expect(interactionDeviceBlocker(ev([ids[1] as string]), ids[0] as string)).toBe(`${ids[0]} is not run by ios device-states at every DPR`);
    expect(interactionDeviceBlocker(ev(ids, { unavailable: 'lanes.json is stale' }), ids[0] as string)).toBe('lanes.json is stale');
    expect(deriveInteractionRows('ios', passing, ev([ids[0] as string]))).toEqual([{ feature: FOCUS, context: 'interaction/forced-only', status: 'exact', proofs: [proof(FOCUS, [ids[0] as string])] }]);
    expect(deriveInteractionRows('ios', passing, ev(ids, { failing: ids, lane: 'device-pixels' }))).toEqual([]);
    expect(deriveInteractionRows('ios', passing, null)).toEqual([]);
    expect(deriveInteractionRows('web', passing, ev(ids))).toEqual([]);
  });
});
