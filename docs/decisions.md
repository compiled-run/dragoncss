# Owner decisions

These are recorded 2026-09-26. The owner said "take the recommendations", so each entry below is the recommendation the research made. Change any of them by editing this file and noting the date.

## Direction

- **Separate project:** Dragon CSS lives in its own repo. The npm package is `dragon`, published as `1.0.0-alpha.x` prereleases. Markless is the first user.
- **Regular CSS is the one authoring model.** On native targets, a selector may test only its own element, parents in the same component, and app-wide conditions. Anything else is a build error with a fix. StyleX-style object input is not added, unless the agent evaluation shows it helps. The evaluation ran on 2026-09-27 (notes/T005-agent-eval.md §8). Typed objects passed 7/15 on the first try against 5/15 for CSS, below the pre-registered bar of CSS + 5. Both styles failed on the same over-strict support rows, so Dragon stays CSS-only.
- **Compile straight to native properties,** using platform mechanisms where they exist. The only on-device library is layout, and it is Dragon's own engine (see Layout engine below). Any runtime helper Dragon needs ships as part of the generated output or a small runtime; see the API design for the exact boundary.
- **Build-time code is TypeScript.** The CSS analyzer is built in TypeScript inside Dragon, and moves into yuku (Zig) only if measurements require it. It stays internal in 1.x; only `explain()` is public.
- **Every target is a backend.** The core speaks only CSS. Backends choose among six kinds of technique: native property, Dragon-owned paint, shader, text-engine hook, build-time fold, runtime helper. They prefer proven fidelity first, then cost.

## Layout engine (2026-09-26)

- **Dragon owns its layout engine, written in TypeScript. Taffy is not used,** neither upstream nor as a fork. The owner's reasons: Taffy is partial (no inline layout, fixed or sticky positioning, tables, multi-column, vertical writing modes or flex `order`), it makes its own assumptions (flex and border-box defaults), and flaws cannot be made impossible by design in someone else's engine.
- **The engine takes a fully specified input.** Every field is required and comes from the compiler's CSS resolution; there are no engine defaults. It follows the CSS specification algorithms and matches Chrome's arithmetic.
- **The TypeScript engine is the reference for native layout.** On-device versions (Swift, then Kotlin) are generated or ported in the native milestones and must reproduce it exactly on shared test vectors.

## Native engine strategy (2026-09-27)

- **TypeScript translated to each target.** The owner chose this after the milestone 2 research (docs/goals/milestone-2/notes/T001-engine-strategy.md). `packages/layout` stays the only hand-written layout engine. A Dragon-owned translator generates the native engines from a checked TypeScript subset: Swift for iOS and macOS, Kotlin for Android, and further languages as targets arrive. Generated engines are never edited by hand.
- **Proof:** every generated engine must reproduce all shared vectors and a shared differential test corpus exactly, on every target.
- **Not chosen:** a Rust or Zig core. It would either be a hand port, so two engines could drift, or it would replace the TypeScript reference. It would also still need Swift and Kotlin for helpers. An embedded JavaScript engine is not chosen either: Android has no built-in synchronous engine, so Android would become the weaker platform.

## Native lanes, milestone 2 (2026-09-27)

Owner answers to docs/research/native-strategy.md section 4:
- **Android toolchain:** the owner installs it on this Mac (JDK 17, Kotlin, Gradle, Android SDK, emulator images). Until it lands, Android runs are reported as blocked on owner tooling, and never as passing.
- **One Chrome reference:** iOS and Android are both judged against macOS Chrome 145, captured at each device's pixel ratio.
- **Pixel ratios:** 2 and 3 on both platforms, plus 2.625 as a named Android extra. The DPR 1 corpus stays untouched.
- **Report-only start:** the Android emulator lane starts report-only, like iOS (decision 14), and becomes blocking after two weeks without unexplained failures.
- **Translator subset check blocks:** a layout-engine change the translator cannot translate fails the tests.
- **Oldest iOS:** Dragon may download the oldest iOS simulator runtime Xcode 27 offers, for floor-OS runs on both platforms.
- **CI:** workflow files are written but not pushed. Dragon asks again before adding a remote.

## Pixel-ratio findings (2026-09-27)

- **Initial border width is not zoomed (D1, approved).** Chrome keeps the initial border width at 3 device px at every pixel ratio, but the spec says 3 CSS px. Dragon matches Chrome. The compiler marks the initial width as a typed `device-px` value, and the case is recorded as the Chrome deviation `initial-line-width-unzoomed` in a registry keyed by pixel ratio. It has a proving fixture and a planted spec-reading fault. Native backends apply it as device px (3 / scale). This follows from Blink's source (notes/T010-p2-triage.md).
- **One milestone-1 vector input changes (D2, approved).** In `color-border-sides.json`, node `long` changes its four initial border widths to `device-px`. The output stays byte-identical. No other milestone-1 vector, capture or emitted file changes.
- **Engine fixes at DPR 1.** Three milestone-1 engine bugs were measured in Chrome and fixed: px line-height rounding, number line-height rounding, and the min-content width of words inside a multi-word text. Three new fixtures prove the fixes. The milestone-1 corpus grows to 140 fixtures and 261 cases, and nothing is removed.

