// css-anchor-position-1 (W3C WD 2026-09-06): anchor-name and anchor-scope (initial none), position-anchor (none in Chrome 145, where
// the spec says normal), position-area (none), position-try-fallbacks (none), position-try-order (normal) with the position-try
// shorthand, and position-visibility (anchors-visible, where webref says anchor-visible), none inherited (Chrome 145
// css_properties.json5). A value the grammar below reads is kept as its typed value (ANCHOR_VALUE_TYPES), which the anchored box's
// lowering reads (lower/anchor-layout.ts); any other value is kept as written and refused (analysis/scroll-containment.ts), so
// Dragon never drops a value Chrome keeps. position-visibility stays initial-only: Dragon hides no anchored box.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import type { Span } from '../../types.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { asciiLower } from '../escapes.ts';
import { initialOnlyLonghand, kwInitial, nonInitial } from './initial-only.ts';

export const ANCHOR_POSITION_LONGHANDS = ['anchor-name', 'anchor-scope', 'position-anchor', 'position-area', 'position-try-order', 'position-try-fallbacks', 'position-visibility'] as const;
export const ANCHOR_POSITION_SHORTHANDS = ['position-try'] as const;
export const ANCHOR_POSITION_INHERITED: readonly (typeof ANCHOR_POSITION_LONGHANDS)[number][] = [];
export const ANCHOR_POSITION_CONTAINER: readonly (typeof ANCHOR_POSITION_LONGHANDS)[number][] = [];
export const ANCHOR_POSITION_TEXT_ROLE: readonly (typeof ANCHOR_POSITION_LONGHANDS)[number][] = [];

type AnchorPositionLonghand = (typeof ANCHOR_POSITION_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const ANCHOR_POSITION_ASPECTS = Object.fromEntries(ANCHOR_POSITION_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in AnchorPositionLonghand]: PropertyAspect };

/** Each longhand's initial value. */
export const ANCHOR_POSITION_INITIAL: { readonly [P in AnchorPositionLonghand]: CssValue } = {
  'anchor-name': kwInitial('none'),
  'anchor-scope': kwInitial('none'),
  'position-anchor': kwInitial('none'),
  'position-area': kwInitial('none'),
  'position-try-order': kwInitial('normal'),
  'position-try-fallbacks': kwInitial('none'),
  'position-visibility': kwInitial('anchors-visible'),
};

/** The typed values this file writes, each { kind: 'other', type, text } with text in its canonical spelling. */
export const ANCHOR_VALUE_TYPES = {
  /** anchor-name and anchor-scope: <dashed-ident>#, written "--a, --b". */
  names: 'anchor-names',
  /** position-anchor: one <dashed-ident>. */
  name: 'anchor-name',
  /** position-area: one or two lowercase keywords of one grammar branch, space-separated. */
  area: 'position-area',
  /** position-try-fallbacks: its entries, comma-separated, each lowercase keywords or a <dashed-ident>. */
  fallbacks: 'position-try-fallbacks',
} as const;

/** Whether a value is one this file typed, which the lowering reads. */
export const isAnchorTyped = (v: CssValue): boolean => v.kind === 'other' && (Object.values(ANCHOR_VALUE_TYPES) as string[]).includes(v.type);

/** The <try-size> keywords that open a position-try value as its position-try-order (css-anchor-position-1 §6.2). */
const TRY_ORDERS: readonly string[] = ['normal', 'most-width', 'most-height', 'most-block-size', 'most-inline-size'];

const isDashed = (t: CssNode | undefined): boolean => t !== undefined && t.type === 'Identifier' && String(t['name']).startsWith('--') && String(t['name']).length > 2;
const keywordOf = (t: CssNode | undefined): string | null => (t !== undefined && t.type === 'Identifier' && !String(t['name']).startsWith('--') ? asciiLower(String(t['name'])) : null);
const isComma = (t: CssNode): boolean => t.type === 'Operator' && t['value'] === ',';

/** Splits tokens at top-level commas; null when an entry is empty. */
function commaList(tokens: readonly CssNode[]): CssNode[][] | null {
  const parts: CssNode[][] = [[]];
  for (const t of tokens) {
    if (isComma(t)) parts.push([]);
    else (parts[parts.length - 1] as CssNode[]).push(t);
  }
  return parts.every((p) => p.length > 0) ? parts : null;
}

