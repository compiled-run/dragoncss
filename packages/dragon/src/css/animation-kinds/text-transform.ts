// How the text-transform family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { TEXT_TRANSFORM_LONGHANDS } from '../properties/text-transform.ts';

export const TEXT_TRANSFORM_ANIMATION: { readonly [P in (typeof TEXT_TRANSFORM_LONGHANDS)[number]]: AnimationKind } = {
  'text-transform': DISCRETE,
};
