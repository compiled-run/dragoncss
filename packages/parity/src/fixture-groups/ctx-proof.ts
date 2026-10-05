// CTX-PROOF: values the engine already lays out, proven in the contexts the profiles lacked a fixture for (auto margins in block
// flow, auto insets on positioned boxes). Both environment directions; px and keyword values only.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const CTX_PROOF: readonly FixtureSpec[] = [
  both('ctx-proof-auto-margins'),
  both('ctx-proof-auto-insets'),
  both('ctx-proof-auto-flex'),
];
