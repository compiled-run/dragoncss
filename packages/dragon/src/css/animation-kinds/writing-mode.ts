// How the writing-mode family's longhands animate in Chrome 145 (animation-kinds.ts).
import type { AnimationKind } from './kinds.ts';
import type { WRITING_MODE_LONGHANDS } from '../properties/writing-mode.ts';

export const WRITING_MODE_ANIMATION: { readonly [P in (typeof WRITING_MODE_LONGHANDS)[number]]: AnimationKind } = {};
