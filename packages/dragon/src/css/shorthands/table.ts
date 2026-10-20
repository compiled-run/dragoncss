// CSS2 §17.6.1: border-spacing sets the horizontal then the vertical spacing; one length sets both (Blink BorderSpacing::ParseShorthand).
import type { ShorthandHandler } from './shared.ts';
import { twoAxes } from './shared.ts';

export const TABLE_SHORTHANDS = {
  'border-spacing': twoAxes(['-webkit-border-horizontal-spacing', '-webkit-border-vertical-spacing']),
} as const satisfies { readonly [s: string]: ShorthandHandler };
