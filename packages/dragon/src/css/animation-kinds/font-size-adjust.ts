// How the font-size-adjust family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { FONT_SIZE_ADJUST_LONGHANDS } from '../properties/font-size-adjust.ts';

export const FONT_SIZE_ADJUST_ANIMATION: { readonly [P in (typeof FONT_SIZE_ADJUST_LONGHANDS)[number]]: AnimationKind } = {
  // Chrome interpolates two numbers under the same metric; Dragon accepts none only, and no runtime writer re-lays out text yet.
  'font-size-adjust': UNADMITTED,
};
