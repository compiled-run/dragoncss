// Fixture group grid (GRID G0, G1a, G2, G3, G4): the grid longhands and shorthands, justify-items and justify-self, compiled and computed like
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
  // GRID G2: repeat(auto-fill) and repeat(auto-fit) over a definite width, a max-width and a height, with gaps, flexible and
  // percentage tracks, named lines around the repeater, and auto-fit collapsing the tracks no item spans.
  both('grid-auto-repeat'),
  // GRID G4: absolutely positioned children in their grid areas (lines inside a set, auto lines, lines beyond the grid, named
  // lines, content alignment) and their static positions, in a positioned grid and in a static one.
  both('grid-abspos'),
  // GRID G3: first baseline self-alignment in the block axis: font sizes, padding, margins and borders in auto rows, synthesized
  // baselines, fixed, flexible and spanned rows, align-items against align-self, the start fallback of an item whose percentage
  // size depends on its row, nested grids and flex containers as items, and a grid's first baseline in a flex line.
  both('grid-baseline'),
  // G-INL: an inline-grid is an atomic inline on its line; one inside an inline box stays refused (INL2c), as inline-block and inline-flex are.
  reject('reject-grid-inline-grid', 'DRAGON_UNPROVEN_CONTEXT', '<span data-dragon-id="box" class="box"><span data-dragon-id="cell" class="cell">X</span></span>', 'inline-grid <span> box is an atomic inline inside the inline box <span> s'),
  reject('reject-grid-subgrid', 'DRAGON_UNSUPPORTED_VALUE', 'subgrid', 'grid-template-columns: subgrid is unsupported: subgrid needs the grid engine'),
  reject('reject-grid-masonry', 'DRAGON_CSS_INVALID_VALUE', 'masonry'),
  reject('reject-grid-areas-not-rectangular', 'DRAGON_CSS_INVALID_VALUE', '"a a" "a b"', '""a a""a b"" is not a valid value for grid-template-areas: every row needs the same number of cells'),
  reject('reject-grid-auto-repeat-flex', 'DRAGON_CSS_INVALID_VALUE', 'repeat(auto-fill, 1fr)', '"repeat(auto-fill,1fr)" is not a valid value for grid-template-columns: line names may not be span, auto, default or a CSS-wide keyword, and an automatic repetition takes only fixed sizes'),
  reject('reject-grid-track-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(10px + 5%)', 'grid-template-columns: calc(10px + 5%) is unsupported: calc() is a css-values-4 math function'),
  reject('reject-grid-justify-self-block', 'DRAGON_UNPROVEN_CONTEXT', 'center', 'justify-self:center on cell is used in the block/ltr context, which is not proven'),
  // G1a proves justify-items: center in grid containers, so on a block container it is an unproven context.
  reject('reject-grid-justify-items', 'DRAGON_UNPROVEN_CONTEXT', 'center', 'justify-items:center on box is used in the not-flex-container/ltr context, which is not proven'),
];
