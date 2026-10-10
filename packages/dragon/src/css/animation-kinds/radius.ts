// How the radius family's longhands animate in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { RADIUS_LONGHANDS } from '../properties/radius.ts';

export const RADIUS_ANIMATION: { readonly [P in (typeof RADIUS_LONGHANDS)[number]]: AnimationKind } = {
  // PNT1: each corner interpolates its two components in Chrome; the state runtime has no radius writer yet.
  'border-top-left-radius': UNADMITTED,
  'border-top-right-radius': UNADMITTED,
  'border-bottom-right-radius': UNADMITTED,
  'border-bottom-left-radius': UNADMITTED,
};
