// Fixture group border-image (MISC-PAINT): every border image longhand at its initial value in Ahem, both directions, on bordered and
// padded boxes with backgrounds, through border-image: none, in another ASCII case, through -webkit-border-image (which sets no border
// width at none), through the CSS-wide keywords, on an inheriting child and on a flex row, so every target proves the initial values.
// The reject: a gradient border image, which no target draws yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const BORDER_IMAGE: readonly FixtureSpec[] = [
  layout('border-image-initial', ['ltr', 'rtl']),
  reject('reject-border-image-source', 'DRAGON_UNSUPPORTED_VALUE', 'linear-gradient(red, blue)', 'border-image-source: linear-gradient(red,blue)'),
];
