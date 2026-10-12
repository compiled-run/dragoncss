// Keyframe groups, segments and sampling (T065 R10) and the value-range clamp (R13, M26) on hand-built cases; the Chrome
// oracle comparison is in rt-faults.test.ts.
import { describe, expect, it } from 'vitest';
import type { Easing } from '../src/rt-easing.ts';
import { EASE_IN, LINEAR, NO_RT_FAULTS, stepsEasing } from '../src/rt-easing.ts';
import type { AnimatedValue } from '../src/rt-interpolate.ts';
import { interpolateLengthInRange, lengthPercent, lengthPx, serializeValue, TRANSPARENT, ZERO_PX } from '../src/rt-interpolate.ts';
import type { PropertyKeyframe, RuleKeyframe } from '../src/rt-keyframes.ts';
import { completeKeyframes, groupFromRule, keyframeSegments, sampleKeyframeEffect, sampleKeyframes } from '../src/rt-keyframes.ts';

const BASE: AnimatedValue = { kind: 'opacity', number: 0, length: ZERO_PX, color: TRANSPARENT, ops: [] };
const op = (n: number): AnimatedValue => ({ ...BASE, number: Math.fround(n) });
const px = (n: number): AnimatedValue => ({ ...BASE, kind: 'length', length: lengthPx(n) });
const show = (v: AnimatedValue | undefined): string => (v === undefined ? 'none' : serializeValue(v, 100, 100, { sin: Math.sin, cos: Math.cos }));
const kf = (offset: number, value: AnimatedValue, easing: Easing = LINEAR): PropertyKeyframe => ({ offset, value, neutral: false, easing });
const block = (offset: number, value: AnimatedValue | null, easing: Easing | null = null): RuleKeyframe => ({ offset, hasEasing: easing !== null, easing: easing ?? LINEAR, sets: value !== null, value: value ?? BASE });
const STEPS2 = stepsEasing(2, 'end');

describe('keyframe groups', () => {
  it('adds neutral ends: offset 0 with the zero-offset easing, offset 1 linear (M20)', () => {
    const k = completeKeyframes({ keyframes: [kf(0.5, op(0))], zeroOffsetEasing: STEPS2 });
    expect(k.map((x) => [x.offset, x.neutral, x.easing])).toEqual([[0, true, STEPS2], [0.5, false, LINEAR], [1, true, LINEAR]]);
    expect(show(sampleKeyframes(k, op(1), 0.2, false, 'all', NO_RT_FAULTS)?.value)).toBe('1');
    expect(show(sampleKeyframes(k, op(1), 0.75, false, 'all', NO_RT_FAULTS)?.value)).toBe('0.5');
  });

  it('drops interior keyframes whose neighbours share their offset, and builds segments with infinite ends', () => {
    const k = completeKeyframes({ keyframes: [kf(0, px(0)), kf(0.5, px(1)), kf(0.5, px(2)), kf(0.5, px(3)), kf(1, px(4))], zeroOffsetEasing: LINEAR });
    expect(k.map((x) => show(x.value))).toEqual(['0px', '1px', '3px', '4px']);
    expect(keyframeSegments(k)).toEqual([
      { startIndex: 0, endIndex: 1, applyFrom: -Infinity, applyTo: 0.5 },
      { startIndex: 2, endIndex: 3, applyFrom: 0.5, applyTo: Infinity },
    ]);
    const ends = keyframeSegments([kf(0, px(0)), kf(0, px(1)), kf(1, px(2)), kf(1, px(3))]);
    expect(ends).toEqual([{ startIndex: 0, endIndex: 0, applyFrom: -Infinity, applyTo: 0 }, { startIndex: 1, endIndex: 2, applyFrom: 0, applyTo: 1 }, { startIndex: 3, endIndex: 3, applyFrom: 1, applyTo: Infinity }]);
  });

  it('merges blocks at one offset only when their easings match; an unmerged block keeps its value', () => {
    const g = groupFromRule([block(0, px(10)), block(0.5, px(50), EASE_IN), block(0, px(0)), block(0.5, px(70), STEPS2), block(1, px(100))], LINEAR);
    expect(g.keyframes.map((x) => [x.offset, show(x.value)])).toEqual([[0, '0px'], [0.5, '50px'], [0.5, '70px'], [1, '100px']]);
    const same = groupFromRule([block(0.5, px(50), EASE_IN), block(0.5, null, EASE_IN), block(0.5, px(60), STEPS2)], LINEAR);
    expect(same.keyframes.map((x) => show(x.value))).toEqual(['60px']);
    const into = groupFromRule([block(0.5, px(50), EASE_IN), block(0.5, null, EASE_IN)], LINEAR);
    expect(into.keyframes.map((x) => [show(x.value), x.easing])).toEqual([['50px', EASE_IN]]);
  });

  it('takes the zero-offset easing from the last offset-0 block, setting the property or not', () => {
    expect(groupFromRule([block(0, null, STEPS2), block(0.4, px(80))], EASE_IN).zeroOffsetEasing).toBe(STEPS2);
    expect(groupFromRule([block(0.4, px(80))], EASE_IN).zeroOffsetEasing).toBe(EASE_IN);
  });

  it('refuses a non-finite offset', () => {
    expect(() => groupFromRule([block(Number.NaN, px(1))], LINEAR)).toThrow(/finite/);
  });
});

