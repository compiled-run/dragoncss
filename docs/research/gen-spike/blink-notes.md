# GEN-P: Blink source notes for generated content and list markers

Source reading for T151 (docs/goals/milestone-2-proof/notes/T151-gen-spec.md, rulings R3 to R14). Every rule below names the
Chromium 145.0.7632.6 file and lines it comes from, and the probe case that measures it. GEN-b, GEN-a and GEN-c cite these
entries. Anything the source does not explain is an open question with its case id (last section), never a guess.

Files were fetched at the tag with
`curl -s "https://chromium.googlesource.com/chromium/src/+/refs/tags/145.0.7632.6/third_party/blink/renderer/<path>?format=TEXT" | base64 -d`,
and Skia at the DEPS revision 2ab8add5be2c46eb6238f4c217f6d6dbc9bccd23. Paths below are relative to
`third_party/blink/renderer/` unless they start with `third_party/skia/`.

## The corpus

- `scripts/capture-gen-probe.ts` writes `probe/family1-content.json` to `probe/family6-alignment.json` and
  `probe/family7-symbol-oracle.json`. Run it through `/tmp/heavy-lease.sh node --conditions=dragon-internal scripts/capture-gen-probe.ts`;
  `--check` captures again and requires every file to be byte-identical (it was, on the second run).
- Every case runs at DPR 1, 2, 3 and 2.625, in ltr and rtl, on the pinned Chrome 145.0.7632.6 with the parity flags and Ahem.
  Each family has one Inter case (`inter`).
- Per run it records: the CDP pseudo-element boxes (DOM.getDocument `pseudoElements`, DOM.getBoxModel border quad in CSS px) with
  CSS.getComputedStyleForNode values; getComputedStyle of every labelled element and of its `::before`, `::after` and `::marker`;
  getBoundingClientRect of the labelled elements; DOMSnapshot text boxes divided by the DPR and stored as float32, owned by
  `<label>:text<k>`, `<label>::before:text0`, `<label>::marker:text0` or `<label>:br`.
- **R9 cross-check.** Every light-DOM text box from the snapshot, divided by the DPR, must equal its Range client rect within
  1/1024 CSS px, and the box counts must agree, or the capture fails. Result: 1288 text lines, worst difference 2.03e-5 CSS px.
  UA shadow text (inside inputs) is recorded as `:ua-text<k>` and is outside the check because a Range over light-DOM text
  nodes cannot reach it.
- **Marker geometry assertion.** Every marker of the four `geometry-*` cases (disc, circle, square and decimal at 10, 13, 16,
  17.3, 23.3, 33.33 and 1 px; 224 markers over 4 DPRs and 2 directions) must match the formulas below, or the capture fails.
  All 224 match.
- `scripts/check-marker-paint-oracle.ts` redraws the family 7 crops with packages/layout/src/paint-aa.ts (see "Marker paint").
  `--self-test` plants a fault in each check (oracle data, a Chrome pixel, a marker box, a snapshot text box) and requires each
  to be caught.

## Licences of the files read

- BSD ("The Chromium Authors"): list/list_marker.cc, list/unpositioned_list_marker.cc, list/layout_outside_list_marker.cc,
  list/layout_list_item.h and .cc, html/list_item_ordinal.cc, css/counter_style.cc, css/counter_style_map.cc,
  inline/inline_node.cc, inline/inline_items_builder.cc, inline/line_breaker.cc, block_layout_algorithm.cc,
  paint/text_fragment_painter.cc, css/counters_attachment_context.cc, css/properties/computed_style_utils.cc,
  css/properties/longhands/longhands_custom.cc, style/display_style.h, layout/generated_children.h.
- BSD-google: dom/pseudo_element.cc. BSD (Apple and Google): platform/graphics/graphics_context.cc. BSD-skia: SkDraw.cpp,
  SkBitmapDevice.cpp.
- LGPL, so class A (reference only; Dragon follows the spec and these observations): html/resources/html.css,
  css/resolver/style_adjuster.cc, layout/layout_quote.cc, layout/layout_counter.cc, html/html_olist_element.cc,
  style/content_data.cc, style/computed_style.h.

