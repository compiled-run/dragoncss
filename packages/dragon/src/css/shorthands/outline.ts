// css-ui-4 §3.1: outline sets outline-color, outline-style and outline-width (not outline-offset). Its values are parsed by the
// paint value hook (css/paint-parsers.ts parseOutline); a CSS-wide keyword sets each of the three.
import type { ShorthandHandler } from './shared.ts';

export const OUTLINE_SHORTHANDS = {
  outline: {
    longhands: ['outline-color', 'outline-style', 'outline-width'],
    // A non-CSS-wide value never reaches expand: the paint value hook parses it (parseOutline).
    expand: () => {
      throw new Error('outline values are parsed by the paint value hook (css/paint-parsers.ts)');
    },
  },
} as const satisfies { readonly [s: string]: ShorthandHandler };
