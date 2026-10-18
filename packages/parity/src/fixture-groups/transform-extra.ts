// Fixture group transform-extra (PNT2): backface-visibility, transform-style, transform-box, perspective and perspective-origin at
// their initial values in Ahem, both directions, on bordered and padded boxes with backgrounds, in another ASCII case, through the
// -webkit- aliases (one beating an earlier perspective), on rotated, mirrored and translated boxes, through the CSS-wide keywords and
// on a flex row, so every target proves the initial values. The rejects: a hidden backface, which can hide a box and its text, and
// a perspective, which makes a 3D rendering context; no target draws either yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TRANSFORM_EXTRA: readonly FixtureSpec[] = [
  layout('transform-extra-initial', ['ltr', 'rtl']),
  reject('reject-transform-extra-backface', 'DRAGON_UNSUPPORTED_VALUE', 'hidden', 'backface-visibility: hidden'),
  reject('reject-transform-extra-perspective', 'DRAGON_UNSUPPORTED_VALUE', '200px', 'perspective: 200px'),
];
