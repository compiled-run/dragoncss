# T013 P3 review and P4 package

Judge, 2026-09-28. Decision: **approved**.

P3 (T012, branch `t012-p3-lane-core`, commit 4c1331c) is approved with no must-fix items.

**Fast-forward:** yes. Master 2beb4a2 is an ancestor of 4c1331c, and the branch changes only `packages/`, `scripts/` and `package.json`. It cannot collide with the dirty `docs/decisions.md` or the untracked docs in the main checkout. Run `git merge --ff-only t012-p3-lane-core` on master.

P4 is approved as **one package covering both platforms** (T014 below). It is not split into iOS and Android halves.

## 1. P3 verification (Judge re-ran in /tmp/dragon-p3 at 4c1331c, with JAVA_HOME and ANDROID_HOME exported)

| Check | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 41 files, 946/946 passed, 101.2 s wall (baseline 93-100 s; P3 receipt 99.6-116.2 s) |
| `pnpm run parity:lanes` (default, reads committed lanes.json) | exit 0; parity: the lanes, case lists, tolerances, sample rules, dump faults and projection agree on ios and android |
| `pnpm run parity:lanes -- --run-host` | exit 0 in 67.7 s. ios and android `layout-vectors-host` both **pass**, with identical counts on each: 258/258, 320000, 20258, 22000, 3/3, 783, 783, 120000, 20783. Both have digests ae0f4087...48af38e and b9b2fb6b...10a8037. Swift 6.4, and kotlinc 2.4.20 on JRE 17.0.20.1. The reference proof passes 261/261 on validity, (a) and (d) at ios 2 and 3, and at android 2, 3 and 2.625. Afterwards `out/lanes.json` is byte-identical to the committed file (`cmp`) and `git status` is clean |
| `pnpm run parity:lanes -- --require-all` | exit 1, naming the 10 not-run device lanes, 5 per target. Each is "not run", not "blocked" |
| `--plant missing-lane / dropped-case / tolerance-literal-2 / unnamed-extra-dpr` | each exits 1 with its own first message (missing lane device-pixels; drops 1 case at DPR 2; gateDevicePx 2 is not the imported GATE_DEVICE_PX 1; DPR 1.5 is not shared or named) |
| `git diff --name-only 2beb4a2..4c1331c` | 20 files, every one in T012 allowed_files |
| `git diff --exit-code 2beb4a2 4c1331c -- <T012 protected list>` | exit 0 |
| `git diff 2beb4a2 4c1331c -- packages/parity/src/compare.ts` | exactly one added line, `export const GATE_CHANNEL_DELTA = 0;` |
| Test files modified or deleted since 2beb4a2 | none (5 added) |
| project.ts diff | only the `iosLowered` to `nativeLowered` rename (2 lines) |
| `git remote -v` | empty |

**Code read:** native-dump.ts, targets.ts, lanes.ts, native-compare.ts, internal.ts and project.ts.
- The schema is one data description. The TS types are inferred from it, and the validator walks it.
- Case lists derive from `layoutCases()`, `DPRS`/`SHARED_DPRS`/`EXTRA_DPRS` and the manifests. There are no literals.
- Tolerances are imported. The literal scan works, and the planted literal proves it.
- A host lane passes only when every count and both digests match.
- `blocked` is reachable only when a tool lookup fails.
- All eight worker deviations are accepted, including:
  - the `git add -f` of `out/lanes.json`;
  - the schema additions (`case.id`, `nodes[].parent`, absolute lines, the `ts-reference` lane);
  - 522 device cases on ios against 783 on android. The shared sets are identical; 2.625 is named through `EXTRA_DPRS`.

**Not re-run by the Judge:** these rely on the T012 receipt and on the tests inside `pnpm test`.
- parity:report, with its byte check outside the Native lanes section;
- parity:dpr-report;
- native:planted;
- the xcodebuild of DragonLayout;
- profile:rows and parity:capture.

