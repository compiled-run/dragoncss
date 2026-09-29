# T045: REPL (replaced elements, iframe web-view slot) and FORM-a (Dragon-drawn button and range), Judge spec

Judge note, 2026-09-28. Read-only review. This note is the only file written.

**Read for this review:**
- goal.md (Decision Rule, Throughput Rules, checkpoint 3 scope) and state.yaml (T007, T009, T019, T034, T038, T043, T044, T046, T047);
- docs/research/coverage-roadmap.md: REPL, FORM, SIZE, INL2 and BG2 rows; §3 wave and merge order; §4 parallel-safety and hotspot owners; the north-star paragraph;
- notes/T010-north-star-plan.md, notes/T025 §4 (ELB-2 spec), notes/T017-elb2.md (userAgentForced, userAgentUnmodelled, systemColors), notes/T015-tree.md (attribute owners), notes/T014-ns-lane-ref.md (covers);
- docs/decisions.md on master 41cc750 (content of 71dbdf4): "Maximum support", "Text selection and editing", course correction 4, decision 13 (tolerance), decision 17 (states);
- milestone-2 notes/T015-p4-review-p5-plan.md §3 and §4 (the P5 lanes and pixel rules);
- examples/music-player: styles.css, snapshot.html, tools/cover-png.ts, tools/capture-chrome.ts, lane/manifest.json;
- packages/parity/src/chrome.ts (`openPage` uses `setContent`), compare.ts (`GATE_DEVICE_PX = 1`, `GATE_CHANNEL_DELTA = 0`);
- packages/layout/src/input.ts, which has no replaced or ratio concept today.

## 0. What the north star actually needs (measured from the demo)

| Demo use | Box context | Consequence |
|---|---|---|
| `.record-label img` (display:block, 100%x100%, object-fit: cover) | block-level, inside an abspos box | REPL at block level. Natural size is irrelevant to layout; object-fit uses the natural ratio for paint. |
| `.library-song img` (width 6.5rem, aspect-ratio 16/9, object-fit: contain) | **flex item** of `.library-song` (a display:flex button) | REPL for flex items. The height comes from `aspect-ratio`, not from the natural size. |
| `aspect-ratio` on `.mini-video-shell` (fixed), `.record` (flex item), `.record-label` and `.record-center` (abspos) | non-replaced boxes | SIZE-ar, which is independent of REPL. |
| YouTube iframe (inserted by script in place of `.youtube-player-target`; `display:block; width/height:100%; border:0`) | block-level | The FV slot. Its frame equals its host box. |
| `button` x10: `.library-button` (nav flex item), `.play-control button` (flex items), `.library-song` (flex column items, themselves display:flex), two sync buttons in a display:none parent | **all blockified** | FORM-a button boxes need no INL2. Their *contents* do: the text needs INL1/TXT1 and `.play-icon` is `inline-flex` (INL2). |
| `input[type=range]` (appearance none, background transparent, width 100%) | **inline-level child of `.track`**, a block container | The range box needs INL2 (an atomic inline in a line box). |
| `::-webkit-slider-thumb` (appearance none, 16x16, no background) | UA shadow tree | The thumb sizes the input but **paints nothing**. The visible track is `.animate-track`. |

Findings that shape the order:
- **Nothing in the demo lays out from image bytes.** Both images are sized by CSS. The natural ratio only matters for object-fit paint. REPL's block-level and flex-item path is therefore on the critical path. Inline `img` is not.
- **Demo buttons do not set `appearance: none`,** but they do set author `background` and `border`. In Chrome, author background or border on a button "devolves" it to CSS painting (Blink `LayoutTheme::IsControlStyled`, which HTML calls "devolvable widget"). FORM-a must therefore cover that path, not only `appearance: none`.
- **The UA font does not reach demo controls.** Controls do not inherit `font` (the UA sets the control font), but the demo writes `button, input, iframe { font: inherit }`.

## 1. Rulings (research-backed; the PM records them in decisions.md and on the board)

**R1. Where images come from.** An image source is bytes known at build time:
- a `data:` URL, or
- a path or URL mapped to a local file by a project asset map. This is an additive `images` option, shaped like TXT1-C's font option.

An unmapped remote URL is a build error (`DRAGON_REMOTE_IMAGE`, a new code), the same as fonts (T004). Each asset's sha256 goes into the compilation digest (the TXT1-C `manifestDigestInput` precedent).

The north star maps the four `i.ytimg.com/.../maxresdefault.jpg` URLs to `examples/music-player/covers/*.png`, as the NS-REF Chrome route already does. That mapping is a labelled stand-in, like the pinned fonts. Runtime-fetched images, whose natural size is known only on device and which then need a relayout, are a later package (REPL-r). They are not refused forever (maximum support).

**R2. The format is decided by magic bytes, not by the URL or type.** Chrome's ImageDecoder sniffs the bytes the same way, so a `.jpg` URL serving PNG bytes is a PNG.

**R3. Formats and colour in REPL-a.** REPL-a accepts:
- 8-bit PNG (all colour types, interlaced or not, tRNS), untagged or with an `sRGB` chunk;
- **no** iCCP, gAMA/cHRM without sRGB, cICP, 16-bit or APNG (acTL).

Each refused format names its package:
- REPL-c: colour-managed images;
- REPL-j: JPEG;
- REPL-g: GIF, WebP and AVIF;
- REPL-an: animated images.

The reasons:
- Lossless 8-bit sRGB PNG decodes to identical RGBA in Chrome (libpng via Blink), ImageIO and Android's ImageDecoder. Only this makes a strict-channel pixel gate possible.
- JPEG decoders differ: libjpeg-turbo in Chrome and on Android, AppleJPEG on iOS, with different IDCT and chroma upsampling. REPL-j is ruled as a **build-time transcode**. A pinned libjpeg-turbo at Chrome 145's revision decodes the JPEG in the compiler (the vendored-upstream route of TXT1-0/HarfBuzz), and a lossless PNG ships. Its proof is byte equality with Chrome's `getImageData` on a corpus. REPL-0 gathers the evidence.

