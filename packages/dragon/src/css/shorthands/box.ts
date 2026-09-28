// css-box-4 §4 (margin), §5 (padding).
import type { ShorthandHandler } from './shared.ts';
import { fourSides } from './shared.ts';

export const BOX_SHORTHANDS = {
  margin: fourSides(['margin-top', 'margin-right', 'margin-bottom', 'margin-left']),
  padding: fourSides(['padding-top', 'padding-right', 'padding-bottom', 'padding-left']),
} as const satisfies { readonly [s: string]: ShorthandHandler };
