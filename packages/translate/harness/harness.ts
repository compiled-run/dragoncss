// The differential test harness, written in the translator subset and translated with the engine. Each case is one JSON line;
// each result is one line with every double as its IEEE bit pattern, so TypeScript and native runs compare byte for byte.
import type { EngineFaults } from '../../layout/src/block.ts';
import type {
  AlignContent,
  AspectRatioValue,
  AlignItems,
  AlignSelf,
  BorderWidthValue,
  BoxSizing,
  BoxType,
  CalcExpr,
  Direction,
  Display,
  FlexBasisValue,
  FlexDirection,
  FlexWrap,
  FontSpec,
  GapValue,
  InlineBox,
  InlineChild,
  GridAutoRepeat,
  GridContainerStyle,
  GridItemStyle,
  GridLine,
  GridLineName,
  GridSelfAlign,
  GridSpan,
  InsetValue,
  JustifyContent,
  LayoutBox,
  LayoutInput,
  LayoutStyle,
  LengthCalc,
  LineHeightCalc,
  LineBreak,
  LineHeightValue,
  LineStrut,
  MarginValue,
  NaturalSizeValue,
  ObjectFit,
  ObjectPositionValue,
  ReplacedLeaf,
  MaxSizeValue,
  MinSizeValue,
  Overflow,
  PaddingValue,
  Position,
  SafeAreaSide,
  SizeValue,
  TextAlign,
  TextLeaf,
  TextWrapMode,
  VerticalAlignKeyword,
  VerticalAlignValue,
  ViewportLength,
  ViewportSize,
  Viewport,
  TrackBreadth,
  TrackRepeater,
  TrackSize,
} from '../../layout/src/input.ts';
import type { LayoutRect } from '../../layout/src/layout.ts';
import { absoluteRects, layoutWithFaults } from '../../layout/src/layout.ts';
import { measurerFor } from '../../layout/src/platform.ts';
import type { GlyphShaper, HanKerningFontData, ShapedItem, ShapeResult, ShapingFaults } from '../../layout/src/shaping.ts';
import { GLYPH_STRIDE, latinScopedMeasurer, makeItem, shapeItem, viewSnappedWidth, wholeView } from '../../layout/src/shaping.ts';
import type { FontData, FontLengths, FontMetrics, MeasureResult, TextMeasurer } from '../../layout/src/text.ts';
import { fontMetricLengths } from '../../layout/src/text.ts';
import type { TextFont } from '../../layout/src/input.ts';
import type { ScrollMetrics } from '../../layout/src/overflow.ts';
import { scrollMetricsWithFaults } from '../../layout/src/overflow.ts';
import { snapEdges } from '../../layout/src/snap.ts';
import type { BorderOp, DashFaults } from '../../layout/src/paint-dash.ts';
import { borderNeedsSidePainter, borderPaintOps, selectBestDashGap } from '../../layout/src/paint-dash.ts';
import type { DistributedMode, FactorSum, LU } from '../../layout/src/units.ts';
import {
  cachedRangeWidth,
  calcToLu,
  clampLengthFloat,
  cssLengthFixed,
  cumulativeShareRounded,
  distributedOffset,
  divInt,
  doubleMaxStep,
  doubleMinStep,
  emLeafPx,
  floatInvert,
  fractionalFreeSpace,
  fromCssPx,
  fromDouble,
  fromFloatRound,
  fromPxCeil,
  fromPxRound,
  fontMetricPx,
  fromRaw,
  growShare,
  inlineToFloat,
  lineHeightFromNumber,
  percentOf,
  pixelsAndPercentAt,
  platformFontSize,
  roundCoreTextMetricToWholePx,
  roundFontMetricHalfUpToWholePx,
  roundFontMetricToWholePx,
  shrinkShare,
  sub,
  snapBorderWidth,
  snapEdge,
  textAdvance,
  viewportLeafPx,
  viewportUnitBase,
  zoomCssPx,
  zoomFontSize,
  zoomViewportPx,
  ZERO,
} from '../../layout/src/units.ts';
import type { AnimationEntry, AnimationState, KeyframesRule } from '../../layout/src/rt-animations.ts';
import { runAnimationScript } from '../../layout/src/rt-animations.ts';
import type { EasingSpec, RtFaults, StepPosition } from '../../layout/src/rt-easing.ts';
import { cubicBezier, easingFromSpec, LINEAR, solveBezier } from '../../layout/src/rt-easing.ts';
import type { TransformOrigin } from '../../layout/src/paint-transform.ts';
import { mapPoint, paintTransformMatrix, resolveTransformOrigin, transformAboutPoint, transformFunctionsMatrix } from '../../layout/src/paint-transform.ts';
import type { AnimatedValue, LegacyColor, LengthValue, Matrix2D, TransformFn, TransformOp, Trig, ValueRange } from '../../layout/src/rt-interpolate.ts';
import { interpolateValue, serializeValue } from '../../layout/src/rt-interpolate.ts';
import type { RuleKeyframe } from '../../layout/src/rt-keyframes.ts';
import { groupFromRule, sampleKeyframeEffect } from '../../layout/src/rt-keyframes.ts';
import type { EffectTimingSpec, FillMode, PlaybackDirection, SecondsTiming } from '../../layout/src/rt-timing.ts';
import { advanceHeld, computeSecondsTiming, computeTiming, currentTimeAt, HELD_ZERO, seekPaused } from '../../layout/src/rt-timing.ts';
import type { ScriptStep, TransitionListing, TransitionState } from '../../layout/src/rt-transition.ts';
import { runTransitionScript } from '../../layout/src/rt-transition.ts';
import type { HitFact, HitFaults, HitTableFaults } from '../../layout/src/rt-hit.ts';
import { hitGrid, hitRuns, hitTableOf } from '../../layout/src/rt-hit.ts';
import type { AnimationTable, AnimatorFaults, AnimatorState, AnimTables, BaseTable, ClosureTable, EasingCode, EasingKind, EntryCode, KeyframeBlock, KeyframesTable, KeyframeValue, ListingCode, ListingMode, RenderedTable, SlotTable, TrackKind, TrackRef, ValueCode, ValueKind } from '../../layout/src/rt-animator.ts';
import { animatorAdvance, animatorEvent, animatorFrame, animatorStart, frameColors } from '../../layout/src/rt-animator.ts';
import type { ForcedKind, InteractionFaults, InteractionPointer, InteractionTables } from '../../layout/src/rt-interaction.ts';
import { activeMatches, checkInteractionTables, focusMatch, focusVisibleMatch, forcePseudo, hoverExitStarted, hoverMatches, interactionCombo, interactionFrame, interactionStart, interactionState, keyboardFocused, keyPressed, layoutChanged, mousePressed, mouseReleased, pointerExited, pointerMoved, remapPointer, touchCancelled, touchPressed, touchReleased } from '../../layout/src/rt-interaction.ts';
import type { BackgroundLayer, BackgroundPaint, BoxKeyword, CssStop, GradientImage, LayerGeometry, LengthPct, RepeatKeyword, SizeComponent, StopColor } from '../../layout/src/paint-gradient.ts';
import { backgroundRow, fma64, gradientDesc, gradientFaults, hypotF32, planBackground, sqrtF64 } from '../../layout/src/paint-gradient.ts';
import { bitsHex, fromCodePoints, hexBits, parseNumber } from './host.ts';
import type { RadiusFaults, RadiusLength } from '../../layout/src/paint-radius.ts';
import { constrainCornerRadii, hasRoundedCorner, innerCornerRadii, outlineOffsetPx, outlineRings, outlineWidthPx, radiiRenderable, radiusComponent, resolveCornerRadii, roundedShape } from '../../layout/src/paint-radius.ts';
import type { BackdropFill, ShadowFaults, ShadowInput, ShadowLayer, ShadowShape } from '../../layout/src/paint-shadow.ts';
import { backdropAt, blurredCoverage, encodeOver, insetShadowLayer, insetShadowLayerOver, outerShadowLayer, outerShadowLayerOver, platformOver, shapeCoverage, shapeType, spreadShape } from '../../layout/src/paint-shadow.ts';

/** A malformed case line; the native decoders reject exactly what this decoder rejects. */
export class HarnessError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.detail = detail;
  }
}

// ---------------------------------------------------------------- JSON reader

type JsonNull = { readonly kind: 'null' };
type JsonBool = { readonly kind: 'bool'; readonly flag: boolean };
type JsonNum = { readonly kind: 'num'; readonly num: number };
type JsonStr = { readonly kind: 'str'; readonly text: string };
type JsonArr = { readonly kind: 'arr'; readonly items: readonly JsonValue[] };
type JsonObj = { readonly kind: 'obj'; readonly keys: readonly string[]; readonly values: ReadonlyMap<string, JsonValue> };
type JsonValue = JsonNull | JsonBool | JsonNum | JsonStr | JsonArr | JsonObj;

type Cursor = { readonly cps: readonly number[]; pos: number };

function fail(detail: string): never {
  throw new HarnessError(detail);
}

function peekAt(c: Cursor, k: number): number {
  const v = c.cps[c.pos + k];
  return v === undefined ? -1 : v;
}

function peek(c: Cursor): number {
  return peekAt(c, 0);
}

function skipWs(c: Cursor): void {
  while (peek(c) === 0x20 || peek(c) === 0x09 || peek(c) === 0x0a || peek(c) === 0x0d) c.pos++;
}

function expect(c: Cursor, cp: number): void {
  if (peek(c) !== cp) fail(`expected U+${cp.toString(16)} at ${c.pos}`);
  c.pos++;
}

function word(c: Cursor, cps: readonly number[]): void {
  for (const cp of cps) expect(c, cp);
}

function isDigit(cp: number): boolean {
  return cp >= 0x30 && cp <= 0x39;
}

function hexDigit(cp: number): number {
  if (isDigit(cp)) return cp - 0x30;
  if (cp >= 0x61 && cp <= 0x66) return cp - 0x61 + 10;
  if (cp >= 0x41 && cp <= 0x46) return cp - 0x41 + 10;
  return fail('bad hex digit');
}

function hex4(c: Cursor): number {
  let v = 0;
  for (let i = 0; i < 4; i++) {
    v = v * 16 + hexDigit(peek(c));
    c.pos++;
  }
  return v;
}

