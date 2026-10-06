// css-ui-4 §3.1: outline sets outline-color, outline-style and outline-width (not outline-offset). Its values are parsed by the
// outline value parsers (css/properties/outline.ts parseOutline); a CSS-wide keyword sets each of the three.
import type { ShorthandHandler } from './shared.ts';

export const OUTLINE_SHORTHANDS = {
  outline: {
    longhands: ['outline-color', 'outline-style', 'outline-width'],
    // A non-CSS-wide value never reaches expand: stylesheet.ts parses it with parseOutline.
    expand: () => {
      throw new Error('outline values are parsed by css/properties/outline.ts parseOutline');
    },
  },
} as const satisfies { readonly [s: string]: ShorthandHandler };
