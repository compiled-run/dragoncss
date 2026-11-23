// Fixture group resize (css-ui-4 §5.1): every keyword Chrome 145 parses, auto (which computes to both), any case, var(), inherit,
// initial and unset, on blocks, flex items, positioned boxes, an inline span and an overflow: clip box, none of them a scroll
// container, where Chrome draws no resizer and native compiles every value (resize-values, web and native rows). On a scroll
// container or an iframe native also compiles it and does nothing, as a phone has no resizer (packages/dragon/test/resize.test.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const RESIZE: readonly FixtureSpec[] = [
  both('resize-values'),
];
