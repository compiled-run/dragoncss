// Fixture group overscroll: overscroll-behavior and overflow-anchor at every value, in Ahem, both directions, on overflowing auto and
// scroll containers (both axes and a locked one), through the shorthand, the physical and flow-relative longhands (a later logical
// pair winning over an earlier one), nested with inherit, through var(), the CSS-wide keywords and another ASCII case, on a box that
// does not scroll and on a flex row. The scroll- prefix gives each case Chrome's scroll metrics, so every value is proven to leave
// the box and the offset range alone.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const OVERSCROLL: readonly FixtureSpec[] = [both('scroll-overscroll-values')];
