// The rt vectors (packages/layout/rt-vectors) are the TS reference's outputs on the oracle inputs, for the ANIM-a2 Swift and
// Kotlin equality. They must be current: the reference reproduces every record, and they cover every oracle input.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EasingSpec, RtFaults } from '../src/rt-easing.ts';
import { cubicBezier, easingFromSpec, NO_RT_FAULTS, solveBezier } from '../src/rt-easing.ts';
import type { AnimatedValue } from '../src/rt-interpolate.ts';
import { interpolateValue, serializeValue } from '../src/rt-interpolate.ts';
import type { EffectTimingSpec, FillMode, PlaybackDirection } from '../src/rt-timing.ts';
import { animationTiming, computeTiming, msToSeconds, seekPaused } from '../src/rt-timing.ts';

type Combo = { readonly delayMs: number; readonly endDelayMs: number; readonly durationMs: number; readonly iterations: number | 'Infinity'; readonly iterationStart: number; readonly direction: PlaybackDirection; readonly fill: FillMode; readonly easing: EasingSpec };
type Timing = { readonly combos: readonly Combo[]; readonly records: readonly (readonly [number, number, string | null, string | null])[] };
type Hold = Timing & { readonly elapsedSeconds: number };
type Easings = { readonly easings: readonly { readonly spec: EasingSpec }[]; readonly records: readonly (readonly [number, number, string | null])[] };
type Case = { readonly from: AnimatedValue; readonly to: AnimatedValue; readonly effectEasing: EasingSpec; readonly keyframeEasing: EasingSpec };
type Interp = { readonly box: { readonly width: number; readonly height: number }; readonly cases: readonly Case[]; readonly records: readonly (readonly [number, number, string | null, string])[] };
const read = (dir: string, name: string): unknown => JSON.parse(readFileSync(new URL(`../${dir}/${name}`, import.meta.url), 'utf8'));
const TRIG = { sin: Math.sin, cos: Math.cos };

function bits(v: number | null): string | null {
  if (v === null) return null;
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v);
  return b.toString('hex');
}

/** Hold vectors the reference under `faults` fails: each animation is paused at timeMs and read elapsedSeconds later. */
function holdMismatches(v: Hold, faults: RtFaults): number {
  let bad = 0;
  for (const [i, t, p, it] of v.records) {
    const c = v.combos[i] as Combo;
    const r = animationTiming({ ...c, iterations: c.iterations === 'Infinity' ? Infinity : c.iterations, easing: easingFromSpec(c.easing) }, seekPaused(t, 0, 1), v.elapsedSeconds, faults);
    if (bits(r.progress) !== p || bits(r.currentIteration) !== it) bad++;
  }
  return bad;
}

function one(e: EasingSpec): EffectTimingSpec {
  return { delayMs: 0, endDelayMs: 0, durationMs: 1000, iterations: 1, iterationStart: 0, direction: 'normal', fill: 'both', easing: easingFromSpec(e) };
}

describe('rt vectors', () => {
  it('timing: every record reproduces and the inputs are the oracle inputs', () => {
    const v = read('rt-vectors', 'timing.json') as Timing;
    const o = read('rt-oracle', 'timing.json') as Timing;
    expect(v.combos).toEqual(o.combos);
    expect(v.records.map((r) => [r[0], r[1]])).toEqual(o.records.map((r) => [r[0], r[1]]));
    let bad = 0;
    for (const [i, t, p, it] of v.records) {
      const c = v.combos[i] as Combo;
      const r = computeTiming({ ...c, iterations: c.iterations === 'Infinity' ? Infinity : c.iterations, easing: easingFromSpec(c.easing) }, msToSeconds(t), NO_RT_FAULTS);
      if (bits(r.progress) !== p || bits(r.currentIteration) !== it) bad++;
    }
    expect(bad).toBe(0);
  });

  it('easing: every record reproduces and the inputs are the oracle inputs', () => {
    const v = read('rt-vectors', 'easing.json') as Easings;
    const o = read('rt-oracle', 'easing.json') as Easings;
    expect(v.easings).toEqual(o.easings);
    expect(v.records.map((r) => [r[0], r[1]])).toEqual(o.records.map((r) => [r[0], r[1]]));
    let bad = 0;
    for (const [i, t, p] of v.records) if (bits(computeTiming(one((v.easings[i] as { spec: EasingSpec }).spec), msToSeconds(t), NO_RT_FAULTS).progress) !== p) bad++;
    expect(bad).toBe(0);
  });

  it('interpolation: every record reproduces and the inputs are the oracle inputs', () => {
    const v = read('rt-vectors', 'interp.json') as Interp;
    const o = read('rt-oracle', 'interp.json') as Interp;
    expect(v.cases).toEqual(o.cases);
    expect(v.box).toEqual(o.box);
    expect(v.records.map((r) => [r[0], r[1]])).toEqual(o.records.map((r) => [r[0], r[1]]));
    let bad = 0;
    for (const [i, t, p, s] of v.records) {
      const c = v.cases[i] as Case;
      const progress = computeTiming(one(c.effectEasing), msToSeconds(t), NO_RT_FAULTS).progress;
      const k = c.keyframeEasing;
      const local = k.kind === 'cubic-bezier' ? solveBezier(cubicBezier(k.x1, k.y1, k.x2, k.y2), progress ?? 0, NO_RT_FAULTS) : progress ?? 0;
      const r = interpolateValue(c.from, c.to, local, NO_RT_FAULTS);
      if (bits(progress) !== p || (r.refused ? 'refused' : serializeValue(r.value, v.box.width, v.box.height, TRIG)) !== s) bad++;
    }
    expect(bad).toBe(0);
  });

  it('hold: the inputs and outputs are the oracle hold records, read after the timeline advanced', () => {
    const v = read('rt-vectors', 'hold.json') as Hold;
    const o = read('rt-oracle', 'hold.json') as Timing;
    expect(v.elapsedSeconds).toBeGreaterThan(0);
    expect(v.combos).toEqual(o.combos);
    expect(v.records).toEqual(o.records);
    expect(v.records.length).toBeGreaterThan(500);
    expect(holdMismatches(v, NO_RT_FAULTS)).toBe(0);
  });

  it('hold: a port that drops hold times (the holdTimeLost plant) fails the hold vectors', () => {
    const v = read('rt-vectors', 'hold.json') as Hold;
    expect(holdMismatches(v, { ...NO_RT_FAULTS, holdTimeLost: true })).toBeGreaterThan(0);
  });
});
