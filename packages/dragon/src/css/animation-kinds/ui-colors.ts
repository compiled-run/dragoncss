// How the caret-color and accent-color longhands animate in Chrome 145 (animation-kinds.ts): as colours, which Dragon does not admit.
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { UI_COLORS_LONGHANDS } from '../properties/ui-colors.ts';

export const UI_COLORS_ANIMATION: { readonly [P in (typeof UI_COLORS_LONGHANDS)[number]]: AnimationKind } = {
  'caret-color': UNADMITTED,
  'accent-color': UNADMITTED,
};
