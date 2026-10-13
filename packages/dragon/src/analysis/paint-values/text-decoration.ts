// Seam (EMS): the text-decoration module's paint values. The decoration longhands compute in analysis/computed.ts and propagate in
// analysis/text-decoration.ts; analysis/computed-checks.ts checkDecorations rules on them per target (TDEC-a, TDEC-b).
import type { PaintValues } from './types.ts';
import { stubPaintValues } from './types.ts';

export const TEXT_DECORATION_VALUES: PaintValues = stubPaintValues('text-decoration');
