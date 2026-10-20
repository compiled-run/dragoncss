// Fixture group isolation (compositing-1 §3.3): isolate and auto in another case, through var(), inherit and initial, on blocks, a
// positioned box and a flex row and item (isolation-values), and isolate's stacking context on non-positioned boxes in the z-index 0
// layer: above a later overlapping flow box, holding a negative and a positive z-index child, below a later z-index 1 box, and on a
// flex item (isolation-stacking). Both directions.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const ISOLATION: readonly FixtureSpec[] = [
  both('isolation-values'),
  both('isolation-stacking'),
];
