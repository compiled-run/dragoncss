# @dragon/text-shaper

`dragon_hb`: a Zig shim (`src/dragon_hb.zig`, C header `include/dragon_hb.h`) over unmodified HarfBuzz
(`vendor/harfbuzz`, Chrome 145's pin), set up the way Blink sets it up on macOS. Only integers come back: glyph id,
cluster, x/y advance, x/y offset (16.16) and glyph flags.

## Build (Zig 0.16)

```sh
cd packages/text-shaper
zig build wasm      # zig-out/wasm/dragon_hb.wasm; `pnpm run build:wasm` also refreshes the committed wasm/
zig build ios       # zig-out/ios/DragonHB.xcframework (arm64 device + arm64 simulator, static)
zig build android -Dandroid-ndk=<ndk>   # zig-out/android/{arm64-v8a,x86_64}/libdragon_hb.so (API 31, with the JNI glue)
zig build host      # zig-out/host/libdragon_hb.a (aarch64-macos, static; the Swift host replay links it)
zig build host-jni  # zig-out/host-jni/libdragon_hb.dylib (aarch64-macos, with the JNI glue; needs JAVA_HOME or -Djava-home)
zig build -Dandroid-ndk=<ndk>           # all five
```

`wasm/dragon_hb.wasm` is committed so Node needs no Zig; the build reproduces it byte for byte.

## TXT1-0 gate

`src/gate.ts` shapes the 620 text-spike cases through the WASM build, applies Blink's arithmetic (`src/blink.ts`,
`src/script.ts`, `src/han-kerning.ts`) and compares every line width and nowrap width with Chrome 145
(`docs/research/text-spike/gate/chrome-145.json`), and the 640 Lato 400/700 cases of T036 the same way
(`gate/chrome-145-lato.json`, measured by `docs/research/text-spike/lato`). `pnpm test` runs it; `pnpm text:gate` prints it;
`pnpm text:report` rewrites `docs/research/text-spike/gate-report.md` (needs a full `zig build`).

## Native bridges and shape transcripts (TXT1-N)

- **Swift:** `swift/` is a SwiftPM package. `CDragonHB` is a module map over `include/dragon_hb.h`; `DragonHBShaper` wraps
  faces, fonts and shaping and copies each shaped record into `[Double]`.
- **Kotlin:** `kotlin/src/dev/dragon/text/DragonHB.kt` declares the external funs. `src/dragon_hb_jni.zig` implements them
  (`Java_dev_dragon_text_DragonHB_*`) and is linked only into the Android `.so` and the host JNI dylib, never the WASM.
- **Transcripts:** `src/transcript.ts` defines `dragon-shape-transcript/1`: faces by sha256, fonts, and every shape,
  nominal-glyph and glyph-advance call with the integers it returned. `transcripts/gate.json` is the TXT1-0 gate's
  1,260 cases recorded through the WASM.

```sh
node scripts/replay.ts --record    # rewrite transcripts/gate.json (every gate case must be exact)
node scripts/replay.ts --check     # byte-identical to a fresh recording, and replays through the WASM
pnpm run replay:swift              # the committed transcript through zig build host, from Swift
pnpm run replay:kotlin             # through zig build host-jni, from Kotlin on the JVM (needs JAVA_HOME, kotlinc)
pnpm run replay:swift -- --plant off-by-one   # one expected integer changed: must exit 1 (same for replay:kotlin)
```

`scripts/replay-device.ts --platform ios|android` runs the same replay on the iOS simulator (`device/ios`) or the
Android emulator (`device/android`); `--build-only` builds them without starting a device. It passes only on the exact
expected output: every call replayed with 0 mismatches, or with `--plant <name>` exactly the planted failure. An unplanted
pass writes `transcripts/device/<platform>.txt`, which `test/replay-device.test.ts` ties to the current transcript. Run it
under the device lease, with `--device <udid|serial>` when more than one simulator or emulator is up.
