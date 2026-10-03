// The environment pass: the input with every length resolved for its device environment, as Blink's style resolution leaves it
// (css_length_resolver.cc, css_math_expression_node.cc and css_math_function_value.cc at 145.0.7632.6). It runs once per layout
// (layout.ts zoomInput) at every device pixel ratio.
//
// Device zoom (vectors/README.md, Device pixel ratios): at DPR N every CSS length and font size is multiplied by N, the font rules
// apply to the zoomed size, and the engine lays out in zoomed px, where borders snap to whole px. An initial line width (R5) is
// already in device px. At DPR 1 nothing is zoomed.
//
// Calculations: a calculation with no percentage is evaluated in double and stored as a float px (Length::Fixed); one whose only
// dimension is a percentage becomes a percentage; any other becomes Blink PixelsAndPercent when its sums and products allow it, and
// otherwise a CalculationExpression tree with pixels-and-percent leaves, both evaluated in float at layout (calc.ts).
//
// Fonts (V2): a text run's specified font size is an expression at zoom 1 (StyleResolverState::FontSizeConversionData), its
// computed size is specified * zoom with Chrome's minimum logical size, and font-relative leaves read the environment's root font
// size, the font's metrics from the measurer, and the line height, each unzoomed by the font's zoom and zoomed by the conversion
// zoom as CSSToLengthConversionData does. Every environment input is explicit in the LayoutInput.
import type {
  BorderWidthValue,
  CalcExpr,
  FlexBasisValue,
  FontSpec,
  GapValue,
  InsetValue,
  InlineChild,
  LayoutBox,
  LayoutInput,
  LayoutStyle,
  LengthCalc,
  LineHeightCalc,
  LineHeightValue,
  LineStrut,
  MarginValue,
  MaxSizeValue,
  MinSizeValue,
  PaddingValue,
  Percent,
  PixelsAndPercent,
  Px,
  ReplacedLeaf,
  SafeAreaInsets,
  SizeValue,
  TextLeaf,
  VerticalAlignValue,
  ViewportLength,
} from './input.ts';
import type { EngineFaults } from './block.ts';
import { calcHasPercent, evaluateCalc, resolveCalc } from './calc.ts';
import type { FontLengths, TextMeasurer } from './text.ts';
import { AHEM_FONT_DATA, ahemMeasurerWith } from './text.ts';
import {
  clampLengthFloat,
  clampNonNegativeDouble,
  calcEvaluateFloat,
  computedFontSize,
  cssLengthFixed,
  doubleAdd,
  doubleDiv,
  doubleInvert,
  doubleMaxStep,
  doubleMinStep,
  doubleMul,
  emLeafPx,
  float32,
  floatAdd,
  floatDiv,
  floatMax,
  floatMin,
  floatMul,
  fontPercentSize,
  lineHeightNumberPx,
  lineHeightPercentPx,
  metricLeafPx,
  specifiedFontSize,
  fontMetricPx,
  platformFontSize,
  fromCssPx,
  toFloat,
  toPx,
  add,
  unzoomMetric,
  viewportLeafPx,
  viewportUnitBase,
  zoomCssPx,
  zoomViewportPx,
} from './units.ts';

/** The viewport size viewport units of one kind read, in CSS px after R6. */
type ViewportBase = { readonly width: number; readonly height: number };

/**
 * What a length resolves against: the conversion zoom (1 inside font-size), the element's zoom that font metrics are unzoomed by,
 * the viewport sizes viewport units read (R6), the safe-area insets, the root font size, the measurer and the planted faults.
 */
type Env = {
  readonly zoom: number;
  readonly fontZoom: number;
  readonly small: ViewportBase;
  readonly large: ViewportBase;
  readonly dynamic: ViewportBase;
  readonly safeArea: SafeAreaInsets;
  readonly rootFontSize: number;
  readonly measurer: TextMeasurer;
  readonly faults: EngineFaults;
};

/** Blink's initial font size (medium), which planted fault rootFontSizeIgnored reads for rem. */
const INITIAL_FONT_SIZE = 16;

/** R6, planted fault viewportUnitsUnceiled: viewport units read the CSS viewport instead of the whole device px window over z. */
function viewportBase(width: number, height: number, z: number, faults: EngineFaults): ViewportBase {
  if (faults.viewportUnitsUnceiled) return { width, height };
  return { width: viewportUnitBase(width, z), height: viewportUnitBase(height, z) };
}

/**
 * The input resolved for its environment with the reference Ahem measurer and the planted font rules (layout.ts zoomInput): the
 * engine lays out only Ahem, and a device's bridge measurer is self-checked equal to the Ahem constants.
 */
export function applyEnvironment(input: LayoutInput, faults: EngineFaults): LayoutInput {
  return resolveEnvironment(input, faults, ahemMeasurerWith({ metricHalfUp: faults.metricHalfUp, untruncatedFontSize: faults.untruncatedFontSize }));
}

