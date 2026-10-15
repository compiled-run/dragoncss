// The effects family's legacy alias (aliases.ts): Chrome 145 css_properties.json5 alias_for (line 9868). Opacity's parse ignores
// UseAliasParsing, so -webkit-opacity parses as opacity, and native refuses the same fractions.
import type { EFFECTS_LONGHANDS } from '../properties/effects.ts';

export const EFFECTS_ALIASES = {
  '-webkit-opacity': 'opacity',
} as const satisfies { readonly [alias: string]: (typeof EFFECTS_LONGHANDS)[number] };
