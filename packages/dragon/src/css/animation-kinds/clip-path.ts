// How the clip-path family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { CLIP_PATH_LONGHANDS } from '../properties/clip-path.ts';

export const CLIP_PATH_ANIMATION: { readonly [P in (typeof CLIP_PATH_LONGHANDS)[number]]: AnimationKind } = {
  // MASK-CLIP: Chrome interpolates inset() edge by edge; the native runtime has no clip-path writer for frames yet.
  'clip-path': UNADMITTED,
};
