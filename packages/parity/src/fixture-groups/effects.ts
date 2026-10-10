// Fixture group effects (PNT1): opacity (css-color-4 §14.1) and z-index with CSS2 Appendix E paint order.
// opacity: the values the native targets draw, 0 and 1, on boxes that would fold (a background alone) and that would composite as a
// layer (a background with a child, text, a border, a nested group, text alone), with percentages, a clamped 1.5 and -2, and the
// cascade (inherit, var(), calc(), a negative value, 500%, initial). A fractional opacity is refused natively (platform compositing
// rounds unlike Skia; package PNT1-opacity-b), and every layout fixture compiles natively, so none is here; the host paint model
// still pins Chrome's fractional composite bytes (pnt1-effects.test). Every group sits clear of the cc raster tile seams at DPR 2, 3
// and 2.625 in both directions (x in 16-48, 64-96 or 104-136 css px, y below 168). opacity-web holds the fractional cases (0.3,
// 45%, an inherited 0.5, translucent groups with a child, text and a border): the lanes compile it on native as a lane-only case
// (project.ts), so it proves web rows only, and the device pixel lanes skip what its groups paint (pixel-reference.ts devicePoints).
// stacking: overlapping positioned boxes and stacking contexts whose paint order differs from tree order: z-index 2, 1, auto, -1 and
// -2 in the root context, a relative box over a later flow sibling, a flex item with a z-index over its later sibling, a
// will-change: opacity context holding a z-index 10 child under a z-index 1 box outside it, a z-index 0 context with a negative
// child between its background and its flow child, a relative box inside a relative parent over the parent's later flow child, an
// absolute z-index box escaping an overflow clip that is not its containing block, the music player's z-index 40 button over two
// later z-index 20 and 30 overlays, and transformed and will-change: opacity boxes, which paint in the z-index 0 layer. Sample centres sit in the overlaps,
// so the device pixels compare the order. The rejects: a percentage calculation in opacity, a z-index calculation that is not a whole
// number. The native-only stacking refusals cannot be reject fixtures (a reject blocks web too); dragon test/paint-stacking.test.ts
// compiles each of them.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const EFFECTS: readonly FixtureSpec[] = [
  both('opacity-basic'),
  both('opacity-cascade'),
  both('opacity-web'),
  reject('opacity-reject-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(50% + 10%)', 'opacity: calc(50% + 10%) is unsupported:'),
  both('stacking-basic'),
  both('stacking-context'),
  both('stacking-escape'),
  both('stacking-transform'),
  reject('stacking-reject-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(3 / 2)', 'z-index: calc(3/2) is unsupported: the calculation is not a whole number'),
];
