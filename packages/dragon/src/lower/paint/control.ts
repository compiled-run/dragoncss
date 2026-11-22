// Seam (EMS): form controls (FORM, T052). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const CONTROL_LOWERING: PaintLowering<never> = stubLowering('control');
