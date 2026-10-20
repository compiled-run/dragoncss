// Fixture group transform-extra (PNT2): backface-visibility, transform-style, transform-box, perspective and perspective-origin at
// their initial values in Ahem, both directions, on bordered and padded boxes with backgrounds, in another ASCII case, through the
// -webkit- aliases, on rotated, mirrored and translated boxes, through the CSS-wide keywords and on a flex row, so every target proves
// the initial values. The reject: a hidden backface on an inline box, whose paint layer no target places (a block's is: effects'
// stacking-backface). A perspective is drawn as an identity transform (transforms.ts, transform-perspective).
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TRANSFORM_EXTRA: readonly FixtureSpec[] = [
  layout('transform-extra-initial', ['ltr', 'rtl']),
  reject('reject-transform-extra-backface', 'DRAGON_UNSUPPORTED_VALUE', 'hidden', 'backface-visibility: hidden on the inline box'),
];
