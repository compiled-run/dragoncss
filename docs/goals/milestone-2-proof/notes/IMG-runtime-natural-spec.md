# REPL-r2a: an `<img>` with a run-time `src` whose height follows its image, laid out again on the device

Worker spec (2026-11-26), for the planner and the Judge before any code. It builds on REPL-r1 (IMG-dynamic-src-spec.md, Judge verdict 2026-11-22) and changes one of REPL-r1's rules, for one narrow shape.

## Why

Markless check-in has two photos whose height follows the photo:

| Site | Markup | CSS | Screen |
|---|---|---|---|
| checkin pages/checkins/[id].tsrx:49 | `<img class="photo" src={entry.photo} alt={…} />` inside `@if (entry.photo !== '')` | `.photo { width: 100%; max-height: 320px; border-radius; object-fit: cover }` | `/checkins/[id]` |
| checkin pages/new.tsrx (`.shot`) | the photo just taken | `.shot { width: 100%; max-height: 260px; border-radius: 12px; object-fit: cover }` | `/new` |

REPL-r1 lays an img with a run-time `src` out once, without the image, and refuses every layout that reads the natural size. Its spec lists the `/checkins/[id]` photo as "refused, correctly" (measured heights 280.5, 9.34, 320 and 0 px for four photos). With Markless #1100 and dragoncss#716, this refusal is the last one on `/checkins/[id]`.

The other way to get these pages styled is to change the app: give each photo a fixed CSS `aspect-ratio`. That crops every photo to one shape on the web too. This spec is the way that keeps the web page as it is.

## What Chrome 145 does

Facts already in REPL-r1's spec, which this slice relies on:
- Before the image's size is known, and with no `src`, the natural size is 0 by 0 with no ratio (`LayoutImageEmptyNaturalSizeBeforeSizeAvailable` is stable). Once known, the natural size is fixed: both sizes and their ratio, after EXIF orientation.
- ComputeReplacedSize with a definite width and an `auto` height takes the height from the natural ratio, then clamps it by `min-height` and `max-height`.
- LayoutImage::ImageChanged lays the page out again when the natural size changed and NeedsLayoutOnNaturalSizeChange holds. Otherwise it only repaints.
- A new `src` keeps the old image, and so the old natural size, until the new one has loaded.

So in Chrome, the photo's box is 0 high while it loads, then `min(width × h / w, max-height)` once it has loaded. Everything after it in the flow moves down.

## The slice: what is accepted

An img with a run-time `src` is accepted as **following its image** when all of these hold, in every case, band, interaction state and export viewport Dragon lays out:

1. **The only read is the block size from the natural ratio.** The engine's natural-size reads at the img all come from the one site "auto height from the ratio, with a definite width" (replacedSize). Every other read stays refused as in REPL-r1, with its message: shrink-to-fit widths, flex automatic minimums, grid contributions, unsized imgs.
2. **No inline size depends on it.** With the natural size swept over the samples below, every box's inline size and every text node's line widths are the same as in the 0 by 0 layout. Only block positions, block sizes and scroll ranges may change. This keeps the device inside the text shaping the build recorded, since a line's width never changes.
3. **No selector or query reads layout.** The page has no container query on an ancestor of the img, and no scroll-driven or anchor-positioned box that depends on a box after it. These are refused as they are today, with the img named.
4. **REPL-r1's other rules are unchanged:** no alt text that a missing `src` would show, no selector that tests `src`, and the Q1 divergence note.

**The sweep.** The build lays the page out with each sample natural size: 0 by 0 (loading, as in Chrome), 1 by 1, 4:3, 3:4, 1:1, 16:9, 9:16, 10:1 and 1:10 at camera pixel sizes, and one sample tall enough that `max-height` clamps it. It does this in every case, band, interaction state and export viewport REPL-r1 already lays out, plus each band's edge widths (REPL-r1's Q3). Rule 2 is checked on the engine's own output, not on the source. Any difference in an inline size refuses the img with `DRAGON_RUNTIME_IMAGE_SIZE`, naming the box whose width changed.

## What the device does

