// clip-path (css-masking-1 §6.1): none, or inset() (css-shapes-1 §3.1) with one to four <length-percentage> edges and no round,
// against the border box. Chrome 145 parses it in ClipPath::ParseSingleValue (longhands_custom.cc) through ConsumeBasicShapeInset
// (css_parsing_utils.cc: any sign), drops a trailing border-box, computes each length to px with percentages kept, and serializes
// the shortest of the four edges, as margin's shorthand does.
// Every other shape, a url(), another reference box, a round and a calculation or viewport-unit edge are refused on every target.
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
import { componentText } from './radius.ts';

export const CLIP_PATH_LONGHANDS = ['clip-path'] as const;
export const CLIP_PATH_SHORTHANDS = [] as const;
export const CLIP_PATH_INHERITED: readonly (typeof CLIP_PATH_LONGHANDS)[number][] = [];
export const CLIP_PATH_CONTAINER: readonly (typeof CLIP_PATH_LONGHANDS)[number][] = [];
export const CLIP_PATH_TEXT_ROLE: readonly (typeof CLIP_PATH_LONGHANDS)[number][] = [];

export const CLIP_PATH_ASPECTS: { readonly [P in (typeof CLIP_PATH_LONGHANDS)[number]]: PropertyAspect } = {
  'clip-path': { layout: false, paint: true },
};

/** The CssValue type of an inset() clip path; its text is the shortest inset(t [r [b [l]]]) form. */
export const CLIP_PATH_INSET = 'clip-path-inset';

/** One inset edge: a length in a unit with a build-time px value, or a percentage of the reference box's width or height. */
export type InsetEdge = { readonly value: number; readonly unit: string };

/** The four inset edges in top, right, bottom, left order. */
export type InsetEdges = readonly [InsetEdge, InsetEdge, InsetEdge, InsetEdge];

const CLIP_PATH_FIX = 'Use clip-path: inset() with px, em, rem, absolute-length or percentage edges and no round, or clip-path: none.';

const edgeText = (e: InsetEdge): string => (e.unit === '%' ? componentText({ kind: 'percentage', value: e.value }) : componentText({ kind: 'length', value: e.value, unit: e.unit }));

/** The CssValue of an inset() from its four edges, in Chrome's shortest form (BuildRectStringCommon). */
export function insetValue(edges: InsetEdges): CssValue {
  const [top, right, bottom, left] = edges.map(edgeText) as [string, string, string, string];
  const showLeft = left !== right;
  const showBottom = bottom !== top || showLeft;
  const showRight = right !== top || showBottom;
  const parts = [top, ...(showRight ? [right] : []), ...(showBottom ? [bottom] : []), ...(showLeft ? [left] : [])];
  return { kind: 'other', type: CLIP_PATH_INSET, text: `inset(${parts.join(' ')})` };
}

/** The four edges of an inset() value; null for none; throws on any other value. */
export function insetEdgesOf(v: CssValue): InsetEdges | null {
  if (v.kind === 'keyword' && v.value === 'none') return null;
  if (v.kind !== 'other' || v.type !== CLIP_PATH_INSET) throw new Error(`clip-path ${JSON.stringify(v)} is not none or inset()`);
  const m = /^inset\((.*)\)$/.exec(v.text);
  const parts = (m === null ? '' : (m[1] as string)).split(' ').map((p): InsetEdge => {
    const e = /^(-?(?:\d+\.?\d*|\.\d+))([a-z]+|%)$/.exec(p);
    if (e === null) throw new Error(`clip-path edge ${JSON.stringify(p)} is not a length or percentage`);
    return { value: Number(e[1]), unit: e[2] as string };
  });
  if (m === null || parts.length < 1 || parts.length > 4) throw new Error(`clip-path ${JSON.stringify(v.text)} is not one to four edges`);
  // css-shapes-1 §3.1: the edges expand as margin does (top, right = top, bottom = top, left = right).
  const [t, r = t, b = t, l = r] = parts as [InsetEdge, InsetEdge?, InsetEdge?, InsetEdge?];
  return [t, r, b, l] as unknown as InsetEdges;
}

/** Whether an element has a clip-path other than none; an element map without the longhand (a test's partial props) has none. */
export function hasClipPath(el: Pick<ResolvedElement, 'props'>): boolean {
  const v = el.props.get('clip-path');
  return v !== undefined && insetEdgesOf(v.value) !== null;
}

