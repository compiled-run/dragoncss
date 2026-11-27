// Fixture group sizing-ratio (SIZE-ar, T050): css-sizing-4 §5.1 aspect-ratio on non-replaced boxes, as Chrome 145 applies it,
// in block flow, flex rows and columns and absolute positioning, plus the music-player demo's record, record label and 16 / 9
// video shell, in both directions. ARAT: ratios whose parts are not whole 64ths, converted as Blink LayoutRatioFromSizeF does, in
// block flow, flex, grid columns, absolute positioning, at the tiny-part and equal-part edges, and the Markless shop's skeleton
// card at four content widths. The rejects name what Dragon refuses beside a ratio.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const SIZING: readonly FixtureSpec[] = [
  both('sizing-ratio-block'),
  both('sizing-ratio-flex-row'),
  both('sizing-ratio-flex-column'),
  both('sizing-ratio-abspos'),
  both('sizing-ratio-demo'),
  both('sizing-ratio-fraction-block'),
  both('sizing-ratio-fraction-flex'),
  both('sizing-ratio-fraction-grid'),
  both('sizing-ratio-fraction-abspos'),
  both('sizing-ratio-fraction-edge'),
  both('sizing-ratio-shop'),
  reject('reject-sizing-ratio-percent-height', 'DRAGON_UNSUPPORTED_VALUE', '50%', 'height: 50% beside aspect-ratio: 2 / 1 on a is unsupported'),
  reject('reject-sizing-ratio-percent-height-fraction', 'DRAGON_UNSUPPORTED_VALUE', '50%', 'height: 50% beside aspect-ratio: 3 / 3.4 on a is unsupported'),
  reject('reject-sizing-ratio-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(1/2)', 'aspect-ratio: calc(1/2) is unsupported'),
];
