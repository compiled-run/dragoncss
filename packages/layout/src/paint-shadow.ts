// box-shadow as Blink 145 and Skia 2ab8add5 paint it (css-backgrounds-3 §7.1): each shadow's shape (the border box outset by the
// spread, radii adjusted by ComputeOutsetAdjustedBorderRadius, ShadowContourFollowsBorder being stable at 145, then
// ConstrainRadii), translated by the offset and blurred with sigma = blur / 2 in device px (paint-blur.ts shadowSigma), through the
// path Skia's SkBlurMaskFilterImpl picks: the analytic BlurRect nine-patch of a rect (paint-blur.ts rectShadowCoverage), the
// nine-patch of a small blurred rrect (filterRRectToNine) for a simple, nine-patch or complex rrect whose middle stretches, and
// otherwise the whole shape drawn into an A8 mask (SkDraw compute_mask_bounds, trimmed to the cc tile at most 128 px past it) and
// box-blurred (paint-blur.ts boxBlur). Outer shadows are clipped out of the border box (inset 1 device px when the background is
// opaque, BoxPainterBase ClipToBorderEdge); inset shadows are the blurred rect-with-hole of AreaCastingShadowInHole clipped to the
// padding box. Each layer is premultiplied RGBA8 composited with Skia's 8-bit source-over in reverse list order, so the first
// shadow is on top. Every exported function is a translated engine root (translate/src/generate.ts), proven TS = Swift = Kotlin by
// packages/layout/paint-vectors/shadow.
//
// Where this is not bit-exact with Chrome: the antialiased source of a rounded, oval or fractional-edged shape is supersampled
// 16 x 16 per pixel here (Skia uses its analytic AA scan converter), and the platform composites the layer over the backdrop with
// its own rounding. Both are measured against Chrome by packages/parity/test/pnt1-shadow.test.ts; the shadow sample rule carries
// the measured allowance (packages/parity/src/allowances/shadow.ts, at most 2 channel levels).
import type { A8Mask, BlurFaults, IRect } from './paint-blur.ts';
import { boxBlur, boxBlurMargin, hasNoBlur, maskBounds, mulDiv255Round, rectShadowCoverage, shadowSigma } from './paint-blur.ts';
import { ccTileEnd, ccTileIndex, ccTileStart } from './paint-dither.ts';
import { constrainCornerRadii, hasRoundedCorner } from './paint-radius.ts';
import { floorOf, froundOf } from './rt-easing.ts';

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

/** An A8 mask of a shape over bounds, minus an optional hole (the even-odd rect-with-hole of an inset shadow). */
function rasterMask(s: ShadowShape, hole: ShadowShape | null, b: IRect): A8Mask {
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
  const blurred = boxBlur(rasterMask(small, null, { left: 0, top: 0, right: totalW, bottom: totalH }), sigma, NO_BLUR);
  const local: A8Mask = { bounds: { left: 0, top: 0, right: width(blurred.bounds), bottom: height(blurred.bounds) }, data: blurred.data };
  const src = roundOut(s.left, s.top, s.right, s.bottom);
  const outer: IRect = { left: src.left - margin, top: src.top - margin, right: src.right + margin, bottom: src.bottom + margin };
  return drawNine(local, outer, margin + leftUnstretched, margin + topUnstretched);
}

/** SkDraw::DrawToMask then SkBlurMask::BoxBlur: the shape (minus a hole) rastered over its mask bounds, trimmed to the tile clip. */
function pathBlur(s: ShadowShape, hole: ShadowShape | null, sigma: number, clip: IRect): A8Mask {
  const b = maskBounds({ left: s.left, top: s.top, right: s.right, bottom: s.bottom }, clip, boxBlurMargin(sigma));
  return boxBlur(rasterMask(s, hole, b), sigma, NO_BLUR);
}

/** A shape drawn with no blur: its antialiased coverage over its rounded-out bounds. */
function plainMask(s: ShadowShape, hole: ShadowShape | null): A8Mask {
  return rasterMask(s, hole, roundOut(s.left, s.top, s.right, s.bottom));
}

