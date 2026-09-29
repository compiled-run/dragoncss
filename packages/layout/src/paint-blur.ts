// Box-shadow blur as Chrome 145 rasters it on the CPU: an exact port of Skia 2ab8add5 (Chromium 145.0.7632.6 DEPS):
// SkBlurMaskFilterImpl's nine-patch selection (src/core/SkBlurMaskFilterImpl.cpp:262-567), SkMaskFilterBase::draw_nine
// (src/core/SkMaskFilterBase.cpp:81-187), SkBlurMask::BlurRect with the cubic gaussianIntegral profile
// (src/core/SkBlurMask.cpp:319-460), SkMaskBlurFilter's triple box PlanGauss/Scan and small_blur
// (src/core/SkMaskBlurFilter.cpp:25-202, 880-975) with SkGaussFilter (src/core/SkGaussFilter.cpp). Float32 steps use fround;
// the 64-bit weight*sum is a split multiply. The generic path's source mask is trimmed as SkDraw.cpp compute_mask_bounds
// trims it (kMaxMargin 128 past the cc tile's clip). Reference only: no engine root reaches this file.
import { ccTileEnd, ccTileIndex, ccTileStart } from './paint-dither.ts';
import { floorOf, froundOf, roundOf, truncOf } from './rt-easing.ts';

/** Planted faults (T109); the Chrome pixel oracle must catch each one. */
export type BlurFaults = {
  readonly blurSigmaFormula: boolean;
  readonly ninePatchAlways: boolean;
  readonly tripleBoxRoundingOff: boolean;
};

export const NO_BLUR_FAULTS: BlurFaults = { blurSigmaFormula: false, ninePatchAlways: false, tripleBoxRoundingOff: false };

/** An integer device-pixel rect (SkIRect). */
export type IRect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** A float device-pixel rect (SkRect); every coordinate is a float32 value. */
export type FRect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** An A8 mask: one coverage byte per pixel, row-major over bounds. */
export type A8Mask = { readonly bounds: IRect; readonly data: readonly number[] };

/** Which Skia path drew a shadow. */
export type ShadowPath = 'nine-patch-rect' | 'nine-patch-rrect' | 'triple-box' | 'small-blur';

/**
 * A shadow's coverage over its bounds as the blitter receives it. `tainted` marks pixels that depend on an anti-aliased
 * source pixel (a rounded corner, or a fractional rect edge); their value here is not Chrome's (SKIA-AA, T086).
 */
export type ShadowCoverage = { readonly path: ShadowPath; readonly mask: A8Mask; readonly tainted: readonly boolean[] };

type Cell = { v: number };

/** A mask with a taint flag per pixel. */
export type TaintedMask = { readonly mask: A8Mask; readonly tainted: readonly boolean[] };

const SQRT_2PI = 2.5066282746310002;
const TWO_POW_16 = 65536;
const TWO_POW_31 = 2147483648;
const TWO_POW_32 = 4294967296;
const MAX_BLUR_SIGMA = 128;
/** SkDraw.cpp compute_mask_bounds' kMaxMargin: a mask filter's source reaches at most this far past the clip. */
const MAX_MASK_MARGIN = 128;

function f32(v: number): number {
  return froundOf(v);
}

function ceilInt(v: number): number {
  return -floorOf(-v);
}

function absNum(v: number): number {
  return v < 0 ? -v : v;
}

function minNum(a: number, b: number): number {
  return a < b ? a : b;
}

function maxNum(a: number, b: number): number {
  return a > b ? a : b;
}

/** Unsigned 16-bit wrap (skvx uint16 lanes). */
function wrap16(v: number): number {
  return v - floorOf(v / TWO_POW_16) * TWO_POW_16;
}

/** SkScalarRoundToInt: floorf(x + 0.5f). */
function roundToInt(x: number): number {
  return floorOf(f32(x + 0.5));
}

function width(r: IRect): number {
  return r.right - r.left;
}

function height(r: IRect): number {
  return r.bottom - r.top;
}

function at(xs: readonly number[], i: number): number {
  return xs[i] as number;
}

function cells(n: number): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) out.push({ v: 0 });
  return out;
}

/** Blink's box-shadow sigma: ShadowData::BlurAsSigma (radius * 0.5f), capped by computeXformedSigma at 128. */
export function shadowSigma(blurDevicePx: number, faults: BlurFaults): number {
  const blur = f32(blurDevicePx);
  // Planted: SkBlurMask::ConvertRadiusToSigma (0.57735f * radius + 0.5f) instead of the spec's half-radius.
  const sigma = faults.blurSigmaFormula ? f32(f32(f32(0.57735) * blur) + 0.5) : f32(blur * 0.5);
  return minNum(sigma, MAX_BLUR_SIGMA);
}

