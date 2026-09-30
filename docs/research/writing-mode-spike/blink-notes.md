# Blink 145.0.7632.6 writing modes: source reading matched to the probe

The source was read from the GitHub mirror at tag `145.0.7632.6` (`raw.githubusercontent.com/chromium/chromium/145.0.7632.6/third_party/blink/renderer/...`). Every path below is relative to `third_party/blink/renderer/`, and `file:line` refers to that tag. Case ids refer to `probe/*.json` (see README.md). Values are DPR 1 ltr unless stated.

**Notation.**
- **LU** is a LayoutUnit, 1/64 px.
- **S** is the font size and **N** the device scale.
- Ahem has font-unit ascent 0.8·S and descent 0.2·S.
- Physical rects are `[x, y, w, h]` relative to the container's border box.

## 1. Mode predicates (`platform/text/writing_mode.h`)

- **Flipped lines.** `IsFlippedLinesWritingMode` is true only for `vertical-lr` (`:67-69`). Line-over is the right side in both `vertical-rl` and `vertical-lr`, so line-relative code maps `vertical-lr` to `vertical-rl` (`:77-78`).
- **Flipped blocks.** `IsFlippedBlocksWritingMode` is true for `vertical-rl` and `sideways-rl` (`:83-86`).
- **Parallel flows.** `IsParallelWritingMode(a, b)` compares only "is horizontal-tb" (`:90-92`). Every pair of the four vertical and sideways modes is parallel. Only a horizontal/vertical pair is orthogonal.
- **Horizontal typographic modes.** `IsHorizontalTypographicMode` is true for `horizontal-tb`, `sideways-lr` and `sideways-rl` (`:97-101`). In these modes `text-orientation` has no effect (see §5).

## 2. WritingModeConverter (`core/layout/geometry/writing_mode_converter.cc`)

The only mapping between logical and physical coordinates. WM-1a logicalizes the engine once with this mapping (T098 binding rule).

- **Fast path.** `horizontal-tb` ltr is the identity (`writing_mode_converter.h:96-110`). Every other case is a Slow path.
- **`SlowToPhysical`** (`:71-105`). Its inputs are a logical offset (i, b), the inner box's physical size (w, h) and the container's physical outer size (W, H).

  | mode | ltr | rtl |
  | --- | --- | --- |
  | horizontal-tb | (i, b) | (W−i−w, b) |
  | vertical-rl, sideways-rl | (W−b−w, i) | (W−b−w, H−i−h) |
  | vertical-lr | (b, i) | (b, H−i−h) |
  | sideways-lr | (b, H−i−h) | (b, i) |

- **Inverses.** `SlowToLogical` (`:9-38`, and the float form `:40-69`) is the inverse. The rect forms convert the size first and then the offset (`:107-121`).
- **Probe evidence.** b1-fixed-children: a 30x40 block, a 20x60 block and a 10x10 block in a 200x150 container.
  - vertical-rl ltr puts a at x 170, b at x 150 and c at x 140, all at y 0.
  - vertical-rl rtl puts them at y 110, 90 and 140 (H−i−h).
  - sideways-lr ltr puts them at y 110, 90 and 140, which matches vertical-lr rtl.
  - sideways-lr rtl puts them at y 0.
- **Rounding.** The converter subtracts in LU, and lengths are truncated to LU first.
  - b1-fractional vertical-rl: container width 200.5, margin-block-start 0.7 → 0.6875 LU, block size 10.3 → 10.296875 LU. The x is 200.5−0.6875−10.296875 = 189.515625.
  - b1-fractional sideways-lr: y = 150.25−33.296875 = 116.953125.

## 3. Block flow in vertical modes (family 1)

- **Axes.** Block-axis margins collapse, which is horizontal in vertical modes. Inline-axis margins do not collapse.
  - b1-margin-collapse vertical-rl: a at x 170, then max(15, 25) = 25 between a and b, so b's right edge is 170−25 = 145 and b is at x 125.
  - A negative margin: b's end margin 4 collapses with c's −6 to −2, so c's right edge is 125+2 = 127 and c is at x 107.
