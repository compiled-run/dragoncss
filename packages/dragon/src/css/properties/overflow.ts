// Overflow (css-overflow-3).
import type { PropertyAspect } from '../properties.ts';

export const OVERFLOW_LONGHANDS = ['overflow-x', 'overflow-y'] as const;
export const OVERFLOW_SHORTHANDS = ['overflow'] as const;
export const OVERFLOW_INHERITED: readonly (typeof OVERFLOW_LONGHANDS)[number][] = [];
export const OVERFLOW_CONTAINER: readonly (typeof OVERFLOW_LONGHANDS)[number][] = [];
export const OVERFLOW_TEXT_ROLE: readonly (typeof OVERFLOW_LONGHANDS)[number][] = [];

export const OVERFLOW_ASPECTS: { readonly [P in (typeof OVERFLOW_LONGHANDS)[number]]: PropertyAspect } = {
  // overflow: hidden also clips painting, which no milestone-1 lane renders natively.
  'overflow-x': { layout: true, paint: true },
  'overflow-y': { layout: true, paint: true },
};
