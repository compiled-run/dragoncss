// CTX-PROOF: values the engine already lays out, proven in the contexts the profiles lacked a fixture for (auto margins in block
// flow, auto insets on positioned boxes, rem, em, vw and vh gaps in each kind of flex container). Both environment directions.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const CTX_PROOF: readonly FixtureSpec[] = [
  both('ctx-proof-auto-margins'),
  both('ctx-proof-auto-insets'),
  both('ctx-proof-auto-flex'),
  both('ctx-proof-flex-gap-units'),
];