/** The input resolved for its environment with the measurer's font metrics, in zoomed px with devicePixelRatio 1. */
export function resolveEnvironment(input: LayoutInput, faults: EngineFaults, measurer: TextMeasurer): LayoutInput {
  const z = input.devicePixelRatio;
  if (z === 1 && !boxNeedsEnvironment(input.root, faults)) return input;
  const u = input.viewportUnits;
  const large = viewportBase(u.large.width, u.large.height, z, faults);
  const env: Env = {
    zoom: z,
    fontZoom: z,
    small: faults.viewportSizeKindIgnored ? large : viewportBase(u.small.width, u.small.height, z, faults),
    large,
    dynamic: faults.viewportSizeKindIgnored ? large : viewportBase(u.dynamic.width, u.dynamic.height, z, faults),
    safeArea: input.safeArea,
    rootFontSize: faults.rootFontSizeIgnored ? INITIAL_FONT_SIZE : input.rootFontSize,
    measurer,
    faults,
  };
  const viewport = z === 1 ? input.viewport : { width: zoomViewportPx(input.viewport.width, z), height: zoomViewportPx(input.viewport.height, z) };
  return { viewport, devicePixelRatio: 1, viewportUnits: input.viewportUnits, safeArea: input.safeArea, rootFontSize: input.rootFontSize, root: resolveBox(input.root, env) };
}

/**
 * Whether a box or its descendants hold anything to resolve at DPR 1: a calculation, or a text run whose font size or line
 * height is not already its computed px value; the pass returns such an input itself.
 */
function boxNeedsEnvironment(b: LayoutBox, faults: EngineFaults): boolean {
  if (styleNeedsEnvironment(b.style)) return true;
  if (b.strut !== null && fontNeedsEnvironment(b.strut.font, b.strut.lineHeight, faults)) return true;
  for (const c of b.children) {
    if (c.kind === 'box') {
      if (boxNeedsEnvironment(c, faults)) return true;
      continue;
    }
    if (c.kind === 'replaced') {
      if (styleNeedsEnvironment(c.style)) return true;
      continue;
    }
    if (inlineNeedsEnvironment(c, faults)) return true;
  }
  return false;
}

/** Whether an inline-level child or its descendants hold a font or line height to resolve, or an inline box a calculation. */
function inlineNeedsEnvironment(c: InlineChild, faults: EngineFaults): boolean {
  if (fontNeedsEnvironment(c.font, c.lineHeight, faults)) return true;
  if (c.kind !== 'inline') return false;
  if (styleNeedsEnvironment(c.style)) return true;
  for (const k of c.children) if (inlineNeedsEnvironment(k, faults)) return true;
  return false;
}

/** Whether a font's size or a line height is not already its computed px value at DPR 1. */
function fontNeedsEnvironment(f: FontSpec, lineHeight: LineHeightValue, faults: EngineFaults): boolean {
  if (f.specifiedSize.kind !== 'px' || f.specifiedSize.value !== f.size) return true;
  if (computedFontSize(f.size, f.absoluteSize, 1, faults.minimumFontSizeIgnored) !== f.size) return true;
  return lineHeight.kind === 'percent' || lineHeight.kind === 'calc';
}

/** Whether any length of a style is a calculation. */
function styleNeedsEnvironment(s: LayoutStyle): boolean {
  const kinds = [
    s.top.kind, s.right.kind, s.bottom.kind, s.left.kind, s.width.kind, s.height.kind, s.minWidth.kind, s.minHeight.kind, s.maxWidth.kind,
    s.maxHeight.kind, s.marginTop.kind, s.marginRight.kind, s.marginBottom.kind, s.marginLeft.kind, s.paddingTop.kind, s.paddingRight.kind,
    s.paddingBottom.kind, s.paddingLeft.kind, s.borderTopWidth.kind, s.borderRightWidth.kind, s.borderBottomWidth.kind,
    s.borderLeftWidth.kind, s.flexBasis.kind, s.rowGap.kind, s.columnGap.kind, s.verticalAlign.kind,
  ];
  for (const k of kinds) if (k === 'calc') return true;
  return false;
}

function resolveBox(b: LayoutBox, env: Env): LayoutBox {
  const children = b.children.map((c): LayoutBox | ReplacedLeaf | InlineChild => (c.kind === 'box' ? resolveBox(c, env) : c.kind === 'replaced' ? resolveReplaced(c, env) : resolveInline(c, env)));
  return { kind: 'box', id: b.id, boxType: b.boxType, style: resolveStyle(b.style, env), strut: b.strut === null ? null : resolveStrut(b.strut, env), children };
}

function resolveInline(c: InlineChild, env: Env): InlineChild {
  if (c.kind === 'text') return resolveText(c, env);
  const size = computedSize(c.font, env);
  const font: FontSpec = { family: c.font.family, size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true };
  const lineHeight = resolveLineHeightValue(c.lineHeight, size, env);
  if (c.kind === 'br') return { kind: 'br', id: c.id, font, lineHeight };
  return { kind: 'inline', id: c.id, style: resolveStyle(c.style, env), font, lineHeight, children: c.children.map((k) => resolveInline(k, env)) };
}

/** A strut at its computed font size, as a text run's (resolveText). */
function resolveStrut(s: LineStrut, env: Env): LineStrut {
  const size = computedSize(s.font, env);
  return { font: { family: s.font.family, size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true }, lineHeight: resolveLineHeightValue(s.lineHeight, size, env) };
}