describe('keyframe sampling', () => {
  it('eases with the start keyframe and the before flag (M21): steps(2) from 0 reads 0 at 400 ms', () => {
    const group = groupFromRule([block(0, op(0), STEPS2), block(1, op(1))], LINEAR);
    const timing = { delay: 0, duration: 1, iterations: 1, direction: 'normal' as const, fill: 'none' as const, easing: LINEAR };
    expect(show(sampleKeyframeEffect(timing, 0.4, group, op(0.5), 'all', NO_RT_FAULTS)?.value)).toBe('0');
    expect(show(sampleKeyframeEffect(timing, 0.4, group, op(0.5), 'all', { ...NO_RT_FAULTS, perKeyframeEasingIgnored: true })?.value)).toBe('0.4');
    expect(sampleKeyframeEffect(timing, 1.5, group, op(0.5), 'all', NO_RT_FAULTS)).toBeNull();
  });

  it('uses the left limit in the before phase', () => {
    const group = groupFromRule([block(0, px(0), stepsEasing(2, 'jump-start')), block(1, px(100))], LINEAR);
    const timing = { delay: 0.3, duration: 1, iterations: 1, direction: 'normal' as const, fill: 'backwards' as const, easing: LINEAR };
    expect(show(sampleKeyframeEffect(timing, 0.1, group, px(5), 'all', NO_RT_FAULTS)?.value)).toBe('0px');
    expect(show(sampleKeyframeEffect(timing, 0.3, group, px(5), 'all', NO_RT_FAULTS)?.value)).toBe('50px');
  });
});

describe('value ranges (M26)', () => {
  it('clamps px and % at 0 for non-negative properties, keeps calc() and every value of an all-range property', () => {
    expect(interpolateLengthInRange(lengthPx(2), lengthPx(50), -0.156, 'non-negative', NO_RT_FAULTS)).toEqual(ZERO_PX);
    expect(interpolateLengthInRange(lengthPx(2), lengthPx(50), -0.156, 'all', NO_RT_FAULTS).px).toBeLessThan(0);
    expect(interpolateLengthInRange(lengthPx(2), lengthPx(50), -0.156, 'non-negative', { ...NO_RT_FAULTS, nonNegativeUnclamped: true }).px).toBeLessThan(0);
    expect(interpolateLengthInRange(lengthPercent(2), lengthPercent(50), -0.5, 'non-negative', NO_RT_FAULTS)).toEqual({ kind: 'percent', px: 0, percent: 0 });
    expect(interpolateLengthInRange(lengthPx(10), lengthPercent(50), -0.5, 'non-negative', NO_RT_FAULTS).kind).toBe('calc');
  });
});
