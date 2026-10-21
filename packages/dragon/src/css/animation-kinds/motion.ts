// How the motion path longhands animate in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { MOTION_LONGHANDS } from '../properties/motion.ts';

// Chrome interpolates all five (interpolable: true in css_properties.json5); Dragon accepts only initial values, so it admits no
// animation of them.
export const MOTION_ANIMATION: { readonly [P in (typeof MOTION_LONGHANDS)[number]]: AnimationKind } = {
  'offset-path': UNADMITTED,
  'offset-distance': UNADMITTED,
  'offset-position': UNADMITTED,
  'offset-anchor': UNADMITTED,
  'offset-rotate': UNADMITTED,
};
