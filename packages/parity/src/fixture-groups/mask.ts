// Fixture group mask (MASK-CLIP): every mask longhand at its initial value in Ahem, both directions, on bordered and padded boxes
// with backgrounds, through mask: none, in another ASCII case, through mask-position and the -x and -y longhands, through each
// -webkit-mask-* alias, through the CSS-wide keywords and on a flex row, so every target proves the initial values. That includes
// -webkit-mask-composite's source-over (computed source-over), also in upper case and inherited explicitly. The reject: a mask image
// that hides text, which no target draws yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const MASK: readonly FixtureSpec[] = [
  layout('mask-initial', ['ltr', 'rtl']),
  reject('reject-mask-image', 'DRAGON_UNSUPPORTED_VALUE', 'linear-gradient(transparent, transparent)', 'mask-image: linear-gradient(transparent,transparent)'),
];
