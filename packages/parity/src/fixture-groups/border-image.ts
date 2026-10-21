// Fixture group border-image (MISC-PAINT): every border image longhand at its initial value in Ahem, both directions, on bordered and
// padded boxes with backgrounds, through border-image: none, in another ASCII case, through -webkit-border-image (which sets no border
// width at none), through the CSS-wide keywords, on an inheriting child and on a flex row, so every target proves the initial values.
// border-image-gradient: part 1's gradient border images, drawn natively by the translated nine-piece port (paint-gradient.ts
// planBorderImage), in both directions: the coverage probe (linear-gradient(to right, red, blue) 1), slices in numbers and
// percentages with and without fill, widths in numbers, px and auto, overlapping widths, a slice past the image, a box with no
// border style (only the filled middle draws), a dashed border the image replaces, uneven and fractional borders, the longhands,
// a source of none with every other longhand set (the border style draws), an inherited border image and a box wider than one
// cc raster tile. The rejects: a radial-gradient() source and border-image-repeat round, which no target draws yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const BORDER_IMAGE: readonly FixtureSpec[] = [
  layout('border-image-initial', ['ltr', 'rtl']),
  layout('border-image-gradient', ['ltr', 'rtl']),
  reject('reject-border-image-source', 'DRAGON_UNSUPPORTED_VALUE', 'radial-gradient(red, blue)', 'border-image-source: radial-gradient(red,blue)'),
  reject('reject-border-image-repeat', 'DRAGON_UNSUPPORTED_VALUE', 'linear-gradient(red, blue) 1 round', 'border-image-repeat: round'),
];