## R3. When a box is generated, and the computed `content`

| Rule | Source | Measured (family1-content unless named) |
|---|---|---|
| `::before`/`::after` get a layout object iff display is not none and content does not prevent box generation | dom/pseudo_element.cc:732-757 (`PseudoElementLayoutObjectIsNeeded`) | `none-normal`: no pseudo node for `content: none`, `normal`, or `display: block` alone |
| On `::before`/`::after`, `normal` behaves as `none` (no content data, or `none`) | style/display_style.h:33-59 (`ContentBehavesAsNormal`, `ContentPreventsBoxGeneration`) | `none-normal`: getComputedStyle reports `none` for both |
| The computed value: `none` when box generation is prevented, `normal` when content behaves as normal, otherwise the list with `/ alt` | css/properties/computed_style_utils.cc:3408-3447 (`ValueForContentData`) | `content-values`: `"ab"`, `"a" / "alt"`, `counter(x)`, `"Q"` (attr resolved), `open-quote`, `url(...)` |
| On an element, `content: none` is stored as NoneContentData but behaves as normal; strings are kept as specified | longhands_custom.cc:3380-3390 (`Content::ApplyValue`); display_style.h:33-39, 56-57 (default style type: never prevents boxes) | `on-element`: `"zzz"` kept, `none` reads `normal`, no box or height change |
| Adjacent strings join into one text item | longhands_custom.cc:3431-3437 | `content-values` a: one text box "ab", 32 px |
| `content: ''` makes an empty inline box | pseudo_element.cc:757 (`''` is not none) | `empty-string`: `a::before` box 0x0 and the empty host is 0 tall; with text (`b`) the box is 0x16 |
| `var()` in content, Tailwind's registered `--tw-content` | standard custom-property substitution | `var-content`: `"hi"` on `.t::before`; `.u::after` with the initial value `''` makes an empty box |
| Tailwind preflight first rule generates nothing | it sets no `content` | `preflight`: the only pseudo node is the li's marker |
| `counter(x)` with no counter-reset renders "0"; `open-quote` renders U+201C; `url()` makes a 1x1 image box | css/counters_attachment_context.cc (counter scopes); layout/layout_quote.cc (LGPL, class A) | `content-values` c, e, f |

## R4. Hosts (family2-hosts)

- A generated box needs a host whose layout object can have generated children: layout/generated_children.h:18-32
  (`CanHaveGeneratedChildren`: no media, text control, menu list or input button, then `CanHaveChildren`), and
  layout_replaced.h:71 (replaced objects have no children).
