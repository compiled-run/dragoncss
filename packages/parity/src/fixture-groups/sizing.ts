// Fixture group sizing-ratio (SIZE-ar, T050): css-sizing-4 §5.1 aspect-ratio on non-replaced boxes, as Chrome 145 applies it,
// in block flow, flex rows and columns and absolute positioning, plus the music-player demo's record, record label and 16 / 9
// video shell, in both directions. The rejects name what Dragon refuses beside a ratio.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const SIZING: readonly FixtureSpec[] = [
  both('sizing-ratio-block'),
  both('sizing-ratio-flex-row'),
  both('sizing-ratio-flex-column'),
  both('sizing-ratio-abspos'),
  both('sizing-ratio-demo'),
  reject('reject-sizing-ratio-percent-height', 'DRAGON_UNSUPPORTED_VALUE', '50%', 'height: 50% beside aspect-ratio: 2 / 1 on a is unsupported'),
  reject('reject-sizing-ratio-inexact', 'DRAGON_UNSUPPORTED_VALUE', '0.7', 'aspect-ratio: 0.7 / 1 on a is unsupported'),
  reject('reject-sizing-ratio-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(1/2)', 'aspect-ratio: calc(1/2) is unsupported'),
];