**R4. The natural size is a build-time constant.**
- It comes from the header: PNG IHDR, and for REPL-j, JPEG SOFn with EXIF orientation applied, because Chrome's default is `image-orientation: from-image`.
- Chrome may density-correct JPEG natural size from EXIF resolution. REPL-0 measures whether it does. Until REPL-j follows the measured rule, any EXIF resolution is refused.
- Native code never measures an image. Layout never waits for decoding. Decoding on device affects pixels only, and the lanes capture after a Dragon "images decoded" signal.

**R5. Sizing is an engine feature (E), translated.** A new `packages/layout/src/replaced.ts` implements:
- CSS 2.2 §10.3.2, §10.3.4, §10.3.8, §10.6.2 and §10.6.5, the §10.4 min/max table, and css-sizing-4 natural and preferred aspect ratio (`aspect-ratio: auto && <ratio>`);
- the HTML presentational hints for `width` and `height` attributes, which map to `width`, `height` and `aspect-ratio: auto w / h`;
- the default object size of 300x150, used for `iframe`;
- flex items with a ratio (css-flexbox §9.2 and §9.4 with transferred sizes, and the automatic minimum size).

**R6. object-fit and object-position are computed by the engine, drawn by Dragon (D).** The engine outputs the image's destination rect, which is snapped by the rule Chrome is measured to use. Native code draws the decoded bitmap into that rect, clipped to the content box:
- iOS: `CGContext.draw` in a Dragon layer;
- Android: `Canvas.drawBitmap(src, dst, paint)` with `FILTER_BITMAP_FLAG`.

`UIImageView.contentMode` and `ImageView.ScaleType` are **not** used, because neither can express `object-position` percentages and lengths.

**R7. How replaced sizing and placement are proven numerically.**
- **Boxes.** Parity fixtures with Chrome `getBoundingClientRect` (the existing capture). The images are `data:` URLs, so `chrome.ts` stays unchanged: Playwright's `setContent` waits for `load`, and that includes images.
- **Destination rect.** Chrome exposes no object-fit rect, so REPL-0 captures a **quadrant probe**:
  - The test image has four flat, distinct colour quadrants on a distinct content-box background.
  - At DPR 2, 3 and 2.625, the capture reads the screenshot. The quadrant boundary lines are taken at the 50% crossing, together with any unclipped image edges.
  - This gives the destination rect's centre, scale and visible edges.
- **Comparison.** The engine's destination rect must equal the probe within `GATE_DEVICE_PX` (1 device px) for every fit {fill, contain, cover, none, scale-down} x position grid (keywords, %, px, calc-free) x natural ratio {wide, tall, square}.
- **Decode parity.** Chrome's `getImageData` equals the host TS PNG decode, byte for byte, over the whole corpus.

**R8. Image pixels under P5's strict gate (`GATE_CHANNEL_DELTA = 0`).** Resampling filters differ: Skia's mipmap and cubic, CoreGraphics interpolation and Android bilinear. So the pixel lane gets an appended sample rule, `image-flat`:
- **Interior points** are taken only where the decoded source is uniform over the filter support (at least 2 source px beyond `ceil(1/scale)` on every side). Any normalised filter reproduces a constant exactly.
- **Edge points** fall on the destination-rect and quadrant boundaries, compared by position within 1 device px, as in the P5 glyph edge rule.