function parseString(c: Cursor): string {
  expect(c, 0x22);
  const out: number[] = [];
  for (;;) {
    const ch = peek(c);
    if (ch === -1) fail('unterminated string');
    c.pos++;
    if (ch === 0x22) return fromCodePoints(out);
    if (ch < 0x20) fail('control character in string');
    if (ch !== 0x5c) {
      out.push(ch);
      continue;
    }
    const e = peek(c);
    c.pos++;
    if (e === 0x22 || e === 0x5c || e === 0x2f) out.push(e);
    else if (e === 0x62) out.push(0x08);
    else if (e === 0x66) out.push(0x0c);
    else if (e === 0x6e) out.push(0x0a);
    else if (e === 0x72) out.push(0x0d);
    else if (e === 0x74) out.push(0x09);
    else if (e === 0x75) {
      const u = hex4(c);
      if (u >= 0xd800 && u <= 0xdbff && peek(c) === 0x5c && peekAt(c, 1) === 0x75) {
        c.pos += 2;
        const lo = hex4(c);
        if (lo >= 0xdc00 && lo <= 0xdfff) out.push((u - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000);
        else fail('lone surrogate');
      } else if (u >= 0xd800 && u <= 0xdfff) fail('lone surrogate');
      else out.push(u);
    } else fail('bad escape');
  }
}

// JSON number grammar: -?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)?
function parseNum(c: Cursor): number {
  const out: number[] = [];
  const take = (): void => {
    out.push(peek(c));
    c.pos++;
  };
  const digits = (): void => {
    if (!isDigit(peek(c))) fail('digit expected');
    while (isDigit(peek(c))) take();
  };
  if (peek(c) === 0x2d) take();
  if (peek(c) === 0x30) take();
  else digits();
  if (peek(c) === 0x2e) {
    take();
    digits();
  }
  if (peek(c) === 0x65 || peek(c) === 0x45) {
    take();
    if (peek(c) === 0x2b || peek(c) === 0x2d) take();
    digits();
  }
  return parseNumber(fromCodePoints(out));
}

function parseArray(c: Cursor): JsonValue {
  expect(c, 0x5b);
  const items: JsonValue[] = [];
  skipWs(c);
  if (peek(c) === 0x5d) {
    c.pos++;
    return { kind: 'arr', items };
  }
  for (;;) {
    items.push(parseValue(c));
    skipWs(c);
    if (peek(c) === 0x2c) {
      c.pos++;
      continue;
    }
    expect(c, 0x5d);
    return { kind: 'arr', items };
  }
}

function parseObject(c: Cursor): JsonValue {
  expect(c, 0x7b);
  const keys: string[] = [];
  const values = new Map<string, JsonValue>();
  skipWs(c);
  if (peek(c) === 0x7d) {
    c.pos++;
    return { kind: 'obj', keys, values };
  }
  for (;;) {
    skipWs(c);
    const key = parseString(c);
    skipWs(c);
    expect(c, 0x3a);
    const v = parseValue(c);
    if (values.has(key)) fail(`duplicate key ${key}`);
    keys.push(key);
    values.set(key, v);
    skipWs(c);
    if (peek(c) === 0x2c) {
      c.pos++;
      continue;
    }
    expect(c, 0x7d);
    return { kind: 'obj', keys, values };
  }
}

function parseValue(c: Cursor): JsonValue {
  skipWs(c);
  const ch = peek(c);
  if (ch === 0x7b) return parseObject(c);
  if (ch === 0x5b) return parseArray(c);
  if (ch === 0x22) return { kind: 'str', text: parseString(c) };
  if (ch === 0x74) {
    word(c, [0x74, 0x72, 0x75, 0x65]);
    return { kind: 'bool', flag: true };
  }
  if (ch === 0x66) {
    word(c, [0x66, 0x61, 0x6c, 0x73, 0x65]);
    return { kind: 'bool', flag: false };
  }
  if (ch === 0x6e) {
    word(c, [0x6e, 0x75, 0x6c, 0x6c]);
    return { kind: 'null' };
  }
  return { kind: 'num', num: parseNum(c) };
}

export function parseJson(text: string): JsonValue {
  const cps: number[] = [];
  for (const ch of text) cps.push(ch.codePointAt(0) as number);
  const c: Cursor = { cps, pos: 0 };
  const v = parseValue(c);
  skipWs(c);
  if (c.pos !== cps.length) fail('trailing characters');
  return v;
}

// ---------------------------------------------------------------- decoders: exact keys, no defaults

function obj(v: JsonValue, keys: readonly string[], path: string): JsonObj {
  if (v.kind !== 'obj') return fail(`${path}: expected an object`);
  if (v.keys.length !== keys.length) fail(`${path}: expected keys ${keys.length}, got ${v.keys.length}`);
  for (const k of keys) if (!v.values.has(k)) fail(`${path}: missing key ${k}`);
  return v;
}

function field(o: JsonObj, k: string, path: string): JsonValue {
  const v = o.values.get(k);
  if (v === undefined) return fail(`${path}: missing key ${k}`);
  return v;
}

function num(v: JsonValue, path: string): number {
  if (v.kind !== 'num') return fail(`${path}: expected a number`);
  return v.num;
}

function str(v: JsonValue, path: string): string {
  if (v.kind !== 'str') return fail(`${path}: expected a string`);
  return v.text;
}

function bool(v: JsonValue, path: string): boolean {
  if (v.kind !== 'bool') return fail(`${path}: expected a boolean`);
  return v.flag;
}

function arr(v: JsonValue, path: string): readonly JsonValue[] {
  if (v.kind !== 'arr') return fail(`${path}: expected an array`);
  return v.items;
}

function lit(v: JsonValue, allowed: readonly string[], path: string): string {
  const s = str(v, path);
  if (!allowed.some((a) => a === s)) fail(`${path}: unexpected ${s}`);
  return s;
}

function kindOf(v: JsonValue, path: string): string {
  if (v.kind !== 'obj') return fail(`${path}: expected a tagged object`);
  return str(field(v, 'kind', path), `${path}.kind`);
}

function numField(o: JsonObj, k: string, path: string): number {
  return num(field(o, k, path), `${path}.${k}`);
}

function calcTerms(o: JsonObj, path: string): CalcExpr[] {
  const out: CalcExpr[] = [];
  arr(field(o, 'terms', path), `${path}.terms`).forEach((t, i) => {
    out.push(calcExpr(t, `${path}.terms[${i}]`));
  });
  if (out.length === 0) fail(`${path}.terms: expected a non-empty array`);
  return out;
}

function calcExpr(v: JsonValue, path: string): CalcExpr {
  const k = kindOf(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'number') return { kind: 'number', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'viewport') {
    const o = obj(v, ['kind', 'value', 'axis', 'size'], path);
    return { kind: 'viewport', value: numField(o, 'value', path), axis: viewportAxis(field(o, 'axis', path), `${path}.axis`), size: viewportSize(field(o, 'size', path), `${path}.size`) };
  }
  if (k === 'em') {
    const o = obj(v, ['kind', 'value', 'fontSize'], path);
    return { kind: 'em', value: numField(o, 'value', path), fontSize: calcExpr(field(o, 'fontSize', path), `${path}.fontSize`) };
  }
  if (k === 'rem') return { kind: 'rem', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'font-metric') {
    const o = obj(v, ['kind', 'value', 'metric', 'font'], path);
    const m = lit(field(o, 'metric', path), ['ex', 'ch', 'cap'], `${path}.metric`);
    const value = numField(o, 'value', path);
    const font = fontSpec(field(o, 'font', path), `${path}.font`);
    if (m === 'ex') return { kind: 'font-metric', value, metric: 'ex', font };
    if (m === 'ch') return { kind: 'font-metric', value, metric: 'ch', font };
    return { kind: 'font-metric', value, metric: 'cap', font };
  }
  if (k === 'lh') {
    const o = obj(v, ['kind', 'value', 'font', 'lineHeight'], path);
    return { kind: 'lh', value: numField(o, 'value', path), font: fontSpec(field(o, 'font', path), `${path}.font`), lineHeight: lineHeightValue(field(o, 'lineHeight', path), `${path}.lineHeight`) };
  }
  if (k === 'env') {
    const o = obj(v, ['kind', 'value', 'side'], path);
    return { kind: 'env', value: numField(o, 'value', path), side: safeAreaSide(field(o, 'side', path), `${path}.side`) };
  }
  if (k === 'font-percent') {
    const o = obj(v, ['kind', 'value', 'parent'], path);
    return { kind: 'font-percent', value: numField(o, 'value', path), parent: calcExpr(field(o, 'parent', path), `${path}.parent`) };
  }
  if (k === 'font-calc') {
    const o = obj(v, ['kind', 'expr', 'parent'], path);
    return { kind: 'font-calc', expr: calcExpr(field(o, 'expr', path), `${path}.expr`), parent: calcExpr(field(o, 'parent', path), `${path}.parent`) };
  }
  if (k === 'sum') return { kind: 'sum', terms: calcTerms(obj(v, ['kind', 'terms'], path), path) };
  if (k === 'product') return { kind: 'product', terms: calcTerms(obj(v, ['kind', 'terms'], path), path) };
  if (k === 'min') return { kind: 'min', terms: calcTerms(obj(v, ['kind', 'terms'], path), path) };
  if (k === 'max') return { kind: 'max', terms: calcTerms(obj(v, ['kind', 'terms'], path), path) };
  if (k === 'invert') {
    const o = obj(v, ['kind', 'term'], path);
    return { kind: 'invert', term: calcExpr(field(o, 'term', path), `${path}.term`) };
  }
  if (k === 'clamp') {
    const o = obj(v, ['kind', 'min', 'value', 'max'], path);
    return { kind: 'clamp', min: calcExpr(field(o, 'min', path), `${path}.min`), value: calcExpr(field(o, 'value', path), `${path}.value`), max: calcExpr(field(o, 'max', path), `${path}.max`) };
  }
  if (k === 'pixels-and-percent') {
    const o = obj(v, ['kind', 'pixels', 'percent', 'explicitPixels', 'explicitPercent'], path);
    return {
      kind: 'pixels-and-percent',
      pixels: numField(o, 'pixels', path),
      percent: numField(o, 'percent', path),
      explicitPixels: bool(field(o, 'explicitPixels', path), `${path}.explicitPixels`),
      explicitPercent: bool(field(o, 'explicitPercent', path), `${path}.explicitPercent`),
    };
  }
  return fail(`${path}: unknown calculation kind ${k}`);
}

function viewportAxis(v: JsonValue, path: string): ViewportLength['axis'] {
  const a = lit(v, ['width', 'height', 'min', 'max'], path);
  if (a === 'width') return 'width';
  if (a === 'height') return 'height';
  if (a === 'min') return 'min';
  return 'max';
}

function viewportSize(v: JsonValue, path: string): ViewportSize {
  const a = lit(v, ['small', 'large', 'dynamic'], path);
  if (a === 'small') return 'small';
  if (a === 'large') return 'large';
  return 'dynamic';
}

function safeAreaSide(v: JsonValue, path: string): SafeAreaSide {
  const a = lit(v, ['top', 'right', 'bottom', 'left'], path);
  if (a === 'top') return 'top';
  if (a === 'right') return 'right';
  if (a === 'bottom') return 'bottom';
  return 'left';
}

/** A FontSpec {family, size, specifiedSize, absoluteSize}. */
function fontSpec(v: JsonValue, path: string): FontSpec {
  const o = obj(v, ['family', 'size', 'specifiedSize', 'absoluteSize'], path);
  return { family: str(field(o, 'family', path), `${path}.family`), size: numField(o, 'size', path), specifiedSize: calcExpr(field(o, 'specifiedSize', path), `${path}.specifiedSize`), absoluteSize: bool(field(o, 'absoluteSize', path), `${path}.absoluteSize`) };
}

/** A LengthCalc {kind: calc, expr, range}. */
function lengthCalc(v: JsonValue, path: string): LengthCalc {
  const o = obj(v, ['kind', 'expr', 'range'], path);
  const expr = calcExpr(field(o, 'expr', path), `${path}.expr`);
  const range = lit(field(o, 'range', path), ['all', 'non-negative'], `${path}.range`);
  return range === 'all' ? { kind: 'calc', expr, range: 'all' } : { kind: 'calc', expr, range: 'non-negative' };
}

/** A LineHeightCalc {kind: calc, expr, range: non-negative}: line-height is non-negative. */
function lineHeightCalc(v: JsonValue, path: string): LineHeightCalc {
  const o = obj(v, ['kind', 'expr', 'range'], path);
  const expr = calcExpr(field(o, 'expr', path), `${path}.expr`);
  lit(field(o, 'range', path), ['non-negative'], `${path}.range`);
  return { kind: 'calc', expr, range: 'non-negative' };
}

function sizeValue(v: JsonValue, path: string): SizeValue {
  const k = kindOf(v, path);
  if (k === 'calc') return lengthCalc(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'auto') {
    obj(v, ['kind'], path);
    return { kind: 'auto' };
  }
  return fail(`${path}: unknown kind ${k}`);
}

function maxSizeValue(v: JsonValue, path: string): MaxSizeValue {
  const k = kindOf(v, path);
  if (k === 'calc') return lengthCalc(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'none') {
    obj(v, ['kind'], path);
    return { kind: 'none' };
  }
  return fail(`${path}: unknown kind ${k}`);
}

function paddingValue(v: JsonValue, path: string): PaddingValue {
  const k = kindOf(v, path);
  if (k === 'calc') return lengthCalc(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  return fail(`${path}: unknown kind ${k}`);
}

function borderValue(v: JsonValue, path: string): BorderWidthValue {
  const k = kindOf(v, path);
  if (k === 'calc') return lengthCalc(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'device-px') return { kind: 'device-px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  return fail(`${path}: unknown kind ${k}`);
}

function gapValue(v: JsonValue, path: string): GapValue {
  const k = kindOf(v, path);
  if (k === 'calc') return lengthCalc(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'normal') {
    obj(v, ['kind'], path);
    return { kind: 'normal' };
  }
  return fail(`${path}: unknown kind ${k}`);
}

function flexBasisValue(v: JsonValue, path: string): FlexBasisValue {
  const k = kindOf(v, path);
  if (k === 'calc') return lengthCalc(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'auto') {
    obj(v, ['kind'], path);
    return { kind: 'auto' };
  }
  if (k === 'content') {
    obj(v, ['kind'], path);
    return { kind: 'content' };
  }
  return fail(`${path}: unknown kind ${k}`);
}

function lineHeightValue(v: JsonValue, path: string): LineHeightValue {
  const k = kindOf(v, path);
  if (k === 'calc') return lineHeightCalc(v, path);
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'number') return { kind: 'number', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'normal') {
    obj(v, ['kind'], path);
    return { kind: 'normal' };
  }
  return fail(`${path}: unknown kind ${k}`);
}

function aspectRatioValue(v: JsonValue, path: string): AspectRatioValue {
  const k = kindOf(v, path);
  if (k === 'auto') {
    obj(v, ['kind'], path);
    return { kind: 'auto' };
  }
  if (k === 'ratio' || k === 'auto-ratio') {
    const o = obj(v, ['kind', 'width', 'height'], path);
    const width = numField(o, 'width', path);
    const height = numField(o, 'height', path);
    return k === 'ratio' ? { kind: 'ratio', width, height } : { kind: 'auto-ratio', width, height };
  }
  return fail(`${path}: unknown kind ${k}`);
}

const STYLE_KEYS: readonly string[] = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'overflowX', 'overflowY', 'direction', 'boxSizing', 'width', 'height',
  'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop',
  'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'order', 'justifyContent', 'alignItems', 'alignSelf',
  'alignContent', 'rowGap', 'columnGap', 'textAlign', 'aspectRatio', 'verticalAlign', 'grid', 'gridItem',
];

function verticalAlignValue(v: JsonValue, path: string): VerticalAlignValue {
  const k = kindOf(v, path);
  if (k === 'calc') return lengthCalc(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'keyword') {
    const o = obj(v, ['kind', 'value'], path);
    return { kind: 'keyword', value: lit(field(o, 'value', path), ['baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle', 'top', 'bottom'], `${path}.value`) as VerticalAlignKeyword };
  }
  return fail(`${path}: unknown kind ${k}`);
}

const GRID_SELF_ALIGN: readonly string[] = ['normal', 'stretch', 'start', 'end', 'center', 'self-start', 'self-end', 'flex-start', 'flex-end', 'left', 'right'];

function trackBreadth(v: JsonValue, path: string): TrackBreadth {
  const k = kindOf(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'fr') return { kind: 'fr', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  obj(v, ['kind'], path);
  if (k === 'auto') return { kind: 'auto' };
  if (k === 'min-content') return { kind: 'min-content' };
  if (k === 'max-content') return { kind: 'max-content' };
  return fail(`${path}: unknown kind ${k}`);
}

function trackSize(v: JsonValue, path: string): TrackSize {
  const k = kindOf(v, path);
  if (k === 'breadth') return { kind: 'breadth', breadth: trackBreadth(field(obj(v, ['kind', 'breadth'], path), 'breadth', path), `${path}.breadth`) };
  if (k === 'minmax') {
    const o = obj(v, ['kind', 'min', 'max'], path);
    return { kind: 'minmax', min: trackBreadth(field(o, 'min', path), `${path}.min`), max: trackBreadth(field(o, 'max', path), `${path}.max`) };
  }
  if (k === 'fit-content') {
    const limit = field(obj(v, ['kind', 'limit'], path), 'limit', path);
    const lk = kindOf(limit, `${path}.limit`);
    const value = numField(obj(limit, ['kind', 'value'], `${path}.limit`), 'value', `${path}.limit`);
    if (lk === 'px') return { kind: 'fit-content', limit: { kind: 'px', value } };
    if (lk === 'percent') return { kind: 'fit-content', limit: { kind: 'percent', value } };
    return fail(`${path}.limit: unknown kind ${lk}`);
  }
  return fail(`${path}: unknown kind ${k}`);
}

function trackSizes(v: JsonValue, path: string): TrackSize[] {
  return arr(v, path).map((t, i) => trackSize(t, `${path}[${i}]`));
}

function repeaters(v: JsonValue, path: string): TrackRepeater[] {
  return arr(v, path).map((r, i): TrackRepeater => {
    const at = `${path}[${i}]`;
    const o = obj(r, ['count', 'sizes'], at);
    return { count: numField(o, 'count', at), sizes: trackSizes(field(o, 'sizes', at), `${at}.sizes`) };
  });
}

function gridLine(v: JsonValue, path: string): GridLine {
  const k = kindOf(v, path);
  if (k === 'auto') {
    obj(v, ['kind'], path);
    return { kind: 'auto' };
  }
  if (k === 'line') return { kind: 'line', n: numField(obj(v, ['kind', 'n'], path), 'n', path) };
  if (k === 'span') return { kind: 'span', n: numField(obj(v, ['kind', 'n'], path), 'n', path) };
  if (k === 'named-line') {
    const o = obj(v, ['kind', 'n', 'name'], path);
    return { kind: 'named-line', n: numField(o, 'n', path), name: numField(o, 'name', path) };
  }
  if (k === 'named-span') {
    const o = obj(v, ['kind', 'n', 'name'], path);
    return { kind: 'named-span', n: numField(o, 'n', path), name: numField(o, 'name', path) };
  }
  if (k === 'area') {
    const o = obj(v, ['kind', 'implicitName', 'name'], path);
    return { kind: 'area', implicitName: numField(o, 'implicitName', path), name: numField(o, 'name', path) };
  }
  return fail(`${path}: unknown kind ${k}`);
}

function gridSpan(v: JsonValue, path: string): GridSpan {
  const k = kindOf(v, path);
  if (k === 'definite') {
    const o = obj(v, ['kind', 'start', 'end'], path);
    return { kind: 'definite', start: numField(o, 'start', path), end: numField(o, 'end', path) };
  }
  if (k === 'auto') return { kind: 'auto', span: numField(obj(v, ['kind', 'span'], path), 'span', path) };
  if (k === 'lines') {
    const o = obj(v, ['kind', 'start', 'end'], path);
    return { kind: 'lines', start: gridLine(field(o, 'start', path), `${path}.start`), end: gridLine(field(o, 'end', path), `${path}.end`) };
  }
  return fail(`${path}: unknown kind ${k}`);
}

function lineList(v: JsonValue, path: string): number[] {
  return arr(v, path).map((x, i) => num(x, `${path}[${i}]`));
}

function gridAutoRepeat(v: JsonValue, path: string): GridAutoRepeat | null {
  if (v.kind === 'null') return null;
  const o = obj(v, ['type', 'index', 'sizes', 'lineNames'], path);
  const names = arr(field(o, 'lineNames', path), `${path}.lineNames`).map((n, i): GridLineName => {
    const at = `${path}.lineNames[${i}]`;
    const l = obj(n, ['explicit', 'repeat', 'implicit'], at);
    return { explicit: lineList(field(l, 'explicit', at), `${at}.explicit`), repeat: lineList(field(l, 'repeat', at), `${at}.repeat`), implicit: lineList(field(l, 'implicit', at), `${at}.implicit`) };
  });
  return {
    type: lit(field(o, 'type', path), ['auto-fill', 'auto-fit'], `${path}.type`) === 'auto-fit' ? 'auto-fit' : 'auto-fill',
    index: numField(o, 'index', path),
    sizes: trackSizes(field(o, 'sizes', path), `${path}.sizes`),
    lineNames: names,
  };
}

function decodeGrid(v: JsonValue, path: string): GridContainerStyle | null {
  if (v.kind === 'null') return null;
  const o = obj(v, ['templateColumns', 'templateRows', 'autoColumns', 'autoRows', 'explicitColumnCount', 'explicitRowCount', 'autoRepeatColumns', 'autoRepeatRows', 'autoFlow', 'dense', 'justifyItems'], path);
  const f = (k: string): JsonValue => field(o, k, path);
  return {
    templateColumns: repeaters(f('templateColumns'), `${path}.templateColumns`),
    templateRows: repeaters(f('templateRows'), `${path}.templateRows`),
    autoColumns: trackSizes(f('autoColumns'), `${path}.autoColumns`),
    autoRows: trackSizes(f('autoRows'), `${path}.autoRows`),
    explicitColumnCount: num(f('explicitColumnCount'), `${path}.explicitColumnCount`),
    explicitRowCount: num(f('explicitRowCount'), `${path}.explicitRowCount`),
    autoRepeatColumns: gridAutoRepeat(f('autoRepeatColumns'), `${path}.autoRepeatColumns`),
    autoRepeatRows: gridAutoRepeat(f('autoRepeatRows'), `${path}.autoRepeatRows`),
    autoFlow: lit(f('autoFlow'), ['row', 'column'], `${path}.autoFlow`) === 'column' ? 'column' : 'row',
    dense: bool(f('dense'), `${path}.dense`),
    justifyItems: lit(f('justifyItems'), GRID_SELF_ALIGN, `${path}.justifyItems`) as GridSelfAlign,
  };
}

function decodeGridItem(v: JsonValue, path: string): GridItemStyle | null {
  if (v.kind === 'null') return null;
  const o = obj(v, ['column', 'row', 'justifySelf'], path);
  const self = str(field(o, 'justifySelf', path), `${path}.justifySelf`);
  return {
    column: gridSpan(field(o, 'column', path), `${path}.column`),
    row: gridSpan(field(o, 'row', path), `${path}.row`),
    justifySelf: self === 'auto' ? 'auto' : (lit(field(o, 'justifySelf', path), GRID_SELF_ALIGN, `${path}.justifySelf`) as GridSelfAlign),
  };
}

const ALIGN_ITEMS: readonly string[] = ['normal', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end'];

function decodeStyle(v: JsonValue, path: string): LayoutStyle {
  const o = obj(v, STYLE_KEYS, path);
  const f = (k: string): JsonValue => field(o, k, path);
  const p = (k: string): string => `${path}.${k}`;
  return {
    display: lit(f('display'), ['block', 'flex', 'grid', 'inline'], p('display')) as Display,
    position: lit(f('position'), ['static', 'relative', 'absolute'], p('position')) as Position,
    top: sizeValue(f('top'), p('top')) as InsetValue,
    right: sizeValue(f('right'), p('right')) as InsetValue,
    bottom: sizeValue(f('bottom'), p('bottom')) as InsetValue,
    left: sizeValue(f('left'), p('left')) as InsetValue,
    overflowX: lit(f('overflowX'), ['visible', 'hidden', 'clip', 'auto', 'scroll'], p('overflowX')) as Overflow,
    overflowY: lit(f('overflowY'), ['visible', 'hidden', 'clip', 'auto', 'scroll'], p('overflowY')) as Overflow,
    direction: lit(f('direction'), ['ltr', 'rtl'], p('direction')) as Direction,
    boxSizing: lit(f('boxSizing'), ['content-box', 'border-box'], p('boxSizing')) as BoxSizing,
    width: sizeValue(f('width'), p('width')),
    height: sizeValue(f('height'), p('height')),
    minWidth: sizeValue(f('minWidth'), p('minWidth')) as MinSizeValue,
    minHeight: sizeValue(f('minHeight'), p('minHeight')) as MinSizeValue,
    maxWidth: maxSizeValue(f('maxWidth'), p('maxWidth')),
    maxHeight: maxSizeValue(f('maxHeight'), p('maxHeight')),
    marginTop: sizeValue(f('marginTop'), p('marginTop')) as MarginValue,
    marginRight: sizeValue(f('marginRight'), p('marginRight')) as MarginValue,
    marginBottom: sizeValue(f('marginBottom'), p('marginBottom')) as MarginValue,
    marginLeft: sizeValue(f('marginLeft'), p('marginLeft')) as MarginValue,
    paddingTop: paddingValue(f('paddingTop'), p('paddingTop')),
    paddingRight: paddingValue(f('paddingRight'), p('paddingRight')),
    paddingBottom: paddingValue(f('paddingBottom'), p('paddingBottom')),
    paddingLeft: paddingValue(f('paddingLeft'), p('paddingLeft')),
    borderTopWidth: borderValue(f('borderTopWidth'), p('borderTopWidth')),
    borderRightWidth: borderValue(f('borderRightWidth'), p('borderRightWidth')),
    borderBottomWidth: borderValue(f('borderBottomWidth'), p('borderBottomWidth')),
    borderLeftWidth: borderValue(f('borderLeftWidth'), p('borderLeftWidth')),
    flexDirection: lit(f('flexDirection'), ['row', 'row-reverse', 'column', 'column-reverse'], p('flexDirection')) as FlexDirection,
    flexWrap: lit(f('flexWrap'), ['nowrap', 'wrap', 'wrap-reverse'], p('flexWrap')) as FlexWrap,
    flexGrow: num(f('flexGrow'), p('flexGrow')),
    flexShrink: num(f('flexShrink'), p('flexShrink')),
    flexBasis: flexBasisValue(f('flexBasis'), p('flexBasis')),
    order: num(f('order'), p('order')),
    justifyContent: lit(f('justifyContent'), ['normal', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch', 'start', 'end', 'left', 'right'], p('justifyContent')) as JustifyContent,
    alignItems: lit(f('alignItems'), ALIGN_ITEMS, p('alignItems')) as AlignItems,
    alignSelf: (str(f('alignSelf'), p('alignSelf')) === 'auto' ? 'auto' : lit(f('alignSelf'), ALIGN_ITEMS, p('alignSelf'))) as AlignSelf,
    alignContent: lit(f('alignContent'), ['normal', 'stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'baseline', 'start', 'end'], p('alignContent')) as AlignContent,
    rowGap: gapValue(f('rowGap'), p('rowGap')),
    columnGap: gapValue(f('columnGap'), p('columnGap')),
    textAlign: lit(f('textAlign'), ['start', 'end', 'left', 'right', 'center', 'justify'], p('textAlign')) as TextAlign,
    aspectRatio: aspectRatioValue(f('aspectRatio'), p('aspectRatio')),
    verticalAlign: verticalAlignValue(f('verticalAlign'), p('verticalAlign')),
    grid: decodeGrid(f('grid'), p('grid')),
    gridItem: decodeGridItem(f('gridItem'), p('gridItem')),
  };
}

function decodeText(o: JsonObj, path: string): TextLeaf {
  obj(o, ['kind', 'id', 'text', 'font', 'lineHeight', 'whiteSpaceCollapse', 'textWrapMode'], path);
  lit(field(o, 'whiteSpaceCollapse', path), ['collapse'], `${path}.whiteSpaceCollapse`);
  return {
    kind: 'text',
    id: str(field(o, 'id', path), `${path}.id`),
    text: str(field(o, 'text', path), `${path}.text`),
    font: fontSpec(field(o, 'font', path), `${path}.font`),
    lineHeight: lineHeightValue(field(o, 'lineHeight', path), `${path}.lineHeight`),
    whiteSpaceCollapse: 'collapse',
    textWrapMode: lit(field(o, 'textWrapMode', path), ['wrap', 'nowrap'], `${path}.textWrapMode`) as TextWrapMode,
  };
}

function naturalSizeValue(v: JsonValue, path: string): NaturalSizeValue {
  const k = kindOf(v, path);
  if (k === 'none') {
    obj(v, ['kind'], path);
    return { kind: 'none' };
  }
  if (k === 'image') {
    const o = obj(v, ['kind', 'width', 'height'], path);
    return { kind: 'image', width: numField(o, 'width', path), height: numField(o, 'height', path) };
  }
  return fail(`${path}: unknown kind ${k}`);
}

function objectPositionValue(v: JsonValue, path: string): ObjectPositionValue {
  const k = kindOf(v, path);
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'percent') return { kind: 'percent', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  return fail(`${path}: unknown kind ${k}`);
}

function decodeReplaced(o: JsonObj, path: string): ReplacedLeaf {
  obj(o, ['kind', 'id', 'style', 'natural', 'defaultWidth', 'defaultHeight', 'objectFit', 'objectPositionX', 'objectPositionY'], path);
  return {
    kind: 'replaced',
    id: str(field(o, 'id', path), `${path}.id`),
    style: decodeStyle(field(o, 'style', path), `${path}.style`),
    natural: naturalSizeValue(field(o, 'natural', path), `${path}.natural`),
    defaultWidth: numField(o, 'defaultWidth', path),
    defaultHeight: numField(o, 'defaultHeight', path),
    objectFit: lit(field(o, 'objectFit', path), ['fill', 'contain', 'cover', 'none', 'scale-down'], `${path}.objectFit`) as ObjectFit,
    objectPositionX: objectPositionValue(field(o, 'objectPositionX', path), `${path}.objectPositionX`),
    objectPositionY: objectPositionValue(field(o, 'objectPositionY', path), `${path}.objectPositionY`),
  };
}

function decodeBox(o: JsonObj, path: string): LayoutBox {
  obj(o, ['kind', 'id', 'boxType', 'style', 'strut', 'children'], path);
  const children: (LayoutBox | ReplacedLeaf | InlineChild)[] = [];
  arr(field(o, 'children', path), `${path}.children`).forEach((c, i) => {
    children.push(decodeNode(c, `${path}.children[${i}]`));
  });
  const strut = field(o, 'strut', path);
  return {
    kind: 'box',
    id: str(field(o, 'id', path), `${path}.id`),
    boxType: lit(field(o, 'boxType', path), ['element', 'anonymous'], `${path}.boxType`) as BoxType,
    style: decodeStyle(field(o, 'style', path), `${path}.style`),
    strut: strut.kind === 'null' ? null : decodeStrut(strut, `${path}.strut`),
    children,
  };
}

function decodeStrut(v: JsonValue, path: string): LineStrut {
  const o = obj(v, ['font', 'lineHeight'], path);
  return { font: fontSpec(field(o, 'font', path), `${path}.font`), lineHeight: lineHeightValue(field(o, 'lineHeight', path), `${path}.lineHeight`) };
}

function decodeInline(o: JsonObj, path: string): InlineBox {
  obj(o, ['kind', 'id', 'style', 'font', 'lineHeight', 'children'], path);
  const children: InlineChild[] = [];
  arr(field(o, 'children', path), `${path}.children`).forEach((c, i) => {
    children.push(decodeInlineChild(c, `${path}.children[${i}]`));
  });
  return {
    kind: 'inline',
    id: str(field(o, 'id', path), `${path}.id`),
    style: decodeStyle(field(o, 'style', path), `${path}.style`),
    font: fontSpec(field(o, 'font', path), `${path}.font`),
    lineHeight: lineHeightValue(field(o, 'lineHeight', path), `${path}.lineHeight`),
    children,
  };
}

function decodeBreak(o: JsonObj, path: string): LineBreak {
  obj(o, ['kind', 'id', 'font', 'lineHeight'], path);
  return { kind: 'br', id: str(field(o, 'id', path), `${path}.id`), font: fontSpec(field(o, 'font', path), `${path}.font`), lineHeight: lineHeightValue(field(o, 'lineHeight', path), `${path}.lineHeight`) };
}

function decodeInlineChild(v: JsonValue, path: string): InlineChild {
  if (v.kind !== 'obj') return fail(`${path}: expected an inline-level node`);
  const k = kindOf(v, path);
  if (k === 'text') return decodeText(v, path);
  if (k === 'inline') return decodeInline(v, path);
  if (k === 'br') return decodeBreak(v, path);
  return fail(`${path}: unknown inline-level node kind ${k}`);
}

function decodeNode(v: JsonValue, path: string): LayoutBox | ReplacedLeaf | InlineChild {
  if (v.kind !== 'obj') return fail(`${path}: expected a node`);
  const k = kindOf(v, path);
  if (k === 'box') return decodeBox(v, path);
  if (k === 'replaced') return decodeReplaced(v, path);
  return decodeInlineChild(v, path);
}

function decodeViewport(v: JsonValue, path: string): Viewport {
  const o = obj(v, ['width', 'height'], path);
  return { width: numField(o, 'width', path), height: numField(o, 'height', path) };
}

function decodeInput(v: JsonValue): LayoutInput {
  const o = obj(v, ['viewport', 'devicePixelRatio', 'viewportUnits', 'safeArea', 'rootFontSize', 'root'], '$');
  const units = obj(field(o, 'viewportUnits', '$'), ['small', 'large', 'dynamic'], '$.viewportUnits');
  const safe = obj(field(o, 'safeArea', '$'), ['top', 'right', 'bottom', 'left'], '$.safeArea');
  const root = field(o, 'root', '$');
  if (root.kind !== 'obj' || kindOf(root, '$.root') !== 'box') return fail('$.root: expected a box');
  return {
    viewport: decodeViewport(field(o, 'viewport', '$'), '$.viewport'),
    devicePixelRatio: numField(o, 'devicePixelRatio', '$'),
    viewportUnits: {
      small: decodeViewport(field(units, 'small', '$.viewportUnits'), '$.viewportUnits.small'),
      large: decodeViewport(field(units, 'large', '$.viewportUnits'), '$.viewportUnits.large'),
      dynamic: decodeViewport(field(units, 'dynamic', '$.viewportUnits'), '$.viewportUnits.dynamic'),
    },
    safeArea: { top: numField(safe, 'top', '$.safeArea'), right: numField(safe, 'right', '$.safeArea'), bottom: numField(safe, 'bottom', '$.safeArea'), left: numField(safe, 'left', '$.safeArea') },
    rootFontSize: numField(o, 'rootFontSize', '$'),
    root: decodeBox(root, '$.root'),
  };
}

const FAULT_KEYS: readonly string[] = [
  'breakOffByOne', 'rtlAsLtr', 'ignoreOrder', 'baselineFromBorderTop', 'scrollMinAuto', 'absposInFlow', 'cbIgnoresPadding',
  'staticPosLtr', 'relativeShiftsFlow', 'metricHalfUp', 'untruncatedFontSize', 'halfLeadingSpec', 'minMaxEndMarginSpec',
  'wrapReverseBaselineSpec', 'initialLineWidthZoomed', 'calcPercentPlainOrder', 'calcDoubleEval', 'calcNoNonNegClamp',
  'calcPercentIndefiniteAsLength', 'clampMaxWins', 'divideDirect', 'calcLeafUnzoomed', 'viewportUnitsUnceiled', 'lhUnsnapped',
  'exUntruncatedFontSize', 'rootFontSizeIgnored', 'safeAreaIgnored', 'lhNormalUnrounded', 'viewportSizeKindIgnored', 'minimumFontSizeIgnored',
  'spaceOnlyBreaks', 'fitWithoutEpsilon', 'breakAfterSolidus', 'noHyphenDigitBreak', 'lineHeightIgnoresInlineBoxes',
  'halfLeadingUnflooredPerBox', 'brIgnored', 'breakAtBoxBoundary', 'fragmentFromLineTop',
  'advanceNot16_16', 'doubleAccumulation', 'noReshapeAtBreak', 'kerningDropped', 'wholePixelPositions', 'softHyphenWidthMissing',
  'metricRoundingSwapped', 'latinCheckSkipped',
  'orderHalfEven', 'orderUnclamped', 'gutterReserved', 'overflowIgnoresPadding',
];

function decodeFaults(v: JsonValue): EngineFaults {
  const o = obj(v, FAULT_KEYS, '$.faults');
  const b = (k: string): boolean => bool(field(o, k, '$.faults'), `$.faults.${k}`);
  return {
    breakOffByOne: b('breakOffByOne'),
    rtlAsLtr: b('rtlAsLtr'),
    ignoreOrder: b('ignoreOrder'),
    baselineFromBorderTop: b('baselineFromBorderTop'),
    scrollMinAuto: b('scrollMinAuto'),
    absposInFlow: b('absposInFlow'),
    cbIgnoresPadding: b('cbIgnoresPadding'),
    staticPosLtr: b('staticPosLtr'),
    relativeShiftsFlow: b('relativeShiftsFlow'),
    metricHalfUp: b('metricHalfUp'),
    untruncatedFontSize: b('untruncatedFontSize'),
    halfLeadingSpec: b('halfLeadingSpec'),
    minMaxEndMarginSpec: b('minMaxEndMarginSpec'),
    wrapReverseBaselineSpec: b('wrapReverseBaselineSpec'),
    initialLineWidthZoomed: b('initialLineWidthZoomed'),
    calcPercentPlainOrder: b('calcPercentPlainOrder'),
    calcDoubleEval: b('calcDoubleEval'),
    calcNoNonNegClamp: b('calcNoNonNegClamp'),
    calcPercentIndefiniteAsLength: b('calcPercentIndefiniteAsLength'),
    clampMaxWins: b('clampMaxWins'),
    divideDirect: b('divideDirect'),
    calcLeafUnzoomed: b('calcLeafUnzoomed'),
    viewportUnitsUnceiled: b('viewportUnitsUnceiled'),
    lhUnsnapped: b('lhUnsnapped'),
    exUntruncatedFontSize: b('exUntruncatedFontSize'),
    rootFontSizeIgnored: b('rootFontSizeIgnored'),
    safeAreaIgnored: b('safeAreaIgnored'),
    lhNormalUnrounded: b('lhNormalUnrounded'),
    viewportSizeKindIgnored: b('viewportSizeKindIgnored'),
    minimumFontSizeIgnored: b('minimumFontSizeIgnored'),
    spaceOnlyBreaks: b('spaceOnlyBreaks'),
    fitWithoutEpsilon: b('fitWithoutEpsilon'),
    breakAfterSolidus: b('breakAfterSolidus'),
    noHyphenDigitBreak: b('noHyphenDigitBreak'),
    lineHeightIgnoresInlineBoxes: b('lineHeightIgnoresInlineBoxes'),
    halfLeadingUnflooredPerBox: b('halfLeadingUnflooredPerBox'),
    brIgnored: b('brIgnored'),
    breakAtBoxBoundary: b('breakAtBoxBoundary'),
    fragmentFromLineTop: b('fragmentFromLineTop'),
    advanceNot16_16: b('advanceNot16_16'),
    doubleAccumulation: b('doubleAccumulation'),
    noReshapeAtBreak: b('noReshapeAtBreak'),
    kerningDropped: b('kerningDropped'),
    wholePixelPositions: b('wholePixelPositions'),
    softHyphenWidthMissing: b('softHyphenWidthMissing'),
    metricRoundingSwapped: b('metricRoundingSwapped'),
    latinCheckSkipped: b('latinCheckSkipped'),
    orderHalfEven: b('orderHalfEven'),
    orderUnclamped: b('orderUnclamped'),
    gutterReserved: b('gutterReserved'),
    overflowIgnoresPadding: b('overflowIgnoresPadding'),
  };
}

// ---------------------------------------------------------------- writer

/** A JSON string literal. */
function q(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (cp < 0x10) out += `\\u000${cp.toString(16)}`;
    else if (cp < 0x20) out += `\\u00${cp.toString(16)}`;
    else out += ch;
  }
  return `${out}"`;
}

function h(x: number): string {
  return `"${bitsHex(x)}"`;
}

/** One recorded GlyphShaper call of a shape transcript (R3) and its integer glyph records. */
type ReplayCall = {
  readonly face: string;
  readonly size: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly script: string;
  readonly rtl: boolean;
  readonly language: string;
  readonly features: readonly number[];
  readonly glyphs: readonly number[];
};

/** A face of a transcript: its FontData and HanKerning data, as the host read them from the bundled bytes. */
type ReplayFace = { readonly data: FontData; readonly hanKerning: HanKerningFontData };

type Shaping = { readonly language: string; readonly faces: Map<string, ReplayFace>; readonly calls: readonly ReplayCall[] };

function numbers(v: JsonValue, path: string): number[] {
  const out: number[] = [];
  arr(v, path).forEach((x, i) => {
    out.push(num(x, `${path}[${i}]`));
  });
  return out;
}

function fontData(v: JsonValue, path: string): FontData {
  const o = obj(v, ['unitsPerEm', 'ascent', 'descent', 'lineGap', 'advances', 'xHeight', 'capHeight', 'zeroAdvance'], path);
  return {
    unitsPerEm: numField(o, 'unitsPerEm', path), ascent: numField(o, 'ascent', path), descent: numField(o, 'descent', path), lineGap: numField(o, 'lineGap', path),
    advances: numbers(field(o, 'advances', path), `${path}.advances`), xHeight: numField(o, 'xHeight', path), capHeight: numField(o, 'capHeight', path), zeroAdvance: numField(o, 'zeroAdvance', path),
  };
}

function hanKerning(v: JsonValue, path: string): HanKerningFontData {
  const o = obj(v, ['hasAlternateSpacing', 'hasContextualSpacing', 'typeForDot', 'typeForColon', 'typeForSemicolon', 'isQuoteFullwidth'], path);
  return {
    hasAlternateSpacing: bool(field(o, 'hasAlternateSpacing', path), `${path}.hasAlternateSpacing`),
    hasContextualSpacing: bool(field(o, 'hasContextualSpacing', path), `${path}.hasContextualSpacing`),
    typeForDot: numField(o, 'typeForDot', path), typeForColon: numField(o, 'typeForColon', path), typeForSemicolon: numField(o, 'typeForSemicolon', path),
    isQuoteFullwidth: bool(field(o, 'isQuoteFullwidth', path), `${path}.isQuoteFullwidth`),
  };
}

/** A shape transcript: {language, faces: [{id, data, hanKerning}], calls: [[face, size, text, start, end, script, rtl, language, features, glyphs]]}. */
function decodeShaping(v: JsonValue, path: string): Shaping {
  const o = obj(v, ['language', 'faces', 'calls'], path);
  const faces = new Map<string, ReplayFace>();
  arr(field(o, 'faces', path), `${path}.faces`).forEach((f, i) => {
    const at = `${path}.faces[${i}]`;
    const fo = obj(f, ['id', 'data', 'hanKerning'], at);
    const id = str(field(fo, 'id', at), `${at}.id`);
    if (faces.has(id)) fail(`${at}.id: face ${id} is listed twice`);
    faces.set(id, { data: fontData(field(fo, 'data', at), `${at}.data`), hanKerning: hanKerning(field(fo, 'hanKerning', at), `${at}.hanKerning`) });
  });
  const calls: ReplayCall[] = [];
  arr(field(o, 'calls', path), `${path}.calls`).forEach((c, i) => {
    const at = `${path}.calls[${i}]`;
    const a = arr(c, at);
    if (a.length !== 10) fail(`${at}: expected 10 fields, got ${a.length}`);
    const item = (k: number): JsonValue => a[k] as JsonValue;
    const features = numbers(item(8), `${at}[8]`);
    const glyphs = numbers(item(9), `${at}[9]`);
    // A call's features must equal the engine's request exactly (replayShaper), so only the glyphs it returns need checking.
    if (!Number.isInteger(glyphs.length / GLYPH_STRIDE)) fail(`${at}[9]: ${glyphs.length} integers are not whole glyph records of ${GLYPH_STRIDE}`);
    calls.push({
      face: str(item(0), `${at}[0]`), size: num(item(1), `${at}[1]`), text: str(item(2), `${at}[2]`), start: num(item(3), `${at}[3]`), end: num(item(4), `${at}[4]`),
      script: str(item(5), `${at}[5]`), rtl: bool(item(6), `${at}[6]`), language: str(item(7), `${at}[7]`), features, glyphs,
    });
  });
  return { language: str(field(o, 'language', path), `${path}.language`), faces, calls };
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if ((a[i] as number) !== (b[i] as number)) return false;
  return true;
}

/** R3: a GlyphShaper that replays a transcript; a call the transcript does not hold is a harness error. */
function replayShaper(calls: readonly ReplayCall[]): GlyphShaper {
  return {
    shape(face: string, size: number, text: string, start: number, end: number, script: string, rtl: boolean, language: string, features: readonly number[]): readonly number[] {
      for (const c of calls) {
        if (c.face === face && c.size === size && c.text === text && c.start === start && c.end === end && c.script === script && c.rtl === rtl && c.language === language && sameNumbers(c.features, features)) return c.glyphs;
      }
      return fail(`the shape transcript holds no call ${face} ${size} [${start}, ${end}) of ${text}`);
    },
  };
}

/**
 * The shaped measurer of a transcript from the engine's shaping primitives (shaping.ts makeItem, shapeItem and the view widths the
 * line breaker reads), as layout/src/shaping.ts shapedText composes them: the translated engine's roots do not reach shapedText,
 * and a host builds its measurer this way. runEngineCase scopes it to R4 as shapedMeasurerFor does; text-latin-engine.test.ts
 * proves its layouts equal the Node host's.
 */
function replayMeasurer(s: Shaping, faults: EngineFaults): TextMeasurer {
  const shaper = replayShaper(s.calls);
  const sf: ShapingFaults = {
    advanceNot16_16: faults.advanceNot16_16, doubleAccumulation: faults.doubleAccumulation, noReshapeAtBreak: faults.noReshapeAtBreak, kerningDropped: faults.kerningDropped,
    wholePixelPositions: faults.wholePixelPositions, softHyphenWidthMissing: faults.softHyphenWidthMissing, metricRoundingSwapped: faults.metricRoundingSwapped,
  };
  const faceOf = (family: string): ReplayFace => {
    const f = s.faces.get(family);
    if (f === undefined) return fail(`the shape transcript has no face ${family}`);
    return f;
  };
  const itemFor = (text: string, font: TextFont): ShapedItem => {
    const f = s.faces.get(font.family);
    if (f === undefined) return { ok: false, code: 'text-glyph', reason: `no bundled face ${font.family}` };
    const made = makeItem({ shaper, face: font.family, size: platformFontSize(font.size), text, language: s.language, hanKerning: f.hanKerning, faults: sf });
    if (!made.ok) return { ok: false, code: 'text-glyph', reason: made.reason };
    const result = shapeItem(made.item);
    if (result.missing >= 0) return { ok: false, code: 'text-glyph', reason: `U+${result.missing.toString(16).toUpperCase()} has no glyph; font fallback is outside the shaping core` };
    return { ok: true, item: made.item, result };
  };
  /** A code point index as the UTF-16 offset of the item. */
  const offsetOf = (units: readonly number[], codePoint: number): number => {
    let k = 0;
    for (let i = 0; i < units.length; i++) {
      if ((units[i] as number) < 0) continue;
      if (k === codePoint) return i;
      k++;
    }
    return units.length;
  };
  const position = (r: ShapeResult, offset: number): LU => {
    const i = offset - r.start;
    return i < r.positions.length ? fromRaw(r.positions[i] as number) : fromPxCeil(inlineToFloat(r.total));
  };
  return {
    metrics(font: TextFont): FontMetrics {
      const d = faceOf(font.family).data;
      const size = platformFontSize(font.size);
      const round = (units: number): LU => (sf.metricRoundingSwapped ? roundFontMetricHalfUpToWholePx(fontMetricPx(size, d.unitsPerEm, units)) : roundCoreTextMetricToWholePx(units, d.unitsPerEm, size));
      return { ascent: round(d.ascent), descent: round(d.descent), lineGap: d.lineGap === 0 ? ZERO : round(d.lineGap) };
    },
    measure(text: string, font: TextFont): MeasureResult {
      const r = itemFor(text, font);
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      return { ok: true, measure: { width: viewSnappedWidth(r.item, wholeView(r.result)) } };
    },
    measureRange(text: string, start: number, end: number, font: TextFont): MeasureResult {
      const r = itemFor(text, font);
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      return { ok: true, measure: { width: sub(position(r.result, offsetOf(r.item.units, end)), position(r.result, offsetOf(r.item.units, start))) } };
    },
    lengths(font: TextFont): FontLengths {
      return fontMetricLengths(faceOf(font.family).data, platformFontSize(font.size));
    },
    shaped(text: string, font: TextFont): ShapedItem {
      return itemFor(text, font);
    },
    hasFace(family: string): boolean {
      return s.faces.has(family);
    },
  };
}

/** A scroll metrics record: the id, the client size and the scroll rect (overflow.ts). */
function scrollRecord(s: ScrollMetrics): string {
  return `[${q(s.id)},${h(s.clientWidth)},${h(s.clientHeight)},${h(s.scrollRect.x)},${h(s.scrollRect.y)},${h(s.scrollRect.width)},${h(s.scrollRect.height)}]`;
}

/**
 * A line with a viewportDirection key (the engine-overflow suite) also runs scrollMetrics and appends its result; every other line
 * keeps its output byte for byte.
 */
function scrollSuffix(input: LayoutInput, measurer: TextMeasurer, direction: string, faults: EngineFaults): string {
  const r = scrollMetricsWithFaults(input, measurer, direction === 'rtl' ? 'rtl' : 'ltr', faults);
  if (r.kind === 'refused') return `,["refused",${q(r.nodeId)},${q(r.detail)}]`;
  let out = `,["ok",${scrollRecord(r.viewport)},[`;
  r.containers.forEach((c, i) => {
    if (i > 0) out += ',';
    out += scrollRecord(c);
  });
  return `${out}]]`;
}

/**
 * The first shaping plant set in faults, or ''. The shaping plants act only through a shaped measurer (platform.ts
 * shapedMeasurerFor, or replayMeasurer here), so a case without a shape transcript, which measurerFor's Ahem measurer lays out,
 * refuses them rather than run them inert.
 */
function shapingPlantOf(f: EngineFaults): string {
  if (f.advanceNot16_16) return 'advanceNot16_16';
  if (f.doubleAccumulation) return 'doubleAccumulation';
  if (f.noReshapeAtBreak) return 'noReshapeAtBreak';
  if (f.kerningDropped) return 'kerningDropped';
  if (f.wholePixelPositions) return 'wholePixelPositions';
  if (f.softHyphenWidthMissing) return 'softHyphenWidthMissing';
  if (f.metricRoundingSwapped) return 'metricRoundingSwapped';
  if (f.latinCheckSkipped) return 'latinCheckSkipped';
  return '';
}

/** One engine case: {platform, faults, input} in, the layout (and its absolute rects) out; with shaping, a replayed HarfBuzz measures. */
export function runEngineCase(line: string): string {
  try {
    const parsed = parseJson(line);
    const shaped = parsed.kind === 'obj' && parsed.values.has('shaping');
    const scroll = parsed.kind === 'obj' && parsed.values.has('viewportDirection');
    const keys: string[] = ['platform', 'faults', 'input'];
    if (shaped) keys.push('shaping');
    if (scroll) keys.push('viewportDirection');
    const o = obj(parsed, keys, '$');
    const direction = scroll ? lit(field(o, 'viewportDirection', '$'), ['ltr', 'rtl'], '$.viewportDirection') : 'ltr';
    const platform = str(field(o, 'platform', '$'), '$.platform');
    const faults = decodeFaults(field(o, 'faults', '$'));
    const plant = shapingPlantOf(faults);
    if (plant !== '' && !shaped) fail(`$.faults.${plant} is a shaping plant, which acts only through the shaped measurer; the harness has only measurerFor's Ahem measurer`);
    const input = decodeInput(field(o, 'input', '$'));
    let m = measurerFor(platform);
    if (shaped && m.kind === 'ok') {
      const s = decodeShaping(field(o, 'shaping', '$'), '$.shaping');
      m = { kind: 'ok', platform, key: `shaped/${platform}`, measurer: latinScopedMeasurer(replayMeasurer(s, faults), faults.latinCheckSkipped), rules: m.rules };
    }
    if (m.kind !== 'ok') return `["refused",${q(m.code)}]`;
    const r = layoutWithFaults(input, m.measurer, faults);
    if (r.kind !== 'ok') {
      const u = r.unsupported;
      return `["unsupported",${q(u.code)},${q(u.nodeId)},${q(u.specSection)},${q(u.detail)}]`;
    }
    let out = `["ok",${q(m.key)},[`;
    r.boxes.forEach((b, i) => {
      if (i > 0) out += ',';
      out += `[${q(b.id)},${b.parent === null ? 'null' : q(b.parent)},${h(b.x)},${h(b.y)},${h(b.width)},${h(b.height)}]`;
    });
    out += '],[';
    let first = true;
    for (const [id, rect] of absoluteRects(r.boxes)) {
      if (!first) out += ',';
      first = false;
      out += `[${q(id)},${h(rect.x)},${h(rect.y)},${h(rect.width)},${h(rect.height)}]`;
    }
    return `${out}]${scroll ? scrollSuffix(input, m.measurer, direction, faults) : ''}]`;
  } catch (e) {
    if (e instanceof HarnessError) return `["harness-error",${q(e.detail)}]`;
    return '["threw"]';
  }
}

function arg(a: readonly JsonValue[], i: number): number {
  const v = a[i];
  if (v === undefined) return fail(`missing argument ${i}`);
  return hexBits(str(v, `$[${i}]`));
}

function unitsResult(name: string, a: readonly JsonValue[]): number {
  switch (name) {
    case 'fromCssPx':
      return fromCssPx(arg(a, 1));
    case 'fromDouble':
      return fromDouble(arg(a, 1));
    case 'fromPxRound':
      return fromPxRound(arg(a, 1));
    case 'fromPxCeil':
      return fromPxCeil(arg(a, 1));
    case 'snapBorderWidth':
      return snapBorderWidth(arg(a, 1), arg(a, 2));
    case 'percentOf':
      return percentOf(arg(a, 1) as LU, arg(a, 2));
    case 'roundFontMetricToWholePx':
      return roundFontMetricToWholePx(arg(a, 1));
    case 'platformFontSize':
      return platformFontSize(arg(a, 1));
    case 'textAdvance':
      return textAdvance(arg(a, 1), arg(a, 2));
    case 'lineHeightFromNumber':
      return lineHeightFromNumber(arg(a, 1), arg(a, 2));
    case 'growShare':
      return growShare(arg(a, 1) as LU, arg(a, 2), arg(a, 3) as FactorSum);
    case 'shrinkShare':
      return shrinkShare(arg(a, 1) as LU, arg(a, 2), arg(a, 3) as LU, arg(a, 4) as FactorSum);
    case 'fractionalFreeSpace':
      return fractionalFreeSpace(arg(a, 1) as LU, arg(a, 2) as FactorSum);
    case 'divInt':
      return divInt(arg(a, 1) as LU, arg(a, 2));
    case 'cumulativeShareRounded':
      return cumulativeShareRounded(arg(a, 1) as LU, arg(a, 2), arg(a, 3));
    // Extended corpus (units-m2): the zoom model, R2, the snap rule and R4.
    case 'fromFloatRound':
      return fromFloatRound(arg(a, 1));
    case 'zoomCssPx':
      return zoomCssPx(arg(a, 1), arg(a, 2));
    case 'zoomFontSize':
      return zoomFontSize(arg(a, 1), arg(a, 2));
    case 'zoomViewportPx':
      return zoomViewportPx(arg(a, 1), arg(a, 2));
    case 'snapEdge':
      return snapEdge(arg(a, 1) as LU);
    case 'cachedRangeWidth':
      return cachedRangeWidth(arg(a, 1), arg(a, 2), arg(a, 3));
    // Calc suite (units-calc): R6, the leaves of a calculation, float PixelsAndPercent, the stores and the double min and max steps.
    case 'viewportUnitBase':
      return viewportUnitBase(arg(a, 1), arg(a, 2));
    case 'viewportLeafPx':
      return viewportLeafPx(arg(a, 1), arg(a, 2), arg(a, 3));
    case 'emLeafPx':
      return emLeafPx(arg(a, 1), arg(a, 2), arg(a, 3));
    case 'pixelsAndPercentAt':
      return pixelsAndPercentAt(arg(a, 1), arg(a, 2), arg(a, 3));
    case 'cssLengthFixed':
      return cssLengthFixed(arg(a, 1));
    case 'clampLengthFloat':
      return clampLengthFloat(arg(a, 1));
    case 'floatInvert':
      return floatInvert(arg(a, 1));
    case 'doubleMinStep':
      return doubleMinStep(arg(a, 1), arg(a, 2));
    case 'doubleMaxStep':
      return doubleMaxStep(arg(a, 1), arg(a, 2));
    case 'calcToLu':
      return calcToLu(arg(a, 1), arg(a, 2) !== 0);
    case 'distributedOffset': {
      const v = a[1];
      if (v === undefined) return fail('missing mode');
      const mode = lit(v, ['space-between', 'space-around', 'space-evenly'], '$[1]') as DistributedMode;
      return distributedOffset(mode, arg(a, 2) as LU, arg(a, 3), arg(a, 4));
    }
    default:
      return fail(`unknown function ${name}`);
  }
}

// ---------------------------------------------------------------- paint suites (EMS)

/** count doubles from argument i on. */
function argList(a: readonly JsonValue[], i: number, count: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(arg(a, i + k));
  return out;
}

/** A result list of doubles as bits. */
function numList(xs: readonly number[]): string {
  let out = '["ok",[';
  for (let k = 0; k < xs.length; k++) {
    if (k > 0) out += ',';
    out += h(xs[k] as number);
  }
  return `${out}]]`;
}

/** One radius length from arguments i (percent flag, 0 or 1) and i + 1 (value). */
function radiusLength(a: readonly JsonValue[], i: number): RadiusLength {
  const flag = arg(a, i);
  if (flag !== 0 && flag !== 1) return fail(`radius length flag ${flag} is not 0 or 1`);
  return { percent: flag === 1, value: arg(a, i + 1) };
}

/** Eight radius lengths from argument i on. */
function radiusLengths(a: readonly JsonValue[], i: number): RadiusLength[] {
  const out: RadiusLength[] = [];
  for (let k = 0; k < 8; k++) out.push(radiusLength(a, i + 2 * k));
  return out;
}

/** The radius faults from arguments i (radiusUnclamped) and i + 1 (innerRadiusNotReduced), each 0 or 1. */
function radiusFaults(a: readonly JsonValue[], i: number): RadiusFaults {
  return { radiusUnclamped: arg(a, i) !== 0, innerRadiusNotReduced: arg(a, i + 1) !== 0 };
}

/** The shadow faults from arguments i (spreadIgnored), i + 1 (sigmaHalfBlur) and i + 2 (shadowNotClippedOut). */
function shadowFaults(a: readonly JsonValue[], i: number): ShadowFaults {
  return { spreadIgnored: arg(a, i) !== 0, sigmaHalfBlur: arg(a, i + 1) !== 0, shadowNotClippedOut: arg(a, i + 2) !== 0 };
}

/** A shadow shape from arguments i (left, top, right, bottom, then eight radii). */
function shadowShape(a: readonly JsonValue[], i: number): ShadowShape {
  return { left: arg(a, i), top: arg(a, i + 1), right: arg(a, i + 2), bottom: arg(a, i + 3), radii: argList(a, i + 4, 8) };
}

/** A count at argument i, then that many shadows of nine arguments each (inset, x, y, blur, spread, r, g, b, a). */
function shadowInputs(a: readonly JsonValue[], i: number): ShadowInput[] {
  const n = arg(a, i);
  const out: ShadowInput[] = [];
  for (let k = 0; k < n; k++) {
    const at = i + 1 + 9 * k;
    out.push({ inset: arg(a, at) !== 0, x: arg(a, at + 1), y: arg(a, at + 2), blur: arg(a, at + 3), spread: arg(a, at + 4), r: arg(a, at + 5), g: arg(a, at + 6), b: arg(a, at + 7), a: arg(a, at + 8) });
  }
  return out;
}

/** A count at argument i, then that many backdrop fills of sixteen arguments each (edges, eight radii, r, g, b, a). */
function backdropFills(a: readonly JsonValue[], i: number): BackdropFill[] {
  const n = arg(a, i);
  const out: BackdropFill[] = [];
  for (let k = 0; k < n; k++) {
    const at = i + 1 + 16 * k;
    out.push({ left: arg(a, at), top: arg(a, at + 1), right: arg(a, at + 2), bottom: arg(a, at + 3), radii: argList(a, at + 4, 8), r: arg(a, at + 12), g: arg(a, at + 13), b: arg(a, at + 14), a: arg(a, at + 15) });
  }
  return out;
}

/** A shape result: its edges then its eight radii. */
function shapeResult(s: ShadowShape): string {
  const xs: number[] = [s.left, s.top, s.right, s.bottom];
  for (let k = 0; k < s.radii.length; k++) xs.push(s.radii[k] as number);
  return numList(xs);
}

/**
 * A layer result: its edges, its value count and a digest of its values (h = (h * 31 + v + 1) mod 2147483647, exact in double),
 * so a layer of thousands of values stays one short line while any changed value changes the line.
 */
function layerResult(l: ShadowLayer): string {
  let d = 0;
  for (let k = 0; k < l.rgba.length; k++) {
    const v = d * 31 + (l.rgba[k] as number) + 1;
    d = v - Math.floor(v / 2147483647) * 2147483647;
  }
  return numList([l.left, l.top, l.right, l.bottom, l.rgba.length, d]);
}

/**
 * One paint case, run through the units mode: ["paint:<feature>:<function>", arg...] in, the whole result line out; null for any
 * other name. Registration point (RT-13 style): each paint package adds one case per root; its vectors are
 * packages/layout/paint-vectors/<feature>/*.json.
 */
function paintResult(name: string, a: readonly JsonValue[]): string | null {
  if (a.length === 0) return fail(`paint case ${name} has no name`);
  if (name === 'paint:dash:selectBestDashGap') return `["ok",${h(selectBestDashGap(arg(a, 1), arg(a, 2), arg(a, 3)))}]`;
  if (name === 'paint:dash:borderNeedsSidePainter') return `["ok",${borderNeedsSidePainter(bitsList(a, 1), strList(a, 2), bitsList(a, 3)) ? 'true' : 'false'}]`;
  if (name === 'paint:dash:borderPaintOps') {
    const faults: DashFaults = { phase1: flagAt(a, 8), gapUnfitted: flagAt(a, 9) };
    return `["ok",[${commaList(borderPaintOps(arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), bitsList(a, 5), strList(a, 6), bitsList(a, 7), faults).map(borderOpJson))}]]`;
  }
  // PNT2: paint-transform.ts.
  if (name === 'paint:transform:resolveTransformOrigin') {
    const o = resolveTransformOrigin(decodeOrigin(item(a, 1, '$'), '$[1]'), arg(a, 2), arg(a, 3));
    return `["ok",[${h(o.x)},${h(o.y)}]]`;
  }
  if (name === 'paint:transform:transformFunctionsMatrix') return `["ok",${matrixJson(transformFunctionsMatrix(decodeOps(item(a, 1, '$'), '$[1]'), arg(a, 2), arg(a, 3), tableTrig(item(a, 4, '$'), '$[4]')))}]`;
  if (name === 'paint:transform:paintTransformMatrix') {
    return `["ok",${matrixJson(paintTransformMatrix(decodeOps(item(a, 1, '$'), '$[1]'), decodeOrigin(item(a, 2, '$'), '$[2]'), arg(a, 3), arg(a, 4), tableTrig(item(a, 5, '$'), '$[5]')))}]`;
  }
  if (name === 'paint:transform:transformAboutPoint') return `["ok",${matrixJson(transformAboutPoint(decodeMatrix(item(a, 1, '$'), '$[1]'), arg(a, 2), arg(a, 3)))}]`;
  if (name === 'paint:transform:mapPoint') {
    const p = mapPoint(decodeMatrix(item(a, 1, '$'), '$[1]'), arg(a, 2), arg(a, 3));
    return `["ok",[${h(p.x)},${h(p.y)}]]`;
  }
  if (name === 'paint:radius:radiusComponent') return `["ok",${h(radiusComponent(radiusLength(a, 1), arg(a, 3), arg(a, 4)))}]`;
  if (name === 'paint:radius:resolveCornerRadii') return numList(resolveCornerRadii(radiusLengths(a, 1), arg(a, 17), arg(a, 18), arg(a, 19)));
  if (name === 'paint:radius:constrainCornerRadii') return numList(constrainCornerRadii(argList(a, 1, 8), arg(a, 9), arg(a, 10), radiusFaults(a, 11)));
  if (name === 'paint:radius:radiiRenderable') return `["ok",${radiiRenderable(argList(a, 1, 8), arg(a, 9), arg(a, 10)) ? 'true' : 'false'}]`;
  if (name === 'paint:radius:innerCornerRadii') return numList(innerCornerRadii(argList(a, 1, 8), argList(a, 9, 4), arg(a, 13), arg(a, 14), radiusFaults(a, 15)));
  if (name === 'paint:radius:roundedShape') return numList(roundedShape(arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), arg(a, 5), arg(a, 6), argList(a, 7, 4), radiusLengths(a, 11), arg(a, 27), radiusFaults(a, 28)));
  if (name === 'paint:radius:outlineWidthPx') return `["ok",${h(outlineWidthPx(arg(a, 1), arg(a, 2)))}]`;
  if (name === 'paint:radius:outlineOffsetPx') return `["ok",${h(outlineOffsetPx(arg(a, 1), arg(a, 2)))}]`;
  if (name === 'paint:radius:outlineRings') return numList(outlineRings(arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), argList(a, 5, 8), arg(a, 13), arg(a, 14), arg(a, 15) !== 0));
  if (name === 'paint:radius:hasRoundedCorner') return `["ok",${hasRoundedCorner(argList(a, 1, 8)) ? 'true' : 'false'}]`;
  if (name === 'paint:shadow:spreadShape') return shapeResult(spreadShape(arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), argList(a, 5, 8), arg(a, 13), shadowFaults(a, 14)));
  if (name === 'paint:shadow:shapeCoverage') return `["ok",${h(shapeCoverage(shadowShape(a, 1), arg(a, 13), arg(a, 14)))}]`;
  if (name === 'paint:shadow:shapeType') return `["ok",${q(shapeType(shadowShape(a, 1)))}]`;
  if (name === 'paint:shadow:blurredCoverage') {
    const m = blurredCoverage(shadowShape(a, 1), arg(a, 13), { left: arg(a, 14), top: arg(a, 15), right: arg(a, 16), bottom: arg(a, 17) });
    return layerResult({ left: m.bounds.left, top: m.bounds.top, right: m.bounds.right, bottom: m.bounds.bottom, rgba: m.data });
  }
  if (name === 'paint:shadow:outerShadowLayer') return layerResult(outerShadowLayer(arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), argList(a, 5, 8), arg(a, 13) !== 0, shadowInputs(a, 14), arg(a, 15 + 9 * arg(a, 14)), shadowFaults(a, 16 + 9 * arg(a, 14))));
  if (name === 'paint:shadow:insetShadowLayer') return layerResult(insetShadowLayer(arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), argList(a, 5, 4), argList(a, 9, 8), shadowInputs(a, 17), arg(a, 18 + 9 * arg(a, 17)), shadowFaults(a, 19 + 9 * arg(a, 17))));
  if (name === 'paint:shadow:outerShadowLayerOver') return layerResult(outerShadowLayerOver(arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), argList(a, 5, 8), arg(a, 13) !== 0, shadowInputs(a, 14), arg(a, 15 + 9 * arg(a, 14)), shadowFaults(a, 16 + 9 * arg(a, 14)), backdropFills(a, 19 + 9 * arg(a, 14))));
  if (name === 'paint:shadow:insetShadowLayerOver') return layerResult(insetShadowLayerOver(arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), argList(a, 5, 4), argList(a, 9, 8), shadowInputs(a, 17), arg(a, 18 + 9 * arg(a, 17)), shadowFaults(a, 19 + 9 * arg(a, 17)), backdropFills(a, 22 + 9 * arg(a, 17))));
  if (name === 'paint:shadow:backdropAt') {
    const fills = backdropFills(a, 1);
    const at = 2 + 16 * fills.length;
    return numList(backdropAt(fills, arg(a, at), arg(a, at + 1)));
  }
  if (name === 'paint:shadow:platformOver') return `["ok",${h(platformOver(arg(a, 1), arg(a, 2), arg(a, 3)))}]`;
  if (name === 'paint:shadow:encodeOver') return numList(encodeOver(arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), arg(a, 5), arg(a, 6), arg(a, 7)));
  const gradient = gradientResult(name, a);
  if (gradient !== null) return gradient;
  return null;
}

