// Fixture group showcase: visually rich fixtures built only from supported features, shown first in the native gallery
// (pnpm run native:gallery). Each is an ordinary layout fixture with the full parity checks.
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

export const SHOWCASE: readonly FixtureSpec[] = [
  // A music-player card: flex rows and columns, per-side border colours, background colours, var() colour tokens, logical
  // padding and borders, a percentage width, Ahem text.
  layout('showcase-player-card'),
];
