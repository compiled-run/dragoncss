# T003 Strategy decision and first package

Judge, 2026-09-27. Decision: **approved**.

The engine decision stands as the owner recorded it. T001 and T002 give enough evidence to fix the translator's rules, the device-DPR plan and the lane architecture. I approve the first vertical slice: the subset checker, the translator, the Swift engine proven on the Mac against all 258 vectors plus a differential corpus, and Kotlin emitted and committed. The Kotlin run is an owner-blocked task, not a scope cut. The code check found things T001 missed: a second RegExp (inline.ts:34), a numeric || in a sort comparator (flex.ts:134), Map keys that rely on object identity (flex.ts:157), and Swift's canonical String equality. Judge is read-only, so docs/research/native-strategy.md was not written. Its full text is in native_strategy_md for the PM to write.

## Sequence
- T004 PM: owner decisions (Android install, one Chrome reference, DPR set, iOS floor runtime, CI permission, report-only policy). This runs in parallel with T005 because it does not touch T005's files.
- P1 / T005 Worker: subset checker, translator, Swift engine proven on the Mac, Kotlin emitted and committed (run blocked). Then a Judge milestone review.
- P1K Worker (blocked on the JDK 17 and kotlinc install): Kotlin host run of the identical vectors, corpus and planted faults. It is picked up as soon as the install lands, ahead of any other package.
- P2 Worker, device DPR, serves both platforms: Chrome capture at --force-device-scale-factor N plus a matching deviceScaleFactor, with a probe guard. Captures of all 258 cases at DPR 2, 3 and 2.625 under new keys. TS engine zoom model and snapEdges with vectors. New vectors under packages/layout/vectors/dpr-*/. The DPR 1 corpus stays byte-identical. Regenerate the Swift and Kotlin engines; Swift passes all, Kotlin is pass or blocked.
- P3 Worker, shared lane core: dragon.native-dump/1 types and validator, packages/parity/src/targets.ts, parity:lanes check with planted faults, sample-point generator, compare checks (a) to (d), report states, android target in the profiles (no exact rows without native cases), and a shared native layout projection for iOS and Android.
- P4 Worker, backends for both targets together: Swift UIKit and Kotlin Views emitters from one lowered program, expected dumps, text-view hooks (TextKit 1 delegate; StaticLayout plus LineHeightSpan), measurer bridges, generated iOS host app and Android Gradle project. iOS compiles; the Android build is blocked until the install.
- P5 Worker, device lanes: the iOS simulator at DPR 2 and 3 and the Android emulator at DPR 2 and 3 plus 2.625 run engine-on-device, frames, applied values and lines over the full corpus. The package is not done unless Android has run or is formally reported as blocked (owner tooling).
- P6 Worker, paint lanes for both: drawHierarchy and PixelCopy, Chrome screenshots at the device DPR, geometry-generated samples, a PixelCopy vs screencap probe. Profile rows are promoted per platform only through passing native cases.
- P7 Worker: CI workflow files (written, not pushed): macos-26 for iOS, ubuntu with KVM and x86_64 for Android. Floor-OS configurations on both. The 20-run flake check on both. The ABI equal-dump cross-check (not run until CI is approved).
- T999 Judge final audit, per platform; blocked lanes count as not met.

## Owner decisions
- 1. Install the Android toolchain (about 3 GB of downloads, 8-12 GB on disk). These are T002's commands: brew install --cask temurin@17; export JAVA_HOME="$(/usr/libexec/java_home -v 17)"; install cmdline-tools rev 23.0 (commandlinetools-mac_arm64-16111833_latest.zip into ~/Library/Android/sdk/cmdline-tools/latest, or brew install --cask android-commandlinetools); export ANDROID_HOME=~/Library/Android/sdk and add its cmdline-tools/latest/bin, platform-tools and emulator to PATH; yes | sdkmanager --licenses; sdkmanager "platform-tools" "emulator" "platforms;android-36" "build-tools;36.0.0" "system-images;android-36;default;arm64-v8a" "system-images;android-29;default;arm64-v8a". Added by this Judge: brew install kotlin (kotlinc, for the host Kotlin engine run) and brew install gradle (for the Android host project; the version is recorded in dumps). The Dragon harness creates the AVDs itself. Until you install these, every Android lane is reported as not met.
- 2. Chrome reference: both iOS and Android are judged against the same macOS Chrome 145 (darwin-arm64), captured at each device's pixel ratio. This keeps one oracle for both. Chrome on Android as a reference would be a later choice.
- 3. Device pixel ratios: DPR 2 and 3 on both platforms, plus 2.625 as an Android extra. That means three new Chrome capture sets and vector sets of about 17 MB each in the repo. The DPR 1 corpus is untouched.
- 4. Oldest iOS: may Dragon try to download the oldest iOS simulator runtime Xcode 27 offers (several GB) for the floor-OS run? If none installs, the iOS floor run is reported as blocked. Android's API 29 run is then reported, but it does not count as extra proof.
- 5. CI: the workflow files are written but not pushed. Running them (and the Android arm64 vs x86_64 equal-dump check) needs your approval to add a remote and push. Until then both platforms' CI runs are 'not run'. The local runs are the proof.
- 6. Decision 14 extended: the Android emulator lane starts report-only, like iOS, and becomes blocking after two weeks without unexplained failures.
- 7. Confirm that the subset checker blocks: any change to packages/layout that the translator cannot translate fails pnpm test.

