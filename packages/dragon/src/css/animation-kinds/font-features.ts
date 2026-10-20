// How the font-features family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { FONT_FEATURES_LONGHANDS } from '../properties/font-features.ts';

export const FONT_FEATURES_ANIMATION: { readonly [P in (typeof FONT_FEATURES_LONGHANDS)[number]]: AnimationKind } = {
  'font-feature-settings': DISCRETE,
  // Chrome interpolates matching variation axes; no runtime writer re-lays out text yet.
  'font-variation-settings': UNADMITTED,
};
