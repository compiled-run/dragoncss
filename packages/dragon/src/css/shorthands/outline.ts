// Seam (EMS): the outline (css-ui-4 §3.1; PNT1) shorthand handlers; empty until its package fills it.
import type { ShorthandHandler } from './shared.ts';

export const OUTLINE_SHORTHANDS = {} as const satisfies { readonly [s: string]: ShorthandHandler };
