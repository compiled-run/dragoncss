// How the clip family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { CLIP_RECT_LONGHANDS } from '../properties/clip-rect.ts';

export const CLIP_RECT_ANIMATION: { readonly [P in (typeof CLIP_RECT_LONGHANDS)[number]]: AnimationKind } = {
  // MASK-CLIP: Chrome interpolates rect() edge by edge; the native runtime has no clip writer for frames yet.
  clip: UNADMITTED,
};
