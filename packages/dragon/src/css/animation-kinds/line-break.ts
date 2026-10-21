// How the line-break family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { LINE_BREAK_LONGHANDS } from '../properties/line-break.ts';

export const LINE_BREAK_ANIMATION: { readonly [P in (typeof LINE_BREAK_LONGHANDS)[number]]: AnimationKind } = {
  'line-break': DISCRETE,
};
