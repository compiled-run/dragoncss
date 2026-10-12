// How the logical family's longhands animate in Chrome 145 (animation-kinds.ts).
import type { AnimationKind } from './kinds.ts';
import type { LOGICAL_LONGHANDS } from '../properties/logical.ts';

export const LOGICAL_ANIMATION: { readonly [P in (typeof LOGICAL_LONGHANDS)[number]]: AnimationKind } = {};
