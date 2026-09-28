# T014 P4 native backends for iOS and Android: DONE

Worker, 2026-09-28, claude-code. Board: `docs/goals/milestone-2/state.yaml`, task T014. Branch `t014-p4-backends` from 4c1331c, worktree `/tmp/dragon-p4`. Local commits only; `git remote -v` is empty; nothing pushed.

**Result: done.** Every T014 item is built and verified on both platforms, with the PM rulings and the owner's floor decision applied (section 1). The smoke run passes 3/3 on the iPhone 17 simulator (scale 3) and 3/3 on `dragon-smoke` (API 36, scale 2.625). Each run passes:
- validation;
- `device.scale` equal to the device's scale;
- check (d) against the TS engine;
- check (b) against the expected dump, with equal expected digests;
- the bridge self-check.

The snap rule, the gate and the cases are unchanged.

## 1. History

1. **First attempt: blocked before any code.** Any engine-source edit rewrites the header of `Unions.swift`, `Strings.swift` and `Unions.kt`, which were outside allowed_files. The cause is `translate/src/generate.ts`, which writes a digest over every engine file into those headers. That note is kept in this history.
2. **PM ruling, 2026-09-28** (T011 precedent, option a). Those three files may change their header line only, with bodies byte-identical to 4c1331c. The translator stays protected.
3. **PM update: relaxed tier.** Generated headers and digest lines are relaxed; they go in the deviations, with a body check.
4. **PM text strategy** (decisions.md, Text strategy). The engine owns line breaks and native code supplies advances only:
   - iOS through Core Text (`CTTypesetterCreateLine`);
   - Android through `Paint.getRunAdvance` with `LINEAR_TEXT_FLAG`, never `measureText`;
   - neither TextKit nor StaticLayout may choose a break.

   P4 follows this. It is recorded as deviation 1.
5. **Build, verify, smoke.** iOS passes everything. With `getRunAdvance` at textSize = unitsPerEm, the Android self-check failed at 999.99609375 (section 3a), which was reported as blocked.
6. **PM ruling on the advance source: option (a).** The Android bridge reads advances from `hmtx`, with the glyph found through `cmap`, in the same buffer as `head` and `hhea`. For parity of method, iOS now reads `cmap` and `hmtx` through `CTFontCopyTable` too.
   - Core Text (`CTTypesetterCreateLine`) and `getRunAdvance` stay only as evidence probes in `bridge-<platform>.json`.
   - iOS already matched exactly before the change: its Core Text probe gives 1000 at every size, and its self-check passed both before and after.
   - Real-font text (TXT1) will need shaped advances (kerning, GPOS). Those will also be computed in font units, and the TXT1 package designs them. `getRunAdvance` stays an evidence probe.
7. **Re-run after ruling (a).** Both self-checks pass. Android check (d) failed on text line right edges by 1 device px, which was reported as blocked (section 3b).
8. **PM ruling on (d): option (ii).** Dragon positions every glyph at the engine's advances, and the platform only rasterises:
   - iOS draws each engine line with `CTFontDrawGlyphs` (glyph ids from `cmap`), and TextKit is no longer used;
   - Android draws with `Canvas.drawGlyphs`;
   - line edges in the dump come from Dragon's own placement (what it drew), read from the view's live position and snapped with the one snap rule;
   - the device lane's pixel check (P6) will verify the raster against Chrome;
   - accessibility: the line text is exposed through `accessibilityLabel` (iOS) and `contentDescription` (Android). Full accessibility parity is P6 work.
9. **API 29 fallback, tried and then superseded.** The per-code-point `drawText` fallback for API 29 and 30 was built and run on a new API 29 AVD, `dragon-floor` (density 420).
   - It passed 3/3 with no workaround: validation, (d), (b) and the self-check.
   - (d) and (b) read Dragon's placement, so they cannot tell the two draw paths apart. The raster difference is P6 work.
   - Its API-floor guard (a class named `…Api31`, called only behind an explicit `SDK_INT >= 31` check) was proven by the build (1 guarded call) and by an `api-31-unguarded` plant.
