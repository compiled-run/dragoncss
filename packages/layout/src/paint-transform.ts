// PNT2 (notes/T046-paint-spec.md §1, §5.3): the transform of a box resolved at its border-box size, as Blink 145 paints it
// (ComputedStyle::ApplyTransform with the transform origin: translate to the origin, apply each function, translate back). The
// functions, the float box size, gfx::SinCosDegrees and the matrix steps are the interpolation reference's (rt-interpolate.ts),
// so the device and the animation runtime compose the same matrix; the platform supplies only sin and cos (T047 RT-4).
import { froundOf } from './rt-easing.ts';
import type { LengthValue, Matrix2D, TransformOp, Trig } from './rt-interpolate.ts';
import { applyTransformOps, IDENTITY_MATRIX, resolveLength, translateMatrix } from './rt-interpolate.ts';

/** A length as Blink stores it in a transform function or origin (blink::Length holds a float). */
function storedLength(l: LengthValue): LengthValue {
  return { kind: l.kind, px: froundOf(l.px), percent: froundOf(l.percent) };
}

/** The functions with their lengths as Blink stores them; the compiler writes the computed doubles. */
function storedOps(ops: readonly TransformOp[]): TransformOp[] {
  return ops.map((o): TransformOp => ({ fn: o.fn, x: storedLength(o.x), y: storedLength(o.y), angle: o.angle, sx: o.sx, sy: o.sy }));
}

/** transform-origin as typed lengths against the border box (px or percent); its z is always 0, since 3D is refused. */
export type TransformOrigin = {
  readonly x: LengthValue;
  readonly y: LengthValue;
};

/** A resolved transform origin in CSS px from the border box's top left. */
export type OriginPoint = {
  readonly x: number;
  readonly y: number;
};

/** The transform origin in CSS px: FloatValueForLength of each coordinate against the float border-box width and height. */
export function resolveTransformOrigin(origin: TransformOrigin, boxWidth: number, boxHeight: number): OriginPoint {
  return { x: resolveLength(storedLength(origin.x), froundOf(boxWidth)), y: resolveLength(storedLength(origin.y), froundOf(boxHeight)) };
}

/** The functions alone (no origin) at the border-box size: the matrix Chrome serialises for getComputedStyle(el).transform. */
export function transformFunctionsMatrix(ops: readonly TransformOp[], boxWidth: number, boxHeight: number, trig: Trig): Matrix2D {
  return applyTransformOps(IDENTITY_MATRIX, storedOps(ops), boxWidth, boxHeight, trig);
}

/**
 * The paint matrix of a box in its own border-box coordinates (CSS px from its top left): translate by the origin, the functions,
 * translate back, each step as gfx::Transform takes it.
 */
export function paintTransformMatrix(ops: readonly TransformOp[], origin: TransformOrigin, boxWidth: number, boxHeight: number, trig: Trig): Matrix2D {
  const o = resolveTransformOrigin(origin, boxWidth, boxHeight);
  const toOrigin = translateMatrix(IDENTITY_MATRIX, o.x, o.y);
  return translateMatrix(applyTransformOps(toOrigin, storedOps(ops), boxWidth, boxHeight, trig), -o.x, -o.y);
}

/**
 * The same paint matrix for a platform that applies a transform about the point (px, py) of the box (a CALayer about its anchor
 * point): T(-p) · m · T(p), so that T(p) · result · T(-p) equals m.
 */
export function transformAboutPoint(m: Matrix2D, px: number, py: number): Matrix2D {
  return { full: true, a: m.a, b: m.b, c: m.c, d: m.d, e: m.a * px + m.c * py + m.e - px, f: m.b * px + m.d * py + m.f - py };
}

/** A point of the box's own coordinates mapped through a matrix: [a c e; b d f] times (x, y, 1). */
export function mapPoint(m: Matrix2D, x: number, y: number): OriginPoint {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

