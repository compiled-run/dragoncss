// Transforms (css-transforms-1, PNT2): transform, transform-origin and will-change, and the parse of their multi-token values.
// A transform is a list of 2D functions Dragon resolves itself (translate, translateX/Y, scale, scaleX/Y, rotate, and matrix()
// without skew); skew, 3D functions, perspective and a non-zero origin z are refused naming package PNT2-m, and so is a list
// whose composition skews the box, which Android's View transform (a rotation times an axis-aligned scale) cannot express.
// The individual transform properties (css-transforms-2 §4) translate, rotate and scale are read as one function each, applied
// before transform in that order (paint-values/transform.ts elementTransform); a z component or a rotation axis is refused as 3D.
import { generate, parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { list, spanOf } from '../ast.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import { normalizeUnit, unitEntry } from '../units.ts';
import type { CssValue } from '../values.ts';

export const TRANSFORM_LONGHANDS = ['transform', 'transform-origin', 'will-change', 'translate', 'rotate', 'scale'] as const;
export const TRANSFORM_SHORTHANDS = [] as const;
export const TRANSFORM_INHERITED: readonly (typeof TRANSFORM_LONGHANDS)[number][] = [];
export const TRANSFORM_CONTAINER: readonly (typeof TRANSFORM_LONGHANDS)[number][] = [];
export const TRANSFORM_TEXT_ROLE: readonly (typeof TRANSFORM_LONGHANDS)[number][] = [];

export const TRANSFORM_ASPECTS: { readonly [P in (typeof TRANSFORM_LONGHANDS)[number]]: PropertyAspect } = {
  // A transform never moves layout boxes; the containing-block change it makes for positioned descendants is refused where it
  // would move one (analysis/paint-values/transform.ts).
  transform: { layout: false, paint: true },
  'transform-origin': { layout: false, paint: true },
  'will-change': { layout: false, paint: true },
  translate: { layout: false, paint: true },
  rotate: { layout: false, paint: true },
  scale: { layout: false, paint: true },
};

/** The properties whose values this module parses (stylesheet.ts parseValue). */
export const TRANSFORM_VALUE_PROPERTIES: ReadonlySet<string> = new Set<string>(TRANSFORM_LONGHANDS);

/** The value types of the computed transform values (featureOf keys transform:<transform-list> and transform-origin:<transform-origin>). */
export const TRANSFORM_LIST_TYPE = 'transform-list';
export const TRANSFORM_ORIGIN_TYPE = 'transform-origin';
export const WILL_CHANGE_LIST_TYPE = 'will-change-list';
/** The value type of a computed translate, rotate or scale other than none: the canonical value text ("10px 0px", "45deg", "2 1"). */
export const INDIVIDUAL_TRANSFORM_TYPE = 'individual-transform';

/** The individual transform properties, in the order css-transforms-2 §4 applies them before transform. */
export const INDIVIDUAL_TRANSFORMS = ['translate', 'rotate', 'scale'] as const;

/** The will-change features Dragon accepts: transform (a containing block and stacking context, like a transform) and opacity. */
export const WILL_CHANGE_FEATURES: readonly string[] = ['transform', 'opacity'];

/** A declared length of a transform: a number and its lowercased unit, '%' for a percentage. */
export type TransformLengthDecl = { readonly value: number; readonly unit: string };

/** One declared function, matrix() already written as translate · rotate · scale. */
export type TransformFnDecl =
  | { readonly kind: 'translate'; readonly fn: 'translate' | 'translateX' | 'translateY'; readonly x: TransformLengthDecl; readonly y: TransformLengthDecl; readonly text: string }
  | { readonly kind: 'rotate'; readonly deg: number; readonly text: string }
  | { readonly kind: 'scale'; readonly fn: 'scale' | 'scaleX' | 'scaleY'; readonly sx: number; readonly sy: number; readonly text: string }
  | { readonly kind: 'matrix'; readonly values: readonly number[]; readonly text: string };

export type TransformOriginDecl = { readonly x: TransformLengthDecl; readonly y: TransformLengthDecl };

const PNT2_M = 'skew, 3D functions and perspective are not supported yet (package PNT2-m)';
const SUPPORTED_FUNCTIONS = ['translate', 'translatex', 'translatey', 'scale', 'scalex', 'scaley', 'rotate', 'matrix'];
const ZERO: TransformLengthDecl = { value: 0, unit: 'px' };

/** A refusal found while reading a value: the node it is located at and the reason. */
type Refusal = { readonly node: CssNode; readonly reason: string; readonly text?: string };
type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal };
const ok = <T>(value: T): Read<T> => ({ ok: true, value });
const no = <T>(node: CssNode, reason: string): Read<T> => ({ ok: false, refusal: { node, reason } });

