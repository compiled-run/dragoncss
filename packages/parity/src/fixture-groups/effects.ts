// Fixture group effects (PNT1): opacity (css-color-4 §14.1) and z-index with CSS2 Appendix E paint order.
// opacity: the values the native targets draw, 0 and 1, on boxes that would fold (a background alone) and that would composite as a
// layer (a background with a child, text, a border, a nested group, text alone), with percentages, a clamped 1.5 and -2, and the
// cascade (inherit, var(), calc(), a negative value, 500%, initial, and the -webkit-opacity alias alone and in both orders with
// opacity). A fractional opacity on a group that neither folds nor meets the group rules is refused natively (platform compositing rounds
// unlike Skia), and every layout fixture compiles natively, so none is here; the host paint model still pins
// Chrome's fractional composite bytes (pnt1-effects.test). opacity-fold holds fractions native draws: groups of one opaque fill,
// which Chrome folds into the fill (0.3, 45%, calc(1 / 3), 0.5 over a light row, 0.00196 at a byte's rounding edge, 0.999 (byte 255),
// 0.7 white, an empty 0.4 that paints nothing and 0.62549 with a zero-width border). The opacity-group fixtures hold groups native
// pre-composites itself (PNT1-opacity-b, analysis paint-values/effects.ts opacityGroupPlans; layout paint-group.ts): text groups
// (opacity-group-text), groups with solid one-colour borders and opaque children (-border), border-only groups, whose one draw op cc
// folds when the border is four solid sides in one colour or a lone side, and does not with two sides, a child or text
// (-border-only), groups over earlier flow rects
// (-over-rects), a group over an earlier group (-over-group), and groups clipped by an opaque overflow: hidden backdrop
// (-clipped). S2: nested groups, one and two levels deep, whose inner group folds into its one fill or is a layer, inside an outer
// group with or without its own paint, a translucent fill or text (-nested), and translucent paint inside a group: a lone translucent
// fill (folded at the float alpha product), a translucent child fill, a translucent fill under a translucent four-side border, a
// translucent border alone (one op, folded), a translucent lone side, and opaque text over a translucent fill (-translucent). Every group sits clear of the cc raster tile seams at DPR 2, 3
// and 2.625 in both directions (x in 16-48, 64-96 or 104-136 css px, y below 168). opacity-web holds the fractional cases (0.3,
// 45%, an inherited 0.5, translucent groups with a child, text and a border): the lanes compile it on native as a lane-only case
// (project.ts), so it proves web rows only, and the device pixel lanes skip what its groups paint (pixel-reference.ts devicePoints).
// stacking: overlapping positioned boxes and stacking contexts whose paint order differs from tree order: z-index 2, 1, auto, -1 and
// -2 in the root context, a relative box over a later flow sibling, a flex item with a z-index over its later sibling, a
// will-change: opacity context holding a z-index 10 child under a z-index 1 box outside it, a z-index 0 context with a negative
// child between its background and its flow child, a relative box inside a relative parent over the parent's later flow child, an
// absolute z-index box escaping an overflow clip that is not its containing block, the music player's z-index 40 button over two
// later z-index 20 and 30 overlays, and transformed and will-change: opacity boxes, which paint in the z-index 0 layer.
// stacking-grid-items: a static z-index applies to every flex and grid item (Blink StyleAdjuster): a grid item with z-index 1 over a
// later sibling pulled under it, a z-index -1 grid item sharing a cell with an earlier flow item, inline-grid and inline-flex items
// with z-index 1, and z-index 1 grid and flex items whose order puts a later painted layer first in the tree.
// stacking-isolation: isolation: isolate makes a stacking context (compositing-1 §3.2): a z-index -1 child paints over its isolated
// parent's background, and an isolated flow box (in another ASCII case) paints over an earlier relative box it overlaps, in the
// z-index 0 layer; an isolation: auto box beside them keeps its negative child under its background.
// stacking-backface: backface-visibility: hidden gives a box a paint layer of its own that makes no stacking context (Blink
// LayerTypeRequired; a normal-flow layer): a hidden-backface box with a child paints over a later flow sibling it overlaps, one
// inside a flow wrapper (through the -webkit- alias) and one in another ASCII case paint under a later relative box, and a z-index
// -1 child of a hidden-backface box still paints under the stage's background, and two hidden-backface flex items whose order swaps
// them paint in tree order, so the later one, placed first, paints over the earlier where they overlap. Sample centres sit in the overlaps,
// so the device pixels compare the order. The rejects: a percentage calculation in opacity, a z-index calculation that is not a whole
// number. The native-only stacking refusals cannot be reject fixtures (a reject blocks web too); dragon test/paint-stacking.test.ts
// compiles each of them.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const EFFECTS: readonly FixtureSpec[] = [
  both('opacity-basic'),
  both('opacity-cascade'),
  both('opacity-web'),
  both('opacity-fold'),
  both('opacity-group-text'),
  both('opacity-group-border'),
  both('opacity-group-border-only'),
  both('opacity-group-over-rects'),
  both('opacity-group-over-group'),
  both('opacity-group-clipped'),
  both('opacity-group-nested'),
  both('opacity-group-translucent'),
  reject('opacity-reject-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(50% + 10%)', 'opacity: calc(50% + 10%) is unsupported:'),
  both('stacking-basic'),
  both('stacking-context'),
  both('stacking-escape'),
  both('stacking-transform'),
  both('stacking-grid-items'),
  both('stacking-isolation'),
  both('stacking-backface'),
  reject('stacking-reject-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(3 / 2)', 'z-index: calc(3/2) is unsupported: the calculation is not a whole number'),
];
