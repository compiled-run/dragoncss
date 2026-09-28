// Borders (css-backgrounds-3 §3).
import type { PropertyAspect } from '../properties.ts';

export const BORDER_LONGHANDS = [
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
] as const;
export const BORDER_SHORTHANDS = ['border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style', 'border-color'] as const;
export const BORDER_INHERITED: readonly (typeof BORDER_LONGHANDS)[number][] = [];
export const BORDER_CONTAINER: readonly (typeof BORDER_LONGHANDS)[number][] = [];
export const BORDER_TEXT_ROLE: readonly (typeof BORDER_LONGHANDS)[number][] = [];

/** border-*-style is both layout and paint: none/hidden zero the border width, and every other style paints. */
export const BORDER_ASPECTS: { readonly [P in (typeof BORDER_LONGHANDS)[number]]: PropertyAspect } = {
  'border-top-width': { layout: true, paint: false },
  'border-right-width': { layout: true, paint: false },
  'border-bottom-width': { layout: true, paint: false },
  'border-left-width': { layout: true, paint: false },
  'border-top-style': { layout: true, paint: true },
  'border-right-style': { layout: true, paint: true },
  'border-bottom-style': { layout: true, paint: true },
  'border-left-style': { layout: true, paint: true },
  'border-top-color': { layout: false, paint: true },
  'border-right-color': { layout: false, paint: true },
  'border-bottom-color': { layout: false, paint: true },
  'border-left-color': { layout: false, paint: true },
};