### Observations (not must-fix; each is carried to a later phase)
1. **No reference for line breaks.** The dump has line `start`/`end`, but the Chrome captures have no per-line text ranges (capture.ts records `Range.getClientRects()` only). The engine's `LayoutRect` carries no break offsets either. So checks (a)-(d) never compare breaks. native-strategy.md 3.4 promises "a break mismatch is its own failure kind", and today nothing can compute it. P5 must add a break reference (see section 4).
2. **DUMP_FAULTS are not run against real dumps.** They are checked as names for parity, and the negative unit tests use synthetic dumps. Nothing yet mutates a real device dump. P5 must run every `DUMP_FAULTS` entry against real dumps on both platforms.
3. **The meaning of `lines[].baseline` is open.** Its field doc says "css px from the line top", but the line `frame` is Chrome's text-range rect (the glyph content area), not the line box. P4 must pin this: the baseline is measured from the line frame's top (the content-area top), in css px. It must not change the schema.
4. **The iOS output reason text is now wrong in part.** It says "no Swift is emitted". P4 emits Swift internally, so P4 updates the reason (no test asserts it).

## 2. P4 package (T014): native backends for iOS and Android together

### Split decision: one package, not iOS and Android halves
- The lowered program, the two view emitters, the expected dumps and the dump readers form one contract. `applied` keys are exactly what the emitters write and what the readers read back. Splitting by platform would let one platform's program shape become the de facto design, which is the "Android later" misfire.
- Every item below is required on both platforms. The package is **rejected** if either platform's item is missing, is weaker, or is proven by a different kind of check.
- If the Worker hits the verification-failure stop, the fallback split is **by layer, with both platforms in each half**, never by platform:
  - P4a: the program, expected dumps, public android target, encoders and measurer data path.
  - P4b: the emitters, text views, host builds and the smoke run.
- Neither half is accepted until both have landed.

### Objective (binding)
P4, the native backends (native-strategy.md 1.1, 3.2-3.4 and 3.9 items 7 and 13; api.md 4.1 and 4.4; T009 sequence). Work on branch `t014-p4-backends` from master after the fast-forward to 4c1331c, in a new worktree `/tmp/dragon-p4`. Commit locally only.

1. **One lowered program per backend, from one shared layout lowering.**
   - A new `packages/dragon/src/lower/native-program.ts` builds, per case:
     - the ios (UIKit) and android (Views) lowered programs, each versioned per backend;
     - both from the same `nativeLowered` layout tree and the same resolved paint values.
   - Each program holds:
     - generated node ids, kinds and parents;
     - the typed engine input;
     - the property writes in backend vocabulary;
     - text runs (text, font identity, colour);
     - the technique of every write (native property or dragon-owned paint).
   - Emitters and the expected-dump projection read only the program. They never re-resolve CSS.
   - It covers every paint feature any layout case uses: background-color, text color, border widths, styles (solid, dashed, dotted) and colours per side, and overflow hidden.
     - The overflow clip is the **padding box** on both platforms. UIKit `clipsToBounds` and Android `clipChildren` clip other boxes, so the program must express the clip explicitly, either as topology or as a clip property.
     - Dashed and dotted borders get a declared dragon-owned technique. They are never promoted from `applied` (ruling 3.9 item 11).
   - `lower/ios-layout.ts` is unchanged, and `nativeLayoutProjection` stays the one projection for both targets.
2. **Code emitters, generated rather than a runtime interpreter.**
   - `packages/dragon/src/emit/uikit.ts` emits Swift and `packages/dragon/src/emit/android-views.ts` emits Kotlin. Each emits:
     - one function per case that builds the native tree;
     - the `LayoutInput` as typed constructor calls of the translated engine. There is no JSON decoding or CSS text on the device, and no selector or class name in any generated file.
   - At runtime the generated code:
     - runs the translated engine at the device's own scale (`UIScreen`/`traitCollection` scale; `displayMetrics.density`);
     - snaps with the translated `snapEdges`;
     - sets frames relative to the parent from the snapped absolute edges:
       - on iOS, as `CGFloat(edge - parentEdge) / scale`;
       - on Android, as `View.layout(l, t, r, b)` ints from a checked conversion that traps on a non-integral or out-of-Int32 value. It is emitted in both languages with a host test.
   - Android uses a Dragon root `ViewGroup` whose `onMeasure` and `onLayout` only apply the stored engine frames. iOS uses no Auto Layout.
   - Device-px values:
     - Initial border widths (D1, `device-px`) apply as device px: `3 / scale` points on iOS, and the snapped int px on Android.
     - Every other border width comes from the translated engine snap helper at the device scale, on both platforms. The expected dump computes it with the same helper on the host.
   - Support code ships as emitted source with the output (api.md 4.4): the Dragon text view, the measurer bridge and the checked conversions. It is never a hand-written file and never a runtime package.
