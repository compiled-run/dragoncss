// FX: backdrop-filter (filter-effects-2 §3) and mix-blend-mode (compositing-1 §3.2), neither inherited. backdrop-filter is none or a
// filter function list, initial none; Blink's BackdropFilter::ParseSingleValue is ConsumeFilterFunctionList, filter's parser
// (longhands_custom.cc), whose grammar scripts/gen-css-grammar.ts writes out (no -webkit- alias in Chrome 145). mix-blend-mode is one
// of Chrome 145's seventeen keywords (webref's <blend-mode> | plus-lighter), initial normal. Both are emitted on web as computed;
// analysis/fx.ts admits on native only the values Chrome draws with no pixel changed and refuses the rest there. Any value other
// than none or normal makes a stacking context, and a backdrop-filter also a containing block (lower/paint/stacking.ts).
import type { CssNode, List } from 'css-tree';
import { generate, parse } from 'css-tree';
import type { CssValue } from '../values.ts';
import type { PropertyAspect } from '../properties.ts';
import type { Span } from '../../types.ts';
import type { ParsedValue } from '../stylesheet.ts';
import { asciiLower } from '../escapes.ts';
import { FILTER_LIST_TYPE } from './filter.ts';
import { cssNumberText } from './transform.ts';

export const FX_LONGHANDS = ['backdrop-filter', 'mix-blend-mode'] as const;
export const FX_SHORTHANDS = [] as const;
export const FX_INHERITED: readonly (typeof FX_LONGHANDS)[number][] = [];
export const FX_CONTAINER: readonly (typeof FX_LONGHANDS)[number][] = [];
export const FX_TEXT_ROLE: readonly (typeof FX_LONGHANDS)[number][] = [];

export const FX_ASPECTS: { readonly [P in (typeof FX_LONGHANDS)[number]]: PropertyAspect } = {
  'backdrop-filter': { layout: false, paint: true },
  'mix-blend-mode': { layout: false, paint: true },
};

/** none, or the written list (the grammar has checked it is Chrome's), as a filter-value-list. */
export function parseBackdropFilter(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only !== undefined && only.type === 'Identifier' && asciiLower(String(only['name'])) === 'none') {
    return { kind: 'ok', longhands: [{ property: 'backdrop-filter', value: { kind: 'keyword', value: 'none' }, explicit: true }] };
  }
  if (tokens.length === 0) return { kind: 'invalid', reason: 'backdrop-filter takes none or a filter function list' };
  return { kind: 'ok', longhands: [{ property: 'backdrop-filter', value: { kind: 'other', type: FILTER_LIST_TYPE, text: tokens.map((t) => generate(t)).join(' ') }, explicit: true }] };
}

export const FX_VALUE_PARSERS = { 'backdrop-filter': parseBackdropFilter } as const;

/** Whether a computed backdrop-filter is other than none (a stacking context and a containing block). */
export const hasBackdropFilter = (v: CssValue | undefined): boolean => v !== undefined && !(v.kind === 'keyword' && v.value === 'none');

/** A computed mix-blend-mode keyword ('normal' when absent). */
export const blendModeOf = (v: CssValue | undefined): string => (v !== undefined && v.kind === 'keyword' ? v.value : 'normal');

/** The top-level function names of a computed filter list, ASCII lower case, with a url() as 'url'. */
export function filterFunctionNames(text: string): string[] {
  const value = parse(text, { context: 'value' });
  const children = (value['children'] as List<CssNode>).toArray().filter((n) => n.type !== 'WhiteSpace');
  return children.map((n) => (n.type === 'Function' ? asciiLower(String(n['name'])) : n.type === 'Url' ? 'url' : `<${n.type}>`));
}

/**
 * A filter list with its em and rem lengths in px, as Chrome computes it (an inherited list keeps the parent's px); a list is left
 * as written where a base is unknown (the font-size pre-pass). Other units compute alike wherever the web output emits them.
 */
export function computedFilterText(text: string, em: number | null, rem: number | null): string {
  const value = parse(text, { context: 'value' });
  let changed = false;
  const visit = (n: CssNode): void => {
    if (n.type === 'Dimension') {
      const unit = asciiLower(String(n['unit']));
      const base = unit === 'em' ? em : unit === 'rem' ? rem : undefined;
      if (base === undefined || base === null) return;
      const mutable = n as unknown as { value: string; unit: string };
      mutable.value = cssNumberText(Number(n['value']) * base);
      mutable.unit = 'px';
      changed = true;
      return;
    }
    const children = n['children'] as List<CssNode> | null | undefined;
    if (children !== null && children !== undefined) for (const c of children.toArray()) visit(c);
  };
  visit(value);
  return changed ? generate(value) : text;
}
