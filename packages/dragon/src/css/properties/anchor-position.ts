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

/**
 * position-try: <'position-try-order'>? <'position-try-fallbacks'>. none, or normal none, sets both longhands to their initial
 * values; any other value is kept on both and refused.
 */
export function parsePositionTry(tokens: readonly CssNode[], _base: Span): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'position-try needs a value' };
  const fallbacks = ANCHOR_POSITION_INITIAL['position-try-fallbacks'];
  const initial = (tokens.length === 1 && spellsInitial(fallbacks, tokens[0])) || (tokens.length === 2 && spellsInitial(ANCHOR_POSITION_INITIAL['position-try-order'], tokens[0]) && spellsInitial(fallbacks, tokens[1]));
  return {
    kind: 'ok',
    longhands: (['position-try-order', 'position-try-fallbacks'] as const).map((p) => ({ property: p, value: initial ? ANCHOR_POSITION_INITIAL[p] : nonInitial(tokens), explicit: true })),
  };
}

export const ANCHOR_POSITION_VALUE_PARSERS: { readonly [P in AnchorPositionLonghand | (typeof ANCHOR_POSITION_SHORTHANDS)[number]]: InitialOnlyParser } = {
  ...(Object.fromEntries(ANCHOR_POSITION_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, ANCHOR_POSITION_INITIAL[p])])) as { readonly [P in AnchorPositionLonghand]: InitialOnlyParser }),
  'position-try': parsePositionTry,
};
