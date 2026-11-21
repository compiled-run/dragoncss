// How field-sizing animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { FIELD_SIZING_LONGHANDS } from '../properties/field-sizing.ts';

export const FIELD_SIZING_ANIMATION: { readonly [P in (typeof FIELD_SIZING_LONGHANDS)[number]]: AnimationKind } = {
  // A keyword field, not interpolable in css_properties.json5, so it animates discretely.
  'field-sizing': DISCRETE,
};
