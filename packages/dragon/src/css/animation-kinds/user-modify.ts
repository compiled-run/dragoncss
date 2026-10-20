// How the -webkit-user-modify longhand animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { USER_MODIFY_LONGHANDS } from '../properties/user-modify.ts';

export const USER_MODIFY_ANIMATION: { readonly [P in (typeof USER_MODIFY_LONGHANDS)[number]]: AnimationKind } = {
  '-webkit-user-modify': DISCRETE,
};