/** A replaced leaf in zoomed px: its style, natural size, default object size (Blink ComputeDefaultNaturalSize scales it by the zoom) and px object-position. */
function resolveReplaced(r: ReplacedLeaf, env: Env): ReplacedLeaf {
  const z = env.zoom;
  const natural: ReplacedLeaf['natural'] = r.natural.kind === 'image' ? { kind: 'image', width: zoomCssPx(r.natural.width, z), height: zoomCssPx(r.natural.height, z) } : { kind: 'none' };
  const position = (v: ReplacedLeaf['objectPositionX']): ReplacedLeaf['objectPositionX'] => (v.kind === 'px' ? { kind: 'px', value: zoomCssPx(v.value, z) } : v);
  return {
    kind: 'replaced',
    id: r.id,
    style: resolveStyle(r.style, env),
    natural,
    defaultWidth: zoomCssPx(r.defaultWidth, z),
    defaultHeight: zoomCssPx(r.defaultHeight, z),
    objectFit: r.objectFit,
    objectPositionX: position(r.objectPositionX),
    objectPositionY: position(r.objectPositionY),
  };
}

/**
 * A text run at its computed font size, which the pass writes back as an absolute px size so a resolved input resolves to itself,
 * with a percentage or calculated line height as px at the zoom (Blink ConvertLineHeight).
 */
function resolveText(t: TextLeaf, env: Env): TextLeaf {
  const size = computedSize(t.font, env);
  const font: FontSpec = { family: t.font.family, size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true };
  return { kind: 'text', id: t.id, text: t.text, font, lineHeight: resolveLineHeightValue(t.lineHeight, size, env), whiteSpaceCollapse: t.whiteSpaceCollapse, textWrapMode: t.textWrapMode, overflowWrap: t.overflowWrap, wordBreak: t.wordBreak };
}

function resolveStyle(s: LayoutStyle, env: Env): LayoutStyle {
  return {
    ...s,
    top: resolveInset(s.top, env),
    right: resolveInset(s.right, env),
    bottom: resolveInset(s.bottom, env),
    left: resolveInset(s.left, env),
    width: resolveSize(s.width, env),
    height: resolveSize(s.height, env),
    minWidth: resolveSize(s.minWidth, env),
    minHeight: resolveSize(s.minHeight, env),
    maxWidth: resolveMax(s.maxWidth, env),
    maxHeight: resolveMax(s.maxHeight, env),
    marginTop: envMargin(s.marginTop, env),
    marginRight: envMargin(s.marginRight, env),
    marginBottom: envMargin(s.marginBottom, env),
    marginLeft: envMargin(s.marginLeft, env),
    paddingTop: envPadding(s.paddingTop, env),
    paddingRight: envPadding(s.paddingRight, env),
    paddingBottom: envPadding(s.paddingBottom, env),
    paddingLeft: envPadding(s.paddingLeft, env),
    borderTopWidth: resolveBorderWidth(s.borderTopWidth, env),
    borderRightWidth: resolveBorderWidth(s.borderRightWidth, env),
    borderBottomWidth: resolveBorderWidth(s.borderBottomWidth, env),
    borderLeftWidth: resolveBorderWidth(s.borderLeftWidth, env),
    flexBasis: resolveBasis(s.flexBasis, env),
    rowGap: resolveGap(s.rowGap, env),
    columnGap: resolveGap(s.columnGap, env),
    verticalAlign: resolveVerticalAlign(s.verticalAlign, env),
  };
}

function resolveVerticalAlign(v: VerticalAlignValue, env: Env): VerticalAlignValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function zoomPx(v: Px, z: number): Px {
  if (z === 1) return v;
  return { kind: 'px', value: zoomCssPx(v.value, z) };
}

/** R5: a device-px initial line width keeps its value at every zoom; the planted spec reading zooms it like CSS px. */
function resolveBorderWidth(v: BorderWidthValue, env: Env): BorderWidthValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return { kind: 'px', value: borderCalcPx(v, env) };
  if (env.faults.initialLineWidthZoomed && env.zoom !== 1) return { kind: 'device-px', value: zoomCssPx(v.value, env.zoom) };
  return v;
}

function resolveSize(v: SizeValue, env: Env): SizeValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function resolveMax(v: MaxSizeValue, env: Env): MaxSizeValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function envMargin(v: MarginValue, env: Env): MarginValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function resolveInset(v: InsetValue, env: Env): InsetValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function envPadding(v: PaddingValue, env: Env): PaddingValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function resolveBasis(v: FlexBasisValue, env: Env): FlexBasisValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function resolveGap(v: GapValue, env: Env): GapValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

// ---------------------------------------------------------------- fonts and line heights

/** The environment at another conversion zoom (1 inside font-size, the element's zoom for line-height); the font zoom is kept. */
function atZoom(env: Env, zoom: number): Env {
  return zoom === env.zoom ? env : { ...env, zoom };
}

/**
 * A specified font size in CSS px at zoom 1 (StyleBuilderConverter::ConvertFontSize over FontSizeConversionData): a percentage of
 * the parent's, a math function with a percentage evaluated against the parent's, or a length computed in double and stored as
 * a float, a math function clamped to its non-negative range first.
 */
