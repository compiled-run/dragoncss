// Seam (EMS): replaced images (REPL, T051). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const IMAGE_LOWERING: PaintLowering<never> = stubLowering('image');