/** Argument i: an array of numbers as bit patterns. */
function bitsList(a: readonly JsonValue[], i: number): number[] {
  return arr(item(a, i, '$'), `$[${i}]`).map((v) => hexBits(str(v, `$[${i}]`)));
}

/** Argument i: an array of strings. */
function strList(a: readonly JsonValue[], i: number): string[] {
  return arr(item(a, i, '$'), `$[${i}]`).map((v) => str(v, `$[${i}]`));
}

function flagAt(a: readonly JsonValue[], i: number): boolean {
  return bool(item(a, i, '$'), `$[${i}]`);
}

/** A border drawing operation: [op, side, alpha, antialias, [points]] with every number as bits. */
function borderOpJson(o: BorderOp): string {
  return `[${q(o.op)},${h(o.side)},${h(o.alpha)},${o.antialias ? 'true' : 'false'},[${commaList(o.points.map(h))}]]`;
}

function commaList(parts: readonly string[]): string {
  let out = '';
  for (const x of parts) out = out === '' ? x : `${out},${x}`;
  return out;
}

// PNT2 decoders: a length is [kind, px bits, percent bits]; an op [fn, x, y, angle bits, sx bits, sy bits]; a matrix [full, a..f bits];
// the trig table [[radians bits, sin bits, cos bits], ...] stands in for the platform's sin and cos, so every target reads the same values.
function decodeLength(v: JsonValue, path: string): LengthValue {
  const t = arr(v, path);
  if (t.length !== 3) return fail(`${path}: expected [kind, px, percent]`);
  const kind = lit(item(t, 0, path), ['px', 'percent', 'calc'], `${path}[0]`) as LengthValue['kind'];
  return { kind, px: hexBits(str(item(t, 1, path), `${path}[1]`)), percent: hexBits(str(item(t, 2, path), `${path}[2]`)) };
}

