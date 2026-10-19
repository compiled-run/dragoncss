// The border image family's shorthands (properties/border-image.ts): border-image and -webkit-border-image over the five border
// image longhands, as Chrome 145 registers border-image (css_properties.json5) and applies -webkit-border-image.
import { BORDER_IMAGE_LONGHANDS } from '../properties/border-image.ts';
import type { ShorthandHandler } from './shared.ts';

// A non-CSS-wide value never reaches expand: the paint value hook parses it (properties/border-image.ts).
const hooked = (): never => {
  throw new Error('border image values are parsed by the paint value hook (css/paint-parsers.ts)');
};

export const BORDER_IMAGE_SHORTHANDS = {
  'border-image': { longhands: BORDER_IMAGE_LONGHANDS, expand: hooked },
  '-webkit-border-image': { longhands: BORDER_IMAGE_LONGHANDS, expand: hooked },
} as const satisfies { readonly [s: string]: ShorthandHandler };
