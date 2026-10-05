// How the radius family's longhands animate in Chrome 145 (animation-kinds.ts).
import type { AnimationKind } from './kinds.ts';
import type { RADIUS_LONGHANDS } from '../properties/radius.ts';

export const RADIUS_ANIMATION: { readonly [P in (typeof RADIUS_LONGHANDS)[number]]: AnimationKind } = {};