3. **Text path** (native-strategy.md 3.4; decision 7):
   - **iOS:** `DragonTextView` owns `NSTextStorage`, `NSLayoutManager` and `NSTextContainer` (TextKit 1, constructed explicitly, never TextKit 2), with:
     - `lineFragmentPadding = 0`;
     - `hyphenationFactor = 0`;
     - `lineBreakStrategy = []`;
     - `usesFontLeading = false`.

     The `NSLayoutManagerDelegate` per-line hook sets each fragment's line box and baseline offset from engine data.
   - **Android:** `DragonTextView` owns a `StaticLayout.Builder` layout with:
     - `BREAK_STRATEGY_SIMPLE`;
     - `HYPHENATION_FREQUENCY_NONE`;
     - `setIncludePad(false)`;
     - `setUseLineSpacingFromFallbacks(false)`.

     A `LineHeightSpan.chooseHeight` over the whole text finds the line by its start offset and writes `fm.top = fm.ascent` and `fm.bottom = fm.descent` from the same snapped engine data.
   - **Line data:**
     - The line box for line k is the engine's content rect minus the engine's half-leading, with the engine's line height. The baseline is the content top plus the engine's ascent.
     - These values come from the translated engine, not from UIFont or FontMetrics. If the native hook needs a value the engine computes only internally (line height, half-leading, ascent), P4 exports a behaviour-preserving helper from `packages/layout/src/inline.ts` that `inline.ts` itself calls, so the device reuses the exact translated arithmetic.
   - **Measurer bridge (both platforms, R4):**
     - `text.ts` gains a font-data measurer with these parts:
       - the raw inputs: units per em, ascent, descent and line gap in font units, plus a per-code-point advance in font units;
       - the Dragon covered-glyph predicate;
       - the existing translated rules: `fontMetricPx`, `platformFontSize`, whole-px metric rounding, `textAdvanceAt`, and `cachedRangeWidth` for `measureRange`, which is R4.
     - `ahemMeasurerWith` becomes that measurer over the Ahem constants, with outputs byte-identical.
     - The device bridge supplies only raw data read from the bundled font:
       - iOS: `CTFontCopyTable` for `head`/`hhea`, and advances from `CTFontGetAdvancesForGlyphs` at size = unitsPerEm;
       - Android: `android.graphics.fonts.Font` (API 29), with the buffer's `head`/`hhea` and advances at textSize = unitsPerEm.
     - The platform-rule key is `darwin-arm64` on both devices.
     - At start-up each bridge runs a self-check: the raw data equal the Ahem constants (1000/800/200, 1 em for covered code points, 0 for U+200B). It records the font's sha256.
     - Ahem is bundled on both, registered with `CTFontManagerRegisterFontsForURL(.process)` on iOS and built with `Font.Builder`/`Typeface` on Android under a Dragon id.
4. **Expected dumps.**
   - `packages/dragon/src/emit/expected-dump.ts` projects, per backend, per case and per device DPR (ios 2 and 3; android 2, 3 and 2.625):
     - each node's `applied` map, in backend vocabulary;
     - its `native` class;
     - its sha256 (`expectedDigest`). The generated code embeds a digest table keyed by case and DPR, and fails loudly at an unknown scale.
   - Colours are RGBA8 integers on both platforms. Every `applied` value on device is read back from the live object; none is copied from the table.
   - A per-backend map (T002 1.2) projects applied keys onto CSS longhands. A test proves ios and android cover the same CSS longhands on every node of every case.
