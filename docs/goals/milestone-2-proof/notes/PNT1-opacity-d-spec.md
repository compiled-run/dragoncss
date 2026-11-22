# PNT1-opacity-d: pre-composited groups over a platform-rendered backdrop, transformed, and in sticky or fixed layers (Judge-reviewed, changes applied)

Why: Markless notes (owner checkpoint 2026-11-30, Markless #974). Every page has `<a class="button primary">` in a `position: sticky`
header, with `.button:active { transform: scale(0.97); opacity: 0.85 }`, `border-radius: 999px`, a 1 px border, text, and
`:focus-visible { outline: 3px solid }`. Page bodies have more `.button`s over the canvas after text. On master plus #625/#627/#629/#635
each pressed button is refused, in order: `b has a transform` (a transformed box is never a group), `it is inside bar, which has
position sticky`, `the text of p paints before it in its backdrop the canvas` (painters are modelled in software, so text, rounded
painters and anything but square fills before the group are refused). The transform on `inline-flex` itself is dragonCSS#630
(dragon-slots), not this task. Planner ruling on #974 (2026-11-22, for the owner): the platform renders the backdrop (option A); the
app never changes for the phone; any case that cannot match Chrome is named on #974.

## Scope

Admitted (native targets), on top of master's group rules:
1. **Platform backdrop.** Q = composite of the group's layer L over B, where B is the platform's own rendering of the root view with
   the group's view and every view that paints after it hidden, over the group's extent in root device px (iOS `CALayer.render(in:)`
   with those layers `isHidden` inside a `CATransaction` with actions disabled; Android `View.draw` into a software `Canvas` with a
   `dragonBackdropPass` flag that `DragonBoxView.drawChild` reads to skip the hidden views). "After" is the device's own paint order:
   later siblings of the group's view and of each of its ancestors up to the root, after `dragonSortPaintOrder`. This replaces the
   software painter model (white, square fills, solid sides, earlier Q): the platform draws those bytes identically, and also text,
   rounded boxes, images and earlier overlays. The backdrop box and painter list go; the painter refusals go with them.
2. **Transformed group.** The group's own 2D transform (functions Dragon draws: translate, rotate, scale) and transforms on its
   members stay refused as today except the group's own. L is the platform's rendering of the group view in its local device px
   (as today); B is sampled through the group's transform: Q_local(u) = composite(L(u), B(T(u))) with T the group view's live
   transform to root device px, nearest sample. The overlay stays the group view's last child, so the platform maps Q by T.
3. **Fold under a transform.** Each draw item's rect (the fold list) is mapped by T to its root-device-px bounding box before the
   tile query (Blink paint_chunks_to_cc_layer.cc maps item visual rects into the layer's space; cc's rtree holds them there).
4. **Group in a sticky or fixed layer.** Tiles are taken in that layer's space: origin at the sticky or fixed box's border box
   (unscrolled, as #625's sticky claim), size by cc tile_size_calculator.cc's CPU path for the layer's bounds. Ancestors between the
   group and that layer must not be transformed, filtered, translucent or scrollers (master's rules).
5. **Staleness.** Besides box layout and paint changes (master), a text view's text or colour change, an image load, a scroll of any
   scroller when the group is inside a sticky or fixed box or a sticky or fixed box paints before it, and a transform write on the
   group mark every overlay stale.

Refused (DRAGON_UNSUPPORTED_VALUE at the opacity or filter declaration, `this one is not: <reason>`):
- a transform with skew, matrix, perspective or 3D on the group (`it has a transform Dragon does not draw in 2D`);
- a transform on a member or between the group and its layer (`<id> inside it is transformed`, `it is inside <id>, which is transformed`);
- an animation or transition on any box that paints before the group in its stacking context or on a member (refuseAnimatedGroups
  scope grows to the order slice before the group: B is captured on change, not per frame);
- a group in a scroller other than the viewport (master);
- unchanged: filters other than colour-matrix, will-change: opacity, S2 limits.

## R-rulings

R1. **B is exact wherever Chrome's backdrop pixel equals the platform's.** Q = blend(L(p), B(p)) per pixel (Color32/s32a, measured,
    paint-group.ts). The parity sample points are exactly where the device equals Chrome (fills, borders, clear of glyphs and arcs),
    so Q equals Chrome at a sample point whose backdrop pixel is one. Evidence: the pnt1-effects model with B taken from the committed
    Chrome pixels of the same case with the group removed (twin case) equals Chrome at every non-edge point.
R2. **Transformed content.** Chrome draws a statically transformed group as Save, Concat(T), SaveLayerAlpha, items, Restore
    (paint_chunks_to_cc_layer.cc ConversionContext::SwitchToEffect/SwitchToTransform), rasterized at device px; an interior point of a
    flat fill under T has the fill's colour. Q_local(u) mapped by T with nearest sampling lands within half a device px of p, so B(T(u))
    equals B(p) at points clear of B's edges by the sample inset. Measurement: fixture opacity-group-transform (below).
R3. **Fold rect mapping.** cc's rtree holds each op's visual rect mapped to the layer (display_item_list.cc / paint_chunks_to_cc_layer
    .cc:1081-1082); the tile query is outset by 1 px (#629). Measurement: a transformed lone fill crossing a tile seam folds in each tile.
R4. **Sticky layer tiling.** A sticky box under a composited root scroller is its own layer (compositing reason sticky position);
    CPU tiles: tile_size_calculator.cc:216-237 (content height under the default tile height gives a full-width tile row;
    width-and-height under max untiled size gives one tile). Measurement: fixture opacity-group-sticky places a lone fill across the
    sticky layer's x seam and must fold on each side; the twin with root tiling must differ where the layer origin differs.

## Proofs and planted faults

- Fixtures (effects group, ltr and rtl, DPR 2, 3, 2.625):
  - `opacity-group-transform`: scaled (0.97, 1.5), rotated (8deg) and translated groups with fills, a rounded 1 px border and text,
    over flat backdrops and over text and a rounded painter (sample points clear of them); a lone fill crossing a tile seam under scale.
  - `opacity-group-sticky`: a sticky header with brand text, a rounded link and the notes button state (scale 0.97, opacity 0.85,
    rounded, 1 px border, text), and a translucent lone fill across the header's x seam.
  - `opacity-group-painters`: groups after text, after a rounded box, after an image-free gradient-free mix of earlier groups.
- pnt1-effects model (the Chrome reference): it already paints every item before the group in Appendix E order, text and rounded
  boxes included, so B is the model's own paint at p; it gains group transforms: a group with T evaluates its items at T^-1(p) in
  local coordinates (the transform sample module supplies mapped points) and its fold maps item rects by T. Exact at every non-edge
  point of the three fixtures at every DPR. Twins: B taken from the software painter model (master) misses the text and rounded
  painter points; untransformed L misses the scaled points; root tiling misses the sticky seam points.
- Planted (device-run PLANT_CASES/RULES):
  - `group-backdrop-unhidden`: B rendered with the group visible (the group counted twice);
  - `group-transform-unmapped`: B sampled at u instead of T(u);
  - `group-sticky-root-tiles`: sticky tiles from the root scroller origin.
- Dragon unit tests: admission and each refusal by name; the write's new fields.

## Targets

iOS and Android device code in emit/paint/effects.ts (Swift and Kotlin); analysis/paint-values/effects.ts; lower/paint/effects.ts
(write fields: `transformed`, `layer` origin box id, `scroll` staleness flag); layout/src/paint-group.ts (rect mapping helper).

## File map

Owned: packages/dragon/src/analysis/paint-values/effects.ts, lower/paint/effects.ts, emit/paint/effects.ts,
emit/native-support.ts (drawChild flag, stale hooks; shared with #625's afterTree), layout/src/paint-group.ts,
parity fixtures and pnt1-effects.test.ts (shared with #625, #629, #635: merge order #625, #629, #635, this).

## Evidence stop conditions

Stop and report on #974 if: Chrome's pixel at an interior point of a transformed translucent flat fill over a flat backdrop is not
blend(fill, backdrop) at the group's alpha byte; a sticky layer's fold does not follow either tiling model; or iOS render(in:) /
Android software draw differs from the on-screen pixels at a sample point of the backdrop.

## PR plan

One PR on master after #635 lands (or stacked on #635: 2 deep). Device code first, then fixtures; regen on CI; devices label run.

## North-star delta

Compiles the pressed `.button` on every notes page. With #630 (transform on inline-flex), #621 (SELD-R2b), #622, the placeholder
attribute and the select chain, notes pages become styled-buildable; this task alone unblocks no page.

## Size and risk

~60-90 KB. Risk: the group compositor is shared by every translucent box; master's admitted fixtures must stay byte-identical on the
device lanes (the platform draws master's painters with the same bytes as the software model). Cost: one root render per stale
recompute, scoped to the group's extent; scroll recompute only for sticky/fixed cases.

## Judge review (2026-11-22): approve with required changes, applied as follows

Stages (one PR each, at most two stacked):
- **D1: platform backdrop + scale/translate groups.** B is a root render: iOS hides `CALayer`s (`layer.isHidden`, never `view.isHidden`)
  of the group and of every later sibling of it and of each ancestor, inside a `CATransaction` with actions disabled, restoring each
  layer's previous hidden state exactly; every earlier group's Q is recomputed first (overlays recompute in paint order); B starts as the
  canvas colour (white), then `render(in:)`. Android: a `dragonBackdropPass` flag read by every Dragon ViewGroup (box and clip views)
  in `drawChild`, rounded clips applied with `canvas.clipPath` during the pass (API 33+ `clipToOutline` is not applied by a software
  canvas; API 31/32 overlay masks measured or refused). Transform on the group: scale and translate only (notes needs scale 0.97);
  rotation stays refused (`it is rotated`). Nearest-sample bound: T(centre of u) is within 0.5*sigma per axis of p (sigma <= 1 for
  admitted scales; scale above 1 refused until measured). Q = 0 where L's alpha is 0 (the real backdrop shows through). Fold: a
  transformed group is admitted only when no tile can fold under any tiling (rule N below), so no fold mapping is needed (R3 kept as
  measured evidence only).
  **Rule N (no fold under any tiling):** the group box's own decoration is at least two ops (a fill and a border), and no member other
  than the group box draws a one-op item (a lone fill, a lone border, a lone side); text never folds. Derived from the analyzer's op
  count, so it holds for every tile grid. The group box's own outline (with #629) lies inside its decoration item's visual rect
  (box_painter.cc / physical_box_fragment.cc: the item rect is the visual overflow, which includes the outline).
  Refused, newly: a group inside or painted after a sticky or fixed box in any enclosing stacking context (Chrome may composite it in
  another cc layer whose tile origin and content Dragon cannot see) - D2/D3 lift parts; any animation or transition on any box painted
  before the group (render(in:) draws the model tree); a rotated or upscaled group. Master defect fixed by this refusal: a group painted
  after a sticky box behind a clipping backdrop was admitted with root tiling (measured wrong, fold-sticky.html); named on #974.
  Staleness adds: transform, alpha, visibility or mask writes on any box; DragonTree.apply re-sorts or inserts or removes views; an
  earlier group's recompute marks later groups stale; text and colour changes of text views; native control state; dark mode and
  font size; device scale, size and rotation. The capture itself marks nothing stale.
  Proof: fixtures opacity-group-transform (scale and translate groups over flat fills, text and a rounded painter) and
  opacity-group-painters (groups after text, a rounded box, an earlier group, a translucent non-group fold, a clip); the model equals
  Chrome at every non-edge point; device lanes: B equals the device's own screenshot at every sample point (a readback of B), and every
  master opacity-group fixture keeps its bytes. Plants: `group-backdrop-unhidden`, `group-backdrop-later-visible`,
  `group-hidden-not-restored`, `group-backdrop-stale-text`; unit: a one-op member under rule N refused.
- **D2: a group inside a sticky or fixed box whose own content under the group is opaque** (the header button). Chrome composites the
  group into the sticky layer over that layer's earlier content (one-step composite, exact) when the layer exists, or into the root layer
  when it does not (compositing_reason_finder.cc:274-282: only when the scroll container overflows) - both one-step, same B. The device
  checks at every layout that the sticky box's opaque background covers the group's extent; if not, it composites without the condition
  and sets a named readback field (`backdropUnknown`) so parity reports a named mismatch; never fatalError. Rule N applies.
- **D3: a group painted after a sticky or fixed box** (notes' body buttons). Chrome composites it into a decomposited layer over
  transparent pixels, then that layer over the lower layers (two-step). Proof needed first: the two-step bytes over every byte value
  (Skia restore onto transparent, then the compositor's src-over draw) equal the one-step composite, or the device uses the two-step
  formula when the root overflows (a device fact). Measured: one point equal (fold-sticky.html). Stop condition: if they differ and the
  layer's other content under the group cannot be known, name the case on #974.
