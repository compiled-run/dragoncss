// The role module (P6b) paints nothing: a heading's lines are proven by their accessibility readback, not by pixels.
import type { PaintSamples } from './types.ts';
import { stubPaintSamples } from './types.ts';

export const ROLE_SAMPLES: PaintSamples = stubPaintSamples('role');