// ---------------------------------------------------------------------------------------------------------------------
// SkBlurMask::BlurRect (the analytic rect blur).

/** SkBlurMask.cpp gaussianIntegral: the integral of three convolved boxes, piecewise cubic, in float32. */
export function gaussianIntegral(x: number): number {
  if (x > 1.5) return 0;
  if (x < -1.5) return 1;
  const x2 = f32(x * x);
  const x3 = f32(x2 * x);
  if (x > 0.5) return f32(0.5625 - f32(f32(f32(x3 / 6) - f32(f32(3 * x2) * 0.25)) + f32(1.125 * x)));
  if (x > -0.5) return f32(0.5 - f32(f32(0.75 * x) - f32(x3 / 3)));
  return f32(0.4375 + f32(f32(f32(f32(-x3) / 6) - f32(f32(3 * x2) * 0.25)) - f32(1.125 * x)));
}

/** SkBlurMask::ComputeBlurProfile: size ceil(6 sigma) bytes, pre-inverted (255 - 255*gi). */
export function computeBlurProfile(size: number, sigma: number): number[] {
  const center = floorOf(size / 2);
  const invr = f32(1 / f32(2 * sigma));
  const out: number[] = [255];
  for (let x = 1; x < size; x++) {
    const scaledX = f32(f32(center - x - 0.5) * invr);
    out.push(255 - truncOf(f32(255 * gaussianIntegral(scaledX))));
  }
  return out;
}

/** SkBlurMask::ProfileLookup. */
function profileLookup(profile: readonly number[], loc: number, blurredWidth: number, sharpWidth: number): number {
  const dx = absNum(2 * loc + 1 - blurredWidth) - sharpWidth;
  return at(profile, maxNum(floorOf(dx / 2), 0));
}

/** SkBlurMask::ComputeBlurredScanline, with the unsigned `width - profile_size` wrap of the C++. */
export function computeBlurredScanline(profile: readonly number[], widthPx: number, sigma: number): number[] {
  const profileSize = ceilInt(f32(6 * sigma));
  const sw = widthPx - profileSize;
  // The profile's 2x-scaled center: the nearest odd number below the profile size.
  const center = profileSize - (profileSize - floorOf(profileSize / 2) * 2) - 1;
  const w = sw - center;
  // A negative sw wraps to a huge unsigned value, so the lookup branch is taken.
  const lookup = sw < 0 || profileSize <= sw;
  const out: number[] = [];
  for (let x = 0; x < widthPx; x++) {
    if (lookup) {
      out.push(profileLookup(profile, x, widthPx, w));
    } else {
      const twoSigma = f32(2 * sigma);
      const span = f32(sw / twoSigma);
      const giX = f32(1.5 - f32(f32(x + 0.5) / twoSigma));
      out.push(truncOf(f32(255 * f32(gaussianIntegral(giX) - gaussianIntegral(f32(giX + span))))));
    }
  }
  return out;
}

/** SkMulDiv255Round. */
export function mulDiv255Round(a: number, b: number): number {
  const prod = a * b + 128;
  return floorOf((prod + floorOf(prod / 256)) / 256);
}

/** The pad of SkBlurMask::BlurRect: ceil(6 sigma) / 2. */
export function blurRectPad(sigma: number): number {
  return floorOf(ceilInt(f32(6 * sigma)) / 2);
}

/** BlurRect's destination bounds (kJustComputeBounds): the rect outset by pad, each edge SkScalarRoundToInt. */
export function blurRectBounds(sigma: number, src: FRect): IRect {
  const pad = blurRectPad(sigma);
  return { left: roundToInt(f32(src.left - pad)), top: roundToInt(f32(src.top - pad)), right: roundToInt(f32(src.right + pad)), bottom: roundToInt(f32(src.bottom + pad)) };
}

/** SkBlurMask::BlurRect, kNormal_SkBlurStyle, kComputeBoundsAndRenderImage. */
export function blurRect(sigma: number, src: FRect): A8Mask {
  const bounds = blurRectBounds(sigma, src);
  const profile = computeBlurProfile(ceilInt(f32(6 * sigma)), sigma);
  const h = computeBlurredScanline(profile, width(bounds), sigma);
  const v = computeBlurredScanline(profile, height(bounds), sigma);
  const data: number[] = [];
  for (let y = 0; y < height(bounds); y++) for (let x = 0; x < width(bounds); x++) data.push(mulDiv255Round(at(h, x), at(v, y)));
  return { bounds, data };
}

