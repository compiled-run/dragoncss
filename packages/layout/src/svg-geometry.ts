// SVG-a1 (/tmp/specs/svg-a.md): the geometry of an inline <svg>'s shapes as Chrome 145 holds it. The compiler parses the path
// data into these segments (dragon analysis/elements/svg-path.ts); this module holds what the drawing and its proof read from them.
// - Bounds are Skia's SkPathPriv::ComputeTightBounds (src/core/SkPathPriv.cpp), with SkFindCubicExtrema, SkFindUnitQuadRoots,
//   valid_unit_divide and SkCubicCoeff's eval (src/core/SkGeometry.cpp, src/core/SkGeometry.h), ported in float32 with no
//   fused operations, as Chromium builds them (-ffp-contract=off).
// - The viewBox transform is SVG 2 §8.2's xMidYMid meet, in Chrome's arithmetic.
import { sqrtF64 } from './paint-gradient.ts';
import { froundOf } from './rt-easing.ts';

export type SvgMove = { readonly kind: 'move'; readonly x: number; readonly y: number };
export type SvgLine = { readonly kind: 'line'; readonly x: number; readonly y: number };
export type SvgQuad = { readonly kind: 'quad'; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number };
export type SvgCubic = { readonly kind: 'cubic'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number };
export type SvgClose = { readonly kind: 'close' };

/** One absolute segment in float32 user space. */
export type SvgSegment = SvgMove | SvgLine | SvgQuad | SvgCubic | SvgClose;

/** A float32 rect as [left, top, right, bottom]. */
export type SvgBounds = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** A float32 rect as origin and size (getBBox). */
export type SvgRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const FLOAT_MAX = 3.4028234663852886e38;

function minNum(a: number, b: number): number {
  return a < b ? a : b;
}

function maxNum(a: number, b: number): number {
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------------------------------------------------
// Skia tight bounds (BSD).

/** valid_unit_divide: numer / denom when it lies in (0, 1), else -1 (no root). */
function validUnitDivide(numer: number, denom: number): number {
  let n = numer;
  let d = denom;
  if (n < 0) {
    n = -n;
    d = -d;
  }
  if (d === 0 || n === 0 || n >= d) return -1;
  const r = froundOf(n / d);
  if (Number.isNaN(r) || r === 0) return -1;
  return r;
}

/** SkFindUnitQuadRoots: the roots of A t^2 + B t + C in (0, 1), ascending, a double root once. */
function findUnitQuadRoots(A: number, B: number, C: number): number[] {
  const roots: number[] = [];
  if (A === 0) {
    const only = validUnitDivide(-C, B);
    if (only >= 0) roots.push(only);
    return roots;
  }
  const dr = B * B - 4 * A * C;
  if (dr < 0) return roots;
  const R = froundOf(sqrtF64(dr));
  if (!Number.isFinite(R)) return roots;
  const Q = B < 0 ? froundOf(froundOf(-froundOf(B - R)) / 2) : froundOf(froundOf(-froundOf(B + R)) / 2);
  const first = validUnitDivide(Q, A);
  const second = validUnitDivide(C, Q);
  if (first >= 0) roots.push(first);
  if (second >= 0) roots.push(second);
  if (first >= 0 && second >= 0) {
    if (first > second) return [second, first];
    if (first === second) return [first];
  }
  return roots;
}

/** SkFindCubicExtrema: the t of each extremum of one coordinate of a cubic, in (0, 1). */
function findCubicExtrema(a: number, b: number, c: number, d: number): number[] {
  const A = froundOf(froundOf(d - a) + froundOf(3 * froundOf(b - c)));
  const B = froundOf(2 * froundOf(froundOf(froundOf(a - b) - b) + c));
  const C = froundOf(b - a);
  return findUnitQuadRoots(A, B, C);
}

/** SkFindQuadExtrema: the t of the extremum of one coordinate of a quad, in (0, 1). */
function findQuadExtrema(a: number, b: number, c: number): number[] {
  const r = validUnitDivide(froundOf(a - b), froundOf(froundOf(froundOf(a - b) - b) + c));
  return r >= 0 ? [r] : [];
}

/** SkQuadCoeff(src).eval(t) for one coordinate. */
function evalQuad(p0: number, p1: number, p2: number, t: number): number {
  const B = froundOf(2 * froundOf(p1 - p0));
  const A = froundOf(froundOf(p2 - froundOf(2 * p1)) + p0);
  return froundOf(froundOf(froundOf(froundOf(A * t) + B) * t) + p0);
}

/** SkCubicCoeff(src).eval(t) for one coordinate. */
function evalCubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const A = froundOf(froundOf(p3 + froundOf(3 * froundOf(p1 - p2))) - p0);
  const B = froundOf(3 * froundOf(froundOf(p2 - froundOf(2 * p1)) + p0));
  const C = froundOf(3 * froundOf(p1 - p0));
  return froundOf(froundOf(froundOf(froundOf(froundOf(froundOf(A * t) + B) * t) + C) * t) + p0);
}

