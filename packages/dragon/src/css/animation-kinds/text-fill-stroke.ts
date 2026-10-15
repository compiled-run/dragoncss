// How the text-fill-stroke family's longhands animate in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TEXT_FILL_STROKE_LONGHANDS } from '../properties/text-fill-stroke.ts';

export const TEXT_FILL_STROKE_ANIMATION: { readonly [P in (typeof TEXT_FILL_STROKE_LONGHANDS)[number]]: AnimationKind } = {
  // TXT-FX: the colours and the width interpolate in Chrome; Dragon paints neither a fill colour nor a stroke yet, so it admits no animation.
  '-webkit-text-fill-color': UNADMITTED,
  '-webkit-text-stroke-color': UNADMITTED,
  '-webkit-text-stroke-width': UNADMITTED,
};
