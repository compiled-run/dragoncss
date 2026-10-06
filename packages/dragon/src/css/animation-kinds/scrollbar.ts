// How the scrollbar family's longhands animate in Chrome 145 (animation-kinds.ts).
import type { AnimationKind } from './kinds.ts';
import type { SCROLLBAR_LONGHANDS } from '../properties/scrollbar.ts';

export const SCROLLBAR_ANIMATION: { readonly [P in (typeof SCROLLBAR_LONGHANDS)[number]]: AnimationKind } = {};
