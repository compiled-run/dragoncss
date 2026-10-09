// box-shadow as Blink 145 and Skia 2ab8add5 paint it (css-backgrounds-3 §7.1): each shadow's shape (the border box outset by the
// spread, radii adjusted by ComputeOutsetAdjustedBorderRadius, ShadowContourFollowsBorder being stable at 145, then
// ConstrainRadii), translated by the offset and blurred with sigma = blur / 2 in device px (paint-blur.ts shadowSigma), through the
// path Skia picks: at blur 0 a rect is SkScan::AntiFillRect's coverage (antiFillRectCoverage); otherwise SkBlurMaskFilterImpl's,
// the analytic BlurRect nine-patch of a rect (paint-blur.ts rectShadowCoverage), the nine-patch of a small blurred rrect
// (filterRRectToNine) for a simple, nine-patch or complex rrect whose middle stretches, and otherwise the whole shape drawn into
// an A8 mask (SkDraw compute_mask_bounds, trimmed to the raster clip at most 128 px past it; draw_into_mask fills it in the
// mask's own coordinates through SkA8_Blitter, edges crossing it clipped by SkEdgeClipper) and box-blurred (paint-blur.ts
// boxBlur). Each cc tile is rastered on its own with its bitmap origin subtracted (the canvas translate, to which the looper
// adds the offset). Outer shadows are clipped out of the border box (inset 1 device px when the background is
// opaque, BoxPainterBase ClipToBorderEdge); inset shadows are the blurred rect-with-hole of AreaCastingShadowInHole clipped to the
// padding box. Each layer is premultiplied RGBA8 composited with Skia's 8-bit source-over in reverse list order, so the first
// shadow is on top. Every exported function is a translated engine root (translate/src/generate.ts), proven TS = Swift = Kotlin by
// packages/layout/paint-vectors/shadow.
//
// Chrome blits each shadow straight onto the raster tile, which already holds the backdrop (BoxPainterBase::PaintNormalBoxShadow
// draws one looper shadow per list entry into no layer; Skia's blit_mask_d32_a8 floors (backdrop * (256 - alpha)) >> 8 per
// shadow). The device composites one premultiplied layer over its backdrop, rounding to nearest. So the device takes the *Over
// layers: every shadow is blitted onto the backdrop its ancestors paint (BackdropFill, over the white root) as Chrome blits it,
// and each pixel is encoded as the layer pixel whose platform composite over that backdrop is Chrome's colour.
//
// Where this is not bit-exact with Chrome: a small line-only source (try_blit_fat_anti_rect) and the antialiased clips (the border
// box an outer shadow is clipped out of, the padding box an inset one is clipped to) are supersampled 16 x 16 per pixel, and a
// backdrop the ancestors' backgrounds do not describe (another box's paint beneath the shadow) is composited over as the platform
// rounds. The feature PR that lowers box-shadow measures the device layers against Chrome (packages/parity/test/pnt1-shadow.test.ts).
import type { A8Mask, BlurFaults, IRect } from './paint-blur.ts';
import { boxBlur, boxBlurMargin, hasNoBlur, maskBounds, mulDiv255Round, rectShadowCoverage, shadowSigma } from './paint-blur.ts';
import type { AaPath, Device, IRect as AaIRect, Radius, SkRRect } from './paint-aa.ts';
import { a8Device, aaRoute, antiFillPath, devicePixels, drrectPath, NO_AA_FAULTS, ovalPath, rrectPath, setRectRadii, translatePath, whiteDevice } from './paint-aa.ts';
import { ccTileEnd, ccTileIndex, ccTileStart } from './paint-dither.ts';
import { constrainCornerRadii, hasRoundedCorner } from './paint-radius.ts';
import { floorOf, froundOf, truncOf } from './rt-easing.ts';

/** Planted faults (T046 §5.2); the paint vectors and the pixel lanes must catch each one. */
export type ShadowFaults = {
  /** Ignores the spread. */
  readonly spreadIgnored: boolean;
  /** Blurs with sigma = blur / 2 in css px, forgetting the device scale. */
  readonly sigmaHalfBlur: boolean;
  /** Paints the outer shadow under the border box instead of clipping it out. */
  readonly shadowNotClippedOut: boolean;
};

export const NO_SHADOW_FAULTS: ShadowFaults = { spreadIgnored: false, sigmaHalfBlur: false, shadowNotClippedOut: false };

/** One shadow as the compiler lowers it: css px lengths at zoom 1 and an sRGB RGBA8 colour. */
export type ShadowInput = {
  readonly inset: boolean;
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

/**
 * One fill of the backdrop beneath a box's shadows (an ancestor's background, and for inset shadows the box's own): a rect with
 * eight radii (as ShadowShape) in page device px and an sRGB RGBA8 colour. Fills are painted in order over the white root.
 */
export type BackdropFill = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly radii: readonly number[];
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

/** A premultiplied RGBA8 layer over a page device-px rect (row-major, 4 values per pixel); empty when the rect is empty. */
export type ShadowLayer = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly rgba: readonly number[] };

/** A shape in page device px: a rect with eight radii (horizontal then vertical, top-left first; all 0 for a rect). */
export type ShadowShape = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly radii: readonly number[] };

type Cell = { v: number };

const NO_BLUR: BlurFaults = { blurSigmaFormula: false, ninePatchAlways: false, tripleBoxRoundingOff: false };
/** cc's raster tile on Mac at a device scale factor of 2 or more (paint-dither.ts ccTileSize); the capture host is macOS. */
const TILE = 512;
/** Supersampling of an antialiased source edge: 16 x 16 samples per pixel. */
const SUPERSAMPLE = 16;

function f32(v: number): number {
  return froundOf(v);
}

function ceilInt(v: number): number {
  return -floorOf(-v);
}

function minNum(a: number, b: number): number {
  return a < b ? a : b;
}

function maxNum(a: number, b: number): number {
  return a > b ? a : b;
}

function at(xs: readonly number[], i: number): number {
  const v = xs[i];
  if (v === undefined) throw new Error(`paint-shadow: index ${i} is outside ${xs.length} values`);
  return v;
}

function width(r: IRect): number {
  return r.right - r.left;
}

function height(r: IRect): number {
  return r.bottom - r.top;
}

function zeroCells(n: number): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) out.push({ v: 0 });
  return out;
}

function cellAt(xs: readonly Cell[], i: number): Cell {
  const c = xs[i];
  if (c === undefined) throw new Error(`paint-shadow: cell ${i} is outside ${xs.length} cells`);
  return c;
}

