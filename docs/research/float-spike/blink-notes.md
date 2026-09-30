# Blink 145.0.7632.6 floats: source reading matched to the probe

## Source and conventions

- **Source.** The source was read from the GitHub mirror at tag `145.0.7632.6`, at `raw.githubusercontent.com/chromium/chromium/145.0.7632.6/third_party/blink/renderer/...`. Every path below is relative to `third_party/blink/renderer/core/layout/` unless it starts with `core/` or `platform/`. A `file:line` refers to that tag.
- **Case ids.** Case ids refer to `probe/*.json` (see README.md).
- **Default environment.** Values are DPR 1, ltr, `horizontal-tb`, as `[x, y, w, h]` relative to the container, unless stated.

**Notation.**
- **LU** is a LayoutUnit, 1/64 px.
- **BFC** is the block formatting context.
- **Line-left and line-right** are the physical left and right in `horizontal-tb`, and the physical top and bottom in both vertical modes.
- Blink keeps all float geometry in BFC coordinates. A `BfcOffset` is `{line_offset, block_offset}`, measured from line-left and from block-start. So the exclusion code has no direction or writing mode in it. Direction enters only when `inline-start`/`inline-end` are resolved and when a BFC offset is converted back to a logical child offset.

## 1. Length to LayoutUnit: truncation at device scale

- **The conversion.** `LayoutUnit(float)` and `LayoutUnit(double)` multiply by 64 and truncate toward zero (`platform/geometry/layout_unit.h:126-131`, "truncated to a multiple of Epsilon()").
- **Device scale.** At DPR N, Chrome lays out at N× zoom, so a CSS length L becomes `trunc(L·N·64)/64` device px. That is `trunc(L·N·64)/(64·N)` CSS px.
- **Measured.** From p-fractional-*, p-percent, l-edge-*, l-width-*, c-fractional-margin and b-fixed-fractional:

| authored | DPR 1 | DPR 2 | DPR 3 | DPR 2.625 |
| --- | --- | --- | --- | --- |
| 33.3px | 33.296875 | 33.296875 | 33.296875 | 33.2976 |
| 25.1px | 25.09375 | 25.09375 | 25.0990 | 25.0952 |
| 33.34px (right float) | 33.328125 | 33.3359 | 33.3385 | 33.3393 |
| 20.01px | 20 | 20.0078 | 20.0052 | 20.0060 |
| 19.99px | 19.984375 | 19.984375 | 19.9896 | 19.9881 |
| 150.01px | 150 | 150.0078 | 150.0052 | 150.0060 |
| 33.3% of 200 | 66.59375 | 66.59375 | 66.5990 | 66.5952 |

- **Decisions change with DPR.** For example:
  - **b-fixed-fractional.** A 150.01px flow-root beside a 50px float in 200 fits at DPR 1, because it truncates to 150. At DPR 2, 3 and 2.625 it moves below the float.
  - **l-edge-20p01.** A float 20.01px tall does not reach the third 10px line at DPR 1, because it truncates to 20 and the intersection test is strict (§4). At DPR 2 and 3 it does, so that line is shortened.
  - **p-fractional-sum.** A 33.34px right float is placed at `100 - 33.328125` at DPR 1 and at `100 - 33.3359` at DPR 2.
- **Rule for FLT-1.** Every float size, margin and offset must be truncated to 1/(64·DPR) CSS px before any exclusion arithmetic. The float engine must run in device LU, the same as the inline engine (inline-spike/blink-notes.md).

## 2. Placement (`floats_utils.cc`, `exclusions/exclusion_space.cc`)

- **Resolving `inline-start` and `inline-end`.**
  - `ComputedStyle::Floating(cb_direction)` maps `inline-start` and `inline-end` to left or right using the containing block's direction (`core/style/computed_style.h:1497-1507`). The float's own direction does not count.
  - Measured: `p-inline-start-own-rtl` and `p-inline-start-own-ltr` put the float at the container's inline-start in both directions.
  - Chrome keeps `inline-start` as the computed value.
