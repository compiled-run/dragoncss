// The multicol family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for. None of their properties parses
// with UseAliasParsing (probed: each alias serializes as its property for auto, lengths, unitless numbers, counts, rules and the
// columns pairs), so each parses exactly as its property. -webkit-column-gap is the flex family's (aliases/flex.ts), and Chrome
// has no -webkit-column-fill.
import type { MULTICOL_LONGHANDS, MULTICOL_SHORTHANDS } from '../properties/multicol.ts';

export const MULTICOL_ALIASES = {
  '-webkit-column-count': 'column-count',
  '-webkit-column-rule': 'column-rule',
  '-webkit-column-rule-color': 'column-rule-color',
  '-webkit-column-rule-style': 'column-rule-style',
  '-webkit-column-rule-width': 'column-rule-width',
  '-webkit-column-span': 'column-span',
  '-webkit-column-width': 'column-width',
  '-webkit-columns': 'columns',
} as const satisfies { readonly [alias: string]: (typeof MULTICOL_LONGHANDS)[number] | (typeof MULTICOL_SHORTHANDS)[number] };
