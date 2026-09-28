# T015 P4 review and P5 package

Judge, 2026-09-28. Decision: **approved**.

P4 (T014, branch `t014-p4-backends` at cdf9312, worktree `/tmp/dragon-p4`, base 4c1331c) is approved. The branch itself needs no fixes. Two merge items (M1, M2 in section 2) are required when the integrator merges it into current master; without M1, the merged `pnpm test` fails.

P5 is approved as **one package covering both platforms and all five device lanes, device-pixels included** (section 4). The pixel lane moves from P6 into P5, because P4's custom glyph drawing has no independent evidence until it exists.

## 1. P4 verification (Judge re-ran in /tmp/dragon-p4 at cdf9312, JAVA_HOME and ANDROID_HOME exported)

| Check | Result |
|---|---|
| Worktree | clean at cdf9312; `git remote -v` empty |
| `git diff --name-only 4c1331c..cdf9312` | 34 files, every one in T014 allowed_files (Inline.ts/.swift/.kt untouched) |
| Test files | 8 added; 1 modified (`native-projection.test.ts`, the P3 pin only: renamed, asserts android, web and ios plus `androidProfile` and the 3-target KNOWN_TARGETS) |
| Header-only files | Unions.swift, Strings.swift and Unions.kt: body after line 1 identical to 4c1331c (all three) |
| Protected paths (T014 list) | `git diff --exit-code 4c1331c cdf9312` exit 0 |
| `pnpm test` | 48 files, **994/994**, 97.1 s wall (base about 100 s) |
| `native:build --target ios` | exit 0; swiftc arm64-apple-ios15.0-simulator -O, 53 files, 40 s; 261 cases = layoutCases(); source sha256 f8c80fc4...ad09b, **identical to the Worker's** |
| `native:build --target android` | exit 0; apksigner v3 verified; badging `minSdkVersion:'31' targetSdkVersion:'36'`; d8 --min-api 31; 261 cases; source sha256 dad7fa7b...3ec6e3d, **identical to the Worker's**; 141 `android.*` references, 0 above API 31 |
| Plant `--plant ios-16` | exit 1: `'UICalendarView' is only available in iOS 16.0 or newer` |
| Plant `--plant api-34` | exit 1, naming `android.content.Context#createDeviceContext(I)...` (since API 34) |
| `native:encoders --target swift` / `kotlin` | each 261/261 valid, deep-equal and byte-equal; the 4 planted faults fail with missing-key, extra-key, not-integer and null-not-allowed |
| `native:smoke --target ios` | **pass 3/3** on iPhone 17 (iOS 26.5, 23F77), scale 3: self-check pass (1000/800/200/0, 95 advances, Ahem sha256 b719ecb3...b94b8448 = repo); color-border-sides (d) 11 (b) 44, text-wrap-spaces 25 lines (d) 43 (b) 56, overflow-hidden-bfc (d) 26 (b) 93; digests equal; drawHierarchy 1200x900 |
| `native:smoke --target android` | **pass 3/3** on dragon-smoke (API 36, density 420, scale 2.625, Canvas.drawGlyphs): the same counts; PixelCopy 1050x788; the getRunAdvance probe again shows 999.609375 to 999.998 units (evidence only) |

**Code read:**
- native-smoke.ts and native-build.ts;
- the Swift and Kotlin `DragonTextView`s, the line placement and the dump readback in native-support.ts;
- targets.ts, lanes.ts, samples.ts and native-compare.ts;
- the `engine-linebreak` diff stat and linefit.ts.

**Not re-run by the Judge:** these rely on the T014 receipt and on the tests inside `pnpm test`.
- typecheck on the branch (it was run on the merged tree, where it passes);
- layout:subset and the vector diffs;
- native:swift, native:kotlin and native:planted;
- parity:capture, profile:rows, parity:dpr-report, parity:report and parity:lanes;
- the DragonLayout xcodebuild;
- the T038 greps.

### Verdict: approve. Every T013 item is present on both platforms, and each deviation is covered by a ruling or is accepted.
- **Accepted deviations:**
  - text strategy, the cmap/hmtx advances and Dragon positioning every glyph (PM rulings, recorded in decisions.md);
  - the API 31 floor (owner, decision 6);
  - aapt2's `minSdkVersion` spelling;
  - the renamed P3 pin;
  - engine injection into the expected dumps;
  - the chunked build functions;
  - `bridge-<platform>.json` beside the dump, which leaves the schema unchanged.
- **The floor change is consistent in code:** there are no `API 29`, `minSdk 29` or `api-30` references left in packages/parity/src, packages/dragon/src or api.md.

### The limitation P4 exposed (it shapes P5)
- **Line edges in the dump come from Dragon's placement, not from the raster.** `dump()` builds line edges from the view's live origin plus the engine's own `xLU`/`widthLU`, snapped (native-support.ts, around line 651). The glyphs are then drawn by `CTFontDrawGlyphs` / `Canvas.drawGlyphs` at the engine's x positions.
- **So checks (d) and (b) on lines are partly self-referential.** They prove that the view frames are live and that the engine arithmetic ran on device. They do not prove where the platform put ink.
- **Nothing in P4 samples the raster.** `pixels.samples` is empty on every dump, and no Chrome pixel reference exists at DPR 2, 3 or 2.625 (the expected-dpr captures are geometry JSON only).
- **`DUMP_FAULTS` cannot run in full on real dumps.** Its `channel-delta-1` entry needs samples.

## 2. Merge into current master (the integrator performs it)

`git merge-tree --write-tree master t014-p4-backends` (master be37b60, 14 commits past 4c1331c: the north star, compiler seams, the WPT import, logical properties and the background shorthand):
- **Textual conflict:** only `package.json` scripts. Master adds north-star:* and wpt:*, and P4 adds native:build, native:smoke and native:encoders.
- **Files changed on both sides:** package.json and packages/dragon/src/internal.ts; internal.ts auto-merges.

The Judge extracted the merged tree to /tmp/t015-merge (outside the repo), took the union of the scripts and ran the checks:

| Check on the merged tree | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | ok |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 1101/1104. **2 real failures:** native-host.test.ts:46 `expected 273 to be 261` and :69 `expected 1365 to be 1305`. The other failures were environmental: the WPT tests without `vendor/wpt` and the Kotlin checked-int test without JAVA_HOME. Re-run with `DRAGON_WPT_DIR` and JAVA_HOME set, those 3 files pass 28/28 |
| `native:build --target ios` | exit 0, **273 cases** = layoutCases(), floor pass |
| `native:build --target android` | exit 0, **273 cases**, floor 31, 0 references above 31 |

