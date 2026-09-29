// Rounded-rect anti-aliasing as Chrome 145 rasters it on the CPU: an exact port of Skia 2ab8add5 (Chromium 145.0.7632.6
// DEPS) analytic AA for filled paths: SkScan_AntiPath.cpp AntiFillPath, SkScan_AAAPath.cpp (the additive mask, RLE and
// safe-RLE blitters, the trapezoid rows, aaa_walk_convex_edges, aaa_walk_edges), SkAnalyticEdge.cpp (lines and quads in
// SkFixed/SkFDot6, quick_inverse), SkEdgeBuilder.cpp (combineVertical, conics through SkAutoConicToQuads with tol 0.25),
// SkGeometry.cpp (computeQuadPOW2, the SK_SUPPORT_LEGACY_CONIC_CHOP chop, subdivide, SkChopQuadAtYExtrema), SkTSort.h,
// SkPathRawShapes.cpp (Rect, Oval, RRect with start indices), SkRRect.cpp setRectRadii/scaleRadii/computeType, SkDraw and
// SkCanvas rrect/DRRect dispatch, and the SkARGB32_Black_Blitter blend. On the Blink side: FloatRoundedRect ConstrainRadii,
// the SkRRect conversion, GraphicsContext FillRoundedRect/FillDRRect and the border fast path's inner rrect.
// Chromium builds with -ffp-contract=off, so every float step is its own fround. Reference only: no engine root reaches it.
import { floorOf, froundOf, roundOf, truncOf } from './rt-easing.ts';

/** Planted faults (T086); the Chrome pixel oracle must catch each one. */
export type AaFaults = {
  readonly supersampleInsteadOfAAA: boolean;
  readonly conicNotQuadded: boolean;
  readonly edgeFixedPointRounding: boolean;
  readonly rrectRadiiUnclamped: boolean;
  readonly coverageNotAccumulated: boolean;
};

export const NO_AA_FAULTS: AaFaults = { supersampleInsteadOfAAA: false, conicNotQuadded: false, edgeFixedPointRounding: false, rrectRadiiUnclamped: false, coverageNotAccumulated: false };

/** An integer device-pixel rect (SkIRect). */
export type IRect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** A float device-pixel rect (SkRect); every coordinate is a float32 value. */
export type FRect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** A corner radius (x, y) in device px, float32. */
export type Radius = { readonly x: number; readonly y: number };

/** Blink corner radii in device px (zoomed, float32), before ConstrainRadii. */
export type CornerRadii = { readonly topLeft: Radius; readonly topRight: Radius; readonly bottomRight: Radius; readonly bottomLeft: Radius };

/** Border widths in whole device px. */
export type BorderWidths = { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };

type Cell = { v: number };

/** A gray device crop (R = G = B), one cell per pixel, row-major; pixels outside it are not recorded. */
export type Device = { readonly bounds: IRect; readonly px: readonly Cell[] };

type Pt = { readonly x: number; readonly y: number };

const SK_FIXED1 = 65536;
const SK_MAX_S32 = 2147483647;
const SK_MIN_S32 = -2147483647;
const TWO_POW_31 = 2147483648;
const TWO_POW_32 = 4294967296;
const ROOT2_OVER2 = 0.7071067690849304;
const POW2: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216, 33554432, 67108864, 134217728, 268435456, 536870912, 1073741824, 2147483648, 4294967296];

// ---------------------------------------------------------------------------------------------------------------------
// 32-bit integer and float32 arithmetic.

function f32(v: number): number {
  return froundOf(v);
}

function at(xs: readonly number[], i: number): number {
  return xs[i] as number;
}

function cellAt(xs: readonly Cell[], i: number): Cell {
  const c = xs[i];
  if (c === undefined) throw new Error(`SKIA-AA: cell ${i} is outside the modelled buffer`);
  return c;
}

function cells(n: number, v: number): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) out.push({ v });
  return out;
}

function pow2(n: number): number {
  return at(POW2, n);
}

function minNum(a: number, b: number): number {
  return a < b ? a : b;
}

function maxNum(a: number, b: number): number {
  return a > b ? a : b;
}

function abs32(v: number): number {
  return v < 0 ? -v : v;
}

/** Two's-complement int32 wrap. */
function wrap32(v: number): number {
  return v - floorOf((v + TWO_POW_31) / TWO_POW_32) * TWO_POW_32 + 0;
}

/** Arithmetic right shift (>>). */
function shr(v: number, n: number): number {
  return floorOf(v / pow2(n));
}

/** SkLeftShift: the unsigned shift, wrapped to int32. */
function shl(v: number, n: number): number {
  return wrap32(v * pow2(n));
}

/** A store to uint8_t (SkAlpha). */
function u8(v: number): number {
  return v - floorOf(v / 256) * 256;
}

/** C int division (truncation toward zero); exact for |numerator| < 2^53. */
function cdiv(a: number, b: number): number {
  return truncOf(a / b);
}

function add32(a: number, b: number): number {
  return wrap32(a + b);
}

function satAdd(a: number, b: number): number {
  const s = a + b;
  return s > SK_MAX_S32 ? SK_MAX_S32 : s < SK_MIN_S32 ? SK_MIN_S32 : s;
}

function satSub(a: number, b: number): number {
  return satAdd(a, -b);
}

/** (int)x for a float in range: truncation. */
function toInt(x: number): number {
  return truncOf(x);
}

/** SkFixedMul: (int64)a * b >> 16, as a split multiply so every step is exact in a double. */
export function fixedMul(a: number, b: number): number {
  const bh = floorOf(b / SK_FIXED1);
  const bl = b - bh * SK_FIXED1;
  return wrap32(a * bh + floorOf((a * bl) / SK_FIXED1));
}

/** SkFixedDiv: (int64)numer << 16 / denom, pinned to [SK_MinS32, SK_MaxS32]. */
function fixedDiv(numer: number, denom: number): number {
  const q = cdiv(numer * SK_FIXED1, denom);
  return q > SK_MAX_S32 ? SK_MAX_S32 : q < SK_MIN_S32 ? SK_MIN_S32 : q;
}

function fixedRoundToInt(x: number): number {
  return shr(x + 32768, 16);
}

function fixedCeilToInt(x: number): number {
  return shr(x + SK_FIXED1 - 1, 16);
}

function fixedFloorToInt(x: number): number {
  return shr(x, 16);
}

function fixedRoundToFixed(x: number): number {
  return wrap32(floorOf((x + 32768) / SK_FIXED1) * SK_FIXED1);
}

function fixedCeilToFixed(x: number): number {
  return wrap32(floorOf((x + SK_FIXED1 - 1) / SK_FIXED1) * SK_FIXED1);
}

function fixedFloorToFixed(x: number): number {
  return wrap32(floorOf(x / SK_FIXED1) * SK_FIXED1);
}

function fdot6ToFixed(x: number): number {
  return shl(x, 10);
}

function fixedToFDot6(x: number): number {
  return shr(x, 10);
}

/** SkFDot6Div. */
function fdot6Div(a: number, b: number): number {
  if (a >= -32768 && a <= 32767) return cdiv(shl(a, 16), b);
  return fixedDiv(a, b);
}

/** SkCLZ for a uint32. */
function clz(x: number): number {
  let n = 32;
  let v = x;
  while (v > 0) {
    n--;
    v = floorOf(v / 2);
  }
  return n;
}

function isOdd(v: number): boolean {
  return v - floorOf(v / 2) * 2 !== 0;
}

/** The float32 value next toward zero from a positive float32 (nextafterf(x, 0)). */
function nextDown32(x: number): number {
  let p = 1;
  while (p * 2 <= x) p = p * 2;
  while (p > x) p = p / 2;
  const ulp = p / 8388608;
  return x === p ? x - ulp / 2 : x - ulp;
}

