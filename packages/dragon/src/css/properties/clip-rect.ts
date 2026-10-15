// clip (css-masking-1 §5.1, CSS2 §11.1.2): auto | rect(<top>, <right>, <bottom>, <left>), each edge a <length> or auto, the
// edges separated by commas or by whitespace alone. Chrome 145 parses both forms (longhands_custom.cc Clip::ParseSingleValue),
// computes each length to px, and serializes rect(t, r, b, l) with commas and auto edges kept (Clip::CSSValueFromComputedStyleInternal).
// A calculation and a unit with no build-time px value are refused, as for border radii.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { CANONICAL_LENGTH_UNIT, normalizeUnit, unitEntry } from '../units.ts';
import type { CssValue } from '../values.ts';
import { componentText } from './radius.ts';

export const CLIP_RECT_LONGHANDS = ['clip'] as const;
export const CLIP_RECT_SHORTHANDS = [] as const;
export const CLIP_RECT_INHERITED: readonly (typeof CLIP_RECT_LONGHANDS)[number][] = [];
export const CLIP_RECT_CONTAINER: readonly (typeof CLIP_RECT_LONGHANDS)[number][] = [];
export const CLIP_RECT_TEXT_ROLE: readonly (typeof CLIP_RECT_LONGHANDS)[number][] = [];

export const CLIP_RECT_ASPECTS: { readonly [P in (typeof CLIP_RECT_LONGHANDS)[number]]: PropertyAspect } = {
  clip: { layout: false, paint: true },
};

/** The CssValue type of a rect() clip; its text is rect(t, r, b, l), each edge a length with its unit or auto. */
export const CLIP_RECT = 'clip-rect';

/** One edge of a rect() clip: a length in a unit with a build-time px value, or auto (null). */
export type ClipEdge = { readonly value: number; readonly unit: string } | null;

/** The four edges of a rect() clip in top, right, bottom, left order. */
export type ClipEdges = readonly [ClipEdge, ClipEdge, ClipEdge, ClipEdge];

const CLIP_FIX = 'Write each clip edge as px, em, rem, an absolute length or auto.';

const edgeText = (e: ClipEdge): string => (e === null ? 'auto' : componentText({ kind: 'length', value: e.value, unit: e.unit }));

/** The CssValue of a rect() clip from its edges. */
export function clipRectValue(edges: ClipEdges): CssValue {
  return { kind: 'other', type: CLIP_RECT, text: `rect(${edges.map(edgeText).join(', ')})` };
}

/** The edges of a rect() clip value; null for auto; throws on any other value. */
export function clipEdgesOf(v: CssValue): ClipEdges | null {
  if (v.kind === 'keyword' && v.value === 'auto') return null;
  if (v.kind !== 'other' || v.type !== CLIP_RECT) throw new Error(`clip ${JSON.stringify(v)} is not auto or rect()`);
  const m = /^rect\((.*)\)$/.exec(v.text);
  const parts = m === null ? [] : (m[1] as string).split(', ');
  if (parts.length !== 4) throw new Error(`clip ${JSON.stringify(v.text)} is not four edges`);
  return parts.map((p): ClipEdge => {
    if (p === 'auto') return null;
    const e = /^(-?(?:\d+\.?\d*|\.\d+))([a-z]+)$/.exec(p);
    if (e === null) throw new Error(`clip edge ${JSON.stringify(p)} is not a length or auto`);
    return { value: Number(e[1]), unit: e[2] as string };
  }) as unknown as ClipEdges;
}

/**
 * Whether a computed rect() clip (edges in px) clips everything whatever the box's size: CSS2 §11.1.2 takes each edge as an offset
 * from the border box's top-left, an auto edge as the border edge, so the width is right - left (right alone when left is auto),
 * and the same for the height; a rect with no width or height clips all (pinned against Chrome by the clip-rect fixtures).
 * Null when that depends on the box's size (an auto right or bottom edge against a set left or top).
 */
export function clipsEverything(edges: ClipEdges): boolean | null {
  const [top, right, bottom, left] = edges.map((e) => {
    if (e !== null && e.unit !== 'px') throw new Error(`clip edge ${e.value}${e.unit} is not computed to px`);
    return e === null ? null : e.value;
  }) as [number | null, number | null, number | null, number | null];
  const empty = (start: number | null, end: number | null): boolean | null => (end === null ? null : end <= (start ?? 0));
  const x = empty(left, right);
  const y = empty(top, bottom);
  if (x === true || y === true) return true;
  return x === null || y === null ? null : false;
}

