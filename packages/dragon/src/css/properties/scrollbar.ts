// The scrollbar longhands (css-scrollbars-1 §3, css-overflow-4 §3.2): scrollbar-width (auto | thin | none, initial auto) and
// scrollbar-gutter (auto | stable && both-edges?, initial auto), neither inherited, each computed as specified. Every value is
// accepted on every target under the overlay-scrollbar rule (docs/decisions.md; notes/T078-ovfl-spec.md R1): overlay scrollbars and
// the iOS and Android scroll indicators take no layout space, so neither property moves a box, and at rest no scrollbar is drawn.
// On native, scrollbar-width: none hides a scroll container's indicators while it scrolls (lower/paint/scroll.ts); thin and auto
// keep them, since the platform indicator is already thin. scrollbar-color and ::-webkit-scrollbar rules are not part of this family.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const SCROLLBAR_LONGHANDS = ['scrollbar-width', 'scrollbar-gutter'] as const;
export const SCROLLBAR_SHORTHANDS = [] as const;
export const SCROLLBAR_INHERITED: readonly (typeof SCROLLBAR_LONGHANDS)[number][] = [];
export const SCROLLBAR_CONTAINER: readonly (typeof SCROLLBAR_LONGHANDS)[number][] = [];
export const SCROLLBAR_TEXT_ROLE: readonly (typeof SCROLLBAR_LONGHANDS)[number][] = [];

// Layout aspect: classic scrollbars would reserve a gutter for both, which the overlay reference proves absent (PROFILE_NOTES).
export const SCROLLBAR_ASPECTS: { readonly [P in (typeof SCROLLBAR_LONGHANDS)[number]]: PropertyAspect } = {
  'scrollbar-width': { layout: true, paint: false },
  'scrollbar-gutter': { layout: true, paint: false },
};

/** scrollbar-gutter as Chrome 145 parses it, any ASCII case: auto, stable, or stable and both-edges in either order, kept as stable both-edges. */
export function parseScrollbarGutter(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const words: string[] = [];
  for (const t of tokens) {
    if (t.type !== 'Identifier') return { kind: 'invalid', reason: 'scrollbar-gutter takes keywords only' };
    words.push(asciiLower(String(t['name'])));
  }
  const keyword = (value: string): ParsedValue => ({ kind: 'ok', longhands: [{ property: 'scrollbar-gutter', value: { kind: 'keyword', value }, explicit: true }] });
  const key = [...words].sort().join(' ');
  if (key === 'auto' || key === 'stable') return keyword(key);
  if (key === 'both-edges stable') return keyword('stable both-edges');
  return { kind: 'invalid', reason: `Chrome 145 does not parse scrollbar-gutter: ${words.join(' ')}` };
}

/** The value parsers of the scrollbar family (the value hook, css/paint-parsers.ts); scrollbar-width is one keyword of the grammar. */
export const SCROLLBAR_VALUE_PARSERS: { readonly [P in 'scrollbar-gutter']: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'scrollbar-gutter': parseScrollbarGutter,
};