function values(cells: readonly Cell[]): number[] {
  const out: number[] = [];
  for (const c of cells) out.push(c.v);
  return out;
}

function roundOut(l: number, t: number, r: number, b: number): IRect {
  return { left: floorOf(l), top: floorOf(t), right: ceilInt(r), bottom: ceilInt(b) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The shadow shape: Blink FloatRoundedRect::OutsetWithCornerCorrection with the coverage factor, then ConstrainRadii.

/** The cube of a float as C++ std::pow(float, 3) computes it: in double, then used in double. */
function cube(v: number): number {
  return v * v * v;
}

// adjustedRadius below is ported from third_party/blink/renderer/platform/geometry/float_rounded_rect.cc in Chromium 145.0.7632.6,
// under this notice:
//
//   Copyright (C) 2013 Adobe Systems Incorporated. All rights reserved.
//
//   Redistribution and use in source and binary forms, with or without
//   modification, are permitted provided that the following conditions
//   are met:
//
//   1. Redistributions of source code must retain the above
//      copyright notice, this list of conditions and the following
//      disclaimer.
//   2. Redistributions in binary form must reproduce the above
//      copyright notice, this list of conditions and the following
//      disclaimer in the documentation and/or other materials
//      provided with the distribution.
//
//   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
//   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
//   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
//   FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
//   COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
//   INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
//   (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
//   SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
//   HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
//   STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
//   ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
//   OF THE POSSIBILITY OF SUCH DAMAGE.

/** float_rounded_rect.cc AdjustedRadiusDimension (the double expression narrowed to float at the return). */
function adjustedRadius(radius: number, outset: number, coverage: number): number {
  if (radius > outset || coverage > 1) return f32(radius + outset);
  const ratio = f32(radius / outset);
  return f32(radius + outset * (1 - cube(f32(1 - ratio)) * (1 - cube(coverage))));
}

/** gfx::SizeF's clamp of a component to at least 0 (a trivial one to 0). */
function sizeComponent(v: number): number {
  return v > 9.5367431640625e-7 ? v : 0;
}

/**
 * The shape of a spread shadow: the rect outset by the spread (negative for an inset shadow's hole) and each rounded corner's
 * radii by ComputeOutsetAdjustedBorderRadius against the unspread size, then ConstrainRadii. A rect stays a rect.
 */
export function spreadShape(left: number, top: number, right: number, bottom: number, radii: readonly number[], spread: number, faults: ShadowFaults): ShadowShape {
  if (radii.length !== 8) throw new Error(`paint-shadow: ${radii.length} radii, not 8`);
  const s = faults.spreadIgnored ? 0 : spread;
  const w = f32(right - left);
  const h = f32(bottom - top);
  const l = f32(left - s);
  const t = f32(top - s);
  const rr = f32(right + s);
  const b = f32(bottom + s);
  const out: number[] = [];
  const adjust = s !== 0 && hasRoundedCorner(radii) && w > 0 && h > 0;
  for (let i = 0; i < 8; i++) {
    const k = i < 4 ? i : i - 4;
    const x = at(radii, k);
    const y = at(radii, k + 4);
    if (!adjust || (x === 0 && y === 0)) {
      out.push(at(radii, i));
      continue;
    }
    const coverage = f32(2 * minNum(f32(x / w), f32(y / h)));
    out.push(sizeComponent(adjustedRadius(i < 4 ? x : y, s, coverage)));
  }
  const sw = maxNum(f32(rr - l), 0);
  const sh = maxNum(f32(b - t), 0);
  // ApplySpreadToShadowShape constrains after the outset (a no-op when the radii fit).
  const constrained = s !== 0 && hasRoundedCorner(out) ? constrainCornerRadii(out, sw, sh, { radiusUnclamped: false, innerRadiusNotReduced: false }) : out;
  return { left: l, top: t, right: rr, bottom: b, radii: constrained };
}

/** The shape translated by the shadow offset (the draw looper's translate, in float). */
function offsetShape(s: ShadowShape, dx: number, dy: number): ShadowShape {
  return { left: f32(s.left + dx), top: f32(s.top + dy), right: f32(s.right + dx), bottom: f32(s.bottom + dy), radii: s.radii };
}

// ---------------------------------------------------------------------------------------------------------------------
// Antialiased coverage of a shape (supersampled).

/** Whether a point is inside a shape (the elliptical corner test of each rounded corner). */
function insideShape(s: ShadowShape, x: number, y: number): boolean {
  if (x < s.left || x >= s.right || y < s.top || y >= s.bottom) return false;
  for (let k = 0; k < 4; k++) {
    const rx = at(s.radii, k);
    const ry = at(s.radii, k + 4);
    if (!(rx > 0 && ry > 0)) continue;
    const right = k === 1 || k === 2;
    const bottom = k === 2 || k === 3;
    const cx = right ? s.right - rx : s.left + rx;
    const cy = bottom ? s.bottom - ry : s.top + ry;
    const beyondX = right ? x > cx : x < cx;
    const beyondY = bottom ? y > cy : y < cy;
    if (beyondX && beyondY) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny > 1) return false;
    }
  }
  return true;
}

/** Whether pixel (x, y) touches the box of a rounded corner (the rect's corner square of the corner's radii). */
function inCornerBox(s: ShadowShape, x: number, y: number): boolean {
  for (let k = 0; k < 4; k++) {
    const rx = at(s.radii, k);
    const ry = at(s.radii, k + 4);
    if (!(rx > 0 && ry > 0)) continue;
    const right = k === 1 || k === 2;
    const bottom = k === 2 || k === 3;
    const inX = right ? x + 1 > s.right - rx : x < s.left + rx;
    const inY = bottom ? y + 1 > s.bottom - ry : y < s.top + ry;
    if (inX && inY) return true;
  }
  return false;
}

/** The 8-bit coverage of pixel (x, y) by a shape: 16 x 16 samples, 256 of 256 being 255. */
export function shapeCoverage(s: ShadowShape, x: number, y: number): number {
  if (x + 1 <= s.left || x >= s.right || y + 1 <= s.top || y >= s.bottom) return 0;
  if (x >= s.left && x + 1 <= s.right && y >= s.top && y + 1 <= s.bottom && !inCornerBox(s, x, y)) return 255;
  let n = 0;
  for (let j = 0; j < SUPERSAMPLE; j++) {
    const sy = y + (j + 0.5) / SUPERSAMPLE;
    for (let i = 0; i < SUPERSAMPLE; i++) if (insideShape(s, x + (i + 0.5) / SUPERSAMPLE, sy)) n++;
  }
  return n === SUPERSAMPLE * SUPERSAMPLE ? 255 : floorOf((n * 255) / (SUPERSAMPLE * SUPERSAMPLE) + 0.5);
}

