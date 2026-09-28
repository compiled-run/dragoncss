# TXT1: real-font text, design summary (2026-09-28)

This summarises the design. The full design is in this session's transcript; re-derive the detail when a package starts.

## Blink facts that shape the design
- **Advances go through 16.16 fixed point.** Each glyph advance comes from Skia, which reads Core Text on Mac. `SkiaScalarToHarfBuzzPosition(v) = ClampTo<int>(v * 65536)` converts it, with subpixel positioning on Mac. HarfBuzz applies GPOS in 16.16, then Blink converts to float, sums in float, and applies `FromFloatCeil`. Sources: harfbuzz_face.cc and skia_text_metrics.cc.
- **text-spacing-trim** is the OpenType `halt` feature (or `chws`) on selected glyph indices (han_kerning.cc).
- **Line ends are reshaped** where HarfBuzz says a break is unsafe (shaping_line_breaker.cc). So Chrome keeps kerning next to spaces in mid-line, while Minikin drops it everywhere.
- **Synthetic bold and italic** are Skia paint effects (embolden, skew −1/4), not advance changes. **opsz** is set automatically from the specified size (font_custom_platform_data.cc).
- Chrome 145 pins HarfBuzz at fa2908bf16d2ccd6623f4d575455fea72a1a722b.

## Recommendation: bundle HarfBuzz everywhere, pinned to Chrome's revision
- **One Zig shim** (dragon_hb.zig, built with `zig build`; owner 2026-09-28) over the pinned, unmodified C++ HarfBuzz, built three times: WASM (compiler, the TS reference engine, tests), an iOS xcframework, and an Android .so through JNI.
- **Chrome's advance function:** `trunc(float(float(units*size/upem))*65536)`, built with `-ffp-contract=off`.
- **Integer results only cross into the engine:** glyph id, cluster, advance, offsets and unsafe-to-break flags. All float and LU arithmetic stays in the translated TS engine, so Node, Swift and Kotlin are bit-identical.
- **Why not the platform shapers:**
  - Core Text is off by up to 0.016 px per line.
  - Minikin loses kerning next to spaces.
  - Core Text picks named instances of variable fonts.
  - Neither exposes unsafe-to-break information.
  - The TS reference engine cannot call them, so vectors could not be shared across targets.
- **Cost:** about 0.5–1 MB per ABI, stripped. Measure it in step 0.

## Fonts, matching and fallback
- **Bundled `@font-face` files** are the only exact source. Each has a SHA-256 manifest that enters the compilation digest. Remote URLs are a build error.
- **Generic families** (system-ui, sans-serif, monospace) resolve through a project font map:
  - **pinned:** web CSS is rewritten to the same font, and the result is exact;
  - **platform:** the system font is used, and the result is caveat.
- **Matching** uses Blink's font_selection_algorithm, ported to the compiler.
- **Per-character fallback** ports Blink's reshape queue into the engine. System fallback is caveat.
- **Metrics:** hhea on darwin, with macOS half-down rounding. x-height comes from glyph bounds, ch from WidthForGlyph('0') without the 16.16 step, and cap height from OS/2.

## Integration and phasing (strict serial order on text.ts and inline.ts)
1. P4
2. engine-linebreak
3. P5
4. V1 and V2
5. INL1
6. TXT1a: Latin
7. TXT1b: variable fonts
8. TXT1c: Japanese and trim
9. TXT1d: system fonts, emoji and colour
10. TXT2: bidi, RTL and complex scripts

Two packages can start in parallel with steps 3 to 5 because they write new files only:
- **TXT1-0:** HarfBuzz, the shim and a step-0 gate. The gate requires WASM HarfBuzz to reproduce Chrome's LU widths on all 620 spike paragraphs.
- **TXT1-C:** `@font-face`, the font manifest and matching.

## Proof
- **Step-0 gate** first; any mismatch goes back to the owner.
- **Fixtures** with vendored OFL fonts at every DPR.
- **The spike corpus** as a fixture group.
- **Planted faults:** kerningDropped, wrongOpsz, opszZoomed, softHyphenWidthMissing, minikinSpaceKerning, namedInstance, advanceNot16_16, doubleAccumulation, noReshapeAtBreak, syntheticBoldAdvance and others.
- **Pixel lane for text:** compared by ink bounds within 1 device px plus coverage similarity, with a measured allowance recorded in the test (decision 13). Non-text pixels stay strict.
