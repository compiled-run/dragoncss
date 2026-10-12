// CTX-PROOF-2: inherit on the flex, box-sizing, margin, padding and border-width longhands, in block flow (where the
// coverage-rank alias probes use it) and in flex containers and items (where the inherited value moves a frame). The resolver
// handles inherit the same way for every longhand; these fixtures give its rows their Chrome proof. Both environment directions.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const INHERIT_CONTEXTS: readonly FixtureSpec[] = [
  both('ctx-proof-inherit'),
];
