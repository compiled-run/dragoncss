// COL4: Chrome 145's colour model for colour functions (color-mix(), relative colours, hwb(), lab(), lch(), oklab(), oklch() and
// color()). Color in third_party/blink/renderer/platform/graphics/color.cc keeps three float32 parameters and an alpha in a colour
// space, and converts between spaces with ui/gfx/color_conversions.cc, skia/ext/skcms_ext.cc and the matrix helpers of
// third_party/skia/modules/skcms/skcms.cc, using the constants of third_party/skia/include/core/SkColorSpace.h. Chromium builds with
// -ffp-contract=off, so every float32 step below rounds on its own (f32). With css/color.ts, the only core file that converts or
// rounds colours.

const f32 = Math.fround;

/** Blink's Color::ColorSpace; 'rgb' is kSRGBLegacy (rgb(), hex and named colours, channels 0-255). */
export type ColorSpace =
  | 'rgb' | 'hsl' | 'hwb' | 'srgb' | 'srgb-linear' | 'display-p3' | 'display-p3-linear' | 'a98-rgb' | 'prophoto-rgb' | 'rec2020' | 'xyz-d50' | 'xyz-d65'
  | 'lab' | 'oklab' | 'lch' | 'oklch';

export type HueMethod = 'shorter' | 'longer' | 'increasing' | 'decreasing';

type Matrix = readonly [number, number, number, number, number, number, number, number, number];
type Vec = [number, number, number];
type TransferFn = { readonly g: number; readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number };

// ---------------------------------------------------------------------------------------------------------------------
// skcms matrices (skcms.cc skcms_Matrix3x3_invert, skcms_Matrix3x3_concat, skcms_AdaptToXYZD50, skcms_PrimariesToXYZD50) and
// skcms_ext.cc Matrix3x3_apply.

/** Matrix3x3_apply: each row's three products summed left to right in float32. */
function apply(m: Matrix, v: readonly number[]): Vec {
  const row = (r: number): number => f32(f32(f32(m[r * 3]! * v[0]!) + f32(m[r * 3 + 1]! * v[1]!)) + f32(m[r * 3 + 2]! * v[2]!));
  return [row(0), row(1), row(2)];
}

/** skcms_Matrix3x3_invert: the cofactor inverse in double, each entry cast back to float32. */
function invert(src: Matrix): Matrix {
  const [a00, a10, a20, a01, a11, a21, a02, a12, a22] = src;
  let b0 = a00 * a11 - a01 * a10;
  let b1 = a00 * a12 - a02 * a10;
  let b2 = a01 * a12 - a02 * a11;
  let b3 = a20;
  let b4 = a21;
  let b5 = a22;
  const invdet = 1 / (b0 * b5 - b1 * b4 + b2 * b3);
  b0 *= invdet;
  b1 *= invdet;
  b2 *= invdet;
  b3 *= invdet;
  b4 *= invdet;
  b5 *= invdet;
  return [
    f32(a11 * b5 - a12 * b4), f32(a12 * b3 - a10 * b5), f32(a10 * b4 - a11 * b3),
    f32(a02 * b4 - a01 * b5), f32(a00 * b5 - a02 * b3), f32(a01 * b3 - a00 * b4),
    f32(b2), f32(-b1), f32(b0),
  ];
}

function concat(a: Matrix, b: Matrix): Matrix {
  const at = (r: number, c: number): number => f32(f32(f32(a[r * 3]! * b[c]!) + f32(a[r * 3 + 1]! * b[3 + c]!)) + f32(a[r * 3 + 2]! * b[6 + c]!));
  return [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1), at(2, 2)];
}

const fm = (v: readonly number[]): Matrix => v.map(f32) as unknown as Matrix;
const diagonal = (v: readonly number[]): Matrix => [v[0]!, 0, 0, 0, v[1]!, 0, 0, 0, v[2]!];

/** skcms_AdaptToXYZD50: the Bradford adaptation from white point (wx, wy) to D50. */
function adaptToXYZD50(wx: number, wy: number): Matrix {
  const white = [f32(wx / wy), 1, f32(f32(f32(1 - wx) - wy) / wy)];
  const d50 = fm([0.96422, 1, 0.82521]);
  const xyzToLms = fm([0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]);
  const lmsToXyz = fm([0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867]);
  const src = apply(xyzToLms, white);
  const dst = apply(xyzToLms, d50);
  const scale = diagonal([f32(dst[0] / src[0]), f32(dst[1] / src[1]), f32(dst[2] / src[2])]);
  return concat(lmsToXyz, concat(scale, xyzToLms));
}

