// How the scroll-padding, scroll-margin and scroll-snap longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import { SCROLL_SNAP_LONGHANDS } from '../properties/scroll-snap.ts';

// interpolable: false in css_properties.json5, so each animates discretely.
export const SCROLL_SNAP_ANIMATION = Object.fromEntries(SCROLL_SNAP_LONGHANDS.map((p) => [p, DISCRETE])) as { readonly [P in (typeof SCROLL_SNAP_LONGHANDS)[number]]: AnimationKind };
