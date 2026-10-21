// css-multicol-1 §3, §4, §6, §7: column-width (initial auto), column-count (auto), the column rule longhands column-rule-width
// (medium), column-rule-style (none) and column-rule-color (currentcolor), column-span (none) and column-fill (balance), none
// inherited, with the columns shorthand of column-width and column-count and the column-rule shorthand of the rule longhands
// (Chrome 145 css_properties.json5). column-gap is the flex family's, which lays it out between flex and grid tracks too. Chrome's
// columns also lists column-height and column-wrap, behind MulticolColumnWrapping, which is off: columns: auto / auto is invalid
// in Chrome (probed). Dragon builds a multi-column container of balanced columns (LayoutStyle.multicol): column-width as a px
// length and column-count as a positive integer are parsed to their computed values, and analysis/multicol.ts accepts them where
// the engine lays the container out and refuses them elsewhere. Every other column-width and column-count spelling, and every
// rule, span and fill value but the initial one, is kept as written and refused (analysis/multicol.ts). column-rule-width
// computes to 0px under column-rule-style none, so the initial value is checked as the keyword medium the cascade gives, never as
// a length.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, kwInitial, nonInitial, spellsInitial } from './initial-only.ts';
import { asciiLower } from '../escapes.ts';

export const MULTICOL_LONGHANDS = ['column-width', 'column-count', 'column-rule-width', 'column-rule-style', 'column-rule-color', 'column-span', 'column-fill'] as const;
export const MULTICOL_SHORTHANDS = ['columns', 'column-rule'] as const;
export const MULTICOL_INHERITED: readonly (typeof MULTICOL_LONGHANDS)[number][] = [];
/** column-width and column-count lay out the element's own contents, as a flex container's longhands do. */
export const MULTICOL_CONTAINER: readonly (typeof MULTICOL_LONGHANDS)[number][] = ['column-width', 'column-count'];
export const MULTICOL_TEXT_ROLE: readonly (typeof MULTICOL_LONGHANDS)[number][] = [];

type MulticolLonghand = (typeof MULTICOL_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
const LAYOUT: PropertyAspect = { layout: true, paint: false };
/** column-width and column-count lay out (fixture group multicol); the rule, span and fill longhands stay at their initial values. */
export const MULTICOL_ASPECTS = Object.fromEntries(MULTICOL_LONGHANDS.map((p) => [p, p === 'column-width' || p === 'column-count' ? LAYOUT : PAINT_ONLY])) as { readonly [P in MulticolLonghand]: PropertyAspect };

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

/** One token as column-width: auto, or a px length of at least 0 (a unitless 0 is 0px); null for any other spelling. */
function columnWidthOf(t: CssNode | undefined): CssValue | null {
  if (t === undefined) return null;
  if (t.type === 'Identifier' && asciiLower(String(t['name'])) === 'auto') return kwInitial('auto');
  if (t.type === 'Number' && Number(t['value']) === 0) return { kind: 'length', value: 0, unit: 'px' };
  if (t.type !== 'Dimension' || asciiLower(String(t['unit'])) !== 'px') return null;
  const v = Number(t['value']);
  return Number.isFinite(v) && v >= 0 ? { kind: 'length', value: v, unit: 'px' } : null;
}

/** One token as column-count: auto, or an integer of at least 1 (Blink ConsumePositiveInteger); null for any other spelling. */
function columnCountOf(t: CssNode | undefined): CssValue | null {
  if (t === undefined) return null;
  if (t.type === 'Identifier' && asciiLower(String(t['name'])) === 'auto') return kwInitial('auto');
  if (t.type !== 'Number' || !/^[+]?[0-9]+$/.test(String(t['value']))) return null;
  const v = Number(t['value']);
  return Number.isSafeInteger(v) && v >= 1 ? { kind: 'number', value: v } : null;
}

/** column-width or column-count: a value it reads, else the value kept as written (refused by analysis/multicol.ts). */
function columnLonghand(property: 'column-width' | 'column-count', of: (t: CssNode | undefined) => CssValue | null): InitialOnlyParser {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${property} needs a value` };
    const v = tokens.length === 1 ? of(tokens[0]) : null;
    return { kind: 'ok', longhands: [{ property, value: v ?? nonInitial(tokens), explicit: true }] };
  };
}

/**
 * columns (Blink Columns::ParseShorthand): one or two values, each auto (which sets nothing), else column-width while it is open,
 * else column-count while it is open; an omitted longhand is auto. A value it does not read is kept on both, as written.
 */
export function parseColumns(tokens: readonly CssNode[], _base: Span): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'columns needs a value' };
  let width: CssValue | null = null;
  let count: CssValue | null = null;
  let ok = tokens.length <= 2;
  for (const t of tokens) {
    if (t.type === 'Identifier' && asciiLower(String(t['name'])) === 'auto') continue;
    const w: CssValue | null = width === null ? columnWidthOf(t) : null;
    const c: CssValue | null = w === null && count === null ? columnCountOf(t) : null;
    if (w !== null) width = w;
    else if (c !== null) count = c;
    else ok = false;
  }
  if (!ok) return { kind: 'ok', longhands: MULTICOL_SHORTHAND_LONGHANDS.columns.map((p) => ({ property: p, value: nonInitial(tokens), explicit: true })) };
  return { kind: 'ok', longhands: [{ property: 'column-width', value: width ?? kwInitial('auto'), explicit: true }, { property: 'column-count', value: count ?? kwInitial('auto'), explicit: true }] };
}

export const MULTICOL_VALUE_PARSERS: { readonly [P in MulticolLonghand | (typeof MULTICOL_SHORTHANDS)[number]]: InitialOnlyParser } = {
  ...(Object.fromEntries(MULTICOL_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, MULTICOL_INITIAL[p])])) as { readonly [P in MulticolLonghand]: InitialOnlyParser }),
  'column-width': columnLonghand('column-width', columnWidthOf),
  'column-count': columnLonghand('column-count', columnCountOf),
  // columns: column-width and column-count in either order; Chrome drops a third value and a / column-height.
  columns: parseColumns,
  'column-rule': parseColumnRule,
};
