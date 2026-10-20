// PNT1 paint-shadow.ts: the shadow shapes (Blink's corner correction with the coverage factor, ConstrainRadii), the Skia path a
// shape takes, the A8 colour blit (measured exact against Chrome 145: approxMulDiv255 of the premultiplied colour, then the
// destination scaled by 256 - alpha), the clip-out of outer shadows, the inset layer, the planted faults, and the committed paint
// vectors the translated Swift and Kotlin reproduce bit for bit (translate/test/paint-roots.test.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BackdropFill, ShadowInput, ShadowLayer } from '../src/paint-shadow.ts';
import { backdropAt, blurredCoverage, encodeOver, insetShadowLayer, insetShadowLayerOver, NO_SHADOW_FAULTS, outerShadowLayer, outerShadowLayerOver, platformOver, shapeCoverage, shapeType, spreadShape } from '../src/paint-shadow.ts';
import { opacityAlpha8 } from '../src/paint.ts';

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

const fill = (left: number, top: number, right: number, bottom: number, radii: readonly number[], r: number, g: number, b: number, a: number): BackdropFill => ({ left, top, right, bottom, radii, r, g, b, a });

/** Chrome's pixel: every shadow's own layer (the single-shadow plain layer holds exactly its blit terms) blitted onto the backdrop in reverse order. */
function chromeOver(layers: readonly ShadowLayer[], back: readonly number[], x: number, y: number): number[] {
  const d = [...back];
  for (let k = layers.length - 1; k >= 0; k--) {
    const l = layers[k] as ShadowLayer;
    if (x < l.left || x >= l.right || y < l.top || y >= l.bottom) continue;
    const s = px(l, x, y);
    for (let c = 0; c < 3; c++) d[c] = (s[c] as number) + Math.floor(((d[c] as number) * (256 - (s[3] as number))) / 256);
  }
  return d;
}

