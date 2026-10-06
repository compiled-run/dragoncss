// Fixture group overflow (OVFL Phase A, notes/T046-paint-spec.md §5.8 with T078J): auto, scroll and clip, scroll containers and
// their scrollable overflow (css-overflow-3 §2.2), and viewport propagation from html or body (§3.3), which the compiler resolves.
// Each layout case runs in both directions and also has Chrome's scroll metrics in expected-scroll (scroll-metrics.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const OVERFLOW: readonly FixtureSpec[] = [
  // The BASE text of reject-overflow-single-axis: overflow-x hidden computes overflow-y to auto (§3.1).
  both('overflow-single-axis-hidden'),
  both('overflow-scroll-basic'),
  // clip is no scroll container: margins collapse through it and a flex item keeps its automatic minimum size.
  both('overflow-clip-margin-collapse'),
  both('overflow-clip-flex-min-size'),
  both('overflow-end-padding'),
  both('overflow-nested'),
  both('overflow-direction'),
  both('viewport-prop-body-hidden'),
  both('viewport-prop-html-x-hidden'),
  // The music player's html, body and .App pattern: html propagates, so body stays a scroll container.
  both('viewport-prop-demo'),
  both('viewport-prop-document'),
  // clip on both axes paints at the padding box; content that fits scrolls nothing; the demo's .App pair without propagation.
  both('overflow-clip-both'),
  both('overflow-auto-fits'),
  both('overflow-hidden-x-auto-y'),
  // REPL-a images in scroll containers: a replaced box adds its border box and its in-flow bounds (pre-landing review of #96).
  both('overflow-replaced'),
  // Reversed flex scroll containers overflow past their main-start or cross-start (Blink LayoutFlexibleBox::HasLeftOverflow and
  // HasTopOverflow): row-reverse to the inline start, column-reverse to the top, wrap-reverse to the cross start (#194 review).
  both('overflow-flex-reverse'),
  // OVFL-p: a percentage relative offset inside a scroll container is refused on native targets (overflow.ts does not decide it).
  reject('reject-overflow-percent-relative', 'DRAGON_UNPROVEN_CONTEXT', '10%', 'position: relative with a percentage top on k inside the scroll container sc'),
];
