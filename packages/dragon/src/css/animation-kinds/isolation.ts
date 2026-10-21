// How isolation animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { ISOLATION_LONGHANDS } from '../properties/isolation.ts';

export const ISOLATION_ANIMATION: { readonly [P in (typeof ISOLATION_LONGHANDS)[number]]: AnimationKind } = {
  // A keyword field, not interpolable in css_properties.json5, so it animates discretely.
  isolation: DISCRETE,
};
