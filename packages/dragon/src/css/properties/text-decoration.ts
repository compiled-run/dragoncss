// Text decoration (css-text-decor-3 §2-§4, css-text-decor-4 §2.4-§2.6), as Chromium 145's css_properties.json5 defines the longhands
// (inheritance and initial values). Decorations paint and never move a box, so every longhand has the paint aspect only.
import type { PropertyAspect } from '../properties.ts';

export const TEXT_DECORATION_LONGHANDS = [
  'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness',
  'text-underline-offset', 'text-underline-position', 'text-decoration-skip-ink',
] as const;
export const TEXT_DECORATION_SHORTHANDS = ['text-decoration'] as const;
export const TEXT_DECORATION_INHERITED: readonly (typeof TEXT_DECORATION_LONGHANDS)[number][] = ['text-underline-offset', 'text-underline-position', 'text-decoration-skip-ink'];
export const TEXT_DECORATION_CONTAINER: readonly (typeof TEXT_DECORATION_LONGHANDS)[number][] = [];
export const TEXT_DECORATION_TEXT_ROLE: readonly (typeof TEXT_DECORATION_LONGHANDS)[number][] = [];

export const TEXT_DECORATION_ASPECTS: { readonly [P in (typeof TEXT_DECORATION_LONGHANDS)[number]]: PropertyAspect } = {
  'text-decoration-line': { layout: false, paint: true },
  'text-decoration-style': { layout: false, paint: true },
  'text-decoration-color': { layout: false, paint: true },
  'text-decoration-thickness': { layout: false, paint: true },
  'text-underline-offset': { layout: false, paint: true },
  'text-underline-position': { layout: false, paint: true },
  'text-decoration-skip-ink': { layout: false, paint: true },
};

/** The decoration lines, in the order Chrome 145 serializes text-decoration-line. */
export const DECORATION_LINES = ['underline', 'overline', 'line-through'] as const;
export type DecorationLine = (typeof DECORATION_LINES)[number];
