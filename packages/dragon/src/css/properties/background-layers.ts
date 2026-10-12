// Background layers beyond background-color (css-backgrounds-3 §2-§3; BG2): Chrome 145's eight layer longhands, in its
// expansion order, and the background-position shorthand over the two position longhands. Each longhand holds a
// comma-separated list with one item per layer; background-image's item count is the layer count (css-backgrounds-3 §2.2).
import type { PropertyAspect } from '../properties.ts';

export const BACKGROUND_LAYERS_LONGHANDS = [
  'background-image', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip',
] as const;
export const BACKGROUND_LAYERS_SHORTHANDS = ['background-position'] as const;
export const BACKGROUND_LAYERS_INHERITED: readonly (typeof BACKGROUND_LAYERS_LONGHANDS)[number][] = [];
export const BACKGROUND_LAYERS_CONTAINER: readonly (typeof BACKGROUND_LAYERS_LONGHANDS)[number][] = [];
export const BACKGROUND_LAYERS_TEXT_ROLE: readonly (typeof BACKGROUND_LAYERS_LONGHANDS)[number][] = [];

export type BackgroundLayerLonghand = (typeof BACKGROUND_LAYERS_LONGHANDS)[number];

/** Paint only: a background never changes a box's geometry. */
export const BACKGROUND_LAYERS_ASPECTS: { readonly [P in BackgroundLayerLonghand]: PropertyAspect } = {
  'background-image': { layout: false, paint: true },
  'background-position-x': { layout: false, paint: true },
  'background-position-y': { layout: false, paint: true },
  'background-size': { layout: false, paint: true },
  'background-repeat': { layout: false, paint: true },
  'background-attachment': { layout: false, paint: true },
  'background-origin': { layout: false, paint: true },
  'background-clip': { layout: false, paint: true },
};

export function isBackgroundLayerLonghand(p: string): p is BackgroundLayerLonghand {
  return (BACKGROUND_LAYERS_LONGHANDS as readonly string[]).includes(p);
}
