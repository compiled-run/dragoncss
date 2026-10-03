// Fixture group visibility (T150a, css-display-3 §4; notes/T150-visibility-spec.md §6): hidden, collapse, the CSS-wide keywords and
// var(), inheritance and visible children of hidden boxes, nested toggles (visibility-basic); a hidden box with a radius, border, outer
// and inset shadows and an outline, a hidden opacity group, a hidden stacking context with a z-indexed visible child, and a visible
// shadowed child of a collapsed box whose background is not its backdrop (visibility-paint); collapsed and hidden flex items keep
// their space, with fixed and growing items (visibility-flex); hidden text, visible text inside hidden boxes and anonymous runs (visibility-text); a hidden html
// and body with a visible child (visibility-root). Every case in both environment directions. The native-only refusals are proven in
// packages/dragon/test/paint-visibility.test.ts, as a reject fixture needs a refusal that blocks the web output too.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const VISIBILITY: readonly FixtureSpec[] = [
  both('visibility-basic'),
  both('visibility-paint'),
  both('visibility-flex'),
  both('visibility-text'),
  both('visibility-root'),
];