- **Percentages.**
  - `width` and `height` percentages resolve against the physical axis: b1-percent vertical-rl a is 50x30 from 25% of 200 and 20% of 150.
  - Margin and padding percentages resolve against the containing block's inline size in both axes. In vertical-rl that is the height, 150: `margin-inline-start: 10%` gives 15, and `padding-block-start: 5%` gives 7.5, so b's width is 10+7.5.
- **Auto margins.** Auto inline-axis margins centre a block, and auto block-axis margins are 0 (b1-margin-auto).
- **A vertical `#c` inside the horizontal body is an orthogonal root.** Its auto width is its content block size: b1-auto-block-size gives 48.75 = 20+5+13.5+10.25.

## 4. Orthogonal flows and the fallback inline size (family 2)

- **Orthogonal root flag.** `ConstraintSpaceBuilder` marks the space an orthogonal writing-mode root when the parent and child modes are not parallel (`core/layout/constraint_space_builder.h:54-69`).
- **Axis swap.** For such a child, `SetAvailableSize` and `SetPercentageResolutionSize` swap the axes (`:85-100`, `:103-116`). If the child's inline size, the parent's block size, is indefinite, `AdjustInlineSizeIfNeeded` substitutes the orthogonal fallback inline size (`:74-82`). The fallback is set by `SetOrthogonalFallbackInlineSize` (`:142-146`).
- **Fallback value** (`core/layout/space_utils.cc:32-80`).
  - Start from the ICB size along the parent's block axis (`:38-44`), which is the viewport height for a horizontal parent.
  - Take the parent's fixed `height`, clamp it by a fixed `max-height` and then a fixed `min-height`, or use infinity (`:46-58`).
  - For `box-sizing: border-box`, subtract fixed block-axis padding and border (`:60-76`). A non-fixed padding abandons the parent's size and returns the ICB value (`:63-67`).
  - Fallback = min(ICB, that size) (`:78-79`).
- **Callers.** The block layout child space (`constraint_space_builder.h:716`), atomic inlines (`core/layout/block_node.cc:1467`) and flex items (`core/layout/flex/flex_layout_algorithm.cc:685`, `:706`) all call it.
- **Probe evidence.** Viewport 400x300; the text is 60 words of `xx ` at 10px.

  | case | fallback / result |
  | --- | --- |
  | o2-parent-auto | ICB height 300. The child is 60x300 (6 lines). |
  | o2-parent-max | max-height 70. The child is 300x70 and overflows its 70px parent. |
  | o2-parent-min | min-height 350 > ICB, so 300. |
  | o2-parent-min-max | height 50, min 120, so 120. |
  | o2-small-viewport | 250x180 viewport, so 180. |
  | o2-border-box-pct-padding | percent padding abandons the parent size. During layout the parent's content height of 60 is definite anyway, so the child is 60 tall. |
  | o2-reverse-auto | horizontal child of a vertical parent with auto width: the fallback is the ICB width, 400 (child 400x50). |
  | o2-container-auto-height | a vertical `#c` with auto height is 60x300. With a 250x180 viewport it is 100x180. |

- **An orthogonal child's auto inline size is fit-content in the available size, not stretch.**
  - o2-child-short: `aa bb` gives a 10x50 box.
  - c8-writing-mode-horizontal-tb under a vertical-rl `#c`: a 20x20 box, not 200 wide.
- **Intrinsic contributions.** The min/max contribution of an orthogonal child is its block size after a layout, not a min/max pass. `ComputeMinAndMaxContentContributionInternal` does this: it resolves the block size, and if that is indefinite it lays the child out (`core/layout/length_utils.cc:372-386`). The parallel path is at `:388-459`, and the entry point is at `:462-483` (`:471` is the parallel check).
  - o2-shrink-to-fit: an inline-block around an orthogonal child is 20 wide, the child's two columns at the 300 fallback.
- **Flex base size of an orthogonal item in a column container.** It is the item's max-content inline size, not the fallback. o2-flex-column-item: 12 words = 35 glyphs = 350 px base plus a 10 px sibling in 80 px. Shrink by weight 350:10 gives 77.78125 and 2.21875 (LU).
- **An inline whose mode differs from its parent's becomes inline-block** (`core/css/resolver/style_adjuster.cc:790-794`). o2-inline-orthogonal: the span is a 20x50 box.

