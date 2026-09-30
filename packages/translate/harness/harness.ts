// The differential test harness, written in the translator subset and translated with the engine. Each case is one JSON line;
// each result is one line with every double as its IEEE bit pattern, so TypeScript and native runs compare byte for byte.
import type { EngineFaults } from '../../layout/src/block.ts';
import type {
  AlignContent,
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
  GapValue,
  InsetValue,
  JustifyContent,
  LayoutBox,
  LayoutInput,
  LayoutStyle,
  LengthCalc,
  LineHeightValue,
  MarginValue,
  MaxSizeValue,
  MinSizeValue,
  Overflow,
  PaddingValue,
  Position,
  SizeValue,
  TextAlign,
  TextLeaf,
  TextWrapMode,
} from '../../layout/src/input.ts';
import type { LayoutRect } from '../../layout/src/layout.ts';
import { absoluteRects, layoutWithFaults } from '../../layout/src/layout.ts';
import { measurerFor } from '../../layout/src/platform.ts';
import { snapEdges } from '../../layout/src/snap.ts';
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
    const o = obj(v, ['kind', 'value', 'axis'], path);
    const axis = lit(field(o, 'axis', path), ['width', 'height', 'min', 'max'], `${path}.axis`);
    const value = numField(o, 'value', path);
    if (axis === 'width') return { kind: 'viewport', value, axis: 'width' };
    if (axis === 'height') return { kind: 'viewport', value, axis: 'height' };
    if (axis === 'min') return { kind: 'viewport', value, axis: 'min' };
    return { kind: 'viewport', value, axis: 'max' };
  }
  if (k === 'em') {
    const o = obj(v, ['kind', 'value', 'fontSize'], path);
    return { kind: 'em', value: numField(o, 'value', path), fontSize: calcExpr(field(o, 'fontSize', path), `${path}.fontSize`) };
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

/** A LengthCalc {kind: calc, expr, range}. */
function lengthCalc(v: JsonValue, path: string): LengthCalc {
  const o = obj(v, ['kind', 'expr', 'range'], path);
  const expr = calcExpr(field(o, 'expr', path), `${path}.expr`);
  const range = lit(field(o, 'range', path), ['all', 'non-negative'], `${path}.range`);
  return range === 'all' ? { kind: 'calc', expr, range: 'all' } : { kind: 'calc', expr, range: 'non-negative' };
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
  if (k === 'px') return { kind: 'px', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'number') return { kind: 'number', value: numField(obj(v, ['kind', 'value'], path), 'value', path) };
  if (k === 'normal') {
    obj(v, ['kind'], path);
    return { kind: 'normal' };
  }
  return fail(`${path}: unknown kind ${k}`);
}

const STYLE_KEYS: readonly string[] = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'overflowX', 'overflowY', 'direction', 'boxSizing', 'width', 'height',
  'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop',
  'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'order', 'justifyContent', 'alignItems', 'alignSelf',
  'alignContent', 'rowGap', 'columnGap', 'textAlign',
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
  };
}

function decodeText(o: JsonObj, path: string): TextLeaf {
  obj(o, ['kind', 'id', 'text', 'font', 'lineHeight', 'whiteSpaceCollapse', 'textWrapMode'], path);
  const font = obj(field(o, 'font', path), ['family', 'size'], `${path}.font`);
  lit(field(font, 'family', `${path}.font`), ['Ahem'], `${path}.font.family`);
  lit(field(o, 'whiteSpaceCollapse', path), ['collapse'], `${path}.whiteSpaceCollapse`);
  return {
    kind: 'text',
    id: str(field(o, 'id', path), `${path}.id`),
    text: str(field(o, 'text', path), `${path}.text`),
    font: { family: 'Ahem', size: numField(font, 'size', `${path}.font`) },
    lineHeight: lineHeightValue(field(o, 'lineHeight', path), `${path}.lineHeight`),
    whiteSpaceCollapse: 'collapse',
    textWrapMode: lit(field(o, 'textWrapMode', path), ['wrap', 'nowrap'], `${path}.textWrapMode`) as TextWrapMode,
  };
}

function decodeBox(o: JsonObj, path: string): LayoutBox {
  obj(o, ['kind', 'id', 'boxType', 'style', 'children'], path);
  const children: (LayoutBox | TextLeaf)[] = [];
  arr(field(o, 'children', path), `${path}.children`).forEach((c, i) => {
    children.push(decodeNode(c, `${path}.children[${i}]`));
  });
  return {
    kind: 'box',
    id: str(field(o, 'id', path), `${path}.id`),
    boxType: lit(field(o, 'boxType', path), ['element', 'anonymous'], `${path}.boxType`) as BoxType,
    style: decodeStyle(field(o, 'style', path), `${path}.style`),
    children,
  };
}

function decodeNode(v: JsonValue, path: string): LayoutBox | TextLeaf {
  if (v.kind !== 'obj') return fail(`${path}: expected a node`);
  const k = kindOf(v, path);
  if (k === 'box') return decodeBox(v, path);
  if (k === 'text') return decodeText(v, path);
  return fail(`${path}: unknown node kind ${k}`);
}

function decodeInput(v: JsonValue): LayoutInput {
  const o = obj(v, ['viewport', 'devicePixelRatio', 'root'], '$');
  const vp = obj(field(o, 'viewport', '$'), ['width', 'height'], '$.viewport');
  const root = field(o, 'root', '$');
  if (root.kind !== 'obj' || kindOf(root, '$.root') !== 'box') return fail('$.root: expected a box');
  return {
    viewport: { width: numField(vp, 'width', '$.viewport'), height: numField(vp, 'height', '$.viewport') },
    devicePixelRatio: numField(o, 'devicePixelRatio', '$'),
    root: decodeBox(root, '$.root'),
  };
}

const FAULT_KEYS: readonly string[] = [
  'breakOffByOne', 'rtlAsLtr', 'ignoreOrder', 'baselineFromBorderTop', 'scrollMinAuto', 'absposInFlow', 'cbIgnoresPadding',
  'staticPosLtr', 'relativeShiftsFlow', 'metricHalfUp', 'untruncatedFontSize', 'halfLeadingSpec', 'minMaxEndMarginSpec',
  'wrapReverseBaselineSpec', 'initialLineWidthZoomed', 'calcPercentPlainOrder', 'calcDoubleEval', 'calcNoNonNegClamp',
  'calcPercentIndefiniteAsLength', 'clampMaxWins', 'divideDirect', 'calcLeafUnzoomed', 'viewportUnitsUnceiled',
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

/** One units case: ["name", arg bits...] in, the result bits out. */
export function runUnitsCase(line: string): string {
  try {
    const a = arr(parseJson(line), '$');
    const first = a[0];
    if (first === undefined) return fail('empty case');
    const name = str(first, '$[0]');
    try {
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