/** The SkRRect of a shape (radii in Skia corner order UL, UR, LR, LL), through SkRRect::setRectRadii. */
function skRRect(s: ShadowShape): SkRRect {
  const radii: Radius[] = [];
  for (let k = 0; k < 4; k++) {
    const r: Radius = { x: at(s.radii, k), y: at(s.radii, k + 4) };
    radii.push(r);
  }
  return setRectRadii({ left: s.left, top: s.top, right: s.right, bottom: s.bottom }, radii, NO_AA_FAULTS);
}

/** The path Skia fills for a shape: SkCanvas::drawRRect's oval delegation, else SkPath::RRect; with a hole, SkDevice::drawDRRect's. */
function shapePath(s: ShadowShape, hole: ShadowShape | null): AaPath {
  const rr = skRRect(s);
  if (hole !== null) return drrectPath(rr, skRRect(hole));
  return rr.type === 'oval' ? ovalPath(rr.rect) : rrectPath(rr);
}

/**
 * The device path of a shape (minus a hole) given in the canvas's coordinates: the path is built there and its points moved by
 * the canvas translate (dx, dy), as SkDraw::drawPath maps a path (SkPath::transform, float adds).
 */
function devicePath(s: ShadowShape, hole: ShadowShape | null, dx: number, dy: number): AaPath {
  return translatePath(shapePath(s, hole), dx, dy);
}

/**
 * An A8 mask over bounds b of a device path, a shape minus an optional hole (the even-odd rect-with-hole of an inset shadow), whose
 * device shapes are s and hole, filled by Skia's analytic AA (paint-aa.ts AntiFillPath): masked, as SkDraw draw_into_mask fills a
 * mask (in its own coordinates, SkA8_Blitter), else straight onto the tile within clip (the coverage read back from the black
 * blitter over white). A small line-only path, which would take try_blit_fat_anti_rect, is supersampled.
 */
function rasterMask(path: AaPath, s: ShadowShape, hole: ShadowShape | null, b: IRect, clip: IRect, masked: boolean): A8Mask {
  const rounded = hasRoundedCorner(s.radii) || (hole !== null && hasRoundedCorner(hole.radii));
  // A small line-only path would take try_blit_fat_anti_rect, which paint-aa.ts does not model.
  const analytic = rounded || !(aaRoute(path) === 'mask-convex' || aaRoute(path) === 'mask-edges');
  if (analytic && masked && width(b) > 0 && height(b) > 0) {
    // SkDraw draw_into_mask: the path moved into the mask's coordinates, filled with the mask as its clip.
    const maskRect: AaIRect = { left: 0, top: 0, right: width(b), bottom: height(b) };
    const dev: Device = a8Device(maskRect);
    antiFillPath(dev, translatePath(path, -b.left, -b.top), maskRect, NO_AA_FAULTS);
    return { bounds: b, data: devicePixels(dev) };
  }
  if (analytic && !masked && width(b) > 0 && height(b) > 0) {
    // Drawn straight onto the tile, in its coordinates, clipped to clip.
    const devBounds: AaIRect = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    const aaClip: AaIRect = { left: clip.left, top: clip.top, right: clip.right, bottom: clip.bottom };
    const dev: Device = whiteDevice(devBounds);
    antiFillPath(dev, path, aaClip, NO_AA_FAULTS);
    const data: number[] = [];
    for (const v of devicePixels(dev)) data.push(255 - v);
    return { bounds: b, data };
  }
  const data: number[] = [];
  for (let y = b.top; y < b.bottom; y++) {
    for (let x = b.left; x < b.right; x++) {
      const c = shapeCoverage(s, x, y);
      data.push(hole === null ? c : maxNum(0, c - shapeCoverage(hole, x, y)));
    }
  }
  return { bounds: b, data };
}

// ---------------------------------------------------------------------------------------------------------------------
// An unblurred rect: Draw::drawRect's kFill rect type (no mask filter, the looper adds no blur at sigma 0), drawn with
// SkScan::AntiFillRect. Ported from third_party/skia/src/core/SkScan_Antihair.cpp (Skia 2ab8add5, BSD, Copyright 2011 The
// Android Open Source Project): antifillrect, antifilldot8 and do_scanline, as one pixel's coverage.

/** SkScalarToFixed then SkFixedToFDot8: (trunc(x * 65536) + 0x80) >> 8, the edge in 24.8 fixed point. */
function fdot8(x: number): number {
  return floorOf((truncOf(f32(x * 65536)) + 128) / 256);
}

/** An FDot8's whole pixel (v >> 8) and its fraction (v & 0xFF). */
function dot8Int(v: number): number {
  return floorOf(v / 256);
}

function dot8Frac(v: number): number {
  return v - 256 * dot8Int(v);
}

/** SkAlphaMul(value, alpha256): (value * alpha256) >> 8. */
function alphaMul(value: number, alpha256: number): number {
  return floorOf((value * alpha256) / 256);
}

/** do_scanline's coverage of pixel x on a scanline of alpha between FDot8 edges l and r. */
function scanlineAlpha(l: number, r: number, alpha: number, x: number): number {
  if (dot8Int(l) === dot8Int(r - 1)) return x === dot8Int(l) ? alphaMul(alpha, r - l) : 0;
  let left = dot8Int(l);
  if (dot8Frac(l) !== 0) {
    if (x === left) return alphaMul(alpha, 256 - dot8Frac(l));
    left += 1;
  }
  const rite = dot8Int(r);
  if (x >= left && x < rite) return alpha;
  if (dot8Frac(r) !== 0 && x === rite) return alphaMul(alpha, dot8Frac(r));
  return 0;
}

