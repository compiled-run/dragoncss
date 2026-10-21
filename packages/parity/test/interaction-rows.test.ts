// SELD-R2 PR 5 (step 5a): the forced-only interaction rows (profile-rows.ts deriveInteractionRows) are exact on a native target only
// for forced device cases that pass the four device checks and whose group's script passes device-traces there; they claim only
// :focus and :focus-visible, and never reach web. The forced device cases themselves (forced-device.ts) are checked below too.
import { describe, expect, it } from 'vitest';
import type { DeviceEvidence } from '../src/profile-rows.ts';
import { cutForceSteps, deriveInteractionRows, forceStepKey, INTERACTION_ROW_LANES, interactionDeviceBlocker } from '../src/profile-rows.ts';
import { isForcedCaseId, traceScriptOfForced } from '../src/cases.ts';
import { forcedDeviceCases, stateDigest } from '../src/forced-device.ts';
import { keptForceSteps, MAX_TRACE_STEPS } from '../src/trace-lane.ts';
import { deviceCheckCases, forcedNativeCases, nativeCases } from '../src/native-host.ts';
import { deviceCheckCaseIds, nativeTargets, vectorCaseIds } from '../src/targets.ts';

const FOCUS = 'selector:pseudo-class(:focus)';
const VISIBLE = 'selector:pseudo-class(:focus-visible)';
const ids = ['interaction-focus~ix0', 'interaction-focus~ix1-rtl'];
/** The device ids of ids: a state digest each, never the state index. */
const devs = ['interaction-focus~fx0123456789ab', 'interaction-focus~fxba9876543210-rtl'];
const at = (k: 0 | 1, cut: readonly string[] = []) => ({ id: ids[k] as string, device: devs[k] as string, cut });
const passing = [{ ...at(0), features: [FOCUS] }, { ...at(1), features: [FOCUS, VISIBLE, 'selector:pseudo-class(:hover)'] }];
const TRACES = ['interaction-focus~trace', 'interaction-focus-rtl~trace'];
/** Every row lane runs cases (device-traces their scripts); skip leaves one lane out, failing fails ids on lane. */
const ev = (cases: readonly string[], o: { failing?: readonly string[]; lane?: string; skip?: string; unavailable?: string } = {}): DeviceEvidence => ({
  target: 'ios',
  unavailable: o.unavailable ?? null,
  lanes: INTERACTION_ROW_LANES.filter((l) => l !== o.skip).map((lane) => ({ lane, perCase: true, passed: true, cases: new Set(lane === 'device-traces' ? cases.map((c) => traceScriptOfForced(ids[devs.indexOf(c)] as string)) : cases), failing: new Set(lane === (o.lane ?? lane) ? (o.failing ?? []) : []) })),
});
const proof = (feature: string, cases: readonly string[]) => ({ aspect: 'computed-value', lane: 'chrome-dual', valueSubset: feature.slice(feature.indexOf(':') + 1), context: 'interaction/forced-only', cases });

