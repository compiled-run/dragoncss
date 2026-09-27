// Blink LayoutUnit arithmetic. This is the only file in @dragon/layout allowed to round or hold floats.
// LU holds Blink's raw LayoutUnit value: an int32 count of 1/64 CSS px (third_party/blink/renderer/platform/geometry/layout_unit.h).

declare const luBrand: unique symbol;
export type LU = number & { readonly [luBrand]: 'LU' };

declare const factorBrand: unique symbol;
/** A double-precision accumulator of flex factors, as Blink keeps total_flex_grow / total_weighted_flex_shrink. */
export type FactorSum = number & { readonly [factorBrand]: 'FactorSum' };

export const LU_PER_PX = 64;
const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

function saturate(v: number): LU {
  if (Number.isNaN(v)) return 0 as LU;
  if (v > INT_MAX) return INT_MAX as LU;
  if (v < INT_MIN) return INT_MIN as LU;
  return v as LU;
}

export const ZERO: LU = 0 as LU;

export function fromRaw(raw: number): LU {
  if (!Number.isInteger(raw)) throw new Error(`LayoutUnit raw value must be an integer, got ${raw}`);
  return saturate(raw);
}

/** Blink LayoutUnit(float): saturated_cast<int>(float(v) * 64), truncating toward zero. */
export function fromCssPx(px: number): LU {
  return saturate(Math.trunc(Math.fround(Math.fround(px) * LU_PER_PX)));
}

/** Blink LayoutUnit(double): saturated_cast<int>(v * 64), truncating toward zero. */
export function fromDouble(px: number): LU {
  return saturate(Math.trunc(px * LU_PER_PX));
}

/** Blink LayoutUnit::FromFloatRound: std::round(v * 64), halves away from zero. */
export function fromPxRound(px: number): LU {
  return saturate(roundHalfAwayFromZero(px * LU_PER_PX));
}

/** Blink LayoutUnit::FromFloatCeil: ceil(float(v) * 64). */
export function fromPxCeil(px: number): LU {
  return saturate(Math.ceil(Math.fround(Math.fround(px) * LU_PER_PX)));
}

/**
 * Blink StyleBuilderConverter::ConvertBorderWidth (css-values-4 §6.1 line-width snapping): a width of at least one device px
 * floors to whole device px, a thinner non-zero width becomes one device px. S1 measured thin/medium/thick and fractional
 * widths at DPR 1; other ratios are unverified against Chrome.
 */
export function snapBorderWidth(cssPx: number, devicePixelRatio: number): LU {
  const device = cssPx * devicePixelRatio;
  const snapped = device >= 1 ? Math.floor(device) : device > 0 ? 1 : 0;
  return fromCssPx(snapped / devicePixelRatio);
}

/** Whole CSS px as LU, for integer-pixel metrics such as rounded font ascent. */
export function fromWholePx(n: number): LU {
  if (!Number.isInteger(n)) throw new Error(`whole px expected, got ${n}`);
  return saturate(n * LU_PER_PX);
}

/** LayoutUnit::ToFloat. */
export function toFloat(v: LU): number {
  return Math.fround(v / LU_PER_PX);
}

/** Exact CSS px value of an LU (raw / 64 is exact in a double). */
export function toPx(v: LU): number {
  return v / LU_PER_PX;
}

export function add(a: LU, b: LU): LU {
  return saturate(a + b);
}

export function sub(a: LU, b: LU): LU {
  return saturate(a - b);
}

export function sum(values: readonly LU[]): LU {
  let total = ZERO;
  for (const v of values) total = add(total, v);
  return total;
}

export function neg(a: LU): LU {
  return saturate(-a);
}

export function max(a: LU, b: LU): LU {
  return (a > b ? a : b);
}

export function min(a: LU, b: LU): LU {
  return (a < b ? a : b);
}

export function clampNegativeToZero(a: LU): LU {
  return a < 0 ? ZERO : a;
}

/** Blink operator*(LayoutUnit, int). */
export function mulInt(a: LU, n: number): LU {
  if (!Number.isInteger(n)) throw new Error(`integer multiplier expected, got ${n}`);
  return saturate(a * n);
}

/** Blink operator/(LayoutUnit, int): FromRawValue(raw / n), C++ integer division truncating toward zero. */
export function divInt(a: LU, n: number): LU {
  if (!Number.isInteger(n) || n === 0) throw new Error(`non-zero integer divisor expected, got ${n}`);
  return saturate(Math.trunc(a / n));
}

/** Blink LayoutUnit::Floor(): the largest whole px not above the value, as LU. */
export function floorToWholePx(a: LU): LU {
  return saturate(Math.floor(a / LU_PER_PX) * LU_PER_PX);
}

/**
 * Blink MinimumValueForLength / ValueForLength for kPercent (length_functions.cc):
 * LayoutUnit(static_cast<float>(maximum_value * length.Percent() / 100.0f)), where LayoutUnit * float yields a float.
 */
export function percentOf(base: LU, percent: number): LU {
  const product = Math.fround(toFloat(base) * Math.fround(percent));
  const quotient = Math.fround(product / Math.fround(100));
  return fromCssPx(quotient);
}

