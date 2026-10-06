// How the outline family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { OUTLINE_LONGHANDS } from '../properties/outline.ts';

export const OUTLINE_ANIMATION: { readonly [P in (typeof OUTLINE_LONGHANDS)[number]]: AnimationKind } = {
  // PNT1: the colour, width and offset interpolate in Chrome; the state and animation runtimes have no outline writer yet.
  'outline-color': UNADMITTED,
  'outline-style': DISCRETE,
  'outline-width': UNADMITTED,
  'outline-offset': UNADMITTED,
};
