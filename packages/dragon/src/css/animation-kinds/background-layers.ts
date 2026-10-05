// How the background-layers family's longhands animate in Chrome 145 (animation-kinds.ts).
import type { AnimationKind } from './kinds.ts';
import type { BACKGROUND_LAYERS_LONGHANDS } from '../properties/background-layers.ts';

export const BACKGROUND_LAYERS_ANIMATION: { readonly [P in (typeof BACKGROUND_LAYERS_LONGHANDS)[number]]: AnimationKind } = {};
