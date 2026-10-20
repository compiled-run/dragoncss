// How the text-decoration family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TEXT_DECORATION_LONGHANDS } from '../properties/text-decoration.ts';

export const TEXT_DECORATION_ANIMATION: { readonly [P in (typeof TEXT_DECORATION_LONGHANDS)[number]]: AnimationKind } = {
  'text-decoration-line': DISCRETE,
  'text-decoration-style': DISCRETE,
  // TDEC-a: the colour and the underline offset interpolate in Chrome; Dragon admits neither animation yet.
  'text-decoration-color': UNADMITTED,
  'text-decoration-thickness': DISCRETE,
  'text-underline-offset': UNADMITTED,
  'text-underline-position': DISCRETE,
  'text-decoration-skip-ink': DISCRETE,
};
