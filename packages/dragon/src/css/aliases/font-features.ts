// The font-features family's legacy alias (aliases.ts): Chrome 145 css_properties.json5 alias_for (line 9857), without
// UseAliasParsing, so -webkit-font-feature-settings parses as font-feature-settings.
import type { FONT_FEATURES_LONGHANDS } from '../properties/font-features.ts';

export const FONT_FEATURES_ALIASES = {
  '-webkit-font-feature-settings': 'font-feature-settings',
} as const satisfies { readonly [alias: string]: (typeof FONT_FEATURES_LONGHANDS)[number] };
