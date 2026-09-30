# T082 Worker: TXT1-S, the engine shaping core and the R5 probe

Worker, 2026-09-28. Worktree `/tmp/dragon-txt1s`, branch `txt1s-shaping-core`, BASE `8e66aca6` (master).

**Result: done.** The branch has three commits:
- `bd58b3c2`: Step 0.
- `46c84815`: the Script table, formerly parked and now fast-forwarded in.
- `6b09c37e`: the shaping core.

The first pass stopped on three blockers, B1 to B3 (§5). The PM ruled on them, and this pass applies the rulings.

## 1. Step 0: R5 metric rounding. Outcome (a), one traced mechanism

`scripts/capture-metric-rounding.ts` and `docs/research/text-spike/metric-rounding/` (README, `coretext-probe.swift`, `captures/`).

**Core Text, measured directly.** The Swift probe makes Skia's call sequence:
- `CTFontManagerCreateFontDescriptorFromData`;
- `CTFontCreateWithFontDescriptor` at size 0;
- `CTFontCopyGraphicsFont` and `CTFontCreateWithGraphicsFont` at the strike size;
- `CTFontGetAscent`, `CTFontGetDescent` and `CTFontGetLeading`.

It ran for Ahem, Inter Light, Regular, Italic, Bold and BoldItalic, and Lato Regular and Bold, at every size from 0.01 to 192 px in hundredths. Every value, 8 × 19,200 × 3, equals this, with 0 mismatches:

```
coreText(units) = (round(units * 65536 / upem) * upem / 65536) * (size / upem)      // CGFloat
```

So Core Text keeps each vertical metric as a 16.16 fraction of the em. Skia stores the value as a float, and Blink rounds it with `SkScalarRoundToScalar`, which is `floorf(x + 0.5f)`.

**Chrome 145.0.7632.6** at DPR 1, 2, 2.625 and 3. There are 129 rows. Each was checked on two observables: the Range rect against a baseline marker, and T005's line box.

| Rule | Range misses | Line box misses |
|---|---|---|
| Traced (above) | 0 | 0 |
| Half up (T005 metrics.ts today) | 79 | 79 |
| Half down (units.ts `roundFontMetricToWholePx`) | 56 | 56 |

The two observables never disagree.

**Why each old rule held where it was tested:**
- **Ahem** 200/1000 quantises below 0.2, so 12.5 px gives a descent of 2.49996, which rounds to 2.
- **Inter** 1984/2048 is exact, so 16 px gives an ascent of 15.5, which rounds to 16.
- **Lato** discriminates between them. At 82.16 device px the descent is 17.50008 unquantised but 17.49987 from Core Text. Chrome gives 17, and both old rules give 18.

**The traced rule is now in the engine.** It is `units.ts roundCoreTextMetricToWholePx`, and `shapedMeasurer.metrics` uses it. In shaping-gate.test.ts:
- it gives Chrome's ascent and descent on every captured row for Ahem, Inter Regular, Lato and LatoBold;
- it equals `ahemMeasurer.metrics` at every size from 0.01 to 256 px in hundredths. The first Ahem difference is at 662.51 px.

**For TXT1a-1:**
- `ahem-metric-half-down` keeps its id and nodes; its `source` becomes this trace.
- fonts/metrics.ts needs the quantisation for Lato.
- Skia measures sizes above 256 px on a 64 px strike, which is not probed here.

## 2. The shaping core (`packages/layout/src/shaping.ts`, unreached)

**GlyphShaper (B2 ruling).**
```
shape(face, size, text, start, end, script, rtl, language, features: readonly number[]): readonly number[]
```
- `features` is a list of records of `FEATURE_STRIDE` = 4 integers: the OpenType tag as a big-endian uint32, the value, start and end. Start and end are UTF-16 offsets, and an end of `FEATURE_TO_END` (4294967295) means the end of the text.
- The constants are `TAG_KERN`, `TAG_HALT` and `TAG_CHWS`.
- The glyph records are unchanged: stride 7, 16.16 advances, and the cluster is a UTF-16 offset in the text.
- TXT1-N must carry the same array through its C ABI and JNI wrappers.

**What was ported from blink.ts:**
- RunSegmenter and ScriptRunIterator, with Script_Extensions and bracket pairing;
- HanKerning: the `halt` ranges, the unsafe-to-break offsets and the line-end extension;
- ShapeResult runs (a negative run width clamps to 0), ComputePositionData (safe-to-break flags and ceiled cached positions), and CachedOffsetForPosition;
- ShapeResultView part widths summed in float, `FromFloatCeil`, and ShapingLineBreaker's reshaping at the start and end of a line;
- the hyphen at a soft-hyphen break: U+2010 if the face has it, else `-`.