// ---------------------------------------------------------------------------------------------------------------------
// SkMaskBlurFilter: the triple box (sigma >= 2) and small_blur (sigma < 2).

/** SkMaskBlurFilter.cpp PlanGauss. */
export type PlanGauss = {
  readonly weight: number;
  readonly border: number;
  readonly slidingWindow: number;
  readonly pass0Size: number;
  readonly pass1Size: number;
  readonly pass2Size: number;
};

export function planGauss(sigma: number): PlanGauss {
  const possibleWindow = floorOf((sigma * 3 * SQRT_2PI) / 4 + 0.5);
  const window = maxNum(1, possibleWindow);
  const odd = window - floorOf(window / 2) * 2 === 1;
  const border = odd ? 3 * floorOf((window - 1) / 2) : 3 * floorOf(window / 2) - 1;
  const window2 = window * window;
  const window3 = window2 * window;
  const divisor = odd ? window3 : window3 + window2;
  return {
    weight: roundOf((1 / divisor) * TWO_POW_32),
    border,
    slidingWindow: 2 * border + 1,
    pass0Size: window - 1,
    pass1Size: window - 1,
    pass2Size: odd ? window - 1 : window,
  };
}

/** Scan::finalScale: (weight * sum + 2^31) >> 32 with a 64-bit product, as a split multiply. */
export function finalScale(weight: number, sum: number, faults: BlurFaults): number {
  const wHi = floorOf(weight / TWO_POW_16);
  const wLo = weight - wHi * TWO_POW_16;
  // weight * sum = a * 2^16 + b, with a and b below 2^48.
  const a = sum * wHi;
  const b = sum * wLo;
  const aHi = floorOf(a / TWO_POW_16);
  const aLo = a - aHi * TWO_POW_16;
  // Planted: truncate instead of adding the half.
  const half = faults.tripleBoxRoundingOff ? 0 : TWO_POW_31;
  return aHi + floorOf((aLo * TWO_POW_16 + b + half) / TWO_POW_32);
}

/** One ring buffer of Scan (uint32 cells) with its cursor. */
type Ring = { readonly cells: readonly Cell[]; cursor: number };

function ringTake(r: Ring, put: number): number {
  const c = r.cells[r.cursor] as Cell;
  const old = c.v;
  c.v = put;
  r.cursor = r.cursor + 1 < r.cells.length ? r.cursor + 1 : 0;
  return old;
}

/**
 * PlanGauss::Scan::blur over one line: `src` (n values) to n + 2*border outputs. The forward pass, the no-change tail and
 * the right-to-left fill are the C++ loops; the right-to-left outputs are collected and appended in position order.
 */
export function scanLine(plan: PlanGauss, src: readonly number[], faults: BlurFaults): number[] {
  const n = src.length;
  const outLen = n + 2 * plan.border;
  const noChangeCount = plan.slidingWindow > n ? plan.slidingWindow - n : 0;
  const b0: Ring = { cells: cells(plan.pass0Size), cursor: 0 };
  const b1: Ring = { cells: cells(plan.pass1Size), cursor: 0 };
  const b2: Ring = { cells: cells(plan.pass2Size), cursor: 0 };
  const out: number[] = [];
  let sum0 = 0;
  let sum1 = 0;
  let sum2 = 0;
  for (let i = 0; i < n + noChangeCount; i++) {
    const leadingEdge = i < n ? at(src, i) : 0;
    sum0 += leadingEdge;
    sum1 += sum0;
    sum2 += sum1;
    out.push(finalScale(plan.weight, sum2, faults));
    sum2 -= ringTake(b2, sum1);
    sum1 -= ringTake(b1, sum0);
    sum0 -= ringTake(b0, leadingEdge);
  }
  // Starting from the right: the buffers are zeroed, the cursors keep their places.
  for (const c of b0.cells) c.v = 0;
  for (const c of b1.cells) c.v = 0;
  for (const c of b2.cells) c.v = 0;
  sum0 = 0;
  sum1 = 0;
  sum2 = 0;
  const tail: number[] = [];
  let srcCursor = n;
  for (let k = outLen - 1; k >= out.length; k--) {
    srcCursor -= 1;
    const leadingEdge = at(src, srcCursor);
    sum0 += leadingEdge;
    sum1 += sum0;
    sum2 += sum1;
    tail.push(finalScale(plan.weight, sum2, faults));
    sum2 -= ringTake(b2, sum1);
    sum1 -= ringTake(b1, sum0);
    sum0 -= ringTake(b0, leadingEdge);
  }
  for (let k = tail.length - 1; k >= 0; k--) out.push(at(tail, k));
  return out;
}

