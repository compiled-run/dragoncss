// SELD-R1b (notes/T047-runtime-spec.md §3.3 item 6): the hit-test fixtures, in both directions. hit-line-strip-a and -b reproduce
// the T063J probe table (text overflowing a fixed-height block with a tall line-height); hit-order covers paint order, flex order
// and atomic items, positioned layers, overflow clips along the containing-block chain and fractional edges; hit-pointer-events
// covers none over a hittable sibling, none with an auto child, inherited none and none on flex items and layers. The state
// cases themselves are the tree fixtures with free states (packages/parity/src/state-cases.ts). SVG pointer-events values are
// refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const STATES: readonly FixtureSpec[] = [
  both('hit-line-strip-a'),
  both('hit-line-strip-b'),
  both('hit-order'),
  both('hit-pointer-events'),
  reject('reject-pointer-events-visiblePainted', 'DRAGON_UNSUPPORTED_VALUE', 'visiblePainted', 'pointer-events: visiblePainted is unsupported'),
  reject('reject-pointer-events-all', 'DRAGON_UNSUPPORTED_VALUE', 'all', 'pointer-events: all is unsupported'),
  reject('reject-pointer-events-bounding-box', 'DRAGON_UNSUPPORTED_VALUE', 'bounding-box', 'pointer-events: bounding-box is unsupported'),
];
