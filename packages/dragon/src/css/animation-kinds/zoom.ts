// How zoom animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { ZOOM_LONGHANDS } from '../properties/zoom.ts';

export const ZOOM_ANIMATION: { readonly [P in (typeof ZOOM_LONGHANDS)[number]]: AnimationKind } = {
  // Not interpolable in css_properties.json5, so it animates discretely.
  zoom: DISCRETE,
};
