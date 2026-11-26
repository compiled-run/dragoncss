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

**Measured on Markless main `1b78daa73` (2026-11-26):** both hosts already lay the page out again when the size, a slot or a page text changes. On iOS this is MarklessViewController.layOutAtScreenSize, which feeds `tree.relayout`. On Android it is MarklessHost.layOutAt, keyed on `laidOutFor`. Taps go through the views' current frames: on iOS, the UIKit hit test in PageScroll.topmost. So the host change is to add the natural sizes to that key. Inside Dragon, the interaction machine's hit table is a separate risk; see the Judge's amendment 4.

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

## Judge verdict (2026-11-26)

**Approved with amendments.** The route and the product behaviour are right. Four parts of the spec are wrong or missing, and each must be fixed before code:
- Rule 1 describes the read wrongly.
- The sweep alone does not prove rule 2.
- The hit-test risk is inside Dragon, not only in the host.
- The scroll-anchoring refusal can never fire.

Where the rulings and amendments below differ from the sections above, they win.

### Rulings

1. **Sweep or structural proof for rule 2: both, plus a check on the device.** A sample sweep is evidence, not proof. Several engine paths turn a block size into an inline size only past a threshold, and a fixed sample list can step over one (amendment 2). Three layers are required:
   - (a) A structural guard at the img itself (amendment 1). It shows the img's own inline size never reads its natural size.
   - (b) Build-time refusals of the known paths from a block size to an inline size (amendment 2), with the sweep kept as a backstop.
   - (c) A check on the device. After each layout that follows a natural size, the engine compares every box's inline size and every line's width with its own 0 by 0 layout at the same viewport and scale. The device already computes that layout while the photo loads, so the check costs only the comparison. Any difference stops, naming the box. The device stop then covers every natural size, not only the sampled ones. Taint-tracking every LU value is not required.
2. **Scroll anchoring: the proposed refusal is rejected.** "Above the initial scroll position" is a build-time fact. The risk is a run-time one: the user scrolls down while the photo loads, and the photo then grows above the viewport. On `/checkins/[id]` the refusal would never fire, yet the page would still jump. A full port of Blink's ScrollAnchor is not required. Port only these two cases, and pin each with a Chrome capture made after scrolling and before the load:
   - **Img wholly above the scroll offset:** add the change in its height to the offset.
   - **Img crossing the top of the viewport:** no change.

   Anything else, such as a nested scroller or an img inside a sticky box, is a named divergence note. The claim that "at offset 0, anchoring changes nothing" is unverified. While loading, the img is 0 high and may not be an anchor candidate, in which case the `<h1>` or `<dl>` below it would be the anchor. The fixture must capture Chrome at offset 0 too.
3. **Loading state: approved, 0 by 0 as Chrome does.** One addition: when the image is already decoded at the first layout, the host passes its natural size on that first call rather than laying out 0 by 0 and then again. Examples are a cached image, or `/new`'s `.shot` right after capture. This matches Chrome, which lays out a memory-cached image at its size on first layout. The `-follows-change` fixture adds a case where the image is ready at mount.
4. **Rows: approved, refused.** runMarklessRowsLayout keeps REPL-r1's stop, naming the row. No follows img sits in a row on either page. The index page's `.thumb` sits inside `@for` (index.tsrx:72-75), and must keep compiling exactly as it does today; the entry gate shows this.

### Amendments

1. **Rule 1 is false as written.** There is no single "auto height from the ratio" read site. All reads go through one closure, `read` (replaced.ts:132-135), and it is reached from:
   - the ratio read at replaced.ts:141;
   - the natural-size read at replaced.ts:150;
   - the callers at :165, :166 (a recursive pass that ignores block lengths), :186 (the block axis, computed before the inline axis) and :254.

   The loading state is not a ratio read. A 0 by 0 natural size has no ratio (replaced.ts:294), so the box's height comes from the natural size through :165/:254. Rule 1 should instead be a predicate checked before the first read. The read is allowed only when all of these hold:
   - `reader === 'used-size'`;
   - `space.fixedInline !== null`, or `s.width.kind !== 'auto'` and the width resolves against a non-null `percentInline` (replaced.ts:230);
   - the height is auto, or a fixed block size is given.

   Under this predicate the function returns at :241 or :255 with an inline size the natural size never touched, so the guard is the structural proof for the img itself. Every other read, including `max-content`, `min-content` and `flex-content`, keeps `runtimeNaturalRead`.
