// SVG paint (SVG-a1, /tmp/specs/svg-a.md): fill, stroke and stroke-width (css-fill-stroke-3), inherited, painted on the shapes of
// an inline <svg>. fill and stroke take a <color> or none; paint servers and the context-* keywords wait for SVG-paint, and a
// stroke-width other than a px length or a unitless number (Chrome's SVG quirk) waits for SVG-units.
import type { PropertyAspect } from '../properties.ts';

export const SVG_LONGHANDS = ['fill', 'stroke', 'stroke-width'] as const;
export const SVG_SHORTHANDS = [] as const;
export const SVG_INHERITED: readonly (typeof SVG_LONGHANDS)[number][] = ['fill', 'stroke', 'stroke-width'];
export const SVG_CONTAINER: readonly (typeof SVG_LONGHANDS)[number][] = [];
export const SVG_TEXT_ROLE: readonly (typeof SVG_LONGHANDS)[number][] = [];

export const SVG_ASPECTS: { readonly [P in (typeof SVG_LONGHANDS)[number]]: PropertyAspect } = {
  fill: { layout: false, paint: true },
  stroke: { layout: false, paint: true },
  'stroke-width': { layout: false, paint: true },
};

/** The SVG paint properties whose value is a <color> or none. */
export const SVG_PAINT_PROPERTIES: ReadonlySet<string> = new Set(['fill', 'stroke']);
