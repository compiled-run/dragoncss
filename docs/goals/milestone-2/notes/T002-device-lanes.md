# T002: native device lanes at parity (iOS and Android)

Scout note for `docs/goals/milestone-2/state.yaml` T002. Written 2026-09-27. Read-only research. Scratch files are in `/tmp/m2t002`, and nothing in the repo changed except this note.

## 0. What was run and what was read

**Ran on this Mac** (Apple M5 Pro, 48 GB, macOS 26.6.2, Xcode 27.0 27A266a, iOS 26.5 simulator runtime 23F77, SDK iphonesimulator27.0):

| Probe | Result | Time |
|---|---|---|
| `simctl boot` + `bootstatus -b`, iPhone 17 | booted | **6 s** |
| Swift package (`Package.swift`, iOS 15 floor, Ahem as a resource) with an XCTest target, `xcodebuild test -scheme Probe -destination 'platform=iOS Simulator,id=…'` | passed; a `DRAGON_DUMP {json}` line in the log | **12 s** cold build + test; **2 s** warm; **8 s** when xcodebuild boots the sim itself; the test body took 22 ms including Ahem registration |
| Same test, with `TEST_RUNNER_DRAGON_OUT=/tmp/m2t002/dump.json` | the test process read `DRAGON_OUT` and wrote the JSON straight to the **host** path (simulator processes share the Mac file system) | – |
| Minimal UIKit app (`swiftc -target arm64-apple-ios15.0-simulator`, hand-written Info.plist with a scene manifest, `codesign -s -`), `simctl install` + `simctl launch --console-pty`, `simctl io screenshot` | printed the dump to stdout; the screenshot is 1206×2622, sRGB, 8 bit | compile **3 s**; install + launch + screenshot **~5 s** of 11 s wall (the rest was sleeps) |
| Chrome 145.0.7632.6 (the repo's pinned Playwright chromium-headless-shell) at DPR 1, 2, 2.625, 3, two ways | see §4: **layout numbers change with a real DPR, and Playwright's `deviceScaleFactor` alone hides it** | 1 s per run |
| `curl` of the Android SDK repository XML, AGP release notes, GitHub runner docs and images, android-emulator-runner README | versions and sizes in §9 | – |

**Numbers the probes produced (iPhone 17, iOS 26.5):**
- `UIScreen.scale = 3`; the screen is 402×874 pt; in a window, `traitCollection.displayScale = 3` and `UILabel.layer.contentsScale = 3`.
- UIKit keeps fractional frames: a view set to x = 152.33 reads back 152.33 (456.99 device px). UIKit does not snap frames. Snapping only happens when drawing.
- Ahem registered with `CTFontManagerRegisterFontsForURL(.process)`: at 10 pt, ascender 8, descender −2, lineHeight 10. `UILabel` "AB" has intrinsic size 20×10.
- TextKit 1 per-line hook (`NSLayoutManagerDelegate … shouldSetLineFragmentRect … baselineOffset`) with line-height 15, Ahem 10, width 30, "AB CD EF":
  - lines at y = 0, 15, 30, each h = 15, with baselines 10.5 / 25.5 / 40.5;
  - used rect 30×45.
  - This is exactly CSS half-leading ((15−10)/2 + 8) with fractional points kept.
- Pixel samples of `#3366ff` with an 8 pt radius, against white:
  - The card interior reads `[51,102,255,255]` in all three captures (`layer.render`, `drawHierarchy(afterScreenUpdates:true)` and the simctl screenshot).
  - A pixel 1 px inside the Ahem glyph reads `[0,0,0,255]` in all three.
- **The shadow pixel differs by capture method.** `layer.render(in:)` gives `[246,246,246]`; `drawHierarchy` and the real screenshot both give `[181,181,181]`. So `layer.render` does not show what the compositor draws. Paint evidence must use `drawHierarchy(afterScreenUpdates:)` in a window, or `simctl io screenshot`.
- Byte order trap: `UIGraphicsImageRenderer` gave BGRA (`alphaInfo` 6), and the first read showed `[255,102,51]`. Always draw into an explicitly declared sRGB RGBA8 `CGContext`.

**Read, not run:** everything about Android (no JDK or SDK on this Mac, and installing was forbidden). Also the repo documents listed in the task, and web sources in §12. Anything from memory is marked [unverified].

## 1. The shared design (both platforms, one code path in `packages/parity`)

### 1.1 The one pipeline per case

For each (fixture, DPR) case and each native target, the pipeline has these steps:

1. Compile the fixture once with `compileBackend` (api.md §4.1). It gives `files` (the generated Swift or Kotlin), `expected` (the expected native property dump) and `layout` (the engine input).
2. Run the TS engine on `layout` at the case DPR. This is the reference.
3. The native layout engine port reproduces the vectors bit for bit (oracle 1; T001's concern).
4. The device lane builds the generated code into the host and lays it out, waits for layout to settle, and writes a **native dump** (schema below).
5. `packages/parity` compares:
   - (a) dump frames and line boxes against **Chrome captured at the same DPR**, with the gate `|Δ css px| × dpr ≤ 1` on every absolute edge (`compare.ts` `GATE_DEVICE_PX`, unchanged);
   - (b) dump `applied` against `expected`, exact after normalisation;
   - (c) pixel samples against Chrome's pixels at the same coordinates (§6);
   - (d) dump frames against the TS engine frames, exact after the shared pixel snap. This separates "engine" failures from "view application" failures, as in testing-plan §4.3.

### 1.2 Shared dump schema `dragon.native-dump/1`

The same JSON is written by the Swift and the Kotlin test harness. Only `device` differs.

```jsonc
{
  "schema": "dragon.native-dump/1",
  "lane": "ios-sim" | "android-emu",
  "case": { "fixture": "flex-row-gap", "dpr": 3, "viewport": { "width": 400, "height": 300 },
            "direction": "ltr", "compilerDigest": "…", "expectedDigest": "…" },
  "device": { "platform": "ios", "os": "26.5 (23F77)", "model": "iPhone 17", "abi": "arm64",
              "scale": 3, "toolchain": "Xcode 27.0 (27A266a)", "renderer": "simulator-metal" },
  //          android: { "os": "36 (BP…)", "model": "dragon_dpr3", "abi": "arm64-v8a" | "x86_64",
  //                     "scale": 3.0, "densityDpi": 480, "toolchain": "AGP 9.4.0 / JDK 17", "renderer": "swiftshader_indirect" }
  "units": "css-px",                       // frames are device px / scale; deviceEdges keep the raw ints
  "nodes": [
    { "id": "n3",                          // compiler node id, joins Chrome's data-dragon-id; a missing id fails the case
      "kind": "element" | "text" | "anonymous",
      "native": "UIView" | "DragonTextView" | "android.view.View" | "DragonTextView",
      "frame": { "x": 20, "y": 20, "width": 120, "height": 40 },          // absolute to the fixture root
      "deviceEdges": { "left": 60, "top": 60, "right": 420, "bottom": 180 },
      "applied": { "layer.cornerRadius": 8, "backgroundColor": [0.2, 0.4, 1, 1] },   // platform names, read back from the live object
      "lines": [ { "top": 0, "height": 15, "baseline": 10.5, "start": 0, "end": 3, "left": 0, "width": 30 } ]
    }
  ],
  "pixels": { "capture": "drawHierarchy" | "PixelCopy", "colorSpace": "sRGB", "width": 1200, "height": 900,
              "sha256": "…", "samples": [ { "x": 240, "y": 120, "rgba": [51, 102, 255, 255], "rule": "interior:n3" } ] },
  "timing": { "settleMs": 3, "dumpMs": 1 }
}
```

- **Frames:**
  - `frame` is read back from the live native tree: `convert(bounds, to: root)` on iOS, and `getLocationInWindow` minus the root's position on Android.
  - It is never taken from what the generated code intended to write.
  - `deviceEdges` are integers on both platforms (see 1.4).
- **`applied`:** these keys use each backend's own vocabulary, so the file can equal the backend's `expected` dump byte for byte (goal oracle 2). A per-backend map in `packages/parity`, keyed by technique, projects them onto CSS names so they can be compared with Chrome's computed values. The lane-parity check (1.5) requires every support row covered on one target to be covered on the other.
- **`lines`:** one entry per line box of every text node, taken from the text engine after layout (`enumerateLineFragments` on iOS, `Layout.getLineTop/Bottom/Baseline/Start/End` on Android). Chrome's side already captures anonymous boxes and text lines (`compare.ts` `AnonymousBox`).

### 1.3 Device pixel ratios (task question 4)

- **Measured:**
  - Chrome's layout **depends on DPR** once the DPR is real (`--force-device-scale-factor=N`, with or without a matching Playwright `deviceScaleFactor`).
  - With only Playwright's `deviceScaleFactor` (the current `chrome.ts` pattern, which hardcodes the flag to 1), `window.devicePixelRatio` reports N but the layout numbers stay those of DPR 1. That capture would be silently wrong for a device lane. §4 has the numbers.
- **UIKit scales are integers:**
  - 3 for iPhone 17 (measured);
  - 2 for iPads [the iPad Pro 11-inch M5 simulator is available; its scale was not probed].
  - iOS cannot run at 2.625.
- **Android density is set per AVD** (`hw.lcd.density`: 320 → 2.0, 420 → 2.625, 480 → 3.0). The DPR is `densityDpi / 160`.
- **Recommendation (symmetric):**
  - **Shared DPRs {2, 3} on both platforms**, with identical cases and the same Chrome capture set. The iOS devices are iPhone 17 (3) and iPad Pro 11-inch M5 (2). The Android devices are two AVDs at density 480 and 320.
  - **Android adds 2.625 (density 420)** as a declared extra configuration. Real Android phones ship fractional densities, and T015 names 2.625 as the stress case. iOS has no fractional scale, so no iOS counterpart exists. This extra makes Android's proof stronger, not weaker. The parity check compares the shared set and lists extras explicitly.
- **Chrome captures:**
  - Three new capture sets, `expected/darwin-arm64/dpr-2|2.625|3/…`.
  - Each is taken with `--force-device-scale-factor=N` **and** `deviceScaleFactor: N`, with the existing `dpr !== env.devicePixelRatio` guard kept.
  - The runs also need a guard that the zoom actually applied. Assert one probe value in the capture, for example that a `0.5px` border computes to `0.333333px` at DPR 3.
- **Viewport fit:**
  - The fixture root is 400×300 CSS px. iPhone 17 is 402 pt wide, so it fits.
  - The Android AVDs need a wide enough panel:
    - 1344 px wide at 480 dpi gives 448 dp;
    - 1080 px at 420 dpi gives 411 dp;
    - 800 px at 320 dpi gives 400 dp. Use 900 px, which gives 450 dp.
  - The host places the fixture root in a fixed 400×300 container at a known window origin, never in the safe-area layout.
- **Engine prerequisite (both platforms):**
  - All 258 committed captures are DPR 1, and `layout/src/units.ts` says other ratios are "unverified against Chrome".
  - The TS engine must first reproduce the DPR 2/2.625/3 captures. Otherwise neither device lane can be judged: an engine error would look like a device error.
  - The measured differences are all things the engine must model: font-metric rounding at the zoomed font size, border snapping, and LayoutUnit in device space.

### 1.4 One pixel-snap rule for both

- **Android** `View.layout(l, t, r, b)` takes integer device px, so Android frames are always quantised.
- **iOS** accepts fractional points (measured).
- **Asymmetry to avoid:** if iOS kept fractional frames, it would match Chrome's unrounded layout more closely than Android does. Its paint would also antialias edges that Chrome and Android snap.
- **Fix:**
  - One TS reference function, `snapEdges(rectInLU, dpr) → device-px ints`. It snaps each absolute edge with round-half-up, and sizes come from the snapped edges. Chrome's paint snapping and Yoga's `pointScaleFactor` work the same way.
  - It has shared vectors. Both generated runtimes call their port of it.
  - iOS writes `CGFloat(edge) / scale`, so both dumps carry integer `deviceEdges`, and both are compared with the same gate.
  - Snapping moves an edge by at most 0.5 device px, which stays inside the 1 device px gate. The planted-bug self-test must include "snap disabled on one platform".

### 1.5 Lane-parity check (goal oracle 3)

`pnpm parity:lanes` reads one config (`packages/parity/src/targets.ts`) and fails unless the following hold:
- Every configured native target (ios, android, and later macos) has the same lanes: `layout-vectors`, `device-frames`, `device-applied`, `device-lines`, `device-pixels`.
- They share the same case list (the full corpus × shared DPRs).
- Tolerances are imported from the single `compare.ts` constant.
- There are the same pixel-sample rules.
- Extras (Android 2.625) are listed by name.
- Report status: a lane whose toolchain is missing reports `blocked (owner tooling)`, never `pass` (goal.md).

## 2. iOS lane

### 2.1 Hosting (question 1)

- **Shape:** one generated Swift package per corpus build.
  - Target `DragonGenerated`: the generated view code for every fixture, plus the Swift layout engine port and resources (`Ahem.ttf`).
  - Test target `DragonDeviceTests`: one XCTest that loops over fixtures. Swift Testing parameterised tests are also possible, but one test method means one process and one log to parse.
- **Measured:** `xcodebuild test` works on a bare `Package.swift` against a simulator destination. No `.xcodeproj` and no app target are needed, and it builds in 12 s cold.
- **Window-backed variant:** package tests run in the xctest runner with no app scene, so views are not in a window.
  - Off-window views were fine for frames, applied values and TextKit lines.
  - For paint (§6), `drawHierarchy` and real contentsScale need a window. There are two ways to get one:
    - (a) a hosted test (`TEST_HOST`) that needs a generated `.xcodeproj`. Tooling like XcodeGen or Tuist is not installed [unverified which is preferable].
    - (b) the minimal app measured above, built with `swiftc` + Info.plist + ad-hoc signing and driven by `simctl launch --console-pty`. It uses no project file and has a real `UIWindowScene`. It needs a hand-rolled test protocol: an args list in, JSON out to a host path passed via `SIMCTL_CHILD_DRAGON_OUT` [unverified that the `SIMCTL_CHILD_` prefix reaches the app, but it is documented simctl behaviour].
  - Recommendation: **(b) for the whole lane.** It is one binary with a real window, `drawHierarchy` works, and there is no project generator. Package tests stay for engine vectors.
- **pnpm entry:**
  - `pnpm parity:device --target ios` does four things: compile the fixtures, write the Swift sources into `packages/parity/out/ios/…`, run `xcrun swiftc`/`xcodebuild`, then `simctl` boot, install, launch and read the JSON files.
  - `pnpm test` runs it only when `process.platform === 'darwin'` and `xcrun simctl` works. Elsewhere the lane is reported `blocked (tooling)`, never skipped silently (testing-plan §6 "darwin-only policy entry").
- **Pinning:**
  - Record the device type id (`com.apple.CoreSimulator.SimDeviceType.iPhone-17`) and the runtime build (`23F77`).
  - Create a dedicated device, `xcrun simctl create dragon-iphone17 com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-26-5`, and erase it before each run (`simctl erase`).
  - Record the Xcode version in the dump.

### 2.2 Settle and dump (question 2)

- Generated code builds the views and runs the Swift engine. It sets `frame`s synchronously from the snapped engine output. It does not use Auto Layout, so there is no constraint solver to wait for.
- Then:
  - call `root.layoutIfNeeded()`;
  - call `layoutManager.ensureLayout(for:)` on every Dragon text view;
  - call `CATransaction.flush()`.
- At that point the tree is settled, deterministically and without sleeps.
- Pixel capture: `drawHierarchy(in:afterScreenUpdates: true)` forces a render-server commit.
- Animations are off (`UIView.setAnimationsEnabled(false)`, and `layer.speed = 0` is not needed).
- The dump walks the tree by node id, read from an associated `dragonId` on each view (the Markless `hostNodeId` precedent).

### 2.3 Ahem (question 3)

- Ship `Ahem.ttf` from `vendor/fonts/` in the package or app bundle.
- Register it with `CTFontManagerRegisterFontsForURL(url, .process, …)` at start-up. This is measured working; `UIAppFonts` in Info.plist is the alternative.
- The build asserts `UIFont(name: "Ahem", size: 10)` is non-nil and records the font's sha256 in the dump, matching the web capture's data-URI font.

### 2.4 Text hook (question 5)

- Use TextKit 1 through a Dragon text view that owns `NSTextStorage` → `NSLayoutManager` → `NSTextContainer` with `lineFragmentPadding = 0`.
- The `NSLayoutManagerDelegate` per-line hook sets each fragment's rect height and baseline from Dragon's line box. **Measured exact** in the probe.
- For exact Chrome parity, each line's top and height come from the TS engine's line boxes. They are passed in as data (as `LayoutUnit`s, then snapped with the shared rule), not recomputed in Swift from UIFont metrics. Blink rounds metrics differently from Core Text (decisions.md, Linux lane scope), so recomputing would drift.
- Break positions stay native and are checked:
  - the dump records each line's `start`/`end` offsets;
  - these are compared with Chrome's per-line text ranges;
  - a break mismatch is a separate failure kind, not a geometry delta.
- Settings: `lineBreakStrategy = []`, `hyphenationFactor = 0`, `usesFontLeading = false` [unverified name on iOS; `NSLayoutManager.usesFontLeading` exists].
- Avoid `UILabel` for measured text. It does not expose the hook, and its intrinsic size was 20×10 (fine for Ahem, but it has its own line model).

## 3. Android lane

### 3.1 Hosting (question 1)

- **Shape:** one generated Gradle project (Kotlin) with two modules:
  - `:app`: the generated Views for every fixture, the Kotlin layout engine port, and `assets/fonts/Ahem.ttf`. `minSdk 29`, `compileSdk 36`, `targetSdk 36`.
  - `androidTest`: one instrumented JUnit4 test (`AndroidJUnitRunner`) looping over fixtures inside an `ActivityScenario` with a fixed 400×300 dp container.
- **Run:** `./gradlew :app:assembleDebug :app:assembleDebugAndroidTest`. Then `adb install -r` both APKs and `adb shell am instrument -w -e dragonOut /sdcard/Android/media/dev.dragon.host/ dev.dragon.host.test/androidx.test.runner.AndroidJUnitRunner`, and `adb pull` the JSON files. This is the counterpart of `simctl launch` + a host path.
- **Alternative:** Gradle Managed Devices (`testOptions.managedDevices`) create, boot and tear down a pinned emulator from `build.gradle`. This is the closest analogue of `xcodebuild -destination`. [Unverified: whether GMD lets you set a custom `hw.lcd.density` and panel size, which §1.3 needs; ATD images exist only for newer API levels.] If it cannot set density, drive `avdmanager`/`emulator` directly.
- **pnpm entry:**
  - `pnpm parity:device --target android` does the following:
    - compiles the fixtures;
    - writes Kotlin sources into `packages/parity/out/android/…`;
    - runs Gradle (the wrapper is pinned in the generated project);
    - boots the AVD headless;
    - runs `am instrument`;
    - pulls the dumps.
  - `pnpm test` runs it when `ANDROID_HOME`, `adb`, `emulator` and a JDK are present. Otherwise it reports `blocked (owner tooling)`.
- **Pinning:**
  - One AVD per DPR, created from a named system image package and revision, for example `system-images;android-36;default;arm64-v8a` rev 2.
  - Explicit `config.ini` values: `hw.lcd.width`, `hw.lcd.height`, `hw.lcd.density`, `hw.gpu.mode=swiftshader_indirect`.
  - Boot with `-no-snapshot -wipe-data` for CI-equal state.
  - Record the emulator build in the dump. The stable build is 37.1.11 (`emulator-darwin_aarch64-15917651`).

### 3.2 Settle and dump (question 2)

- The generated code calls `View.layout(l,t,r,b)` with the snapped device-px ints from the Kotlin engine, inside a custom `ViewGroup` whose `onLayout` applies stored frames. `onMeasure` returns the engine sizes, so there is no framework layout logic.
- Settling:
  - after `setContentView`, `InstrumentationRegistry.getInstrumentation().waitForIdleSync()`;
  - then a `ViewTreeObserver.OnDrawListener` / `Choreographer.postFrameCallback` wait for one drawn frame [standard APIs, from memory].
- Before boot:
  - `settings put global window_animation_scale 0`, and the same for `transition_animation_scale` and `animator_duration_scale`;
  - `svc power stayon true`;
  - disable the soft keyboard and system dialogs (a `wm`/`cmd` setting).
- Frames: use `getLocationInWindow` minus the root origin, divided by `resources.displayMetrics.density`. `density` should equal `densityDpi/160` exactly (2.625 for 420).

### 3.3 Ahem (question 3)

- Put `Ahem.ttf` in `assets/fonts/` and load it with `Typeface.Builder(assets, "fonts/Ahem.ttf").build()` (API 26) or `Font.Builder` + `FontFamily.Builder` (API 29, T015 §7.4).
- Register it under a Dragon-generated id, never an Android family-name string.
- The build asserts non-null and records the font's sha256.

### 3.4 Text hook (question 5)

- The Dragon text view owns a `StaticLayout` built with `StaticLayout.Builder` (API 23). It uses:
  - `setBreakStrategy(BREAK_STRATEGY_SIMPLE)`;
  - `setHyphenationFrequency(NONE)`;
  - `setIncludePad(false)`;
  - `setUseLineSpacingFromFallbacks`, per T015 §7.1.
- Line boxes are set by a `LineHeightSpan.chooseHeight` over the whole text. It writes `fm.ascent/descent/top/bottom` so each line's top and bottom land on `snapEdges(engineLineTop/Bottom)`.
- Use T015 §7.2's error diffusion, but take the exact values from the TS engine's line boxes passed as data, not from a float line-height. This makes it the same data path as iOS.
- `FontMetricsInt` is integer device px, so line edges are quantised. With the shared snap rule in §1.4, iOS lines are quantised too, so both platforms are judged identically.
- Break offsets come from `layout.getLineStart/End` and are compared with Chrome, as on iOS.
- Probe needed: T015 §8.19, error diffusion over 10 lines at 2.625. The lane's text corpus covers it.

## 4. Chrome at the device DPR (measured, question 4)

These are `getBoundingClientRect` values in CSS px from the same page. The page has Ahem 13px / line-height 17.3px text, a 0.5px border with 1.3px padding at width 33.3%, an inline-block of Ahem 10.7px, and a 100px flex of three `flex:1` items.

| Capture | `#b` height | `#b` border | inline-block height | text line 2 top / height | flex item 1 width |
|---|---|---|---|---|---|
| DPR 1 (repo pattern) | 20.59375 | 1px | 11 | 19.29688 / 13 | 33.32813 |
| Playwright `deviceScaleFactor: 3`, flag `=1` | 20.59375 | 1px | 11 | 19.29688 / 13 | 33.32813 (**identical to DPR 1**) |
| flag `--force-device-scale-factor=3` (+ matching DSF) | 19.26042 | 0.333333px | 10.66667 | 19.30208 / 13 | 33.33334 |
| flag `=2.625` | 19.35714 | 0.380952px | 10.66667 | 19.20238 / 12.95238 | 33.33333 |

Consequences:
1. Device lanes need Chrome captures made with the real flag at each DPR. Reusing DPR 1 captures, or emulating DPR, misses sub-pixel differences and border snapping (a 0.5px border differs by 1 device px at DPR 3). It also misses line-box rounding.
2. The engine's existing `snapBorderWidth(0.5, 3)` formula gives 1/3 px, which matches Chrome at the real DPR 3. The remaining DPR paths (font metrics at zoomed sizes, LayoutUnit granularity) need new vectors.
3. The table gives one ready-made guard assertion for the capture tool.

## 5. Where one platform would get weaker proof, and how to avoid it

| # | Risk | Weaker side | Avoidance |
|---|---|---|---|
| 1 | Fractional frames on iOS against integer frames on Android | Android would look worse; or iOS would hide snapping bugs | One shared `snapEdges` reference with vectors, used by both runtimes (§1.4) |
| 2 | Only iOS has a real window; Android tests run in an Activity | – | Both are hosted in a real window: the iOS minimal app with a scene, and an Android Activity. Paint is read from the compositor on both (§6) |
| 3 | `applied` readback on Android reads Dragon's own `Drawable` fields, not a platform property the OS renders (iOS `CALayer` properties are OS state) | Android (and iOS for Dragon-owned paint such as border masks) | Rule: no row whose technique is `dragon-owned-paint` may be promoted from `applied` alone on **either** platform. It needs pixel samples (§6) |
| 4 | Android DPR 2.625 has no iOS equivalent | iOS gets fewer configurations | Declared extra, allowed by the parity check. The shared set {2, 3} is identical |
| 5 | Local Android runs arm64-v8a on the Mac; CI runs x86_64 on Linux KVM (macOS arm64 runners have no nested virtualisation) | Android local and CI differ in guest ABI; iOS is arm64 in both places | Record the ABI in the dump. Require the **same dumps** from both ABIs for frames, lines and applied values: all integer device px, so equality is a cheap, strict check. Pixel samples are judged per run against Chrome with the same rules, never against the other ABI |
| 6 | Emulator GPU: host GPU against SwiftShader | Android pixels vary by host | Always `-gpu swiftshader_indirect` locally and in CI. The iOS simulator uses the Mac's Metal on both (arm64 macOS only, testing-plan §6) |
| 7 | Floor OS coverage: Android can easily run API 29 (`system-images;android-29;default;arm64-v8a`, 498 MB). An iOS 15-16 simulator runtime is unlikely to install with Xcode 27 [unverified] | iOS | Primary lanes run the current OS on both (iOS 26.5, Android 36). Floor-OS runs are a second configuration on both. If iOS cannot get its floor runtime, that is an owner-blocked item, not an Android-only extra that counts as proof |
| 8 | Xcode 27.0 locally, while GitHub macOS runners have Xcode 26.6 default and 27 only as "public preview" | iOS reproducibility | Pin the simulator runtime (26.5 / 23F77, present on both). Record Xcode in the dump. Before blocking, check that the dumps from both toolchains are equal |
| 9 | Robolectric/JVM "Android" shortcut (testing-plan §6 idea) | Android | Not a proof lane. It runs no real device HWUI/compositor. At most it is a fast inner loop. The oracle needs the emulator, just as iOS needs the real simulator (Markless fake-UIKit precedent) |
| 10 | Toolchain missing (Android today) | Android | The lane reports `blocked (owner tooling)` and the goal stays not met. It is an owner-blocked task, not a scope cut (goal.md) |

## 6. Native paint evidence to promote the 221 caveat rows (question 6)

The proof is numeric pixel samples. It is never a human or model looking at pictures.

- **Captures:**
  - Chrome: `page.screenshot` at the real DPR (flag N + `deviceScaleFactor: N`, `--force-color-profile=srgb`), decoded to RGBA8.
  - iOS: `drawHierarchy(afterScreenUpdates:true)` into an sRGB RGBA8 `CGContext` of the fixture root. It matched `simctl io screenshot` exactly in the probe, including the shadow pixel. `layer.render` is banned, because it did not match.
  - Android: `PixelCopy.request(window, rootRectInWindow, bitmap, …)` (API 26) of the composited window, `ARGB_8888`, sRGB. `View.draw(Canvas(bitmap))` is banned for the same reason (a software re-draw, not HWUI's output) [the HWUI/software difference is from memory and needs a probe, like the iOS one]. Cross-check: `adb exec-out screencap -p` equals `PixelCopy` on a probe fixture.
- **Sample points are generated from geometry, not hand-picked.** The generator (TS, shared) uses the snapped device-px boxes and the resolved paint values. Every point is at least 2 device px away from any edge or curve unless it is an edge probe:
  - `interior:<node>`: the fill colour; exact, channel delta 0 (allow 1 only if measured and approved).
  - `border:<node>:<side>`: the middle of each border band ≥ 2 device px wide; exact colour.
  - `outside:<node>`: just outside the border box; equals the parent's colour.
  - `radius:<node>:<corner>`: points along the corner diagonal at distance r − 2 and r + 2 device px from the arc. Inside means painted and outside means not, each exact.
  - `clip:<node>`: for overflow clipping, points 2 device px inside and outside the clip rect (rounded clip: along the diagonal as above). Child colour inside and parent colour outside, both exact.
  - `edge:<node>:<side>`: estimated edge position from antialiasing coverage along a scanline (coverage = (c − bg)/(fg − bg), summed). The position is compared in device px with the 1 device px gate, the same gate as frames.
- This makes colours, borders, backgrounds and overflow clipping provable with numbers on both platforms, with the same rules. Rows whose output depends on antialiasing shape (dash patterns, shadows, gradients) need the WPT-style fuzzy pair (max channel delta, pixel count) written into the fixture with owner approval (testing-plan §4.2 rule 2). They do not count toward this first promotion.
- **Colour caution:** 8-bit rounding of `#3366ff` was exact on iOS. Colours with non-integer 8-bit values (from `rgb(… / 0.5)` or `opacity`) compositing over white can differ by 1 between Skia and Core Animation. Measure first. If a delta of 1 is ever needed, it is a tolerance change needing owner approval.

## 7. Run time and flakiness (question 7)

- **iOS, measured:**
  - boot 6 s;
  - package build + test 12 s cold, 2 s warm;
  - app compile 3 s, install + launch ~3-5 s;
  - one fixture's dump 22 ms.
- **iOS projection** for 258 cases × 2 DPRs, one process per DPR: about 30-60 s plus build. Pixel capture adds maybe 10-30 ms per fixture [estimate]. Well under the 20-minute budget in testing-plan §6.
- **Android** [estimates, not measured]:
  - cold headless boot on Apple silicon with Hypervisor.framework: about 20-60 s; with swiftshader maybe slower;
  - first Gradle build (downloads AGP and androidx) 2-5 min; warm 10-30 s;
  - install 2 APKs about 5 s;
  - instrumentation over 258 cases likely under 1 min.
  - CI on ubuntu with KVM: add about 1-3 min for image download unless cached.
- **Flakiness:**
  - The simulator has been reliable in these runs (3/3 boots).
  - testing-plan cites Android emulator tests at 25 % flaky against 1.7 % overall. This is dominated by boot and UI-interaction timing, not by numeric dumps.
  - Controls on both:
    - explicit settle signals and no sleeps;
    - one boot retry only;
    - all fixtures in one process;
    - erase or wipe-data per run;
    - animations off;
    - Android: poll `getprop sys.boot_completed` = 1 and `init.svc.bootanim` = stopped before install.
  - A new fixture passes 20 consecutive runs before merging (testing-plan §6), on both lanes.

## 8. CI friendliness (question 8)

- **iOS:**
  - GitHub `macos-26` arm64 runner, image 20260907, Xcode 26.6 default, iOS 26.5 simulator runtime listed.
  - Free on public repos, with up to 5 concurrent macOS jobs.
  - The pinned runtime matches this Mac (26.5). Xcode 27 on runners is a preview.
- **Android:**
  - GitHub docs: on macOS arm64 runners "Nested-virtualization is not supported due to the limitation of Apple's Virtualization Framework". So **no accelerated emulator on macOS arm64 CI**.
  - Use `ubuntu-latest` with KVM enabled by the udev rule from android-emulator-runner (it says ubuntu is "2-3 times faster than the macOS ones").
  - The Ubuntu 24.04 image already has JDK 17 (17.0.20), cmdline-tools 12.0, build-tools 36/37 and platforms up to 37.2. Only the system image and emulator download are needed. Cache them with `actions/cache` keyed on the package revision.
  - Use x86_64 images there, and see §5 row 5 for the ABI cross-check.
- **Symmetric CI shape:** two jobs, `parity-ios` (macos-26) and `parity-android` (ubuntu + KVM), with the same trigger and path filter, both advisory at first (decision 14 extended to Android with the same two-week rule), and the same report. Workflow files are written but not pushed (goal.md, stay in repo).

## 9. Owner install list for Android on this arm64 Mac

Versions come from Google's SDK repository XML and the AGP release page, fetched 2026-09-27. AGP 9.4.0 (September 2026) needs **JDK 17** minimum and Gradle 9.6.0, defaults to build-tools 36.0.0, and supports up to API 37.

```sh
# 1. JDK 17 (Temurin 17.0.20.1 via Homebrew; matches the ubuntu runner's default 17.0.20)
brew install --cask temurin@17
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"

# 2. Android command-line tools (no Android Studio needed)
#    Either:  brew install --cask android-commandlinetools   (cask version 15859902)
#    or the direct zip (rev 23.0, 155 MB):
mkdir -p ~/Library/Android/sdk/cmdline-tools
cd /tmp && curl -LO https://dl.google.com/android/repository/commandlinetools-mac_arm64-16111833_latest.zip
unzip -q commandlinetools-mac_arm64-16111833_latest.zip -d ~/Library/Android/sdk/cmdline-tools
mv ~/Library/Android/sdk/cmdline-tools/cmdline-tools ~/Library/Android/sdk/cmdline-tools/latest
export ANDROID_HOME=~/Library/Android/sdk
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# 3. SDK packages (minSdk 29 needs no android-29 platform to compile; the API 29 image is for the floor-OS run)
yes | sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-36" "build-tools;36.0.0" \
  "system-images;android-36;default;arm64-v8a" "system-images;android-29;default;arm64-v8a"

# 4. AVDs, one per DPR (panel wide enough for a 400 CSS px root)
avdmanager create avd -n dragon_api36_dpr3   -k "system-images;android-36;default;arm64-v8a" -d pixel_9 --force
avdmanager create avd -n dragon_api36_dpr2   -k "system-images;android-36;default;arm64-v8a" -d pixel_9 --force
avdmanager create avd -n dragon_api36_dpr2625 -k "system-images;android-36;default;arm64-v8a" -d pixel_9 --force
# then set in ~/.android/avd/<name>.avd/config.ini:
#   dpr3:    hw.lcd.width=1344 hw.lcd.height=2992 hw.lcd.density=480
#   dpr2:    hw.lcd.width=900  hw.lcd.height=1800 hw.lcd.density=320
#   dpr2625: hw.lcd.width=1080 hw.lcd.height=2424 hw.lcd.density=420
#   all:     hw.gpu.enabled=yes hw.gpu.mode=swiftshader_indirect hw.keyboard=yes
# (the Dragon harness can write these itself; the owner only needs steps 1-3)

# 5. Smoke test (headless)
emulator -avd dragon_api36_dpr3 -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect &
adb wait-for-device && adb shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done'
adb shell wm density; adb shell wm size; adb emu kill
```

**Download size (mac arm64, from the repository XML `<size>`):**

| Package | Size |
|---|---|
| cmdline-tools rev 23.0 | 155 MB |
| platform-tools 37.0.1 | 16 MB |
| emulator 37.1.11 (stable) | 395 MB |
| platforms;android-36 r2 | 66 MB |
| build-tools;36.0.0 | 79 MB |
| system image android-36 default arm64-v8a r2 | 811 MB |
| system image android-29 default arm64-v8a r8 | 498 MB |
| **SDK subtotal** | **≈ 2.0 GB** |
| Temurin 17 | ≈ 0.2 GB [unverified] |
| Gradle 9.6 distribution + AGP/androidx/Kotlin dependencies on first build | ≈ 0.5-0.8 GB [estimate] |
| **Total download** | **≈ 2.7-3.0 GB** |

- **On disk:** expect about 8-12 GB after unpacking plus three AVDs' data partitions [estimate]. The Mac has 194 GiB free.
- **Image choice:** the `google_apis` images are about 2× larger (android-36 arm64 is 1,873 MB) and are not needed. The AOSP `default` images are enough for Views.
- **Android Studio is optional:** it bundles a JDK, but adds GBs, and the lane never needs it.

## 10. What cannot be proven where

- **Linux (the TS engine):** geometry only, not native text shaping, paint or property writes (api.md §4.1).
- **iOS simulator:** real UIKit, Core Text and Core Animation on Mac GPU. It is not device GPU rasterisation. Simulator-versus-device paint differences are possible [unverified] and stay out of the claim wording ("proven on the iOS 26.5 simulator").
- **Android emulator:** real framework and Minikin/HWUI on SwiftShader. It is not an OEM GPU or OEM fonts. The claim wording says "proven on the Android 36 AOSP emulator, density 480/320/420".
- **Both:**
  - line **breaks** with real fonts, CJK and emoji stay caveat (platform-playbook §6);
  - Ahem proves the line-box and geometry path, not shaping;
  - interaction (press, dark mode, text size) is layer 7 and out of this lane.

## 11. Candidate facts for the Judge (T003)

1. A single `dragon.native-dump/1` schema with integer `deviceEdges`, backend-named `applied`, `lines` and `pixels.samples` can serve both lanes. The iOS side is demonstrated end to end, from build to boot to dump to host file.
2. Chrome device-DPR captures (flag, not only emulation) and TS-engine DPR vectors are a **shared prerequisite**. They block both native lanes equally, and could be the first Worker slice that serves both platforms.
3. A shared pixel-snap reference removes the main iOS/Android geometry asymmetry.
4. Paint evidence must come from compositor captures (`drawHierarchy` / `PixelCopy`). `layer.render` is measurably wrong for shadows.
5. Android needs about 3 GB of owner downloads (§9). CI Android runs on ubuntu + KVM (x86_64), not on macOS arm64.

## 12. Sources (all accessed 2026-09-27)

- Android SDK repository manifest (cmdline-tools, platform-tools, emulator, platforms, build-tools sizes and versions): https://dl.google.com/android/repository/repository2-3.xml
- AOSP system images: https://dl.google.com/android/repository/sys-img/android/sys-img2-3.xml
- Google APIs system images: https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml
- AGP release notes (AGP 9.4.0, JDK 17 minimum, Gradle 9.6.0, build-tools 36.0.0, max API 37): https://developer.android.com/build/releases/gradle-plugin
- Emulator command line (`-no-window`, `-no-boot-anim`, `-gpu swiftshader_indirect`): https://developer.android.com/studio/run/emulator-commandline
- sdkmanager reference: https://developer.android.com/tools/sdkmanager
- GitHub-hosted runners (macOS arm64: nested virtualisation not supported): https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- macOS 26 arm64 runner image (Xcode 26.6 default, Xcode 27 preview, iOS 26.5 simulator): https://raw.githubusercontent.com/actions/runner-images/main/images/macos/macos-26-arm64-Readme.md
- Ubuntu 24.04 runner image (JDK 17.0.20, Android cmdline-tools 12.0, build-tools, platforms): https://raw.githubusercontent.com/actions/runner-images/main/images/ubuntu/Ubuntu2404-Readme.md
- android-emulator-runner README (KVM udev rule; ubuntu 2-3× faster than macOS): https://raw.githubusercontent.com/ReactiveCircus/android-emulator-runner/main/README.md
- Homebrew casks `temurin@17` (17.0.20.1) and `android-commandlinetools` (15859902): `brew info`, local
- Repo: `docs/research/testing-plan.md` §2-6, `docs/research/platform-playbook.md` §6-8, `docs/goals/milestone-1/notes/T014-ios-playbook.md`, `T015-android-playbook.md` §7, 12, `docs/decisions.md`, `docs/api.md` §4.1-4.4, `packages/parity/src/{chrome,compare,report,fixtures}.ts`, `packages/layout/src/units.ts`
- Probe code: `/tmp/m2t002/Probe` (Swift package), `/tmp/m2t002/App/main.swift` (UIKit host), `/tmp/m2t002/dpr*.mjs` (Chrome DPR), `/tmp/m2t002/parse.mjs` (SDK sizes)
