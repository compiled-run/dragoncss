// PNT1 paint-shadow.ts: the shadow shapes (Blink's corner correction with the coverage factor, ConstrainRadii), the Skia path a
// shape takes, the A8 colour blit (measured exact against Chrome 145: approxMulDiv255 of the premultiplied colour, then the
// destination scaled by 256 - alpha), the clip-out of outer shadows, the inset layer, the planted faults, and the committed paint
// vectors the translated Swift and Kotlin reproduce bit for bit (translate/test/paint-roots.test.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ShadowInput, ShadowLayer } from '../src/paint-shadow.ts';
import { blurredCoverage, insetShadowLayer, NO_SHADOW_FAULTS, outerShadowLayer, shapeCoverage, shapeType, spreadShape } from '../src/paint-shadow.ts';

const SQUARE = [0, 0, 0, 0, 0, 0, 0, 0];
const shadow = (o: Partial<ShadowInput>): ShadowInput => ({ inset: false, x: 0, y: 0, blur: 0, spread: 0, r: 0, g: 0, b: 0, a: 255, ...o });
const px = (l: ShadowLayer, x: number, y: number): number[] => {
  const i = 4 * ((y - l.top) * (l.right - l.left) + (x - l.left));
  return l.rgba.slice(i, i + 4) as number[];
};

describe('paint-shadow: shapes', () => {
  it('outsets a rect by the spread and keeps it square', () => {
    expect(spreadShape(10, 10, 30, 22, SQUARE, 2, NO_SHADOW_FAULTS)).toEqual({ left: 8, top: 8, right: 32, bottom: 24, radii: SQUARE });
    expect(spreadShape(10, 10, 30, 22, SQUARE, -1.5, NO_SHADOW_FAULTS)).toEqual({ left: 11.5, top: 11.5, right: 28.5, bottom: 20.5, radii: SQUARE });
  });
  it('corrects each rounded corner by css-backgrounds-3 §7.1.1 with the coverage factor (ShadowContourFollowsBorder, stable at 145)', () => {
    // A 10 px radius on a 100 x 100 box spread by 20: coverage 0.2, ratio 0.5: 10 + 20 (1 - 0.125 (1 - 0.008)) = 27.52.
    const s = spreadShape(0, 0, 100, 100, [10, 10, 10, 10, 10, 10, 10, 10], 20, NO_SHADOW_FAULTS);
    expect(s.radii[0]).toBe(Math.fround(10 + 20 * (1 - 0.125 * (1 - 0.2 ** 3))));
    // A radius above the spread grows by the spread; a negative spread (an inset hole) shrinks it and never below 0.
    expect(spreadShape(0, 0, 100, 100, [30, 30, 30, 30, 30, 30, 30, 30], 20, NO_SHADOW_FAULTS).radii[0]).toBe(50);
    expect(spreadShape(0, 0, 100, 100, [4, 4, 4, 4, 4, 4, 4, 4], -6, NO_SHADOW_FAULTS).radii[0]).toBe(0);
  });
  it('classifies shapes as Skia does: rect, simple, oval, nine-patch and complex', () => {
    expect(shapeType({ left: 0, top: 0, right: 10, bottom: 8, radii: SQUARE })).toBe('rect');
    expect(shapeType({ left: 0, top: 0, right: 10, bottom: 8, radii: [2, 2, 2, 2, 2, 2, 2, 2] })).toBe('simple');
    expect(shapeType({ left: 0, top: 0, right: 10, bottom: 10, radii: [5, 5, 5, 5, 5, 5, 5, 5] })).toBe('oval');
    expect(shapeType({ left: 0, top: 0, right: 20, bottom: 10, radii: [4, 2, 2, 4, 3, 3, 1, 1] })).toBe('nine-patch');
    expect(shapeType({ left: 0, top: 0, right: 20, bottom: 10, radii: [4, 1.5, 0, 2, 2, 1.5, 0, 3] })).toBe('complex');
  });
  it('covers whole pixels fully, fractional edges by area and corners by their arc', () => {
    const r = { left: 0.5, top: 0, right: 4, bottom: 4, radii: SQUARE };
    expect(shapeCoverage(r, 1, 1)).toBe(255);
    expect(shapeCoverage(r, 0, 1)).toBe(128);
    expect(shapeCoverage(r, 5, 1)).toBe(0);
    const c = { left: 0, top: 0, right: 8, bottom: 8, radii: [4, 4, 4, 4, 4, 4, 4, 4] };
    expect(shapeCoverage(c, 0, 0)).toBe(0);
    expect(shapeCoverage(c, 3, 3)).toBe(255);
  });
});

