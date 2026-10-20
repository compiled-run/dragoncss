// PNT1-opacity-b: an opacity group as Chrome 145's CPU raster composites it, so a device can present the result (Q) itself. In a cc
// raster tile where the group's only drawing is one opaque rect fill, cc folds the group alpha into the fill (cc
// PlaybackFoldingIterator) and Skia blits it as a solid colour (Skia 2ab8add5 src/opts/SkBlitRow_opts.h:243-270 blit_row_color32);
// in any other tile the group is a layer composited with blit_row_s32a_blend (src/core/SkBlitRow_D32.cpp:204-301, with
// src/core/SkColorData.h:134-137 SkAlphaMulInv256). Pixels are premultiplied RGBA8; the packed result is r + g * 2^8 + b * 2^16 +
// a * 2^24. Pinned against Chrome's pixels by packages/parity/test/pnt1-effects.test.ts.
import { ccTileEnd, ccTileIndex, ccTileSize, ccTileStart, fma32, roundHalfEven } from './paint-dither.ts';
import { floorOf, froundOf } from './rt-easing.ts';

function at(xs: readonly number[], i: number): number {
  const v = xs[i];
  if (v === undefined) throw new Error(`paint-group: no value at ${i}`);
  return v;
}

/** x >> 8 for a non-negative integer. */
function shr8(x: number): number {
  return floorOf(x / 256);
}

/** SkMulDiv255Round. */
function mulDiv255Round(a: number, b: number): number {
  const p = a * b + 128;
  return shr8(p + shr8(p));
}

/** One channel of blit_row_color32: a premultiplied colour channel c of alpha a over dst. */
function color32Channel(dst: number, c: number, a: number): number {
  return c + shr8(dst * (256 - a));
}

/** One channel of blit_row_s32a_blend: (src * alpha256 + dst * SkAlphaMulInv256(srcA, alpha256)) in a 16-bit lane, >> 8. */
function s32aChannel(dst: number, src: number, a256: number, ds: number): number {
  const sum = src * a256 + dst * ds;
  return shr8(sum - floorOf(sum / 65536) * 65536);
}

/** A premultiplied RGBA8 pixel packed as r + g * 2^8 + b * 2^16 + a * 2^24. */
export function groupPack(r: number, g: number, b: number, a: number): number {
  return r + g * 256 + b * 65536 + a * 16777216;
}

/**
 * The pixel Chrome shows where an opacity group of alpha byte a8 (paint.ts opacityAlpha8) meets the backdrop pixel d: l is the
 * group's layer pixel (its content drawn opaque into a transparent layer), both premultiplied. fold is whether the tile folds
 * (groupTileFolds): then an opaque layer pixel is the one fill, blitted at a8 with blit_row_color32, and a clear one leaves d.
 */
export function groupComposite(lr: number, lg: number, lb: number, la: number, dr: number, dg: number, db: number, da: number, a8: number, fold: boolean): number {
  if (a8 <= 0) return groupPack(dr, dg, db, da);
  if (fold && la === 0) return groupPack(dr, dg, db, da);
  // A partly covered pixel in a folding tile is ink Chrome culls from the tile (it draws the fill alone), so it takes the layer blit.
  if (fold && la === 255) {
    const sr = mulDiv255Round(lr, a8);
    const sg = mulDiv255Round(lg, a8);
    const sb = mulDiv255Round(lb, a8);
    if (a8 >= 255) return groupPack(sr, sg, sb, 255);
    return groupPack(color32Channel(dr, sr, a8), color32Channel(dg, sg, a8), color32Channel(db, sb, a8), color32Channel(da, a8, a8));
  }
  if (a8 >= 255) {
    // An alpha byte of 255 composites the layer opaque: srcover of premultiplied pixels (SkPMSrcOver, the 256 scale of color32).
    return groupPack(color32Channel(dr, lr, la), color32Channel(dg, lg, la), color32Channel(db, lb, la), color32Channel(da, la, la));
  }
  const a256 = a8 + 1;
  const prod = 65535 - la * a256;
  const ds = shr8(prod + shr8(prod));
  return groupPack(s32aChannel(dr, lr, a256, ds), s32aChannel(dg, lg, a256, ds), s32aChannel(db, lb, a256, ds), s32aChannel(da, la, a256, ds));
}