The 12 wave cases, including the RTL logical-property cases, lower, project, emit and compile on both platforms. The two failures are literal counts only: the deep-equal loop ran over all 273 before the count assertion.

**Must-fix at merge:**
- **M1.** `packages/parity/test/native-host.test.ts`:
  - Replace the literal `261` at line 46, and `261 * 5` at line 69, with derived counts: `layoutCaseIds().length`, and the sum over targets of `deviceDprs(t).length` times that. This follows master's convention (ddc957e, `case-count.ts`: derived counts, plus a floor of `MILESTONE_1_LAYOUT_CASES`).
  - Drop "261 today" from the test name at line 28.
  - The equality assertions stay; this is not a loosening.
- **M2.** Take the union of the `package.json` scripts, with no dependency change.
- **Verify after the merge,** exporting `JAVA_HOME`, `ANDROID_HOME` and `DRAGON_WPT_DIR`:
  - `pnpm typecheck`;
  - `pnpm test`, all green;
  - `pnpm run native:build -- --target ios` and `--target android`, each at the derived case count;
  - `pnpm run parity:lanes -- --run-host`, exit 0;
  - `git diff --exit-code` of the committed lanes.json after that run.

**Non-blocking observations (relaxed tier or docs):**
- **O1.** T014 note section 2 is stale. Items 3, 6, 7 and 9 still describe TextKit 1 / StaticLayout, minSdk 29 and `--plant api-30`. Sections 1, 3 and 5 are correct. Add a one-line pointer, or fix it at merge.
- **O2.** decisions.md (uncommitted owner edits) has three problems:
  - "Native glyph advances" still lists "Android API 29–30: per-cluster drawText ... behind a guard". That contradicts decision 6 and the code, where the fallback was removed.
  - "Text strategy" names `CTTypesetterCreateLine` / `getRunAdvance` as the advance sources; the hmtx ruling supersedes them.
  - Decision 7 still says native engines handle breaking, selection and editing. With Dragon drawing glyphs, **selection and editing of custom-drawn text are unaddressed**, and need an owner ruling before the P6 accessibility work.
- **O3.** The smoke CLI kills any running emulator of another AVD. The P5 runner should address devices by serial (`-port`), and not kill unrelated emulators.
- **O4.** The Android capture at 2.625 is 1050x788 for a viewport 787.5 device px tall. The pixel protocol must define the raster size of a non-integral root, identically for Chrome and both devices.

## 3. Scope decisions for P5

1. **device-pixels moves into P5 (from P6).** The reasons:
   - P4 made glyph placement Dragon-owned on both platforms, so only a raster check can show that ink lands where Dragon placed it. Without it, a device-lines "pass" would be half self-referential.
   - `channel-delta-1` in `DUMP_FAULTS` cannot be applied to real dumps without samples.
   - Most of the machinery already exists: `generateSamples`/`checkPixels` from P3, and a host capture with a points list that is empty today. What is missing is a Chrome pixel reference at the device DPRs, the host-to-device points transport, a glyph sample rule and the capture-trust probe.
   - **P6 becomes the fix-and-promote phase:** paint-fidelity fixes, native promotion of rows, and the `outputs.*` ready ruling.
2. **Largest safe slice.** One package: both platforms, all five device lanes, the break reference, real-dump faults and the raster plant.
   - **Fallback split** (only after verification fails twice): by layer, both platforms in each half, never by platform.
     - **P5a:** the runner and device matrix, layout-vectors-device, device-frames, device-applied and device-lines with the break reference, and `DUMP_FAULTS` on real dumps except `channel-delta-1`.
     - **P5b:** the pixel reference, points protocol, glyph rule, capture trust, glyph plant, device-pixels and `channel-delta-1`.
   - Neither half is accepted until both land.
3. **The text strategy is DECIDED** (decisions.md "Text strategy": option b, the engine owns breaks). The device-lines lane is designed on it:
   - **The breaks on device:** they are the translated engine's `inline_breakLines`, as in P4, and the reference is the TS engine's start/end.
   - **The new breaker is not wired in P5.** The UAX #14 breaker on `engine-linebreak` (linebreak.ts, linefit.ts) is standalone: nothing in inline.ts uses it, and it adds no generated files. Wiring it into inline.ts is a separate engine package (TXT1), which would regenerate the break vectors under the strict tier with the Chrome break capture as its proof.
   - **Condition:** the owner's decisions.md edits are uncommitted today. They must be on master before P5 starts (section 5), or the P5 stop applies.
4. **The device matrix** (every case uses a 400x300 css px viewport, so the root is 800x600, 1050x787.5 or 1200x900 device px):
   - **iOS scale 3:** iPhone 17 (402 pt wide).
   - **iOS scale 2:** **iPad (A16)** (820 pt wide, capabilities scale 2). iPhone SE (3rd gen) is scale 2 but only 375 pt wide, so the root would be off-screen and its compositor capture untrustworthy.
   - **Android** (android-36 arm64 default image, installed):
     - `dragon-320`: 1080x2400, 540 dp wide, scale 2;
     - `dragon-smoke`: density 420, 1080 px, 411 dp wide, scale 2.625;
     - `dragon-480`: **1440x3120**, 480 dp wide, scale 3. A 1080 px panel at 480 is only 360 dp, too narrow.
   - **The runner** checks that the root fits the window in device px, and stops rather than crop.
5. **Text scale:** P5 pins the device text size at the default (Android `font_scale` 1.0, iOS content size `large`) and records it in the run record. The largest-text-size run needs the engine value model (V2) and scaled-root Chrome captures, so it is not P5 (section 5).
6. **The API 31 floor probe:** `Canvas.drawGlyphs` has never run on API 31. P5 downloads `system-images;android-31;default;arm64-v8a` (allowed) and runs `native:smoke` on a new `dragon-api31` AVD as evidence, not a lane. The full floor-OS lanes stay P7. If the download is unavailable, that is recorded as missing evidence, not a stop. The Judge's `sdkmanager --list` printed nothing in this sandbox.

## 4. P5 package (T016): device lanes on iOS and Android

