// Fixture group text-fill-stroke (TXT-FX, compat §5): -webkit-text-fill-color at currentcolor under several colours, and zero-width
// strokes in other colours through the longhands and the -webkit-text-stroke shorthand, inherited, and on a flex row, in Ahem,
// both directions; Chrome draws each as it draws the text without them. text-stroke-ahem: strokes 1px to 8px wide in explicit and
// currentcolor colours, inherited, over a background, on wrapped and touching lines and on inline boxes, which iOS and Android
// stroke after each line's fill (packages/parity/test/text-stroke.test.ts). The reject: a fill colour other than currentcolor,
// which Dragon does not paint.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const TEXT_FILL_STROKE: readonly FixtureSpec[] = [
  both('text-fill-stroke-initial'),
  layout('text-stroke-ahem', ['ltr', 'rtl']),
  reject('reject-text-fill-color', 'DRAGON_UNSUPPORTED_VALUE', 'red', 'text f:text0 takes -webkit-text-fill-color: rgb(255, 0, 0)'),
];
