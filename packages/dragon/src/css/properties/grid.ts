// Grid (css-grid-2) and the justify-* alignment longhands (css-align-3 §6.1, §6.2). The compiler reads them; grid layout itself is
// refused (display: grid has no profile row) until the grid engine lands.
import type { PropertyAspect } from '../properties.ts';

export const GRID_LONGHANDS = [
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
  'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end',
  'justify-items', 'justify-self',
] as const;
/** grid-gap, grid-row-gap and grid-column-gap are Chrome's legacy aliases of gap, row-gap and column-gap (css-align-3 §8.5). */
export const GRID_SHORTHANDS = ['grid', 'grid-template', 'grid-row', 'grid-column', 'grid-area', 'grid-gap', 'grid-row-gap', 'grid-column-gap', 'place-content', 'place-items', 'place-self'] as const;
export const GRID_INHERITED: readonly (typeof GRID_LONGHANDS)[number][] = [];
export const GRID_CONTAINER: readonly (typeof GRID_LONGHANDS)[number][] = ['grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow', 'justify-items'];
export const GRID_TEXT_ROLE: readonly (typeof GRID_LONGHANDS)[number][] = [];

export const GRID_ASPECTS: { readonly [P in (typeof GRID_LONGHANDS)[number]]: PropertyAspect } = {
  'grid-template-columns': { layout: true, paint: false },
  'grid-template-rows': { layout: true, paint: false },
  'grid-template-areas': { layout: true, paint: false },
  'grid-auto-columns': { layout: true, paint: false },
  'grid-auto-rows': { layout: true, paint: false },
  'grid-auto-flow': { layout: true, paint: false },
  'grid-row-start': { layout: true, paint: false },
  'grid-row-end': { layout: true, paint: false },
  'grid-column-start': { layout: true, paint: false },
  'grid-column-end': { layout: true, paint: false },
  'justify-items': { layout: true, paint: false },
  'justify-self': { layout: true, paint: false },
};
