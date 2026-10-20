// How the transform family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, TRANSFORM, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TRANSFORM_LONGHANDS } from '../properties/transform.ts';

export const TRANSFORM_ANIMATION: { readonly [P in (typeof TRANSFORM_LONGHANDS)[number]]: AnimationKind } = {
  // PNT2: transform and transform-origin interpolate in Chrome. ANIM-b2 writes transform through dragonSetTransform; the
  // origin's writer is not built yet. will-change is discrete.
  transform: TRANSFORM,
  'transform-origin': UNADMITTED,
  'will-change': DISCRETE,
};