## 5. Font orientation, shaping and vertical metrics (families 6, 7)

- **`FontOrientation`** (`platform/fonts/font_orientation.h:35-47`): Horizontal, VerticalRotated (`sideways`), VerticalMixed (`mixed`) and VerticalUpright (`upright`).
  - `ComputeFontOrientation` returns Horizontal in any horizontal typographic mode, which includes `sideways-*` (`core/style/computed_style.cc:3205-3221`). t6-sideways-mode-orientation: `upright` in sideways-rl lays out like vertical-rl `mixed` Latin, and the g7 grids for sideways modes are identical under all three values.
- **Mixed segmentation.** `OrientationIterator` splits a mixed run where `Character::IsUprightInMixedVertical` changes. That test is ICU `Vertical_Orientation != R` (`platform/fonts/orientation_iterator.cc:19-48`, `platform/text/character.cc:95-99`). Grapheme extenders stay with their base (`:27-28`).
- **Canvas rotation per run** (`platform/fonts/shaping/harfbuzz_shaper.cc:460-482`, applied at `:1001-1003`).
  - VerticalUpright → kRotateCanvasUpright.
  - VerticalMixed → upright for "keep" segments and kRegular (rotated with the line) for sideways segments.
  - Anything else → kRegular.
  - The `*Oblique` variants apply only with synthetic oblique.
- **HarfBuzz direction** (`:241-251`). Upright runs shape with `HB_DIRECTION_TTB` and everything else with `HB_DIRECTION_LTR`. rtl reverses either one. TTB runs prepare the vertical-layout callbacks (`:335-337`).
- **Vertical metrics** (`platform/fonts/opentype/open_type_vertical_data.cc`).
  - `LoadMetrics` reads hhea/hmtx, then vhea. With no vhea it returns early (`:155-193`).
  - Vertical advance: from vmtx, else `height_fallback_` (`:265-276`).
  - Vertical origin (`:278-329`).
    - x is −advance_width/2 (`:294`).
    - y comes from VORG (`:297-310`), else from vmtx top-side bearing plus glyph bounds (`:313-324`), else −`ascent_fallback_` (`:326-327`).
  - HarfBuzz receives the negated translation (`platform/fonts/shaping/harfbuzz_face.cc:276-296`) and the negated advance (`:298-312`). The callbacks are registered at `:508-512`.
- **Fallback metrics** (`platform/fonts/shaping/harfbuzz_font_data.h:43-72`).
  - `ascent_fallback_` is the ascent from `FontMetrics::AscentDescentWithHacks`, which is `SkScalarRoundToScalar` of the Skia ascent in device px (`platform/fonts/font_metrics.cc:110-112`; no VDMX on macOS).
  - `height_fallback_ = lroundf(ascent) + lroundf(descent)` (`:58`).

### Ahem's vertical tables (vmtx/VORG)

- **Tables present.** `vendor/fonts/Ahem.ttf` (sha256 `b719ecb3…fb94b8448`) has only `OS/2 cmap gasp glyf head hhea hmtx loca maxp name post`: no `vhea`, `vmtx` or `VORG`.
  - `unitsPerEm` is 1000. hhea ascender and descender are 800/−200, and OS/2 typo and win values match.
  - It has 278 glyphs, and every advance width is 1000 except glyph 1.
  - It covers the CJK code points used here (U+3000, U+3007, U+4E00 一, U+6C34 水, U+706B 火, U+91D1 金, and others) and the upright-in-mixed symbols § © ® ± × ÷ ™.
- **Upright or mixed-CJK Ahem therefore uses the fallbacks:**
  - vertical advance = round(0.8·S·N) + round(0.2·S·N) device px, which is the same integer font height a horizontal line uses for the glyph box;
  - vertical origin = (advance_width/2, round(0.8·S·N)) in HarfBuzz's y-up units, so the glyph is centred on the inline axis and hangs from its ascent.