/** Skia SkScalarRoundToScalar(x) = floor(x + 0.5), used by Blink SimpleFontData for ascent and descent. */
export function roundFontMetricToWholePx(px: number): LU {
  return fromWholePx(Math.floor(Math.fround(px) + 0.5));
}

/** Ahem text advance: float sum of per-glyph advances, then LayoutUnit::FromFloatCeil (ShapeResult::SnappedWidth). */
export function textAdvance(glyphCount: number, fontSizePx: number): LU {
  let width = Math.fround(0);
  const advance = Math.fround(fontSizePx);
  for (let i = 0; i < glyphCount; i++) width = Math.fround(width + advance);
  return fromPxCeil(width);
}

/** A font-relative line-height number, stored by Blink as a percent Length and resolved with MinimumValueForLength. */
export function lineHeightFromNumber(fontSizePx: number, factor: number): LU {
  return percentOf(fromCssPx(fontSizePx), Math.fround(factor * 100));
}

/** Integer-px scalar helper for font metrics from units per em. */
export function fontMetricPx(fontSizePx: number, unitsPerEm: number, units: number): number {
  return Math.fround((Math.fround(fontSizePx) * units) / unitsPerEm);
}

function roundHalfAwayFromZero(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

// Flex factor arithmetic (flexible_box_algorithm.cc, FlexLine::ResolveFlexibleLengths / FreezeViolations).

export const FACTOR_ZERO: FactorSum = 0 as FactorSum;

export function factorAdd(total: FactorSum, v: number): FactorSum {
  return (total + v) as FactorSum;
}

/** Blink clamps total_weighted_flex_shrink at 0 after subtracting (std::max(total, 0.0)). */
export function factorSubClampZero(total: FactorSum, v: number): FactorSum {
  const next = total - v;
  return (next < 0 ? 0 : next) as FactorSum;
}

export function factorValue(total: FactorSum): number {
  return total;
}

/** Blink flex_shrink * flex_base_content_size: float * LayoutUnit yields a float. */
export function shrinkWeight(shrink: number, base: LU): number {
  return Math.fround(Math.fround(shrink) * toFloat(base));
}

/** Blink extra_space = remaining_free_space * flex_grow / total_flex_grow; child_size += LayoutUnit::FromFloatRound(extra_space). */
export function growShare(remaining: LU, grow: number, total: FactorSum): LU {
  const extra = Math.fround(toFloat(remaining) * Math.fround(grow)) / total;
  return Number.isFinite(extra) ? fromPxRound(extra) : ZERO;
}

/** Blink extra_space = remaining_free_space * flex_shrink * flex_base_content_size / total_weighted_flex_shrink, rounded by FromFloatRound. */
export function shrinkShare(remaining: LU, shrink: number, base: LU, totalWeighted: FactorSum): LU {
  const scaled = Math.fround(Math.fround(toFloat(remaining) * Math.fround(shrink)) * toFloat(base));
  const extra = scaled / totalWeighted;
  return Number.isFinite(extra) ? fromPxRound(extra) : ZERO;
}

/** Blink: LayoutUnit fractional(initial_free_space * sum_flex_factors) for flex factor sums below one (LayoutUnit * double yields a double). */
export function fractionalFreeSpace(initialFree: LU, factorSum: FactorSum): LU {
  return fromDouble((initialFree / LU_PER_PX) * factorSum);
}

export function isFiniteFactorSum(total: FactorSum): boolean {
  return Number.isFinite(total);
}

// Content distribution (css-align-3 §5.3). Chrome 145 places item or line k at a truncated leading share plus a rounded cumulative
// share of the free space; notes/T026-slice-2.md pins this over 2,280 justify-content and align-content probes. Positive amounts only.

/** round(total * k / parts), halves up: the offset before item k under justify-content: space-between. */
export function cumulativeShareRounded(total: LU, k: number, parts: number): LU {
  if (total < 0 || parts <= 0) throw new Error('cumulativeShareRounded needs a non-negative total and positive parts');
  return saturate(Math.floor((2 * total * k + parts) / (2 * parts)));
}

/** trunc(total * numerator / denominator): offsets under space-around and space-evenly. */
export function cumulativeShareTruncated(total: LU, numerator: number, denominator: number): LU {
  if (total < 0 || denominator <= 0) throw new Error('cumulativeShareTruncated needs a non-negative total and a positive denominator');
  return saturate(Math.trunc((total * numerator) / denominator));
}

export type DistributedMode = 'space-between' | 'space-around' | 'space-evenly';

/**
 * Offset before item k of n under a distributed alignment (Blink ContentDistributionSpaceBetweenChildren accumulated per item):
 * space-between round(free*k/(n-1)); space-around trunc(free/2n) + round(free*k/n); space-evenly trunc(free/(n+1)) + round(free*k/(n+1)).
 */
export function distributedOffset(mode: DistributedMode, free: LU, n: number, k: number): LU {
  if (mode === 'space-between') return n > 1 ? cumulativeShareRounded(free, k, n - 1) : ZERO;
  if (mode === 'space-around') return add(cumulativeShareTruncated(free, 1, 2 * n), cumulativeShareRounded(free, k, n));
  return add(cumulativeShareTruncated(free, 1, n + 1), cumulativeShareRounded(free, k, n + 1));
}
