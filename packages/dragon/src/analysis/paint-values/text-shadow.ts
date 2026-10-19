// Seam (EMS): the text-shadow module's paint values. text-shadow computes in css/properties/text-shadow.ts and inherits;
// analysis/text-shadow.ts checkTextShadows rules on it per target (TXT-FX).
import type { PaintValues } from './types.ts';
import { stubPaintValues } from './types.ts';

export const TEXT_SHADOW_VALUES: PaintValues = stubPaintValues('text-shadow');