10. **Owner decision: the Android floor is API 31 (Android 12).** It supersedes the fallback: `drawGlyphs` only, and the fallback and the guarded class were removed.
    - The floor changed wherever it is defined:
      - `ANDROID_MIN_SDK` becomes 31..36 (project.ts), with a note in types.ts;
      - the android-target tests (30 is now invalid, 31 to 36 are valid), and `minSdk: 31` in the other tests;
      - the APK `minSdkVersion` and `d8 --min-api` become 31, and the native compile config becomes `{ ios: { minimum: '15.0' }, android: { minSdk: 31 } }`;
      - the build plant becomes `api-34` (`Context.createDeviceContext`), and api.md is updated.
    - The checker keeps its `…Api<N>` guard rule, with synthetic tests, for future guarded calls.
    - Every file edited is in allowed_files.
    - `dragon-floor` (API 29) is now below the floor. It stays on disk, unused.

## 2. What was built (T013 section 2, items 1 to 10)

1. **Programs** (`lower/native-program.ts`).
   - `lowerNativePrograms` builds a UIKit and an Android Views program, `dragon.uikit-program/1` and `dragon.android-views-program/1`. Both come from the one `nativeLowered` tree (the same object) and one shared paint lowering.
   - Each node holds its id, kind, parent, native class, clip flag and text. Each write holds a backend key, a technique, a detail and the CSS longhands it realises.
   - Kinds: background, border widths, styles and colours per side, the padding-box clip, font, and text colour.
   - Borders are `dragon-owned-paint` on both. Solid, dashed, dotted and double each have a declared technique. Nothing is promoted from applied values.
   - The clip is topology: a `DragonClipView` over the padding box, with `clipsToBounds` on iOS and `clipBounds` on Android.
   - `ios-layout.ts` is unchanged, and `nativeLayoutProjection` stays the one projection.
2. **Emitters** (`emit/uikit.ts`, `emit/android-views.ts`, `emit/native-support.ts`).
   - Each case has one build function (chunked into 12-node parts) and one input function built from typed engine constructors, one small function per box. There is no JSON, CSS, selector or class name.
   - The support code is emitted source: the checked conversions, the views, the tree, the bridge and the dump readback.
   - On the device, the generated code runs the translated `layout` at the device scale and snaps with the translated `snapEdges`:
     - iOS sets frames as `CGFloat(edge - parentEdge) / scale`;
     - Android uses `View.layout` ints from `dragonCheckedInt` inside a `DragonGroup`, whose `onMeasure` and `onLayout` only apply stored frames. There is no Auto Layout.
   - Border widths come from the translated `box_resolveBorder` on `layout_zoomInput`, so initial widths are 3 device px.
3. **Text path.**
   - iOS `DragonTextView` uses TextKit 1, constructed explicitly:
     - `lineFragmentPadding` 0, `hyphenationFactor` 0, `lineBreakStrategy []` and `usesFontLeading` false;
     - an `NSLayoutManagerDelegate` per-line hook sets each fragment's line box, baseline and line-left.
   - Android `DragonTextView` uses `StaticLayout.Builder`:
     - `BREAK_STRATEGY_SIMPLE`, `HYPHENATION_FREQUENCY_NONE`, `setIncludePad(false)` and `setUseLineSpacingFromFallbacks(false)`;
     - a `LineHeightSpan.chooseHeight` sets `fm.top = fm.ascent` and `fm.bottom = fm.descent` for each line.
   - The engine's lines come from the translated `inline_buildRun` and `inline_breakLines`, which is the engine's exact arithmetic, so `inline.ts` did not change. Each engine line is rendered as its own run (U+2028 or `\n` between lines, unbounded width), so neither platform ever chooses a break.
   - Before any view is built, each line's width is checked against the engine's layout rect. A mismatch traps.
   - `text.ts` gains `fontDataMeasurer`, `FontData`, `coveredIndex`, `coveredCodePoints` and `AHEM_FONT_DATA`, and `ahemMeasurerWith` is now that measurer over the Ahem constants. It adds no string literal; a zero line gap returns `ZERO`.
   - The bridges read `head` and `hhea` from the font, and advances at size = unitsPerEm. The platform-rule key is darwin-arm64. The self-check record (`bridge-<platform>.json`) holds the font sha256.
