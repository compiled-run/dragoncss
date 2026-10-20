// Fixture group transform-extra (PNT2): backface-visibility, transform-style, transform-box, perspective and perspective-origin at
// their initial values in Ahem, both directions, on bordered and padded boxes with backgrounds, in another ASCII case, through the
// -webkit- aliases, on rotated, mirrored and translated boxes, through the CSS-wide keywords and
// on a flex row, so every target proves the initial values. backface-values: backface-visibility: hidden on boxes whose will-change
// names transform, where Chrome draws nothing new, through the alias, another case, var() and inherit, on rotated and mirrored boxes,
// under a perspective and beside an overlapping later box. The reject: a hidden backface elsewhere, which gives the box layers of its
// own and no target draws yet. A perspective is drawn as an identity transform (transforms.ts, transform-perspective).
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const TRANSFORM_EXTRA: readonly FixtureSpec[] = [
  layout('transform-extra-initial', ['ltr', 'rtl']),
  both('backface-values'),
  reject('reject-transform-extra-backface', 'DRAGON_UNSUPPORTED_VALUE', 'hidden', 'backface-visibility: hidden'),
];
