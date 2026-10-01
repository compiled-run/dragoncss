// Seam (EMS): scrollbar-color and scrollbar-width (OVFL-S). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const SCROLLBAR_LOWERING: PaintLowering<never> = stubLowering('scrollbar');
