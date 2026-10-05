// How the flex family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, NON_NEGATIVE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { FLEX_LONGHANDS } from '../properties/flex.ts';

export const FLEX_ANIMATION: { readonly [P in (typeof FLEX_LONGHANDS)[number]]: AnimationKind } = {
  'flex-direction': DISCRETE,
  'flex-wrap': DISCRETE,
  'flex-grow': UNADMITTED,
  'flex-shrink': UNADMITTED,
  'flex-basis': UNADMITTED,
  order: UNADMITTED,
  'justify-content': DISCRETE,
  'align-items': DISCRETE,
  'align-self': DISCRETE,
  'align-content': DISCRETE,
  'row-gap': NON_NEGATIVE,
  'column-gap': NON_NEGATIVE,
};