/** cc's raster tile size in device px for the reference Chrome (Mac) at a device scale factor (paint-dither.ts ccTileSize). */
export function groupTileSize(dpr: number): number {
  return ccTileSize(true, dpr);
}

/** The cc raster tile index of device coordinate v (paint-dither.ts ccTileIndex). */
export function groupTileIndex(v: number, tileSize: number): number {
  return ccTileIndex(v, tileSize);
}

/** The first device px of tile i (its bitmap, with the border texel), and one past its last: [start, end). */
export function groupTileSpan(i: number, tileSize: number): number[] {
  return [ccTileStart(i, tileSize), ccTileEnd(i, tileSize)];
}

/**
 * Whether cc folds a group's alpha into its drawing in a tile: draws holds the group's display items as flat groups of five
 * (left, top, right, bottom in device px, then 1 for an opaque rect fill alone or 0 for anything else: a box with a border, a text
 * run). The group folds when exactly one item meets the tile and it is a lone fill.
 */
export function groupTileFolds(draws: readonly number[], tileLeft: number, tileTop: number, tileRight: number, tileBottom: number): boolean {
  if (draws.length - 5 * floorOf(draws.length / 5) !== 0) throw new Error(`paint-group: draws hold ${draws.length} numbers, not groups of five`);
  let met = 0;
  let foldable = false;
  for (let k = 0; k < draws.length; k += 5) {
    const l = at(draws, k);
    const t = at(draws, k + 1);
    const r = at(draws, k + 2);
    const b = at(draws, k + 3);
    if (!(l < tileRight && r > tileLeft && t < tileBottom && b > tileTop)) continue;
    met += 1;
    foldable = at(draws, k + 4) === 1;
  }
  return met === 1 && foldable;
}

// ---------------------------------------------------------------- colour-matrix filters (PNT1-filter)
// A CSS filter list of grayscale, sepia, saturate, invert, opacity, brightness and contrast as Chrome 145's CPU raster applies it to a
// group's layer. Blink records a non-composited filter as a SaveLayer whose image filter is cc's chain of matrix colour filters
// (Chromium 145.0.7632.6 third_party/blink/renderer/platform/graphics/compositing/paint_chunks_to_cc_layer.cc:716-722,
// cc/paint/render_surface_filters.cc:153-191, each matrix built in float by cc/paint/render_surface_filters.cc:27-143). Skia composes
// them (Skia 2ab8add5 src/effects/colorfilters/SkComposeColorFilter.cpp:29-35) into one highp raster pipeline that restores the layer:
// per matrix unpremul, matrix_4x5, clamp_01, premul (src/effects/colorfilters/SkMatrixColorFilter.cpp:70-98), then srcover onto the
// destination and store_8888 (src/opts/SkRasterPipeline_opts.h:1776-1778 from_byte, :2038-2045 to_unorm, :2217 srcover, :2409-2414
// clamp_01, :2469-2485 premul and unpremul, :3443-3452 matrix_4x5), with fused mads (HSW and NEON) and round-half-even stores. The
// functions are coded 0 grayscale, 1 sepia, 2 saturate, 3 invert, 4 opacity, 5 brightness, 6 contrast. A filtered layer never takes
// cc's alpha fold, whatever it draws: Blink records a filter as a SaveLayerOp (paint_chunks_to_cc_layer.cc:716-722), with any
// opacity in a separate SaveLayerAlphaOp around it, and PlaybackFoldingIterator folds only a SaveLayerAlphaOp whose next op is a
// drawing op (cc/paint/paint_op_buffer_iterator.cc:41-66, :96-146), which a SaveLayerOp is not. Pinned against Chrome's pixels by
// packages/parity/test/pnt1-effects.test.ts.

/** The largest finite float32. */
const FLT_MAX = 3.4028234663852886e38;
/** from_byte's scale, 1 / 255.0f. */
const BYTE = froundOf(1 / 255);

function addf(a: number, b: number): number {
  return froundOf(a + b);
}

