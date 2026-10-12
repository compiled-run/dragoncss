// How the border family's longhands animate in Chrome 145 (animation-kinds.ts).
import { COLOR, DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { BORDER_LONGHANDS } from '../properties/border.ts';

export const BORDER_ANIMATION: { readonly [P in (typeof BORDER_LONGHANDS)[number]]: AnimationKind } = {
  'border-top-width': UNADMITTED,
  'border-right-width': UNADMITTED,
  'border-bottom-width': UNADMITTED,
  'border-left-width': UNADMITTED,
  'border-top-style': DISCRETE,
  'border-right-style': DISCRETE,
  'border-bottom-style': DISCRETE,
  'border-left-style': DISCRETE,
  'border-top-color': COLOR,
  'border-right-color': COLOR,
  'border-bottom-color': COLOR,
  'border-left-color': COLOR,
};