- **The top-edge rule.**
  - `AdjustToTopEdgeAlignmentRule` (`floats_utils.cc:31-38`) raises the origin to `exclusion_space.LastFloatBlockStart()`. That is the largest block-start of any float added so far (`exclusion_space.cc:321-322`, getter `exclusions/exclusion_space.h:199`).
  - The rule compares against float tops only. It is not the block-end of the preceding float, and not the line boxes.
  - Measured:
    - p-top-edge: the fourth float `d` (right, 30x10) is placed at y 40, beside `c`, although the space at y 10-40 on the right is free.
    - p-top-edge-gap: `c` (5x5) lands at y 10, not y 0.
- **Clearance on a float.** `FindLayoutOpportunityForFloat` (`floats_utils.cc:40-60`) applies the float's own `clear` through `ClearanceOffset(clear_type)` (`:49-55`), then asks for an opportunity at least `inline_size + margins.InlineSum()` wide (`:57-59`). Cases: p-clear-self, p-clear-self-left.
- **Finding the opportunity.** `DerivedGeometry::FindLayoutOpportunity` (`exclusion_space.cc:638-668`) walks the opportunities in block order and takes the first one where either:
  - the opportunity is at least as wide as the margin box; or
  - the opportunity has the full available width and starts at the origin's line offset (`:657-659`).

  The second clause places too-wide floats:
  - p-wider-than-cb: a 250px left float at x 0.
  - p-wider-right: a 250px right float at x -50.
  - p-wider-after-float: a 250px float skips the gap beside a 50px float and goes to y 20, where the full width is free.
- **Shortcut when everything is cleared.** If the offset is at or past every clear offset, the opportunity is simply the whole available width (`exclusions/exclusion_space.h:49-68`).
- **Line-right floats.** `PositionFloat` (`floats_utils.cc:212`) puts line-right floats at the opportunity's line-right edge minus the margin box (`:381-387`). The border box is the margin box moved in by the line-left and block-start margins (`:430-433`). Case: p-margins (`a` at [5,5], `b` at x 60).
- **Available size.** A float is laid out with the container's available size, not the opportunity's (`CreateConstraintSpaceForFloat`, `floats_utils.cc:64`, `SetAvailableSize` at `:101`).
  - p-auto-width-beside: a shrink-to-fit float holding `aaaa bbbb cccc` is 140 wide even though only 90 is free beside the first float. So it moves below, to y 20.
  - p-auto-width-wrap: the width clamps to the container (100).
- **The exclusion rect.** `CreateExclusionArea` (`floats_utils.cc:148-169`) makes the rect from the margin box, clamping its inline and block size at 0 (`:157`, `:159`).
  - p-neg-margin-overlap-all: `margin-inline-end: -50px` on a 50px float gives a zero-width exclusion. Zero-width exclusions are ignored for opportunities (`exclusion_space.cc:345-349`), so the next float sits at x 0 on top of it.
  - p-neg-margin-end: a -20px end margin makes the next float start at x 30.
- **The shelf and closed-area model.**
  - `DerivedGeometry::Add` (`exclusion_space.cc:341-636`) keeps "shelves" (open-ended opportunities, one per block offset where the free width changes) and closed-off areas (bounded opportunities).
  - A left exclusion shrinks a shelf's `line_left` (`:512-521`). A right exclusion shrinks `line_right` (`:524-534`).
  - A closed area is recorded when a new exclusion below a shelf overlaps it and both shelf edges are "solid", meaning backed by a float (`:441-495`, overlap tests `:469-478`).
  - b-closed-short and b-closed-fits exercise this: a 40x30 flow-root skips the 20-tall closed area at (150, 0) and lands at (160, 0) on the shelf. A 40x15 flow-root fits the closed area at (150, 0).
- **Floats that meet a line.** These are §4.

## 3. Clearance (`block_layout_algorithm.cc`, `exclusions/exclusion_space.h`)

- **Clear types.**
  - `ClearanceOffset(clear_type)` is the largest block-end margin edge of the left floats, the right floats, or both (`exclusions/exclusion_space.h:92-105`). It is updated in `Add` (`exclusion_space.cc:324-327`).
  - `Clear(cb_direction)` maps `inline-start` and `inline-end` using the containing block's direction (`core/style/computed_style.h:1582-1592`).
  - Measured, ltr (left float 50x30, right float 60x50):
    - c-left and c-inline-start put the block at y 30.
    - c-right, c-both and c-inline-end put it at y 50.
  - In rtl, c-inline-start goes to y 50 and c-inline-end to y 30.