/** antifilldot8's coverage of pixel (x, y) by the FDot8 rect l, t, r, b (fillInner: the inside is blitRect, 255). */
function antiFillRectAlpha(l: number, t: number, r: number, b: number, x: number, y: number): number {
  if (l >= r || t >= b) return 0;
  let top = dot8Int(t);
  if (top === dot8Int(b - 1)) return y === top ? scanlineAlpha(l, r, b - t - 1, x) : 0;
  if (dot8Frac(t) !== 0) {
    if (y === top) return scanlineAlpha(l, r, 256 - dot8Frac(t), x);
    top += 1;
  }
  const bot = dot8Int(b);
  if (y >= top && y < bot) {
    let left = dot8Int(l);
    if (left === dot8Int(r - 1)) return x === left ? r - l - 1 : 0;
    if (dot8Frac(l) !== 0) {
      if (x === left) return 256 - dot8Frac(l);
      left += 1;
    }
    const rite = dot8Int(r);
    if (x >= left && x < rite) return 255;
    if (dot8Frac(r) !== 0 && x === rite) return dot8Frac(r);
    return 0;
  }
  if (dot8Frac(b) !== 0 && y === bot) return scanlineAlpha(l, r, dot8Frac(b), x);
  return 0;
}

/** Whether a device rect fits SkFixed (SkRectPriv::FitsInFixed); Draw::drawRect takes the path otherwise. */
function fitsInFixed(s: ShadowShape): boolean {
  const m = 32767;
  return s.left >= -m && s.left <= m && s.top >= -m && s.top <= m && s.right >= -m && s.right <= m && s.bottom >= -m && s.bottom <= m;
}

/**
 * SkScan::AntiFillRect of a device rect within a rect clip: the rect is first intersected with the clip in float (so a clip edge
 * becomes the rect's edge), then each pixel of its rounded-out bounds takes antifilldot8's coverage.
 */
function antiFillRectCoverage(s: ShadowShape, clip: IRect): A8Mask {
  const b = roundOut(s.left, s.top, s.right, s.bottom);
  const l = maxNum(s.left, clip.left);
  const t = maxNum(s.top, clip.top);
  const r = minNum(s.right, clip.right);
  const bt = minNum(s.bottom, clip.bottom);
  const data: number[] = [];
  const empty = !(l < r && t < bt);
  const fl = fdot8(l);
  const ft = fdot8(t);
  const fr = fdot8(r);
  const fb = fdot8(bt);
  for (let y = b.top; y < b.bottom; y++) for (let x = b.left; x < b.right; x++) data.push(empty ? 0 : antiFillRectAlpha(fl, ft, fr, fb, x, y));
  return { bounds: b, data };
}

// ---------------------------------------------------------------------------------------------------------------------
// Skia's blur paths.

/** SkRRect types as SkRRect::computeType classifies a shape (empty, rect, oval, simple, nine-patch, complex). */
export function shapeType(s: ShadowShape): string {
  if (!(s.left < s.right && s.top < s.bottom)) return 'empty';
  if (!hasRoundedCorner(s.radii)) return 'rect';
  let allEqual = true;
  for (let k = 1; k < 4; k++) if (at(s.radii, k) !== at(s.radii, 0) || at(s.radii, k + 4) !== at(s.radii, 4)) allEqual = false;
  if (allEqual) return at(s.radii, 0) >= f32(f32(s.right - s.left) * 0.5) && at(s.radii, 4) >= f32(f32(s.bottom - s.top) * 0.5) ? 'oval' : 'simple';
  const ul = at(s.radii, 0);
  const ur = at(s.radii, 1);
  const lr = at(s.radii, 2);
  const ll = at(s.radii, 3);
  const uly = at(s.radii, 4);
  const ury = at(s.radii, 5);
  const lry = at(s.radii, 6);
  const lly = at(s.radii, 7);
  return ul === ll && uly === ury && ur === lr && lly === lry ? 'nine-patch' : 'complex';
}

/** SkMaskFilterBase draw_nine: the small mask expanded over outer, repeating column cx and row cy, the centre at 255. */
function drawNine(mask: A8Mask, outer: IRect, cx: number, cy: number): A8Mask {
  const mw = width(mask.bounds);
  const mh = height(mask.bounds);
  const innerLeft = outer.left + cx;
  const innerTop = outer.top + cy;
  const innerRight = outer.right + (cx + 1 - mw);
  const innerBottom = outer.bottom + (cy + 1 - mh);
  const data: number[] = [];
  for (let y = outer.top; y < outer.bottom; y++) {
    const my = y < innerTop ? y - outer.top : y >= innerBottom ? y - outer.bottom + mh : cy;
    for (let x = outer.left; x < outer.right; x++) {
      const mx = x < innerLeft ? x - outer.left : x >= innerRight ? x - outer.right + mw : cx;
      const centre = x >= innerLeft && x < innerRight && y >= innerTop && y < innerBottom;
      data.push(centre ? 255 : at(mask.data, my * mw + mx));
    }
  }
  return { bounds: outer, data };
}

/** SkBlurMaskFilterImpl::filterRRectToNine, or null when the rrect has no stretchable middle (Skia then takes the path). */
function rrectNine(s: ShadowShape, sigma: number): A8Mask | null {
  const margin = boxBlurMargin(sigma);
  const leftUnstretched = ceilInt(maxNum(at(s.radii, 0), at(s.radii, 3))) + margin;
  const rightUnstretched = ceilInt(maxNum(at(s.radii, 1), at(s.radii, 2))) + margin;
  const totalW = leftUnstretched + rightUnstretched + 1;
  if (totalW >= f32(s.right - s.left)) return null;
  const topUnstretched = ceilInt(maxNum(at(s.radii, 4), at(s.radii, 5))) + margin;
  const bottomUnstretched = ceilInt(maxNum(at(s.radii, 7), at(s.radii, 6))) + margin;
  const totalH = topUnstretched + bottomUnstretched + 1;
  if (totalH >= f32(s.bottom - s.top)) return null;
  const small: ShadowShape = { left: 0, top: 0, right: totalW, bottom: totalH, radii: s.radii };
  const smallBounds: IRect = { left: 0, top: 0, right: totalW, bottom: totalH };
  const blurred = boxBlur(rasterMask(shapePath(small, null), small, null, smallBounds, smallBounds, true), sigma, NO_BLUR);
  const local: A8Mask = { bounds: { left: 0, top: 0, right: width(blurred.bounds), bottom: height(blurred.bounds) }, data: blurred.data };
  const src = roundOut(s.left, s.top, s.right, s.bottom);
  const outer: IRect = { left: src.left - margin, top: src.top - margin, right: src.right + margin, bottom: src.bottom + margin };
  return drawNine(local, outer, margin + leftUnstretched, margin + topUnstretched);
}

/**
 * SkDraw::DrawToMask then SkBlurMask::BoxBlur: the shape (minus a hole), in the canvas's coordinates moved by (dx, dy) into the
 * device, rastered over its mask bounds, trimmed to the tile clip.
 */
