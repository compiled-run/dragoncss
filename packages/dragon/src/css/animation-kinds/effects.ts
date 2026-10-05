// How the effects family's longhands animate in Chrome 145 (animation-kinds.ts).
import type { AnimationKind } from './kinds.ts';
import type { EFFECTS_LONGHANDS } from '../properties/effects.ts';

export const EFFECTS_ANIMATION: { readonly [P in (typeof EFFECTS_LONGHANDS)[number]]: AnimationKind } = {};
