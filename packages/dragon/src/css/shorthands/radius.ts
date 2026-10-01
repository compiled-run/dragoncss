// Seam (EMS): the border-radius (css-backgrounds-3 §5.1; PNT1) shorthand handlers; empty until its package fills it.
import type { ShorthandHandler } from './shared.ts';

export const RADIUS_SHORTHANDS = {} as const satisfies { readonly [s: string]: ShorthandHandler };
