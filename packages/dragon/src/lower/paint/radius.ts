// Seam (EMS): border-radius: the eight radii and the rounded border and clip paths (PNT1). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const RADIUS_LOWERING: PaintLowering<never> = stubLowering('radius');
