// MISC-PAINT: the border image (nine-piece) entry points of the paint-gradient seam, re-exported on their own line of index.ts so
// the seam's pinned export lines (paint-seams.test.ts) stay the gradient background's. The code lives in paint-gradient.ts, the
// translated paint root the device runs (planBorderImage, ported from Blink nine_piece_image_painter.cc / nine_piece_image_grid.cc).
export type { BorderImageLength, BorderImagePaint, BorderImageSlice } from './paint-gradient.ts';
export { borderImageStopsModelled, planBorderImage } from './paint-gradient.ts';
