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
- **Overlay scrollbars.** Chrome is captured with overlay scrollbars, which take no layout space, so layout matches iOS and Android. Custom `::-webkit-scrollbar` styling that Chrome honours is drawn by Dragon on native. Styling that Chrome ignores is ignored too.

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