- **R4 is per-position ceil (T009).** Blink 145 uses ToCeil and FromFloatCeil in shape_result.cc, which supersedes the T010 "truncation" wording. It covers left-to-right runs only. Right-to-left script text needs a proving fixture before it can be supported.
- **Native proof still owed.** The 958 iOS rows marked `exact` are proven by the Linux layout lane, not by a native case. Milestone 2 oracle clause 4 requires native proof on both platforms (P6 or T999).

## Linux lane scope for milestone 1 (2026-09-27)

The owner asked the PM to research and decide (notes/T033-linux-lane.md).
- **What milestone 1 proves:** Dragon's layout engine is platform-free TypeScript and gives the same numbers on any OS. The Chrome oracle is captured on macOS Chrome 145.0.7632.6. Reports and the final audit say exactly that. They do not claim a Linux run.
- **What is platform-dependent (corrected 2026-09-27, T036):** most box geometry in the corpus does not depend on the OS: all laid-out text is Ahem and nothing scrolls. Text baselines and line boxes do. Blink rounds font metrics differently per platform. On Linux (`font_metrics.cc`, lines 114-126 at the pinned tag) it moves 1 px from ascent to descent at some Ahem sizes the corpus uses. On macOS, two measured rules apply: metric halves round down, and font sizes are truncated to hundredths. So Linux baselines are expected to differ by up to 1 px, which has not been measured. The default font-family string also differs (`Times` against `Times New Roman`). The macOS rules are held in a platform-rule registry with exact test nodes, keyed to `darwin-arm64`.
- **Making it portable (S5):** captures record the platform. The fixture environment sets the root font-family to Ahem, so no capture depends on the OS's default font. Any remaining UA data is keyed by platform. A Linux CI workflow file is written, but not pushed.
- **First real Linux run:** it happens when the owner approves either a local runtime (Apple `container` or Lima) or a push to CI. Linux captures are committed under their own platform key (`linux-x64`). Computed values must equal the macOS reference, except values from the platform UA dataset. Chrome-dual must be exact on Linux. Geometry is judged per platform against the Chrome captured on that platform. The workflow file (`.github/workflows/parity.yml`, manual trigger only) is written, but not pushed.

## iOS caveat cap for milestone 1 (2026-09-27)

- **Owner acknowledged:** 221 iOS paint and overflow support rows (colours, borders, backgrounds, overflow clipping) stay `caveat`, not `exact`, in milestone 1. Chrome proves the computed values, but no native paint lane exists. They can become `exact` only through the simulator lane in the next milestone, which needs the Xcode licence accepted.

## Anchor positioning (2026-09-28)

- **In scope (owner):** Dragon will support CSS anchor positioning: `anchor-name`, `position-anchor`, `anchor()`, `anchor-size()`, `position-area`, `position-try` and fallbacks, `position-visibility` and `anchor-scope`. Each feature is proven against Chrome 145 like any other layout feature.
- **It is an engine feature, not an overlay adapter.** Dragon owns its layout engine, so anchor resolution lives in `packages/layout` and reaches Swift and Kotlin through the translator. This replaces the "native overlay placement adapter" recommendation in docs/research/T011-styling.md §246, which assumed a third-party engine. No native platform provides anchor positioning, and no native CSS product ships it today (T011-styling.md §193).
- **Sequencing:** after milestone 2, so native parity is not delayed. It belongs with the next layout-breadth work (for example grid), because it builds on absolute positioning and needs the scroll-offset and fallback overflow rules that work shares.

## Spec conformance through web-platform-tests (2026-09-28)

- **Owner:** Dragon must implement the CSS specifications, and prove it with the same shared test suite the browsers use: web-platform-tests (WPT).
- **Two oracles:**
  - WPT checks the spec.
  - Chrome 145 checks what users see.

  A WPT test Dragon fails because Chrome also deviates from the spec is recorded in a per-target expectations file, with the Chrome deviation named (for example D1, `initial-line-width-unzoomed`). It never passes silently.
