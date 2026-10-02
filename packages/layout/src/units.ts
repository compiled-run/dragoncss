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
 * A percentage of a LayoutUnit base as Chrome resolves it (observed; Chrome's code is in length_functions.cc): the base as a float
 * times the float percent, divided by 100 in float, then snapped to a LayoutUnit. Pinned by units, dpr-rules and calc tests.
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
 * R3: a font-relative line-height number, as Chrome resolves it (observed; Chrome does this in computed_style.cc 2568-2585 and
 * computed_style.h 893-895): the percentage (factor * 100) of the font size rounded to the nearest LayoutUnit. Pinned by
 * dpr-rules.test.ts.
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

// Calculations (css-values-4 §10). Blink evaluates a calculation twice over: in double when it has no percentage
// (CSSMathExpressionOperation::EvaluateOperator, then a float Length::Fixed), and in float at layout when it has one
// (CalculationExpressionNode::Evaluate). calc.ts and environment.ts compose these primitives and do no arithmetic of their own.

const FLOAT_MAX = 3.4028234663852886e38;
/** The largest and smallest CSS lengths Chrome keeps, INT_MAX / 64 - 2 and INT_MIN / 64 + 2 (named in Chrome's css_primitive_value.cc). */
const CSS_LENGTH_MAX = 33554429;
const CSS_LENGTH_MIN = -33554430;

/** A double stored in a float field (static_cast<float>). */
export function float32(x: number): number {
  return Math.fround(x);
}

export function floatMul(a: number, b: number): number {
  return Math.fround(a * b);
}

/** Planted fault divideDirect: a / b in float instead of a times the float inverse. */
export function floatDiv(a: number, b: number): number {
  return Math.fround(a / b);
}

/** Blink CalculationOperator::kInvert: 1.0 / denominator in double, returned as float. */
export function floatInvert(d: number): number {
  return Math.fround(1 / d);
}

/** std::min(a, b): b < a ? b : a, so NaN in a stays. */
export function floatMin(a: number, b: number): number {
  return b < a ? b : a;
}

/** std::max(a, b): a < b ? b : a. */
export function floatMax(a: number, b: number): number {
  return a < b ? b : a;
}

/** Blink CalculationExpressionPixelsAndPercentNode::Evaluate: pixels + percent / 100 * max_value, all float. */
export function pixelsAndPercentAt(pixels: number, percent: number, maxValue: number): number {
  return Math.fround(pixels + Math.fround(Math.fround(percent / 100) * maxValue));
}

/** Planted fault calcPercentPlainOrder: the plain-percent float order Chrome uses (length_functions.cc), (max * percent) / 100. */
export function pixelsAndPercentPlainOrder(pixels: number, percent: number, maxValue: number): number {
  return Math.fround(pixels + Math.fround(Math.fround(maxValue * Math.fround(percent)) / 100));
}

/** Planted fault calcDoubleEval: pixels + percent / 100 * max in double. */
export function pixelsAndPercentDouble(pixels: number, percent: number, maxValue: number): number {
  return pixels + (percent / 100) * maxValue;
}

/**
 * Blink CalculationValue::Evaluate then Length::NonNanCalculatedValue and LayoutUnit(float): a negative result of a non-negative
 * calculation is 0, NaN is 0, and the float truncates to LU.
 */
export function calcToLu(value: number, nonNegative: boolean): LU {
  if (Number.isNaN(value)) return ZERO;
  if (nonNegative && value < 0) return ZERO;
  return fromCssPx(value);
}

/** CSSValueClampingUtils::ClampLength(float): NaN is 0, and the value is clamped to the float range. */
export function clampLengthFloat(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v >= FLOAT_MAX) return FLOAT_MAX;
  if (v <= -FLOAT_MAX) return -FLOAT_MAX;
  return Math.fround(v);
}

/** CSSPrimitiveValue::ClampToCSSLengthRange: NaN is 0, then the CSS length range, as float (Length::Fixed). */
export function cssLengthFixed(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v >= CSS_LENGTH_MAX) return CSS_LENGTH_MAX;
  if (v <= CSS_LENGTH_MIN) return CSS_LENGTH_MIN;
  return Math.fround(v);
}

export function doubleAdd(a: number, b: number): number {
  return a + b;
}

export function doubleMul(a: number, b: number): number {
  return a * b;
}

/** Planted fault divideDirect in the double path: a / b. */
export function doubleDiv(a: number, b: number): number {
  return a / b;
}

/** Blink kInvert in double: 1.0 / operand. */
export function doubleInvert(d: number): number {
  return 1 / d;
}

function isNegativeZero(x: number): boolean {
  return x === 0 && 1 / x < 0;
}

/** One step of Blink EvaluateOperator kMin: std::min, except that min(0, -0) is -0. */
export function doubleMinStep(minimum: number, operand: number): number {
  if (minimum === 0 && operand === 0 && isNegativeZero(minimum) !== isNegativeZero(operand)) return -0;
  return operand < minimum ? operand : minimum;
}

