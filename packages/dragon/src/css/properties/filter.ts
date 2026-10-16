// filter (filter-effects-1 §5): none | a filter function list, not inherited, initial none. Only none is accepted: Dragon draws no
// filter yet (coverage-rank lane FX), so computed-checks refuses every function list on every target (checkFilter), since a filter
// such as opacity(0) or brightness(0) can hide text. Blink's Filter::ParseSingleValue (longhands_custom.cc) takes none or a list
// of filter functions and url()s; the grammar takes any value besides none (scripts/gen-css-grammar.ts), so Dragon never drops a
// declaration Chrome keeps and the cascade can never pick an earlier none where Chrome applies a filter.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const FILTER_LONGHANDS = ['filter'] as const;
export const FILTER_SHORTHANDS = [] as const;
export const FILTER_INHERITED: readonly (typeof FILTER_LONGHANDS)[number][] = [];
export const FILTER_CONTAINER: readonly (typeof FILTER_LONGHANDS)[number][] = [];
export const FILTER_TEXT_ROLE: readonly (typeof FILTER_LONGHANDS)[number][] = [];

export const FILTER_ASPECTS: { readonly [P in (typeof FILTER_LONGHANDS)[number]]: PropertyAspect } = {
  filter: { layout: false, paint: true },
};

/** The value type of a filter other than none (featureOf key filter:<filter-value-list>); computed-checks refuses it. */
export const FILTER_LIST_TYPE = 'filter-value-list';

/** none, in any ASCII case, or the written text of anything else, which analysis/computed-checks.ts refuses where it applies. */
export function parseFilter(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only !== undefined && only.type === 'Identifier' && asciiLower(String(only['name'])) === 'none') {
    return { kind: 'ok', longhands: [{ property: 'filter', value: { kind: 'keyword', value: 'none' }, explicit: true }] };
  }
  if (tokens.length === 0) return { kind: 'invalid', reason: 'filter takes none or a filter function list' };
  return { kind: 'ok', longhands: [{ property: 'filter', value: { kind: 'other', type: FILTER_LIST_TYPE, text: tokens.map((t) => generate(t)).join(' ') }, explicit: true }] };
}

/** The value parser of the filter family (the paint value hook, css/paint-parsers.ts). */
export const FILTER_VALUE_PARSERS: { readonly [P in (typeof FILTER_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  filter: parseFilter,
};
