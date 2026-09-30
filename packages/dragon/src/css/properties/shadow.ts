// Seam (EMS): box-shadow (css-backgrounds-3 §6; PNT1). An empty family until its package fills it.
import type { PropertyAspect } from '../properties.ts';

export const SHADOW_LONGHANDS = [] as const;
export const SHADOW_SHORTHANDS = [] as const;
export const SHADOW_INHERITED: readonly (typeof SHADOW_LONGHANDS)[number][] = [];
export const SHADOW_CONTAINER: readonly (typeof SHADOW_LONGHANDS)[number][] = [];
export const SHADOW_TEXT_ROLE: readonly (typeof SHADOW_LONGHANDS)[number][] = [];

export const SHADOW_ASPECTS: { readonly [P in (typeof SHADOW_LONGHANDS)[number]]: PropertyAspect } = {};