4. **Expected dumps** (`emit/expected-dump.ts`).
   - One dump per backend, case and DPR (ios 2 and 3; android 2, 3 and 2.625), holding each node's applied map and native class. The generated code embeds the sha256 of each and traps at an unknown scale.
   - The TS engine is injected, because the core imports `@dragon/layout` for types only (ua.test.ts guard).
   - Colours are RGBA8 on both. `cssCoverage` proves the longhands are identical per node.
5. **Encoders** (`parity/src/native-encoders.ts`).
   - Swift and Kotlin classes and a writer are emitted by walking `NATIVE_DUMP_SCHEMA`. Keys come in schema order, and the writer traps on a non-finite number, a non-integer integer, an empty id, a bad enum value and a wrong length.
   - Null is written only for `nullable: 'always'`. There is no Codable and no kotlinx.
   - Readback on device:
     - iOS: frames by `convert(bounds, to: root)`, pixels by `drawHierarchy(afterScreenUpdates: true)` into an sRGB RGBA8 `CGContext`;
     - Android: frames by `getLocationInWindow` minus the root, divided by density, pixels by `PixelCopy` into ARGB_8888;
     - on both, sha256 plus the samples at host-supplied points (an empty list in P4).
6. **Host apps** (`parity/src/native-host.ts`), built into the gitignored `packages/parity/out/native/<target>`.
   - iOS: a UIKit app with a window scene, built with `xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios15.0-simulator -O`, plus Info.plist and Ahem, and signed with `codesign -s -`.
   - Android without Gradle, AGP or androidx: `aapt2 link` (min 29, target 36, Ahem in assets), `kotlinc -cp android.jar`, `d8 --min-api 29` with kotlin-stdlib, `zipalign`, then `apksigner` with a debug key generated under `out/`. The host is an Activity.
   - Both contain all 261 cases from `layoutCases()`.
7. **API floors** (`parity/src/api-floor.ts`, `cli/native-build.ts`).
   - iOS: swiftc availability checking at the iOS 15 target.
   - Android: every `android.*` class and member in the `dexdump -d` output of classes.dex must exist at API 29 in `api-versions.xml`. Members reached through app subclasses are resolved to the declaring class.
   - Planted faults: `--plant ios-16` (UICalendarView) and `--plant api-30` (Context.getDisplay).
8. **Public android target.**
   - `Targets.android { minSdk }` must be an integer from 29 to 36; anything else is `DRAGON_CONFIG_INVALID` with a fix.
   - `NormalizedTarget` gains android. `KNOWN_TARGETS` is web, ios and android. `COMMITTED_PROFILES` includes `androidProfile`, and android.ts stays byte-identical.
   - Font and lowering diagnostics are reported for every configured native target.
   - The output is analysis-only. The iOS reason text was updated (observation 4).
   - querySupport accepts android. api.md sections 1, 2.1, 2.2, 6.3 and 10.1 are updated.
9. **Native compile.** `nativeCompile` is one compile per fixture and direction, `{ ios: { minimum: '15.0' }, android: { minSdk: 29 } }` in derive mode for both targets. Its digest is the dump's `compilerDigest`.
10. **Smoke run** (`cli/native-smoke.ts`). It covers the three cases on the iPhone 17 simulator and the `dragon-smoke` AVD. It is not a lane, and lanes.json is unchanged.

## 3. The smoke runs (final, at the API 31 floor)

