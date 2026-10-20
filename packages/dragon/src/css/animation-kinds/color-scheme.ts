// How color-scheme animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { COLOR_SCHEME_LONGHANDS } from '../properties/color-scheme.ts';

export const COLOR_SCHEME_ANIMATION: { readonly [P in (typeof COLOR_SCHEME_LONGHANDS)[number]]: AnimationKind } = {
  // Not interpolable in css_properties.json5, so it animates discretely.
  'color-scheme': DISCRETE,
};
