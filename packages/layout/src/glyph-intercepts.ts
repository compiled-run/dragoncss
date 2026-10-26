// TDEC-d for pinned faces: the skip-ink intercepts of real glyphs as Chrome 145 on macOS takes them, over the glyf outlines of
// the bundled face (notes/T148J-tdec.md). Ported from Skia 2ab8add5 (BSD, Chromium 145.0.7632.6 DEPS) and Blink 145.0.7632.6:
//   - Blink text_painter.cc:548-583 ClipDecorationLine asks Font::GetTextIntercepts for the band of the line's Bounds inset by 0.5
//     px vertically, relative to the baseline; Font::GetTextIntercepts hands it to SkTextBlob::getIntercepts.
//   - SkTextBlob.cpp:872-924 get_glyph_run_intercepts takes each glyph's path at kCanonicalTextSizeForPaths (SkFontPriv.h:36, 64)
//     unhinted, divides the band by scale = size / 64, and maps each interval back by interval * scale + the glyph's x.
//   - SkScalerContext_mac_ct.cpp:549-677: the path is Core Text's CTFontCreatePathForGlyph at that size, y flipped, its elements
//     narrowed to float (SkCTPathGeometrySink drops a segment whose points all equal the current point). For a TrueType face that
//     is the glyf contour: quadratic segments with the implied on-curve midpoints, lines between on-curve points.
//   - SkPath.cpp:337-437 Iter(path, false) closes each contour with a line when its last point is not its first.
//   - SkGlyph.cpp:540-598 ensureIntercepts skips a glyph whose path bounds miss the band; SkGlyph.cpp:438-538 calculate_path_gap
//     widens [left, right] by every line and quad crossing of the band's two edges and every segment point inside the band.
//   - SkBezierCurves.cpp:141-150 pinTRange and 188-228 SkBezierQuad::IntersectWithHorizontalLine, over SkQuads.cpp:47-129
//     Discriminant and Roots and 164-167 EvalAt, in doubles.
// The fused multiply-adds of Discriminant's error terms and of EvalAt are computed exactly with Dekker's product split.
// A composite glyph with a component scale, or whose components are placed by points, is not read (null): the caller refuses it.
import { floorOf, froundOf } from './rt-easing.ts';
import { sqrt64 } from './paint-aa.ts';

/** Planted faults; the live Chrome skip-ink fixture must catch each one. */
export type InterceptFaults = {
  /** A glyph crossing the band clips its whole ink box x extent (the Ahem rule) instead of the outline's crossings. */
  readonly inkBoxNotOutline: boolean;
  /** The band is not divided by size / 64, so it is taken in device px against the 64 px path. */
  readonly bandUnscaled: boolean;
};

export const NO_INTERCEPT_FAULTS: InterceptFaults = { inkBoxNotOutline: false, bandUnscaled: false };

/** SkFontPriv.h:36 kCanonicalTextSizeForPaths. */
export const CANONICAL_TEXT_SIZE_FOR_PATHS = 64;

const FLT_MAX = 3.4028234663852886e38;
const TAG_HEAD = 0x68656164;
const TAG_LOCA = 0x6c6f6361;
const TAG_GLYF = 0x676c7966;
const POW2: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];

/** A segment of an outline, LINE or QUAD, then its points: [kind, x0, y0, x1, y1, x2, y2] (a line's x2, y2 repeat x1, y1). */
export const SEGMENT_STRIDE = 7;
export const LINE = 1;
export const QUAD = 2;

function f32(v: number): number {
  return froundOf(v);
}

function u8(b: readonly number[], i: number): number {
  return b[i] as number;
}

function u16(b: readonly number[], i: number): number {
  return u8(b, i) * 256 + u8(b, i + 1);
}

function i16(b: readonly number[], i: number): number {
  const v = u16(b, i);
  return v >= 32768 ? v - 65536 : v;
}

function i8(b: readonly number[], i: number): number {
  const v = u8(b, i);
  return v >= 128 ? v - 256 : v;
}

function u32(b: readonly number[], i: number): number {
  return u16(b, i) * 65536 + u16(b, i + 2);
}

