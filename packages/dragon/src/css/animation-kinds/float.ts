// How the float family's longhands animate in Chrome 145 (animation-kinds.ts): both are keywords, so discrete.
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { FLOAT_LONGHANDS } from '../properties/float.ts';

export const FLOAT_ANIMATION: { readonly [P in (typeof FLOAT_LONGHANDS)[number]]: AnimationKind } = {
  float: DISCRETE,
  clear: DISCRETE,
};
