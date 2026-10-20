// Fixture group media (notes/T025 §3 B item 9), 400x300 in ltr and rtl: max-width, min-width and range atoms that are true,
// false and equal at 400, em thresholds under a 20px root, not, or and the comma list, nested @media, overlapping breakpoints
// as in the north star, the cascade across @media blocks, width and height atoms in one condition, and (MQ-R0) orientation,
// aspect-ratio and 1/64 px thresholds. The media sweep (media-sweep.ts) renders each one at every band.
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
  // Width and height atoms together: a band needs both axes, and the sweep crosses them (PR #38 finding 4142696777). No height
  // threshold sits at 300: at DPR 2.625 Chrome's viewport is 787.5 device px tall, so its CSS height is not exactly 300.
  both('media-two-axis'),
  // MQ-R0 (notes/T067 §4): orientation and aspect-ratio bands (whole px, a square is portrait) and thresholds within 1/64 px of a
  // whole width, which Chrome's slack moves across it. No ratio or height boundary sits where DPR 2.625's 300.19 px height moves a band.
  both('media-orientation'),
  both('media-aspect-ratio'),
  both('media-epsilon'),
  reject('reject-media-prefers-color-scheme', 'DRAGON_UNSUPPORTED_AT_RULE', '@media (prefers-color-scheme: dark) { .a { width: 20px; } }', '@media (prefers-color-scheme: dark) in the stylesheet is not supported: (prefers-color-scheme: dark) depends on the device or the user, which Dragon does not read yet (package MQ-R2)'),
  // MQ-R2 reads resolution; a calc() value is still not evaluated.
  reject('reject-media-resolution', 'DRAGON_UNSUPPORTED_AT_RULE', '@media (max-width: 500px) and (min-resolution: calc(2dppx)) { .a { width: 20px; } }', '@media (max-width: 500px) and (min-resolution: calc(2dppx)) in the stylesheet is not supported: (min-resolution: calc(2dppx)) uses a value Dragon does not evaluate'),
];