Non-flat content is not compared, and the report says so. **No allowance is introduced.** Matching resampling (a Dragon-owned resampler equal to Skia's) is the named follow-up REPL-f.

The north-star cover stand-ins are gradients with almost no flat support. REPL-a Phase B therefore adds flat marker patches to `tools/cover-png.ts`, 16 source px beyond the largest filter support, and recaptures. The stand-ins are test data (T014), and changing them is not a design change.

**R9. The iframe web-view slot (FV, goal.md checkpoint 3 scope).**
- **Model.** `iframe` is a replaced element with no natural size or ratio and the default object size of 300x150. UA defaults come from a new ELB-2 key, `iframe`, which REPL-0 captures.
- **Native.** Dragon lays out the slot and creates the platform view in the content box:
  - iOS: `WKWebView` with `allowsInlineMediaPlayback = true` and `mediaTypesRequiringUserActionForPlayback = []`;
  - Android: `android.webkit.WebView` with JavaScript enabled and `mediaPlaybackRequiresUserGesture = false`.
- **Clipping.** It is clipped by the ancestors' overflow clip, and by border-radius once PNT1 lands. Dragon loads `src` from the element.
- **Tests: frames only.**
  - device-frames and ns-frames compare the web view's native frame with the engine's snapRect and with Chrome's iframe rect.
  - device-applied checks the native class name and the config flags.
  - device-pixels **masks the content box** of every foreign view: `generateSamples` excludes it, which is an additive rule. The iframe's own border and background are still sampled.
  - Test and lane builds never load network content: Chrome is routed an empty document, and native gets `about:blank`.
- **The north-star tree** models the DOM after the IFrame API has run. `snapshot.ts` gains an additive export that replaces `.youtube-player-target` with `<iframe class="youtube-player-target" data-dragon-id="video-placeholder">`, keeping the id. The embed URL is fulfilled with empty HTML in the Chrome capture.

**R10. SIZE-ar is not part of REPL.** It sizes non-replaced boxes: 4 of the demo's 5 `aspect-ratio` uses. It is proven with Chrome boxes alone, and it lives in intrinsic.ts, flex.ts and a block.ts call site. REPL-a builds on its ratio-transfer code. SIZE-ar is specified here (package 3) because REPL waits on it and no other Judge task covers it (T044 is INL1/INL2; T046 is paint).

**R11. Which buttons FORM-a covers.** FORM-a covers every button whose used appearance is CSS painting:
- `appearance: none`, or
- `appearance: auto` with author-level `background-*` or `border-*`. This is Blink's devolve rule. FORM-0 confirms it by pixel probe in Chrome 145 and commits it as a table.

Natively themed buttons (auto, with no author background or border) are FORM-b. FORM-b must first rule on which native look Chrome 145 macOS paints as the reference.

The range is covered only with `appearance: none` on the input. The thumb and track take their own appearance. When they are `none`, they paint only their CSS.

**R12. How controls are laid out.** A control is expanded at build time into Chrome's own UA shadow structure, with the UA shadow styles taken from Chrome by FORM-0.
- **Range:** container (flex), then track (block, `flex:1`, `align-self:center`), then thumb.
- **Button:** an anonymous inner box, per Blink `LayoutButton::UpdateAnonymousChildStyle`: flex-grow 1, min-width 0, auto block margins, and the button's flex direction, justify, align and wrap. It is proven by Chrome boxes of the button's children.
- **Thumb offset** = (value − min) / (max − min) x (track content width − thumb width), mirrored in rtl. It is an engine function, proven against CDP box models of the UA shadow nodes: `DOM.getDocument({pierce:true})` exposes user-agent shadow roots, and `DOM.getBoxModel` gives their boxes.
- **Value sanitisation** follows HTML's range state: defaults min 0, max 100 and value at the midpoint; if max < min, the value is min; values snap to step from the step base, and a tie goes up. It is proven against Chrome's `input.value` over a derived matrix.
- **Range value is control state, not style state.** Decision 17 therefore does not bind it. It is exposed as a typed value event (`input` while dragging, `change` on release).

**R13. Colours and fonts in controls.**
- **System colours** (ButtonFace, ButtonText, ButtonBorder, Field, FieldText) resolve at build time from the ELB-2 `systemColors` tables, by the element's used color-scheme. Dark resolution needs `color-scheme` (PNT1). Before PNT1 lands, a system colour that reaches a used value under a dark scheme is refused naming PNT1. The demo overrides every UA colour on its controls, so this does not block it.
- **Fonts.** A control whose used font is the UA control font (`system-ui`, unpinned) is refused with `DRAGON_UNSUPPORTED_FONT`, naming the font map. Fixtures use `font: inherit`, as the demo does.
- **userAgentForced values** (inline-block display, `overflow: clip` on inputs) do not take part in the cascade.

**R14. Native feel for interaction (extends the owner's "Dragon builds it, native feel" ruling to controls).** Dragon draws the control, and the platform's own control plumbing handles the behaviour:

| | iOS | Android |
|---|---|---|
| Button class | a `UIControl` subclass, so UIKit touch tracking gives touch-up-inside with the system retention bounds and cancel on drag-out | a `View` with `isClickable`, so `performClick` plays the system click sound when enabled, and touch slop cancels the press |
| Button extras | `UIAccessibilityTraitButton`, label from `aria-label` or the text | `AccessibilityNodeInfo` className `android.widget.Button`; focusable; Enter and Space activate from a hardware keyboard |
| Press visual | CSS `:active` only (SELD-R). No UIKit dimming. | CSS `:active` only (SELD-R). No ripple, because the design is the CSS (course correction 4). |
| Range gesture | web semantics: a tap on the track jumps the value, then drags. The demo's thumb is invisible, so thumb-only dragging would be unusable. | same |
| Range arbitration | begins only once horizontal movement dominates, via `gestureRecognizerShouldBegin` | `requestDisallowInterceptTouchEvent` after touch slop with \|dx\| > \|dy\| |
| Range accessibility | adjustable trait; increment and decrement by step; `accessibilityValue` from `aria-valuetext`, else the value | className `android.widget.SeekBar`, `RangeInfo(FLOAT, min, max, value)`, `ACTION_SET_PROGRESS` and scroll forward and back |
| Haptics | none, matching UISlider and UIButton | none, matching SeekBar |

The value mapping and thumb geometry are engine code (translated). The gesture glue is thin platform code in an emitted support module.

**Proof.**
- **Android:** real `adb shell input tap` and `input swipe` events, with values read back from the dump.
- **iOS:** simctl has no touch injection, and idb would be an install outside /tmp. So the control exposes `dragonPointer(down:move:up:)` entry points in CSS px, which `touchesBegan` and the other touch handlers call. A `--dragon-script` host flag drives them. **The iOS real-touch path is recorded as missing evidence.** An XCUITest lane is shared follow-up work with P6 selection and editing.

**R15. How Dragon-drawn controls are proven visually (P5 §4 rules, unchanged).**
- Points come from `generateSamples` over the engine geometry and paint facts. The control's paint facts are the CSS paint of the input and button boxes, plus the track and thumb boxes from the engine.
- Non-text points are strict (delta 0). Text uses the glyph rule. Edges are within 1 device px.
- Parity fixtures give the thumb and track **solid author backgrounds**, so placement is visible.
- A new raster plant, **`thumb-offset-1`** (thumb drawn 1 device px right), must fail device-pixels on both targets while device-frames and device-lines pass.
- Capture trust as in P5. Focus is not captured (`:focus-visible` rings are SELD-R).

**R16. Shared element-table and fixture edits are append-only.** REPL-a and FORM-a add their tags in new files, `analysis/elements/replaced.ts` and `analysis/elements/controls.ts`. elements.ts gets one import and one concatenation line, which the integrator resolves like `fixtures.ts` (T010 merge rules). This is not a reason to serialise against INL1's ownership of elements.ts.

## 2. Order and dependencies

```
now:            REPL-0 ∥ FORM-0                       (new files; no device; disjoint from T007, T009, T044/T046 scopes)
after T007 (P5) + T009 V1 Phase B on master:
                SIZE-ar                               (merges before INL1 branches: INL1 owns block.ts)
after SIZE-ar + REPL-0 + T043 (TREE) + T038 (TXT1-C Phase B) on master:
                REPL-a Phase A (engine, compiler, web)
after the T046 emitter split + T034 (NS-REF recapture), with the device lease:
                REPL-a Phase B (native paint, FV slot, image-flat rule, covers markers, device step)
after REPL-a Phase A + FORM-0:  FORM-a Phase A (engine, compiler, web)
after REPL-a Phase B:           FORM-a Phase B (native draw, interaction, a11y, device step; lease)
after INL2 (T044) + REPL-a + FORM-a:
                RF-INL (inline-level img and iframe, inline-block controls, the demo's range in .track)
then NS-LANE runs (T018); NS-E2E needs TXT1a/TXT1d for button text and PNT1 for radii and color-scheme
```

- **INL2 dependency.** Only RF-INL waits for INL2. REPL-a and FORM-a refuse inline-level cases with a diagnostic that names RF-INL. This takes REPL-a and FORM-a off the INL1 → TXT → INL2 pole.
- **Worker count.** REPL-0 and FORM-0 add 2 writers (limit 8).
- **Device leases.** Phase B steps and SIZE-ar's device step each hold both leases, serialised by the PM.

---

## 3. Worker packages

Every verify line below is one shell command that starts with the environment export, as required. BASE is the package's start commit.

These guards apply to **every package**:
- no push and no remote;
- no edit to `design/`;
- no tolerance, gate, DPR, case or device loosened;
- generated files are regenerated, never hand-edited;
- notes are written only in the main checkout.

### P1. REPL-0: image data and asset core (starts now, new files plus the ua lane)

- **Base:** master 41cc750.
- **Worktree:** `/tmp/dragon-repl0`.
- **Branch:** `repl0-image-data`.
- **Merge:** any time. The ua outputs are regenerated at merge, as for T017.

**Objective.**
1. **`packages/dragon/src/images/`:**
   - `sniff.ts`: magic-byte format detection (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG);
   - `png.ts`: chunk parse (IHDR, colour chunks, tRNS, acTL) and an RGBA8 decode through `node:zlib` (build time only);
   - `jpeg.ts`: SOFn, progressive, APP1 EXIF orientation and resolution, ICC presence (metadata only);
   - `natural-size.ts`: R4;
   - `manifest.ts`: sha256 per asset, source kind (`data:` or mapped path), natural size, format, refusal with the owning package, and `manifestDigestInput`. A remote URL never yields an entry.
   - `faults.ts`: plants.
2. **`scripts/capture-image-data.ts`** (Chrome 145 via `launchChrome` and `chromeArgsAt`, imported unchanged). It captures:
   - `naturalWidth` and `naturalHeight` for a derived corpus: generated PNGs of every colour type and bit depth, interlaced and not; Chrome-encoded JPEGs (`canvas.toBlob`, which must be byte-stable, else a stop) with EXIF orientations 1–8 and EXIF resolution 72 and 144 dpi;
   - full `getImageData` for the small corpus images;
   - the **quadrant-probe** destination rects (R7) at DPR 2, 3 and 2.625 for fit x position x ratio.

   The output goes to `packages/dragon/test/images/chrome-145/`. It has `--check` (a byte-identical recapture) and `--plant ihdr-swap|exif-ignored|density-ignored`.
3. **Decode evidence (note only, no test):** macOS ImageIO decode of the JPEG corpus against Chrome `getImageData`, as a max channel delta per image. This is REPL-j's input.
4. **UA keys `iframe` and `img` with a `data:` src.** Added to `scripts/capture-ua-defaults.ts` in the T017 separate-table style. The existing tables stay byte-identical.

**allowed_files:**
- `packages/dragon/src/images/**` (new)
- `packages/dragon/test/images/**` (new: tests, corpus, captures)
- `scripts/capture-image-data.ts` (new)
- `scripts/capture-ua-defaults.ts` (new keys only)
- `packages/dragon/src/ua/chrome-145.darwin-arm64.generated.ts` and `packages/dragon/src/ua/chrome-145.darwin-arm64.dark.generated.ts` (ua:capture output)
- `packages/dragon/test/ua-elb2.test.ts` (appended pins)
- `docs/goals/milestone-2-proof/notes/T0xx-repl0.md` (main checkout only)

**verify:**
1. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`: green; no skip, `.only` or `.todo`.
2. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && node --conditions=dragon-internal scripts/capture-image-data.ts && node --conditions=dragon-internal scripts/capture-image-data.ts && git diff --exit-code packages/dragon/test/images`
3. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && node --conditions=dragon-internal scripts/capture-image-data.ts --check`: exit 0. Tests prove:
   - the header natural size equals Chrome for every corpus image;
   - the TS PNG decode equals `getImageData` byte for byte;
   - the refusal list is exact.
4. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && for p in ihdr-swap exif-ignored density-ignored; do node --conditions=dragon-internal scripts/capture-image-data.ts --check --plant $p; test $? -eq 1 || exit 1; done`
5. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run ua:capture && pnpm run ua:capture && git diff --exit-code packages/dragon/src/ua`
6. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && git show 41cc750:packages/dragon/src/ua/chrome-145.darwin-arm64.generated.ts > /tmp/repl0-base-ua.ts && node --conditions=dragon-internal scripts/capture-ua-defaults.ts --check && node --conditions=dragon-internal scripts/capture-ua-defaults.ts --compare /tmp/repl0-base-ua.ts`: 0 differing entries.
7. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run parity:capture && git diff --exit-code packages/parity/expected packages/parity/emitted && pnpm run profile:rows && git diff --exit-code packages/dragon/src/profiles && pnpm run north-star:check && git diff --exit-code examples/music-player/dragon/north-star-check.json`
8. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && git diff --name-only 41cc750..HEAD && git remote -v`: inside allowed_files; no remote.

**stop_if:**
- `chrome.ts`, `package.json`, the lockfile or any compiler, engine or parity source must change.
- Chrome's natural size disagrees with the header parse, and no rule explains it after measurement.
- Chrome's `getImageData` differs from the TS decode for an untagged 8-bit PNG. This would falsify R3; report it.
- A capture or `toBlob` output is not byte-stable across runs.
- An existing UA entry changes.
- A plant is not caught.
- Verification fails twice.

### P2. FORM-0: control data and value model (starts now, new files only)

- **Base:** master 41cc750.
- **Worktree:** `/tmp/dragon-form0`.
- **Branch:** `form0-control-data`.

**Objective.**
1. **`scripts/capture-form-data.ts`** (Chrome 145 via the imported `launchChrome`, CDP). It captures:
   - **Range matrix** (derived): appearance none or auto on the input, thumb and track; thumb width and height; track author height; input width, height, padding, border and box-sizing; min, max, value and step, including invalid and misordered values; ltr and rtl.
     - The input rect, and the `container`, `track` and `thumb` box models via `DOM.getDocument({depth:-1,pierce:true})` and `DOM.getBoxModel`.
     - Their computed styles (`CSS.getComputedStyleForNode`).
     - `value` and `valueAsNumber`.
   - **Button matrix:** display block, flex or inline-block in a flex parent; min-height; padding; border; text-align, justify-content and align-items; children that are Ahem text, an element, or both.
     - The button rect, child rects and text Range rects.
   - **Devolve probe (R11):** for button and range, and each author property set (none; background-color; border; appearance none), the DPR 2 screenshot is compared at centre and border points against the CSS-predicted colours. The result is `packages/dragon/src/forms/appearance.generated.ts`, with the Blink citation.
   - The output goes to `packages/dragon/test/forms/chrome-145/`, with `--check` and `--plant thumb-unmirrored|step-tie-down|devolve-ignored`.
2. **`packages/dragon/src/forms/range-value.ts`:** HTML value sanitisation (R12), tested against Chrome `value` over the whole matrix.
3. **`packages/dragon/src/forms/range-geometry.ts`** and **`button-inner.ts`:** TS reference functions for the thumb offset and the button inner-box style (R12), tested against the captured boxes within 0 LU. FORM-a *moves* them into the engine.
4. **`packages/dragon/src/forms/ua-shadow.generated.ts`:** the UA shadow styles for container, track and thumb.
5. **The note** records the platform interaction conventions behind R14, with Apple and Android documentation references (evidence only).

**allowed_files:**
- `scripts/capture-form-data.ts` (new)
- `packages/dragon/src/forms/**` (new)
- `packages/dragon/test/forms/**` (new)
- `docs/goals/milestone-2-proof/notes/T0xx-form0.md` (main checkout only)

**verify:**
1. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`: green; no skip, `.only` or `.todo`.
2. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && node --conditions=dragon-internal scripts/capture-form-data.ts && node --conditions=dragon-internal scripts/capture-form-data.ts && git diff --exit-code packages/dragon/test/forms packages/dragon/src/forms`
3. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && node --conditions=dragon-internal scripts/capture-form-data.ts --check`: exit 0. range-value equals Chrome on N/N; range-geometry and button-inner equal Chrome boxes on N/N.
4. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && for p in thumb-unmirrored step-tie-down devolve-ignored; do node --conditions=dragon-internal scripts/capture-form-data.ts --check --plant $p; test $? -eq 1 || exit 1; done`
5. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run parity:capture && git diff --exit-code packages/parity/expected packages/parity/emitted && pnpm run north-star:check && git diff --exit-code examples/music-player/dragon/north-star-check.json`
6. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && git diff --name-only 41cc750..HEAD && git remote -v`: inside allowed_files; no remote.

**stop_if:**
- CDP does not expose the user-agent shadow nodes with `pierce:true`. Report it, and propose a pixel-scan fallback with coloured thumbs; do not guess.
- A Chrome value or box disagrees with the reference function after the cited Blink rule has been re-checked.
- The devolve probe contradicts R11.
- Any existing file must change.
- A capture is not byte-stable.
- A plant is not caught.
- Verification fails twice.

### P3. SIZE-ar: aspect-ratio on non-replaced boxes

- **Base:** master after T007 (P5) and T009 (V1 Phase B).
- **Worktree:** `/tmp/dragon-size-ar`.
- **Branch:** `size-ar`.
- **Sequencing:** it must merge before INL1 branches. If INL1 is already in flight, the block.ts call-site commit waits for INL1's merge, and SIZE-ar rebases.

**Objective.**
- **Syntax:** `aspect-ratio: auto | <ratio> | auto && <ratio>` (px-free numbers, `a / b`, and degenerate 0 ratios as Chrome does).
- **Where it applies:**
  - block-level boxes: auto block size from inline size; box-sizing semantics, where `auto &&` uses the content box;
  - flex items, row and column: the transferred flex base size and cross size, and the automatic minimum size (css-sizing-4 §5.2);
  - absolutely positioned boxes: the ratio at the auto-size resolution call site only.
- **Min and max:** min and max transfer through the ratio.
- **Also:** computed-value serialisation, web output, and both native lowerings.
- **Fixtures:** a `sizing-ratio` group covering the demo's four contexts (fixed is covered via abspos until POSX-f) in ltr and rtl, run through the full proof path (as T010 WP1 verify 2–8), plus the device step on the lease.

**allowed_files:**
- `packages/layout/src/ratio.ts` (new)
- `packages/layout/src/intrinsic.ts` and `flex.ts`
- `packages/layout/src/block.ts` (the auto-block-size call site only)
- `packages/layout/src/position.ts` (the auto-size ratio call site only)
- `packages/layout/src/input.ts` and `validate.ts` (additive `aspectRatio` field and check)
- `packages/dragon/src/css/properties/box.ts` (the `aspect-ratio` entry)
- `packages/dragon/src/css/values.ts` (the `<ratio>` parser, additive)
- `packages/dragon/src/analysis/computed.ts` (the aspect-ratio computed value only)
- `packages/dragon/src/lower/ios-layout.ts` and `packages/dragon/src/lower/native-program.ts` (additive field lowering)
- `packages/dragon/src/emit/web-css.ts` (only if pass-through needs it)
- `packages/parity/fixtures/sizing-ratio-*.html` and `reject-sizing-ratio-*.html` (new)
- `packages/parity/src/fixture-groups/sizing.ts` (new)
- `packages/parity/src/fixtures.ts` (one import and one concatenation)
- new files under `packages/parity/expected/**`, `expected-dpr/**`, `expected-breaks/**`, `expected-pixels/**`, `packages/layout/vectors/**` and `packages/layout/break-vectors/**`
- `packages/parity/emitted/**` (new files; headers relaxed)
- `packages/layout/generated/**` (native:gen output)
- `packages/translate/corpus-dpr.json` (generator output)
- `packages/dragon/src/profiles/*.ts` (profile:rows)
- `packages/parity/out/lanes.json`
- `examples/music-player/dragon/north-star-check.json` (regenerated)
- `packages/layout/test/ratio.test.ts` (new)
- the note (main checkout)

**verify:**
1. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
2. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run parity:capture && pnpm run parity:capture && pnpm run parity:dpr-capture && pnpm run parity:dpr-capture && git diff --exit-code packages/parity/expected packages/parity/expected-dpr`: the second runs are clean.
3. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run layout:vectors && pnpm run layout:dpr-vectors && git diff --diff-filter=MD --name-only BASE -- packages/layout/vectors packages/parity/expected packages/parity/expected-dpr`: empty.
4. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run parity:report && pnpm run parity:dpr-report`: failed 0 at 1, 2, 3 and 2.625.
5. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run layout:subset && pnpm run native:gen && pnpm run native:swift && pnpm run native:kotlin && pnpm run native:planted -- --target swift && pnpm run native:planted -- --target kotlin`
6. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run profile:rows`: the diff contains only new aspect-ratio rows and proofs.
7. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run north-star:check`: the aspect-ratio errors fall. Before and after are in the note.
8. **Device step (lease):** `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run layout:break-vectors && pnpm run parity:break-capture && pnpm run parity:pixel-capture && pnpm run parity:lanes -- --run-host --run-device`: the new cases pass device-frames, applied and lines on both targets, with no stale lane.
9. `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && git diff --name-only BASE..HEAD && git remote -v`

**stop_if:**
- Chrome and the engine disagree on a ratio case after the spec has been re-checked.
- An existing capture, vector, emitted body or profile row changes.
- A non-additive `input.ts` change is needed.
- `inline.ts` or `text.ts` would change.
- block.ts or position.ts needs more than the call site.
- P5 or V1 Phase B is not on master.
- The device lease is not held for step 8.
- Verification fails twice.

### P4. REPL-a: replaced elements (img, iframe/FV) at block level and as flex items, object-fit and object-position

- **Base:** master after SIZE-ar, REPL-0, T043 (TREE: attributes.ts) and T038 (TXT1-C Phase B: the option precedent on project.ts). Never concurrent with T030.
- **Phase B** also needs the T046 emitter split and T034.
- **Worktree:** `/tmp/dragon-repl`.
- **Branch:** `repl-a`.

**Objective.**

*Phase A (engine, compiler, web):*
- R1–R7 and R9: `replaced.ts` sizing and the destination rect; the `img` and `iframe` element entries; attributes `src`, `alt`, `width` and `height` (the attributes.ts owner rows move from refused to handled);
- the `images` option and manifest digest; the `object-fit` and `object-position` properties;
- new codes `DRAGON_REMOTE_IMAGE` and `DRAGON_UNSUPPORTED_IMAGE`, the latter naming REPL-c, j, g or an;
- inline-level replaced boxes are refused, naming RF-INL;
- parity fixtures with `data:` PNGs in a `replaced` group;
- engine destination-rect vectors, compared with the REPL-0 quadrant probe within 1 device px.

*Phase B (native, lease):*
- the image draw writer module;
- the decoded-images signal;
- the foreign-view writer module for `WKWebView` and `WebView`;
- appended sample rules `image-flat` and the foreign-view mask;
- the raster plant `image-offset-1`;
- WebKit linking in native-build;
- flat marker patches in the covers, and the NS tree iframe export, then recapture;
- the device step.

**allowed_files:**
- `packages/layout/src/replaced.ts` (new)
- `packages/layout/src/input.ts` and `validate.ts` (additive: a replaced leaf kind and object-fit fields)
- `packages/layout/src/block.ts`, `flex.ts` and `position.ts` (replaced call sites only)
- `packages/layout/src/index.ts` (exports)
- `packages/dragon/src/images/**` (extends REPL-0)
- `packages/dragon/src/attributes.ts` (the img and iframe rows)
- `packages/dragon/src/analysis/elements/replaced.ts` (new), plus `packages/dragon/src/analysis/elements.ts` (one import and one concatenation)
- `packages/dragon/src/css/properties/box.ts` (object-fit and object-position entries)
- `packages/dragon/src/css/values.ts` (the `<position>` parser, additive)
- `packages/dragon/src/analysis/computed.ts` (those two properties only)
- `packages/dragon/src/types.ts` and `project.ts` (the additive `images` option and digest input only)
- `packages/dragon/src/diagnostics/catalogue.ts` (two appended entries)
- `packages/dragon/test/diagnostic-codes.json` (append)
- `packages/dragon/src/lower/ios-layout.ts` and `native-program.ts` (additive replaced lowering)
- `packages/dragon/src/emit/web-css.ts` (only if needed)
- Phase B only:
  - `packages/dragon/src/emit/paint/image.ts` and `emit/paint/foreign-view.ts` (new, in the T046 split layout; use T046's directory verbatim if it differs)
  - `packages/dragon/src/emit/native-support.ts` (the decoded-images signal only)
  - `packages/parity/src/samples.ts` (the appended rules `image-flat` and `foreign-mask`)
  - `packages/parity/test/samples.test.ts` (append pin)
  - `packages/parity/src/cli/native-build.ts` (WebKit link and the `image-offset-1` plant)
  - `examples/music-player/tools/cover-png.ts` (marker patches)
  - `examples/music-player/tools/snapshot.ts` (additive iframe export)
  - `examples/music-player/tools/capture-chrome.ts` (fulfil the embed URL with empty HTML)
  - `examples/music-player/covers/**`, `examples/music-player/chrome/**` and `examples/music-player/lane/**` (regenerated)
- `packages/parity/fixtures/replaced-*.html` and `reject-replaced-*.html` (new)
- `packages/parity/src/fixture-groups/replaced.ts` (new)
- `packages/parity/src/fixtures.ts` (append)
- generated outputs as listed for SIZE-ar
- `packages/layout/test/replaced.test.ts` and `packages/dragon/test/images/**` (new tests)
- the note

**verify:**
- SIZE-ar verify 1–9, with `replaced` in place of `sizing-ratio`.
- Plus: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm test -- packages/layout/test/replaced.test.ts`: the engine destination rect equals the REPL-0 probe within 1 device px at 2, 3 and 2.625 on N/N.
- Plus: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && node --conditions=dragon-internal scripts/capture-image-data.ts --check`
- Phase B plus: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run native:build -- --target ios --plant image-offset-1 && pnpm run native:build -- --target android --plant image-offset-1 && pnpm run parity:lanes -- --run-device`. The plant must fail device-pixels on `image-flat` or edge points while device-frames passes, on both targets. Without the plant:
  - the replaced cases pass frames, applied and lines on both targets;
  - device-pixels is pass, or fail with every failure listed;
  - the foreign-view frames equal the Chrome iframe rect within 1 device px;
  - the applied dump names `WKWebView` / `android.webkit.WebView` and the config flags.
- Phase B plus: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run north-star:capture && pnpm run north-star:capture && git diff --exit-code examples/music-player/chrome examples/music-player/covers && pnpm run north-star:check`. It is byte-stable and at most 50 MB. The img, iframe, object-fit and src errors reach 0, and the rest are listed.

**stop_if:**
- The destination rect is off by more than 1 device px after Blink's snapping has been measured and re-checked.
- Chrome and the engine disagree on a sizing case.
- `chrome.ts` or `compare.ts` must change.
- A pixel allowance or a non-flat image comparison would be needed.
- The Android WebView provider is missing on the AVDs. That is a tooling fault; report it.
- WebKit linking needs Xcode-project tooling.
- Network access is needed in any test.
- T046's emitter split is not on master for Phase B. Phase A may merge alone.
- An existing output changes.
- Verification fails twice.

### P5. FORM-a: button and range, Dragon-drawn (block-level and flex-item controls)

- **Base:** master after REPL-a Phase A and FORM-0.
- **Phase B** after REPL-a Phase B, with the lease.
- **Worktree:** `/tmp/dragon-form`.
- **Branch:** `form-a`.

**Objective.**

*Phase A:*
- `packages/layout/src/controls.ts`: the range container, track and thumb expansion, the thumb offset and the button inner box (moved from FORM-0);
- `button` and `input[type=range]` element entries; attributes `type` (`button`, `submit`, `reset` and `range` only; others refused naming FORM-b), `min`, `max`, `value` and `step`;
- `appearance` / `-webkit-appearance` (none and auto under the R11 table); the `::-webkit-slider-thumb` and `::-webkit-slider-runnable-track` pseudo-elements (selectors.ts owner rows);
- userAgentForced, system colours (R13), and inline-level controls refused naming RF-INL;
- a `controls` fixture group (Ahem text, solid thumb and track colours, ltr and rtl, min/max/value/step matrix).

*Phase B:*
- `emit/paint/control.ts` and the `emit/support/controls.ts` gesture and accessibility module (R14);
- the typed value event;
- `--dragon-script` pointer injection (iOS) and `adb input` (Android) interaction tests;
- the raster plant `thumb-offset-1`;
- the device step.

**allowed_files:**
- `packages/layout/src/controls.ts` (new)
- `packages/layout/src/input.ts` and `validate.ts` (additive control kinds)
- `packages/layout/src/flex.ts` and `block.ts` (control call sites only)
- `packages/layout/src/index.ts`
- `packages/dragon/src/forms/**` (the move-out of the reference functions)
- `packages/dragon/src/attributes.ts` (control rows)
- `packages/dragon/src/css/selectors.ts` and `css/selector-validity.generated.ts` (the two pseudo-elements move from refused to handled)
- `packages/dragon/src/analysis/match.ts` (pseudo-element matching, additive)
- `packages/dragon/src/analysis/elements/controls.ts` (new) plus the one elements.ts line
- `packages/dragon/src/css/properties/box.ts` (appearance)
- `packages/dragon/src/analysis/computed.ts` (appearance and system colours only)
- `packages/dragon/src/diagnostics/catalogue.ts` and `packages/dragon/test/diagnostic-codes.json` (append)
- `packages/dragon/src/lower/ios-layout.ts` and `native-program.ts` (additive)
- Phase B only:
  - `packages/dragon/src/emit/paint/control.ts` and `emit/support/controls.ts` (new)
  - one include line in `emit/native-support.ts`
  - `packages/dragon/src/types.ts` (the additive typed value-event type)
  - `packages/parity/src/cli/native-build.ts` (the `thumb-offset-1` plant)
  - `packages/parity/src/native-host.ts` (the `--dragon-script` flag, additive)
  - `packages/parity/test/controls-interaction.test.ts` (new)
- `packages/parity/fixtures/controls-*.html` and `reject-controls-*.html`
- `packages/parity/src/fixture-groups/controls.ts`
- `packages/parity/src/fixtures.ts` (append)
- generated outputs as listed for SIZE-ar
- `packages/layout/test/controls.test.ts` (new)
- the note

**verify:**
- SIZE-ar verify 1–9, with `controls`.
- Plus: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && node --conditions=dragon-internal scripts/capture-form-data.ts --check && pnpm test -- packages/layout/test/controls.test.ts`: the engine thumb, track and inner boxes equal the FORM-0 Chrome boxes on N/N, and the value equals Chrome on N/N.
- Phase B plus: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run native:build -- --target ios --plant thumb-offset-1 && pnpm run native:build -- --target android --plant thumb-offset-1 && pnpm run parity:lanes -- --run-device`. The plant must fail device-pixels while device-frames and device-lines pass, on both targets. Without the plant, the controls cases pass frames, applied and lines, and pixels pass or list every failure.
- Phase B plus: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm test -- packages/parity/test/controls-interaction.test.ts`, with a device run under the lease:
  - tap and swipe produce the Chrome-equal sanitised values;
  - a drag-out cancels a button press;
  - a vertical swipe over the range scrolls instead of seeking;
  - the accessibility nodes show the R14 classes, traits and range info.
- Plus: `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && pnpm run north-star:check`: the button, input, type/min/max/value, appearance and slider-thumb errors reach 0, and the rest are listed.

**stop_if:**
- A Chrome box or value disagrees with the engine.
- A control needs the native theme (FORM-b) or `system-ui` text.
- A dark system colour is needed before PNT1.
- iOS touch proof would need idb or XCUITest tooling. Record it as missing evidence and continue with the pointer-script path; do not stop the package.
- A pixel allowance would be needed.
- An existing output changes.
- REPL-a Phase B is not on master for Phase B.
- Verification fails twice.

### P6. RF-INL: inline-level replaced boxes and controls (the INL2 join)

- **Base:** master after INL2 (the T044 package), REPL-a and FORM-a.
- **Worktree:** `/tmp/dragon-rf-inline`.
- **Branch:** `rf-inline`.

**Objective.** Replaced boxes and controls become atomic inlines through INL2's atomic-inline kind:
- **Baselines:** a replaced box's baseline is its margin-box bottom edge. A range or button baseline follows the FORM-0-captured Chrome baseline.
- **Behaviour:** `vertical-align` and line-box height with the strut.
- **Coverage:** inline `img`, `iframe` and inline-block controls, including the demo's range inside `.track` and the `inline-flex` `.play-icon` inside a button (the latter proven jointly with INL2).
- **Cleanup:** the RF-INL refusals are removed.

**allowed_files:**
- the INL2 atomic-inline registration point that T044 names (verbatim from T044's list)
- `packages/layout/src/replaced.ts` and `controls.ts` (baseline functions)
- `packages/parity/fixtures/inline-replaced-*.html` and `inline-controls-*.html`
- `packages/parity/src/fixture-groups/inline-atomic-replaced.ts`
- `packages/parity/src/fixtures.ts` (append)
- generated outputs as listed for SIZE-ar
- the note

**verify:**
- SIZE-ar verify 1–9.
- Plus the north-star check: 0 errors remain for `img`, `iframe`, `button` and `input` in every context.

**stop_if:**
- INL2 is not on master.
- inline.ts needs more than INL2's registration point.
- A baseline disagrees with Chrome.
- Verification fails twice.

## 4. What can start now in new files only

- **REPL-0:** its engine-independent core is new files. The ua-lane keys are regenerated output under the T017 precedent (merge any time, never hand-merged).
- **FORM-0:** new files only.

Both are disjoint from T007 (P5 §4 files), T009 (V1 files), T044 and T046 (not yet specified; neither may claim `packages/dragon/src/images/**`, `packages/dragon/src/forms/**` or the two capture scripts), and each other. Neither boots a device.

## 5. Required board updates (PM)

1. Record T045 as approved with this note.
2. Add Worker cards:
   - REPL-0 and FORM-0: dispatch now;
   - SIZE-ar: after T007 and T009B;
   - REPL-a A and B;
   - FORM-a A and B;
   - RF-INL.

   Replace "wave 4: INL2, REPL, FORM-a" in T019 with this order.
3. Record rulings R1–R16 in docs/decisions.md as PM rulings (decision-by-research).
4. T044 constraint: INL2 names its atomic-inline registration point, and must not claim `replaced.ts`, `controls.ts`, `images/**` or `forms/**`.
5. T046 constraint: the emitter split's writer-module directory is the one REPL-a and FORM-a Phase B use. PNT1 carries `color-scheme` (R13) and radius clipping of foreign views.
6. T034 (NS-REF recapture) must land before REPL-a Phase B. The two serialise on `examples/music-player/chrome/**`.
7. Missing evidence to track:
   - Android decode parity on device (REPL-a B);
   - the iOS real-touch path (XCUITest, shared with P6);
   - JPEG decoder deltas on iOS devices (REPL-j).