### Objective (binding)
**Base and branch.**
- Branch `t016-p5-device-lanes` from master **after** the P4 merge (M1 and M2 applied). Include `engine-linebreak` if the integrator has merged it, but do not wire it. Use a new worktree, `/tmp/dragon-p5`, and commit locally only.
- Case lists derive at the start from `layoutCases()`, `deviceDprs()` and the manifests: **every fixture on master when P5 starts, wave fixtures included**. There are no literals.

**Items.**
1. **Device runner and matrix** (`device-run.ts`, `cli/native-devices.ts`).
   - Provision and verify the matrix in section 3.4: simctl for the iPad (A16) if none is available, and avdmanager for dragon-320 and dragon-480.
   - Headless boot (`-no-window -no-audio -no-snapshot -gpu swiftshader_indirect`), with emulators addressed by serial.
   - Batch launches: all cases per device in one launch or in derived chunks, with the dumps pulled.
   - Record per device: model, OS/build, scale from the device profile (capabilities.plist / `wm density`) **and** from the app (`UIScreen.scale` / `displayMetrics.density`), the window size in device px, and the text scale.
2. **layout-vectors-device** (`device-vectors.ts`).
   - Run the existing generated harnesses from `packages/translate/harness`, unchanged and consumed by import only, on device:
     - iOS: a simulator binary (`xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios15.0-simulator`) run with `xcrun simctl spawn`;
     - Android: the Kotlin harness dexed with `d8 --min-api 31`, run under ART with `adb shell app_process` (or `dalvikvm`).
   - Stdin and stdout carry the same corpus lines. The comparison is the host lane's byte-for-byte comparison.
   - The lane passes only if every suite count and both corpus digests equal that target's `layout-vectors-host` run: currently 1092+ top-level and DPR vectors plus the corpora, derived.
   - It runs on iPhone 17 and dragon-smoke, because the vectors are DPR-independent inputs.
3. **device-frames, device-applied and device-lines**, for every case at every device DPR of each target (ios 2 and 3; android 2, 3 and 2.625):
   - **frames:** node (d) against snapRect of the TS engine, and node (a) against the committed Chrome DPR capture within `GATE_DEVICE_PX`.
   - **applied:** (b) against the expected dump, plus the native class and an equal `expectedDigest`.
   - **lines:** line (a) against Chrome and line (d) against the engine, plus the **break check** in item 4.
   - The existing check functions keep their semantics. Any split of (a) into node and line parts is additive.
4. **The line-break reference.**
   - **(i) Engine export.** A behaviour-preserving export of each text node's per-line `start`/`end` in UTF-16 units:
     - Use the existing `buildRun`/`breakLines` arithmetic through `index.ts` exports. Put a helper in inline.ts only if inline.ts itself calls it.
     - Commit the result as break vectors under `packages/layout/break-vectors/dpr-<d>/`, for every case at 2, 3 and 2.625, via `pnpm run layout:break-vectors`.
   - **(ii) Chrome break capture.** A new capture set, `packages/parity/expected-breaks/darwin-arm64/dpr-<d>/`: per text node, per line start/end, from Chrome at each device DPR.
     - Use `chrome.ts` flags unchanged (imported).
     - Group single-code-unit Range rects by line.
     - Existing captures stay byte-identical.
   - **(iii) Comparisons.** The dump's line `start`/`end` must equal the break vectors, and the break vectors must equal the Chrome breaks.
   - **(iv) Failure kind.** Any mismatch is reported as the failure kind **`break-mismatch`**, separate from geometry.
5. **device-pixels** (`pixel-reference.ts`, `cli/pixel-capture.ts`).
   - **Chrome pixel reference:**
     - `Page.captureScreenshot` at each device DPR with the existing flags (sRGB, no LCD text), for every case;
     - PNGs committed under `packages/parity/expected-pixels/darwin-arm64/dpr-<d>/`, with a manifest: sha256, Chrome version, flags, size, and the raster-size rule for 787.5 (O4).
   - **Points protocol:**
     - The host generates the points per case and DPR with `generateSamples` from the snapped engine geometry and the program's paint facts;
     - it pushes a points file to each device (the app container on iOS, the app files dir on Android);
     - the device samples its own compositor capture into `pixels.samples`;
     - `checkPixels` compares those samples with the Chrome PNG.
   - **Glyph rule:**
     - `SAMPLE_RULES` gains `'glyph'`, appended; the existing rules' points are unchanged.
     - For each Ahem-covered glyph, it takes the box from engine advances and font ascent/descent (the Ahem ink is the em square): an interior point when the box is wide enough for the inset, and edge scanlines across the left edge of each line's first visible glyph and the right edge of its last.
     - Glyph boxes come only from engine data, never from the capture. The generator refuses non-Ahem families.
   - **Capture trust (the former P6 probe):**
     - For the three smoke cases on every device, the in-app capture (drawHierarchy / PixelCopy) must equal the OS screenshot (`simctl io screenshot` / `adb exec-out screencap -p`) at every generated point, within `GATE_CHANNEL_DELTA`, at the root's window offset.
   - **Raster plant `glyph-offset-1`:**
     - A build plant (in `native-build.ts` and `native-support.ts`) draws every glyph 1 device px right.
     - On text-wrap-spaces (ios 3, android 2.625), device-pixels must fail on glyph or edge rules while device-frames and device-lines still pass. This proves the pixel lane sees what (d) cannot.
   - **Lane outcome:**
     - device-pixels may end **fail**; every failure is listed with case, DPR, rule, point, the native RGBA and the Chrome RGBA.
     - P5 does not change any drawing or paint technique (that is P6).
6. **DUMP_FAULTS on real dumps.**
   - `DUMP_FAULTS` gains `'break-shifted'`, appended: one line's end and the next line's start move by one code unit.
   - Every entry is applied to real device dumps of both targets at every device DPR. Each must be caught by the check it targets, with its named kind.
   - Report the applicable dump count per fault, target and DPR: it must be greater than 0 for every entry. Zero faults may go uncaught.
7. **Lanes file.**
   - `pnpm run parity:lanes -- --run-host --run-device` runs all 12 lanes (6 per target) and writes `packages/parity/out/lanes.json` (force-added) with no `not run` lane. The schema may become `dragon.lanes/2` if the record shape changes.
   - Each device record carries:
     - the device and OS per DPR set;
     - counts compared per check;
     - failure counts by kind;
     - the run digests.
   - `checkLaneParity` extends to the run records: both targets have the same lanes, checks, fault list and sample rules, and equal case lists per shared DPR.
   - `--require-all` exits 0 only when all 12 lanes pass; otherwise it names exactly the lanes that did not pass. The lanes stay report-only (decisions 14 and "Report-only start").
