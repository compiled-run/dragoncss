// clip-path (css-masking-1 §6.1): none, or one basic shape (css-shapes-1 §3.1) against the border box: inset() with one to four
// <length-percentage> edges and no round, circle() and ellipse() with an optional radius and position, and polygon() with an
// optional fill rule. Chrome 145 parses it in ClipPath::ParseSingleValue (longhands_custom.cc) through ConsumeBasicShape
// (css_parsing_utils.cc), drops a trailing or leading border-box, computes each length to px with percentages kept, and serializes:
// inset() as the shortest of the four edges, as margin's shorthand does; circle() and ellipse() without a closest-side radius and
// without a position that was left out; a position with each axis offset from left or top (center is 50%, right and bottom 100%,
// a percentage from right or bottom 100% less it, a zero length 0%), unless an axis keeps a nonzero length from right or bottom, when
// both print as keyword and offset; polygon() without the nonzero fill rule and with each 0 as 0px.
// Every other shape, a url(), another reference box, a round and a calculation or viewport-unit length are refused on every target.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import { normalizeUnit, unitEntry } from '../units.ts';
import type { CssValue } from '../values.ts';
import { chromeNumber } from '../chrome-number.ts';

export const CLIP_PATH_LONGHANDS = ['clip-path'] as const;
export const CLIP_PATH_SHORTHANDS = [] as const;
export const CLIP_PATH_INHERITED: readonly (typeof CLIP_PATH_LONGHANDS)[number][] = [];
export const CLIP_PATH_CONTAINER: readonly (typeof CLIP_PATH_LONGHANDS)[number][] = [];
export const CLIP_PATH_TEXT_ROLE: readonly (typeof CLIP_PATH_LONGHANDS)[number][] = [];

export const CLIP_PATH_ASPECTS: { readonly [P in (typeof CLIP_PATH_LONGHANDS)[number]]: PropertyAspect } = {
  'clip-path': { layout: false, paint: true },
};

/** The CssValue types of a clip path's shapes; each text is Chrome's computed serialization of the shape. */
export const CLIP_PATH_INSET = 'clip-path-inset';
export const CLIP_PATH_CIRCLE = 'clip-path-circle';
export const CLIP_PATH_ELLIPSE = 'clip-path-ellipse';
export const CLIP_PATH_POLYGON = 'clip-path-polygon';
const SHAPE_TYPES: readonly string[] = [CLIP_PATH_INSET, CLIP_PATH_CIRCLE, CLIP_PATH_ELLIPSE, CLIP_PATH_POLYGON];

/** One inset edge: a length in a unit with a build-time px value, or a percentage of the reference box's width or height. */
export type InsetEdge = { readonly value: number; readonly unit: string };

/** The four inset edges in top, right, bottom, left order. */
export type InsetEdges = readonly [InsetEdge, InsetEdge, InsetEdge, InsetEdge];

/** A shape length: a length in a unit with a build-time px value, or a percentage (`%`) of a reference box extent. */
export type ShapeLength = InsetEdge;

/** One axis of a shape's position: an offset from the left or top edge, or, a nonzero length only, from the right or bottom edge. */
export type ShapeCoord = { readonly from: 'start' | 'end'; readonly offset: ShapeLength };

/** A circle() or ellipse() radius. */
export type ShapeRadius = ShapeLength | 'closest-side' | 'farthest-side';

/** A clip path's shape; a circle or ellipse without a position is centred (50% 50%). */
export type ClipShape =
  | { readonly kind: 'inset'; readonly edges: InsetEdges }
  | { readonly kind: 'circle'; readonly radius: ShapeRadius; readonly at: readonly [ShapeCoord, ShapeCoord] | null }
  | { readonly kind: 'ellipse'; readonly radii: readonly [ShapeRadius, ShapeRadius]; readonly at: readonly [ShapeCoord, ShapeCoord] | null }
  | { readonly kind: 'polygon'; readonly evenodd: boolean; readonly points: readonly (readonly [ShapeLength, ShapeLength])[] };

const CLIP_PATH_FIX = 'Use clip-path: inset(), circle(), ellipse() or polygon() with px, em, rem, absolute-length or percentage lengths and no round, or clip-path: none.';