describe('paint-shadow: the device layers over a backdrop', () => {
  it('rounds the platform composite to nearest, never on a tie', () => {
    expect(platformOver(0, 128, 200)).toBe(100);
    expect(platformOver(40, 90, 17)).toBe(40 + Math.round((17 * 165) / 255));
    expect(platformOver(0, 255, 255)).toBe(0);
    expect(platformOver(0, 0, 255)).toBe(255);
    for (let a = 0; a < 256; a++) for (let d = 0; d < 256; d++) expect(((2 * d * (255 - a)) % 510) === 255, `${a},${d}`).toBe(false);
  });
  it('encodes any colour over any backdrop as a valid premultiplied pixel that composites to it, the alpha nearest the layer', () => {
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % 256;
    };
    for (let n = 0; n < 20000; n++) {
      const c = [rand(), rand(), rand()];
      const b = [rand(), rand(), rand()];
      const a = rand();
      const e = encodeOver(c[0] as number, c[1] as number, c[2] as number, b[0] as number, b[1] as number, b[2] as number, a);
      const ea = e[3] as number;
      for (let k = 0; k < 3; k++) {
        expect(e[k]).toBeGreaterThanOrEqual(0);
        expect(e[k]).toBeLessThanOrEqual(ea);
        expect(platformOver(e[k] as number, ea, b[k] as number)).toBe(c[k]);
      }
    }
    // A black shadow at alpha 49 over 255: Chrome floors to 255 * 207 >> 8 = 206, the platform rounds 255 * 206 / 255 to 206 only
    // at alpha 49; at a darker Chrome colour the alpha moves up by one.
    expect(encodeOver(206, 206, 206, 255, 255, 255, 49)).toEqual([0, 0, 0, 49]);
    expect(encodeOver(205, 205, 205, 255, 255, 255, 49)).toEqual([0, 0, 0, 50]);
    expect(encodeOver(255, 255, 255, 255, 255, 255, 0)).toEqual([0, 0, 0, 0]);
    expect(() => encodeOver(256, 0, 0, 0, 0, 0, 0)).toThrow(/not 8-bit/);
    expect(() => encodeOver(0, 0, 0, 0, 0, -1, 0)).toThrow(/not 8-bit/);
    expect(() => encodeOver(0, 0, 0, 0, 0, 0, 0.5)).toThrow(/not 8-bit/);
  });
  it('paints the backdrop fills in order over the white root, each at its pixel centre, with Skia\'s solid-colour blit', () => {
    const stage = fill(0, 0, 40, 30, SQUARE, 43, 58, 74, 255);
    const tint = fill(2, 2, 14, 10, [3, 3, 3, 3, 3, 3, 3, 3], 200, 100, 20, 128);
    expect(backdropAt([], 5, 5)).toEqual([255, 255, 255]);
    expect(backdropAt([stage], 5, 5)).toEqual([43, 58, 74]);
    expect(backdropAt([stage], 45, 5)).toEqual([255, 255, 255]);
    // SkMulDiv255Round(200, 128) + ((43 * 128) >> 8) = 100 + 21.
    expect(backdropAt([stage, tint], 6, 6)).toEqual([121, 50 + 29, 10 + 37]);
    // The rounded corner leaves its corner pixel to the fill beneath; a clear fill paints nothing.
    expect(backdropAt([stage, tint], 2, 2)).toEqual([43, 58, 74]);
    expect(backdropAt([stage, fill(0, 0, 40, 30, SQUARE, 0, 0, 0, 0)], 5, 5)).toEqual([43, 58, 74]);
    expect(() => backdropAt([fill(0, 0, 4, 4, [1, 1], 0, 0, 0, 255)], 1, 1)).toThrow(/2 radii/);
    expect(() => backdropAt([fill(0, 0, 4, 4, SQUARE, 0, 0, 0, 255.5)], 1, 1)).toThrow(/not RGBA8/);
    expect(() => backdropAt([fill(0, 0, 4, 4, SQUARE, 256, 0, 0, 255)], 1, 1)).toThrow(/not RGBA8/);
  });
  // PNT1-opacity-b: native draws a folded fill as backdropAt over its ancestors and the fill itself. Device batch 3 (bf377f0a
  // packages/parity/out/device-failures-*.json) recorded Chrome's interior bytes for opacity-fold and opacity-web over the stage
  // rgb(40, 60, 80), and the native ones when the platform blended the translucent colour itself.
  it('gives the Chrome bytes device batch 3 recorded for the folded fills, which the platform blends missed', () => {
    const stage = fill(0, 0, 40, 40, SQUARE, 40, 60, 80, 255);
    const cases: readonly { id: string; c: readonly number[]; o: number; chrome: readonly number[]; ios: readonly number[]; android: readonly number[] }[] = [
      { id: 'of-a, ow-fold', c: [230, 80, 40], o: 0.3, chrome: [96, 65, 67], ios: [97, 66, 68], android: [97, 66, 68] },
      { id: 'of-d', c: [250, 220, 60], o: 1 / 3, chrome: [109, 113, 73], ios: [110, 113, 73], android: [110, 113, 73] },
      { id: 'of-j', c: [90, 200, 230], o: 0.62549, chrome: [71, 147, 173], ios: [71, 147, 174], android: [71, 148, 173] },
    ];
    const mdr = (a: number, b: number): number => {
      const p = a * b + 128;
      return (p + (p >> 8)) >> 8;
    };
    for (const k of cases) {
      const a = opacityAlpha8(k.o);
      expect(backdropAt([stage, fill(4, 4, 12, 12, SQUARE, k.c[0] as number, k.c[1] as number, k.c[2] as number, a)], 5, 5), k.id).toEqual(k.chrome);
      // UIKit blends the colour in float, rounding once; Android premultiplies to bytes, then blends in float. Chrome floors dst * (256 - a) / 256.
      const d = [40, 60, 80];
      expect([0, 1, 2].map((i) => Math.round(((k.c[i] as number) * a + (d[i] as number) * (255 - a)) / 255)), `${k.id} ios`).toEqual(k.ios);
      expect([0, 1, 2].map((i) => mdr(k.c[i] as number, a) + Math.round(((d[i] as number) * (255 - a)) / 255)), `${k.id} android`).toEqual(k.android);
    }
  });
  it('gives the bytes Chrome 145 painted for a translucent fill over a translucent fill over an opaque one', () => {
    // [opaque rgb, middle rgb, middle alpha, top rgb, top alpha, Chrome 145.0.7632.6 at DPR 1], from a sweep of 3000 such stacks
    // (rgba() backgrounds of nested 4 px boxes), all of which backdropAt matched; SkMulDiv255Round of dst matched 795.
    const shot: readonly (readonly number[])[] = [
      [231, 238, 231, 97, 94, 243, 162, 95, 48, 228, 78, 130, 117, 235],
      [64, 119, 165, 103, 125, 151, 40, 254, 54, 110, 139, 169, 83, 134],
      [108, 52, 211, 88, 173, 177, 36, 252, 91, 28, 104, 164, 77, 133],
      [184, 194, 149, 122, 243, 75, 44, 76, 214, 228, 93, 138, 206, 169],
      [90, 50, 183, 11, 185, 25, 113, 16, 222, 154, 247, 16, 218, 152],
      [14, 221, 142, 181, 227, 164, 115, 191, 124, 81, 87, 123, 189, 128],
      [115, 25, 113, 94, 239, 226, 130, 58, 103, 29, 18, 100, 131, 160],
      [15, 109, 22, 210, 14, 188, 73, 150, 141, 204, 116, 106, 108, 130],
    ];
    for (const v of shot) {
      const n = (i: number): number => v[i] as number;
      const fills = [fill(0, 0, 4, 4, SQUARE, n(0), n(1), n(2), 255), fill(0, 0, 4, 4, SQUARE, n(3), n(4), n(5), n(6)), fill(0, 0, 4, 4, SQUARE, n(7), n(8), n(9), n(10))];
      expect(backdropAt(fills, 1, 1), v.join()).toEqual([n(11), n(12), n(13)]);
    }
  });
  it('composites every pixel of the Over layers over their backdrop to Chrome\'s per-shadow blits', () => {
    const two = [shadow({ spread: 1, r: 255, a: 255 }), shadow({ x: -1, y: 1, blur: 3, spread: 0.5, r: 20, g: 40, b: 200, a: 77 })];
    const back = [fill(0, 0, 40, 30, SQUARE, 43, 58, 74, 255)];
    const over = outerShadowLayerOver(4, 4, 16, 12, SQUARE, true, two, 2, NO_SHADOW_FAULTS, back);
    const plain = outerShadowLayer(4, 4, 16, 12, SQUARE, true, two, 2, NO_SHADOW_FAULTS);
    const each = two.map((s) => outerShadowLayer(4, 4, 16, 12, SQUARE, true, [s], 2, NO_SHADOW_FAULTS));
    expect([over.left, over.top, over.right, over.bottom]).toEqual([plain.left, plain.top, plain.right, plain.bottom]);
    let differ = 0;
    for (let y = over.top; y < over.bottom; y++) {
      for (let x = over.left; x < over.right; x++) {
        const b = backdropAt(back, x, y);
        const want = chromeOver(each, b, x, y);
        const e = px(over, x, y);
        expect([0, 1, 2].map((k) => platformOver(e[k] as number, e[3] as number, b[k] as number)), `${x},${y}`).toEqual(want);
        const p = px(plain, x, y);
        if ([0, 1, 2].some((k) => platformOver(p[k] as number, p[3] as number, b[k] as number) !== want[k])) differ++;
      }
    }
    // The plain layer, one platform composite, misses Chrome's floors somewhere; the Over layer never does.
    expect(differ).toBeGreaterThan(0);
    const ins = [shadow({ inset: true, y: 1, blur: 2, a: 128 }), shadow({ inset: true, spread: 1, r: 255, g: 255, b: 255, a: 128 })];
    const own = [...back, fill(2, 2, 16, 12, SQUARE, 58, 110, 165, 255)];
    const io = insetShadowLayerOver(2, 2, 16, 12, [1, 2, 1, 2], SQUARE, ins, 2, NO_SHADOW_FAULTS, own);
    const ie = ins.map((s) => insetShadowLayer(2, 2, 16, 12, [1, 2, 1, 2], SQUARE, [s], 2, NO_SHADOW_FAULTS));
    for (let y = io.top; y < io.bottom; y++) {
      for (let x = io.left; x < io.right; x++) {
        const b = backdropAt(own, x, y);
        const e = px(io, x, y);
        expect([0, 1, 2].map((k) => platformOver(e[k] as number, e[3] as number, b[k] as number)), `${x},${y}`).toEqual(chromeOver(ie, b, x, y));
      }
    }
  });
});

describe('paint-shadow vectors', () => {
  it('are committed and cover every exported function', () => {
    const v = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'paint-vectors', 'shadow', 'vectors.json'), 'utf8')) as { feature: string; lines: string[] };
    expect(v.feature).toBe('shadow');
    const names = new Set(v.lines.map((l) => (JSON.parse(l) as string[])[0]));
    expect([...names].sort()).toEqual(['paint:shadow:backdropAt', 'paint:shadow:blurredCoverage', 'paint:shadow:encodeOver', 'paint:shadow:insetShadowLayer', 'paint:shadow:insetShadowLayerOver', 'paint:shadow:outerShadowLayer', 'paint:shadow:outerShadowLayerOver', 'paint:shadow:platformOver', 'paint:shadow:shapeCoverage', 'paint:shadow:shapeType', 'paint:shadow:spreadShape', 'paint:shadow:textShadowLayerOver']);
  });
});
