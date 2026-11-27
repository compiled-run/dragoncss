// Fixture group clip-rect (MASK-CLIP, css-masking-1 §5.1): absolutely positioned boxes whose clip rect() is empty at every size, in
// each form Chrome parses (commas, whitespace, auto edges, em, negative and equal edges, var(), upper case), with children, an
// overflowing positioned child and text; a visually-hidden (sr-only) box among text; clip on a static and a relative box, auto and
// initial, where Chrome draws the box (clip-rect-basic). Clipped boxes inside an overflow clip, a clipped flex container, a clipped
// box holding a positioned child, a z-index 0 box and an opacity group, a clipped stacking context over a sibling, a clipped box
// inside a clipped box and clipped text (clip-rect-nested). Text in hidden boxes, which native boxes carry as their accessibility
// label: the coverage probe's shape (two blocks), inline runs, a <br> and the 1px sr-only box among text (clip-rect-sr-only). Every
// case in both environment directions. The native-only refusals are proven in packages/dragon/test/paint-clip-rect.test.ts, as a
// reject fixture needs a refusal that blocks the web output too.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const CLIP_RECT: readonly FixtureSpec[] = [
  both('clip-rect-basic'),
  both('clip-rect-nested'),
  both('clip-rect-sr-only'),
];
