// The rt interpolation reference against Chrome 145 (rt-oracle/interp.json): getComputedStyle strings equal string for string
// for numbers, length-percentages, angles, legacy colours and transform lists, including extrapolation past [0, 1].
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EasingSpec } from '../src/rt-easing.ts';
import { cubicBezier, EASE, easingFromSpec, evaluateEasing, NO_RT_FAULTS, solveBezier } from '../src/rt-easing.ts';
import type { AnimatedValue } from '../src/rt-interpolate.ts';
import { formatCssNumber, formatG, formatPrecision, interpolateColor, interpolateTransform, interpolateValue, legacyColorFromCss, lengthPercent, lengthPx, rotateOp, scaleOp, serializeColor, serializeTransform, serializeValue, TRANSPARENT, translateOp, ZERO_PX } from '../src/rt-interpolate.ts';
import type { EffectTimingSpec } from '../src/rt-timing.ts';
import { computeTiming, msToSeconds } from '../src/rt-timing.ts';

type Case = { readonly id: string; readonly property: string; readonly from: AnimatedValue; readonly to: AnimatedValue; readonly effectEasing: EasingSpec; readonly keyframeEasing: EasingSpec };
type InterpOracle = { readonly box: { readonly width: number; readonly height: number }; readonly cases: readonly Case[]; readonly records: readonly (readonly [number, number, string | null, string])[] };
const oracle = JSON.parse(readFileSync(new URL('../rt-oracle/interp.json', import.meta.url), 'utf8')) as InterpOracle;
const TRIG = { sin: Math.sin, cos: Math.cos };

function value(c: Case, timeMs: number): string {
  const timing: EffectTimingSpec = { delayMs: 0, endDelayMs: 0, durationMs: 1000, iterations: 1, iterationStart: 0, direction: 'normal', fill: 'both', easing: easingFromSpec(c.effectEasing) };
  const p = computeTiming(timing, msToSeconds(timeMs), NO_RT_FAULTS).progress ?? 0;
  const k = c.keyframeEasing;
  const local = k.kind === 'cubic-bezier' ? solveBezier(cubicBezier(k.x1, k.y1, k.x2, k.y2), p, NO_RT_FAULTS) : p;
  const v = interpolateValue(c.from, c.to, local, NO_RT_FAULTS);
  return v.refused ? 'refused' : serializeValue(v.value, oracle.box.width, oracle.box.height, TRIG);
}

