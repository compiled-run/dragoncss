// How the transform family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TRANSFORM_LONGHANDS } from '../properties/transform.ts';

export const TRANSFORM_ANIMATION: { readonly [P in (typeof TRANSFORM_LONGHANDS)[number]]: AnimationKind } = {
  // PNT2: transform and transform-origin interpolate in Chrome; their writers come with ANIM-b2. will-change is discrete.
  transform: UNADMITTED,
  'transform-origin': UNADMITTED,
  'will-change': DISCRETE,
};