- **Input:** runMarklessLayout and runMarklessRowsLayout take a new optional `naturals` field: per img that follows its image, `[width, height]` in image pixels, or `null` while it loads or has no `src` (laid out as 0 by 0).
- **When it lays out again:** the host calls the layout again when a decoded image's natural size differs from the one last laid out. The same call already runs on viewport and slot changes, so the result (frames, scroll range, sticky constraints, text areas) replaces the old one the same way. A new `src` keeps the old natural size until its image has decoded, as Chrome does.
- **The engine on the device:** for an img the export marks as following its image, the natural read at the accepted site returns the given size. Every other site still stops, with its reason. A viewport the build never laid out stops at the first read rule 2 has not proved, as REPL-r1's device stop does today.
- **Paint:** unchanged from REPL-r1 (`runtime-image`, `setRuntimeImage`). The content box now comes from the layout of the current natural size.
- **Export:** the `runtime-image` write gains `follows: true`. A compile without such an img gives byte-identical output.

## What has to be checked on the device

These depend on the Markless hosts, not on Dragon. I'll measure each before the Dragon PR, and correct this spec if one is wrong:
- **Taps:** the host's hit test must read the frames of the latest layout, not frames recorded at build time. If any tap target's frame is recorded at build time, a target below the photo would answer at its old place. Then that path must take the new layout, or the slice is refused for pages with tap targets after the img.
- **State tables:** a state change must not reuse a frame from the layout before the photo loaded.
- **Scroll position:** when the photo loads above the current scroll offset, Chrome's scroll anchoring (`overflow-anchor: auto`) keeps the visible content in place. The host must apply Dragon's anchoring answer, or the slice refuses an img above the initial scroll position. On `/checkins/[id]` the photo is above every other box, and the page opens at offset 0, where anchoring changes nothing.

## Proof

- **Parity fixtures (chrome-dual and linux-dragon-layout),** each ltr and rtl, at every DPR lane:
  - `tree-replaced-runtime-follows-block`: the `/checkins/[id]` shape, a `width: 100%; max-height` img followed by text and a grid. It is captured in Chrome once per sample image (0 by 0 loading, landscape, portrait, square, clamped). Layout and hit lanes compare each sample's frames with Chrome's. The paint lane draws each sample through replacedPaint.
  - `tree-replaced-runtime-follows-change`: a state that swaps the `src` between a landscape and a portrait sample. Chrome's frames are captured after each load. The native lanes check that the layout follows the loaded image, and that the old natural size stays until the new image is set.
  - `reject-runtime-follows-width`: an img whose natural size reaches an inline size (a `width: 100%` img inside a shrink-to-fit float). It stays refused, naming the float.
  - `reject-runtime-follows-container-query`: a container query on an ancestor.
- **Planted faults:**
  - `runtimeFollowsStale`: the device lays out with the 0 by 0 natural size after the image loads. The follows fixtures must fail.
  - `runtimeFollowsWidthUnchecked`: rule 2 is skipped. `reject-runtime-follows-width` must compile and its layout lane must fail.
- **Entry gate:** paint, layout and hit counts at each DPR, `native:gen`, and the iOS and Android builds of the new pages. Every existing page's output stays byte-identical, since no other page has an img that follows its image.
- **Markless rung:** a page with the `/checkins/[id]` shape and a tap target below the photo, run on iOS and Android with a landscape and a portrait photo. The tap must land after each load.

## Open questions for the Judge

1. **The sweep instead of a proof.** Rule 2 is checked on a fixed set of natural sizes, not proved for every size. In this shape, the img's block size is the only thing that changes, and block sizes don't feed inline sizes in block, flex-row and grid flow without the refused features. Is a sample sweep with a named sample list enough (proposed), or should the engine prove it structurally: tracking that the natural size reaches only block-axis values?
2. **Scroll anchoring:** refuse an img above the initial scroll position (proposed), or port Blink's ScrollAnchor for this case?
3. **Loading state:** lay out at 0 by 0 while loading, as Chrome does (proposed), so the content jumps when the photo arrives, exactly as on the web?
4. **Rows:** a follows img inside a `@for` row (runMarklessRowsLayout). Include it (each row lays out again with its own image) or leave it refused until an app needs it (proposed: refused; neither check-in page has one)?

## Not in this slice

Any read of the natural size into an inline size; flex automatic minimums; grid track contributions (shop `/products/[id]`'s photo keeps REPL-r1's refusal and its CSS fix); `srcset` densities.
