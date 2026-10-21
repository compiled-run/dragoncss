// How background-blend-mode animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { BACKGROUND_BLEND_LONGHANDS } from '../properties/background-blend.ts';

export const BACKGROUND_BLEND_ANIMATION: { readonly [P in (typeof BACKGROUND_BLEND_LONGHANDS)[number]]: AnimationKind } = {
  // A keyword list, not interpolable in css_properties.json5, so it animates discretely.
  'background-blend-mode': DISCRETE,
};
