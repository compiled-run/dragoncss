// How the anchor positioning longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import { ANCHOR_POSITION_LONGHANDS } from '../properties/anchor-position.ts';

// interpolable: false in css_properties.json5, so each animates discretely.
export const ANCHOR_POSITION_ANIMATION = Object.fromEntries(ANCHOR_POSITION_LONGHANDS.map((p) => [p, DISCRETE])) as { readonly [P in (typeof ANCHOR_POSITION_LONGHANDS)[number]]: AnimationKind };
