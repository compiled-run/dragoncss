// Fixture group outline (PNT1, css-ui-4 §3): the outline shorthand and longhands in every style, px, em, keyword and zero widths,
// positive and negative offsets, colours (currentcolor, hex, rgba, transparent), inherit and var() (outline-values, painting nothing);
// solid outlines (offsets, a thin and a negative one, a fractional width and offset, over a later flow sibling, under an overflow
// clip, in a positioned box under a later positioned one) and double ones (the thirds, the width-2 solid fallback, a negative offset,
// a fractional width), in both environment directions. Corners are square: rounded outlines join with the radius module. A system
// colour and a viewport unit are refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const OUTLINE: readonly FixtureSpec[] = [
  both('outline-values'),
  both('outline-solid'),
  both('outline-double'),
  reject('reject-outline-color', 'DRAGON_UNSUPPORTED_VALUE', 'Highlight', 'outline-color: Highlight is unsupported:'),
  reject('reject-outline-viewport', 'DRAGON_UNSUPPORTED_VALUE', '2vw', 'outline-offset: 2vw is unsupported: an outline length in a viewport unit'),
];
