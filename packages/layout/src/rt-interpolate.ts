// Interpolation and computed-value serialisation as Blink does them at Chrome 145 (145.0.7632.6): InterpolableNumber,
// InterpolableLength, InterpolableColor (premultiplied legacy sRGB), TransformOperations::Blend (css-transforms-1 §9, -2 §16),
// gfx::Transform and CSSNumericLiteralValue's "%.6g". Blink stores lengths, opacity and colour channels as float, so those
// values pass through froundOf exactly where Blink narrows.
import type { RtFaults } from './rt-easing.ts';
import { floorOf, froundOf, INFINITY, roundOf, truncOf } from './rt-easing.ts';
import { fmod } from './rt-timing.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Blend primitives.

/** InterpolableNumber::Interpolate (numbers, colour channels). */
export function interpolateNumber(from: number, to: number, progress: number): number {
  if (progress === 0 || from === to) return from;
  if (progress === 1) return to;
  return from * (1 - progress) + to * progress;
}

/** blink::Blend(double, double, double). */
export function blendDouble(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/** blink::Blend(float, float, double): the difference is a float, the sum a double narrowed to float. */
export function blendFloat(from: number, to: number, progress: number): number {
  return froundOf(from + froundOf(to - from) * progress);
}

// ---------------------------------------------------------------------------------------------------------------------
// Numbers: opacity.

/** Opacity at progress: interpolated as a number, clamped to [0, 1] and stored as float. */
export function interpolateOpacity(from: number, to: number, progress: number): number {
  const v = interpolateNumber(from, to, progress);
  return froundOf(v < 0 ? 0 : v > 1 ? 1 : v);
}

// ---------------------------------------------------------------------------------------------------------------------
// Length-percentages.

/** A blink::Length: fixed px, percent, or calc(percent + px); values are floats. */
export type LengthValue = {
  readonly kind: 'px' | 'percent' | 'calc';
  readonly px: number;
  readonly percent: number;
};

export function lengthPx(v: number): LengthValue {
  return { kind: 'px', px: froundOf(v), percent: 0 };
}

export function lengthPercent(v: number): LengthValue {
  return { kind: 'percent', px: 0, percent: froundOf(v) };
}

export const ZERO_PX: LengthValue = { kind: 'px', px: 0, percent: 0 };

function lengthIsZero(l: LengthValue): boolean {
  if (l.kind === 'px') return l.px === 0;
  if (l.kind === 'percent') return l.percent === 0;
  return false;
}

/**
 * A length-percentage property at progress (InterpolableLength with px and % entries, then CreateLength): each entry blends in
 * double, and the Length narrows to float. Either endpoint having a percentage flags both.
 */
export function interpolateLengthProperty(from: LengthValue, to: LengthValue, progress: number): LengthValue {
  const hasPercentage = from.kind !== 'px' || to.kind !== 'px';
  const pixels = blendDouble(from.px, to.px, progress);
  const percentage = blendDouble(from.percent, to.percent, progress);
  if (pixels !== 0 && hasPercentage) return { kind: 'calc', px: froundOf(pixels), percent: froundOf(percentage) };
  if (hasPercentage) return { kind: 'percent', px: 0, percent: froundOf(percentage) };
  return { kind: 'px', px: froundOf(pixels), percent: 0 };
}

/** Length::Blend(from, progress) called on `to`, as transform functions blend their length arguments. */
export function blendLength(to: LengthValue, from: LengthValue, progress: number): LengthValue {
  if (progress === 0.0) return from;
  if (progress === 1.0) return to;
  const mixed = from.kind === 'calc' || to.kind === 'calc' || (!lengthIsZero(from) && !lengthIsZero(to) && from.kind !== to.kind);
  if (mixed) return { kind: 'calc', px: blendFloat(from.px, to.px, progress), percent: blendFloat(from.percent, to.percent, progress) };
  if (lengthIsZero(from) && lengthIsZero(to)) return to;
  const kind = lengthIsZero(to) ? from.kind : to.kind;
  const fromValue = from.kind === 'px' ? from.px : from.percent;
  const toValue = to.kind === 'px' ? to.px : to.percent;
  const v = blendFloat(fromValue, toValue, progress);
  return kind === 'px' ? { kind: 'px', px: v, percent: 0 } : { kind: 'percent', px: 0, percent: v };
}

/** FloatValueForLength against a float reference size (the border box for translate). */
export function resolveLength(l: LengthValue, maximum: number): number {
  if (l.kind === 'px') return l.px;
  if (l.kind === 'percent') return froundOf(froundOf(maximum * l.percent) / 100);
  const v = froundOf(l.px + froundOf(froundOf(l.percent / 100) * maximum));
  return Number.isNaN(v) ? 0 : v;
}

// ---------------------------------------------------------------------------------------------------------------------
// Angles: the rotate property and rotate() blend through Rotation::Slerp about the common z axis.

const ANGLE_EPSILON = 1e-4;

function absOf(v: number): number {
  return v < 0 ? -v : v;
}

/** Rotation::Slerp for two z-axis rotations: GetCommonAxis treats |angle| < 1e-4 as zero, then blends the angles. */
export function interpolateAngle(fromDeg: number, toDeg: number, progress: number, faults: RtFaults): number {
  const zeroA = absOf(fromDeg) < ANGLE_EPSILON;
  const zeroB = absOf(toDeg) < ANGLE_EPSILON;
  let a = zeroA ? 0 : fromDeg;
  let b = zeroB ? 0 : toDeg;
  if (faults.rotateViaMatrix) {
    a = matrixAngle(a);
    b = matrixAngle(b);
  }
  return blendDouble(a, b, progress);
}

/** The angle a rotation matrix represents, in (-180, 180]: what interpolation through matrix decomposition sees. */
function matrixAngle(deg: number): number {
  let r = fmod(deg, 360);
  if (r > 180) r = r - 360;
  if (r <= -180) r = r + 360;
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------
// Colours: legacy sRGB, premultiplied.

/** A blink::Color in legacy sRGB: channels 0 to 255 and alpha 0 to 1, all floats. */
export type LegacyColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
};

export function legacyColor(r: number, g: number, b: number, alpha: number): LegacyColor {
  const a = froundOf(alpha);
  return { r: froundOf(r), g: froundOf(g), b: froundOf(b), alpha: a < 0 ? 0 : a > 1 ? 1 : a };
}

/** The Color Blink's parser builds from legacy rgb()/rgba(): channels clamped to [0, 255], alpha quantised to 8 bits. */
export function legacyColorFromCss(r: number, g: number, b: number, alpha: number): LegacyColor {
  const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return legacyColor(clamp255(r), clamp255(g), clamp255(b), roundOf(a * 255.0) / 255.0);
}

export const TRANSPARENT: LegacyColor = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * InterpolableColor: premultiply (float products), interpolate each channel in double, then Resolve: clamp alpha to [0, 1];
 * at alpha 0 keep the premultiplied channels, else unpremultiply; the Color narrows to float.
 */
export function interpolateColor(from: LegacyColor, to: LegacyColor, progress: number, faults: RtFaults): LegacyColor {
  const pre = !faults.colorUnpremultiplied;
  const fr = pre ? froundOf(from.r * from.alpha) : from.r;
  const fg = pre ? froundOf(from.g * from.alpha) : from.g;
  const fb = pre ? froundOf(from.b * from.alpha) : from.b;
  const tr = pre ? froundOf(to.r * to.alpha) : to.r;
  const tg = pre ? froundOf(to.g * to.alpha) : to.g;
  const tb = pre ? froundOf(to.b * to.alpha) : to.b;
  const r = interpolateNumber(fr, tr, progress);
  const g = interpolateNumber(fg, tg, progress);
  const b = interpolateNumber(fb, tb, progress);
  const rawAlpha = interpolateNumber(from.alpha, to.alpha, progress);
  const alpha = rawAlpha < 0 ? 0 : rawAlpha > 1 ? 1 : rawAlpha;
  if (alpha === 0 || !pre) return { r: froundOf(r), g: froundOf(g), b: froundOf(b), alpha: froundOf(alpha) };
  return { r: froundOf(r / alpha), g: froundOf(g / alpha), b: froundOf(b / alpha), alpha: froundOf(alpha) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Transform lists.

export type TransformFn = 'translate' | 'translateX' | 'translateY' | 'rotate' | 'scale' | 'scaleX' | 'scaleY';

/** One 2D transform function. translate* use x and y; rotate uses angle (deg); scale* use sx and sy. */
export type TransformOp = {
  readonly fn: TransformFn;
  readonly x: LengthValue;
  readonly y: LengthValue;
  readonly angle: number;
  readonly sx: number;
  readonly sy: number;
};

export function translateOp(fn: TransformFn, x: LengthValue, y: LengthValue): TransformOp {
  return { fn, x, y, angle: 0, sx: 1, sy: 1 };
}

export function rotateOp(deg: number): TransformOp {
  return { fn: 'rotate', x: ZERO_PX, y: ZERO_PX, angle: deg, sx: 1, sy: 1 };
}

export function scaleOp(fn: TransformFn, sx: number, sy: number): TransformOp {
  return { fn, x: ZERO_PX, y: ZERO_PX, angle: 0, sx, sy };
}

/** The result of interpolating two lists: `refused` when the lists need matrix interpolation (package ANIM-m). */
export type TransformBlend = {
  readonly refused: boolean;
  readonly ops: readonly TransformOp[];
};

function family(fn: TransformFn): string {
  if (fn === 'translate' || fn === 'translateX' || fn === 'translateY') return 'translate';
  if (fn === 'scale' || fn === 'scaleX' || fn === 'scaleY') return 'scale';
  return 'rotate';
}

function blendOp(from: TransformOp | null, to: TransformOp | null, progress: number, faults: RtFaults): TransformOp {
  if (to !== null && from !== null) {
    if (family(to.fn) === 'translate') return translateOp(to.fn, blendLength(to.x, from.x, progress), blendLength(to.y, from.y, progress));
    if (family(to.fn) === 'scale') return scaleOp(to.fn, blendDouble(from.sx, to.sx, progress), blendDouble(from.sy, to.sy, progress));
    return rotateOp(interpolateAngle(from.angle, to.angle, progress, faults));
  }
  if (to !== null) {
    // Blend from the identity function of the same type (css-transforms-1 §9: none becomes identity functions).
    if (family(to.fn) === 'translate') return translateOp(to.fn, blendLength(to.x, ZERO_PX, progress), blendLength(to.y, ZERO_PX, progress));
    if (family(to.fn) === 'scale') return scaleOp(to.fn, blendDouble(1.0, to.sx, progress), blendDouble(1.0, to.sy, progress));
    return rotateOp(to.angle * progress);
  }
  if (from === null) throw new Error('blendOp needs at least one operation');
  if (family(from.fn) === 'translate') return translateOp(from.fn, blendLength(ZERO_PX, from.x, progress), blendLength(ZERO_PX, from.y, progress));
  if (family(from.fn) === 'scale') return scaleOp(from.fn, blendDouble(from.sx, 1.0, progress), blendDouble(from.sy, 1.0, progress));
  return rotateOp(from.angle * (1 - progress));
}

/** TransformOperations::Blend: pairwise by matching prefix, the shorter list padded with identity functions. */
export function interpolateTransform(from: readonly TransformOp[], to: readonly TransformOp[], progress: number, faults: RtFaults): TransformBlend {
  if (from.length === 0 && to.length === 0) return { refused: false, ops: to };
  const n = from.length > to.length ? from.length : to.length;
  const out: TransformOp[] = [];
  for (let i = 0; i < n; i++) {
    const f = i < from.length ? from[i] : undefined;
    const t = i < to.length ? to[i] : undefined;
    const fo = f === undefined ? null : f;
    const tt = t === undefined ? null : t;
    if (fo !== null && tt !== null && family(fo.fn) !== family(tt.fn)) return { refused: true, ops: [] };
    out.push(blendOp(fo, tt, progress, faults));
  }
  return { refused: false, ops: out };
}

// ---------------------------------------------------------------------------------------------------------------------
// gfx::Transform, 2D: an axis-aligned float form until a rotation needs the double matrix.

/** Math.sin and Math.cos from the platform: the subset has no trigonometry (T047 RT-4). */
export type Trig = {
  readonly sin: (radians: number) => number;
  readonly cos: (radians: number) => number;
};

/** A 2D affine matrix [a c e; b d f]. While `full` is false, a and d are float scales and e and f float translations. */
export type Matrix2D = {
  readonly full: boolean;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export const IDENTITY_MATRIX: Matrix2D = { full: false, a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const PI = 3.141592653589793;
const SQRT2_OVER_2 = 0.7071067811865476;

function bitOf(n: number, k: number): number {
  let p = 1;
  for (let i = 0; i < k; i++) p = p * 2;
  const q = floorOf(n / p);
  return q - floorOf(q / 2) * 2;
}

/** gfx::SinCosDegrees: exact at multiples of 45 degrees, else range-reduced to [0, 45] before sin and cos. */
export type SinCos = {
  readonly sin: number;
  readonly cos: number;
};

export function sinCosDegrees(degrees: number, trig: Trig): SinCos {
  if (degrees > -90000000.0 && degrees < 90000000.0) {
    const n45 = degrees / 45.0;
    let octant = truncOf(n45);
    if (octant === n45) {
      const k = octant - floorOf(octant / 8) * 8;
      if (k === 0) return { sin: 0, cos: 1 };
      if (k === 1) return { sin: SQRT2_OVER_2, cos: SQRT2_OVER_2 };
      if (k === 2) return { sin: 1, cos: 0 };
      if (k === 3) return { sin: SQRT2_OVER_2, cos: -SQRT2_OVER_2 };
      if (k === 4) return { sin: 0, cos: -1 };
      if (k === 5) return { sin: -SQRT2_OVER_2, cos: -SQRT2_OVER_2 };
      if (k === 6) return { sin: -1, cos: 0 };
      return { sin: -SQRT2_OVER_2, cos: SQRT2_OVER_2 };
    }
    if (degrees < 0) octant = octant - 1;
    let reduced = degrees - octant * 45.0;
    if (bitOf(octant, 0) === 1) reduced = 45.0 - reduced;
    const rad = (reduced * PI) / 180;
    let s = trig.sin(rad);
    let c = trig.cos(rad);
    if (bitOf(octant + 1, 1) === 1) {
      const t = s;
      s = c;
      c = t;
    }
    if (bitOf(octant, 2) === 1) s = -s;
    if (bitOf(octant + 2, 2) === 1) c = -c;
    return { sin: s, cos: c };
  }
  const rad = (fmod(degrees, 360.0) * PI) / 180;
  return { sin: trig.sin(rad), cos: trig.cos(rad) };
}

function translateMatrix(m: Matrix2D, x: number, y: number): Matrix2D {
  if (!m.full) return { full: false, a: m.a, b: 0, c: 0, d: m.d, e: froundOf(m.e + froundOf(x * m.a)), f: froundOf(m.f + froundOf(y * m.d)) };
  return { full: true, a: m.a, b: m.b, c: m.c, d: m.d, e: m.a * x + m.c * y + m.e, f: m.b * x + m.d * y + m.f };
}

function scaleMatrix(m: Matrix2D, x: number, y: number): Matrix2D {
  if (!m.full) return { full: false, a: froundOf(m.a * x), b: 0, c: 0, d: froundOf(m.d * y), e: m.e, f: m.f };
  return { full: true, a: m.a * x, b: m.b * x, c: m.c * y, d: m.d * y, e: m.e, f: m.f };
}

function rotateMatrix(m: Matrix2D, degrees: number, trig: Trig): Matrix2D {
  const sc = sinCosDegrees(degrees, trig);
  if (sc.sin === 0 && sc.cos === 1) return m;
  return {
    full: true,
    a: m.a * sc.cos + m.c * sc.sin,
    b: m.b * sc.cos + m.d * sc.sin,
    c: m.c * sc.cos - m.a * sc.sin,
    d: m.d * sc.cos - m.b * sc.sin,
    e: m.e,
    f: m.f,
  };
}

/** ComputedStyle::ApplyTransform over the functions (transform-origin excluded), against a float border-box size. */
export function transformMatrix(ops: readonly TransformOp[], boxWidth: number, boxHeight: number, trig: Trig): Matrix2D {
  let m = IDENTITY_MATRIX;
  for (const op of ops) {
    const fam = family(op.fn);
    if (fam === 'translate') m = translateMatrix(m, resolveLength(op.x, froundOf(boxWidth)), resolveLength(op.y, froundOf(boxHeight)));
    else if (fam === 'scale') m = scaleMatrix(m, froundOf(op.sx), froundOf(op.sy));
    else m = rotateMatrix(m, op.angle, trig);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// Exact decimal formatting. Blink prints CSS numbers with "%.6g" (CSSNumericLiteralValue) and colour alpha with
// double-conversion's ToPrecision; both round the exact binary value, so the digits come from exact integer arithmetic.

function digitChar(d: number): string {
  if (d === 0) return '0';
  if (d === 1) return '1';
  if (d === 2) return '2';
  if (d === 3) return '3';
  if (d === 4) return '4';
  if (d === 5) return '5';
  if (d === 6) return '6';
  if (d === 7) return '7';
  if (d === 8) return '8';
  return '9';
}

/** The decimal text of a non-negative integer below 2^53. */
export function intToString(v: number): string {
  if (v < 10) return digitChar(v);
  const q = floorOf(v / 10);
  return intToString(q) + digitChar(v - q * 10);
}

/** Digits (little-endian, base 10) of a non-negative integer below 2^53. */
function integerDigits(v: number): number[] {
  const out: number[] = [];
  let m = v;
  while (m > 0) {
    let q = floorOf(m / 10);
    let d = m - q * 10;
    if (d < 0) {
      q = q - 1;
      d = d + 10;
    }
    if (d >= 10) {
      q = q + 1;
      d = d - 10;
    }
    out.push(d);
    m = q;
  }
  return out;
}

function multiplySmall(digits: number[], factor: number): number[] {
  const out: number[] = [];
  let carry = 0;
  for (const d of digits) {
    const t = d * factor + carry;
    const q = floorOf(t / 10);
    out.push(t - q * 10);
    carry = q;
  }
  while (carry > 0) {
    const q = floorOf(carry / 10);
    out.push(carry - q * 10);
    carry = q;
  }
  return out;
}

/** The exact decimal expansion of a finite v > 0: big-endian digits with no leading zero, and the power of ten of the first. */
type Decimal = {
  readonly digits: readonly number[];
  readonly exponent: number;
};

function exactDecimal(v: number): Decimal {
  let m = v;
  let e2 = 0;
  while (m !== floorOf(m)) {
    m = m * 2;
    e2 = e2 - 1;
  }
  while (m >= 9007199254740992) {
    m = m / 2;
    e2 = e2 + 1;
  }
  let digits = integerDigits(m);
  let fraction = 0;
  if (e2 >= 0) {
    for (let i = 0; i < e2; i++) digits = multiplySmall(digits, 2);
  } else {
    for (let i = 0; i < -e2; i++) digits = multiplySmall(digits, 5);
    fraction = -e2;
  }
  const big = digits.slice(0).reverse();
  return { digits: big, exponent: big.length - 1 - fraction };
}

/** v > 0 rounded to `precision` significant digits; ties go to even (printf) or away from zero (ToPrecision). */
function roundSignificant(v: number, precision: number, tiesToEven: boolean): Decimal {
  const dec = exactDecimal(v);
  const keep: number[] = [];
  for (let i = 0; i < precision; i++) {
    const d = dec.digits[i];
    keep.push(d === undefined ? 0 : d);
  }
  if (dec.digits.length <= precision) return { digits: keep, exponent: dec.exponent };
  const first = dec.digits[precision];
  let restNonZero = false;
  for (let i = precision + 1; i < dec.digits.length; i++) {
    const d = dec.digits[i];
    if (d !== undefined && d !== 0) restNonZero = true;
  }
  const firstDropped = first === undefined ? 0 : first;
  const last = keep[precision - 1];
  const lastKept = last === undefined ? 0 : last;
  let up = false;
  if (firstDropped > 5) up = true;
  else if (firstDropped === 5) up = restNonZero || !tiesToEven || lastKept - floorOf(lastKept / 2) * 2 === 1;
  if (!up) return { digits: keep, exponent: dec.exponent };
  const rounded: number[] = [];
  let carry = 1;
  for (let i = precision - 1; i >= 0; i--) {
    const d = keep[i];
    const t = (d === undefined ? 0 : d) + carry;
    if (t === 10) {
      rounded.push(0);
      carry = 1;
    } else {
      rounded.push(t);
      carry = 0;
    }
  }
  if (carry === 1) {
    const grown: number[] = [1];
    for (let i = 0; i < precision - 1; i++) grown.push(0);
    return { digits: grown, exponent: dec.exponent + 1 };
  }
  return { digits: rounded.reverse(), exponent: dec.exponent };
}

function joinDigits(digits: readonly number[], from: number, to: number): string {
  let s = '';
  for (let i = from; i < to; i++) {
    const d = digits[i];
    s = s + digitChar(d === undefined ? 0 : d);
  }
  return s;
}

function lastNonZero(digits: readonly number[]): number {
  let last = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits[i];
    if (d !== undefined && d !== 0) last = i;
  }
  return last;
}

/** C printf("%.<precision>g"): trailing zeros removed, exponent with a sign and at least two digits. */
export function formatG(v: number, precision: number): string {
  if (v === 0) return '0';
  if (v < 0) return '-' + formatG(-v, precision);
  const r = roundSignificant(v, precision, true);
  const x = r.exponent;
  const end = lastNonZero(r.digits) + 1;
  if (x < -4 || x >= precision) {
    const mantissa = end > 1 ? joinDigits(r.digits, 0, 1) + '.' + joinDigits(r.digits, 1, end) : joinDigits(r.digits, 0, 1);
    const ax = x < 0 ? -x : x;
    return mantissa + 'e' + (x < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + intToString(ax);
  }
  if (x < 0) {
    let zeros = '';
    for (let i = 0; i < -x - 1; i++) zeros = zeros + '0';
    return '0.' + zeros + joinDigits(r.digits, 0, end);
  }
  const intPart = joinDigits(r.digits, 0, x + 1);
  if (end <= x + 1) return intPart;
  return intPart + '.' + joinDigits(r.digits, x + 1, end);
}

/** String::Number(v, precision): double-conversion ToPrecision (ties away from zero), trailing zeros truncated. */
export function formatPrecision(v: number, precision: number): string {
  if (v === 0) return '0';
  if (v < 0) return '-' + formatPrecision(-v, precision);
  const r = roundSignificant(v, precision, false);
  const x = r.exponent;
  const end = lastNonZero(r.digits) + 1;
  if (x < -6 || x >= precision) {
    const mantissa = precision > 1 ? joinDigits(r.digits, 0, 1) + '.' + joinDigits(r.digits, 1, precision) : joinDigits(r.digits, 0, 1);
    return mantissa + 'e' + (x < 0 ? '-' : '+') + intToString(x < 0 ? -x : x);
  }
  if (x < 0) {
    let zeros = '';
    for (let i = 0; i < -x - 1; i++) zeros = zeros + '0';
    return '0.' + zeros + joinDigits(r.digits, 0, end);
  }
  const intPart = joinDigits(r.digits, 0, x + 1);
  if (end <= x + 1) return intPart;
  return intPart + '.' + joinDigits(r.digits, x + 1, end);
}

/** CSSNumericLiteralValue::CustomCSSText for a number with a unit suffix ('' for a plain number). */
export function formatCssNumber(v: number, unit: string): string {
  if (Number.isNaN(v)) return unit === '' ? 'NaN' : 'NaN * 1' + unit;
  if (v === INFINITY) return unit === '' ? 'infinity' : 'infinity * 1' + unit;
  if (v === -INFINITY) return unit === '' ? '-infinity' : '-infinity * 1' + unit;
  if (v < -999999 || v > 999999 || truncOf(v) !== v) return formatG(v, 6) + unit;
  const i = truncOf(v);
  return (i < 0 ? '-' + intToString(-i) : intToString(i)) + unit;
}

// ---------------------------------------------------------------------------------------------------------------------
// Computed-value serialisers (getComputedStyle strings).

export function serializeNumber(v: number): string {
  return formatCssNumber(v, '');
}

export function serializeAngle(deg: number): string {
  return formatCssNumber(deg, 'deg');
}

export function serializeLength(l: LengthValue): string {
  if (l.kind === 'px') return formatCssNumber(l.px, 'px');
  if (l.kind === 'percent') return formatCssNumber(l.percent, '%');
  const pct = formatCssNumber(l.percent, '%');
  if (l.px < 0) return 'calc(' + pct + ' - ' + formatCssNumber(-l.px, 'px') + ')';
  return 'calc(' + pct + ' + ' + formatCssNumber(l.px, 'px') + ')';
}

function roundHalfAway(v: number): number {
  return v < 0 ? -floorOf(-v + 0.5) : floorOf(v + 0.5);
}

function channel(v: number): string {
  const c = v < 0 ? 0 : v > 255 ? 255 : v;
  return intToString(roundOf(c));
}

/** Color::SerializeLegacyColorAsCSSColor. */
export function serializeColor(c: LegacyColor): string {
  const opaque = c.alpha >= 1;
  const head = (opaque ? 'rgb(' : 'rgba(') + channel(c.r) + ', ' + channel(c.g) + ', ' + channel(c.b);
  if (opaque) return head + ')';
  const eps = froundOf(1e-7);
  const scaled = roundHalfAway(froundOf(c.alpha + eps) * 255.0);
  const intAlpha = scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
  const two = froundOf(roundHalfAway((intAlpha * 100.0) / 255.0) / 100.0);
  if (roundHalfAway(froundOf(two * 255)) === intAlpha) return head + ', ' + formatPrecision(two, 2) + ')';
  const three = froundOf(roundHalfAway((intAlpha * 1000.0) / 255.0) / 1000.0);
  return head + ', ' + formatPrecision(three, 3) + ')';
}

/** ComputedStyleUtils::ValueForTransform for a 2D matrix at zoom 1. */
export function serializeMatrix(m: Matrix2D): string {
  return 'matrix(' + serializeNumber(m.a) + ', ' + serializeNumber(m.b) + ', ' + serializeNumber(m.c) + ', ' + serializeNumber(m.d) + ', ' + serializeNumber(m.e) + ', ' + serializeNumber(m.f) + ')';
}

/** getComputedStyle(el).transform: 'none' for an empty list, else the resolved matrix. */
export function serializeTransform(ops: readonly TransformOp[], boxWidth: number, boxHeight: number, trig: Trig): string {
  if (ops.length === 0) return 'none';
  return serializeMatrix(transformMatrix(ops, boxWidth, boxHeight, trig));
}

// ---------------------------------------------------------------------------------------------------------------------
// One animated value of any supported kind.

/** A computed value: `kind` picks the field (opacity uses `number`, the rotate property `number` in degrees). */
export type AnimatedValue = {
  readonly kind: 'opacity' | 'length' | 'angle' | 'color' | 'transform';
  readonly number: number;
  readonly length: LengthValue;
  readonly color: LegacyColor;
  readonly ops: readonly TransformOp[];
};

/** An interpolation result; `refused` when the pair needs matrix interpolation (ANIM-m) or mixes kinds. */
export type InterpolatedValue = {
  readonly refused: boolean;
  readonly value: AnimatedValue;
};

export function interpolateValue(from: AnimatedValue, to: AnimatedValue, progress: number, faults: RtFaults): InterpolatedValue {
  if (from.kind !== to.kind) return { refused: true, value: from };
  const base: AnimatedValue = { kind: from.kind, number: 0, length: ZERO_PX, color: TRANSPARENT, ops: [] };
  if (from.kind === 'opacity') return { refused: false, value: { kind: base.kind, number: interpolateOpacity(from.number, to.number, progress), length: base.length, color: base.color, ops: base.ops } };
  if (from.kind === 'length') return { refused: false, value: { kind: base.kind, number: 0, length: interpolateLengthProperty(from.length, to.length, progress), color: base.color, ops: base.ops } };
  if (from.kind === 'angle') return { refused: false, value: { kind: base.kind, number: interpolateAngle(from.number, to.number, progress, faults), length: base.length, color: base.color, ops: base.ops } };
  if (from.kind === 'color') return { refused: false, value: { kind: base.kind, number: 0, length: base.length, color: interpolateColor(from.color, to.color, progress, faults), ops: base.ops } };
  const t = interpolateTransform(from.ops, to.ops, progress, faults);
  return { refused: t.refused, value: { kind: base.kind, number: 0, length: base.length, color: base.color, ops: t.ops } };
}

/** The getComputedStyle string of a value on an element with the given float border-box size. */
export function serializeValue(v: AnimatedValue, boxWidth: number, boxHeight: number, trig: Trig): string {
  if (v.kind === 'opacity') return serializeNumber(v.number);
  if (v.kind === 'length') return serializeLength(v.length);
  if (v.kind === 'angle') return serializeAngle(v.number);
  if (v.kind === 'color') return serializeColor(v.color);
  return serializeTransform(v.ops, boxWidth, boxHeight, trig);
}

// ---------------------------------------------------------------------------------------------------------------------
// Value ranges (T065 R13; Chrome measurement M26): InterpolableLength::CreateLength clamps a px or % result of a
// non-negative property (padding, width, height, min/max sizes, gaps) at 0. Margins and insets take every value.

export type ValueRange = 'all' | 'non-negative';

/** A length-percentage property at progress, clamped to its value range; a mixed calc() keeps its range for use time. */
export function interpolateLengthInRange(from: LengthValue, to: LengthValue, progress: number, range: ValueRange, faults: RtFaults): LengthValue {
  const clamp = range === 'non-negative' && !faults.nonNegativeUnclamped;
  const hasPercentage = from.kind !== 'px' || to.kind !== 'px';
  const pixels = blendDouble(from.px, to.px, progress);
  const percentage = blendDouble(from.percent, to.percent, progress);
  if (pixels !== 0 && hasPercentage) return { kind: 'calc', px: froundOf(pixels), percent: froundOf(percentage) };
  if (hasPercentage) return { kind: 'percent', px: 0, percent: froundOf(clamp && percentage < 0 ? 0 : percentage) };
  return { kind: 'px', px: froundOf(clamp && pixels < 0 ? 0 : pixels), percent: 0 };
}

/** interpolateValue with the property's value range applied to lengths (opacity and colour channels always clamp). */
export function interpolateValueInRange(from: AnimatedValue, to: AnimatedValue, progress: number, range: ValueRange, faults: RtFaults): InterpolatedValue {
  if (from.kind !== 'length' || to.kind !== 'length') return interpolateValue(from, to, progress, faults);
  const length = interpolateLengthInRange(from.length, to.length, progress, range, faults);
  return { refused: false, value: { kind: 'length', number: 0, length, color: TRANSPARENT, ops: [] } };
}
