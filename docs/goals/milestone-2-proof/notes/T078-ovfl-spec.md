# T078 OVFL: scroll containers, binding worker spec (Judge, 2026-10-03)

This supersedes notes/T046-paint-spec.md §5.8 and the T078J amendment (notes/T078-ovfl.md) wherever they differ. It keeps
everything in them that is not changed here. It also says how T145 (OVFL-c), T080 (OVFL-S) and T079 (POSX-f) relate to T078.
Read-only review: nothing in the repo was changed. Scratch work and probes are in /tmp/t078spec.

**Read:**
- AGENTS.md;
- goal.md for milestone 1 (design principles) and for milestone-2-proof (Decision Rule, Throughput, landing queue, trains);
- docs/research/coverage-roadmap.md: the OVFL row, §4 and §6.3;
- docs/decisions.md: "Selectors and scrollbars", "Paint (T046)", "Adding engine fields", "Porting Chrome's algorithms", "What is platform-dependent", decision 9;
- docs/ports.md and docs/ports.json; notes/T118J-lgpl-ruling.md;
- state.yaml cards T058, T063/T134, T070, T072, T078, T079, T080, T145, and PM-2026-10-01.md (trains, review/** bases, PNT1 split);
- notes T044, T045, T046 (§0-§5, C1-C14) and T070;
- docs/api.md §483 (web output against target previews);
- the music player's styles.css and north-star-check.json on master 0d04dc09a;
- branch ovfl-a in full (/tmp/dragon-ovfl), master's EMS seams (`lower|emit|analysis/paint-values|paint-samples/scroll.ts`, `dragonMakeContainer`), pnt1-stacking-v3 `lower/paint/stacking.ts`, seld-r1 `rt-hit.ts`, and Playwright 1.58.2's chromium launcher.

## 0. What ovfl-a already did, and what is reused

ovfl-a (/tmp/dragon-ovfl, head a2cf2d768) sits on **b0c8fd13e**, a commit of the abandoned `inl1a-compiler` stack. Its history runs
through inl1a-engine-corpus. It has three commits:

| Commit | Content | Reviewed size | Verdict |
|---|---|---|---|
| f7c4b432d | Engine and translator. `Overflow` gains `clip`, `auto` and `scroll`, with the §3.1 computed-pair validator. `isScrollContainer` covers hidden, auto and scroll. New `overflow.ts` (509 lines) ports Blink's ScrollableOverflowCalculator: in-flow bounds with end padding, the scroll-origin adjustment, rtl, nested containers, abspos by containing block, and the viewport with the root's margins. Plants `gutterReserved` and `overflowIgnoresPadding`. Translator roots `scrollMetrics` and `scrollMetricsWithFaults`, plus the `engine-overflow` suite appended to corpus-dpr.ts. `layout()` output is byte-identical. | 57 KB | **Reuse as is**, apart from the two citation fixes in R12. |
| 4ad3c8f45 | Compiler and proof. `checkOverflow` refuses only single-axis clip (OVFL-c). The html/body refusals are removed. `viewportOverflow()` in ios-layout.ts (design A) and the compiler fault `propagationFromBody`. native-program clips when both axes are non-visible and throws `ProgramError` for one. 11 fixtures; 3 rejects become positives and 1 is retargeted. `scroll-metrics.ts` and `parity:scroll-capture` with expected-scroll at DPR 1, 2, 3 and 2.625. Tests ovfl-metrics, overflow and layout overflow. Pin retargets. | 75 KB | **Reuse.** Add the capture precondition (R2) and the citation fix (R12). |
| a2cf2d768 | Regenerated outputs. 18 scroll cases equal Chrome at 4 DPRs, all three plants are caught, and Swift and Kotlin engine-overflow pass 3000/3000. | n/a | **Drop.** Regenerate on the new base. |

I reviewed the code for soundness. overflow.ts follows `scrollable_overflow_calculator.cc` and `box_fragment_builder.cc` 241-366
correctly. It refuses rather than guesses on three shapes: a percentage relative offset, a percentage height with collapsing end
margins, and a percentage relative offset on the root. It reads `placeLines`, whose `PlacedLine` shape is unchanged on
inl1a-lowering (`pieces`, `boxRects` and `breakRects` are at the same lines). Design A for viewport propagation is sound:
- html is taken when it is non-visible, else the first body child;
- the source element uses visible;
- the viewport's visible becomes auto and its clip becomes hidden;
- the direction comes from body (css-writing-modes-3 §8).

**Three defects to fix on reuse:**
1. **Unregistered citations.** ovfl-a predates PORT-0, so its Chrome citations are not in docs/ports.json. On master,
   chrome-ports.test.ts fails until they are added. Three of the five cited files have an LGPL header. See R12.
2. **The scroll capture does not check its own environment.** See R2.
3. **Phase B is not started.** EMS's scroll seams are empty stubs on master.

**Rebase dry run.** I replayed f7c4b432d and 4ad3c8f45 onto inl1a-lowering with `git merge-tree`. It gives 9 conflicting files, all
append or pin conflicts:
- `.macroscope/ignore.md`, `faults.ts`, `fixtures.ts`, `harness.ts`, `pixel-reference.test.ts`, and the two `native-dpr-*.test.ts` suite lists;
- plus `ios-layout.ts` and `native-program.ts`, which need a careful hand resolution.

Onto master the replay gives 12 conflicting files. The extra ones are `block.ts`, `validate.ts` and `targets.ts`, because master lacks INL1a.

## 1. Scope

### Supported (Phase A engine and compiler, Phase B native; they land together, R14)

- **`overflow`, `overflow-x`, `overflow-y`:** `visible`, `hidden`, `clip`, `auto` and `scroll`, with css-overflow-3 §3.1 computed
  pairs (visible beside a scrolling value computes to auto; clip beside one computes to hidden).
- **Which boxes are scroll containers:** `hidden`, `auto` and `scroll` make a box a scroll container. It establishes a BFC and loses
  the flex automatic minimum size. `clip` on both axes clips at the padding box without becoming a scroll container. Margins still
  collapse through it, and a flex item keeps its automatic minimum size.
- **Scrollable overflow** (§2.2, Blink's calculator): the children's border boxes and their own overflow, the line boxes and
  inline fragments, in-flow bounds plus end padding, abspos by containing block, and no overflow before the scroll origin.
- **Scroll metrics:** `scrollWidth`, `scrollHeight`, `clientWidth` and `clientHeight`, plus the maximum scroll offset (R7). There
  is no gutter (R1).
- **Viewport propagation** (§3.3) from html, or from body when html is visible on both axes. The viewport scroll container sits at
  the root of every native screen (milestone-1 principle 6).
- **Natively:**
  - scroll containers become native scroll views sized by the engine;
  - the scroll offset is set and read back;
  - the background stays put while content scrolls (`background-attachment: scroll`; `local` is BG2's refusal);
  - the offset clamps after a relayout;
  - Dragon's hit test applies scroll offsets.

### Refused (each has a reject fixture)

| Input | Code | Message (shape) | Package |
|---|---|---|---|
| `clip` on one axis beside `visible` | `DRAGON_UNSUPPORTED_VALUE` (computed-value basis) | `overflow-x: clip beside overflow-y: visible on <addr> clips one axis only, which needs OVFL-c (css-overflow-3 §3.1)` (ovfl-a text, kept) | T145 OVFL-c |
| `scrollbar-gutter` (any value) | `DRAGON_UNSUPPORTED_PROPERTY` (existing "not supported" path; no new row) | unchanged | OVFL-G (new card, queued; facts in R1) |
| `overflow-clip-margin`, `scroll-behavior`, `overscroll-behavior*`, `scroll-snap-*`, `scroll-padding*`, `scroll-margin*`, `overflow-anchor`, `overflow-inline/block` | `DRAGON_UNSUPPORTED_PROPERTY` (unchanged) | unchanged | existing queue (snap and overscroll per T046 §8) |
| `scrollbar-color`, `scrollbar-width`, `::-webkit-scrollbar*` | unchanged in T078 | unchanged | T080a OVFL-S0 (§8) |
| Any overflow on an element whose layout input is refused elsewhere | unchanged | unchanged | n/a |

The overflow.ts port has three internal refusals: a percentage relative offset inside a scroll container, a percentage height
with collapsing end margins, and a percentage relative offset on the root. They surface as `LoweringError`
`DRAGON_UNPROVEN_CONTEXT`, naming OVFL-p, with fixtures (§4). They must never be silent.

## 2. Rulings

**R1. No scrollbar gutter on any target: the overlay model.** This is the platform rule the roadmap asked for (§6.3).
- **The rule.** The engine reserves 0 at the inline end and block end of every scroll container and of the viewport.
- **Evidence:**
  - **iOS:** `UIScrollView` indicators overlay the content and take no layout space.
  - **Android:** `View` scrollbars default to `SCROLLBARS_INSIDE_OVERLAY`, which takes no padding.
  - **Chrome's reference environment is overlay, measured on this machine.** I used Chrome for Testing 145.0.7632.6 in headless=new without `--hide-scrollbars`. A 100x100 box with `overflow: scroll` or `auto` and 300x300 content has `clientWidth` 100.
  - **Classic scrollbars, measured with `-AppleShowScrollBars Always`** (launched directly and connected over CDP; probe2.mjs):

    | Case | Measured |
    |---|---|
    | `scroll`, `auto` that overflows | 15 px gutter (clientWidth 85) |
    | `scrollbar-width: thin` | 11 px |
    | `scrollbar-width: none` | 0 |
    | `scrollbar-gutter: stable` | 15 px even when nothing overflows |
    | `stable both-edges` | 30 px |
    | viewport of 400 px | clientWidth 385 |

- **No new engine field.** The rule needs none: gutter 0 is the only value. The plant `gutterReserved` (15 px) proves the metrics test sees a gutter.
- **The PM records it** in decisions.md, under "What is platform-dependent", as the overlay-scrollbar rule.

**R2. The capture environment is pinned and checked.** T070 couldn't find why headless Chrome showed no scrollbars without the flag.
The reason is that Playwright 1.58.2 adds `--hide-scrollbars` itself whenever it runs headless (playwright-core
`lib/server/chromium/chromium.js:283-289`). So every lane is hide-scrollbars, whatever CHROME_ARGS says.

Under `--hide-scrollbars`, overflowing `scroll` and `auto` boxes measure 100 in both environments. One case still differs:
`scrollbar-gutter: stable` measures **85 under Always plus hide** and **100 under overlay plus hide**. This corrects T070's note,
which says stable reserves nothing under the flag. T070 measured only the overlay environment.

So the reference environment depends on the capture machine's scrollbar preference. With the default "Automatic" setting and a
mouse attached, macOS is classic.

**Ruling:**
- `scroll-metrics.ts` gains `assertOverlayScrollbars(page)`. On the page it captures, before any capture, it sets a probe `<div style="overflow:auto;scrollbar-gutter:stable;width:100px;height:100px">` and requires `clientWidth === 100`. Otherwise it throws `capture environment has classic scrollbars (System Settings > Appearance > Show scroll bars, or a mouse attached); the reference is overlay (decisions.md, overlay-scrollbar rule)`.
- The scroll capture records `"scrollbars": "overlay"` in each expected-scroll file. `readScroll` refuses any other value.
- The probe is in a file the package owns. chrome.ts is not edited.
- A unit test feeds the check a fake `clientWidth` of 85 and expects the throw.

**R3. Web output in classic-scrollbar environments.** The actual web output targets the configured web environment, and target
previews are separate projections (docs/api.md §483).
- **The web support claim is made for the reference (overlay) environment only**, the way the darwin-arm64 font rules are claimed only there. The web rows for `auto` and `scroll` are proven in that environment (R1 and R2).
- **Dragon does not add `scrollbar-width: none` to actual web output.** That would remove the only scroll affordance a mouse user can drag on Windows, Linux and classic macOS. In a classic environment, the gutter that Chrome reserves is the browser's correct behaviour for the emitted CSS.
- **The native-target web preview** (the future development-preview projection, api.md §123/§483) **must** add `scrollbar-width: none` to every scroll container and to the root. Then the preview shows the phone's boxes on classic desktops. The preview package owns this requirement, not T078; the PM adds it to that card.
- **`explain` and the web overflow rows carry the environment note** through the existing proof `context`. No new status is added.

**R4. Viewport propagation is resolved in the compiler (T078J design A, kept).** The engine never sees tags and gets no new input
field. `viewportOverflow()` is exported for Phase B. The plant `propagationFromBody` is caught by viewport-prop-demo, where body
must stay a scroll container.

**R5. `clip`** is not a scroll container and draws a padding-box clip at `overflow-clip-margin: 0`, the initial value; any other
margin is refused. Single-axis clip is refused for T145 (R14, §8). Rationale: native-program's `padding-box-clip` is one rect, and a
single-axis clip needs an unbounded rect on the other axis. That is T145's job.

**R6. Scrollable overflow and metrics must equal Chrome exactly.** After Chrome's integer conversion, `scrollWidth`, `scrollHeight`,
`clientWidth` and `clientHeight` must be identical to the engine's at DPR 1, 2, 3 and 2.625. This is ovfl-a's ovfl-metrics test,
kept. There is no tolerance.

**R7. The maximum scroll offset is a difference of snapped sizes in device px.** Measured with probe3.mjs, `--hide-scrollbars`, a
100.3 px auto box and 250.7 px content, after `scrollTo(10000, 10000)`:

| DPR | scrollTop | Device px | snap(content) − snap(client) |
|---|---|---|---|
| 1 | 151 | 151 | 251 − 100 |
| 2 | 150 | 300 | 501 − 201 |
| 2.625 | 150.476 | 395 | 658 − 263 |
| 3 | 150.333 | 451 | 752 − 301 |

So `maxScrollOffset(device px) = round(scrollRect size × dpr) − round(client size × dpr)`, per axis, at the container's
pixel-snapped origin. `overflow.ts` exports `maxScrollOffset` as a translated root.
- **Host check:** Chrome's `scrollTop` and `scrollLeft` after scrolling to the end, times the DPR, must equal it exactly on every scroll case at the four DPRs.
- **Device check:** the device's clamped offset readback must equal it exactly.
- **If a nonzero box origin breaks the closed form,** the worker finds the snapping origin from a measurement (`round(x+w) − round(x)`, the usual snap). If no closed form matches every case, that is a stop.

**R8. Right-to-left scroll origin (CSSOM View §4.1).**
- **Chrome:** an rtl container starts at `scrollLeft = 0` at its right edge and reaches `−(scrollWidth − clientWidth)` at the end. Measured: −200 for 300 px of content in 100 px.
- **The engine:** it gives `scrollRect.x < 0`.
- **Native:**
  - content views are placed at `x − scrollRect.x`;
  - the initial native offset is `−scrollRect.x`;
  - the CSS offset read back is `native offset + scrollRect.x`.
- **Proof:** the `-rtl` twins at rest and at the end.

**R9. Native scroll containers.**
- **One view per scroll container.** It is a scroll view whose frame is the box's padding box, inside the box view that draws the background, border and shadow. Content scrolls under the padding.
- **`hidden` on both axes stays the existing clip view.** Users cannot scroll it, and Dragon has no script scrolling API.
- **One axis `hidden`, the other `auto` or `scroll`:** a scroll view with the hidden axis locked. The demo's html, body and .App are this case.
- **`auto` and `scroll` act the same.** With overlay scrollbars they differ only in whether a gutter is reserved, and it is 0.
- **iOS:** `DragonScrollView: UIScrollView` with:
  - `contentInsetAdjustmentBehavior = .never` (safe areas come only through `env()`, V2a);
  - `automaticallyAdjustsScrollIndicatorInsets = false`;
  - `alwaysBounceHorizontal = alwaysBounceVertical = false`;
  - the indicator for a locked axis hidden;
  - otherwise UIKit's defaults (bounce, deceleration, indicators): native feel.
- **Android:** `DragonScrollView : DragonClipView`, a ViewGroup scrolled by `View.scrollTo`. `ScrollView` is vertical only, so it is not used. The view uses:
  - `OverScroller` for fling and `EdgeEffect` for overscroll (stretch on API 31);
  - `VelocityTracker`, plus `ViewConfiguration` for touch slop and fling speeds;
  - the platform's nested-scrolling API on `View` and `ViewGroup` (API 21+, no AndroidX), so an inner scroller consumes first;
  - overlay scrollbars that fade (`SCROLLBARS_INSIDE_OVERLAY`, with fading on).
- **No platform animators (RT-2).** Programmatic offsets are set without animation. The C14 grep stays empty.
- **The viewport.** On both platforms the host installs the viewport scroll view as the root of every case. It is not a DOM node, so existing dumps keep their nodes. It scrolls only on axes where the viewport's used overflow is `auto` or `scroll`, and its content size is the engine's viewport scrollRect.

**R10. Content size and offsets are runtime-callable writers (RT-1, RT-11).**
- **The writers.** `scroll` module writers set the content size, the axis locks and the offset. The after-layout hook re-applies the content size, then clamps the current offset to the new `maxScrollOffset`, which is what Chrome does.
- **Proof of the clamp:** a state case that shrinks the content at scroll end. It is captured from Chrome with SELD-R1's state runtime.
- **The emitted case code** applies the static values only through the same writers.
- **The applied readback** reports per scroll container, in device px: `contentSize`, `offset`, `axisLock`, plus `viewport` for the root.

**R11. Re-hosting across scroll containers (PNT1 facts).**
- **What PNT1 already does.** It never takes a layer item out of an overflow clip in its containing-block chain (stacking.ts header and `underClip`). So every box whose containing-block chain passes through a scroll container stays inside that container's scroll view and scrolls with it, with no extra writer.
- **Boxes that do not scroll.** An abspos box whose containing block is outside the scroller is not in the scroller's chain, so PNT1 hosts it outside. It must not scroll, and Chrome agrees.
- **Phase B checks both** at offsets with a fixture and a plant (§4).
- **The container factory.** EMS's `dragonMakeContainer()` takes no arguments today. Phase B changes it once, to `dragonMakeContainer(scroll: DragonScrollFacts?)` in Swift and `(ctx, scroll)` in Kotlin, so the factory can return a scroll view or a clip view. This is the only non-additive native-support.ts hunk allowed.

**R12. Port registry and the LGPL rule (T118J precedent).** Phase A cites five Chrome files at 145.0.7632.6:

| File | Header | Entry | Action |
|---|---|---|---|
| `core/layout/scrollable_overflow_calculator.cc` (and its `.h`) | BSD, Chromium | `port`, ranges cited | Add the entry. |
| `core/layout/box_fragment_builder.cc` 241-366 | BSD, Chromium | `port` | Add the entry. |
| `core/paint/paint_layer_scrollable_area.cc` 968-982 | **LGPL** (Apple/Netscape tri-licence) | `reference`, ruling class A | Basis: the css-overflow-3 §2.2 scrollport is part of scrollable overflow, plus Chrome observation. Proof: ovfl-metrics.test.ts. Re-cite overflow.ts `metricsOf` as "css-overflow-3 §2.2; matches Chrome (ports.json reference)", not "a port of". |
| `core/dom/element.cc` 2593-2935 | **LGPL** (KDE/Apple) | `reference`, class A | Basis: CSSOM View §4 plus Chrome observation (two rounding formulas). Proof: ovfl-metrics.test.ts#Blink integer conversions. Re-word the scroll-metrics.ts header the same way. |
| `core/layout/adjust_for_absolute_zoom.h` 44-57 | **LGPL** | `reference`, class A | as for element.cc |

These are class A, not B. Each LGPL use is a one-line formula (a unite with the client size; the half-up and +0.5/+0.01
conversions). Each is pinned by a Chrome measurement, the same class as T118J's computed_style.cc "one rounding formula". Run
`pnpm notices:gen` and commit THIRD_PARTY_NOTICES.md.

Phase B cites no new Chrome file unless it ports one. If it does, the same procedure applies, and an LGPL file is never ported.

**R13. Proof at rest, motion native** (decision 9 precedent, "Selectors and scrollbars"):
- Device lanes compare frames, applied values, pixels and hit grids at programmatic offsets: start, a middle offset, and end.
- Every offset is a whole number of device px. Chrome snaps offsets to device px (R7), Android `scrollTo` takes whole px, and iOS points times the scale are whole on scale 2 and 3.
- Fling, bounce, stretch and indicators are native and are not compared. The overflow rows' scrolling-motion aspect is covered by the existing caveat for the paint aspect (#49/T075J rule). No new status is added.

**R14. Phases land together.** This keeps T078J. If Phase A landed alone, the iOS and Android rows for `auto` and `scroll` would pass the
layout lane and draw like `hidden` at rest, while the device could not scroll: a claim with no test.
- **Phase A's PRs are opened early.** They go on `review/` bases (PM-2026-10-01) and run their review loops while Phase B is built.
- **All four PRs land as one train** after the PNT1 train.
- **POSX-f (T079) Phase A stacks on ovfl-a2** ("Reviews never block work").

**R15. Hidden stays hidden.** Existing `overflow: hidden` cases keep their device verdicts and failure lists. The scroll view is used
only where an axis is `auto` or `scroll`. The viewport root view is new for every case, but a case whose viewport doesn't scroll must
give byte-identical frames, applied values and pixels to BASE. The new readback keys appear only on the overflow, scroll and
viewport-prop fixture groups.

**R16. INL2 handshake.** overflow.ts `addLines` handles exactly the line items that exist at BASE: pieces, box rects and break rects.
- **Unknown kinds are refused.** If `PlacedLine` gains another item kind (INL2's atomic inlines), overflow.ts must throw `OverflowRefusal` and never skip it. A test pins this with a stub item.
- **INL2 takes on the work.** Whichever of OVFL and INL2 lands second adds that kind to `addLines` with a Chrome metrics case. The PM adds this constraint to the INL2 cards (T059 lane).

## 3. How each target gets it

The compiler resolves every platform difference. On-device code never parses CSS.

| | Web | iOS (UIKit, CoreAnimation) | Android (View, Canvas, minSdk 31) |
|---|---|---|---|
| Values | web-css.ts writes `overflow-x` and `overflow-y` as resolved; the browser does propagation and scrolling | The compiler resolves pairs and propagation (`viewportOverflow`); `LayoutStyle` gets the used values | same as iOS |
| Geometry | Chrome | the translated engine (`layout`, `scrollMetrics`, `maxScrollOffset`) in Swift | the same, in Kotlin |
| Container | CSS | `DragonScrollView: UIScrollView` at the padding box; `DragonClipView` for hidden | `DragonScrollView : DragonClipView` with OverScroller, EdgeEffect and nested scrolling; `DragonClipView` for hidden |
| Viewport | Chrome | the host's root `DragonScrollView` | the host's root `DragonScrollView` |
| Scrollbars | the browser's own (R3) | native indicators, overlaid, shown only while scrolling | native overlay scrollbars that fade |
| Offsets | `scrollTo` (capture only) | `contentOffset` through the writer, clamped | `scrollTo` through the writer, clamped |
| Hit test | `elementFromPoint` (oracle) | Dragon `rt-hit.ts` (translated) with offsets | same as iOS |

## 4. Proof

**Lanes, at every DPR** (host: 1, 2, 3 and 2.625; iOS: 2 and 3; Android: 2, 2.625 and 3):
1. **chrome-dual:** computed `overflow-x` and `overflow-y` strings on every new fixture.
2. **Layout:** Chrome boxes against the engine. This covers clip margin collapse and flex minimum size, the scroll-container BFC, and propagation.
3. **Scroll metrics:** the 4 metrics on every container and the viewport, exact (R6). `maxScrollOffset` against Chrome's end offset, exact (R7).
4. **Vectors:** layout-vectors and dpr-vectors; engine-overflow in Swift and Kotlin 3000/3000; translator roots for `scrollMetrics` and `maxScrollOffset`.
5. **Device lanes**, on both leases (Phase B). Each runs at offsets start, middle and end:
   - **layout-vectors-device;**
   - **device-frames:** DOM frames in layout coordinates, which don't depend on the offset;
   - **device-applied:** content size, offset, axis lock and viewport, against the engine;
   - **device-pixels:** against Chrome's PNG at the same offset. Points sit 2 device px clear of the scrollport edge, and the scrollport edges are checked by the edge rule;
   - **device-hit:** the SELD-R1b lane at the offsets, where the TS `rt-hit.ts` must equal `elementFromPoint` and the device must equal TS.

**Fixtures.**
- **Kept from ovfl-a (11):** `overflow-single-axis-hidden`, `overflow-scroll-basic`, `overflow-clip-margin-collapse`, `overflow-clip-flex-min-size`, `overflow-end-padding`, `overflow-nested`, `overflow-direction`, `viewport-prop-body-hidden`, `viewport-prop-html-x-hidden`, `viewport-prop-demo` and `viewport-prop-document`, plus the `both()` rtl twins. Also the reject `reject-overflow-single-axis`, retargeted to clip.
- **New in Phase A:**
  - `reject-overflow-percent-relative`, for the OVFL-p refusal;
  - `overflow-clip-both`, clip on both axes painting at the padding box;
  - `overflow-auto-fits`, where content fits and nothing scrolls;
  - `overflow-hidden-x-auto-y`, the demo's .App pattern without propagation.
- **New in Phase B** (each with start, middle and end offsets in device px, and an `-rtl` twin where marked):
  - `scroll-offsets-basic` (rtl);
  - `scroll-offsets-nested`, inner at end and outer at middle;
  - `scroll-offsets-viewport`, where the window scrolls;
  - `scroll-background-fixed`, where the background stays and the content moves;
  - `scroll-hosted-zindex`, a z-index relative child inside a scroller, re-hosted by PNT1, which must scroll;
  - `scroll-abspos-escape`, an abspos whose containing block is outside the scroller, which must not move;
  - `scroll-demo-library`, the .library list without `position: fixed`;
  - `scroll-state-shrink`, a state case where the content shrinks at the end and the offset clamps;
  - `scroll-axis-locked`, where x is hidden and y is auto, a horizontal scroll attempt is a no-op, and the readback shows the lock.

**Plants. Each must fail its lane, on both platforms where it is native.**

| Plant | Kind | Lane that must fail |
|---|---|---|
| `gutterReserved` | engine | ovfl-metrics |
| `overflowIgnoresPadding` | engine | ovfl-metrics |
| `propagationFromBody` | compiler | the layout lane on viewport-prop-demo |
| `content-size-short` (native content one device px short) | native | device-applied and the end-offset frames or pixels |
| `offset-ignored-in-hit` (`rt-hit.ts`) | TS and device | the hit report at offsets |
| `escapee-scrolls` (the abspos escapee hosted inside the scroll view) | native | device-pixels on `scroll-abspos-escape` |
| `rtl-origin-left` (native rtl initial offset 0) | native | device-pixels and applied on `scroll-offsets-basic-rtl` |
| `clamp-skipped` (the after-layout hook doesn't clamp) | native | `scroll-state-shrink` |

**Support-profile rows (C8: the declared rows only, no other status change):**
- **overflow-x and overflow-y:** auto, scroll and clip on web, iOS and Android, in the contexts the fixtures prove, root/ltr and root/rtl included.
- **hidden:** gains the root contexts.
- **Statuses:** layout rows follow #49/T075J (layout from the layout lane; paint capped at caveat; outputs ready only with every lane passing).

ovfl-a produced 26 new rows. The worker lists the exact rows in the receipt.

## 5. Base, dependencies and order

- **Phase A base: `inl1a-lowering` (C2) at afec4d619 or its head when the work starts. This is the top of INL1a train 3.**
  - Phase A edits `ios-layout.ts`, the translator harness and corpus-dpr, which C2 rewrites.
  - A base on master would conflict with INL1a and force a restack.
  - C2's commits reach master by merge in the train. So ovfl-a2 then catches up by merge, never by restack.
  - C2 is the earliest base that avoids a later restack.
- **Branch and worktree.** Create a new branch `ovfl-a2` from C2 in `/tmp/dragon-ovfl` (`git worktree move` or a new worktree; the PM creates it). Cherry-pick f7c4b432d and 4ad3c8f45, resolve the 9 conflicts, apply R2 and R12 and the new Phase A fixtures, then `pnpm regen`.
  - Keep ovfl-a unchanged as the record.
  - If INL1a's train changes C2, merge the new C2 into ovfl-a2.
- **Phase B starts after these are on master:**
  - train 1 with seld-r1 #75 (SELD-R1b: `rt-hit.ts`, device-hit, states);
  - train 4 (PNT2, which writes capture.ts first);
  - the PNT1 train (8 PRs: stacking facts and the hosting model R11 relies on).

  Phase B merges `origin/master` into ovfl-a2 once all are in. The queued landing order is train 1 → REPL-a → FORM-a → INL1a → PNT2 → PNT1, so OVFL lands in the train right after PNT1's. EMS (#62, ems-b-paint-seams) is already on master.
- **Not concurrent with, on the same files:**
  - **Phase A:** `input.ts`, `validate.ts`, `box.ts`, `block.ts` (the EngineFaults append), `harness.ts`, `corpus-dpr.ts`, `ios-layout.ts`, `computed-checks.ts`, `native-program.ts`, `faults.ts`. The text stack (TXT1a-*-v2, T133, TXT-W1/W2, TDEC-a, restacked onto C2) and INL2a/b touch some of these. All shared hunks are appends; whoever lands second regenerates and appends.
  - **Phase B:** `rt-hit.ts` (SELD-R2b T146 is a different hunk and goes in after), `capture.ts` (after PNT2), and `native-support.ts` (the factory hunk only; P6b and P6c are serial on it, and the PM orders them).
- **Device runs:** only under `/tmp/device-lease.sh` (both leases).
- **Heavy commands:** only under `/tmp/heavy-lease.sh`.

## 6. Worker package

ENV is the literal prefix `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`. BASE is the recorded base sha.

**allowed_files.**
- **Phase A** (the T078J list, plus R2 and R12):
  - `packages/layout/src/{input,validate,box,overflow}.ts`, and `block.ts` (EngineFaults append only);
  - `packages/layout/test/overflow.test.ts`;
  - `packages/translate/harness/harness.ts` (overflow literals, the FAULT_KEYS append, the suite dispatch);
  - `packages/translate/src/{corpus-dpr,generate}.ts` (append, roots);
  - `packages/translate/test/{corpus-dpr,native-dpr-swift,native-dpr-kotlin}.test.ts` (suite lists);
  - `packages/dragon/src/lower/ios-layout.ts` (overflow values and `viewportOverflow`);
  - `packages/dragon/src/lower/native-program.ts` (`clipsPaddingBox`);
  - `packages/dragon/src/analysis/computed-checks.ts` (`checkOverflow`);
  - `packages/dragon/src/faults.ts` (append);
  - `packages/dragon/test/{overflow,s4a,seams}.test.ts` (new tests and listed pins);
  - `packages/parity/src/{scroll-metrics.ts,cli/scroll-capture.ts}`, `packages/parity/src/fixture-groups/{overflow,milestone-1,contexts}.ts`, `packages/parity/src/fixtures.ts` (one import, one concatenation), `packages/parity/src/targets.ts` (the engine-overflow declaration);
  - `packages/parity/fixtures/{overflow,viewport-prop,reject-overflow}-*.html`;
  - `packages/parity/test/{ovfl-metrics,fixture-reader,pixel-reference}.test.ts` (new tests and listed pins);
  - `package.json` (one script line), `.macroscope/ignore.md` (the expected-scroll entry);
  - `docs/ports.json`, `THIRD_PARTY_NOTICES.md` (generated).
- **Phase B:**
  - `packages/dragon/src/{lower,emit}/paint/scroll.ts`, `packages/dragon/src/analysis/paint-values/scroll.ts`, `packages/parity/src/paint-samples/scroll.ts`;
  - `packages/dragon/src/emit/native-support.ts` (the `dragonMakeContainer` signature hunk only, R11);
  - `packages/layout/src/overflow.ts` (the `maxScrollOffset` export), and `packages/translate/src/generate.ts` (one root line);
  - `packages/layout/src/rt-hit.ts` (the scroll-offset and scrollport hunk), `packages/layout/rt-vectors/hit/**` (new files);
  - `packages/parity/src/hit-capture.ts` (the offset registration hunk);
  - RT-13 hunks in `packages/parity/src/{capture,native-host,native-dump,lanes}.ts` for the scroll-offset case kind;
  - `packages/parity/src/scroll-offsets.ts` (new: the case-kind registry and offsets in device px);
  - `packages/parity/src/fixture-groups/scroll.ts` (new), `packages/parity/fixtures/scroll-*.html`;
  - `packages/parity/test/ovfl-*.test.ts`, `packages/dragon/test/scroll-*.test.ts` (new);
  - derived-count pins (listed).
- **Both phases:**
  - new files only under `packages/parity/expected*/**`, `packages/layout/{vectors,break-vectors}/**` and `packages/parity/expected-hit/**`;
  - regenerated outputs (profiles, emitted, generated engines, corpus json, lanes.json, native-lanes.ts, wpt expectations, tw-sweep snapshot);
  - `examples/music-player/dragon/north-star-check.json` (regenerated).
- **Shared with other lanes:** `fixtures.ts`, `package.json`, `harness.ts`, `corpus-dpr.ts`, `faults.ts`, `.macroscope/ignore.md` and `docs/ports.json` are append-only here.

**verify** (T046 §5 C1-C14 with today's commands). Every heavy step runs under `/tmp/heavy-lease.sh`, and device steps run under `/tmp/device-lease.sh`.
- **C1** `ENV pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`:
  - green;
  - BASE's `vitest list` is a subset of HEAD's;
  - no `.skip`, `.only` or `.todo`;
  - modified tests are only the listed pins: s4a overflow refusals, seams ids and sha, fixture-reader REMOVED and RETARGETED, pixel-reference derived counts, and the native-dpr suite lists.
- **C2-C9** as T046 §5, with these specifics:
  - **C5:** vectors are new files only, plus the faults key migration from generators (the "Adding engine fields" rule), and results are byte-identical.
  - **C6:** existing captures are byte-identical, and emitted files differ only in headers.
  - **C8:** only the declared rows change.
  - **C9:** `native:encoders` is clean for Swift and Kotlin, with derived counts.
- **Scroll metrics:** `ENV pnpm run parity:scroll-capture` twice gives byte-identical output, with the R2 precondition passing. `pnpm vitest run packages/parity/test/ovfl-metrics.test.ts` shows all four metrics and `maxScrollOffset` exact at 1, 2, 3 and 2.625, and catches the three Phase A plants.
- **Ports:** `pnpm vitest run packages/parity/test/chrome-ports.test.ts` passes; `pnpm notices:gen && git diff --exit-code THIRD_PARTY_NOTICES.md` (after committing).
- **C10 and C11 (Phase B, both leases):** `/tmp/device-lease.sh pnpm run parity:devices`, then `pnpm run parity:lanes --require-all`.
  - No `not run` lane.
  - Every new case passes every lane at every offset on both platforms at every DPR.
  - Pre-existing cases keep BASE's verdicts and failure lists (R15).
  - The four native plants are caught on both platforms.
- **Hit:** `ENV pnpm run parity:hit-capture && pnpm run parity:hit-report` at offsets. TS equals Chrome at every grid point, the device equals TS, and `offset-ignored-in-hit` is caught.
- **C12** `pnpm run north-star:check`: every overflow diagnostic on all three targets is 0 (§9), and no per-target count rises.
- **C13** WPT web expectations: no pass becomes a fail.
- **C14** `git diff --name-only BASE..HEAD` is inside allowed_files; the RT-13 additive check passes on every RT-13 file; the no-animator grep over `packages/dragon/src/emit` prints nothing.

**stop_if:**
- the R2 precondition fails on the capture machine (report it; never capture classic);
- Chrome's metrics disagree with the engine and Blink 145 doesn't explain it;
- no closed form for the end offset matches every case (R7);
- an existing vector, capture, device verdict or failure list changes (except R15's new readback keys on scroll groups);
- a BASE failure unrelated to OVFL, such as the INL1a encoder regression: report it, don't fix it;
- a hosting case crosses a scroll container in a way PNT1's facts can't express (R11);
- a native-support.ts change beyond the factory hunk is needed;
- a non-additive RT-13 edit is needed;
- the INL2 handshake (R16) is hit before INL2 lands;
- an LGPL file would need a `port` use;
- a needed file is outside allowed_files;
- the lease is not held;
- verification fails twice.

## 7. PR split (each reviewed diff under about 150 KB; generated output is ignored by shape)

| PR | Branch | Content | Est. reviewed size | Base for review |
|---|---|---|---|---|
| A1 | ovfl-a2-engine | f7c4b432d replayed: engine, translator, layout tests, ports.json BSD and LGPL-reference entries, NOTICES | ~62 KB | review/inl1a-lowering |
| A2 | ovfl-a2 | 4ad3c8f45 replayed: compiler, scroll metrics with R2, fixtures, rejects, pins; plus regenerated outputs in their own commit | ~80 KB | review/ovfl-a2-engine |
| B1 | ovfl-b-native | scroll modules in lower, emit and paint-values; Swift and Kotlin DragonScrollView; the factory hunk; the viewport root; writers and readback; `maxScrollOffset`; the scroll-offset case kind (scroll-offsets.ts, RT-13 hunks); Phase B fixtures; the 4 native plants | ~130 KB (if over 150 KB, split the Kotlin scroll view into B1b) | review/ovfl-a2 |
| B2 | ovfl-b-hit | `rt-hit.ts` offsets and scrollport, hit vectors, hit capture at offsets, the hit plant | ~45 KB | review/ovfl-b-native |

All four land as one train after the PNT1 train (R14), one regen and one device run per position (AGENTS.md step 8). Regenerated
outputs stay in their own commits, which name the command that produced them.

## 8. How T145, T080 and T079 relate

- **T145 OVFL-c (single-axis clip). After T078; it may start once Phase A is host-done.** It replaces two guards:
  - T078's `DRAGON_UNSUPPORTED_VALUE` naming OVFL-c (computed-checks.ts);
  - native-program's `ProgramError`.

  In their place comes an axis clip write: the clip rect is the padding box on the clipped axis and unbounded on the other, from engine geometry (iOS: a `CAShapeLayer` mask or a container frame; Android: `clipRect` in `dispatchDraw`). Its proof is boxes, pixels and hit at rest; scrolling is not involved. It also shares overflow.ts `propagated()`, which already handles clip per axis. Size S, risk low. It is not on the checkpoint-3 path, because the demo has no clip.
- **T080 OVFL-S, as carded (Dragon-drawn, honoured `::-webkit-scrollbar`).** It stays off the checkpoint-3 path. Two findings change its card:
  - **A capture method exists.** `chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })` shows honoured custom scrollbars at DPR 1 and 3 (measured: a honoured `::-webkit-scrollbar{width:5px}` gives `clientWidth` 95). Overlay scrollbars stay 0.
  - **A honoured `::-webkit-scrollbar` takes layout space,** which the lane's hide flag hides. So it must be refused (OVFL-S2) wherever Chrome would honour it, and never silently dropped.
- **New T080a OVFL-S0: the demo's scrollbar CSS. It is on the checkpoint-3 path, after T078 Phase B. Size S-M.** T078 removes only the overflow diagnostics. The demo's other 5 errors need this:
  - `scrollbar-color` and `scrollbar-width` (auto, thin, none) as real longhands, proven with chrome-dual and the additive checker;
  - the Chrome ignore rule (computed_style.cc:2494-2512, class A reference already registered): a `::-webkit-scrollbar*` rule is dropped with a warning only when every element it can match has `scrollbar-width` or `scrollbar-color` not `auto` in every reachable state. Otherwise it is refused naming OVFL-S2;
  - the native side: no thumb at rest; while scrolling, the native indicators (thin is native default; `scrollbar-color` doesn't tint them, per the owner's native-feel ruling); `none` hides them, through T078's `scroll` writer (`showsVertical/HorizontalScrollIndicator` and `setVertical/HorizontalScrollBarEnabled`);
  - write scope: `css/properties/scrollbar.ts`, a `css/selectors.ts` hunk (pseudo-element acceptance; the single selectors.ts writer at that time), `lower|emit/paint/scrollbar.ts`, a new warning code `DRAGON_RULE_IGNORED` in catalogue.ts, fixtures `scrollbar-*`, and `reject-scrollbar-honoured`.
- **T079 POSX-f.** Its Phase A stacks on ovfl-a2 and uses overflow.ts. Fixed boxes leave ancestors' scrollable overflow; the T046 §5.9 note "fixed boxes excluded once POSX-f lands" moves into POSX-f. Its Phase B uses T078's offset writer and listener registry to counter-offset fixed boxes by the viewport offset.
- **ANIM-S** (scroll-driven animation) reads T078's offset at sampled offsets. It is after T065 and T078.

## 9. North-star delta (examples/music-player/dragon/north-star-check.json)

Master 0d04dc09a has 343 errors. 29 are overflow or scrollbar diagnostics: 8 overflow per target (web, iOS, Android), and 5
target-less scrollbar diagnostics.

| Package | Errors | Declarations | Other |
|---|---|---|---|
| **T078 (A+B)** | overflow 8/8/8 → **0/0/0** (−24) | lines 25 (`html, body` overflow-x), 64 (`.App` overflow-x) and 368 (`.library` overflow: auto) become supported on all three targets | ovfl-a measured −19 and 165 → 168 on its older base, where Android had no overflow rows. `position: fixed` on `.library` stays POSX-f's diagnostic. |
| **T080a OVFL-S0** | scrollbar 5 → **0** | — | The 3 `::-webkit-scrollbar*` rules become `DRAGON_RULE_IGNORED` warnings. |

The exact totals are derived by `north-star:check` at the merge position. The gate is: these diagnostics fall to 0, and no
per-target count rises.

## 10. Size and risk

- **Phase A: size S-M, risk low-med.** It is a replay of reviewed work: 9 conflicts and a regen, plus R2, R12 and 4 fixtures. The risk is append conflicts with the text stack on harness and corpus-dpr.
- **Phase B: size L, risk high.** The main risks:
  - a two-axis Android scroll view with nested scrolling, with no platform class to lean on;
  - a new case kind (offsets) across capture, host, dump and lanes;
  - the R15 guarantee that the root viewport view changes nothing on existing cases;
  - the interaction with PNT1's hosting (R11);
  - device pixels at fractional DPR 2.625 offsets.
- **Overall: L, high, about 1 session for A and 2-3 for B.** It sits on the checkpoint-3 critical path behind the PNT1 train.

## 11. Board updates for the PM

1. **T078:** base inl1a-lowering, branch ovfl-a2, this spec binding (replaces §5.8 and T078J where they differ), Phase A PRs opened early on review/ bases, and the train after PNT1.
2. **decisions.md** gets:
   - the overlay-scrollbar platform rule (R1, R2) with the measurements;
   - R3 (web support claimed for the overlay environment; the native-target preview hides scrollbars);
   - the T070 correction (Playwright adds `--hide-scrollbars`; `scrollbar-gutter: stable` reserves 15 px under classic even with the flag);
   - the R12 class A rulings.
3. **New cards:**
   - **T080a OVFL-S0,** on the checkpoint-3 path, after T078;
   - **OVFL-G** (`scrollbar-gutter`, classic web environments), queued;
   - **OVFL-p** (the three overflow.ts refusals), queued.

   **T080** gains the ignoreDefaultArgs capture method and the "honoured takes space, so refuse" fact.
4. **Constraints:**
   - **T079:** Phase A stacks on ovfl-a2.
   - **INL2 cards:** the R16 handshake.
   - **The preview package:** the R3 `scrollbar-width: none` requirement.

---

## Receipt

**Spec:** /tmp/specs/T078.md

**R-rulings:**
- R1: gutter 0 on every target (overlay model). Classic is measured at 15/11/0 px and is not claimed.
- R2: the scroll capture asserts an overlay environment (a `scrollbar-gutter: stable` probe must give 100) and records it. Playwright injects `--hide-scrollbars`.
- R3: web support is claimed for the overlay environment; actual web output keeps the browser's scrollbars; the native-target preview adds `scrollbar-width: none`.
- R4: viewport propagation is resolved in the compiler (design A), with no engine field.
- R5: `clip` is not a scroll container; it clips at the padding box with clip margin 0; single-axis clip is refused for OVFL-c.
- R6: the four scroll metrics equal Chrome exactly at 1, 2, 3 and 2.625.
- R7: the end offset is `round(scroll × dpr) − round(client × dpr)` device px (measured at 4 DPRs).
- R8: the rtl origin is at the right, with negative scrollLeft; native maps the offset by `scrollRect.x`.
- R9: one native scroll view at the padding box (a UIScrollView subclass; an OverScroller ViewGroup on Android); hidden stays a clip view; a hidden axis is locked.
- R10: content size and offset are runtime writers, re-applied and clamped after layout.
- R11: PNT1's under-clip hosting makes descendants scroll; escapees don't; one factory-signature hunk.
- R12: two BSD ports and three LGPL class A references (re-cite); NOTICES regenerated.
- R13: lanes compare at programmatic whole-device-px offsets; motion is native.
- R14: Phases A and B land in one train after PNT1; A is reviewed early.
- R15: hidden and non-scrolling cases stay byte-identical.
- R16: overflow.ts refuses unknown line items; whichever of OVFL and INL2 lands second adds atomic inlines.

**Owner-only questions:** none. Every item above is settled by measurement, source or precedent and goes to the PM for a ruling.
