// Fixture group bg-position (BG2, css-backgrounds-3 §3.6): the edge keywords right and bottom in background-position, alone, paired
// in either order, through the -x and -y longhands, the background shorthand and a two-layer list, in the padding, content and
// border positioning areas, each over an opaque colour and drawn natively. Every case in both environment directions. What stays
// refused is proven elsewhere: x-start, x-end, y-start and y-end (paint-values/gradient.ts), and a repeating layer away from its
// start edge, which the native targets refuse (packages/dragon/test/paint-gradient.test.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const BG_POSITION: readonly FixtureSpec[] = [
  both('bg-position-keywords'),
];
