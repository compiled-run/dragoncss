// How unicode-bidi animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { BIDI_LONGHANDS } from '../properties/bidi.ts';

export const BIDI_ANIMATION: { readonly [P in (typeof BIDI_LONGHANDS)[number]]: AnimationKind } = {
  // A keyword field, not interpolable in css_properties.json5, so it animates discretely.
  'unicode-bidi': DISCRETE,
};
