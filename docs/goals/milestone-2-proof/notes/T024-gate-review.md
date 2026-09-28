# T024: Judge review of checkpoint 1 (TXT1-0, txt1-harfbuzz-gate at b00f626)

**Verdict: checkpoint 1 is met, with conditions.**

Everything was re-run from a clean `git archive b00f626` export in /tmp/t024-hb, with fresh Zig caches. /tmp/dragon-hb was not modified.

## 1. Re-runs

| Check | Result |
|---|---|
| `zig build -Dandroid-ndk=/tmp/dragon-ndk/ndk/27.2.12479018` | exit 0. Produced: WASM; the xcframework (Mach-O platform 2 for the device slice, platform 7 for the simulator slice, minos 15.0); arm64-v8a and x86_64 `.so` (ELF, stripped) |
| Clean `zig build wasm` | sha256 `1ad2e484…fdf092`, equal to the committed `wasm/dragon_hb.wasm` and to the gate report |
| `node packages/text-shaper/scripts/gate.ts` | `gate: 620/620 cases exact, 5000 lines`, exit 0 |
| `vitest run packages/text-shaper` | 8/8 pass: fonts, corpus, the gate, and 5 planted faults |
| `tsc -b packages/text-shaper/test` | exit 0 |

The branch base is 2d2e4dd, not master 8df7574. Against the merge base the diff only adds files; the only modified files are package.json and pnpm-lock.yaml. T023 must merge it, not fast-forward it.

## 2. HarfBuzz pin

- Chromium 145.0.7632.6 DEPS has `'harfbuzz_revision': 'fa2908bf16d2ccd6623f4d575455fea72a1a722b'`. I read it from the GitHub mirror because googlesource returned 503.
- `vendor/harfbuzz/src/**` and `COPYING` are byte-identical to the upstream tarball at that commit.
- The vendored tree is a subset: no files were added, and the only file that differs is the top-level `README.md`, which was replaced by a vendoring note. The source is unmodified. "Byte-identical" holds for everything that is compiled.
- The build.zig defines match Chromium's third_party/harfbuzz-ng/BUILD.gn, except for ICU: Chrome uses `HAVE_ICU`, `HAVE_ICU_BUILTIN` and `HB_NO_UCD`, and Dragon uses HarfBuzz's own UCD. The gate report discloses this.

## 3. Self-reference

- **The reference is Chrome-measured.**
  - `import-spike.ts /tmp/text-spike/out` regenerates `gate/chrome-145.json` byte-identically.
  - The raw inputs were written at 11:42–11:45 on 2026-09-28, before T003 existed. They are `cases.json`, `chrome.json` and `chrome-opps.json`.
  - They were produced by the spike's `chrome/measure.mjs` and `opps.mjs`, which run Playwright Chromium over Range client rects and nowrap spans. Neither script touches gate code.
  - The committed fonts are identical to /tmp/text-spike/fonts, which is what Chrome loaded.
- **Weakness in the font test.** The sha256 values in the reference were computed by `import-spike.ts` from the repo copy in FONT_DIR. The "uses the fonts Chrome measured" test is therefore circular. It holds today only because I checked the fonts against the spike directory.
- **Weakness in provenance.** The capture scripts and raw data exist only in /tmp/text-spike. That directory is volatile, and master's `docs/research/text-spike` has no `chrome/` directory.
- **No tolerance.** The comparison is `dragon !== chrome` on integer LU, for every line and every nowrap span. Adding +1 LU to one reference line, or −1 LU to one nowrap width, each fails exactly 1 case.
- **Line breaks are inputs.** The gate proves widths, not line breaking, which is what the checkpoint asks for. The model still throws if its own candidate contradicts Chrome's break, in the fits, rest-fits and HanKerning branches.
- **Break opportunities do not leak answers.** `isBreakable` is read only in the HanKerning line-end extension, and only for `candidate+1`, as in shaping_line_breaker.cc:345-348.
  - Making every offset breakable: 0 mismatches.
  - Making no offset breakable: 1 mismatch.
  - `available` is the CSS width, not a Chrome output.
- No code is keyed on a case id or font name. `wasm.ts` reads only the `.wasm` file.

## 4. Deviations checked against the Blink 145 source

- **Run and part sums.** Confirmed in Blink.
  - `ShapeResultRun` width is an `InlineLayoutUnit` (16.16, int64) sum, converted with `ToFloat()`. The run path clamps negatives: shape_result.cc:1566 `ClampNegativeToZero`.
  - `ShapeResult::width_` and `ShapeResultView::width_` are float sums of run and part widths (shape_result_view.cc:251-264, shape_result.cc:1035).
  - `FromFloatCeil` is `ceilf(value*64)`.
  - The port matches, with one small difference: `sumAdvances` also clamps view parts to ≥0, and Blink's `std::accumulate` does not. This is harmless for positive advances, but it is not Blink.
