# T035: How cross-platform rendering and CSS parity is tested automatically (Scout)

Owner request, 2026-09-26: prove CSS parity across web, iOS, Android and email "without a human constantly doing QA", ideally web and platform side by side, with visual diffs that show what was applied, and failures an AI agent can read and fix.

Read-only research. Inputs: T035 card, `css-support.md` (summary), `T030-agent-guardrails.md`. All web sources accessed 2026-09-26. "Unverified" marks claims taken from secondary summaries or my own inference, not from a primary source I read.

## 1. Answer in plain words

- **The most reliable oracle is numbers, not pictures.** Taffy and Yoga, the two layout engines Markless would ship, are themselves tested by laying out HTML fixtures in headless Chrome, reading every box's position and size, and comparing those numbers to the engine's output. Taffy has 1,548 such fixtures. This catches layout bugs exactly, never flakes on anti-aliasing, and gives a failure an agent can act on ("node 3 width expected 120, got 118").
- **Also compare the applied style values, not only the boxes.** Chrome's `getComputedStyle` gives the resolved value of every property; the native side can dump what it actually set on each view (colour, corner radius, border width, font size, opacity). Comparing the two catches wrong mappings and wrong cascade results before any pixel is drawn.
- **Pixel diffs between web and native will never be zero.** Fonts, anti-aliasing, shadow blur and gradient dithering differ by design (css-support.md already says "close, not pixel-identical"). Every mature tool that compares pixels only compares like with like: same OS, same simulator, same browser build. Cross-platform screenshots are useful as evidence images beside a numeric failure, and as tolerance-bounded checks on a small set of paint-only fixtures, not as the main gate.
- **Reftests are the trick that makes pixel checks work on one platform.** A reftest renders two different inputs that should look identical (for example `border-radius` versus a pre-clipped shape) in the *same* renderer and compares them. Renderer noise cancels. Servo, Blitz and Ladybird all run the web-platform-tests (WPT) reftests this way against engines that are not Chrome.
- **Screenshots from the same platform catch regressions**: Flutter goldens, swift-snapshot-testing on iOS, Paparazzi or Roborazzi on Android (these two render Android views on a normal JVM with no emulator). They say "this changed", not "this is correct".
- **Multimodal models are not reliable judges of CSS differences.** In DiffSpot (May 2026), where each image pair differs by one CSS property on a web page, the best of 13 frontier vision models found 40.7% of real changes, and every model found fewer than 23% of the hardest ones; several reported changes where there were none. Use models to describe a failure that a numeric or pixel check already found, never to decide pass or fail.
- **Devices are the flakiest part.** One cited report: 25% of Android emulator tests flaky versus 1.7% of all tests. iOS simulator boots occasionally hang. Keep the per-change gate on Linux (Chrome, Taffy, JVM rendering) and run simulators and emulators for what only they can prove, with pinned images and one retry for boot only.
- **Email cannot be rendered locally for the clients that matter** (classic Outlook uses Word). The automatable parts are static checks against caniemail data, snapshot tests of the generated HTML, and paid cloud screenshot services (Litmus, Email on Acid) run nightly or before release.
- **Cost:** GitHub-hosted macOS minutes cost about 10 times Linux ($0.062 vs $0.006 per minute on private repos; standard runners are free on public repos) and most plans cap macOS at 5 concurrent jobs.

## 2. Landscape: what exists, what works, what is flaky

### 2.1 Geometry oracles: laying out in Chrome, comparing numbers