5. **Dump encoders from `NATIVE_DUMP_SCHEMA`.**
   - `packages/parity/src/native-encoders.ts` walks the schema and emits the Swift and Kotlin dump types and a JSON writer. The writer:
     - puts keys in schema order;
     - traps on non-finite numbers, and on a non-integer in an integer field;
     - writes `null` only where the field's `nullable` allows it for a device lane.

     There is no Codable and no kotlinx dependency.
   - A test changes a copy of the schema by adding a field and shows the emitted encoders change, which proves they are derived.
   - Device dumps write `lane: 'ios-sim' | 'android-emu'`. They carry a pixels block from a compositor capture:
     - iOS: `drawHierarchy(afterScreenUpdates: true)` into a declared sRGB RGBA8 `CGContext`;
     - Android: `PixelCopy` into ARGB_8888 sRGB. `layer.render` and `View.draw` are banned.

     The block holds the sha256 and the samples read at a points list the host supplies. The list may be empty in P4. The points protocol, and trust in the capture, belong to P6.
   - Frames are read back from the live tree:
     - iOS: `convert(bounds, to: root)`;
     - Android: `getLocationInWindow` minus the root's position, divided by density.
6. **Host apps, built for both platforms.** Build from generated sources into the gitignored `packages/parity/out/native/<target>/`. Nothing native is committed in P4.
   - **iOS:** a minimal UIKit app with a window scene (ruling 3.9 item 7). It is built with `xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios15.0-simulator -O` over DragonLayout, the generated cases, the support code, the encoder and the host, plus Info.plist and Ahem, then signed with `codesign -s -`.
   - **Android:** the counterpart, built **without Gradle, AGP or androidx**. There is no `~/.gradle` cache and no AGP is downloaded; the owner-installed SDK is enough. The build runs:
     - `aapt2 link` (manifest `minSdkVersion 29`, `targetSdkVersion 36`, android-36 `android.jar`, Ahem in assets);
     - `kotlinc -cp android.jar`;
     - `d8 --min-api 29` with kotlin-stdlib;
     - `zipalign`;
     - `apksigner` with a debug key generated under `out/`.

     The host is an Activity. P5 decides between `am start` and a framework `Instrumentation` subclass; neither needs androidx.
   - Both apps contain **every layout case**, derived from `layoutCases()` (261 today), selectable by argument or extra.
7. **API floors, proven at build time on both platforms.**
   - **iOS:** the build uses the iOS 15 deployment target, so swiftc availability checking applies. A planted fault referencing an iOS 16-only API must fail the build with an availability error.
   - **Android:** a check parses `platforms/android-36/data/api-versions.xml`. Every `android.*` class and member referenced by `classes.dex` (from `dexdump`) must have `since <= minSdk (29)`. A planted fault referencing an API 30+ member must fail, naming it.
8. **The public android target.**
   - Types and configuration:
     - `Targets` gains `android?: { minSdk: number }`: an integer, 29 <= minSdk <= 36. Anything else is `DRAGON_CONFIG_INVALID`, with a fix message.
     - `NormalizedTarget` gains `{ kind: 'android'; minSdk: number }`.
     - `KNOWN_TARGETS` becomes web, ios and android, and `COMMITTED_PROFILES` includes `androidProfile`. It stays all-unsupported, and android.ts stays byte-identical.
   - Diagnostics:
     - The font check and lowering diagnostics are reported for every configured native target.
     - With android not configured, every diagnostic and output is byte-identical to 4c1331c.
   - Outputs: `outputs.ios` and `outputs.android` stay `analysis-only` (or `blocked`). Generated sources are reachable only through `internal.ts`. A public `ready` native artifact before any device case passes would be a claim without a test; see section 4 for when it flips.
     - With the all-unsupported profile, a public android compile that declares a feature is blocked with `DRAGON_UNSUPPORTED_VALUE`. That is the honest fail-closed state. Tests pin both this and an empty-CSS android compile (`analysis-only`).
   - querySupport possibilities accept the android normalized target.
   - `docs/api.md` is updated in sections 1, 2.1, 2.2, 6.3 and 10.1:
     - android is a configured target with an SDK-integer floor;
     - its output is analysis-only;
     - no row is supported until a native case passes;
     - there is still no public `swift()` or `kotlin()`.
9. **The native generation compile.**
   - The lane compile is one compile per fixture and direction, with configuration `{ ios: { minimum: '15.0' }, android: { minSdk: 29 } }` in `'derive'` mode for **both** targets. This is the same bootstrapping mode gen-profile-rows uses: rows cannot exist before native cases pass. The generated code and expected dumps both come from this one compile, and its digest is the dump's `compilerDigest`.
   - A test proves that, for every layout case, this compile's layout input deep-equals `nativeLayoutProjection` of the enforced `{ ios, web }` compile. The web pipeline compile stays unchanged.
