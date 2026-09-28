# T014 P4 native backends: BLOCKED on Android smoke check (d) for text line right edges; everything else done

Worker, 2026-09-28, claude-code. Board: `docs/goals/milestone-2/state.yaml`, task T014. Branch `t014-p4-backends` from 4c1331c, worktree `/tmp/dragon-p4`. Local commits only; `git remote -v` is empty; nothing pushed.

**Result: blocked.**
- **The ruling was applied.** After PM ruling (a), both bridges read glyph advances from the font's own `cmap` and `hmtx` tables, so the method is the same on both platforms. Core Text and `getRunAdvance` stay only as evidence probes.
- **The self-check now passes on both platforms**, and the Android engine lays out all three smoke cases.
- **iOS smoke:** 3/3 pass.
- **Android smoke:** `color-border-sides` passes. `text-wrap-spaces` and `overflow-hidden-bfc` fail check (d) on text line right edges by exactly 1 device px (section 3b), which is the stop condition "a smoke case fails (d): report". I did not change the snap rule, the gate, the case or the readback rounding.
- **Everything else** in T014 is built and verified on both platforms.

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
7. **Re-run.** Both self-checks pass. iOS smoke passes 3/3. Android passes (b) on all three cases and (d) on `color-border-sides`, and fails (d) on the text line right edges (section 3b).

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

## 3. The Android smoke

### 3a. Resolved: advance source (PM ruling a)

| | iOS (iPhone 17, iOS 26.5 23F77, scale 3) | Android (dragon-smoke, Android 16 API 36 BE2A.250530.026.D1, density 420, scale 2.625) |
|---|---|---|
| Font sha256 | b719ecb3...b94b8448 = repo Ahem | b719ecb3...b94b8448 = repo Ahem |
| head / hhea | 1000 / 800 / 200 / 0 | 1000 / 800 / 200 / 0 |
| Advances from `cmap` + `hmtx` | 1000 per covered glyph, 0 for U+200B: **self-check pass** | 1000 per covered glyph, 0 for U+200B: **self-check pass** |
| Evidence probe, U+0058 in font units at text size 10 / 26.25 / 100 / 256 / 257 / 512 / 1000 / 2048 | Core Text: 1000 at every size | `getRunAdvance` (linear): 999.609375 / 999.8512 / 999.9609375 / 1000 / 999.9848 / 999.9924 / 999.99609375 / 999.9981 |

Before the ruling, the Android bridge used `getRunAdvance`, got 999.99609375 and failed the self-check. The engine then refused `text-wrap-spaces` at `w1:text0` (text-glyph).

### 3b. Open: check (d) on text line right edges on Android

| Case @ scale | iOS @3 | Android @2.625 |
|---|---|---|
| color-border-sides | valid; (d) 11/11; (b) 44; digest equal | valid; (d) 11/11; (b) 44; digest equal |
| text-wrap-spaces | valid; 25 lines; (d) 43 pass; (b) 56 pass | valid; 25 lines; (b) 56 pass; **(d) fail on 11 lines** |
| overflow-hidden-bfc | valid; 4 lines; (d) 26 pass; (b) 93 pass | valid; 4 lines; (b) 93 pass; **(d) fail on 4 lines** |

Every failure is a text line's right edge, 1 device px left of the engine's. Every other edge (lefts, tops, bottoms, every box) matches exactly. Examples:
- `w1:text0:line0` "XX": dump right 52, engine snapRect 53;
- `w6:text0:line2`: 151 against 152;
- `txt:text0:line0..3`: 52 against 53.

**Why.**
- Ahem 10px at 2.625 is 26.25 device px per glyph. The engine measures "XX" as 52.5 px (3360 LU), which `snapEdge` rounds half-up to 53.
- The device draws the run with Android's own advances, 1/256 px short per glyph (the probe above). So the live right edge is 52.4922 px, and the readback (`left + getRunAdvance`, half-up) gives 52.
- On iOS the same line reads 60 = 60, because Core Text's advances are exact.

**The discrepancy is real:** Android draws the glyph run 1/128 px short. It only becomes a whole device px because 52.5 sits on a rounding boundary.

