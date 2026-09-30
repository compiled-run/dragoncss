# T081 Worker: TXT1-N, the shim native bridge and host replay

Worker, 2026-09-28. Binding spec: T056 §3 TXT1-N, with rulings R1 to R3, and the T082 PM ruling on feature records.

- **Worktree / branch:** `/tmp/dragon-txt1n`, `txt1n-shim-bridge`.
- **BASE:** master `8e66aca6`.
- **Commits:** `c20cc6c6` (bridges, transcript, replays, device harness) and `5c67bd9b` (integer feature records, per the T082 ruling). Not pushed.

## What landed (all inside packages/text-shaper)

- **`build.zig`.** Two new steps:
  - `host`: `zig-out/host/libdragon_hb.a`, aarch64-macos 13.0, static. SwiftPM links it.
  - `host-jni`: `zig-out/host-jni/libdragon_hb.dylib`, which includes the JNI glue. It needs `-Djava-home` or `JAVA_HOME` for `jni.h`.
  - The Android `.so` now links the JNI glue as a separate object, using the NDK's `jni.h`.
  - The wasm and ios steps are unchanged, and the `hbModule` root is still `dragon_hb.zig`. The WASM rebuilds byte-identical.
- **`src/dragon_hb_jni.zig` (new).** `Java_dev_dragon_text_DragonHB_*` wrappers for:
  - face create, destroy and upem;
  - font create (with optional variations) and destroy;
  - `glyphAdvance` and `nominalGlyph`;
  - shaper create and destroy;
  - `shape`, which returns an `IntArray` of stride 7, and takes features as an `IntArray` of 4 ints per record (tag as int32, value, start, end).

  It calls the C ABI through `@cImport` of `dragon_hb.h` and `jni.h`, and does no float arithmetic.
- **`swift/` (new SwiftPM package).**
  - `CDragonHB`: a module map over `../include/dragon_hb.h`, which links `dragon_hb` and `c++`.
  - `DragonHBShaper`: face, font and shaper classes. `shape` copies records into `[Double]`. A `featureRecords: [Double]` overload takes the GlyphShaper integer records.
  - `TranscriptReplay.swift`: the replay, which checks each face's sha256 with CryptoKit.
  - `dragon-hb-replay`: the executable.
- **`kotlin/src/dev/dragon/text/` (new).**
  - `DragonHB.kt`: an object with `@JvmStatic external fun`s.
  - `Json.kt`: a minimal JSON reader, since the JVM has none built in.
  - `Replay.kt`: the replay, which checks sha256, plus `main`.
- **`src/transcript.ts` (new).**
  - The format is `dragon-shape-transcript/1`:
    - faces, with a repo-relative file and sha256;
    - fonts, with every `dhb_font_create` argument resolved and stored as f32 values;
    - texts;
    - calls: `shape` (inputs, integer feature records and glyph ints), `nominal` and `advance`.
  - It also provides `recordTranscript`, `replayTranscript`, `wasmBackend`, `withoutFeatures` and `plantTranscript('off-by-one')`.
  - These are appended to the `index.ts` exports.
- **`scripts/replay.ts` (new).** Four modes: `--record`, `--check`, `--swift` and `--kotlin`, with `--plant off-by-one`. It filters out pnpm's literal `--`.
- **`transcripts/gate.json` (new, generated).**
  - All 1,260 gate cases, recorded through the WASM (sha256 `1ad2e484…`).
  - 7 faces, 36 fonts, 4,820 calls: 1,100 shape calls (45,544 glyphs), the nominal-glyph calls, and the advances.
  - Size: 1.38 MB.
- **`test/replay.test.ts` (new).** 7 tests:
  - the file is byte-identical to a fresh recording (1,260 cases);
  - the WASM and face sha256 values match;
  - all three op kinds are present;
  - features are captured as integer records: `chws`, `halt`, and ranged HanKerning records. Dropping the features makes the replay mismatch, so the recorded calls depend on them;
  - a WASM replay gives 0 mismatches;
  - the off-by-one plant gives exactly 1 mismatch;
  - a face whose sha256 is wrong throws.
- **T029 entry point.** `scripts/replay-device.ts` with `device/ios/main.swift` and `device/android/DeviceMain.kt`.
  - iOS: swiftc against the xcframework's simulator slice, run with `simctl spawn`.
  - Android: kotlinc, then d8, then `adb push`, then `app_process`. The library matches the device ABI.
  - An unplanted run writes `transcripts/device/<platform>.txt`.
  - **Not run on any device.** `--build-only` built both harnesses here, and no simulator or emulator was started.
- `package.json` gains scripts only: `replay:record`, `replay:check`, `replay:swift`, `replay:kotlin` and `replay:device`. `.gitignore` gains `swift/.build/`, `swift/.swiftpm/` and `kotlin/build/`. The README is updated.

## Rulings made by research (for the PM to record)

