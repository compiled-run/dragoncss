// The appearance family's legacy alias (aliases.ts): Chrome 145 css_properties.json5 alias_for, parsed as appearance for every keyword
// Dragon accepts (packages/parity/test/appearance-parse.test.ts).
import type { APPEARANCE_LONGHANDS } from '../properties/appearance.ts';

export const APPEARANCE_ALIASES = {
  '-webkit-appearance': 'appearance',
} as const satisfies { readonly [alias: string]: (typeof APPEARANCE_LONGHANDS)[number] };
