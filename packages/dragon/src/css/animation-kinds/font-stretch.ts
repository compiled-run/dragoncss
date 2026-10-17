// How the font-stretch family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { FONT_STRETCH_LONGHANDS } from '../properties/font-stretch.ts';

export const FONT_STRETCH_ANIMATION: { readonly [P in (typeof FONT_STRETCH_LONGHANDS)[number]]: AnimationKind } = {
  // Chrome interpolates font-stretch as a percentage; no runtime writer re-lays out text yet.
  'font-stretch': UNADMITTED,
};