| | iOS: iPhone 17, iOS 26.5 (23F77), scale 3 | Android: dragon-smoke, Android 16 (API 36, BE2A.250530.026.D1), density 420, scale 2.625, text by Canvas.drawGlyphs |
|---|---|---|
| Bridge self-check | pass: 1000 / 800 / 200 / 0, 95 advances from cmap+hmtx; font sha256 b719ecb3...b94b8448 = repo Ahem | pass: the same values and sha256 |
| Advance probe (evidence only), U+0058 in font units | Core Text: 1000 at every size | getRunAdvance: 999.609375 (10), 999.99609375 (1000), 1000 only at 256 |
| color-border-sides | valid; (d) 11/11; (b) 44; digest equal | valid; (d) 11/11; (b) 44; digest equal |
| text-wrap-spaces | valid; 25 lines; (d) 43; (b) 56; digest equal | valid; 25 lines; (d) 43; (b) 56; digest equal |
| overflow-hidden-bfc | valid; 4 lines; (d) 26; (b) 93; digest equal | valid; 4 lines; (d) 26; (b) 93; digest equal |

**History of the Android text path** (each result was reported when it happened):
1. **`getRunAdvance` as the advance source.** Self-check failed: 999.99609375 at textSize 1000. Fixed by ruling (a): advances from `hmtx`.
2. **Native run drawing with a live-extent readback.** (d) failed on line right edges by 1 device px: the drawn run is 1/128 px short on 2 glyphs, 52.4922 against the engine's 52.5, which snaps to 53. Fixed by ruling (ii): Dragon places every glyph.
3. **API 29 per-code-point `drawText` fallback on `dragon-floor`.** Passed 3/3 with no workaround; it was then superseded by the owner's API 31 floor.
4. **API 31+ `Canvas.drawGlyphs` on `dragon-smoke`.** Passes 3/3 (the table above).

**What (d) proves now.** It proves the engine's frames and line boxes are applied exactly as Dragon places them. It does not prove the platform rasterises the glyphs where they were placed; the P6 pixel lane does that on both platforms.

**TXT1.** Real-font text will need shaped advances (kerning, GPOS), also computed in font units; the TXT1 package designs them. `getRunAdvance` and Core Text stay evidence probes.

## 4. Verification (JAVA_HOME and ANDROID_HOME exported before each command)