10. **Smoke run, not a lane and not recorded in `lanes.json`.** `pnpm run native:smoke -- --target ios|android` runs the same three cases on both platforms: `color-border-sides` (D1 node `long`), `text-wrap-spaces` (lines of wrapped text) and `overflow-hidden-bfc` (padding-box clip).
    - The devices:
      - iOS: an iPhone 17 simulator at scale 3;
      - Android: the `dragon-smoke` AVD, booted headless (`-no-window -no-snapshot -gpu swiftshader_indirect`) at density 420, so scale 2.625.
    - For each case, it installs, launches and pulls the dump, and requires:
      - the dump validates;
      - `device.scale` equals the device's scale;
      - check (d) passes against the TS engine at that DPR;
      - check (b) passes against the expected dump at that DPR;
      - the bridge self-check passes.
    - Device lanes stay "not run" until P5.

### Allowed files
- `package.json` (scripts only; no dependency or lockfile change)
- `docs/api.md`
- `packages/layout/src/text.ts`, `packages/layout/src/inline.ts`, `packages/layout/src/index.ts` (behaviour-preserving only)
- `packages/layout/generated/swift/Sources/DragonLayout/Text.swift`, `packages/layout/generated/swift/Sources/DragonLayout/Inline.swift`, `packages/layout/generated/kotlin/src/main/kotlin/dev/dragon/layout/Text.kt`, `packages/layout/generated/kotlin/src/main/kotlin/dev/dragon/layout/Inline.kt` (native:gen output only)
- `packages/layout/test/font-data.test.ts` (new)
- `packages/dragon/src/types.ts`, `packages/dragon/src/project.ts`, `packages/dragon/src/support.ts`, `packages/dragon/src/internal.ts`, `packages/dragon/src/index.ts`
- `packages/dragon/src/lower/native-program.ts` (new)
- `packages/dragon/src/emit/uikit.ts`, `packages/dragon/src/emit/android-views.ts`, `packages/dragon/src/emit/native-support.ts`, `packages/dragon/src/emit/expected-dump.ts` (new)
- `scripts/gen-profile-rows.ts` (only if KNOWN_TARGETS forces it; android.ts output byte-identical)
- `packages/dragon/test/native-projection.test.ts`: only the P3 pin "is not a configured target" (lines 27-31) may change, to assert that android is configured with `androidProfile`
- `packages/dragon/test/android-target.test.ts`, `packages/dragon/test/android-target.test-d.ts`, `packages/dragon/test/native-backends.test.ts`, `packages/dragon/test/expected-dump.test.ts` (new)
- `packages/parity/src/native-encoders.ts`, `packages/parity/src/native-host.ts`, `packages/parity/src/api-floor.ts` (new)
- `packages/parity/src/cli/native-build.ts`, `packages/parity/src/cli/native-smoke.ts`, `packages/parity/src/cli/native-encoders.ts` (new)
- `packages/parity/test/native-encoders.test.ts`, `packages/parity/test/native-host.test.ts`, `packages/parity/test/api-floor.test.ts` (new)
- `docs/goals/milestone-2/notes/T014-p4-backends.md` (Worker note)

### Verify (export `JAVA_HOME=/opt/homebrew/opt/openjdk@17` and `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` before every command)

**Setup and tests**
1. `pnpm install --frozen-lockfile`: the lockfile is unchanged.
2. `pnpm typecheck`: exit 0.
3. `pnpm test`:
   - All 946 prior tests are present and passing, with none skipped, `.todo` or `.only`. The test-name list at 4c1331c is a subset of the list at HEAD.
   - `git diff --diff-filter=MD --name-only 4c1331c -- 'packages/*/test'` prints only `packages/dragon/test/native-projection.test.ts`, and its diff touches only the P3 pin.
   - Report the wall time against about 100 s. Growth must be at most 5 minutes.

**Engine and translator unchanged**
4. `pnpm run layout:subset`: 0 violations; validate.ts is the only exempt file.
5. Vectors:
   - Run `pnpm run layout:vectors && pnpm run layout:dpr-vectors`.
   - `git diff --exit-code 4c1331c -- packages/layout/vectors packages/parity/expected-dpr` exits 0.
