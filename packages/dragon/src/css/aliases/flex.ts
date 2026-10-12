// The flex family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for.
import type { FLEX_LONGHANDS, FLEX_SHORTHANDS } from '../properties/flex.ts';

export const FLEX_ALIASES = {
  '-webkit-align-content': 'align-content',
  '-webkit-align-items': 'align-items',
  '-webkit-align-self': 'align-self',
  '-webkit-column-gap': 'column-gap',
  '-webkit-flex': 'flex',
  '-webkit-flex-basis': 'flex-basis',
  '-webkit-flex-direction': 'flex-direction',
  '-webkit-flex-flow': 'flex-flow',
  '-webkit-flex-grow': 'flex-grow',
  '-webkit-flex-shrink': 'flex-shrink',
  '-webkit-flex-wrap': 'flex-wrap',
  '-webkit-justify-content': 'justify-content',
  '-webkit-order': 'order',
} as const satisfies { readonly [alias: string]: (typeof FLEX_LONGHANDS)[number] | (typeof FLEX_SHORTHANDS)[number] };
