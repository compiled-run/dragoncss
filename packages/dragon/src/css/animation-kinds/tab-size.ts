// How the tab-size family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TAB_SIZE_LONGHANDS } from '../properties/tab-size.ts';

export const TAB_SIZE_ANIMATION: { readonly [P in (typeof TAB_SIZE_LONGHANDS)[number]]: AnimationKind } = {
  // TXT2-c3: Chrome interpolates tab-size; no runtime writer re-lays out text yet.
  'tab-size': UNADMITTED,
};