/** skcms_PrimariesToXYZD50. */
function primariesToXYZD50(rx: number, ry: number, gx: number, gy: number, bx: number, by: number, wx: number, wy: number): Matrix {
  const primaries: Matrix = [rx, gx, bx, ry, gy, by, f32(f32(1 - rx) - ry), f32(f32(1 - gx) - gy), f32(f32(1 - bx) - by)];
  const white = [f32(wx / wy), 1, f32(f32(f32(1 - wx) - wy) / wy)];
  const xyz = apply(invert(primaries), white);
  return concat(adaptToXYZD50(wx, wy), concat(primaries, diagonal(xyz)));
}

const fixed = (v: number): number => v / 65536;
// SkNamedGamut (SkColorSpace.h): sRGB and Adobe RGB in ICC 16.16 fixed point.
const GAMUT_SRGB: Matrix = [fixed(0x6fa2), fixed(0x6299), fixed(0x24a0), fixed(0x38f5), fixed(0xb785), fixed(0x0f84), fixed(0x0390), fixed(0x18da), fixed(0xb6cf)];
const GAMUT_ADOBE: Matrix = [fixed(0x9c18), fixed(0x348d), fixed(0x2631), fixed(0x4fa5), fixed(0xa02c), fixed(0x102f), fixed(0x04fc), fixed(0x0f95), fixed(0xbe9c)];
const GAMUT_P3 = fm([0.515102, 0.291965, 0.157153, 0.241182, 0.692236, 0.0665819, -0.00104941, 0.0418818, 0.784378]);
const GAMUT_REC2020 = fm([0.673459, 0.165661, 0.1251, 0.279033, 0.675338, 0.0456288, -0.00193139, 0.0299794, 0.797162]);
const GAMUT_XYZ: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const D65_TO_D50 = adaptToXYZD50(f32(0.3127), f32(0.329));
const GAMUT_PROPHOTO = primariesToXYZD50(f32(0.7347), f32(0.2653), f32(0.1596), f32(0.8404), f32(0.0366), f32(0.0001), f32(0.34567), f32(0.3585));
// color_conversions.cc kXYZD65_to_LMS and kOklab_to_LMS.
const XYZD65_TO_LMS = fm([0.8190224432164319, 0.3619062562801221, -0.12887378261216414, 0.0329836671980271, 0.9292868468965546, 0.03614466816999844, 0.048177199566046255, 0.26423952494422764, 0.6335478258136937]);
const OKLAB_TO_LMS = fm([0.99999999845051981432, 0.39633779217376785678, 0.21580375806075880339, 1.0000000088817607767, -0.1055613423236563494, -0.063854174771705903402, 1.0000000546724109177, -0.089484182094965759684, -1.2914855378640917399]);

const isIdentity = (m: Matrix): boolean => m.every((v, i) => v === GAMUT_XYZ[i]);
/** Matrix3x3_apply_inverse: the identity passes through; anything else is inverted, then applied. */
const applyInverse = (m: Matrix, v: readonly number[]): Vec => (isIdentity(m) ? [v[0]!, v[1]!, v[2]!] : apply(invert(m), v));

// ---------------------------------------------------------------------------------------------------------------------
// Transfer functions. SkNamedTransferFn (SkColorSpace.h) and skcms_ext.cc TransferFunction_eval and TransferFunction_invert, which
// use the C library's powf (std::pow on floats).

const tf = (g: number, a: number, b: number, c: number, d: number, e: number, f: number): TransferFn => ({ g: f32(g), a: f32(a), b: f32(b), c: f32(c), d: f32(d), e: f32(e), f: f32(f) });
const TF_SRGB = tf(2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045, 0, 0);
const TF_2DOT2 = tf(2.2, 1, 0, 0, 0, 0, 0);
const TF_REC2020 = tf(2.22222, 0.909672, 0.0903276, 0.222222, 0.0812429, 0, 0);
const TF_PROPHOTO = tf(1.8, 1, 0, 0, 0, 0, 0);
const TF_LINEAR = tf(1, 1, 0, 0, 0, 0, 0);

const powf = (x: number, y: number): number => f32(Math.pow(x, y));
const sameTf = (x: TransferFn, y: TransferFn): boolean => x.a === y.a && x.b === y.b && x.c === y.c && x.d === y.d && x.e === y.e && x.f === y.f && x.g === y.g;

function evalTf(fn: TransferFn, x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  if (ax <= fn.d) return f32(sign * f32(f32(fn.c * ax) + fn.f));
  const base = Math.max(f32(f32(fn.a * ax) + fn.b), 0);
  if (fn.g === 1) return f32(sign * f32(base + fn.e));
  return f32(sign * f32(powf(base, fn.g) + fn.e));
}