describe('the forced-only interaction rows', () => {
  it('are exact for the focus pseudo-classes of the cases that pass every row lane, and leave other features out', () => {
    expect(INTERACTION_ROW_LANES).toEqual(['device-frames', 'device-applied', 'device-lines', 'device-pixels', 'device-traces']);
    expect(ids.map(traceScriptOfForced)).toEqual(TRACES);
    expect(traceScriptOfForced('t#2~ix3-rtl')).toBe('t-rtl~trace');
    expect(() => traceScriptOfForced('interaction-focus')).toThrow('is not a forced case id');
    for (const k of [0, 1] as const) expect(interactionDeviceBlocker(ev(devs), at(k))).toBeNull();
    expect(deriveInteractionRows('ios', passing, ev(devs))).toEqual([
      { feature: FOCUS, context: 'interaction/forced-only', status: 'exact', proofs: [proof(FOCUS, ids)] },
      { feature: VISIBLE, context: 'interaction/forced-only', status: 'exact', proofs: [proof(VISIBLE, [ids[1] as string])] },
    ]);
  });

  it('drop a case that fails, was not run, or lacks a lane, and give nothing without evidence or on web', () => {
    for (const lane of INTERACTION_ROW_LANES) {
      const run = lane === 'device-traces' ? TRACES[1] : devs[1];
      expect(interactionDeviceBlocker(ev(devs, { failing: [run as string], lane }), at(1)), lane).toBe(`${run} fails ios ${lane}`);
      expect(interactionDeviceBlocker(ev(devs, { skip: lane }), at(0)), lane).toBe(`ios has no ${lane} lane`);
    }
    expect(interactionDeviceBlocker(ev([devs[1] as string]), at(0))).toBe(`${devs[0]} is not run by ios device-frames at every DPR`);
    // Evidence is keyed by the state digest: a run of the host id (the state index) proves nothing.
    expect(interactionDeviceBlocker(ev(devs), { ...at(0), device: ids[0] as string })).toBe(`${ids[0]} is not run by ios device-frames at every DPR`);
    expect(interactionDeviceBlocker(ev(devs, { unavailable: 'lanes.json is stale' }), at(0))).toBe('lanes.json is stale');
    expect(deriveInteractionRows('ios', passing, ev([devs[0] as string]))).toEqual([{ feature: FOCUS, context: 'interaction/forced-only', status: 'exact', proofs: [proof(FOCUS, [ids[0] as string])] }]);
    expect(deriveInteractionRows('ios', passing, ev(devs, { failing: devs, lane: 'device-pixels' }))).toEqual([]);
    expect(deriveInteractionRows('ios', passing, null)).toEqual([]);
    expect(deriveInteractionRows('web', passing, ev(devs))).toEqual([]);
  });

  it('drop a case whose group script cuts a step it forces at MAX_TRACE_STEPS, though its traces pass', () => {
    const force = [{ pseudo: 'focus', address: 'a' }, { pseudo: 'focus-visible', address: 'a' }];
    expect(forceStepKey(force[0] as { pseudo: string; address: string })).toBe('focus@a');
    expect(cutForceSteps(force, new Set(['focus@a', 'focus-visible@a', 'hover@b']))).toEqual([]);
    expect(cutForceSteps(force, new Set(['focus@a']))).toEqual(['focus-visible@a']);
    expect(interactionDeviceBlocker(ev(devs), at(1, ['focus-visible@a']))).toBe(`${TRACES[1]} cuts the force steps focus-visible@a of ${devs[1]} at MAX_TRACE_STEPS`);
    expect(deriveInteractionRows('ios', [{ ...at(0, ['focus@a']), features: [FOCUS] }], ev(devs))).toEqual([]);
    expect(keptForceSteps('no-such-group~trace').size).toBe(0);
  });
});

describe('the forced device cases (forced-device.ts)', () => {
  const forced = forcedDeviceCases();
  it('force :focus or :focus-visible in a case with no focusable element, of interaction-focus and interaction-combo, in both directions', () => {
    expect(forced.length).toBeGreaterThan(0);
    expect([...new Set(forced.map((f) => f.spec.id))].sort()).toEqual(['interaction-combo', 'interaction-focus']);
    expect(forced.some((f) => f.case.environment.direction === 'rtl')).toBe(true);
    for (const f of forced) {
      // The device id carries a digest of the state key; the host id (chrome-dual, device-traces) its state index.
      expect(f.case.id, f.case.id).toBe(f.hostId.replace(/~ix\d+/, `~fx${stateDigest(f.case.interaction as string)}`));
      expect(f.hostId, f.case.id).toMatch(/~ix\d+(-rtl)?$/);
      expect(isForcedCaseId(f.case.id) && isForcedCaseId(f.hostId), f.case.id).toBe(true);
      expect(f.force.length, f.case.id).toBeGreaterThan(0);
      // Every step it forces survives its group script's MAX_TRACE_STEPS cut, so device-traces covers it.
      expect(cutForceSteps(f.force, keptForceSteps(traceScriptOfForced(f.hostId))), `${f.case.id} (cut at ${MAX_TRACE_STEPS})`).toEqual([]);
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