/** A CSS <number> without exponent notation, so every written value is valid CSS text (the same rule as emit/web-css.ts). */
export function cssNumberText(n: number): string {
  const s = String(n === 0 ? 0 : n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (m === null) return s;
  const sign = m[1] as string;
  const frac = m[3] === undefined ? '' : m[3];
  const digits = `${m[2] as string}${frac}`;
  const exp = Number(m[4]);
  return exp < 0 ? `${sign}0.${'0'.repeat(-exp - 1)}${digits}` : `${sign}${digits}${'0'.repeat(exp - frac.length)}`;
}

export const lengthText = (l: TransformLengthDecl): string => `${cssNumberText(l.value)}${l.unit}`;

/**
 * The value, or a refusal when it overflows: a length or number past the float range (Blink stores them as floats, and so does the
 * paint resolver), an angle past the double range. css-values-4 clamps such values to the largest finite value; Dragon refuses them.
 */
function finite(n: CssNode, v: number, float = true): Read<number> {
  return (float ? inFloatRange(v) : Number.isFinite(v)) ? ok(v) : no(n, `${generate(n)} is out of range`);
}

/** Whether a double rounds to a finite float: below 2^128 - 2^103, the midpoint between the largest float and 2^128. */
export const inFloatRange = (v: number): boolean => Math.abs(v) < 2 ** 128 - 2 ** 103;

const args = (fn: CssNode): CssNode[] => list(fn, 'children').filter((n) => n.type !== 'WhiteSpace' && !(n.type === 'Operator' && n['value'] === ','));

/** A <length-percentage> argument: px, an absolute unit, em or rem, a percentage, or a unitless zero. */
function readLength(n: CssNode, percent: boolean): Read<TransformLengthDecl> {
  if (n.type === 'Percentage') return percent ? finiteLength(n, Number(n['value']), '%') : no(n, 'a percentage is not a length here');
  if (n.type === 'Number' && Number(n['value']) === 0) return ok(ZERO);
  if (n.type === 'Function') return no(n, `${String(n['name']).toLowerCase()}() in a transform function is not supported yet; write a length or a percentage`);
  if (n.type !== 'Dimension') return no(n, `${generate(n)} is not a length`);
  const unit = normalizeUnit(String(n['unit']));
  const c = unitEntry(unit)?.conversion;
  if (c === undefined) return no(n, `the unit ${unit} is not supported`);
  if (c.kind === 'refused') return no(n, c.reason);
  if (c.kind === 'viewport') return no(n, `${unit} in a transform function would be resolved against the device viewport after layout, which Dragon's transform writer does not do yet; use px, em, rem or a percentage of the box`);
  return finiteLength(n, Number(n['value']), unit);
}

function finiteLength(n: CssNode, value: number, unit: string): Read<TransformLengthDecl> {
  const v = finite(n, value);
  return v.ok ? ok({ value: v.value, unit }) : v;
}

/**
 * css-values-4 §7.1: an <angle> in degrees, or a unitless zero; the unit factors are the spec's, as Blink's
 * third_party/blink/renderer/core/css/css_primitive_value.cc:486-542 (ConversionToCanonicalUnitsScaleFactor) applies them.
 */
function readAngle(n: CssNode): Read<number> {
  if (n.type === 'Number' && Number(n['value']) === 0) return ok(0);
  if (n.type === 'Function') return no(n, `${String(n['name']).toLowerCase()}() in rotate() is not supported yet; write an angle`);
  if (n.type !== 'Dimension') return no(n, `${generate(n)} is not an angle`);
  const v = Number(n['value']);
  switch (normalizeUnit(String(n['unit']))) {
    case 'deg':
      return finite(n, v, false);
    case 'rad':
      return finite(n, v * (180 / Math.PI), false);
    case 'grad':
      return finite(n, v * (360 / 400), false);
    case 'turn':
      return finite(n, v * 360, false);
  }
  return no(n, `${generate(n)} is not an angle`);
}

/**
 * A <number>. Scale functions take numbers only: the grammar subset is webref's css-transforms-1 syntax, which matches before this
 * parse runs, so css-transforms-2 percentages (scale(50%)) never reach it.
 */
function readNumber(n: CssNode): Read<number> {
  if (n.type === 'Number') return finite(n, Number(n['value']));
  if (n.type === 'Function') return no(n, `${String(n['name']).toLowerCase()}() in a transform function is not supported yet; write a number`);
  return no(n, `${generate(n)} is not a number`);
}

/** A scale property component: a <number>, or a <percentage> as that number over 100 (css-transforms-2 §4). */
function readScaleComponent(n: CssNode): Read<number> {
  if (n.type === 'Percentage') return finite(n, Number(n['value']) / 100);
  return readNumber(n);
}

const argText = (n: CssNode): string => {
  if (n.type === 'Dimension') return `${cssNumberText(Number(n['value']))}${normalizeUnit(String(n['unit']))}`;
  if (n.type === 'Percentage') return `${cssNumberText(Number(n['value']))}%`;
  if (n.type === 'Number') return cssNumberText(Number(n['value']));
  return generate(n);
};

/** One transform function node. */
function readFunction(fn: CssNode): Read<TransformFnDecl> {
  const name = String(fn['name']).toLowerCase();
  if (!SUPPORTED_FUNCTIONS.includes(name)) return no(fn, PNT2_M);
  const a = args(fn);
  const text = `${name}(${a.map(argText).join(', ')})`;
  const first = a[0];
  if (first === undefined) return no(fn, `${name}() has no argument`);
  if (name === 'rotate') {
    const deg = readAngle(first);
    return deg.ok ? ok({ kind: 'rotate', deg: deg.value, text }) : deg;
  }
  if (name.startsWith('translate')) {
    const x = readLength(first, true);
    if (!x.ok) return x;
    const second = a[1];
    const y = second === undefined ? ok(ZERO) : readLength(second, true);
    if (!y.ok) return y;
    if (name === 'translatex') return ok({ kind: 'translate', fn: 'translateX', x: x.value, y: ZERO, text });
    if (name === 'translatey') return ok({ kind: 'translate', fn: 'translateY', x: ZERO, y: x.value, text });
    return ok({ kind: 'translate', fn: 'translate', x: x.value, y: y.value, text });
  }
  if (name.startsWith('scale')) {
    const sx = readNumber(first);
    if (!sx.ok) return sx;
    const second = a[1];
    const sy = second === undefined ? sx : readNumber(second);
    if (!sy.ok) return sy;
    if (name === 'scalex') return ok({ kind: 'scale', fn: 'scaleX', sx: sx.value, sy: 1, text });
    if (name === 'scaley') return ok({ kind: 'scale', fn: 'scaleY', sx: 1, sy: sx.value, text });
    return ok({ kind: 'scale', fn: 'scale', sx: sx.value, sy: sy.value, text });
  }
  const values: number[] = [];
  for (const n of a) {
    const v = readNumber(n);
    if (!v.ok) return v;
    values.push(v.value);
  }
  if (values.length !== 6) return no(fn, `matrix() takes six numbers`);
  const [ma, mb, mc, md] = values as [number, number, number, number, number, number];
  // A skewed matrix has columns that are not orthogonal; only a rotation times an axis-aligned scale is accepted.
  if (skewDot(ma, mb, mc, md) !== 0) return no(fn, `it skews the box: ${PNT2_M}`);
  return ok({ kind: 'matrix', values, text });
}

/**
 * The dot product of the columns (a, b) and (c, d), each first divided by its largest component, so a tiny shear cannot underflow
 * to 0; a rotation matrix (c, s, -s, c) still gives exactly 0, since both columns divide by the same component.
 */
export function skewDot(a: number, b: number, c: number, d: number): number {
  const m1 = Math.max(Math.abs(a), Math.abs(b)) || 1;
  const m2 = Math.max(Math.abs(c), Math.abs(d)) || 1;
  return (a / m1) * (c / m2) + (b / m1) * (d / m2);
}

/** matrix(a, b, c, d, e, f) with orthogonal columns as translate(e, f) · rotate(angle) · scale(sx, sy), in degrees and px. */
export function matrixParts(values: readonly number[]): { readonly tx: number; readonly ty: number; readonly deg: number; readonly sx: number; readonly sy: number } {
  const [a, b, c, d, e, f] = values as [number, number, number, number, number, number];
  const exactDeg = (cos: number, sin: number): number => {
    if (sin === 0) return cos >= 0 ? 0 : 180;
    if (cos === 0) return sin > 0 ? 90 : 270;
    return (Math.atan2(sin, cos) * 180) / Math.PI;
  };
  const sx = Math.hypot(a, b);
  if (sx === 0) {
    // The first column is zero: R(angle) · diag(0, sy) with the second column (-sy sin, sy cos).
    const sy = Math.hypot(c, d);
    return { tx: e, ty: f, deg: sy === 0 ? 0 : exactDeg(d, -c), sx: 0, sy };
  }
  return { tx: e, ty: f, deg: exactDeg(a, b), sx, sy: (a * d - b * c) / sx };
}

/**
 * Whether the list's linear part stays a rotation times an axis-aligned scale when composed left to right (css-transforms-1 §6).
 * A rotation after a non-uniform scale skews the box unless it turns by a multiple of 90deg.
 */
export function skewsBox(fns: readonly TransformFnDecl[]): boolean {
  let sx = 1;
  let sy = 1;
  const rotate = (deg: number): boolean => {
    if (sx === sy || sx === -sy) return true;
    if (deg % 90 !== 0) return false;
    if (Math.abs(deg / 90) % 2 === 1) [sx, sy] = [sy, sx];
    return true;
  };
  for (const f of fns) {
    if (f.kind === 'rotate' && !rotate(f.deg)) return true;
    if (f.kind === 'scale') {
      sx *= f.sx;
      sy *= f.sy;
    }
    if (f.kind === 'matrix') {
      const p = matrixParts(f.values);
      if (!rotate(p.deg)) return true;
      sx *= p.sx;
      sy *= p.sy;
    }
  }
  return false;
}

/** The functions of a transform value's tokens (a list of Function nodes), or the first refusal. */
function readTransformList(tokens: readonly CssNode[]): Read<TransformFnDecl[]> {
  const out: TransformFnDecl[] = [];
  for (const t of tokens) {
    if (t.type !== 'Function') return no(t, `${generate(t)} is not a transform function`);
    const f = readFunction(t);
    if (!f.ok) return f;
    out.push(f.value);
  }
  return ok(out);
}

type OriginPart = { readonly node: CssNode; readonly axis: 'x' | 'y' | 'either'; readonly length: TransformLengthDecl };

const ORIGIN_KEYWORDS: { readonly [k: string]: { readonly axis: 'x' | 'y' | 'either'; readonly percent: number } } = {
  left: { axis: 'x', percent: 0 },
  right: { axis: 'x', percent: 100 },
  top: { axis: 'y', percent: 0 },
  bottom: { axis: 'y', percent: 100 },
  center: { axis: 'either', percent: 50 },
};

/** css-transforms-1 §7: the x and y of a transform-origin value's tokens, keywords as percentages; a non-zero z is refused. */
function readOrigin(tokens: readonly CssNode[]): Read<TransformOriginDecl> {
  const parts: OriginPart[] = [];
  for (const [i, t] of tokens.entries()) {
    if (i === 2) {
      const z = readLength(t, false);
      if (!z.ok) return z;
      if (z.value.value !== 0) return no(t, `it moves the origin off the plane: ${PNT2_M}`);
      continue;
    }
    if (t.type === 'Identifier') {
      const k = ORIGIN_KEYWORDS[String(t['name']).toLowerCase()];
      if (k === undefined) return no(t, `${generate(t)} is not a transform-origin keyword`);
      parts.push({ node: t, axis: k.axis, length: { value: k.percent, unit: '%' } });
      continue;
    }
    const l = readLength(t, true);
    if (!l.ok) return l;
    parts.push({ node: t, axis: 'either', length: l.value });
  }
  const centre: TransformLengthDecl = { value: 50, unit: '%' };
  const [p, q] = parts;
  if (p === undefined) return no(tokens[0] as CssNode, 'transform-origin has no value');
  if (q === undefined) return ok(p.axis === 'y' ? { x: centre, y: p.length } : { x: p.length, y: centre });
  // The keyword pair form ([center | left | right] && [center | top | bottom]) may name y first.
  return ok(p.axis === 'y' || q.axis === 'x' ? { x: q.length, y: p.length } : { x: p.length, y: q.length });
}

export const originText = (o: TransformOriginDecl): string => `${lengthText(o.x)} ${lengthText(o.y)}`;

/** The canonical text of a function list: each function with its arguments as written (lowercase names and units). */
export const transformListText = (fns: readonly TransformFnDecl[]): string => fns.map((f) => f.text).join(' ');

/** A token of a rotation axis: an axis keyword or a vector component. */
const isAxisToken = (t: CssNode): boolean => t.type === 'Identifier' || t.type === 'Number';

/** Whether rotation axis tokens name z: none (the default), the keyword z, or a vector 0 0 k with k > 0. */
function isZAxis(axis: readonly CssNode[]): boolean {
  if (axis.length === 0) return true;
  if (axis.length === 1) return axis[0]?.type === 'Identifier' && String(axis[0]['name']).toLowerCase() === 'z';
  if (axis.length !== 3 || axis.some((t) => t.type !== 'Number')) return false;
  const [x, y, z] = axis.map((t) => Number(t['value']));
  return x === 0 && y === 0 && (z as number) > 0;
}

/**
 * The one function a translate, rotate or scale value stands for (css-transforms-2 §4): translate(x, y), rotate(angle) or
 * scale(x, y), its text the canonical value ("x y", "<deg>deg", "sx sy"). A rotation axis other than z, a non-zero z translation and
 * a z scale other than 1 are refused as 3D.
 */
function readIndividual(property: (typeof INDIVIDUAL_TRANSFORMS)[number], tokens: readonly CssNode[]): Read<TransformFnDecl> {
  const [a, b, c] = tokens as readonly (CssNode | undefined)[];
  if (a === undefined) return no(tokens[0] as CssNode, `${property} has no value`);
  if (property === 'rotate') {
    // The axis is z, or a vector 0 0 k with k > 0, before or after the angle: Chrome 145 computes those to the angle alone, a 2D
    // rotation. Any other axis (x, y, a tilted vector, or 0 0 k with k <= 0, which Chrome keeps as written) is refused at the axis.
    const angleAt = tokens.length === 1 || !isAxisToken(a) ? 0 : tokens.length - 1;
    const axis = tokens.filter((_, i) => i !== angleAt);
    if (!isZAxis(axis)) return no(axis[0] as CssNode, `a rotation axis other than z turns the box out of the plane: ${PNT2_M}`);
    const deg = readAngle(tokens[angleAt] as CssNode);
    return deg.ok ? ok({ kind: 'rotate', deg: deg.value, text: `${cssNumberText(deg.value)}deg` }) : deg;
  }
  if (property === 'translate') {
    const x = readLength(a, true);
    if (!x.ok) return x;
    const y = b === undefined ? ok(ZERO) : readLength(b, true);
    if (!y.ok) return y;
    if (c !== undefined) {
      const z = readLength(c, false);
      if (!z.ok) return z;
      if (z.value.value !== 0) return no(c, `a z translation moves the box off the plane: ${PNT2_M}`);
    }
    return ok({ kind: 'translate', fn: 'translate', x: x.value, y: y.value, text: `${lengthText(x.value)} ${lengthText(y.value)}` });
  }
  const sx = readScaleComponent(a);
  if (!sx.ok) return sx;
  const sy = b === undefined ? sx : readScaleComponent(b);
  if (!sy.ok) return sy;
  if (c !== undefined) {
    const sz = readScaleComponent(c);
    if (!sz.ok) return sz;
    if (sz.value !== 1) return no(c, `a z scale is a 3D transform: ${PNT2_M}`);
  }
  return ok({ kind: 'scale', fn: 'scale', sx: sx.value, sy: sy.value, text: `${cssNumberText(sx.value)} ${cssNumberText(sy.value)}` });
}

const explicit = (property: (typeof TRANSFORM_LONGHANDS)[number], value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property, value, explicit: true } satisfies LonghandValue] });

