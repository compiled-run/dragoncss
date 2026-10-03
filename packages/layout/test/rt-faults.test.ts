// Planted faults (T047 §3.1 verify 7): each one, switched on alone, must make the rt reference disagree with the Chrome oracle
// somewhere; with none switched on the reference agrees everywhere.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAnimationScript } from '../src/rt-animations.ts';
import type { EasingSpec, RtFaults } from '../src/rt-easing.ts';
import { cubicBezier, easingFromSpec, LINEAR, NO_RT_FAULTS, solveBezier } from '../src/rt-easing.ts';
import type { AnimatedValue, ValueRange } from '../src/rt-interpolate.ts';
import { interpolateValue, serializeValue, TRANSPARENT, ZERO_PX } from '../src/rt-interpolate.ts';
import type { RuleKeyframe } from '../src/rt-keyframes.ts';
import { groupFromRule, sampleKeyframeEffect } from '../src/rt-keyframes.ts';
import type { EffectTimingSpec, FillMode, PlaybackDirection, SecondsTiming } from '../src/rt-timing.ts';
import { advanceHeld, animationTiming, computeSecondsTiming, HELD_ZERO, seekPaused } from '../src/rt-timing.ts';
import type { ScriptStep, TransitionListing } from '../src/rt-transition.ts';
import { runTransitionScript } from '../src/rt-transition.ts';

type Combo = { readonly delayMs: number; readonly endDelayMs: number; readonly durationMs: number; readonly iterations: number | 'Infinity'; readonly iterationStart: number; readonly direction: PlaybackDirection; readonly fill: FillMode; readonly easing: EasingSpec };
type TimingOracle = { readonly combos: readonly Combo[]; readonly records: readonly (readonly [number, number, string | null, string | null])[] };
type EasingOracle = { readonly easings: readonly { readonly spec: EasingSpec }[]; readonly records: readonly (readonly [number, number, string | null])[] };
type Case = { readonly from: AnimatedValue; readonly to: AnimatedValue; readonly effectEasing: EasingSpec; readonly keyframeEasing: EasingSpec };
type InterpOracle = { readonly box: { readonly width: number; readonly height: number }; readonly cases: readonly Case[]; readonly records: readonly (readonly [number, number, string | null, string])[] };
const load = (name: string): unknown => JSON.parse(readFileSync(new URL(`../rt-oracle/${name}`, import.meta.url), 'utf8'));
const timing = load('timing.json') as TimingOracle;
const hold = load('hold.json') as TimingOracle;
const easing = load('easing.json') as EasingOracle;
const interp = load('interp.json') as InterpOracle;
const TRIG = { sin: Math.sin, cos: Math.cos };
const LINEAR_SPEC: EasingSpec = { kind: 'linear', x1: 0, y1: 0, x2: 0, y2: 0, steps: 0, position: 'end' };

function bits(v: number | null): string | null {
  if (v === null) return null;
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v);
  return b.toString('hex');
}

function timingSpec(c: Combo): EffectTimingSpec {
  return { ...c, iterations: c.iterations === 'Infinity' ? Infinity : c.iterations, easing: easingFromSpec(c.easing) };
}

function one(e: EasingSpec): EffectTimingSpec {
  return { delayMs: 0, endDelayMs: 0, durationMs: 1000, iterations: 1, iterationStart: 0, direction: 'normal', fill: 'both', easing: easingFromSpec(e) };
}

/** Mismatches between the reference under `faults` and every oracle record; the hold records are read 50 ms of timeline later. */
function mismatches(faults: RtFaults): number {
  let n = 0;
  for (const [o, elapsed] of [[timing, 0], [hold, 0.05]] as const) {
    for (const [i, t, progress, iteration] of o.records) {
      const r = animationTiming(timingSpec(o.combos[i] as Combo), seekPaused(t, 0, 1), elapsed, faults);
      if (bits(r.progress) !== progress || bits(r.currentIteration) !== iteration) n++;
    }
  }
  for (const [i, t, progress] of easing.records) {
    if (bits(animationTiming(one((easing.easings[i] as { spec: EasingSpec }).spec), seekPaused(t, 0, 1), 0, faults).progress) !== progress) n++;
  }
  for (const [i, t, , expected] of interp.records) {
    const c = interp.cases[i] as Case;
    const p = animationTiming(one(c.effectEasing), seekPaused(t, 0, 1), 0, faults).progress ?? 0;
    const k = c.keyframeEasing;
    const local = k.kind === 'cubic-bezier' ? solveBezier(cubicBezier(k.x1, k.y1, k.x2, k.y2), p, faults) : p;
    const v = interpolateValue(c.from, c.to, local, faults);
    if ((v.refused ? 'refused' : serializeValue(v.value, interp.box.width, interp.box.height, TRIG)) !== expected) n++;
  }
  return n;
}