/** Whether bit n (0-15) of v is set. */
function bit(v: number, n: number): boolean {
  const p = POW2[n] as number;
  return floorOf(v / p) - 2 * floorOf(v / (2 * p)) === 1;
}

/** The offset of an sfnt table (a single-face .ttf), or -1. */
function tableOffset(b: readonly number[], tag: number): number {
  const n = u16(b, 4);
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    if (u32(b, at) === tag) return u32(b, at + 8);
  }
  return -1;
}

/** head.unitsPerEm, or -1 for bytes without head, loca and glyf (no TrueType outlines). */
export function glyfUnitsPerEm(b: readonly number[]): number {
  const head = tableOffset(b, TAG_HEAD);
  if (head < 0 || tableOffset(b, TAG_LOCA) < 0 || tableOffset(b, TAG_GLYF) < 0) return -1;
  return u16(b, head + 18);
}

/** The [start, end) byte range of a glyph in glyf, from loca (head.indexToLocFormat 0: u16 / 2, 1: u32). */
function glyphRange(b: readonly number[], glyph: number): number[] {
  const head = tableOffset(b, TAG_HEAD);
  const loca = tableOffset(b, TAG_LOCA);
  const glyf = tableOffset(b, TAG_GLYF);
  if (i16(b, head + 50) === 0) return [glyf + u16(b, loca + glyph * 2) * 2, glyf + u16(b, loca + glyph * 2 + 2) * 2];
  return [glyf + u32(b, loca + glyph * 4), glyf + u32(b, loca + glyph * 4 + 4)];
}

