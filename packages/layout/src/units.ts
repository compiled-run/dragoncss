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

// Device zoom (vectors/README.md, Device pixel ratios): at DPR N Chrome multiplies CSS lengths and font sizes by N and lays out in
// zoomed px, so one zoomed px is one device px and one LU is 1/64 device px.

/** A CSS length at zoom N: Blink CSSToLengthConversionData::ZoomedComputedPixels, value * zoom in double (Length keeps it as float). */
export function zoomCssPx(px: number, zoom: number): number {
  return px * zoom;
}

/** R1: a viewport length at zoom N: the window is a whole number of device px, rounded up (Chrome 145 measured at 2.625; T008 note). */
export function zoomViewportPx(px: number, zoom: number): number {
  return Math.ceil(px * zoom);
}

/** A computed font size at zoom N: Blink FontSize::getComputedSizeFromSpecifiedSize, float(size) * zoom in float. */
export function zoomFontSize(sizePx: number, zoom: number): number {
  return Math.fround(Math.fround(sizePx) * zoom);
}

/** Blink LayoutUnit::FromFloatRound(float): round(float(v) * 64), halves away from zero. R2: a px line-height (ComputedLineHeightAsFixed). */
export function fromFloatRound(px: number): LU {
  return saturate(roundHalfAwayFromZero(Math.fround(px) * LU_PER_PX));
}

/** Whole CSS px as LU, for integer-pixel metrics such as rounded font ascent. */
export function fromWholePx(n: number): LU {
  if (!Number.isInteger(n)) throw new Error(`whole px expected, got ${n}`);
  return saturate(n * LU_PER_PX);
}

/**
 * Zoomed LU to whole device px, halves toward +infinity (Blink LayoutUnit::Round): floor((lu + 32) / 64). LU are 1/64 device px at
 * every DPR (layout.ts zoomInput), so the result is a device px edge; it stays a number.
 */
export function snapEdge(lu: LU): number {
  return Math.floor((lu + LU_PER_PX / 2) / LU_PER_PX);
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

/**
 * Blink SimpleFontData rounds ascent and descent to whole px. Measured on the Chrome 145 oracle (notes/T035-slice-4a.md): the
 * nearest whole px, with an exact half rounded down (12.5px Ahem: ascent 10, descent 2.5 -> 2; 10.625px: ascent 8.5 -> 8).
 */
export function roundFontMetricToWholePx(px: number): LU {
  return fromWholePx(Math.ceil(Math.fround(px) - 0.5));
}

/** Planted fault metricHalfUp: Blink's SkScalarRoundToScalar rounding (halves up), which the macOS oracle does not show. */
export function roundFontMetricHalfUpToWholePx(px: number): LU {
  return fromWholePx(Math.floor(Math.fround(px) + 0.5));
}

/**
 * The size the font instance is created at: Blink keys and creates font platform data at the font size times 100, truncated
 * (FontCacheKey precision multiplier), so 10.625px shapes and measures as 10.62px. Measured on the Chrome 145 oracle
 * (notes/T035-slice-4a.md); line-height numbers still multiply the computed font size.
 */
export function platformFontSize(fontSizePx: number): number {
  return Math.trunc(Math.fround(Math.fround(fontSizePx) * 100)) / 100;
}

/** Ahem text advance: float sum of per-glyph advances at the platform font size, then LayoutUnit::FromFloatCeil (ShapeResult::SnappedWidth). */
export function textAdvance(glyphCount: number, fontSizePx: number): LU {
  return textAdvanceAt(glyphCount, platformFontSize(fontSizePx));
}

/** textAdvance at a font instance size already chosen by the caller. */
export function textAdvanceAt(glyphCount: number, instanceSizePx: number): LU {
  let width = Math.fround(0);
  const advance = Math.fround(instanceSizePx);
  for (let i = 0; i < glyphCount; i++) width = Math.fround(width + advance);
  return fromPxCeil(width);
}

/**
 * R4, Blink ShapeResult::CachedWidth(start, end) of one text item, which the fast min-content path measures each word with
 * (line_breaker.cc HandleTextForFastMinContent, FastMinTextContext::Add). ComputePositionData stores each character's position
 * as ToCeil<LayoutUnit> of the advance sum before it, and CachedPositionForOffset(length) is FromFloatCeil(width); so a range of
 * the item is ceil(advance sum to its end) - ceil(advance sum to its start), in glyph advances from the item start. A range that
 * starts at the item start is SnappedWidth, as textAdvanceAt.
 */
export function cachedRangeWidth(startAdvances: number, endAdvances: number, instanceSizePx: number): LU {
  return sub(textAdvanceAt(endAdvances, instanceSizePx), textAdvanceAt(startAdvances, instanceSizePx));
}

/**
 * R3: a font-relative line-height number, stored by Blink as a percent Length and resolved with MinimumValueForLength against
 * ComputedFontSizeAsFixed, which is LayoutUnit::FromFloatRound(ComputedSize()) (computed_style.cc 2568-2585, computed_style.h 893-895).
 */
export function lineHeightFromNumber(fontSizePx: number, factor: number): LU {
  return percentOf(fromFloatRound(fontSizePx), Math.fround(factor * 100));
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

/** C++ integer division of two integers, truncating toward zero (track counts and line numbers). */
export function intDiv(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b) || b === 0) throw new Error(`integer division needs integers and a non-zero divisor, got ${a} / ${b}`);
  return Math.trunc(a / b);
}