function decodeOrigin(v: JsonValue, path: string): TransformOrigin {
  const t = arr(v, path);
  if (t.length !== 2) return fail(`${path}: expected [x, y]`);
  return { x: decodeLength(item(t, 0, path), `${path}[0]`), y: decodeLength(item(t, 1, path), `${path}[1]`) };
}

function decodeOps(v: JsonValue, path: string): TransformOp[] {
  const out: TransformOp[] = [];
  arr(v, path).forEach((o, i) => {
    const at = `${path}[${i}]`;
    const t = arr(o, at);
    if (t.length !== 6) fail(`${at}: expected [fn, x, y, angle, sx, sy]`);
    const fn = lit(item(t, 0, at), ['translate', 'translateX', 'translateY', 'rotate', 'scale', 'scaleX', 'scaleY'], `${at}[0]`) as TransformFn;
    out.push({ fn, x: decodeLength(item(t, 1, at), `${at}[1]`), y: decodeLength(item(t, 2, at), `${at}[2]`), angle: hexBits(str(item(t, 3, at), at)), sx: hexBits(str(item(t, 4, at), at)), sy: hexBits(str(item(t, 5, at), at)) });
  });
  return out;
}

function decodeMatrix(v: JsonValue, path: string): Matrix2D {
  const t = arr(v, path);
  if (t.length !== 7) return fail(`${path}: expected [full, a, b, c, d, e, f]`);
  const n = (i: number): number => hexBits(str(item(t, i, path), `${path}[${i}]`));
  return { full: bool(item(t, 0, path), `${path}[0]`), a: n(1), b: n(2), c: n(3), d: n(4), e: n(5), f: n(6) };
}