// ANIM-b (T065): the frozen-timeline sections. Values are the cases' AnimatedValue fields; numbers are plain JSON numbers.
type Spec = { readonly v: AnimatedValue };
type Seconds = { readonly delay: number; readonly duration: number; readonly iterations: number | 'Infinity'; readonly direction: PlaybackDirection; readonly fill: FillMode; readonly easing: EasingSpec };
type Rule = readonly { readonly offset: number; readonly easing: EasingSpec | null; readonly value: Spec | null }[];
type Script = readonly (readonly [string, number])[];
type KeyframeCase = { readonly range: ValueRange; readonly underlying: Spec; readonly rule: Rule; readonly timing: Seconds };
type TransitionCase = { readonly range: ValueRange; readonly states: readonly { readonly value: Spec; readonly listing: { readonly mode: TransitionListing['mode']; readonly delay: number; readonly duration: number; readonly easing: EasingSpec } }[]; readonly steps: Script };
type AnimationCase = { readonly range: ValueRange; readonly rules: readonly { readonly name: string; readonly rule: Rule }[]; readonly states: readonly { readonly base: Spec; readonly entries: readonly { readonly name: string; readonly paused: boolean; readonly timing: Seconds }[] }[]; readonly steps: Script };
const advance = load('advance.json') as { readonly sequences: readonly (readonly number[])[]; readonly records: readonly (readonly [number, readonly (string | null)[]])[] };
const keyframes = load('keyframes.json') as { readonly cases: readonly KeyframeCase[]; readonly records: readonly (readonly [number, number, string | null, string])[] };
const transitions = load('transitions.json') as { readonly cases: readonly TransitionCase[]; readonly records: readonly (readonly [number, readonly unknown[]])[] };
const animations = load('animations.json') as { readonly cases: readonly AnimationCase[]; readonly records: readonly (readonly [number, readonly unknown[]])[] };

/** The value of a block that does not set the property; groupFromRule never reads it. */
const UNSET: AnimatedValue = { kind: 'opacity', number: 0, length: ZERO_PX, color: TRANSPARENT, ops: [] };
const seconds = (t: Seconds): SecondsTiming => ({ ...t, iterations: t.iterations === 'Infinity' ? Infinity : t.iterations, easing: easingFromSpec(t.easing) });
const ruleOf = (r: Rule): RuleKeyframe[] => r.map((k) => ({ offset: k.offset, hasEasing: k.easing !== null, easing: k.easing === null ? LINEAR : easingFromSpec(k.easing), sets: k.value !== null, value: k.value === null ? UNSET : k.value.v }));
const stepsOf = (s: Script): ScriptStep[] => s.map(([k, n]) => (k === 's' ? { kind: 'state', state: n, deltaMs: 0 } : { kind: 'advance', state: 0, deltaMs: n }));
const show = (v: AnimatedValue): string => serializeValue(v, interp.box.width, interp.box.height, TRIG);