/** One step of Blink EvaluateOperator kMax: std::max, except that max(-0, 0) is 0. */
export function doubleMaxStep(maximum: number, operand: number): number {
  if (maximum === 0 && operand === 0 && isNegativeZero(maximum) !== isNegativeZero(operand)) return 0;
  return maximum < operand ? operand : maximum;
}

/** The non-negative range at compute time (CSSMathFunctionValue::ClampToPermittedRange): std::max(value, 0.0). */
export function clampNonNegativeDouble(v: number): number {
  return v < 0 ? 0 : v;
}

/** R6 (platform-rules.ts viewport-device-ceil): the viewport size viewport units read, float(ceil(w * z) / z) in CSS px. */
export function viewportUnitBase(cssPx: number, zoom: number): number {
  return Math.fround(Math.ceil(cssPx * zoom) / Math.fround(zoom));
}

/** Blink ZoomedComputedPixels for vw, vh, vmin and vmax: value * (base / 100) * zoom in double. */
export function viewportLeafPx(value: number, basePx: number, zoom: number): number {
  return value * (basePx / 100) * Math.fround(zoom);
}

/** Blink ZoomedComputedPixels for em and rem: value * float(fontSize * zoom). */
export function emLeafPx(value: number, fontSizePx: number, zoom: number): number {
  return value * Math.fround(Math.fround(fontSizePx) * Math.fround(zoom));
}

// Font-relative values (V2 of the value model, css-values-4 §6.1.1 and css-fonts-4 §2.5). Blink's font sizes are floats: the
// specified size at zoom 1 (FontDescription::SpecifiedSize) and the computed size at the zoom (ComputedSize).

/** Blink kMaximumAllowedFontSize (computed_style_constants.h): specified and computed font sizes are capped at 10000px. */
const MAX_FONT_SIZE = 10000;
/** Chrome's default minimum logical font size (WebPreferences minimum_logical_font_size, measured 6px on the oracle). */
const MINIMUM_LOGICAL_FONT_SIZE = 6;
/** std::numeric_limits<float>::epsilon(). */
const FLOAT_EPSILON = 1.1920928955078125e-7;

/** FontBuilder::SetSize: a specified font size is stored as a float, capped at the maximum. */
export function specifiedFontSize(px: number): number {
  const f = Math.fround(px);
  return f < MAX_FONT_SIZE ? f : MAX_FONT_SIZE;
}

/** font-size: <percentage> (StyleBuilderConverterBase::ConvertFontSize): percent * parent / 100.0f in double, stored as float. */
export function fontPercentSize(percent: number, parentSpecified: number): number {
  return specifiedFontSize((percent * Math.fround(parentSpecified)) / 100);
}

/**
 * FontSizeFunctions::GetComputedSizeFromSpecifiedSize: 0 for a size below float epsilon; the minimum logical font size for a
 * size that is not absolute (planted fault minimumFontSizeIgnored drops it); then specified * zoom in float, capped.
 */
export function computedFontSize(specified: number, absoluteSize: boolean, zoom: number, minimumIgnored: boolean): number {
  const s = Math.fround(specified);
  if (s < FLOAT_EPSILON && s > -FLOAT_EPSILON) return 0;
  const sized = !absoluteSize && !minimumIgnored && s < MINIMUM_LOGICAL_FONT_SIZE ? MINIMUM_LOGICAL_FONT_SIZE : s;
  const zoomed = Math.fround(sized * Math.fround(zoom));
  return zoomed < MAX_FONT_SIZE ? zoomed : MAX_FONT_SIZE;
}

/** SimpleFontData x-height on macOS: the bounds of glyph x, the font instance size times float(units / unitsPerEm) in float. */
export function glyphBoundsMetricPx(instanceSizePx: number, unitsPerEm: number, units: number): number {
  return Math.fround(Math.fround(instanceSizePx) * Math.fround(units / unitsPerEm));
}

/** A font metric length at a conversion zoom: metric / fontZoom * zoom in float (CSSToLengthConversionData::FontSizes::Ex). */
export function unzoomMetric(metricPx: number, fontZoom: number, zoom: number): number {
  return Math.fround(Math.fround(Math.fround(metricPx) / Math.fround(fontZoom)) * Math.fround(zoom));
}

/** A font-relative leaf in px, value * float metric, in double (ZoomedComputedPixels kExs, kChs, kCaps, kLhs). */
export function metricLeafPx(value: number, metricPx: number): number {
  return value * Math.fround(metricPx);
}

/** base::saturated_cast<int>(double): NaN is 0, and the value truncates toward zero into the int range. */
function saturatedInt(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v >= INT_MAX) return INT_MAX;
  if (v <= INT_MIN) return INT_MIN;
  return Math.trunc(v);
}

/**
 * order from a math function (CSSMathFunctionValue::ComputeInteger, range kInteger): RoundHalfTowardsPositiveInfinity, floor(v + 0.5)
 * in double, then ClampToWithNaNTo0<int>. Planted faults: halfEven rounds a tie to the even integer; unclamped skips the int range.
 */
