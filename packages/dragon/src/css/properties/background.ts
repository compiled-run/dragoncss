// Backgrounds (css-backgrounds-3 §2).
import type { PropertyAspect } from '../properties.ts';

export const BACKGROUND_LONGHANDS = ['background-color'] as const;
export const BACKGROUND_SHORTHANDS = [] as const;
export const BACKGROUND_INHERITED: readonly (typeof BACKGROUND_LONGHANDS)[number][] = [];
export const BACKGROUND_CONTAINER: readonly (typeof BACKGROUND_LONGHANDS)[number][] = [];
export const BACKGROUND_TEXT_ROLE: readonly (typeof BACKGROUND_LONGHANDS)[number][] = [];

export const BACKGROUND_ASPECTS: { readonly [P in (typeof BACKGROUND_LONGHANDS)[number]]: PropertyAspect } = {
  'background-color': { layout: false, paint: true },
};
