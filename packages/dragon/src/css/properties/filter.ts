// filter (filter-effects-1 §5): none | a filter function list, not inherited, initial none. Blink's Filter::ParseSingleValue
// (longhands_custom.cc) takes none or a list of filter functions and url()s; the grammar takes any value besides none
// (scripts/gen-css-grammar.ts), so Dragon never drops a declaration Chrome keeps and the cascade can never pick an earlier none where
// Chrome applies a filter. A list is kept as its text; colorMatrixFilters reads the lists Dragon draws (PNT1-filter): the
// colour-matrix functions alone, each amount as Chrome computes it, and computed-checks refuses every other list (checkFilter).
import type { CssNode } from 'css-tree';
import { generate, parse } from 'css-tree';
import type { Span } from '../../types.ts';
import { list } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

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

/** Whether a computed filter applies one (anything but none): the box is then a stacking context (filter-effects-1 §5). */
export function filterApplies(v: CssValue): boolean {
  return !(v.kind === 'keyword' && v.value === 'none');
}

/** The colour-matrix filter functions Dragon draws, in the order layout paint-group.ts codes them (the index is the code). */
export const COLOR_MATRIX_FILTERS = ['grayscale', 'sepia', 'saturate', 'invert', 'opacity', 'brightness', 'contrast'] as const;
export type ColorMatrixFilter = (typeof COLOR_MATRIX_FILTERS)[number];

/** One function of a colour-matrix filter list: its name and its computed amount. */
export type FilterFunction = { readonly name: ColorMatrixFilter; readonly amount: number };

/** The functions whose computed amount is clamped to 1 (Blink FilterOperationResolver::ResolveNumericArgumentForFunction). */
const CLAMPED: readonly string[] = ['grayscale', 'sepia', 'invert', 'opacity'];

/**
 * A computed filter value as Dragon draws it: none, a list of colour-matrix functions with their computed amounts, or why not. Blink
 * (third_party/blink/renderer/core/css/properties/css_parsing_utils.cc:776-844 ConsumeFilterFunction) takes an optional
 * non-negative number or percentage, clamps grayscale, sepia, invert and opacity to 1 (100%), and computes a percentage / 100 and
 * a missing amount as 1. hue-rotate() is refused: its matrix takes the platform's cosf and sinf, which Dragon does not reproduce.
 */
export function colorMatrixFilters(v: CssValue): { readonly kind: 'none' } | { readonly kind: 'list'; readonly functions: readonly FilterFunction[] } | { readonly kind: 'other'; readonly reason: string } {
  if (v.kind === 'keyword' && v.value === 'none') return { kind: 'none' };
  if (v.kind !== 'other' || v.type !== FILTER_LIST_TYPE) return { kind: 'other', reason: 'it is not a filter function list' };
  let failed = false;
  const ast = parse(v.text, { context: 'value', onParseError: () => { failed = true; } });
  if (failed) return { kind: 'other', reason: 'it does not parse as a filter function list' };
  const nodes = list(ast, 'children').filter((n) => n.type !== 'WhiteSpace');
  if (nodes.length === 0) return { kind: 'other', reason: 'it holds no filter function' };
  const functions: FilterFunction[] = [];
  for (const n of nodes) {
    if (n.type !== 'Function') return { kind: 'other', reason: `${generate(n)} is not a filter function` };
    const name = asciiLower(String(n['name']));
    if (name === 'hue-rotate') return { kind: 'other', reason: "hue-rotate() builds its matrix from the platform's cosf and sinf, which Dragon does not reproduce exactly" };
    const known = COLOR_MATRIX_FILTERS.find((f) => f === name);
    if (known === undefined) return { kind: 'other', reason: `${name}() is not one of them` };
    const args = list(n, 'children').filter((x) => x.type !== 'WhiteSpace');
    if (args.length > 1) return { kind: 'other', reason: `${generate(n)} has more than one argument` };
    const arg = args[0];
    let amount = 1;
    if (arg !== undefined) {
      if (arg.type !== 'Number' && arg.type !== 'Percentage') return { kind: 'other', reason: `${generate(n)} has an amount that is not a number or a percentage (a calculation is not supported)` };
      const x = Number(arg.value);
      if (!Number.isFinite(x) || x < 0) return { kind: 'other', reason: `${generate(n)} has an amount Chrome does not parse` };
      // An amount past float range makes cc's matrix infinite, which Skia drops (no filter at all).
      if (x > 1e38) return { kind: 'other', reason: `${generate(n)} has an amount past float range` };
      amount = arg.type === 'Percentage' ? x / 100 : x;
    }
    functions.push({ name: known, amount: CLAMPED.includes(known) && amount > 1 ? 1 : amount });
  }
  return { kind: 'list', functions };
}
