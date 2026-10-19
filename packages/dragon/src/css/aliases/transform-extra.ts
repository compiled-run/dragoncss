// The 3D transform longhands' legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for (lines 9736 and 9924). Neither
// property parses with UseAliasParsing (both are keyword fields), so each alias parses and computes exactly as its property.
import type { TRANSFORM_EXTRA_LONGHANDS } from '../properties/transform-extra.ts';

export const TRANSFORM_EXTRA_ALIASES = {
  '-webkit-backface-visibility': 'backface-visibility',
  '-webkit-transform-style': 'transform-style',
} as const satisfies { readonly [alias: string]: (typeof TRANSFORM_EXTRA_LONGHANDS)[number] };