**Float arithmetic.** It goes only through units.ts. `inlineToFloat`, `floatAdd` and `inlineToLayoutUnitCeil` are the three ruled helpers. `roundCoreTextMetricToWholePx` is the R5 rule, listed as a deviation. The T038 guard is unchanged: shaping.ts contains no `Math.` rounding.

**The API:**
- **`shapedText(faces, shaper, faults, language)`** returns:
  - `measurer`: R2's `TextMeasurer` (`metrics`, `measure` and `measureRange`), with each item shaped once and cached;
  - `item(text, face, size)`: the shaped item;
  - `line(item, start, breakOffset, available, isBreakable)`: the width of a line.
- **`shapedMeasurer(...)`** returns the `.measurer` alone.
- **Until TXT1a-1 adds `TextFont.face`,** `TextFont.family` names the face id.
- **A `ShapedFace`** is `{ id, data: FontData, hanKerning: HanKerningFontData }`.
- **Refusals are typed** (`ok: false`, with a reason):
  - emoji (Extended_Pictographic other than the text-default ones);
  - combining marks above U+00FF;
  - Inherited characters that have Script_Extensions;
  - a code point with no glyph (font fallback).

  These are what the gate's reference refuses too.

**Planted faults** (`ShapingFaults`, a local record that TXT1a-1 threads into `EngineFaults`). Each changes at least one gate width:
- `advanceNot16_16`;
- `doubleAccumulation`: widths are kept as exact doubles through FromFloatCeil;
- `noReshapeAtBreak`: no reshaping at either edge of a line;
- `kerningDropped`: adds the feature `kern` = 0;
- `wholePixelPositions`;
- `softHyphenWidthMissing`: en/shy has soft-hyphen breaks, so this is caught here.

**Script data (`script-data.ts`, generated by `scripts/gen-script-data.ts`).**
- The sources are vendored with pinned sha256 values:
  - Unicode 16.0.0: `Scripts.txt`, `ScriptExtensions.txt`, `PropertyValueAliases.txt`, `BidiBrackets.txt`, `DerivedGeneralCategory.txt` and `emoji-data.txt`;
  - ICU 77.1 `uscript.h` (`79b4287a…`), because Blink compares UScriptCode numbers.
- It provides:
  - the Script and Script_Extensions values as UScriptCode, with ISO 15924 tags;
  - Bidi paired brackets;
  - General_Category M, Ps and Pe;
  - Extended_Pictographic;
  - `isLatinText` (R4).
- The shas of DerivedGeneralCategory and emoji-data equal the pins in gen-linebreak-data.ts.

## 3. Evidence

`packages/layout/test/shaping-gate.test.ts`, 17 tests. text-shaper is loaded at run time by relative path, with no package.json change.
- **All 1,260 cases through the engine, 1260/1260 exact against Chrome.**
  - That is the 620 spike cases plus the 640 Lato cases, including the 60 NotoSansJP Japanese-script cases.
  - The nowrap span goes through `shapedText.measurer.measure`, and each line through `shapedText.line`. The total line count also matches.
- **Equal to blink.ts case by case.** The reference is recomputed with text-shaper's own shaping context, HanKerning and hyphen.
- **Segmentation.** `segmentText` equals text-shaper's segmenter on every gate paragraph, and on "abc ー def", "abc । def", "abc 、 def", "—… “" and "「English」と(括弧)". Emoji are refused.
- **HanKerning font data** that the host reads is identical at 12, 16, 17 and 24 px for NotoSansJP, Inter and Lato, so a per-face value is justified.
- **All 6 plants are caught.**
- **R5 rows** (§1).
- **Ahem through HarfBuzz** (§4).

`packages/layout/test/script-data.test.ts`, 10 tests:
- every code point equals Scripts.txt and ScriptExtensions.txt, with extension sets in ascending UScriptCode order;
- every listed code point agrees with V8 on Script, M, Ps and Pe;
- Extended_Pictographic and the brackets equal the vendored files.

V8 is not used as the oracle for Script_Extensions or Extended_Pictographic: Node 24's ICU 78 carries Unicode 17, which changed U+0320's extensions and many Extended_Pictographic values.

## 4. Findings for TXT1a-1

1. **The Ahem measurer is off by 1 LU against Chrome at some fractional sizes; the HarfBuzz path is not.**
   - The new capture `captures/ahem-advances.json` has 1,680 nowrap runs: 'X' × 1 to 120 at 14 sizes, DPR 1.
   - Ahem through shaping.ts matches Chrome on all 1,680.
   - `ahemMeasurer`, which accumulates in f32 at the instance size, misses 40 of them: at 7.77, 9.99, 11.1111, 17.3, 23.3 and 33.33 px, always 1 LU wide.
   - The test pins this as a finding.
   - **Impact on R2.** R2's premise that every existing Ahem output stays byte-identical holds for today's fixtures, since they pass. It would break for longer Ahem runs at such sizes, and there HarfBuzz is the path that is right. The swap should expect existing outputs to stay the same, and treat a changed output as a correction only with a Chrome capture.