2. **Rule 2 must name and refuse the paths from a block size to an inline size,** each with a reject fixture:
   - **Abspos boxes:** an absolutely positioned box with an aspect-ratio, an auto width and both block insets takes its width from its containing block's height (position.ts:236). Refuse it when the img lies inside that containing block.
   - **Grid second column pass:** a grid whose rows the img's block size feeds, and which has an item flagged `sizingDependsOnBlockSize` (grid.ts:1914), sizes its columns again after its rows (grid.ts:2203, :2633). Refuse it.
   - **Floats:** a float in the img's block formatting context that ends below the img's top. Lines after the img change width as it grows.
   - **anchor-size():** any `anchor-size()` that refers to the img, to an ancestor of it, or to a box after it (anchor.ts:195). Rule 3's "a box after it" misses ancestors; widen it to the img, its ancestors and every box after it in its containing-block chain.

   Already closed, with no new work:
   - Classic scrollbars: the engine reserves no gutter. The 15px gutter exists only as the planted fault at overflow.ts:60 and :283.
   - Multi-line column flex with an indefinite height is refused (flex.ts:169).
   - A float with an aspect-ratio and an auto width is refused (float.ts:76).

   Orthogonal writing modes need a rule-2 refusal unless the engine already refuses `writing-mode` (block.ts, flex.ts and inline.ts reference it).
3. **"This refusal is the last one on `/checkins/[id]`" is unproven.** REPL-r1 stops at the first read, which is the used-size read, so later reads were never reached. One example: the article is an item in `.content`'s single auto column (Shell.tsrx:41-47). Commit 6e6707e2c2 says master reads no max-content contribution there, but that holds only for one auto track. Before the Dragon PR, compile both pages at every band with the used-size read allowed, and list what is still refused. `/new` also places `.shot` inside `.form` (also a grid) inside `.content`.
4. **The hit-test risk is inside Dragon, and the spec must say so.** The emitted interaction machine builds its own hit table by laying out `variants[laidOut](scale)` again (interaction.ts:359 Swift, :705 Kotlin; rt-hit.ts:1414 `layout(input, measurer)`). It caches the table under `"\(laidOut)|\(f)"`, a key that leaves out the natural size. Two consequences:
   - (a) Without `naturals`, that layout reaches the run-time read and throws, which becomes a HitError.
   - (b) With them, a table built before the load is reused after it, so a tap below the photo answers at its old place.

   `naturals` must reach every caller of `layout()`: runMarklessLayout, rt-hit `hitTableOf`, rt-select `selectionTableOf` (rt-select.ts:299), and the state machine (state.ts `runtime-image`). Each cache key must include a counter that changes whenever the natural sizes change. Plant a fault, `runtimeFollowsHitCacheStale`, that keeps the old table. The Markless rung must fail under it.
5. **Planted faults to add:**
   - `runtimeFollowsReadUnguarded`: the amendment-1 predicate is skipped. A width-auto follows img must then compile, and its layout lane must fail.
   - `runtimeFollowsDeviceCheckSkipped`: the ruling-1(c) comparison is skipped. A device-lane case with a natural size the sweep never sampled, crossing a float edge, must fail.

   `runtimeFollowsWidthUnchecked` stays, but its fixture must use a path that amendment 2 does not already refuse at build time. Otherwise the fault proves nothing.
6. **Sweep samples:** keep the list. Add both extremes of the ratio clamp, for example 1:1000 and 1000:1, and an exact-fit sample where the height computed from the ratio equals `max-height` to the LU. The clamp at replaced.ts:187 is where a rounding error in `constrain` would show. Since the width is definite, the size in camera pixels changes nothing except through the ratio. The 0 by 0 sample and one non-zero size per ratio are enough.
7. **Paint:** REPL-r1's rule stands. The destination rect of a follows img is never computed at build time. The paint lane computes it per sample in its test host.
8. **Export:** `follows: true` is set only on an img that passes amendments 1-2. Byte-identical output is checked over the whole entry-gate corpus, not stated.

