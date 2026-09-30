# Float probe corpus (FLT-P)

These are Chrome 145.0.7632.6 (Playwright 1.58.2) measurements of float layout, for FLT-0 to FLT-4 and FLT-WM to cite.

- Every case uses Ahem only.
- Each case is captured in 24 environments: DPR 1, 2, 3 and 2.625, in ltr and rtl, and in `horizontal-tb`, `vertical-rl` and `vertical-lr`.
- There are 209 cases, so 5,016 environment records, in 3.9 MB over six files.

The Blink source reading that explains each measured rule is in [blink-notes.md](blink-notes.md).

## Running

```text
node --conditions=dragon-internal scripts/capture-float-probe.ts          # writes probe/<family>.json
node --conditions=dragon-internal scripts/capture-float-probe.ts --check  # recaptures and exits 1 unless every file is byte-identical
```

The script imports `packages/parity/src/chrome.ts` unchanged:

- `launchChrome(dpr)` refuses any Chrome other than 145.0.7632.6.
- `openPage` injects the harness style: Ahem as the root font, and `direction: rtl` on the root for rtl.

The four DPRs run at the same time, one browser each, and the results are written in a fixed order.

Each case is a `<div id="c" style="writing-mode:M; inline-size:Wpx; ...">` at the top-left of a 600x600 viewport, with `body{margin:0}` and `#c{font-size:10px; display:flow-root}`. So the container is always the root of the block formatting context (BFC) the floats live in. Case HTML uses logical properties (`inline-size`, `block-size`, `margin-inline-start`, ...), so each case means the same thing in every writing mode. `float: left/right` are line-left and line-right, which is the top and bottom edge in both vertical modes.

## Files