/** SkGaussFilter's Bessel kernel for 0 <= sigma < 2: fN factors, gauss[0] the center. */
export function gaussFilter(sigma: number): number[] {
  const variance = sigma * sigma;
  const d = ieeeExp(variance);
  const b: number[] = [besselI0(variance), besselI1(variance)];
  const gauss: number[] = [at(b, 0) / d, at(b, 1) / d];
  let n = 1;
  while (at(gauss, n) > 1 / 100) {
    b.push(-((2 * n) / variance) * at(b, n) + at(b, n - 1));
    gauss.push(at(b, n + 1) / d);
    n += 1;
  }
  // normalize(n, gauss): add from smallest to largest, divide, then put the slop into gauss[0].
  let sum = 0;
  for (let i = n - 1; i >= 1; i--) sum += 2 * at(gauss, i);
  sum += at(gauss, 0);
  const divided: number[] = [];
  for (let i = 0; i < n; i++) divided.push(at(gauss, i) / sum);
  let rest = 0;
  for (let i = n - 1; i >= 1; i--) rest += 2 * at(divided, i);
  const out: number[] = [1 - rest];
  for (let i = 1; i < n; i++) out.push(at(divided, i));
  return out;
}

function besselI0(t: number): number {
  const tSquaredOver4 = (t * t) / 4;
  let sum = 1;
  let factor = 1;
  let k = 1;
  while (factor > 1 / 1000000) {
    factor = factor * (tSquaredOver4 / (k * k));
    sum += factor;
    k += 1;
  }
  return sum;
}

function besselI1(t: number): number {
  const tSquaredOver4 = (t * t) / 4;
  let sum = t / 2;
  let factor = sum;
  let k = 1;
  while (factor > 1 / 1000000) {
    factor = factor * (tSquaredOver4 / (k * (k + 1)));
    sum += factor;
    k += 1;
  }
  return sum;
}

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.4426950408889634074;
const EXP_P1 = 1.66666666666666019037e-1;
const EXP_P2 = -2.77777777770155933842e-3;
const EXP_P3 = 6.61375632143793436117e-5;
const EXP_P4 = -1.65339022054652515390e-6;
const EXP_P5 = 4.13813679705723846039e-8;
/** fdlibm thresholds on the high word of |x|: 0x3fd62e43 (just above 0.5 ln2), 0x3ff0a2b2 (1.5 ln2), 0x3e300000 (2^-28). */
const HALF_LN2_WORD = 0.3465735912322998;
const THREE_HALF_LN2_WORD = 1.0397205352783203;
const TINY_WORD = 3.725290298461914e-9;

/**
 * fdlibm __ieee754_exp for 0 <= x < 8, the SkGaussFilter range (within one ulp of any correctly rounded exp). The subset has
 * no Math.exp; Skia calls the platform exp, and a two-ulp change of it cannot move round(gauss * 65536) (paint-blur.test.ts).
 */
export function ieeeExp(x: number): number {
  if (x < TINY_WORD) return 1 + x;
  let k = 0;
  let hi = x;
  let lo = 0;
  let r = x;
  if (x >= HALF_LN2_WORD) {
    if (x < THREE_HALF_LN2_WORD) {
      hi = x - LN2_HI;
      lo = LN2_LO;
      k = 1;
    } else {
      k = truncOf(INV_LN2 * x + 0.5);
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    r = hi - lo;
  }
  const t = r * r;
  const c = r - t * (EXP_P1 + t * (EXP_P2 + t * (EXP_P3 + t * (EXP_P4 + t * EXP_P5))));
  if (k === 0) return 1 - ((r * c) / (c - 2) - r);
  let y = 1 - (lo - (r * c) / (2 - c) - hi);
  for (let i = 0; i < k; i++) y = y * 2;
  return y;
}

/** small_blur's prepareGauss: static_cast<uint16_t>(round(d * 65536)). */
export function gaussFactors(sigma: number): number[] {
  const out: number[] = [];
  for (const d of gaussFilter(sigma)) out.push(wrap16(roundOf(d * TWO_POW_16)));
  return out;
}

/** mulhi on uint16 lanes: (a * b) >> 16. */
function mulhi(a: number, b: number): number {
  return floorOf((a * b) / TWO_POW_16);
}

/**
 * One direct_blur_y column or blur_x row of small_blur, in 8.8 fixed point: out[i] = half + sum over k in [0, 2R] of
 * mulhi(src[i - k] << 8, gauss[|R - k|]), each add wrapping at 16 bits, stored as the high byte. The vector code's d01..d78
 * recurrence and its lane shuffles compute exactly this sum; the flushed rows are the last 2R outputs.
 */
export function smallBlurLine(src: readonly number[], factors: readonly number[], radius: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < src.length + 2 * radius; i++) {
    let acc = 0x80;
    for (let k = 0; k <= 2 * radius; k++) {
      const j = i - k;
      if (j >= 0 && j < src.length) acc = wrap16(acc + mulhi(at(src, j) * 256, at(factors, absNum(radius - k))));
    }
    out.push(floorOf(acc / 256));
  }
  return out;
}