8. **Floor probe (evidence):** the dragon-api31 smoke from section 3.6.

### Allowed files
- `package.json` (scripts only; no dependency or lockfile change)
- `packages/parity/src/lanes.ts`, `packages/parity/src/cli/lanes.ts`, `packages/parity/src/targets.ts` (device matrix and run records; case lists stay derived)
- `packages/parity/src/native-compare.ts`, `packages/parity/src/samples.ts` (additive only: the break check, the line/node split of (a), fault application, `break-shifted`, the `glyph` rule; existing semantics and points unchanged)
- `packages/parity/src/native-host.ts`, `packages/parity/src/cli/native-build.ts`, `packages/parity/src/cli/native-smoke.ts`
- `packages/parity/src/device-run.ts`, `packages/parity/src/device-lanes.ts`, `packages/parity/src/device-vectors.ts`, `packages/parity/src/line-breaks.ts`, `packages/parity/src/pixel-reference.ts` (new)
- `packages/parity/src/cli/native-devices.ts`, `packages/parity/src/cli/break-vectors.ts`, `packages/parity/src/cli/break-capture.ts`, `packages/parity/src/cli/pixel-capture.ts` (new)
- `packages/dragon/src/emit/native-support.ts` (points-file read, sampling and the glyph plant hook only)
- `packages/dragon/src/internal.ts` (exports only)
- `packages/layout/src/index.ts` (exports only), `packages/layout/src/inline.ts` (behaviour-preserving helper only)
- `packages/layout/generated/swift/Sources/DragonLayout/Inline.swift`, `packages/layout/generated/kotlin/src/main/kotlin/dev/dragon/layout/Inline.kt` (native:gen output only)
- `packages/layout/generated/**` (translator source-digest header line only: relaxed tier, body-identical)
- `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**`, `packages/parity/expected-pixels/**` (new committed data)
- `packages/parity/out/lanes.json`
- `packages/parity/test/lanes.test.ts`: only the device "not run" pins (around lines 145-147 and 178-185). Without a device run, device lanes are still not run; the committed file must hold run states.
- `packages/parity/test/native-compare.test.ts`: the `DUMP_FAULTS` pin (around line 201), append only.
- `packages/parity/test/samples.test.ts`: the `SAMPLE_RULES` pin (around line 16), append only.
- `packages/parity/test/device-run.test.ts`, `packages/parity/test/device-lanes.test.ts`, `packages/parity/test/device-vectors.test.ts`, `packages/parity/test/line-breaks.test.ts`, `packages/parity/test/pixel-reference.test.ts` (new)
- `docs/goals/milestone-2/notes/T016-p5-device-lanes.md` (Worker note)

### Verify (export `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` and `DRAGON_WPT_DIR=<main checkout>/vendor/wpt` before every command; BASE is the P5 start commit)

**Setup and tests**
1. `pnpm install --frozen-lockfile`: the lockfile is unchanged.
2. `pnpm typecheck`: exit 0.
3. `pnpm test`:
   - The `vitest list` at BASE is a subset of HEAD's; none are skipped, `.todo` or `.only`.
   - `git diff --diff-filter=MD --name-only BASE -- packages/parity/test packages/dragon/test packages/layout/test packages/translate/test packages/wpt/test` lists only the three pinned files above, with their changes limited as stated.
   - Wall-time growth is at most 5 minutes, and no device run is inside `pnpm test`.

**Guards (strict tier unchanged)**
4. `pnpm run layout:subset`: 0 violations.
5. Run `pnpm run layout:vectors && pnpm run layout:dpr-vectors`; then `git diff --exit-code BASE -- packages/layout/vectors packages/parity/expected-dpr` exits 0.
6. `pnpm run native:gen`:
   - The generated diff is header lines only (a body-identical script reports 0 body lines), plus Inline.* only if inline.ts changed.
   - The translator digest is unchanged.
7. `pnpm run native:swift` and `native:kotlin`: counts and digests equal to a BASE run. `pnpm run native:planted -- --target swift` and `--target kotlin`: 8/8 each.
8. Existing captures and outputs:
   - `pnpm run parity:capture`: no change under packages/parity/expected or emitted;
   - `pnpm run profile:rows`: byte-identical;
   - `pnpm run parity:dpr-report`: failed 0 at 2, 3 and 2.625;
   - `pnpm run parity:report`: failed 0; outside the Native lanes section, byte-identical to a BASE run.

**Devices and host builds**
9. `pnpm run native:devices` prints the matrix, and the scale from both the profile and the app agrees:
   - iPhone 17 at 3 and iPad (A16) at 2;
   - dragon-320 at 2, dragon-smoke at 2.625 and dragon-480 at 3.

   It also prints OS/build, the window in device px (at least 1200x900 at scale 3, 1050x788 at 2.625 and 800x600 at 2) and the text scale at default.
10. `pnpm run native:build -- --target ios` and `--target android`:
    - exit 0, with a case count equal to the derived layoutCases();
    - the Android floor check 0 references above 31;
    - `--plant ios-16` and `--plant api-34` still exit 1 naming the API;
    - `--plant glyph-offset-1` builds on both.
11. `pnpm run native:encoders -- --target swift` and `--target kotlin`: all valid and equal, 4/4 plants caught. `pnpm run native:smoke -- --target ios` and `--target android`: 3/3 each.

**The break reference**
12. `pnpm run layout:break-vectors`:
    - It writes break vectors for every case at 2, 3 and 2.625.
    - A second run leaves `git diff --exit-code` at 0.
    - A test proves the export equals the device-side `inline_breakLines` offsets (host Swift and Kotlin) for every case.
13. `pnpm run parity:break-capture`:
    - It captures Chrome breaks for every case at 2, 3 and 2.625; a second run is byte-identical.
    - It reports the engine against Chrome: equal on N/N. Any mismatch is listed as `break-mismatch` and recorded in both targets' device-lines.

**The pixel reference**
14. `pnpm run parity:pixel-capture`:
    - It captures every case at 2, 3 and 2.625, with the manifest written.
    - A re-capture of a derived subset (every 25th case per DPR) is byte-identical.
    - It prints the committed size, which must be at most 50 MB.

