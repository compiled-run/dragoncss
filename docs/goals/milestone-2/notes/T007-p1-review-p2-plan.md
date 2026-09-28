# T007 P1 review and P2 package

Judge, 2026-09-27. Decision: **approved**.

P1 (8228b4e) and P1K meet the T003 bar. I re-ran typecheck and pnpm test (809/809), and native:swift and native:kotlin both print 258/258, 320000, 20258 and 22000 with digest e2daf313 and status pass. All seven deviations are sound and accepted. The order sort is stable and equal to JS. The 180 s cap fails closed. Swift being slower does not matter for device lanes. Must-fix: freshness skips every dot-file and every build/ folder at any depth (probed); the checker misses for-loop let capture; the Kotlin blocked path is never run; DPR captures under expected/darwin-arm64/dpr-N would break platform.test.ts:119. These fold into P2, the next vertical slice for both platforms.

**PM correction:** the Android SDK IS installed at /opt/homebrew/share/android-commandlinetools (platform-tools, emulator, platforms;android-36, build-tools;36.0.0, system images android-36 and android-29 arm64). An Android 36 AVD booted headless in about 8 s on 2026-09-27. The Judge looked only at ~/Library/Android/sdk. Use ANDROID_HOME=/opt/homebrew/share/android-commandlinetools. Android is NOT owner-blocked.

## P2 objective (binding)
P2, device DPR for both platforms (native-strategy.md section 2 and 3.3; decisions.md 'Native lanes, milestone 2'). (1) Chrome captures of all 258 milestone-1 layout cases at DPR 2, 3 and 2.625, one browser launch per DPR with --force-device-scale-factor=N and a context deviceScaleFactor of N. Keep the devicePixelRatio guard. Add a zoom-applied guard: a 0.5px border must compute to 0.5px at 2, 0.333333px at 3 and 0.380952px at 2.625, or the capture aborts. Prove the guard rejects a planted flag-1-with-deviceScaleFactor-N capture. Write the captures to packages/parity/expected-dpr/darwin-arm64/dpr-<N>/<case>.web.json. They must not go in a subfolder of expected/darwin-arm64, because platform.test.ts:119 reads every entry there as a file. Every DPR set has the same 258 case ids; 2.625 is named as an Android extra. (2) TS engine zoom model: at DPR N, CSS lengths and font sizes are zoomed on entry, the font rules apply to the zoomed size, output LU are 1/64 device px, and CSS px = LU / (64 * N). At DPR 1 the model is the identity. Add a README section defining it. (3) snapEdges in packages/layout/src/snap.ts: snapEdge(lu) = floor((lu + 32) / 64); edges are absolute; sizes come from the snapped edges; results stay Double. It is exported and added as a translator root. (4) Vectors at packages/layout/vectors/dpr-<N>/<case>.json (the same 4-key format) and snap vectors at packages/layout/vectors/dpr-<N>/snap/<case>.json. Only new CLIs write them. New tests check that the engine reproduces them and that the milestone-1 platform checks (the platform key, no platform font) hold for the new folders. (5) The parity DPR lane compares the engine with the committed DPR captures, with the 1 device px gate imported from compare.ts unchanged. It reports exact nodes in zoomed LU per DPR. It does not change DPR-1 results or report files. (6) Regenerate the Swift and Kotlin engines and extend the translated harness and corpus: a vectors suite over all 1032 vectors; engine mutations of the DPR vectors; a snap suite of the snap vectors plus at least 20,000 generated edge cases (halves, negatives, saturation, all four DPRs); a new planted translator fault on both emitters where snapEdge uses truncating or integer division, which must fail. (7) P1 must-fixes: listTree ignores only .build and .swiftpm at the Swift package root and build at the Kotlin root, and a test proves a hand-written file in a nested build/ folder or a dot-file is caught. The subset checker rejects closures that capture a for-loop let binding, with a test. A test forces the Kotlin tool lookup to fail and asserts status blocked (owner tooling) with no suites, never pass. Optionally, native reports name a suite timeout or crash as the cause.

## Constraints
- Engine changes stay in the checked subset and preserve DPR-1 behaviour bit for bit.
- Every new native file comes from the translator, with the do-not-edit header.
- Faults and suites are defined for Swift and Kotlin together.
- The Android 2.625 set is named as an extra, never a substitute.
- Do not write profile rows from DPR cases.
- Commit locally only.

