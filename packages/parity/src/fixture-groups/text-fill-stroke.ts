// Fixture group text-fill-stroke (TXT-FX, compat §5): -webkit-text-fill-color at currentcolor under several colours, and zero-width
// strokes in other colours through the longhands and the -webkit-text-stroke shorthand, inherited, and on a flex row, in Ahem,
// both directions; Chrome draws each as it draws the text without them. The reject: a fill colour other than currentcolor,
// which Dragon does not paint.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const TEXT_FILL_STROKE: readonly FixtureSpec[] = [
  both('text-fill-stroke-initial'),
  reject('reject-text-fill-color', 'DRAGON_UNSUPPORTED_VALUE', 'red', 'text f:text0 takes -webkit-text-fill-color: red'),
];
