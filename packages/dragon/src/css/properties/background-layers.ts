// Seam (EMS): background layers beyond background-color (css-backgrounds-3 §3; BG2). An empty family until its package fills it.
import type { PropertyAspect } from '../properties.ts';

export const BACKGROUND_LAYERS_LONGHANDS = [] as const;
export const BACKGROUND_LAYERS_SHORTHANDS = [] as const;
export const BACKGROUND_LAYERS_INHERITED: readonly (typeof BACKGROUND_LAYERS_LONGHANDS)[number][] = [];
export const BACKGROUND_LAYERS_CONTAINER: readonly (typeof BACKGROUND_LAYERS_LONGHANDS)[number][] = [];
export const BACKGROUND_LAYERS_TEXT_ROLE: readonly (typeof BACKGROUND_LAYERS_LONGHANDS)[number][] = [];

export const BACKGROUND_LAYERS_ASPECTS: { readonly [P in (typeof BACKGROUND_LAYERS_LONGHANDS)[number]]: PropertyAspect } = {};
