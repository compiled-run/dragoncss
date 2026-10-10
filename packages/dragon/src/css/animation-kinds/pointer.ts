// How the pointer family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { POINTER_LONGHANDS } from '../properties.ts';

export const POINTER_ANIMATION: { readonly [P in (typeof POINTER_LONGHANDS)[number]]: AnimationKind } = {
  'pointer-events': DISCRETE,
};