/** The margin SkMaskBlurFilter::blur reports: PlanGauss's border for sigma >= 2, SkGaussFilter's radius below. */
export function boxBlurMargin(sigma: number): number {
  if (sigma < 2) return gaussFilter(sigma).length - 1;
  return planGauss(sigma).border;
}

/** SkMaskBlurFilter::hasNoBlur with the historical 1/3 cutoff. */
export function hasNoBlur(sigma: number): boolean {
  return sigma < 1 / 3;
}

function row(mask: A8Mask, y: number): number[] {
  const w = width(mask.bounds);
  const out: number[] = [];
  for (let x = 0; x < w; x++) out.push(at(mask.data, y * w + x));
  return out;
}

/** SkBlurMask::BoxBlur for kNormal_SkBlurStyle on an A8 mask: bounds grow by the margin on every side. */
export function boxBlur(src: A8Mask, sigma: number, faults: BlurFaults): A8Mask {
  const m = boxBlurMargin(sigma);
  const srcW = width(src.bounds);
  const srcH = height(src.bounds);
  const bounds: IRect = { left: src.bounds.left - m, top: src.bounds.top - m, right: src.bounds.right + m, bottom: src.bounds.bottom + m };
  const dstW = srcW + 2 * m;
  const dstH = srcH + 2 * m;
  const cols: number[][] = [];
  if (sigma < 2) {
    // small_blur: blur_y over the source columns (into dst columns [m, m + srcW)), then blur_x over those columns.
    const factors = gaussFactors(sigma);
    const yCols: number[][] = [];
    for (let x = 0; x < srcW; x++) {
      const col: number[] = [];
      for (let y = 0; y < srcH; y++) col.push(at(src.data, y * srcW + x));
      yCols.push(smallBlurLine(col, factors, m));
    }
    const rows: number[][] = [];
    for (let y = 0; y < dstH; y++) {
      const line: number[] = [];
      for (let x = 0; x < srcW; x++) line.push(at(yCols[x] as number[], y));
      rows.push(smallBlurLine(line, factors, m));
    }
    const data: number[] = [];
    for (let y = 0; y < dstH; y++) for (let x = 0; x < dstW; x++) data.push(at(rows[y] as number[], x));
    return { bounds, data };
  }
  // Triple box: each source row blurred along x (the transposed tmp), then each tmp row (one dst column) along y.
  const plan = planGauss(sigma);
  const hRows: number[][] = [];
  for (let y = 0; y < srcH; y++) hRows.push(scanLine(plan, row(src, y), faults));
  for (let x = 0; x < dstW; x++) {
    const tmp: number[] = [];
    for (let y = 0; y < srcH; y++) tmp.push(at(hRows[y] as number[], x));
    cols.push(scanLine(plan, tmp, faults));
  }
  const data: number[] = [];
  for (let y = 0; y < dstH; y++) for (let x = 0; x < dstW; x++) data.push(at(cols[x] as number[], y));
  return { bounds, data };
}

/** Taint through a separable blur of margin m: output i reads source [i - 2m, i] along each axis. */
function blurTaint(src: readonly boolean[], srcW: number, srcH: number, m: number): boolean[] {
  const dstW = srcW + 2 * m;
  const dstH = srcH + 2 * m;
  const h: boolean[] = [];
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < dstW; x++) {
      let t = false;
      for (let j = maxNum(0, x - 2 * m); j <= minNum(srcW - 1, x); j++) if (src[y * srcW + j] as boolean) t = true;
      h.push(t);
    }
  }
  const out: boolean[] = [];
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      let t = false;
      for (let j = maxNum(0, y - 2 * m); j <= minNum(srcH - 1, y); j++) if (h[j * dstW + x] as boolean) t = true;
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Path selection and the nine-patch expansion.

function roundOut(r: FRect): IRect {
  return { left: floorOf(r.left), top: floorOf(r.top), right: ceilInt(r.right), bottom: ceilInt(r.bottom) };
}

