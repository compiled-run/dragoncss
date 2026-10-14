// How the text-overflow family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { TEXT_OVERFLOW_LONGHANDS } from '../properties/text-overflow.ts';

export const TEXT_OVERFLOW_ANIMATION: { readonly [P in (typeof TEXT_OVERFLOW_LONGHANDS)[number]]: AnimationKind } = {
  'text-overflow': DISCRETE,
};
