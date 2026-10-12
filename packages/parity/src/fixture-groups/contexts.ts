// Context proofs for the north-star screen (examples/music-player): each fixture uses, in both environment directions, the
// declarations the north-star check reports as DRAGON_UNPROVEN_CONTEXT, in the formatting context the check names. px, % and
// keyword values only.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const CONTEXTS: readonly FixtureSpec[] = [
  both('context-absolute-in-flex-row'),
  both('context-relative-in-flex-row'),
  both('context-relative-in-flex-column'),
  both('context-relative-in-block'),
  both('context-root-zero'),
  both('context-root-box'),
  both('context-display-none'),
  both('context-not-flex-container'),
  both('context-text-align-flex-column'),
  both('context-block-insets'),
  both('context-flex-column-percent-width'),
];