/** The coverage of a filled shape drawn with a normal blur of sigma, through the path Skia picks, rastered into a tile at clip. */
export function blurredCoverage(s: ShadowShape, sigma: number, clip: IRect): A8Mask {
  const type = shapeType(s);
  if (type === 'empty') return { bounds: { left: 0, top: 0, right: 0, bottom: 0 }, data: [] };
  if (!(sigma > 0) || hasNoBlur(sigma)) return plainMask(s, null);
  if (type === 'rect') {
    const cov = rectShadowCoverage({ left: s.left, top: s.top, right: s.right, bottom: s.bottom }, sigma, clip, NO_BLUR);
    if (cov.path === 'nine-patch-rect') return cov.mask;
    return pathBlur(s, null, sigma, clip);
  }
  if (type !== 'oval') {
    const nine = rrectNine(s, sigma);
    if (nine !== null) return nine;
  }
  return pathBlur(s, null, sigma, clip);
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

/** A clip that trims nothing: a blur whose margin is at most kMaxMargin reads no source pixel beyond its tile's outset clip. */
const UNCLIPPED: IRect = { left: -1073741824, top: -1073741824, right: 1073741824, bottom: 1073741824 };

/** Whether a blur's coverage depends on the tile it is rastered in: a path blur whose margin reaches past kMaxMargin. */
function tileDependent(sigma: number): boolean {
  return sigma > 0 && !hasNoBlur(sigma) && boxBlurMargin(sigma) > 128;
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
 * left + ((layer * (256 - left alpha)) >> 8). The colour is premultiplied with SkMulDiv255Round (SkPreMultiplyColor).
 */
function compositeOnto(layer: readonly Cell[], bounds: IRect, sh: ShadowInput, coverageAt: (x: number, y: number) => number): void {
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
    }
  }
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

function tileMaskAt(cache: TileMask[], s: ShadowShape, sigma: number, x: number, y: number): A8Mask {
  const i = ccTileIndex(x, TILE);
  const j = ccTileIndex(y, TILE);
  for (const t of cache) if (t.i === i && t.j === j) return t.mask;
  const mask = blurredCoverage(s, sigma, tileClip(i, j));
  cache.push({ i, j, mask });
  return mask;
}

/**
 * The outer shadows of a snapped border box (edges in page device px, outer radii from paint-radius.ts), composited into one
 * premultiplied layer in reverse list order (the first shadow on top), clipped out of the border box (inset 1 device px when the
 * background is opaque). Inset shadows and fully obscured ones (no offset, blur or spread) are skipped.
 */
export function outerShadowLayer(left: number, top: number, right: number, bottom: number, radii: readonly number[], opaqueBackground: boolean, shadows: readonly ShadowInput[], dpr: number, faults: ShadowFaults): ShadowLayer {
  const rounded = hasRoundedCorner(radii);
  const border: ShadowShape = { left, top, right, bottom, radii: rounded ? radii : [0, 0, 0, 0, 0, 0, 0, 0] };
  const shapes: ShadowShape[] = [];
  const sigmas: number[] = [];
  let bounds: IRect | null = null;
  for (const sh of shadows) {
    const z = zoomed(sh, dpr, faults);
    const shape = offsetShape(spreadShape(left, top, right, bottom, border.radii, at(z, 3), faults), at(z, 0), at(z, 1));
    shapes.push(shape);
    sigmas.push(at(z, 4));
    const obscured = sh.x === 0 && sh.y === 0 && sh.blur === 0 && sh.spread === 0;
    if (!sh.inset && !obscured && shapeType(shape) !== 'empty') bounds = union(bounds, reach(shape, at(z, 4)));
  }
  if (bounds === null) return { left: 0, top: 0, right: 0, bottom: 0, rgba: [] };
  const b = bounds;
  const layer = zeroCells(4 * width(b) * height(b));
  // ClipToBorderEdge: the border box, inset by one device px when the background is opaque, clipped out.
  const inset = opaqueBackground ? 1 : 0;
  const clipOut = spreadShape(left, top, right, bottom, border.radii, -inset, NO_SHADOW_FAULTS);
  for (let k = shadows.length - 1; k >= 0; k--) {
    const sh = shadows[k] as ShadowInput;
    const shape = shapes[k] as ShadowShape;
    const sigma = at(sigmas, k);
    if (sh.inset || (sh.x === 0 && sh.y === 0 && sh.blur === 0 && sh.spread === 0) || shapeType(shape) === 'empty' || sh.a === 0) continue;
    const perTile = tileDependent(sigma);
    const first = perTile ? null : blurredCoverage(shape, sigma, UNCLIPPED);
    const cache: TileMask[] = [];
    compositeOnto(layer, b, sh, (x, y) => {
      const m = first === null ? tileMaskAt(cache, shape, sigma, x, y) : first;
      const c = maskAt(m, x, y);
      if (c === 0 || faults.shadowNotClippedOut) return c;
      if (!rounded) return x >= clipOut.left && x < clipOut.right && y >= clipOut.top && y < clipOut.bottom ? 0 : c;
      return mulDiv255Round(c, 255 - shapeCoverage(clipOut, x, y));
    });
  }
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, rgba: values(layer) };
}

