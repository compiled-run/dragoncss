// Seam (EMS): CSS2 Appendix E paint order and hosting under stacking contexts (PNT1). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const STACKING_LOWERING: PaintLowering<never> = stubLowering('stacking');