describe('rt interpolation: Chrome oracle', () => {
  it('covers each primitive, with and without an overshooting easing', () => {
    const props = new Set(oracle.cases.map((c) => c.property));
    expect([...props].sort()).toEqual(['color', 'opacity', 'rotate', 'text-indent', 'transform']);
    expect(oracle.cases.filter((c) => c.id.endsWith('~overshoot')).length).toBeGreaterThan(30);
    expect(oracle.records.length).toBeGreaterThan(6000);
  });

  it('equals Chrome string for string at every sample', () => {
    const failures: string[] = [];
    for (const [i, t, , expected] of oracle.records) {
      const c = oracle.cases[i];
      if (c === undefined) throw new Error(`case ${i}`);
      const got = value(c, t);
      if (got !== expected) failures.push(`${c.id} t=${t}: chrome ${JSON.stringify(expected)}, reference ${JSON.stringify(got)}`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures.length).toBe(0);
  });

  it('rotate(0deg) to rotate(360deg) at 0.25 interpolates the angle: matrix(0, 1, -1, 0, 0, 0), as Chrome records it', () => {
    const r = interpolateTransform([rotateOp(0)], [rotateOp(360)], 0.25, NO_RT_FAULTS);
    expect(r.refused).toBe(false);
    expect(serializeTransform(r.ops, 100, 100, TRIG)).toBe('matrix(0, 1, -1, 0, 0, 0)');
    const i = oracle.cases.findIndex((c) => c.id === 'transform rotate(0deg) rotate(360deg)');
    expect(oracle.records.find((r) => r[0] === i && r[1] === 250)?.[3]).toBe('matrix(0, 1, -1, 0, 0, 0)');
  });

  it('the library opening frame at 250 ms: translateX(100%) to translateX(0%) under ease(0.5)', () => {
    const p = evaluateEasing(EASE, 0.5, false, NO_RT_FAULTS);
    const r = interpolateTransform([translateOp('translateX', lengthPercent(100), ZERO_PX)], [translateOp('translateX', lengthPercent(0), ZERO_PX)], p, NO_RT_FAULTS);
    expect(r.ops[0]?.x).toEqual({ kind: 'percent', px: 0, percent: Math.fround(100 + Math.fround(-100) * p) });
    // T047 RT-3 quotes translateX(19.7596…%): the float Blink stores starts with those digits.
    expect(String(r.ops[0]?.x.percent).startsWith('19.7596')).toBe(true);
  });
});

describe('rt interpolation: rules the oracle does not reach', () => {
  it('refuses lists that need matrix interpolation (ANIM-m)', () => {
    expect(interpolateTransform([rotateOp(0)], [translateOp('translateX', lengthPx(10), ZERO_PX)], 0.5, NO_RT_FAULTS).refused).toBe(true);
    expect(interpolateTransform([scaleOp('scale', 2, 2), rotateOp(0)], [rotateOp(10)], 0.5, NO_RT_FAULTS).refused).toBe(true);
    expect(interpolateTransform([], [], 0.5, NO_RT_FAULTS)).toEqual({ refused: false, ops: [] });
  });

  it('promotes none to identity functions: none to scale(1.08) is scale(1) to scale(1.08)', () => {
    const a = interpolateTransform([], [scaleOp('scale', 1.08, 1.08)], 0.5, NO_RT_FAULTS);
    const b = interpolateTransform([scaleOp('scale', 1, 1)], [scaleOp('scale', 1.08, 1.08)], 0.5, NO_RT_FAULTS);
    expect(a).toEqual(b);
  });

  it('transparent to a colour does not darken', () => {
    const red = legacyColorFromCss(255, 0, 0, 1);
    for (const p of [0.01, 0.25, 0.5, 0.99]) expect(serializeColor(interpolateColor(TRANSPARENT, red, p, NO_RT_FAULTS)).startsWith('rgba(255, 0, 0, ')).toBe(true);
  });

  it('formats numbers as printf %.6g (ties to even) and alpha as ToPrecision', () => {
    expect(formatG(10.03125, 6)).toBe('10.0312');
    expect(formatG(123456.5, 6)).toBe('123456');
    expect(formatG(1234565, 6)).toBe('1.23456e+06');
    expect(formatG(0.00001, 6)).toBe('1e-05');
    expect(formatG(6.666666666666665e-8, 6)).toBe('6.66667e-08');
    expect(formatG(999999.5, 6)).toBe('1e+06');
    expect(formatCssNumber(-0, 'px')).toBe('0px');
    expect(formatCssNumber(-12, 'deg')).toBe('-12deg');
    expect(formatCssNumber(0.8024033910598437, '')).toBe('0.802403');
    expect(formatPrecision(Math.fround(0.42), 2)).toBe('0.42');
    expect(formatPrecision(Math.fround(0.5), 2)).toBe('0.5');
    expect(formatPrecision(Math.fround(0.416), 3)).toBe('0.416');
  });

  it('serialises every kind through one entry point', () => {
    const base: AnimatedValue = { kind: 'opacity', number: 0.5, length: ZERO_PX, color: TRANSPARENT, ops: [] };
    expect(serializeValue(base, 0, 0, TRIG)).toBe('0.5');
    expect(serializeValue({ ...base, kind: 'length', length: { kind: 'calc', px: -5, percent: 20 } }, 0, 0, TRIG)).toBe('calc(20% - 5px)');
    expect(serializeValue({ ...base, kind: 'angle', number: 90 }, 0, 0, TRIG)).toBe('90deg');
    expect(serializeValue({ ...base, kind: 'transform' }, 0, 0, TRIG)).toBe('none');
    expect(interpolateValue(base, { ...base, kind: 'angle' }, 0.5, NO_RT_FAULTS).refused).toBe(true);
  });
});
