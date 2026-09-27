import { describe, expect, it } from 'vitest';
import * as u from '../src/units.ts';

const lu = (raw: number) => u.fromRaw(raw);

describe('Blink LayoutUnit arithmetic', () => {
  it('LayoutUnit(float) truncates float(v) * 64: 33.3px is raw 2131 (33.296875px), T001 §4.1', () => {
    expect(u.fromCssPx(33.3)).toBe(2131);
    expect(u.toPx(u.fromCssPx(33.3))).toBe(33.296875);
    expect(u.fromCssPx(-33.3)).toBe(-2131);
  });

  it('saturates to int32 like Blink', () => {
    expect(u.fromCssPx(1e12)).toBe(2147483647);
    expect(u.add(lu(2147483647), lu(1))).toBe(2147483647);
    expect(u.sub(lu(-2147483648), lu(1))).toBe(-2147483648);
  });

  it('ValueForLength percent: 33.3% of 400px is 133.1875px in Chrome 145', () => {
    expect(u.percentOf(u.fromCssPx(400), 33.3)).toBe(8524);
  });

  it('LayoutUnit / int truncates the raw value toward zero', () => {
    expect(u.divInt(lu(7), 2)).toBe(3);
    expect(u.divInt(lu(-7), 2)).toBe(-3);
    expect(u.divInt(lu(4672), 3)).toBe(1557);
  });

  it('FromFloatRound rounds halves away from zero', () => {
    expect(u.fromPxRound(2154.5 / 64)).toBe(2155);
    expect(u.fromPxRound(-1045.5 / 64)).toBe(-1046);
  });

  it('Floor() snaps to whole px toward negative infinity', () => {
    expect(u.floorToWholePx(lu(480))).toBe(448);
    expect(u.floorToWholePx(lu(-160))).toBe(-192);
  });

  it('grow shares follow Blink: remaining * grow / total, FromFloatRound', () => {
    const total = u.factorAdd(u.factorAdd(u.factorAdd(u.FACTOR_ZERO, 1), 1), 1);
    expect(u.growShare(lu(6464), 1, total)).toBe(2155);
  });

  it('shrink shares weight by the flex base size', () => {
    const w = u.shrinkWeight(1, u.fromCssPx(50));
    const total = u.factorAdd(u.factorAdd(u.factorAdd(u.FACTOR_ZERO, w), w), w);
    expect(u.shrinkShare(lu(-3200), 1, u.fromCssPx(50), total)).toBe(-1067);
  });

  it('Ahem metrics round to whole px (SkScalarRoundToScalar)', () => {
    expect(u.roundFontMetricToWholePx(u.fontMetricPx(10, 1000, 800))).toBe(8 * 64);
    expect(u.roundFontMetricToWholePx(u.fontMetricPx(16, 1000, 800))).toBe(13 * 64);
    expect(u.roundFontMetricToWholePx(u.fontMetricPx(16, 1000, 200))).toBe(3 * 64);
  });
});

describe('content distribution shares (Chrome 145 probes, raw LU)', () => {
  it('space-between rounds the cumulative share, halves up', () => {
    expect([1, 2, 3, 4, 5, 6].map((k) => u.cumulativeShareRounded(lu(8320), k, 6))).toEqual([1387, 2773, 4160, 5547, 6933, 8320]);
    expect(u.cumulativeShareRounded(lu(1), 1, 2)).toBe(1);
    expect(u.cumulativeShareRounded(lu(3), 1, 2)).toBe(2);
  });
  it('space-around: trunc(free/2n) plus round(free*k/n)', () => {
    expect([0, 1, 2].map((k) => u.distributedOffset('space-around', lu(7040), 3, k))).toEqual([1173, 3520, 5866]);
    expect([0, 1].map((k) => u.distributedOffset('space-around', lu(29), 2, k))).toEqual([7, 22]);
    expect([0, 1, 2, 3].map((k) => u.distributedOffset('space-around', lu(1107), 4, k))).toEqual([138, 415, 692, 968]);
  });
  it('space-evenly: trunc(free/(n+1)) plus round(free*k/(n+1))', () => {
    expect([0, 1, 2, 3, 4, 5].map((k) => u.distributedOffset('space-evenly', lu(9152), 6, k))).toEqual([1307, 2614, 3922, 5229, 6537, 7844]);
    expect([0, 1, 2, 3].map((k) => u.distributedOffset('space-evenly', lu(1107), 4, k))).toEqual([221, 442, 664, 885]);
  });
  it('space-between: round(free*k/(n-1))', () => {
    expect([0, 1, 2, 3].map((k) => u.distributedOffset('space-between', lu(1107), 4, k))).toEqual([0, 369, 738, 1107]);
  });
});
