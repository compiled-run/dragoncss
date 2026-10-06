// The box family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for.
import type { BOX_LONGHANDS } from '../properties/box.ts';

export const BOX_ALIASES = {
  '-webkit-box-sizing': 'box-sizing',
} as const satisfies { readonly [alias: string]: (typeof BOX_LONGHANDS)[number] };
