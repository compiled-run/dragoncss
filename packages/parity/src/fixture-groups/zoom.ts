// Fixture group zoom (ZOOM): zoom where it is 1 in Ahem, both directions, on bordered and padded boxes with backgrounds: 1, normal,
// 100% in another ASCII case, 1.0, 0 (which Chrome computes to 1), a calculation, var(), the CSS-wide keywords and a flex row, so
// every target proves them. zoom-scaled: zoom 1.5, 2 nested in 1.5, 110% and 0.7 on px, em, rem and viewport lengths, fractional
// lengths, every border width keyword and the unzoomed initial medium, a flex gap, and text with line-height, letter-spacing,
// word-spacing and text-indent, in a zoomed block and in zoomed inline boxes.
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

export const ZOOM: readonly FixtureSpec[] = [
  layout('zoom-one', ['ltr', 'rtl']),
  layout('zoom-scaled', ['ltr', 'rtl']),
];