- **Maximum support (owner, 2026-09-28):** the goal is as much CSS as possible. A feature a platform lacks is not a reason to mark it unsupported: Dragon implements it in its generated Swift and Kotlin (engine, Dragon-owned paint, shaders or another workaround). Visual and numeric tests against Chrome prove it, and WPT where it has tests. After milestone 2, the feature roadmap is ordered by how many WPT tests and how much real-world usage each feature unblocks (the WPT scout, 2026-09-28: 2 of 1,138 numeric CSS tests run today; the biggest blockers are the `background` shorthand, non-Ahem text, `<br>`, `writing-mode`, `inline-block`, pseudo-selectors and `float`).
- **First import:** numeric layout tests (`check-layout-th.js`, `data-expected-*`) from `css-flexbox`, `css-position`, `css-box`, `css-sizing`, `css-writing-modes` (right-to-left only) and, when it is built, `css-anchor-position`. Only tests whose features are all in a target's profile are counted. The pass rate is published per target, as testing-plan.md layer 4 already specifies.

## Course corrections (2026-09-28)

The owner accepted these four corrections.

1. **Coverage grows in parallel with native proof.** CSS feature work runs alongside milestone 2 in waves, ordered by the coverage roadmap (WPT tests unblocked plus real-world use). Each wave has disjoint write scopes. Packages that touch the engine or API merge after P4.
2. **The text strategy is decided before text lanes.** The real-font text spike (Chrome compared with Core Text / TextKit and with StaticLayout, on open fonts including CJK) decides between three options:
   - native engines as they are;
   - native shaping with Dragon's own line breaker in the engine;
   - bundled shaping.

   The decision lands before P5's device-lines lane is built.
3. **Gates are tiered.**
   - **Strict:** engine output, vectors, captures, tolerances, support labels and profiles, emitted CSS bodies, and the checks themselves. These change only with a proof or an owner or PM ruling.
   - **Relaxed:** generated-file headers and source digests, report formatting, docs and notes. They may change whenever their inputs change. The receipt lists them, and a body-identical check is enough. They never need a stop and a ruling.
4. **North star: a real screen.** The Markless music-player demo (`markless/demos/music-player-ssr`, read-only; Markless is not edited) is copied into Dragon as its north-star app. It must run end to end on iPhone and Android and be verified visually against Chrome, and against WPT where tests exist. Every CSS feature it uses is on the roadmap. Nothing it uses is dropped because a platform lacks it: Dragon implements the missing piece in generated Swift or Kotlin, Dragon-owned paint, shaders or another workaround (owner, 2026-09-28: "anything we can't do with the platform you WILL find a way around it"). Each workaround is verified visually against Chrome before it is labelled.

## Interop focus areas (owner, 2026-09-28)

- **What it adds:** Dragon also scores itself against the WPT Interop focus areas for every year from 2021 to 2026. The browser vendors picked these tests together as the ones that matter most.
- **How:** Interop test sets are defined by `interop-YYYY-<area>` labels in the wpt-metadata repo, whose commit is pinned next to the WPT pin. 6,482 distinct CSS tests carry at least one label (wpt-metadata e6b32d8, counted by packages/wpt): flexbox, grid, transforms and aspect-ratio (2021); contain, color, scrolling and subgrid (2022); masking, container queries and `:has()` (2023); nesting and scrollbars (2024); anchor positioning, view transitions and writing modes (2025); view transitions, custom highlights, scroll snap, zoom, `shape()` and `attr()` (2026).
- **Reporting:** the WPT import tags each test with its labels and publishes per-area scores for Dragon and for Chrome on the same tests, next to the overall WPT number. Interop areas outside CSS (IndexedDB, WebRTC and so on) do not apply.
- **Roadmap:** Interop areas are a second priority signal, next to WPT tests unblocked and real-world use.

## Coverage roadmap (2026-09-28)

- The post-milestone-2 feature order is in docs/research/coverage-roadmap.md: 42 packages, ranked by WPT tests unblocked and real-world use. It is worked in waves with disjoint write scopes:
  - **Wave 0:** the WPT importer and a behaviour-preserving compiler split.
  - **Wave 1:** compiler-only features.
  - **Wave 2:** engine features after P4, starting with a shared value model.
  - **Later:** paint features after P6 and an emitter split.

  Generated files are regenerated at merge, never hand-merged.
- **P5 scope (PM):** the device lanes run every fixture on master when P5 starts, including fixtures merged after P4.
- **Text scale (PM):** Chrome and WPT proof run at text scale 1. Device lanes add a largest-text-size run, because `rem` follows the device text size (decision 5 in "Pitfalls handled by design").

## Text strategy (2026-09-28, from the real-font spike)

This decision uses the spike's measurements in docs/research/text-spike/: 620 cases across Inter, Roboto, Noto Sans, Inter variable and Noto Sans JP, compared with Chrome 145.

- **Native text engines as they are cannot reach `exact`.**
  - Core Text and TextKit 1 break lines the way Chrome does in 70–72% of Latin paragraphs.
  - Android StaticLayout does so in 40–53%.
  - The failures are structural:
    - native engines break an overflowing word mid-word, where Chrome lets it overflow;
    - ICU and Blink differ at `/` and at a hyphen before a digit;
    - soft hyphens are handled differently;
    - Android hints advances to whole pixels.