- Measured (`hosts`): img, text input, br, iframe, select, option and textarea have a `::before`/`::after` DOM node but no box
  (`box: null`). div, span, range input, checkbox, hr and button generate boxes. `root-and-body`: `html::before` is laid out
  before body (y 0, body's own `::before` at y 16).

## R5 and R6. Selectors, specificity and inheritance

- `specificity`: `#a::before` ("2") beats `.c::before` and `div::before`. The legacy `#b:before` and `#b:after` generate "S" and
  "T".
- family3 `inherit`: `color` and `font-size` come from the host (`a::before` is green, 20 px); `font-size: 2em` on `b::after`
  resolves against the host's 10 px to 20 px.

## R7. Generated text in the inline formatting context (family4-whitespace)

- Generated text is appended as text items of the host's inline formatting context, and collapsible spaces collapse across item
  boundaries: inline/inline_items_builder.cc:767-800 (`AppendCollapseWhitespace`: the first run interacts with the last item)
  and :376-440 (`AppendTextItem` collapsing against `LastItemToCollapseWith`, :218).
- `collapse`: `'x  '` + `"  m  "` + `'  y'` gives boxes x [0,32] (2 chars: x and one space), m [32,64], y [64,80]: "x m y",
  80 px.
- `newline`: `'a\A b'` without preserving white-space is one 48 px box ("a b"); with `white-space: pre` it breaks into two lines
  (`c::before` 16x32).
- `empty-strings`: `''` boxes are 0 wide; `' '` boxes collapse to 0 wide at the line start and end.
- `wrap-3-lines` (width 64): six lines, every space at a line end hangs; boxes at x 0 on every line.

## R8. Display of generated boxes (family3-display)

- Blockification: css/resolver/style_adjuster.cc:244 (`EquivalentBlockDisplay`) and :730-818 (`AdjustStyleForDisplay`;
  LGPL, class A).
- `flex-item`: `::before` computes `block`, is a flex item 50 px wide; `grid-item`: `block`, in column 1 (40 px);
  `abspos`: `::after` computes `block`, `inset: 0` fills the 100x50 host; `inline-block`: 40x20 atomic box; `block`: a 10 px
  `::before` block above the text line, `::after` "Q" on its own line.

## R13. List items without a marker

- LayoutListItem is a LayoutBlockFlow: list/layout_list_item.h:15.
- `list-style-type: none` is ListStyleCategory kNone, which gives no marker text and no margins: list/list_marker.cc:174-176
  and :407-409.
- family5 `none-and-empty`: no `::marker` node for `list-style-type: none`; an empty `display: list-item; list-style: none` div
  is 0 tall, like a block; an empty list-item div with a disc is 16 tall (see R14 alignment).
- UA defaults: html/resources/html.css:333-351 (ul, menu, dir: disc; ol: decimal; padding-inline-start 40px; li `display:
  list-item`) and :363-373 (nested circle and square). LGPL, class A.

## R14. Outside list markers

### Marker geometry

- The marker's computed display is `inline-block` (every family5 run).
- **Symbol width** (disc, circle, square): list/list_marker.cc:345-361 (`WidthOfSymbol`):
  `(ascent * 2 / 3 + 1) / 2 + 2` in int arithmetic on the primary font's rounded ascent; 0 when the specified font size is 0.
- The symbol's shaped text ("• ", "◦ ", "■ " in the snapshot) is replaced by a run of spaces of that width:
  inline/inline_node.cc:1546-1557. No symbol glyph is measured or drawn. The symbol text itself comes from
  list_marker.cc:180-195 (kSymbol).
- **Outside margins**: list_marker.cc:394-432 (`InlineMarginsForOutside`). Symbols: start `-(ascent * 2 / 3) - 7 - 1` with
  `kCMarkerPaddingPx = 7` (list_marker.cc:25). Text and strings: start `-marker_inline_size`.
- The offset is from the list item's **border box**: list/unpositioned_list_marker.cc:25-37 (`InlineOffset`). Measured by
  family6 `border-left`: li border-box start 50, content start 60, marker at 34 (= 50 - 16).
- **DPR.** Layout runs in zoomed (device) px, so the ascent is rounded in device px and 7 and 1 stay device px. Formula, in
  device px: `asc = floor(0.8 * size * dpr + 0.5)` (Ahem), `third = floor(asc * 2 / 3)`, width `floor((third + 1) / 2) + 2`,
  ltr x `= border-box start - third - 8`, rtl x `= border-box end + third + 8 - width`. Asserted on all 224 geometry markers.
  Examples (disc, ltr, padding 50): 16 px at DPR 1: x 34, w 6; DPR 2: x 75, w 11; DPR 3: x 117, w 15; DPR 2.625: x 101.25,
  w 13 (4.952 CSS px). 1 px at DPR 1: w 2.
- Text markers: width = the shaped text including the trailing space; ltr x `= start - width`, rtl x `= start` (border-box
  end). Decimal "1. " at 16 px is 48 px at x 2. The assertion takes the width from the marker's own text boxes, so it checks
  the margin rule, not the shaper.
- Inter (family5 and family6 `inter`): the same formula holds with Inter's ascent `round(1984 / 2048 * size * dpr)` (hhea and
  typo ascender 1984 at 2048 units per em): 16 px gives asc 16, w 7, x 32; 23.3 px asc 23, w 10, x 27; 32 px asc 31, w 12, x 22.