1. **Verify 5 JNI check uses `nm -D -gU`.**
   - Every `libdragon_hb.so` is built with `strip = true` (`hbModule`, unchanged), so it has no `.symtab`. `nm -gU` prints "no symbols" on the BASE `.so` too.
   - The exported JNI symbols are in `.dynsym`. `nm -D -gU` finds 10 in arm64-v8a and 10 in x86_64.
   - Turning stripping off would change the Android output beyond "gaining the JNI symbols", so I did not.
2. **The transcript keeps identical calls once, in first-use order.**
   - The gate re-shapes the same ranges across widths. A replay proves each distinct call.
   - `advance` records are added for every glyph id each font returned, so the bridges' `glyph_advance` is replayed too.
3. **Feature records are integers (T082 ruling).**
   - `dhb_feature {tag, value, start, end}` in the unchanged `dragon_hb.h` already carries them. No change to `dragon_hb.zig` was needed.
   - The Swift replay goes through the `featureRecords` overload, which is the GlyphShaper form. Kotlin passes the same 4-int records to JNI.
4. **Sizes cross as f32, derived from the double.**
   - The transcript stores `Math.fround(size)`.
   - Swift uses `Float(Double)` and Kotlin uses `toDouble().toFloat()`, which equal JS ToFloat32.
5. **FMA.** A disassembly scan finds 0 `fmadd`/`fmsub`/`fnmadd`/`fnmsub`/`vfmadd*` in any new binary:
   - the host `.a` and the JNI dylib;
   - both Android `.so` files;
   - the Swift replay executable;
   - the iOS simulator harness.

   The scan works: `fmul` is found 60 to 119 times per binary.
6. **Remote.** `origin` is the owner's and was present at BASE. Per the PM, the rule is "never push", and nothing was pushed or added.

## Verify (E = the standard env prefix; BASE = 8e66aca6)

1. `E pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
   - install and typecheck pass.
   - Final run: 1,513 of 1,515 pass.
     - **1 failure also at BASE:** `packages/parity/test/dist.test.ts` (f5) rejects `README.md` in the packed tarball. `packages/dragon` prepack copies the root README (22b69d3f), and T082 found the same. This branch changes nothing in packages/dragon (verify 9).
     - **1 timeout under load:** `parity.test.ts` determinism, with load average about 50 to 60.
   - The first run also had timeouts, in `lanes.test.ts`, `native-host.test.ts`, `native-compare.test.ts` (2), `dist.test.ts` (d) and `parity.test.ts`. `native-compare` and `dist` (d) passed in the second full run. `lanes`, `native-host` and `parity` passed on a rerun (`--testTimeout=600000 --fileParallelism=false`): 3 files, 261 of 261.
   - The text-shaper tests pass: 3 files, 30 tests.
2. `E pnpm run text:gate`: 1260/1260 cases exact, 9,855 lines.
3. `zig build wasm && cmp …`: byte-identical, after `rm -rf zig-out`.
4. `zig build -Dandroid-ndk=/tmp/dragon-ndk/ndk/27.2.12479018`: exit 0, all five steps.
5. JNI symbols: `nm -gU` gives 0 because the file is stripped (ruling 1). `nm -D -gU` gives 10 (arm64-v8a) and 10 (x86_64). FMA scan: 0 (ruling 5).
6. `replay.ts --record && --check`: byte-identical. The WASM replay has 4,820 calls and 0 mismatches.
7. `replay:swift`: 4,820 calls (1,100 shape, 45,544 glyphs), 0 mismatches. `replay:kotlin`: the same, 0 mismatches.
8. `replay:swift -- --plant off-by-one` exits 1 (1 mismatch, call 0, int 2). `replay:kotlin -- --plant off-by-one` exits 1 (the same).
9. `git diff --exit-code BASE -- vendor …/dragon_hb.zig …/include …/wasm packages/layout packages/dragon packages/parity package.json pnpm-lock.yaml`: exit 0.
10. `git diff --name-only BASE..HEAD`: 21 files, all under the allowed packages/text-shaper paths. `git remote -v`: origin (the owner's; ruling 6).

**Pinned tests retargeted:** none.

## For T029 and TXT1a

- T029 runs `node packages/text-shaper/scripts/replay-device.ts --platform ios|android`, then again with `--plant off-by-one`. It needs `ANDROID_NDK_HOME` or a prior `zig build android`, `ANDROID_HOME` (for d8) and `JAVA_HOME`.
- **Not yet proven:** that `simctl spawn` propagates the exit code, and that `app_process` accepts the dex. These are first-run risks for T029.
- **TXT1a-2 builds the R1 `GlyphShaper` closures from these bridges.**
  - Swift: `DragonHBShaper.shape(font:…featureRecords:)`, which returns `[Double]`.
  - Kotlin: `DragonHB.shape(…)`, which returns an `IntArray`.
  - The face and font caches keyed by manifest id and sha256 are the runtime's job (R8).