**Lanes**
15. `pnpm run parity:lanes -- --run-host --run-device`:
    - It exits after writing lanes.json with **no `not run` lane**, and parity passes.
    - Per target, it prints each lane's state, the counts compared per check (a, b, c, d, breaks), failures by kind, and the device and OS per DPR.
    - **layout-vectors-device** equals layout-vectors-host (counts and both digests) on both targets.
    - **device-frames, device-applied and device-lines pass on both targets.**
    - **device-pixels** is pass, or fail with every failure listed.
16. Real-dump faults: every `DUMP_FAULTS` entry, `break-shifted` included, is caught on real dumps of both targets at every device DPR by its named check, with applicable counts greater than 0 and 0 uncaught.
17. Raster plant: with `glyph-offset-1`, text-wrap-spaces fails device-pixels on glyph or edge rules on both targets (ios 3, android 2.625), while device-frames and device-lines still pass.
18. Capture trust: for the 3 smoke cases on all 5 devices, the in-app capture equals the OS screenshot at every generated point, within `GATE_CHANNEL_DELTA`.
19. `pnpm run parity:lanes -- --require-all`:
    - exit 0 if all 12 lanes pass; otherwise exit 1 naming exactly the non-pass lanes;
    - the 4 existing `--plant` lane faults each still exit 1 with their own message.
20. Floor probe: `sdkmanager "system-images;android-31;default;arm64-v8a"`, create `dragon-api31` (density 420, 1080x2400), then `pnpm run native:smoke -- --target android --avd dragon-api31`: 3/3, or the failure reported. An unavailable download is recorded as missing evidence.

**Scope**
21. Protected paths: `git diff --exit-code BASE` passes on each of these.
    - Directories:
      - packages/translate
      - packages/layout/vectors
      - packages/parity/expected, expected-dpr, emitted and fixtures
      - packages/dragon/src/css, ua, analysis, profiles and lower
      - .github
    - Emitters: packages/dragon/src/emit, except native-support.ts.
    - Parity sources, under packages/parity/src/: dpr, chrome, capture, pipeline, compare, native-dump, report, render, native-encoders and api-floor (all `.ts`).
    - NATIVE_DUMP_SCHEMA is unchanged.
22. The T038 greps: 0 / 0 / 0. `git diff --name-only BASE..HEAD` lies inside allowed_files. `git remote -v` is empty, and nothing is pushed.
23. Relaxed tier: the receipt lists every generated header, digest line, report-formatting or note change, each with its body-identical check. None needs a stop.

### Stop if
- **Missing decision.** docs/decisions.md on BASE lacks the "Text strategy" section. Stop before building device-lines.
- **Scope.** Any of these:
  - a file outside allowed_files is needed;
  - an existing test changes beyond the three pins;
  - NATIVE_DUMP_SCHEMA, compare.ts, chrome.ts or packages/translate must change;
  - an existing vector, capture, emitted CSS, profile row or expected dump changes.
- **Engine.** An engine change other than a behaviour-preserving export is needed, or wiring the `engine-linebreak` breaker is needed.
- **A case cannot run.** A master fixture, wave fixtures included, cannot be lowered, emitted, compiled or run on either platform. Report it by name. Never drop, skip or special-case it.
- **Non-pixel lane failure.** device-frames, device-applied, device-lines or layout-vectors-device fails on either target:
  - run every lane to completion;
  - record the states in lanes.json;
  - then stop with the full failure list (case, DPR, node, kind, values).
  - Do not change emitters, the snap rule, the engine or the gate.
- **Pixel lane integrity.** Any of these:
  - capture trust fails on any device;
  - the `glyph-offset-1` plant is not caught;
  - the Chrome pixel re-capture is not byte-identical;
  - the committed pixel set exceeds 50 MB (an owner storage call).
- **Device fit.** A device window cannot hold the root at its scale. Report it as a tooling fault; never crop.
- **Boot failure.** A simulator or AVD fails to boot twice. Report it as a tooling fault, never as a pass.
- **Weakening.** Any tolerance, gate, check, case, DPR or device is loosened, skipped or reduced, or any profile row would be promoted (promotion is P6).
- **Build tooling.** The Android build needs Gradle, AGP, androidx or an npm/lockfile change. The only download allowed is the API 31 system image.
- **Test time.** `pnpm test` grows by more than 5 minutes.
- **Repeated verification failure.** Verification fails twice. Fall back to the layer split in section 3.2 (P5a/P5b, both platforms in each), never a platform split.

### Risks
- **Size and wall time.** Five devices, 273+ cases per DPR and 1092+ vectors on device. Mitigations: batch launches, emulators run in sequence, and commits in layers (runner, vectors, frames/applied/lines, breaks, pixels, faults).
- **Pixel parity on Dragon-owned paint.** Dashed, dotted and double borders, and clips, may fail device-pixels. That is expected and is P6's work. Glyph failures are a P6 must-fix too, but they are the finding P5 exists to surface.
- **Chrome vs native AA at subpixel glyph x.** Interior glyph points are solid, so they compare at channel delta 0. Edges are compared by position within 1 device px.
- **ART running the Kotlin harness** outside an app process (`app_process`) may need a small launcher class. It goes inside device-vectors.ts; packages/translate stays untouched.

## 5. Board sequence changes
- **PM now:**
  - Record T015 approved.
  - The integrator merges `t014-p4-backends` into master with M1 and M2 and the post-merge verification in section 2.
  - Commit the owner's `docs/decisions.md` edits and `docs/research/text-spike/` to master **before P5 starts**, since the P5 stop depends on them.
  - Fix O2 in decisions.md:
    - remove the API 29–30 drawText bullet;
    - cross-reference hmtx advances from "Text strategy";
    - annotate decision 7.
  - Point T014 note section 2 at sections 1 and 5 (O1).
  - Merge `engine-linebreak` after P4, as planned. It stays unwired until TXT1.
