// The shadow family's legacy alias (aliases.ts): Chrome 145 css_properties.json5 alias_for (line 9776). BoxShadow's parse ignores
// UseAliasParsing, so -webkit-box-shadow parses and computes exactly as box-shadow.
import type { SHADOW_LONGHANDS } from '../properties/shadow.ts';

export const SHADOW_ALIASES = {
  '-webkit-box-shadow': 'box-shadow',
} as const satisfies { readonly [alias: string]: (typeof SHADOW_LONGHANDS)[number] };
