// Seam (EMS): position: fixed against the viewport (POSX-f). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const FIXED_LOWERING: PaintLowering<never> = stubLowering('fixed');
