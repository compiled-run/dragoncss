# T036 — Existing test infrastructure a web-vs-native CSS parity harness can reuse

Scout receipt note. Read-only survey, 2026-09-26, branch perf/packed-delivery.

## Summary

Markless already has a strong web side: real headless Chromium tests through Vitest browser mode, Playwright page probes in `@markless/analyzer`, built-page "witness boxes" (`@async/witness` 0.7.0), and a local CI runner that replays `ci.yml`. The only macOS CI lane today is the advisory VoiceOver job in `screen-reader.yml`. The native side is one small iOS proof (UIKit + JavaScriptCore, one XCTest, a simulator launch script) that no CI job runs. There is no visual-baseline tooling anywhere (no `toMatchScreenshot`, no pixelmatch, no swift-snapshot-testing), no geometry-capture helper, and nothing for Android.

## Reusable pieces

### 1. Vitest browser mode (web oracle runner)
- Files: `packages/vitest-browser/vitest.config.ts`, `packages/vitest-browser/browser/**` (225 entries), `packages/vitest-browser/src/{index,vitest,ssr-plugin,csr-islands,island-resume}.ts`; `packages/headless/components/vitest.config.ts`.
- What it does: compiles `.tsrx` fixtures with the `markless()` Vite plugin and runs them in real headless Chromium via the vite-plus Playwright provider. It covers CSR and SSR-resume modes (`testSSR` plugin). Runs serially (`fileParallelism: false`, measured reason in the config). Has custom browser commands (`parkPointer`).
- `__screenshots__` dirs: these are Vitest's **automatic screenshots taken on failure** (e.g. `tour-gates/__screenshots__/target-prop.test.ts/CSR--...-1.png`). They are gitignored (`.gitignore:37,39`), and nothing in the repo calls `toMatchScreenshot`. So there are **no committed visual baselines**.
- Reuse: the web half of the parity harness. Mount the same `.tsrx` CSS fixture, then capture `getBoundingClientRect` and `getComputedStyle` per node through a new `BrowserCommand` (the same pattern as `parkPointer`), or run them in-page. Adding `{ browser: 'webkit' }` to `instances` gives a WebKit reference render, which is closer to iOS text and layout than Chromium.

### 2. `@markless/analyzer` Playwright probes
- File: `packages/analyzer/src/playwright.ts` (715 lines). Exports `inventoryCandidates` (walks every element with `page.locator('*').evaluateAll` and already reads `getComputedStyle` and `getClientRects` to classify hidden, disabled, and inert nodes), `collectLocatorResolution`, `collectPayloadWiring`, `ConsoleLedger`, `RequestLedger`, `measurePageWindow`, and others. Requires `window.__MARKLESS_DEBUG__` version 1 (the debug channel).
- Reuse: the closest existing template for a `captureLayoutTree(page)` probe. It runs one `evaluateAll` over every element and returns a serialisable record per node, keyed by document index. The debug channel can map DOM nodes back to compiler host node IDs, which gives a shared key between the web and native trees. `packages/analyzer/src/witness.ts` (`createWitnessVerdict`) and `verdicts.ts` / `invariants.ts` give a ready verdict and receipt shape that agents already read.

### 3. Witness boxes (built-and-previewed page proofs)
- Files: `packages/bundler/boxes/*.box.ts` (35 entries, e.g. `csr-styles-dev-browser.box.ts`), `demos/live-feed/boxes/*.box.ts`, `demos/music-player*/boxes/` (these include analyzer gates), and router boxes.
- What they do: `box({ name, tags, modes: ['build','preview'] }, async ({ pipeline, expect, receipt }) => ...)` builds with Vite, previews, visits the page in a Playwright browser, asserts, and writes `receipt.note(...)`. CI uploads the analyzer receipts as artifacts (`receipts-bundler`).
- Reuse: the production-build lane for parity. It checks CSS after the real bundler and style pipeline, not the dev server. Receipts become the web side of a parity report that CI uploads.