/** The computed rect() edges of an element whose clip applies (an absolutely or fixed positioned box), or null. */
export function appliedClipEdges(el: Pick<ResolvedElement, 'props' | 'element'>): ClipEdges | null {
  const v = el.props.get('clip');
  if (v === undefined) throw new Error(`${el.element.address}: clip did not resolve`);
  const edges = clipEdgesOf(v.value);
  if (edges === null) return null;
  const p = el.props.get('position')?.value;
  const position = p !== undefined && p.kind === 'keyword' ? p.value : '';
  return position === 'absolute' || position === 'fixed' ? edges : null;
}

/** Whether an element's clip applies and hides it whole (an empty rect at any box size); null when it applies and does not. */
export function clipHidesBox(el: Pick<ResolvedElement, 'props' | 'element'>): boolean | null {
  const edges = appliedClipEdges(el);
  if (edges === null) return false;
  if (edges.some((e) => e !== null && e.unit !== CANONICAL_LENGTH_UNIT)) return null;
  return clipsEverything(edges) === true ? true : null;
}

type EdgeResult = { readonly ok: ClipEdge } | { readonly refused: ParsedValue } | { readonly invalid: string };

function clipEdge(t: CssNode, base: Span): EdgeResult {
  const refuse = (message: string): EdgeResult => ({ refused: { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message, manual: CLIP_FIX }) } });
  if (t.type === 'Identifier') return asciiLower(String(t['name'])) === 'auto' ? { ok: null } : { invalid: `${generate(t)} is not a length or auto` };
  if (t.type === 'Number') return Number(t['value']) === 0 ? { ok: { value: 0, unit: 'px' } } : { invalid: 'a clip edge other than 0 needs a unit' };
  if (t.type === 'Dimension') {
    const unit = normalizeUnit(String(t['unit']));
    const c = unitEntry(unit)?.conversion;
    if (c === undefined) return { invalid: `${unit} is not a length unit` };
    if (c.kind === 'refused') return refuse(`clip: ${generate(t)} is unsupported: ${c.reason}`);
    if (c.kind === 'viewport') return refuse(`clip: ${generate(t)} is unsupported: a clip edge in a viewport unit would need the device viewport on the native side`);
    return { ok: { value: Number(t['value']), unit } };
  }
  if (t.type === 'Function') return refuse(`clip: ${generate(t)} is unsupported: a calculation in a clip edge is not supported`);
  return { invalid: `${generate(t)} is not a length or auto` };
}

/** Clip::ParseSingleValue: auto, or rect() with four edges, all separated by commas or none (the grammar has checked the shape). */
export function parseClip(tokens: readonly CssNode[], base: Span): ParsedValue {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined) return { kind: 'invalid', reason: 'clip is auto or one rect()' };
  if (t.type === 'Identifier' && asciiLower(String(t['name'])) === 'auto') return { kind: 'ok', longhands: [{ property: 'clip', value: { kind: 'keyword', value: 'auto' }, explicit: true }] };
  if (t.type !== 'Function' || asciiLower(String(t['name'])) !== 'rect') return { kind: 'invalid', reason: 'clip is auto or rect()' };
  const all = (t['children'] as { toArray(): CssNode[] }).toArray().filter((c) => c.type !== 'WhiteSpace');
  const commas = all.filter((c) => c.type === 'Operator' && String(c['value']) === ',').length;
  const args = all.filter((c) => !(c.type === 'Operator' && String(c['value']) === ','));
  if (args.length !== 4 || (commas !== 0 && commas !== 3)) return { kind: 'invalid', reason: 'rect() takes four edges, separated by commas or by whitespace alone' };
  if (commas === 3 && all.some((c, i) => (i % 2 === 1) !== (c.type === 'Operator'))) return { kind: 'invalid', reason: 'rect() separates every edge with a comma or none' };
  const edges: ClipEdge[] = [];
  for (const a of args) {
    const r = clipEdge(a, base);
    if ('refused' in r) return r.refused;
    if ('invalid' in r) return { kind: 'invalid', reason: r.invalid };
    edges.push(r.ok);
  }
  return { kind: 'ok', longhands: [{ property: 'clip', value: clipRectValue(edges as unknown as ClipEdges), explicit: true }] };
}

/** The value parser of the clip family (the paint value hook, css/paint-parsers.ts). */
export const CLIP_RECT_VALUE_PARSERS: { readonly [P in (typeof CLIP_RECT_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  clip: parseClip,
};
