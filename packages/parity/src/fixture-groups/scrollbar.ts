// Fixture group scrollbar (OVFL-S0): scrollbar-width and scrollbar-gutter at every value, in Ahem, both directions, on overflowing
// auto and scroll containers (both axes and a locked one), nested with inherit, through var(), the CSS-wide keywords and another ASCII
// case, on a box that does not scroll, on flex rows and columns, grid items and relatively and absolutely positioned boxes, and on
// html and body, whose values the viewport does not take on native. The scroll- prefix gives each case Chrome's scroll metrics, so
// every value is proven to reserve no gutter and keep the offset range in the overlay reference (scroll-metrics.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const SCROLLBAR: readonly FixtureSpec[] = [
  both('scroll-scrollbar-values'),
  both('scroll-scrollbar-root'),
];