function intersect(a: IRect, b: IRect): IRect {
  const left = maxNum(a.left, b.left);
  const top = maxNum(a.top, b.top);
  const right = maxNum(left, minNum(a.right, b.right));
  const bottom = maxNum(top, minNum(a.bottom, b.bottom));
  return { left, top, right, bottom };
}

/**
 * SkDraw.cpp compute_mask_bounds: the path bounds outset by half a pixel and rounded out, trimmed to the raster clip outset by
 * the blur margin, at most kMaxMargin. A blur wider than that loses source pixels near the clip (the cc tile) edges.
 */
export function maskBounds(pathBounds: FRect, clip: IRect, margin: number): IRect {
  const b = roundOut({ left: f32(pathBounds.left - 0.5), top: f32(pathBounds.top - 0.5), right: f32(pathBounds.right + 0.5), bottom: f32(pathBounds.bottom + 0.5) });
  const m = minNum(margin, MAX_MASK_MARGIN);
  return intersect(b, { left: clip.left - m, top: clip.top - m, right: clip.right + m, bottom: clip.bottom + m });
}

/** A solid A8 mask of a rect drawn with anti-aliasing over bounds b: whole pixels 255, partially covered pixels tainted. */
function rectMask(r: FRect, b: IRect): TaintedMask {
  const data: number[] = [];
  const tainted: boolean[] = [];
  for (let y = b.top; y < b.bottom; y++) {
    for (let x = b.left; x < b.right; x++) {
      const whole = x >= r.left && x + 1 <= r.right && y >= r.top && y + 1 <= r.bottom;
      const outside = x + 1 <= r.left || x >= r.right || y + 1 <= r.top || y >= r.bottom;
      data.push(whole ? 255 : 0);
      tainted.push(!whole && !outside);
    }
  }
  return { mask: { bounds: b, data }, tainted };
}

/**
 * An integer rect with uniform corner radius drawn with anti-aliasing (draw_rrect_into_mask). Pixels inside a corner square
 * [0, ceil(r)) depend on the analytic AA of the flattened arc and are tainted (value 0 here); all others are 0 or 255.
 */
function rrectMask(r: IRect, radius: number, b: IRect): TaintedMask {
  const c = ceilInt(radius);
  const data: number[] = [];
  const tainted: boolean[] = [];
  for (let y = b.top; y < b.bottom; y++) {
    for (let x = b.left; x < b.right; x++) {
      const inside = x >= r.left && x < r.right && y >= r.top && y < r.bottom;
      const inCornerX = x < r.left + c || x >= r.right - c;
      const inCornerY = y < r.top + c || y >= r.bottom - c;
      const corner = inside && inCornerX && inCornerY;
      data.push(inside && !corner ? 255 : 0);
      tainted.push(corner);
    }
  }
  return { mask: { bounds: b, data }, tainted };
}

/** draw_nine: expand the small blurred mask over outer, repeating column cx and row cy, the center filled at 255. */
function drawNine(mask: A8Mask, maskTaint: readonly boolean[], outer: IRect, cx: number, cy: number): TaintedMask {
  const mw = width(mask.bounds);
  const mh = height(mask.bounds);
  const innerLeft = outer.left + cx;
  const innerTop = outer.top + cy;
  const innerRight = outer.right + (cx + 1 - mw);
  const innerBottom = outer.bottom + (cy + 1 - mh);
  const data: number[] = [];
  const tainted: boolean[] = [];
  for (let y = outer.top; y < outer.bottom; y++) {
    const my = y < innerTop ? y - outer.top : y >= innerBottom ? y - outer.bottom + mh : cy;
    for (let x = outer.left; x < outer.right; x++) {
      const mx = x < innerLeft ? x - outer.left : x >= innerRight ? x - outer.right + mw : cx;
      const center = x >= innerLeft && x < innerRight && y >= innerTop && y < innerBottom;
      data.push(center ? 255 : at(mask.data, my * mw + mx));
      tainted.push(center ? false : (maskTaint[my * mw + mx] as boolean));
    }
  }
  return { mask: { bounds: outer, data }, tainted };
}

function blurred(src: TaintedMask, sigma: number, faults: BlurFaults): TaintedMask {
  const m = boxBlurMargin(sigma);
  return { mask: boxBlur(src.mask, sigma, faults), tainted: blurTaint(src.tainted, width(src.mask.bounds), height(src.mask.bounds), m) };
}

/**
 * A filled device rect drawn with a normal blur mask filter (SkDraw::drawRect -> drawPath -> SkMaskFilterBase::filterPath ->
 * filterRects): the nine-patch of an analytic BlurRect when the rect is large enough for its blur, otherwise the whole rect
 * rasterised into an A8 mask and blurred by SkMaskBlurFilter.
 */
