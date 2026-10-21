// How the text-justify family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { TEXT_JUSTIFY_LONGHANDS } from '../properties/text-justify.ts';

export const TEXT_JUSTIFY_ANIMATION: { readonly [P in (typeof TEXT_JUSTIFY_LONGHANDS)[number]]: AnimationKind } = {
  'text-justify': DISCRETE,
};