- **Add T016 (P5)** with the section 4 package, and a T017 Judge review of P5.
- **P6 (revised): fix and promote.**
  - Fix device-pixels failures in Dragon-owned paint and glyph raster on both platforms.
  - Re-prove the 958 iOS exact rows, and derive android rows, only through passing native cases (oracle clause 4).
  - Rule on `outputs.ios` and `outputs.android` becoming ready (only after that target's lanes pass), and update api.md.
  - Rule on the emitter digest in the compilation digest.
  - **Accessibility parity for custom-drawn text** on both platforms:
    - per-line accessibility frames and text (UIAccessibilityElement per line; AccessibilityNodeInfo virtual children);
    - a dump-level accessibility check (the iOS accessibility hierarchy, `uiautomator dump`) with equal coverage on both;
    - the owner ruling on selection and editing (O2).
  - Start the two-week report-only clock for each device lane.
  - The PixelCopy/screencap probe and the sample-points protocol move to P5.
- **P7 (revised): floors and robustness.**
  - The floor-OS lanes on **API 31** (the image downloaded in P5): all device lanes at one density at least.
  - The oldest iOS simulator runtime Xcode 27 offers (the owner already allowed the download).
  - The 20-run flake check and the ABI cross-check.
  - **The largest-text-size device run** (decisions: Device text size, Coverage roadmap text scale) once the engine value model V2 lands, with scaled-root Chrome captures. Until then, rem-dependent rows stay caveat.
- **TXT1:** wire the UAX #14 breaker and shaped advances. Break vectors are regenerated under the strict tier, with the Chrome break capture as the proof.
- **T999 constraints (add):**
  - Reject if any device lane on either target is `not run`, stale (`staleLanes`) or fails.
  - Reject if device-pixels lacks the glyph rule, or the raster plant is not caught.
  - Reject if the API 31 floor run or the oldest-iOS run is missing; report it as not met, never as passing.
  - Reject if accessibility parity for custom-drawn text is unproven on either platform.
  - Reject if any `outputs.*` is ready, or any android or ios row is exact, without that target's passing native cases.
  - Reject if the largest-text-size run is missing while rem-dependent rows are exact.

## 6. Evidence
- **Ran in /tmp/dragon-p4 at cdf9312:**
  - pnpm test 994/994 (97 s);
  - native:build ios and android (sha256 equal to the receipt);
  - the ios-16 and api-34 plants;
  - native:encoders swift and kotlin;
  - native:smoke ios (iPhone 17, scale 3) and android (dragon-smoke, 2.625), both 3/3;
  - the diff name list, the header-body check, the protected paths and the test-file status.
- **Ran on the merged tree** (/tmp/t015-merge, from `git merge-tree`, scripts unioned):
  - typecheck 0;
  - pnpm test 1101/1104, with 2 literal-count failures (M1) plus 3 environmental ones that pass with the environment set;
  - native:build ios and android, 273 cases each.
- **Tooling:**
  - The iOS 26.5 runtime supports iPad (A16) and iPhone SE (3rd gen).
  - capabilities.plist gives 3 for iPhone 17 and 2 for every iPad.
  - Only android-29 and android-36 images are installed. The AVDs are dragon-smoke (420, 1080x2400) and dragon-floor (API 29).
  - The master lanes.json declares ios 546 and android 819 device cases, and 504988 vectors-lane cases.
- **Read:**
  - T013 and T014 notes;
  - state.yaml (T013–T015, T999);
  - decisions.md (the uncommitted owner edits);
  - native-smoke.ts, native-build.ts and native-support.ts (text view, placement, readback);
  - targets.ts, lanes.ts, samples.ts and native-compare.ts;
  - master's case-count.ts, chrome.ts flags and report.ts Native lanes;
  - the engine-linebreak linefit.ts and diff stat.

## 7. Missing evidence
- **Not re-run by the Judge on the branch:** layout:subset, the vector diffs, native:swift, native:kotlin and native:planted, parity:capture, profile:rows, parity:dpr-report, parity:report, parity:lanes (all modes), the DragonLayout xcodebuild and the T038 greps. They rely on the T014 receipt.
- **Raster placement:** nothing independent shows where either platform rasterises Dragon-placed glyphs (no samples, no Chrome pixel reference). This is P5's device-pixels lane.
- **`Canvas.drawGlyphs` on API 31** has never run, since the floor moved to 31 after the API 29 run.
- **The API 31 system image:** whether it can be downloaded was not confirmed, because `sdkmanager --list` printed nothing here.
- **The iPad (A16) scale of 2** is known only from capabilities.plist, not from an app run.

```json
{
  "goalbuddy_receipt_v1": {
    "result": "done",
    "task_id": "T015",
    "board_path": "docs/goals/milestone-2/state.yaml",
    "decision": "approved",
    "full_outcome_complete": false,
    "rationale": "P4 approved after Judge re-run at cdf9312: pnpm test 994/994 (97 s); native:build ios/android pass with the receipt's source sha256, 261 cases, floor 31; ios-16 and api-34 plants caught; encoders 261/261 x2 with 4/4 plants; smoke 3/3 on iPhone 17 (3) and dragon-smoke (2.625); diff inside allowed_files; protected paths clean. Merge risk: package.json scripts conflict plus two 261 literals in native-host.test.ts that fail against master's 273 cases (M1); merged tree typechecks and builds 273 cases on both. P5 approved as one package with device-pixels pulled in from P6, because custom glyph drawing has no raster proof yet.",
    "note": "notes/T015-p4-review-p5-plan.md",
    "worker_package": {
      "objective": "P5 device lanes for iOS and Android together (notes/T015-p4-review-p5-plan.md section 4, binding). Branch t016-p5-device-lanes from master after the P4 merge (M1, M2), worktree /tmp/dragon-p5, commit locally only; case lists derived at start (every master fixture, wave fixtures included). (1) Device runner and matrix: iPhone 17 (3), iPad (A16) (2), AVDs dragon-320 (1080x2400, scale 2), dragon-smoke (420, 2.625), dragon-480 (1440x3120, scale 3) from the android-36 arm64 image; headless, by serial, root-fits-window check, text scale default recorded. (2) layout-vectors-device: the unchanged translate harnesses run on device (simctl spawn; ART app_process), counts and digests equal to layout-vectors-host. (3) device-frames (a, d), device-applied (b), device-lines (a, d, breaks) for every case at ios 2, 3 and android 2, 3, 2.625. (4) Line-break reference: engine start/end export as committed break vectors, a Chrome per-line break capture at 2, 3, 2.625, device start/end against both, failure kind break-mismatch. (5) device-pixels: committed Chrome PNG reference at device DPRs, host-to-device points protocol, appended glyph sample rule from engine glyph boxes, capture-trust probe against OS screenshots, glyph-offset-1 raster plant; the lane may end fail with every failure listed; no paint or drawing changes. (6) DUMP_FAULTS plus appended break-shifted applied to real dumps on both targets at every device DPR, all caught. (7) parity:lanes --run-host --run-device writes lanes.json with no not-run lane; lane parity extended to run records. (8) API 31 floor smoke on a new dragon-api31 AVD as evidence.",
      "allowed_files": [
        "package.json",
        "packages/parity/src/lanes.ts",
        "packages/parity/src/cli/lanes.ts",
        "packages/parity/src/targets.ts",
        "packages/parity/src/native-compare.ts",
        "packages/parity/src/samples.ts",
        "packages/parity/src/native-host.ts",
        "packages/parity/src/cli/native-build.ts",
        "packages/parity/src/cli/native-smoke.ts",
        "packages/parity/src/device-run.ts",
        "packages/parity/src/device-lanes.ts",
        "packages/parity/src/device-vectors.ts",
        "packages/parity/src/line-breaks.ts",
        "packages/parity/src/pixel-reference.ts",
        "packages/parity/src/cli/native-devices.ts",
        "packages/parity/src/cli/break-vectors.ts",
        "packages/parity/src/cli/break-capture.ts",
        "packages/parity/src/cli/pixel-capture.ts",
        "packages/dragon/src/emit/native-support.ts",
        "packages/dragon/src/internal.ts",
        "packages/layout/src/index.ts",
        "packages/layout/src/inline.ts",
        "packages/layout/generated/swift/Sources/DragonLayout/Inline.swift",
        "packages/layout/generated/kotlin/src/main/kotlin/dev/dragon/layout/Inline.kt",
        "packages/layout/generated/** (translator source-digest header line only; relaxed tier, body-identical)",
        "packages/layout/break-vectors/**",
        "packages/parity/expected-breaks/**",
        "packages/parity/expected-pixels/**",
        "packages/parity/out/lanes.json",
        "packages/parity/test/lanes.test.ts (device not-run pins only)",
        "packages/parity/test/native-compare.test.ts (DUMP_FAULTS pin, append only)",
        "packages/parity/test/samples.test.ts (SAMPLE_RULES pin, append only)",
        "packages/parity/test/device-run.test.ts",
        "packages/parity/test/device-lanes.test.ts",
        "packages/parity/test/device-vectors.test.ts",
        "packages/parity/test/line-breaks.test.ts",
        "packages/parity/test/pixel-reference.test.ts",
        "docs/goals/milestone-2/notes/T016-p5-device-lanes.md"
      ],
      "verify": [
        "export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=<main checkout>/vendor/wpt before every command; BASE is the P5 start commit",
        "pnpm install --frozen-lockfile: lockfile unchanged; pnpm typecheck: exit 0",
        "pnpm test: vitest list at BASE is a subset of HEAD, none skipped, todo or only; modified existing tests are only the three pinned files within their stated limits; wall-time growth at most 5 min; no device run inside pnpm test",
        "pnpm run layout:subset 0 violations; layout:vectors && layout:dpr-vectors then git diff --exit-code BASE -- packages/layout/vectors packages/parity/expected-dpr",
        "pnpm run native:gen: generated diff is header lines only (body-identical script reports 0) plus Inline.* only if inline.ts changed; translator digest unchanged",
        "pnpm run native:swift and native:kotlin: counts and digests equal to a BASE run; native:planted swift and kotlin 8/8 each",
        "parity:capture no change under expected or emitted; profile:rows byte-identical; parity:dpr-report failed 0 at 2, 3 and 2.625; parity:report failed 0 and byte-identical to BASE outside the Native lanes section",
        "pnpm run native:devices: iPhone 17 at 3, iPad (A16) at 2, dragon-320 at 2, dragon-smoke at 2.625, dragon-480 at 3; the scale from the device profile equals the scale from the app; windows hold 1200x900, 1050x788 and 800x600 device px; text scale default",
        "native:build ios and android: exit 0 at the derived case count; android floor 0 above 31; --plant ios-16 and --plant api-34 still exit 1 naming the API; --plant glyph-offset-1 builds on both",
        "native:encoders swift and kotlin all valid, 4/4 plants; native:smoke ios and android 3/3",
        "pnpm run layout:break-vectors: every case at 2, 3 and 2.625; a second run is diff-clean; a test proves the export equals the host Swift and Kotlin inline_breakLines offsets for every case",
        "pnpm run parity:break-capture: Chrome breaks for every case at 2, 3 and 2.625; a second run is byte-identical; engine against Chrome reported N/N, any mismatch listed as break-mismatch in both targets' device-lines",
        "pnpm run parity:pixel-capture: every case at 2, 3 and 2.625 with the manifest; a derived re-capture (every 25th case per DPR) is byte-identical; committed size at most 50 MB",
        "pnpm run parity:lanes -- --run-host --run-device: lanes.json has no not-run lane; parity passes; per-lane states, compared counts per check (a, b, c, d, breaks), failures by kind and device/OS per DPR printed; layout-vectors-device equals layout-vectors-host (counts and both digests) on both targets; device-frames, device-applied and device-lines pass on both; device-pixels pass, or fail with every failure listed",
        "Real-dump faults: every DUMP_FAULTS entry, break-shifted included, caught on real dumps of both targets at every device DPR by its named check; applicable counts > 0; 0 uncaught",
        "Raster plant glyph-offset-1: text-wrap-spaces fails device-pixels on glyph or edge rules on ios 3 and android 2.625, while device-frames and device-lines pass",
        "Capture trust: for the 3 smoke cases on all 5 devices, the in-app capture equals the OS screenshot at every generated point within GATE_CHANNEL_DELTA",
        "parity:lanes -- --require-all: exit 0 if all 12 lanes pass, else exit 1 naming exactly the non-pass lanes; the 4 existing --plant lane faults each still exit 1",
        "Floor probe: sdkmanager system-images;android-31;default;arm64-v8a, create dragon-api31 (420, 1080x2400), native:smoke --target android --avd dragon-api31: 3/3, or the failure reported; a download that is unavailable is recorded as missing",
        "git diff --exit-code BASE on packages/translate, packages/layout/vectors, packages/parity/{expected,expected-dpr,emitted,fixtures}, packages/dragon/src/{css,ua,analysis,profiles,lower}, packages/dragon/src/emit except native-support.ts, packages/parity/src/{dpr,chrome,capture,pipeline,compare,native-dump,report,render,native-encoders,api-floor}.ts, .github; NATIVE_DUMP_SCHEMA unchanged",
        "T038 greps 0/0/0; git diff --name-only BASE..HEAD inside allowed_files; git remote -v empty; nothing pushed",
        "Relaxed tier: the receipt lists every generated header, digest line, report-formatting or note change with its body-identical check"
      ],
      "stop_if": [
        "docs/decisions.md on BASE lacks the Text strategy section: stop before building device-lines",
        "A file outside allowed_files is needed; an existing test changes beyond the three pins; NATIVE_DUMP_SCHEMA, compare.ts, chrome.ts or packages/translate must change; an existing vector, capture, emitted CSS, profile row or expected dump changes",
        "An engine change other than a behaviour-preserving export is needed, or wiring the engine-linebreak breaker is needed",
        "A master fixture (wave fixtures included) cannot be lowered, emitted, compiled or run on either platform: report it by name; never drop, skip or special-case it",
        "device-frames, device-applied, device-lines or layout-vectors-device fails on either target: run every lane to completion, record the states in lanes.json, then stop with the full failure list; do not change emitters, the snap rule, the engine or the gate",
        "Capture trust fails on any device; the glyph-offset-1 plant is not caught; the Chrome pixel re-capture is not byte-identical; the committed pixel set exceeds 50 MB",
        "A device window cannot hold the root at its scale (tooling fault; never crop); a simulator or AVD fails to boot twice (tooling fault, never a pass)",
        "Any tolerance, gate, check, case, DPR or device is loosened, skipped or reduced, or any profile row would be promoted",
        "The Android build needs Gradle, AGP, androidx, or an npm or lockfile change; the only download allowed is the API 31 system image",
        "pnpm test grows by more than 5 minutes",
        "Verification fails twice: fall back to the P5a/P5b layer split, both platforms in each half, never a platform split"
      ]
    },
    "evidence": [
      "/tmp/dragon-p4 cdf9312: pnpm test 48 files 994/994, 97.1 s",
      "native:build ios: 261 cases, source sha256 f8c80fc4...ad09b (equal to the receipt), iOS 15 availability pass",
      "native:build android: 261 cases, sha256 dad7fa7b...3ec6e3d (equal), apksigner v3, minSdkVersion 31, targetSdkVersion 36, 141 refs, 0 above 31",
      "Plants: ios-16 UICalendarView availability error, exit 1; api-34 Context#createDeviceContext named, exit 1",
      "native:encoders swift and kotlin: 261/261 valid, equal and byte-equal; 4/4 planted faults each",
      "native:smoke ios: iPhone 17, iOS 26.5, scale 3, 3/3 pass, self-check pass, Ahem sha256 equal",
      "native:smoke android: dragon-smoke API 36, 2.625, drawGlyphs, 3/3 pass, self-check pass",
      "Diff 34 files inside T014 allowed_files; 1 existing test modified (the P3 pin); header-only files body-identical; protected paths exit 0; no remote",
      "Line readback reads the engine's xLU/widthLU (native-support.ts around line 651); pixels.samples empty; no Chrome pixel reference at 2, 3 or 2.625",
      "git merge-tree master t014-p4-backends: conflict only in package.json scripts; merged tree typecheck 0; pnpm test fails only native-host.test.ts:46 (273 vs 261) and :69 (1365 vs 1305) besides environmental ones; merged native:build ios and android 273 cases each, pass",
      "engine-linebreak adds standalone linebreak.ts and linefit.ts, not used by inline.ts; header-only generated changes",
      "Every layout case has viewport 400x300; iPad (A16) is scale 2 and 820 pt wide; iPhone SE (3rd gen) is 375 pt wide; the iOS 26.5 runtime supports both"
    ],
    "missing_evidence": [
      "Judge did not re-run on the branch: layout:subset, vector diffs, native:swift, native:kotlin, native:planted, parity:capture, profile:rows, parity:dpr-report, parity:report, parity:lanes, the DragonLayout xcodebuild, the T038 greps",
      "No independent evidence of where either platform rasterises Dragon-placed glyphs (P5 device-pixels)",
      "Canvas.drawGlyphs has never run on API 31; the API 31 image's availability through sdkmanager is unconfirmed",
      "iPad (A16) scale 2 is known only from capabilities.plist, not from an app run"
    ],
    "required_board_updates": [
      "Record T015 approved (P4 accepted, no branch fixes)",
      "Integrator merges t014-p4-backends into master with M1 (native-host.test.ts lines 28/46/69: derived counts replace 261 and 261*5) and M2 (package.json scripts union); verify merged typecheck, pnpm test (JAVA_HOME, ANDROID_HOME, DRAGON_WPT_DIR exported), native:build ios and android at the derived count, and parity:lanes --run-host",
      "Commit the owner's docs/decisions.md edits and docs/research/text-spike to master before P5 starts; fix decisions.md: remove the Android API 29-30 drawText bullet from Native glyph advances, cross-reference hmtx advances from Text strategy, annotate decision 7 (selection and editing of custom-drawn text need an owner ruling)",
      "T014 note: mark section 2 items 3, 6, 7 and 9 as superseded by sections 1 and 5 (relaxed tier)",
      "Merge engine-linebreak after P4; it stays unwired until TXT1",
      "Add T016 Worker (P5 device lanes) with this worker_package, then a T017 Judge review of P5",
      "P6 revised: fix device-pixels failures (Dragon-owned paint and glyph raster), native re-proof of the 958 iOS exact rows and the android rows, the outputs ready ruling and api.md, the emitter digest ruling, accessibility parity for custom-drawn text (per-line elements, an accessibility-tree dump check equal on both platforms, the owner ruling on selection and editing), and the report-only clock; the points protocol and capture probe move to P5",
      "P7 revised: device lanes on API 31 (image from P5) and on the oldest iOS runtime, the 20-run flake check, the ABI cross-check, and the largest-text-size device run after engine value model V2",
      "T999: reject on any device lane not run, stale or failing; on device-pixels without the glyph rule or with the raster plant uncaught; on a missing API 31 or oldest-iOS floor run; on unproven accessibility parity for custom-drawn text; on outputs ready or rows exact without that target's passing native cases; on a missing largest-text-size run while rem-dependent rows are exact"
    ]
  }
}
```
