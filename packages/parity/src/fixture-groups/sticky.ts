// Fixture group sticky (POSX-s, css-position-3 §3.4): position: sticky at scroll offset 0. A sticky box moves down to its top inset
// or up to its bottom inset in the viewport, and right to its left inset or left to its right inset, only as far as its parent's
// content box less its own margins lets it (padding, border and margins included, percentages of the viewport, an ancestor's
// relative offset, a flex item, top and bottom together), and carries its absolutely positioned children. A sticky box inside
// another is refused; one inside a scroll container is refused on native only (analysis/computed-checks.ts checkSticky, pinned in
// packages/dragon/test).
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const STICKY: readonly FixtureSpec[] = [
  // The coverage probe's shape: a sticky box of two blocks of text with no insets, which stays in flow.
  both('sticky-probe'),
  both('sticky-viewport'),
  reject('reject-sticky-nested', 'DRAGON_UNSUPPORTED_VALUE', 'sticky', 'position: sticky on i inside the sticky o'),
];
