// How the touch-action family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { TOUCH_ACTION_LONGHANDS } from '../properties/touch-action.ts';

export const TOUCH_ACTION_ANIMATION: { readonly [P in (typeof TOUCH_ACTION_LONGHANDS)[number]]: AnimationKind } = {
  'touch-action': DISCRETE,
};