/** The inset() edges of an element's clip-path, or null for none. */
export function clipPathEdges(el: Pick<ResolvedElement, 'props' | 'element'>): InsetEdges | null {
  const v = el.props.get('clip-path');
  if (v === undefined) throw new Error(`${el.element.address}: clip-path did not resolve`);
  return insetEdgesOf(v.value);
}

type EdgeResult = { readonly ok: InsetEdge } | { readonly refused: ParsedValue } | { readonly invalid: string };

function insetEdge(t: CssNode, base: Span): EdgeResult {
  const refuse = (message: string): EdgeResult => ({ refused: { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message, manual: CLIP_PATH_FIX }) } });
  if (t.type === 'Number') return Number(t['value']) === 0 ? { ok: { value: 0, unit: 'px' } } : { invalid: 'an inset edge other than 0 needs a unit' };
  if (t.type === 'Percentage') return { ok: { value: Number(t['value']), unit: '%' } };
  if (t.type === 'Dimension') {
    const unit = normalizeUnit(String(t['unit']));
    const c = unitEntry(unit)?.conversion;
    if (c === undefined) return { invalid: `${unit} is not a length unit` };
    if (c.kind === 'refused') return refuse(`clip-path: ${generate(t)} is unsupported: ${c.reason}`);
    if (c.kind === 'viewport') return refuse(`clip-path: ${generate(t)} is unsupported: an inset edge in a viewport unit would need the device viewport on the native side`);
    return { ok: { value: Number(t['value']), unit } };
  }
  if (t.type === 'Function') return refuse(`clip-path: ${generate(t)} is unsupported: a calculation in an inset edge is not supported`);
  return { invalid: `${generate(t)} is not a length or percentage` };
}

const word = (t: CssNode | undefined): string | null => (t !== undefined && t.type === 'Identifier' ? asciiLower(String(t['name'])) : null);

/** ClipPath::ParseSingleValue for the values Dragon draws: none, or inset() with an optional border-box (the grammar has checked the shape). */
export function parseClipPath(tokens: readonly CssNode[], base: Span): ParsedValue {
  const first = tokens[0];
  if (tokens.length === 1 && word(first) === 'none') return { kind: 'ok', longhands: [{ property: 'clip-path', value: { kind: 'keyword', value: 'none' }, explicit: true }] };
  const refuse = (t: CssNode, why: string): ParsedValue => ({ kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `clip-path: ${generate(t)} is unsupported: ${why}`, manual: CLIP_PATH_FIX }) });
  const shapes = tokens.filter((t) => t.type === 'Function');
  const boxes = tokens.filter((t) => t.type === 'Identifier');
  const other = tokens.find((t) => t.type !== 'Function' && t.type !== 'Identifier');
  if (other !== undefined) return refuse(other, 'Dragon draws a clip path from inset() only, not a url() reference');
  const box = boxes.find((t) => word(t) !== 'border-box');
  if (box !== undefined) return refuse(box, 'Dragon clips to the border box only, the reference box clip-path takes by default');
  const shape = shapes[0];
  if (shape === undefined) return refuse(tokens[0] as CssNode, 'Dragon draws a clip path from inset() only, not from a reference box alone');
  if (shapes.length !== 1 || boxes.length > 1) return { kind: 'invalid', reason: 'clip-path takes one shape and one reference box at most' };
  if (asciiLower(String(shape['name'])) !== 'inset') return refuse(shape, 'Dragon draws a clip path from inset() only (MASK-CLIP)');
  const args = (shape['children'] as { toArray(): CssNode[] }).toArray().filter((c) => c.type !== 'WhiteSpace');
  const round = args.findIndex((c) => word(c) === 'round');
  if (round >= 0) return refuse(shape, 'Dragon draws an inset() clip with square corners only, without round');
  if (args.length < 1 || args.length > 4) return { kind: 'invalid', reason: 'inset() takes one to four edges' };
  const edges: InsetEdge[] = [];
  for (const a of args) {
    const r = insetEdge(a, base);
    if ('refused' in r) return r.refused;
    if ('invalid' in r) return { kind: 'invalid', reason: r.invalid };
    edges.push(r.ok);
  }
  const [t, r = t, b = t, l = r] = edges as [InsetEdge, InsetEdge?, InsetEdge?, InsetEdge?];
  return { kind: 'ok', longhands: [{ property: 'clip-path', value: insetValue([t, r, b, l] as unknown as InsetEdges), explicit: true }] };
}

/** The value parser of the clip-path family (the paint value hook, css/paint-parsers.ts). */
export const CLIP_PATH_VALUE_PARSERS: { readonly [P in (typeof CLIP_PATH_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'clip-path': parseClipPath,
};
