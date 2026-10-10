// Fixture group grid (GRID G0, G1a): the grid longhands and shorthands, justify-items and justify-self, compiled and computed like
// Chrome. G0's inert fixtures put placement and template values on block and flex boxes, where Chrome ignores them, and prove
// justify-self only on flex items (block children and absolutely positioned boxes align by it). G1a's fixtures lay out display:
// grid: placement, named lines and areas, fr, intrinsic tracks, alignment, sizing and nesting. The rejects are inline-grid, subgrid,
// masonry, values Chrome's parser drops beyond the webref grammar, math functions inside track lists, and justify-* where unproven.
// The hit lane refuses the G1a cases by name (rt-hit.ts hitRefusal), and native :hover, :active and :focus rules in a case with a
// grid container are refused (DRAGON_UNSUPPORTED_SELECTOR, package GRID hit model) until grid hit testing is built.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const GRID: readonly FixtureSpec[] = [
  both('grid-inert-placement'),
  both('grid-inert-templates'),
  // GRID G1a: grid layout in block flow and as a flex item, each exact against Chrome 145 in both directions.
  both('grid-placement'),
  both('grid-named-areas'),
  both('grid-fr'),
  both('grid-intrinsic'),
  both('grid-alignment'),
  both('grid-sizing'),
  both('grid-nested'),
  both('grid-aspect-ratio'),
  // GRID G1c: every self-alignment value in grid containers and items, the place-* shorthands, and the template shorthands with
  // their none values and spans on end lines.
  both('grid-self-values'),
  both('grid-place'),
  both('grid-template-shorthands'),
  reject('reject-grid-inline-grid', 'DRAGON_UNSUPPORTED_VALUE', 'inline-grid'),
  reject('reject-grid-subgrid', 'DRAGON_UNSUPPORTED_VALUE', 'subgrid', 'grid-template-columns: subgrid is unsupported: subgrid needs the grid engine'),
  reject('reject-grid-masonry', 'DRAGON_CSS_INVALID_VALUE', 'masonry'),
  reject('reject-grid-areas-not-rectangular', 'DRAGON_CSS_INVALID_VALUE', '"a a" "a b"', '""a a""a b"" is not a valid value for grid-template-areas: every row needs the same number of cells'),
  reject('reject-grid-auto-repeat-flex', 'DRAGON_CSS_INVALID_VALUE', 'repeat(auto-fill, 1fr)', '"repeat(auto-fill,1fr)" is not a valid value for grid-template-columns: line names may not be span, auto, default or a CSS-wide keyword, and an automatic repetition takes only fixed sizes'),
  reject('reject-grid-track-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(10px + 5%)', 'grid-template-columns: calc(10px + 5%) is unsupported: calc() is a css-values-4 math function'),
  reject('reject-grid-justify-self-block', 'DRAGON_UNPROVEN_CONTEXT', 'center', 'justify-self:center on cell is used in the block/ltr context, which is not proven'),
  // G1a proves justify-items: center in grid containers, so on a block container it is an unproven context.
  reject('reject-grid-justify-items', 'DRAGON_UNPROVEN_CONTEXT', 'center', 'justify-items:center on box is used in the not-flex-container/ltr context, which is not proven'),
];
