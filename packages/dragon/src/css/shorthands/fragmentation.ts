// css-break-3 §3.4 and Blink's WebkitColumnBreak*::ParseShorthand: the legacy break shorthands, each over one break longhand
// (css/properties/fragmentation.ts).
import { FRAGMENTATION_SHORTHAND_LONGHAND } from '../properties/fragmentation.ts';
import type { ShorthandHandler } from './shared.ts';

// A non-CSS-wide value never reaches expand: the paint value hook parses it (css/paint-parsers.ts).
const hooked = (): never => {
  throw new Error('fragmentation shorthand values are parsed by the paint value hook (css/paint-parsers.ts)');
};

export const FRAGMENTATION_SHORTHANDS = {
  'page-break-before': { longhands: [FRAGMENTATION_SHORTHAND_LONGHAND['page-break-before']], expand: hooked },
  'page-break-after': { longhands: [FRAGMENTATION_SHORTHAND_LONGHAND['page-break-after']], expand: hooked },
  'page-break-inside': { longhands: [FRAGMENTATION_SHORTHAND_LONGHAND['page-break-inside']], expand: hooked },
  '-webkit-column-break-before': { longhands: [FRAGMENTATION_SHORTHAND_LONGHAND['-webkit-column-break-before']], expand: hooked },
  '-webkit-column-break-after': { longhands: [FRAGMENTATION_SHORTHAND_LONGHAND['-webkit-column-break-after']], expand: hooked },
  '-webkit-column-break-inside': { longhands: [FRAGMENTATION_SHORTHAND_LONGHAND['-webkit-column-break-inside']], expand: hooked },
} as const satisfies { readonly [s: string]: ShorthandHandler };