function specifiedSize(e: CalcExpr, env: Env): number {
  const fenv = atZoom(env, 1);
  if (e.kind === 'font-percent') return fontPercentSize(e.value, specifiedSize(e.parent, env));
  if (e.kind === 'font-calc') {
    const v = evaluateCalc(calcValue({ kind: 'calc', expr: e.expr, range: 'non-negative' }, fenv).expr, specifiedSize(e.parent, env), env.faults);
    return specifiedFontSize(calcEvaluateFloat(v, !env.faults.calcNoNonNegClamp));
  }
  return specifiedFontSize(clampLengthFloat(clampNonNegativeDouble(computeDouble(e, fenv))));
}

/** A font's computed size in zoomed px (FontBuilder::GetComputedSizeFromSpecifiedSize at the element's zoom). */
function computedSize(font: FontSpec, env: Env): number {
  return computedFontSize(specifiedSize(font.specifiedSize, env), font.absoluteSize, env.fontZoom, env.faults.minimumFontSizeIgnored);
}

/** The float metrics of a font at its computed size; planted fault exUntruncatedFontSize reads the untruncated size. */
function fontLengths(font: FontSpec, env: Env): FontLengths {
  const size = computedSize(font, env);
  const m = env.faults.exUntruncatedFontSize ? ahemMeasurerWith({ metricHalfUp: env.faults.metricHalfUp, untruncatedFontSize: true }) : env.measurer;
  return m.lengths({ family: font.family, size });
}

/** ex, ch or cap in zoomed px at the conversion zoom (CSSToLengthConversionData::FontSizes); no x-height is em / 2, unzoomed. */
function fontMetricPxAt(metric: 'ex' | 'ch' | 'cap', font: FontSpec, env: Env, zoom: number): number {
  const lengths = fontLengths(font, env);
  if (metric === 'ex' && !(lengths.xHeight > 0)) return floatDiv(specifiedSize(font.specifiedSize, env), 2);
  const m = metric === 'ex' ? lengths.xHeight : metric === 'ch' ? lengths.zeroWidth : lengths.capHeight;
  return unzoomMetric(m, env.fontZoom, zoom);
}

/**
 * ComputedStyle::ComputedLineHeight in zoomed px: normal is the font's rounded line spacing (planted fault lhNormalUnrounded sums
 * the float metrics); a number is a percent of LayoutUnit(computed size); a percentage, px or calculation is its stored float
 * (StyleBuilderConverter::ConvertLineHeight at the element's zoom).
 */
function computedLineHeightPx(lh: LineHeightValue, font: FontSpec, env: Env): number {
  const size = computedSize(font, env);
  switch (lh.kind) {
    case 'normal': {
      if (env.faults.lhNormalUnrounded) {
        const i = platformFontSize(size);
        const d = AHEM_FONT_DATA;
        return floatAdd(floatAdd(fontMetricPx(i, d.unitsPerEm, d.ascent), fontMetricPx(i, d.unitsPerEm, d.descent)), fontMetricPx(i, d.unitsPerEm, d.lineGap));
      }
      const m = env.measurer.metrics({ family: font.family, size });
      return toPx(add(add(m.ascent, m.descent), m.lineGap));
    }
    case 'number':
      return lineHeightNumberPx(size, lh.value, env.faults.lhUnsnapped);
    case 'percent':
      return lineHeightPercentPx(size, lh.value);
    case 'px':
      return cssLengthFixed(zoomCssPx(lh.value, env.fontZoom));
    case 'calc':
      return lineHeightCalcPx(lh, size, atZoom(env, env.fontZoom));
  }
}

/**
 * A calculated line height at the element's zoom: without a percentage, Length::Fixed of its double value; with one,
 * ValueForLength of its CalculationValue against LayoutUnit(computed size), which truncates to LU.
 */
function lineHeightCalcPx(lh: LineHeightCalc, computedFontSize: number, env: Env): number {
  const c: LengthCalc = { kind: 'calc', expr: lh.expr, range: 'non-negative' };
  if (!calcHasPercent(c.expr)) return cssLengthFixed(lengthDouble(c, env));
  return toFloat(resolveCalc(calcValue(c, env), fromCssPx(computedFontSize), env.faults));
}

/** A text run's line height at the zoom: normal and numbers stay, as layout resolves them (R3); the rest become zoomed px. */
function resolveLineHeightValue(v: LineHeightValue, computedFontSize: number, env: Env): LineHeightValue {
  if (v.kind === 'px') return zoomPx(v, env.fontZoom);
  if (v.kind === 'percent') return { kind: 'px', value: lineHeightPercentPx(computedFontSize, v.value) };
  if (v.kind === 'calc') return { kind: 'px', value: lineHeightCalcPx(v, computedFontSize, atZoom(env, env.fontZoom)) };
  return v;
}

// ---------------------------------------------------------------- leaves (CSSLengthResolver::ZoomedComputedPixels)

/** The zoom a calculation leaf is multiplied by; planted fault calcLeafUnzoomed leaves calculation leaves in CSS px. */
function leafZoom(env: Env): number {
  return env.faults.calcLeafUnzoomed ? 1 : env.zoom;
}

function viewportAxisBase(v: ViewportLength, env: Env): number {
  const b = v.size === 'small' ? env.small : v.size === 'dynamic' ? env.dynamic : env.large;
  if (v.axis === 'width') return b.width;
  if (v.axis === 'height') return b.height;
  if (v.axis === 'min') return floatMin(b.width, b.height);
  return floatMax(b.width, b.height);
}

