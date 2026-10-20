// The filter family's legacy alias (aliases.ts): Chrome 145 css_properties.json5 alias_for (line 9824). Filter's parse ignores
// UseAliasParsing (longhands_custom.cc Filter::ParseSingleValue), so -webkit-filter parses and computes exactly as filter.
import type { FILTER_LONGHANDS } from '../properties/filter.ts';

export const FILTER_ALIASES = {
  '-webkit-filter': 'filter',
} as const satisfies { readonly [alias: string]: (typeof FILTER_LONGHANDS)[number] };