- **Probe evidence** (t6-upright-size-*, t6-mixed-cjk-size-*).

  | S | DPR 1 | DPR 2 | DPR 3 | DPR 2.625 |
  | --- | --- | --- | --- | --- |
  | 13 | 13 | 13 | 13 | 12.952381 |
  | 17.5 | 17 (14 + round(3.4999…) = 3) | 17.5 (28+7 dev px) | 17.333 (42+10) | 17.52381 |
  | 23.3 | 24 (19+5) | 23 (37+9) | 23.333 (56+14) | 23.238095 |

  The 0.2·17.5 descent rounds down in float, the same as the horizontal line box height (17 at DPR 1). A rotated glyph keeps its horizontal advance: l5-fractional-size's 17.5px `e` and `f` advance 17.5 while the line is 17 wide.

## 6. Baselines and line boxes (family 5)

- **Dominant baseline** (`core/style/computed_style.cc:2266-2270`). Vertical flow uses the central baseline unless the font orientation is VerticalRotated, in which case it uses alphabetic.
  - Central ascent is FloatHeight/2 (`platform/fonts/font_metrics.cc:151-152`). The integer form is Height−Height/2 (`:187-188`).
- **Probe evidence.** l5-baseline-marker: 20px text with line-height 1, so the line is 20 wide.
  - vertical-rl `mixed` puts the 0x0 marker at x 140, the line centre.
  - vertical-rl `sideways` puts it at x 134 = 150−16, the ascent from the right (line-over) edge.
  - vertical-lr `sideways` puts it at x 4 = 20−16. Line-over is also the right edge there.
  - sideways-lr puts it at x 16 = 0+16. Line-over is the left edge and glyphs are turned counter-clockwise.
  - f3-align-baseline shows the same split for flex baseline alignment: 184 vs 182 in vertical-rl vs sideways-rl.
- **Line stacking.** Lines stack in block direction: from the right in `*-rl`, from the left in `*-lr` (l5-wrap). The `lineStart` markers give the block-start edge: 150, 140, 130 in vertical-rl, and 0, 10, 20 in vertical-lr and sideways-lr.
  - With line-height 1.5, the half-leading of 2.5 splits 2 on the line-over side and 3 on the other, as in horizontal-tb (glyph y 2) (l5-line-height). The glyph is at x 138 in the vertical-rl line [135, 150] and at x 3 in the vertical-lr line [0, 15].
- **Inline direction.** In sideways-lr the inline direction runs bottom to top. l5-wrap: `a` is at y 40 and `b` at y 0 on a 50-tall line.

## 7. text-combine-upright (families 6, 7, 8)

- **Style** (`core/css/resolver/style_adjuster.cc:417-459`).
  - The combined box becomes an inline-block with width = line height (the font height) and height = 1em, as fixed min, max and preferred sizes (`:422-434`).
  - Its inner style is forced to `horizontal-tb`, `text-align: center`, `vertical-align: middle`, `letter-spacing: 0`, `word-spacing: 0`, no decorations and no emphasis (`:438-451`).
- **Fitting** (`core/layout/inline/inline_node.cc:2302-2348`).
  - Content wider than `DesiredWidth` first tries half, third and quarter-width font variants (`:2324-2340`). Ahem has none.
  - Otherwise it sets scale_x = desired/content (`:2347`).
  - `DesiredWidth` is 1.1em, or 1em when the parent has underline or overline in effect (`core/layout/layout_text_combine.cc:68-84`).
  - Paint applies `Scale(scale_x, 1)` about the paint offset (`:191-214`). The inline spacing (line height − desired)/2 is at `:86-93`.
- **Probe evidence.**

  | case | measured |
  | --- | --- |
  | t6-combine-12 | the box is 10x10 in a 20px line. Each Range rect is 5.5 wide: 2 glyphs at scale 11/20. |
  | t6-combine-123 | 3.65625 each (11/30, in LU) |
  | t6-combine-2024 | 2.75 each |
  | t6-combine-underline | 5 each: desired 1em |
  | t6-combine-1 | unscaled (10 ≤ 11) |
  | t6-combine-digits | `digits 2` is rejected; the computed value is `none` |

  The x of a Range rect inside a combined box does not match the box's own x: t6-combine-12 vertical-rl has box x 135 and text 131.5-142.5. The g7-combine screenshot grid is the evidence for ink position, and WM-4 must use paint, not Range rects, there.