/** The inset env(safe-area-inset-<side>) substitutes; planted fault safeAreaIgnored reads 0. */
function safeAreaInset(side: 'top' | 'right' | 'bottom' | 'left', env: Env): number {
  if (env.faults.safeAreaIgnored) return 0;
  if (side === 'top') return env.safeArea.top;
  if (side === 'right') return env.safeArea.right;
  if (side === 'bottom') return env.safeArea.bottom;
  return env.safeArea.left;
}

/** A length leaf in zoomed px, in double; null for a percentage or a number. em and rem read specified font sizes at zoom 1. */
function leafPx(e: CalcExpr, env: Env): number | null {
  const z = leafZoom(env);
  switch (e.kind) {
    case 'px':
      return zoomCssPx(e.value, z);
    case 'viewport':
      return viewportLeafPx(e.value, viewportAxisBase(e, env), z);
    case 'em':
      return emLeafPx(e.value, specifiedSize(e.fontSize, env), z);
    case 'rem':
      return emLeafPx(e.value, specifiedFontSize(env.rootFontSize), z);
    case 'font-metric':
      return metricLeafPx(e.value, fontMetricPxAt(e.metric, e.font, env, z));
    case 'lh':
      return metricLeafPx(e.value, unzoomMetric(computedLineHeightPx(e.lineHeight, e.font, env), env.fontZoom, z));
    case 'env':
      return zoomCssPx(e.value * safeAreaInset(e.side, env), z);
    case 'font-percent':
    case 'font-calc':
      throw new Error(`a ${e.kind} node is a font size; it resolves only as a specified font size`);
    default:
      return null;
  }
}

// ---------------------------------------------------------------- the compute-time double path

function nanIn(values: readonly number[]): number | null {
  for (const v of values) if (Number.isNaN(v)) return v;
  return null;
}

/** A divisor kept as the inverse of a number (planted fault divideDirect divides by it instead). */
function invertedNumber(e: CalcExpr): number | null {
  if (e.kind === 'invert' && e.term.kind === 'number') return e.term.value;
  return null;
}

/** CSSMathExpressionNode::ComputeDouble: lengths in zoomed px, percentages and numbers as their values, operators in double. */
function computeDouble(e: CalcExpr, env: Env): number {
  switch (e.kind) {
    case 'px':
    case 'viewport':
    case 'em':
    case 'rem':
    case 'font-metric':
    case 'lh':
    case 'env':
    case 'font-percent':
    case 'font-calc':
      return leafPx(e, env) as number;
    case 'percent':
    case 'number':
      return e.value;
    case 'pixels-and-percent':
      return e.pixels;
    case 'sum': {
      let total = computeDouble(e.terms[0] as CalcExpr, env);
      for (let i = 1; i < e.terms.length; i++) total = doubleAdd(total, computeDouble(e.terms[i] as CalcExpr, env));
      return total;
    }
    case 'product': {
      let total = computeDouble(e.terms[0] as CalcExpr, env);
      for (let i = 1; i < e.terms.length; i++) {
        const t = e.terms[i] as CalcExpr;
        const divisor = invertedNumber(t);
        total = env.faults.divideDirect && divisor !== null ? doubleDiv(total, divisor) : doubleMul(total, computeDouble(t, env));
      }
      return total;
    }
    case 'invert':
      return doubleInvert(computeDouble(e.term, env));
    case 'min': {
      const values = e.terms.map((t) => computeDouble(t, env));
      const nan = nanIn(values);
      if (nan !== null) return nan;
      let m = values[0] as number;
      for (const v of values) m = doubleMinStep(m, v);
      return m;
    }
    case 'max': {
      const values = e.terms.map((t) => computeDouble(t, env));
      const nan = nanIn(values);
      if (nan !== null) return nan;
      let m = values[0] as number;
      for (const v of values) m = doubleMaxStep(m, v);
      return m;
    }
    case 'clamp': {
      const lo = computeDouble(e.min, env);
      const v = computeDouble(e.value, env);
      const hi = computeDouble(e.max, env);
      const nan = nanIn([lo, v, hi]);
      if (nan !== null) return nan;
      if (env.faults.clampMaxWins) return doubleMinStep(doubleMaxStep(lo, v), hi);
      return doubleMaxStep(lo, doubleMinStep(v, hi));
    }
  }
}

/** Whether a CSS-level calculation has a length leaf (its category is length or length-percentage). */
function hasLength(e: CalcExpr): boolean {
  switch (e.kind) {
    case 'px':
    case 'viewport':
    case 'em':
    case 'rem':
    case 'font-metric':
    case 'lh':
    case 'env':
    case 'font-percent':
    case 'font-calc':
      return true;
    case 'pixels-and-percent':
      return e.explicitPixels;
    case 'percent':
    case 'number':
      return false;
    case 'invert':
      return hasLength(e.term);
    case 'clamp':
      return hasLength(e.min) || hasLength(e.value) || hasLength(e.max);
    case 'sum':
    case 'product':
    case 'min':
    case 'max':
      for (const t of e.terms) if (hasLength(t)) return true;
      return false;
  }
}

// ---------------------------------------------------------------- ToPixelsAndPercent and ToCalculationExpression