/** <dashed-ident>#, each entry one name. */
function nameList(tokens: readonly CssNode[]): string | null {
  const parts = commaList(tokens);
  if (parts === null || !parts.every((p) => p.length === 1 && isDashed(p[0]))) return null;
  return parts.map((p) => generate(p[0] as CssNode)).join(', ');
}

const one = (property: AnchorPositionLonghand, value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property, value, explicit: true }] });
const typed = (type: string, text: string): CssValue => ({ kind: 'other', type, text });

function parseNames(property: 'anchor-name' | 'anchor-scope'): InitialOnlyParser {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${property} needs a value` };
    const k = tokens.length === 1 ? keywordOf(tokens[0]) : null;
    if (k === 'none') return one(property, ANCHOR_POSITION_INITIAL[property]);
    if (k === 'all' && property === 'anchor-scope') return one(property, kwInitial('all'));
    const names = nameList(tokens);
    return one(property, names === null ? nonInitial(tokens) : typed(ANCHOR_VALUE_TYPES.names, names));
  };
}

function parsePositionAnchor(tokens: readonly CssNode[]): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'position-anchor needs a value' };
  const k = tokens.length === 1 ? keywordOf(tokens[0]) : null;
  if (k === 'none') return one('position-anchor', ANCHOR_POSITION_INITIAL['position-anchor']);
  if (k === 'auto') return one('position-anchor', kwInitial('auto'));
  if (tokens.length === 1 && isDashed(tokens[0])) return one('position-anchor', typed(ANCHOR_VALUE_TYPES.name, generate(tokens[0] as CssNode)));
  return one('position-anchor', nonInitial(tokens));
}

/** §3.1.2: the keyword groups of <position-area>; center and span-all belong to every group. */
const AREA_GROUPS: readonly (readonly string[])[] = [
  ['left', 'right', 'span-left', 'span-right', 'x-start', 'x-end', 'span-x-start', 'span-x-end', 'self-x-start', 'self-x-end', 'span-self-x-start', 'span-self-x-end'],
  ['top', 'bottom', 'span-top', 'span-bottom', 'y-start', 'y-end', 'span-y-start', 'span-y-end', 'self-y-start', 'self-y-end', 'span-self-y-start', 'span-self-y-end'],
  ['block-start', 'block-end', 'span-block-start', 'span-block-end'],
  ['inline-start', 'inline-end', 'span-inline-start', 'span-inline-end'],
  ['self-block-start', 'self-block-end', 'span-self-block-start', 'span-self-block-end'],
  ['self-inline-start', 'self-inline-end', 'span-self-inline-start', 'span-self-inline-end'],
  ['start', 'end', 'span-start', 'span-end'],
  ['self-start', 'self-end', 'span-self-start', 'span-self-end'],
];
const SHARED = ['center', 'span-all'];
/** The grammar branches: pairs of groups whose keywords combine with || (or {1,2} within one group). */
const AREA_PAIRS: readonly (readonly [number, number])[] = [[0, 1], [2, 3], [4, 5], [6, 6], [7, 7]];

const inGroup = (k: string, g: number): boolean => SHARED.includes(k) || (AREA_GROUPS[g] as readonly string[]).includes(k);

/** Whether one or two keywords form a <position-area> (§3.1.2). */
export function isPositionArea(keywords: readonly string[]): boolean {
  if (keywords.length === 1) return AREA_GROUPS.some((_, g) => inGroup(keywords[0] as string, g));
  if (keywords.length !== 2) return false;
  const [a, b] = keywords as [string, string];
  return AREA_PAIRS.some(([g, h]) => (inGroup(a, g) && inGroup(b, h)) || (inGroup(a, h) && inGroup(b, g)));
}

/** The keywords of an area value, or null when a token is not a keyword. */
function areaKeywords(tokens: readonly CssNode[]): string[] | null {
  const out: string[] = [];
  for (const t of tokens) {
    const k = keywordOf(t);
    if (k === null) return null;
    out.push(k);
  }
  return out;
}

function parsePositionArea(tokens: readonly CssNode[]): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'position-area needs a value' };
  const ks = areaKeywords(tokens);
  if (ks !== null && ks.length === 1 && ks[0] === 'none') return one('position-area', ANCHOR_POSITION_INITIAL['position-area']);
  return one('position-area', ks !== null && isPositionArea(ks) ? typed(ANCHOR_VALUE_TYPES.area, ks.join(' ')) : nonInitial(tokens));
}

const TACTICS: readonly string[] = ['flip-block', 'flip-inline', 'flip-start', 'flip-x', 'flip-y'];

/** One position-try-fallbacks entry: [<dashed-ident> || <try-tactic>] | <position-area>, in canonical text, or null. */
function fallbackEntry(tokens: readonly CssNode[]): string | null {
  const ks = tokens.map(keywordOf);
  if (ks.every((k) => k !== null) && isPositionArea(ks as string[])) return (ks as string[]).join(' ');
  const names = tokens.filter(isDashed);
  const tactics = ks.filter((k): k is string => k !== null);
  if (names.length > 1 || names.length + tactics.length !== tokens.length || (tactics.length === 0 && names.length === 0)) return null;
  if (!tactics.every((t) => TACTICS.includes(t)) || new Set(tactics).size !== tactics.length) return null;
  return tokens.map((t) => (isDashed(t) ? generate(t) : keywordOf(t))).join(' ');
}

function fallbacksValue(tokens: readonly CssNode[]): CssValue {
  if (tokens.length === 1 && keywordOf(tokens[0]) === 'none') return ANCHOR_POSITION_INITIAL['position-try-fallbacks'];
  const parts = commaList(tokens);
  const entries = parts === null ? null : parts.map(fallbackEntry);
  return entries === null || entries.some((e) => e === null) ? nonInitial(tokens) : typed(ANCHOR_VALUE_TYPES.fallbacks, entries.join(', '));
}

function parseFallbacks(tokens: readonly CssNode[]): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'position-try-fallbacks needs a value' };
  return one('position-try-fallbacks', fallbacksValue(tokens));
}

function parseTryOrder(tokens: readonly CssNode[]): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'position-try-order needs a value' };
  const k = tokens.length === 1 ? keywordOf(tokens[0]) : null;
  if (k !== null && TRY_ORDERS.includes(k)) return one('position-try-order', kwInitial(k));
  return one('position-try-order', nonInitial(tokens));
}

/**
 * position-try: <'position-try-order'>? <'position-try-fallbacks'>. A leading try-order keyword is position-try-order and the rest
 * position-try-fallbacks; without one, the order is normal and the whole value is the fallbacks, as Chrome 145 expands it. A value
 * with no fallbacks (normal, most-width) is invalid, as Chrome 145 drops it.
 */
export function parsePositionTry(tokens: readonly CssNode[], _base: Span): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'position-try needs a value' };
  const first = tokens[0] as CssNode;
  const order = keywordOf(first);
  const ordered = order !== null && TRY_ORDERS.includes(order);
  const fallbacks = ordered ? tokens.slice(1) : tokens;
  if (fallbacks.length === 0) return { kind: 'invalid', reason: 'position-try needs its fallbacks after an order keyword' };
  const orderValue = ordered ? kwInitial(order as string) : ANCHOR_POSITION_INITIAL['position-try-order'];
  return {
    kind: 'ok',
    longhands: [
      { property: 'position-try-order', value: orderValue, explicit: true },
      { property: 'position-try-fallbacks', value: fallbacksValue(fallbacks), explicit: true },
    ],
  };
}

export const ANCHOR_POSITION_VALUE_PARSERS: { readonly [P in AnchorPositionLonghand | (typeof ANCHOR_POSITION_SHORTHANDS)[number]]: InitialOnlyParser } = {
  'anchor-name': parseNames('anchor-name'),
  'anchor-scope': parseNames('anchor-scope'),
  'position-anchor': parsePositionAnchor,
  'position-area': parsePositionArea,
  'position-try-order': parseTryOrder,
  'position-try-fallbacks': parseFallbacks,
  'position-visibility': initialOnlyLonghand('position-visibility', ANCHOR_POSITION_INITIAL['position-visibility']),
  'position-try': parsePositionTry,
};

/** Whether a computed value of the family is one Dragon lays out: initial, or a value this file typed (a keyword other than initial too). */
export function anchorValueAccepted(p: AnchorPositionLonghand, v: CssValue): boolean {
  if (p === 'position-visibility') return spellsInitialValue(v);
  return v.kind === 'keyword' || isAnchorTyped(v);
}

const spellsInitialValue = (v: CssValue): boolean => v.kind === 'keyword' && v.value === 'anchors-visible';