- **The advance function.**
  - On Apple, Blink installs Skia advances, `SkFontGetGlyphWidthForHarfBuzz`, then `SkiaScalarToHarfBuzzPosition`. The exception is fonts with `trak` and no `sbix`, which keep HarfBuzz advances (harfbuzz_face.cc:443-464). The shim mirrors this exactly.
  - Skia's width is Core Text's. For static fonts, `units*size/upem` is an empirical model of Core Text, validated on 560 cases across 4 fonts.
  - For variable fonts, Chrome's source contains no HVAR code: Core Text applies the variations internally. The shim's evaluator is a clean-room model of Core Text. It covers ItemVariationStore, DeltaSetIndexMap, avar segment maps and F2DOT14 rounding, and adds the delta unrounded.
  - It is validated only on Inter VF at its default wght with auto opsz (60 cases). HarfBuzz's own rounding gives 15/60 exact, so the model is needed.
- **Can it drift?** Not between targets: see §5. It can drift from Chrome for other variable fonts, axes and weights.
  - It is a partial re-implementation. There is no gvar phantom-point fallback, so a variable font without HVAR silently gets default-instance advances.
  - That is a correctness trap, not just a coverage gap. Variable fonts outside the validated set must be refused until they are proven.
- **text-spacing-trim.** In Chrome 145 `normal` is `ShouldTrimEnd` = true, `ShouldTrimStartOfWrappedLine` = false and `ShouldTrimAdjacent` = true (text_spacing_trim.h). This matches the port's comments and behaviour. The line-end extension mirrors Blink, with an equivalent float comparison.

## 5. Native portability

- **Only integers come back.** Every export returns `i32` or `u32`. Font sizes and variation values come in as `f32` inputs, which is deterministic.
- **FP contraction is off everywhere.**
  - `-ffp-contract=off` is set for HarfBuzz; Chromium sets the same flag globally.
  - The Zig shim uses the default strict float mode.
  - Zero `fmadd`/`fmsub`/`vfmadd` instructions in the iOS device and simulator objects, the Android arm64 and x86_64 `.so`, and the WASM. The disassembly does find `fmul`, so the scan works.
- **Native output equals WASM (independent test).**
  - I recorded all 775 `dhb_shape` calls the gate makes, 22,756 glyphs.
  - I replayed them through `dragon_hb.zig` and HarfBuzz, built natively for aarch64-macos and for x86_64-macos (under Rosetta) with the build.zig flags.
  - Both give 0 mismatches against WASM. A planted change of 1 in the expected values is caught.
  - This is a macOS proxy for the iOS and Android binaries. It is not a run on a device.
- **libm.** The Android `.so` imports `atanf`. It is reachable only through `hb_style_get_value` (hb-style.cc), which the shaping path does not call. HarfBuzz also calls `getenv` (`HB_OPTIONS`).
- **Engine side.** The engine-side port (script.ts, han-kerning.ts) takes Unicode data from V8's ICU through `\p{…}` regexes. Native engines will need a pinned table. That is outside the shim, but it is a TXT1a requirement.

**Ruling:** the shim is portable exactly across WASM, arm64 and x86_64, given the flags and the replay evidence. A committed native-equality check does not exist yet.

## 6. Planted faults

Mismatch counts from re-running each fault:

| Fault | Mismatches |
|---|---|
| float accumulation | 2 |
| whole-pixel positions | 620 |
| kerning off | 620 |
| no line-start reshape | 22 |
| no HanKerning | 60 |

All five are real departures from Blink's behaviour, and each is caught. Float accumulation is weak, at 2 cases, but real.

## Conditions and required follow-ups

1. **T023, before merge.** Commit the spike's Chrome capture scripts (`chrome/measure.mjs`, `opps.mjs`, `page.html`) and the raw `cases.json`, `chrome.json` and `chrome-opps.json` (or their sha256) under `docs/research/text-spike/`. This lets anyone re-derive `chrome-145.json` without /tmp.
   - Fix the circular font test: the expected sha256 must come from the fonts Chrome loaded, not from FONT_DIR at import time.
2. **Variable fonts.** Until they are validated, Dragon must refuse variable instances outside the gate's validated set, and any variable font without HVAR.
   - The scope of that refusal needs an owner or PM ruling.
   - To extend the scope, add Chrome cases for other weights and widths, and for a second variable font with avar, before widening.
3. **Native equality.** Add a committed native-equality check: the replay of recorded shape calls against the iOS simulator and Android emulator binaries.
   - It must run on device when TXT1a wires the shim in, under the P5 device lease.
4. **NDK.** Install the NDK as the owner (already in T003's receipt). The `.so` build is not repeatable from /tmp.
5. **Unicode data.** Record the Unicode data deviations for TXT1a: HarfBuzz's UCD instead of ICU, and V8's ICU for script and punctuation classes. Native engines need one pinned Unicode version.
6. **Minor fixes:**
   - Remove the ≥0 clamp on view parts, or justify it from Blink's source.
   - Add `dhb_font_var_coords` to `dragon_hb.h`.
   - Keep the upstream HarfBuzz README, for example as `README.upstream.md`, or state that it was replaced.
   - Consider `HB_NO_STYLE`/`HB_NO_GETENV` to drop `atanf` and the `HB_OPTIONS` sensitivity. These are compile flags, not source edits, but they diverge from Chrome's defines. That needs a ruling.

Scratch evidence: /tmp/t024-hb, /tmp/t024-native (`replay.c`, `calls.txt`), /tmp/t024-blink (Blink 145 sources), /tmp/t024-up (upstream HarfBuzz).