function pp(pixels: number, percent: number, explicitPixels: boolean, explicitPercent: boolean): PixelsAndPercent {
  return { kind: 'pixels-and-percent', pixels, percent, explicitPixels, explicitPercent };
}

function ppAdd(a: PixelsAndPercent, b: PixelsAndPercent): PixelsAndPercent {
  return pp(floatAdd(a.pixels, b.pixels), floatAdd(a.percent, b.percent), a.explicitPixels || b.explicitPixels, a.explicitPercent || b.explicitPercent);
}

function ppScale(a: PixelsAndPercent, number: number): PixelsAndPercent {
  return pp(floatMul(a.pixels, number), floatMul(a.percent, number), a.explicitPixels, a.explicitPercent);
}

/** Planted fault divideDirect: pixels and percent divided by the number instead of multiplied by its float inverse. */
function ppDivide(a: PixelsAndPercent, number: number): PixelsAndPercent {
  return pp(floatDiv(a.pixels, number), floatDiv(a.percent, number), a.explicitPixels, a.explicitPercent);
}

/** A number literal of a product: a number, or the inverse of one that the parser folded to 1 / n in double. */
function numberLiteral(e: CalcExpr): number | null {
  if (e.kind === 'number') return e.value;
  const d = invertedNumber(e);
  return d === null ? null : doubleInvert(d);
}

/** CSSMathExpressionNode::ToPixelsAndPercent: sums and products by a number literal of length and percentage leaves; else null. */
function toPixelsAndPercent(e: CalcExpr, env: Env): PixelsAndPercent | null {
  switch (e.kind) {
    case 'px':
    case 'viewport':
    case 'em':
    case 'rem':
    case 'font-metric':
    case 'lh':
    case 'env':
    case 'font-percent':
    case 'font-calc':
      return pp(float32(leafPx(e, env) as number), 0, true, false);
    case 'percent':
      return pp(0, float32(e.value), false, true);
    case 'number':
      return pp(floatMul(float32(e.value), float32(env.zoom)), 0, true, false);
    case 'pixels-and-percent':
      return e;
    case 'sum': {
      let result = toPixelsAndPercent(e.terms[0] as CalcExpr, env);
      for (let i = 1; i < e.terms.length; i++) {
        if (result === null) return null;
        const other = toPixelsAndPercent(e.terms[i] as CalcExpr, env);
        if (other === null) return null;
        result = ppAdd(result, other);
      }
      return result;
    }
    case 'product': {
      if (e.terms.length !== 2) return null;
      const left = e.terms[0] as CalcExpr;
      const right = e.terms[1] as CalcExpr;
      const leftNumber = numberLiteral(left);
      const numberSide = leftNumber !== null ? left : numberLiteral(right) !== null ? right : null;
      if (numberSide === null) return null;
      const other = toPixelsAndPercent(numberSide === left ? right : left, env);
      if (other === null) return null;
      const divisor = invertedNumber(numberSide);
      if (env.faults.divideDirect && divisor !== null) return ppDivide(other, float32(divisor));
      return ppScale(other, float32(numberLiteral(numberSide) as number));
    }
    case 'invert':
    case 'min':
    case 'max':
    case 'clamp':
      return null;
  }
}

function isSimplePixels(e: CalcExpr): boolean {
  return e.kind === 'pixels-and-percent' && e.percent === 0;
}

function pixelsOf(e: CalcExpr): number {
  return e.kind === 'pixels-and-percent' ? e.pixels : 0;
}

/** CSSMathExpressionNode::ToCalculationExpression with CalculationExpressionOperationNode::CreateSimplified at every operator. */
function toCalcExpression(e: CalcExpr, env: Env): CalcExpr {
  switch (e.kind) {
    case 'number':
      return { kind: 'number', value: float32(e.value) };
    case 'px':
    case 'viewport':
    case 'em':
    case 'rem':
    case 'font-metric':
    case 'lh':
    case 'env':
    case 'font-percent':
    case 'font-calc':
    case 'percent':
    case 'pixels-and-percent':
      return toPixelsAndPercent(e, env) as PixelsAndPercent;
    case 'sum': {
      let acc = toCalcExpression(e.terms[0] as CalcExpr, env);
      for (let i = 1; i < e.terms.length; i++) {
        const next = toCalcExpression(e.terms[i] as CalcExpr, env);
        if (acc.kind === 'pixels-and-percent' && next.kind === 'pixels-and-percent') acc = ppAdd(acc, next);
        else if (acc.kind === 'sum') acc = { kind: 'sum', terms: [...acc.terms, next] };
        else acc = { kind: 'sum', terms: [acc, next] };
      }
      return acc;
    }
    case 'product': {
      const terms = e.terms.map((t) => toCalcExpression(t, env));
      if (terms.length !== 2) return { kind: 'product', terms };
      const lhs = terms[0] as CalcExpr;
      const rhs = terms[1] as CalcExpr;
      const numberNode = lhs.kind === 'number' ? lhs : rhs;
      const other = lhs.kind === 'number' ? rhs : lhs;
      if (numberNode.kind === 'number' && other.kind === 'pixels-and-percent') return ppScale(other, numberNode.value);
      const divisor = invertedNumber(rhs);
      if (divisor !== null && lhs.kind === 'pixels-and-percent') return ppDivide(lhs, float32(divisor));
      return { kind: 'product', terms };
    }
    case 'invert': {
      // Planted fault divideDirect keeps the inverse of a number, which calc.ts then divides by.
      if (env.faults.divideDirect && e.term.kind === 'number') return { kind: 'invert', term: { kind: 'number', value: e.term.value } };
      const term = toCalcExpression(e.term, env);
      if (term.kind === 'number') return { kind: 'number', value: float32(doubleInvert(term.value)) };
      return { kind: 'invert', term };
    }
    case 'min':
    case 'max': {
      const terms = e.terms.map((t) => toCalcExpression(t, env));
      let simple = true;
      for (const t of terms) if (!isSimplePixels(t)) simple = false;
      if (!simple) return e.kind === 'min' ? { kind: 'min', terms } : { kind: 'max', terms };
      let m = pixelsOf(terms[0] as CalcExpr);
      for (let i = 1; i < terms.length; i++) m = e.kind === 'min' ? floatMin(m, pixelsOf(terms[i] as CalcExpr)) : floatMax(m, pixelsOf(terms[i] as CalcExpr));
      return pp(m, 0, true, false);
    }
    case 'clamp': {
      const lo = toCalcExpression(e.min, env);
      const v = toCalcExpression(e.value, env);
      const hi = toCalcExpression(e.max, env);
      if (!isSimplePixels(lo) || !isSimplePixels(v) || !isSimplePixels(hi)) return { kind: 'clamp', min: lo, value: v, max: hi };
      const clamped = env.faults.clampMaxWins
        ? floatMin(floatMax(pixelsOf(lo), pixelsOf(v)), pixelsOf(hi))
        : floatMax(pixelsOf(lo), floatMin(pixelsOf(v), pixelsOf(hi)));
      return pp(clamped, 0, true, false);
    }
  }
}

