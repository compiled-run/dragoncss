// Fixture group overflow (OVFL Phase A, notes/T046-paint-spec.md §5.8 with T078J): auto, scroll and clip, scroll containers and
// their scrollable overflow (css-overflow-3 §2.2), and viewport propagation from html or body (§3.3), which the compiler resolves.
// Each layout case also has Chrome's scroll metrics in expected-scroll (scroll-metrics.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const OVERFLOW: readonly FixtureSpec[] = [
  // The BASE text of reject-overflow-single-axis: overflow-x hidden computes overflow-y to auto (§3.1).
  layout('overflow-single-axis-hidden'),
  layout('overflow-scroll-basic'),
  // clip is no scroll container: margins collapse through it and a flex item keeps its automatic minimum size.
  layout('overflow-clip-margin-collapse'),
  layout('overflow-clip-flex-min-size'),
  both('overflow-end-padding'),
  both('overflow-nested'),
  both('overflow-direction'),
  layout('viewport-prop-body-hidden'),
  layout('viewport-prop-html-x-hidden'),
  // The music player's html, body and .App pattern: html propagates, so body stays a scroll container.
  both('viewport-prop-demo'),
  both('viewport-prop-document'),
  // clip on both axes paints at the padding box; content that fits scrolls nothing; the demo's .App pair without propagation.
  layout('overflow-clip-both'),
  layout('overflow-auto-fits'),
  both('overflow-hidden-x-auto-y'),
  // REPL-a images in scroll containers: a replaced box adds its border box and its in-flow bounds (pre-landing review of #96).
  both('overflow-replaced'),
  // OVFL-p: a percentage relative offset inside a scroll container is refused on native targets (overflow.ts does not decide it).
  reject('reject-overflow-percent-relative', 'DRAGON_UNPROVEN_CONTEXT', '10%', 'position: relative with a percentage top on k inside the scroll container sc'),
];
