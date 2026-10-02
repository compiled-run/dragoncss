// Seam (EMS): outline longhands (css-ui-4 §3; PNT1). An empty family until its package fills it.
import type { PropertyAspect } from '../properties.ts';

export const OUTLINE_LONGHANDS = [] as const;
export const OUTLINE_SHORTHANDS = [] as const;
export const OUTLINE_INHERITED: readonly (typeof OUTLINE_LONGHANDS)[number][] = [];
export const OUTLINE_CONTAINER: readonly (typeof OUTLINE_LONGHANDS)[number][] = [];
export const OUTLINE_TEXT_ROLE: readonly (typeof OUTLINE_LONGHANDS)[number][] = [];

export const OUTLINE_ASPECTS: { readonly [P in (typeof OUTLINE_LONGHANDS)[number]]: PropertyAspect } = {};
