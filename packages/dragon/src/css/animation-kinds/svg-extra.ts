// How the svg-extra longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import { SVG_EXTRA_LONGHANDS } from '../properties/svg-extra.ts';

// Chrome interpolates stop-opacity, flood-opacity and baseline-shift alone; Dragon accepts only initial values, so it admits no
// animation of them. The rest are keywords, discrete in Chrome (css_properties.json5 has no interpolable).
const INTERPOLABLE: readonly string[] = ['stop-opacity', 'flood-opacity', 'baseline-shift'];
export const SVG_EXTRA_ANIMATION = Object.fromEntries(SVG_EXTRA_LONGHANDS.map((p) => [p, INTERPOLABLE.includes(p) ? UNADMITTED : DISCRETE])) as { readonly [P in (typeof SVG_EXTRA_LONGHANDS)[number]]: AnimationKind };
