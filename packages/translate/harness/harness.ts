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
  ControlBox,
  ControlKind,
  Direction,
  Display,
  FlexBasisValue,
  FlexDirection,
  FlexWrap,
  FontSpec,
  GapValue,
  InsetValue,
  JustifyContent,
  LayoutBox,
  LayoutInput,
  LayoutStyle,
  LengthCalc,
  LineHeightCalc,
  LineHeightValue,
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
  ViewportLength,
  ViewportSize,
  Viewport,
} from '../../layout/src/input.ts';
import type { LayoutRect } from '../../layout/src/layout.ts';
import { absoluteRects, layoutWithFaults } from '../../layout/src/layout.ts';
import { measurerFor } from '../../layout/src/platform.ts';
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
  growShare,
  lineHeightFromNumber,
  percentOf,
  pixelsAndPercentAt,
  platformFontSize,
  roundFontMetricToWholePx,
  shrinkShare,
  snapBorderWidth,
  snapEdge,
  textAdvance,
  viewportLeafPx,
  viewportUnitBase,
  zoomCssPx,
  zoomFontSize,
  zoomViewportPx,
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
import { bitsHex, fromCodePoints, hexBits, parseNumber } from './host.ts';

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
  lit(field(o, 'family', path), ['Ahem'], `${path}.family`);
  return { family: 'Ahem', size: numField(o, 'size', path), specifiedSize: calcExpr(field(o, 'specifiedSize', path), `${path}.specifiedSize`), absoluteSize: bool(field(o, 'absoluteSize', path), `${path}.absoluteSize`) };
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
  'alignContent', 'rowGap', 'columnGap', 'textAlign', 'aspectRatio',
];

const ALIGN_ITEMS: readonly string[] = ['normal', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end'];

function decodeStyle(v: JsonValue, path: string): LayoutStyle {
  const o = obj(v, STYLE_KEYS, path);
  const f = (k: string): JsonValue => field(o, k, path);
  const p = (k: string): string => `${path}.${k}`;
  return {
    display: lit(f('display'), ['block', 'flex'], p('display')) as Display,
    position: lit(f('position'), ['static', 'relative', 'absolute'], p('position')) as Position,
    top: sizeValue(f('top'), p('top')) as InsetValue,
    right: sizeValue(f('right'), p('right')) as InsetValue,
    bottom: sizeValue(f('bottom'), p('bottom')) as InsetValue,
    left: sizeValue(f('left'), p('left')) as InsetValue,
    overflowX: lit(f('overflowX'), ['visible', 'hidden'], p('overflowX')) as Overflow,
    overflowY: lit(f('overflowY'), ['visible', 'hidden'], p('overflowY')) as Overflow,
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

function decodeChildren(o: JsonObj, path: string): (LayoutBox | ControlBox | TextLeaf | ReplacedLeaf)[] {
  const children: (LayoutBox | ControlBox | TextLeaf | ReplacedLeaf)[] = [];
  arr(field(o, 'children', path), `${path}.children`).forEach((c, i) => {
    children.push(decodeNode(c, `${path}.children[${i}]`));
  });
  return children;
}

function controlKind(v: JsonValue, path: string): ControlKind {
  const k = kindOf(v, path);
  if (k === 'range') return { kind: 'range', defaultInlineSize: numField(obj(v, ['kind', 'defaultInlineSize'], path), 'defaultInlineSize', path) };
  if (k === 'slider-thumb') return { kind: 'slider-thumb', ratio: numField(obj(v, ['kind', 'ratio'], path), 'ratio', path) };
  if (k === 'button-block') {
    obj(v, ['kind'], path);
    return { kind: 'button-block' };
  }
  return fail(`${path}: unknown kind ${k}`);
}

function decodeControl(o: JsonObj, path: string): ControlBox {
  obj(o, ['kind', 'id', 'boxType', 'style', 'control', 'children'], path);
  const children = decodeChildren(o, path);
  return {
    kind: 'control',
    id: str(field(o, 'id', path), `${path}.id`),
    boxType: lit(field(o, 'boxType', path), ['element', 'anonymous'], `${path}.boxType`) as BoxType,
    style: decodeStyle(field(o, 'style', path), `${path}.style`),
    control: controlKind(field(o, 'control', path), `${path}.control`),
    children,
  };
}

function decodeBox(o: JsonObj, path: string): LayoutBox {
  obj(o, ['kind', 'id', 'boxType', 'style', 'children'], path);
  const children = decodeChildren(o, path);
  return {
    kind: 'box',
    id: str(field(o, 'id', path), `${path}.id`),
    boxType: lit(field(o, 'boxType', path), ['element', 'anonymous'], `${path}.boxType`) as BoxType,
    style: decodeStyle(field(o, 'style', path), `${path}.style`),
    children,
  };
}

function decodeNode(v: JsonValue, path: string): LayoutBox | ControlBox | TextLeaf | ReplacedLeaf {
  if (v.kind !== 'obj') return fail(`${path}: expected a node`);
  const k = kindOf(v, path);
  if (k === 'box') return decodeBox(v, path);
  if (k === 'control') return decodeControl(v, path);
  if (k === 'text') return decodeText(v, path);
  if (k === 'replaced') return decodeReplaced(v, path);
  return fail(`${path}: unknown node kind ${k}`);
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
  'spaceOnlyBreaks', 'fitWithoutEpsilon', 'breakAfterSolidus', 'noHyphenDigitBreak',
  'orderHalfEven', 'orderUnclamped',
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
    orderHalfEven: b('orderHalfEven'),
    orderUnclamped: b('orderUnclamped'),
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

/** One engine case: {"platform", "faults", "input"} in, the layout result with every LU as bits out. */
export function runEngineCase(line: string): string {
  try {
    const o = obj(parseJson(line), ['platform', 'faults', 'input'], '$');
    const platform = str(field(o, 'platform', '$'), '$.platform');
    const faults = decodeFaults(field(o, 'faults', '$'));
    const input = decodeInput(field(o, 'input', '$'));
    const m = measurerFor(platform);
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
    return `${out}]]`;
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
