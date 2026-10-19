// Fixture group transform-extra (PNT2): backface-visibility, transform-style and transform-box at their initial values in Ahem, both
// directions, on bordered and padded boxes with backgrounds, in another ASCII case, through the -webkit- aliases, on rotated,
// mirrored and translated boxes, through the CSS-wide keywords and on a flex row, so every target proves the initial values. The
// reject: a hidden backface, which can hide a box and its text, and which no target draws yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TRANSFORM_EXTRA: readonly FixtureSpec[] = [
  layout('transform-extra-initial', ['ltr', 'rtl']),
  reject('reject-transform-extra-backface', 'DRAGON_UNSUPPORTED_VALUE', 'hidden', 'backface-visibility: hidden'),
];
