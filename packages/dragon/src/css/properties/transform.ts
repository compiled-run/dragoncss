// Seam (EMS): transform and transform-origin (css-transforms-1; PNT2). An empty family until its package fills it.
import type { PropertyAspect } from '../properties.ts';

export const TRANSFORM_LONGHANDS = [] as const;
export const TRANSFORM_SHORTHANDS = [] as const;
export const TRANSFORM_INHERITED: readonly (typeof TRANSFORM_LONGHANDS)[number][] = [];
export const TRANSFORM_CONTAINER: readonly (typeof TRANSFORM_LONGHANDS)[number][] = [];
export const TRANSFORM_TEXT_ROLE: readonly (typeof TRANSFORM_LONGHANDS)[number][] = [];

export const TRANSFORM_ASPECTS: { readonly [P in (typeof TRANSFORM_LONGHANDS)[number]]: PropertyAspect } = {};
