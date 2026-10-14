// How the resize family's longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { RESIZE_LONGHANDS } from '../properties/resize.ts';

export const RESIZE_ANIMATION: { readonly [P in (typeof RESIZE_LONGHANDS)[number]]: AnimationKind } = {
  resize: DISCRETE,
};