// ---------------------------------------------------------------- one calculation

function nonNegative(c: LengthCalc, env: Env): boolean {
  return c.range === 'non-negative' && !env.faults.calcNoNonNegClamp;
}

/** The compute-time value of a calculation without a percentage, before the store (CSSMathFunctionValue::ComputeLengthPx). */
function lengthDouble(c: LengthCalc, env: Env): number {
  const d = computeDouble(c.expr, env);
  return nonNegative(c, env) ? clampNonNegativeDouble(d) : d;
}

/** A border width calculation: ComputeLength<float> (StyleBuilderConverter::ConvertBorderWidth); the compiler refuses percentages. */
function borderCalcPx(c: LengthCalc, env: Env): number {
  return clampLengthFloat(lengthDouble(c, env));
}

/**
 * CSSPrimitiveValue::ConvertToLength for a math function: a length is Length::Fixed of the double value; a percentage is
 * Length::Percent; any other is a CalculationValue (CSSMathExpressionNode::ToCalcValue), in PixelsAndPercent form when possible.
 */
export function resolveLengthCalc(c: LengthCalc, env: Env): Px | Percent | LengthCalc {
  if (!calcHasPercent(c.expr)) return { kind: 'px', value: cssLengthFixed(lengthDouble(c, env)) };
  if (!hasLength(c.expr)) return { kind: 'percent', value: clampLengthFloat(lengthDouble(c, env)) };
  return calcValue(c, env);
}

/**
 * CSSMathFunctionValue::ToCalcValue: the calculation as a CalculationValue, in PixelsAndPercent form when its sums and products
 * allow it and otherwise a CalculationExpression tree; a value that is NaN or infinite becomes that value clamped.
 */
function calcValue(c: LengthCalc, env: Env): LengthCalc {
  const direct = toPixelsAndPercent(c.expr, env);
  if (direct !== null) {
    if (Number.isNaN(floatAdd(direct.pixels, direct.percent))) return { kind: 'calc', expr: pp(0, 0, true, true), range: c.range };
    return { kind: 'calc', expr: pp(clampLengthFloat(direct.pixels), clampLengthFloat(direct.percent), direct.explicitPixels, direct.explicitPercent), range: c.range };
  }
  const expr = toCalcExpression(c.expr, env);
  // EvaluateValueIfNaNorInfinity: a tree that is infinite or NaN at a basis of 1 becomes that value clamped, as pixels and percent.
  const probe = evaluateCalc(expr, 1, env.faults);
  if (!Number.isFinite(probe)) {
    const clamped = clampLengthFloat(probe);
    return { kind: 'calc', expr: pp(clamped, clamped, true, true), range: c.range };
  }
  return { kind: 'calc', expr, range: c.range };
}

// ---------------------------------------------------------------- dependencies

/** Which environment inputs a layout input reads besides its viewport and ratio, so a host re-lays out only when one changes. */
export type EnvironmentDependencies = {
  readonly smallViewport: boolean;
  readonly largeViewport: boolean;
  readonly dynamicViewport: boolean;
  readonly safeArea: boolean;
  readonly rootFontSize: boolean;
};

type DependencyFlags = { small: boolean; large: boolean; dynamic: boolean; safeArea: boolean; rootFontSize: boolean };

