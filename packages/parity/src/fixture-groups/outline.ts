// Fixture group outline (PNT1, css-ui-4 §3): the outline shorthand and longhands in every style, px, em, keyword and zero widths,
// positive and negative offsets, colours (currentcolor, hex, rgba, transparent), inherit and var() (outline-values, painting nothing);
// solid outlines (offsets, a thin and a negative one, one over a later flow sibling, a parent's over its child's), double ones
// (the thirds, the width-2 solid fallback) and outlines that follow the border radius (rounded, round, elliptical, one-corner and
// bordered boxes, positive and negative offsets), in both environment directions. A system colour and a viewport unit are refused.
// The native-only refusals (other styles, inline boxes, an outline under an overflow clip or in a case with a positioned or
// transformed box) are proven by packages/dragon/test/paint-outline.test.ts, since a reject fixture blocks the web output too.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const OUTLINE: readonly FixtureSpec[] = [
  both('outline-values'),
  both('outline-solid'),
  both('outline-double'),
  both('outline-rounded'),
  reject('reject-outline-color', 'DRAGON_UNSUPPORTED_VALUE', 'Highlight', 'outline-color: Highlight is unsupported:'),
  reject('reject-outline-viewport', 'DRAGON_UNSUPPORTED_VALUE', '2vw', 'outline-offset: 2vw is unsupported: an outline length in a viewport unit'),
];
