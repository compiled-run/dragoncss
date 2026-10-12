// The visibility module's sample points (notes/T150-visibility-spec.md §6): none of its own. A box that is not visible keeps every
// base point (interior, border, outside, edge and glyph) and the shadow and outline modules' points, and Chrome shows the backdrop
// at each of them, so the device must too; the points of its visible descendants show their own paint.
import type { PaintSamples } from './types.ts';
import { stubPaintSamples } from './types.ts';

export const VISIBILITY_SAMPLES: PaintSamples = stubPaintSamples('visibility');