6. Generated engines:
   - Run `pnpm run native:gen`.
   - `git diff --name-only 4c1331c -- packages/layout/generated` lists only the Text and Inline files, and only if their TS changed.
   - Every generated header keeps translator digest `4069ea1701e109e4`.
7. `pnpm run native:swift` and `pnpm run native:kotlin`:
   - The counts are 258/258, 320000, 20258, 22000, 3/3, 783, 783, 120000 and 20783.
   - The digests are ae0f4087...48af38e and b9b2fb6b...10a8037.
   - Status is pass on both.
8. `pnpm run native:planted -- --target swift` and `--target kotlin`: 8/8 each.

**Milestone guards**
9. Capture: run `pnpm run parity:capture`, then `git status`. Nothing changes under packages/parity/expected or packages/parity/emitted.
10. `pnpm run profile:rows`: ios.ts, web.ts and android.ts are byte-identical to 4c1331c.
11. `pnpm run parity:dpr-report`: 783/783 pass the gate; exact 8795/8795 at 2, 3 and 2.625; failed 0.
12. `pnpm run parity:report`: 140/140 fixtures, 261 cases, failed 0. report.json, summary.md and index.html are byte-identical to a run at 4c1331c in the same worktree, Native lanes section included.

**Lanes unchanged**
13. `pnpm run parity:lanes -- --run-host`:
    - exit 0 with the counts and digests of item 7;
    - `out/lanes.json` is byte-identical to 4c1331c;
    - `--require-all` exits 1, naming the same 10 not-run lanes;
    - each of the 4 `--plant` faults exits 1 with its own message.
14. `cd packages/layout/generated/swift && xcodebuild -scheme DragonLayout -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/t014-ios build`: BUILD SUCCEEDED.

**New in P4: builds and floors**
15. `pnpm run native:build -- --target ios`:
    - exit 0; the ad-hoc signed `.app` exists;
    - it prints a case count equal to `layoutCases()` (261) and a sha256 of the generated source tree;
    - a second run prints the same sha256.
16. `pnpm run native:build -- --target android`:
    - exit 0; `apksigner verify` passes;
    - `aapt2 dump badging` shows `sdkVersion:'29'` and `targetSdkVersion:'36'`;
    - the case count is the same derived 261; a second run gives the same source sha256.
17. API floors:
    - The android check prints 0 references above API 29. `--plant api-30` exits non-zero, naming the member.
    - The ios planted iOS 16-only reference fails swiftc with an availability error.

**New in P4: encoders**
18. `pnpm run native:encoders -- --target swift` and `--target kotlin`:
    - Each language's generated encoder is compiled on the host (swiftc for macOS, kotlinc for the JVM).
    - It encodes all 261 reference dumps at DPR 3, re-labelled to its device lane with deterministic non-null pixels, timing, baseline, start and end.
    - Each output parses on the host, passes `validateNativeDump`, and deep-equals the TS object: 261/261 on both languages.
    - The planted encoder faults must each fail validation with the named code:
      - drop a field: missing-key;
      - add a key: extra-key;
      - write deviceEdges 60.5: not-integer;
      - write null outside the reference lane: null-not-allowed.
    - The schema-copy test from objective item 5 passes.

**New in P4: projection, expected dumps and generated code**
19. Tests in pnpm test:
    - **Shared projection:** the derive-mode native compile's layout input deep-equals `nativeLayoutProjection` for all 261 cases.
    - **Expected dumps:**
      - they exist for every case at ios 2 and 3 and at android 2, 3 and 2.625;
      - ios and android cover identical CSS longhands per node;
      - `color-border-sides` node `long` expects its initial border widths as 3 device px (`1` pt at scale 3 on iOS, `3` px on Android).
    - **Generated sources:** they contain no stylesheet text, selector, class name or JSON layout decoding.
    - **Checked int conversion:** it traps on 1.5 and on 2^31 in both Swift and Kotlin host tests.
    - **Font-data measurer:** over the Ahem constants it equals `ahemMeasurer` on every vector and corpus text input.

