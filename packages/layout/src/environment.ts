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
import type {
  BorderWidthValue,
  CalcExpr,
  FlexBasisValue,
  GapValue,
  InsetValue,
  LayoutBox,
  LayoutInput,
  LayoutStyle,
  LengthCalc,
  LineHeightValue,
  MarginValue,
  MaxSizeValue,
  MinSizeValue,
  PaddingValue,
  Percent,
  PixelsAndPercent,
  Px,
  SizeValue,
  TextLeaf,
  ViewportLength,
} from './input.ts';
import type { EngineFaults } from './block.ts';
import { calcHasPercent, evaluateCalc } from './calc.ts';
import {
  clampLengthFloat,
  clampNonNegativeDouble,
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
  inCssLengthRange,
  viewportLeafPx,
  viewportUnitBase,
  zoomCssPx,
  zoomFontSize,
  zoomViewportPx,
} from './units.ts';

/** What a length resolves against: the zoom, the viewport sizes viewport units read (R6), and the planted engine faults. */
type Env = { readonly zoom: number; readonly viewportWidth: number; readonly viewportHeight: number; readonly faults: EngineFaults };

/** The input resolved for its environment, with devicePixelRatio 1 once zoomed; the input itself when it holds nothing to resolve at DPR 1. */
export function applyEnvironment(input: LayoutInput, faults: EngineFaults): LayoutInput {
  const z = input.devicePixelRatio;
  if (z === 1 && !boxNeedsEnvironment(input.root)) return input;
  // R6, planted fault viewportUnitsUnceiled: viewport units read the CSS viewport instead of the whole device px window over z.
  const env: Env = {
    zoom: z,
    viewportWidth: faults.viewportUnitsUnceiled ? input.viewport.width : viewportUnitBase(input.viewport.width, z),
    viewportHeight: faults.viewportUnitsUnceiled ? input.viewport.height : viewportUnitBase(input.viewport.height, z),
    faults,
  };
  if (z === 1) return { viewport: input.viewport, devicePixelRatio: 1, root: resolveBox(input.root, env) };
  return {
    viewport: { width: zoomViewportPx(input.viewport.width, z), height: zoomViewportPx(input.viewport.height, z) },
    devicePixelRatio: 1,
    root: resolveBox(input.root, env),
  };
}

/** Whether any length of the box or its descendants is a calculation, which needs the pass even at DPR 1. */
function boxNeedsEnvironment(b: LayoutBox): boolean {
  const s = b.style;
  const kinds = [
    s.top.kind, s.right.kind, s.bottom.kind, s.left.kind, s.width.kind, s.height.kind, s.minWidth.kind, s.minHeight.kind, s.maxWidth.kind,
    s.maxHeight.kind, s.marginTop.kind, s.marginRight.kind, s.marginBottom.kind, s.marginLeft.kind, s.paddingTop.kind, s.paddingRight.kind,
    s.paddingBottom.kind, s.paddingLeft.kind, s.borderTopWidth.kind, s.borderRightWidth.kind, s.borderBottomWidth.kind,
    s.borderLeftWidth.kind, s.flexBasis.kind, s.rowGap.kind, s.columnGap.kind,
  ];
  for (const k of kinds) if (k === 'calc') return true;
  const lengths = [
    s.top, s.right, s.bottom, s.left, s.width, s.height, s.minWidth, s.minHeight, s.maxWidth, s.maxHeight, s.marginTop, s.marginRight,
    s.marginBottom, s.marginLeft, s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft, s.flexBasis, s.rowGap, s.columnGap,
  ];
  for (const v of lengths) if (v.kind === 'px' && !inCssLengthRange(v.value)) return true;
  for (const c of b.children) if (c.kind === 'box' && boxNeedsEnvironment(c)) return true;
  return false;
}

