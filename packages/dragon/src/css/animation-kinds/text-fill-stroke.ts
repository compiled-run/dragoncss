// How the text-fill-stroke family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TEXT_FILL_STROKE_LONGHANDS } from '../properties/text-fill-stroke.ts';

export const TEXT_FILL_STROKE_ANIMATION: { readonly [P in (typeof TEXT_FILL_STROKE_LONGHANDS)[number]]: AnimationKind } = {
  // TXT-FX: Chrome 145 animates the fill colour and the stroke width discretely and interpolates the stroke colour
  // (test/data/chrome-145-interpolable.json); Dragon paints neither a fill colour nor a stroke yet, so it admits no smooth animation.
  '-webkit-text-fill-color': DISCRETE,
  '-webkit-text-stroke-color': UNADMITTED,
  '-webkit-text-stroke-width': DISCRETE,
};
