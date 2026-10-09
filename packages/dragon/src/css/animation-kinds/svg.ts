// How the svg family's longhands animate in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { SVG_LONGHANDS } from '../properties/svg.ts';

export const SVG_ANIMATION: { readonly [P in (typeof SVG_LONGHANDS)[number]]: AnimationKind } = {
  // SVG-a1: all three interpolate in Chrome; no shape writer exists until SVG-a2 and an animation package admit them.
  fill: UNADMITTED,
  stroke: UNADMITTED,
  'stroke-width': UNADMITTED,
};
