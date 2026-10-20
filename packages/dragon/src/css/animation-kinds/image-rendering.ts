// How image-rendering animates in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { IMAGE_RENDERING_LONGHANDS } from '../properties/image-rendering.ts';

// interpolable: false in css_properties.json5, so it animates discretely.
export const IMAGE_RENDERING_ANIMATION: { readonly [P in (typeof IMAGE_RENDERING_LONGHANDS)[number]]: AnimationKind } = { 'image-rendering': DISCRETE };
