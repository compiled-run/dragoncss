// Fixture group opacity (PNT1, css-color-4 §14.1): opacity groups Chrome folds into their one draw (a background alone) and ones it
// composites as a layer (a background with a child, text, a border, a nested group, text alone), a percentage, 0 and a clamped 1.5,
// and the cascade (inherit, var(), calc(), a negative value, 500%, initial), in both environment directions. Every group sits clear of
// the cc raster tile seams at DPR 2, 3 and 2.625 in both directions (x in 16-48, 64-96 or 104-136 css px, y below 168), so Chrome's
// per-tile folding of a group's draws never applies. A percentage calculation is refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const OPACITY: readonly FixtureSpec[] = [
  both('opacity-basic'),
  both('opacity-cascade'),
  reject('opacity-reject-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(50% + 10%)', 'opacity: calc(50% + 10%) is unsupported:'),
];
