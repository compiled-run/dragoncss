# T056 Judge: TXT1a, real-font Latin text in the engine and on device

Judge, read-only, 2026-09-28. Only this note is written.

**Read:** goal.md (Decision Rule, Throughput Rules); state.yaml (T003, T024, T028, T029, T033, T036, T038, T044 and T045); docs/research/text-plan-summary.md; docs/decisions.md at 41cc750 plus the working-tree diff ("Text strategy", "Text shaping", "Native glyph advances", "Pinned generic fonts", "Lato", "Italic ch", "Variable fonts", decision 13, and the uncommitted "Inline layout" section); notes T005, T012 (§2 and §4), T024, T028, T033, T036 and T044.

**Code read on master 41cc750:**
- packages/text-shaper: include/dragon_hb.h, src/wasm.ts, src/blink.ts exports, build.zig, package.json.
- packages/layout/src: text.ts (`TextMeasurer`, `FontData`, `fontDataMeasurer`), units.ts (`roundFontMetricToWholePx`, `platformFontSize`, `textAdvanceAt`, `cachedRangeWidth`), platform-rules.ts, the linebreak-data.ts header (Unicode 16.0.0, which is ICU 77 in Chrome 145).
- packages/layout/generated/swift Text.swift: a TS interface is emitted as a final class of closures, so a host can build one from native closures.
- packages/dragon/src/fonts/metrics.ts: `skRound`, `scaled` and `advance`.
- packages/dragon/src/emit/native-support.ts: the Ahem bridge, which reads hmtx, calls `text_fontDataMeasurer`, and draws with CTFontDrawGlyphs and Canvas.drawGlyphs.
- The measurer call sites in parity/src (pipeline.ts, dpr.ts, lanes.ts, native-host.ts, cli/vectors.ts, cli/platform-check.ts) and translate (generate.ts, harness/harness.ts).
- Vertical tables of the vendored Ahem, Inter and Lato fonts.
- The NDK at /tmp/dragon-ndk/ndk/27.2.12479018.

## 1. Findings that shape the packages

1. **The engine's font boundary is `TextMeasurer`,** built by the host.
   - Node uses `ahemMeasurer`.
   - Swift and Kotlin build `text_fontDataMeasurer(FontData)` from the bundled Ahem's hmtx.
   - Translated interfaces are closure classes, so a host-implemented interface already crosses cleanly into Swift and Kotlin.
2. **The Blink shaping arithmetic that passed the gate lives in `packages/text-shaper/src/blink.ts`.** This covers the run and part sums, `FromFloatCeil`, reshape at line start and end, and cached safe-to-break offsets.
   - That file imports the WASM class and is outside the translator subset.
   - The engine cannot import it. The arithmetic must be ported into `packages/layout/src`, and the port proven equal to the gate.
3. **Files in `packages/layout/src` that nothing reaches are subset-checked but not generated** (T044 §1.2: linebreak.ts today). So a new, unreached engine file can land before INL1a without touching the serial files or the generated output.
4. **The C ABI returns only integers** (stride 7, 16.16 positions). There is no JNI glue, no Swift module map, and no macOS host build for the Swift and Kotlin host harnesses. T024 proved native equals WASM only on a /tmp replay. T029 (the committed replay on device) is queued and has no harness.
5. **Metric rounding conflict (T033 §7.1).**
   - The engine rounds Ahem halves down: `roundFontMetricToWholePx`, marked "inferred, not traced", held by 3 nodes of text-fractional-font-size.
   - T005 rounds half-up with `floorf(x+0.5f)`: Inter 16px ascent 15.5 becomes 16, exact on 1,040 + 80 rows.
   - I tested the obvious unifying hypothesis, Skia's `sA = f32(f32(1/s)*s)` factor on metrics. It fails: the factor is exactly 1 at 12.5, 17.5, 22.5 and 16 px. So the conflict is not explained by arithmetic that is already known.
   - The tables do not explain it either: Ahem hhea, typo and win values all agree (800/-200, USE_TYPO_METRICS set), and Inter's also agree.
   - It needs a measurement, not a guess.
6. **Italic `ch`** differs by 1 f32 ulp on 4 rows (T005 B1). The cause is a Core Text italic-trait dependence.
   - The same dependence may reach the 16.16 advances of italic faces.
   - The gate corpus has no static italic face, so em and i on native with Dragon Sans (Inter-Italic) are unproven today.
7. **Only Lato 400 and 700 are bundled for the north star.** The demo has no italic. The spike showed that `❚` (U+275A) needs TXT1d.