### 4. CI (`.github/workflows/ci.yml`) and local replay (`scripts/ci/local.mjs`)
- Every `ci.yml` job runs on `ubuntu-latest`: agent-files, typecheck, lanes, prepare-playwright, unit, browser, completion-matrix, boxes-bundler, boxes-router, boxes-music-player, boxes-music-player-ssr, receipts, save-lane-markers, test, package-manager-matrix, changes, benchmark, benchmark-guard. **There is no macOS job in ci.yml.**
- Browsers: `prepare-playwright` installs and caches **chromium + webkit** (cache key `playwright-<os>-chromium-webkit-<lockfile hash>`). The `unit` job installs both. The `browser` and box jobs install only chromium. WebKit binaries are therefore already cached and cost almost nothing to use in a new instance.
- Lane skipping: the `lanes` job hashes inputs per lane (unit, browser, completion-matrix, box lanes, receipts) and skips unchanged lanes. A parity lane would plug into this same mechanism.
- `scripts/ci/local.mjs`: reads the workflow YAML and runs its steps locally. Options are `--fast`, `--full`, `--job <id>`, `--install`, `--clean` (throwaway worktree), `--linux` (docker), and `--dry-run`. Jobs have per-job local policy (`mode: 'fast'`). A parity job added to `ci.yml` is replayable locally with no extra work. A macOS-only job would need a local-policy entry, for example "run only on darwin".

### 5. Screen reader workflow: the only macOS lane (`.github/workflows/screen-reader.yml`)
- Three lanes. `virtual` runs on ubuntu with `@guidepup/virtual-screen-reader` inside the Chromium project, is required, and has a per-family matrix. `nvda` runs on `windows-latest` and is required. `voiceover` runs on **`macos-latest`**, has a 25-minute timeout, and is **`continue-on-error: true` (advisory)**. Path-filtered to `packages/headless/**`.
- Pattern worth copying: one shared set of expectations run by a cheap Linux lane (required) and an expensive real-OS lane (advisory). The real-OS lane uploads its transcript even when it fails. Family scenarios live beside the source (`packages/headless/components/src/<family>/scenarios/basic.tsrx`, plus `<family>.sr.ts`, `.nvda.ts`, `.voiceover.ts`). `packages/headless/sr-app` serves every family's Basic scenario on one page. The parity harness could reuse the same colocated-fixture-plus-gallery shape (for example a `<fixture>.parity.ts` beside the scenario).
- Proof that a macOS runner already works in this repo: guidepup/setup-action, pnpm, and a Node build all run on it.

### 6. iOS native proof (`poc/fixtures/proofs/ios-native-rendering-target`)
- `ios/Package.swift`: swift-tools 6.0, iOS 17, library `MarklessNativeProof` with `Resources/artifact.json` as an SPM resource, plus a test target.
- `ios/Sources/MarklessNativeProof/MarklessArtifact.swift` (71 lines) and `MarklessNativeRuntime.swift` (242 lines): decode the host-neutral artifact, build UIKit views (`UIStackView` root), run JavaScriptCore symbols, and apply text bindings. `runtime.textValue(hostNodeId:)` already addresses native views by compiler host node ID.
- `ios/Tests/MarklessNativeProofTests/MarklessNativeProofTests.swift`: one **XCTest** (not Swift Testing) that mounts, asserts text, activates, and asserts again. **No snapshot tests of any kind.**
- `ios/Scripts/run-ios-demo.sh`: compiles with `xcrun swiftc` for the `iphonesimulator` SDK (no Xcode project), ad-hoc codesigns, then runs `simctl boot/install/launch` (default device "iPhone 17") and opens Simulator. It is interactive: a human taps the button.
- `src/verify.mjs`: a Node check on the artifact shape, the Swift sources, and the Swift test (static only).
- README scope: explicitly **no styling** and no Android.
- Reuse: the SPM-resource artifact loading is the documented DivKit-style shared-fixture seam. The same JSON fixture corpus can feed Vitest and Swift. Keying by `hostNodeId` is the join between the web tree and the native tree. The script is a starting point for a headless `simctl` lane (drop `open -a Simulator`, add `simctl io <dev> screenshot` and a `xcodebuild test` step).

