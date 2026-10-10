// The transform family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for. -webkit-transform also parses a
// unitless perspective() length (css_parsing_utils.cc ConsumePerspective, UseAliasParsing); legacyAliasRefusal covers that.
import type { TRANSFORM_LONGHANDS } from '../properties/transform.ts';

export const TRANSFORM_ALIASES = {
  '-webkit-transform': 'transform',
  '-webkit-transform-origin': 'transform-origin',
} as const satisfies { readonly [alias: string]: (typeof TRANSFORM_LONGHANDS)[number] };
