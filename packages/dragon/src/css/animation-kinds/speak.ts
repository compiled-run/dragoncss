// How the speak longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { SPEAK_LONGHANDS } from '../properties/speak.ts';

export const SPEAK_ANIMATION: { readonly [P in (typeof SPEAK_LONGHANDS)[number]]: AnimationKind } = {
  speak: DISCRETE,
};