- **Clearance known before layout.** `HasClearancePastAdjoiningFloats` (`block_layout_algorithm.cc:159-165`) decides clearance up front when the floats to clear are still adjoining (the BFC offset is unresolved). In that case `HandleInflow` forces the child's BFC block offset to the clearance offset (`:2255-2274`, the assignment at `:2271`).
- **Clearance found during layout.** Otherwise `ApplyClearance` (`:187-194`) moves the child's BFC block offset to the clearance offset only if the hypothetical position is above it.
  - c-margin-less: margin 10 < float 30, so y 30.
  - c-margin-equal: y 30.
  - c-margin-more: margin 50, no clearance, so y 50.
  - c-prev-margin-big: the float sits at 50 after the 40px margin, so the cleared block is at 60.
  - c-negative-clearance: the float sits at 40. A cleared block whose hypothetical top (40) is above the float bottom (50) goes to 50.
- **Floats and the margin strut.**
  - A float met while the parent's BFC block offset is unresolved is placed at the expected offset and makes the parent re-lay out when that resolves (`HandleFloat`, `:1660-1704`, with the origin at `:1671-1676`).
  - Measured: c-prev-margin (float at 30, after the collapsed 20px margin), p-after-margin (float at 30), p-in-child-margin (the float follows its parent's 15px margin to y 15).
- **Self-collapsing cleared blocks.** Blink computes the clearance explicitly for a self-collapsing cleared block, from the separated margin struts (`:2829-2873`, the formula at `:2869-2872`). Measured:
  - c-self-collapsing: the text after an empty cleared block starts at the float bottom, y 50.
  - c-self-collapsing-margins: an empty block with `clear:left` and margins 5 and 7, then a block with `margin-block-start:3`. The cleared block's border edge is at 30, and the next block is at 32, not the 37 a plain margin collapse (30 + max(7, 3)) would give. FLT-1 must reproduce 32 from `:2866-2872`.
- **`<br clear>`.** A `<br>` with a `clear` attribute or style clears the next line (c-br-all, c-br-left, c-br-style: the second line starts at the float bottom). The computed `clear` of the `<br>` is `both`, `left` or `right`. The line breaker handles this at `inline/line_breaker.cc:2824-2852`.
- **Computed values.** Computed `clear` is kept on a span and on an abspos box (c-computed). Computed `float` becomes `none` for absolute and fixed boxes, but stays `left` on flex and grid items (p-computed-none).

## 4. Line opportunities (`inline/line_breaker.cc`, `inline/inline_layout_algorithm.cc`, `exclusions/layout_opportunity.cc`)

- **Collecting opportunities.**
  - `InlineLayoutAlgorithm::Layout` asks for every opportunity from the line's BFC offset down, once, before breaking (`inline/inline_layout_algorithm.cc:1123-1126`, which calls `AllLayoutOpportunities`, `exclusion_space.cc:670-686`).
  - If the line overflows an opportunity narrower than the available width, and the text wraps, it moves to the next opportunity (`:1295-1320`).
  - Measured:
    - l-word-too-wide: a 120px word skips the 100px gap and lands at y 30.
    - l-word-too-wide-both: a 50px word skips a 40px gap.
    - l-atomic-too-wide: an inline-block does the same.
    - l-nowrap: a `nowrap` line stays beside the float and overflows, because `ShouldWrapLine()` is false.
    - l-word-too-wide-last: a word wider than the container goes to the last, full-width opportunity and overflows there.
- **Intersection is strict.**
  - An opportunity ends at the float's block-end margin edge.
  - A line of block size `h` at offset `y` is beside the float when `y < float_end` and `y + h > float_start` (`exclusions/layout_opportunity.cc:71-76`; shelves use the same half-open ranges, `exclusion_space.cc:101-108`).
  - Measured at DPR 1:
    - l-edge-19p99 and l-edge-20: line 3 (20..30) is full width, because 19.984 and 20 are both ≤ 20.
    - l-edge-20p01: line 3 is full width (truncated to 20).
    - l-edge-20p02: 20.015625 > 20, so line 3 is beside the float.
    - At DPR 2 and 3, l-edge-20p01 flips (§1).
- **Fitting the width.**
  - l-width-49p99: a 100px word fits beside a 49.984375 float in 150.
  - l-width-50p01: the float truncates to 50, and 100 ≤ 100 fits.
  - l-width-50p5: the word moves below.
- **Text in the opportunity.**
  - Lines start at the opportunity's line-left edge.
  - `text-align` and `text-indent` apply inside the opportunity (l-left-end, l-right-end, l-both-center, l-justify, l-indent, l-indent-negative). For example, l-indent's first line starts at 50 + 20 = 70.
- **A sibling's padding and margin.**
  - l-sibling-padding: a plain sibling block's `padding-inline-start` (20) does not add to the float edge. Its lines start at 50, since the opportunity is in BFC coordinates and 50 > 20.
  - l-sibling-margin: `margin-inline-start: 70` > 50 puts the lines at 70.
- **Floats met inside a line.** `LineBreaker::HandleFloat` (`inline/line_breaker.cc:3680`) places the float on the current line if `ShouldPushFloatAfterLine` (`:3626-3664`) is false. That needs all three of:
  - the margin box fits: `position + margin-box inline size + the inline-end edges of the float's still-open ancestors` ≤ the line's available width, retried without trailing collapsible spaces (`:3637-3648`; ancestor edges from `ComputeFloatAncestorInlineEndSize`, `:288-310`);
  - the top-edge rule does not push the float down;
  - clearance does not push the float down (`:3660-3663`).

  Otherwise, and whenever an earlier float on the line is still pending (`:3751`), the float is placed after the line, at `line top + line height` (`PlaceFloatingObjects`, `inline/inline_layout_algorithm.cc:839-840`). After placing a float on the line, `UpdateLineOpportunity` (`:3785`) shrinks the line. Measured:
  - p-text-fits: `aa ` then a 30px float means the float is at x 0 and the text moves to x 30.
  - p-text-nofit: 140px of text plus a 120px float goes after the line, to y 10.
  - p-text-nofit-trailing-space and p-text-exact: 100 + 110 fits only once the trailing space is dropped, so the float is at y 0.
  - p-text-ancestor-end: the span's 50px end padding counts, and the fit then passes only after the trailing space is dropped.
  - p-text-second-pending: the second float also goes to y 10.
  - l-mid-paragraph: a float after the fourth word lands on the second line's top (y 10) and moves that line's text.
- **Leading floats.** Floats before any content on a line are placed first (`PositionLeadingFloats`, `inline/inline_layout_algorithm.cc:1688`). Case: p-text-leading.
- **Zero-size floats.**
  - l-zero-inline: a zero-inline-size float does not narrow lines (`exclusion_space.cc:345-349`), but it still sets the top-edge rule.
  - l-zero-block: a zero-block-size float affects nothing.

## 5. BFC roots beside floats (`block_layout_algorithm.cc`)

- **The opportunity loop.** `HandleNewFormattingContext` (`:1758`) calls `LayoutNewFormattingContext` (`:1999`).
  - It applies clearance (`:2012-2018`), fetches every opportunity (`:2021-2023`), and lays the child out in each one in turn (`:2034`).
  - It keeps the first opportunity where:
    - the child fits in the block direction (`:2116-2117`);
    - where floats are present, the border box does not cross the opportunity's line-left or line-right edge (`:2180-2186`);
    - with floats on either side, the inline size fits (`:2190-2193`).
- **Plain blocks against BFC roots.**
  - b-plain-block: a plain block is full width (0..200), and only its lines move.
  - b-flow-root, b-overflow, b-flex, b-grid, b-contain and b-multicol: an auto-width BFC root fills the opportunity (50..200).
  - b-table: a table shrinks to fit (80).
- **Fixed widths.**
  - b-fixed-fits (100) and b-fixed-exact (150) stay beside the float.
  - b-fixed-nofit (180) moves to y 40.
  - b-min-content-wide: an auto-width flow-root whose content (160) is wider than the gap stays beside at width 150 and overflows, because its fragment is 150 wide.
  - b-table-wide: a table's min-content width is 160, so it moves below.
- **Margins against floats.**
  - If there are no floats in the way, the margins shrink the opportunity (`:2062-2069`).
  - If there are floats, the margins are measured from the content edge and only shrink the opportunity where they reach past the float (`:2070-2080`).
  - Measured:
    - b-margin-start-small: margin 30 behind a 50 float, so the box is at 50.
    - b-margin-start-big: margin 70, so the box is at 70.
    - b-margin-neg: margin -20, so the box is at 50 (clamped at 0 at `:2075`).
    - b-margin-end in rtl: line-right = min(200, 200 - 30).
- **Auto margins.** These resolve against the opportunity plus margins (`:2143-2150`). b-auto-margins centres a 60px box in 50..200, at x 95. b-auto-margin-start puts it at x 140.
- **Adjoining margins.** A BFC root's block-start margin may collapse with the parent's margin strut only if the root fits beside the floats. Otherwise the strut is re-resolved as non-adjoining (`:1778-1799`).
  - b-margin-adjoining (180 wide, does not fit): the parent stays at y 0, the float at 0 and the flow-root at 40.
  - b-margin-adjoining-fits (100 wide): the 20px margin collapses through the parent, so the parent, the float and the flow-root are all at y 20.
- **`<hr>`.** `<hr>` is a BFC root in Chrome because the UA sheet gives it `overflow: hidden` (`core/html/resources/html.css:112-122`). b-hr: an `<hr>` beside a float is 150 wide, starting at 50. FLT-0 must treat `<hr>` as a BFC root.

## 6. Container height and intrinsic sizes

- **Height.** The BFC root includes its floats' margin boxes. The clear offsets used for this are the margin-box ends clamped as in `CreateExclusionArea` (`floats_utils.cc:155-159`). Measured:
  - h-root: 80.
  - h-float-margin: 30 + 15 = 45.
  - h-float-neg-margin: 30 - 12 = 18.
  - h-float-neg-margin-all: 30 - 40 is clamped, so 0.
  - h-fractional: 30.6875.
- **Which boxes grow to their floats.**
  - A plain child does not (h-plain-child: 10).
  - A child holding only a float is 0 tall, and later text wraps around the float (h-empty-child).
  - A child that establishes a BFC does (h-flow-root, h-overflow, h-inline-block, h-abspos, h-float, h-table-cell, h-flex-item: 80).
  - A trailing `clear: both` block grows a plain parent (h-clearfix-div, h-clearfix-margin: 40).
- **Intrinsic sizes.** In `BlockLayoutAlgorithm::ComputeMinMaxSizes` (`block_layout_algorithm.cc:393-556`):
  - Floats accumulate on a "line", left and right separately (`:489-507`).
  - A float or BFC root with `clear` closes the line (`:431-443`).
  - A BFC root adds the float widths as insets (`:508-529`).
  - Any in-flow child resets the float sums (`:550-553`).
  - Inline content and anonymous blocks receive the float sums (`:445-449`). Other block children do not.
- **Intrinsic sizes, measured.**
  - h-max-content: 60 + 40 + `aa bb` 50 = 150.
  - h-max-content-cleared: row 60, then a cleared row 40 + 30 = 70.
  - h-max-content-bfc-child: 60 + 40 = 100.
  - h-max-content-block: 60 (see §9).
  - h-min-content: min-content 60 (the float).
  - h-inline-block-width: 60 + 50 = 110.

## 7. `shape-outside` (`shapes/*`, `exclusions/layout_opportunity.cc`)

- **Building the shape.**
  - `ShapeOutsideInfo::ComputedShape` (`shapes/shape_outside_info.cc:259-305`) builds the shape in the containing block's writing mode (`:270`).
  - `shape-margin` resolves against the containing block's inline size (`:271-273`).
  - `Shape::CreateShape` (`shapes/shape.cc:130-224`) resolves circle, ellipse, polygon and inset in the physical reference box, then converts them to logical coordinates with `TextDirection::kLtr` (`:137-138`; `converter.ToLogical` at `:150`, `:165`, `:181`, `:211-212`).
  - So a shape is line-relative (§8), and an asymmetric shape transposes in vertical modes.
- **The reference box.** Margin-box is the default. Its insets come from `CreateExclusionShapeData` (`floats_utils.cc:106-144`) and `ShapeOutsideInfo::BlockStartOffset` and `InlineStartOffset` (`shape_outside_info.cc:307-345`). Cases: s-box-*, s-circle-content-box, s-circle-border-box-margin, s-circle-margin-box.
- **Excluded intervals.**
  - For each line, the float's exclusion rect is still the float's margin box.
  - The line-left and line-right offsets are rebuilt from each intersecting shape's excluded interval (`exclusions/layout_opportunity.cc:98-162`), clamped to the float's margin box (`:56-60`).
  - A line that only touches the shape's bounds is skipped (`:36-38`).
- **Per-shape formulas.**
  - Ellipse and circle (`shapes/ellipse_shape.cc:61-87`): over a line band `[y1, y2]` the interval is the widest x-intercept in the band. It is the full radius when the band covers the centre.
    - s-circle: line 0..10 starts at 50 + √(50² - 40²) = 80. Line 20..30 starts at 95.813.
  - Polygon (`shapes/polygon_shape.cc:128-171`): the union of the x-ranges of the edges clipped to the band, with `shape-margin` applied as offset edges and vertex circles. The fill rule is not consulted (s-polygon-evenodd).
  - Inset and box shapes with radii (`shapes/box_shape.cc:53-100`).
- **1px stepping.** When a line does not fit beside a shape, the line is retried 1px lower until it clears the shapes, instead of jumping to the next opportunity (`inline/inline_layout_algorithm.cc:1298-1309`, `block_delta += LayoutUnit(1)` at `:1306`; `IsBlockDeltaBelowShapes`, `layout_opportunity.cc:80-96`). s-circle-word-steps: a 130px word lands at y 96, x 69.594.
- **Where shapes do not apply.**
  - BFC roots and later floats ignore shapes and avoid the float's box (s-bfc-ignores-shape, s-next-float-ignores-shape).
  - `shape-outside` on a non-float does nothing (s-not-float).
  - A radius larger than the box is clamped to the margin box (s-circle-too-big: every line starts at 100).
- **Computed values.** Serialisation drops default keywords: `circle(closest-side at 20% 50%)` becomes `circle(at 20% 50%)`, and polygon lengths become `0px`.
- **Image shapes.** These are listed only; see README.md.

## 8. Writing modes and direction

- **Writing modes.** Every family was captured in `horizontal-tb`, `vertical-rl` and `vertical-lr`. In line-relative coordinates (line-left, block-start), `modeDivergent` is empty for 187 of 209 cases, within 0.001 px at every DPR and in both directions. The float code runs in BFC coordinates, as FLT's binding rule requires. The 22 cases that differ:
  - **By design (16).** p-orthogonal is authored with physical `width` and `height`. In family 6, s-circle-pos, s-circle-closest, s-circle-farthest, s-ellipse, s-ellipse-pos, s-ellipse-sides, s-inset, s-inset-round-right, s-polygon, s-polygon-right, s-polygon-notch, s-polygon-evenodd, s-polygon-margin, s-fractional and s-two-shapes are asymmetric shapes, whose coordinates are physical (§7).
  - **l-atomic-too-wide.** Not a float difference. In vertical modes an inline-block sits on the central baseline, so the line holding it is 10 tall, not 12. The container is 40 instead of 42.
  - **l-tall-lines and l-odd-leading-23** (DPR 1, 3 and 2.625). This is the float quirk in §9.1. l-even-leading-24 and s-circle-tall-lines differ only at DPR 2.625, where the leading is odd in device px.
  - **l-odd-leading-alone** (DPR 1, 3 and 2.625) differs only in glyph position: in `vertical-lr`, an odd half-leading rounds toward block-start, so glyphs are at 8 and not 7. The float itself does not move.
- **Direction.**
  - `left` and `right` floats are unaffected by direction.
  - `inline-start` and `inline-end` flip with the containing block's direction.
  - Text in the opportunities aligns to the line's start edge (for example p-text-fits in rtl: the text is at x 120).
  - BFC-root margins are applied line-relative (§5).

## 9. Suspected deviations and quirks for FLT to reproduce

1. **Floats inside a line box shift one device px in `vertical-lr` when the half-leading is odd.**
   - Measured: l-tall-lines (`line-height: 25px`) and l-odd-leading-23 put the float at physical x 1 at DPR 1, 0.333 at DPR 3, and 0 at DPR 2. The spec position is 0, which is what `horizontal-tb` and `vertical-rl` give.
   - Mechanism: `PlaceFloatingObjects` positions line floats relative to the baseline (`inline/inline_layout_algorithm.cc:831-832`) and negates the offset for flipped-lines modes (`:887-892`). The line box's odd half-leading rounds toward the other side there.
   - A float alone in a block child (l-odd-leading-alone) is not affected.
   - FLT-WM must reproduce this, or record it as a known Chrome deviation.
2. **Max-content ignores floats before a plain block child.**
   - Measured: h-max-content-block gives 60 = max(60, 40), not 100. At that width `aaaa` no longer fits beside the float and wraps below it.
   - Mechanism: `block_layout_algorithm.cc:445-449` passes float sizes only to inline and anonymous children.
   - The spec leaves intrinsic sizing with floats undefined. FLT-1 must follow Blink.
3. **Self-collapsing cleared block.**
   - Measured: c-self-collapsing-margins puts the following block at 32, not 37 (30 + max(7, 3)).
   - Mechanism: this comes from the explicit clearance computation at `block_layout_algorithm.cc:2866-2872`.
   - To confirm in FLT-1 against the case.
4. **Computed `float` is kept where it has no effect.** `float: left` stays the computed value on flex and grid items and on `display: contents` (p-computed-none, p-computed-display). Chrome also keeps `inline-start` and `inline-end` as computed values, not left or right. FLT-0's computed-value checks must expect this.

## 10. Anchor index

| Anchor | What it is | Probe cases |
| --- | --- | --- |
| `exclusions/exclusion_space.cc:233` | `ExclusionSpaceInternal::Add`: last float block-start (`:321`), left and right clear offsets (`:324-327`) | p-top-edge*, c-* |
| `exclusions/exclusion_space.cc:341` | `DerivedGeometry::Add`: shelves, closed areas, zero-width skip (`:348`) | p-left-wrap-step, b-closed-*, p-neg-margin-overlap-all, l-zero-inline |
| `exclusions/exclusion_space.cc:639` | `FindLayoutOpportunity`: first fit, or full width at origin (`:657-659`) | p-wider-* |
| `exclusions/exclusion_space.cc:671` | `AllLayoutOpportunities`: for line boxes and BFC roots | l-*, b-* |
| `floats_utils.cc:31` | the top-edge rule | p-top-edge, p-top-edge-gap |
| `floats_utils.cc:40` | a float's opportunity: its own clearance, minimum size = margin box | p-clear-self*, p-margins |
| `floats_utils.cc:64` | the float constraint space: the container's available size | p-auto-width-beside |
| `floats_utils.cc:193` | the margin-box inline size clamped at 0, used by the line breaker | p-text-*, p-neg-margin-* |
| `floats_utils.cc:212` | `PositionFloat`: line-right placement (`:381-387`), border-box offset (`:430-433`) | p-right*, p-margins* |
| `block_layout_algorithm.cc:159` | `HasClearancePastAdjoiningFloats` | c-nested, c-prev-margin |
| `block_layout_algorithm.cc:187` | `ApplyClearance` | c-margin-* |
| `block_layout_algorithm.cc:1660` | `HandleFloat`: the origin before and after BFC resolution | p-after-margin, p-in-child-margin |
| `block_layout_algorithm.cc:2222` | `HandleInflow`: forced clearance (`:2255-2274`) | c-* |
| `inline/line_breaker.cc:3626` | `ShouldPushFloatAfterLine` | p-text-* |
| `inline/inline_layout_algorithm.cc:1123`, `:1295` | the line opportunity list and moving on when a line overflows | l-word-too-wide* |
| `exclusions/layout_opportunity.cc:98`, `:130` | line-left and line-right offsets with shapes | s-* |
| `shapes/shape.cc:130` | building basic shapes | s-* |
