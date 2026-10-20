// Fixture group mask (MASK-CLIP): every mask longhand at its initial value in Ahem, both directions, on bordered and padded boxes
// with backgrounds, through mask: none, in another ASCII case, through mask-position and the -x and -y longhands, through each
// -webkit-mask-* alias, through the CSS-wide keywords and on a flex row, so every target proves the initial values. The reject: a
// conic gradient mask image that hides text, which no target draws yet. Gradient masks (mask-gradient): a linear, a radial (through
// -webkit-mask-image, on a bordered and padded box), a repeating angled one (through mask, over a child box), one to a side on a
// box at fractional px, and one over text, every one over the white canvas, in both directions.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const MASK: readonly FixtureSpec[] = [
  layout('mask-initial', ['ltr', 'rtl']),
  layout('mask-gradient', ['ltr', 'rtl']),
  reject('reject-mask-image', 'DRAGON_UNSUPPORTED_VALUE', 'conic-gradient(transparent, transparent)', 'mask-image: conic-gradient(transparent,transparent)'),
];