function invertTf(src: TransferFn): TransferFn {
  const inv = { g: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  inv.d = f32(f32(src.c * src.d) + src.f);
  if (inv.d > 0) {
    inv.c = f32(1 / src.c);
    inv.f = f32(-src.f / src.c);
  }
  const k = powf(src.a, -src.g);
  inv.g = f32(1 / src.g);
  inv.a = k;
  inv.b = f32(-k * src.e);
  inv.e = f32(-src.b / src.a);
  if (f32(f32(inv.a * inv.d) + inv.b) < 0) inv.b = f32(-inv.a * inv.d);
  let s = evalTf(src, 1);
  const sign = s < 0 ? -1 : 1;
  s = f32(s * sign);
  if (s < inv.d) inv.f = f32(1 - f32(f32(sign * inv.c) * s));
  else inv.e = f32(1 - f32(sign * powf(f32(f32(inv.a * s) + inv.b), inv.g)));
  return inv;
}

const applyTf = (fn: TransferFn, v: readonly number[]): Vec => [evalTf(fn, v[0]!), evalTf(fn, v[1]!), evalTf(fn, v[2]!)];
const applyTfInverse = (fn: TransferFn, v: readonly number[]): Vec => (sameTf(fn, TF_LINEAR) ? [v[0]!, v[1]!, v[2]!] : applyTf(invertTf(fn), v));

// skcms.cc's own approximations (log2f_, exp2f_, powf_), which skcms_TransferFunction_eval and skcms_TransferFunction_invert use;
// Color::ToSRGB calls those for srgb-linear.
const bits = new DataView(new ArrayBuffer(4));
const floatBits = (x: number): number => (bits.setFloat32(0, x), bits.getInt32(0));
const bitsFloat = (i: number): number => (bits.setInt32(0, i), bits.getFloat32(0));

function log2Approx(x: number): number {
  const b = floatBits(x);
  const e = f32(f32(b) * f32(1 / (1 << 23)));
  const m = bitsFloat((b & 0x007fffff) | 0x3f000000);
  return f32(f32(f32(e - f32(124.22551499)) - f32(f32(1.498030302) * m)) - f32(f32(1.72587999) / f32(f32(0.3520887068) + m)));
}

function exp2Approx(x: number): number {
  if (x > 128) return Infinity;
  if (x < -127) return 0;
  const truncated = f32(x < 0 ? -Math.floor(-x) : Math.floor(x));
  const fract = f32(x - (truncated > x ? f32(truncated - 1) : truncated));
  const fbits = f32(f32(1 << 23) * f32(f32(f32(x + f32(121.2740575)) - f32(f32(1.49012907) * fract)) + f32(f32(27.7280233) / f32(f32(4.84252568) - fract))));
  if (fbits >= 2147483648) return Infinity;
  if (fbits < 0) return 0;
  return bitsFloat(fbits < 0 ? -Math.floor(-fbits) : Math.floor(fbits));
}

function powApprox(x: number, y: number): number {
  if (x <= 0) return 0;
  if (x === 1) return 1;
  return exp2Approx(f32(log2Approx(x) * y));
}

/** skcms_TransferFunction_eval for an sRGB-like curve. */
function skcmsEval(fn: TransferFn, x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = f32(x * sign);
  return f32(sign * (ax < fn.d ? f32(f32(fn.c * ax) + fn.f) : f32(powApprox(f32(f32(fn.a * ax) + fn.b), fn.g) + fn.e)));
}

/** skcms_TransferFunction_invert for an sRGB-like curve. */
function skcmsInvert(src: TransferFn): TransferFn {
  const inv = { g: 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  inv.d = f32(f32(src.c * src.d) + src.f);
  if (inv.d > 0) {
    inv.c = f32(1 / src.c);
    inv.f = f32(-src.f / src.c);
  }
  const k = powApprox(src.a, -src.g);
  inv.g = f32(1 / src.g);
  inv.a = k;
  inv.b = f32(-k * src.e);
  inv.e = f32(-src.b / src.a);
  if (f32(f32(inv.a * inv.d) + inv.b) < 0) inv.b = f32(-inv.a * inv.d);
  let s = skcmsEval(src, 1);
  const sign = s < 0 ? -1 : 1;
  s = f32(s * sign);
  if (s < inv.d) inv.f = f32(1 - f32(f32(sign * inv.c) * s));
  else inv.e = f32(1 - f32(sign * powApprox(f32(f32(inv.a * s) + inv.b), inv.g)));
  return inv;
}
const TF_SRGB_SKCMS_INVERSE = skcmsInvert(TF_SRGB);

/** GetSkColorSpaceParams (color.cc): the matrix to XYZ D50 and transfer function of each RGB or XYZ space. */
function rgbSpaceParams(space: ColorSpace): { readonly m: Matrix; readonly t: TransferFn } {
  switch (space) {
    case 'srgb':
      return { m: GAMUT_SRGB, t: TF_SRGB };
    case 'srgb-linear':
      return { m: GAMUT_SRGB, t: TF_LINEAR };
    case 'display-p3':
      return { m: GAMUT_P3, t: TF_SRGB };
    case 'display-p3-linear':
      return { m: GAMUT_P3, t: TF_LINEAR };
    case 'a98-rgb':
      return { m: GAMUT_ADOBE, t: TF_2DOT2 };
    case 'prophoto-rgb':
      return { m: GAMUT_PROPHOTO, t: TF_PROPHOTO };
    case 'rec2020':
      return { m: GAMUT_REC2020, t: TF_REC2020 };
    case 'xyz-d50':
      return { m: GAMUT_XYZ, t: TF_LINEAR };
    case 'xyz-d65':
      return { m: D65_TO_D50, t: TF_LINEAR };
    default:
      throw new Error(`${space} has no matrix and transfer function`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// gfx::color_conversions.cc.

const D50_X = f32(0.9642);
const D50_Z = f32(0.8251);
const PI_F = f32(Math.PI);
const ONE_THIRD = f32(1 / 3);

function labToXYZD50(l: number, a: number, b: number): Vec {
  const y = f32(f32(l + 16) / 116);
  const x = f32(y + f32(a / 500));
  const z = f32(y - f32(b / 200));
  const inverse = (t: number): number => (t <= f32(24 / 116) ? f32(f32(108 / 841) * f32(t - f32(16 / 116))) : f32(f32(t * t) * t));
  return [f32(inverse(x) * D50_X), inverse(y), f32(inverse(z) * D50_Z)];
}

function xyzD50ToLab(x: number, y: number, z: number): Vec {
  const delta = f32(24 / 116);
  const limit = f32(f32(delta * delta) * delta);
  const transfer = (t: number): number => (t <= limit ? f32(f32(f32(841 / 108) * t) + f32(16 / 116)) : powf(t, ONE_THIRD));
  const fx = transfer(f32(x / D50_X));
  const fy = transfer(y);
  const fz = transfer(f32(z / D50_Z));
  return [f32(f32(116 * fy) - 16), f32(500 * f32(fx - fy)), f32(200 * f32(fy - fz))];
}

function oklabToXYZD50(l: number, a: number, b: number): Vec {
  const lms = apply(OKLAB_TO_LMS, [l, a, b]);
  const cubed = lms.map((v) => f32(f32(v * v) * v));
  return apply(D65_TO_D50, applyInverse(XYZD65_TO_LMS, cubed));
}

function xyzD50ToOklab(x: number, y: number, z: number): Vec {
  const lmsCubed = apply(XYZD65_TO_LMS, applyInverse(D65_TO_D50, [x, y, z]));
  const lms = lmsCubed.map((v) => (v < 0 ? -powf(-v, ONE_THIRD) : powf(v, ONE_THIRD)));
  return applyInverse(OKLAB_TO_LMS, lms);
}

const degToRad = (d: number): number => f32(f32(d * PI_F) / 180);
const radToDeg = (r: number): number => f32(f32(r * 180) / PI_F);
const lchToLab = (l: number, c: number, h: number): Vec => [l, f32(c * f32(Math.cos(degToRad(h)))), f32(c * f32(Math.sin(degToRad(h))))];
const labToLch = (l: number, a: number, b: number): Vec => [l, f32(Math.sqrt(f32(f32(a * a) + f32(b * b)))), radToDeg(f32(Math.atan2(b, a)))];
const srgbToLegacy = (v: readonly number[]): Vec => [f32(v[0]! * 255), f32(v[1]! * 255), f32(v[2]! * 255)];
const legacyToSrgb = (v: readonly number[]): Vec => [f32(v[0]! / 255), f32(v[1]! / 255), f32(v[2]! / 255)];
const xyzD50ToSrgb = (v: readonly number[]): Vec => applyTfInverse(TF_SRGB, applyInverse(GAMUT_SRGB, v));
const srgbToXYZD50 = (v: readonly number[]): Vec => apply(GAMUT_SRGB, applyTf(TF_SRGB, v));

function hslToSrgb(h: number, s: number, l: number): Vec {
  if (s === 0) return [l, l, l];
  const channel = (n: number): number => {
    const k = f32(f32(n + f32(h / 30)) % 12);
    const a = f32(s * Math.min(l, f32(1 - l)));
    return f32(l - f32(a * Math.max(-1, Math.min(f32(k - 3), f32(9 - k), 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

function srgbHue(r: number, g: number, b: number, min: number, max: number): number {
  const d = f32(max - min);
  if (d === 0) return 0;
  const hue = max === r ? f32(f32(f32(g - b) / d) + (g < b ? 6 : 0)) : max === g ? f32(f32(f32(b - r) / d) + 2) : f32(f32(f32(r - g) / d) + 4);
  return f32(hue * 60);
}

function srgbToHsl(r: number, g: number, b: number): Vec {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const lightness = f32(f32(min + max) / 2);
  let hue = 0;
  let saturation = 0;
  if (f32(max - min) !== 0) {
    saturation = lightness === 0 || lightness === 1 ? 0 : f32(f32(max - lightness) / Math.min(lightness, f32(1 - lightness)));
    hue = srgbHue(r, g, b, min, max);
  }
  if (saturation < 0) {
    hue = f32(hue + 180);
    saturation = Math.abs(saturation);
  }
  if (hue >= 360) hue = f32(hue - 360);
  return [hue, saturation, lightness];
}

function hwbToSrgb(h: number, w: number, b: number): Vec {
  const sum = f32(w + b);
  if (sum >= 1) {
    const gray = f32(w / sum);
    return [gray, gray, gray];
  }
  return hslToSrgb(h, 1, 0.5).map((c) => f32(c + f32(w - f32(sum * c)))) as Vec;
}

function srgbToHwb(r: number, g: number, b: number): Vec {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  let hue = srgbHue(r, g, b, min, max);
  if (hue >= 360) hue = f32(hue - 360);
  return [hue, min, f32(1 - max)];
}

// ---------------------------------------------------------------------------------------------------------------------
// blink::Color.

const LEGACY: ReadonlySet<ColorSpace> = new Set(['rgb', 'hsl', 'hwb']);
const LIGHTNESS_FIRST: ReadonlySet<ColorSpace> = new Set(['lab', 'oklab', 'lch', 'oklch']);
const CHROMA_SECOND: ReadonlySet<ColorSpace> = new Set(['lch', 'oklch']);
const RGB_OR_XYZ: ReadonlySet<ColorSpace> = new Set(['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz-d50', 'xyz-d65', 'rgb']);
const ACHROMATIC_CHROMA = f32(0.02);
const KEPSILON = f32(1e-7);

export const isLegacySpace = (s: ColorSpace): boolean => LEGACY.has(s);
export const isLightnessFirst = (s: ColorSpace): boolean => LIGHTNESS_FIRST.has(s);
export const hasChromaSecond = (s: ColorSpace): boolean => CHROMA_SECOND.has(s);
/** AngleToUnitCircleDegrees. */
const unitCircle = (deg: number): number => f32(f32(f32(deg % 360) + 360) % 360);

/** A Blink colour: float32 parameters in a colour space, each of which (and the alpha) may be none. */
export class BlinkColor {
  space: ColorSpace;
  p: Vec;
  none: [boolean, boolean, boolean];
  alpha: number;
  alphaNone: boolean;

  private constructor(space: ColorSpace, p: Vec, none: [boolean, boolean, boolean], alpha: number, alphaNone: boolean) {
    this.space = space;
    this.p = p;
    this.none = none;
    this.alpha = alpha;
    this.alphaNone = alphaNone;
  }

  copy(): BlinkColor {
    return new BlinkColor(this.space, [...this.p], [...this.none], this.alpha, this.alphaNone);
  }

  /** Color::FromColorSpace: null is none; alpha clamps to [0, 1], lightness to its range and chroma to non-negative. */
  static of(space: ColorSpace, p0: number | null, p1: number | null, p2: number | null, alpha: number | null): BlinkColor {
    const c = new BlinkColor(space, [f32(p0 ?? 0), f32(p1 ?? 0), f32(p2 ?? 0)], [p0 === null, p1 === null, p2 === null], alpha === null ? 0 : Math.min(1, Math.max(f32(alpha), 0)), alpha === null);
    if (LIGHTNESS_FIRST.has(space) && !Number.isNaN(c.p[0])) c.p[0] = Math.min(space === 'lab' || space === 'lch' ? 100 : 1, Math.max(c.p[0], 0));
    if (CHROMA_SECOND.has(space)) c.p[1] = Math.max(c.p[1], 0);
    return c;
  }

  /** Color(RGBA32): a hex or named colour, 8-bit channels and an alpha byte over 255. */
  static rgba32(r: number, g: number, b: number, alpha8: number): BlinkColor {
    return new BlinkColor('rgb', [r, g, b], [false, false, false], f32(alpha8 / 255), false);
  }

  /** Color::ToSRGB without gamut mapping (BakedGamutMapping is disabled by default in Chrome 145). */
  toSrgb(): Vec {
    const [p0, p1, p2] = this.p;
    switch (this.space) {
      case 'srgb':
        return [p0, p1, p2];
      case 'rgb':
        return legacyToSrgb(this.p);
      case 'srgb-linear':
        return [skcmsEval(TF_SRGB_SKCMS_INVERSE, p0), skcmsEval(TF_SRGB_SKCMS_INVERSE, p1), skcmsEval(TF_SRGB_SKCMS_INVERSE, p2)];
      case 'hsl':
        return hslToSrgb(p0, p1, p2);
      case 'hwb':
        return hwbToSrgb(p0, p1, p2);
      default:
        return xyzD50ToSrgb(this.toXYZD50());
    }
  }

  toXYZD50(): Vec {
    const [p0, p1, p2] = this.p;
    switch (this.space) {
      case 'rgb':
        return srgbToXYZD50(legacyToSrgb(this.p));
      case 'lab':
        return labToXYZD50(p0, p1, p2);
      case 'oklab':
        return oklabToXYZD50(p0, p1, p2);
      case 'lch':
        return labToXYZD50(...lchToLab(p0, p1, p2));
      case 'oklch':
        return oklabToXYZD50(...lchToLab(p0, p1, p2));
      case 'hsl':
        return srgbToXYZD50(hslToSrgb(p0, p1, p2));
      case 'hwb':
        return srgbToXYZD50(hwbToSrgb(p0, p1, p2));
      default: {
        const { m, t } = rgbSpaceParams(this.space);
        return apply(m, applyTf(t, this.p));
      }
    }
  }

  private resolveMissing(): void {
    for (let i = 0; i < 3; i++) {
      if (this.none[i]) {
        this.p[i] = 0;
        this.none[i] = false;
      }
    }
  }

  /** Color::ConvertToColorSpace. */
  convert(dest: ColorSpace, resolveMissing = true): void {
    if (this.space === dest) return;
    if (resolveMissing) this.resolveMissing();
    const [p0, p1, p2] = this.p;
    switch (dest) {
      case 'xyz-d65':
      case 'xyz-d50':
      case 'srgb-linear':
      case 'display-p3':
      case 'display-p3-linear':
      case 'a98-rgb':
      case 'prophoto-rgb':
      case 'rec2020': {
        const { m, t } = rgbSpaceParams(dest);
        this.p = applyTfInverse(t, applyInverse(m, this.toXYZD50()));
        break;
      }
      case 'lab':
        this.p = this.space === 'lch' ? lchToLab(p0, p1, p2) : xyzD50ToLab(...this.toXYZD50());
        break;
      case 'oklab':
        if (this.space === 'oklch') this.p = lchToLab(p0, p1, p2);
        else this.p = xyzD50ToOklab(...this.toXYZD50());
        break;
      case 'lch':
        this.p = this.space === 'lab' ? labToLch(p0, p1, p2) : labToLch(...xyzD50ToLab(...this.toXYZD50()));
        this.p[2] = unitCircle(this.p[2]);
        if (this.p[1] <= ACHROMATIC_CHROMA) this.none[2] = true;
        break;
      case 'oklch':
        if (this.space === 'oklab') this.p = labToLch(p0, p1, p2);
        else {
          this.p = labToLch(...xyzD50ToOklab(...this.toXYZD50()));
          this.p[2] = unitCircle(this.p[2]);
        }
        if (this.p[1] <= ACHROMATIC_CHROMA) this.none[2] = true;
        break;
      case 'srgb':
        this.p = this.toSrgb();
        break;
      case 'rgb':
        this.p = srgbToLegacy(this.toSrgb());
        break;
      case 'hsl':
        this.p = srgbToHsl(...this.toSrgb());
        if (this.p[1] === 0) this.none[0] = true;
        break;
      case 'hwb':
        this.p = srgbToHwb(...this.toSrgb());
        if (f32(this.p[1] + this.p[2]) >= 1) this.none[0] = true;
        break;
    }
    this.space = dest;
  }

  /** Color::GetAnalogousMissingComponents. */
  private analogousMissing(dest: ColorSpace): [boolean, boolean, boolean] {
    const [n0, n1, n2] = this.none;
    const lab = dest === 'lab' || dest === 'oklab';
    const lch = dest === 'lch' || dest === 'oklch';
    const s = this.space;
    if (RGB_OR_XYZ.has(s)) {
      if (RGB_OR_XYZ.has(dest)) return [n0, n1, n2];
    } else if (s === 'lab' || s === 'oklab') {
      if (lab) return [n0, n1, n2];
      if (lch) return [n0, false, false];
      if (dest === 'hsl') return [false, false, n0];
    } else if (s === 'lch' || s === 'oklch') {
      if (lch) return [n0, n1, n2];
      if (dest === 'hsl') return [n2, n1, n0];
      if (lab) return [n0, false, false];
    } else if (s === 'hsl') {
      if (lch) return [n2, n1, n0];
      if (lab) return [n2, false, false];
      if (dest === 'hwb') return [n0, false, false];
    } else if (s === 'hwb') {
      if (dest === 'hsl') return [n0, false, false];
      if (lch) return [false, false, n0];
    }
    return [false, false, false];
  }

  /** Color::ConvertToColorSpaceForInterpolation: missing components carry forward to analogous ones. */
  convertForInterpolation(dest: ColorSpace): void {
    if (this.space === dest) return;
    const analogous = this.analogousMissing(dest);
    this.convert(dest);
    for (let i = 0; i < 3; i++) {
      if (analogous[i]) {
        this.p[i] = 0;
        this.none[i] = true;
      }
    }
  }

  private premultiply(): number {
    if (this.alphaNone) return this.alpha;
    const alpha = this.alpha;
    if (this.space !== 'hsl' && this.space !== 'hwb') this.p[0] = f32(this.p[0] * alpha);
    this.p[1] = f32(this.p[1] * alpha);
    if (!CHROMA_SECOND.has(this.space)) this.p[2] = f32(this.p[2] * alpha);
    this.alpha = 1;
    return alpha;
  }

  private unpremultiply(): void {
    if (this.alphaNone || this.alpha === 0) return;
    if (this.space !== 'hsl' && this.space !== 'hwb') this.p[0] = f32(this.p[0] / this.alpha);
    this.p[1] = f32(this.p[1] / this.alpha);
    if (!CHROMA_SECOND.has(this.space)) this.p[2] = f32(this.p[2] / this.alpha);
  }

  /** Color::FromColorMix: InterpolateColors, the alpha multiplier, and legacy results as color(srgb ...). */
  static mix(space: ColorSpace, hue: HueMethod, color1: BlinkColor, color2: BlinkColor, percentage: number, alphaMultiplier: number): BlinkColor {
    const a = color1.copy();
    const b = color2.copy();
    a.convertForInterpolation(space);
    b.convertForInterpolation(space);
    // SubstituteMissingParameters.
    for (let i = 0; i < 3; i++) {
      if (a.none[i] && !b.none[i]) {
        a.p[i] = b.p[i] as number;
        a.none[i] = false;
      } else if (b.none[i] && !a.none[i]) {
        b.p[i] = a.p[i] as number;
        b.none[i] = false;
      }
    }
    if (a.alphaNone && !b.alphaNone) {
      a.alpha = b.alpha;
      a.alphaNone = false;
    } else if (b.alphaNone && !a.alphaNone) {
      b.alpha = a.alpha;
      b.alphaNone = false;
    }
    const alpha1 = a.premultiply();
    const alpha2 = b.premultiply();
    const t = f32(percentage);
    const blend = (x: number, y: number): number => f32(x + f32(y - x) * t);
    const param = (i: number, isHue: boolean): number | null => (a.none[i] && b.none[i] ? null : isHue ? hueInterpolation(a.p[i] as number, b.p[i] as number, t, hue) : blend(a.p[i] as number, b.p[i] as number));
    const result = BlinkColor.of(
      space,
      param(0, space === 'hsl' || space === 'hwb'),
      param(1, false),
      param(2, CHROMA_SECOND.has(space)),
      a.alphaNone && b.alphaNone ? null : blend(alpha1, alpha2),
    );
    result.unpremultiply();
    result.alpha = f32(result.alpha * f32(alphaMultiplier));
    if (LEGACY.has(result.space)) result.convert('srgb');
    return result;
  }

  /** Every parameter and the alpha are finite numbers (calc() can make them infinite or NaN). */
  finite(): boolean {
    return this.p.every(Number.isFinite) && Number.isFinite(this.alpha);
  }

  /**
   * Color::SerializeAsCSSColor, its parameters and alpha to six significant digits; with `digits` 9 (COL4 web output), the float32
   * channels exactly, so Chrome reparses the text to the same colour and paints the same bytes (six digits can move a channel at a
   * .5 step of 255 by one) while computing it to the same six-digit text.
   */
  serialize(digits = 6): string {
    if (LEGACY.has(this.space)) {
      const [r, g, b] = this.legacyChannels();
      const opaque = this.alpha >= 1;
      return opaque ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${legacyAlphaText(this.alpha)})`;
    }
    const head = LIGHTNESS_FIRST.has(this.space) ? `${this.space}(` : `color(${this.space} `;
    const params = this.p.map((v, i) => (this.none[i] ? 'none' : paramText(v, digits))).join(' ');
    const alpha = this.alpha !== 1 || this.alphaNone ? ` / ${this.alphaNone ? 'none' : chromeFixedPrecision(this.alpha, digits)}` : '';
    return `${head}${params}${alpha})`;
  }

  /** SerializeLegacyColorAsCSSColor's channels: hsl and hwb through sRGB plus 1e-7 (crbug.com/1425856), rounded and clamped. */
  legacyChannels(): Vec {
    let [r, g, b] = this.p;
    if (this.space === 'hsl' || this.space === 'hwb') {
      const srgb = this.space === 'hsl' ? hslToSrgb(r, g, b) : hwbToSrgb(r, g, b);
      [r, g, b] = srgbToLegacy(srgb.map((v) => f32(v + KEPSILON)));
    }
    return [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v)))) as Vec;
  }

  /**
   * The 8-bit channels and alpha byte Chrome paints (toSkColor4f): sRGB clamped to [0, 1] and rounded. Probed on Chromium: a
   * color(srgb ...) colour, translucent or out of gamut, paints the same pixels as the rgba() colour of those bytes.
   */
  paintChannels(): { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number } {
    const [r, g, b] = this.toSrgb().map((v) => Math.round(f32(Math.min(1, Math.max(0, v)) * 255))) as Vec;
    return { r, g, b, alpha: Math.round(f32(this.alpha * 255)) };
  }
}

/** Color::HueInterpolation. */
function hueInterpolation(value1: number, value2: number, t: number, method: HueMethod): number {
  let v1 = value1;
  let v2 = value2;
  const diff = f32(v2 - v1);
  if (method === 'shorter') {
    if (diff > 180) v1 = f32(v1 + 360);
    else if (diff < -180) v2 = f32(v2 + 360);
  } else if (method === 'longer') {
    if (diff > 0 && diff < 180) v1 = f32(v1 + 360);
    else if (diff > -180 && diff <= 0) v2 = f32(v2 + 360);
  } else if (method === 'increasing') {
    if (v2 < v1) v2 = f32(v2 + 360);
  } else if (v1 < v2) {
    v1 = f32(v1 + 360);
  }
  return unitCircle(f32(v1 + f32(v2 - v1) * t));
}

/** The <alpha-value> of SerializeLegacyColorAsCSSColor: an 8-bit alpha, written with two decimals when they round-trip, else three. */
function legacyAlphaText(alpha: number): string {
  const int = Math.min(255, Math.max(0, Math.round(f32(alpha + KEPSILON) * 255)));
  const two = f32(Math.round((int * 100) / 255) / 100);
  if (Math.round(f32(two * 255)) === int) return chromeFixedPrecision(two, 2);
  return chromeFixedPrecision(f32(Math.round((int * 1000) / 255) / 1000), 3);
}

/** ColorParamToString: infinities and NaN as calc() (css-values-4 §10.13), anything else to six significant digits. */
function paramText(v: number, digits: number): string {
  if (Number.isNaN(v)) return 'calc(NaN)';
  if (!Number.isFinite(v)) return v < 0 ? 'calc(-infinity)' : 'calc(infinity)';
  return chromeFixedPrecision(v, digits);
}

/**
 * WTF's DoubleToStringConverter::ToStringWithFixedPrecision as Chrome 145 writes colour parameters: the value to `precision`
 * significant digits, exponential below 1e-6 or from 10^precision, trailing zeros dropped only from the fixed form (probed:
 * 1e-7 is 1.00000e-7, 1e-5 is 0.00001, 123456789 is 1.23457e+8).
 */
export function chromeFixedPrecision(v: number, precision: number): string {
  const text = v.toPrecision(precision);
  if (text.includes('e')) return text;
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}
