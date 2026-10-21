// Fixture group border-image (MISC-PAINT): every border image longhand at its initial value in Ahem, both directions, on bordered and
// padded boxes with backgrounds, through border-image: none, in another ASCII case, through -webkit-border-image (which sets no border
// width at none), through the CSS-wide keywords, on an inheriting child and on a flex row, so every target proves the initial values.
// border-image-gradient: part 1's gradient border images, drawn natively by the translated nine-piece port (paint-gradient.ts
// planBorderImage), in both directions: the coverage probe (linear-gradient(to right, red, blue) 1), slices in numbers and
// percentages with and without fill, widths in numbers, px and auto, overlapping widths, a slice past the image, a box with no
// border style (only the filled middle draws), a dashed border the image replaces, uneven and fractional borders, the longhands,
// a source of none with every other longhand set (the border style draws), an inherited border image and a box wider than one
// cc raster tile. border-image-fractional: number slices that are not whole (Blink rounds them, CSSToStyleMap's
// ConvertBorderImageSliceSide): 0.4 paints nothing and still drops the border style, 2.6 / auto takes its widths from slice 3,
// 2.5 rounds up, mixed sides, percentages kept as written, and a 4px width that leaves the border band open. border-image-repeat
// (MISC-PAINT part 2): repeat, round and space on 48 x 32 px boxes with 8px borders, whose tiles land on whole device px at DPR 2,
// 2.625 and 3 (analysis/paint-values/border-image-tiling.ts proves it): one tile per edge, tiles repeated from a centred phase, round's
// whole tiles at scale 0.5, space with no spacing and with no tile that fits (only the corners draw), a tile scaled 2 past its edge,
// number and auto widths, the longhands, a border-box box and a box with no border style. The rejects: a radial-gradient() source
// and a url() source, which no target draws yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const BORDER_IMAGE: readonly FixtureSpec[] = [
  layout('border-image-initial', ['ltr', 'rtl']),
  layout('border-image-gradient', ['ltr', 'rtl']),
  layout('border-image-fractional', ['ltr', 'rtl']),
  layout('border-image-repeat', ['ltr', 'rtl']),
  reject('reject-border-image-source', 'DRAGON_UNSUPPORTED_VALUE', 'radial-gradient(red, blue)', 'border-image-source: radial-gradient(red,blue)'),
  reject('reject-border-image-url', 'DRAGON_UNSUPPORTED_VALUE', 'url(b.png)', 'border-image-source: url(b.png)'),
];