| # | Command | Result |
|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | pass; lockfile unchanged |
| 2 | `pnpm typecheck` | exit 0 |
| 3 | `pnpm test` (earlier run) | 48 files, 990/990 at that point, none skipped, todo or only; 153.8 s wall (baseline about 100 s). `vitest list`: 946 names at 4c1331c, 990 at HEAD. One base name is missing: the P3 pin was renamed, see deviation 3. `git diff --diff-filter=MD --name-only 4c1331c HEAD -- packages/*/test`: only `packages/dragon/test/native-projection.test.ts`, at the pin (lines 27-31, one line added) |
| 4 | `pnpm run layout:subset` | 0 violations (exempt: validate.ts) |
| 5 | `layout:vectors && layout:dpr-vectors`; diff vectors and expected-dpr | exit 0 |
| 6 | `native:gen`; generated diff | Text.swift, Text.kt, and the header line only of Unions.swift, Strings.swift and Unions.kt (sources 84d76dca1e16b970 to the current digest). A body diff after line 1: **0 lines** in each of the three. Every generated header keeps translator 4069ea1701e109e4 |
| 7 | `native:swift`, `native:kotlin` | both 258/258, 320000, 20258, 22000, 3/3, 783, 783, 120000, 20783; digests ae0f4087...48af38e and b9b2fb6b...10a8037; status pass |
| 8 | `native:planted --target swift / kotlin` | 8/8 each |
| 9 | `parity:capture`; `git status` | 0 changes under expected and emitted |
| 10 | `profile:rows` | ios.ts, web.ts and android.ts byte-identical (git diff exit 0) |
| 11 | `parity:dpr-report` | 783/783 pass the gate; exact 8795/8795 at 2, 3 and 2.625; failed 0 |
| 12 | `parity:report` | 140/140 fixtures, 261 cases, failed 0. report.json, summary.md and index.html are `cmp`-identical to a run at 4c1331c in this worktree, Native lanes section included |
| 13 | `parity:lanes -- --run-host` | exit 0, with the P3 counts and digests; lanes.json diff exit 0. `--require-all` exits 1 naming the same 10 not-run lanes. The four plants each exit 1 with their own message |
| 14 | `xcodebuild -scheme DragonLayout ... build` | BUILD SUCCEEDED |
| 15 | `native:build --target ios` | exit 0; ad-hoc signed .app; 261 cases = layoutCases(); a second run gives the same source sha256 (the final sources are f8c80fc4...3723c4); swiftc 35 s |
| 16 | `native:build --target android` (twice) | exit 0; `apksigner verify` pass; badging `minSdkVersion:'31' targetSdkVersion:'36'` (deviation 2); d8 --min-api 31; 261 cases; source sha256 dad7fa7b...13ec6e3d on both runs |
| 17 | Floors | android: 141 `android.*` references checked, 0 above API 31. `--plant api-34`: exit 1 naming `android.content.Context#createDeviceContext(I)Landroid/content/Context;`. `--plant ios-16`: exit 1, "error: 'UICalendarView' is only available in iOS 16.0 or newer". Earlier, at the API 29 floor: `--plant api-30` and `--plant api-31-unguarded` each caught and named |
| 18 | `native:encoders --target swift / kotlin` | each 261/261 valid, deep-equal and byte-equal to JSON.stringify (keys in schema order). The planted faults fail with missing-key, extra-key, not-integer and null-not-allowed. The schema-copy test is in pnpm test |
| 19 | Tests in pnpm test | shared projection 261/261 at DPR 1, 2, 3 and 2.625; expected dumps 1305 = 261 x 5 with identical coverage; `long` expects [1,1,1,1] pt at 3 on iOS and [3,3,3,3] px on Android; the 56 generated source files hold none of 1551 stylesheet rules, 1427 selector class names or 6096 web class bindings, and no JSON decoding; checked int traps on 1.5, 2^31 and -2^31-1 in Swift and Kotlin; the font-data measurer equals the 4c1331c Ahem measurer on every vector and corpus text input, with and without the planted rules |
| 20 | Public android tests (floor 31, owner decision) | minSdk 28, 29, 30, 37, 31.5, "31", NaN and null are each DRAGON_CONFIG_INVALID; 31 to 36 compile; empty-CSS android is analysis-only; `.a { width: 50px }` is blocked with DRAGON_UNSUPPORTED_VALUE; type tests pass (`android: {}` and `minSdk: '31'` are type errors) |
| 21 | `native:smoke --target ios` (final) | **pass** 3/3: valid, scale 3, (d), (b), digest, self-check (section 3) |
| 21 | `native:smoke --target android` (final, dragon-smoke API 36, drawGlyphs) | **pass** 3/3: valid, scale 2.625, (d), (b), digest, self-check (section 3) |
| 3 | `pnpm test` (final) | 48 files, 994/994 (946 prior + 48 new), none skipped, todo or only; 96.2 s wall; `vitest list`: 945 of the 946 base names present, the missing one being the renamed P3 pin |
| 22 | Protected paths | `git diff --exit-code 4c1331c` over the full list: exit 0 |
| 23 | T038 item-21 greps | 0 / 0 / 0, plus 0 node or fs imports and 0 non-type `@dragon/layout` imports in dragon/src |
| 24 | Scope | every changed file is in allowed_files (the three header-only files by the PM ruling); no remote |

## 5. Deviations

1. **Text strategy (PM update), advance source (PM ruling a) and glyph placement (PM ruling ii).**
   - The engine owns the breaks: `inline_breakLines` runs on the device, and each engine line is its own run. `inline.ts` is unchanged, because the translated `buildRun` and `breakLines` already expose the exact values.
   - The bridge advances come from the font's `cmap` and `hmtx` tables on both platforms, not the spec's `CTFontGetAdvancesForGlyphs` or "advances at textSize = unitsPerEm".
   - `CTTypesetterCreateLine` and `getRunAdvance` (linear) are evidence probes only.
   - Dragon draws every glyph at the engine's advances: `CTFontDrawGlyphs` on iOS, `Canvas.drawGlyphs` on Android. TextKit 1 and StaticLayout (spec item 3) are no longer used for placement or drawing; accessibility gets the text through the view's properties.