function calcDependencies(e: CalcExpr, out: DependencyFlags): void {
  switch (e.kind) {
    case 'viewport':
      if (e.size === 'small') out.small = true;
      else if (e.size === 'dynamic') out.dynamic = true;
      else out.large = true;
      return;
    case 'rem':
      out.rootFontSize = true;
      return;
    case 'env':
      out.safeArea = true;
      return;
    case 'em':
      calcDependencies(e.fontSize, out);
      return;
    case 'font-metric':
      calcDependencies(e.font.specifiedSize, out);
      return;
    case 'lh':
      calcDependencies(e.font.specifiedSize, out);
      if (e.lineHeight.kind === 'calc') calcDependencies(e.lineHeight.expr, out);
      return;
    case 'font-percent':
      calcDependencies(e.parent, out);
      return;
    case 'font-calc':
      calcDependencies(e.expr, out);
      calcDependencies(e.parent, out);
      return;
    case 'invert':
      calcDependencies(e.term, out);
      return;
    case 'clamp':
      calcDependencies(e.min, out);
      calcDependencies(e.value, out);
      calcDependencies(e.max, out);
      return;
    case 'sum':
    case 'product':
    case 'min':
    case 'max':
      for (const t of e.terms) calcDependencies(t, out);
      return;
    case 'px':
    case 'percent':
    case 'number':
    case 'pixels-and-percent':
      return;
  }
}

function boxDependencies(b: LayoutBox, out: DependencyFlags): void {
  styleDependencies(b.style, out);
  if (b.strut !== null) fontDependencies(b.strut.font, b.strut.lineHeight, out);
  for (const c of b.children) {
    if (c.kind === 'box') boxDependencies(c, out);
    else if (c.kind === 'replaced') styleDependencies(c.style, out);
    else inlineDependencies(c, out);
  }
}

function inlineDependencies(c: InlineChild, out: DependencyFlags): void {
  fontDependencies(c.font, c.lineHeight, out);
  if (c.kind !== 'inline') return;
  styleDependencies(c.style, out);
  for (const k of c.children) inlineDependencies(k, out);
}

function fontDependencies(f: FontSpec, lineHeight: LineHeightValue, out: DependencyFlags): void {
  calcDependencies(f.specifiedSize, out);
  if (lineHeight.kind === 'calc') calcDependencies(lineHeight.expr, out);
}

/** The environment inputs one style's calculations read. */
function styleDependencies(s: LayoutStyle, out: DependencyFlags): void {
  if (s.top.kind === 'calc') calcDependencies(s.top.expr, out);
  if (s.right.kind === 'calc') calcDependencies(s.right.expr, out);
  if (s.bottom.kind === 'calc') calcDependencies(s.bottom.expr, out);
  if (s.left.kind === 'calc') calcDependencies(s.left.expr, out);
  if (s.width.kind === 'calc') calcDependencies(s.width.expr, out);
  if (s.height.kind === 'calc') calcDependencies(s.height.expr, out);
  if (s.minWidth.kind === 'calc') calcDependencies(s.minWidth.expr, out);
  if (s.minHeight.kind === 'calc') calcDependencies(s.minHeight.expr, out);
  if (s.maxWidth.kind === 'calc') calcDependencies(s.maxWidth.expr, out);
  if (s.maxHeight.kind === 'calc') calcDependencies(s.maxHeight.expr, out);
  if (s.marginTop.kind === 'calc') calcDependencies(s.marginTop.expr, out);
  if (s.marginRight.kind === 'calc') calcDependencies(s.marginRight.expr, out);
  if (s.marginBottom.kind === 'calc') calcDependencies(s.marginBottom.expr, out);
  if (s.marginLeft.kind === 'calc') calcDependencies(s.marginLeft.expr, out);
  if (s.paddingTop.kind === 'calc') calcDependencies(s.paddingTop.expr, out);
  if (s.paddingRight.kind === 'calc') calcDependencies(s.paddingRight.expr, out);
  if (s.paddingBottom.kind === 'calc') calcDependencies(s.paddingBottom.expr, out);
  if (s.paddingLeft.kind === 'calc') calcDependencies(s.paddingLeft.expr, out);
  if (s.borderTopWidth.kind === 'calc') calcDependencies(s.borderTopWidth.expr, out);
  if (s.borderRightWidth.kind === 'calc') calcDependencies(s.borderRightWidth.expr, out);
  if (s.borderBottomWidth.kind === 'calc') calcDependencies(s.borderBottomWidth.expr, out);
  if (s.borderLeftWidth.kind === 'calc') calcDependencies(s.borderLeftWidth.expr, out);
  if (s.flexBasis.kind === 'calc') calcDependencies(s.flexBasis.expr, out);
  if (s.rowGap.kind === 'calc') calcDependencies(s.rowGap.expr, out);
  if (s.columnGap.kind === 'calc') calcDependencies(s.columnGap.expr, out);
  if (s.verticalAlign.kind === 'calc') calcDependencies(s.verticalAlign.expr, out);
}

/** The environment inputs the input's tree reads (translated, so the native hosts ask the engine rather than re-walk the tree). */
export function environmentDependencies(input: LayoutInput): EnvironmentDependencies {
  const out: DependencyFlags = { small: false, large: false, dynamic: false, safeArea: false, rootFontSize: false };
  boxDependencies(input.root, out);
  return { smallViewport: out.small, largeViewport: out.large, dynamicViewport: out.dynamic, safeArea: out.safeArea, rootFontSize: out.rootFontSize };
}
