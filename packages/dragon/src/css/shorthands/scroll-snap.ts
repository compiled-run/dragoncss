// css-scroll-snap-1 §5, §6: scroll-padding and scroll-margin take one to four values over top, right, bottom and left (Blink
// ScrollPadding and ScrollMargin ConsumeShorthandVia4Longhands), their -inline and -block forms one or two over the start and end
// edges, and each flow-relative longhand maps onto the physical longhand of its edge (css-logical-1 §4), as Chrome 145 registers them.
import type { ShorthandHandler } from './shared.ts';
import { fourSides } from './shared.ts';
import { edgePair, one, slot } from './logical.ts';

export const SCROLL_SNAP_SHORTHANDS = {
  'scroll-padding': fourSides(['scroll-padding-top', 'scroll-padding-right', 'scroll-padding-bottom', 'scroll-padding-left']),
  'scroll-padding-inline': edgePair('scroll-padding-*', 'inline'),
  'scroll-padding-block': edgePair('scroll-padding-*', 'block'),
  'scroll-padding-inline-start': one(slot('scroll-padding-*', 'inline-start')),
  'scroll-padding-inline-end': one(slot('scroll-padding-*', 'inline-end')),
  'scroll-padding-block-start': one(slot('scroll-padding-*', 'block-start')),
  'scroll-padding-block-end': one(slot('scroll-padding-*', 'block-end')),
  'scroll-margin': fourSides(['scroll-margin-top', 'scroll-margin-right', 'scroll-margin-bottom', 'scroll-margin-left']),
  'scroll-margin-inline': edgePair('scroll-margin-*', 'inline'),
  'scroll-margin-block': edgePair('scroll-margin-*', 'block'),
  'scroll-margin-inline-start': one(slot('scroll-margin-*', 'inline-start')),
  'scroll-margin-inline-end': one(slot('scroll-margin-*', 'inline-end')),
  'scroll-margin-block-start': one(slot('scroll-margin-*', 'block-start')),
  'scroll-margin-block-end': one(slot('scroll-margin-*', 'block-end')),
} as const satisfies { readonly [s: string]: ShorthandHandler };
