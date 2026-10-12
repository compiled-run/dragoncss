// How the shadow family's longhands animate in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { SHADOW_LONGHANDS } from '../properties/shadow.ts';

export const SHADOW_ANIMATION: { readonly [P in (typeof SHADOW_LONGHANDS)[number]]: AnimationKind } = {
  // PNT1: Chrome interpolates each shadow's offsets, blur, spread and colour; the state runtime has no shadow writer yet.
  'box-shadow': UNADMITTED,
};
