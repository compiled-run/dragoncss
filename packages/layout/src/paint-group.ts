// PNT1-opacity-b: an opacity group as Chrome 145's CPU raster composites it, so a device can present the result (Q) itself. In a cc
// raster tile where the group's only drawing is one opaque rect fill, cc folds the group alpha into the fill (cc
// PlaybackFoldingIterator) and Skia blits it as a solid colour (Skia 2ab8add5 src/opts/SkBlitRow_opts.h:243-270 blit_row_color32);
// in any other tile the group is a layer composited with blit_row_s32a_blend (src/core/SkBlitRow_D32.cpp:204-301, with
// src/core/SkColorData.h:134-137 SkAlphaMulInv256). Pixels are premultiplied RGBA8; the packed result is r + g * 2^8 + b * 2^16 +
// a * 2^24. Pinned against Chrome's pixels by packages/parity/test/pnt1-effects.test.ts.
import { ccTileEnd, ccTileIndex, ccTileSize, ccTileStart } from './paint-dither.ts';
import { floorOf } from './rt-easing.ts';

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