- **Chosen: native shaping plus Dragon's own line breaking (option b).** This amends decision 7 in "Platforms": the native text engine still shapes, falls back and renders, and handles selection and accessibility, but Dragon now decides the breaks as well as the line box.
  - **Break opportunities:** Dragon ports UAX #14 with Blink's overrides, and its space, soft-hyphen and NBSP handling. It pins the Unicode data instead of using the platform ICU.
  - **Greedy fit:** Blink's rule (fits if the width rounded up to 1/64 px is at most the available width plus 1/64 px), overflow instead of mid-word breaks, and the hyphen width added at soft-hyphen breaks.
  - **Advances only from the platform** (as measured in the spike; *superseded:* advances now come from font units, see "Native glyph advances", and from bundled HarfBuzz, see "Text shaping"):
    - iOS: `CTTypesetterCreateLine`, using the default instance of variable fonts.
    - Android: `getRunAdvance` with `LINEAR_TEXT_FLAG`, and an explicit `opsz` for variable fonts. Never `HIGH_QUALITY`.
  - **Measured results:**
    - iOS proxy: 480/480 Latin and 60/60 variable-font paragraphs match; width error at most 1/64 px.
    - Android: 478/480 Latin match, max 0.93 px per line. The 2 misses come from Minikin dropping kerning pairs that involve the space glyph. A build-time correction table from each bundled font's space-kerning pairs is the planned fix; if it falls short, bundled HarfBuzz is the fallback.
  - **Line boxes:** `line-height: normal` equals `round(ascent) + round(descent) + round(lineGap)` in all 20 font and size pairs measured. Native metrics match to 3 decimals, so Dragon owning the line box holds.
- **Japanese** stays `caveat` until Dragon implements `text-spacing-trim`. Chrome halves adjacent fullwidth punctuation by default. With trimming disabled, every Japanese break matches exactly.
- **Not yet measured:** real iOS devices, older Android versions, right-to-left text, complex scripts, emoji, font fallback, justification, letter and word spacing, `hyphens: auto`, and Chinese or Korean.

## Text shaping: bundled HarfBuzz (owner, 2026-09-28)

- **Dragon shapes text with HarfBuzz,** the shaper Chrome uses, pinned to Chrome 145's revision (fa2908bf16d2ccd6623f4d575455fea72a1a722b). It replaces the platform shapers.
  - One small shim (Zig, see below) is built three ways: WASM for the compiler, the TypeScript reference engine and tests; an iOS xcframework; and an Android .so.
  - It installs Chrome's advance function, 16.16 fixed point.
  - Only integer results cross into the engine, so Node, Swift and Kotlin stay bit-identical.
- **This amends two earlier sections:**
  - "Text strategy": advances now come from HarfBuzz, not the platform. Dragon still owns line breaking.
  - "Native glyph advances": advances follow Chrome's 16.16 path with float accumulation.
- **Zig for the shim and the build (owner, 2026-09-28).**
  - HarfBuzz stays upstream C++, unmodified at the pinned revision; exactness depends on running Chrome's code.
  - The shim is Zig (`dragon_hb.zig`), and `zig build` cross-compiles HarfBuzz and the shim to WASM, iOS (device and simulator) and the Android ABIs from one toolchain, matching yuku. Zig 0.16 is installed.
  - Zig does not contract floating-point multiply-add implicitly, which supports bit-identical results across targets.
  - This does not change the layout-engine decision ("Not chosen: a Rust or Zig core").
- **Cost:** about 0.5–1 MB per CPU architecture. HarfBuzz is MIT-style licensed, so apps carry a notice.
- **Gate:** before any engine change, WASM HarfBuzz plus the shim must reproduce Chrome's LU widths on all 620 spike paragraphs. A mismatch goes back to the owner.
- **Design:** docs/research/text-plan-summary.md.

## Device text size (owner, 2026-09-28)

- **The device text size scales the root font.** The iOS Dynamic Type size and the Android font scale set the root element's computed font size, so every `rem`, and every `em` chain from the root, follows the device setting. Explicit px font sizes do not.
- **Proof:** Chrome is captured with the scaled root size injected (`:root { font-size: <scaled>px !important }`) from a pinned table of iOS content-size categories and Android font scales. The native hosts report their root size in the device dump. See docs/research/engine-value-model-plan.md §3.
- **Until the engine value model (V2) lands:** native support rows for sizes that depend on `rem` are `caveat` at any text scale other than 1.

## Vertical font metrics rounding (T082 research)