function refused(property: string, r: Refusal, base: Span): ParsedValue {
  return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(r.node, base)), message: `${property}: ${r.text ?? generate(r.node)} is unsupported: ${r.reason}`, manual: (INDIVIDUAL_TRANSFORMS as readonly string[]).includes(property) ? `Write ${property} with two-dimensional values only.` : `Use translate, scale, rotate or matrix() without skew in ${property}.` }) };
}

/**
 * The value of transform, transform-origin or will-change after the grammar matched (stylesheet.ts parseValue): a keyword or the
 * canonical text of the whole value, or a located refusal.
 */
export function parseTransformValue(property: string, tokens: readonly CssNode[], base: Span): ParsedValue {
  const only = tokens.length === 1 ? tokens[0] : undefined;
  const keyword = only !== undefined && only.type === 'Identifier' ? String(only['name']).toLowerCase() : null;
  if (property === 'transform') {
    if (keyword === 'none') return explicit('transform', { kind: 'keyword', value: 'none' });
    const fns = readTransformList(tokens);
    if (!fns.ok) return refused(property, fns.refusal, base);
    if (skewsBox(fns.value)) {
      const first = tokens[0] as CssNode;
      const last = tokens[tokens.length - 1] as CssNode;
      const node = { ...first, loc: first.loc === null || first.loc === undefined || last.loc === null || last.loc === undefined ? first.loc : { ...first.loc, end: last.loc.end } } as CssNode;
      return refused(property, { node, text: tokens.map((t) => generate(t)).join(' '), reason: `a rotation after a non-uniform scale skews the box, which Android's View transform cannot express: ${PNT2_M}` }, base);
    }
    return explicit('transform', { kind: 'other', type: TRANSFORM_LIST_TYPE, text: transformListText(fns.value) });
  }
  if ((INDIVIDUAL_TRANSFORMS as readonly string[]).includes(property)) {
    const p = property as (typeof INDIVIDUAL_TRANSFORMS)[number];
    if (keyword === 'none') return explicit(p, { kind: 'keyword', value: 'none' });
    const f = readIndividual(p, tokens);
    if (!f.ok) return refused(property, f.refusal, base);
    return explicit(p, { kind: 'other', type: INDIVIDUAL_TRANSFORM_TYPE, text: f.value.text });
  }
  if (property === 'transform-origin') {
    const o = readOrigin(tokens);
    if (!o.ok) return refused(property, o.refusal, base);
    return explicit('transform-origin', { kind: 'other', type: TRANSFORM_ORIGIN_TYPE, text: originText(o.value) });
  }
  if (keyword === 'auto') return explicit('will-change', { kind: 'keyword', value: 'auto' });
  const features: string[] = [];
  for (const t of tokens) {
    if (t.type === 'Operator' && t['value'] === ',') continue;
    const name = t.type === 'Identifier' ? String(t['name']).toLowerCase() : '';
    if (!WILL_CHANGE_FEATURES.includes(name)) {
      return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `will-change: ${generate(t)} is unsupported: only auto, transform and opacity are supported (package PNT2)`, manual: 'Use will-change: transform, opacity or auto.' }) };
    }
    features.push(name);
  }
  if (features.length === 1) return explicit('will-change', { kind: 'keyword', value: features[0] as string });
  return explicit('will-change', { kind: 'other', type: WILL_CHANGE_LIST_TYPE, text: features.join(', ') });
}