/** A length as Chrome serializes it: six significant digits (chromeNumber). */
const edgeText = (e: InsetEdge): string => `${chromeNumber(e.value)}${e.unit}`;
const radiusText = (r: ShapeRadius): string => (typeof r === 'string' ? r : edgeText(r));

function positionText(at: readonly [ShapeCoord, ShapeCoord]): string {
  const [x, y] = at;
  if (x.from === 'start' && y.from === 'start') return `${edgeText(x.offset)} ${edgeText(y.offset)}`;
  return `${x.from === 'start' ? 'left' : 'right'} ${edgeText(x.offset)} ${y.from === 'start' ? 'top' : 'bottom'} ${edgeText(y.offset)}`;
}

/** The CssValue of an inset() from its four edges, in Chrome's shortest form (BuildRectStringCommon). */
export function insetValue(edges: InsetEdges): CssValue {
  const [top, right, bottom, left] = edges.map(edgeText) as [string, string, string, string];
  const showLeft = left !== right;
  const showBottom = bottom !== top || showLeft;
  const showRight = right !== top || showBottom;
  const parts = [top, ...(showRight ? [right] : []), ...(showBottom ? [bottom] : []), ...(showLeft ? [left] : [])];
  return { kind: 'other', type: CLIP_PATH_INSET, text: `inset(${parts.join(' ')})` };
}

/** The CssValue of a clip shape, in Chrome's computed serialization (CSSBasicShape*Value::CustomCSSText). */
export function shapeValue(shape: ClipShape): CssValue {
  const at = (p: readonly [ShapeCoord, ShapeCoord] | null): string[] => (p === null ? [] : [`at ${positionText(p)}`]);
  switch (shape.kind) {
    case 'inset':
      return insetValue(shape.edges);
    case 'circle':
      return { kind: 'other', type: CLIP_PATH_CIRCLE, text: `circle(${[...(shape.radius === 'closest-side' ? [] : [radiusText(shape.radius)]), ...at(shape.at)].join(' ')})` };
    case 'ellipse': {
      const radii = shape.radii[0] === 'closest-side' && shape.radii[1] === 'closest-side' ? [] : [`${radiusText(shape.radii[0])} ${radiusText(shape.radii[1])}`];
      return { kind: 'other', type: CLIP_PATH_ELLIPSE, text: `ellipse(${[...radii, ...at(shape.at)].join(' ')})` };
    }
    case 'polygon':
      return { kind: 'other', type: CLIP_PATH_POLYGON, text: `polygon(${shape.evenodd ? 'evenodd, ' : ''}${shape.points.map(([x, y]) => `${edgeText(x)} ${edgeText(y)}`).join(', ')})` };
  }
}

function lengthOf(p: string): ShapeLength {
  const e = /^(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)([a-z]+|%)$/.exec(p);
  if (e === null) throw new Error(`clip-path length ${JSON.stringify(p)} is not a length or percentage`);
  return { value: Number(e[1]), unit: e[2] as string };
}

/** The four edges of an inset() value; null for none; throws on any other value. */
export function insetEdgesOf(v: CssValue): InsetEdges | null {
  if (v.kind === 'keyword' && v.value === 'none') return null;
  if (v.kind !== 'other' || v.type !== CLIP_PATH_INSET) throw new Error(`clip-path ${JSON.stringify(v)} is not none or inset()`);
  const m = /^inset\((.*)\)$/.exec(v.text);
  const parts = (m === null ? '' : (m[1] as string)).split(' ').map(lengthOf);
  if (m === null || parts.length < 1 || parts.length > 4) throw new Error(`clip-path ${JSON.stringify(v.text)} is not one to four edges`);
  // css-shapes-1 §3.1: the edges expand as margin does (top, right = top, bottom = top, left = right).
  const [t, r = t, b = t, l = r] = parts as [InsetEdge, InsetEdge?, InsetEdge?, InsetEdge?];
  return [t, r, b, l] as unknown as InsetEdges;
}

