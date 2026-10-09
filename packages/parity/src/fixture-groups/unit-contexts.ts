// CTX-PROOF-3: viewport units on the min and max sizes (min-height: 100vh is the common full-screen idiom), which the engine
// already resolves as it does height: 100vh: proven in block flow and on flex items, each value binding a frame in Chrome.
// Both environment directions.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const UNIT_CONTEXTS: readonly FixtureSpec[] = [
  both('ctx-proof-units'),
];
