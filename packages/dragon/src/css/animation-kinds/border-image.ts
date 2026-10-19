// How the border image longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { BORDER_IMAGE_LONGHANDS } from '../properties/border-image.ts';

// MISC-PAINT: Chrome interpolates the source, slice, width and outset (css_properties.json5 interpolable); Dragon accepts only the
// initial values, so it admits no animation of them, and border-image-repeat is discrete.
export const BORDER_IMAGE_ANIMATION: { readonly [P in (typeof BORDER_IMAGE_LONGHANDS)[number]]: AnimationKind } = {
  'border-image-source': UNADMITTED,
  'border-image-slice': UNADMITTED,
  'border-image-width': UNADMITTED,
  'border-image-outset': UNADMITTED,
  'border-image-repeat': DISCRETE,
};
