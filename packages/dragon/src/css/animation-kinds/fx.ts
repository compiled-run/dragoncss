// How the FX longhands animate in Chrome 145 (animation-kinds.ts): mix-blend-mode is a keyword field, not interpolable in
// css_properties.json5; a backdrop-filter list interpolates, which Dragon does not admit.
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { FX_LONGHANDS } from '../properties/fx.ts';

export const FX_ANIMATION: { readonly [P in (typeof FX_LONGHANDS)[number]]: AnimationKind } = {
  'backdrop-filter': UNADMITTED,
  'mix-blend-mode': DISCRETE,
};