| System | How it works | Tolerance | Evidence |
|---|---|---|---|
| **Taffy gentest** | Rust tool downloads Chrome for Testing, drives it through WebDriver (`fantoccini`) with `--headless --disable-gpu`. For each HTML fixture, `test_helper.js` walks the DOM and records style plus `getBoundingClientRect()` / `offsetLeft`/`offsetWidth`, `scrollWidth`, resolved grid tracks. Emits an expected-layout XML tree per fixture: `x, y, width, height`, scroll sizes, resolved rows/columns. | Two layouts per node, `smartRoundedLayout` (integer, matching Chrome's rounding) and `unroundedLayout` (float); a fixture picks one via `useRounding`. Values are asserted as recorded. | 1,548 `test_fixtures/*.html` on `main`. Base CSS pins the **Ahem** font ("the X glyph ... is exactly 10 pixels wide by 10 high"), `line-height: 1`, `font-size: 10px`, 15px scrollbars (asserted non-zero), `box-sizing`, zeroed margins. https://github.com/DioxusLabs/taffy/tree/main/scripts/gentest (`src/main.rs`, `test_helper.js`, `test_base_style.css`) |
| **Yoga gentest** | `gentest-driver.ts` runs Selenium Chrome with `--force-device-scale-factor=1 --hide-scrollbars`, loads each fixture in LTR and RTL variants, and the page logs generated C++ and Java test source for each fixture. | Generated asserts on layout values. | Ships `gentest/fonts/Ahem.ttf`. https://github.com/facebook/yoga/tree/main/gentest |
| **React Native Fantom** | Headless C++ host running real Hermes + Fabric + Yoga, no device. Renders the mount tree as a deterministic JSX-like string including layout values; tests assert inline. Described by a third party as "a semantic golden image with no pixels and no flaky diff". Runs on Linux in public CI. | Exact string match. | **Unverified** (third-party descriptions, not RN docs): https://github.com/react-native-linux/react-native-linux/issues/210 ; source path `private/react-native-fantom/` in facebook/react-native. |

What this oracle catches: box position and size, flex/grid/block algorithm errors, percentage and `calc` resolution, scroll extents, RTL. What it misses: paint (colour, radius, shadow), clipping, z-order, text shaping with real fonts (Ahem deliberately removes that), hit testing, accessibility. Flake: effectively none; there is no rasterisation. Cost: one headless Chrome run per fixture, milliseconds each.

Implication for Markless (inference): because iOS and Android both lay out with Taffy, a native geometry mismatch has only three possible sources: (1) Markless's CSS-to-Taffy style mapping, (2) the native text measurement callback, (3) the step that copies Taffy boxes onto views (point/pixel rounding). (1) can be tested on Linux with no simulator by feeding the compiled style table to Taffy with an Ahem measure function and comparing to Chrome. Only (2) and (3) need a device.

### 2.2 Applied-value oracles

- Chrome side: `getComputedStyle` is already read by Taffy's helper (for `position` and style extraction). Taffy's generated fixture records both the input style and the output layout, which is the exact shape of a computed-value oracle.
- Native side: no public project found that dumps applied UIKit/Android view properties and compares them to Chrome's computed styles. Closest: Roborazzi's optional "UI tree dump" writes a machine-readable JSON sidecar next to each screenshot "providing exact component bounds and properties for AI agents or tools" (https://github.com/takahirom/roborazzi). Android `uiautomator dump` and iOS `XCUIElement.frame`/`debugDescription` give bounds but not paint properties (standard platform knowledge; **unverified** here).
- Markless can do better than both because it owns the runtime: the Swift/Kotlin applier can emit a JSON record of every property it set on every view (`backgroundColor`, `layer.cornerRadius`, `layer.borderWidth`, font descriptor, `alpha`, transform) keyed by the same node id the web fixture uses. That comparison needs no pixels and no screenshots.

### 2.3 Reftests and WPT against non-browser renderers

- WPT reftest rules: `<link rel=match|mismatch>`; "A match test only passes if the two files render pixel-for-pixel identically within a 800x600 window including scroll-bars if present"; tolerance via `<meta name=fuzzy content="maxDifference=15;totalPixels=300">`, ranges allowed; `reftest-wait` delays the capture. https://web-platform-tests.org/writing-tests/reftests.html
- **Servo** keeps expected results in `.ini` files under `tests/wpt/meta/`, allows several results for intermittent tests (`expected: [PASS, TIMEOUT]`), retries unexpected results once and ignores a pass on retry, and ships a reftest analyzer for pixel-level inspection. It names screenshot timing (for example web fonts loading) as a common cause of flaky reftests. https://book.servo.org/contributing/guides/diagnosing-errors/intermittent-wpt-errors.html ; https://web-platform-tests.org/tools/wptrunner/docs/expectation.html
- **Blitz** (Dioxus, Rust HTML/CSS renderer using Taffy) has its own WPT runner that renders HTML to a buffer. PR #936 (merged 2026-09-24) made it wait for timers, `requestAnimationFrame` and `reftest-wait` like wptrunner: 148 FAIL to PASS, 17 PASS to FAIL (the latter had passed only because the screenshot was taken too early), 16,774 passing. Still missing: the `TestRendered` event and waiting on `document.fonts.ready`. Results are archived in `DioxusLabs/blitz-wpt-results`; dashboard scoring changed from "percent of tests run" to cross-engine union denominators, so older percentages are not comparable. Tests that hang are listed in `wpt/runner/timeout-quarantine.txt`. https://github.com/DioxusLabs/blitz/pull/936 ; https://github.com/DioxusLabs/blitz-wpt-results ; https://github.com/DioxusLabs/blitz/issues/863
- **Ladybird** publishes nightly full-WPT runs to wpt.fyi, but does not run upstream WPT per PR because it "takes ~5.5 hours, many timeouts". Instead `Meta/WPT.sh import` copies selected tests into `Tests/LibWeb/.../wpt-import` with expected output files, and in-tree tests are Text, Layout, Ref or Screenshot tests. A September 2026 upstream update that waits for fonts fixed "a flake that has been plaguing our CI". https://github.com/LadybirdBrowser/ladybird/blob/master/Documentation/Testing.md ; https://github.com/w3c/tpac2024-breakouts/issues/56 (summarised by search, **partly unverified**)
- **Lynx**: `lynx-stack` runs Playwright screenshot tests (`web-core-e2e`, 361 cards, only 70 with screenshots; the rest use DOM assertions). A third-party renderer (`lynx-vello`) reuses those cards as a conformance suite: boot each card natively, capture, and compare to Chrome's screenshot of web-core rendering the same source, with a pixelmatch port set to Playwright's tolerances. That is the closest published analogue to "Markless native vs Chrome side by side". https://github.com/PupilTong/lynx-vello/pull/329 ; https://lynxjs.org/react/reactlynx-testing-library (search summary, **partly unverified**)

What this means for Markless: most WPT CSS tests use features outside the native profile (floats, inline layout, tables, scripts). A usable subset is the reftests in `css-flexbox`, `css-grid`, `css-box`, `css-backgrounds` (radius/colour), `css-values` whose features are all profile-supported. They would need translation from HTML to Markless fixtures and must be rendered both test and reference *by the native renderer*. Pass rates should be tracked with an expectations file per target (Servo's model), plus an in-repo imported subset with expected results per PR (Ladybird's model), since the full suite is too slow per change.

### 2.4 Same-platform screenshot (golden) testing

| Tool | Where it renders | Known flake / limits | Source |
|---|---|---|---|
| Flutter `matchesGoldenFile` | In-process test renderer; default font Ahem | "a golden file generated on Windows with fonts will likely differ from the one produced by another operating system"; goldens can break across Flutter versions. Engine uses Skia Gold with fuzzy keys (e.g. `fuzzy_max_different_pixels:7864 fuzzy_pixel_delta_threshold:8`). Team policy (2022): Skia output pixel-perfect, fuzzy only for browser HTML renderer, "percentage-based thresholds had proven risky". Engine Gold had "100+ untriaged results every day"; Android emulator goldens flaky with 2-pixel diffs. | https://api.flutter.dev/flutter/flutter_test/matchesGoldenFile.html ; https://github.com/flutter/flutter/issues/143591 ; https://github.com/flutter/flutter/issues/159153 |
| swift-snapshot-testing (iOS) | In the XCTest process on a simulator; can render several device sizes and trait collections from one simulator | "Snapshots must be compared using the exact same simulator that originally took the reference". Apple Silicon vs Intel produce different pixels, even under Rosetta; `perceptualPrecision` (added in PR #628) plus `precision` below 1 (e.g. 0.98/0.99) are the usual fix; one report of the perceptual score not matching perception. | https://github.com/pointfreeco/swift-snapshot-testing ; issues #424, #673; discussion #656; PR #628 |
| Paparazzi (Android) | JVM, Android Studio's layoutlib, no emulator | Linux vs macOS differ in text anti-aliasing; a layoutlib upgrade measured text "~2px wider", causing re-wrapping; colour shifts after layoutlib 15.2.3 to 16.1.1; shadows diverge for some components. | https://github.com/cashapp/paparazzi ; issues #1465, #2409, #2233 |
| Roborazzi (Android) | JVM via Robolectric Native Graphics | Supports interactions and Hilt; UI-tree JSON sidecars; optional AI assertions (below). | https://github.com/takahirom/roborazzi |
| Maestro | Real simulator/emulator via XCUITest / UIAutomator | Auto-retries each command against the latest view tree. `assertScreenshot` default threshold 95% of pixels, `cropOn` to isolate an element; 2.6.0 fixed a scale mismatch in the reported match percentage. Third-party guide: still struggles with deeply nested custom native views. | https://docs.maestro.dev/reference/commands-available/assertscreenshot ; https://maestro.dev/blog/maestro-cli-v2-6-0 ; https://www.netguru.com/blog/maestro-tool-automated-testing-for-mobile |
| Playwright `toHaveScreenshot` | Browser | "Browser rendering can vary based on the host OS, version, settings, hardware, power source ... headless mode"; baseline file names carry browser and platform (`chromium-darwin`). | https://playwright.dev/docs/test-snapshots |

Note on Maestro's 95% default: 5% of a phone screen is tens of thousands of pixels; Chromatic warns a loose threshold (0.8) "can be enough to stop Chromatic from accurately detecting changes, such as positioning". Loose whole-screen thresholds hide exactly the layout shifts parity testing is for.

### 2.5 Diff methods and tolerances

- **pixelmatch**: YIQ perceptual colour difference with anti-aliasing detection; default `threshold` 0.1; `includeAA` false; writes a diff image. https://github.com/mapbox/pixelmatch
- **odiff**: same YIQ approach in Zig with SIMD; ~6-7x faster than pixelmatch on a full-page screenshot (1.17 s vs 7.71 s); ignore regions; can compare images of different sizes; server mode. https://github.com/dmtrKovalenko/odiff
- **SSIM vs FLIP**: NVIDIA's "Understanding SSIM" argues SSIM's weaknesses matter most in rendering and recommends replacing it; FLIP produces a per-pixel map of what a human would notice when flipping between two images, validated on 1,500+ rendering pairs. FLIP's weakness: it ignores masking, so it can over-report. https://arxiv.org/pdf/2006.13846 ; https://dl.acm.org/doi/10.1145/3406183
- **Chromatic**: `diffThreshold` is a per-pixel colour tolerance (default 0.063), not a share of pixels; anti-aliased pixels are ignored unless `diffIncludeAntiAliasing`. https://www.chromatic.com/docs/threshold/
- **Argos**: auto-pauses CSS animations; recommends `--disable-lcd-text` and `--font-render-hinting=none`; flaky-change ignores are scoped to one diff fingerprint so a new regression still shows. https://argos-ci.com/docs/flaky-test-detection ; https://argos-ci.com/docs/sdks-reference/playwright
- **WPT fuzzy**: two numbers per test (max channel difference, count of differing pixels), both as ranges, stated in the test file. This is the most honest form: the tolerance is per fixture, written down, and reviewable.

How tolerances are set in practice: per fixture, from measured noise, with ranges (WPT, Skia Gold fuzzy keys); per platform pair when machines differ (swift-snapshot-testing precision); never as a global percentage for correctness (Flutter policy, Chromatic warning). This matches the repo rule that a budget is raised only "with a measured, stated reason".

### 2.6 Flakiness sources and controls

| Source | Control | Evidence |
|---|---|---|
| Fonts and hinting | Ahem for layout fixtures; bundle exact font files for text fixtures; Chrome `--font-render-hinting=none --disable-lcd-text --disable-font-subpixel-positioning` | Taffy/Yoga/Flutter use Ahem; Puppeteer #2410; hinting flag cut Mac-vs-Ubuntu diffs to a tenth (Puppeteer #661, **unverified count**) |
| Colour management, GPU | `--force-color-profile=srgb --disable-gpu`; software raster | cypress-plugin-visual-regression-diff PR #421; https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md |
| Frame timing | Wait for fonts, two rAFs, explicit ready signal; Chrome `--deterministic-mode` + BeginFrame only if needed (experimental, headless shell only) | Blitz PR #936; Servo book; chrome-launcher docs |
| Device scale | Chrome `--force-device-scale-factor=1` (Yoga); native: fixed simulator model; compare in points, allow one device pixel | Yoga driver |
| Animations, caret | Disable (Playwright `animations: 'disabled'`, Argos pause); native `UIView.setAnimationsEnabled(false)` (**unverified** as a documented snapshot practice) | Playwright docs, Argos |
| iOS status bar, appearance, text size | `xcrun simctl status_bar <udid> override --time 9:41 ...` (re-apply after every boot; reports of `--time` broken in Xcode 14/15); `simctl ui <udid> appearance dark` (SIGKILL/timeout seen on a macOS 26 runner, fixed with timeout and one retry); `simctl ui <udid> content_size <category>` (**unverified**, not in any source I read; check `xcrun simctl help ui`) | https://www.jessesquires.com/blog/2019/09/26/overriding-status-bar-settings-ios-simulator/ ; https://developer.apple.com/forums/thread/728719 ; https://github.com/kaeawc/auto-mobile/issues/7605 |
| CPU architecture | Record and compare on the same architecture (arm64 macOS only) | swift-snapshot-testing #424 |
| Simulator boot | `simctl boot` then `simctl bootstatus -b` with ~3 min timeout and one retry; do not open Simulator.app; ~6 GB RAM per simulator | runner reports gathered by search, **unverified individually**: https://github.com/actions/runner-images/issues/12777 |
| Android emulator | KVM on `ubuntu-latest`; ATD images; AVD snapshot cache; `adb wait-for-device` + boot polling; separate job | https://github.com/ReactiveCircus/android-emulator-runner ; https://github.blog/changelog/2024-04-02-github-actions-hardware-accelerated-android-virtualization-now-available/ ; customerio-android PR #850 |
| Renderer upgrades | Pin layoutlib / Xcode / Chrome for Testing; re-baseline in the same change as the upgrade | Paparazzi #2409, #2233; Flutter #143591 |

Measured flake evidence: survey citing 25% of Android emulator tests flaky vs 1.7% of all tests, and one respondent attributing ~80% of flakiness to the environment (https://arxiv.org/pdf/2203.00483); Flutter emulator builder 3.03% flaky against a 2% threshold (https://github.com/flutter/flutter/issues/193205); only 10.6% of 4,518 Android repos with CI run instrumentation tests in CI, emulator setup being fragile (https://arxiv.org/html/2604.03438v1).

### 2.7 Accessibility tree comparison

- Web: Playwright `toMatchAriaSnapshot` stores a YAML tree `- role "name" [attr=value]`; one snapshot is shared across browsers. It checks structure only, not contrast or invalid ARIA. https://playwright.dev/docs/aria-snapshots
- iOS: `XCUIApplication.performAccessibilityAudit()` (Xcode 15, iOS 17) fails the test on contrast, element detection, hit region, description, Dynamic Type, clipped text and trait issues. https://developer.apple.com/videos/play/wwdc2023/10035/ ; https://www.polpiella.dev/xcode-15-automated-accessibility-audits/
- No project found that compares a web ARIA tree with a native accessibility tree automatically. A normalised form (role, name, state, order) is feasible because Markless owns both emitters (inference). It catches missing labels, wrong roles and reading order; it misses visuals entirely. The `textClipped` and `dynamicType` audits are the only native audits that touch CSS parity directly (text size and truncation).

### 2.8 Email

- caniemail: volunteers write HTML test files per feature (inline and `<style>` variants, several values), send them to real clients and record `y/n/a/u` per client version. About a sixth of the matrix is untested per one third-party count (**unverified**), and the npm package reports untested as partial. https://github.com/hteumeuleu/caniemail/wiki/Build-a-test ; https://www.caniemail.com/support/
- Static checks: Mailpit's HTML check scores a message against 175+ caniemail-backed checks, worst-case weighted, with an API usable in CI; it does not validate HTML or render. https://mailpit.axllent.org/docs/usage/html-check/
- Real-client rendering: Litmus Instant API (POST HTML, previews in ~10 s, 40+ clients) is sales-gated; last published price $500/month for 2,000 previews (**unverified**, from a third-party comparison). Email on Acid (now Mailgun Inspect) lists API access from $99/month with 1,000 previews (**unverified**, third-party). https://docs.litmus.com/instant ; https://www.emailonacid.com/pricing/
- Limits: classic Outlook's Word engine cannot run in a Linux container, so there is no local oracle for it. Client screenshots come back at client-chosen sizes with client chrome; pixel comparison across clients is not meaningful. Useful automated checks are: output HTML text snapshots, "every declaration is in the email profile" (T030), and per-client screenshot *regression* (same client, today vs last approved).

### 2.9 How agents consume visual failures

- **Structured text wins.** Playwright writes `error-context.md` with the error and an ARIA snapshot on failure and has a "Copy prompt" button for an LLM (1.51+); Roborazzi's UI-tree JSON is explicitly for "AI agents or tools". https://github.com/microsoft/playwright/issues/36485 ; https://dev.to/playwright/playwright-release-151-smarter-debugging-enhanced-reports-more-65l
- **Model judgment of screenshots is weak on exactly this task.** DiffSpot: single-CSS-property mutations on web pages, 4,400 pairs, best model 40.7% recall, all under 23% on the hard tier, false reports on unchanged pairs; difficulty is "property-dependent" and not predicted by pixel magnitude; bottleneck is "nameability, not visual salience". https://arxiv.org/abs/2605.29615 . "Vision language models are blind": four VLMs averaged ~58% on trivial geometry tasks (circle overlap, line crossings). https://arxiv.org/abs/2407.06581 . MLLM-as-a-Judge: good at pairwise comparison, poor at scoring and ranking, with bias and inconsistency. https://arxiv.org/abs/2402.04788 . RippleGUItester: 46.4% precision, with 45.6% of false positives caused by non-deterministic rendering and screenshot timing. https://arxiv.org/pdf/2603.03121
- **Agents with screenshot tools are not clearly better.** SWE-bench Multimodal: best system 12.2% at launch; 38% of SWE-agent M actions used browser/screenshot tools but the gain was "model-dependent and therefore ambiguous"; removing necessary images cut resolve rates up to 50%, so images help locate a problem more than verify a fix. https://arxiv.org/html/2410.03859
- **Where models do help:** describing a diff already found, with context. A canvas-bug study reports up to 100% per-application accuracy when the model gets documentation, bug descriptions and a bug-free reference screenshot (https://arxiv.org/abs/2501.09236). Roborazzi runs its AI assertions only when the pixel diff is non-zero, because they are "slow and expensive" (https://github.com/takahirom/roborazzi).

So the report an agent reads should lead with fixture id, node path, source file and line, property, expected value (web), actual value (target), difference and tolerance, and the profile row; then link the side-by-side and heatmap images as secondary evidence.

### 2.10 CI cost and time

- Per-minute (private repos, from 2026-01-01): Linux 2-core $0.006, macOS $0.062, Linux arm64 $0.005. Standard runners are free for public repos. https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/ (figures via search summary, **verify on GitHub billing docs**)
- Concurrency: Free/Pro/Team cap macOS at 5 concurrent jobs (Enterprise 50). https://docs.github.com/en/actions/reference/limits
- Markless CI today uses `ubuntu-latest` only (`.github/workflows/ci.yml`); T036 owns the repo-side map.
- iOS simulator boot ~1.5-2 min normally, occasional 3 min stuck boots; Android emulator boot up to 600-900 s timeouts reported on cold runners; JVM rendering and headless Chrome need neither.

## 3. Comparing the oracles

| Oracle | Catches | Misses | Flake | Agent-readable | Cost per fixture |
|---|---|---|---|---|---|
| Profile/static check (T030) | Unsupported CSS | Wrong implementations | None | Yes: file, line, fix | ~0 |
| Style-to-Taffy geometry on Linux (Chrome boxes vs Taffy fed by the compiled style table) | Mapping, cascade and value resolution affecting layout | Paint, real text, view application | None with Ahem | Yes: node, field, numbers | ms |
| Applied-value dump (Chrome computed style vs native applier log) | Wrong colour, radius, border, font, opacity mapping; missed properties | Whether the platform draws them as expected | None | Yes | ms after render |
| On-device geometry (view frames vs Chrome boxes) | Text measurement adapter, rounding, view nesting and clipping bugs | Paint | Low (boot flake only); text needs measured tolerance | Yes | simulator time |
| Same-renderer reftests | Paint equivalences (radius, borders, backgrounds) without cross-engine noise | Anything where test and reference share the same bug | Low; timing-sensitive | Medium: pass/fail plus diff image | render x2 |
| Same-platform golden screenshots | Any visual regression | Correctness | Medium; tied to OS, chip, renderer version | Low: needs image | render |
| Cross-platform pixel/perceptual diff (web vs native) | Gross paint errors on paint-only fixtures | Anything inside tolerance; never zero with text | High unless text-free and masked | Low: evidence only | render x2 |
| Accessibility tree (normalised) | Roles, names, order, clipped text | Visuals | Low | Yes | ms |
| Interaction scripts (Maestro/XCUITest) | Hit testing, scroll, focus | Styling detail | Highest | Medium | seconds |
| Multimodal model review | Describes a diff for humans | Unreliable detection (DiffSpot) | Non-deterministic | Prose | API cost |

## 4. Recommended oracle stack for Markless

Layer 0, every change, Linux: **profile check** from T030; unknown CSS fails the build.

Layer 1, every change, Linux, no device: **Chrome truth capture** in the Taffy gentest style. One fixture source (a `.tsrx` component with one `<style>`) is rendered in headless Chrome for Testing with pinned flags (`--headless --disable-gpu --force-device-scale-factor=1 --force-color-profile=srgb --font-render-hinting=none --disable-lcd-text --hide-scrollbars`), Ahem for layout fixtures. Capture per node: border box, content box, scroll size, and a fixed list of computed properties. Store as JSON expectations in the repo (regenerated only by an explicit command, like gentest).
- 1a: feed the compiled native style table into Taffy with an Ahem measure callback on Linux; compare boxes exactly (Taffy's rounded mode) or within 0.01 px unrounded.
- 1b: compare the compiler's resolved values for each native target against Chrome's computed values; differences must match a `caveat` row or fail.

Layer 2, when native, runtime, compiler-style or profile code changes, macOS arm64 (iOS) and Linux (Android): **on-device numeric parity**. Same fixtures, rendered by the real Swift/Kotlin applier in-process (XCTest host app on one pinned simulator model and runtime; Android via Roborazzi/Robolectric on the JVM if the Taffy native library loads there, else an ATD emulator). The runtime writes a JSON dump of view frames (points) and applied properties. Compare to Layer 1 expectations: frames within one device pixel (1/scale pt); properties exact or per the profile's caveat. Text fixtures with real bundled fonts get per-fixture tolerances recorded from repeated runs, each with a stated reason.

Layer 3, same trigger, same jobs: **same-renderer reftests** for paint rows (radius, border, background, gradient, shadow when enabled): each fixture has a reference written with simpler primitives; both rendered natively; pixelmatch or odiff with a WPT-style per-fixture fuzzy pair. Plus a curated, translated WPT subset with a per-target expectations file and a tracked pass count.

Layer 4, nightly and before release: **side-by-side evidence**. For every fixture, a composite image: web screenshot, native screenshot, pixel-diff heatmap (FLIP or pixelmatch), and an overlay of the Layer 2 boxes. Same-platform goldens catch regressions (swift-snapshot-testing precision/perceptualPrecision pinned; Roborazzi or Paparazzi on Android). Cross-platform pixel scores are recorded as trends, not gates, except on text-free paint fixtures with measured thresholds.

Layer 5: **accessibility**: normalised role/name/state tree compared web vs native; `performAccessibilityAudit` for `textClipped` and `dynamicType` on iOS.

Layer 6, a few flows: **interaction**: Maestro or XCUITest for hit areas, scrolling and focus; boot-only retry, no test retries.

Email: output-HTML snapshots and profile checks per change; Mailpit-style caniemail scoring; paid real-client screenshots (Email on Acid API is the cheaper published option) nightly or per release, compared per client against the last approved image; a human approves new client baselines.

Models: allowed to caption a failure already detected and to cluster diffs for a human; never to pass or fail a fixture.

Where a human is still needed: approving new golden baselines and new tolerances, the initial translation of WPT tests, and email client baselines.

## 5. Open questions for T036/T037

1. Can Taffy's native library load inside Robolectric/layoutlib on Linux, so Android Layer 2 needs no emulator? Not verified.
2. Is the Markless repo public (free standard runners, macOS included) or private ($0.062/min macOS)? `gh repo view` did not answer here.
3. Which simulator model/runtime is the single pinned reference, and does the owner accept "one device pixel" as the frame tolerance?
4. Budget for an email rendering service, or email stays at static checks until release.
5. Whether translated WPT reftests (licence: WPT is 3-clause BSD, **unverified** here) may be vendored into the repo.

```json
{
  "goalbuddy_receipt_v1": {
    "task": "T035",
    "type": "scout",
    "result": "done",
    "harness": "claude-code",
    "summary": "Numeric oracles (Chrome boxes and computed values vs engine/native output, the Taffy/Yoga gentest pattern) are the reliable, flake-free, agent-readable core; pixel diffs are trustworthy only within one renderer (reftests, same-platform goldens) and serve as evidence across platforms; multimodal models are unreliable judges of CSS differences (DiffSpot best 40.7% recall); devices are the flakiest layer, so the per-change gate should run on Linux and devices should run numeric dumps, not screenshots.",
    "evidence": [
      "notes/T035-testing-landscape.md",
      "https://github.com/DioxusLabs/taffy/tree/main/scripts/gentest",
      "https://github.com/facebook/yoga/tree/main/gentest",
      "https://web-platform-tests.org/writing-tests/reftests.html",
      "https://github.com/DioxusLabs/blitz/pull/936",
      "https://book.servo.org/contributing/guides/diagnosing-errors/intermittent-wpt-errors.html",
      "https://github.com/LadybirdBrowser/ladybird/blob/master/Documentation/Testing.md",
      "https://arxiv.org/abs/2605.29615",
      "https://arxiv.org/html/2410.03859",
      "https://github.com/pointfreeco/swift-snapshot-testing",
      "https://github.com/takahirom/roborazzi",
      "https://docs.github.com/en/actions/reference/limits"
    ],
    "facts": [
      "Taffy gentest: 1,548 HTML fixtures, headless Chrome for Testing via WebDriver, Ahem font, getBoundingClientRect/offset* per node, rounded and unrounded layouts.",
      "Yoga gentest: Selenium Chrome with --force-device-scale-factor=1, Ahem, LTR and RTL variants, generates C++ and Java tests.",
      "WPT reftest: pixel-identical in 800x600 unless per-test fuzzy maxDifference/totalPixels ranges.",
      "Blitz WPT runner: 16,774 passing after PR #936; 17 tests had passed only because capture was too early.",
      "Ladybird: full WPT ~5.5 h so not per PR; imports selected tests with expected output in-tree.",
      "DiffSpot: best VLM 40.7% recall on single-CSS-property diffs, all models <23% on hard tier.",
      "SWE-bench M: 38% of agent actions used screenshot/browser tools; benefit ambiguous.",
      "swift-snapshot-testing requires the exact same simulator; Apple Silicon vs Intel pixels differ.",
      "Paparazzi text width shifted ~2px across a layoutlib upgrade; Linux vs macOS anti-aliasing differs.",
      "Android emulator tests cited as 25% flaky vs 1.7% overall.",
      "GitHub macOS: $0.062/min vs Linux $0.006/min private; 5 concurrent macOS jobs on Free/Pro/Team.",
      "Markless CI runs ubuntu-latest only today."
    ],
    "contradictions": [
      "css-support.md says nothing counts as supported until a browser-vs-phone test passes; cross-platform pixel equality is not achievable, so that test must be numeric plus tolerance-bounded paint checks, not a pixel match.",
      "Maestro's default 95% screenshot threshold and loose Chromatic thresholds would hide layout shifts that parity testing exists to catch."
    ],
    "unverified": [
      "React Native Fantom details (third-party descriptions).",
      "simctl ui content_size syntax.",
      "Litmus and Email on Acid prices (third-party).",
      "Whether Taffy's native library runs under Robolectric/layoutlib.",
      "Repo visibility (public/private) for CI pricing."
    ],
    "ambiguity_requiring_judge": [
      "Frame tolerance on device (proposed: one device pixel).",
      "Whether Android Layer 2 runs on the JVM or an emulator.",
      "Email real-client rendering budget and cadence.",
      "Vendoring translated WPT reftests."
    ]
  }
}
```
