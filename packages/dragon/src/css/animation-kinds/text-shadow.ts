// How the text-shadow family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TEXT_SHADOW_LONGHANDS } from '../properties/text-shadow.ts';

export const TEXT_SHADOW_ANIMATION: { readonly [P in (typeof TEXT_SHADOW_LONGHANDS)[number]]: AnimationKind } = {
  // TXT-FX: a shadow list interpolates in Chrome; Dragon accepts only none, so it admits no animation.
  'text-shadow': UNADMITTED,
};
