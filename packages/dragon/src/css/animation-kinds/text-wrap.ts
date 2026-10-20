// How the text-wrap family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { TEXT_WRAP_LONGHANDS } from '../properties/text-wrap.ts';

export const TEXT_WRAP_ANIMATION: { readonly [P in (typeof TEXT_WRAP_LONGHANDS)[number]]: AnimationKind } = {
  'text-wrap-style': DISCRETE,
};
