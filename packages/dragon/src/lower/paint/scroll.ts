// Seam (EMS): overflow auto and scroll: scroll containers (OVFL). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const SCROLL_LOWERING: PaintLowering<never> = stubLowering('scroll');
