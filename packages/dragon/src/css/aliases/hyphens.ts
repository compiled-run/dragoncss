// The hyphens family's legacy alias (aliases.ts): Chrome 145 css_properties.json5 alias_for.
import type { HYPHENS_LONGHANDS } from '../properties/hyphens.ts';

export const HYPHENS_ALIASES = {
  '-webkit-hyphens': 'hyphens',
} as const satisfies { readonly [alias: string]: (typeof HYPHENS_LONGHANDS)[number] };