**Options** (the PM or owner rules; I changed nothing):
- **(i)** Read a live text extent the way Blink converts a text width to a LayoutUnit, `LayoutUnit::FromFloatCeil` (the engine's `units_fromPxCeil`, translated), and then snap with `snapEdge`, on both platforms. 52.4922 becomes 3360 LU, then 53. This changes the readback convention, not the snap rule or the gate, but it was chosen after seeing the failure, so it needs a ruling.
- **(ii)** Dragon positions each glyph at the engine's advances instead of letting the native run advance them (for example, per-glyph draws on Android, or `CTFontDrawGlyphs` with positions on iOS for symmetry). The live extent would then be the engine's, and the platform only rasterises. `Canvas.drawGlyphs` is API 31, so it is above the floor; API 29 needs another path.
- **(iii)** Treat the Android advance quantisation (1/256 px per glyph) as an owner-approved deviation for (d) on text line extents. This loosens a check, and I do not recommend it.

## 4. Verification (JAVA_HOME and ANDROID_HOME exported before each command)

| # | Command | Result |
|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | pass; lockfile unchanged |
| 2 | `pnpm typecheck` | exit 0 |
| 3 | `pnpm test` | 48 files, 990/990 (946 prior + 44 new), none skipped, todo or only; 153.8 s wall (baseline about 100 s; +54 s). `vitest list`: 946 names at 4c1331c, 990 at HEAD. One base name is missing: the P3 pin was renamed, see deviation 3. `git diff --diff-filter=MD --name-only 4c1331c HEAD -- packages/*/test`: only `packages/dragon/test/native-projection.test.ts`, at the pin (lines 27-31, one line added) |
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
| 15 | `native:build --target ios` (twice) | exit 0; ad-hoc signed .app; 261 cases = layoutCases(); source sha256 b755437b...2529f987 on both runs; swiftc 34-38 s |
| 16 | `native:build --target android` (twice) | exit 0; `apksigner verify` pass; badging `minSdkVersion:'29' targetSdkVersion:'36'` (deviation 2); 261 cases; source sha256 ecd6c826...27dccb69 on both runs |
| 17 | Floors | android: 172 `android.*` references checked, 0 above API 29. `--plant api-30`: exit 1 naming `android.content.Context#getDisplay()Landroid/view/Display;`. `--plant ios-16`: exit 1, "error: 'UICalendarView' is only available in iOS 16.0 or newer" |
| 18 | `native:encoders --target swift / kotlin` | each 261/261 valid, deep-equal and byte-equal to JSON.stringify (keys in schema order). The planted faults fail with missing-key, extra-key, not-integer and null-not-allowed. The schema-copy test is in pnpm test |
| 19 | Tests in pnpm test | shared projection 261/261 at DPR 1, 2, 3 and 2.625; expected dumps 1305 = 261 x 5 with identical coverage; `long` expects [1,1,1,1] pt at 3 on iOS and [3,3,3,3] px on Android; the 56 generated source files hold none of 1551 stylesheet rules, 1427 selector class names or 6096 web class bindings, and no JSON decoding; checked int traps on 1.5, 2^31 and -2^31-1 in Swift and Kotlin; the font-data measurer equals the 4c1331c Ahem measurer on every vector and corpus text input, with and without the planted rules |
| 20 | Public android tests | minSdk 28, 37, 29.5, "29", NaN and null are each DRAGON_CONFIG_INVALID; 29 to 36 compile; empty-CSS android is analysis-only; `.a { width: 50px }` is blocked with DRAGON_UNSUPPORTED_VALUE; type tests pass |
| 21 | `native:smoke --target ios` | **pass**: 3/3 cases; bridge self-check pass |
| 21 | `native:smoke --target android` (after ruling a) | **fail** (section 3b): bridge self-check pass; all 3 dumps valid with device.scale 2.625 and equal expected digests; (b) passes 3/3; (d) passes color-border-sides and fails text-wrap-spaces (11 line right edges) and overflow-hidden-bfc (4 line right edges), each 1 device px |
| 21 | `native:smoke --target ios` (after ruling a) | **pass**: 3/3; self-check pass with hmtx advances |
| 3 | `pnpm test` (after ruling a) | 990/990, 95.4 s wall |
| 22 | Protected paths | `git diff --exit-code 4c1331c` over the full list: exit 0 |
| 23 | T038 item-21 greps | 0 / 0 / 0, plus 0 node or fs imports and 0 non-type `@dragon/layout` imports in dragon/src |
| 24 | Scope | every changed file is in allowed_files (the three header-only files by the PM ruling); no remote |

## 5. Deviations

1. **Text strategy (PM update) and advance source (PM ruling a).**
   - The engine owns the breaks: `inline_breakLines` runs on the device, and each engine line is its own run. `inline.ts` is unchanged, because the translated `buildRun` and `breakLines` already expose the exact values.
   - The bridge advances come from the font's `cmap` and `hmtx` tables on both platforms, not the spec's `CTFontGetAdvancesForGlyphs` or "advances at textSize = unitsPerEm".
   - `CTTypesetterCreateLine` and `getRunAdvance` (linear) are evidence probes only.
2. **aapt2 36.0.0 badging.** It prints `minSdkVersion:'29'`; older aapt printed `sdkVersion:'29'`. The CLI accepts either spelling and prints the raw lines.
3. **The P3 pin was renamed** to "is a configured target with androidProfile: ...", because its old name claimed the opposite. So the 4c1331c test-name list is a subset of HEAD minus this one renamed test.
4. **The unknown-target message** now reads "(Dragon knows web, ios and android)". It appears only for invalid configs.
5. **Generated headers** (relaxed tier and PM ruling). The sources-digest line of Unions.swift, Strings.swift and Unions.kt changed; their bodies are identical (0 lines). `layout/src/index.ts` gained exports (FontData, fontDataMeasurer, zoomInput, resolveBorder, platformFontSize, zoomFontSize, snapEdge), which moves the same digest.
6. **Expected dumps take the engine as a parameter** (`ExpectedEngine`). An existing guard allows the core only type imports of `@dragon/layout` and no rounding outside color.ts. The host supplies the TS engine and `Math.fround` for Android's float textSize.
7. **Line readback.** The live values are the line-box top, the baseline and the glyph left and right. The content top is the line-box top plus the engine's half-leading, which is whole device px; the bottom is the top plus ascent and descent. Start and end are the engine's offsets, after a trap-on-mismatch check that the native line holds exactly that text (the engine owns breaks). The line-left is set from the engine on both platforms.
8. **Node readback.** deviceEdges come from the live position; iOS traps if a position is not whole within 1e-6. The frame is deviceEdges / scale, as in `frameOf`. The iOS clip frame is read in whole device px / scale.
9. **The iOS font point size** is the engine's instance size (`platformFontSize(zoomFontSize(size, scale))`) / scale, and the Android textSize is the same size as a float, so glyphs match the engine's measure. Applied values say so.
10. **The breaking width** is the parent's content width, from the translated `box_resolvePadding` and `box_resolveBorder`. Percent padding on an absolutely positioned text container would use the wrong basis. The per-line width check traps on any such mismatch.
11. **The bridge self-check record** is a separate `bridge-<platform>.json` (the dump schema is unchanged). It carries an evidence-only advance probe, the same on both platforms.
12. **The iOS smoke scale** comes from the device type's `capabilities.plist` (`ArtworkDeviceScaleFactor`); the Android scale comes from `wm density` / 160.
13. **Compile time.** Input functions are one per box, and build functions are chunked into 12 nodes, because one large case took swiftc -O 400 s. swiftc runs with `-j`, and kotlinc with `-J-Xmx8g`.
14. **`SupportProfiles.android` is optional** for test-only replacement profiles (existing s5 tests pass `{ ios, web }`); absent means `androidProfile`.
15. **Border paint** covers `double` too, which one fixture uses. Dotted uses round dots, like Chrome. The pixel proof is P6.

## 6. For the board

- **PM ruling needed:** check (d) on Android text line extents (section 3b, options i, ii or iii). Then re-run `native:smoke --target android` and `--target ios`.
- **TXT1:** real-font shaped advances (kerning, GPOS) in font units; `getRunAdvance` and Core Text stay evidence probes.
- **P5:** the break reference, which is now the engine's own breaks (text strategy); DUMP_FAULTS on real dumps; AVDs at 320 and 480; the iPad scale; the lanes.json flips.
- **P6:** the sample points (the host protocol exists, with an empty list), the PixelCopy and screencap probe, and pixel proof of the Dragon-owned border and clip paint.