function pathBlur(s: ShadowShape, hole: ShadowShape | null, dx: number, dy: number, sigma: number, clip: IRect): A8Mask {
  const path = devicePath(s, hole, dx, dy);
  const pb = path.bounds;
  const b = maskBounds({ left: pb.left, top: pb.top, right: pb.right, bottom: pb.bottom }, clip, boxBlurMargin(sigma));
  return boxBlur(rasterMask(path, offsetShape(s, dx, dy), hole === null ? null : offsetShape(hole, dx, dy), b, b, true), sigma, NO_BLUR);
}

/** The coverage of a filled shape drawn with a normal blur of sigma, through the path Skia picks, rastered into a tile at clip. */
export function blurredCoverage(s: ShadowShape, sigma: number, clip: IRect): A8Mask {
  if (!isFiniteNum(sigma) || sigma < 0) throw new Error(`paint-shadow: sigma ${sigma} is not a non-negative finite number`);
  return coverageOf(s, 0, 0, sigma, clip);
}

/**
 * blurredCoverage of a shape in the canvas's coordinates under a canvas translate (dx, dy): a rect or rrect is mapped to the device
 * (SkMatrix::mapRect, SkRRect::transform), a path is built first and its points moved (SkPath::transform).
 */
function coverageOf(s: ShadowShape, dx: number, dy: number, sigma: number, clip: IRect): A8Mask {
  const type = shapeType(s);
  if (type === 'empty') return { bounds: { left: 0, top: 0, right: 0, bottom: 0 }, data: [] };
  const ds = offsetShape(s, dx, dy);
  // At sigma 0 the looper sets no mask filter, so a rect is Draw::drawRect's kFill: SkScan::AntiFillRect.
  if (!(sigma > 0) && type === 'rect' && fitsInFixed(ds)) return antiFillRectCoverage(ds, clip);
  if (!(sigma > 0) || hasNoBlur(sigma)) {
    // Drawn with no blur: its antialiased coverage over its rounded-out bounds.
    const b = roundOut(ds.left, ds.top, ds.right, ds.bottom);
    return rasterMask(devicePath(s, null, dx, dy), ds, null, b, clip, false);
  }
  if (type === 'rect') {
    const cov = rectShadowCoverage({ left: ds.left, top: ds.top, right: ds.right, bottom: ds.bottom }, sigma, clip, NO_BLUR);
    if (cov.path === 'nine-patch-rect') return cov.mask;
    return pathBlur(s, null, dx, dy, sigma, clip);
  }
  if (type !== 'oval') {
    const nine = rrectNine(ds, sigma);
    if (nine !== null) return nine;
  }
  return pathBlur(s, null, dx, dy, sigma, clip);
}

// ---------------------------------------------------------------------------------------------------------------------
// The layers.

/** The zoomed shadow lengths and sigma of one shadow at a device scale (Blink ShadowData stores float(css px x zoom)). */
function zoomed(sh: ShadowInput, dpr: number, faults: ShadowFaults): readonly number[] {
  const blur = f32(sh.blur * dpr);
  const sigma = faults.sigmaHalfBlur ? shadowSigma(f32(sh.blur), NO_BLUR) : shadowSigma(blur, NO_BLUR);
  return [f32(sh.x * dpr), f32(sh.y * dpr), blur, f32(sh.spread * dpr), sigma];
}

/** The tile clip of tile (i, j). */
function tileClip(i: number, j: number): IRect {
  return { left: ccTileStart(i, TILE), top: ccTileStart(j, TILE), right: ccTileEnd(i, TILE), bottom: ccTileEnd(j, TILE) };
}

/** Coverage of a mask at page pixel (x, y), 0 outside it. */
function maskAt(m: A8Mask, x: number, y: number): number {
  const b = m.bounds;
  if (x < b.left || x >= b.right || y < b.top || y >= b.bottom) return 0;
  return at(m.data, (y - b.top) * width(b) + (x - b.left));
}

/** Sk4px::approxMulDiv255: (a * (b + 1)) >> 8, the multiply Skia's NEON mask blit uses. */
function approxMulDiv255(a: number, b: number): number {
  return floorOf((a * (b + 1)) / 256);
}

/**
 * Composites one shadow of colour (r, g, b, a) and per-pixel coverage onto a premultiplied layer with Skia's A8 colour mask blit
 * (SkOpts blit_mask_d32_a8_general, measured exact against Chrome 145): left = approxMulDiv255(premul colour, coverage), then
 * left + ((layer * (256 - left alpha)) >> 8). The colour is premultiplied with SkMulDiv255Round (SkPreMultiplyColor). The same
 * blit goes onto over (the opaque backdrop, as Chrome's tile holds it) unless over is empty.
 */
function compositeOnto(layer: readonly Cell[], over: readonly Cell[], bounds: IRect, sh: ShadowInput, coverageAt: (x: number, y: number) => number): void {
  const pr = mulDiv255Round(sh.r, sh.a);
  const pg = mulDiv255Round(sh.g, sh.a);
  const pb = mulDiv255Round(sh.b, sh.a);
  for (let y = bounds.top; y < bounds.bottom; y++) {
    for (let x = bounds.left; x < bounds.right; x++) {
      const c = coverageAt(x, y);
      if (c === 0) continue;
      const i = 4 * ((y - bounds.top) * width(bounds) + (x - bounds.left));
      const la = approxMulDiv255(sh.a, c);
      const keep = 256 - la;
      const cr = cellAt(layer, i);
      const cg = cellAt(layer, i + 1);
      const cb = cellAt(layer, i + 2);
      const ca = cellAt(layer, i + 3);
      cr.v = approxMulDiv255(pr, c) + floorOf((cr.v * keep) / 256);
      cg.v = approxMulDiv255(pg, c) + floorOf((cg.v * keep) / 256);
      cb.v = approxMulDiv255(pb, c) + floorOf((cb.v * keep) / 256);
      ca.v = la + floorOf((ca.v * keep) / 256);
      if (over.length === 0) continue;
      const dr = cellAt(over, i);
      const dg = cellAt(over, i + 1);
      const db = cellAt(over, i + 2);
      dr.v = approxMulDiv255(pr, c) + floorOf((dr.v * keep) / 256);
      dg.v = approxMulDiv255(pg, c) + floorOf((dg.v * keep) / 256);
      db.v = approxMulDiv255(pb, c) + floorOf((db.v * keep) / 256);
    }
  }
}