/** The value tokens of a canonical text (a computed value this module wrote), without white space. */
function valueTokens(text: string): CssNode[] {
  return list(parse(text, { context: 'value' }), 'children').filter((n) => n.type !== 'WhiteSpace');
}

/** The functions of a transform-list text this module wrote; throws on text it did not write. */
export function transformFunctionsOf(text: string): TransformFnDecl[] {
  const r = readTransformList(valueTokens(text));
  if (!r.ok) throw new Error(`transform-list ${JSON.stringify(text)}: ${r.refusal.reason}`);
  return r.value;
}

/** The function of a computed translate, rotate or scale text this module wrote; throws on text it did not write. */
export function individualTransformOf(property: (typeof INDIVIDUAL_TRANSFORMS)[number], text: string): TransformFnDecl {
  const f = readIndividual(property, valueTokens(text));
  if (!f.ok) throw new Error(`${property} ${JSON.stringify(text)}: ${f.refusal.reason}`);
  return f.value;
}

/** The x and y of a transform-origin text (this module's canonical text or the webref initial value "50% 50%"). */
export function transformOriginOf(text: string): TransformOriginDecl {
  const r = readOrigin(valueTokens(text));
  if (!r.ok) throw new Error(`transform-origin ${JSON.stringify(text)}: ${r.refusal.reason}`);
  return r.value;
}

/** The will-change features of a computed will-change value. */
export function willChangeFeatures(v: CssValue): readonly string[] {
  if (v.kind === 'keyword') return v.value === 'auto' ? [] : [v.value];
  if (v.kind === 'other' && v.type === WILL_CHANGE_LIST_TYPE) return v.text.split(', ');
  return [];
}