**New in P4: public android target**
20. Public android tests:
    - minSdk 28, 37, 29.5 and "29" are each `DRAGON_CONFIG_INVALID`;
    - `{ android: { minSdk: 29 } }` compiles;
    - an empty-CSS android compile is `analysis-only`;
    - `.a { width: 50px }` on android is blocked with `DRAGON_UNSUPPORTED_VALUE`;
    - type tests: `outputs.android` exists only when android is configured, and `android: {}` is a type error.

**New in P4: smoke run**
21. `pnpm run native:smoke -- --target ios` and `--target android`: for the three cases on both, the dump validates, check (d) passes, check (b) passes, and the bridge self-check passes. Report the scale, OS, model and font sha256 per platform.

**Scope**
22. Protected paths: `git diff --exit-code 4c1331c` passes on each of these.
    - Directories:
      - packages/translate
      - packages/layout/vectors
      - packages/parity/expected, expected-dpr, emitted and fixtures
      - packages/dragon/src/css, ua and analysis
      - .github
    - Parity sources, under packages/parity/src/: dpr, chrome, capture, pipeline, compare, native-dump, native-compare, samples, targets, lanes, report and render (all `.ts`).
    - Parity CLIs, under packages/parity/src/cli/: capture, vectors, dpr-capture, dpr-vectors, dpr-report, lanes and report (all `.ts`).
    - Single files:
      - packages/parity/out/lanes.json
      - packages/dragon/src/lower/ios-layout.ts
      - packages/dragon/src/emit/web-css.ts
      - packages/dragon/src/profiles
23. The T038 item-21 greps on packages/layout/src: 0 / 0 / 0.
24. `git diff --name-only 4c1331c..HEAD` lies inside allowed_files; `git remote -v` is empty; nothing is pushed.

### Stop if
- A file outside allowed_files is needed. Any existing test file changes beyond the one P3 pin. `NATIVE_DUMP_SCHEMA`, native-compare.ts or targets.ts must change.
- The layout refactor changes any vector, corpus digest, native count or planted result, or needs a translator change (the translator digest must stay 4069ea1701e109e4).
- Any emitted CSS file, capture, vector, profile, report byte or `lanes.json` changes. The compilation digest of a config without android changes.
- Any profile row would get a status other than unsupported on android, or any row is promoted from a build, a smoke run, an expected dump or a reference dump.
- A layout case cannot be lowered or emitted for either backend. Either backend covers fewer cases, fewer CSS longhands per node, or a weaker check than the other.
- The text hook needs line metrics recomputed from UIFont or FontMetrics, or engine values that cannot be exported behaviour-preservingly.
- The Android build needs Gradle, AGP, androidx or any download. Any install, npm dependency or lockfile change is needed.
- A floor check needs an API above iOS 15 or API 29 without a guarded fallback.
- A smoke case fails (d) or (b), or the bridge self-check fails, on either platform: report the case, node, scale and values. Do not change the snap rule, the gate or the case.
- The simulator or `dragon-smoke` fails to boot twice: report it as a tooling fault. Never report it as a pass.
- Any tolerance, gate, check or case is loosened, skipped or reduced.
- `pnpm test` grows by more than 5 minutes.
- Verification fails twice.

### Risks
- **Size.** This is the biggest package on the board. Mitigations: commit in layers (the measurer and layout refactor, then program and expected dumps, then encoders, then emitters and builds, then the smoke run), and use the fallback layer split above.
- **Padding-box clipping and per-side borders** have no single native property on either platform. The technique must be explicit in the program, and it gets pixel proof in P6.
- **Line-box mapping.** The engine's line rect is the glyph content area, which Chrome's Range rect also is, not the line box. The half-leading derivation is the most likely source of an error in (d) or (a). This is why the smoke run includes wrapped text.
- **TextKit or StaticLayout may break lines differently from the engine**, even with Ahem. The smoke run only shows geometry. Break offsets have no reference until P5 (observation 1).
- **Kotlin/JVM bytecode through d8 on API 29** is untested here. The API-floor check covers only framework references, not ART behaviour. The floor-OS run is P7.

## 3. Evidence

**Ran in /tmp/dragon-p3 at 4c1331c:**
- typecheck: exit 0.
- pnpm test: 946/946 in 101.2 s.
- parity:lanes: default exit 0; `--run-host` exit 0 with both host lanes passing, the reference proof at 261/261 per DPR and target, and lanes.json byte-identical; `--require-all` exit 1 on 10 lanes; the 4 plants each exit 1.
- git diff name-only, protected-list, compare.ts and test-file checks, as in the table in section 1.