/** C++ integer remainder, with the sign of the dividend. */
export function intMod(a: number, b: number): number {
  return a - intDiv(a, b) * b;
}

// Grid track sizing arithmetic (grid.ts; Blink grid_track_sizing_algorithm.cc). Blink keeps flex factors, fr sizes and leftovers in
// float32 (float, base::ClampedNumeric<float>), and an equal share of extra space in unsigned 32-bit integers.

const FLOAT_MAX = 3.4028234663852886e38;
const TWO_16 = 65536;
const TWO_32 = 4294967296;
const FLOAT_EPSILON = 1.1920928955078125e-7;

/** A float32 result, clamped to the finite float range as base::ClampedNumeric<float> saturates. */
export function clampedFloat(v: number): number {
  if (Number.isNaN(v)) return 0;
  const f = Math.fround(v);
  if (f > FLOAT_MAX) return FLOAT_MAX;
  if (f < -FLOAT_MAX) return -FLOAT_MAX;
  return f;
}

/** Blink GridSet::FlexFactor: float(flex) * track_count, in float. */
export function setFlexFactor(flex: number, trackCount: number): number {
  return Math.fround(Math.fround(flex) * trackCount);
}

/** A float32 flex sum plus or minus one factor (ClampedFloat += / -=). */
export function flexSumAdd(sum: number, factor: number): number {
  return clampedFloat(sum + factor);
}

export function flexSumSub(sum: number, factor: number): number {
  return clampedFloat(sum - factor);
}

/** Blink AreEqual<float>: |a - b| < FLT_EPSILON, computed in float. */
export function floatNearlyEqual(a: number, b: number): boolean {
  const d = Math.fround(a - b);
  return (d < 0 ? -d : d) < FLOAT_EPSILON;
}


/** int * float in float: a raw LayoutUnit times a float factor (Blink RawValue() * FlexFactor()). */
export function rawTimesFloat(v: LU, factor: number): number {
  return Math.fround(Math.fround(v) * factor);
}

/** int / float in float: Blink leftover_space.RawValue() / flex_factor_sum, the fr size. */
export function rawOverFloat(v: LU, divisor: number): number {
  return clampedFloat(Math.fround(v) / divisor);
}

/** float / float in float. */
export function floatDiv(a: number, b: number): number {
  return clampedFloat(a / b);
}

/** float * float in float. */
export function floatMul(a: number, b: number): number {
  return clampedFloat(a * b);
}

/** Blink LayoutUnit::FromRawValue(float): the float converted to int, truncating toward zero and saturating. */
export function fromRawFloat(v: number): LU {
  return saturate(Math.trunc(v));
}

/** Blink ExpandFlexibleTracks: LayoutUnit::FromRawValue(fr_share + FLT_EPSILON), the sum in float. */
export function frShareToLu(frShare: number): LU {
  return fromRawFloat(clampedFloat(frShare + FLOAT_EPSILON));
}

