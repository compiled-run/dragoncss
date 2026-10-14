// How the text-break family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { TEXT_BREAK_LONGHANDS } from '../properties/text-break.ts';

export const TEXT_BREAK_ANIMATION: { readonly [P in (typeof TEXT_BREAK_LONGHANDS)[number]]: AnimationKind } = {
  'overflow-wrap': DISCRETE,
  'word-break': DISCRETE,
};
