// How the text family's longhands animate in Chrome 145 (animation-kinds.ts).
import { COLOR, DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TEXT_FAMILY_LONGHANDS } from '../properties/text.ts';

export const TEXT_ANIMATION: { readonly [P in (typeof TEXT_FAMILY_LONGHANDS)[number]]: AnimationKind } = {
  'font-size': UNADMITTED,
  'font-family': DISCRETE,
  'line-height': UNADMITTED,
  'text-align': DISCRETE,
  'white-space-collapse': DISCRETE,
  'text-wrap-mode': DISCRETE,
  color: COLOR,
};