## 2. Rulings (research-backed; the PM records them)

- **R1, where integers cross.**
  - The translated engine gains an interface `GlyphShaper` in a new engine file, `shaping.ts`:
    ```
    shape(face: string, size: number, text: string, start: number, end: number, script: string, rtl: boolean, language: string): readonly number[]
    ```
    It returns glyph records of stride 7: glyph id, cluster, x advance, y advance, x offset, y offset and flags, all int32, with advances and offsets in 16.16.
  - All float and LU arithmetic stays in translated TS: the 16.16 run sums, the float part sums, `FromFloatCeil`, cached positions and reshaping decisions. It is ported from blink.ts.
  - **Hosts:**
    - **TS:** a sync adapter over `DragonHB.fromBytes`, one instance per process, faces cached by sha256.
    - **Swift:** closures over the xcframework's C ABI, through a module map on `dragon_hb.h`. Records are copied from `dhb_shaper_glyphs` into `[Double]`.
    - **Kotlin:** closures over a JNI glue function (`Java_dev_dragon_text_DragonHB_shape`) compiled into `libdragon_hb.so` only. It returns an `IntArray`.
  - dragon_hb.zig and vendor/harfbuzz are unchanged, and the WASM stays byte-identical. The fence stays in TS and the compiler (T028). Native gets only faces the compiler approved.
- **R2, shaping during layout.**
  - The TS reference calls WASM synchronously, inside `measure` and `measureRange`.
  - The measurer becomes `shapedMeasurer(faces, shaper)`. `faces` holds per-face `FontData` (units, hhea metrics) read by the host from the bundled bytes, keyed by the manifest face id.
  - Each text item is shaped once per item and font, and cached per layout.
  - At a break offset whose glyph carries UNSAFE_TO_BREAK, the line-start and line-end ranges are reshaped (shaping_line_breaker.cc).
  - Floats accumulate inside the item. The item's LU is `FromFloatCeil` of the item's float sum. INL1a sums the per-item LU and owns fit, opportunities and hanging spaces.
  - **Soft hyphen.** At a U+00AD break, the hyphen string is shaped and its width added. Blink's HyphenString is U+2010 if the face maps it, else `-`. U+00AD itself has zero advance.
  - **Ahem.** Ahem goes through the same path: the Ahem face is shaped by HarfBuzz too. Every existing output must stay byte-identical. This proves the new path cannot drift on the 140+ Ahem fixtures.
- **R3, shared vectors.**
  - A real-font vector carries a **shape transcript**: face ids with their sha256, and every `shape` call with its integer result.
  - The translate harness implements `GlyphShaper` by replay. A call missing from the transcript throws.
  - So TS, Swift and Kotlin engine equality is proven without a native shim in `swift test` or the JVM harness.
  - The shim's own equality is proven separately:
    - on the host by TXT1-N (macOS arm64 Swift and JVM, against WASM);
    - on device by T029;
    - on device, live, by TXT1a-2's layout-vectors-device lane (live device shim, compared with the host).
- **R4, Latin scope.**
  - TXT1a accepts text whose code points are all in scripts Latn, Zyyy or Zinh, according to a pinned Script table generated from the Unicode 16.0.0 UCD (the same version as linebreak-data.ts). This settles T024 condition 5 for the engine.
  - Anything else is refused with a typed code, and TXT1c or TXT2 owns it.
  - HarfBuzz keeps its internal UCD for shaping. That is a disclosed deviation from Chrome's HAVE_ICU, covered by the gate.
- **R5, metric rounding reconciliation (T005 against the engine).** Step 0 of TXT1-S is a committed probe, `scripts/capture-metric-rounding.ts`, with `--check`.
  - **What it measures in Chrome 145.0.7632.6:**
    - ascent, descent and the line box;
    - both observables: Range rects with a 0x0 inline-block baseline marker, and T005's observable;
    - faces: Ahem, the 5 Inter faces and the 2 Lato faces;
    - every size where `units*size/upem` of ascent or descent is an exact n.5 after hundredth truncation, between 1 and 64 px;
    - DPR 1, 2, 3 and 2.625.
  - **Core Text directly:** a standalone probe calls CTFontGetAscent and CTFontGetDescent through Skia's call sequence, for the same faces (T005 did this for advances).
  - **Pre-ruled outcomes:**
    - (a) **One traced mechanism explains both.** The engine (units.ts) and the compiler (metrics.ts) share it. platform-rules `ahem-metric-half-down` keeps its id and nodes, and its `source` is replaced by the trace.
    - (b) **The two rules read different Blink fields or observables.** Each function is bound to its observable, with the trace written into both files.
    - (c) **Unexplained but consistent per face.** The Chrome capture writes a per-face `halfRounding: 'down' | 'up'` into the font data, keyed by sha256 and never by name. It is labelled "measured, not traced", as the existing rule is, and has a planted fault. The engine reads it from `FontData`.
    - (d) **Inconsistent within one face.** Stop. A Judge ruling follows.
  - No engine code chooses rounding by guess.
