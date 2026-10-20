// How the line-clamp family's longhands animate in Chrome 145 (animation-kinds.ts): neither interpolates.
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { LINE_CLAMP_LONGHANDS } from '../properties/line-clamp.ts';

export const LINE_CLAMP_ANIMATION: { readonly [P in (typeof LINE_CLAMP_LONGHANDS)[number]]: AnimationKind } = {
  '-webkit-box-orient': DISCRETE,
  '-webkit-line-clamp': DISCRETE,
};
