// How the containment longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { CONTAINMENT_LONGHANDS } from '../properties/containment.ts';

// Chrome interpolates contain-intrinsic-width and -height and their flow-relative -inline-size and -block-size; Dragon accepts only initial values, so it admits no animation.
export const CONTAINMENT_ANIMATION: { readonly [P in (typeof CONTAINMENT_LONGHANDS)[number]]: AnimationKind } = {
  contain: DISCRETE,
  'content-visibility': DISCRETE,
  'contain-intrinsic-width': UNADMITTED,
  'contain-intrinsic-height': UNADMITTED,
  'contain-intrinsic-inline-size': UNADMITTED,
  'contain-intrinsic-block-size': UNADMITTED,
};
