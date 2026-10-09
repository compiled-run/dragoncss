// border-radius geometry as Blink 145 paints it (css-backgrounds-3 §5): the eight radii of a box in device px, the §5.5 clamp and
// the padding-edge (inner) radii. Blink's steps: CalcRadiiFor (FloatValueForLength of each zoomed Length against the layout border
// box size, before snapping: contoured_border_geometry.cc PixelSnappedContouredBorder passes border_rect.size; a fixed length is stored as float(css px x zoom), a percentage as float(size x percent) / 100), gfx::SizeF's clamp of a
// trivial component to 0, FloatRoundedRect::ConstrainRadii (one factor min(L/S) over the four sums, float steps), and
// PixelSnappedRoundedInnerBorder (the snapped rect inset by the device-px border widths, positive components shrunk by the
// adjacent widths). Radii order everywhere: horizontal then vertical, top-left, top-right, bottom-right, bottom-left. Every
// exported function is a translated engine root (translate/src/generate.ts), proven TS = Swift = Kotlin by
// packages/layout/paint-vectors/radius.
import { froundOf } from './rt-easing.ts';

/** Planted faults (T046 §5.2); the paint vectors and the pixel lanes must catch each one. */
export type RadiusFaults = {
  /** Skips ConstrainRadii, so overlapping radii are drawn unscaled. */
  readonly radiusUnclamped: boolean;
  /** Gives the padding edge the border edge's radii. */
  readonly innerRadiusNotReduced: boolean;
};

export const NO_RADIUS_FAULTS: RadiusFaults = { radiusUnclamped: false, innerRadiusNotReduced: false };

/** One authored radius component: a zoom-1 css px length (em and rem already resolved), or a percentage of its axis. */
export type RadiusLength = { readonly percent: boolean; readonly value: number };

/** gfx::SizeF clamps a component at most 8 float epsilons to 0. */
const SIZEF_TRIVIAL = 9.5367431640625e-7;

function f32(v: number): number {
  return froundOf(v);
}

function sizeClamp(v: number): number {
  return v > SIZEF_TRIVIAL ? v : 0;
}

function at(xs: readonly number[], i: number): number {
  const v = xs[i];
  if (v === undefined) throw new Error(`paint-radius: index ${i} is outside the ${xs.length} radii`);
  return v;
}

function lengthAt(xs: readonly RadiusLength[], i: number): RadiusLength {
  const v = xs[i];
  if (v === undefined) throw new Error(`paint-radius: index ${i} is outside the ${xs.length} radius lengths`);
  return v;
}

function minOf(a: number, b: number): number {
  return a < b ? a : b;
}

function maxOf(a: number, b: number): number {
  return a > b ? a : b;
}

/** FloatValueForLength of one zoomed radius component against its axis (the border box width or height in device px). */
export function radiusComponent(len: RadiusLength, axis: number, dpr: number): number {
  if (len.percent) return f32(f32(axis * f32(len.value)) / 100);
  return f32(len.value * dpr);
}

/**
 * CalcRadiiFor: the eight radii in device px of a border box width x height device px, from the eight authored components.
 * A corner with a zero component is square (FloatRoundedRect::Radii keeps it, and Skia's rrect zeroes both).
 */
export function resolveCornerRadii(lengths: readonly RadiusLength[], width: number, height: number, dpr: number): number[] {
  if (lengths.length !== 8) throw new Error(`paint-radius: ${lengths.length} radius lengths, not 8`);
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(sizeClamp(radiusComponent(lengthAt(lengths, i), i < 4 ? width : height, dpr)));
  return out;
}

/** gfx::SizeF::Scale, then FloatRoundedRect::Radii::Scale's reset of a corner with a zero component. */
function scaleCorner(out: number[], x: number, y: number, factor: number): void {
  const sx = sizeClamp(f32(x * factor));
  const sy = sizeClamp(f32(y * factor));
  if (sx === 0 || sy === 0) {
    out.push(0);
    out.push(0);
    return;
  }
  out.push(sx);
  out.push(sy);
}

