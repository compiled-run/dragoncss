// css-anchor-position-1: anchor-name and anchor-scope (initial none), position-anchor (none in Chrome 145, where webref says
// normal), position-area (none), position-try-fallbacks (none), position-try-order (normal) with the position-try shorthand of
// -order and -fallbacks, and position-visibility (anchors-visible, where webref says anchor-visible), none inherited (Chrome 145
// css_properties.json5). Dragon positions no box against an anchor yet: a name only names an anchor, and the others move or hide an
// absolutely positioned box only when it has an anchor or a position area. So it accepts the initial values alone, where no box is
// anchored, and refuses every other value (analysis/scroll-containment.ts). Rows are proven by the computed value, as no layout lane
// reads them.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { asciiLower } from '../escapes.ts';
import { initialOnlyLonghand, kwInitial, nonInitial, spellsInitial } from './initial-only.ts';

export const ANCHOR_POSITION_LONGHANDS = ['anchor-name', 'anchor-scope', 'position-anchor', 'position-area', 'position-try-order', 'position-try-fallbacks', 'position-visibility'] as const;
export const ANCHOR_POSITION_SHORTHANDS = ['position-try'] as const;
export const ANCHOR_POSITION_INHERITED: readonly (typeof ANCHOR_POSITION_LONGHANDS)[number][] = [];
export const ANCHOR_POSITION_CONTAINER: readonly (typeof ANCHOR_POSITION_LONGHANDS)[number][] = [];
export const ANCHOR_POSITION_TEXT_ROLE: readonly (typeof ANCHOR_POSITION_LONGHANDS)[number][] = [];

type AnchorPositionLonghand = (typeof ANCHOR_POSITION_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const ANCHOR_POSITION_ASPECTS = Object.fromEntries(ANCHOR_POSITION_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in AnchorPositionLonghand]: PropertyAspect };

/** Each longhand's initial value, the only one Dragon accepts. */
export const ANCHOR_POSITION_INITIAL: { readonly [P in AnchorPositionLonghand]: CssValue } = {
  'anchor-name': kwInitial('none'),
  'anchor-scope': kwInitial('none'),
  'position-anchor': kwInitial('none'),
  'position-area': kwInitial('none'),
  'position-try-order': kwInitial('normal'),
  'position-try-fallbacks': kwInitial('none'),
  'position-visibility': kwInitial('anchors-visible'),
};

/** The <try-size> keywords that open a position-try value as its position-try-order (css-anchor-position-1 §5.3). */
const TRY_ORDERS: readonly string[] = ['normal', 'most-width', 'most-height', 'most-block-size', 'most-inline-size'];

/**
 * position-try: <'position-try-order'>? <'position-try-fallbacks'>. A leading try-order keyword is position-try-order and the rest
 * position-try-fallbacks; without one, the order is normal and the whole value is the fallbacks, as Chrome 145 expands it. Each
 * longhand takes its initial value when its part spells it, and keeps its part as written otherwise. A value with no fallbacks
 * (normal, most-width) is invalid, as Chrome 145 drops it.
 */
export function parsePositionTry(tokens: readonly CssNode[], _base: Span): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'position-try needs a value' };
  const first = tokens[0] as CssNode;
  const ordered = first.type === 'Identifier' && TRY_ORDERS.includes(asciiLower(String(first['name'])));
  const order = ordered ? [first] : [];
  const fallbacks = ordered ? tokens.slice(1) : tokens;
  const part = (p: 'position-try-order' | 'position-try-fallbacks', ts: readonly CssNode[]): CssValue => {
    if (ts.length === 0 && p === 'position-try-order') return ANCHOR_POSITION_INITIAL[p];
    return ts.length === 1 && spellsInitial(ANCHOR_POSITION_INITIAL[p], ts[0]) ? ANCHOR_POSITION_INITIAL[p] : nonInitial(ts);
  };
  // [<position-try-order>]? <position-try-fallbacks>: an order alone (normal, most-width) has no fallbacks, and Chrome 145 drops it.
  if (fallbacks.length === 0) return { kind: 'invalid', reason: 'position-try needs its fallbacks after an order keyword' };
  const values = [part('position-try-order', order), part('position-try-fallbacks', fallbacks)];
  return {
    kind: 'ok',
    longhands: (['position-try-order', 'position-try-fallbacks'] as const).map((p, i) => ({ property: p, value: values[i] as CssValue, explicit: true })),
  };
}

export const ANCHOR_POSITION_VALUE_PARSERS: { readonly [P in AnchorPositionLonghand | (typeof ANCHOR_POSITION_SHORTHANDS)[number]]: InitialOnlyParser } = {
  ...(Object.fromEntries(ANCHOR_POSITION_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, ANCHOR_POSITION_INITIAL[p])])) as { readonly [P in AnchorPositionLonghand]: InitialOnlyParser }),
  'position-try': parsePositionTry,
};
