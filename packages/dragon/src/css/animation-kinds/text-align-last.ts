// How the text-align-last family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { TEXT_ALIGN_LAST_LONGHANDS } from '../properties/text-align-last.ts';

export const TEXT_ALIGN_LAST_ANIMATION: { readonly [P in (typeof TEXT_ALIGN_LAST_LONGHANDS)[number]]: AnimationKind } = {
  'text-align-last': DISCRETE,
};
