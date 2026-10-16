// CTX-PROOF: values the engine already lays out, proven in the contexts the profiles lacked a fixture for (auto margins in block
// flow, auto insets on positioned boxes, rem, em, vw and vh gaps in each kind of flex container). Both environment directions.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const CTX_PROOF: readonly FixtureSpec[] = [
  both('ctx-proof-auto-margins'),
  both('ctx-proof-auto-insets'),
  both('ctx-proof-auto-flex'),
  // A single-line container's cross-axis gap is inert (css-align-3 §8.1 puts it only between flex lines), so those rows prove it
  // is ignored, as inert-layout's do, on a line its items overflow, where the multi-line twin breaks into lines and applies it.
  both('ctx-proof-flex-gap-units'),
];
