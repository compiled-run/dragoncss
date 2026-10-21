// Fixture group scrollbar (OVFL-S0): scrollbar-width and scrollbar-gutter at every value, in Ahem, both directions, on overflowing
// auto and scroll containers (both axes and a locked one), nested with inherit, through var(), the CSS-wide keywords and another ASCII
// case, on a box that does not scroll, on flex rows and columns, grid items and relatively and absolutely positioned boxes, and on
// html and body, whose values the viewport does not take on native. The scroll- prefix gives each case Chrome's scroll metrics, so
// every value is proven to reserve no gutter and keep the offset range in the overlay reference (scroll-metrics.ts).
// scroll-webkit-scrollbar (NA-NATIVE): the ::-webkit-scrollbar rules that hide the scrollbar (display: none, a zero width and height,
// a zero thickness on the one axis that scrolls), with part rules that then style nothing, against scrollbar-width: thin, which makes
// Chrome ignore them. The reject is a ::-webkit-scrollbar width that draws a custom scrollbar in a gutter (analysis/webkit-scrollbar.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const SCROLLBAR: readonly FixtureSpec[] = [
  both('scroll-scrollbar-values'),
  both('scroll-scrollbar-root'),
  both('scroll-webkit-scrollbar'),
  reject('reject-webkit-scrollbar-custom', 'DRAGON_UNSUPPORTED_SELECTOR', 'width: 8px', 'width: 8px in a ::-webkit-scrollbar rule'),
];
