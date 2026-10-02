// Seam (EMS): box-shadow: outer and inset shadows drawn by Dragon (PNT1). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const SHADOW_LOWERING: PaintLowering<never> = stubLowering('shadow');