2. **aapt2 36.0.0 badging.** It prints `minSdkVersion:'29'`; older aapt printed `sdkVersion:'29'`. The CLI accepts either spelling and prints the raw lines.
3. **The P3 pin was renamed** to "is a configured target with androidProfile: ...", because its old name claimed the opposite. So the 4c1331c test-name list is a subset of HEAD minus this one renamed test.
4. **The unknown-target message** now reads "(Dragon knows web, ios and android)". It appears only for invalid configs.
5. **Generated headers** (relaxed tier and PM ruling). The sources-digest line of Unions.swift, Strings.swift and Unions.kt changed; their bodies are identical (0 lines). `layout/src/index.ts` gained exports (FontData, fontDataMeasurer, zoomInput, resolveBorder, platformFontSize, zoomFontSize, snapEdge), which moves the same digest.
6. **Expected dumps take the engine as a parameter** (`ExpectedEngine`). An existing guard allows the core only type imports of `@dragon/layout` and no rounding outside color.ts. The host supplies the TS engine and `Math.fround` for Android's float textSize.
7. **Line readback (ruling ii).** Line edges are Dragon's placement: the view's live position plus the run's LU left and width, snapped with `snapEdge`. The content top is the line-box top plus the engine's half-leading; the baseline is the placed baseline; start and end are the engine's offsets. The P6 pixel lane verifies the raster.
8. **Node readback.** deviceEdges come from the live position; iOS traps if a position is not whole within 1e-6. The frame is deviceEdges / scale, as in `frameOf`. The iOS clip frame is read in whole device px / scale.
9. **The iOS font point size** is the engine's instance size (`platformFontSize(zoomFontSize(size, scale))`) / scale, and the Android textSize is the same size as a float, so glyphs match the engine's measure. Applied values say so.
10. **The breaking width** is the parent's content width, from the translated `box_resolvePadding` and `box_resolveBorder`. Percent padding on an absolutely positioned text container would use the wrong basis. The per-line width check traps on any such mismatch.
11. **The bridge self-check record** is a separate `bridge-<platform>.json` (the dump schema is unchanged). It carries an evidence-only advance probe, the same on both platforms.
12. **The iOS smoke scale** comes from the device type's `capabilities.plist` (`ArtworkDeviceScaleFactor`); the Android scale comes from `wm density` / 160.
13. **Compile time.** Input functions are one per box, and build functions are chunked into 12 nodes, because one large case took swiftc -O 400 s. swiftc runs with `-j`, and kotlinc with `-J-Xmx8g`.
14. **`SupportProfiles.android` is optional** for test-only replacement profiles (existing s5 tests pass `{ ios, web }`); absent means `androidProfile`.
15. **Border paint** covers `double` too, which one fixture uses. Dotted uses round dots, like Chrome. The pixel proof is P6.
16. **Android floor at API 31 (owner decision).** The public range is 31..36; the APK, d8 and the native compile use 31. The API-floor checker keeps a guard rule (`…Api<N>` classes behind an explicit `SDK_INT >= N`) with synthetic tests. The `api-34` plant replaces `api-30`.
17. **The smoke CLI has `--avd`.** Its Android output directory is `smoke-<avd>`. It stops a running emulator of another AVD before booting the named one. The `dragon-floor` AVD (API 29) was created for the superseded fallback run.

## 6. For the board

- **P5:**
  - the full-corpus device lanes on both platforms, reusing this host protocol;
  - DUMP_FAULTS applied to real dumps;
  - AVDs at density 320 and 480;
  - the iPad scale of 2;
  - the lanes.json flips.
- **P6:**
  - pixel proof that the rasterised glyphs, the Dragon-owned borders and the clips land where Dragon placed them;
  - the sample-points protocol, whose host side exists with an empty list;
  - the PixelCopy and screencap probe;
  - full accessibility parity for custom-drawn text.
- **P7:** the floor-OS run now targets API 31 (a system image to install; only android-29 and android-36 are present) and the oldest iOS runtime.
- **TXT1:** shaped advances (kerning, GPOS) in font units for real fonts.