2. **R4 by Script alone admits Common code points that Blink shapes in their own runs.**
   - Examples are U+30FC ("ー", Script_Extensions Hira and Kana), U+0964 and U+3001.
   - The engine segmenter gives "abc ー def" the runs Latn, Hira, Latn. `isLatinText` accepts it, which script-data.test.ts pins.
   - TXT1a-1 should either refuse a Common or Inherited code point whose Script_Extensions exclude Latn (the data is now in script-data.ts), or accept multi-run Latin-scope text, since the segmenter handles it.
3. **Script of 16-bit Latin-scope text.** With no Latn code point, it resolves to Zyyy ("—… “"). 8-bit text is always Latn.
4. **`TextMeasurer` has no line entry.** Line widths need `ShapedText.line` next to it (INL1a and TXT1a-1).
5. **Combining marks above U+00FF are refused.** That includes NFD Latin such as "e" + U+0301. This follows the gate reference's limit; TXT1a-1 decides.
6. **Ahem's OS/2 fsSelection is 64.** USE_TYPO_METRICS is not set, contrary to T056 §1.5. It changes nothing.

## 5. Rulings applied, and deviations

- **B1.**
  - `units.ts` has four append-only exports: the three ruled helpers, plus `roundCoreTextMetricToWholePx`. The fourth is a deviation: the spec requires R5's rounding in `shapedMeasurer`, and units.ts is the only file allowed to round.
  - Because every units.ts export is an engine root, `Units.swift` and `Units.kt` gain these four functions.
  - `native:swift` and `native:kotlin` pass. Both printed "build 0.0 s", so the build may have been reused and whether the new functions compile is not shown.
- **B2.**
  - The feature array is in `GlyphShaper`.
  - HanKerning's font data comes from the host's face record (`ShapedFace.hanKerning`). Deriving it needs the GPOS feature list and glyph bounds, which `GlyphShaper` does not expose. The test host derives it with text-shaper's method. This is a deviation, and it is outside R4's scope.
- **B3.**
  - The digest lines of Strings.swift, Unions.swift and Unions.kt are regenerated.
  - Apart from the Units additions (B1), no generated body changed. My first version named a type `Run`, which collided with inline.ts's `Run` (the translator renamed it `Inline_Run` in Inline.swift and Inline.kt). I renamed mine to `ShapingRun` and `ShapingGlyph`, so Inline is unchanged.
- **The Ahem advance capture** was added to the R5 script (section (4)). It is in the metric-rounding directory, because the Ahem R2 premise is part of the same reconciliation.
- **Extra UCD and ICU files** were vendored for the Script_Extensions segmentation the PM required.
- **The parked branch** `txt1s-script-data-parked` is merged and deleted. The capture's row selection and the probe's range are unchanged from the first pass.

## 6. Verification (on `6b09c37e`, under the E environment)

1. **`pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`.**
   - Install and typecheck pass.
   - Tests: 1531 passed and 4 failed.
     - **dist.test.ts (f5)** fails on master too; the PM assigned it to T088.
     - **3 timeouts at load 24 to 34:** lanes, native-compare and parity determinism.
   - On rerun, lanes and native-compare pass. parity.test.ts passes run on its own: 237/237 at the default timeout.
2. **`pnpm run layout:subset`:** 0 violations. `engineFiles()` includes `script-data.ts` and `shaping.ts`.
3. **`pnpm run native:gen`.** The diff is only the 3 digest lines and the Units.swift and Units.kt additions (B1 and B3).
4. **`node scripts/gen-script-data.ts --check`:** byte-identical.
5. **`vitest shaping-gate.test.ts`:** 17/17, including 1260/1260, equality with blink.ts and all 6 plants caught.
6. **`capture-metric-rounding.ts` and `--check`:** outcome (a). Byte-identical over 4 files. Chrome 145.0.7632.6.
   - chrome.json 6ea73191…
   - coretext.json bb486198…
   - outcome.json a5856103…
   - ahem-advances.json ef6f7a8f…
7. **Diff checks.**
   - `--diff-filter=MD` lists units.ts and the 5 generated files, all ruled (B1 and B3).
   - Every name is in allowed_files, as the rulings amended them.
   - `origin` is the owner's remote. Nothing was pushed ("never push").