function positionOf(parts: readonly string[]): readonly [ShapeCoord, ShapeCoord] {
  if (parts.length === 2) return [{ from: 'start', offset: lengthOf(parts[0] as string) }, { from: 'start', offset: lengthOf(parts[1] as string) }];
  if (parts.length !== 4) throw new Error(`clip-path position ${JSON.stringify(parts.join(' '))} is not two or four parts`);
  return [{ from: parts[0] === 'right' ? 'end' : 'start', offset: lengthOf(parts[1] as string) }, { from: parts[2] === 'bottom' ? 'end' : 'start', offset: lengthOf(parts[3] as string) }];
}

const radiusOf = (p: string): ShapeRadius => (p === 'closest-side' || p === 'farthest-side' ? p : lengthOf(p));

/** The shape of a computed clip-path; null for none; throws on any other value. */
export function clipShapeOf(v: CssValue): ClipShape | null {
  if (v.kind === 'keyword' && v.value === 'none') return null;
  if (v.kind !== 'other' || !SHAPE_TYPES.includes(v.type)) throw new Error(`clip-path ${JSON.stringify(v)} is not none or a basic shape`);
  if (v.type === CLIP_PATH_INSET) return { kind: 'inset', edges: insetEdgesOf(v) as InsetEdges };
  const m = /^[a-z]+\((.*)\)$/.exec(v.text);
  if (m === null) throw new Error(`clip-path ${JSON.stringify(v.text)} is not a function`);
  const inner = m[1] as string;
  if (v.type === CLIP_PATH_POLYGON) {
    const groups = inner.split(', ');
    const evenodd = groups[0] === 'evenodd';
    const points = (evenodd ? groups.slice(1) : groups).map((g) => {
      const xy = g.split(' ');
      if (xy.length !== 2) throw new Error(`clip-path polygon point ${JSON.stringify(g)} is not two lengths`);
      return [lengthOf(xy[0] as string), lengthOf(xy[1] as string)] as const;
    });
    return { kind: 'polygon', evenodd, points };
  }
  const [head = '', tail] = inner.startsWith('at ') ? ['', inner.slice(3)] : inner.split(' at ');
  const radii = head === '' ? [] : head.split(' ').map(radiusOf);
  const at = tail === undefined ? null : positionOf(tail.split(' '));
  if (v.type === CLIP_PATH_CIRCLE) {
    if (radii.length > 1) throw new Error(`clip-path ${JSON.stringify(v.text)} has more than one radius`);
    return { kind: 'circle', radius: radii[0] ?? 'closest-side', at };
  }
  if (radii.length === 1 || radii.length > 2) throw new Error(`clip-path ${JSON.stringify(v.text)} does not have zero or two radii`);
  return { kind: 'ellipse', radii: radii.length === 2 ? [radii[0] as ShapeRadius, radii[1] as ShapeRadius] : ['closest-side', 'closest-side'], at };
}

/** Every length of a shape mapped through f; null when f gives null for one. */
export function mapShapeLengths(shape: ClipShape, f: (l: ShapeLength) => ShapeLength | null): ClipShape | null {
  let failed = false;
  const g = (l: ShapeLength): ShapeLength => {
    const out = f(l);
    if (out === null) failed = true;
    return out ?? l;
  };
  const r = (x: ShapeRadius): ShapeRadius => (typeof x === 'string' ? x : g(x));
  const at = (p: readonly [ShapeCoord, ShapeCoord] | null): readonly [ShapeCoord, ShapeCoord] | null => (p === null ? null : [{ from: p[0].from, offset: g(p[0].offset) }, { from: p[1].from, offset: g(p[1].offset) }]);
  const out: ClipShape =
    shape.kind === 'inset' ? { kind: 'inset', edges: shape.edges.map(g) as unknown as InsetEdges }
      : shape.kind === 'circle' ? { kind: 'circle', radius: r(shape.radius), at: at(shape.at) }
        : shape.kind === 'ellipse' ? { kind: 'ellipse', radii: [r(shape.radii[0]), r(shape.radii[1])], at: at(shape.at) }
          : { kind: 'polygon', evenodd: shape.evenodd, points: shape.points.map(([x, y]) => [g(x), g(y)] as const) };
  return failed ? null : out;
}