/** sqrtf: the correctly rounded float32 square root of a float32. */
export function sqrt32(x: number): number {
  if (x === 0) return 0;
  if (x < 0) throw new Error('SKIA-AA: sqrt of a negative float');
  let r = x > 1 ? x : 1;
  for (let i = 0; i < 2000; i++) {
    const n = (r + x / r) / 2;
    if (!(n < r)) break;
    r = n;
  }
  let s = f32(r);
  for (let i = 0; i < 4; i++) {
    let p = 1;
    while (p * 2 <= s) p = p * 2;
    while (p > s) p = p / 2;
    const ulp = p / 8388608;
    const up = (s + (s + ulp)) / 2;
    const down = s === p ? (s + (s - ulp / 2)) / 2 : (s + (s - ulp)) / 2;
    if (up * up < x) s = s + ulp;
    else if (down * down > x) s = s === p ? s - ulp / 2 : s - ulp;
    else break;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// SkAnalyticEdge.cpp quick_inverse and quick_div.

const INVERSE_TABLE: readonly number[] = [
  -4096, -4100, -4104, -4108, -4112, -4116, -4120, -4124, -4128, -4132, -4136, -4140, -4144, -4148,
  -4152, -4156, -4161, -4165, -4169, -4173, -4177, -4181, -4185, -4190, -4194, -4198, -4202, -4206,
  -4211, -4215, -4219, -4223, -4228, -4232, -4236, -4240, -4245, -4249, -4253, -4258, -4262, -4266,
  -4271, -4275, -4279, -4284, -4288, -4293, -4297, -4301, -4306, -4310, -4315, -4319, -4324, -4328,
  -4332, -4337, -4341, -4346, -4350, -4355, -4359, -4364, -4369, -4373, -4378, -4382, -4387, -4391,
  -4396, -4401, -4405, -4410, -4415, -4419, -4424, -4429, -4433, -4438, -4443, -4447, -4452, -4457,
  -4462, -4466, -4471, -4476, -4481, -4485, -4490, -4495, -4500, -4505, -4510, -4514, -4519, -4524,
  -4529, -4534, -4539, -4544, -4549, -4554, -4559, -4563, -4568, -4573, -4578, -4583, -4588, -4593,
  -4599, -4604, -4609, -4614, -4619, -4624, -4629, -4634, -4639, -4644, -4650, -4655, -4660, -4665,
  -4670, -4675, -4681, -4686, -4691, -4696, -4702, -4707, -4712, -4718, -4723, -4728, -4733, -4739,
  -4744, -4750, -4755, -4760, -4766, -4771, -4777, -4782, -4788, -4793, -4798, -4804, -4809, -4815,
  -4821, -4826, -4832, -4837, -4843, -4848, -4854, -4860, -4865, -4871, -4877, -4882, -4888, -4894,
  -4899, -4905, -4911, -4917, -4922, -4928, -4934, -4940, -4946, -4951, -4957, -4963, -4969, -4975,
  -4981, -4987, -4993, -4999, -5005, -5011, -5017, -5023, -5029, -5035, -5041, -5047, -5053, -5059,
  -5065, -5071, -5077, -5084, -5090, -5096, -5102, -5108, -5115, -5121, -5127, -5133, -5140, -5146,
  -5152, -5159, -5165, -5171, -5178, -5184, -5190, -5197, -5203, -5210, -5216, -5223, -5229, -5236,
  -5242, -5249, -5256, -5262, -5269, -5275, -5282, -5289, -5295, -5302, -5309, -5315, -5322, -5329,
  -5336, -5343, -5349, -5356, -5363, -5370, -5377, -5384, -5391, -5398, -5405, -5412, -5418, -5426,
  -5433, -5440, -5447, -5454, -5461, -5468, -5475, -5482, -5489, -5497, -5504, -5511, -5518, -5526,
  -5533, -5540, -5548, -5555, -5562, -5570, -5577, -5584, -5592, -5599, -5607, -5614, -5622, -5629,
  -5637, -5645, -5652, -5660, -5667, -5675, -5683, -5691, -5698, -5706, -5714, -5722, -5729, -5737,
  -5745, -5753, -5761, -5769, -5777, -5785, -5793, -5801, -5809, -5817, -5825, -5833, -5841, -5849,
  -5857, -5866, -5874, -5882, -5890, -5899, -5907, -5915, -5924, -5932, -5940, -5949, -5957, -5966,
  -5974, -5983, -5991, -6000, -6009, -6017, -6026, -6034, -6043, -6052, -6061, -6069, -6078, -6087,
  -6096, -6105, -6114, -6123, -6132, -6141, -6150, -6159, -6168, -6177, -6186, -6195, -6204, -6213,
  -6223, -6232, -6241, -6250, -6260, -6269, -6278, -6288, -6297, -6307, -6316, -6326, -6335, -6345,
  -6355, -6364, -6374, -6384, -6393, -6403, -6413, -6423, -6432, -6442, -6452, -6462, -6472, -6482,
  -6492, -6502, -6512, -6523, -6533, -6543, -6553, -6563, -6574, -6584, -6594, -6605, -6615, -6626,
  -6636, -6647, -6657, -6668, -6678, -6689, -6700, -6710, -6721, -6732, -6743, -6754, -6765, -6775,
  -6786, -6797, -6808, -6820, -6831, -6842, -6853, -6864, -6875, -6887, -6898, -6909, -6921, -6932,
  -6944, -6955, -6967, -6978, -6990, -7002, -7013, -7025, -7037, -7049, -7061, -7073, -7084, -7096,
  -7108, -7121, -7133, -7145, -7157, -7169, -7182, -7194, -7206, -7219, -7231, -7244, -7256, -7269,
  -7281, -7294, -7307, -7319, -7332, -7345, -7358, -7371, -7384, -7397, -7410, -7423, -7436, -7449,
  -7463, -7476, -7489, -7503, -7516, -7530, -7543, -7557, -7570, -7584, -7598, -7612, -7626, -7639,
  -7653, -7667, -7681, -7695, -7710, -7724, -7738, -7752, -7767, -7781, -7796, -7810, -7825, -7839,
  -7854, -7869, -7884, -7898, -7913, -7928, -7943, -7958, -7973, -7989, -8004, -8019, -8035, -8050,
  -8065, -8081, -8097, -8112, -8128, -8144, -8160, -8176, -8192, -8208, -8224, -8240, -8256, -8272,
  -8289, -8305, -8322, -8338, -8355, -8371, -8388, -8405, -8422, -8439, -8456, -8473, -8490, -8507,
  -8525, -8542, -8559, -8577, -8594, -8612, -8630, -8648, -8665, -8683, -8701, -8719, -8738, -8756,
  -8774, -8793, -8811, -8830, -8848, -8867, -8886, -8905, -8924, -8943, -8962, -8981, -9000, -9020,
  -9039, -9058, -9078, -9098, -9118, -9137, -9157, -9177, -9198, -9218, -9238, -9258, -9279, -9300,
  -9320, -9341, -9362, -9383, -9404, -9425, -9446, -9467, -9489, -9510, -9532, -9554, -9576, -9597,
  -9619, -9642, -9664, -9686, -9709, -9731, -9754, -9776, -9799, -9822, -9845, -9868, -9892, -9915,
  -9939, -9962, -9986, -10010, -10034, -10058, -10082, -10106, -10131, -10155, -10180, -10205, -10230, -10255,
  -10280, -10305, -10330, -10356, -10381, -10407, -10433, -10459, -10485, -10512, -10538, -10564, -10591, -10618,
  -10645, -10672, -10699, -10727, -10754, -10782, -10810, -10837, -10866, -10894, -10922, -10951, -10979, -11008,
  -11037, -11066, -11096, -11125, -11155, -11184, -11214, -11244, -11275, -11305, -11335, -11366, -11397, -11428,
  -11459, -11491, -11522, -11554, -11586, -11618, -11650, -11683, -11715, -11748, -11781, -11814, -11848, -11881,
  -11915, -11949, -11983, -12018, -12052, -12087, -12122, -12157, -12192, -12228, -12264, -12300, -12336, -12372,
  -12409, -12446, -12483, -12520, -12557, -12595, -12633, -12671, -12710, -12748, -12787, -12826, -12865, -12905,
  -12945, -12985, -13025, -13066, -13107, -13148, -13189, -13231, -13273, -13315, -13357, -13400, -13443, -13486,
  -13530, -13573, -13617, -13662, -13706, -13751, -13797, -13842, -13888, -13934, -13981, -14027, -14074, -14122,
  -14169, -14217, -14266, -14315, -14364, -14413, -14463, -14513, -14563, -14614, -14665, -14716, -14768, -14820,
  -14873, -14926, -14979, -15033, -15087, -15141, -15196, -15252, -15307, -15363, -15420, -15477, -15534, -15592,
  -15650, -15709, -15768, -15827, -15887, -15947, -16008, -16070, -16131, -16194, -16256, -16320, -16384, -16448,
  -16513, -16578, -16644, -16710, -16777, -16844, -16912, -16980, -17050, -17119, -17189, -17260, -17331, -17403,
  -17476, -17549, -17623, -17697, -17772, -17848, -17924, -18001, -18078, -18157, -18236, -18315, -18396, -18477,
  -18558, -18641, -18724, -18808, -18893, -18978, -19065, -19152, -19239, -19328, -19418, -19508, -19599, -19691,
  -19784, -19878, -19972, -20068, -20164, -20262, -20360, -20460, -20560, -20661, -20763, -20867, -20971, -21076,
  -21183, -21290, -21399, -21509, -21620, -21732, -21845, -21959, -22075, -22192, -22310, -22429, -22550, -22671,
  -22795, -22919, -23045, -23172, -23301, -23431, -23563, -23696, -23831, -23967, -24105, -24244, -24385, -24528,
  -24672, -24818, -24966, -25115, -25266, -25420, -25575, -25731, -25890, -26051, -26214, -26379, -26546, -26715,
  -26886, -27060, -27235, -27413, -27594, -27776, -27962, -28149, -28339, -28532, -28728, -28926, -29127, -29330,
  -29537, -29746, -29959, -30174, -30393, -30615, -30840, -31068, -31300, -31536, -31775, -32017, -32263, -32513,
  -32768, -33026, -33288, -33554, -33825, -34100, -34379, -34663, -34952, -35246, -35544, -35848, -36157, -36472,
  -36792, -37117, -37449, -37786, -38130, -38479, -38836, -39199, -39568, -39945, -40329, -40721, -41120, -41527,
  -41943, -42366, -42799, -43240, -43690, -44150, -44620, -45100, -45590, -46091, -46603, -47127, -47662, -48210,
  -48770, -49344, -49932, -50533, -51150, -51781, -52428, -53092, -53773, -54471, -55188, -55924, -56679, -57456,
  -58254, -59074, -59918, -60787, -61680, -62601, -63550, -64527, -65536, -66576, -67650, -68759, -69905, -71089,
  -72315, -73584, -74898, -76260, -77672, -79137, -80659, -82241, -83886, -85598, -87381, -89240, -91180, -93206,
  -95325, -97541, -99864, -102300, -104857, -107546, -110376, -113359, -116508, -119837, -123361, -127100, -131072, -135300,
  -139810, -144631, -149796, -155344, -161319, -167772, -174762, -182361, -190650, -199728, -209715, -220752, -233016, -246723,
  -262144, -279620, -299593, -322638, -349525, -381300, -419430, -466033, -524288, -599186, -699050, -838860, -1048576, -1398101,
  -2097152, -4194304, 0,
];

const INVERSE_TABLE_SIZE = 1024;

function quickInverse(x: number): number {
  if (abs32(x) > INVERSE_TABLE_SIZE) throw new Error('SKIA-AA: quick_inverse outside its table');
  return x > 0 ? -at(INVERSE_TABLE, INVERSE_TABLE_SIZE - x) : at(INVERSE_TABLE, INVERSE_TABLE_SIZE + x);
}

function quickDiv(a: number, b: number): number {
  const absA = abs32(a);
  const absB = abs32(b);
  if (absB >= 8 && absB < INVERSE_TABLE_SIZE && absA < 4096) return shr(a * quickInverse(b), 6);
  return fdot6Div(a, b);
}

// ---------------------------------------------------------------------------------------------------------------------
// SkRRect (setRect, setRectRadii, scaleRadii, computeType) and Blink's FloatRoundedRect (ConstrainRadii, IsRenderable).

type RRectType = 'empty' | 'rect' | 'oval' | 'simple' | 'ninePatch' | 'complex';

/** An SkRRect; radii are in Skia corner order UL, UR, LR, LL. */
export type SkRRect = { readonly rect: FRect; readonly radii: readonly Radius[]; readonly type: RRectType };

/** A Blink FloatRoundedRect in device px (gfx::SizeF radii are clamped: at most 8 float epsilons becomes 0). */
export type FloatRoundedRect = { readonly rect: FRect; readonly radii: CornerRadii };

const SIZEF_TRIVIAL = 9.5367431640625e-7;

function sizeClamp(v: number): number {
  return v > SIZEF_TRIVIAL ? v : 0;
}

function radius(x: number, y: number): Radius {
  return { x: sizeClamp(x), y: sizeClamp(y) };
}

function rectWidth(r: FRect): number {
  return f32(r.right - r.left);
}

function rectHeight(r: FRect): number {
  return f32(r.bottom - r.top);
}

function radiusIsZero(r: Radius): boolean {
  return r.x === 0 && r.y === 0;
}

function radiiIsZero(r: CornerRadii): boolean {
  return radiusIsZero(r.topLeft) && radiusIsZero(r.topRight) && radiusIsZero(r.bottomRight) && radiusIsZero(r.bottomLeft);
}

/** gfx::SizeF::Scale then FloatRoundedRect::Radii::Scale's reset of a corner with a zero component. */
function scaleCorner(r: Radius, factor: number): Radius {
  const s = radius(f32(r.x * factor), f32(r.y * factor));
  return s.x === 0 || s.y === 0 ? { x: 0, y: 0 } : s;
}

/** FloatRoundedRect::ConstrainRadii. */
export function constrainRadii(fr: FloatRoundedRect): FloatRoundedRect {
  const r = fr.radii;
  let factor = 1;
  const w = rectWidth(fr.rect);
  const h = rectHeight(fr.rect);
  const horizontal = maxNum(f32(r.topLeft.x + r.topRight.x), f32(r.bottomLeft.x + r.bottomRight.x));
  if (horizontal > w) factor = minNum(f32(w / horizontal), factor);
  const vertical = maxNum(f32(r.topLeft.y + r.bottomLeft.y), f32(r.topRight.y + r.bottomRight.y));
  if (vertical > h) factor = minNum(f32(h / vertical), factor);
  if (factor === 1) return fr;
  return { rect: fr.rect, radii: { topLeft: scaleCorner(r.topLeft, factor), topRight: scaleCorner(r.topRight, factor), bottomRight: scaleCorner(r.bottomRight, factor), bottomLeft: scaleCorner(r.bottomLeft, factor) } };
}

/** FloatRoundedRect::IsRenderable (tolerance 1.0001f). */
export function isRenderable(fr: FloatRoundedRect): boolean {
  const r = fr.radii;
  const w = f32(rectWidth(fr.rect) * f32(1.0001));
  const h = f32(rectHeight(fr.rect) * f32(1.0001));
  return f32(r.topLeft.x + r.topRight.x) <= w && f32(r.bottomLeft.x + r.bottomRight.x) <= w && f32(r.topLeft.y + r.bottomLeft.y) <= h && f32(r.topRight.y + r.bottomRight.y) <= h;
}

function rectRRect(rect: FRect): SkRRect {
  const zero: Radius = { x: 0, y: 0 };
  const empty = !(rect.left < rect.right && rect.top < rect.bottom);
  return { rect, radii: [zero, zero, zero, zero], type: empty ? 'empty' : 'rect' };
}

type ClampedRadii = { readonly radii: Radius[]; readonly allSquare: boolean };

function clampToZero(radii: readonly Radius[]): ClampedRadii {
  const out: Radius[] = [];
  let allSquare = true;
  for (const r of radii) {
    if (r.x <= 0 || r.y <= 0) out.push({ x: 0, y: 0 });
    else {
      out.push(r);
      allSquare = false;
    }
  }
  return { radii: out, allSquare };
}

function computeMinScale(rad1: number, rad2: number, limit: number, curMin: number): number {
  return rad1 + rad2 > limit ? minNum(curMin, limit / (rad1 + rad2)) : curMin;
}

/** flush_to_zero on a pair: returns [a, b]. */
function flushToZero(a: number, b: number): number[] {
  const s = f32(a + b);
  if (s === a) return [a, 0];
  if (s === b) return [0, b];
  return [a, b];
}

/** SkScaleToSides::AdjustRadii: returns [a, b]. */
function adjustRadii(limit: number, scale: number, a0: number, b0: number): number[] {
  const a = f32(a0 * scale);
  const b = f32(b0 * scale);
  if (f32(a + b) > limit) {
    const aIsMin = !(a > b);
    const minR = aIsMin ? a : b;
    let maxR = f32(limit - minR);
    while (f32(maxR + minR) > limit) maxR = nextDown32(maxR);
    return aIsMin ? [a, maxR] : [maxR, b];
  }
  return [a, b];
}

function computeType(rect: FRect, radii: readonly Radius[]): RRectType {
  if (!(rect.left < rect.right && rect.top < rect.bottom)) return 'empty';
  const r0 = radii[0] as Radius;
  let allEqual = true;
  let allSquare = r0.x === 0 || r0.y === 0;
  for (let i = 1; i < 4; i++) {
    const r = radii[i] as Radius;
    const p = radii[i - 1] as Radius;
    if (r.x !== 0 && r.y !== 0) allSquare = false;
    if (r.x !== p.x || r.y !== p.y) allEqual = false;
  }
  if (allSquare) return 'rect';
  if (allEqual) return r0.x >= f32(rectWidth(rect) * 0.5) && r0.y >= f32(rectHeight(rect) * 0.5) ? 'oval' : 'simple';
  const ul = radii[0] as Radius;
  const ur = radii[1] as Radius;
  const lr = radii[2] as Radius;
  const ll = radii[3] as Radius;
  return ul.x === ll.x && ul.y === ur.y && ur.x === lr.x && ll.y === lr.y ? 'ninePatch' : 'complex';
}

/** SkRRect::setRectRadii (radii in Skia corner order); the fault skips scaleRadii's clamp. */
export function setRectRadii(rect: FRect, radii: readonly Radius[], faults: AaFaults): SkRRect {
  if (!(rect.left < rect.right && rect.top < rect.bottom)) return rectRRect(rect);
  const clamped = clampToZero(radii);
  if (clamped.allSquare) return rectRRect(rect);
  const r = clamped.radii;
  let scale = 1;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const r0 = r[0] as Radius;
  const r1 = r[1] as Radius;
  const r2 = r[2] as Radius;
  const r3 = r[3] as Radius;
  scale = computeMinScale(r0.x, r1.x, width, scale);
  scale = computeMinScale(r1.y, r2.y, height, scale);
  scale = computeMinScale(r2.x, r3.x, width, scale);
  scale = computeMinScale(r3.y, r0.y, height, scale);
  const x01 = flushToZero(r0.x, r1.x);
  const y12 = flushToZero(r1.y, r2.y);
  const x23 = flushToZero(r2.x, r3.x);
  const y30 = flushToZero(r3.y, r0.y);
  let ulx = at(x01, 0);
  let urx = at(x01, 1);
  let ury = at(y12, 0);
  let lry = at(y12, 1);
  let lrx = at(x23, 0);
  let llx = at(x23, 1);
  let lly = at(y30, 0);
  let uly = at(y30, 1);
  if (scale < 1 && !faults.rrectRadiiUnclamped) {
    const a = adjustRadii(width, scale, ulx, urx);
    ulx = at(a, 0);
    urx = at(a, 1);
    const b = adjustRadii(height, scale, ury, lry);
    ury = at(b, 0);
    lry = at(b, 1);
    const c = adjustRadii(width, scale, lrx, llx);
    lrx = at(c, 0);
    llx = at(c, 1);
    const d = adjustRadii(height, scale, lly, uly);
    lly = at(d, 0);
    uly = at(d, 1);
  }
  const out = clampToZero([
    { x: ulx, y: uly },
    { x: urx, y: ury },
    { x: lrx, y: lry },
    { x: llx, y: lly },
  ]).radii;
  return { rect, radii: out, type: computeType(rect, out) };
}

/** FloatRoundedRect's explicit operator SkRRect. */
export function toSkRRect(fr: FloatRoundedRect, faults: AaFaults): SkRRect {
  if (radiiIsZero(fr.radii)) return rectRRect(fr.rect);
  const r = fr.radii;
  return setRectRadii(fr.rect, [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft], faults);
}

// ---------------------------------------------------------------------------------------------------------------------
// Paths: SkPathRawShapes Rect, Oval and RRect (clockwise), and the DRRect builder.

const VERB_MOVE = 0;
const VERB_LINE = 1;
const VERB_QUAD = 2;
const VERB_CONIC = 3;
const VERB_CLOSE = 5;

/** A device-space path (identity CTM). */
export type AaPath = {
  readonly pts: readonly Pt[];
  readonly verbs: readonly number[];
  readonly weights: readonly number[];
  readonly evenOdd: boolean;
  readonly convex: boolean;
  readonly bounds: FRect;
};

function pt(x: number, y: number): Pt {
  return { x, y };
}

/** SkPath_PointIterator<N> advancing clockwise. */
function ring(xs: readonly Pt[], start: number, step: number): Pt {
  const n = xs.length;
  const i = start + step;
  return xs[i - floorOf(i / n) * n] as Pt;
}

function rectCorners(r: FRect): Pt[] {
  return [pt(r.left, r.top), pt(r.right, r.top), pt(r.right, r.bottom), pt(r.left, r.bottom)];
}

function midpoint(a: number, b: number): number {
  return f32(0.5 * (a + b));
}

/** A contour's points, verbs and conic weights. */
type Shape = { readonly pts: Pt[]; readonly verbs: number[]; readonly weights: number[] };

function rectPoints(r: FRect, index: number): Shape {
  const c = rectCorners(r);
  return { pts: [ring(c, index, 0), ring(c, index, 1), ring(c, index, 2), ring(c, index, 3)], verbs: [VERB_MOVE, VERB_LINE, VERB_LINE, VERB_LINE, VERB_CLOSE], weights: [] };
}

function ovalPoints(r: FRect, index: number): Shape {
  const cx = midpoint(r.left, r.right);
  const cy = midpoint(r.top, r.bottom);
  const oval = [pt(cx, r.top), pt(r.right, cy), pt(cx, r.bottom), pt(r.left, cy)];
  const c = rectCorners(r);
  const pts: Pt[] = [ring(oval, index, 0)];
  for (let i = 0; i < 4; i++) {
    pts.push(ring(c, index, i + 1));
    pts.push(ring(oval, index, i + 1));
  }
  return { pts, verbs: [VERB_MOVE, VERB_CONIC, VERB_CONIC, VERB_CONIC, VERB_CONIC, VERB_CLOSE], weights: [ROOT2_OVER2, ROOT2_OVER2, ROOT2_OVER2, ROOT2_OVER2] };
}

function rrectPoints(rr: SkRRect, index: number): Shape {
  const b = rr.rect;
  const ul = rr.radii[0] as Radius;
  const ur = rr.radii[1] as Radius;
  const lr = rr.radii[2] as Radius;
  const ll = rr.radii[3] as Radius;
  const rp = [
    pt(f32(b.left + ul.x), b.top),
    pt(f32(b.right - ur.x), b.top),
    pt(b.right, f32(b.top + ur.y)),
    pt(b.right, f32(b.bottom - lr.y)),
    pt(f32(b.right - lr.x), b.bottom),
    pt(f32(b.left + ll.x), b.bottom),
    pt(b.left, f32(b.bottom - ll.y)),
    pt(b.left, f32(b.top + ul.y)),
  ];
  const c = rectCorners(b);
  const rectStart = floorOf(index / 2);
  const w = [ROOT2_OVER2, ROOT2_OVER2, ROOT2_OVER2, ROOT2_OVER2];
  const pts: Pt[] = [ring(rp, index, 0)];
  if (isOdd(index)) {
    // Clockwise from an odd index starts with a conic; the final line is the close.
    let k = 1;
    for (let i = 0; i < 3; i++) {
      pts.push(ring(c, rectStart, i + 1));
      pts.push(ring(rp, index, k));
      pts.push(ring(rp, index, k + 1));
      k += 2;
    }
    pts.push(ring(c, rectStart, 4));
    pts.push(ring(rp, index, k));
    return { pts, verbs: [VERB_MOVE, VERB_CONIC, VERB_LINE, VERB_CONIC, VERB_LINE, VERB_CONIC, VERB_LINE, VERB_CONIC, VERB_CLOSE], weights: w };
  }
  let k = 1;
  for (let i = 0; i < 4; i++) {
    pts.push(ring(rp, index, k));
    pts.push(ring(c, rectStart, i + 1));
    pts.push(ring(rp, index, k + 1));
    k += 2;
  }
  return { pts, verbs: [VERB_MOVE, VERB_LINE, VERB_CONIC, VERB_LINE, VERB_CONIC, VERB_LINE, VERB_CONIC, VERB_LINE, VERB_CONIC, VERB_CLOSE], weights: w };
}

function boundsOf(pts: readonly Pt[]): FRect {
  let l = (pts[0] as Pt).x;
  let t = (pts[0] as Pt).y;
  let r = l;
  let b = t;
  for (const p of pts) {
    l = minNum(l, p.x);
    t = minNum(t, p.y);
    r = maxNum(r, p.x);
    b = maxNum(b, p.y);
  }
  return { left: l, top: t, right: r, bottom: b };
}

/** SkPath::Oval(r) (clockwise, start index 1), as SkDraw::drawOval builds it. */
export function ovalPath(r: FRect): AaPath {
  const s = ovalPoints(r, 1);
  return { pts: s.pts, verbs: s.verbs, weights: s.weights, evenOdd: false, convex: true, bounds: boundsOf(s.pts) };
}

/** SkPath::RRect(rr) (clockwise, start index 6), with SkPathPriv::SimplifyRRect. */
export function rrectPath(rr: SkRRect): AaPath {
  const s = rr.type === 'rect' || rr.type === 'empty' ? rectPoints(rr.rect, 3) : rr.type === 'oval' ? ovalPoints(rr.rect, 3) : rrectPoints(rr, 6);
  return { pts: s.pts, verbs: s.verbs, weights: s.weights, evenOdd: false, convex: true, bounds: boundsOf(s.pts) };
}

/** SkDevice::drawDRRect's path: addRRect(outer), addRRect(inner), even-odd; two contours make it concave. */
export function drrectPath(outer: SkRRect, inner: SkRRect): AaPath {
  const pts: Pt[] = [];
  const verbs: number[] = [];
  const weights: number[] = [];
  for (const rr of [outer, inner]) {
    const s = rr.type === 'rect' || rr.type === 'empty' ? rectPoints(rr.rect, 3) : rr.type === 'oval' ? ovalPoints(rr.rect, 3) : rrectPoints(rr, 6);
    for (const p of s.pts) pts.push(p);
    for (const v of s.verbs) verbs.push(v);
    for (const w of s.weights) weights.push(w);
  }
  return { pts, verbs, weights, evenOdd: true, convex: false, bounds: boundsOf(pts) };
}

// ---------------------------------------------------------------------------------------------------------------------
// SkGeometry: conics to quads (SK_SUPPORT_LEGACY_CONIC_CHOP) and SkChopQuadAtYExtrema.

type Conic = { readonly p0: Pt; readonly p1: Pt; readonly p2: Pt; readonly w: number };

const CONIC_TOL = 0.25;
const MAX_CONIC_TO_QUAD_POW2 = 5;

/** SkConic::computeQuadPOW2. */
function computeQuadPow2(c: Conic, tol: number): number {
  const a = f32(c.w - 1);
  const k = f32(a / f32(4 * f32(2 + a)));
  const x = f32(k * f32(f32(c.p0.x - f32(2 * c.p1.x)) + c.p2.x));
  const y = f32(k * f32(f32(c.p0.y - f32(2 * c.p1.y)) + c.p2.y));
  let error = sqrt32(f32(f32(x * x) + f32(y * y)));
  let p = 0;
  while (p < MAX_CONIC_TO_QUAD_POW2) {
    if (error <= tol) break;
    error = f32(error * 0.25);
    p++;
  }
  return p;
}

/** SkConic::chop, the legacy form. */
function chopConic(c: Conic): Conic[] {
  const scale = f32(1 / f32(1 + c.w));
  const newW = sqrt32(f32(0.5 + f32(c.w * 0.5)));
  const wp1 = pt(f32(c.w * c.p1.x), f32(c.w * c.p1.y));
  const m = pt(f32(f32(f32(f32(c.p0.x + f32(wp1.x + wp1.x)) + c.p2.x) * scale) * 0.5), f32(f32(f32(f32(c.p0.y + f32(wp1.y + wp1.y)) + c.p2.y) * scale) * 0.5));
  const a1 = pt(f32(f32(c.p0.x + wp1.x) * scale), f32(f32(c.p0.y + wp1.y) * scale));
  const b1 = pt(f32(f32(wp1.x + c.p2.x) * scale), f32(f32(wp1.y + c.p2.y) * scale));
  return [
    { p0: c.p0, p1: a1, p2: m, w: newW },
    { p0: m, p1: b1, p2: c.p2, w: newW },
  ];
}

function between(a: number, b: number, c: number): boolean {
  return f32(f32(a - b) * f32(c - b)) <= 0;
}

function withY(p: Pt, y: number): Pt {
  return pt(p.x, y);
}

/** subdivide(): appends the quads' control and end points. */
function subdivideConic(src: Conic, out: Pt[], level: number): void {
  if (level === 0) {
    out.push(src.p1);
    out.push(src.p2);
    return;
  }
  const d = chopConic(src);
  let d0 = d[0] as Conic;
  let d1 = d[1] as Conic;
  const startY = src.p0.y;
  const endY = src.p2.y;
  if (between(startY, src.p1.y, endY)) {
    const midY = d0.p2.y;
    if (!between(startY, midY, endY)) {
      const closerY = abs32(f32(midY - startY)) < abs32(f32(midY - endY)) ? startY : endY;
      d0 = { p0: d0.p0, p1: d0.p1, p2: withY(d0.p2, closerY), w: d0.w };
      d1 = { p0: withY(d1.p0, closerY), p1: d1.p1, p2: d1.p2, w: d1.w };
    }
    if (!between(startY, d0.p1.y, d0.p2.y)) d0 = { p0: d0.p0, p1: withY(d0.p1, startY), p2: d0.p2, w: d0.w };
    if (!between(d1.p0.y, d1.p1.y, endY)) d1 = { p0: d1.p0, p1: withY(d1.p1, endY), p2: d1.p2, w: d1.w };
  }
  subdivideConic(d0, out, level - 1);
  subdivideConic(d1, out, level - 1);
}

/** SkAutoConicToQuads::computeQuads: 2^pow2 quads as 2*count+1 points. */
function conicToQuads(c: Conic): Pt[] {
  const p = computeQuadPow2(c, CONIC_TOL);
  const out: Pt[] = [c.p0];
  if (p === MAX_CONIC_TO_QUAD_POW2) throw new Error('SKIA-AA: a conic needing 32 quads is not modelled');
  subdivideConic(c, out, p);
  return out;
}

function interp(a: number, b: number, t: number): number {
  return f32(a + f32(f32(b - a) * t));
}

function validUnitDivide(numer0: number, denom0: number): number {
  let numer = numer0;
  let denom = denom0;
  if (numer < 0) {
    numer = -numer;
    denom = -denom;
  }
  if (denom === 0 || numer === 0 || numer >= denom) return -1;
  const r = f32(numer / denom);
  if (r !== r) return -1;
  return r === 0 ? -1 : r;
}

function isNotMonotonic(a: number, b: number, c: number): boolean {
  const ab = f32(a - b);
  let bc = f32(b - c);
  if (ab < 0) bc = -bc;
  return ab === 0 || bc < 0;
}

/** SkChopQuadAtYExtrema: one or two y-monotonic quads as 3 or 5 points. */
function chopQuadAtYExtrema(q: readonly Pt[]): Pt[] {
  const p0 = q[0] as Pt;
  const p1 = q[1] as Pt;
  const p2 = q[2] as Pt;
  const a = p0.y;
  let b = p1.y;
  const c = p2.y;
  if (isNotMonotonic(a, b, c)) {
    const t = validUnitDivide(f32(a - b), f32(f32(f32(a - b) - b) + c));
    if (t > 0) {
      const p01 = pt(interp(p0.x, p1.x, t), interp(p0.y, p1.y, t));
      const p12 = pt(interp(p1.x, p2.x, t), interp(p1.y, p2.y, t));
      const mid = pt(interp(p01.x, p12.x, t), interp(p01.y, p12.y, t));
      return [p0, pt(p01.x, mid.y), mid, pt(p12.x, mid.y), p2];
    }
    b = abs32(f32(a - b)) < abs32(f32(b - c)) ? a : c;
  }
  return [pt(p0.x, a), pt(p1.x, b), pt(p2.x, c)];
}

// ---------------------------------------------------------------------------------------------------------------------
// SkAnalyticEdge.

type Edge = {
  fNext: Edge | null;
  fPrev: Edge | null;
  fX: number;
  fDX: number;
  fUpperX: number;
  fY: number;
  fUpperY: number;
  fLowerY: number;
  fDY: number;
  fIsLine: boolean;
  fCurveCount: number;
  fCurveShift: number;
  fWinding: number;
  fQx: number;
  fQy: number;
  fQDx: number;
  fQDy: number;
  fQDDx: number;
  fQDDy: number;
  fQLastX: number;
  fQLastY: number;
  fSnappedX: number;
  fSnappedY: number;
};

function newEdge(): Edge {
  return { fNext: null, fPrev: null, fX: 0, fDX: 0, fUpperX: 0, fY: 0, fUpperY: 0, fLowerY: 0, fDY: 0, fIsLine: true, fCurveCount: 0, fCurveShift: 0, fWinding: 1, fQx: 0, fQy: 0, fQDx: 0, fQDy: 0, fQDDx: 0, fQDDy: 0, fQLastX: 0, fQLastY: 0, fSnappedX: 0, fSnappedY: 0 };
}

function nx(e: Edge | null): Edge {
  if (e === null) throw new Error('SKIA-AA: walked past the edge list');
  return e;
}

/** SkAnalyticEdge::SnapY: to a quarter pixel. */
function snapY(y: number): number {
  return wrap32(floorOf((y + 8192) / 16384) * 16384);
}

/** float * 256 to SkFDot6 (x4 accuracy): (int)(x * scale), or the fault's rounding. */
function toFDot6x4(x: number, faults: AaFaults): number {
  const v = f32(x * 256);
  return faults.edgeFixedPointRounding ? roundOf(v) : toInt(v);
}

function goY(e: Edge, y: number): void {
  if (y === e.fY + SK_FIXED1) {
    e.fX = add32(e.fX, e.fDX);
    e.fY = y;
  } else if (y !== e.fY) {
    e.fX = add32(e.fUpperX, fixedMul(e.fDX, y - e.fUpperY));
    e.fY = y;
  }
}

function goYShift(e: Edge, y: number, yShift: number): void {
  e.fY = y;
  e.fX = add32(e.fX, shr(e.fDX, yShift));
}

/** SkAnalyticEdge::setLine. */
function setLine(e: Edge, p0: Pt, p1: Pt, faults: AaFaults): boolean {
  let x0 = shr(fdot6ToFixed(toFDot6x4(p0.x, faults)), 2);
  let y0 = snapY(shr(fdot6ToFixed(toFDot6x4(p0.y, faults)), 2));
  let x1 = shr(fdot6ToFixed(toFDot6x4(p1.x, faults)), 2);
  let y1 = snapY(shr(fdot6ToFixed(toFDot6x4(p1.y, faults)), 2));
  let winding = 1;
  if (y0 > y1) {
    const tx = x0;
    x0 = x1;
    x1 = tx;
    const ty = y0;
    y0 = y1;
    y1 = ty;
    winding = -1;
  }
  const dy = fixedToFDot6(y1 - y0);
  if (dy === 0) return false;
  const dx = fixedToFDot6(x1 - x0);
  const slope = quickDiv(dx, dy);
  const absSlope = abs32(slope);
  e.fX = x0;
  e.fDX = slope;
  e.fUpperX = x0;
  e.fY = y0;
  e.fUpperY = y0;
  e.fLowerY = y1;
  e.fDY = dx === 0 || slope === 0 ? SK_MAX_S32 : absSlope < INVERSE_TABLE_SIZE ? quickInverse(absSlope) : abs32(quickDiv(dy, dx));
  e.fIsLine = true;
  e.fCurveCount = 0;
  e.fWinding = winding;
  e.fCurveShift = 0;
  return true;
}

/** SkAnalyticEdge::updateLine. */
function updateLine(e: Edge, ax0: number, ay0: number, ax1: number, ay1: number, slope: number): boolean {
  let x0 = ax0;
  let y0 = ay0;
  let x1 = ax1;
  let y1 = ay1;
  if (y0 > y1) {
    const tx = x0;
    x0 = x1;
    x1 = tx;
    const ty = y0;
    y0 = y1;
    y1 = ty;
    e.fWinding = -e.fWinding;
  }
  const dx = fixedToFDot6(x1 - x0);
  const dy = fixedToFDot6(y1 - y0);
  if (dy === 0) return false;
  const absSlope = abs32(fixedToFDot6(slope));
  e.fX = x0;
  e.fDX = slope;
  e.fUpperX = x0;
  e.fY = y0;
  e.fUpperY = y0;
  e.fLowerY = y1;
  e.fDY = dx === 0 || slope === 0 ? SK_MAX_S32 : absSlope < INVERSE_TABLE_SIZE ? quickInverse(absSlope) : abs32(quickDiv(dy, dx));
  return true;
}

function cheapDistance(dx0: number, dy0: number): number {
  const dx = abs32(dx0);
  const dy = abs32(dy0);
  return dx > dy ? dx + shr(dy, 1) : dy + shr(dx, 1);
}

function diffToShift(dx: number, dy: number, shiftAA: number): number {
  const dist = shr(cheapDistance(dx, dy) + shl(1, 2 + shiftAA), 3 + shiftAA);
  return shr(32 - clz(dist), 1);
}

/** SkAnalyticQuadraticEdge::setQuadraticWithoutUpdate with shift = kDefaultAccuracy (2). */
function setQuadraticWithoutUpdate(e: Edge, pts: readonly Pt[], faults: AaFaults): boolean {
  let x0 = toFDot6x4((pts[0] as Pt).x, faults);
  let y0 = toFDot6x4((pts[0] as Pt).y, faults);
  const x1 = toFDot6x4((pts[1] as Pt).x, faults);
  const y1 = toFDot6x4((pts[1] as Pt).y, faults);
  let x2 = toFDot6x4((pts[2] as Pt).x, faults);
  let y2 = toFDot6x4((pts[2] as Pt).y, faults);
  let winding = 1;
  if (y0 > y2) {
    const tx = x0;
    x0 = x2;
    x2 = tx;
    const ty = y0;
    y0 = y2;
    y2 = ty;
    winding = -1;
  }
  const top = shr(y0 + 32, 6);
  const bot = shr(y2 + 32, 6);
  if (top === bot) return false;
  const ddx = shr(shl(x1, 1) - x0 - x2, 2);
  const ddy = shr(shl(y1, 1) - y0 - y2, 2);
  let shift = diffToShift(ddx, ddy, 2);
  if (shift === 0) shift = 1;
  else if (shift > 6) shift = 6;
  e.fWinding = winding;
  e.fIsLine = false;
  e.fCurveCount = pow2(shift);
  e.fCurveShift = shift - 1;
  let a = shl(x0 - x1 - x1 + x2, 9);
  let b = fdot6ToFixed(x1 - x0);
  e.fQx = fdot6ToFixed(x0);
  e.fQDx = add32(b, shr(a, shift));
  e.fQDDx = shr(a, shift - 1);
  a = shl(y0 - y1 - y1 + y2, 9);
  b = fdot6ToFixed(y1 - y0);
  e.fQy = fdot6ToFixed(y0);
  e.fQDy = add32(b, shr(a, shift));
  e.fQDDy = shr(a, shift - 1);
  e.fQLastX = fdot6ToFixed(x2);
  e.fQLastY = fdot6ToFixed(y2);
  return true;
}

/** SkAnalyticQuadraticEdge::setQuadratic. */
function setQuadratic(e: Edge, pts: readonly Pt[], faults: AaFaults): boolean {
  if (!setQuadraticWithoutUpdate(e, pts, faults)) return false;
  e.fQx = shr(e.fQx, 2);
  e.fQy = shr(e.fQy, 2);
  e.fQDx = shr(e.fQDx, 2);
  e.fQDy = shr(e.fQDy, 2);
  e.fQDDx = shr(e.fQDDx, 2);
  e.fQDDy = shr(e.fQDDy, 2);
  e.fQLastX = shr(e.fQLastX, 2);
  e.fQLastY = shr(e.fQLastY, 2);
  e.fQy = snapY(e.fQy);
  e.fQLastY = snapY(e.fQLastY);
  e.fSnappedX = e.fQx;
  e.fSnappedY = e.fQy;
  return updateQuadratic(e);
}

/** SkAnalyticQuadraticEdge::updateQuadratic. */
function updateQuadratic(e: Edge): boolean {
  let success = false;
  let count = e.fCurveCount;
  let oldx = e.fQx;
  let oldy = e.fQy;
  let dx = e.fQDx;
  let dy = e.fQDy;
  let newx = 0;
  let newy = 0;
  let newSnappedX = 0;
  let newSnappedY = 0;
  const shift = e.fCurveShift;
  while (true) {
    let slope = 0;
    count--;
    if (count > 0) {
      newx = add32(oldx, shr(dx, shift));
      newy = add32(oldy, shr(dy, shift));
      if (abs32(shr(dy, shift)) >= SK_FIXED1 * 2 && abs32(dy) * 64 > abs32(dx)) {
        const diffY = fixedToFDot6(newy - e.fSnappedY);
        slope = diffY !== 0 ? quickDiv(fixedToFDot6(newx - e.fSnappedX), diffY) : SK_MAX_S32;
        newSnappedY = minNum(e.fQLastY, fixedRoundToFixed(newy));
        newSnappedX = newx - fixedMul(slope, newy - newSnappedY);
      } else {
        newSnappedY = minNum(e.fQLastY, snapY(newy));
        newSnappedX = newx;
        const diffY = fixedToFDot6(newSnappedY - e.fSnappedY);
        slope = diffY !== 0 ? quickDiv(fixedToFDot6(newx - e.fSnappedX), diffY) : SK_MAX_S32;
      }
      dx = add32(dx, e.fQDDx);
      dy = add32(dy, e.fQDDy);
    } else {
      newx = e.fQLastX;
      newy = e.fQLastY;
      newSnappedY = newy;
      newSnappedX = newx;
      const diffY = fixedToFDot6(newy - e.fSnappedY);
      slope = diffY !== 0 ? quickDiv(fixedToFDot6(newx - e.fSnappedX), diffY) : SK_MAX_S32;
    }
    if (slope < SK_MAX_S32) success = updateLine(e, e.fSnappedX, e.fSnappedY, newSnappedX, newSnappedY, slope);
    oldx = newx;
    oldy = newy;
    if (!(count > 0 && !success)) break;
  }
  e.fQx = newx;
  e.fQy = newy;
  e.fQDx = dx;
  e.fQDy = dy;
  e.fSnappedX = newSnappedX;
  e.fSnappedY = newSnappedY;
  e.fCurveCount = count;
  return success;
}

function edgeUpdate(e: Edge): boolean {
  return e.fCurveCount > 0 ? updateQuadratic(e) : false;
}

function keepContinuous(e: Edge): void {
  e.fSnappedX = e.fX;
  e.fSnappedY = e.fY;
}

// ---------------------------------------------------------------------------------------------------------------------
// SkEdgeBuilder (no clip: every path here is inside its cc tile).

const COMBINE_NO = 0;
const COMBINE_PARTIAL = 1;
const COMBINE_TOTAL = 2;

function combineVertical(edge: Edge, last: Edge): number {
  const near = (a: number, b: number): boolean => abs32(a - b) < 0x100;
  if (!last.fIsLine || last.fDX !== 0 || edge.fX !== last.fX) return COMBINE_NO;
  if (edge.fWinding === last.fWinding) {
    if (edge.fLowerY === last.fUpperY) {
      last.fUpperY = edge.fUpperY;
      last.fY = last.fUpperY;
      return COMBINE_PARTIAL;
    }
    if (near(edge.fUpperY, last.fLowerY)) {
      last.fLowerY = edge.fLowerY;
      return COMBINE_PARTIAL;
    }
    return COMBINE_NO;
  }
  if (near(edge.fUpperY, last.fUpperY)) {
    if (near(edge.fLowerY, last.fLowerY)) return COMBINE_TOTAL;
    if (edge.fLowerY < last.fLowerY) {
      last.fUpperY = edge.fLowerY;
      last.fY = last.fUpperY;
      return COMBINE_PARTIAL;
    }
    last.fUpperY = last.fLowerY;
    last.fY = last.fUpperY;
    last.fLowerY = edge.fLowerY;
    last.fWinding = edge.fWinding;
    return COMBINE_PARTIAL;
  }
  if (near(edge.fLowerY, last.fLowerY)) {
    if (edge.fUpperY > last.fUpperY) {
      last.fLowerY = edge.fUpperY;
      return COMBINE_PARTIAL;
    }
    last.fLowerY = last.fUpperY;
    last.fUpperY = edge.fUpperY;
    last.fY = last.fUpperY;
    last.fWinding = edge.fWinding;
    return COMBINE_PARTIAL;
  }
  return COMBINE_NO;
}

/** SkEdgeBuilder's fList: a push/pop stack of edges. */
type EdgeList = { readonly cells: EdgeCell[]; n: number; readonly faults: AaFaults };

function pushEdge(list: EdgeList, e: Edge): void {
  if (list.n < list.cells.length) edgeAt(list.cells, list.n).e = e;
  else list.cells.push({ e });
  list.n++;
}

function addLine(list: EdgeList, p0: Pt, p1: Pt): void {
  const e = newEdge();
  if (!setLine(e, p0, p1, list.faults)) return;
  const combine = e.fIsLine && e.fDX === 0 && list.n > 0 ? combineVertical(e, edgeAt(list.cells, list.n - 1).e) : COMBINE_NO;
  if (combine === COMBINE_TOTAL) list.n--;
  else if (combine === COMBINE_NO) pushEdge(list, e);
}

function addQuad(list: EdgeList, q: readonly Pt[]): void {
  const mono = chopQuadAtYExtrema(q);
  for (let i = 0; i + 2 < mono.length; i += 2) {
    const e = newEdge();
    if (setQuadratic(e, [mono[i] as Pt, mono[i + 1] as Pt, mono[i + 2] as Pt], list.faults)) pushEdge(list, e);
  }
}

/** SkEdgeBuilder::build over SkPathEdgeIter (auto-closing each contour). */
function buildEdges(path: AaPath, faults: AaFaults): Edge[] {
  const list: EdgeList = { cells: [], n: 0, faults };
  let p = 0;
  let wi = 0;
  let moveTo: Pt = pt(0, 0);
  let last: Pt = pt(0, 0);
  let needsClose = false;
  for (const v of path.verbs) {
    if (v === VERB_MOVE) {
      if (needsClose) addLine(list, last, moveTo);
      needsClose = false;
      moveTo = path.pts[p] as Pt;
      last = moveTo;
      p++;
    } else if (v === VERB_LINE) {
      const q = path.pts[p] as Pt;
      addLine(list, last, q);
      last = q;
      p++;
      needsClose = true;
    } else if (v === VERB_QUAD) {
      const c = path.pts[p] as Pt;
      const q = path.pts[p + 1] as Pt;
      addQuad(list, [last, c, q]);
      last = q;
      p += 2;
      needsClose = true;
    } else if (v === VERB_CONIC) {
      const c = path.pts[p] as Pt;
      const q = path.pts[p + 1] as Pt;
      const w = at(path.weights, wi);
      if (faults.conicNotQuadded) addQuad(list, [last, c, q]);
      else {
        const quads = conicToQuads({ p0: last, p1: c, p2: q, w });
        for (let i = 0; i + 2 < quads.length; i += 2) addQuad(list, [quads[i] as Pt, quads[i + 1] as Pt, quads[i + 2] as Pt]);
      }
      last = q;
      p += 2;
      wi++;
      needsClose = true;
    } else if (v === VERB_CLOSE) {
      if (needsClose) addLine(list, last, moveTo);
      needsClose = false;
    }
  }
  if (needsClose) addLine(list, last, moveTo);
  const out: Edge[] = [];
  for (let i = 0; i < list.n; i++) out.push(edgeAt(list.cells, i).e);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// SkTQSort over compare_edges.

function edgeLess(a: Edge, b: Edge): boolean {
  if (a.fUpperY !== b.fUpperY) return a.fUpperY < b.fUpperY;
  if (a.fX !== b.fX) return a.fX < b.fX;
  return a.fDX < b.fDX;
}

type EdgeCell = { e: Edge };

function edgeAt(xs: readonly EdgeCell[], i: number): EdgeCell {
  const c = xs[i];
  if (c === undefined) throw new Error('SKIA-AA: sort index out of range');
  return c;
}

function swapCells(xs: readonly EdgeCell[], i: number, j: number): void {
  const a = edgeAt(xs, i);
  const b = edgeAt(xs, j);
  const t = a.e;
  a.e = b.e;
  b.e = t;
}

function insertionSort(xs: readonly EdgeCell[], left: number, count: number): void {
  const right = left + count - 1;
  for (let next = left + 1; next <= right; next++) {
    if (!edgeLess(edgeAt(xs, next).e, edgeAt(xs, next - 1).e)) continue;
    const insert = edgeAt(xs, next).e;
    let hole = next;
    while (true) {
      edgeAt(xs, hole).e = edgeAt(xs, hole - 1).e;
      hole--;
      if (!(left < hole && edgeLess(insert, edgeAt(xs, hole - 1).e))) break;
    }
    edgeAt(xs, hole).e = insert;
  }
}

function partition(xs: readonly EdgeCell[], left0: number, count: number, pivot: number): number {
  let left = left0;
  const right = left + count - 1;
  const pivotValue = edgeAt(xs, pivot).e;
  swapCells(xs, pivot, right);
  let newPivot = left;
  while (left < right) {
    if (edgeLess(edgeAt(xs, left).e, pivotValue)) {
      swapCells(xs, left, newPivot);
      newPivot++;
    }
    left++;
  }
  swapCells(xs, newPivot, right);
  return newPivot;
}

function siftDown(xs: readonly EdgeCell[], base: number, root0: number, bottom: number): void {
  let root = root0;
  const x = edgeAt(xs, base + root - 1).e;
  let child = root * 2;
  while (child <= bottom) {
    if (child < bottom && edgeLess(edgeAt(xs, base + child - 1).e, edgeAt(xs, base + child).e)) child++;
    if (edgeLess(x, edgeAt(xs, base + child - 1).e)) {
      edgeAt(xs, base + root - 1).e = edgeAt(xs, base + child - 1).e;
      root = child;
      child = root * 2;
    } else break;
  }
  edgeAt(xs, base + root - 1).e = x;
}

function siftUp(xs: readonly EdgeCell[], base: number, root0: number, bottom: number): void {
  let root = root0;
  const x = edgeAt(xs, base + root - 1).e;
  const start = root;
  let j = root * 2;
  while (j <= bottom) {
    if (j < bottom && edgeLess(edgeAt(xs, base + j - 1).e, edgeAt(xs, base + j).e)) j++;
    edgeAt(xs, base + root - 1).e = edgeAt(xs, base + j - 1).e;
    root = j;
    j = root * 2;
  }
  j = floorOf(root / 2);
  while (j >= start) {
    if (edgeLess(edgeAt(xs, base + j - 1).e, x)) {
      edgeAt(xs, base + root - 1).e = edgeAt(xs, base + j - 1).e;
      root = j;
      j = floorOf(root / 2);
    } else break;
  }
  edgeAt(xs, base + root - 1).e = x;
}

function heapSort(xs: readonly EdgeCell[], base: number, count: number): void {
  for (let i = floorOf(count / 2); i > 0; i--) siftDown(xs, base, i, count);
  for (let i = count - 1; i > 0; i--) {
    swapCells(xs, base, base + i);
    siftUp(xs, base, 1, i);
  }
}

function introSort(xs: readonly EdgeCell[], depth0: number, left0: number, count0: number): void {
  let depth = depth0;
  let left = left0;
  let count = count0;
  while (true) {
    if (count <= 32) {
      insertionSort(xs, left, count);
      return;
    }
    if (depth === 0) {
      heapSort(xs, left, count);
      return;
    }
    depth--;
    const middle = left + shr(count - 1, 1);
    const p = partition(xs, left, count, middle);
    const pivotCount = p - left;
    introSort(xs, depth, left, pivotCount);
    left += pivotCount + 1;
    count -= pivotCount + 1;
  }
}

function sortEdges(edges: readonly Edge[]): Edge[] {
  const xs: EdgeCell[] = [];
  for (const e of edges) xs.push({ e });
  const n = xs.length;
  if (n > 1) introSort(xs, 2 * (32 - clz(n - 2)), 0, n);
  const out: Edge[] = [];
  for (const c of xs) out.push(c.e);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The real blitter (SkARGB32_Black_Blitter over the gray device) and the additive blitters.

function devCell(d: Device, x: number, y: number): Cell | null {
  const b = d.bounds;
  if (x < b.left || x >= b.right || y < b.top || y >= b.bottom) return null;
  return cellAt(d.px, (y - b.top) * (b.right - b.left) + (x - b.left));
}

/** Black over dst at coverage a: dst * SkAlpha255To256(255 - a) >> 8 per channel. */
function blend(d: Device, x: number, y: number, a: number): void {
  if (a === 0) return;
  const c = devCell(d, x, y);
  if (c !== null) c.v = floorOf((c.v * (256 - a)) / 256);
}

const KIND_MASK = 0;
const KIND_RLE = 1;
const KIND_SAFE = 2;
const MASK_STORAGE_BYTES = 1032;

type Acc = {
  readonly kind: number;
  readonly dev: Device;
  readonly faults: AaFaults;
  readonly maskLeft: number;
  readonly maskTop: number;
  readonly maskWidth: number;
  readonly mask: readonly Cell[];
  readonly clip: IRect;
  readonly left: number;
  readonly width: number;
  readonly top: number;
  currY: number;
  readonly row: readonly Cell[];
};

function maskCell(acc: Acc, x: number, y: number): Cell {
  return cellAt(acc.mask, 1 + (y - acc.maskTop) * acc.maskWidth + (x - acc.maskLeft));
}

/** add_alpha: CatchOverflow of the sum; the fault stores the delta. */
function addAlpha(c: Cell, delta: number, faults: AaFaults): void {
  if (faults.coverageNotAccumulated) {
    c.v = delta;
    return;
  }
  const s = c.v + delta;
  c.v = u8(s - shr(s, 8));
}

/** safely_add_alpha: min(0xFF, sum); the fault stores the delta. */
function safelyAddAlpha(c: Cell, delta: number, faults: AaFaults): void {
  c.v = faults.coverageNotAccumulated ? delta : minNum(255, c.v + delta);
}

function snapAlpha(a: number): number {
  return a > 247 ? 255 : a < 8 ? 0 : a;
}

function accFlush(acc: Acc): void {
  if (acc.currY >= acc.top) {
    let any = false;
    for (const c of acc.row) {
      c.v = snapAlpha(c.v);
      if (c.v !== 0) any = true;
    }
    if (any) {
      for (let i = 0; i < acc.width; i++) blend(acc.dev, acc.left + i, acc.currY, cellAt(acc.row, i).v);
      for (const c of acc.row) c.v = 0;
    }
    acc.currY = acc.top - 1;
  }
}

function accCheckY(acc: Acc, y: number): void {
  if (y !== acc.currY) {
    accFlush(acc);
    acc.currY = y;
  }
}

function accFlushIfYChanged(acc: Acc, y: number, nextY: number): void {
  if (acc.kind !== KIND_MASK && fixedFloorToInt(y) !== fixedFloorToInt(nextY)) accFlush(acc);
}

function accAdd(acc: Acc, c: Cell, delta: number): void {
  if (acc.kind === KIND_SAFE) safelyAddAlpha(c, delta, acc.faults);
  else addAlpha(c, delta, acc.faults);
}

/** blitAntiH(x, y, width, alpha) of the additive blitter (width 1 is blitAntiH(x, y, alpha)). */
function accAntiH(acc: Acc, x0: number, y: number, width: number, alpha: number): void {
  if (acc.kind === KIND_MASK) {
    for (let i = 0; i < width; i++) addAlpha(maskCell(acc, x0 + i, y), alpha, acc.faults);
    return;
  }
  accCheckY(acc, y);
  const x = x0 - acc.left;
  if (x >= 0 && x + width <= acc.width) for (let i = 0; i < width; i++) accAdd(acc, cellAt(acc.row, x + i), alpha);
}

/** blitAntiH(x, y, antialias[], len) of the RLE blitters. */
function accAntiHArray(acc: Acc, x0: number, y: number, alphas: readonly Cell[], len0: number): void {
  if (acc.kind === KIND_MASK) throw new Error('SKIA-AA: MaskAdditiveBlitter::blitAntiH(array) aborts');
  accCheckY(acc, y);
  let x = x0 - acc.left;
  let len = len0;
  let off = 0;
  if (x < 0) {
    len += x;
    off -= x;
    x = 0;
  }
  len = minNum(len, acc.width - x);
  for (let i = 0; i < len; i++) accAdd(acc, cellAt(acc.row, x + i), cellAt(alphas, off + i).v);
}

/** getRealBlitter()->blitV: the mask sets alphas directly. */
function realBlitV(acc: Acc, x: number, y: number, height: number, alpha: number): void {
  if (alpha === 0) return;
  for (let i = 0; i < height; i++) {
    if (acc.kind === KIND_MASK) maskCell(acc, x, y + i).v = alpha;
    else blend(acc.dev, x, y + i, alpha);
  }
}

function realBlitRect(acc: Acc, x: number, y: number, width: number, height: number): void {
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (acc.kind === KIND_MASK) maskCell(acc, x + i, y + j).v = 255;
      else blend(acc.dev, x + i, y + j, 255);
    }
  }
}

function realBlitAntiRect(acc: Acc, x: number, y: number, width: number, height: number, leftAlpha: number, rightAlpha: number): void {
  if (acc.kind === KIND_MASK) {
    realBlitV(acc, x, y, height, leftAlpha);
    realBlitV(acc, x + 1 + width, y, height, rightAlpha);
    realBlitRect(acc, x + 1, y, width, height);
    return;
  }
  if (leftAlpha > 0) realBlitV(acc, x, y, height, leftAlpha);
  if (width > 0) realBlitRect(acc, x + 1, y, width, height);
  if (rightAlpha > 0) realBlitV(acc, x + 1 + width, y, height, rightAlpha);
}

function realOnDevice(acc: Acc): void {
  if (acc.kind === KIND_MASK) throw new Error('SKIA-AA: the mask blitter has no real row blit here');
}

// ---------------------------------------------------------------------------------------------------------------------
// SkScan_AAAPath.cpp: alphas of trapezoid rows.

function trapezoidToAlpha(l1: number, l2: number): number {
  return u8(shr(cdiv(l1 + l2, 2), 8));
}

function partialTriangleToAlpha(a: number, b: number): number {
  const area = wrap32(shr(a, 11) * shr(a, 11) * shr(b, 11));
  return u8(shr(area, 8));
}

function partialAlphaFixed(alpha: number, partialHeight: number): number {
  return u8(fixedRoundToInt(alpha * partialHeight));
}

function partialAlpha(alpha: number, fullAlpha: number): number {
  return u8(shr(u8(alpha) * fullAlpha, 8));
}

function fixedToAlpha(f: number): number {
  return partialAlphaFixed(0xff, f);
}

function approximateIntersection(a1: number, b1: number, a2: number, b2: number): number {
  const l1 = minNum(a1, b1);
  const r1 = maxNum(a1, b1);
  const l2 = minNum(a2, b2);
  const r2 = maxNum(a2, b2);
  return cdiv(maxNum(l1, l2) + minNum(r1, r2), 2);
}

function setAlpha(xs: readonly Cell[], i: number, v: number): void {
  cellAt(xs, i).v = u8(v);
}

function computeAlphaAboveLine(alphas: readonly Cell[], off: number, l: number, r: number, dY: number, fullAlpha: number): void {
  const R = fixedCeilToInt(r);
  if (R === 0) return;
  if (R === 1) {
    setAlpha(alphas, off, partialAlpha(shr(shl(R, 17) - l - r, 9), fullAlpha));
    return;
  }
  const first = SK_FIXED1 - l;
  const last = r - shl(R - 1, 16);
  const firstH = fixedMul(first, dY);
  setAlpha(alphas, off, shr(fixedMul(first, firstH), 9));
  let alpha16 = satAdd(firstH, shr(dY, 1));
  for (let i = 1; i < R - 1; i++) {
    setAlpha(alphas, off + i, shr(alpha16, 8));
    alpha16 = satAdd(alpha16, dY);
  }
  setAlpha(alphas, off + R - 1, fullAlpha - partialTriangleToAlpha(last, dY));
}

function computeAlphaBelowLine(alphas: readonly Cell[], off: number, l: number, r: number, dY: number, fullAlpha: number): void {
  const R = fixedCeilToInt(r);
  if (R === 0) return;
  if (R === 1) {
    setAlpha(alphas, off, partialAlpha(trapezoidToAlpha(l, r), fullAlpha));
    return;
  }
  const first = SK_FIXED1 - l;
  const last = r - shl(R - 1, 16);
  const lastH = fixedMul(last, dY);
  setAlpha(alphas, off + R - 1, shr(fixedMul(last, lastH), 9));
  let alpha16 = satAdd(lastH, shr(dY, 1));
  for (let i = R - 2; i > 0; i--) {
    setAlpha(alphas, off + i, shr(alpha16, 8));
    alpha16 = satAdd(alpha16, dY);
  }
  setAlpha(alphas, off, fullAlpha - partialTriangleToAlpha(first, dY));
}

function blitSingleAlpha(acc: Acc, y: number, x: number, alpha: number, fullAlpha: number, useMask: boolean, noRealBlitter: boolean): void {
  if (useMask) {
    if (fullAlpha === 0xff && !noRealBlitter) maskCell(acc, x, y).v = alpha;
    else safelyAddAlpha(maskCell(acc, x, y), partialAlpha(alpha, fullAlpha), acc.faults);
  } else if (fullAlpha === 0xff && !noRealBlitter) {
    realOnDevice(acc);
    realBlitV(acc, x, y, 1, alpha);
  } else accAntiH(acc, x, y, 1, partialAlpha(alpha, fullAlpha));
}

function blitTwoAlphas(acc: Acc, y: number, x: number, a1: number, a2: number, fullAlpha: number, useMask: boolean, noRealBlitter: boolean): void {
  if (useMask) {
    safelyAddAlpha(maskCell(acc, x, y), a1, acc.faults);
    safelyAddAlpha(maskCell(acc, x + 1, y), a2, acc.faults);
  } else if (fullAlpha === 0xff && !noRealBlitter) {
    realOnDevice(acc);
    blend(acc.dev, x, y, a1);
    blend(acc.dev, x + 1, y, a2);
  } else {
    accAntiH(acc, x, y, 1, a1);
    accAntiH(acc, x + 1, y, 1, a2);
  }
}

function blitFullAlpha(acc: Acc, y: number, x: number, len: number, fullAlpha: number, useMask: boolean, noRealBlitter: boolean): void {
  if (useMask) {
    for (let i = 0; i < len; i++) safelyAddAlpha(maskCell(acc, x + i, y), fullAlpha, acc.faults);
  } else if (fullAlpha === 0xff && !noRealBlitter) {
    realOnDevice(acc);
    for (let i = 0; i < len; i++) blend(acc.dev, x + i, y, 255);
  } else accAntiH(acc, x, y, len, fullAlpha);
}

function blitAaaTrapezoidRow(acc: Acc, y: number, ul: number, ur: number, ll: number, lr: number, lDY: number, rDY: number, fullAlpha: number, useMask: boolean, noRealBlitter: boolean): void {
  const L = fixedFloorToInt(ul);
  const R = fixedCeilToInt(lr);
  const len = R - L;
  if (len === 1) {
    blitSingleAlpha(acc, y, L, trapezoidToAlpha(ur - ul, lr - ll), fullAlpha, useMask, noRealBlitter);
    return;
  }
  const alphas = cells(len, fullAlpha);
  const temp = cells(len + 1, 0);
  const uL = fixedFloorToInt(ul);
  const lL = fixedCeilToInt(ll);
  if (uL + 2 === lL) {
    const first = shl(uL, 16) + SK_FIXED1 - ul;
    const second = ll - ul - first;
    const a1 = u8(fullAlpha - partialTriangleToAlpha(first, lDY));
    const a2 = partialTriangleToAlpha(second, lDY);
    const c0 = cellAt(alphas, 0);
    const c1 = cellAt(alphas, 1);
    c0.v = c0.v > a1 ? c0.v - a1 : 0;
    c1.v = c1.v > a2 ? c1.v - a2 : 0;
  } else {
    computeAlphaBelowLine(temp, uL - L, ul - shl(uL, 16), ll - shl(uL, 16), lDY, fullAlpha);
    for (let i = uL; i < lL; i++) {
      const c = cellAt(alphas, i - L);
      const t = cellAt(temp, i - L).v;
      c.v = c.v > t ? c.v - t : 0;
    }
  }
  const uR = fixedFloorToInt(ur);
  const lR = fixedCeilToInt(lr);
  if (uR + 2 === lR) {
    const first = shl(uR, 16) + SK_FIXED1 - ur;
    const second = lr - ur - first;
    const a1 = partialTriangleToAlpha(first, rDY);
    const a2 = u8(fullAlpha - partialTriangleToAlpha(second, rDY));
    const c0 = cellAt(alphas, len - 2);
    const c1 = cellAt(alphas, len - 1);
    c0.v = c0.v > a1 ? c0.v - a1 : 0;
    c1.v = c1.v > a2 ? c1.v - a2 : 0;
  } else {
    computeAlphaAboveLine(temp, uR - L, ur - shl(uR, 16), lr - shl(uR, 16), rDY, fullAlpha);
    for (let i = uR; i < lR; i++) {
      const c = cellAt(alphas, i - L);
      const t = cellAt(temp, i - L).v;
      c.v = c.v > t ? c.v - t : 0;
    }
  }
  if (useMask) {
    for (let i = 0; i < len; i++) safelyAddAlpha(maskCell(acc, L + i, y), cellAt(alphas, i).v, acc.faults);
  } else if (fullAlpha === 0xff && !noRealBlitter) {
    realOnDevice(acc);
    for (let i = 0; i < len; i++) blend(acc.dev, L + i, y, cellAt(alphas, i).v);
  } else accAntiHArray(acc, L, y, alphas, len);
}

function blitTrapezoidRow(acc: Acc, y: number, ul0: number, ur0: number, ll0: number, lr0: number, lDY: number, rDY: number, fullAlpha: number, useMask: boolean, noRealBlitter: boolean): void {
  let ul = ul0;
  let ur = ur0;
  let ll = ll0;
  let lr = lr0;
  if (ul > ur) return;
  if (ll > lr) {
    ll = approximateIntersection(ul, ll, ur, lr);
    lr = ll;
  }
  if (ul === ur && ll === lr) return;
  if (ul > ll) {
    const t = ul;
    ul = ll;
    ll = t;
  }
  if (ur > lr) {
    const t = ur;
    ur = lr;
    lr = t;
  }
  const joinLeft = fixedCeilToFixed(ll);
  const joinRite = fixedFloorToFixed(ur);
  if (joinLeft <= joinRite) {
    if (ul < joinLeft) {
      const len = fixedCeilToInt(joinLeft - ul);
      if (len === 1) {
        blitSingleAlpha(acc, y, shr(ul, 16), trapezoidToAlpha(joinLeft - ul, joinLeft - ll), fullAlpha, useMask, noRealBlitter);
      } else if (len === 2) {
        const first = joinLeft - SK_FIXED1 - ul;
        const second = ll - ul - first;
        const a1 = partialTriangleToAlpha(first, lDY);
        const a2 = u8(fullAlpha - partialTriangleToAlpha(second, lDY));
        blitTwoAlphas(acc, y, shr(ul, 16), a1, a2, fullAlpha, useMask, noRealBlitter);
      } else {
        blitAaaTrapezoidRow(acc, y, ul, joinLeft, ll, joinLeft, lDY, SK_MAX_S32, fullAlpha, useMask, noRealBlitter);
      }
    }
    if (joinLeft < joinRite) blitFullAlpha(acc, y, fixedFloorToInt(joinLeft), fixedFloorToInt(joinRite - joinLeft), fullAlpha, useMask, noRealBlitter);
    if (lr > joinRite) {
      const len = fixedCeilToInt(lr - joinRite);
      if (len === 1) {
        blitSingleAlpha(acc, y, shr(joinRite, 16), trapezoidToAlpha(ur - joinRite, lr - joinRite), fullAlpha, useMask, noRealBlitter);
      } else if (len === 2) {
        const first = joinRite + SK_FIXED1 - ur;
        const second = lr - ur - first;
        const a1 = u8(fullAlpha - partialTriangleToAlpha(first, rDY));
        const a2 = partialTriangleToAlpha(second, rDY);
        blitTwoAlphas(acc, y, shr(joinRite, 16), a1, a2, fullAlpha, useMask, noRealBlitter);
      } else {
        blitAaaTrapezoidRow(acc, y, joinRite, ur, joinRite, lr, SK_MAX_S32, rDY, fullAlpha, useMask, noRealBlitter);
      }
    }
  } else {
    blitAaaTrapezoidRow(acc, y, ul, ur, ll, lr, lDY, rDY, fullAlpha, useMask, noRealBlitter);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// SkScan_AAAPath.cpp: the edge walks.

function isSmoothEnough(thisEdge: Edge, nextEdge: Edge): boolean {
  if (thisEdge.fCurveCount > 0) {
    return shr(abs32(thisEdge.fQDx), 1) >= abs32(thisEdge.fQDDx) && shr(abs32(thisEdge.fQDy), 1) >= abs32(thisEdge.fQDDy) && shr(thisEdge.fQDy - thisEdge.fQDDy, thisEdge.fCurveShift) >= SK_FIXED1;
  }
  return abs32(satSub(nextEdge.fDX, thisEdge.fDX)) <= SK_FIXED1 && nextEdge.fLowerY - nextEdge.fUpperY >= SK_FIXED1;
}

function isSmoothEnough4(leftE: Edge, riteE: Edge, currE0: Edge, stopY: number): boolean {
  let currE = currE0;
  if (currE.fUpperY >= shl(stopY, 16)) return false;
  if (add32(leftE.fLowerY, SK_FIXED1) < riteE.fLowerY) return isSmoothEnough(leftE, currE);
  if (leftE.fLowerY > add32(riteE.fLowerY, SK_FIXED1)) return isSmoothEnough(riteE, currE);
  let nextCurrE = nx(currE.fNext);
  if (nextCurrE.fUpperY >= shl(stopY, 16)) return false;
  if (nextCurrE.fUpperX < currE.fUpperX) {
    const t = currE;
    currE = nextCurrE;
    nextCurrE = t;
  }
  return isSmoothEnough(leftE, currE) && isSmoothEnough(riteE, nextCurrE);
}

const SNAP_HALF = 2048;

function snapX(v: number): number {
  return floorOf(v / 4096) * 4096;
}

function walkConvexEdges(prevHead: Edge, acc: Acc, stopY: number, leftBound: number, riteBound: number, useMask: boolean): void {
  let leftE = nx(prevHead.fNext);
  let riteE = nx(leftE.fNext);
  let currE = nx(riteE.fNext);
  let y = maxNum(leftE.fUpperY, riteE.fUpperY);
  while (true) {
    while (leftE.fLowerY <= y) {
      if (!edgeUpdate(leftE)) {
        if (fixedFloorToInt(currE.fUpperY) >= stopY) return;
        leftE = currE;
        currE = nx(currE.fNext);
      }
    }
    while (riteE.fLowerY <= y) {
      if (!edgeUpdate(riteE)) {
        if (fixedFloorToInt(currE.fUpperY) >= stopY) return;
        riteE = currE;
        currE = nx(currE.fNext);
      }
    }
    if (fixedFloorToInt(y) >= stopY) break;
    goY(leftE, y);
    goY(riteE, y);
    if (leftE.fX > riteE.fX || (leftE.fX === riteE.fX && leftE.fDX > riteE.fDX)) {
      const t = leftE;
      leftE = riteE;
      riteE = t;
    }
    let localBot = minNum(leftE.fLowerY, riteE.fLowerY);
    if (isSmoothEnough4(leftE, riteE, currE, stopY)) localBot = fixedCeilToFixed(localBot);
    localBot = minNum(localBot, shl(stopY, 16));
    let left = maxNum(leftBound, leftE.fX);
    const dLeft = leftE.fDX;
    let rite = minNum(riteBound, riteE.fX);
    const dRite = riteE.fDX;
    if (dLeft === 0 && dRite === 0) {
      const fullLeft = fixedCeilToInt(left);
      const fullRite = fixedFloorToInt(rite);
      const partialLeft = shl(fullLeft, 16) - left;
      const partialRite = rite - shl(fullRite, 16);
      const fullTop = fixedCeilToInt(y);
      const fullBot = fixedFloorToInt(localBot);
      let partialTop = shl(fullTop, 16) - y;
      let partialBot = localBot - shl(fullBot, 16);
      if (fullTop > fullBot) {
        partialTop -= SK_FIXED1 - partialBot;
        partialBot = 0;
      }
      if (fullRite >= fullLeft) {
        if (partialTop > 0) {
          if (partialLeft > 0) accAntiH(acc, fullLeft - 1, fullTop - 1, 1, fixedToAlpha(fixedMul(partialTop, partialLeft)));
          accAntiH(acc, fullLeft, fullTop - 1, fullRite - fullLeft, fixedToAlpha(partialTop));
          if (partialRite > 0) accAntiH(acc, fullRite, fullTop - 1, 1, fixedToAlpha(fixedMul(partialTop, partialRite)));
          accFlushIfYChanged(acc, y, y + partialTop);
        }
        if (fullBot > fullTop && (fullRite > fullLeft || fixedToAlpha(partialLeft) > 0 || fixedToAlpha(partialRite) > 0)) {
          realBlitAntiRect(acc, fullLeft - 1, fullTop, fullRite - fullLeft, fullBot - fullTop, fixedToAlpha(partialLeft), fixedToAlpha(partialRite));
        }
        if (partialBot > 0) {
          if (partialLeft > 0) accAntiH(acc, fullLeft - 1, fullBot, 1, fixedToAlpha(fixedMul(partialBot, partialLeft)));
          accAntiH(acc, fullLeft, fullBot, fullRite - fullLeft, fixedToAlpha(partialBot));
          if (partialRite > 0) accAntiH(acc, fullRite, fullBot, 1, fixedToAlpha(fixedMul(partialBot, partialRite)));
        }
      } else {
        const width = rite - left;
        if (width > 0) {
          if (partialTop > 0) {
            accAntiH(acc, fullLeft - 1, fullTop - 1, 1, fixedToAlpha(fixedMul(partialTop, width)));
            accFlushIfYChanged(acc, y, y + partialTop);
          }
          if (fullBot > fullTop) realBlitV(acc, fullLeft - 1, fullTop, fullBot - fullTop, fixedToAlpha(width));
          if (partialBot > 0) accAntiH(acc, fullLeft - 1, fullBot, 1, fixedToAlpha(fixedMul(partialBot, width)));
        }
      }
      y = localBot;
    } else {
      left += SNAP_HALF;
      rite += SNAP_HALF;
      let count = fixedCeilToInt(localBot) - fixedFloorToInt(y);
      if (count > 1) {
        if (fixedFloorToFixed(y) !== y) {
          count--;
          const nextY = fixedCeilToFixed(y + 1);
          const dY = nextY - y;
          const nextLeft = add32(left, fixedMul(dLeft, dY));
          const nextRite = add32(rite, fixedMul(dRite, dY));
          blitTrapezoidRow(acc, shr(y, 16), snapX(left), snapX(rite), snapX(nextLeft), snapX(nextRite), leftE.fDY, riteE.fDY, partialAlphaFixed(0xff, dY), useMask, false);
          accFlushIfYChanged(acc, y, nextY);
          left = nextLeft;
          rite = nextRite;
          y = nextY;
        }
        while (count > 1) {
          count--;
          const nextY = y + SK_FIXED1;
          const nextLeft = add32(left, dLeft);
          const nextRite = add32(rite, dRite);
          blitTrapezoidRow(acc, shr(y, 16), snapX(left), snapX(rite), snapX(nextLeft), snapX(nextRite), leftE.fDY, riteE.fDY, 0xff, useMask, false);
          accFlushIfYChanged(acc, y, nextY);
          left = nextLeft;
          rite = nextRite;
          y = nextY;
        }
      }
      const dY = localBot - y;
      const nextLeft = maxNum(add32(left, fixedMul(dLeft, dY)), leftBound + SNAP_HALF);
      const nextRite = minNum(add32(rite, fixedMul(dRite, dY)), riteBound + SNAP_HALF);
      blitTrapezoidRow(acc, shr(y, 16), snapX(left), snapX(rite), snapX(nextLeft), snapX(nextRite), leftE.fDY, riteE.fDY, partialAlphaFixed(0xff, dY), useMask, false);
      accFlushIfYChanged(acc, y, localBot);
      left = nextLeft;
      rite = nextRite;
      y = localBot;
      left -= SNAP_HALF;
      rite -= SNAP_HALF;
    }
    leftE.fX = left;
    riteE.fX = rite;
    leftE.fY = y;
    riteE.fY = y;
  }
}

function removeEdge(e: Edge): void {
  nx(e.fPrev).fNext = e.fNext;
  nx(e.fNext).fPrev = e.fPrev;
}

function insertEdgeAfter(e: Edge, afterMe: Edge): void {
  e.fPrev = afterMe;
  e.fNext = afterMe.fNext;
  nx(afterMe.fNext).fPrev = e;
  afterMe.fNext = e;
}

function backwardInsertEdgeBasedOnX(e: Edge): void {
  const x = e.fX;
  let prev = nx(e.fPrev);
  while (prev.fPrev !== null && prev.fX > x) prev = prev.fPrev;
  const pn = prev.fNext;
  if (pn === null || pn !== e) {
    removeEdge(e);
    insertEdgeAfter(e, prev);
  }
}

function backwardInsertStart(prev0: Edge, x: number): Edge {
  let prev = prev0;
  while (prev.fPrev !== null && prev.fX > x) prev = prev.fPrev;
  return prev;
}

function updateNextNextY(y: number, nextY: number, nextNextY: Cell): void {
  nextNextY.v = y > nextY && y < nextNextY.v ? y : nextNextY.v;
}

function checkIntersection(e: Edge, nextY: number, nextNextY: Cell): void {
  const p = nx(e.fPrev);
  if (p.fPrev !== null && add32(p.fX, p.fDX) > add32(e.fX, e.fDX)) nextNextY.v = nextY + shr(SK_FIXED1, 2);
}

function checkIntersectionFwd(e: Edge, nextY: number, nextNextY: Cell): void {
  const n = nx(e.fNext);
  if (n.fNext !== null && add32(e.fX, e.fDX) > add32(n.fX, n.fDX)) nextNextY.v = nextY + shr(SK_FIXED1, 2);
}

function insertNewEdges(newEdge0: Edge, y: number, nextNextY: Cell): void {
  let newEdge = newEdge0;
  if (newEdge.fUpperY > y) {
    updateNextNextY(newEdge.fUpperY, y, nextNextY);
    return;
  }
  const prev = nx(newEdge.fPrev);
  if (prev.fX <= newEdge.fX) {
    while (newEdge.fUpperY <= y) {
      checkIntersection(newEdge, y, nextNextY);
      updateNextNextY(newEdge.fLowerY, y, nextNextY);
      newEdge = nx(newEdge.fNext);
    }
    updateNextNextY(newEdge.fUpperY, y, nextNextY);
    return;
  }
  let start = backwardInsertStart(prev, newEdge.fX);
  while (true) {
    const next = nx(newEdge.fNext);
    let linked = false;
    while (true) {
      const sn = nx(start.fNext);
      if (sn === newEdge) {
        linked = true;
        break;
      }
      const after = nx(start.fNext);
      if (after.fX >= newEdge.fX) break;
      start = after;
    }
    if (!linked) {
      removeEdge(newEdge);
      insertEdgeAfter(newEdge, start);
    }
    checkIntersection(newEdge, y, nextNextY);
    checkIntersectionFwd(newEdge, y, nextNextY);
    updateNextNextY(newEdge.fLowerY, y, nextNextY);
    start = newEdge;
    newEdge = next;
    if (!(newEdge.fUpperY <= y)) break;
  }
  updateNextNextY(newEdge.fUpperY, y, nextNextY);
}

function edgesTooClose(prev: Edge | null, next: Edge | null, lowerY: number): boolean {
  if (next === null || prev === null) return false;
  return next.fUpperY < lowerY && add32(prev.fX, SK_FIXED1) >= next.fX - abs32(next.fDX);
}

function rowTooClose(prevRite: number, ul: number, ll: number): boolean {
  return prevRite > fixedFloorToInt(ul) || prevRite > fixedFloorToInt(ll);
}

function walkEdges(prevHead: Edge, nextTail: Edge, evenOdd: boolean, acc: Acc, startY: number, stopY: number, leftClip: number, rightClip: number, useMask: boolean, skipIntersect: boolean): void {
  prevHead.fX = leftClip;
  prevHead.fUpperX = leftClip;
  nextTail.fX = rightClip;
  nextTail.fUpperX = rightClip;
  let y = maxNum(nx(prevHead.fNext).fUpperY, shl(startY, 16));
  const nextNextY: Cell = { v: SK_MAX_S32 };
  let edge = nx(prevHead.fNext);
  while (edge.fUpperY <= y) {
    goY(edge, y);
    updateNextNextY(edge.fLowerY, y, nextNextY);
    edge = nx(edge.fNext);
  }
  updateNextNextY(edge.fUpperY, y, nextNextY);
  while (true) {
    let w = 0;
    let inInterval = false;
    let prevX = prevHead.fX;
    let nextY = minNum(nextNextY.v, fixedCeilToFixed(y + 1));
    let currE = nx(prevHead.fNext);
    let leftE = prevHead;
    let left = leftClip;
    let leftDY = 0;
    let prevRite = fixedFloorToInt(leftClip);
    nextNextY.v = SK_MAX_S32;
    let yShift = 0;
    const step = nextY - y;
    if (isOdd(floorOf(step / 16384))) {
      yShift = 2;
      nextY = y + 16384;
    } else if (isOdd(floorOf(step / 32768))) {
      yShift = 1;
    }
    const fullAlpha = fixedToAlpha(nextY - y);
    const noRealBlitter = false;
    while (currE.fUpperY <= y) {
      w += currE.fWinding;
      const prevIn = inInterval;
      inInterval = evenOdd ? isOdd(w) : w !== 0;
      const isLeft = inInterval && !prevIn;
      const isRite = !inInterval && prevIn;
      if (isRite) {
        let rite = currE.fX;
        goYShift(currE, nextY, yShift);
        const nextLeft = maxNum(leftClip, leftE.fX);
        rite = minNum(rightClip, rite);
        const nextRite = minNum(rightClip, currE.fX);
        blitTrapezoidRow(acc, shr(y, 16), left, rite, nextLeft, nextRite, leftDY, currE.fDY, fullAlpha, useMask, noRealBlitter || (fullAlpha === 0xff && (rowTooClose(prevRite, left, leftE.fX) || edgesTooClose(currE, currE.fNext, nextY))));
        prevRite = fixedCeilToInt(maxNum(rite, currE.fX));
      } else {
        if (isLeft) {
          left = maxNum(currE.fX, leftClip);
          leftDY = currE.fDY;
          leftE = currE;
        }
        goYShift(currE, nextY, yShift);
      }
      const next = nx(currE.fNext);
      while (currE.fLowerY <= nextY) {
        if (currE.fCurveCount > 0) {
          keepContinuous(currE);
          if (!updateQuadratic(currE)) break;
        } else break;
      }
      if (currE.fLowerY <= nextY) removeEdge(currE);
      else {
        updateNextNextY(currE.fLowerY, nextY, nextNextY);
        const newX = currE.fX;
        if (newX < prevX) backwardInsertEdgeBasedOnX(currE);
        else prevX = newX;
        if (!skipIntersect) checkIntersection(currE, nextY, nextNextY);
      }
      currE = next;
    }
    if (inInterval) {
      blitTrapezoidRow(acc, shr(y, 16), left, rightClip, maxNum(leftClip, leftE.fX), rightClip, leftDY, 0, fullAlpha, useMask, noRealBlitter || (fullAlpha === 0xff && edgesTooClose(leftE.fPrev, leftE, nextY)));
    }
    y = nextY;
    if (y >= shl(stopY, 16)) break;
    insertNewEdges(currE, y, nextNextY);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// SkScan::AntiFillPath and SkScan::AAAFillPath.

function roundOut(r: FRect): IRect {
  return { left: floorOf(r.left), top: floorOf(r.top), right: -floorOf(-r.right), bottom: -floorOf(-r.bottom) };
}

function containsIRect(outer: IRect, inner: IRect): boolean {
  return inner.left < inner.right && inner.top < inner.bottom && outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom;
}

function canHandleRect(ir: IRect): boolean {
  const width = ir.right - ir.left;
  if (width > 32) return false;
  const rb = floorOf((width + 3) / 4) * 4;
  return rb * (ir.bottom - ir.top) <= 1024;
}

function makeAcc(kind: number, dev: Device, ir: IRect, clip: IRect, faults: AaFaults): Acc {
  const left = maxNum(ir.left, clip.left);
  const right = minNum(ir.right, clip.right);
  const top = maxNum(ir.top, clip.top);
  const width = kind === KIND_MASK ? 0 : right - left;
  return {
    kind,
    dev,
    faults,
    maskLeft: ir.left,
    maskTop: ir.top,
    maskWidth: ir.right - ir.left,
    mask: cells(kind === KIND_MASK ? MASK_STORAGE_BYTES : 0, 0),
    clip: { left, top, right, bottom: minNum(ir.bottom, clip.bottom) },
    left,
    width,
    top,
    currY: top - 1,
    row: cells(width, 0),
  };
}

function aaaFillPath(path: AaPath, clip: IRect, acc: Acc, startY: number, stopY: number, useMask: boolean): void {
  const built = buildEdges(path, acc.faults);
  if (built.length === 0) return;
  const list = sortEdges(built);
  for (let i = 1; i < list.length; i++) {
    (list[i - 1] as Edge).fNext = list[i] as Edge;
    (list[i] as Edge).fPrev = list[i - 1] as Edge;
  }
  const first = list[0] as Edge;
  const last = list[list.length - 1] as Edge;
  const head = newEdge();
  head.fPrev = null;
  head.fNext = first;
  head.fUpperY = SK_MIN_S32;
  head.fLowerY = SK_MIN_S32;
  head.fX = SK_MIN_S32;
  head.fDX = 0;
  head.fDY = SK_MAX_S32;
  head.fUpperX = SK_MIN_S32;
  first.fPrev = head;
  const tail = newEdge();
  tail.fPrev = last;
  tail.fNext = null;
  tail.fUpperY = SK_MAX_S32;
  tail.fLowerY = SK_MAX_S32;
  tail.fX = SK_MAX_S32;
  tail.fDX = 0;
  tail.fDY = SK_MAX_S32;
  tail.fUpperX = SK_MAX_S32;
  last.fNext = tail;
  let leftBound = shl(clip.left, 16);
  let rightBound = shl(clip.right, 16);
  if (useMask) {
    const ir = roundOut(path.bounds);
    leftBound = maxNum(leftBound, shl(ir.left, 16));
    rightBound = minNum(rightBound, shl(ir.right, 16));
  }
  if (path.convex && list.length >= 2) walkConvexEdges(head, acc, stopY, leftBound, rightBound, useMask);
  else walkEdges(head, tail, path.evenOdd, acc, startY, stopY, leftBound, rightBound, useMask, path.pts.length > (stopY - startY) * 2);
}

/** SkScan::AntiFillPath with a cc tile's rect clip, then SkScan::AAAFillPath, then the blitter's final flush or mask blit. */
export function antiFillPath(dev: Device, path: AaPath, tileClip: IRect, faults: AaFaults): void {
  const ir = roundOut(path.bounds);
  if (!(ir.left < ir.right && ir.top < ir.bottom)) return;
  if (!containsIRect(tileClip, ir)) throw new Error('SKIA-AA: a path crossing its cc tile clip is not modelled');
  if (faults.supersampleInsteadOfAAA) {
    supersampleFill(dev, path, ir, faults);
    return;
  }
  if (canHandleRect(ir)) {
    let conics = false;
    for (const v of path.verbs) if (v === VERB_CONIC) conics = true;
    if (!conics) throw new Error('SKIA-AA: try_blit_fat_anti_rect on a line-only path is not modelled');
    const acc = makeAcc(KIND_MASK, dev, ir, tileClip, faults);
    aaaFillPath(path, tileClip, acc, ir.top, ir.bottom, true);
    const c = acc.clip;
    for (let y = c.top; y < c.bottom; y++) for (let x = c.left; x < c.right; x++) blend(dev, x, y, maskCell(acc, x, y).v);
    return;
  }
  const acc = makeAcc(path.convex ? KIND_RLE : KIND_SAFE, dev, ir, tileClip, faults);
  aaaFillPath(path, tileClip, acc, ir.top, ir.bottom, false);
  accFlush(acc);
}

/** Which AAAFillPath blitter and walk a path takes: mask or RLE blitter, convex or general edge walk. */
export function aaRoute(path: AaPath): string {
  const ir = roundOut(path.bounds);
  const walk = path.convex ? 'convex' : 'edges';
  if (canHandleRect(ir)) return `mask-${walk}`;
  return path.convex ? 'rle-convex' : 'safe-rle-edges';
}

// ---------------------------------------------------------------------------------------------------------------------
// The supersampleInsteadOfAAA plant: 4x4 point sampling of the flattened path.

function flatten(path: AaPath): Pt[][] {
  const contours: Pt[][] = [];
  let cur: Pt[] = [];
  let p = 0;
  let wi = 0;
  for (const v of path.verbs) {
    if (v === VERB_MOVE) {
      if (cur.length > 0) contours.push(cur);
      cur = [path.pts[p] as Pt];
      p++;
    } else if (v === VERB_LINE) {
      cur.push(path.pts[p] as Pt);
      p++;
    } else if (v === VERB_CONIC || v === VERB_QUAD) {
      const a = cur[cur.length - 1] as Pt;
      const c = path.pts[p] as Pt;
      const b = path.pts[p + 1] as Pt;
      const w = v === VERB_CONIC ? at(path.weights, wi) : 1;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        const d = u * u + 2 * w * u * t + t * t;
        cur.push(pt((u * u * a.x + 2 * w * u * t * c.x + t * t * b.x) / d, (u * u * a.y + 2 * w * u * t * c.y + t * t * b.y) / d));
      }
      p += 2;
      if (v === VERB_CONIC) wi++;
    }
  }
  if (cur.length > 0) contours.push(cur);
  return contours;
}

function supersampleFill(dev: Device, path: AaPath, ir: IRect, faults: AaFaults): void {
  const contours = flatten(path);
  for (let y = ir.top; y < ir.bottom; y++) {
    for (let x = ir.left; x < ir.right; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4;
          const py = y + (sy + 0.5) / 4;
          let wind = 0;
          for (const c of contours) {
            for (let i = 0; i < c.length; i++) {
              const a = c[i] as Pt;
              const b = c[i + 1 < c.length ? i + 1 : 0] as Pt;
              if ((a.y <= py) !== (b.y <= py)) {
                const xi = a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y);
                if (xi < px) wind += a.y < b.y ? 1 : -1;
              }
            }
          }
          if (path.evenOdd ? isOdd(wind) : wind !== 0) n++;
        }
      }
      blend(dev, x, y, faults.coverageNotAccumulated ? 0 : minNum(255, n * 16));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// SkCanvas/SkDraw dispatch and the Blink painters.

function isIntegral(v: number): boolean {
  return floorOf(v) === v;
}

/** SkDraw::drawRect with anti-aliasing, for a rect on whole device pixels (full coverage). */
function fillIntegerRect(dev: Device, r: FRect): void {
  if (!(isIntegral(r.left) && isIntegral(r.top) && isIntegral(r.right) && isIntegral(r.bottom))) throw new Error('SKIA-AA: a fractional AA rect is not modelled');
  for (let y = r.top; y < r.bottom; y++) for (let x = r.left; x < r.right; x++) blend(dev, x, y, 255);
}

/** SkCanvas::drawRRect (fill, anti-aliased): rect and oval delegate, everything else is SkDraw::drawRRect's path. */
export function drawRRect(dev: Device, rr: SkRRect, tileClip: IRect, faults: AaFaults): void {
  if (rr.type === 'empty') return;
  if (rr.type === 'rect') {
    fillIntegerRect(dev, rr.rect);
    return;
  }
  antiFillPath(dev, rr.type === 'oval' ? ovalPath(rr.rect) : rrectPath(rr), tileClip, faults);
}

function rectContains(outer: FRect, inner: FRect): boolean {
  return inner.left < inner.right && inner.top < inner.bottom && outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom;
}

/** SkCanvas::drawDRRect (fill, anti-aliased). */
export function drawDRRect(dev: Device, outer: SkRRect, inner: SkRRect, tileClip: IRect, faults: AaFaults): void {
  if (outer.type === 'empty') return;
  if (inner.type === 'empty') {
    drawRRect(dev, outer, tileClip, faults);
    return;
  }
  if (!rectContains(outer.rect, inner.rect)) return;
  antiFillPath(dev, drrectPath(outer, inner), tileClip, faults);
}

/** A box on whole device pixels with its authored radii, zoomed to device px. */
export type RoundedBoxSpec = { readonly box: IRect; readonly radii: CornerRadii; readonly tileSize: number };

function boxRect(b: IRect): FRect {
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
}

function withRadiusClamp(r: CornerRadii): CornerRadii {
  return { topLeft: radius(r.topLeft.x, r.topLeft.y), topRight: radius(r.topRight.x, r.topRight.y), bottomRight: radius(r.bottomRight.x, r.bottomRight.y), bottomLeft: radius(r.bottomLeft.x, r.bottomLeft.y) };
}

/** ContouredBorderGeometry::PixelSnappedContouredBorder for a round-cornered box already snapped to device pixels. */
export function borderRoundedRect(spec: RoundedBoxSpec, faults: AaFaults): FloatRoundedRect {
  const fr: FloatRoundedRect = { rect: boxRect(spec.box), radii: withRadiusClamp(spec.radii) };
  return faults.rrectRadiiUnclamped || radiiIsZero(fr.radii) ? fr : constrainRadii(fr);
}

/** PixelSnappedContouredInnerBorder: the snapped rect inset by the widths, radii Outset by -widths (positive ones only). */
export function innerRoundedRect(outer: FloatRoundedRect, w: BorderWidths): FloatRoundedRect {
  const r = outer.radii;
  const o = outer.rect;
  const rect: FRect = { left: o.left + w.left, top: o.top + w.top, right: maxNum(o.left + w.left, o.right - w.right), bottom: maxNum(o.top + w.top, o.bottom - w.bottom) };
  const shrink = (c: Radius, dx: number, dy: number): Radius => radius(c.x > 0 ? f32(c.x - dx) : c.x, c.y > 0 ? f32(c.y - dy) : c.y);
  return { rect, radii: { topLeft: shrink(r.topLeft, w.left, w.top), topRight: shrink(r.topRight, w.right, w.top), bottomRight: shrink(r.bottomRight, w.right, w.bottom), bottomLeft: shrink(r.bottomLeft, w.left, w.bottom) } };
}

function tileClip(spec: RoundedBoxSpec): IRect {
  return { left: 0, top: 0, right: spec.tileSize, bottom: spec.tileSize };
}

/** BoxPainterBase's fast bottom layer for a background colour: GraphicsContext::FillRoundedRect in black. */
export function paintRoundedBackground(dev: Device, spec: RoundedBoxSpec, faults: AaFaults): void {
  const fr = borderRoundedRect(spec, faults);
  if (radiiIsZero(fr.radii) || !isRenderable(fr)) {
    fillIntegerRect(dev, fr.rect);
    return;
  }
  drawRRect(dev, toSkRRect(fr, faults), tileClip(spec), faults);
}

function nearlyEqual(a: number, b: number): boolean {
  return abs32(a - b) <= 1 / 4096;
}

function simpleCorner(o: Radius, i: Radius, stroke: number): boolean {
  if (o.x === 0 && o.y === 0 && i.x === 0 && i.y === 0) return true;
  return nearlyEqual(o.x, o.y) && nearlyEqual(i.x, i.y) && nearlyEqual(o.x, f32(i.x + stroke));
}

/** GraphicsContext.cc IsSimpleDRRect: the DRRect Blink draws as a stroked rrect instead. */
export function isSimpleDRRect(outer: FloatRoundedRect, inner: FloatRoundedRect): boolean {
  const sx = f32(inner.rect.left - outer.rect.left);
  const sy = f32(inner.rect.top - outer.rect.top);
  if (!nearlyEqual(f32(sx / sy), 1) || !nearlyEqual(sx, f32(outer.rect.right - inner.rect.right)) || !nearlyEqual(sy, f32(outer.rect.bottom - inner.rect.bottom))) return false;
  const o = outer.radii;
  const i = inner.radii;
  return simpleCorner(o.topLeft, i.topLeft, sx) && simpleCorner(o.topRight, i.topRight, sx) && simpleCorner(o.bottomRight, i.bottomRight, sx) && simpleCorner(o.bottomLeft, i.bottomLeft, sx);
}

/** BoxBorderPainter::PaintBorderFastPath for four solid black sides: GraphicsContext::FillDRRect(outer, inner). */
export function paintRoundedBorder(dev: Device, spec: RoundedBoxSpec, widths: BorderWidths, faults: AaFaults): void {
  const outer = borderRoundedRect(spec, faults);
  const inner = innerRoundedRect(outer, widths);
  if (radiiIsZero(outer.radii)) throw new Error('SKIA-AA: a square border takes DrawSolidBorderRect, which is not modelled here');
  if (!isRenderable(inner)) throw new Error('SKIA-AA: a border whose inner rrect is not renderable takes the clipped path');
  if (isSimpleDRRect(outer, inner)) throw new Error('SKIA-AA: a uniform circular border is drawn as a stroked rrect (SkStroke), not modelled yet');
  drawDRRect(dev, toSkRRect(outer, faults), toSkRRect(inner, faults), tileClip(spec), faults);
}

/** The route of a background fill: 'rect' for a plain rect fill, otherwise aaRoute of its path. */
export function backgroundRoute(spec: RoundedBoxSpec): string {
  const fr = borderRoundedRect(spec, NO_AA_FAULTS);
  if (radiiIsZero(fr.radii) || !isRenderable(fr)) return 'rect';
  const rr = toSkRRect(fr, NO_AA_FAULTS);
  if (rr.type === 'rect') return 'rect';
  return aaRoute(rr.type === 'oval' ? ovalPath(rr.rect) : rrectPath(rr));
}

/** The route of a border drawn as a DRRect. */
export function borderRoute(spec: RoundedBoxSpec, widths: BorderWidths): string {
  const outer = borderRoundedRect(spec, NO_AA_FAULTS);
  const inner = innerRoundedRect(outer, widths);
  if (isSimpleDRRect(outer, inner)) return 'stroke';
  return aaRoute(drrectPath(toSkRRect(outer, NO_AA_FAULTS), toSkRRect(inner, NO_AA_FAULTS)));
}

/** A white device crop. */
export function whiteDevice(bounds: IRect): Device {
  return { bounds, px: cells((bounds.right - bounds.left) * (bounds.bottom - bounds.top), 255) };
}

/** The device crop's gray values, row-major. */
export function devicePixels(dev: Device): number[] {
  const out: number[] = [];
  for (const c of dev.px) out.push(c.v);
  return out;
}