| File | Family | Cases |
| --- | --- | --- |
| `probe/family1-placement.json` | 1. Placement and the top-edge rule: left, right, inline-start and inline-end (including a float whose own direction differs from its containing block's); rows, wrapping and stepping; the top-edge rule; positive, negative and logical margins; floats wider than the container; shrink-to-fit floats; % and fractional sizes; floats after blocks and margins; floats inside a line (fits, pushed after the line, trailing space, ancestor inline-end padding, a second float pending); floats with `clear`; the computed `display` and `float` of floated inline, inline-block, inline-flex, inline-grid, inline-table, list-item, table-cell and contents boxes, and of abspos, fixed, flex and grid items; relative offsets; orthogonal floats | 50 |
| `probe/family2-clearance.json` | 2. Clearance: `clear` none, left, right, both, inline-start and inline-end on a fixed-height block and on text; cleared margins less than, equal to and greater than the float; preceding margins; negative clearance; clearance through a collapsing parent and a bordered parent; self-collapsing cleared blocks; `<br clear>` and `br{clear}`; `clear` on a flow-root; floats inside sibling BFCs and inside plain children; fractional heights; negative float margins; the computed `clear` of floats, spans and abspos boxes | 32 |
| `probe/family3-bfc.json` | 3. BFC roots beside floats: flow-root, `overflow:hidden`, flex, grid, table, `contain:paint` and multicol beside a float, compared with a plain block; auto, fixed, exact, too-wide and fractional widths; min-content wider than the gap; inline-start, inline-end, negative and auto margins; staircases and closed-off areas that are too short; `clear`; the margin-collapsing re-layout when a BFC root does not fit; % widths; `<hr>` | 31 |
| `probe/family4-lines.json` | 4. Line opportunities with Ahem: left, right and both; `text-align` end, center and justify, to expose both edges of each opportunity; words and atomics too wide for the gap; `nowrap`; `pre-wrap`; `text-indent` ±; tall and odd, even and 23px line-heights; a 20px span; float heights at 19.99, 20, 20.01, 20.02, 20.5 and 25.3 and widths at 49.99, 50.01 and 50.5 (rounding edges); a float mid-paragraph; sibling blocks with padding and margin; staircases; zero-block-size and zero-inline-size floats; `<br>`; floats inside decorated spans; alternating floats | 39 |
| `probe/family5-height.json` | 5. Container height and intrinsic sizes: the BFC root grows to its floats and a plain child does not; flow-root, overflow, inline-block, abspos, float, table-cell and flex-item children; float block margins, positive and negative; fractional heights; min and max block size; clearfix divs; shrink-to-fit, min-content and max-content widths with floats, cleared floats, block children and BFC children | 25 |
| `probe/family6-shapes.json` | 6. `shape-outside` basic shapes: `circle()` (%, px, positioned, closest-side, farthest-side, larger than the box, with `shape-margin`, with float margins, with tall lines, and a word that steps down 1px at a time); `ellipse()`; `inset()` with and without `round`; `polygon()` (convex, concave, evenodd, with `shape-margin`); the margin-box, border-box, padding-box and content-box keywords with `border-radius`; shape plus box; fractional sizes; two shapes; BFC roots and later floats ignore the shape; `shape-outside` on a non-float | 32 |

Image shapes are listed only, not captured. These are `shape-outside: url(...)`, `shape-outside: linear-gradient(...)` and `shape-image-threshold`. The code path is `ShapeOutsideInfo::CreateShapeForImage` (`shape_outside_info.cc:213`) with `RasterShape` (`raster_shape.cc`). An image shape would need a decoded image in the probe and a raster pass in the engine. FLT-4 decides whether to add them.

## Record format

Each file holds `cases[id] = { note, width, style, html, modeDivergent, dprDivergent, results }`.

`results["dpr<N>-<dir>-<writing-mode>"]` holds:

- **`container`**: the container's border box, `[x, y, width, height]`.
- **`elements[label]`**: every `data-p` element.
  - `box`: `getBoundingClientRect()`, the border box.
  - `rects` (inline boxes and `<br>` only): `getClientRects()`.
  - `computed`: `float`, `clear` and `display`. Family 6 also records `shape-outside`, `shape-margin` and `shape-image-threshold`.
  - A `display: contents` element has no box. Its `box` is the viewport origin relative to the container, and is meaningless.
- **`lines[container]`**: the lines of each block container, keyed by the `data-p` label of the nearest non-inline ancestor (`#c` for the root).
  - `rect`: the union of the Ahem glyph rects on the line. Spaces are excluded, so a hanging space does not widen it.
  - `text`: the line's characters in DOM order, with trailing spaces trimmed.
  - Glyphs are grouped into lines by overlapping block-axis extents, in DOM order.
  - With Ahem and `line-height: normal`, a glyph rect's block extent is the line box's block extent (ascent 0.8 em + descent 0.2 em, no line gap). With a larger `line-height`, the rect is the glyph box and the line box extends by the half-leading on each side.

Every coordinate is in CSS px, physical, relative to the container's border box.

- **`modeDivergent`**: the environments whose line-relative geometry differs from `horizontal-tb` at the same DPR and direction. Line-relative means: offset from line-left, offset from block-start, inline size, block size.
  - The comparison allows 0.001 px, which is below a device LayoutUnit at DPR 3 (1/192 px) but above the float noise of subtracting page offsets.
  - An empty list means float placement is the same in all three writing modes. See blink-notes.md §8 for the cases that differ.
- **`dprDivergent`**: the environments whose line-relative geometry differs from DPR 1 in the same direction and writing mode. At 2.625 almost every case with text is listed, because a 10px Ahem line is 26 device px, which is 9.905 CSS px.

## Measurement method

- **Boxes.** Boxes are read with `getBoundingClientRect()`. Floats, blocks and BFC roots are block-level, so this is their border box.
- **Line opportunities.** Where an opportunity's end edge matters, a case is also run with `text-align: end` or `center` (`l-left-end`, `l-right-end`, `l-both-center`). The start edge is the first glyph of a start-aligned line. The end edge is the last glyph of an end-aligned line.
- **Placement.** Nothing is inserted into the page. The layout measured is the authored layout. `--check` recaptures everything and compares the files byte for byte.
