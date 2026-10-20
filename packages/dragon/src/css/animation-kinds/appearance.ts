// How the appearance family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { APPEARANCE_LONGHANDS } from '../properties/appearance.ts';

export const APPEARANCE_ANIMATION: { readonly [P in (typeof APPEARANCE_LONGHANDS)[number]]: AnimationKind } = {
  appearance: DISCRETE,
};