/** Planted fault frFloat64: the fr size, the fr shares and the leftover in double instead of float. */
export function doubleQuotient(v: LU, divisor: number): number {
  return v / divisor;
}

export function doubleShare(fr: number, factor: number, leftover: number): number {
  return fr * factor + leftover;
}

export function doubleShareToLu(share: number): LU {
  return fromRawFloat(share + FLOAT_EPSILON);
}

export function doubleLeftover(share: number, expanded: LU): number {
  const d = share - expanded;
  return d > 0 ? d : 0;
}

/** Blink ClampMax(fr_share - expanded_size.RawValue(), 0): the float leftover carried to the next flexible set. */
export function frLeftover(frShare: number, expanded: LU): number {
  const d = clampedFloat(frShare - Math.fround(expanded));
  return d > 0 ? d : 0;
}

/** True when a LayoutUnit is at either saturation bound (LayoutUnit::MightBeSaturated). */
export function mightBeSaturated(v: LU): boolean {
  return v === INT_MAX || v === INT_MIN;
}

/** x mod 2^32 for 0 <= x < 2^49, without the % operator. */
function mod32(x: number): number {
  return x - Math.floor(x / TWO_32) * TWO_32;
}

/**
 * Blink DistributeExtraSpaceToSets for an equal distribution: FromRawValue((extra.RawValue() * set_track_count) /
 * growable_track_count), where int * wtf_size_t is computed in unsigned 32-bit arithmetic and wraps, the quotient is unsigned
 * integer division, and FromRawValue takes the unsigned result as an int.
 */
export function equalShare(extra: LU, setTrackCount: number, growableTrackCount: number): LU {
  if (!Number.isInteger(setTrackCount) || !Number.isInteger(growableTrackCount) || growableTrackCount <= 0) {
    throw new Error(`equalShare needs integer counts and a positive divisor, got ${setTrackCount} / ${growableTrackCount}`);
  }
  const a = mod32(extra);
  const high = Math.floor(a / TWO_16);
  const low = a - high * TWO_16;
  const product = mod32(mod32(high * setTrackCount) * TWO_16 + low * setTrackCount);
  const quotient = Math.floor(product / growableTrackCount);
  return saturate(quotient > INT_MAX ? quotient - TWO_32 : quotient);
}

/** Blink DistributeExtraSpaceToSets for flex-weighted sets: FromRawValue((extra.RawValue() * ratio) / ratio_sum), in float. */
export function weightedShare(extra: LU, ratio: number, ratioSum: number): LU {
  return fromRawFloat(clampedFloat(rawTimesFloat(extra, ratio) / ratioSum));
}

// Shaping arithmetic (TXT1-S, shaping.ts): HarfBuzz positions are 16.16 fixed point, Blink's InlineLayoutUnit (FixedPoint<16, int64>).

/** InlineLayoutUnit::ToFloat: static_cast<float>(raw) / 65536, in float. */
export function inlineToFloat(raw: number): number {
  return Math.fround(Math.fround(raw) / 65536);
}

/** float + float, in float: how Blink sums ShapeResult run widths and ShapeResultView part widths. */
export function floatAdd(a: number, b: number): number {
  return Math.fround(a + b);
}

/** InlineLayoutUnit::ToCeil<LayoutUnit>: a 16.16 value as 1/64 px, rounded up (raw / 1024 is exact in a double). */
export function inlineToLayoutUnitCeil(raw: number): LU {
  return saturate(Math.ceil(raw / 1024));
}

/**
 * R5, traced (docs/research/text-spike/metric-rounding): Core Text keeps a vertical metric as a 16.16 fraction of the em and returns
 * (fraction * upem) * (size / upem) in CGFloat; Skia stores it as a float and Blink rounds with SkScalarRoundToScalar, floorf(x + 0.5f).
 * Probed for sizes 0.01 to 192 px; Skia measures sizes above 256 px on a 64 px strike, which this does not model.
 */
export function roundCoreTextMetricToWholePx(units: number, unitsPerEm: number, sizePx: number): LU {
  const coreText = ((Math.round((units * 65536) / unitsPerEm) * unitsPerEm) / 65536) * (sizePx / unitsPerEm);
  return fromWholePx(Math.floor(Math.fround(Math.fround(coreText) + 0.5)));
}
