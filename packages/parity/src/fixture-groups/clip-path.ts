// Fixture group clip-path (MASK-CLIP, css-masking-1 §6.1): boxes whose clip-path is inset(), in each form Chrome parses (one to four
// edges, px, em, percentages, negative, zero, an inset that leaves nothing, var(), upper case, a trailing border-box), positioned
// and in flow, over children that overflow, and none and initial, where Chrome draws the box (clip-path-basic). A clip over an
// absolutely positioned descendant whose containing block is outside it, a clipped flow box over a later sibling (a clip-path makes
// a stacking context), a clip over an overflow clip, a clip over a z-index child, a clip inside a clip and a clip over a rounded box
// (clip-path-nested). circle() and ellipse() with each radius and position form Chrome parses (clip-path-circle), and polygon() with
// each fill rule, crossing and holed outlines, negative and overflowing points and em lengths (clip-path-polygon). Every case in
// both environment directions. The native-only refusals are proven in
// packages/dragon/test/paint-clip-path.test.ts.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const CLIP_PATH: readonly FixtureSpec[] = [
  both('clip-path-basic'),
  both('clip-path-nested'),
  both('clip-path-circle'),
  both('clip-path-polygon'),
];
