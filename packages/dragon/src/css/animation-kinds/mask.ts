// How the mask family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { MASK_LONGHANDS } from '../properties/mask.ts';

// MASK-CLIP: Chrome interpolates the image, position and size lists (an image list through a cross-fade); Dragon admits no such animation.
export const MASK_ANIMATION: { readonly [P in (typeof MASK_LONGHANDS)[number]]: AnimationKind } = {
  'mask-image': UNADMITTED,
  '-webkit-mask-position-x': UNADMITTED,
  '-webkit-mask-position-y': UNADMITTED,
  'mask-size': UNADMITTED,
  'mask-repeat': DISCRETE,
  'mask-origin': DISCRETE,
  'mask-clip': DISCRETE,
  'mask-composite': DISCRETE,
  'mask-mode': DISCRETE,
};
