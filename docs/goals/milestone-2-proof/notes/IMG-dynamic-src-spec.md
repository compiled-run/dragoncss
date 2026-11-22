# REPL-r1: laying out an `<img>` whose `src` is set at run time, as Chrome 145 sizes it

Worker spec (2026-11-21), for review before implementation. T045 R1 names runtime-fetched images as a later package (REPL-r). This is its first slice.

## Why

Markless's styled yardstick apps (Markless e63329eb8, packages/mobile/apps) have images whose `src` follows app data:

| Site | Markup | CSS that sizes it | Screens |
|---|---|---|---|
| shop lib/ProductCard.tsrx:45 | `<img src={image} alt="" width="400" height="300" />` in `<a class="card">` | `.card { display: grid }`, `.card img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover }` | `/`, `/categories/[slug]` |
| shop pages/products/[id].tsrx:125 | `<img class="photo" src={product.image} alt={product.name} width="400" height="300" />` in `<article class="product">` | `.product { display: grid; gap: 18px }` (`1fr 1fr` from 700px), `.photo { width: 100%; border-radius }` | `/products/[id]` |
| checkin pages/index.tsrx:75 | `<img class="thumb" src={entry.photo === '' ? undefined : entry.photo} alt="" />`, in a `@for` row | `.row { display: grid; grid-template-columns: 64px 1fr }`, `.thumb { width: 64px; height: 64px; background: var(--line); object-fit: cover }` | `/` |
| checkin pages/checkins/[id].tsrx:49 | `<img class="photo" src={entry.photo} alt={…} />` | `.photo { width: 100%; max-height: 320px; object-fit: cover }` | `/checkins/[id]` |

styles/app.css of either app has no rule for these elements. Markless leaves a bound `src` out of the style input (serializer native-view.ts isNativeStyleStateAttribute), so Dragon sees an `<img>` without `src` and refuses it in images/compile.ts compileImages (`has no src: Dragon draws an img only from a src it reads at build time`). That refusal blocks all five screens.

Two facts about the apps matter below:
- **The two `width="400" height="300"` images keep `height: 300px`.** The `height` attribute maps to the `height` property, and no author rule overrides it. So ProductCard's `aspect-ratio: 4 / 3` has no effect in Chrome: the image is 179 by 300 at a 390px viewport.
- **shop's images are SVG** (server/catalog.ts: `/images/lamp.svg`, a `viewBox="0 0 400 300"` with no width or height). checkin's photos are camera JPEGs.

## What Chrome 145 does (tag 145.0.7632.6, references only; paths under third_party/blink/renderer/core/)

**The natural size** (layout/layout_image.cc LayoutImage::UpdateNaturalSizeIfNeeded; layout/layout_image_resource.cc GetNaturalDimensions):
- Once the image's size is known, the natural size is `NaturalSizingInfo::MakeFixed(image.Size(orientation))`: both sizes and their ratio. It is scaled by zoom and by the srcset density. An SVG with only a `viewBox` has a ratio and no size.
- Before that, and with no `src`, it stays the default PhysicalNaturalSizingInfo (layout/natural_sizing_info.h), which is 0 by 0 with no ratio. This is because the runtime flag `LayoutImageEmptyNaturalSizeBeforeSizeAvailable` is stable. It is not the 300 by 150 default object size, so an unsized img that is loading is 0 by 0 (measured).
- On a load error the old value is kept (`if (!image_resource_->ErrorOccurred())`). The element is then re-attached as fallback content (below).

**Width and height attributes** (html/html_image_element.cc CollectStyleForPresentationAttribute; html/html_element.cc ApplyAspectRatioToStyle):
- They map to `width`, `height` and, when both are absolute lengths, `aspect-ratio: auto w / h`. Dragon already does this in analysis/elements/replaced.ts presentationalHints.
- layout/block_node.cc BlockNode::GetReplacedAspectRatio orders the ratios:
  - a plain CSS `<ratio>` wins;
  - then the natural ratio, if there is one;
  - only then the ratio of `auto && <ratio>`.
- So with `auto 400 / 300`, the ratio is 4:3 before load and the image's own ratio after load.