/** Whether a value is an 8-bit channel: an integer from 0 to 255. */
function isByte(v: number): boolean {
  return v >= 0 && v <= 255 && floorOf(v) === v;
}

/** Whether a value is a finite number (NaN and the infinities are not). */
function isFiniteNum(v: number): boolean {
  return v - v === 0;
}

/** Refuses a device scale that is not a positive finite number, and a shadow whose lengths are not finite, whose blur is negative or whose colour is not RGBA8. */
function checkShadows(shadows: readonly ShadowInput[], dpr: number): void {
  if (!isFiniteNum(dpr) || !(dpr > 0)) throw new Error(`paint-shadow: device scale ${dpr} is not a positive finite number`);
  for (const sh of shadows) {
    if (!isFiniteNum(sh.x) || !isFiniteNum(sh.y) || !isFiniteNum(sh.spread) || !isFiniteNum(sh.blur) || sh.blur < 0) throw new Error(`paint-shadow: a shadow ${sh.x} ${sh.y} ${sh.blur} ${sh.spread} has a length that is not finite or a negative blur`);
    if (!isByte(sh.r) || !isByte(sh.g) || !isByte(sh.b) || !isByte(sh.a)) throw new Error(`paint-shadow: a shadow colour ${sh.r},${sh.g},${sh.b},${sh.a} is not RGBA8`);
  }
}

/** Refuses box edges that are not finite or whose right or bottom is before its left or top. */
function checkEdges(left: number, top: number, right: number, bottom: number): void {
  if (!isFiniteNum(left) || !isFiniteNum(top) || !isFiniteNum(right) || !isFiniteNum(bottom) || right < left || bottom < top) throw new Error(`paint-shadow: box ${left},${top},${right},${bottom} is not a finite rect`);
}

/** The backdrop at the centre of pixel (x, y): the white root, then each fill holding the centre, with Skia's 8-bit source-over. */
export function backdropAt(fills: readonly BackdropFill[], x: number, y: number): number[] {
  let r = 255;
  let g = 255;
  let b = 255;
  for (const f of fills) {
    if (f.radii.length !== 8) throw new Error(`paint-shadow: a backdrop fill has ${f.radii.length} radii, not 8`);
    if (!isFiniteNum(f.left) || !isFiniteNum(f.top) || !isFiniteNum(f.right) || !isFiniteNum(f.bottom)) throw new Error(`paint-shadow: a backdrop fill ${f.left},${f.top},${f.right},${f.bottom} is not finite`);
    if (!isByte(f.r) || !isByte(f.g) || !isByte(f.b) || !isByte(f.a)) throw new Error(`paint-shadow: a backdrop fill colour ${f.r},${f.g},${f.b},${f.a} is not RGBA8`);
    const shape: ShadowShape = { left: f.left, top: f.top, right: f.right, bottom: f.bottom, radii: f.radii };
    if (f.a === 0 || !insideShape(shape, x + 0.5, y + 0.5)) continue;
    if (f.a === 255) {
      r = f.r;
      g = f.g;
      b = f.b;
      continue;
    }
    const k = 255 - f.a;
    r = mulDiv255Round(f.r, f.a) + mulDiv255Round(r, k);
    g = mulDiv255Round(f.g, f.a) + mulDiv255Round(g, k);
    b = mulDiv255Round(f.b, f.a) + mulDiv255Round(b, k);
  }
  return [r, g, b];
}

/** The backdrop over bounds as an opaque layer, or no cells without fills. */
function backdropCells(fills: readonly BackdropFill[] | null, bounds: IRect): Cell[] {
  const out: Cell[] = [];
  if (fills === null) return out;
  for (let y = bounds.top; y < bounds.bottom; y++) {
    for (let x = bounds.left; x < bounds.right; x++) {
      const c = backdropAt(fills, x, y);
      out.push({ v: at(c, 0) });
      out.push({ v: at(c, 1) });
      out.push({ v: at(c, 2) });
      out.push({ v: 255 });
    }
  }
  return out;
}

/** The platform's source-over of a premultiplied channel s at alpha a onto an opaque backdrop channel d: s + d (255 - a) / 255, rounded to nearest. */
export function platformOver(s: number, a: number, d: number): number {
  // d (255 - a) / 255 is never an odd multiple of 1/2, so the rounding has no ties.
  return s + floorOf((2 * d * (255 - a) + 255) / 510);
}

/**
 * The premultiplied pixel (each channel between 0 and its alpha) whose platform composite over backdrop (br, bg, bb) is Chrome's
 * (cr, cg, cb): the alpha nearest the layer's own alpha a that allows it, the higher first (alpha 255, the colour itself, always does).
 */
export function encodeOver(cr: number, cg: number, cb: number, br: number, bg: number, bb: number, a: number): number[] {
  if (!isByte(cr) || !isByte(cg) || !isByte(cb) || !isByte(br) || !isByte(bg) || !isByte(bb) || !isByte(a)) throw new Error(`paint-shadow: ${cr},${cg},${cb} over ${br},${bg},${bb} at alpha ${a} is not 8-bit`);
  for (let d = 0; d <= 255; d++) {
    for (let side = 0; side < 2; side++) {
      const a2 = side === 0 ? a + d : a - d;
      if ((d === 0 && side === 1) || a2 < 0 || a2 > 255) continue;
      const r = cr - platformOver(0, a2, br);
      const g = cg - platformOver(0, a2, bg);
      const b = cb - platformOver(0, a2, bb);
      if (r >= 0 && r <= a2 && g >= 0 && g <= a2 && b >= 0 && b <= a2) return [r, g, b, a2];
    }
  }
  throw new Error(`paint-shadow: no layer pixel composites to ${cr},${cg},${cb} over ${br},${bg},${bb}`);
}

/** A composited layer's values; with a backdrop (back not empty), each pixel encoded over it from Chrome's colour in over. */
function layerValues(layer: readonly Cell[], over: readonly Cell[], back: readonly Cell[]): number[] {
  if (back.length === 0) return values(layer);
  const out: number[] = [];
  for (let i = 0; i < layer.length; i += 4) {
    const px = encodeOver(cellAt(over, i).v, cellAt(over, i + 1).v, cellAt(over, i + 2).v, cellAt(back, i).v, cellAt(back, i + 1).v, cellAt(back, i + 2).v, cellAt(layer, i + 3).v);
    for (const v of px) out.push(v);
  }
  return out;
}

