// How box-decoration-break animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { BOX_DECORATION_LONGHANDS } from '../properties/box-decoration.ts';

export const BOX_DECORATION_ANIMATION: { readonly [P in (typeof BOX_DECORATION_LONGHANDS)[number]]: AnimationKind } = {
  // A keyword field, not interpolable in css_properties.json5, so it animates discretely.
  'box-decoration-break': DISCRETE,
};
