// Seam (EMS): the transform paint module's emission; no writes or native code until its package fills it (notes/T046-paint-spec.md §4).
import type { PaintEmitter } from './types.ts';
import { stubEmitter } from './types.ts';

export const TRANSFORM_EMITTER: PaintEmitter<never> = stubEmitter('transform');
