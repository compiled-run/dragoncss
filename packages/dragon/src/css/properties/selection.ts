// user-select (css-ui-4 §6.1; T154): auto | text | none | all, inherited as Blink declares it, initial auto, computed as specified.
// Blink 145 css_properties.json5 lists contain too, but css_parser_fast_paths.cc parses it only under CSSUserSelectContain, a
// test-status feature, so the value parser drops it. No layout or paint aspect: on native only none compiles, since no native
// text is selectable until package P6c (T077) builds selection (analysis/selection.ts).
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const SELECTION_LONGHANDS = ['user-select'] as const;
export const SELECTION_SHORTHANDS = [] as const;
export const SELECTION_INHERITED: readonly (typeof SELECTION_LONGHANDS)[number][] = ['user-select'];
export const SELECTION_CONTAINER: readonly (typeof SELECTION_LONGHANDS)[number][] = [];
export const SELECTION_TEXT_ROLE: readonly (typeof SELECTION_LONGHANDS)[number][] = [];

export const SELECTION_ASPECTS: { readonly [P in (typeof SELECTION_LONGHANDS)[number]]: PropertyAspect } = {
  'user-select': { layout: false, paint: false },
};

export type UserSelectKeyword = 'auto' | 'text' | 'none' | 'all';

/** user-select as Chrome 145 parses it: one of four keywords, any ASCII case (contain is invalid there). */
export function parseUserSelect(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined || t.type !== 'Identifier') return { kind: 'invalid', reason: 'user-select is one keyword' };
  const k = asciiLower(String(t['name']));
  if (k !== 'auto' && k !== 'text' && k !== 'none' && k !== 'all') return { kind: 'invalid', reason: `Chrome 145 does not parse user-select: ${k}` };
  return { kind: 'ok', longhands: [{ property: 'user-select', value: { kind: 'keyword', value: k }, explicit: true }] };
}

/** The value parser of the selection family (the value hook, css/paint-parsers.ts). */
export const SELECTION_VALUE_PARSERS: { readonly [P in (typeof SELECTION_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'user-select': parseUserSelect,
};