## Sequence
- P3 shared lane core: dump schema, targets.ts, parity:lanes with planted faults, sample generator, compare checks (a)-(d), report states, android profile and projection. Changes: case lists come from the P2 DPR constants (1032 vectors, 258 cases per DPR, 2.625 named as an extra). layout-vectors-host must pass on both platforms, since Kotlin is no longer blocked. Suite timeout causes are reported if P2 did not add that.
- P4 backends: UIKit with TextKit 1, and Android Views with StaticLayout and LineHeightSpan, from one lowered program; expected dumps; measurer bridges; host app sources. Changes: JDK 17, kotlinc and gradle exist, but the Android SDK does not (no ~/Library/Android/sdk, adb or emulator), so the Android app build stays blocked (owner tooling) until the owner finishes the sdkmanager step. snapEdges goes from Double to Int for View.layout through a checked conversion with its own proof.
- P5 device lanes: the iOS simulator at DPR 2 and 3, and the Android emulator at 2, 3 and 2.625 or blocked. The on-device layout-vectors lane runs all 1032 vectors plus the corpora. Build the device harness with -O and keep the per-suite cap. Probe the iPad scale of 2.
- P6 paint lanes and per-platform profile promotion: drawHierarchy, and PixelCopy after the screencap probe. Unchanged.
- P7 CI files (written, not pushed), floor-OS runs, 20-run flake check, ABI cross-check. Unchanged.
- T999 final audit per platform: a blocked lane counts as not met.

## Evidence
- pnpm typecheck && pnpm test (JAVA_HOME=openjdk@17): 25 files, 809/809 pass, 87.2 s
- pnpm run native:kotlin: kotlinc-jvm 2.4.20, JRE 17.0.20.1; vectors 258/258, units 320000/320000, engine 20258/20258, library 22000/22000, digest e2daf313...c59, status pass
- pnpm run native:swift: Swift 6.4, the same counts and digest, status pass, run 16.5 s
- /tmp probe: listTree on /tmp/t007probe returned only Ok.swift, missing Sources/DragonLayout/build/Hand.swift and .Hidden.swift (packages/translate/src/generate.ts:220-233 skips any dot-prefixed or build-named entry at any depth)
- packages/translate/src/native.ts:177-183: SUITE_TIMEOUT_MS 180000 with SIGKILL; errors are swallowed and missing lines count as failures (fails closed); the library suite catches canonical-equality directly (569 cases)
- packages/translate/src/prelude-swift.ts:61-80: jsSort is a stable bottom-up merge sort that takes the right element only when cmp > 0; flex.ts order is validated as int (validate.ts:96)
- packages/layout/src/units.ts:30-32: fromCssPx = saturate(trunc(fround(fround(px)*64))); the redundancy relies on the trunc, and translate.test.ts keeps a 400k+ value check
- packages/parity/test/platform.test.ts:119-120 reads every entry of expectedDir() as a file, so subfolders there would fail with EISDIR
- packages/parity/src/chrome.ts:12 hardcodes --force-device-scale-factor=1; compare.ts:40-45,81 converts LU/64 with no DPR
- packages/translate/test/native-kotlin.test.ts accepts blocked only when kotlinTool() is null; that path is untested on this Mac
- Android SDK: ~/Library/Android/sdk absent, adb and emulator not found; gradle, kotlinc and sdkmanager present

## Missing evidence
- The DPR zoom model is still inferred from the T002 5-value probe; P2 proves or refutes it.
- The full native:planted run (non-short-circuit) was not re-run by the Judge; it relies on the T005 receipt, and pnpm test's short-circuit planted tests passed.
- The Kotlin blocked path is untested now that the tools exist (P2 must-fix).

## Required board updates
- T005 and T006: mark as reviewed and accepted by T007, with the deviations accepted as ruled.
- PM: update docs/research/native-strategy.md 1.2 with the subset additions and the missing generics, 1.9 with the missing-fround fault in percentOf and canonical-equality on both emitters, and section 2 with the capture path packages/parity/expected-dpr/darwin-arm64/dpr-<N>.
- Add a P2 Worker task with this worker_package; then a Judge milestone review of P2 before P3.
- Record for the owner: the Android SDK packages (the sdkmanager step, platform-tools and emulator) are still missing; Android device lanes stay blocked (owner tooling) until installed.
- Record the should-fixes: the Kotlin jsNumberToString of non-integers is not JS-shortest on JDK 17 (latent; only used in throw messages today); name suite timeouts in native reports.