type TrigEntry = { readonly radians: number; readonly sin: number; readonly cos: number };

function tableTrig(v: JsonValue, path: string): Trig {
  const table: TrigEntry[] = [];
  arr(v, path).forEach((e, i) => {
    const at = `${path}[${i}]`;
    const t = arr(e, at);
    if (t.length !== 3) fail(`${at}: expected [radians, sin, cos]`);
    table.push({ radians: hexBits(str(item(t, 0, at), at)), sin: hexBits(str(item(t, 1, at), at)), cos: hexBits(str(item(t, 2, at), at)) });
  });
  const find = (r: number): TrigEntry => {
    for (const e of table) if (e.radians === r) return e;
    return fail(`the trig table has no entry for ${bitsHex(r)}`);
  };
  return { sin: (r: number): number => find(r).sin, cos: (r: number): number => find(r).cos };
}

function matrixJson(m: Matrix2D): string {
  return `[${m.full ? 'true' : 'false'},${h(m.a)},${h(m.b)},${h(m.c)},${h(m.d)},${h(m.e)},${h(m.f)}]`;
}

// ---------------------------------------------------------------- paint suite: gradient (BG2)

function gradLength(v: JsonValue, path: string): LengthPct {
  const o = obj(v, ['unit', 'value'], path);
  return { unit: lit(field(o, 'unit', path), ['percent', 'px', 'end-percent', 'end-px'], `${path}.unit`) as LengthPct['unit'], value: numField(o, 'value', path) };
}

function gradColor(v: JsonValue, path: string): StopColor {
  const o = obj(v, ['r', 'g', 'b', 'alpha'], path);
  return { r: numField(o, 'r', path), g: numField(o, 'g', path), b: numField(o, 'b', path), alpha: numField(o, 'alpha', path) };
}

function gradStop(v: JsonValue, path: string): CssStop {
  const o = obj(v, ['color', 'unit', 'value'], path);
  return { color: gradColor(field(o, 'color', path), `${path}.color`), unit: lit(field(o, 'unit', path), ['auto', 'percent', 'px'], `${path}.unit`) as 'auto' | 'percent' | 'px', value: numField(o, 'value', path) };
}

const GRADIENT_KEYS: readonly string[] = ['radial', 'repeating', 'direction', 'angleDeg', 'slope', 'sideX', 'sideY', 'circle', 'extent', 'radiusX', 'radiusY', 'centerX', 'centerY', 'stops'];

function gradImage(v: JsonValue, path: string): GradientImage {
  const o = obj(v, GRADIENT_KEYS, path);
  const stops: CssStop[] = [];
  arr(field(o, 'stops', path), `${path}.stops`).forEach((s, i) => {
    stops.push(gradStop(s, `${path}.stops[${i}]`));
  });
  if (stops.length < 2) fail(`${path}.stops: a gradient has at least two stops`);
  return {
    radial: bool(field(o, 'radial', path), `${path}.radial`),
    repeating: bool(field(o, 'repeating', path), `${path}.repeating`),
    direction: lit(field(o, 'direction', path), ['default', 'angle', 'side'], `${path}.direction`) as 'default' | 'angle' | 'side',
    angleDeg: numField(o, 'angleDeg', path),
    slope: numField(o, 'slope', path),
    sideX: lit(field(o, 'sideX', path), ['none', 'left', 'right'], `${path}.sideX`) as 'none' | 'left' | 'right',
    sideY: lit(field(o, 'sideY', path), ['none', 'top', 'bottom'], `${path}.sideY`) as 'none' | 'top' | 'bottom',
    circle: bool(field(o, 'circle', path), `${path}.circle`),
    extent: lit(field(o, 'extent', path), ['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner', 'explicit'], `${path}.extent`) as 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner' | 'explicit',
    radiusX: gradLength(field(o, 'radiusX', path), `${path}.radiusX`),
    radiusY: gradLength(field(o, 'radiusY', path), `${path}.radiusY`),
    centerX: gradLength(field(o, 'centerX', path), `${path}.centerX`),
    centerY: gradLength(field(o, 'centerY', path), `${path}.centerY`),
    stops,
  };
}

function gradSize(v: JsonValue, path: string): SizeComponent {
  const o = obj(v, ['unit', 'value'], path);
  return { unit: lit(field(o, 'unit', path), ['auto', 'percent', 'px'], `${path}.unit`) as 'auto' | 'percent' | 'px', value: numField(o, 'value', path) };
}

const BOXES: readonly string[] = ['border-box', 'padding-box', 'content-box'];

function gradGeometry(v: JsonValue, path: string): LayerGeometry {
  const o = obj(v, ['sizeKind', 'sizeX', 'sizeY', 'positionX', 'positionY', 'repeatX', 'repeatY', 'origin', 'clip'], path);
  return {
    sizeKind: lit(field(o, 'sizeKind', path), ['length', 'cover', 'contain'], `${path}.sizeKind`) as 'length' | 'cover' | 'contain',
    sizeX: gradSize(field(o, 'sizeX', path), `${path}.sizeX`),
    sizeY: gradSize(field(o, 'sizeY', path), `${path}.sizeY`),
    positionX: gradLength(field(o, 'positionX', path), `${path}.positionX`),
    positionY: gradLength(field(o, 'positionY', path), `${path}.positionY`),
    repeatX: lit(field(o, 'repeatX', path), ['repeat', 'no-repeat'], `${path}.repeatX`) as RepeatKeyword,
    repeatY: lit(field(o, 'repeatY', path), ['repeat', 'no-repeat'], `${path}.repeatY`) as RepeatKeyword,
    origin: lit(field(o, 'origin', path), BOXES, `${path}.origin`) as BoxKeyword,
    clip: lit(field(o, 'clip', path), BOXES, `${path}.clip`) as BoxKeyword,
  };
}

function gradNumbers(v: JsonValue, n: number, path: string): number[] {
  const out: number[] = [];
  const items = arr(v, path);
  if (items.length !== n) fail(`${path}: expected ${n} numbers`);
  items.forEach((x, i) => {
    out.push(num(x, `${path}[${i}]`));
  });
  return out;
}

