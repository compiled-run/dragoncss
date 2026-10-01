// Seam (EMS): transform and transform-origin, resolved by Dragon and set as the native view transform (PNT2). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const TRANSFORM_LOWERING: PaintLowering<never> = stubLowering('transform');
