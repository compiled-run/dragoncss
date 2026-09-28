// css-overflow-3 §3: overflow sets overflow-x and overflow-y; one value sets both.
import type { ShorthandHandler } from './shared.ts';
import { twoAxes } from './shared.ts';

export const OVERFLOW_SHORTHANDS = {
  overflow: twoAxes(['overflow-x', 'overflow-y']),
} as const satisfies { readonly [s: string]: ShorthandHandler };