- **R6, italic `ch` and italic advances.**
  - TXT1a-1 adds Chrome gate cases for Inter-Italic and Inter-BoldItalic, using the T036 method and corpus at the same sizes and widths, plus 23.3 px. The model must not change.
  - **If they are exact:**
    - em and i with real italic faces are exact in the engine;
    - `ch` of italic-trait faces stays caveat, unless a traced rule matches all 4 T005 rows and every other row. HarfBuzz's 16.16 path does not produce `ch`.
  - **If they mismatch:** the gate-mismatch rule applies. The lane stops, the mismatch is investigated, and a Judge rules; it is never tolerated. Until then, italic-trait faces stay refused in the engine and on native.
- **R7, b, strong, em and i on native** (this takes over T044 R7).
  - These are accepted on native **only** where matching resolves to a real bundled face that needs no synthesis:
    - Dragon Sans 700, italic and 700 italic;
    - Lato 700.
  - Synthetic bold or oblique stays refused on native with a new typed code, `DRAGON_SYNTHETIC_FONT_STYLE`. Cases: Ahem bold, Lato italic, Dragon Mono bold. The reasons:
    - synthesis is a Skia paint effect;
    - Chrome adds no advance for it, but its pixels are not reproducible by CTFontDrawGlyphs or drawGlyphs without a proof.
  - Web accepts all of them. The engine plant `syntheticBoldAdvance` proves synthesis never adds advance.
- **R8, the variable-font fence on native.**
  - TXT1a refuses **every** variable face on native. Inter VF is TXT1b.
  - The runtime checks each bundled face's sha256 against the compiled manifest before it creates a shim face. The runtime plant `faceHashUnchecked` must be caught.
  - The compiler and shim fences (T028) are unchanged.
- **R9, font wiring.**
  - T038 (T033 Phase B) stays its own package. It is a hard gate for TXT1a-1 and is not folded in, because its files (css, project and web-css) are disjoint from the engine and runtime and its risk is different.
  - TXT1a consumes T038's manifest, font map and assets, and lifts `textFontProblem` (`DRAGON_UNSUPPORTED_FONT`) for bundled, static, Latin, non-synthetic faces:
    - in the engine and on web in TXT1a-1;
    - on native in TXT1a-2.
- **R10, the pixel lane for text** (text-plan-summary and decision 13, whose "measured allowance written into the test" clause is used as written).
  - For real-font text nodes, device-pixels applies two checks:
    - (i) ink bounds within 1 device px, with no allowance;
    - (ii) coverage similarity against a threshold measured once, on a calibration fixture set disjoint from the proof set. The threshold and its measurement are written into the test.
  - Non-text pixels and Ahem text stay under P5's rules, unchanged.
  - Planted faults must fail (ii) or (i):
    - `glyphShiftedOneDevicePx`;
    - `wrongFaceDrawn` (Inter drawn for Lato);
    - `nominalGlyphDrawn` (cmap glyph instead of the shaped glyph id);
    - `gposOffsetsIgnored`.
  - The PM records this as a ruling. Widening the threshold later is a loosening, which is a stop.
- **R11, split and order.** TXT1a as one slice is unsafe. It spans:
  - a C/JNI toolchain;
  - an arithmetic port;
  - a Chrome probe;
  - the serial engine files;
  - the runtime on two platforms with both leases.

  **Now** (new files; parallel with everything):
  - **TXT1-N:** the shim bridge plus host replay. packages/text-shaper only.
  - **TXT1-S:** the engine shaping core (unreached), plus the R5 probe.

  **After P5:** T029, retargeted onto TXT1-N's replay, on device.

  **Serial, after INL1a (T044 R8), T038, TXT1-N and TXT1-S:**
  - **TXT1a-1:** engine, compiler, vectors and Chrome proof. Native keeps refusing non-Ahem fonts.
  - **TXT1a-2:** the runtime on device plus Phase B. It needs T029 passed and both leases.

  **Where INL2 goes:** after TXT1a-1 (inline.ts). INL2 is never concurrent with TXT1a-2 if INL2 needs native-support.ts.