export function rectShadowCoverage(rect: FRect, sigma: number, clip: IRect, faults: BlurFaults): ShadowCoverage {
  const srcBounds = roundOut(rect);
  const dstBounds = blurRectBounds(sigma, rect);
  let smallW = width(dstBounds) - width(srcBounds) + 2;
  let smallH = height(dstBounds) - height(srcBounds) + 2;
  const cx = smallW;
  const cy = smallH;
  smallW += 1;
  smallH += 1;
  const dx = width(srcBounds) - smallW;
  const dy = height(srcBounds) - smallH;
  const fits = dx >= 0 && dy >= 0;
  // Planted: take the nine-patch even when the rect is too small for it.
  if (fits || faults.ninePatchAlways) {
    const small: FRect = { left: rect.left, top: rect.top, right: f32(rect.right - dx), bottom: f32(rect.bottom - dy) };
    if (f32(small.right - small.left) >= 2 && f32(small.bottom - small.top) >= 2) {
      const m = blurRect(sigma, small);
      const local: A8Mask = { bounds: { left: 0, top: 0, right: width(m.bounds), bottom: height(m.bounds) }, data: m.data };
      const nine = drawNine(local, filledBool(m.data.length, false), dstBounds, cx, cy);
      return { path: 'nine-patch-rect', mask: nine.mask, tainted: nine.tainted };
    }
  }
  if (hasNoBlur(sigma)) throw new Error(`sigma ${sigma} has no blur: Skia draws the rect unblurred (not modelled)`);
  const out = blurred(rectMask(rect, maskBounds(rect, clip, boxBlurMargin(sigma))), sigma, faults);
  return { path: sigma < 2 ? 'small-blur' : 'triple-box', mask: out.mask, tainted: out.tainted };
}

function filledBool(n: number, v: boolean): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) out.push(v);
  return out;
}

/**
 * An integer device rect with one uniform corner radius (an SkRRect of kSimple type, radius below half of each side) drawn
 * with a normal blur mask filter: SkBlurMaskFilterImpl::filterRRectToNine when the rrect leaves a stretchable middle,
 * otherwise the whole rrect path rasterised and blurred. Arc-dependent pixels are tainted.
 */
export function rrectShadowCoverage(rect: IRect, radius: number, sigma: number, clip: IRect, faults: BlurFaults): ShadowCoverage {
  if (hasNoBlur(sigma)) throw new Error(`sigma ${sigma} has no blur: Skia draws the rrect unblurred (not modelled)`);
  if (!(radius > 0) || 2 * radius >= width(rect) || 2 * radius >= height(rect)) throw new Error('only simple rrects with radius below half of each side are modelled');
  const margin = boxBlurMargin(sigma);
  const unstretched = ceilInt(radius) + margin;
  const totalSmall = unstretched + unstretched + 1;
  if (totalSmall < width(rect) && totalSmall < height(rect)) {
    const small: IRect = { left: 0, top: 0, right: totalSmall, bottom: totalSmall };
    const smallRR = rrectMask(small, radius, small);
    const b = blurred(smallRR, sigma, faults);
    const local: A8Mask = { bounds: { left: 0, top: 0, right: width(b.mask.bounds), bottom: height(b.mask.bounds) }, data: b.mask.data };
    const outer: IRect = { left: rect.left - margin, top: rect.top - margin, right: rect.right + margin, bottom: rect.bottom + margin };
    const nine = drawNine(local, b.tainted, outer, margin + unstretched, margin + unstretched);
    return { path: 'nine-patch-rrect', mask: nine.mask, tainted: nine.tainted };
  }
  const pathBounds: FRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  const out = blurred(rrectMask(rect, radius, maskBounds(pathBounds, clip, margin)), sigma, faults);
  return { path: sigma < 2 ? 'small-blur' : 'triple-box', mask: out.mask, tainted: out.tainted };
}

// ---------------------------------------------------------------------------------------------------------------------
// Blink's outer box-shadow over a white page (BoxPainterBase::PaintNormalBoxShadow).

/**
 * One outer box-shadow in device pixels: the snapped border box, the zoomed spread, offset and blur, a uniform corner radius
 * (0 for a plain rect) and cc's raster tile size. The box has no background, so the shadow is clipped out of exactly the
 * border box.
 */
export type BoxShadowSpec = {
  readonly box: IRect;
  readonly radius: number;
  readonly blur: number;
  readonly spread: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly tileSize: number;
};