function gradPaint(v: JsonValue, path: string): BackgroundPaint {
  const o = obj(v, ['box', 'color', 'colorClip', 'layers', 'lastIsBottom', 'zoom', 'tileSize', 'layerX', 'layerY'], path);
  const b = obj(field(o, 'box', path), ['x', 'y', 'width', 'height', 'borders', 'padding', 'obscures'], `${path}.box`);
  const obscures: boolean[] = [];
  arr(field(b, 'obscures', path), `${path}.box.obscures`).forEach((x, i) => {
    obscures.push(bool(x, `${path}.box.obscures[${i}]`));
  });
  if (obscures.length !== 4) fail(`${path}.box.obscures: expected 4 flags`);
  const layers: BackgroundLayer[] = [];
  arr(field(o, 'layers', path), `${path}.layers`).forEach((l, i) => {
    const lo = obj(l, ['geometry', 'image'], `${path}.layers[${i}]`);
    layers.push({ geometry: gradGeometry(field(lo, 'geometry', path), `${path}.layers[${i}].geometry`), image: gradImage(field(lo, 'image', path), `${path}.layers[${i}].image`) });
  });
  return {
    box: { x: numField(b, 'x', path), y: numField(b, 'y', path), width: numField(b, 'width', path), height: numField(b, 'height', path), borders: gradNumbers(field(b, 'borders', path), 4, `${path}.box.borders`), padding: gradNumbers(field(b, 'padding', path), 4, `${path}.box.padding`), obscures },
    color: gradColor(field(o, 'color', path), `${path}.color`),
    colorClip: lit(field(o, 'colorClip', path), BOXES, `${path}.colorClip`) as BoxKeyword,
    layers,
    lastIsBottom: bool(field(o, 'lastIsBottom', path), `${path}.lastIsBottom`),
    zoom: numField(o, 'zoom', path),
    tileSize: numField(o, 'tileSize', path),
    layerX: numField(o, 'layerX', path),
    layerY: numField(o, 'layerY', path),
  };
}

/** The gradient suite: the exact arithmetic, Blink's gradient descriptor, and whole background rows; null for other names. */
function gradientResult(name: string, a: readonly JsonValue[]): string | null {
  switch (name) {
    case 'paint:gradient:sqrtF64':
      return `["ok",${h(sqrtF64(arg(a, 1)))}]`;
    case 'paint:gradient:hypotF32':
      return `["ok",${h(hypotF32(arg(a, 1), arg(a, 2)))}]`;
    case 'paint:gradient:fma64':
      return `["ok",${h(fma64(arg(a, 1), arg(a, 2), arg(a, 3)))}]`;
    case 'paint:gradient:gradientDesc': {
      const d = gradientDesc(gradImage(item(a, 1, '$'), '$[1]'), arg(a, 2), arg(a, 3), arg(a, 4));
      let out = `["ok",${d.modelled ? 'true' : 'false'},${h(d.p0x)},${h(d.p0y)},${h(d.p1x)},${h(d.p1y)},${h(d.r0)},${h(d.r1)},${h(d.aspect)},[`;
      for (let i = 0; i < d.offsets.length; i++) {
        const c = d.colors[i];
        if (c === undefined) return fail('a stop without a colour');
        out += `${i > 0 ? ',' : ''}[${h(d.offsets[i] as number)},${h(c.r)},${h(c.g)},${h(c.b)},${h(c.a)}]`;
      }
      return `${out}]]`;
    }
    case 'paint:gradient:backgroundRow': {
      // The whole row, every value as two hex digits, so native runs are compared byte for byte.
      const plan = planBackground(gradPaint(item(a, 1, '$'), '$[1]'), gradientFaults('none'));
      const row = backgroundRow(plan, arg(a, 2), gradientFaults('none'));
      let bytes = '';
      for (let i = 0; i < row.length; i++) {
        const x = row[i] as number;
        if (!(x >= 0 && x <= 255 && Math.floor(x) === x)) return fail(`row value ${i} is not a byte`);
        bytes += `${x < 16 ? '0' : ''}${x.toString(16)}`;
      }
      return `["ok",${plan.modelled ? 'true' : 'false'},${h(plan.left)},${h(plan.right)},${h(row.length)},${q(bytes)}]`;
    }
    default:
      return null;
  }
}


/** One units case: ["name", arg bits...] in, the result bits out. */
export function runUnitsCase(line: string): string {
  try {
    const a = arr(parseJson(line), '$');
    const first = a[0];
    if (first === undefined) return fail('empty case');
    const name = str(first, '$[0]');
    try {
      const paint = paintResult(name, a);
      if (paint !== null) return paint;
      return `["ok",${h(unitsResult(name, a))}]`;
    } catch (e) {
      if (e instanceof HarnessError) throw e;
      return '["threw"]';
    }
  } catch (e) {
    if (e instanceof HarnessError) return `["harness-error",${q(e.detail)}]`;
    return '["threw"]';
  }
}

// ---------------------------------------------------------------- snap suite

function item(a: readonly JsonValue[], i: number, path: string): JsonValue {
  const v = a[i];
  if (v === undefined) return fail(`${path}: missing item ${i}`);
  return v;
}

/** A layout rect [id, parent or null, x, y, width, height], the LU as bits. */
function decodeRect(v: JsonValue, path: string): LayoutRect {
  const a = arr(v, path);
  if (a.length !== 6) return fail(`${path}: expected [id, parent, x, y, width, height]`);
  const p = item(a, 1, path);
  return {
    id: str(item(a, 0, path), path),
    parent: p.kind === 'null' ? null : str(p, path),
    x: hexBits(str(item(a, 2, path), path)) as LU,
    y: hexBits(str(item(a, 3, path), path)) as LU,
    width: hexBits(str(item(a, 4, path), path)) as LU,
    height: hexBits(str(item(a, 5, path), path)) as LU,
  };
}

/**
 * One snap case: {"dpr", "rects"} in, where rects is a layout result in zoomed LU at that DPR (the DPR only labels the case: LU are
 * 1/64 device px at every DPR); snapEdges out, every edge and size as bits.
 */
export function runSnapCase(line: string): string {
  try {
    const o = obj(parseJson(line), ['dpr', 'rects'], '$');
    hexBits(str(field(o, 'dpr', '$'), '$.dpr'));
    const rects = arr(field(o, 'rects', '$'), '$.rects').map((r, i): LayoutRect => decodeRect(r, `$.rects[${i}]`));
    try {
      let out = '["ok",[';
      snapEdges(rects).forEach((r, i) => {
        if (i > 0) out += ',';
        out += `[${q(r.id)},${h(r.left)},${h(r.top)},${h(r.right)},${h(r.bottom)},${h(r.width)},${h(r.height)}]`;
      });
      return `${out}]]`;
    } catch (e) {
      if (e instanceof HarnessError) throw e;
      return '["threw"]';
    }
  } catch (e) {
    if (e instanceof HarnessError) return `["harness-error",${q(e.detail)}]`;
    return '["threw"]';
  }
}

// ---------------------------------------------------------------- library suite

/** One sort item: a key with ties and the tag that shows the order ties keep. */
type SortItem = { readonly key: number; readonly tag: string };

function sortItem(v: JsonValue, path: string): SortItem {
  const pair = arr(v, path);
  const k = pair[0];
  const t = pair[1];
  if (k === undefined || t === undefined || pair.length !== 2) return fail(`${path}: expected [key, tag]`);
  return { key: hexBits(str(k, path)), tag: str(t, path) };
}

function libraryResult(op: string, a: readonly JsonValue[]): string {
  switch (op) {
    case 'round':
      return h(Math.round(arg(a, 1)));
    case 'trunc':
      return h(Math.trunc(arg(a, 1)));
    case 'floor':
      return h(Math.floor(arg(a, 1)));
    case 'ceil':
      return h(Math.ceil(arg(a, 1)));
    case 'fround':
      return h(Math.fround(arg(a, 1)));
    case 'isInteger':
      return Number.isInteger(arg(a, 1)) ? 'true' : 'false';
    case 'hex':
      return q(arg(a, 1).toString(16).toUpperCase());
    case 'sort': {
      const v = a[1];
      if (v === undefined) return fail('missing items');
      const items = arr(v, '$[1]').map((x): SortItem => sortItem(x, '$[1]'));
      let out = '';
      for (const it of [...items].sort((x, y) => x.key - y.key)) out += `${out === '' ? '' : ','}${q(it.tag)}`;
      return `[${out}]`;
    }
    case 'map': {
      const v = a[1];
      if (v === undefined) return fail('missing keys');
      const m = new Map<string, number>();
      arr(v, '$[1]').forEach((k, i) => {
        m.set(str(k, '$[1]'), i);
      });
      let out = '';
      for (const [k, i] of m) out += `${out === '' ? '' : ','}[${q(k)},${h(i)}]`;
      return `[${out}]`;
    }
    case 'codePoints': {
      const v = a[1];
      if (v === undefined) return fail('missing text');
      let out = '';
      for (const ch of str(v, '$[1]')) out += `${out === '' ? '' : ','}${h(ch.codePointAt(0) as number)}`;
      return `[${out}]`;
    }
    case 'equal': {
      const x = a[1];
      const y = a[2];
      if (x === undefined || y === undefined) return fail('missing strings');
      return str(x, '$[1]') === str(y, '$[2]') ? 'true' : 'false';
    }
    // rt suite (ANIM-a2, T047 section 3.2): the rt timing, easing, hold and interpolation reference on the rt vector inputs.
    case 'rt-timing':
      if (a.length !== 3) return fail('rt-timing: expected [op, timing, timeMs]');
      return rtTimingResult(rtTimingSpec(item(a, 1, '$'), '$[1]'), rtFinite(a, 2, '$'), 0);
    case 'rt-hold':
      if (a.length !== 4) return fail('rt-hold: expected [op, timing, timeMs, elapsedSeconds]');
      return rtTimingResult(rtTimingSpec(item(a, 1, '$'), '$[1]'), rtFinite(a, 2, '$'), rtFinite(a, 3, '$'));
    case 'rt-easing':
      if (a.length !== 3) return fail('rt-easing: expected [op, easing, timeMs]');
      return rtTimingResult(rtOneIteration(rtEasing(item(a, 1, '$'), '$[1]')), rtFinite(a, 2, '$'), 0);
    case 'rt-interp':
      return rtInterpResult(a);
    // ANIM-b (T065): held-time steps, keyframe samples, transition scripts and animation scripts.
    case 'rt-advance':
      return rtAdvanceResult(a);
    case 'rt-keyframes':
      return rtKeyframesResult(a);
    case 'rt-transitions':
      return rtTransitionsResult(a);
    case 'rt-animations':
      return rtAnimationsResult(a);
    // hit suite (SELD-R1b, T047 RT-9): the hit table, derived grid and answers of a layout vector's input.
    case 'rt-hit':
      return rtHitResult(a);
    // animator suite (ANIM-b1 3b, T065 R16): the runtime animator over a frame case's tables and script.
    case 'rt-animator':
      return rtAnimatorResult(a);
    // interaction suite (SELD-R2, T064 R12): the interaction runtime over synthetic tables and an event script.
    case 'rt-interaction':
      return rtInteractionResult(a);
    default:
      return fail(`unknown operation ${op}`);
  }
}

/** One library case: a library operation of the subset on edge inputs, so a prelude slip fails even where the engine does not reach it yet. */
export function runLibraryCase(line: string): string {
  try {
    const a = arr(parseJson(line), '$');
    const first = a[0];
    if (first === undefined) return fail('empty case');
    try {
      return `["ok",${libraryResult(str(first, '$[0]'), a)}]`;
    } catch (e) {
      if (e instanceof HarnessError) throw e;
      return '["threw"]';
    }
  } catch (e) {
    if (e instanceof HarnessError) return `["harness-error",${q(e.detail)}]`;
    return '["threw"]';
  }
}

// ---------------------------------------------------------------- rt suite (ANIM-a2)

/** The rt reference runs with no planted fault: the rt faults are proven against the Chrome oracle in TypeScript (ANIM-a). */
const RT_NO_FAULTS: RtFaults = {
  newtonIterations3: false,
  epsilon1e6: false,
  noSplineGuess: false,
  stepsIgnoreBeforeFlag: false,
  rotateViaMatrix: false,
  colorUnpremultiplied: false,
  holdTimeLost: false,
  heldTimeShortcut: false,
  noReversalShortening: false,
  perKeyframeEasingIgnored: false,
  nameChangeKeepsAnimation: false,
  pauseLosesPhase: false,
  pauseClockRuns: false,
  nonNegativeUnclamped: false,
};

/**
 * A finite rt number argument: the rt reference loops (fmod's doubling, the timing phases) assume finite inputs, so NaN or an
 * infinity is a harness error, never a computation (Macroscope 4153809247).
 */
function rtFinite(a: readonly JsonValue[], i: number, path: string): number {
  const v = arg(a, i);
  if (!Number.isFinite(v)) return fail(`${path}[${i}]: ${bitsHex(v)} is not a finite number`);
  return v;
}

/** An iteration count: finite and not negative, or +Infinity (the only infinity Web Animations allows); NaN is refused. */
function rtIterations(a: readonly JsonValue[], i: number, path: string): number {
  const v = arg(a, i);
  if (Number.isNaN(v) || v < 0) return fail(`${path}[${i}]: iterations ${bitsHex(v)} is not a non-negative number or +Infinity`);
  return v;
}

function rtStepPosition(v: JsonValue, path: string): StepPosition {
  const p = lit(v, ['jump-start', 'jump-end', 'jump-none', 'jump-both', 'start', 'end'], path);
  if (p === 'jump-start') return 'jump-start';
  if (p === 'jump-end') return 'jump-end';
  if (p === 'jump-none') return 'jump-none';
  if (p === 'jump-both') return 'jump-both';
  if (p === 'start') return 'start';
  return 'end';
}

/** An easing [kind, x1, y1, x2, y2, steps, position], every number as bits. */
function rtEasing(v: JsonValue, path: string): EasingSpec {
  const a = arr(v, path);
  if (a.length !== 7) return fail(`${path}: expected [kind, x1, y1, x2, y2, steps, position]`);
  const k = lit(item(a, 0, path), ['linear', 'cubic-bezier', 'steps'], path);
  const x1 = rtFinite(a, 1, path);
  const y1 = rtFinite(a, 2, path);
  const x2 = rtFinite(a, 3, path);
  const y2 = rtFinite(a, 4, path);
  const steps = rtFinite(a, 5, path);
  const position = rtStepPosition(item(a, 6, path), path);
  if (k === 'linear') return { kind: 'linear', x1, y1, x2, y2, steps, position };
  if (k === 'steps') return { kind: 'steps', x1, y1, x2, y2, steps, position };
  return { kind: 'cubic-bezier', x1, y1, x2, y2, steps, position };
}

function rtDirection(v: JsonValue, path: string): PlaybackDirection {
  const d = lit(v, ['normal', 'reverse', 'alternate', 'alternate-reverse'], path);
  if (d === 'normal') return 'normal';
  if (d === 'reverse') return 'reverse';
  if (d === 'alternate') return 'alternate';
  return 'alternate-reverse';
}

function rtFill(v: JsonValue, path: string): FillMode {
  const f = lit(v, ['none', 'forwards', 'backwards', 'both', 'auto'], path);
  if (f === 'none') return 'none';
  if (f === 'forwards') return 'forwards';
  if (f === 'backwards') return 'backwards';
  if (f === 'both') return 'both';
  return 'auto';
}

/** Effect timing [delayMs, endDelayMs, durationMs, iterations, iterationStart, direction, fill, easing], numbers as bits. */
function rtTimingSpec(v: JsonValue, path: string): EffectTimingSpec {
  const a = arr(v, path);
  if (a.length !== 8) return fail(`${path}: expected [delay, endDelay, duration, iterations, iterationStart, direction, fill, easing]`);
  return {
    delayMs: rtFinite(a, 0, path),
    endDelayMs: rtFinite(a, 1, path),
    durationMs: rtFinite(a, 2, path),
    iterations: rtIterations(a, 3, path),
    iterationStart: rtFinite(a, 4, path),
    direction: rtDirection(item(a, 5, path), `${path}[5]`),
    fill: rtFill(item(a, 6, path), `${path}[6]`),
    easing: easingFromSpec(rtEasing(item(a, 7, path), `${path}[7]`)),
  };
}

/** One 1000 ms iteration with fill both: the timing the easing records sample each timing function through. */
function rtOneIteration(e: EasingSpec): EffectTimingSpec {
  return { delayMs: 0, endDelayMs: 0, durationMs: 1000, iterations: 1, iterationStart: 0, direction: 'normal', fill: 'both', easing: easingFromSpec(e) };
}

function rtBits(v: number | null): string {
  return v === null ? 'null' : h(v);
}

/** An animation paused at timeMs at timeline time 0 and read elapsedSeconds later: [progress, currentIteration], bits or null. */
function rtTimingResult(spec: EffectTimingSpec, timeMs: number, elapsedSeconds: number): string {
  const t = computeTiming(spec, currentTimeAt(seekPaused(timeMs, 0, 1), elapsedSeconds, RT_NO_FAULTS), RT_NO_FAULTS);
  return `[${rtBits(t.progress)},${rtBits(t.currentIteration)}]`;
}

/** A length [kind, px, percent], numbers as bits. */
function rtLength(v: JsonValue, path: string): LengthValue {
  const a = arr(v, path);
  if (a.length !== 3) return fail(`${path}: expected [kind, px, percent]`);
  const k = lit(item(a, 0, path), ['px', 'percent', 'calc'], path);
  const px = rtFinite(a, 1, path);
  const percent = rtFinite(a, 2, path);
  if (k === 'px') return { kind: 'px', px, percent };
  if (k === 'percent') return { kind: 'percent', px, percent };
  return { kind: 'calc', px, percent };
}

