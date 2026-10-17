// SVG paint (SVG-a1, docs/goals/milestone-2-proof/notes/T-svg-a-spec.md): fill, stroke and stroke-width (css-fill-stroke-3),
// inherited, painted on the shapes of
// an inline <svg>, and (SVG-opacity) fill-opacity and stroke-opacity, inherited <opacity-value>s that scale the alpha of the fill
// and stroke paint, and (SVG-stroke) stroke-linecap, stroke-linejoin, stroke-miterlimit and fill-rule, inherited, the cap, join
// and fill rule the shapes are drawn with, and (SVG-dash) stroke-dasharray and stroke-dashoffset, inherited, the dash pattern of
// the stroke (svg-dash.ts parses the list), and (SVG-geometry) cx, cy, r, x and y, not inherited, the geometry of a <circle> and a
// <rect> (SVG 2 §10.3, §10.4; their attributes are presentation hints, elements/svg.ts), and (SVG-paint-order) paint-order,
// inherited, whether a shape paints its stroke before its fill (svg-paint-order.ts parses the list). fill and stroke take a <color> or none; paint servers and the context-* keywords wait for SVG-paint, and a
// stroke-width other than a px length or a unitless number (Chrome's SVG quirk) waits for SVG-units.
import type { PropertyAspect } from '../properties.ts';

export const SVG_LONGHANDS = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'stroke-dasharray', 'stroke-dashoffset', 'cx', 'cy', 'r', 'x', 'y', 'paint-order'] as const;
export const SVG_SHORTHANDS = [] as const;
/** The SVG geometry properties: a shape's position and size, which no element inherits. */
export const SVG_GEOMETRY_PROPERTIES = ['cx', 'cy', 'r', 'x', 'y'] as const;
export const SVG_INHERITED: readonly (typeof SVG_LONGHANDS)[number][] = SVG_LONGHANDS.filter((p) => !(SVG_GEOMETRY_PROPERTIES as readonly string[]).includes(p));
export const SVG_CONTAINER: readonly (typeof SVG_LONGHANDS)[number][] = [];
export const SVG_TEXT_ROLE: readonly (typeof SVG_LONGHANDS)[number][] = [];

export const SVG_ASPECTS: { readonly [P in (typeof SVG_LONGHANDS)[number]]: PropertyAspect } = {
  fill: { layout: false, paint: true },
  stroke: { layout: false, paint: true },
  'stroke-width': { layout: false, paint: true },
  'fill-opacity': { layout: false, paint: true },
  'stroke-opacity': { layout: false, paint: true },
  'stroke-linecap': { layout: false, paint: true },
  'stroke-linejoin': { layout: false, paint: true },
  'stroke-miterlimit': { layout: false, paint: true },
  'fill-rule': { layout: false, paint: true },
  'stroke-dasharray': { layout: false, paint: true },
  'stroke-dashoffset': { layout: false, paint: true },
  cx: { layout: false, paint: true },
  cy: { layout: false, paint: true },
  r: { layout: false, paint: true },
  x: { layout: false, paint: true },
  y: { layout: false, paint: true },
  'paint-order': { layout: false, paint: true },
};

/** The SVG paint properties whose value is a <color> or none. */
export const SVG_PAINT_PROPERTIES: ReadonlySet<string> = new Set(['fill', 'stroke']);
