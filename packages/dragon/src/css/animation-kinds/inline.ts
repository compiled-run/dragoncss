// How the inline family's longhands animate in Chrome 145 (animation-kinds.ts): vertical-align interpolates its lengths, and no writer is built.
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { INLINE_LONGHANDS } from '../properties/inline.ts';

export const INLINE_ANIMATION: { readonly [P in (typeof INLINE_LONGHANDS)[number]]: AnimationKind } = {
  'vertical-align': UNADMITTED,
};
