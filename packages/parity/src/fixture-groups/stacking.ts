// Fixture group stacking (PNT1, CSS2 Appendix E): overlapping positioned boxes and stacking contexts whose paint order differs from
// tree order: z-index 2, 1, auto, -1 and -2 in the root context, a relative box over a later flow sibling, a flex item with a z-index
// over its later sibling, an opacity group holding a z-index 10 child under a z-index 1 box outside it, a z-index 0 context with a
// negative child between its background and its flow child, a relative box inside a relative parent over the parent's later flow
// child, an absolute z-index box escaping an overflow clip that is not its containing block, and the music player's z-index 40
// button over two later z-index 20 and 30 overlays (absolute here until POSX-f), and the foreground phase: text overflowing onto
// later block backgrounds in the root and in a relative box, flex items painted atomically above a later block that overlaps them,
// and a flex item's outline under the next item; and text beside a later block child that overlaps it, in a flex item, a relative box
// and an overflow clip, painted above that child's background (PNT1-MIX). Sample centres sit in the overlaps, so the device pixels
// compare the order. A calculation that is not a whole number is refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const STACKING: readonly FixtureSpec[] = [
  both('stacking-basic'),
  both('stacking-context'),
  both('stacking-escape'),
  both('stacking-foreground'),
  both('stacking-mix'),
  reject('stacking-reject-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(3 / 2)', 'z-index: calc(3/2) is unsupported: the calculation is not a whole number'),
];
