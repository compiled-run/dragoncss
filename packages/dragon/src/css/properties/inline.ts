// Inline-level alignment (CSS2 §10.8.1): vertical-align, a longhand that is not inherited and applies to inline-level boxes (inline
// boxes and atomic inlines), keyed in the context the box takes part in (an item property). INL2b lays out every CSS2 value;
// -webkit-baseline-middle, which Chrome 145 also parses (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES), has no proof.
import type { PropertyAspect } from '../properties.ts';

export const INLINE_LONGHANDS = ['vertical-align'] as const;
export const INLINE_SHORTHANDS = [] as const;
export const INLINE_INHERITED: readonly (typeof INLINE_LONGHANDS)[number][] = [];
export const INLINE_CONTAINER: readonly (typeof INLINE_LONGHANDS)[number][] = [];
export const INLINE_TEXT_ROLE: readonly (typeof INLINE_LONGHANDS)[number][] = [];

export const INLINE_ASPECTS: { readonly [P in (typeof INLINE_LONGHANDS)[number]]: PropertyAspect } = {
  'vertical-align': { layout: true, paint: false },
};
