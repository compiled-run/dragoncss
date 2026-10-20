// SELD-R2 PR 5 (step 5a): the forced-only interaction rows (profile-rows.ts deriveInteractionRows) are exact on a native target only
// for forced device cases that pass the four device checks and whose group's script passes device-traces there; they claim only
// :focus and :focus-visible, and never reach web. The forced device cases themselves (forced-device.ts) are checked below too.
import { describe, expect, it } from 'vitest';
import type { DeviceEvidence } from '../src/profile-rows.ts';
import { deriveInteractionRows, INTERACTION_ROW_LANES, interactionDeviceBlocker } from '../src/profile-rows.ts';
import { traceScriptOfForced } from '../src/cases.ts';
import { forcedDeviceCases } from '../src/forced-device.ts';
import { deviceCheckCases, forcedNativeCases, nativeCases } from '../src/native-host.ts';
import { deviceCheckCaseIds, nativeTargets, vectorCaseIds } from '../src/targets.ts';

const FOCUS = 'selector:pseudo-class(:focus)';
const VISIBLE = 'selector:pseudo-class(:focus-visible)';
const ids = ['interaction-focus~ix0', 'interaction-focus~ix1-rtl'];
const passing = [{ id: ids[0] as string, features: [FOCUS] }, { id: ids[1] as string, features: [FOCUS, VISIBLE, 'selector:pseudo-class(:hover)'] }];
const TRACES = ['interaction-focus~trace', 'interaction-focus-rtl~trace'];
/** Every row lane runs cases (device-traces their scripts); skip leaves one lane out, failing fails ids on lane. */
const ev = (cases: readonly string[], o: { failing?: readonly string[]; lane?: string; skip?: string; unavailable?: string } = {}): DeviceEvidence => ({
  target: 'ios',
  unavailable: o.unavailable ?? null,
  lanes: INTERACTION_ROW_LANES.filter((l) => l !== o.skip).map((lane) => ({ lane, perCase: true, passed: true, cases: new Set(lane === 'device-traces' ? cases.map(traceScriptOfForced) : cases), failing: new Set(lane === (o.lane ?? lane) ? (o.failing ?? []) : []) })),
});
const proof = (feature: string, cases: readonly string[]) => ({ aspect: 'computed-value', lane: 'chrome-dual', valueSubset: feature.slice(feature.indexOf(':') + 1), context: 'interaction/forced-only', cases });

describe('the forced-only interaction rows', () => {
  it('are exact for the focus pseudo-classes of the cases that pass every row lane, and leave other features out', () => {
    expect(INTERACTION_ROW_LANES).toEqual(['device-frames', 'device-applied', 'device-lines', 'device-pixels', 'device-traces']);
    expect(ids.map(traceScriptOfForced)).toEqual(TRACES);
    expect(traceScriptOfForced('t#2~ix3-rtl')).toBe('t-rtl~trace');
    expect(() => traceScriptOfForced('interaction-focus')).toThrow('is not a forced case id');
    for (const id of ids) expect(interactionDeviceBlocker(ev(ids), id)).toBeNull();
    expect(deriveInteractionRows('ios', passing, ev(ids))).toEqual([
      { feature: FOCUS, context: 'interaction/forced-only', status: 'exact', proofs: [proof(FOCUS, ids)] },
      { feature: VISIBLE, context: 'interaction/forced-only', status: 'exact', proofs: [proof(VISIBLE, [ids[1] as string])] },
    ]);
  });

  it('drop a case that fails, was not run, or lacks a lane, and give nothing without evidence or on web', () => {
    for (const lane of INTERACTION_ROW_LANES) {
      const run = lane === 'device-traces' ? TRACES[1] : ids[1];
      expect(interactionDeviceBlocker(ev(ids, { failing: [run as string], lane }), ids[1] as string), lane).toBe(`${run} fails ios ${lane}`);
      expect(interactionDeviceBlocker(ev(ids, { skip: lane }), ids[0] as string), lane).toBe(`ios has no ${lane} lane`);
    }
    expect(interactionDeviceBlocker(ev([ids[1] as string]), ids[0] as string)).toBe(`${ids[0]} is not run by ios device-frames at every DPR`);
    expect(interactionDeviceBlocker(ev(ids, { unavailable: 'lanes.json is stale' }), ids[0] as string)).toBe('lanes.json is stale');
    expect(deriveInteractionRows('ios', passing, ev([ids[0] as string]))).toEqual([{ feature: FOCUS, context: 'interaction/forced-only', status: 'exact', proofs: [proof(FOCUS, [ids[0] as string])] }]);
    expect(deriveInteractionRows('ios', passing, ev(ids, { failing: ids, lane: 'device-pixels' }))).toEqual([]);
    expect(deriveInteractionRows('ios', passing, null)).toEqual([]);
    expect(deriveInteractionRows('web', passing, ev(ids))).toEqual([]);
  });
});

describe('the forced device cases (forced-device.ts)', () => {
  const forced = forcedDeviceCases();
  it('force :focus or :focus-visible in a case with no focusable element, of interaction-focus and interaction-combo, in both directions', () => {
    expect(forced.length).toBeGreaterThan(0);
    expect([...new Set(forced.map((f) => f.spec.id))].sort()).toEqual(['interaction-combo', 'interaction-focus']);
    expect(forced.some((f) => f.case.environment.direction === 'rtl')).toBe(true);
    for (const f of forced) {
      expect(f.case.id, f.case.id).toMatch(/~ix\d+(-rtl)?$/);
      expect(f.features.length, f.case.id).toBeGreaterThan(0);
      for (const x of f.features) expect([FOCUS, VISIBLE], f.case.id).toContain(x);
      // The forcing runs in the case's prepare script, so every capture that runs it takes the state forced.
      expect(f.case.authoredPrepare, f.case.id).not.toBeNull();
      expect(f.case.forced, f.case.id).toBeUndefined();
    }
  });
  it('are device cases after every layout device case: in every device check lane, the app and the run, and nowhere else', () => {
    const fids = forced.map((f) => f.case.id);
    expect(deviceCheckCaseIds()).toEqual([...vectorCaseIds(), ...fids]);
    expect(deviceCheckCases().map((n) => n.case.id)).toEqual([...deviceCheckCaseIds()]);
    expect(nativeCases().some((n) => fids.includes(n.case.id))).toBe(false);
    for (const t of nativeTargets()) {
      for (const l of t.lanes) {
        const holds = l.sets.every((s) => fids.every((id) => s.ids.includes(id)));
        const none = l.sets.every((s) => fids.every((id) => !s.ids.includes(id)));
        if (['device-frames', 'device-applied', 'device-lines', 'device-pixels'].includes(l.lane)) expect(holds, `${t.target} ${l.lane}`).toBe(true);
        else expect(none, `${t.target} ${l.lane}`).toBe(true);
      }
    }
  });
  it('hold one engine input for both backends, from their interaction state\'s ready programs', () => {
    expect(forcedNativeCases().map((n) => n.case.id)).toEqual(forced.map((f) => f.case.id));
    for (const n of forcedNativeCases()) expect(JSON.stringify(n.programs.uikit.root), n.case.id).toBe(JSON.stringify(n.programs['android-views'].root));
  });
});