### 7. Research memory: native testing stack (`memory/native-testing-stack.md`, 2026-07)
- Decisions to reuse directly. Add a `webkit` instance to browser mode first. Use a `jsc`-shell lane (`jsc -m bundle.mjs`, also with `--useJIT=0`). Use a Swift JSContext host under `xcodebuild test` on the simulator. Use **Swift Testing `@Test(arguments: fixtures)` with swift-snapshot-testing text strategies (`.dump` / hierarchy) as the tier the proof rests on**. Keep image snapshots to a small curated tier (perceptualPrecision about 0.98, baselines recorded in CI). Use Maestro for iOS simulator smoke tests and XCUITest for macOS. Add an `e2e_idle` accessibility element as an idle monitor. Stamp `accessibilityIdentifier` from locator metadata.
- CI cost note: GitHub macOS minutes carry a **10x multiplier**, with a cap of **5 concurrent macOS jobs**. Pin the Xcode version. Consider Cirrus Runners (about $150 per month flat per M4 runner) once minutes become a real cost.
- `memory/markless-proof-strategy.md`: fake-DOM tests are not accepted as proof (they missed 11 bugs). Claims need real-browser tests plus witness boxes. Known bugs use `test.fails` with a KNOWN RED comment. The completion gate is the full root `pnpm test`. The same rule applied to native means a fake UIKit tree is not proof. Swift tests must run against real UIKit on the simulator.

## Suggested reuse mapping (candidate, for the Judge in T037)
- Web geometry and computed-style oracle: a new analyzer probe modelled on `inventoryCandidates`, run from a Vitest browser command (dev) and from a witness box (build). Instances: chromium, plus webkit, which is already cached in CI.
- Native tree oracle: Swift Testing parameterised over the shared JSON fixture corpus (SPM resources). Text dumps of the resolved view tree (frame, font, colour, and similar, per `hostNodeId`), compared against the web record after normalisation.
- Pixel tier: small, advisory, macOS lane only.
- CI placement: copy the screen-reader shape. The Linux lane (web-side capture and fixture checks) is required and path-filtered. The macOS simulator lane starts advisory (`continue-on-error`) with a receipt upload, as VoiceOver does today.

## Gaps
1. **No macOS job in `ci.yml`.** macOS exists only as the advisory VoiceOver lane. No simulator, `xcodebuild test`, or `swift test` runs in any workflow. The iOS proof's XCTest is not run in CI.
2. **No visual-baseline tooling.** `__screenshots__` are gitignored failure captures, not baselines. There is no `toMatchScreenshot`, pixelmatch, or odiff in the web tooling, and no swift-snapshot-testing on the native side.
3. **No geometry or style capture helper.** `inventoryCandidates` reads computed style only to decide visibility. Nothing records box geometry, fonts, or colours as data.
4. **The browser and box jobs are Chromium-only.** WebKit is installed and cached but only the `unit` job uses it.
5. **The native proof has no styling.** Its README says so. There is no style mapping, no layout engine choice, and only one test.
6. **No Android.** No Gradle, emulator, Kotlin/Compose, or Android runner anywhere.
7. **No Swift Testing, Maestro, or XCUITest** in the repo (all are research-only). `maestro` is not installed locally.
8. **Local machine:** Xcode 27.0 (27A266a) is installed, but the Xcode license has not been accepted, so `xcrun simctl list` refuses. Simulator and `xcodebuild test` runs are blocked until the owner runs `sudo xcodebuild -license`. `jsc` is not on PATH, but the binary exists at `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`.
9. **`scripts/ci/local.mjs` has no macOS-job policy.** `--linux` exists for docker. A macOS parity job would need a darwin-only local policy entry.
10. **Cost:** GitHub macOS minutes carry a 10x multiplier with a 5-concurrent cap (from the research memory, not re-verified today). A per-PR macOS lane needs path filtering or a nightly schedule.