/**
 * SkPath::computeTightBounds of a path built from these segments (null for no segments). A path of lines alone takes its quick
 * bounds, SkPathPriv::TrimmedBounds (src/core/SkPathPriv.h), which skip a trailing moveto; any curve takes ComputeTightBounds over
 * every verb.
 */
export function tightBounds(segments: readonly SvgSegment[]): SvgBounds | null {
  if (segments.length === 0) return null;
  let anyLine = false;
  let anyCurve = false;
  for (const s of segments) {
    if (s.kind === 'line') anyLine = true;
    if (s.kind === 'quad' || s.kind === 'cubic') anyCurve = true;
  }
  const last = segments[segments.length - 1] as SvgSegment;
  const trim = anyLine && !anyCurve && segments.length > 1 && last.kind === 'move';
  const used: SvgSegment[] = [];
  let i = 0;
  for (const s of segments) {
    if (!trim || i < segments.length - 1) used.push(s);
    i++;
  }
  return computeBounds(used);
}

function computeBounds(segments: readonly SvgSegment[]): SvgBounds | null {
  if (segments.length === 0) return null;
  const first = segments[0] as SvgSegment;
  if (first.kind !== 'move') return null;
  let L = first.x;
  let T = first.y;
  let R = first.x;
  let B = first.y;
  let cx = first.x;
  let cy = first.y;
  let sx = first.x;
  let sy = first.y;
  // std::fminf and std::fmaxf, extremum first: a NaN extremum leaves the bound.
  for (const s of segments) {
    const xs: number[] = [];
    const ys: number[] = [];
    if (s.kind === 'move') {
      xs.push(s.x);
      ys.push(s.y);
      cx = s.x;
      cy = s.y;
      sx = s.x;
      sy = s.y;
    } else if (s.kind === 'line') {
      xs.push(s.x);
      ys.push(s.y);
      cx = s.x;
      cy = s.y;
    } else if (s.kind === 'quad') {
      const qx = cx;
      const qy = cy;
      for (const t of findQuadExtrema(qx, s.x1, s.x)) {
        xs.push(evalQuad(qx, s.x1, s.x, t));
        ys.push(evalQuad(qy, s.y1, s.y, t));
      }
      for (const t of findQuadExtrema(qy, s.y1, s.y)) {
        xs.push(evalQuad(qx, s.x1, s.x, t));
        ys.push(evalQuad(qy, s.y1, s.y, t));
      }
      xs.push(s.x);
      ys.push(s.y);
      cx = s.x;
      cy = s.y;
    } else if (s.kind === 'cubic') {
      const qx = cx;
      const qy = cy;
      for (const t of findCubicExtrema(qx, s.x1, s.x2, s.x)) {
        xs.push(evalCubic(qx, s.x1, s.x2, s.x, t));
        ys.push(evalCubic(qy, s.y1, s.y2, s.y, t));
      }
      for (const t of findCubicExtrema(qy, s.y1, s.y2, s.y)) {
        xs.push(evalCubic(qx, s.x1, s.x2, s.x, t));
        ys.push(evalCubic(qy, s.y1, s.y2, s.y, t));
      }
      xs.push(s.x);
      ys.push(s.y);
      cx = s.x;
      cy = s.y;
    } else {
      cx = sx;
      cy = sy;
    }
    for (const x of xs) {
      L = Number.isNaN(x) ? L : minNum(x, L);
      R = Number.isNaN(x) ? R : maxNum(x, R);
    }
    for (const y of ys) {
      T = Number.isNaN(y) ? T : minNum(y, T);
      B = Number.isNaN(y) ? B : maxNum(y, B);
    }
  }
  return { left: L, top: T, right: R, bottom: B };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shapes and the viewport.

export type SvgPathShape = { readonly kind: 'path'; readonly segments: readonly SvgSegment[] };
export type SvgRectShape = { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type SvgCircleShape = { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number };

/** A shape's geometry in user units (float32): a path, an axis-aligned rect, or a circle. */
export type SvgShape = SvgPathShape | SvgRectShape | SvgCircleShape;

/** The object bounding box (getBBox): the tight bounds of the fill geometry, as origin and size in float32. */
export function objectBoundingBox(shape: SvgShape): SvgRect {
  if (shape.kind === 'rect') return { x: shape.x, y: shape.y, width: maxNum(0, shape.width), height: maxNum(0, shape.height) };
  if (shape.kind === 'circle') {
    const d = froundOf(2 * shape.r);
    return { x: froundOf(shape.cx - shape.r), y: froundOf(shape.cy - shape.r), width: d, height: d };
  }
  const b = tightBounds(shape.segments);
  if (b === null) return { x: 0, y: 0, width: 0, height: 0 };
  return boundingRect(b);
}

/** The next float32 above a non-negative float32 v (std::nextafter towards +infinity). */
function nextUpNonNegative(v: number): number {
  if (v === 0) return 1.401298464324817e-45;
  if (v < 1.1754943508222875e-38) return froundOf(v + 1.401298464324817e-45);
  let p = 1;
  while (p * 2 <= v) p = p * 2;
  while (p > v) p = p / 2;
  return v + p / 8388608;
}

/**
 * gfx::BoundingRect (ui/gfx/geometry/rect_f.cc) of an SkRect, as gfx::SkRectToRectF builds it: a width or height whose float sum
 * with the left or top edge misses the far edge grows to the next float.
 */
function boundingRect(b: SvgBounds): SvgRect {
  let width = froundOf(b.right - b.left);
  let height = froundOf(b.bottom - b.top);
  if (froundOf(b.left + width) !== b.right) width = minNum(nextUpNonNegative(width), FLOAT_MAX);
  if (froundOf(b.top + height) !== b.bottom) height = minNum(nextUpNonNegative(height), FLOAT_MAX);
  return { x: b.left, y: b.top, width: width, height: height };
}

/** A viewBox: min-x, min-y, width and height in user units. */
export type ViewBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** A 2D affine map [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
export type SvgMatrix = { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number };

/**
 * SVG 2 §8.2, xMidYMid meet (slice: the other axis limits), in Chrome's observed arithmetic (pinned by parity/test/svg.test.ts
 * against captured CTMs): the axis whose ratio limits the scale is scaled by viewport / viewBox along it, and the other axis is
 * centred by -min - (extent - viewport x viewBox / viewport of the limiting axis) / 2 in user units, then scaled, all in double.
 * With no viewBox, the identity.
 */
export function viewBoxTransform(viewBox: ViewBox | null, width: number, height: number, slice: boolean): SvgMatrix {
  if (viewBox === null) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const logicalRatio = viewBox.width / viewBox.height;
  const physicalRatio = width / height;
  if (logicalRatio < physicalRatio !== slice) {
    const s = height / viewBox.height;
    return { a: s, b: 0, c: 0, d: s, e: s * (-viewBox.x - (viewBox.width - (width * viewBox.height) / height) / 2), f: s * -viewBox.y };
  }
  const s = width / viewBox.width;
  return { a: s, b: 0, c: 0, d: s, e: s * -viewBox.x, f: s * (-viewBox.y - (viewBox.height - (height * viewBox.width) / width) / 2) };
}