/** FloatRoundedRect::ConstrainRadii: one factor min(width / horizontal sum, height / vertical sum, 1) scales every radius. */
export function constrainCornerRadii(radii: readonly number[], width: number, height: number, faults: RadiusFaults): number[] {
  if (radii.length !== 8) throw new Error(`paint-radius: ${radii.length} radii, not 8`);
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(at(radii, i));
  if (faults.radiusUnclamped) return out;
  const w = f32(width);
  const h = f32(height);
  let factor = 1;
  const horizontal = maxOf(f32(at(radii, 0) + at(radii, 1)), f32(at(radii, 3) + at(radii, 2)));
  if (horizontal > w) factor = minOf(f32(w / horizontal), factor);
  const vertical = maxOf(f32(at(radii, 4) + at(radii, 7)), f32(at(radii, 5) + at(radii, 6)));
  if (vertical > h) factor = minOf(f32(h / vertical), factor);
  if (factor === 1) return out;
  const pairs: number[] = [];
  for (let k = 0; k < 4; k++) scaleCorner(pairs, at(radii, k), at(radii, k + 4), factor);
  const scaled: number[] = [];
  for (let k = 0; k < 4; k++) scaled.push(at(pairs, 2 * k));
  for (let k = 0; k < 4; k++) scaled.push(at(pairs, 2 * k + 1));
  return scaled;
}

/** FloatRoundedRect::IsRenderable (tolerance 1.0001f): no two adjacent radii overlap along a side. */
export function radiiRenderable(radii: readonly number[], width: number, height: number): boolean {
  const w = f32(f32(width) * f32(1.0001));
  const h = f32(f32(height) * f32(1.0001));
  return f32(at(radii, 0) + at(radii, 1)) <= w && f32(at(radii, 3) + at(radii, 2)) <= w && f32(at(radii, 4) + at(radii, 7)) <= h && f32(at(radii, 5) + at(radii, 6)) <= h;
}

/**
 * PixelSnappedRoundedInnerBorder: the padding-edge radii of a border box width x height device px with border widths (top,
 * right, bottom, left) in device px. Each positive component shrinks by the adjacent width; a result that is not renderable is
 * constrained against the inner rect, as Blink does before it clips or draws with it.
 */
export function innerCornerRadii(outer: readonly number[], borders: readonly number[], width: number, height: number, faults: RadiusFaults): number[] {
  if (outer.length !== 8 || borders.length !== 4) throw new Error('paint-radius: inner radii take 8 radii and 4 border widths');
  const out: number[] = [];
  if (faults.innerRadiusNotReduced) {
    for (let i = 0; i < 8; i++) out.push(at(outer, i));
    return out;
  }
  const bt = at(borders, 0);
  const br = at(borders, 1);
  const bb = at(borders, 2);
  const bl = at(borders, 3);
  const dx = [bl, br, br, bl];
  const dy = [bt, bt, bb, bb];
  for (let k = 0; k < 4; k++) {
    const x = at(outer, k);
    out.push(sizeClamp(x > 0 ? f32(x - at(dx, k)) : x));
  }
  for (let k = 0; k < 4; k++) {
    const y = at(outer, k + 4);
    out.push(sizeClamp(y > 0 ? f32(y - at(dy, k)) : y));
  }
  const iw = maxOf(width - bl - br, 0);
  const ih = maxOf(height - bt - bb, 0);
  if (radiiRenderable(out, iw, ih)) return out;
  return constrainCornerRadii(out, iw, ih, faults);
}

/**
 * The rounded shape of a snapped border box (edges in device px) with border widths (top, right, bottom, left) in device px:
 * the outer radii (8), then the inner radii (8). Percentages resolve against the layout border box size (layoutWidth and
 * layoutHeight, device px before snapping); the radii are then constrained to the snapped box.
 */
export function roundedShape(left: number, top: number, right: number, bottom: number, layoutWidth: number, layoutHeight: number, borders: readonly number[], lengths: readonly RadiusLength[], dpr: number, faults: RadiusFaults): number[] {
  const width = right - left;
  const height = bottom - top;
  const outer = constrainCornerRadii(resolveCornerRadii(lengths, layoutWidth, layoutHeight, dpr), width, height, faults);
  const inner = innerCornerRadii(outer, borders, width, height, faults);
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(at(outer, i));
  for (let i = 0; i < 8; i++) out.push(at(inner, i));
  return out;
}

/** Whether any corner of eight radii is rounded (both components positive); a square box draws and clips its rectangle. */
export function hasRoundedCorner(radii: readonly number[]): boolean {
  if (radii.length !== 8) throw new Error(`paint-radius: ${radii.length} radii, not 8`);
  for (let k = 0; k < 4; k++) if (at(radii, k) > 0 && at(radii, k + 4) > 0) return true;
  return false;
}
