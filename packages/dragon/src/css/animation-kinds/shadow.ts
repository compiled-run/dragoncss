// How the shadow family's longhands animate in Chrome 145 (animation-kinds.ts).
import type { AnimationKind } from './kinds.ts';
import type { SHADOW_LONGHANDS } from '../properties/shadow.ts';

export const SHADOW_ANIMATION: { readonly [P in (typeof SHADOW_LONGHANDS)[number]]: AnimationKind } = {};