function pushSegment(out: number[], kind: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void {
  out.push(kind);
  out.push(x0);
  out.push(y0);
  out.push(x1);
  out.push(y1);
  out.push(x2);
  out.push(y2);
}

/**
 * One closed contour's segments in font units: from its first on-curve point (or the last point, or the midpoint of the last and
 * first off-curve points), a line to each on-curve point, a quad through each off-curve point to the next on-curve point or to
 * the implied midpoint of two off-curve points, back to the start.
 */
function contourSegments(xs: readonly number[], ys: readonly number[], on: readonly boolean[], first: number, last: number, dx: number, dy: number, out: number[]): void {
  const n = last - first + 1;
  if (n < 2) return;
  let sx: number;
  let sy: number;
  let k0: number;
  if (on[first] as boolean) {
    sx = xs[first] as number;
    sy = ys[first] as number;
    k0 = 1;
  } else if (on[last] as boolean) {
    sx = xs[last] as number;
    sy = ys[last] as number;
    k0 = 0;
  } else {
    sx = ((xs[last] as number) + (xs[first] as number)) / 2;
    sy = ((ys[last] as number) + (ys[first] as number)) / 2;
    k0 = 0;
  }
  let cx = sx;
  let cy = sy;
  let hasControl = false;
  let qx = 0;
  let qy = 0;
  const emitLine = (x: number, y: number): void => {
    if (x !== cx || y !== cy) pushSegment(out, LINE, cx + dx, cy + dy, x + dx, y + dy, x + dx, y + dy);
    cx = x;
    cy = y;
  };
  const emitQuad = (x: number, y: number): void => {
    if (qx !== cx || qy !== cy || x !== cx || y !== cy) pushSegment(out, QUAD, cx + dx, cy + dy, qx + dx, qy + dy, x + dx, y + dy);
    cx = x;
    cy = y;
  };
  // The points after the start, wrapping round; when the start is the last point, every point before it.
  const count = on[first] as boolean ? n - 1 : (on[last] as boolean ? n - 1 : n);
  for (let j = 0; j < count; j++) {
    const i = first + k0 + j;
    const x = xs[i] as number;
    const y = ys[i] as number;
    if (on[i] as boolean) {
      if (hasControl) emitQuad(x, y);
      else emitLine(x, y);
      hasControl = false;
    } else {
      if (hasControl) emitQuad((qx + x) / 2, (qy + y) / 2);
      qx = x;
      qy = y;
      hasControl = true;
    }
  }
  if (hasControl) emitQuad(sx, sy);
  else emitLine(sx, sy);
}

/**
 * A glyph's outline as segments (SEGMENT_STRIDE numbers each) in font units, y up, read from glyf: simple glyphs, and composite
 * glyphs whose components are offset by x and y alone. [] for an empty glyph; null for what this port does not read.
 */
export function glyfOutline(b: readonly number[], glyph: number): number[] | null {
  const out: number[] = [];
  return appendGlyph(b, glyph, 0, 0, 0, out) ? out : null;
}

function appendGlyph(b: readonly number[], glyph: number, dx: number, dy: number, depth: number, out: number[]): boolean {
  if (depth > 8) return false;
  const r = glyphRange(b, glyph);
  const g = r[0] as number;
  if ((r[1] as number) <= g) return true;
  const contours = i16(b, g);
  if (contours < 0) {
    let at = g + 10;
    for (;;) {
      const flags = u16(b, at);
      const component = u16(b, at + 2);
      at = at + 4;
      let ax: number;
      let ay: number;
      if (bit(flags, 0)) {
        ax = i16(b, at);
        ay = i16(b, at + 2);
        at = at + 4;
      } else {
        ax = i8(b, at);
        ay = i8(b, at + 1);
        at = at + 2;
      }
      // ARGS_ARE_XY_VALUES, and no WE_HAVE_A_SCALE, WE_HAVE_AN_X_AND_Y_SCALE or WE_HAVE_A_TWO_BY_TWO.
      if (!bit(flags, 1) || bit(flags, 3) || bit(flags, 6) || bit(flags, 7)) return false;
      if (!appendGlyph(b, component, dx + ax, dy + ay, depth + 1, out)) return false;
      if (!bit(flags, 5)) return true;
    }
  }
  const ends: number[] = [];
  for (let c = 0; c < contours; c++) ends.push(u16(b, g + 10 + c * 2));
  const points = contours === 0 ? 0 : (ends[contours - 1] as number) + 1;
  let at = g + 10 + contours * 2;
  at = at + 2 + u16(b, at);
  const flags: number[] = [];
  while (flags.length < points) {
    const f = u8(b, at);
    at = at + 1;
    flags.push(f);
    if (bit(f, 3)) {
      const repeat = u8(b, at);
      at = at + 1;
      for (let k = 0; k < repeat; k++) flags.push(f);
    }
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const on: boolean[] = [];
  let x = 0;
  for (let i = 0; i < points; i++) {
    const f = flags[i] as number;
    if (bit(f, 1)) {
      const d = u8(b, at);
      at = at + 1;
      x = bit(f, 4) ? x + d : x - d;
    } else if (!bit(f, 4)) {
      x = x + i16(b, at);
      at = at + 2;
    }
    xs.push(x);
    on.push(bit(f, 0));
  }
  let y = 0;
  for (let i = 0; i < points; i++) {
    const f = flags[i] as number;
    if (bit(f, 2)) {
      const d = u8(b, at);
      at = at + 1;
      y = bit(f, 5) ? y + d : y - d;
    } else if (!bit(f, 5)) {
      y = y + i16(b, at);
      at = at + 2;
    }
    ys.push(y);
  }
  let first = 0;
  for (let c = 0; c < contours; c++) {
    const last = ends[c] as number;
    contourSegments(xs, ys, on, first, last, dx, dy, out);
    first = last + 1;
  }
  return true;
}

/** Dekker's split: hi + lo = a exactly, each with at most 26 significant bits. */
function splitHi(a: number): number {
  const c = 134217729 * a;
  return c - (c - a);
}

/** The rounding error of a * b (fma(a, b, -(a * b))), exact barring overflow. */
function productError(a: number, b: number): number {
  const p = a * b;
  const ah = splitHi(a);
  const al = a - ah;
  const bh = splitHi(b);
  const bl = b - bh;
  return ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}

/** fma(a, b, c) to within the rounding of one sum. */
function fma(a: number, b: number, c: number): number {
  const p = a * b;
  const s = p + c;
  const bp = s - p;
  const sumError = (p - (s - bp)) + (c - bp);
  return s + (sumError + productError(a, b));
}

function abs(v: number): number {
  return v < 0 ? -v : v;
}

/** SkQuads.cpp:47-96 Discriminant: b^2 - ac, with the products' rounding errors added back when they could cancel. */
function discriminant(a: number, b: number, c: number): number {
  const b2 = b * b;
  const ac = a * c;
  const rough = b2 - ac;
  if (3 * abs(rough) >= b2 + ac) return rough;
  return (b2 - ac) + (productError(b, b) - productError(a, c));
}

/** SkQuads.cpp:98-129 Roots of A t^2 - 2 B t + C = 0: [r0, r1], NaN when there is none, both equal for one. */
function quadRoots(A: number, B: number, C: number): number[] {
  const d = discriminant(A, B, C);
  if (A === 0) {
    let root: number;
    if (B === 0) root = C === 0 ? FLT_MAX * 2 : 0 / 0;
    else root = C / (2 * B);
    return [root, root];
  }
  if (d === 0) return [B / A, B / A];
  if (d > 0) {
    const D = sqrt64(d);
    const R = B > 0 ? B + D : B - D;
    return [R / A, C / R];
  }
  return [0 / 0, 0 / 0];
}

/** SkBezierCurves.cpp:141-150 pinTRange. */
function pinT(t: number): number {
  if (f32(t + 1) === 1) return 0;
  if (f32(t) === 1) return 1;
  return t;
}

/** SkBezierCurves.cpp:188-228: the x of each crossing of a quad (float points) with y = yIntercept, as floats. */
function quadCrossings(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, yIntercept: number): number[] {
  const AX = x0 - 2 * x1 + x2;
  const AY = y0 - 2 * y1 + y2;
  const BX = x0 - x1;
  const BY = y0 - y1;
  const r = quadRoots(AY, BY, y0 - yIntercept);
  const out: number[] = [];
  const t0 = pinT(r[0] as number);
  if (t0 >= 0 && t0 <= 1) out.push(f32(fma(fma(AX, t0, -2 * BX), t0, x0)));
  const t1 = pinT(r[1] as number);
  if (t1 >= 0 && t1 <= 1 && t1 !== t0) out.push(f32(fma(fma(AX, t1, -2 * BX), t1, x0)));
  return out;
}

/**
 * SkGlyph.cpp:438-598: the [left, right] gap of one glyph's path at 64 px (path space, y down) between the band edges top and
 * bottom, or [] when the path misses the band. segments are the glyph's outline in font units (glyfOutline).
 */
export function glyphGap(segments: readonly number[], unitsPerEm: number, top: number, bottom: number, faults: InterceptFaults): number[] {
  // SkScalerContext_mac_ct.cpp: Core Text's points at 64 px, y flipped, narrowed to float.
  const p: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const v = segments[i] as number;
    const k = i - floorOf(i / SEGMENT_STRIDE) * SEGMENT_STRIDE;
    if (k === 0) p.push(v);
    else if (k === 1 || k === 3 || k === 5) p.push(f32((v * CANONICAL_TEXT_SIZE_FOR_PATHS) / unitsPerEm));
    else p.push(f32(-((v * CANONICAL_TEXT_SIZE_FOR_PATHS) / unitsPerEm)));
  }
  let bx0 = FLT_MAX;
  let bx1 = -FLT_MAX;
  let by0 = FLT_MAX;
  let by1 = -FLT_MAX;
  for (let s = 0; s < p.length; s += SEGMENT_STRIDE) {
    for (let k = 1; k < SEGMENT_STRIDE; k += 2) {
      const x = p[s + k] as number;
      const y = p[s + k + 1] as number;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }
  if (p.length === 0 || by1 < top || bottom < by0) return [];
  if (faults.inkBoxNotOutline) return [bx0, bx1];
  let left = FLT_MAX;
  let right = -FLT_MAX;
  const expand = (v: number): void => {
    if (v < left) left = v;
    if (v > right) right = v;
  };
  const inBand = (x: number, y: number): void => {
    if (top < y && y < bottom) expand(x);
  };
  for (let s = 0; s < p.length; s += SEGMENT_STRIDE) {
    const x0 = p[s + 1] as number;
    const y0 = p[s + 2] as number;
    const x1 = p[s + 3] as number;
    const y1 = p[s + 4] as number;
    if ((p[s] as number) === LINE) {
      const lo = y0 < y1 ? y0 : y1;
      const hi = y0 < y1 ? y1 : y0;
      if (top <= hi && lo <= bottom) {
        for (const offset of [top, bottom]) {
          const t = f32(f32(offset - y0) / f32(y1 - y0));
          if (t >= 0 && t < 1) expand(f32(x0 + f32(t * f32(x1 - x0))));
        }
        inBand(x0, y0);
        inBand(x1, y1);
      }
    } else {
      const x2 = p[s + 5] as number;
      const y2 = p[s + 6] as number;
      let lo = y0 < y1 ? y0 : y1;
      if (y2 < lo) lo = y2;
      let hi = y0 < y1 ? y1 : y0;
      if (y2 > hi) hi = y2;
      if (top <= hi && lo <= bottom) {
        for (const x of quadCrossings(x0, y0, x1, y1, x2, y2, top)) expand(x);
        for (const x of quadCrossings(x0, y0, x1, y1, x2, y2, bottom)) expand(x);
        inBand(x0, y0);
        inBand(x1, y1);
        inBand(x2, y2);
      }
    }
  }
  return left < right ? [left, right] : [];
}

/**
 * SkTextBlob.cpp:872-924 over one run: each glyph's intercept with the band [bandTop, bandBottom] (device px, y down, relative
 * to the baseline) as [begin, end] pairs relative to the text origin. outlines are the glyphs' glyfOutline segments, xs their
 * pen x relative to the text origin, size the size Skia draws the run at (platformFontSize of the zoomed computed size).
 */
export function runIntercepts(outlines: readonly (readonly number[])[], xs: readonly number[], unitsPerEm: number, size: number, bandTop: number, bandBottom: number, faults: InterceptFaults): number[] {
  const scale = f32(size / CANONICAL_TEXT_SIZE_FOR_PATHS);
  const top = faults.bandUnscaled ? f32(bandTop) : f32(f32(bandTop) / scale);
  const bottom = faults.bandUnscaled ? f32(bandBottom) : f32(f32(bandBottom) / scale);
  const out: number[] = [];
  for (let i = 0; i < outlines.length; i++) {
    const gap = glyphGap(outlines[i] as readonly number[], unitsPerEm, top, bottom, faults);
    if (gap.length < 2) continue;
    const x = f32(xs[i] as number);
    out.push(f32(f32((gap[0] as number) * scale) + x));
    out.push(f32(f32((gap[1] as number) * scale) + x));
  }
  return out;
}

/**
 * text_painter.cc:555-583 with the intercepts: the band is the line's Bounds (y, thickness) inset by 0.5 px vertically, relative
 * to the baseline; each intercept's clip rect from the text origin is outset by the dilation, min(thickness, 13), and Skia's
 * non-anti-aliased clip keeps column x outside [floor(left + 0.5), floor(right + 0.5)). Returns the [start, end) column pairs.
 */
export function interceptBand(y: number, thickness: number, baseline: number): number[] {
  const top = f32(f32(y + 0.5) - f32(baseline));
  return [top, f32(top + f32(thickness - 1))];
}

export function interceptClips(originX: number, intercepts: readonly number[], thickness: number, maxDilation: number): number[] {
  const d = thickness < maxDilation ? thickness : maxDilation;
  const out: number[] = [];
  for (let i = 0; i + 1 < intercepts.length; i += 2) {
    const left = f32(f32(originX + (intercepts[i] as number)) - d);
    const right = f32(f32(originX + (intercepts[i + 1] as number)) + d);
    out.push(floorOf(left + 0.5));
    out.push(floorOf(right + 0.5));
  }
  return out;
}