- **Only `vertical-*` combines.** In `sideways-*` and `horizontal-tb` the computed value is `all`, but the text flows as ordinary glyphs (t6-combine-* sideways-rl: the span is 10x20).

## 8. Computed and parsed values (family 8, support.json)

- **`writing-mode`** accepts the five modes plus `lr lr-tb rl rl-tb tb tb-rl` (`core/css/parser/css_parser_fast_paths.cc:1663-1671`). The legacy values map to horizontal-tb (`lr`, `lr-tb`, `rl`, `rl-tb`) or vertical-rl (`tb`, `tb-rl`), measured by computed style and by layout: c8-writing-mode-lr under vertical-rl is a 20x20 horizontal box.
  - WM-0 can accept exactly `lr lr-tb rl rl-tb` as horizontal-tb.
- **`-webkit-writing-mode`** accepts only the range horizontal-tb..vertical-lr (`:1660-1662`). It rejects `sideways-*` and every legacy value.
- **`text-orientation`** accepts `mixed upright sideways sideways-right` (`sideways-right` computes to `sideways`). It rejects `vertical-right` and `use-glyph-orientation`.
  - `-webkit-text-orientation` rejects `mixed` but accepts `vertical-right`, which computes to `mixed`.
- **`-webkit-text-combine: horizontal`** computes `text-combine-upright: all`.
- **Table parts.** On table row groups, rows, columns and column groups, the writing-mode and text-orientation are overwritten with the parent's (`style_adjuster.cc:800-814`). c8-table-row-group: `tbody` and `tr` with `vertical-lr` compute to the table's mode.

## 9. Flex and abspos (families 3, 4)

- **Flex.** Flex works in logical axes throughout. In `sideways-lr` the main start is at the bottom (f3-justify-flex-start: a at y 120).
  - `justify-content: left`/`right` resolve against line-left, which is inline-start in ltr in every mode here (f3-justify-left equals flex-start; f3-justify-right equals flex-end).
  - Grow and shrink distribute in LU: f3-grow-shrink vertical-rl gives 17.671875 and 35.328125 from 53 split 1:2.
- **Abspos static position.** The static position is a `LogicalStaticPosition` in the container's writing direction. It feeds the IMCB per axis (`core/layout/absolute_utils.cc:196-250`). The out-of-flow part converts insets and position-area offsets with `ConvertToLogical` and `WritingModeConverter` (`core/layout/out_of_flow_layout_part.cc:819-830`).
  - a4-block-static vertical-rl ltr: the box is at x 170 = 180−10, right after block a.
  - a4-block-static vertical-rl rtl: y 135 = 150−15.
  - a4-orthogonal: a horizontal abspos in vertical-rl shrinks to 50x10 at x 130.

## 10. Painting rotated runs and the native plan (WM-2, WM-3, WM-4)

### How Blink paints

1. **Line-relative space.** `TextFragmentPainter` builds a line-relative rect from the physical text box (`core/paint/text_fragment_painter.cc:265-275`, `CreateFromLineBox`: offset = the physical origin, inline size = h and block size = w in vertical; `core/paint/line_relative_rect.h:114-119`). It concatenates the rotation before painting glyphs and decorations (`text_fragment_painter.cc:496-501`).
2. **The rotation** (`core/paint/line_relative_rect.cc:19-75`). L and O are the physical x and y of the text box, B is its physical width (block size) and I its physical height (inline size).
   - Every vertical mode except sideways-lr: `AffineTransform(0, 1, −1, 0, L+O+B, O−L)`, which maps (u, v) → (−v+L+O+B, u+O−L). That is a 90° clockwise turn with line-over on the right. vertical-lr uses the same matrix because it has flipped lines (§1).
   - sideways-lr: `AffineTransform(0, −1, 1, 0, L−O, L+O+I)`, which maps (u, v) → (v+L−O, −u+L+O+I). That is 90° counter-clockwise with line-over on the left.
   - Glyphs are then drawn exactly as in horizontal-tb, at line-relative positions: pen at u, baseline at v = O + ascent (alphabetic) or the central offset.
