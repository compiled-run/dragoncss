// How the text-spacing family's longhands animate in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TEXT_SPACING_LONGHANDS } from '../properties/text-spacing.ts';

export const TEXT_SPACING_ANIMATION: { readonly [P in (typeof TEXT_SPACING_LONGHANDS)[number]]: AnimationKind } = {
  // TXT2-b: Chrome interpolates letter-spacing as a length; no runtime writer re-lays out text yet.
  'letter-spacing': UNADMITTED,
};
