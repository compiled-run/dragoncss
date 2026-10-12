// Fixture group vertical-align (CSS2 §10.8.1): Chrome 145 reads vertical-align only on inline-level boxes and table cells, so every
// value is inert on the root, block boxes, flex and grid items (blockified spans and inline-blocks among them), relatively and
// absolutely positioned boxes; baseline is also proven on an inline box. inline.ts's reject pins a non-baseline value there (INL2).
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const VERTICAL_ALIGN: readonly FixtureSpec[] = [both('vertical-align-inert')];
