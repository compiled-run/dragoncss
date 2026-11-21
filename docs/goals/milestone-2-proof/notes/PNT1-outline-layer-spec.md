# PNT1-outline-layer: native outlines beside and inside positioned layers, binding worker spec (2026-11-21)

Why now: the Markless notes app (the owner's 2026-11-30 checkpoint, Markless issue #974) gives every focusable element
`:focus-visible { outline: 3px solid }` and has a `position: sticky` header. Master refuses every outline in a case that holds
any layer item of the stacking tree (`outline-stacking`, "Dragon draws native outlines after all the content until it hosts
them in their stacking context"), so every styled notes page with the header is refused.

Not in scope: an outline under an overflow clip (#582, owner, open), an outline on an inline box (per line fragment), and an
outline inside a group (opacity, transform, filter and the like), which is the follow-up PNT1-outline-group.

## 1. Scope and refusals

Compiles on iOS and Android after this task, wherever master already compiles the outline on its own (solid and double at any
radius; dotted, dashed and 3D on square corners; opaque side-painter colours):
- an outline in a case with layer items (relative, absolute, fixed or sticky boxes, with or without a z-index; a flex or grid
  item with a z-index), beside them or covered by them;
- an outline inside such a layer, at any depth, including the layer box's own outline;
- an outline beside a group layer (opacity, transform, filter, ...), as long as it is not inside it.

Still refused at the outline, `DRAGON_UNSUPPORTED_VALUE`, basis `computed-value`, each with its own message:
- an outline whose box, or any ancestor, makes a layer by anything but its position or z-index: opacity below 1, a transform,
  perspective or backdrop-filter, will-change: transform or opacity, a clip-path, containment, a mask image, isolation: isolate,
  backface-visibility: hidden, a mix-blend-mode, a filter, or the top layer (`outline-stacking`, "inside X, which has Y, and Dragon
  draws native outlines only in the layer of a positioned box, a z-index or the root, not yet inside a layer made by Y"). Some of
  these (opacity, transforms, filters) are device groups the outline view would not join; the others are refused until a fixture
  proves them;
- any outline in a case where a layer item stays under an overflow clip its layer would take it out of (stacking.ts underClip): its
  view sits among the clip's flow, so it would paint before its layer's outlines, where Chrome paints it after them;
- the own outline of a layer item that clips its overflow (the layer's view clips the views it hosts);
- an outline under an overflow clip or scroller (unchanged, `outline-clip`; wording now says "in their paint layer's view").

Unchanged: auto, PNT1b rounded side-painter styles, translucent side-painter colours, inline boxes.

## 2. Rulings

R1. An outline paints in its box's paint layer: the box itself when it is a layer item, else its nearest ancestor that is one,
else the root. Evidence: Chrome 145 `PaintLayerPainter::PaintLayerContents` paints, per self-painting layer,
kSelfBlockBackgroundOnly, kNegativeZOrderChildren, the foreground phases (`PaintForegroundPhases`: descendant block
backgrounds, floats, foreground, then kDescendantOutlinesOnly), kSelfOutlineOnly, then kNormalFlowAndPositiveZOrderChildren.
A box's outline is in the descendant-outline phase of the layer that paints it, or the self-outline phase of its own layer.
Dragon's layer items (positioned boxes, stacking contexts, normal-flow layers) are all self-painting layers.

R2. Within a layer, outlines keep master's order: each box's descendants' outlines before its own (BoxFragmentPainter,
kDescendantOutlinesOnly then kSelfOutlineOnly), boxes in tree order. The layer's outlines paint after its flow content and its
negative-z items, and before its normal-flow layers and z-index auto, 0 and positive items. In Dragon's placement buckets
(lower/paint/stacking.ts): after bucket 0, before bucket 1.

R3. The fact is the analysis's: `StackingFacts.paintLayer`, computed once by `stackingOf`. The compiler check, the native
emitter, the program write and the Markless export read it; nothing re-derives it.

R4. An outline inside a group is refused (scope above) because the native group composite (opacity-group, nested and filter
groups, PNT1-opacity-b) builds the group's pixels from box views only, so an outline view would not join it as Chrome's layer
does. An outline beside a group compiles: it paints before the group in R2's order.

R5. A layer item that clips its overflow and has its own outline is refused: Chrome paints the self outline under the layer's
local border-box properties, outside its own clip, but its native view clips what it hosts.

R6. Dragon's layer items are Blink's self-painting layers, so R1's "paint layer" is the same set on both sides: Blink gives a box a
self-painting layer exactly when it is stacked or has a hidden backface (LayoutBox::LayerTypeRequired: kNormalPaintLayer for
IsStacked() or HasHiddenBackface(); PaintLayer::ShouldBeSelfPaintingLayer is kNormalPaintLayer), and Dragon's isItem is positioned,
a stacking context or a normal-flow (backface) layer. Blink stacking triggers Dragon does not put in its stack tree are refused on
native before this check: transform-style: preserve-3d (checkTransformExtra), will-change values other than auto, transform and
opacity (PNT2), view-transition-name other than none and the root's (view-transition.ts). perspective and backdrop-filter are
transforms here (transformsDescendants). Known gap, not claimed: a running transform or opacity animation makes a stacking
context in Chrome and not in Dragon's stack tree; it predates this task.

R7. Known gap, not claimed (it predates this task and is filed as a Dragon issue): Blink paints a flex item, grid item or
inline-block atomically (BoxFragmentPainter::PaintAllPhasesAtomically paints its outline inside the parent's foreground phase), so a
later flow sibling covers its outline; Dragon paints it in the layer's outline phase, over that sibling. outline-layers has no
such overlap.

## 3. How each target is reached

- Web: unchanged (the browser paints outlines).
- Program write: `outline` gains `layer`, the paintLayer node id. The Markless export carries it unchanged, so a host puts the
  outline in that node's view after its flow children and before its layer items (docs/markless-native-styles.md says so).
- iOS and Android: `dragonSetOutline(t, v, layer, ...)` hosts the outline view in the layer's box view, framed in that view's
  coordinates (rings minus the layer's snapped device-px origin). `DragonTree.apply` re-adds every view in box order, so a new
  registration point, the after-tree hook (emit/native-support.ts `dragonAfterTree`, emit/paint/types.ts `afterTree`), runs
  once every view is placed: `dragonAfterTreeOutline` puts each layer view's outline views after its flow children and before
  its first layer item (bucket 1 or 2, a group overlay, or a layer item's outer shadow view), in R2's order. The after-layout hook
  does the same for its layer, and `dragonSortPaintOrder` keys an outline view after bucket 0 and before bucket 1, so a later sort
  keeps it there. The readback is each ring in device px from the root at the outline view's live layout position
  (dragonLayoutRect, dragonLayoutOffset), and null when the outline view is not in its layer's view among the outline views
  between the flow children and the layer items.
- Sticky: the claim is proven unscrolled. Scrolled, an outline inside the sticky box moves with it because its view is a subview of
  the sticky view (whose movement the sticky lane proves), and an outline under it stays beneath it because the sticky view is a
  later sibling; no scrolled outline capture is claimed.

## 4. Proofs and planted faults

- New fixture `outline-layers` (both directions, group outline), Chrome 145 PNGs from regen at every device DPR: an outline
  covered by a later sticky box; outlines inside a sticky bar (its own and its children's); relative boxes with and without
  z-index over a later sibling's outline; an absolute box whose outline paints over flow outlines; a fixed box; a negative
  z-index box under an outline; a flex item with a z-index.
- pnt1-effects' Appendix E paint model paints each layer's outlines in its outline phase (rings from the TS outlineRings and
  outlinePaintOps, as outline-model.ts), in a describe block of its own for outline-layers: every non-edge sample point equals
  Chrome exactly, and every device DPR has outline points. pnt1-outline's model (every outline last) leaves outline-layers out.
- Model twin of the plant: every outline painted last over the whole case (master's order) must differ from the model at
  non-edge points matching PLANT_RULES['outline-root-hosted'] (`/^(interior|border):/`) at every device DPR.
- Device plant `outline-root-hosted`: the outline view hosted in the tree's root view. PLANT_CASES `outline-layers`. The readback
  is null under the plant, so the dump lane fails too.
- packages/dragon/test/paint-outline.test.ts: the master refusal test is replaced by: the compiling layer cases above; each
  group reason refused by name inside and on the box; a clipping layer's own outline refused; an outline beside a group
  compiling; the outline write's `layer` for flow, nested and self cases.

## 5. File map

Owned: packages/dragon/src/analysis/paint-values/outline.ts, packages/dragon/src/lower/paint/outline.ts,
packages/dragon/src/lower/paint/stacking.ts (one fact), packages/dragon/src/emit/paint/outline.ts,
packages/dragon/src/emit/paint/stacking.ts (outline views in the sort), packages/dragon/src/emit/native-support.ts and
packages/dragon/src/emit/paint/types.ts (the after-tree registration point), packages/dragon/test/paint-outline.test.ts,
packages/parity/test/pnt1-effects.test.ts, packages/parity/test/pnt1-outline.test.ts (leaves outline-layers out),
packages/parity/fixtures/outline-layers.html, packages/parity/src/fixture-groups/outline.ts, packages/parity/src/device-run.ts
(one plant line each), the committed Chrome PNGs of outline-layers (regen), docs/markless-native-styles.md (one paragraph).
Shared: paint-outline.test.ts with #621 (SELD-R2b) and #582; merge at landing.

## 6. Stop conditions

Chrome's pixels on `outline-layers` disagree with R1/R2 and no Chrome source explains it; the effects model cannot paint a
fixture box without a new paint feature (then trim the fixture, never the check).

## 7. PR plan

One PR on master (no stack). Follow-up PNT1-outline-group: outlines inside opacity and transform groups (notes' pressed and
focused buttons).

## 8. North-star delta and risk

Measured (Markless main 25ebf1def with apps/checkpoint/notes, this branch's compiler, `compileRungApp` with partial and
`dragonStyleExport` per page): notes `/tags` and `/tags/[tag]` lose every "has position: sticky" refusal; the next outline refusal
there is a button that is both `:focus-visible` (outline) and `:active` (`opacity: 0.85; transform: scale(0.97)`), an outline
inside its own layer (PNT1-outline-group). Markless compiles style exports with `output: 'program'`, so the state runtime's
refusal of outline writes (emit/runtime/state.ts) does not apply there; its hosts draw outline writes in the Markless host
change that consumes `layer` (Markless issue #974, the host outline claim). Reviewed diff about 45 KB. Risk: a host that ignores
`layer` keeps drawing outlines above sticky headers; the device lanes and the Markless host change catch that.