**Read:**
- the T012 note and receipt;
- the T009 note;
- native-strategy.md;
- T002-device-lanes.md;
- decisions.md;
- AGENTS.md;
- api.md sections 2.1, 2.2, 4.1, 4.4, 7 and 10;
- in packages/parity: native-dump.ts, targets.ts, lanes.ts and native-compare.ts;
- in packages/dragon: internal.ts, project.ts, lower/ios-layout.ts and types.ts;
- packages/layout/src/text.ts, and inline.ts lines 26-88 and 212-255;
- the generated Text.swift and Text.kt, and Package.swift;
- the tests that pin android and analysis-only: s5.test.ts:49,86,174,281; types.test-d.ts:18-39,87-88; compile.test.ts:14-19,78,153; native-projection.test.ts:27-31.

**Toolchain:**
- Gradle 9.7.1 is installed, but there is no `~/.gradle` cache, so AGP has never been fetched.
- In build-tools 36.0.0: `aapt2`, `d8`, `zipalign`, `apksigner` and `dexdump` are present.
- `platforms/android-36/data/api-versions.xml` exists; for example `StaticLayout$Builder` has since=23.
- `kotlin-stdlib.jar` is at `/opt/homebrew/Cellar/kotlin/2.4.20/libexec/lib`.
- AVD `dragon-smoke` uses the android-36 arm64 image with density 420 and panel 1080x2400.
- `adb` and `emulator` are not on PATH; they are under `$ANDROID_HOME`.

## 4. Board sequence changes
- **PM now:** run `git merge --ff-only t012-p3-lane-core` on master (to 4c1331c), and record T012 as accepted by T013. Then add T014 (P4) with this package, followed by a Judge review of P4.
- **native-strategy.md sections 3.9 item 7 and 5:**
  - The Android host is built from the SDK tools without Gradle, AGP or androidx, as the counterpart of the swiftc app.
  - The P4 table row "build blocked until install" is stale: the SDK is installed.
  - Record both in native-strategy.md, or in decisions.md under Native lanes.
- **P5 gains:**
  - a line-break reference. Either the engine exports each line's start and end, behaviour-preservingly with new vectors, or the Chrome captures add per-line text ranges as a new capture set that leaves existing captures untouched. The device-lines lane then fails on a break mismatch as its own kind;
  - `DUMP_FAULTS` applied to real device dumps on both platforms;
  - AVD creation at density 320 and 480, plus the existing 420;
  - verifying the iPad simulator's scale of 2;
  - the `lanes.json` flips.
- **P6:**
  - the sample-points protocol (host to device) and the PixelCopy-vs-screencap probe;
  - re-proving the 958 iOS exact rows natively;
  - an explicit ruling, with an api.md update, on when `outputs.ios` and `outputs.android` change from analysis-only to ready. The Judge's recommendation is only after that target's native cases pass.
- **P6 or T999:** api.md 2.1 says the digest covers backend revisions. P4 records an emitter digest in generated headers only. Adding it to the compilation digest would change every emitted CSS header, so it needs a PM ruling like T011's.
- **P7:** the Android floor run on the installed API 29 image. The iOS floor run needs the oldest simulator runtime Xcode 27 offers, a download the owner has already allowed. Also the 20-run flake check and the ABI cross-check.
- **T999:** add a constraint. The public android target exists from P4, so an android row marked exact without an android native case fails the audit. Also, `outputs.*` must not be `ready` without that target's passing native cases.

## 5. Missing evidence
- The Judge did not re-run parity:report (the byte check), parity:dpr-report, native:planted, the DragonLayout xcodebuild, profile:rows or parity:capture at 4c1331c. These rely on the T012 receipt and on tests inside pnpm test.
- Nothing yet measures whether TextKit 1 and StaticLayout put Ahem line breaks where the engine does at DPR 2, 3 and 2.625. That comes in the P4 smoke run, and in full in P5.
- `android.graphics.fonts.Font` buffer parsing and `CTFontCopyTable` reads of the bundled Ahem are unmeasured on device.
