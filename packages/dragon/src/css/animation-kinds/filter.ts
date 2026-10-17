// How the filter family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { FILTER_LONGHANDS } from '../properties/filter.ts';

export const FILTER_ANIMATION: { readonly [P in (typeof FILTER_LONGHANDS)[number]]: AnimationKind } = {
  // FX: a filter list interpolates in Chrome; Dragon accepts only none, so it admits no animation.
  filter: UNADMITTED,
};