/** The page device-px extent a shadow can reach: its shape bounds outset by 3 sigma, rounded out, plus one pixel. */
function reach(s: ShadowShape, sigma: number): IRect {
  const pad = sigma > 0 ? ceilInt(f32(3 * sigma)) + 1 : 1;
  const r = roundOut(s.left, s.top, s.right, s.bottom);
  return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
}

function union(a: IRect | null, b: IRect): IRect {
  if (a === null) return b;
  return { left: minNum(a.left, b.left), top: minNum(a.top, b.top), right: maxNum(a.right, b.right), bottom: maxNum(a.bottom, b.bottom) };
}

/** A per-tile cache of one shadow's coverage mask. */
type TileMask = { readonly i: number; readonly j: number; readonly mask: A8Mask };

/** A mask moved by whole pixels. */
function moveMask(m: A8Mask, dx: number, dy: number): A8Mask {
  return { bounds: { left: m.bounds.left + dx, top: m.bounds.top + dy, right: m.bounds.right + dx, bottom: m.bounds.bottom + dy }, data: m.data };
}

/** Tile (i, j)'s clip in its own bitmap's coordinates. */
function localClip(i: number, j: number): IRect {
  const c = tileClip(i, j);
  const x0 = ccTileStart(i, TILE);
  const y0 = ccTileStart(j, TILE);
  return { left: c.left - x0, top: c.top - y0, right: c.right - x0, bottom: c.bottom - y0 };
}

/**
 * The coverage of the tile holding page pixel (x, y), cached per tile. cc rasters each tile with its bitmap origin subtracted
 * (a canvas translate the looper's offset is added to in float), so the shape is placed in the tile's coordinates as Skia maps
 * it, f32(edge + f32(offset - origin)), which decides the float rounding of the path, and the mask is moved back.
 */
function tileMaskAt(cache: TileMask[], spread: ShadowShape, ox: number, oy: number, sigma: number, x: number, y: number): A8Mask {
  const i = ccTileIndex(x, TILE);
  const j = ccTileIndex(y, TILE);
  for (const t of cache) if (t.i === i && t.j === j) return t.mask;
  const x0 = ccTileStart(i, TILE);
  const y0 = ccTileStart(j, TILE);
  const mask = moveMask(coverageOf(spread, f32(ox - x0), f32(oy - y0), sigma, localClip(i, j)), x0, y0);
  cache.push({ i, j, mask });
  return mask;
}

/**
 * The outer shadows of a snapped border box (edges in page device px, outer radii from paint-radius.ts), composited into one
 * premultiplied layer in reverse list order (the first shadow on top), clipped out of the border box (inset 1 device px when the
 * background is opaque). Inset shadows and fully obscured ones (no offset, blur or spread) are skipped.
 */
export function outerShadowLayer(left: number, top: number, right: number, bottom: number, radii: readonly number[], opaqueBackground: boolean, shadows: readonly ShadowInput[], dpr: number, faults: ShadowFaults): ShadowLayer {
  return outerLayer(left, top, right, bottom, radii, opaqueBackground, shadows, dpr, faults, null);
}

/** outerShadowLayer as the device shows it: each shadow blitted onto the backdrop as Chrome blits it, encoded over it. */
export function outerShadowLayerOver(left: number, top: number, right: number, bottom: number, radii: readonly number[], opaqueBackground: boolean, shadows: readonly ShadowInput[], dpr: number, faults: ShadowFaults, backdrop: readonly BackdropFill[]): ShadowLayer {
  return outerLayer(left, top, right, bottom, radii, opaqueBackground, shadows, dpr, faults, backdrop);
}

function outerLayer(left: number, top: number, right: number, bottom: number, radii: readonly number[], opaqueBackground: boolean, shadows: readonly ShadowInput[], dpr: number, faults: ShadowFaults, backdrop: readonly BackdropFill[] | null): ShadowLayer {
  checkEdges(left, top, right, bottom);
  checkShadows(shadows, dpr);
  const rounded = hasRoundedCorner(radii);
  const border: ShadowShape = { left, top, right, bottom, radii: rounded ? radii : [0, 0, 0, 0, 0, 0, 0, 0] };
  const shapes: ShadowShape[] = [];
  const spreads: ShadowShape[] = [];
  const offsets: number[] = [];
  const sigmas: number[] = [];
  let bounds: IRect | null = null;
  for (const sh of shadows) {
    const z = zoomed(sh, dpr, faults);
    const spread = spreadShape(left, top, right, bottom, border.radii, at(z, 3), faults);
    const shape = offsetShape(spread, at(z, 0), at(z, 1));
    shapes.push(shape);
    spreads.push(spread);
    offsets.push(at(z, 0));
    offsets.push(at(z, 1));
    sigmas.push(at(z, 4));
    const obscured = sh.x === 0 && sh.y === 0 && sh.blur === 0 && sh.spread === 0;
    if (!sh.inset && !obscured && shapeType(shape) !== 'empty') bounds = union(bounds, reach(shape, at(z, 4)));
  }
  if (bounds === null) return { left: 0, top: 0, right: 0, bottom: 0, rgba: [] };
  const b = bounds;
  const layer = zeroCells(4 * width(b) * height(b));
  const back = backdropCells(backdrop, b);
  const over = backdropCells(backdrop, b);
  // ClipToBorderEdge: the border box, inset by one device px when the background is opaque, clipped out.
  const inset = opaqueBackground ? 1 : 0;
  const clipOut = spreadShape(left, top, right, bottom, border.radii, -inset, NO_SHADOW_FAULTS);
  for (let k = shadows.length - 1; k >= 0; k--) {
    const sh = shadows[k] as ShadowInput;
    const shape = shapes[k] as ShadowShape;
    const sigma = at(sigmas, k);
    if (sh.inset || (sh.x === 0 && sh.y === 0 && sh.blur === 0 && sh.spread === 0) || shapeType(shape) === 'empty' || sh.a === 0) continue;
    const spread = spreads[k] as ShadowShape;
    const ox = at(offsets, 2 * k);
    const oy = at(offsets, 2 * k + 1);
    const cache: TileMask[] = [];
    compositeOnto(layer, over, b, sh, (x, y) => {
      const m = tileMaskAt(cache, spread, ox, oy, sigma, x, y);
      const c = maskAt(m, x, y);
      if (c === 0 || faults.shadowNotClippedOut) return c;
      if (!rounded) return x >= clipOut.left && x < clipOut.right && y >= clipOut.top && y < clipOut.bottom ? 0 : c;
      return mulDiv255Round(c, 255 - shapeCoverage(clipOut, x, y));
    });
  }
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, rgba: layerValues(layer, over, back) };
}

