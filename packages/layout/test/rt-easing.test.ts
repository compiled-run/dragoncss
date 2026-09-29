// The rt easing reference against Chrome 145 (rt-oracle/easing.json): every progress bit-equal, plus the gfx::CubicBezier and
// StepsTimingFunction behaviours the oracle cannot reach (x outside [0, 1], the before flag in isolation).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EasingSpec } from '../src/rt-easing.ts';
import { cubicBezier, EASE, easingFromSpec, easingKeyword, evaluateEasing, evaluateSteps, NO_RT_FAULTS, solveBezier, stepsEasing } from '../src/rt-easing.ts';
import type { EffectTimingSpec } from '../src/rt-timing.ts';
import { computeTiming, msToSeconds } from '../src/rt-timing.ts';

type EasingOracle = { readonly easings: readonly { readonly name: string; readonly spec: EasingSpec }[]; readonly records: readonly (readonly [number, number, string | null])[] };
const oracle = JSON.parse(readFileSync(new URL('../rt-oracle/easing.json', import.meta.url), 'utf8')) as EasingOracle;

function bits(v: number | null): string | null {
  if (v === null) return null;
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v);
  return b.toString('hex');
}

function progressAt(spec: EasingSpec, timeMs: number): string | null {
  const timing: EffectTimingSpec = { delayMs: 0, endDelayMs: 0, durationMs: 1000, iterations: 1, iterationStart: 0, direction: 'normal', fill: 'both', easing: easingFromSpec(spec) };
  return bits(computeTiming(timing, msToSeconds(timeMs), NO_RT_FAULTS).progress);
}

describe('rt easing: Chrome oracle', () => {
  it('covers every keyword, the demo curve, seeded curves with y outside [0, 1] and every steps() position', () => {
    const names = oracle.easings.map((e) => e.name);
    for (const n of ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'demo-ease']) expect(names).toContain(n);
    for (const p of ['jump-start', 'jump-end', 'jump-none', 'jump-both', 'start', 'end']) expect(names.some((n) => n.endsWith(`-${p}`))).toBe(true);
    expect(oracle.easings.some((e) => e.spec.kind === 'cubic-bezier' && (e.spec.y1 < 0 || e.spec.y2 > 1))).toBe(true);
    expect(oracle.records.length).toBeGreaterThan(10000);
  });

  it('equals Chrome bit for bit at every sample', () => {
    const failures: string[] = [];
    for (const [i, t, progress] of oracle.records) {
      const e = oracle.easings[i];
      if (e === undefined) throw new Error(`easing ${i}`);
      const ref = progressAt(e.spec, t);
      if (ref !== progress) failures.push(`${e.name} t=${t}: chrome ${progress}, reference ${ref}`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures.length).toBe(0);
  });

  it('the library frame: ease at x = 0.5 is 0.8024033910598437, as Chrome records it', () => {
    expect(evaluateEasing(EASE, 0.5, false, NO_RT_FAULTS)).toBe(0.8024033910598437);
    const i = oracle.easings.findIndex((e) => e.name === 'demo-ease');
    const rec = oracle.records.find((r) => r[0] === i && r[1] === 500);
    expect(rec?.[2]).toBe(bits(0.8024033910598437));
  });
});

describe('rt easing: gfx::CubicBezier outside [0, 1] and steps limits', () => {
  it('extrapolates with the start and end gradients', () => {
    const b = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(solveBezier(b, -0.5, NO_RT_FAULTS)).toBe(0.4 * -0.5);
    expect(solveBezier(b, 1.5, NO_RT_FAULTS)).toBe(1 + 0 * 0.5);
    // p1x = 0 with p1y = 0 falls back to the far control point; p2x = 1 with p2y = 1 likewise.
    expect(solveBezier(cubicBezier(0, 0, 0.58, 1), -1, NO_RT_FAULTS)).toBe(-1 / 0.58);
    expect(solveBezier(cubicBezier(0.42, 0, 1, 1), 2, NO_RT_FAULTS)).toBe(1 + (0 - 1) / (0.42 - 1));
    // Both control points coincident with an end point is linear; a vertical tangent breaks down to gradient 0.
    expect(solveBezier(cubicBezier(0, 0, 0, 0), -2, NO_RT_FAULTS)).toBe(-2);
    expect(solveBezier(cubicBezier(0, 0.5, 0, 1), -2, NO_RT_FAULTS)).toBe(0);
  });

  it('uses the left limit at a discontinuity only with the before flag', () => {
    expect(evaluateSteps(4, 'end', 0.5, false, NO_RT_FAULTS)).toBe(0.5);
    expect(evaluateSteps(4, 'end', 0.5, true, NO_RT_FAULTS)).toBe(0.25);
    expect(evaluateSteps(1, 'start', 0, false, NO_RT_FAULTS)).toBe(1);
    expect(evaluateSteps(1, 'start', 0, true, NO_RT_FAULTS)).toBe(0);
    expect(evaluateSteps(3, 'jump-none', 1, false, NO_RT_FAULTS)).toBe(1);
    expect(evaluateSteps(3, 'jump-both', 0, false, NO_RT_FAULTS)).toBe(0.25);
  });

  it('maps the keywords and rejects invalid steps()', () => {
    expect(easingKeyword('step-start')).toEqual(stepsEasing(1, 'start'));
    expect(easingKeyword('step-end')).toEqual(stepsEasing(1, 'end'));
    expect(easingKeyword('ease')).toBe(EASE);
    expect(easingKeyword('bounce')).toBeNull();
    expect(() => stepsEasing(1, 'jump-none')).toThrow();
    expect(() => stepsEasing(0, 'end')).toThrow();
    expect(() => stepsEasing(2.5, 'end')).toThrow();
  });
});
