// How the multicol longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { MULTICOL_LONGHANDS } from '../properties/multicol.ts';

// Chrome interpolates column-width, column-count, column-rule-width and column-rule-color (interpolable: true in
// css_properties.json5); Dragon accepts only initial values, so it admits no animation of them. The others animate discretely.
export const MULTICOL_ANIMATION: { readonly [P in (typeof MULTICOL_LONGHANDS)[number]]: AnimationKind } = {
  'column-width': UNADMITTED,
  'column-count': UNADMITTED,
  'column-rule-width': UNADMITTED,
  'column-rule-style': DISCRETE,
  'column-rule-color': UNADMITTED,
  'column-span': DISCRETE,
  'column-fill': DISCRETE,
};