/**
 * The inset shadows of a box (snapped border box edges and border widths in device px, padding-edge radii from paint-radius.ts),
 * composited into one premultiplied layer over the padding box in reverse list order, each clipped to the padding box: the
 * blurred rect-with-hole of AreaCastingShadowInHole around the hole (the padding box shrunk by the spread and offset), or the
 * whole padding box when the hole is empty.
 */
export function insetShadowLayer(left: number, top: number, right: number, bottom: number, borders: readonly number[], innerRadii: readonly number[], shadows: readonly ShadowInput[], dpr: number, faults: ShadowFaults): ShadowLayer {
  if (borders.length !== 4) throw new Error(`paint-shadow: ${borders.length} border widths, not 4`);
  const pl = left + at(borders, 3);
  const pt = top + at(borders, 0);
  const pr = maxNum(pl, right - at(borders, 1));
  const pb = maxNum(pt, bottom - at(borders, 2));
  const b: IRect = { left: pl, top: pt, right: pr, bottom: pb };
  const rounded = hasRoundedCorner(innerRadii);
  const bounds: ShadowShape = { left: pl, top: pt, right: pr, bottom: pb, radii: rounded ? innerRadii : [0, 0, 0, 0, 0, 0, 0, 0] };
  if (width(b) === 0 || height(b) === 0) return { left: pl, top: pt, right: pl, bottom: pt, rgba: [] };
  const layer = zeroCells(4 * width(b) * height(b));
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
      compositeOnto(layer, b, sh, (x, y) => mulDiv255Round(shapeCoverage(bounds, x, y), 255));
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
    const shape = offsetShape(outer, ox, oy);
    const moved = offsetShape(hole, ox, oy);
    const perTile = tileDependent(sigma);
    const once = perTile ? null : !(sigma > 0) || hasNoBlur(sigma) ? rasterMask(shape, moved, b) : pathBlur(shape, moved, sigma, UNCLIPPED);
    const cache: TileMask[] = [];
    compositeOnto(layer, b, sh, (x, y) => {
      let m = once;
      if (m === null) {
        const i = ccTileIndex(x, TILE);
        const j = ccTileIndex(y, TILE);
        for (const t of cache) if (t.i === i && t.j === j) m = t.mask;
        if (m === null) {
          m = pathBlur(shape, moved, sigma, tileClip(i, j));
          cache.push({ i, j, mask: m });
        }
      }
      return mulDiv255Round(maskAt(m, x, y), clipAt(x, y));
    });
  }
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, rgba: values(layer) };
}