## P1 objective
P1, translator slice. (1) Add packages/translate, a private workspace package with no new external dependencies. It uses the typescript devDependency already at the root and contains: a subset checker over packages/layout/src (every file except validate.ts); a lowering from the TypeScript compiler API AST to a typed IR; a Swift emitter; a Kotlin emitter; a prelude for each language with the audited helpers from native-strategy.md section 1.5; a harness JSON reader and writer written in the checked subset and translated like the engine; a differential corpus generator (seeded, same N on every target); a CLI. (2) Refactor packages/layout/src only where the subset requires it: RTL_SAFE regex to a code-point predicate, the numeric || in the flex.ts order comparator to an explicit comparison, named types for anonymous object literals. Engine behaviour must stay byte-identical. (3) Generate and commit the Swift engine and harness under packages/layout/generated/swift, and the Kotlin engine and harness under packages/layout/generated/kotlin, with no hand edits. (4) Prove Swift on the Mac: 258/258 vectors, 320,000 units cases and at least 20,258 engine cases (258 mutated vectors plus 20,000 generated trees at DPR 1, 2, 2.625 and 3, ltr and rtl, at least 50% laying out ok). Every double is compared as IEEE bits. Also prove that every planted translator fault fails. (5) Kotlin reports 'blocked (owner tooling)' when no JDK 17 or kotlinc exists, never pass; it passes the same list when they do. (6) Wire freshness, subset and native checks into pnpm test without weakening any milestone-1 check.

## Evidence
- docs/decisions.md 'Native engine strategy (2026-09-27)' (working tree): TypeScript translated to Swift and Kotlin, never hand-edited, all shared vectors plus a differential corpus
- docs/goals/milestone-2/notes/T001-engine-strategy.md: Swift units.ts translation 320,000/0; planted missing fround 1,609 fails; -ffast-math 2,520 fails; JS/Swift/Kotlin round differ; no JDK
- docs/goals/milestone-2/notes/T002-device-lanes.md: Chrome layout changes with --force-device-scale-factor (DPR 3 0.5px border 0.333333px, inline-block 10.66667); Playwright DSF alone equals DPR 1; TextKit 1 hook exact half-leading; drawHierarchy equals screenshot, layer.render wrong; Android install about 3 GB
- packages/layout/src/inline.ts:34 RTL_SAFE is a second RegExp in engine code (T001 counted only validate.ts)
- packages/layout/src/flex.ts:134 sort comparator uses numeric || (stable-sort and truthiness semantics)
- packages/layout/src/flex.ts:157-158 and layout.ts:55,76,127 use Map, some keyed by object identity; JS Map iteration is insertion-ordered
- packages/layout/src/text.ts:48-51 and inline.ts:46,66 iterate strings by code point; Swift String equality is canonical-equivalence, not code-unit
- packages/layout/src/unsupported.ts: one class (extends Error) plus throw/instanceof control flow; template interpolation is string-only, except cp.toString(16)
- packages/parity/src/chrome.ts:12 hardcodes --force-device-scale-factor=1; compare.ts:10 GATE_DEVICE_PX = 1
- packages/dragon/src/types.ts:8 Target includes 'android', but there is no android profile or lowering (profiles/ios.ts, web.ts; lower/ios-layout.ts only)
- packages/layout/vectors: 258 files at top level plus README.md; vectors.test.ts reads top-level *.json only
- docs/goals/milestone-1/notes/T038-slice-5.md and T999-final-audit-1.md: the milestone-1 guard set (792 tests, byte-identical reports, regeneration clean, S1 greps)
- Tooling: swiftc 6.4 present, node 24.15.0, /usr/bin/java is the stub, kotlinc absent

## Missing evidence
- Kotlin/JVM and ART numeric equality: unmeasured (no JDK).
- Whether Chrome's DPR 2, 3 and 2.625 layout can be modelled as layout in zoomed units (LU = 1/64 device px) for the whole corpus: measured only on a 5-value probe.
- iPad Pro 11-inch M5 simulator UIScreen.scale is 2: not probed.
- PixelCopy equals adb screencap and differs from View.draw on HWUI: from memory, not probed.
- Gradle Managed Devices can set hw.lcd.density: unverified; this plan drives avdmanager/emulator directly.
- Oldest iOS simulator runtime installable with Xcode 27: unverified.
- Full-engine Swift build time and pnpm test cost: unmeasured.