function rtColor(v: JsonValue, path: string): LegacyColor {
  const a = arr(v, path);
  if (a.length !== 4) return fail(`${path}: expected [r, g, b, alpha]`);
  return { r: rtFinite(a, 0, path), g: rtFinite(a, 1, path), b: rtFinite(a, 2, path), alpha: rtFinite(a, 3, path) };
}

function rtTransformFn(v: JsonValue, path: string): TransformFn {
  const f = lit(v, ['translate', 'translateX', 'translateY', 'rotate', 'scale', 'scaleX', 'scaleY'], path);
  if (f === 'translate') return 'translate';
  if (f === 'translateX') return 'translateX';
  if (f === 'translateY') return 'translateY';
  if (f === 'rotate') return 'rotate';
  if (f === 'scale') return 'scale';
  if (f === 'scaleX') return 'scaleX';
  return 'scaleY';
}

/** A transform function [fn, x, y, angle, sx, sy]. */
function rtOp(v: JsonValue, path: string): TransformOp {
  const a = arr(v, path);
  if (a.length !== 6) return fail(`${path}: expected [fn, x, y, angle, sx, sy]`);
  return { fn: rtTransformFn(item(a, 0, path), path), x: rtLength(item(a, 1, path), `${path}[1]`), y: rtLength(item(a, 2, path), `${path}[2]`), angle: rtFinite(a, 3, path), sx: rtFinite(a, 4, path), sy: rtFinite(a, 5, path) };
}

/** An animated value [kind, number, length, color, ops]. */
function rtValue(v: JsonValue, path: string): AnimatedValue {
  const a = arr(v, path);
  if (a.length !== 5) return fail(`${path}: expected [kind, number, length, color, ops]`);
  const k = lit(item(a, 0, path), ['opacity', 'length', 'angle', 'color', 'transform'], path);
  const n = rtFinite(a, 1, path);
  const length = rtLength(item(a, 2, path), `${path}[2]`);
  const color = rtColor(item(a, 3, path), `${path}[3]`);
  const ops: TransformOp[] = [];
  arr(item(a, 4, path), `${path}[4]`).forEach((o, i) => {
    ops.push(rtOp(o, `${path}[4][${i}]`));
  });
  if (k === 'opacity') return { kind: 'opacity', number: n, length, color, ops };
  if (k === 'length') return { kind: 'length', number: n, length, color, ops };
  if (k === 'angle') return { kind: 'angle', number: n, length, color, ops };
  if (k === 'color') return { kind: 'color', number: n, length, color, ops };
  return { kind: 'transform', number: n, length, color, ops };
}

// fdlibm's __kernel_sin and __kernel_cos (k_sin.c, k_cos.c; V8 base/ieee754.cc) with a zero tail (x * y dropped), which are sin and cos for
// |x| <= pi/4. gfx::SinCosDegrees reduces every angle below 9e7 degrees to [0, 45] degrees first, so the rt suite needs no other
// argument; outside that range the harness fails the case rather than guess. The subset has no platform trigonometry (RT-4).
// fdlibm's notice: Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunSoft, a Sun Microsystems, Inc.
// business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice is preserved.
const RT_S1 = -1.66666666666666324348e-1;
const RT_S2 = 8.33333333332248946124e-3;
const RT_S3 = -1.98412698298579493134e-4;
const RT_S4 = 2.75573137070700676789e-6;
const RT_S5 = -2.50507602534068634195e-8;
const RT_S6 = 1.58969099521155010221e-10;
const RT_C1 = 4.16666666666666019037e-2;
const RT_C2 = -1.38888888888741095749e-3;
const RT_C3 = 2.48015872894767294178e-5;
const RT_C4 = -2.75573143513906633035e-7;
const RT_C5 = 2.08757232129817482790e-9;
const RT_C6 = -1.13596475577881948265e-11;

/** |x| as a comparison (the subset has no Math.abs). */
function rtMagnitude(x: number): number {
  return x < 0 ? -x : x;
}

/** fdlibm's |x| <= pi/4 test on the high word (ix <= 0x3fe921fb): every |x| below 0x3fe921fc00000000. */
function rtKernelDomain(x: number): void {
  if (!(rtMagnitude(x) < hexBits('3fe921fc00000000'))) fail(`rt trig argument ${bitsHex(x)} is outside [-pi/4, pi/4]`);
}

function rtSin(x: number): number {
  rtKernelDomain(x);
  if (rtMagnitude(x) < hexBits('3e40000000000000')) return x;
  const z = x * x;
  const v = z * x;
  const r = RT_S2 + z * (RT_S3 + z * (RT_S4 + z * (RT_S5 + z * RT_S6)));
  return x + v * (RT_S1 + z * r);
}

function rtCos(x: number): number {
  rtKernelDomain(x);
  const ax = rtMagnitude(x);
  if (ax < hexBits('3e40000000000000')) return 1.0;
  const z = x * x;
  const r = z * (RT_C1 + z * (RT_C2 + z * (RT_C3 + z * (RT_C4 + z * (RT_C5 + z * RT_C6)))));
  if (ax < hexBits('3fd3333300000000')) return 1.0 - (0.5 * z - z * r);
  // qx: 0.28125 above 0.78125, else |x| / 4 with its low word cleared (INSERT_WORDS(qx, ix - 0x00200000, 0)). Here |x| / 4 lies
  // in [2^-4, 2^-2), so clearing the low word keeps the multiples of 2^-24 or 2^-23 below it; each step is exact.
  const quarter = ax / 4;
  const unit = quarter < 0.125 ? 5.9604644775390625e-8 : 1.1920928955078125e-7;
  const qx = ax >= hexBits('3fe9000100000000') ? 0.28125 : Math.floor(quarter / unit) * unit;
  const hz = 0.5 * z - qx;
  const a = 1.0 - qx;
  return a - (hz - z * r);
}

const RT_TRIG: Trig = { sin: rtSin, cos: rtCos };

/** An interpolation read: [op, from, to, effectEasing, keyframeEasing, timeMs, boxWidth, boxHeight] -> [progress, value]. */
function rtInterpResult(a: readonly JsonValue[]): string {
  if (a.length !== 8) return fail('rt-interp: expected [op, from, to, effectEasing, keyframeEasing, timeMs, boxWidth, boxHeight]');
  const from = rtValue(item(a, 1, '$'), '$[1]');
  const to = rtValue(item(a, 2, '$'), '$[2]');
  const effect = rtEasing(item(a, 3, '$'), '$[3]');
  const keyframe = rtEasing(item(a, 4, '$'), '$[4]');
  if (keyframe.kind === 'steps') return fail('rt-interp: a steps keyframe easing is outside the rt vectors (linear or cubic-bezier only)');
  const t = computeTiming(rtOneIteration(effect), currentTimeAt(seekPaused(rtFinite(a, 5, '$'), 0, 1), 0, RT_NO_FAULTS), RT_NO_FAULTS);
  const p = t.progress === null ? 0 : t.progress;
  const local = keyframe.kind === 'cubic-bezier' ? solveBezier(cubicBezier(keyframe.x1, keyframe.y1, keyframe.x2, keyframe.y2), p, RT_NO_FAULTS) : p;
  const v = interpolateValue(from, to, local, RT_NO_FAULTS);
  return `[${rtBits(t.progress)},${q(v.refused ? 'refused' : serializeValue(v.value, rtFinite(a, 6, '$'), rtFinite(a, 7, '$'), RT_TRIG))}]`;
}

// ---------------------------------------------------------------- rt suite, ANIM-b (T065)

function rtRange(v: JsonValue, path: string): ValueRange {
  return lit(v, ['all', 'non-negative'], path) === 'all' ? 'all' : 'non-negative';
}

/** A seconds timing [delay, duration, iterations, direction, fill, easing], numbers as bits. */
function rtSeconds(v: JsonValue, path: string): SecondsTiming {
  const a = arr(v, path);
  if (a.length !== 6) return fail(`${path}: expected [delay, duration, iterations, direction, fill, easing]`);
  return { delay: rtFinite(a, 0, path), duration: rtFinite(a, 1, path), iterations: rtIterations(a, 2, path), direction: rtDirection(item(a, 3, path), `${path}[3]`), fill: rtFill(item(a, 4, path), `${path}[4]`), easing: easingFromSpec(rtEasing(item(a, 5, path), `${path}[5]`)) };
}

/** The value a block that does not set the property carries; groupFromRule never reads it. */
const RT_UNSET: AnimatedValue = { kind: 'opacity', number: 0, length: { kind: 'px', px: 0, percent: 0 }, color: { r: 0, g: 0, b: 0, alpha: 0 }, ops: [] };

/** An @keyframes rule's blocks [[offset, easing or null, value or null], ...]. */
function rtRule(v: JsonValue, path: string): RuleKeyframe[] {
  const out: RuleKeyframe[] = [];
  arr(v, path).forEach((b, i) => {
    const p = `${path}[${i}]`;
    const k = arr(b, p);
    if (k.length !== 3) fail(`${p}: expected [offset, easing, value]`);
    const e = item(k, 1, p);
    const value = item(k, 2, p);
    out.push({ offset: rtFinite(k, 0, p), hasEasing: e.kind !== 'null', easing: e.kind === 'null' ? LINEAR : easingFromSpec(rtEasing(e, `${p}[1]`)), sets: value.kind !== 'null', value: value.kind === 'null' ? RT_UNSET : rtValue(value, `${p}[2]`) });
  });
  return out;
}

/** Script steps [['s', state] or ['a', deltaMs], ...]. */
function rtSteps(v: JsonValue, path: string): ScriptStep[] {
  const out: ScriptStep[] = [];
  arr(v, path).forEach((s, i) => {
    const p = `${path}[${i}]`;
    const k = arr(s, p);
    if (k.length !== 2) fail(`${p}: expected [kind, number]`);
    const n = rtFinite(k, 1, p);
    if (lit(item(k, 0, p), ['s', 'a'], p) === 's') out.push({ kind: 'state', state: n, deltaMs: 0 });
    else out.push({ kind: 'advance', state: 0, deltaMs: n });
  });
  return out;
}

function rtShow(v: AnimatedValue, a: readonly JsonValue[], at: number): string {
  return serializeValue(v, rtFinite(a, at, '$'), rtFinite(a, at + 1, '$'), RT_TRIG);
}

/** Held-time steps: [op, [deltaMs, ...]] -> the current time in ms after each step. */
function rtAdvanceResult(a: readonly JsonValue[]): string {
  if (a.length !== 2) return fail('rt-advance: expected [op, deltas]');
  const deltas = arr(item(a, 1, '$'), '$[1]');
  let held = HELD_ZERO;
  let out = '';
  for (let i = 0; i < deltas.length; i++) {
    held = advanceHeld(held, rtFinite(deltas, i, '$[1]'), RT_NO_FAULTS);
    out += `${i > 0 ? ',' : ''}${h(held.seconds * 1000)}`;
  }
  return `[${out}]`;
}

/** A keyframe sample: [op, range, underlying, rule, timing, timeMs, boxWidth, boxHeight] -> [progress, value]. */
function rtKeyframesResult(a: readonly JsonValue[]): string {
  if (a.length !== 8) return fail('rt-keyframes: expected [op, range, underlying, rule, timing, timeMs, boxWidth, boxHeight]');
  const range = rtRange(item(a, 1, '$'), '$[1]');
  const underlying = rtValue(item(a, 2, '$'), '$[2]');
  const rule = rtRule(item(a, 3, '$'), '$[3]');
  const timing = rtSeconds(item(a, 4, '$'), '$[4]');
  const seconds = rtFinite(a, 5, '$') / 1000;
  const t = computeSecondsTiming({ delay: timing.delay, duration: timing.duration, iterations: timing.iterations, direction: timing.direction, fill: timing.fill, easing: LINEAR }, seconds, RT_NO_FAULTS);
  const v = sampleKeyframeEffect(timing, seconds, groupFromRule(rule, timing.easing), underlying, range, RT_NO_FAULTS);
  const value = v === null ? rtShow(underlying, a, 6) : v.refused ? 'refused' : rtShow(v.value, a, 6);
  return `[${rtBits(t.progress)},${q(value)}]`;
}

/** A transition script: [op, range, states [[value, [mode, delay, duration, easing]], ...], steps, boxWidth, boxHeight]. */
function rtTransitionsResult(a: readonly JsonValue[]): string {
  if (a.length !== 6) return fail('rt-transitions: expected [op, range, states, steps, boxWidth, boxHeight]');
  const states: TransitionState[] = [];
  arr(item(a, 2, '$'), '$[2]').forEach((s, i) => {
    const p = `$[2][${i}]`;
    const k = arr(s, p);
    if (k.length !== 2) fail(`${p}: expected [value, listing]`);
    const l = arr(item(k, 1, p), `${p}[1]`);
    if (l.length !== 4) fail(`${p}[1]: expected [mode, delay, duration, easing]`);
    const delay = rtFinite(l, 1, p);
    const duration = rtFinite(l, 2, p);
    const easing = easingFromSpec(rtEasing(item(l, 3, p), `${p}[1][3]`));
    const mode = lit(item(l, 0, p), ['listed', 'unlisted', 'initial'], p);
    let listing: TransitionListing = { mode: 'initial', delay, duration, easing };
    if (mode === 'listed') listing = { mode: 'listed', delay, duration, easing };
    else if (mode === 'unlisted') listing = { mode: 'unlisted', delay, duration, easing };
    states.push({ value: rtValue(item(k, 0, p), `${p}[0]`), listing });
  });
  let out = '';
  runTransitionScript(states, rtRange(item(a, 1, '$'), '$[1]'), rtSteps(item(a, 3, '$'), '$[3]'), RT_NO_FAULTS).forEach((r, i) => {
    out += `${i > 0 ? ',' : ''}[${q(rtShow(r.value, a, 4))},${r.durationMs === null ? 'null' : h(r.durationMs)}]`;
  });
  return `[${out}]`;
}

/** An animation script: [op, range, rules [[name, rule], ...], states [[base, [[name, hasKeyframes, paused, timing], ...]], ...], steps, boxWidth, boxHeight]. */
function rtAnimationsResult(a: readonly JsonValue[]): string {
  if (a.length !== 7) return fail('rt-animations: expected [op, range, rules, states, steps, boxWidth, boxHeight]');
  const rules: KeyframesRule[] = [];
  arr(item(a, 2, '$'), '$[2]').forEach((r, i) => {
    const p = `$[2][${i}]`;
    const k = arr(r, p);
    if (k.length !== 2) fail(`${p}: expected [name, rule]`);
    rules.push({ name: str(item(k, 0, p), p), keyframes: rtRule(item(k, 1, p), `${p}[1]`) });
  });
  const states: AnimationState[] = [];
  arr(item(a, 3, '$'), '$[3]').forEach((s, i) => {
    const p = `$[3][${i}]`;
    const k = arr(s, p);
    if (k.length !== 2) fail(`${p}: expected [base, entries]`);
    const entries: AnimationEntry[] = [];
    arr(item(k, 1, p), `${p}[1]`).forEach((e, j) => {
      const q2 = `${p}[1][${j}]`;
      const x = arr(e, q2);
      if (x.length !== 4) fail(`${q2}: expected [name, hasKeyframes, paused, timing]`);
      entries.push({ name: str(item(x, 0, q2), q2), hasKeyframes: bool(item(x, 1, q2), q2), paused: bool(item(x, 2, q2), q2), timing: rtSeconds(item(x, 3, q2), `${q2}[3]`) });
    });
    states.push({ base: rtValue(item(k, 0, p), `${p}[0]`), entries });
  });
  let out = '';
  runAnimationScript(states, rules, rtRange(item(a, 1, '$'), '$[1]'), rtSteps(item(a, 4, '$'), '$[4]'), RT_NO_FAULTS).forEach((r, i) => {
    let names = '';
    let times = '';
    let plays = '';
    r.names.forEach((n, j) => {
      names += `${j > 0 ? ',' : ''}${q(n)}`;
    });
    r.currentTimesMs.forEach((t, j) => {
      times += `${j > 0 ? ',' : ''}${h(t)}`;
    });
    r.playStates.forEach((ps, j) => {
      plays += `${j > 0 ? ',' : ''}${q(ps)}`;
    });
    out += `${i > 0 ? ',' : ''}[[${names}],[${times}],[${plays}],${q(rtShow(r.value, a, 5))}]`;
  });
  return `[${out}]`;
}

// ---------------------------------------------------------------- hit suite (SELD-R1b, T047 RT-9)

const HIT_TABLE_CLEAN: HitTableFaults = { pointerEventsNotInherited: false };
const HIT_CLEAN: HitFaults = { ignorePointerEventsNone: false, reversedOrder: false };

/** A hit read: [op, platform, input, facts] -> the run-length encoded answers at every point of the input's derived grid. */
function rtHitResult(a: readonly JsonValue[]): string {
  if (a.length !== 4) return fail('rt-hit: expected [op, platform, input, facts]');
  const platform = str(item(a, 1, '$'), '$[1]');
  const input = decodeInput(item(a, 2, '$'));
  const facts = new Map<string, HitFact>();
  arr(item(a, 3, '$'), '$[3]').forEach((f, i) => {
    const path = `$[3][${i.toString(16)}]`;
    const g = arr(f, path);
    if (g.length !== 4) return fail(`${path}: expected [id, pointerEvents, inherited, activation]`);
    const pe = str(item(g, 1, path), path);
    if (pe !== 'auto' && pe !== 'none') return fail(`${path}: pointer-events ${pe} is not auto or none`);
    facts.set(str(item(g, 0, path), path), { pointerEvents: pe, inherited: bool(item(g, 2, path), path), activation: bool(item(g, 3, path), path) });
  });
  const m = measurerFor(platform);
  if (m.kind !== 'ok') return fail(`rt-hit: no measurer for ${platform}`);
  const t = hitTableOf(input, m.measurer, facts, HIT_TABLE_CLEAN);
  const zoom = input.devicePixelRatio * 64;
  return q(hitRuns(t, hitGrid(t, input.viewport.width * zoom, input.viewport.height * zoom), HIT_CLEAN));
}

