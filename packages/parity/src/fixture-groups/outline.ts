// Fixture group outline (PNT1, css-ui-4 §3): the outline shorthand and longhands in every style, px, em, keyword and zero widths,
// positive and negative offsets, colours (currentcolor, hex, rgba, transparent), inherit and var() (outline-values, painting nothing);
// solid outlines (offsets, a rounded box, a thin and a negative one, over a later flow sibling, under an overflow clip, in a
// positioned box under a later positioned one) and double ones (the thirds, rounded and round boxes, the width-2 solid fallback),
// in both environment directions. A system colour and a viewport unit are refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const OUTLINE: readonly FixtureSpec[] = [
  both('outline-values'),
  both('outline-solid'),
  both('outline-double'),
  reject('reject-outline-color', 'DRAGON_UNSUPPORTED_VALUE', 'Highlight', 'outline-color: Highlight is unsupported:'),
  reject('reject-outline-viewport', 'DRAGON_UNSUPPORTED_VALUE', '2vw', 'outline-offset: 2vw is unsupported: an outline length in a viewport unit'),
];
