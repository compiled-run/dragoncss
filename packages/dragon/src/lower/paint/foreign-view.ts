// Seam (EMS): foreign platform views in a Dragon-sized slot (REPL, T051). No writes until its package fills it.
import type { PaintLowering } from './types.ts';
import { stubLowering } from './types.ts';

export const FOREIGN_VIEW_LOWERING: PaintLowering<never> = stubLowering('foreign-view');