function subf(a: number, b: number): number {
  return froundOf(a - b);
}

function mulf(a: number, b: number): number {
  return froundOf(a * b);
}

/** A colour matrix that keeps alpha: its colour rows (each r, g, b coefficients and a translation), alpha row 0 0 0 1 0. */
function colourRows(m0: number, m1: number, m2: number, m4: number, m5: number, m6: number, m7: number, m9: number, m10: number, m11: number, m12: number, m14: number): number[] {
  return [m0, m1, m2, 0, m4, m5, m6, m7, 0, m9, m10, m11, m12, 0, m14, 0, 0, 0, 1, 0];
}

/** The 4x5 colour matrix (row major, translations in [0, 1]) cc builds for one filter function at its computed amount, in float. */
export function groupFilterMatrix(code: number, amountIn: number): number[] {
  if (!(amountIn >= 0 && amountIn <= FLT_MAX)) throw new Error(`paint-group: filter amount ${amountIn} is not finite and non-negative`);
  if (code >= 0 && code <= 4 && code !== 2 && amountIn > 1) throw new Error(`paint-group: filter ${code} amount ${amountIn} is above 1, which the computed value clamps`);
  const a = froundOf(amountIn);
  if (code === 0) {
    // cc takes 1 - amount for grayscale and sepia.
    const t = subf(1, a);
    const m0 = addf(froundOf(0.2126), mulf(froundOf(0.7874), t));
    const m1 = subf(froundOf(0.7152), mulf(froundOf(0.7152), t));
    const m5 = subf(froundOf(0.2126), mulf(froundOf(0.2126), t));
    const m6 = addf(froundOf(0.7152), mulf(froundOf(0.2848), t));
    const m10 = subf(froundOf(0.2126), mulf(froundOf(0.2126), t));
    const m11 = subf(froundOf(0.7152), mulf(froundOf(0.7152), t));
    return colourRows(m0, m1, subf(1, addf(m0, m1)), 0, m5, m6, subf(1, addf(m5, m6)), 0, m10, m11, subf(1, addf(m10, m11)), 0);
  }
  if (code === 1) {
    const t = subf(1, a);
    return colourRows(
      addf(froundOf(0.393), mulf(froundOf(0.607), t)), subf(froundOf(0.769), mulf(froundOf(0.769), t)), subf(froundOf(0.189), mulf(froundOf(0.189), t)), 0,
      subf(froundOf(0.349), mulf(froundOf(0.349), t)), addf(froundOf(0.686), mulf(froundOf(0.314), t)), subf(froundOf(0.168), mulf(froundOf(0.168), t)), 0,
      subf(froundOf(0.272), mulf(froundOf(0.272), t)), subf(froundOf(0.534), mulf(froundOf(0.534), t)), addf(froundOf(0.131), mulf(froundOf(0.869), t)), 0,
    );
  }
  if (code === 2) {
    const m0 = addf(froundOf(0.213), mulf(froundOf(0.787), a));
    const m1 = subf(froundOf(0.715), mulf(froundOf(0.715), a));
    const m5 = subf(froundOf(0.213), mulf(froundOf(0.213), a));
    const m6 = addf(froundOf(0.715), mulf(froundOf(0.285), a));
    const m10 = subf(froundOf(0.213), mulf(froundOf(0.213), a));
    const m11 = subf(froundOf(0.715), mulf(froundOf(0.715), a));
    return colourRows(m0, m1, subf(1, addf(m0, m1)), 0, m5, m6, subf(1, addf(m5, m6)), 0, m10, m11, subf(1, addf(m10, m11)), 0);
  }
  if (code === 3) {
    const s = subf(1, mulf(2, a));
    return colourRows(s, 0, 0, a, 0, s, 0, a, 0, 0, s, a);
  }
  if (code === 4) return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, a, 0];
  if (code === 5) return colourRows(a, 0, 0, 0, 0, a, 0, 0, 0, 0, a, 0);
  if (code === 6) {
    const c = addf(mulf(froundOf(-0.5), a), froundOf(0.5));
    return colourRows(a, 0, 0, c, 0, a, 0, c, 0, 0, a, c);
  }
  throw new Error(`paint-group: no colour-matrix filter function ${code}`);
}

