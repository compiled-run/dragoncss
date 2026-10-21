// Fixture group fixed (POSX-f, CSS2 §9.6.1, §10.1 item 3): position: fixed against the viewport, at scroll offset 0. A fixed box
// inside a positioned box ignores it, its percentages resolve against the viewport, it keeps its static position with no insets
// (after an in-flow block, and centred in a flex container), it is shrink-to-fit with auto width, and it is the containing block of
// its own absolutely positioned children. A transformed ancestor's containing block (POSX-f2) is refused; a fixed box in a scroll container is
// refused on native only (analysis/computed-checks.ts checkFixedContainingBlocks, pinned in packages/dragon/test).
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const FIXED: readonly FixtureSpec[] = [
  // The coverage probe's shape: a fixed box of two blocks of text, at its static position.
  both('fixed-probe'),
  both('fixed-viewport'),
  // Fixed children of a positioned grid take the viewport as their containing block; an absolute one takes the grid's padding box.
  both('fixed-in-grid'),
  reject('reject-fixed-transform', 'DRAGON_UNSUPPORTED_VALUE', 'translateX(1px)', 'a transform on g makes it the containing block of the fixed a'),
];