Line numbers refer to the REPL-r1 tree (cw/img-dynamic-src-paint, #651).

## How the amendments were carried out (worker, 2026-11-26)

Where this differs from the verdict, the reason is given; the Judge's reviewer reads these first.

- **Amendment 1:** `followsRead` in replaced.ts is the predicate, checked inside `read` before any natural size is given. Planted fault `runtimeFollowsReadUnguarded` (layout replaced-follows.test.ts).
- **Amendment 2:**
  - Abspos: refused by the sweep, which names the box (`<img> a ... changes the inline size or position of ab`). The width follows any non-zero image height, so no sample can step over it. Fixture `reject-runtime-follows-width`.
  - Grid second column pass: the engine refuses it at grid.ts `layoutGridContainer`. The refusal fires when columns are sized again, an item holds a follows img, and another item is a replaced element flagged `sizingDependsOnBlockSize`. Only a replaced item is measured with its row area as its block size (Blink CreateConstraintSpaceForMeasure), so it is the only way a row's height reaches a column. Refusing on any second pass is too wide: `/checkins/[id]`'s page grid runs one for reasons that have nothing to do with the photo, and the measurement showed that broad refusal blocking the page. A percentage height beside aspect-ratio is already refused. The refusal is in the engine, so it stops the device too.
  - Floats: already refused. FLT refuses any float followed by in-flow content in its formatting context, so a float beside or after the img never compiles.
  - anchor-size(): any box sized by anchor-size() in a tree with a follows img refuses it, naming the box. This is wider than the verdict asks.
  - Writing modes: already refused. Every vertical writing-mode value is DRAGON_UNSUPPORTED_VALUE (writing-mode.test.ts).
- **Amendment 4:** runMarklessLayout takes `naturals`. Dragon's own state and interaction machines never hold a follows img: a runtime-image write in a state program is refused at emit (state.ts nodeLit), now pinned for a follows write. So no Dragon hit or selection table is ever laid out with one, and no cache key needs a counter. Markless pages with states compile, because Markless taps go through the native views and the host lays each state out through runMarklessLayout. The stale-table risk is therefore the host's relayout key, and `runtimeFollowsHitCacheStale` is planted there (Markless host change).
- **Amendment 5:** `runtimeFollowsDeviceCheckSkipped` is an engine fault the device function reads. The verdict's case (a natural size no sample hit, crossing a float edge) cannot be built, because floats are refused. The proof instead uses the abspos page compiled under `runtimeFollowsWidthUnchecked`: the device stops it at its first image, and it lays out widened only with both faults (parity markless-follows.test.ts). The device check also compares every text line's start, x and width with the 0 by 0 layout.
- **Spec fixtures:** `tree-replaced-runtime-follows-block` and `-change` are one fixture, `replaced-runtime-follows`, with REPL-r1's sample images and both swaps. Each sample is compared with Dragon laid out at that sample's natural size, at DPR 1, 2, 2.625 and 3, in both directions. Swapping to an image that has not loaded keeps the old natural size, as Chrome does. A PNG or a viewBox SVG gives its size; an SVG with no size and no viewBox is a named divergence. Chrome sizes it 300x150 with no ratio, which no natural size gives. `reject-runtime-follows-container-query` is dropped: a size query reads only sizes that containment fixes, and an inline-size query reads only the width, so the image cannot change either.
- **Amendment 5, `runtimeFollowsWidthUnchecked`:** under the plant, `reject-runtime-follows-width` compiles, but its layout lane passes. The engine lays the widened abspos box out as Chrome does, because it lays the page out again in full. Rule 2 protects what the build fixes for the device in advance: a Markless plan's measured text, and a box's inline frame. So what fails under the plant is the device's own check, which stops the page at its first image (markless-follows.test.ts), not the fixture's layout lane.
- **Ruling 2:** `runtimeImageScrollShift` (replaced.ts, an engine root so both phones run it). The offset moves by the img's change in height when the img lay wholly above a non-zero offset; otherwise it does not move. Six Chrome 145 cases at DPR 1 and 3 pin it (expected-scroll-anchor, scroll-anchor.test.ts): below the viewport at offset 0, wholly above while loading and after a swap, across the top during a swap, and an img at the page's top at offset 0 and at 100. At offset 0, Chrome does not move the page, even for a 0-high img at the very top, so the rule includes `offset > 0`.
