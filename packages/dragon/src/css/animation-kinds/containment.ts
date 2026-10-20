// How the containment longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { CONTAINMENT_LONGHANDS } from '../properties/containment.ts';

// Chrome interpolates contain-intrinsic-width and -height alone; Dragon accepts only initial values, so it admits no animation.
export const CONTAINMENT_ANIMATION: { readonly [P in (typeof CONTAINMENT_LONGHANDS)[number]]: AnimationKind } = {
  contain: DISCRETE,
  'content-visibility': DISCRETE,
  'contain-intrinsic-width': UNADMITTED,
  'contain-intrinsic-height': UNADMITTED,
  'contain-intrinsic-inline-size': DISCRETE,
  'contain-intrinsic-block-size': DISCRETE,
};