/**
 * The inset shadows of a box (snapped border box edges and border widths in device px, padding-edge radii from paint-radius.ts),
 * composited into one premultiplied layer over the padding box in reverse list order, each clipped to the padding box: the
 * blurred rect-with-hole of AreaCastingShadowInHole around the hole (the padding box shrunk by the spread and offset), or the
 * whole padding box when the hole is empty.
 */
export function insetShadowLayer(left: number, top: number, right: number, bottom: number, borders: readonly number[], innerRadii: readonly number[], shadows: readonly ShadowInput[], dpr: number, faults: ShadowFaults): ShadowLayer {
  return insetLayer(left, top, right, bottom, borders, innerRadii, shadows, dpr, faults, null);
}

/** insetShadowLayer as the device shows it: each shadow blitted onto the backdrop (with the box's own background) as Chrome blits it, encoded over it. */
export function insetShadowLayerOver(left: number, top: number, right: number, bottom: number, borders: readonly number[], innerRadii: readonly number[], shadows: readonly ShadowInput[], dpr: number, faults: ShadowFaults, backdrop: readonly BackdropFill[]): ShadowLayer {
  return insetLayer(left, top, right, bottom, borders, innerRadii, shadows, dpr, faults, backdrop);
}

function insetLayer(left: number, top: number, right: number, bottom: number, borders: readonly number[], innerRadii: readonly number[], shadows: readonly ShadowInput[], dpr: number, faults: ShadowFaults, backdrop: readonly BackdropFill[] | null): ShadowLayer {
  if (borders.length !== 4) throw new Error(`paint-shadow: ${borders.length} border widths, not 4`);
  checkEdges(left, top, right, bottom);
  checkShadows(shadows, dpr);
  // The layer covers whole device pixels of the padding box, so the snapped edges and border widths are whole numbers.
  if (floorOf(left) !== left || floorOf(top) !== top || floorOf(right) !== right || floorOf(bottom) !== bottom) throw new Error(`paint-shadow: box ${left},${top},${right},${bottom} is not on whole device pixels`);
  for (const w of borders) if (!isFiniteNum(w) || w < 0 || floorOf(w) !== w) throw new Error(`paint-shadow: border width ${w} is not a whole non-negative device pixel count`);
  const pl = left + at(borders, 3);
  const pt = top + at(borders, 0);
  const pr = maxNum(pl, right - at(borders, 1));
  const pb = maxNum(pt, bottom - at(borders, 2));
  const b: IRect = { left: pl, top: pt, right: pr, bottom: pb };
  const rounded = hasRoundedCorner(innerRadii);
  const bounds: ShadowShape = { left: pl, top: pt, right: pr, bottom: pb, radii: rounded ? innerRadii : [0, 0, 0, 0, 0, 0, 0, 0] };
  if (width(b) === 0 || height(b) === 0) return { left: pl, top: pt, right: pl, bottom: pt, rgba: [] };
  const layer = zeroCells(4 * width(b) * height(b));
  const back = backdropCells(backdrop, b);
  const over = backdropCells(backdrop, b);
  const clipAt = (x: number, y: number): number => (rounded ? shapeCoverage(bounds, x, y) : 255);
  for (let k = shadows.length - 1; k >= 0; k--) {
    const sh = shadows[k] as ShadowInput;
    if (!sh.inset || (sh.x === 0 && sh.y === 0 && sh.blur === 0 && sh.spread === 0) || sh.a === 0) continue;
    const z = zoomed(sh, dpr, faults);
    const ox = at(z, 0);
    const oy = at(z, 1);
    const blur = at(z, 2);
    const spread = at(z, 3);
    const sigma = at(z, 4);
    const hole = spreadShape(pl, pt, pr, pb, bounds.radii, faults.spreadIgnored ? 0 : -spread, NO_SHADOW_FAULTS);
    if (shapeType(hole) === 'empty') {
      compositeOnto(layer, over, b, sh, (x, y) => mulDiv255Round(shapeCoverage(bounds, x, y), 255));
      continue;
    }
    // AreaCastingShadowInHole: the padding box outset by the blur (and by a negative spread), united with itself moved back
    // by the offset.
    const grow = spread < 0 ? f32(blur - spread) : blur;
    const l0 = f32(pl - grow);
    const t0 = f32(pt - grow);
    const r0 = f32(pr + grow);
    const b0 = f32(pb + grow);
    const outer: ShadowShape = { left: minNum(l0, f32(l0 - ox)), top: minNum(t0, f32(t0 - oy)), right: maxNum(r0, f32(r0 - ox)), bottom: maxNum(b0, f32(b0 - oy)), radii: [0, 0, 0, 0, 0, 0, 0, 0] };
    const cache: TileMask[] = [];
    compositeOnto(layer, over, b, sh, (x, y) => {
      const i = ccTileIndex(x, TILE);
      const j = ccTileIndex(y, TILE);
      let m: A8Mask | null = null;
      for (const t of cache) if (t.i === i && t.j === j) m = t.mask;
      if (m === null) {
        // In the tile's coordinates, as tileMaskAt places an outer shadow.
        const x0 = ccTileStart(i, TILE);
        const y0 = ccTileStart(j, TILE);
        const dx = f32(ox - x0);
        const dy = f32(oy - y0);
        const shape = offsetShape(outer, dx, dy);
        const lb: IRect = { left: b.left - x0, top: b.top - y0, right: b.right - x0, bottom: b.bottom - y0 };
        // The raster clip: the padding box (ClipContouredRect or Clip) within the tile.
        const lc = localClip(i, j);
        const clip: IRect = { left: maxNum(lb.left, lc.left), top: maxNum(lb.top, lc.top), right: minNum(lb.right, lc.right), bottom: minNum(lb.bottom, lc.bottom) };
        const local = !(sigma > 0) || hasNoBlur(sigma) ? rasterMask(devicePath(outer, hole, dx, dy), shape, offsetShape(hole, dx, dy), lb, clip, false) : pathBlur(outer, hole, dx, dy, sigma, clip);
        m = moveMask(local, x0, y0);
        cache.push({ i, j, mask: m });
      }
      return mulDiv255Round(maskAt(m, x, y), clipAt(x, y));
    });
  }
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, rgba: layerValues(layer, over, back) };
}
