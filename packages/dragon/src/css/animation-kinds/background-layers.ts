// How the background-layers family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { BACKGROUND_LAYERS_LONGHANDS } from '../properties/background-layers.ts';

// Chrome cross-fades images and interpolates the position and size lists; Dragon does not animate them yet.
export const BACKGROUND_LAYERS_ANIMATION: { readonly [P in (typeof BACKGROUND_LAYERS_LONGHANDS)[number]]: AnimationKind } = {
  'background-image': UNADMITTED,
  'background-position-x': UNADMITTED,
  'background-position-y': UNADMITTED,
  'background-size': UNADMITTED,
  'background-repeat': DISCRETE,
  'background-attachment': DISCRETE,
  'background-origin': DISCRETE,
  'background-clip': DISCRETE,
};
