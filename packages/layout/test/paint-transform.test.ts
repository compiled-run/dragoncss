// PNT2: the paint transform reference. It reuses the interpolation reference's functions and matrix steps (rt-interpolate.ts,
// checked string for string against Chrome 145), adds the transform origin as Blink's ApplyTransform does, and the platform steps
// (a matrix about a CALayer anchor point, a mapped point). The committed vector inputs are this file's generator's output.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TransformOrigin } from '../src/paint-transform.ts';
import { mapPoint, paintTransformMatrix, resolveTransformOrigin, transformAboutPoint, transformFunctionsMatrix } from '../src/paint-transform.ts';
import type { Matrix2D, TransformOp } from '../src/rt-interpolate.ts';
import { lengthPercent, lengthPx, rotateOp, scaleOp, serializeMatrix, serializeTransform, transformMatrix, translateOp, ZERO_PX } from '../src/rt-interpolate.ts';
import { BOXES, OP_LISTS, ORIGINS, transformInputLines } from './paint-transform-cases.ts';

const TRIG = { sin: Math.sin, cos: Math.cos };
const CENTRE: TransformOrigin = { x: lengthPercent(50), y: lengthPercent(50) };

/** m1 · m2 in double, for checking compositions. */
function times(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return {
    full: true,
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}
const shift = (x: number, y: number): Matrix2D => ({ full: true, a: 1, b: 0, c: 0, d: 1, e: x, f: y });
function close(a: Matrix2D, b: Matrix2D, eps: number): void {
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) expect(Math.abs(a[k] - b[k]), `${k}: ${a[k]} vs ${b[k]}`).toBeLessThanOrEqual(eps);
}

describe('PNT2: paint transform reference', () => {
  it('the committed vector inputs are the generator output', () => {
    const committed = readFileSync(new URL('../paint-vectors/transform/inputs.jsonl', import.meta.url), 'utf8');
    expect(committed).toBe(`${transformInputLines().join('\n')}\n`);
  });

  it('the functions matrix is the interpolation reference matrix, the one Chrome serialises for getComputedStyle', () => {
    for (const ops of OP_LISTS) {
      for (const [w, h] of BOXES) {
        const m = transformFunctionsMatrix(ops, w, h, TRIG);
        expect(m).toEqual(transformMatrix(ops, w, h, TRIG));
        if (ops.length > 0) expect(serializeMatrix(m)).toBe(serializeTransform(ops, w, h, TRIG));
      }
    }
  });

  it('resolves the origin against the float border box (FloatValueForLength), percentages and calc included', () => {
    expect(resolveTransformOrigin(CENTRE, 100, 40)).toEqual({ x: 50, y: 20 });
    expect(resolveTransformOrigin({ x: lengthPx(0), y: lengthPercent(50) }, 33.34375, 17.015625)).toEqual({ x: 0, y: Math.fround(Math.fround(17.015625 * 50) / 100) });
    expect(resolveTransformOrigin({ x: lengthPx(-12.5), y: lengthPx(40) }, 0, 0)).toEqual({ x: -12.5, y: 40 });
    const o = resolveTransformOrigin({ x: { kind: 'calc', px: 3, percent: 20 }, y: lengthPercent(100) }, 50, 10);
    expect(o).toEqual({ x: 13, y: 10 });
  });

  it('the paint matrix is T(origin) · functions · T(-origin)', () => {
    for (const ops of OP_LISTS) {
      for (const o of ORIGINS) {
        for (const [w, h] of BOXES) {
          const p = resolveTransformOrigin(o, w, h);
          const want = times(times(shift(p.x, p.y), transformMatrix(ops, w, h, TRIG)), shift(-p.x, -p.y));
          const scale = Math.max(1, Math.abs(p.x), Math.abs(p.y), w, h) * 1e-3;
          close(paintTransformMatrix(ops, o, w, h, TRIG), want, scale);
        }
      }
    }
  });

  it('rotation is exact at multiples of 45deg (gfx::SinCosDegrees, T047 RT-4) and turns clockwise in y-down coordinates', () => {
    const m90 = paintTransformMatrix([rotateOp(90)], { x: lengthPx(0), y: lengthPx(0) }, 10, 10, TRIG);
    expect([m90.a, m90.b, m90.c, m90.d]).toEqual([0, 1, -1, 0]);
    const m180 = paintTransformMatrix([rotateOp(180)], CENTRE, 10, 10, TRIG);
    expect([m180.a, m180.b, m180.c, m180.d, m180.e, m180.f]).toEqual([-1, 0, -0, -1, 10, 10]);
    // (10, 0), the top right corner, turns 90deg clockwise about the top left onto (0, 10).
    expect(mapPoint(m90, 10, 0)).toEqual({ x: 0, y: 10 });
  });

  it('origin matters: rotate(90deg) about the centre and about the top left differ by the origin shift', () => {
    const a = paintTransformMatrix([rotateOp(90)], CENTRE, 100, 40, TRIG);
    const b = paintTransformMatrix([rotateOp(90)], { x: lengthPx(0), y: lengthPx(0) }, 100, 40, TRIG);
    expect([a.e, a.f]).toEqual([70, -30]);
    expect([b.e, b.f]).toEqual([0, 0]);
  });

  it('percent translations resolve against the box itself, not a containing block', () => {
    const m = paintTransformMatrix([translateOp('translate', lengthPercent(-50), lengthPercent(-50))], CENTRE, 36, 20, TRIG);
    expect([m.e, m.f]).toEqual([-18, -10]);
  });

  it('a matrix about a CALayer anchor point gives back the paint matrix: T(p) · X · T(-p) = m', () => {
    for (const ops of OP_LISTS) {
      const [w, h] = [120, 30];
      const m = paintTransformMatrix(ops, { x: lengthPx(0), y: lengthPercent(50) }, w, h, TRIG);
      const x = transformAboutPoint(m, w / 2, h / 2);
      close(times(times(shift(w / 2, h / 2), x), shift(-w / 2, -h / 2)), m, 1e-9 * Math.max(1, Math.abs(m.e), Math.abs(m.f), w));
    }
  });

  it('scale and translate compose in list order (css-transforms-1 §6: post-multiplied, applied right to left to the box)', () => {
    const ops: TransformOp[] = [scaleOp('scale', 2, 2), translateOp('translateX', lengthPx(10), ZERO_PX)];
    const m = paintTransformMatrix(ops, { x: lengthPx(0), y: lengthPx(0) }, 50, 50, TRIG);
    expect(mapPoint(m, 0, 0)).toEqual({ x: 20, y: 0 });
  });
});
