// PNT1 paint-radius.ts: Blink 145's radius geometry (CalcRadiiFor, gfx::SizeF's trivial clamp, ConstrainRadii and the padding-edge
// radii) in float steps, its planted faults, and the committed paint vectors (packages/layout/paint-vectors/radius), which the
// translated Swift and Kotlin reproduce bit for bit (translate/test/paint-roots.test.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { constrainCornerRadii, hasRoundedCorner, innerCornerRadii, NO_RADIUS_FAULTS, radiiRenderable, radiusComponent, resolveCornerRadii, roundedShape } from '../src/paint-radius.ts';

const px = (value: number) => ({ percent: false, value });
const pct = (value: number) => ({ percent: true, value });
const all = (l: { percent: boolean; value: number }) => [l, l, l, l, l, l, l, l];

describe('paint-radius: Blink 145 radius geometry', () => {
  it('zooms a fixed radius as float(css px x dpr) and resolves a percentage as float(float(axis x percent) / 100)', () => {
    expect(radiusComponent(px(0.35 * 16), 0, 2.625)).toBe(Math.fround(0.35 * 16 * 2.625));
    expect(radiusComponent(pct(33.333), 79, 1)).toBe(Math.fround(Math.fround(79 * Math.fround(33.333)) / 100));
    expect(radiusComponent(px(0), 100, 3)).toBe(0);
  });
  it('clamps a component of at most 8 float epsilons to 0 (gfx::SizeF)', () => {
    expect(resolveCornerRadii([px(1e-7), px(4), px(4), px(4), px(4), px(4), px(4), px(4)], 100, 50, 1)[0]).toBe(0);
    expect(resolveCornerRadii([px(1e-6), px(4), px(4), px(4), px(4), px(4), px(4), px(4)], 100, 50, 1)[0]).toBe(Math.fround(1e-6));
  });
  it('scales every radius by one factor min(L/S) when adjacent radii overflow a side (css-backgrounds-3 §5.5)', () => {
    // 120 + 120 over a 200 x 80 box: horizontal 240 > 200 gives 5/6, vertical 240 > 80 gives 1/3; the smaller wins.
    expect(constrainCornerRadii(Array(8).fill(120), 200, 80, NO_RADIUS_FAULTS)).toEqual(Array(8).fill(40));
    expect(constrainCornerRadii([60, 60, 0, 0, 40, 40, 0, 0], 100, 50, NO_RADIUS_FAULTS)).toEqual([50, 50, 0, 0, Math.fround(40 * Math.fround(100 / 120)), Math.fround(40 * Math.fround(100 / 120)), 0, 0]);
    expect(constrainCornerRadii([10, 10, 10, 10, 10, 10, 10, 10], 100, 50, NO_RADIUS_FAULTS)).toEqual(Array(8).fill(10));
  });
  it('a corner scaled to a zero component becomes square (FloatRoundedRect::Radii::Scale)', () => {
    expect(constrainCornerRadii([80, 30, 30, 80, 1e-6, 20, 20, 20], 100, 50, NO_RADIUS_FAULTS).slice(0, 1)).toEqual([0]);
  });
  it('shrinks each positive padding-edge component by the adjacent border width, and never below 0', () => {
    expect(innerCornerRadii([10, 10, 10, 10, 10, 10, 10, 10], [2, 3, 4, 5], 100, 50, NO_RADIUS_FAULTS)).toEqual([5, 7, 7, 5, 8, 8, 6, 6]);
    expect(innerCornerRadii([10, 0, 10, 10, 10, 10, 10, 10], [30, 30, 30, 30], 100, 100, NO_RADIUS_FAULTS)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('resolves percentages against the layout border box, then clamps to the snapped one, then gives the padding-edge radii', () => {
    // 50% of a 131.25 x 89.25 layout box snapped to 131 x 89 (calib-shadow-blur o12 at 2.625): 65.625 x 44.625, times
    // ConstrainRadii's min(131 / 131.25, 89 / 89.25), so not an oval; resolving against the snapped box gave 65.5 x 44.5.
    const o = roundedShape(625, 184, 756, 273, 131.25, 89.25, [0, 0, 0, 0], all(pct(50)), 2.625, NO_RADIUS_FAULTS);
    const f = Math.min(Math.fround(131 / 131.25), Math.fround(89 / 89.25));
    expect(o.slice(0, 4)).toEqual(Array(4).fill(Math.fround(65.625 * f)));
    expect(o[0]).toBeLessThan(65.5);
    const r = roundedShape(0, 0, 79, 79, 79, 79, [5, 5, 5, 5], all(pct(50)), 2.625, NO_RADIUS_FAULTS);
    expect(r.slice(0, 8)).toEqual(Array(8).fill(39.5));
    expect(r.slice(8)).toEqual(Array(8).fill(34.5));
    expect(hasRoundedCorner(r.slice(0, 8))).toBe(true);
    expect(hasRoundedCorner([0, 5, 0, 0, 5, 0, 0, 0])).toBe(false);
    expect(radiiRenderable(r.slice(0, 8), 79, 79)).toBe(true);
  });
  it('each planted fault changes the shape of a case that exercises it', () => {
    const over = roundedShape(0, 0, 100, 50, 100, 50, [4, 4, 4, 4], all(px(999)), 1, NO_RADIUS_FAULTS);
    expect(roundedShape(0, 0, 100, 50, 100, 50, [4, 4, 4, 4], all(px(999)), 1, { radiusUnclamped: true, innerRadiusNotReduced: false })).not.toEqual(over);
    const ring = roundedShape(0, 0, 100, 50, 100, 50, [4, 4, 4, 4], all(px(10)), 1, NO_RADIUS_FAULTS);
    expect(roundedShape(0, 0, 100, 50, 100, 50, [4, 4, 4, 4], all(px(10)), 1, { radiusUnclamped: false, innerRadiusNotReduced: true })).not.toEqual(ring);
  });
});

describe('paint-radius vectors', () => {
  it('are committed with faults on and off and cover every exported function', () => {
    const v = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'paint-vectors', 'radius', 'vectors.json'), 'utf8')) as { feature: string; lines: string[] };
    expect(v.feature).toBe('radius');
    const names = new Set(v.lines.map((l) => (JSON.parse(l) as string[])[0]));
    expect([...names].sort()).toEqual(['paint:radius:constrainCornerRadii', 'paint:radius:hasRoundedCorner', 'paint:radius:innerCornerRadii', 'paint:radius:radiiRenderable', 'paint:radius:radiusComponent', 'paint:radius:resolveCornerRadii', 'paint:radius:roundedShape']);
    expect(v.lines.length).toBeGreaterThanOrEqual(90);
  });
});
