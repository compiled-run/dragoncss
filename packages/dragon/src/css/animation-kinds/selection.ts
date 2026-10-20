// How the selection family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { SELECTION_LONGHANDS } from '../properties/selection.ts';

export const SELECTION_ANIMATION: { readonly [P in (typeof SELECTION_LONGHANDS)[number]]: AnimationKind } = {
  'user-select': DISCRETE,
};
