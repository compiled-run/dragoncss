// css-multicol-1 §3, §4, §6, §7: column-width (initial auto), column-count (auto), the column rule longhands column-rule-width
// (medium), column-rule-style (none) and column-rule-color (currentcolor), column-span (none) and column-fill (balance), none
// inherited, with the columns shorthand of column-width and column-count and the column-rule shorthand of the rule longhands
// (Chrome 145 css_properties.json5). column-gap is the flex family's, which lays it out between flex and grid tracks. Chrome's
// columns also lists column-height and column-wrap, behind MulticolColumnWrapping, which is off: columns: auto / auto is invalid
// in Chrome (probed). Dragon builds no multi-column container yet, so it accepts the initial values alone, where Chrome makes no
// box a multi-column container, spans nothing and draws no rule, and refuses every other value (analysis/multicol.ts). Rows are
// proven by the computed value, as no layout lane reads them. column-rule-width computes to 0px under column-rule-style none,
// so the initial value is checked as the keyword medium the cascade gives, never as a length.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, initialOnlyShorthand, kwInitial, nonInitial, spellsInitial } from './initial-only.ts';

export const MULTICOL_LONGHANDS = ['column-width', 'column-count', 'column-rule-width', 'column-rule-style', 'column-rule-color', 'column-span', 'column-fill'] as const;
export const MULTICOL_SHORTHANDS = ['columns', 'column-rule'] as const;
export const MULTICOL_INHERITED: readonly (typeof MULTICOL_LONGHANDS)[number][] = [];
export const MULTICOL_CONTAINER: readonly (typeof MULTICOL_LONGHANDS)[number][] = [];
export const MULTICOL_TEXT_ROLE: readonly (typeof MULTICOL_LONGHANDS)[number][] = [];

type MulticolLonghand = (typeof MULTICOL_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const MULTICOL_ASPECTS = Object.fromEntries(MULTICOL_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in MulticolLonghand]: PropertyAspect };

/** Each longhand's initial value, the only one Dragon accepts. */
export const MULTICOL_INITIAL: { readonly [P in MulticolLonghand]: CssValue } = {
  'column-width': kwInitial('auto'),
  'column-count': kwInitial('auto'),
  'column-rule-width': kwInitial('medium'),
  'column-rule-style': kwInitial('none'),
  'column-rule-color': kwInitial('currentcolor'),
  'column-span': kwInitial('none'),
  'column-fill': kwInitial('balance'),
};

/** Each shorthand's longhands, in Chrome 145's order (columns without column-height and column-wrap, which are off). */
export const MULTICOL_SHORTHAND_LONGHANDS = {
  columns: ['column-width', 'column-count'],
  'column-rule': ['column-rule-width', 'column-rule-style', 'column-rule-color'],
} as const satisfies { readonly [S in (typeof MULTICOL_SHORTHANDS)[number]]: readonly MulticolLonghand[] };
const COLUMN_RULE_LONGHANDS = MULTICOL_SHORTHAND_LONGHANDS['column-rule'];

/**
 * column-rule: one to three of medium, none and currentcolor, each at most once and in any order, sets the three rule longhands to
 * their initial values (Chrome 145 serializes each such value as medium). Any other value, a repeated keyword included (which
 * Chrome drops), is kept on all three and refused.
 */
export function parseColumnRule(tokens: readonly CssNode[], _base: Span): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'column-rule needs a value' };
  const used = new Set<MulticolLonghand>();
  const initial = tokens.length <= COLUMN_RULE_LONGHANDS.length && tokens.every((t) => {
    const p = COLUMN_RULE_LONGHANDS.find((q) => !used.has(q) && spellsInitial(MULTICOL_INITIAL[q], t));
    if (p === undefined) return false;
    used.add(p);
    return true;
  });
  return { kind: 'ok', longhands: COLUMN_RULE_LONGHANDS.map((p) => ({ property: p, value: initial ? MULTICOL_INITIAL[p] : nonInitial(tokens), explicit: true })) };
}

export const MULTICOL_VALUE_PARSERS: { readonly [P in MulticolLonghand | (typeof MULTICOL_SHORTHANDS)[number]]: InitialOnlyParser } = {
  ...(Object.fromEntries(MULTICOL_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, MULTICOL_INITIAL[p])])) as { readonly [P in MulticolLonghand]: InitialOnlyParser }),
  // columns: auto or auto auto (column-width and column-count both auto); Chrome drops a third value and a / column-height.
  columns: initialOnlyShorthand('columns', MULTICOL_SHORTHAND_LONGHANDS.columns, kwInitial('auto'), 2),
  'column-rule': parseColumnRule,
};
