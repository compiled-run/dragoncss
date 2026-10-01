// Seam (EMS): opacity, z-index and color-scheme (PNT1). An empty family until its package fills it.
import type { PropertyAspect } from '../properties.ts';

export const EFFECTS_LONGHANDS = [] as const;
export const EFFECTS_SHORTHANDS = [] as const;
export const EFFECTS_INHERITED: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];
export const EFFECTS_CONTAINER: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];
export const EFFECTS_TEXT_ROLE: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];

export const EFFECTS_ASPECTS: { readonly [P in (typeof EFFECTS_LONGHANDS)[number]]: PropertyAspect } = {};
