// Flex layout and box alignment (css-flexbox-1, css-align-3).
import type { PropertyAspect } from '../properties.ts';

export const FLEX_LONGHANDS = [
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'justify-content', 'align-items', 'align-self', 'align-content', 'row-gap', 'column-gap',
] as const;
export const FLEX_SHORTHANDS = ['flex', 'flex-flow', 'gap'] as const;
export const FLEX_INHERITED: readonly (typeof FLEX_LONGHANDS)[number][] = [];
export const FLEX_CONTAINER: readonly (typeof FLEX_LONGHANDS)[number][] = ['flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'row-gap', 'column-gap'];
export const FLEX_TEXT_ROLE: readonly (typeof FLEX_LONGHANDS)[number][] = [];

export const FLEX_ASPECTS: { readonly [P in (typeof FLEX_LONGHANDS)[number]]: PropertyAspect } = {
  'flex-direction': { layout: true, paint: false },
  'flex-wrap': { layout: true, paint: false },
  'flex-grow': { layout: true, paint: false },
  'flex-shrink': { layout: true, paint: false },
  'flex-basis': { layout: true, paint: false },
  order: { layout: true, paint: false },
  'justify-content': { layout: true, paint: false },
  'align-items': { layout: true, paint: false },
  'align-self': { layout: true, paint: false },
  'align-content': { layout: true, paint: false },
  'row-gap': { layout: true, paint: false },
  'column-gap': { layout: true, paint: false },
};
