// How the visibility family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { VISIBILITY_LONGHANDS } from '../properties/visibility.ts';

export const VISIBILITY_ANIMATION: { readonly [P in (typeof VISIBILITY_LONGHANDS)[number]]: AnimationKind } = {
  // T150a: Chrome interpolates visibility (visible wins between a visible and a hidden end); the state runtime has no visibility writer yet.
  visibility: UNADMITTED,
};