/** Every length of a shape, in order. */
export function shapeLengths(shape: ClipShape): ShapeLength[] {
  const out: ShapeLength[] = [];
  mapShapeLengths(shape, (l) => {
    out.push(l);
    return l;
  });
  return out;
}

/** Whether an element has a clip-path other than none; an element map without the longhand (a test's partial props) has none. */
export function hasClipPath(el: Pick<ResolvedElement, 'props'>): boolean {
  const v = el.props.get('clip-path');
  return v !== undefined && clipShapeOf(v.value) !== null;
}

/** The shape of an element's clip-path, or null for none. */
export function clipPathShape(el: Pick<ResolvedElement, 'props' | 'element'>): ClipShape | null {
  const v = el.props.get('clip-path');
  if (v === undefined) throw new Error(`${el.element.address}: clip-path did not resolve`);
  return clipShapeOf(v.value);
}

type LengthResult = { readonly ok: ShapeLength } | { readonly refused: ParsedValue } | { readonly invalid: string };

/** A shape length: 0, a length (any sign) or a percentage; a calculation and a viewport unit are refused. */
function shapeLength(t: CssNode, base: Span): LengthResult {
  const refuse = (message: string): LengthResult => ({ refused: { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message, manual: CLIP_PATH_FIX }) } });
  if (t.type === 'Number') return Number(t['value']) === 0 ? { ok: { value: 0, unit: 'px' } } : { invalid: 'a shape length other than 0 needs a unit' };
  if (t.type === 'Percentage') return { ok: { value: Number(t['value']), unit: '%' } };
  if (t.type === 'Dimension') {
    const unit = normalizeUnit(String(t['unit']));
    const c = unitEntry(unit)?.conversion;
    if (c === undefined) return { invalid: `${unit} is not a length unit` };
    if (c.kind === 'refused') return refuse(`clip-path: ${generate(t)} is unsupported: ${c.reason}`);
    if (c.kind === 'viewport') return refuse(`clip-path: ${generate(t)} is unsupported: a shape length in a viewport unit would need the device viewport on the native side`);
    return { ok: { value: Number(t['value']), unit } };
  }
  if (t.type === 'Function') return refuse(`clip-path: ${generate(t)} is unsupported: a calculation in a shape length is not supported`);
  return { invalid: `${generate(t)} is not a length or percentage` };
}

const word = (t: CssNode | undefined): string | null => (t !== undefined && t.type === 'Identifier' ? asciiLower(String(t['name'])) : null);

/** A parse step's outcome: its value, or the ParsedValue that ends the parse (refused or invalid). */
type Step<T> = { readonly ok: T } | { readonly stop: ParsedValue };
const invalid = (reason: string): { readonly stop: ParsedValue } => ({ stop: { kind: 'invalid', reason } });

function lengthStep(t: CssNode, base: Span): Step<ShapeLength> {
  const r = shapeLength(t, base);
  if ('refused' in r) return { stop: r.refused };
  if ('invalid' in r) return invalid(r.invalid);
  return r;
}

/** A circle() or ellipse() radius: closest-side, farthest-side or a length-percentage of 0 or more. */
function radiusStep(t: CssNode, base: Span): Step<ShapeRadius> {
  const w = word(t);
  if (w === 'closest-side' || w === 'farthest-side') return { ok: w };
  if (w !== null) return invalid(`${w} is not a shape radius`);
  const r = lengthStep(t, base);
  if ('stop' in r) return r;
  return r.ok.value < 0 ? invalid('a shape radius cannot be negative') : r;
}

const HORIZONTAL = ['left', 'center', 'right'];
const VERTICAL = ['top', 'center', 'bottom'];

/** One axis from its keyword (or null) and offset (or null), in Chrome's computed form (see the header). */
function coord(kw: string | null, offset: ShapeLength | null): ShapeCoord {
  const pct = (value: number): ShapeCoord => ({ from: 'start', offset: { value, unit: '%' } });
  if (offset === null) return pct(kw === 'center' ? 50 : kw === 'right' || kw === 'bottom' ? 100 : 0);
  const end = kw === 'right' || kw === 'bottom';
  if (offset.unit === '%') return pct(end ? 100 - offset.value : offset.value);
  if (offset.value === 0) return pct(end ? 100 : 0);
  return { from: end ? 'end' : 'start', offset };
}