/** Mismatches between the reference under `faults` and the ANIM-b oracle sections, by section. */
function animMismatches(faults: RtFaults): Record<string, number> {
  const n = { advance: 0, keyframes: 0, transitions: 0, animations: 0 };
  for (const [i, want] of advance.records) {
    let h = HELD_ZERO;
    const deltas = advance.sequences[i];
    if (deltas === undefined || deltas.length !== want.length) throw new Error(`advance record ${i} does not match its sequence`);
    deltas.forEach((d, k) => {
      h = advanceHeld(h, d, faults);
      if (bits(h.seconds * 1000) !== want[k]) n.advance++;
    });
  }
  for (const [i, t, progress, value] of keyframes.records) {
    const c = keyframes.cases[i];
    if (c === undefined) throw new Error(`keyframes record names case ${i}, which does not exist`);
    const timing = seconds(c.timing);
    const p = computeSecondsTiming({ ...timing, easing: LINEAR }, t / 1000, faults).progress;
    const v = sampleKeyframeEffect(timing, t / 1000, groupFromRule(ruleOf(c.rule), timing.easing), c.underlying.v, c.range, faults);
    if (bits(p) !== progress || (v === null ? show(c.underlying.v) : v.refused ? 'refused' : show(v.value)) !== value) n.keyframes++;
  }
  for (const [i, readings] of transitions.records) {
    const c = transitions.cases[i];
    if (c === undefined) throw new Error(`transitions record names case ${i}, which does not exist`);
    const states = c.states.map((s) => ({ value: s.value.v, listing: { ...s.listing, easing: easingFromSpec(s.listing.easing) } }));
    if (readings.length !== c.steps.length) throw new Error(`transition record ${i} has ${readings.length} readings for ${c.steps.length} steps`);
    runTransitionScript(states, c.range, stepsOf(c.steps), faults).forEach((r, k) => {
      if (JSON.stringify([show(r.value), r.durationMs === null ? null : bits(r.durationMs)]) !== JSON.stringify(readings[k])) n.transitions++;
    });
  }
  for (const [i, readings] of animations.records) {
    const c = animations.cases[i];
    if (c === undefined) throw new Error(`animations record names case ${i}, which does not exist`);
    const names = new Set(c.rules.map((r) => r.name));
    const states = c.states.map((s) => ({ base: s.base.v, entries: s.entries.map((e) => ({ name: e.name, hasKeyframes: names.has(e.name), paused: e.paused, timing: seconds(e.timing) })) }));
    const rules = c.rules.map((r) => ({ name: r.name, keyframes: ruleOf(r.rule) }));
    if (readings.length !== c.steps.length) throw new Error(`animation record ${i} has ${readings.length} readings for ${c.steps.length} steps`);
    runAnimationScript(states, rules, c.range, stepsOf(c.steps), faults).forEach((r, k) => {
      if (JSON.stringify([r.names, r.currentTimesMs.map(bits), r.playStates, show(r.value)]) !== JSON.stringify(readings[k])) n.animations++;
    });
  }
  return n;
}

/** The planted fault names of T047 §3.1, and the RtFaults field each one sets. */
const PLANTS: readonly (readonly [string, keyof RtFaults])[] = [
  ['newtonIterations3', 'newtonIterations3'],
  ['epsilon1e-6', 'epsilon1e6'],
  ['noSplineGuess', 'noSplineGuess'],
  ['stepsIgnoreBeforeFlag', 'stepsIgnoreBeforeFlag'],
  ['rotateViaMatrix', 'rotateViaMatrix'],
  ['colorUnpremultiplied', 'colorUnpremultiplied'],
  ['holdTimeLost', 'holdTimeLost'],
];

/** The ANIM-b plants of T065 §4 that live in the rt reference, and the oracle section each must fail. */
const ANIM_PLANTS: readonly (readonly [keyof RtFaults, string])[] = [
  ['heldTimeShortcut', 'advance'],
  ['noReversalShortening', 'transitions'],
  ['perKeyframeEasingIgnored', 'keyframes'],
  ['nameChangeKeepsAnimation', 'animations'],
  ['pauseLosesPhase', 'animations'],
  ['pauseClockRuns', 'animations'],
  ['nonNegativeUnclamped', 'keyframes'],
];

describe('rt planted faults', () => {
  it('names every RtFaults field once', () => {
    expect([...PLANTS.map(([, f]) => f), ...ANIM_PLANTS.map(([f]) => f)].sort()).toEqual(Object.keys(NO_RT_FAULTS).sort());
    expect(LINEAR_SPEC.kind).toBe('linear');
  });

  it('with no fault the reference equals the whole oracle', () => {
    expect(mismatches(NO_RT_FAULTS)).toBe(0);
  });

  for (const [name, field] of PLANTS) {
    it(`${name} is caught by the oracle`, () => {
      expect(mismatches({ ...NO_RT_FAULTS, [field]: true })).toBeGreaterThan(0);
    });
  }

  it('with no fault the reference equals every ANIM-b oracle section', () => {
    expect(advance.records.length).toBe(advance.sequences.length);
    expect(animMismatches(NO_RT_FAULTS)).toEqual({ advance: 0, keyframes: 0, transitions: 0, animations: 0 });
  });

  for (const [field, section] of ANIM_PLANTS) {
    it(`${field} is caught by the ${section} oracle`, () => {
      expect(animMismatches({ ...NO_RT_FAULTS, [field]: true })[section]).toBeGreaterThan(0);
    });
  }
});