- **One traced rule replaces both earlier rules** (half-up from T005, half-down in the engine). Core Text quantises each ascent, descent and line gap to a 16.16 fraction of the em: `(round(u*65536/upem)*upem/65536)*(size/upem)`. Skia keeps that value as a float, and Blink rounds it with `floorf(x+0.5f)`. This predicts all 129 Chrome rows at DPR 1, 2, 2.625 and 3, and every Core Text value across 8 faces. Half-up missed 79 rows and half-down missed 56. For Ahem the rule equals today's engine up to 662.5 px, so no existing output changes. TXT1a-1 adopts it.

## Real-font text in the engine (PM, T056 research)

- **Shaping interface.** The engine uses the bundled HarfBuzz shim through an integers-only `GlyphShaper` interface: WASM for the TypeScript engine, the C ABI for Swift, JNI for Kotlin. All float and layout-unit arithmetic stays in the translated engine.
- **Shared vectors.** Real-font vectors carry shape transcripts that the Swift and Kotlin harnesses replay. Shim equality is proven separately on the host and on device.
- **Scope.** Latin only, using a pinned Unicode 16.0.0 script table. Italic advances need Chrome cases. Synthetic bold and oblique are refused. Native refuses variable faces until TXT1b.
- **Glyph edges (T093 ruling).** Chrome on macOS draws glyphs with a private Core Graphics smoothing fringe that no native renderer can match. So pixel colour points stay 2 device px (SAMPLE_INSET_DEVICE_PX) clear of every glyph box edge and seam, checked by a committed Chrome calibration set up to 192 device px. A glyph centre check (GATE_GLYPH_CENTRE_DEVICE_PX = 0.5) catches 1-px glyph shifts regardless of the fringe. Planted faults are judged against a clean run. Raising k or the centre gate counts as loosening. Chrome's fringe is top-only (the bottom edge is fringe-free within 0.04 px), so vertical glyph position is checked on the bottom edge (GATE_GLYPH_POSITION_DEVICE_PX = 0.5, calibration bound 0.1). Box-edge points that fall near glyphs keep every pixel that is individually clear. iOS draws glyphs with Core Graphics subpixel positioning.
- **Text pixels.** Ink bounds must match within 1 device px. A coverage threshold is measured on a separate calibration set and written into the test; widening it later counts as loosening.
- **Order.** P5, V1 Phase B, V2a, INL1a, TXT1a-1, INL2, TXT1a-2, INL1b.

## Adding engine fields and CSS longhands (PM rulings, T050 and T113)

- **New engine input fields are required,** with an explicit neutral value when unused (for example `aspectRatio: auto`). The translator subset has no optional fields, and inputs are fully specified.
- **Migration rule.** Existing vectors are migrated by their generators only. Each gains only the new key, and outputs stay byte-identical. A committed check proves this. This is the rule approved for V2a.
- **New CSS longhands are real longhands.** Captures gain their computed values, and emitted CSS gains their declarations. A committed checker must prove the change is additive only: boxes, lines, other values and vectors are byte-identical. Any other difference is a stop.

## Paint (PM, T046 research)

- **Dragon draws:** border-radius, box-shadow, outline and gradients. The native APIs cannot match Chrome: they allow only one radius and clip at the outer edge, CALayer shadows have no spread or inset, and native gradients interpolate unpremultiplied.
- **Native properties stay:** for opacity and for displaying transforms (Dragon resolves the matrix). z-index is compile-time paint order with re-hosting under the stacking context.
- **Scrolling:** native scroll views sized by the engine. `position: fixed` is counter-offset in the same frame.
- **The emitter split (EMS) comes first.** It lands after P5 and V1 Phase B and changes no output, so the paint packages can run in parallel in separate files.
- **Allowances:** only the shadow-blur and gradient pixel checks may carry a measured allowance. It must be at most 2 channel levels, kept in its own file and recorded here, and any row that depends on it is caveat.
- **Chrome rasterises in software with Skia (T085).** Skia is pinned at 2ab8add5. The lanes check this through CDP SystemInfo as a precondition.
  - Dragon ports Skia's blur (the analytic BlurRect and the triple-box SkMaskBlurFilter) and the 8x8 gradient dither exactly, instead of using allowances.
  - Rounded-corner antialiasing becomes an exact port of Skia's analytic AA (SKIA-AA). Until then, arc pixels fall under the existing 1-device-px edge rule, radius rows stay caveat, and no allowance is added.
- **P6 is split:** P6a fix and promote, P6b accessibility, P6c selection, P6d editing, P6e keyboard focus.

## Runtime styles and animation (PM, T047 research)

