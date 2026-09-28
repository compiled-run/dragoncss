// Flow-relative properties (css-logical-1 §4-§6) and the inset shorthand (css-logical-1 §4.3). Dragon lays out horizontal-tb
// only (writing-mode stays refused), so each flow-relative longhand is a surrogate of one physical longhand per direction: it has
// no resolved value of its own, and expands (shorthands/logical.ts) into the physical longhands it maps to, which the cascade
// narrows to the element's own direction (analysis/logical.ts). They are therefore shorthands here, with no longhands.
import type { PropertyAspect } from '../properties.ts';

export const LOGICAL_LONGHANDS = [] as const;
export const LOGICAL_SHORTHANDS = [
  'inset', 'inset-inline', 'inset-block', 'inset-inline-start', 'inset-inline-end', 'inset-block-start', 'inset-block-end',
  'margin-inline', 'margin-block', 'margin-inline-start', 'margin-inline-end', 'margin-block-start', 'margin-block-end',
  'padding-inline', 'padding-block', 'padding-inline-start', 'padding-inline-end', 'padding-block-start', 'padding-block-end',
  'border-inline', 'border-block', 'border-inline-start', 'border-inline-end', 'border-block-start', 'border-block-end',
  'border-inline-width', 'border-inline-style', 'border-inline-color', 'border-block-width', 'border-block-style', 'border-block-color',
  'border-inline-start-width', 'border-inline-start-style', 'border-inline-start-color',
  'border-inline-end-width', 'border-inline-end-style', 'border-inline-end-color',
  'border-block-start-width', 'border-block-start-style', 'border-block-start-color',
  'border-block-end-width', 'border-block-end-style', 'border-block-end-color',
  'inline-size', 'block-size', 'min-inline-size', 'min-block-size', 'max-inline-size', 'max-block-size',
] as const;
export const LOGICAL_INHERITED: readonly (typeof LOGICAL_LONGHANDS)[number][] = [];
export const LOGICAL_CONTAINER: readonly (typeof LOGICAL_LONGHANDS)[number][] = [];
export const LOGICAL_TEXT_ROLE: readonly (typeof LOGICAL_LONGHANDS)[number][] = [];

export const LOGICAL_ASPECTS: { readonly [P in (typeof LOGICAL_LONGHANDS)[number]]: PropertyAspect } = {};