function resolveBox(b: LayoutBox, env: Env): LayoutBox {
  const children = b.children.map((c): LayoutBox | TextLeaf => (c.kind === 'box' ? resolveBox(c, env) : zoomText(c, env.zoom)));
  return { kind: 'box', id: b.id, boxType: b.boxType, style: resolveStyle(b.style, env), children };
}

function zoomText(t: TextLeaf, z: number): TextLeaf {
  if (z === 1) return t;
  return { ...t, font: { family: t.font.family, size: zoomFontSize(t.font.size, z) }, lineHeight: zoomLineHeight(t.lineHeight, z) };
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
  };
}

function zoomPx(v: Px, z: number): Px {
  if (z === 1) return v;
  return { kind: 'px', value: zoomCssPx(v.value, z) };
}

/** Blink ConvertToLength: a px length zoomed, then clamped to the CSS length range (ClampToCSSLengthRange) when outside it. */
function lengthPx(v: Px, z: number): Px {
  const zoomed = zoomPx(v, z);
  return inCssLengthRange(zoomed.value) ? zoomed : { kind: 'px', value: cssLengthFixed(zoomed.value) };
}

/** R5: a device-px initial line width keeps its value at every zoom; the planted spec reading zooms it like CSS px. */
function resolveBorderWidth(v: BorderWidthValue, env: Env): BorderWidthValue {
  if (v.kind === 'px') return zoomPx(v, env.zoom);
  if (v.kind === 'calc') return { kind: 'px', value: borderCalcPx(v, env) };
  if (env.faults.initialLineWidthZoomed && env.zoom !== 1) return { kind: 'device-px', value: zoomCssPx(v.value, env.zoom) };
  return v;
}

function resolveSize(v: SizeValue, env: Env): SizeValue {
  if (v.kind === 'px') return lengthPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function resolveMax(v: MaxSizeValue, env: Env): MaxSizeValue {
  if (v.kind === 'px') return lengthPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function envMargin(v: MarginValue, env: Env): MarginValue {
  if (v.kind === 'px') return lengthPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function resolveInset(v: InsetValue, env: Env): InsetValue {
  if (v.kind === 'px') return lengthPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function envPadding(v: PaddingValue, env: Env): PaddingValue {
  if (v.kind === 'px') return lengthPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function resolveBasis(v: FlexBasisValue, env: Env): FlexBasisValue {
  if (v.kind === 'px') return lengthPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

function resolveGap(v: GapValue, env: Env): GapValue {
  if (v.kind === 'px') return lengthPx(v, env.zoom);
  if (v.kind === 'calc') return resolveLengthCalc(v, env);
  return v;
}

/** Numbers multiply the zoomed font size, so only px line heights are zoomed. */
function zoomLineHeight(v: LineHeightValue, z: number): LineHeightValue {
  return v.kind === 'px' ? zoomPx(v, z) : v;
}

// ---------------------------------------------------------------- leaves (CSSLengthResolver::ZoomedComputedPixels)

/** The zoom a calculation leaf is multiplied by; planted fault calcLeafUnzoomed leaves calculation leaves in CSS px. */
function leafZoom(env: Env): number {
  return env.faults.calcLeafUnzoomed ? 1 : env.zoom;
}

function viewportBase(v: ViewportLength, env: Env): number {
  if (v.axis === 'width') return env.viewportWidth;
  if (v.axis === 'height') return env.viewportHeight;
  if (v.axis === 'min') return floatMin(env.viewportWidth, env.viewportHeight);
  return floatMax(env.viewportWidth, env.viewportHeight);
}

/** A length leaf in zoomed px, in double; null for a percentage or a number. em font sizes are CSS px at zoom 1. */
function leafPx(e: CalcExpr, env: Env): number | null {
  if (e.kind === 'px') return zoomCssPx(e.value, leafZoom(env));
  if (e.kind === 'viewport') return viewportLeafPx(e.value, viewportBase(e, env), leafZoom(env));
  if (e.kind === 'em') return emLeafPx(e.value, computeDouble(e.fontSize, { ...env, zoom: 1 }), leafZoom(env));
  return null;
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
