// Fixture group media (notes/T025 §3 B item 9), 400x300 in ltr and rtl: max-width, min-width and range atoms that are true,
// false and equal at 400, em thresholds under a 20px root, not, or and the comma list, nested @media, overlapping breakpoints
// as in the north star, and the cascade across @media blocks. The media sweep (media-sweep.ts) renders each one at every band.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const MEDIA: readonly FixtureSpec[] = [
  both('media-max-width'),
  both('media-min-width'),
  both('media-range'),
  both('media-em-root'),
  both('media-logic'),
  both('media-nested'),
  both('media-overlap'),
  both('media-cascade-order'),
  reject('reject-media-prefers-color-scheme', 'DRAGON_UNSUPPORTED_AT_RULE', '@media (prefers-color-scheme: dark) { .a { width: 20px; } }', '@media (prefers-color-scheme: dark) in the stylesheet is not supported until MQ-R'),
  reject('reject-media-resolution', 'DRAGON_UNSUPPORTED_AT_RULE', '@media (max-width: 500px) and (min-resolution: 2dppx) { .a { width: 20px; } }', '@media (max-width: 500px) and (min-resolution: 2dppx) in the stylesheet is not supported until MQ-R'),
];