// ---------------------------------------------------------------- animator suite (ANIM-b1 3b, T065 R16)

/** The animator runs with no planted fault: the runtime plants are proven against Chrome in packages/parity anim-frames. */
const AN_NO_FAULTS: AnimatorFaults = { transitionOnFirstStyle: false, displayNoneKeepsTransition: false, inheritedNotPropagated: false, neutralKeyframeStale: false };

function anEasingKind(v: JsonValue, path: string): EasingKind {
  const k = lit(v, ['linear', 'cubic-bezier', 'steps'], path);
  if (k === 'cubic-bezier') return 'cubic-bezier';
  if (k === 'steps') return 'steps';
  return 'linear';
}

function anEasing(v: JsonValue, path: string): EasingCode {
  const o = obj(v, ['kind', 'x1', 'y1', 'x2', 'y2', 'steps', 'position'], path);
  return { kind: anEasingKind(field(o, 'kind', path), `${path}.kind`), x1: numField(o, 'x1', path), y1: numField(o, 'y1', path), x2: numField(o, 'x2', path), y2: numField(o, 'y2', path), steps: numField(o, 'steps', path), position: rtStepPosition(field(o, 'position', path), `${path}.position`) };
}

function anValueKind(v: JsonValue, path: string): ValueKind {
  const k = lit(v, ['color', 'length', 'none'], path);
  if (k === 'color') return 'color';
  if (k === 'length') return 'length';
  return 'none';
}

function anValue(v: JsonValue, path: string): ValueCode {
  const o = obj(v, ['kind', 'r', 'g', 'b', 'alpha', 'px', 'percent', 'calc'], path);
  return { kind: anValueKind(field(o, 'kind', path), `${path}.kind`), r: numField(o, 'r', path), g: numField(o, 'g', path), b: numField(o, 'b', path), alpha: numField(o, 'alpha', path), px: numField(o, 'px', path), percent: numField(o, 'percent', path), calc: bool(field(o, 'calc', path), `${path}.calc`) };
}

function anMode(v: JsonValue, path: string): ListingMode {
  const k = lit(v, ['listed', 'unlisted', 'initial'], path);
  if (k === 'listed') return 'listed';
  if (k === 'unlisted') return 'unlisted';
  return 'initial';
}

function anTrackKind(v: JsonValue, path: string): TrackKind {
  return lit(v, ['length', 'color'], path) === 'length' ? 'length' : 'color';
}

function anRange(v: JsonValue, path: string): ValueRange {
  return lit(v, ['all', 'non-negative'], path) === 'all' ? 'all' : 'non-negative';
}

function anListing(v: JsonValue, path: string): ListingCode {
  const o = obj(v, ['present', 'mode', 'delay', 'duration', 'easing'], path);
  return { present: bool(field(o, 'present', path), `${path}.present`), mode: anMode(field(o, 'mode', path), `${path}.mode`), delay: numField(o, 'delay', path), duration: numField(o, 'duration', path), easing: anEasing(field(o, 'easing', path), `${path}.easing`) };
}

function anSlot(v: JsonValue, path: string): SlotTable {
  const o = obj(v, ['node', 'property', 'kind', 'range', 'values', 'listings'], path);
  return {
    node: str(field(o, 'node', path), `${path}.node`),
    property: str(field(o, 'property', path), `${path}.property`),
    kind: anTrackKind(field(o, 'kind', path), `${path}.kind`),
    range: anRange(field(o, 'range', path), `${path}.range`),
    values: arr(field(o, 'values', path), `${path}.values`).map((x, i): ValueCode => anValue(x, `${path}.values[${i}]`)),
    listings: arr(field(o, 'listings', path), `${path}.listings`).map((x, i): ListingCode => anListing(x, `${path}.listings[${i}]`)),
  };
}

function anEntry(v: JsonValue, path: string): EntryCode {
  const o = obj(v, ['name', 'hasKeyframes', 'paused', 'delay', 'duration', 'iterations', 'direction', 'fill', 'easing'], path);
  const iterations = field(o, 'iterations', path);
  return {
    name: str(field(o, 'name', path), `${path}.name`),
    hasKeyframes: bool(field(o, 'hasKeyframes', path), `${path}.hasKeyframes`),
    paused: bool(field(o, 'paused', path), `${path}.paused`),
    delay: numField(o, 'delay', path),
    duration: numField(o, 'duration', path),
    // JSON has no infinity: an infinite iteration count is the string "infinite".
    iterations: iterations.kind === 'str' ? (lit(iterations, ['infinite'], `${path}.iterations`) === 'infinite' ? 1 / 0 : 0) : num(iterations, `${path}.iterations`),
    direction: rtDirection(field(o, 'direction', path), `${path}.direction`),
    fill: rtFill(field(o, 'fill', path), `${path}.fill`),
    easing: anEasing(field(o, 'easing', path), `${path}.easing`),
  };
}

function anAnimation(v: JsonValue, path: string): AnimationTable {
  const o = obj(v, ['node', 'lists'], path);
  return { node: str(field(o, 'node', path), `${path}.node`), lists: arr(field(o, 'lists', path), `${path}.lists`).map((l, i): EntryCode[] => arr(l, `${path}.lists[${i}]`).map((e, j): EntryCode => anEntry(e, `${path}.lists[${i}][${j}]`))) };
}

function anKeyframeValue(v: JsonValue, path: string): KeyframeValue {
  const o = obj(v, ['property', 'value'], path);
  return { property: str(field(o, 'property', path), `${path}.property`), value: anValue(field(o, 'value', path), `${path}.value`) };
}

function anBlock(v: JsonValue, path: string): KeyframeBlock {
  const o = obj(v, ['offsets', 'hasEasing', 'easing', 'values'], path);
  return {
    offsets: arr(field(o, 'offsets', path), `${path}.offsets`).map((x, i): number => num(x, `${path}.offsets[${i}]`)),
    hasEasing: bool(field(o, 'hasEasing', path), `${path}.hasEasing`),
    easing: anEasing(field(o, 'easing', path), `${path}.easing`),
    values: arr(field(o, 'values', path), `${path}.values`).map((x, i): KeyframeValue => anKeyframeValue(x, `${path}.values[${i}]`)),
  };
}

function anKeyframes(v: JsonValue, path: string): KeyframesTable {
  const o = obj(v, ['name', 'blocks'], path);
  return { name: str(field(o, 'name', path), `${path}.name`), blocks: arr(field(o, 'blocks', path), `${path}.blocks`).map((x, i): KeyframeBlock => anBlock(x, `${path}.blocks[${i}]`)) };
}

function anRendered(v: JsonValue, path: string): RenderedTable {
  const o = obj(v, ['node', 'values'], path);
  return { node: str(field(o, 'node', path), `${path}.node`), values: arr(field(o, 'values', path), `${path}.values`).map((x, i): boolean => bool(x, `${path}.values[${i}]`)) };
}

function anBase(v: JsonValue, path: string): BaseTable {
  const o = obj(v, ['node', 'property', 'kind', 'range', 'values'], path);
  return {
    node: str(field(o, 'node', path), `${path}.node`),
    property: str(field(o, 'property', path), `${path}.property`),
    kind: anTrackKind(field(o, 'kind', path), `${path}.kind`),
    range: anRange(field(o, 'range', path), `${path}.range`),
    values: arr(field(o, 'values', path), `${path}.values`).map((x, i): ValueCode => anValue(x, `${path}.values[${i}]`)),
  };
}

function anRef(v: JsonValue, path: string): TrackRef {
  const o = obj(v, ['node', 'property'], path);
  return { node: str(field(o, 'node', path), `${path}.node`), property: str(field(o, 'property', path), `${path}.property`) };
}

function anClosure(v: JsonValue, path: string): ClosureTable {
  const o = obj(v, ['source', 'writes'], path);
  return { source: anRef(field(o, 'source', path), `${path}.source`), writes: arr(field(o, 'writes', path), `${path}.writes`).map((x, i): TrackRef => anRef(x, `${path}.writes[${i}]`)) };
}

function anTables(v: JsonValue, path: string): AnimTables {
  const o = obj(v, ['assignments', 'slots', 'animations', 'keyframes', 'rendered', 'bases', 'closure'], path);
  return {
    assignments: numField(o, 'assignments', path),
    slots: arr(field(o, 'slots', path), `${path}.slots`).map((x, i): SlotTable => anSlot(x, `${path}.slots[${i}]`)),
    animations: arr(field(o, 'animations', path), `${path}.animations`).map((x, i): AnimationTable => anAnimation(x, `${path}.animations[${i}]`)),
    keyframes: arr(field(o, 'keyframes', path), `${path}.keyframes`).map((x, i): KeyframesTable => anKeyframes(x, `${path}.keyframes[${i}]`)),
    rendered: arr(field(o, 'rendered', path), `${path}.rendered`).map((x, i): RenderedTable => anRendered(x, `${path}.rendered[${i}]`)),
    bases: arr(field(o, 'bases', path), `${path}.bases`).map((x, i): BaseTable => anBase(x, `${path}.bases[${i}]`)),
    closure: arr(field(o, 'closure', path), `${path}.closure`).map((x, i): ClosureTable => anClosure(x, `${path}.closure[${i}]`)),
  };
}

/**
 * An animator script: [op, tables, inputs, initial, steps]; inputs are every assignment's engine input resolved at DPR 1, steps
 * ["event", assignment], ["advance", ms] or ["dump"]. Each dump gives the frame (node, property and the serialised value) and the
 * colour writes with their closure as the device draws them.
 */
function rtAnimatorResult(a: readonly JsonValue[]): string {
  if (a.length !== 5) return fail('rt-animator: expected [op, tables, inputs, initial, steps]');
  const t = anTables(item(a, 1, '$'), '$[1]');
  const inputs = arr(item(a, 2, '$'), '$[2]').map((x): LayoutInput => decodeInput(x));
  const initial = num(item(a, 3, '$'), '$[3]');
  let s: AnimatorState = animatorStart(t, inputs, initial, RT_NO_FAULTS, AN_NO_FAULTS);
  let out = '';
  arr(item(a, 4, '$'), '$[4]').forEach((step, i) => {
    const path = `$[4][${i.toString(16)}]`;
    const g = arr(step, path);
    const op = str(item(g, 0, path), path);
    if (op === 'event') s = animatorEvent(s, t, inputs, initial, num(item(g, 1, path), path), RT_NO_FAULTS, AN_NO_FAULTS);
    else if (op === 'advance') s = animatorAdvance(s, t, inputs, initial, num(item(g, 1, path), path), RT_NO_FAULTS, AN_NO_FAULTS);
    else if (op === 'dump') {
      const frame = animatorFrame(s, t, RT_NO_FAULTS);
      let values = '';
      for (const e of frame) values += `${values === '' ? '' : ','}[${q(e.node)},${q(e.property)},${q(serializeValue(e.value, 0, 0, RT_TRIG))}]`;
      let colors = '';
      for (const c of frameColors(frame, t, AN_NO_FAULTS)) colors += `${colors === '' ? '' : ','}[${q(c.node)},${q(c.property)},${h(c.rgba.r)},${h(c.rgba.g)},${h(c.rgba.b)},${h(c.rgba.alpha)}]`;
      out += `${out === '' ? '' : ','}[[${values}],[${colors}]]`;
    } else fail(`${path}: unknown step ${op}`);
  });
  return `[${out}]`;
}

// ---------------------------------------------------------------- interaction suite (SELD-R2, T064 R12)

/** The interaction runtime runs with no planted fault: the plants are proven by the host trace check and the device traces. */
const IA_NO_FAULTS: InteractionFaults = {
  tapSetsHover: false,
  hoverWithoutAncestors: false,
  forcedSetsAncestors: false,
  focusOnNonFocusable: false,
  focusVisibleOnPointer: false,
  activeWithoutAncestors: false,
  activeStaysAfterRelease: false,
  focusAtTouchPress: false,
  rangeTapFocuses: false,
  hoverNotRecomputedAfterLayout: false,
  hoverExitOnPress: false,
};

function iaInt(v: JsonValue, path: string): number {
  const n = num(v, path);
  if (!Number.isInteger(n)) return fail(`${path}: ${bitsHex(n)} is not an integer`);
  return n;
}

function iaInts(o: JsonObj, k: string, path: string): number[] {
  return arr(field(o, k, path), `${path}.${k}`).map((x, i): number => iaInt(x, `${path}.${k}[${i}]`));
}

function iaBools(o: JsonObj, k: string, path: string): boolean[] {
  return arr(field(o, k, path), `${path}.${k}`).map((x, i): boolean => bool(x, `${path}.${k}[${i}]`));
}

function iaTables(v: JsonValue, path: string): InteractionTables {
  const o = obj(v, ['parent', 'focusable', 'touchConsumesTap', 'keyboardInput', 'chainOf', 'activeChainOf', 'pointerFocusOf', 'keyboardFocusOf', 'forcedHoverOf', 'forcedActiveOf', 'forcedFocusOf', 'forcedFocusVisibleOf', 'hoverValues', 'activeValues', 'focusValues', 'combos'], path);
  return {
    parent: iaInts(o, 'parent', path),
    focusable: iaBools(o, 'focusable', path),
    touchConsumesTap: iaBools(o, 'touchConsumesTap', path),
    keyboardInput: iaBools(o, 'keyboardInput', path),
    chainOf: iaInts(o, 'chainOf', path),
    activeChainOf: iaInts(o, 'activeChainOf', path),
    pointerFocusOf: iaInts(o, 'pointerFocusOf', path),
    keyboardFocusOf: iaInts(o, 'keyboardFocusOf', path),
    forcedHoverOf: iaInts(o, 'forcedHoverOf', path),
    forcedActiveOf: iaInts(o, 'forcedActiveOf', path),
    forcedFocusOf: iaInts(o, 'forcedFocusOf', path),
    forcedFocusVisibleOf: iaInts(o, 'forcedFocusVisibleOf', path),
    hoverValues: iaInt(field(o, 'hoverValues', path), `${path}.hoverValues`),
    activeValues: iaInt(field(o, 'activeValues', path), `${path}.activeValues`),
    focusValues: iaInt(field(o, 'focusValues', path), `${path}.focusValues`),
    combos: iaInts(o, 'combos', path),
  };
}

function iaForced(v: JsonValue, path: string): ForcedKind {
  const k = lit(v, ['none', 'hover', 'active', 'focus', 'focus-visible'], path);
  if (k === 'hover') return 'hover';
  if (k === 'active') return 'active';
  if (k === 'focus') return 'focus';
  if (k === 'focus-visible') return 'focus-visible';
  return 'none';
}

function iaElements(xs: readonly number[]): string {
  let out = '';
  for (const x of xs) out += `${out === '' ? '' : ','}${h(x)}`;
  return `[${out}]`;
}

/** One step of an interaction script: [kind, ...arguments]; each kind takes exactly its own arguments. */
function iaStep(t: InteractionTables, s: InteractionPointer, g: readonly JsonValue[], path: string): InteractionPointer {
  const op = str(item(g, 0, path), path);
  const want = op === 'move' || op === 'mouse-down' || op === 'touch-down' || op === 'touch-up' || op === 'key' || op === 'key-focus' || op === 'remap' || op === 'layout' ? 2 : op === 'force' ? 3 : 1;
  if (g.length !== want) return fail(`${path}: step ${op} expects ${want} items, got ${g.length}`);
  if (op === 'move') return pointerMoved(t, s, iaInt(item(g, 1, path), path));
  if (op === 'exit') return pointerExited(t, s);
  if (op === 'exit-start') return hoverExitStarted(t, s);
  if (op === 'frame') return interactionFrame(t, s);
  if (op === 'mouse-down') return mousePressed(t, s, iaInt(item(g, 1, path), path), IA_NO_FAULTS);
  if (op === 'mouse-up') return mouseReleased(t, s, IA_NO_FAULTS);
  if (op === 'touch-down') return touchPressed(t, s, iaInt(item(g, 1, path), path), IA_NO_FAULTS);
  if (op === 'touch-up') return touchReleased(t, s, iaInt(item(g, 1, path), path), IA_NO_FAULTS);
  if (op === 'touch-cancel') return touchCancelled(t, s, IA_NO_FAULTS);
  if (op === 'key') return keyPressed(t, s, bool(item(g, 1, path), path));
  if (op === 'key-focus') return keyboardFocused(t, s, iaInt(item(g, 1, path), path));
  if (op === 'remap') return remapPointer(t, s, arr(item(g, 1, path), path).map((x, i): number => iaInt(x, `${path}[1][${i}]`)));
  if (op === 'layout') return layoutChanged(t, s, iaInt(item(g, 1, path), path), IA_NO_FAULTS);
  if (op === 'force') return forcePseudo(t, s, iaForced(item(g, 1, path), path), iaInt(item(g, 2, path), path));
  return fail(`${path}: unknown step ${op}`);
}

/**
 * An interaction script: [op, tables, states, steps]. After each step the record is [hover matches, active matches, focus match,
 * focus-visible match, combination, state], every element index and number as bits.
 */
function rtInteractionResult(a: readonly JsonValue[]): string {
  if (a.length !== 4) return fail('rt-interaction: expected [op, tables, states, steps]');
  const t = iaTables(item(a, 1, '$'), '$[1]');
  checkInteractionTables(t, iaInt(item(a, 2, '$'), '$[2]'));
  let s: InteractionPointer = interactionStart();
  let out = '';
  arr(item(a, 3, '$'), '$[3]').forEach((step, i) => {
    const path = `$[3][${i.toString(16)}]`;
    s = iaStep(t, s, arr(step, path), path);
    out += `${out === '' ? '' : ','}[${iaElements(hoverMatches(t, s, IA_NO_FAULTS))},${iaElements(activeMatches(t, s, IA_NO_FAULTS))},${h(focusMatch(s))},${h(focusVisibleMatch(s))},${h(interactionCombo(t, s))},${h(interactionState(t, s))}]`;
  });
  return `[${out}]`;
}
