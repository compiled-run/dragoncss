// How the container-type and container-name animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import { CONTAINER_QUERY_LONGHANDS } from '../properties/container-query.ts';

// interpolable: false in css_properties.json5, so each would animate discretely; Chrome 145 ignores both in @keyframes (at-rules/keyframes.ts).
export const CONTAINER_QUERY_ANIMATION = Object.fromEntries(CONTAINER_QUERY_LONGHANDS.map((p) => [p, DISCRETE])) as { readonly [P in (typeof CONTAINER_QUERY_LONGHANDS)[number]]: AnimationKind };
