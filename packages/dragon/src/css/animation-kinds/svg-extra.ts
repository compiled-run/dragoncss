// How the svg-extra longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import { SVG_EXTRA_LONGHANDS } from '../properties/svg-extra.ts';

// Chrome interpolates baseline-shift alone of these; Dragon accepts only its initial value, so it admits no animation of it. The
// rest are keywords, discrete in Chrome (css_properties.json5 has no interpolable).
const INTERPOLABLE: readonly string[] = ['baseline-shift'];
export const SVG_EXTRA_ANIMATION = Object.fromEntries(SVG_EXTRA_LONGHANDS.map((p) => [p, INTERPOLABLE.includes(p) ? UNADMITTED : DISCRETE])) as { readonly [P in (typeof SVG_EXTRA_LONGHANDS)[number]]: AnimationKind };
