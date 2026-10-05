// How the overflow family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { OVERFLOW_LONGHANDS } from '../properties/overflow.ts';

export const OVERFLOW_ANIMATION: { readonly [P in (typeof OVERFLOW_LONGHANDS)[number]]: AnimationKind } = {
  'overflow-x': DISCRETE,
  'overflow-y': DISCRETE,
};
