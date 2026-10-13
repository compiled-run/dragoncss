// Inline-level alignment (CSS2 §10.8.1): vertical-align. Chrome 145 reads it only on inline-level boxes and table cells, so on a
// block-level box, a flex item or a grid item it has no effect; analysis/context.ts keys it by the context the box takes part in.
import type { PropertyAspect } from '../properties.ts';

export const INLINE_LONGHANDS = ['vertical-align'] as const;
export const INLINE_SHORTHANDS = [] as const;
export const INLINE_INHERITED: readonly (typeof INLINE_LONGHANDS)[number][] = [];
export const INLINE_CONTAINER: readonly (typeof INLINE_LONGHANDS)[number][] = [];
export const INLINE_TEXT_ROLE: readonly (typeof INLINE_LONGHANDS)[number][] = [];

export const INLINE_ASPECTS: { readonly [P in (typeof INLINE_LONGHANDS)[number]]: PropertyAspect } = {
  'vertical-align': { layout: true, paint: false },
};