describe('paint-shadow: layers', () => {
  it('blits a colour through the coverage as Chrome 145 does (SkOpts blit_mask_d32_a8_general, measured exact)', () => {
    // A 1 px blur of a 20 x 20 box: a black shadow at alpha 128 over coverage c gives premultiplied alpha (128 (c + 1)) >> 8.
    const l = outerShadowLayer(10, 10, 30, 30, SQUARE, true, [shadow({ blur: 1, a: 128 })], 1, NO_SHADOW_FAULTS);
    const cov = blurredCoverage({ left: 10, top: 10, right: 30, bottom: 30, radii: SQUARE }, 0.5, { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 });
    const c = cov.data[(20 - cov.bounds.top) * (cov.bounds.right - cov.bounds.left) + (9 - cov.bounds.left)] as number;
    expect(c).toBeGreaterThan(0);
    expect(px(l, 9, 20)).toEqual([0, 0, 0, Math.floor((128 * (c + 1)) / 256)]);
  });
  it('clips an outer shadow out of the border box, inset by one device px when the background is opaque', () => {
    const opaque = outerShadowLayer(10, 10, 30, 30, SQUARE, true, [shadow({ spread: 3 })], 1, NO_SHADOW_FAULTS);
    expect(px(opaque, 10, 20)[3]).toBe(255);
    expect(px(opaque, 11, 20)[3]).toBe(0);
    const clear = outerShadowLayer(10, 10, 30, 30, SQUARE, false, [shadow({ spread: 3 })], 1, NO_SHADOW_FAULTS);
    expect(px(clear, 10, 20)[3]).toBe(0);
    expect(px(clear, 9, 20)[3]).toBe(255);
  });
  it('paints the first shadow on top', () => {
    const l = outerShadowLayer(10, 10, 30, 30, SQUARE, false, [shadow({ spread: 2, r: 255 }), shadow({ spread: 4, b: 255 })], 1, NO_SHADOW_FAULTS);
    expect(px(l, 9, 20)).toEqual([255, 0, 0, 255]);
    expect(px(l, 7, 20)).toEqual([0, 0, 255, 255]);
  });
  it('an inset shadow fills the padding box around its hole; an empty hole fills it all', () => {
    const l = insetShadowLayer(10, 10, 40, 30, [2, 2, 2, 2], SQUARE, [shadow({ inset: true, spread: 4 })], 1, NO_SHADOW_FAULTS);
    expect([l.left, l.top, l.right, l.bottom]).toEqual([12, 12, 38, 28]);
    expect(px(l, 13, 20)[3]).toBe(255);
    expect(px(l, 25, 20)[3]).toBe(0);
    const full = insetShadowLayer(10, 10, 40, 30, [0, 0, 0, 0], SQUARE, [shadow({ inset: true, spread: 30 })], 1, NO_SHADOW_FAULTS);
    expect(px(full, 25, 20)[3]).toBe(255);
  });
  it('each planted fault changes a layer that exercises it', () => {
    const one = [shadow({ x: 2, y: 3, blur: 4, spread: 2, a: 200 })];
    const base = outerShadowLayer(10, 10, 30, 30, SQUARE, true, one, 2, NO_SHADOW_FAULTS);
    for (const f of ['spreadIgnored', 'sigmaHalfBlur', 'shadowNotClippedOut'] as const) {
      expect(outerShadowLayer(10, 10, 30, 30, SQUARE, true, one, 2, { ...NO_SHADOW_FAULTS, [f]: true }), f).not.toEqual(base);
    }
  });
});

describe('paint-shadow vectors', () => {
  it('are committed and cover every exported function', () => {
    const v = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'paint-vectors', 'shadow', 'vectors.json'), 'utf8')) as { feature: string; lines: string[] };
    expect(v.feature).toBe('shadow');
    const names = new Set(v.lines.map((l) => (JSON.parse(l) as string[])[0]));
    expect([...names].sort()).toEqual(['paint:shadow:blurredCoverage', 'paint:shadow:insetShadowLayer', 'paint:shadow:outerShadowLayer', 'paint:shadow:shapeCoverage', 'paint:shadow:shapeType', 'paint:shadow:spreadShape']);
  });
});
