// How the hyphens family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { HYPHENS_LONGHANDS } from '../properties/hyphens.ts';

export const HYPHENS_ANIMATION: { readonly [P in (typeof HYPHENS_LONGHANDS)[number]]: AnimationKind } = {
  hyphens: DISCRETE,
};
