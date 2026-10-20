// How the overscroll-behavior and overflow-anchor animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import { OVERSCROLL_LONGHANDS } from '../properties/overscroll.ts';

// interpolable: false in css_properties.json5, so each animates discretely.
export const OVERSCROLL_ANIMATION = Object.fromEntries(OVERSCROLL_LONGHANDS.map((p) => [p, DISCRETE])) as { readonly [P in (typeof OVERSCROLL_LONGHANDS)[number]]: AnimationKind };
