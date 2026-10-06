// SVG-a1 (/tmp/specs/svg-a.md): the geometry of an inline <svg>'s shapes as Chrome 145 holds it. The compiler parses the path
// data into these segments (dragon analysis/elements/svg-path.ts); this module holds what the drawing and its proof read from them.
// - Bounds are Skia's SkPathPriv::ComputeTightBounds (src/core/SkPathPriv.cpp), with SkFindCubicExtrema, SkFindUnitQuadRoots,
//   valid_unit_divide and SkCubicCoeff's eval (src/core/SkGeometry.cpp, src/core/SkGeometry.h), ported in float32 with no
//   fused operations, as Chromium builds them (-ffp-contract=off).
// - The viewBox transform is SVG 2 §8.2's xMidYMid meet.
import { froundOf } from './rt-easing.ts';

const f32 = froundOf;

/** One absolute segment in float32 user space. */
export type SvgSegment =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly x: number; readonly y: number }
  | { readonly kind: 'quad'; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number }
  | { readonly kind: 'cubic'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number }
  | { readonly kind: 'close' };

/** A float32 rect as [left, top, right, bottom]. */
export type SvgBounds = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

// ---------------------------------------------------------------------------------------------------------------------
// Skia tight bounds (BSD).

/** valid_unit_divide: numer / denom when it lies in (0, 1), else nothing. */
function validUnitDivide(numer: number, denom: number): number | null {
  let n = numer;
  let d = denom;
  if (n < 0) {
    n = -n;
    d = -d;
  }
  if (d === 0 || n === 0 || n >= d) return null;
  const r = f32(n / d);
  if (r !== r || r === 0) return null;
  return r;
}

/** SkFindUnitQuadRoots: the roots of A t^2 + B t + C in (0, 1), ascending, a double root once. */
function findUnitQuadRoots(A: number, B: number, C: number): number[] {
  if (A === 0) {
    const r = validUnitDivide(-C, B);
    return r === null ? [] : [r];
  }
  let dr = B * B - 4 * A * C;
  if (dr < 0) return [];
  dr = Math.sqrt(dr);
  const R = f32(dr);
  if (!Number.isFinite(R)) return [];
  const Q = B < 0 ? f32(f32(-f32(B - R)) / 2) : f32(f32(-f32(B + R)) / 2);
  const roots: number[] = [];
  const r1 = validUnitDivide(Q, A);
  if (r1 !== null) roots.push(r1);
  const r2 = validUnitDivide(C, Q);
  if (r2 !== null) roots.push(r2);
  if (roots.length === 2) {
    if ((roots[0] as number) > (roots[1] as number)) roots.reverse();
    else if (roots[0] === roots[1]) roots.pop();
  }
  return roots;
}

/** SkFindCubicExtrema: the t of each extremum of one coordinate of a cubic, in (0, 1). */
function findCubicExtrema(a: number, b: number, c: number, d: number): number[] {
  const A = f32(f32(d - a) + f32(3 * f32(b - c)));
  const B = f32(2 * f32(f32(f32(a - b) - b) + c));
  const C = f32(b - a);
  return findUnitQuadRoots(A, B, C);
}

/** SkFindQuadExtrema: the t of the extremum of one coordinate of a quad, in (0, 1). */
function findQuadExtrema(a: number, b: number, c: number): number[] {
  const r = validUnitDivide(f32(a - b), f32(f32(f32(a - b) - b) + c));
  return r === null ? [] : [r];
}

/** SkQuadCoeff(src).eval(t) for one coordinate. */
function evalQuad(p0: number, p1: number, p2: number, t: number): number {
  const B = f32(2 * f32(p1 - p0));
  const A = f32(f32(p2 - f32(2 * p1)) + p0);
  return f32(f32(f32(f32(A * t) + B) * t) + p0);
}

/** SkCubicCoeff(src).eval(t) for one coordinate. */
function evalCubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const A = f32(f32(p3 + f32(3 * f32(p1 - p2))) - p0);
  const B = f32(3 * f32(f32(p2 - f32(2 * p1)) + p0));
  const C = f32(3 * f32(p1 - p0));
  return f32(f32(f32(f32(f32(f32(A * t) + B) * t) + C) * t) + p0);
}

/**
 * SkPath::computeTightBounds of a path built from these segments (null for no segments). A path of lines alone takes its quick
 * bounds, SkPathPriv::TrimmedBounds, which skip a trailing moveto; any curve takes ComputeTightBounds over every verb.
 */
export function tightBounds(segments: readonly SvgSegment[]): SvgBounds | null {
  const first = segments[0];
  if (first === undefined || first.kind !== 'move') return null;
  const linesOnly = segments.some((s) => s.kind === 'line') && segments.every((s) => s.kind === 'line' || s.kind === 'move' || s.kind === 'close');
  const last = segments[segments.length - 1] as SvgSegment;
  const used = linesOnly && segments.length > 1 && last.kind === 'move' ? segments.slice(0, -1) : segments;
  return computeBounds(used);
}

