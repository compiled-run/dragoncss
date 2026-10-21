// How the svg family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { SVG_LONGHANDS } from '../properties/svg.ts';

export const SVG_ANIMATION: { readonly [P in (typeof SVG_LONGHANDS)[number]]: AnimationKind } = {
  // SVG-a1: all three interpolate in Chrome; no shape writer exists until SVG-a2 and an animation package admit them.
  fill: UNADMITTED,
  stroke: UNADMITTED,
  'stroke-width': UNADMITTED,
  // SVG-opacity: both interpolate in Chrome as numbers; no animation package admits them yet.
  'fill-opacity': UNADMITTED,
  'stroke-opacity': UNADMITTED,
  // SVG-stroke: the cap, join and fill rule are keywords (discrete); stroke-miterlimit interpolates in Chrome as a number
  // (css_properties.json5 interpolable), and no animation package admits it yet.
  'stroke-linecap': DISCRETE,
  'stroke-linejoin': DISCRETE,
  'stroke-miterlimit': UNADMITTED,
  'fill-rule': DISCRETE,
  // SVG-dash: both interpolate in Chrome (css_properties.json5 interpolable); no animation package admits them yet.
  'stroke-dasharray': UNADMITTED,
  'stroke-dashoffset': UNADMITTED,
  // SVG-geometry: all five interpolate in Chrome (css_properties.json5 interpolable); no animation package admits them yet.
  cx: UNADMITTED,
  cy: UNADMITTED,
  r: UNADMITTED,
  x: UNADMITTED,
  y: UNADMITTED,
  // SVG-paint-order: a keyword list, discrete in Chrome (css_properties.json5 has no interpolable).
  'paint-order': DISCRETE,
  // SVG-rrect: both interpolate in Chrome (css_properties.json5 interpolable); no animation package admits them yet.
  rx: UNADMITTED,
  ry: UNADMITTED,
  // SVG-vector-effect: a keyword, discrete in Chrome (css_properties.json5 has no interpolable).
  'vector-effect': DISCRETE,
  // SVG-inert: all four are keywords or url references, discrete in Chrome (css_properties.json5 has no interpolable).
  'clip-rule': DISCRETE,
  'marker-start': DISCRETE,
  'marker-mid': DISCRETE,
  'marker-end': DISCRETE,
  // SVG-inert-b: the colours and opacities interpolate in Chrome (css_properties.json5 interpolable), and no animation package
  // admits them; mask-type, text-anchor and the baselines are keywords, discrete in Chrome.
  'stop-color': UNADMITTED,
  'stop-opacity': UNADMITTED,
  'flood-color': UNADMITTED,
  'flood-opacity': UNADMITTED,
  'lighting-color': UNADMITTED,
  'mask-type': DISCRETE,
  'text-anchor': DISCRETE,
  'dominant-baseline': DISCRETE,
  'alignment-baseline': DISCRETE,
};