3. **Upright blobs** (`platform/fonts/shaping/shape_result_bloberizer.cc:611-645`). Inside that rotated canvas, a `kRotateCanvasUpright` blob is drawn after `setSinCos(−1, 0, x, y)`, a further −90° turn about the blob's origin. The glyph ends up upright on screen. Its TTB glyph positions (vertical advance and origin, §5) run along the rotated x axis. `kOblique` applies a skew of tan 15° (`:646-657`), and only for synthetic oblique.
4. **Combine.** A combined box is horizontal-typographic inside (its FontOrientation is Horizontal), so it gets no rotation. Only `Scale(scale_x, 1)` about the paint offset applies (`layout_text_combine.cc:208-212`).

The g7 grids confirm the result on screen:
- `p` (descent ink) shows ink in the left 2 columns of 8 under vertical-rl, vertical-lr and sideways-rl (clockwise), and in the right 2 columns under sideways-lr (counter-clockwise).
- Under `upright` it keeps the bottom 2 rows in vertical-rl and vertical-lr, while sideways modes ignore `upright`.

### Native plan (both platforms)

The drawing primitive stays the one ruled in T014: Dragon positions every glyph, and the platform only rasterises it. iOS uses `CTFontDrawGlyphs`. Android uses `Canvas.drawGlyphs` (API 31 floor, so there is no fallback). WM adds a transform around that draw, and nothing else.

1. **Engine output (WM-1b/WM-2).** Each text fragment carries:
   - its physical rect (L, O, B, I);
   - its writing mode;
   - glyph runs, each tagged `regular` or `upright`, with glyph ids and line-relative pen positions from the engine's shaper. Upright runs are shaped TTB with Blink's vertical fallbacks (§5): advance = integer font height in device px, origin = (advance_width/2, rounded ascent).
   The engine computes the matrix. The native side never derives geometry.
2. **iOS.** In the fragment's `draw(_:)`:
   - `ctx.saveGState()`;
   - `ctx.concatenate(CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: L+O+B, ty: O-L))`. For sideways-lr use `(a: 0, b: -1, c: 1, d: 0, tx: L-O, ty: L+O+I)`. UIKit's context is y-down like Blink's, so the matrix is used unchanged;
   - the existing horizontal glyph draw (text matrix flipped as today);
   - for each upright run, `saveGState`, `rotate(by: -.pi/2)` about the run origin (translate, rotate, translate back), then `CTFontDrawGlyphs` at the engine's TTB positions, then `restoreGState`.
   - Do not use `CTFontGetVerticalTranslationsForGlyphs`. Its no-vhea fallback need not match Blink's, so the engine supplies the offsets.
3. **Android.** In the fragment's `onDraw`:
   - `canvas.save()`;
   - `canvas.concat(Matrix().apply { setValues(floatArrayOf(0f, -1f, L+O+B, 1f, 0f, O-L, 0f, 0f, 1f)) })`. Android's row-major order is [scaleX, skewX, transX, skewY, scaleY, transY]; for sideways-lr use `floatArrayOf(0f, 1f, L-O, -1f, 0f, L+O+I, 0f, 0f, 1f)`;
   - the existing `drawGlyphs`;
   - for each upright run, `canvas.save(); canvas.rotate(-90f, px, py); drawGlyphs(...); canvas.restore()`.
4. **Combine (WM-4).** No rotation. `scale(scale_x, 1)` about the combined box's paint origin, then the horizontal draw centred in the box.
5. **Proof.** WM-2 device lanes sample the same cell centres as the g7 grids (at DPR 2, 3 and 2.625) and compare them numerically with the corpus. Layout parity uses the family 1-6 rects. Synthetic oblique, emphasis marks and decorations under rotation are out of scope until their own packages.

## 11. Open items for later WM packages (evidence only, not rulings)

- **Range rects in a combined box** do not match its paint position (§7). WM-4 should use screenshot evidence there.
- **Orthogonal flex items in a column** use the max-content inline size as the flex base (§4, o2-flex-column-item). WM-1b needs this path in flex.ts.
- **`justify-content: left/right`** equals start/end for every mode in ltr here. The rtl records hold the remaining evidence.