function computeBounds(segments: readonly SvgSegment[]): SvgBounds | null {
  const first = segments[0];
  if (first === undefined || first.kind !== 'move') return null;
  let L = first.x;
  let T = first.y;
  let R = first.x;
  let B = first.y;
  const add = (x: number, y: number): void => {
    L = Math.min(x, L);
    T = Math.min(y, T);
    R = Math.max(x, R);
    B = Math.max(y, B);
  };
  let cx = first.x;
  let cy = first.y;
  let sx = first.x;
  let sy = first.y;
  for (const s of segments) {
    if (s.kind === 'move') {
      add(s.x, s.y);
      cx = sx = s.x;
      cy = sy = s.y;
    } else if (s.kind === 'line') {
      add(s.x, s.y);
      cx = s.x;
      cy = s.y;
    } else if (s.kind === 'quad') {
      const ts = [...findQuadExtrema(cx, s.x1, s.x), ...findQuadExtrema(cy, s.y1, s.y)];
      for (const t of ts) add(evalQuad(cx, s.x1, s.x, t), evalQuad(cy, s.y1, s.y, t));
      add(s.x, s.y);
      cx = s.x;
      cy = s.y;
    } else if (s.kind === 'cubic') {
      const ts = [...findCubicExtrema(cx, s.x1, s.x2, s.x), ...findCubicExtrema(cy, s.y1, s.y2, s.y)];
      for (const t of ts) add(evalCubic(cx, s.x1, s.x2, s.x, t), evalCubic(cy, s.y1, s.y2, s.y, t));
      add(s.x, s.y);
      cx = s.x;
      cy = s.y;
    } else {
      cx = sx;
      cy = sy;
    }
  }
  return { left: L, top: T, right: R, bottom: B };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shapes and the viewport.

/** A shape's geometry in user units (float32): a path, an axis-aligned rect, or a circle. */
export type SvgShape =
  | { readonly kind: 'path'; readonly segments: readonly SvgSegment[] }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number };

/** The object bounding box (getBBox): the tight bounds of the fill geometry, as [x, y, width, height] in float32. */
export function objectBoundingBox(shape: SvgShape): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (shape.kind === 'rect') return { x: shape.x, y: shape.y, width: Math.max(0, shape.width), height: Math.max(0, shape.height) };
  if (shape.kind === 'circle') {
    const d = f32(2 * shape.r);
    return { x: f32(shape.cx - shape.r), y: f32(shape.cy - shape.r), width: d, height: d };
  }
  const b = tightBounds(shape.segments);
  if (b === null) return { x: 0, y: 0, width: 0, height: 0 };
  return boundingRect(b);
}

/** The next float32 above v (std::nextafter towards +infinity). */
function nextUp(v: number): number {
  if (v !== v || v === Infinity) return v;
  if (v === 0) return 1.401298464324817e-45;
  const buf = new DataView(new ArrayBuffer(4));
  buf.setFloat32(0, v);
  const bits = buf.getInt32(0);
  buf.setInt32(0, v > 0 ? bits + 1 : bits - 1);
  return buf.getFloat32(0);
}

/**
 * gfx::BoundingRect (ui/gfx/geometry/rect_f.cc) of an SkRect, as gfx::SkRectToRectF builds it: a width or height whose float sum
 * with the left or top edge misses the far edge grows to the next float.
 */
function boundingRect(b: SvgBounds): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  let width = f32(b.right - b.left);
  let height = f32(b.bottom - b.top);
  if (f32(b.left + width) !== b.right) width = Math.min(nextUp(width), 3.4028234663852886e38);
  if (f32(b.top + height) !== b.bottom) height = Math.min(nextUp(height), 3.4028234663852886e38);
  return { x: b.left, y: b.top, width, height };
}

/** A viewBox: min-x, min-y, width and height in user units. */
export type ViewBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** A 2D affine map [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
export type SvgMatrix = { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number };

/**
 * SVG 2 §8.2, xMidYMid meet: the user-to-viewport map of a viewport of width x height px. With no viewBox, the identity.
 */
export function viewBoxTransform(viewBox: ViewBox | null, width: number, height: number): SvgMatrix {
  if (viewBox === null) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const s = Math.min(width / viewBox.width, height / viewBox.height);
  const tx = (width - viewBox.width * s) / 2 - viewBox.x * s;
  const ty = (height - viewBox.height * s) / 2 - viewBox.y * s;
  return { a: s, b: 0, c: 0, d: s, e: tx, f: ty };
}
