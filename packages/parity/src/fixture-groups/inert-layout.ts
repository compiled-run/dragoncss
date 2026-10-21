// Fixture group inert-layout: longhands proven only where Chrome 145 never reads them. vertical-align (CSS2 §10.8.1) on the root,
// block boxes, flex and grid items (blockified spans and inline-blocks among them) and positioned boxes, baseline on block and
// relatively positioned boxes and on an inline box; inline.ts's reject pins a non-baseline value there (INL2). float on flex and
// grid items, which it leaves in place, on absolutely positioned boxes, where it computes to none, and under display: none, and
// none everywhere; clear everywhere but on a float, since the compiler keeps every in-flow box before the floats of its formatting context (CSS2 §9.5.2; fixture group float).
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const INERT_LAYOUT: readonly FixtureSpec[] = [
  both('vertical-align-inert'),
  both('float-clear-inert'),
  reject('reject-float-block', 'DRAGON_UNSUPPORTED_VALUE', 'left', 'float: left on f beside the text or inline content of d'),
];
