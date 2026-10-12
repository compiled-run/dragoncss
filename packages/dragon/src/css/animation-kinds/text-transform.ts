// How the text-transform family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TEXT_TRANSFORM_LONGHANDS } from '../properties/text-transform.ts';

export const TEXT_TRANSFORM_ANIMATION: { readonly [P in (typeof TEXT_TRANSFORM_LONGHANDS)[number]]: AnimationKind } = {
  // TXT2-e: Chrome flips text-transform discretely; the transform is a build-time rewrite of the text, which no runtime writer redoes.
  'text-transform': UNADMITTED,
};