**Common prefix.** **E** means `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`. NDK is `/tmp/dragon-ndk/ndk/27.2.12479018`. BASE is the recorded base sha. S1 to S18 are T044 §2's standard verify block.

## 3. Worker packages

### TXT1-N: the shim native bridge and host replay (new files plus build.zig; starts now)
- **Worktree / branch:** `/tmp/dragon-txt1n`, `txt1n-shim-bridge`. **Base:** master 41cc750. No device lease.
- **Objective.**
  - **JNI glue.** `src/dragon_hb_jni.zig` (new) is linked only into the Android `.so` and a new macOS host JNI dylib. It wraps face and font create and destroy, `shape` (returning an `IntArray` of stride 7), `glyph_advance` and `nominal_glyph`.
  - **build.zig.** New steps `host` (a static lib for aarch64-macos, for SwiftPM) and `host-jni` (a dylib for the JVM harness). The existing wasm, ios and android steps are unchanged in output apart from the Android `.so` gaining the JNI symbols.
  - **Swift package.** `swift/` (new): a module map over `include/dragon_hb.h` and a `DragonHBShaper` wrapper that copies records into `[Double]`.
  - **Kotlin.** `kotlin/` (new): `dev.dragon.text.DragonHB` with external funs.
  - **Transcript.**
    - `src/transcript.ts` (new) holds the transcript format of R3.
    - `scripts/replay.ts` (new) has `--record` (the gate's 1,260 cases through WASM, with face sha256 values) and `--check`.
    - Swift and Kotlin host replays require equality with the WASM transcript.
    - `--plant off-by-one` changes one expected int and must fail both.
  - **T029.** The device runner entry point T029 will call: `scripts/replay-device.ts` (new), with the iOS and Android harness sources under `device/` (new). Not run here.
- **allowed_files:**
  - `packages/text-shaper/build.zig`;
  - `packages/text-shaper/src/dragon_hb_jni.zig` (new);
  - `packages/text-shaper/src/transcript.ts` (new);
  - `packages/text-shaper/src/index.ts` (append-only exports);
  - `packages/text-shaper/swift/**` (new);
  - `packages/text-shaper/kotlin/**` (new);
  - `packages/text-shaper/device/**` (new);
  - `packages/text-shaper/scripts/replay.ts` and `packages/text-shaper/scripts/replay-device.ts` (new);
  - `packages/text-shaper/transcripts/**` (new, generated);
  - `packages/text-shaper/test/replay.test.ts` (new);
  - `packages/text-shaper/package.json` (scripts only);
  - `packages/text-shaper/README.md`;
  - `packages/text-shaper/.gitignore`;
  - the note `docs/goals/milestone-2-proof/notes/<task>-txt1n.md` (main checkout only).
- **verify:**
  1. `E pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
  2. `E pnpm run text:gate` prints 1260/1260 exact.
  3. `E cd /tmp/dragon-txt1n/packages/text-shaper && zig build wasm && cmp zig-out/wasm/dragon_hb.wasm wasm/dragon_hb.wasm` (byte-identical).
  4. `E cd /tmp/dragon-txt1n/packages/text-shaper && zig build -Dandroid-ndk=/tmp/dragon-ndk/ndk/27.2.12479018` (all steps, including host and host-jni).
  5. `E cd /tmp/dragon-txt1n/packages/text-shaper && nm -gU zig-out/android/arm64-v8a/libdragon_hb.so | grep -c Java_dev_dragon_text_DragonHB` is at least 1, and a disassembly scan of every new binary for `fmadd`/`fmsub`/`vfmadd` finds 0.
  6. `E node packages/text-shaper/scripts/replay.ts --record && node packages/text-shaper/scripts/replay.ts --check` (byte-identical)
  7. `E pnpm --dir packages/text-shaper run replay:swift && pnpm --dir packages/text-shaper run replay:kotlin` (0 mismatches over every recorded call)
  8. `E pnpm --dir packages/text-shaper run replay:swift -- --plant off-by-one` and the same for `replay:kotlin`: each exits 1.
  9. `E git diff --exit-code BASE -- vendor packages/text-shaper/src/dragon_hb.zig packages/text-shaper/include packages/text-shaper/wasm packages/layout packages/dragon packages/parity package.json pnpm-lock.yaml`
  10. `E git diff --name-only BASE..HEAD` lies inside allowed_files, and `E git remote -v` is empty.
- **stop_if:**
  - the WASM changes;
  - dragon_hb.zig or vendor/harfbuzz would need an edit;
  - a host replay mismatch persists after the flags are checked (that is the gate-mismatch rule: stop and investigate);
  - FMA appears in any binary;
  - an install outside /tmp is needed;
  - a file outside allowed_files is needed;
  - verification fails twice.

### TXT1-S: the engine shaping core and the R5 probe (new files only; starts now)
- **Worktree / branch:** `/tmp/dragon-txt1s`, `txt1s-shaping-core`. **Base:** master 41cc750. No device lease.
- **Objective.**
  - **Step 0.** The R5 probe, with its outcome (a) to (d) written in the note. Outcome (d) is a stop.
  - **`packages/layout/src/shaping.ts` (new, unreached, inside the translator subset).** It contains:
    - `GlyphShaper`;
    - the port of blink.ts: run and part sums, `FromFloatCeil`, cached positions, the safe-to-break offsets, line-start and line-end reshape, and the hyphen width;
    - `shapedMeasurer(faces, shaper, faults)`, which implements `TextMeasurer`. Metrics come from `FontData` with R5's rounding.
    - Float arithmetic only through units.ts helpers, or local `Math.fround` if the subset allows it. Otherwise that is a stop.
  - **`packages/layout/src/script-data.ts` (new, generated)** by `scripts/gen-script-data.ts` (new) from the Unicode 16.0.0 Scripts.txt, with `--check`, plus `isLatinText`.
  - **Test** `packages/layout/test/shaping-gate.test.ts` (new): a WASM `GlyphShaper` adapter in the test (imported by relative path, with no package.json change) runs all 1,260 gate cases through `shapedMeasurer`.
    - Widths must equal the Chrome reference, 1260/1260.
    - They must also equal blink.ts case by case.
  - **Planted faults** (a local faults record in shaping.ts, threaded into `EngineFaults` by TXT1a-1). Each must flip at least one case:
    - `advanceNot16_16`;
    - `doubleAccumulation`;
    - `noReshapeAtBreak`;
    - `kerningDropped` (features off);
    - `wholePixelPositions`;
    - `softHyphenWidthMissing`. If the corpus has no soft hyphen, this moves to TXT1a-1's fixture and the note says so.
- **allowed_files:**
  - `packages/layout/src/shaping.ts` (new);
  - `packages/layout/src/script-data.ts` (new, generated);
  - `scripts/gen-script-data.ts` (new);
  - `scripts/capture-metric-rounding.ts` (new);
  - `docs/research/text-spike/metric-rounding/**` (new: captures, the Core Text probe source, README);
  - `packages/layout/test/shaping*.test.ts` (new);
  - `packages/layout/test/script-data.test.ts` (new);
  - `vendor/unicode/16.0.0/Scripts.txt` (new, if it is not already vendored; sha256 in the note);
  - the note (main checkout).
- **verify:**
  1. `E pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
  2. `E pnpm run layout:subset` (0 violations, and shaping.ts and script-data.ts are listed as checked)
  3. `E pnpm run native:gen && git diff --exit-code packages/layout/generated` (the files are unreached, so nothing is generated)
  4. `E node scripts/gen-script-data.ts --check`
  5. `E pnpm exec vitest run packages/layout/test/shaping-gate.test.ts` (1260/1260, equal to blink.ts, every plant caught)
  6. `E node --conditions=dragon-internal scripts/capture-metric-rounding.ts && node --conditions=dragon-internal scripts/capture-metric-rounding.ts --check` (byte-identical; Chrome is 145.0.7632.6)
  7. `E git diff --name-only --diff-filter=MD BASE..HEAD` is empty; `E git diff --name-only BASE..HEAD` lies inside allowed_files; `E git remote -v` is empty.
- **stop_if:**
  - R5 outcome (d);
  - the port disagrees with the gate or with blink.ts on any case after two attempts (the gate-mismatch rule);
  - the port needs float arithmetic the subset forbids, or a translator change;
  - any existing file must change (inline.ts, text.ts, units.ts and index.ts belong to TXT1a-1);
  - Chrome is not 145.0.7632.6;
  - a plant is not caught;
  - verification fails twice.

### T029 (retargeted, not new): on-device shim equality
- After P5 has merged and TXT1-N has merged, holding both leases.
- It runs TXT1-N's `replay-device.ts` on the iOS simulator and the Android emulator. The results must be equal, and the off-by-one plant must be caught on both.
- allowed_files are replaced by `packages/text-shaper/device/**`, `packages/text-shaper/scripts/replay-device.ts` and `packages/text-shaper/transcripts/**` (device result files).
- It must pass before TXT1a-2 starts.

### TXT1a-1: Latin real-font text in the engine, compiler and web (serial files; XL)
- **Worktree / branch:** `/tmp/dragon-txt1a`, `txt1a-latin-engine`.
- **Base:** master after INL1a, T038, TXT1-N and TXT1-S have merged (P5, V1 Phase B and V2a are implied). Record BASE.
- **Never concurrent with:** INL2, INL1b, V2b, P6 or the emitter split, on any shared file.
- **Objective.**
  - **Input (additive; migrated by generator).** `TextFont` gains `face` (the manifest face id). Every Ahem input gets the Ahem id. Outputs are byte-identical.
  - **Engine.**
    - `shapedMeasurer` becomes the measurer for every text, Ahem included (R2).
    - platform.ts registers it, and `measurerFor` takes the host's faces and shaper.
    - `EngineFaults` gains the TXT1-S plants, plus `syntheticBoldAdvance`, `metricRoundingSwapped` (R5) and `latinCheckSkipped`.
    - The Latin refusal (R4) and the variable-face refusal are typed in unsupported.ts.
    - Soft-hyphen breaks use the shaped hyphen width.
    - R5's outcome is applied in units.ts and, if outcome (a) or (c), in fonts/metrics.ts.
  - **Hosts.**
    - A Node `GlyphShaper` in `packages/parity/src/text-shaper-host.ts` (new) is passed at the measurer call sites.
    - The translate harness gets a transcript replay shaper (R3).
    - Vectors record transcripts.
  - **Compiler.**
    - `textFontProblem` accepts bundled static Latin non-synthetic faces for the engine and web. The native targets still refuse, with the existing code.
    - `DRAGON_SYNTHETIC_FONT_STYLE` is added.
    - b, strong, em and i are handled as R7 describes, on web and in the engine.
  - **Italic cases (R6).** Gate cases for Inter-Italic and BoldItalic go in `docs/research/text-spike/italic/**`, and the gate reaches 1260 plus the italic count, all exact.
  - **Fixtures.** A new group, `text-latin`, at 400x300, at every DPR, ltr and rtl. It uses:
    - Dragon Sans 300/400/700/italic, Lato 400/700 and Dragon Mono;
    - the spike's Latin paragraphs, including `kernlig`;
    - the demo's sizes (0.7rem, 0.78rem, 1rem, 1.35rem, 1.5rem, 2rem);
    - soft hyphens, NBSP, `- ? / |`, a hyphen before digits, and mixed faces in one IFC (INL1a spans);
    - b, strong, em and i;
    - R5 half-metric sizes.
    - Rejects: non-Latin script, a variable face, synthetic bold, Lato italic on native.
    - The spike corpus is a fixture group (text-plan-summary, Proof).
  - **Chrome-dual:** computed values, boxes, line rects, the font key per node, and the break capture (engine equals Chrome N/N) at DPR 1, 2, 3 and 2.625.
- **allowed_files:**
  - Engine:
    - `packages/layout/src/{inline.ts,inline-box.ts,text.ts,shaping.ts,units.ts,platform.ts,platform-rules.ts,input.ts,validate.ts,layout.ts,unsupported.ts}`;
    - `packages/layout/src/block.ts` (EngineFaults appends only);
    - `packages/layout/src/index.ts` (append);
    - `packages/layout/generated/**`;
    - `packages/layout/vectors/**` (new files; existing files input-only);
    - `packages/layout/break-vectors/**` (new);
    - `packages/layout/test/*` (new files, appends, derived pins).
  - Translate: `packages/translate/src/{corpus.ts,corpus-dpr.ts}`, `packages/translate/harness/harness.ts`, `packages/translate/corpus*.json` (lock output).
  - Compiler:
    - `packages/dragon/src/lower/ios-layout.ts` (textFontProblem and the face id);
    - `packages/dragon/src/lower/native-program.ts` (the font face write only);
    - `packages/dragon/src/analysis/elements.ts` and `computed-checks.ts` (R7 contexts);
    - `packages/dragon/src/fonts/metrics.ts` (R5 only);
    - faults, catalogue, `diagnostic-codes.json` (append), `packages/dragon/src/profiles/*.ts` (output), `packages/dragon/test/txt1a*.test.ts` (new), seams.test.ts (append).
  - Parity:
    - `packages/parity/src/text-shaper-host.ts` (new);
    - `packages/parity/src/{pipeline.ts,dpr.ts,lanes.ts,native-host.ts}`, `packages/parity/src/cli/{vectors.ts,platform-check.ts,break-vectors.ts}` and `packages/parity/src/line-breaks.ts` (the measurer construction call sites only);
    - `packages/parity/src/fixtures.ts` (append);
    - `packages/parity/src/fixture-groups/text-latin.ts` (new);
    - `packages/parity/fixtures/*` (new);
    - `packages/parity/expected/**` and `expected-dpr/**` (new);
    - `packages/parity/emitted/**` (new bodies; headers relaxed);
    - `packages/parity/expected-breaks/**` (new);
    - `packages/parity/test/text-latin.test.ts` (new).
  - Text-shaper: `packages/text-shaper/src/gate.ts` (the italic reference entry, append) and `packages/text-shaper/test/gate.test.ts` (append).
  - Research data: `docs/research/text-spike/italic/**` (new).
  - Generator output: `packages/parity/out/lanes.json`, `examples/music-player/dragon/north-star-check.json`, `packages/wpt/expectations/*.json`.
  - The note (main checkout).
- **verify:**
  - S1 to S15 and S17.
  - S16 with this package's protected list: `packages/parity/src/{chrome,capture,compare,dual,targets,samples,native-compare,native-dump,report,render,device-run,device-lanes,device-vectors,pixel-reference}.ts packages/translate/src packages/layout/src/linebreak-data.ts packages/layout/src/linebreak.ts packages/layout/src/linefit.ts packages/dragon/src/emit vendor packages/text-shaper/src/dragon_hb.zig packages/text-shaper/wasm package.json .github`.
  - Also:
    - `E pnpm run text:gate`: all cases exact, italic included.
    - `E pnpm run linebreak:conformance`.
    - S7 and S13: every existing capture, break vector and Ahem output byte-identical.
    - S11: existing native case sources differ only in the migrated input line.
    - Every named plant is caught by a named fixture or vector.
    - `E pnpm run north-star:check`: web font rows fall, and the native totals do not rise.
- **stop_if:**
  - BASE lacks INL1a, T038, TXT1-N or TXT1-S;
  - a shared-file package is in flight;
  - any existing output changes, Ahem included;
  - an italic or Latin gate case mismatches (the gate-mismatch rule: stop and investigate, never tolerated);
  - the engine differs from Chrome on a break or width and Blink 145.0.7632.6 does not explain it;
  - a file outside allowed_files is needed (in particular emit/**, dragon_hb.zig or package.json);
  - the translator core must change;
  - a plant is not caught;
  - anything would be loosened;
  - verification fails twice.
- **Fallback split** (after two failures only):
  - TXT1a-1a: the Ahem-through-HarfBuzz swap with byte-identical outputs;
  - TXT1a-1b: real faces, fixtures and italic cases.
  - They run in series.
- **Pinned tests likely retargeted:**
  - tests asserting `DRAGON_UNSUPPORTED_FONT` for Inter or Lato on web: move to a still-refused non-Latin script or a variable face;
  - the ahemMeasurer-identity pins;
  - `wire.test.ts`, if T038 has not already done it.

### TXT1a-2: real-font Latin on device (native runtime; both leases)
- **Worktree / branch:** `/tmp/dragon-txt1a`, `txt1a-latin-native`.
- **Base:** master after TXT1a-1, with T029 passed.
- **Never concurrent with:** P6, V2b, the emitter split, INL2 or INL1b on native-support.ts, uikit.ts, android-views.ts or native-host.ts.
- **Objective.**
  - **Linking.** Link DragonHB.xcframework into the iOS app, and `libdragon_hb.so` (arm64-v8a, x86_64) into the Android app, through native-host.ts. Bundle the faces the case's manifest uses by sha256, beside Ahem.
  - **Runtime.**
    - The runtime builds `GlyphShaper` from Swift and Kotlin closures (R1). It checks face hashes (R8).
    - It draws the **shaped glyph ids** at engine positions, with x and y offsets, using CTFontDrawGlyphs and Canvas.drawGlyphs with a per-leaf face.
    - Synthetic styles are refused (R7). Variable faces are refused (R8).
  - **Compiler.** `textFontProblem` lifts the native refusal for the TXT1a-1 set. b, strong, em and i are accepted on native per R7.
  - **The R10 text pixel rule.** Calibration set `text-calibration` (new fixtures) with the threshold written into the test.
  - **Runtime plants** (in `SUPPORT_PLANTS`), each caught by a named lane:
    - `nominalGlyphDrawn`;
    - `gposOffsetsIgnored`;
    - `glyphShiftedOneDevicePx`;
    - `wrongFaceDrawn`;
    - `faceHashUnchecked`;
    - `shaperFromPlatform`: Core Text or Minikin advances used instead of the shim, caught by layout-vectors-device.
- **allowed_files:**
  - `packages/dragon/src/emit/{native-support.ts,uikit.ts,android-views.ts,expected-dump.ts}` (the face and shaper wiring, glyph drawing, plants);
  - `packages/dragon/src/lower/{ios-layout.ts,native-program.ts}` (the native acceptance and face writes);
  - `packages/dragon/src/analysis/computed-checks.ts` (native contexts);
  - faults, catalogue, diagnostic-codes (append), profiles (output);
  - `packages/parity/src/native-host.ts` (linking the shim and bundling faces);
  - `packages/parity/src/pixel-reference.ts` and `packages/parity/src/device-lanes.ts` (the R10 text rule only, additive);
  - `packages/parity/src/fixtures.ts` (append);
  - `packages/parity/src/fixture-groups/text-calibration.ts` (new);
  - `packages/parity/fixtures/*` (new);
  - `packages/parity/emitted/**`;
  - `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**` and `packages/parity/expected-pixels/**` (new cases, appended manifests);
  - `packages/parity/test/*` (new files, appends, derived pins);
  - `packages/dragon/test/txt1a-native*.test.ts` (new);
  - lanes.json, north-star-check.json and WPT expectations (output);
  - the note.
- **verify:**
  - S1 to S17, with S16 protecting `packages/layout/src packages/translate/src packages/text-shaper/src packages/text-shaper/wasm vendor package.json .github`.
  - `E cd /tmp/dragon-txt1a/packages/text-shaper && zig build -Dandroid-ndk=/tmp/dragon-ndk/ndk/27.2.12479018`
  - S18 on both leases, with these requirements:
    - every text-latin and text-calibration case is in all five device lanes, on both platforms and at every DPR;
    - no `not run` lane;
    - layout-vectors-device, with the live shim, equals the host on both targets;
    - device-frames, device-applied and device-lines pass;
    - device-pixels passes the R10 rule on the proof set, and adds no failure beyond master's list;
    - every runtime plant is caught;
    - `--require-all` gives the same verdict as master.
  - `E pnpm run north-star:check`: native font errors fall, and the totals do not rise.
- **stop_if:**
  - T029 has not passed, or a lease is not held;
  - a non-pixel device lane fails;
  - the device shim differs from the host (the gate-mismatch rule);
  - the R10 threshold cannot be set without covering a planted fault;
  - Ahem pixels change;
  - a file outside allowed_files is needed;
  - a device fails to boot twice;
  - verification fails twice.

## 4. What starts now

TXT1-N and TXT1-S can run in parallel with each other and with every lane in flight:
- **Their allowed_files are provably disjoint.** TXT1-N writes only packages/text-shaper (excluding src/dragon_hb.zig, include and wasm). TXT1-S writes only new files in packages/layout/src, packages/layout/test, scripts and docs/research/text-spike/metric-rounding.
- **They are disjoint from every in-flight lane.**
  - INL-P writes docs/research/inline-spike and scripts/capture-inline-probe.ts.
  - INL-U writes the ua files.
  - P5, T009 and T026 do not create shaping.ts or script-data.ts.
  - TXT1-S's new engine files are unreached, so native:gen output does not change.

Nothing else is safe ahead of INL1a:
- TXT1a-1 edits inline.ts, text.ts and the measurer sites.
- TXT1a-2 needs P5's device lanes and T029.

## 5. Required board updates (PM)

1. T056 done with this note.
2. Add TXT1-N and TXT1-S. Both can be dispatched now; neither needs a lease.
3. Retarget T029 to TXT1-N's replay, gated on P5 and TXT1-N.
4. Add TXT1a-1, gated on INL1a, T038, TXT1-N and TXT1-S.
5. Add TXT1a-2, gated on TXT1a-1, T029 and both leases.
6. Record R1 to R11 in docs/decisions.md as PM rulings. They amend:
   - "Italic ch" (R6);
   - T044 R7 (R7);
   - "Variable fonts are fenced", on native (R8);
   - decision 13's use for text pixels (R10).
7. Update the T044 R8 order: P5 → V1 B → V2a → INL1a → TXT1a-1 → INL2 → TXT1a-2 → INL1b. TXT1a-2 and INL2 are never concurrent on native-support.ts.
