// How the view transition longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import { VIEW_TRANSITION_LONGHANDS } from '../properties/view-transition.ts';

// interpolable: false in css_properties.json5, so each animates discretely.
export const VIEW_TRANSITION_ANIMATION = Object.fromEntries(VIEW_TRANSITION_LONGHANDS.map((p) => [p, DISCRETE])) as { readonly [P in (typeof VIEW_TRANSITION_LONGHANDS)[number]]: AnimationKind };