- **States:** finite states compile to typed tables of changes over one base program. Each state's own compiled program is the reference the device must equal after any sequence of state changes.
- **Animation frames:** Dragon computes every frame from a translated port of Chrome's `gfx::CubicBezier` and timing model, checked bit for bit against Chrome's `getComputedTiming`. Core Animation and Android animators are not used; Android's curve approximation misses the 1 device px gate. Handing work to the compositor is a later performance package, allowed only once it proves equal frames.
- **Clock:** on device, lane runs use a virtual clock equivalent to Chrome's frozen timeline.
- **Hit testing:** Dragon does its own, checked against Chrome's `elementFromPoint`.
- **Hover and focus:** tap behaviour follows recorded Chrome traces.
- **Script-set text (T068):** a text slot is a format template over typed integer inputs (the music player's time labels are '{m}:{s:02}'), so every possible string is proven against Chrome at build time. A write re-runs layout with the HarfBuzz shaper, with no width tables. Free-form dynamic text is refused for now (DTXT2).
- **Script-set styles:** these become typed override slots with declared ranges. The music player's progress bar is `translateX(p%)`. Script-set text is covered by DTXT.

## Inline layout (PM, T044 research)

- **The work is split:**
  - INL-P: a Chrome probe corpus.
  - INL-U: UA data for phrasing tags.
  - INL-BF: span, a and label in contexts where CSS makes them block boxes.
  - INL1a: the inline core. It wires the UAX #14 breaker and linefit, and replaces P5's single-font line export for every caller.
  - INL1b: inline-box decorations.
  - INL2: atomic inlines.
- **Serial order on inline.ts and text.ts:** P5, then V1 Phase B, then V2a, then INL1a, then TXT1a, then INL2, then INL1b. INL2 may go before TXT1a if TXT1a is not ready.
- **Native drawing uses no platform attributed strings.** Each text leaf is one view that draws its own glyphs at positions from one translated engine function. An inline box is an unpainted box view.
- **Links:** `href` stays refused until TDEC, because Chrome's UA underline is not modelled yet.
- **Bold and italic:** b, strong, em and i are accepted on web and refused on native until TXT1a.

## Images, web views and form controls (PM, T045 research)

- **Image sources.** An image is a `data:` URL or a local file mapped as an asset. An unmapped remote URL is a build error, as with fonts. Each asset's sha256 enters the compilation digest.
- **Formats.** The format is read from the file's bytes. REPL-a accepts only 8-bit untagged or sRGB PNG, the one format that decodes identically in Chrome, on iOS and on Android. JPEG becomes a build-time transcode using Chrome's pinned libjpeg-turbo.
- **Sizing.** An image's natural size is a build-time constant from its header. Replaced sizing runs in the engine.
- **object-fit.** The engine computes where the image goes and Dragon draws it; UIImageView and ImageView scaling modes are not used. The proof is Chrome's boxes plus a quadrant screenshot probe, which must match within 1 device px.
- **Image pixels.** They are compared only where the source is flat, under the unchanged pixel gate. No allowance is added.
- **Iframes.** An iframe is a 300x150-default replaced slot hosting WKWebView or android.webkit.WebView. It is tested on frames and applied values only, with its content masked out and no network.
- **Form controls.** Controls expand to Chrome's own UA shadow structure, measured through CDP. Buttons and ranges painted by CSS are Dragon-drawn, with native plumbing (UIControl and View, SeekBar accessibility). Press visuals come from CSS only. Natively themed controls are a later package.

## How decisions are made (owner, 2026-09-28)

- **Decisions come from research, not the owner.** Every open question is settled by researching the space: Scout evidence, Chrome measurements, specifications and precedent. The result is recorded here as a PM ruling. Earlier text that sends a question "to the owner" now means a research-backed ruling.
- **Exceptions.** The owner still decides anything outside the repo or that costs money: pushes, remotes, publishing, installs outside /tmp, and spending.

## Native viewports, text scale and device sizes (owner, 2026-09-28)

- **Viewport units and safe areas:** on iOS and Android, the small, large and dynamic viewports (`sv*`, `lv*`, `dv*`) all equal the Dragon root view's bounds. The on-screen keyboard does not resize them. `env(safe-area-inset-*)` is the root view's own insets, in CSS px.
- **The root font always scales with the device text size,** even when it is set in px. The root size at scale 1 is scaled by the platform API (UIFontMetrics on iOS, the font scale on Android). This matches the Chrome reference, which injects the scaled root size with `!important`. Descendants set in px do not scale.
- **Oversize test cases get bigger devices.** When a fixture's viewport does not fit the default simulator or emulator, Dragon provisions a larger one and never crops a case. A size no device can hold goes back to the owner.
- **The engine value model is approved (V2a).** The compiler still folds everything it can at build time. Values that depend on the device (the text size, the viewport, the safe area) are resolved by the shared engine on device. Every vector input is migrated by its generator only, every existing output stays byte-identical, and no field gets a default. If an existing output changes, the Worker stops and asks the owner.
- **Pinned generic fonts (PM, T033).** `sans-serif` maps to "Dragon Sans", the five vendored static Inter 4.1 faces. `monospace` maps to "Dragon Mono" (Noto Sans Mono). Compiled web CSS rewrites the family and emits `@font-face` rules. The Chrome reference applies the same rewrite inside Chrome's own CSSOM. There is no built-in default map: an unmapped generic or family is a build error with a fix.
- **The north star bundles Lato (PM, T035 research).** The demo CSS names `'Lato', sans-serif`, and the design is the authored CSS (course correction 4). Earlier renders showed Helvetica only because Lato was never loaded. Dragon vendors Lato 2.015 Regular and Bold from the Google Fonts build: googlefonts/LatoGFVersion 080cb697, whose OS/2 metrics equal hhea. The files are sha256 d636e468… (Regular) and 8a0aace7… (Bold). The font map maps `Lato` to them, and `sans-serif` stays pinned to Dragon Sans. Lato is labelled exact only after Lato 400 and 700 Chrome cases pass in the font captures, the HarfBuzz gate and TXT1a. The pause symbol ❚ (U+275A) is in neither Lato nor Inter, so the symbol-fallback work (TXT1d) must add a bundled symbol font for it.
- **Italic `ch` is caveat (PM, T005).** Chrome's `ch` for italic-trait faces differs from the Blink port by 1 float ulp in 4 of 1,040 captured rows. It is a Core Text italic-trait dependence that the source does not explain. The label stays caveat until TXT1a proves it on the HarfBuzz advance path.
- **Variable fonts are fenced (PM, T024).** Until more Chrome cases validate them, Dragon refuses variable-font instances outside the tested set (Inter VF at its default instance) and variable fonts without HVAR.

## Native glyph advances (PM, 2026-09-28)

- **Glyph advances come from the font's integer units:** the `hmtx` table, scaled by size / unitsPerEm, as HarfBuzz does in Chrome. They do not come from platform float measurement. On Android, `Paint.getRunAdvance` returned 999.99609375 units for Ahem's 1000-unit glyphs, which could flip a 1/64 px truncation. Platform measurement stays only as an evidence probe.
- **Shaped advances** (kerning and GPOS) for real fonts are designed in the real-font text package, also in font units.
- **Dragon positions every glyph (PM, T014).** The platform only rasterises glyphs at the engine's positions: `CTFontDrawGlyphs` on iOS and `Canvas.drawGlyphs` on Android. Android's floor is API 31, so there is no fallback path (decision 6). Android's own run drawing placed each Ahem glyph 1/256 px short, which drifts about 1 px per 256 glyphs. Text is exposed to accessibility through view properties. Accessibility parity is P6. Selection and editing of custom-drawn text follow the owner ruling in "Text selection and editing".

## Text selection and editing (owner, 2026-09-28)

- **Dragon builds selection and editing for the text it draws, with a native feel.** Dragon places every glyph, so the platform text views cannot select or edit that text themselves. Dragon implements:
  - hit-testing from the engine's glyph positions;
  - selection ranges, handles, the loupe or magnifier, and the copy menu;
  - caret movement and text input for editable fields.
- **Native feel:** gestures, handle appearance, menus, haptics and keyboard behaviour follow each platform's conventions (UIKit on iOS, Android Views on Android). Text reaches the platform through the platform text-input and accessibility protocols, so system features such as copy, the keyboard and VoiceOver or TalkBack keep working.
- **Proof:** behaviour is tested on both platforms at parity, alongside the accessibility-parity work (P6).

## Selectors and scrollbars (owner, 2026-09-28)

- **Provable selectors are allowed.** Any selector, including siblings, `:nth-*`, `:not`, `:is`, `:has` and attribute selectors, compiles when the compiler can prove its match on the fixed element tree at build time. Selectors that depend on state follow the existing finite-state rules. This extends the authoring rule in "Direction".
- **Scrollbars (corrected by T070 research, 2026-09-28).** Chrome is captured with `--hide-scrollbars`, which creates no scrollbars at all: no gutter and no thumb (Blink paint_layer_scrollable_area.cc:1773-1781). Layout therefore matches iOS and Android. Device lanes compare frames at rest, where no scrollbar is shown. While scrolling, the platform's own scroll indicators appear as native feel. `::-webkit-scrollbar` is ignored wherever Chrome ignores it, including whenever scrollbar-width or scrollbar-color is set (computed_style.cc:2508-2511); the music player's rules are all ignored for that reason. Dragon-drawn honoured scrollbar styling (OVFL-S) is off the checkpoint 3 path.

## Pitfalls handled by design (docs/research/pitfalls.md §6)

1. **Build the web preview from the compiled result** when a native target is configured. Tests also render the author's original CSS in Chrome and require the same boxes. Where an approved web change, such as `vh` becoming `dvh`, legitimately changes boxes, that change is tested against its own stated reference.
2. **Fail the type check for any configured target.** The web page keeps rendering while the developer fixes the error.
3. **Copy Chrome's built-in element styles onto native,** captured from Chrome's computed values. New projects start with a reset that applies to both platforms.
4. **Withdrawing support:** a warning period is allowed only while the old implementation is still available and still proven at the fidelity it advertised. A support row that loses its proof or its output blocks immediately, following the fail-closed rule. This is a correction from the Codex API review.
5. **Text size:** `rem` sizes follow the phone's text-size setting and `px` sizes don't. Every component is tested at the largest text size automatically. Text clipped by a fixed-height box at that size is a warning.

## Platforms (docs/research/platform-playbook.md §7.2)

6. **Minimum versions:** iOS 15, Android 12 (API 31; raised from Android 10 on 2026-09-28 by the owner so Dragon can position glyphs with `Canvas.drawGlyphs`), macOS 13, with higher tiers for newer techniques. Owner policy (2026-09-28): be practical, like browser support tables such as caniuse. The floors stay at iOS 15 and Android 12 and are raised case by case when a platform feature beats a custom workaround. Dragon does not build fallbacks for older OS versions. Device share at these versions is still to be confirmed.
7. **Text strategy:** the native text engines handle breaking, shaping, fallback, right-to-left, selection, accessibility and editing. Dragon owns the line box, meaning each line's height and baseline, with Chrome's rounding, set through each engine's per-line hooks. *Superseded in part (2026-09-28):* Dragon now owns line breaking ("Text strategy"), shaping with bundled HarfBuzz ("Text shaping") and glyph positions ("Native glyph advances"). Selection and editing follow "Text selection and editing" (owner, 2026-09-28): Dragon builds them.
8. **Expensive techniques are allowed,** such as paint islands, snapshot blur and live backdrop blur. Every use is listed in the build summary.
9. **Scroll snap counts as "caveat"** when snap positions match Chrome and the motion is native.
10. **macOS stays in the model and the support profile now.** It is built after iOS and Android.
11. **First platform:** iOS with UIKit views, then Android. Email is a parallel, low-cost track. The web view shell is only a fallback for individual screens.

## Testing (docs/research/testing-plan.md)

12. **The tests live in the Dragon repo.** Markless runs a smaller set of its own components through them.
13. **Tolerance:** boxes must match within one physical screen pixel. Text-heavy tests may carry a measured allowance that is written into the test. Tolerances change only with owner approval.
14. **The iPhone simulator lane starts report-only.** It becomes blocking after two weeks without unexplained failures.
15. **No paid email-client screenshot service** until the email target is being built.

## API (docs/api.md)

16. **Framework source readers:** frameworks provide their element trees first. Optional Dragon-maintained source readers (TSRX, JSX, HTML) come after milestone 1.
17. **Changing style values:** the first release supports a known set of states, such as on/off or open/closed. Arbitrary changing numbers, like progress from 0 to 1, come later with their own rules and tests.
18. **Bundled fonts** use shared line heights and baselines on web and native, adopted only after tests prove the differences they cause are explained.
19. **Minimum versions in configuration** default to decision 6. Projects only state them to raise the floor.
20. **Researched defaults in `docs/api.md`:** public lookups are limited to `explain` and support queries in milestone 1. The interface for adding platform implementations stays private until several Dragon implementations pass their tests.

## 2026-09-29: rulings from the ng-native comparison (notes/NG-NATIVE-comparison.md)

ng-native (launched 2026-09-29) is Angular on React Native Fabric with Yoga layout. It matches CSS on the device and checks against Chrome only on the host. Rulings, by research:
- **TW-SWEEP (dispatched):** every Tailwind v4 utility must compile, or be refused with a named diagnostic, on every target. The snapshot is reported next to the WPT score.
- **Runtime value slots:** SOV (T066) grows typed colour and index slots. Data-driven colours use `color-mix()` and relative colours, through a translated port of Chrome's colour code, proven against Chrome over sampled inputs.
- **Host-view slot:** the iframe/web-view slot (REPL-a, T051) becomes a general host-view slot for any native view (maps, video, camera). It is tested on frames and applied values, with its content masked.
- **KBD:** a new package after V2b (T027) and MQ-R (T067), before FORM-a Phase B (T052). It adds `env(keyboard-inset-*)`, and the layout follows the keyboard.
- **ANIM-S:** scroll-driven animation (`animation-timeline: scroll()`), after ANIM-b (T065) and OVFL (T078). It reuses the timing port, and is proven at sampled scroll offsets.
- **Accessibility, Bold Text:** Dragon draws its own glyphs, so the OS Bold Text setting must be applied by Dragon: +300 `font-weight`, clamped at 900, the way iOS applies it. Live text-size changes are part of MQ-R. Both are proven with injected settings.
- **Not adopted:** warn-and-still-build for unsupported CSS. Dragon keeps failing the build; an `explain` migration report gives the same adoption help.
