// How the 3D transform longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TRANSFORM_EXTRA_LONGHANDS } from '../properties/transform-extra.ts';

export const TRANSFORM_EXTRA_ANIMATION: { readonly [P in (typeof TRANSFORM_EXTRA_LONGHANDS)[number]]: AnimationKind } = {
  // Keyword fields, not interpolable in css_properties.json5, so they animate discretely.
  'backface-visibility': DISCRETE,
  'transform-style': DISCRETE,
  'transform-box': DISCRETE,
  // Interpolable in css_properties.json5; their writers are not built.
  perspective: UNADMITTED,
  'perspective-origin': UNADMITTED,
};
