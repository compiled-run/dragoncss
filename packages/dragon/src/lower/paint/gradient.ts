// Seam (EMS): gradient background layers, rasterised by Dragon (BG2). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const GRADIENT_LOWERING: PaintLowering<never> = stubLowering('gradient');
