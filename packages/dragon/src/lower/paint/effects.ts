// Seam (EMS): opacity, z-index and color-scheme (PNT1). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const EFFECTS_LOWERING: PaintLowering<never> = stubLowering('effects');
