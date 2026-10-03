// Fixture group outline (PNT1, css-ui-4 §3): the outline shorthand and longhands in every style, px, em, keyword and zero widths,
// positive and negative offsets, colours (currentcolor, hex, rgba, transparent), inherit and var(), in both environment directions.
// Every outline here paints nothing (style none or width 0), because the native targets do not draw outlines yet (T115 part B);
// the web target's computed strings are the proof. A system colour and a viewport unit are refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const OUTLINE: readonly FixtureSpec[] = [
  both('outline-values'),
  reject('reject-outline-color', 'DRAGON_UNSUPPORTED_VALUE', 'Highlight', 'outline-color: Highlight is unsupported:'),
  reject('reject-outline-viewport', 'DRAGON_UNSUPPORTED_VALUE', '2vw', 'outline-offset: 2vw is unsupported: an outline length in a viewport unit'),
];
