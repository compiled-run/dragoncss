// Seam (EMS): border-radius longhands (css-backgrounds-3 §5; PNT1). An empty family until its package fills it.
import type { PropertyAspect } from '../properties.ts';

export const RADIUS_LONGHANDS = [] as const;
export const RADIUS_SHORTHANDS = [] as const;
export const RADIUS_INHERITED: readonly (typeof RADIUS_LONGHANDS)[number][] = [];
export const RADIUS_CONTAINER: readonly (typeof RADIUS_LONGHANDS)[number][] = [];
export const RADIUS_TEXT_ROLE: readonly (typeof RADIUS_LONGHANDS)[number][] = [];

export const RADIUS_ASPECTS: { readonly [P in (typeof RADIUS_LONGHANDS)[number]]: PropertyAspect } = {};
