// How the text-box family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { TEXT_BOX_LONGHANDS } from '../properties/text-box.ts';

export const TEXT_BOX_ANIMATION: { readonly [P in (typeof TEXT_BOX_LONGHANDS)[number]]: AnimationKind } = {
  'text-box-trim': DISCRETE,
  'text-box-edge': DISCRETE,
};
