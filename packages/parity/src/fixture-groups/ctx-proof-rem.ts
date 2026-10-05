// CTX-PROOF: rem lengths in the contexts the north-star screen (examples/music-player) uses them, where px was proven and rem was
// not: padding and min-height on relative flex-row items, padding on absolute boxes, width, max-width and insets on flex-column
// items, min-width on flex-row items. Both environment directions.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const CTX_PROOF_REM: readonly FixtureSpec[] = [
  both('ctx-proof-rem'),
];