/** A crop of the page's gray values (R = G = B for a black shadow on white) and which values are exact. */
export type ShadowCrop = { readonly crop: IRect; readonly values: readonly number[]; readonly exact: readonly boolean[]; readonly path: ShadowPath };

/** The shadow's coverage before the clip-out, in page device pixels, as rastered into a tile whose bitmap covers clip. */
export function boxShadowCoverage(spec: BoxShadowSpec, clip: IRect, faults: BlurFaults): ShadowCoverage {
  const sigma = shadowSigma(spec.blur, faults);
  if (spec.radius > 0) {
    if (spec.spread !== 0) throw new Error('rounded shadows with spread are not modelled');
    const r: IRect = { left: spec.box.left + spec.offsetX, top: spec.box.top + spec.offsetY, right: spec.box.right + spec.offsetX, bottom: spec.box.bottom + spec.offsetY };
    if (r.left !== floorOf(r.left) || r.top !== floorOf(r.top)) throw new Error('rounded shadows need integer device offsets');
    return rrectShadowCoverage(r, spec.radius, sigma, clip, faults);
  }
  // gfx::RectF::Outset(spread) then the draw looper's translate(offset), in float32.
  const left = f32(spec.box.left - spec.spread);
  const top = f32(spec.box.top - spec.spread);
  const fill: FRect = {
    left: f32(left + spec.offsetX),
    top: f32(top + spec.offsetY),
    right: f32(f32(left + f32(width(spec.box) + f32(2 * spec.spread))) + spec.offsetX),
    bottom: f32(f32(top + f32(height(spec.box) + f32(2 * spec.spread))) + spec.offsetY),
  };
  return rectShadowCoverage(fill, sigma, clip, faults);
}

/** A tile's shadow coverage, keyed by tile column and row. */
type TileCoverage = { readonly i: number; readonly j: number; readonly cov: ShadowCoverage };

function tileClip(i: number, j: number, tileSize: number): IRect {
  return { left: ccTileStart(i, tileSize), top: ccTileStart(j, tileSize), right: ccTileEnd(i, tileSize), bottom: ccTileEnd(j, tileSize) };
}

/**
 * A black shadow blitted over white: lowp srcover of an opaque black A8 blit gives exactly 255 - coverage. Pixels inside the
 * border box are clipped out (white). Each pixel takes the coverage its cc tile rastered. A pixel is exact unless its
 * coverage is tainted or it sits in a corner square of a rounded border box (the anti-aliased clip).
 */
export function boxShadowOverWhite(spec: BoxShadowSpec, crop: IRect, faults: BlurFaults): ShadowCrop {
  const tiles: TileCoverage[] = [];
  const first = boxShadowCoverage(spec, tileClip(0, 0, spec.tileSize), faults);
  // Only a blur that reaches past kMaxMargin through the generic path depends on the tile.
  const perTile = (first.path === 'triple-box' || first.path === 'small-blur') && boxBlurMargin(shadowSigma(spec.blur, faults)) > MAX_MASK_MARGIN;
  const c = ceilInt(spec.radius);
  const values: number[] = [];
  const exact: boolean[] = [];
  for (let y = crop.top; y < crop.bottom; y++) {
    for (let x = crop.left; x < crop.right; x++) {
      let cov = first;
      if (perTile) {
        const ti = ccTileIndex(x, spec.tileSize);
        const tj = ccTileIndex(y, spec.tileSize);
        let found = false;
        for (const t of tiles) {
          if (t.i === ti && t.j === tj) {
            cov = t.cov;
            found = true;
          }
        }
        if (!found) {
          cov = boxShadowCoverage(spec, tileClip(ti, tj, spec.tileSize), faults);
          tiles.push({ i: ti, j: tj, cov });
        }
      }
      const b = cov.mask.bounds;
      const inBox = x >= spec.box.left && x < spec.box.right && y >= spec.box.top && y < spec.box.bottom;
      const nearX = (x >= spec.box.left - 1 && x < spec.box.left + c) || (x >= spec.box.right - c && x < spec.box.right + 1);
      const nearY = (y >= spec.box.top - 1 && y < spec.box.top + c) || (y >= spec.box.bottom - c && y < spec.box.bottom + 1);
      const clipAa = spec.radius > 0 && nearX && nearY;
      const inMask = x >= b.left && x < b.right && y >= b.top && y < b.bottom;
      const i = (y - b.top) * width(b) + (x - b.left);
      const coverage = inBox || !inMask ? 0 : at(cov.mask.data, i);
      values.push(255 - coverage);
      exact.push(!clipAa && !(inMask && !inBox && (cov.tainted[i] as boolean)));
    }
  }
  return { crop, values, exact, path: first.path };
}
