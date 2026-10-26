// Fixture group motion (MOTION, css-motion-1 §2): offset-path, offset-distance, offset-position, offset-anchor and offset-rotate at
// their initial values in Ahem, both directions, on bordered and padded boxes with backgrounds: through offset: none in two ASCII
// cases, every longhand in two ASCII cases (offset-distance as 0 and 0px), the shorthand after a longhand, var(), the CSS-wide
// keywords, inherit, an absolutely positioned box and a flex row, so every target proves the initial values. The rejects: a path
// with a distance along it, which moves the box, and an offset-rotate, which would turn it on a path; no target composes an
// offset transform yet.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const MOTION: readonly FixtureSpec[] = [
  both('motion-initial'),
  reject('reject-motion-path', 'DRAGON_UNSUPPORTED_VALUE', 'path("M 0 0 H 40")', 'offset-path: path("M 0 0 H 40") on <div> s is unsupported'),
  reject('reject-motion-rotate', 'DRAGON_UNSUPPORTED_VALUE', '30deg', 'offset-rotate: 30deg on <div> s is unsupported'),
];
