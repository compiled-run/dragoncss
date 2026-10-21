// How the fragmentation longhands animate in Chrome 145 (animation-kinds.ts): the break keywords are discrete; orphans and widows
// interpolate as integers, which Dragon admits no animation of.
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { FRAGMENTATION_LONGHANDS } from '../properties/fragmentation.ts';

export const FRAGMENTATION_ANIMATION: { readonly [P in (typeof FRAGMENTATION_LONGHANDS)[number]]: AnimationKind } = {
  'break-before': DISCRETE,
  'break-after': DISCRETE,
  'break-inside': DISCRETE,
  orphans: UNADMITTED,
  widows: UNADMITTED,
};
