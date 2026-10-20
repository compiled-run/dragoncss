// How the counters family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { COUNTERS_LONGHANDS } from '../properties/counters.ts';

export const COUNTERS_ANIMATION: { readonly [P in (typeof COUNTERS_LONGHANDS)[number]]: AnimationKind } = {
  'counter-reset': DISCRETE,
  'counter-increment': DISCRETE,
  'counter-set': DISCRETE,
  quotes: DISCRETE,
};
