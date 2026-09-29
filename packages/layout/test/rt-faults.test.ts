// Planted faults (T047 §3.1 verify 7): each one, switched on alone, must make the rt reference disagree with the Chrome oracle
// somewhere; with none switched on the reference agrees everywhere.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EasingSpec, RtFaults } from '../src/rt-easing.ts';
import { cubicBezier, easingFromSpec, NO_RT_FAULTS, solveBezier } from '../src/rt-easing.ts';
import type { AnimatedValue } from '../src/rt-interpolate.ts';
import { interpolateValue, serializeValue } from '../src/rt-interpolate.ts';
import type { EffectTimingSpec, FillMode, PlaybackDirection } from '../src/rt-timing.ts';
import { animationTiming, seekPaused } from '../src/rt-timing.ts';

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

describe('rt planted faults', () => {
  it('names every RtFaults field once', () => {
    expect(PLANTS.map(([, f]) => f).sort()).toEqual(Object.keys(NO_RT_FAULTS).sort());
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
});