- rtl decimal markers are two text boxes ("1." and " " reordered: `[350,0,32,16]` and `[382,0,16,16]` in family5 `ordinals`).
  The marker text is bidi-reordered like any text; no Blink line is needed beyond the inline layout.

### Marker alignment (family6-alignment)

- The list item positions the marker against its first line box's ascent, or the first child's first baseline, descending
  through blocks: block_layout_algorithm.cc:3748-3799 (`PositionOrPropagateListMarker`) with
  unpositioned_list_marker.cc:55-78 (`ContentAlignmentBaseline`).
- If the marker's ascent exceeds the content baseline, the content moves down: unpositioned_list_marker.cc:100-111
  (`AddToBox`). Measured by `push-down`: li font 32, span font 10; the marker box is [25,0,11,32] and the span's text top moves
  to y 18 (its baseline 26 equals the marker's rounded ascent 26).
- `nested-block`: the marker aligns with the text two padded blocks down (text y 13, marker y 13). `flex-first-child` and
  `inline-block-first-child`: the marker aligns with the flex item's or the inline-block's first baseline (marker y 11 and 12).
- `line-height`: 40 px makes the marker box 40 tall; its text sits at y 12 like the content's.
- **Without line boxes**: block_layout_algorithm.cc:1381-1387 and :3802-3830 (`PositionListMarkerWithoutLineBoxes`) with
  unpositioned_list_marker.cc:125-159 (`AddToBoxWithoutLineBoxes`): the marker is top-aligned at block offset 0 of the border
  box and the item grows to the marker's height. Measured by `no-line-boxes`: li `a` (child 10 tall) is 16 tall; li `b`
  (padding-top 5, child 4 tall) has its marker at the li's border-box top (y 16, not 21) and is 16 tall.
- **Empty item**: an li with no children is not the "without line boxes" case. The marker is an inline item of the li's own
  inline formatting context (inline/inline_node.cc:390-394, `kListMarker`), and the line breaker forces the line to be
  non-empty (inline/line_breaker.cc:1102-1106), so the line box exists and the marker aligns with it. Measured by `empty-item`:
  li `b` with padding-top 5 has the marker at the content top (y 21) and is 21 tall.
- `overflow-hidden`: the marker still has its box at x 34 (whether it is painted is a pixel question for GEN-c).
- `before-on-li`: the li's `::before` is the first inline content; the marker is unchanged.
- family5 `flex-ul`: an li in a flex ul stays `list-item` and keeps its marker, offset from the flex item's border box.

### Ordinals and counter-style text (family5-markers)

- html/list_item_ordinal.cc:181-226 (`CalcValue`): the previous item's value plus the step, or the list's initial counter;
  `reversed` steps by -1 and starts from the item count (:311-350, `InitialCounterForReversedOrderedList`). The `start` and
  `reversed` attributes are read in html/html_olist_element.cc (LGPL, class A).
- `ordinals`: 1, 2; start 9 then value 100 then 101; reversed 3, 2, 1; start -2 then -1, 0.
- `list-item-divs`: list-item divs continue the body's list-item counter (1, 2, 3) across an ol inside a div, which counts on
  its own (1).
- Counter-style text: css/counter_style.cc:158-222 (alphabetic, numeric and additive algorithms), :832-869 (`RangeContains`),
  :871-898 (`NeedsNegativeSign`), :900-908 (`GenerateFallbackRepresentation`), :910-944 (`GenerateRepresentation`: range, negative
  sign, pad) and :946-999 (`GenerateInitialRepresentation`). Measured at 0, 1, 26, 27, 3999, 4000, -1:
  decimal `0. 1. 26. 27. 3999. 4000. -1.`; decimal-leading-zero `00. 01. 26. ...`; lower-alpha and lower-latin
  `0. a. z. aa. ewu. ewv. -1.` (0 and -1 fall back to decimal); upper forms likewise; lower-roman
  `0. i. xxvi. xxvii. mmmcmxcix. 4000. -1.` (outside 1-3999 falls back to decimal); a string type `'>> '` is verbatim.

### Marker paint

- paint/text_fragment_painter.cc:173-215 (`PaintSymbol`): the rect is `RelativeSymbolMarkerRect` (list_marker.cc:434-458):
  x 1, y `3 * (ascent - ascent * 2 / 3) / 2`, side `(ascent * 2 / 3 + 1) / 2`, moved by the marker text fragment's offset and
  pixel-snapped. Disc: `FillEllipse`; circle: `SetStrokeThickness(1.0f)` then `StrokeEllipse`; square: `FillRect`. Colour: the
  marker's `color`.
- platform/graphics/graphics_context.cc:874-884: both ellipse calls are `DrawOval` (:657-662), i.e. `SkCanvas::drawOval`.
- third_party/skia/src/core/SkBitmapDevice.cpp:371-372 and SkDraw.cpp:826-833: `drawOval` draws `SkPath::Oval(oval)`, a filled
  path through AntiFillPath for the disc.
- **Circle is a hairline**: SkDraw.cpp:803-824 (`DrawTreatAAStrokeAsHairline`: a mapped stroke width <= 1 is a hairline with
  coverage = the width) and :966-990 (`modifyPaintForHairlines`: coverage 1 sets stroke width 0). So the 1 device px circle is
  drawn by Skia's anti-aliased hairline scan (SkScan::AntiHairPath), not by SkStroke.

### Marker paint oracle result

`node --conditions=dragon-internal scripts/check-marker-paint-oracle.ts` on 84 crops (3 symbols x 7 sizes x 4 DPRs, the snapped
rect plus 2 device px, CPU raster proven by SystemInfo featureStatus at every DPR):

| Symbol | Crops exact | Pixels equal (channel delta 0) | Planted paint-aa faults caught |
|---|---|---|---|
| disc | 28/28 | 6226/6226 | supersampleInsteadOfAAA 24/28, conicNotQuadded 15/28, edgeFixedPointRounding 10/28, coverageNotAccumulated 27/28; rrectRadiiUnclamped 0/28 (it never touches an oval path) |
| square | 28/28 | 6226/6226 | none (an integer rect fill uses no AA code) |
| circle | 0/28 | 0/6226 | not drawn: paint-aa refuses strokes of at most 1 device px ("drawn as a hairline, which is not modelled") |

The 1 px font crops are empty in Chrome and in paint-aa (side 0), so 24 disc crops carry ink. The capture also checks the rect
model before any pixel is compared: every square's ink equals its snapped rect, and every disc's ink lies inside it.

So the disc and square paths of paint-aa reproduce Chrome exactly at DPR 1, 2, 3 and 2.625. The circle needs a port of Skia's
anti-aliased hairline (SkScan_Antihair.cpp) before GEN-c can draw it natively (T151 §3 GEN-P: a recorded split, not a stop).

## Open questions

1. **UA counter-style rules.** The `@counter-style` definitions of the R14 styles (symbols, range, fallback, pad) are created by
   `CounterStyleMap::CreateUACounterStyle` (css/counter_style_map.cc:136); the UA sheet they are parsed from was not located in
   this reading. The measured texts (family5 `counter-*`) are the ground truth until GEN-c's port cites it.
2. **Text marker width rounding.** Decimal "N. " widths are not 3 x size x DPR rounded one way: at DPR 1, 17.3 px gives 51.875
   (floor of 51.9 on the 1/64 grid) but 23.3 px gives 69.90625 (round of 69.9) (family5 `geometry-decimal`). This is the
   shaper's advance rounding, which GEN-c takes from the base measurer, not a marker rule; it is recorded here because the
   marker box width equals it.
3. **Empty host with an empty `::before`.** family1 `empty-string`: a div whose only content is `::before{content:''}` is 0 tall,
   so the empty generated inline box creates no line box. The rule is the inline layout's empty-line rule; the exact line was not
   located in this reading.
