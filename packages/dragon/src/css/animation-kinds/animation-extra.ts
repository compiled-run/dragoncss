// How the interpolate-size and timeline-scope longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import { ANIMATION_EXTRA_LONGHANDS } from '../properties/animation-extra.ts';

// interpolable: false in css_properties.json5, so each animates discretely.
export const ANIMATION_EXTRA_ANIMATION = Object.fromEntries(ANIMATION_EXTRA_LONGHANDS.map((p) => [p, DISCRETE])) as { readonly [P in (typeof ANIMATION_EXTRA_LONGHANDS)[number]]: AnimationKind };
