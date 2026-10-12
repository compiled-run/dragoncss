// The radius family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for. The corners parse alike
// (ParseBorderRadiusCorner); -webkit-border-radius is the family's own shorthand (properties/radius.ts).
import type { RADIUS_LONGHANDS } from '../properties/radius.ts';

export const RADIUS_ALIASES = {
  '-webkit-border-bottom-left-radius': 'border-bottom-left-radius',
  '-webkit-border-bottom-right-radius': 'border-bottom-right-radius',
  '-webkit-border-top-left-radius': 'border-top-left-radius',
  '-webkit-border-top-right-radius': 'border-top-right-radius',
} as const satisfies { readonly [alias: string]: (typeof RADIUS_LONGHANDS)[number] };