/** A shape's <position> as Chrome's ConsumePosition reads it for a basic shape: one, two or four parts, never three. */
function positionStep(parts: readonly CssNode[], base: Span): Step<readonly [ShapeCoord, ShapeCoord]> {
  const bad = invalid('a shape position takes one, two or four parts');
  const lengths: (ShapeLength | null)[] = [];
  for (const t of parts) {
    if (t.type === 'Identifier') {
      lengths.push(null);
      continue;
    }
    const r = lengthStep(t, base);
    if ('stop' in r) return r;
    lengths.push(r.ok);
  }
  const words = parts.map(word);
  if (parts.length === 1) {
    const w = words[0] ?? null;
    if (w === null) return { ok: [coord(null, lengths[0] ?? null), coord('center', null)] };
    if (w === 'top' || w === 'bottom') return { ok: [coord('center', null), coord(w, null)] };
    return HORIZONTAL.includes(w) ? { ok: [coord(w, null), coord('center', null)] } : bad;
  }
  if (parts.length === 2) {
    const [a = null, b = null] = words;
    // Two keywords may come in either order; a length first is horizontal, and a length second is vertical.
    if (a !== null && b !== null) {
      if (HORIZONTAL.includes(a) && VERTICAL.includes(b)) return { ok: [coord(a, null), coord(b, null)] };
      if (VERTICAL.includes(a) && HORIZONTAL.includes(b)) return { ok: [coord(b, null), coord(a, null)] };
      return bad;
    }
    if (a !== null && !HORIZONTAL.includes(a)) return bad;
    if (b !== null && !VERTICAL.includes(b)) return bad;
    return { ok: [coord(a, a === null ? (lengths[0] ?? null) : null), coord(b, b === null ? (lengths[1] ?? null) : null)] };
  }
  if (parts.length === 4) {
    const [a = null, , c = null] = words;
    if (a === null || c === null || words[1] !== null || words[3] !== null || a === 'center' || c === 'center') return bad;
    const x = ['left', 'right'];
    const y = ['top', 'bottom'];
    if (x.includes(a) && y.includes(c)) return { ok: [coord(a, lengths[1] ?? null), coord(c, lengths[3] ?? null)] };
    if (y.includes(a) && x.includes(c)) return { ok: [coord(c, lengths[3] ?? null), coord(a, lengths[1] ?? null)] };
    return bad;
  }
  return bad;
}

/** circle() and ellipse(): the radii before `at` (circle: none or one; ellipse: none or two), then an optional position. */
function ovalStep(kind: 'circle' | 'ellipse', args: readonly CssNode[], base: Span): Step<ClipShape> {
  const at = args.findIndex((a) => word(a) === 'at');
  const head = at < 0 ? args : args.slice(0, at);
  const radii: ShapeRadius[] = [];
  for (const a of head) {
    const r = radiusStep(a, base);
    if ('stop' in r) return r;
    radii.push(r.ok);
  }
  let position: readonly [ShapeCoord, ShapeCoord] | null = null;
  if (at >= 0) {
    const p = positionStep(args.slice(at + 1), base);
    if ('stop' in p) return p;
    position = p.ok;
  }
  if (kind === 'circle') return radii.length > 1 ? invalid('circle() takes one radius at most') : { ok: { kind, radius: radii[0] ?? 'closest-side', at: position } };
  if (radii.length !== 0 && radii.length !== 2) return invalid('ellipse() takes no radius or two');
  return { ok: { kind, radii: radii.length === 2 ? [radii[0] as ShapeRadius, radii[1] as ShapeRadius] : ['closest-side', 'closest-side'], at: position } };
}

