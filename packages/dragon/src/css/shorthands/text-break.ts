// word-wrap: Chrome's legacy alias of overflow-wrap (css-text-3 §5.5), a shorthand of that one longhand, as grid-row-gap is of row-gap.
import type { CssValue } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit } from './shared.ts';

export const TEXT_BREAK_SHORTHANDS = {
  'word-wrap': { longhands: ['overflow-wrap'], expand: (values) => [explicit('overflow-wrap', values[0] as CssValue)] },
} as const satisfies { readonly [s: string]: ShorthandHandler };
