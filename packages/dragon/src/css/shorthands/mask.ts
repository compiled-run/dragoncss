// The mask family's shorthands (properties/mask.ts): mask over the nine mask layer longhands, and mask-position over
// -webkit-mask-position-x and -y, as Chrome 145 registers them (css_properties.json5).
import { MASK_LONGHANDS } from '../properties/mask.ts';
import type { ShorthandHandler } from './shared.ts';

// A non-CSS-wide value never reaches expand: the paint value hook parses it (parseMask, parseMaskPosition).
const hooked = (): never => {
  throw new Error('mask values are parsed by the paint value hook (css/paint-parsers.ts)');
};

export const MASK_SHORTHANDS = {
  mask: { longhands: MASK_LONGHANDS, expand: hooked },
  'mask-position': { longhands: ['-webkit-mask-position-x', '-webkit-mask-position-y'], expand: hooked },
} as const satisfies { readonly [s: string]: ShorthandHandler };
