// How the outline family's longhands animate in Chrome 145 (animation-kinds.ts).
import type { AnimationKind } from './kinds.ts';
import type { OUTLINE_LONGHANDS } from '../properties/outline.ts';

export const OUTLINE_ANIMATION: { readonly [P in (typeof OUTLINE_LONGHANDS)[number]]: AnimationKind } = {};