/** polygon(): an optional fill rule, then one or more points of two length-percentages, comma separated. */
function polygonStep(args: readonly CssNode[], base: Span): Step<ClipShape> {
  const groups: CssNode[][] = [[]];
  for (const a of args) {
    if (a.type === 'Operator' && String(a['value']) === ',') groups.push([]);
    else (groups[groups.length - 1] as CssNode[]).push(a);
  }
  const first = groups[0] as CssNode[];
  const rule = first.length === 1 ? word(first[0]) : null;
  const evenodd = rule === 'evenodd';
  if (rule !== null && rule !== 'evenodd' && rule !== 'nonzero') return invalid(`${rule} is not a fill rule`);
  const pointGroups = rule === null ? groups : groups.slice(1);
  if (pointGroups.length === 0) return invalid('polygon() takes one point at least');
  const points: (readonly [ShapeLength, ShapeLength])[] = [];
  for (const g of pointGroups) {
    if (g.length !== 2) return invalid('a polygon() point takes two lengths');
    const x = lengthStep(g[0] as CssNode, base);
    if ('stop' in x) return x;
    const y = lengthStep(g[1] as CssNode, base);
    if ('stop' in y) return y;
    points.push([x.ok, y.ok]);
  }
  return { ok: { kind: 'polygon', evenodd, points } };
}

function insetStep(shape: CssNode, args: readonly CssNode[], base: Span, refuse: (t: CssNode, why: string) => ParsedValue): Step<ClipShape> {
  if (args.some((c) => word(c) === 'round')) return { stop: refuse(shape, 'Dragon draws an inset() clip with square corners only, without round') };
  if (args.length < 1 || args.length > 4) return invalid('inset() takes one to four edges');
  const edges: InsetEdge[] = [];
  for (const a of args) {
    const r = lengthStep(a, base);
    if ('stop' in r) return r;
    edges.push(r.ok);
  }
  const [t, r = t, b = t, l = r] = edges as [InsetEdge, InsetEdge?, InsetEdge?, InsetEdge?];
  return { ok: { kind: 'inset', edges: [t, r, b, l] as unknown as InsetEdges } };
}

const SHAPES = 'inset(), circle(), ellipse() and polygon()';

/** ClipPath::ParseSingleValue for the values Dragon draws: none, or one basic shape with an optional border-box. */
export function parseClipPath(tokens: readonly CssNode[], base: Span): ParsedValue {
  const first = tokens[0];
  if (tokens.length === 1 && word(first) === 'none') return { kind: 'ok', longhands: [{ property: 'clip-path', value: { kind: 'keyword', value: 'none' }, explicit: true }] };
  const refuse = (t: CssNode, why: string): ParsedValue => ({ kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `clip-path: ${generate(t)} is unsupported: ${why}`, manual: CLIP_PATH_FIX }) });
  const shapes = tokens.filter((t) => t.type === 'Function');
  const boxes = tokens.filter((t) => t.type === 'Identifier');
  const other = tokens.find((t) => t.type !== 'Function' && t.type !== 'Identifier');
  if (other !== undefined) return refuse(other, `Dragon draws a clip path from ${SHAPES} only, not a url() reference`);
  const box = boxes.find((t) => word(t) !== 'border-box');
  if (box !== undefined) return refuse(box, 'Dragon clips to the border box only, the reference box clip-path takes by default');
  const shape = shapes[0];
  if (shape === undefined) return refuse(tokens[0] as CssNode, `Dragon draws a clip path from ${SHAPES} only, not from a reference box alone`);
  if (shapes.length !== 1 || boxes.length > 1) return { kind: 'invalid', reason: 'clip-path takes one shape and one reference box at most' };
  const name = asciiLower(String(shape['name']));
  const args = (shape['children'] as { toArray(): CssNode[] }).toArray().filter((c) => c.type !== 'WhiteSpace');
  const step = name === 'inset' ? insetStep(shape, args, base, refuse)
    : name === 'circle' || name === 'ellipse' ? ovalStep(name, args, base)
      : name === 'polygon' ? polygonStep(args, base)
        : { stop: refuse(shape, `Dragon draws a clip path from ${SHAPES} only (MASK-CLIP)`) };
  if ('stop' in step) return step.stop;
  return { kind: 'ok', longhands: [{ property: 'clip-path', value: shapeValue(step.ok), explicit: true }] };
}

/** The value parser of the clip-path family (the paint value hook, css/paint-parsers.ts). */
export const CLIP_PATH_VALUE_PARSERS: { readonly [P in (typeof CLIP_PATH_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'clip-path': parseClipPath,
};
