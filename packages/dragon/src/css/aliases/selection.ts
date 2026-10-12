// The selection family's legacy alias (aliases.ts): Chrome 145 css_properties.json5 alias_for (line 9948), parsed as user-select.
import type { SELECTION_LONGHANDS } from '../properties/selection.ts';

export const SELECTION_ALIASES = {
  '-webkit-user-select': 'user-select',
} as const satisfies { readonly [alias: string]: (typeof SELECTION_LONGHANDS)[number] };
