// How the grid family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { GRID_LONGHANDS } from '../properties/grid.ts';

export const GRID_ANIMATION: { readonly [P in (typeof GRID_LONGHANDS)[number]]: AnimationKind } = {
  'grid-template-columns': UNADMITTED,
  'grid-template-rows': UNADMITTED,
  'grid-template-areas': DISCRETE,
  'grid-auto-columns': DISCRETE,
  'grid-auto-rows': DISCRETE,
  'grid-auto-flow': DISCRETE,
  'grid-row-start': DISCRETE,
  'grid-row-end': DISCRETE,
  'grid-column-start': DISCRETE,
  'grid-column-end': DISCRETE,
  'justify-items': DISCRETE,
  'justify-self': DISCRETE,
};