/** The matrices of a filter list given as flat (code, amount) pairs, in order: twenty floats each. */
export function groupFilterMatrices(ops: readonly number[]): number[] {
  if (ops.length === 0 || ops.length - 2 * floorOf(ops.length / 2) !== 0) throw new Error(`paint-group: a filter list of ${ops.length} numbers, not (code, amount) pairs`);
  const out: number[] = [];
  for (let k = 0; k < ops.length; k += 2) {
    const m = groupFilterMatrix(at(ops, k), at(ops, k + 1));
    for (let i = 0; i < 20; i++) out.push(at(m, i));
  }
  return out;
}

function clamp01f(v: number): number {
  return v > 1 ? 1 : v > 0 ? v : 0;
}

/** store_8888's to_unorm(v, 255): round half to even of the float product, clamped to [0, 255]. */
function unorm8(v: number): number {
  const x = froundOf(v * 255);
  return roundHalfEven(x > 255 ? 255 : x > 0 ? x : 0);
}

/**
 * The pixel Chrome shows where a filtered group meets the backdrop pixel d: l is the group's layer pixel, both premultiplied RGBA8;
 * matrices is groupFilterMatrices of the list; a8 is the group's opacity alpha byte (255 for none). Without an opacity the filtered
 * float pixel is drawn srcover onto d in the same pipeline. With one the filter runs first (Blink makes the filter's effect node the
 * child of the opacity's): the filtered pixel is stored into the transparent opacity layer, which then composites as groupComposite's
 * layer blit (a filter's layer never folds).
 */
export function groupFilterComposite(lr: number, lg: number, lb: number, la: number, dr: number, dg: number, db: number, da: number, matrices: readonly number[], a8: number): number {
  if (matrices.length === 0 || matrices.length - 20 * floorOf(matrices.length / 20) !== 0) throw new Error(`paint-group: ${matrices.length} matrix coefficients, not groups of twenty`);
  if (a8 <= 0) return groupPack(dr, dg, db, da);
  let r = froundOf(lr * BYTE);
  let g = froundOf(lg * BYTE);
  let b = froundOf(lb * BYTE);
  let a = froundOf(la * BYTE);
  for (let k = 0; k < matrices.length; k += 20) {
    const inv = a > 0 ? froundOf(1 / a) : 0;
    const scale = inv <= FLT_MAX ? inv : 0;
    r = froundOf(r * scale);
    g = froundOf(g * scale);
    b = froundOf(b * scale);
    const nr = fma32(r, at(matrices, k), fma32(g, at(matrices, k + 1), fma32(b, at(matrices, k + 2), fma32(a, at(matrices, k + 3), at(matrices, k + 4)))));
    const ng = fma32(r, at(matrices, k + 5), fma32(g, at(matrices, k + 6), fma32(b, at(matrices, k + 7), fma32(a, at(matrices, k + 8), at(matrices, k + 9)))));
    const nb = fma32(r, at(matrices, k + 10), fma32(g, at(matrices, k + 11), fma32(b, at(matrices, k + 12), fma32(a, at(matrices, k + 13), at(matrices, k + 14)))));
    const na = fma32(r, at(matrices, k + 15), fma32(g, at(matrices, k + 16), fma32(b, at(matrices, k + 17), fma32(a, at(matrices, k + 18), at(matrices, k + 19)))));
    a = clamp01f(na);
    r = froundOf(clamp01f(nr) * a);
    g = froundOf(clamp01f(ng) * a);
    b = froundOf(clamp01f(nb) * a);
  }
  if (a8 < 255) return groupComposite(unorm8(r), unorm8(g), unorm8(b), unorm8(a), dr, dg, db, da, a8, false);
  const ia = froundOf(1 - a);
  return groupPack(unorm8(fma32(froundOf(dr * BYTE), ia, r)), unorm8(fma32(froundOf(dg * BYTE), ia, g)), unorm8(fma32(froundOf(db * BYTE), ia, b)), unorm8(fma32(froundOf(da * BYTE), ia, a)));
}
