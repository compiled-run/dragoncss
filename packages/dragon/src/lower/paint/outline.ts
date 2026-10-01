// Seam (EMS): outline, drawn by Dragon outside the border box (PNT1). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const OUTLINE_LOWERING: PaintLowering<never> = stubLowering('outline');
