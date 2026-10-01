// Seam (EMS): scrollbar-color and scrollbar-width (css-scrollbars-1; OVFL-S). An empty family until its package fills it.
import type { PropertyAspect } from '../properties.ts';

export const SCROLLBAR_LONGHANDS = [] as const;
export const SCROLLBAR_SHORTHANDS = [] as const;
export const SCROLLBAR_INHERITED: readonly (typeof SCROLLBAR_LONGHANDS)[number][] = [];
export const SCROLLBAR_CONTAINER: readonly (typeof SCROLLBAR_LONGHANDS)[number][] = [];
export const SCROLLBAR_TEXT_ROLE: readonly (typeof SCROLLBAR_LONGHANDS)[number][] = [];

export const SCROLLBAR_ASPECTS: { readonly [P in (typeof SCROLLBAR_LONGHANDS)[number]]: PropertyAspect } = {};
