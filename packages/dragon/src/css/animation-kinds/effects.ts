// How the effects family's longhands animate in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { EFFECTS_LONGHANDS } from '../properties/effects.ts';

export const EFFECTS_ANIMATION: { readonly [P in (typeof EFFECTS_LONGHANDS)[number]]: AnimationKind } = {
  // PNT1: both interpolate in Chrome (opacity as a number, z-index as an integer); their runtime writers come with ANIM-b2.
  opacity: UNADMITTED,
  'z-index': UNADMITTED,
};