export function orderInteger(v: number, halfEven: boolean, unclamped: boolean): number {
  const lower = Math.floor(v);
  const tieToEven = halfEven && v - lower === 0.5;
  const rounded = tieToEven ? (Math.floor(lower / 2) * 2 === lower ? lower : lower + 1) : Math.floor(v + 0.5);
  return unclamped ? rounded : saturatedInt(rounded);
}

/** line-height: <percentage> (StyleBuilderConverter::ConvertLineHeight): float(computed * int(percent)) / 100.0, stored as float. */
export function lineHeightPercentPx(computedFontSize: number, percent: number): number {
  return Math.fround(Math.fround(Math.fround(computedFontSize) * saturatedInt(percent)) / 100);
}

/**
 * ComputedStyle::ComputedLineHeight for a number line height: MinimumValueForLength of the percent against LayoutUnit(computed
 * size), which truncates, unlike layout's FromFloatRound (R3); planted fault lhUnsnapped keeps both in float.
 */
export function lineHeightNumberPx(computedFontSize: number, factor: number, unsnapped: boolean): number {
  const percent = Math.fround(factor * 100);
  if (unsnapped) return Math.fround(Math.fround(Math.fround(computedFontSize) * percent) / 100);
  return toFloat(percentOf(fromCssPx(computedFontSize), percent));
}

/** CalculationValue::Evaluate after the expression: ClampTo<float> (NaN stays) and the non-negative clamp to 0. */
export function calcEvaluateFloat(value: number, nonNegative: boolean): number {
  const clamped = value >= FLOAT_MAX ? FLOAT_MAX : value <= -FLOAT_MAX ? -FLOAT_MAX : Math.fround(value);
  return nonNegative && clamped < 0 ? 0 : clamped;
}

// Aspect ratios (css-sizing-4 §5.1, SIZE-ar, ratio.ts).

/** Blink LayoutUnit::MulDiv: raw * m / d in int64, truncated toward zero, then clamped to int. m and d are non-negative integers below 2^31, d positive. */
export function mulDiv(v: LU, m: number, d: number): LU {
  if (d <= 0 || m < 0 || !Number.isInteger(m) || !Number.isInteger(d)) throw new Error('mulDiv needs a non-negative integer multiplier and a positive integer divisor');
  const negative = v < 0;
  const a = negative ? -v : v;
  // raw * m can pass 2^53, so m is split into 16-bit halves and the long division keeps every product exact in a double.
  const high = Math.floor(m / 65536);
  const low = m - high * 65536;
  const upper = a * high;
  const q1 = Math.floor(upper / d);
  const q2 = Math.floor(((upper - q1 * d) * 65536 + a * low) / d);
  const q = q1 * 65536 + q2;
  return saturate(negative ? 0 - q : q);
}

/** A layout ratio: two raw LayoutUnit values, both positive (StyleAspectRatio::GetLayoutRatio). */
export type LayoutRatio = { readonly width: number; readonly height: number };

function positiveRatio(width: number, height: number): LayoutRatio | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Blink LayoutRatioFromSizeF (platform/geometry/physical_size.cc, Chrome 145) for a <ratio> width / height, whose parts Blink
 * stores as float: the layout ratio, or null for a degenerate ratio, which layout treats as auto. Parts that are exact
 * LayoutUnits are kept; equal parts are 1 / 1; anything else is the float continued-fraction convergent that first comes within
 * 1e-6 of width / height, in at most 16 steps, as raw values.
 */
export function layoutRatio(ratioWidth: number, ratioHeight: number): LayoutRatio | null {
  const w = clampLengthFloat(ratioWidth);
  const h = clampLengthFloat(ratioHeight);
  const rw: number = fromCssPx(w);
  const rh: number = fromCssPx(h);
  if ((Math.fround(rw / LU_PER_PX) === w && Math.fround(rh / LU_PER_PX) === h) || w === 0 || h === 0) return positiveRatio(rw, rh);
  if (w === h) return { width: LU_PER_PX, height: LU_PER_PX };
  const initial = Math.fround(w / h);
  let x = initial;
  let h0 = 0;
  let h1 = 1;
  let k0 = 1;
  let k1 = 0;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(x)) break;
    const error = Math.fround(initial - Math.fround(Math.fround(h1) / Math.fround(k1)));
    if ((error < 0 ? -error : error) < Math.fround(0.000001)) break;
    const a: number = saturate(Math.floor(x));
    const h2: number = saturate(saturate(h1 * a) + h0);
    const k2: number = saturate(saturate(k1 * a) + k0);
    if (h2 === INT_MAX || k2 === INT_MAX) break;
    h0 = h1;
    k0 = k1;
    h1 = h2;
    k1 = k2;
    x = Math.fround(1 / Math.fround(x - Math.fround(a)));
  }
  if (h1 === 0 || k1 === 0) return positiveRatio(rw, rh);
  return positiveRatio(h1, k1);
}
