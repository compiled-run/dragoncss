// How the position family's longhands animate in Chrome 145 (animation-kinds.ts).
import { ALL, DISCRETE, type AnimationKind } from './kinds.ts';
import type { POSITION_LONGHANDS } from '../properties/position.ts';

export const POSITION_ANIMATION: { readonly [P in (typeof POSITION_LONGHANDS)[number]]: AnimationKind } = {
  display: DISCRETE,
  position: DISCRETE,
  top: ALL,
  right: ALL,
  bottom: ALL,
  left: ALL,
};
