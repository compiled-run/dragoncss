// How the background family's longhands animate in Chrome 145 (animation-kinds.ts).
import { COLOR, type AnimationKind } from './kinds.ts';
import type { BACKGROUND_LONGHANDS } from '../properties/background.ts';

export const BACKGROUND_ANIMATION: { readonly [P in (typeof BACKGROUND_LONGHANDS)[number]]: AnimationKind } = {
  'background-color': COLOR,
};
