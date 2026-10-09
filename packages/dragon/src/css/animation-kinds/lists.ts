// How the lists family's longhands animate in Chrome 145 (animation-kinds.ts): list-style-image cross-fades images, the rest are discrete.
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { LISTS_LONGHANDS } from '../properties/lists.ts';

export const LISTS_ANIMATION: { readonly [P in (typeof LISTS_LONGHANDS)[number]]: AnimationKind } = {
  content: DISCRETE,
  'list-style-type': DISCRETE,
  'list-style-position': DISCRETE,
  'list-style-image': UNADMITTED,
};