**The used size** (layout/length_utils.cc ComputeReplacedSizeInternal, ComputeNormalizedNaturalSize):
- **Both sizes definite:** the function returns early, before it uses the natural size. Dragon's port is packages/layout/src/replaced.ts replacedSize.
- **One size definite:** the other comes from the ratio, or from the natural size when there is no ratio. A plain `<ratio>` never reads the natural size. `auto && <ratio>` reads it once the image loads.
- **Neither size definite:** the natural size, clamped by min and max. The 300 by 150 default applies only when a natural size is missing and there is no ratio.
- **object-fit and object-position never change the box** (layout/layout_replaced.cc ComputeObjectFitAndPositionRect; paint/image_painter.cc PaintReplaced, PaintIntoRect). They read the natural size only to place the drawn image inside the content box.

**Contributions** (what an img adds to its container's intrinsic sizes):
- **Min and max contributions** (length_utils.cc ComputeMinAndMaxContentContributionForReplaced): both are ComputeReplacedSize's inline size.
  - A percentage `width` or `max-width` is "compressible": the min-content contribution is the resolved `min-width`, or border plus padding when it is `auto`.
  - The max-content contribution of `width: 100%` comes from the definite height through the ratio, or from the natural width when there is no ratio.
- **Grid** (layout/grid/grid_layout_algorithm.cc ContributionSizeForGridItem; grid_layout_utils.cc CalculateIntrinsicMinimumContribution):
  - an `auto` minimum uses the min-content contribution;
  - there is no transferred size suggestion ("TODO(ikilpatrick): All of the below is incorrect for replaced elements");
  - an `auto` track's growth limit uses the max-content contribution.
- **Flex** (layout/flex/flex_layout_algorithm.cc):
  - the content size suggestion is ComputeReplacedSize without the percentage zeroing;
  - the automatic minimum is `std::min(specified_size_suggestion, content_size_suggestion)`;
  - so a flex item with `min-width: auto` reads its natural size even when its width and height are fixed. LayoutImage::NeedsLayoutOnNaturalSizeChange says so: "Flex layout algorithm uses the intrinsic image width/height even if width/height are specified".

**A src that changes at run time** (loader/image_loader.cc UpdateFromElement, DoUpdateFromElement, UpdateLayoutObject):
- The old image stays on screen until the new one has loaded: `if (image_content_ != cached_image_content && (image_complete_ || !cached_image_content))`, with the comment "This prevents flickering in the case where a dynamic change is happening between two images". Measured: the old pixels stay while the new src is pending.
- LayoutImage::ImageChanged relays out only if the natural size changed and NeedsLayoutOnNaturalSizeChange holds. Otherwise it repaints only.

**No src, `src=""`, errors and alt** (html/html_image_element.cc CreateLayoutObject, SelectSourceURL; html/html_image_loader.cc NoImageResourceToLoad; html/html_image_fallback_helper.cc):
- **An img inserted with no `src` and with `alt=""`, or with no alt or title,** stays primary content (NoImageResourceToLoad returns early on an empty alt). It is a real replaced box with a 0 by 0 natural size, and it honours CSS width and height. The FIXME there says fallback is skipped only to avoid rebaselining tests.
- **With a non-empty alt, an error, `src=""`, or a src removed at run time,** SelectSourceURL calls EnsureCollapsedOrFallbackContent and the element becomes fallback content: a block flow with a UA shadow tree. It has no alt check, so this happens even with `alt=""`.
  - With dimensions and an empty alt (TreatImageAsReplaced), the fallback is a flow-root box of the host's size with a 1px silver border and a 16 by 16 broken-image icon, shown when the box is 18px or larger.
  - With a non-empty alt in standards mode, an inline host's width, height and aspect-ratio are reset, so the box is the alt text.
- **Paint with no image** (paint/image_painter.cc PaintReplaced): a primary-content img with no image strokes a light gray outline when its content box is larger than 2 by 2. Measured: rgb(192, 192, 192), 1 device px, at the snapped content box edge, at DPR 1, 2, 2.625 and 3. A loading image (src set, not yet decoded) paints nothing, only its box's own background and border.

**Measured in Chrome 145** (the parity lane's headless shell, chromium_headless_shell-1208, through Playwright 1.58.2; viewport 390 by 844; each shape loaded with PNGs of 400x300, 4000x100, 100x4000 and 1x1, then pending (a request that never answers), 404, no src and `src=""`; every box's rect compared):

| Shape | All loaded and pending images | No src (alt="") | Error or `src=""` |
|---|---|---|---|
| ProductCard (grid in `repeat(2, 1fr)`) | same: 179x300 | same | **differs**: 400x300 (fallback takes the attribute width) |
| products/[id] photo (grid) | same: 374x300 | (alt is not empty: fallback) | differs: 400x300 |
| checkin thumb (64px grid track) | same: 64x64 | same | same |
| checkins/[id] photo (`width: 100%`, auto height) | **differs**: height 280.5, 9.34, 320, 0 | differs | differs |
| block `200px x 100px`, any object-fit | same | same | same |
| block `width: 100px`, attributes 400x300 (height hint stays) | same: 100x300 | same | same |
| block `width: 100px; aspect-ratio: 2` | same: 100x50 | same | same |
| flex row 150px wide, img `200px x 100px` | **differs**: 133.33, 200, 133.11 | differs | differs |
| the same with `min-width: 0` | same: 133.11x100 | same | same |
| flex row 400px wide, img `200px x 100px` | same | same | same |
| grid `auto 1fr`, img `100px x 50px` | same | same | same |
| grid `1fr 1fr`, img `width: 100%; height: 50px` | same | same | same |
| float holding img `width: 100%; height: 50px` | **differs**: 66.7, 374, 1.25, 50, 0 | differs | differs |
| inline in text, `40px x 20px` | same | same | same |

So Chrome's layout of these shapes never reads the natural size, except in the rows marked "differs". The products/[id] photo row stays the same even though Chrome reads the natural ratio there: it feeds only the growth limit of an `auto` track, and stretch then fills the track to the container.

## What Dragon does today

- **images/compile.ts compileImages:**
  - resolves every img `src` of every case, band and interaction state to build-time bytes: a `data:` URL, or a src the `images` option (ProjectConfig.images, a src-to-snapshot-asset map) maps;
  - refuses a remote or unmapped src (`DRAGON_REMOTE_IMAGE`), bytes it cannot draw, and a missing src (`DRAGON_UNSUPPORTED_IMAGE`);
  - fills `naturals` (src to natural size) and `bytes`.
- **lower/ios-layout.ts lowerReplaced:** builds the engine's ReplacedLeaf (layout/src/input.ts) with `natural: { kind: 'image', width, height }` from `naturals`, and throws `has no image the build read` without it.
  - NaturalSizeValue has only `image` (size and ratio) and `none`, which is an iframe's: default object size, no ratio. There is no 0 by 0 state and no ratio-only state.
- **The engine reads the natural size** in replaced.ts:
  - replacedAspectRatio;
  - normalizedNaturalSize, computed eagerly at the top of replacedSize, even on the both-definite path;
  - replacedContribution (intrinsic.ts), which computes the size before its compressible-minimum early return;
  - the flex content size suggestion (flex.ts, contentMain);
  - objectFitRect (paint only).
- **The engine refuses every replaced grid item:** grid.ts buildGrid calls `unsupported('grid-replaced', …, 'a replaced grid item (not yet supported)')`. All three grid-placed Markless images hit this even with a static src.
- **Paint** (lower/paint/image.ts IMAGE_LOWERING, emit/paint/image.ts):
  - the `replaced-image` write (`dragonImage`) embeds the PNG bytes base64, with the natural size, object-fit, pixelated and layer;
  - the device decodes them once when the view is built (ImageIO, BitmapFactory);
  - DragonTree.apply sets the destination and drawn rects after layout from the translated layout/src/paint.ts replacedPaint, an engine root (translate/src/generate.ts PAINT_ROOT_FILES), so the device and the host lanes compute them with the same code;
  - UIImageView contentMode and ImageView ScaleType are not used, since neither expresses object-position.
- **Formats** (T045 R3): native draws 8-bit sRGB PNG only. `reject-replaced-jpeg` pins the refusal of JPEG.
- **Web output** has no image work for an img: the page's own `src` is what Chrome loads. Only background `url()`s get `webUrls`.
- **Markless's hosts today** (Markless e63329eb8) never draw a Dragon image write, and show `<img>` only on unstyled pages:
  - iOS ViewTree.swift:1089-1098 and 1423: a UIImageView with `.scaleAspectFit`, loading only `file:` URLs;
  - Android Camera.kt SizedImage: an ImageView with `FIT_CENTER`, `file:` URLs only;
  - neither honours object-fit or object-position, and I found no `data:` image path in either host.

## Slice REPL-r1: an img whose src is set at run time, accepted when its box never reads the natural size

### 1. Input: saying the src is set at run time

- A tree element gains `runtimeSrc: { absent: boolean }`. In the Markless style input it is an element node field of the same name.
  - It marks an `<img>` whose `src` the app sets while it runs. `absent: true` means the src can also be missing, as with checkin's `entry.photo === '' ? undefined : entry.photo`.
  - It is valid only on `img`, and never together with a static or per-assignment `src`. Anything else is DRAGON_CONFIG_INVALID, or a Markless input error.
- compileImages skips a `runtimeSrc` img: no bytes, no natural size, no digest entry, and no use of the `images` option. A static `src` keeps today's path unchanged.
- **Markless follow-up:** style-input.ts writes `runtimeSrc` for a bound `src` on `<img>`. It sets `absent` from whether the compiled expression can give `undefined` or `null`.

### 2. Layout: a natural size the engine may not read

- NaturalSizeValue gains `{ kind: 'runtime' }`. naturalSizingOf gives the engine a NaturalSizing whose `width`, `height` and `ratio` are read through one accessor that throws `RuntimeNaturalRead(nodeId, site)`.
  - The project catches it and refuses the img by name: `DRAGON_RUNTIME_IMAGE_SIZE`, a new code (Q4), with the message `<img> X has a src set at run time, and its used size reads the image's natural size: <site>`.
  - Each site names its fix. Examples: "its height is auto, so it follows the image's ratio: give it a height or a CSS aspect-ratio"; "it is a flex item whose automatic minimum width is its content size: set min-width"; "its max-content contribution follows the ratio of `auto 400 / 300`: give it a CSS aspect-ratio"; "a float's shrink-to-fit width reads it".
- **The reads become lazy, matching Blink's order:**
  - replacedSize computes normalizedNaturalSize only where Blink's ComputeReplacedSizeInternal uses it;
  - replacedContribution returns its compressible minimum before it sizes the box;
  - replacedAspectRatio returns a plain `<ratio>` before it looks at the natural ratio.

  These are refactors with no change in output. The whole existing replaced corpus must stay at 0 LU difference.
- **Proof scope:** the throwing natural is laid out in every case, assignment, band, interaction state and export viewport Dragon already lays out, in block, inline, flex and grid. A layout that completes without the throw is independent of the natural size, because the natural size is no other input of the engine.
- **On the device:** the translated engine keeps the throwing natural in runMarklessLayout and runMarklessRowsLayout. A viewport the build never laid out (an iPad width, a rotated phone) that reaches a read stops with the reason, as a slot value does today. It never draws a guessed size (Q3).
- **Accepted shapes, by what Chrome and the engine do:**
  - both width and height definite;
  - one size definite plus a plain CSS `aspect-ratio` (no `auto`);
  - `width="w" height="h"` attributes where CSS overrides only one of the two hints (the other hint stays definite);
  - a percentage width whose min-content contribution is compressible, inside a container that never reads its max-content contribution through a natural ratio;
  - a flex item with a non-`auto` min size on its main axis.
- **Refused by the read:**
  - auto height with `width: 100%` (checkin's detail photo);
  - an `auto && <ratio>` ratio on a path that reads the ratio (shop's product photo, through its grid track's max-content contribution);
  - a flex item with `min-width: auto` or `min-height: auto` on the main axis;
  - shrink-to-fit containers (floats, inline-block, abspos with auto width) whose width reads the img's max-content size;
  - an unsized img.

### 3. The states Chrome has, and which ones Dragon claims

- **Claimed:** every state in which Chrome keeps the img as primary content: loaded (any natural size, any ratio, or none), loading, an old image showing while a new src loads, and, when `absent`, inserted with no src. They share one layout, the one Dragon proves.
- **Refused:** `absent: true` with a non-empty or per-assignment `alt`, or a `title` and no `alt`. Chrome then shows the alt text as fallback content, which changes the box (DRAGON_RUNTIME_IMAGE_SIZE, "a missing src shows its alt text").
- **Not claimed, named divergence (Q1):** a load error, `src=""`, and a src removed after it was set. Chrome re-attaches the img as fallback content: ProductCard measures 400x300 instead of 179x300, and the products/[id] photo shows its alt text. The host keeps the laid-out box and paints as for a missing src.
- **Refused selectors:** a selector that reads `src` (`img[src]`, `:not([src])`) and matches a `runtimeSrc` img, because whether it matches depends on data. Dragon's UA rows for img (UA key `img[src]`) apply unchanged: html.css has no `img` rule keyed on `src`.

### 4. Paint and what Dragon hands the host

- **Web:** no change. The app's own `src` loads, and Chrome sizes the box exactly as Dragon proved, for any image.
- **Native:** a new write `runtime-image` (`dragonRuntimeImage` on both platforms). It replaces `replaced-image` for a `runtimeSrc` img and holds:
  - `fit` (object-fit) and `position` (object-position x and y as px or percent), as ReplacedLeaf has them;
  - `pixelated` and `layer`, as `replaced-image` has them;
  - `absent`: the no-image outline, `{ color: [192, 192, 192, 255], width: 1 }` (1 device px at the snapped content box), present only when the input says the src may be missing;
  - the content box in absolute LU, per assignment, from the engine. On a plan or rows layout it comes from the device's own layout of the row.
- **What the device does with it** (Dragon's generated runtime and the lanes' test host):
  - It exposes `setRuntimeImage(nodeId, image | nil)`. On a new decoded image it sets the leaf's natural size for paint only (the pixel size; a plain src has density 1). It then calls the translated replacedPaint and draws as `dragonImage` does: into the destination rect, clipped to the drawn part of the content box and to a rounded padding edge.
  - It does not relay out. The layout is the proven one.
  - `nil` with `absent` draws the outline.
  - A new src keeps the old bitmap until its replacement is set.
- **Placeholder colour: none.** While a src loads, Chrome paints only the box's own CSS background and border, such as the thumb's `var(--line)`. That is the placeholder, and it is already in the writes (Q5).
- **Format:** the host decodes into 8-bit sRGB. Pixel parity is claimed only for the formats T045 R3 proves (8-bit sRGB PNG). Any other format the host can decode is drawn with layout parity and no pixel claim (Q2). The host applies EXIF orientation before taking the natural size, as Chrome's default `image-orientation: from-image` does. Camera JPEGs need this.

### 5. Prerequisite: replaced grid items

- All three grid-placed Markless images need the engine to lay out a replaced grid item, which grid.ts refuses today for any src.
- That is a slice of its own, GRID-replaced. It ports CalculateIntrinsicMinimumContribution's replaced path and the compressible min-content contribution, and proves them against Chrome with static images first.
- REPL-r1's grid fixtures land after it. REPL-r1's block, inline and flex parts do not wait (Q6).

## Refused, by name

- **DRAGON_RUNTIME_IMAGE_SIZE** (or DRAGON_UNSUPPORTED_IMAGE, Q4):
  - every natural-size read (§2), with its site;
  - a missing src with alt text (§3);
  - a selector that reads `src` on a `runtimeSrc` img.
- **Existing refusals that stay:**
  - `srcset`, `sizes`, `loading` and `decoding` (attributes.ts handles only `src`, `alt`, `width` and `height` on img);
  - zoom other than 1 (lowerReplaced);
  - a static img with no src and no `runtimeSrc`. `reject-replaced-no-src` keeps its refusal; Q7 asks whether it should become the `absent` state.

## Parity fixtures (chrome-dual plus linux-dragon-layout)

- **The runtime harness feature:** a fixture marks the img with `data-dragon-runtime-src` (`absent` optional).
  - Dragon lays it out once.
  - Chrome renders it once per sample: PNGs of 400x300, 4000x100, 100x4000, 1x1 and 3x7; an SVG with only `viewBox="0 0 4 3"`; an SVG with no size and no viewBox; pending (a route that never answers); and, when `absent`, no src.
  - Every sample's boxes must equal Dragon's single layout under the existing gates, at DPR 1, 2, 2.625 and 3, with fractional widths (60%, odd px).
  - The paint lane computes the destination rect per sample through replacedPaint with that sample's natural size, against Chrome's REPL-0 quadrant probe, as `replaced-fit` does.
- **`replaced-runtime-sized`:**
  - a block img with px width and height, with and without border, padding and `box-sizing: border-box`;
  - an inline img in a line of text;
  - `width: 100px` with `width="400" height="300"` (the height hint stays: 100x300).
- **`replaced-runtime-ratio`:** `width: 100px; aspect-ratio: 2`, and `height: 80px; aspect-ratio: 3 / 2`.
- **`replaced-runtime-fit`:** object-fit `cover`, `contain`, `none`, `scale-down` and `fill`, with object-position `0 0`, `100% 100%`, `30% 70%` and `7px 3px`, over the samples, plus a rounded img.
- **`replaced-runtime-flex`:**
  - accepted: a 150px row with the img at `200px x 100px; min-width: 0` (measured 133.11x100 for every sample), and a column flex with `min-height: 0`;
  - refused: `reject-runtime-src-flex-auto-min`, the same row without `min-width` (measured 133.33, 200 and 133.11).
- **`replaced-runtime-grid`** (after GRID-replaced):
  - the thumb shape: a 64px track, a 64x64 img, `absent`;
  - the card shape: a grid in a `repeat(2, 1fr)` grid, `width: 100%`, `height` from the attribute, a CSS `aspect-ratio`;
  - `1fr 1fr` with `width: 100%; height: 50px`.
- **`replaced-runtime-absent`:** no src with `alt=""`, a CSS background and a border. The outline is 1 device px at the snapped content box at every DPR (measured at 1, 2, 2.625 and 3).
- **`tree-replaced-runtime-src-change`:** a state that swaps the src between two samples of different natural sizes. The frames are unchanged, and the native lanes check that the old bitmap stays until the new one is set.
- **Refusal fixtures:**
  - `reject-runtime-src-auto-height`: checkin's detail photo shape;
  - `reject-runtime-src-auto-ratio`: shop's product photo shape;
  - `reject-runtime-src-shrink-to-fit`: a float (measured 66.7 to 374);
  - `reject-runtime-src-absent-alt`;
  - `reject-runtime-src-selector`.
- **Planted faults** (faults/repl-r.ts):
  - `runtimeNaturalUnchecked`: the accessor returns 300x150 instead of throwing. Every reject fixture must then compile, and the flex and float samples must fail against Chrome;
  - `runtimeDestStatic`: the device draws with a 1x1 natural size. The fit fixture must fail;
  - `runtimeAbsentOutlineDropped`: the absent fixture must fail;
  - `runtimeSrcSwapClears`: the old bitmap is cleared on a new src. The src-change fixture must fail on native.
- **Device lanes:** the lanes' test host hands each sample's bytes to `setRuntimeImage` at run time, rather than embedding them, so decoding, replacedPaint and drawing run on the device path.

## Markless's need, measured against REPL-r1

- **ProductCard (shop `/`, `/categories/[slug]`): covered, once GRID-replaced lands.** Its width is a compressible percentage, its height is the attribute's 300px, and its ratio is a plain CSS ratio. No read.
- **The checkin thumb (`/`): covered, once GRID-replaced lands.** It is 64 by 64 in a 64px track, with `absent: true` and `alt=""`, and gets the outline when the photo is empty.
- **The products/[id] photo: refused.** Its grid track's max-content contribution reads the natural ratio of `auto 400 / 300`, although Chrome's result does not change (the track stretches). Adding `.photo { aspect-ratio: 4 / 3 }` changes nothing on the web, because both sizes are already definite, and makes it accepted. A later slice could prove that a read reaching only a stretched track's growth limit cannot change the layout (Q8).
- **The checkins/[id] photo: refused, correctly.** Its height follows the image (measured 280.5, 9.34, 320 and 0). A CSS `aspect-ratio` with its `object-fit: cover` would make it accepted. new.tsrx's `.shot` has the same shape.
- **The Markless host** (follow-ups, not in this PR):
  - emit `runtimeSrc` (§1);
  - load `file:`, `data:` and the app's own asset paths asynchronously;
  - decode into sRGB with EXIF orientation;
  - call `setRuntimeImage`, or draw from the translated replacedPaint itself, with the export's content box;
  - replace `.scaleAspectFit` and `FIT_CENTER` with that rect, since neither honours object-fit or object-position;
  - keep the old bitmap while a new src loads.
- **SVG:** shop's images are SVG, which UIKit and Android Views do not decode. Markless must rasterize them, or the app must ship PNG. Layout parity holds either way. Pixel parity does not (Q2).

## Open questions for the Judge

1. **Load errors and a removed src:** Chrome re-attaches the img as fallback content, and ProductCard's box changes from 179x300 to 400x300.
   - Proposed: a named divergence. The host keeps the laid-out box and paints the no-image outline.
   - Or: refuse any `runtimeSrc` img whose fallback layout differs from its image layout. That refuses ProductCard.
2. **Formats on native:** claim pixels only for 8-bit sRGB PNG and draw other decodable formats (JPEG, SVG rasterized by the host) with layout parity only (proposed)? Or refuse them at run time, so the host draws nothing?
3. **Viewports the build never laid out:** the device engine keeps the throwing natural size, so a read at an unproven width stops on the phone (proposed). Should the build also sweep each band's edge widths, so the stop can only happen inside a band?
4. **Diagnostic code:** a new `DRAGON_RUNTIME_IMAGE_SIZE` (proposed, because the fix is CSS, not the image), or DRAGON_UNSUPPORTED_IMAGE?
5. **Placeholder:** no placeholder colour, as in Chrome (proposed), or let the app ask for one?
6. **Order:** GRID-replaced first, then REPL-r1 with every fixture (proposed)? Or REPL-r1's block, inline and flex parts now, with the grid fixtures after? On its own, REPL-r1 unblocks none of the Markless images, because all three accepted shapes are grid items.
7. **A static img with no src:** should `<img alt="">` with no src and no `runtimeSrc` compile as the `absent` state, retargeting `reject-replaced-no-src` (still refused: it is unsized, so it reads the natural size)? Or keep it refused until an app needs it?
8. **Reads that cannot change the result:** the products/[id] photo reads the natural ratio only into an `auto` track's growth limit, which stretch overrides. Should a later slice prove such reads harmless (for example by laying out with the ratio at both extremes and requiring a monotone path)? Or should the refusal stand, with the CSS fix named in the message?

## Judge verdict (2026-11-22)

Approved, with the rulings and amendments below. Where they differ from the sections above, they win.

### Rulings

1. **Load error, `src=""` and a removed src (Q1): a named divergence, not a refusal.** The host keeps the laid-out box and
   paints the no-image outline. The build emits a note per img naming the box Chrome would draw instead: 400x300 for
   ProductCard, the alt text for the product photo. A checkin row whose photo goes from set to empty falls under this note.
2. **Formats (Q2):** pixels are claimed only for 8-bit sRGB PNG. Other decodable formats get layout parity with no pixel
   claim. An image the host cannot decode paints the outline.
3. **Viewports the build never laid out (Q3):** keep the device stop, and also sweep each band's minimum and maximum width at
   build time, using the largest export viewport for a band with no maximum.
4. **Diagnostic (Q4):** a new `DRAGON_RUNTIME_IMAGE_SIZE`, raised through the engine's existing `unsupported()` channel with a
   new code, `runtime-image-size` (unsupported.ts). No new exception class, so the Swift and Kotlin translations and the
   device stop path are reused.
5. **Placeholder (Q5):** no placeholder colour.
6. **Order (Q6):** REPL-r1 is one PR with every fixture, grid included, on top of GRID-items (#638), which is the replaced
   grid item slice §5 calls GRID-replaced.
7. **A static img with no src (Q7):** stays refused (`reject-replaced-no-src`).
8. **Reads that cannot change the result (Q8):** keep the refusal, and name the CSS fix in the message. For the products/[id]
   photo that is `.photo { aspect-ratio: 4 / 3 }`, which changes nothing on the web because both sizes are definite.

### Amendments

- **§5:** Blink has no replaced path in CalculateIntrinsicMinimumContribution. The two replaced differences are
  AxisEdgeFromItemPosition's `is_replaced` fit-content behaviour (normal alignment is fit-content, not stretch) and
  ComputeMinAndMaxContentContributionForReplaced's `depends_on_block_constraints`.
- **§2, refactors:** replacedAspectRatio already returns a plain `<ratio>` first (replaced.ts:51-57). The only real
  refactors are normalizedNaturalSize, computed eagerly at replaced.ts:112, and the size computed before
  replacedContribution's compressible return. Both must keep every existing output identical, at 0 LU.
- **§2, paint at build time:** the paint path (objectFitRect, replacedObjectRect) is never evaluated with the throwing natural
  size at build time. The destination rect of a `runtimeSrc` img is computed only on the device, or per sample in the lanes'
  test host.
- **§2, the read channel:** sizing reads raise `unsupported()` with code `runtime-image-size`, which the project maps to
  `DRAGON_RUNTIME_IMAGE_SIZE`.
- **Proof scope:** adds Q3's band-edge sweep. The device's rows layout (runMarklessRowsLayout) keeps the stop, and the stop
  reason names the row.
- **The Q1 note:** added as ruled, including the checkin row whose photo goes from set to empty.
