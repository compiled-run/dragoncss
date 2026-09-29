# T005: TXT1-C core, Worker receipt (2026-09-28)

**Result: done** after the PM rulings on B1 and B2 (the first pass stopped blocked at `ae13a93`; the rulings are applied in the commit after it on `txt1c-fonts`, worktree `/tmp/dragon-fonts`, base 8df7574).

## PM rulings applied

- **B1:** `faceMetrics` returns `chSupport`. It is `exact` for upright faces, and `caveat` with the reason `core-text-italic-trait-advance` for faces with the italic trait (OS/2 fsSelection bit 0 or a nonzero post.italicAngle). The reason points at `captures/metrics.json` and this note. The 4 rows stay in the committed captures. `captures.test.ts` holds an explicit list of the 4 expected-mismatch case ids and checks all of the following:
  - every listed id is an italic-trait face;
  - italic-trait rows, and only those, are in the caveat group;
  - exactly the listed rows differ from Chrome, so any other mismatch fails, and a listed row that starts to match fails too.

  Upright `ch` stays exact on all 960 upright rows here, and on 1,200 of 1,200 rows in the earlier sweep. The planted faults are counted only on comparisons outside the list. **TXT1a should revisit italic `ch` with the HarfBuzz advance path (T003) and Chrome cases.**
- **B2:** in `packages/dragon/test/ua.test.ts` and `packages/dragon/test/s4b.test.ts`, the rounding-boundary checks now exempt `src/fonts/**` by path. A comment explains that the font metrics port Blink's float32 arithmetic. The colour rule is unchanged everywhere else.
- **Verification after the rulings:**
  - `pnpm typecheck` passes;
  - `pnpm test` passes 1,229 of 1,229, in 52 files;
  - `vitest packages/dragon/test/fonts` passes 54 of 54;
  - `capture --check` is byte-identical for all 5 files.

## What landed (all new files, plus an append to the README)

- **`packages/dragon/src/fonts/`** is pure TypeScript with no `node:` imports. A test checks this.
  - `sfnt.ts`: the table reader and the typed refusals.
  - `css-tokens.ts`: the css-syntax-3 tokenizer.
  - `font-face.ts`: the descriptor parsers, ported from `at_rule_descriptor_parser.cc` and `css_parsing_utils.cc`. It also covers the `FontFace::Create` drop rule, the first-src choice with typed `remote-url`, `unresolved-asset`, `local-font` and `unreadable-font` errors, and `data:` decoding.
  - `family-list.ts`: `ConsumeFontFamily` and `SerializeFontFamily`.
  - `selection.ts`: `FontSelectionValue`, the algorithm, `GetFontSelectionCapabilities`, and the `FontFaceCache` grouping.
  - `wtf-hash.ts`: rapidhash and the WTF `HashTable` slot order, which decides ties between capability groups.
  - `metrics.ts`, `manifest.ts`, `font-map.ts`, `cssom.ts`, `faults.ts` and `index.ts`.
- **`scripts/capture-font-data.ts`**, with `--check`. Captures go to `packages/dragon/test/fonts/captures/`:
  - `matching.json`: 24 families, 416 requests;
  - `metrics.json`: 1,040 rows, covering 8 faces × 10 sizes × 4 DPRs plus override and size-adjust variants;
  - `parsing.json`: 64 `@font-face` rules and 27 `font-family` values;
  - `pinned.json`: 11 requests;
  - `platform.json`: 13 generics. This is data only.
- **Tests** in `packages/dragon/test/fonts/`: `captures`, `units` and `vendored`. Case counts come from the capture files.
  - All 10 capture faults flip at least one comparison.
  - The 3 unit faults are caught by unit tests.
  - A test shows that the Blink hash-map order decides at least one captured tie, compared with declaration order.
- **Vendored fonts**, 3,304,372 bytes in total, all OFL. Each is downloaded from its upstream release, and each family has an `OFL.txt`. The spike copies were not used, because their provenance was not recorded.

  | Family | Version | Faces | Source |
  |---|---|---|---|
  | Inter | 4.1 | Light, Regular, Italic, Bold, BoldItalic | `extras/ttf` |
  | Roboto 3 classic | v3.016 | Regular | `unhinted/static` |
  | Noto Sans | v2.015 | Regular | unhinted |
  | Noto Sans Mono | v2.014 | Regular | unhinted |

  The SHA-256 and byte count of each file are appended to `vendor/fonts/README.md`. The Ahem section is unchanged.

## Verification

- `pnpm typecheck`: passes.
- `node --conditions=dragon-internal scripts/capture-font-data.ts --check`: a fresh capture is byte-identical for all 5 files.
- `pnpm exec vitest run packages/dragon/test/fonts`: 51 of 52 pass. The failure is B1.
- `pnpm test`: 1,224 of 1,227 pass. The three failures are B1, plus the two B2 checks in `ua.test.ts` and `s4b.test.ts`.
- Scope: `git diff --name-only 8df7574..HEAD` contains only `packages/dragon/src/fonts/**`, `packages/dragon/test/fonts/**`, `scripts/capture-font-data.ts`, `vendor/fonts/{Inter,Roboto,NotoSans,NotoSansMono}/**` and `vendor/fonts/README.md`. The README change adds 43 lines and deletes none.
- No T003, P5 or T011 file is touched.

## B1: ch of the italic faces

`ch` is `ZeroWidth`, which is `WidthForGlyph('0')`. Chrome's value is 1 float ulp above Dragon's in these 4 rows:

| Face | Size | DPR | Chrome | Dragon |
|---|---|---|---|---|
| Inter-Italic | 23.3px | 1 | 14.68764591217041 | 14.687644958496094 |
| Inter-Italic | 23.3px | 2 | 14.68764591217041 | 14.687644958496094 |
| Inter-BoldItalic | 23.3px | 1 | 15.700194358825684 | 15.700193405151367 |
| Inter-BoldItalic | 23.3px | 2 | 15.700194358825684 | 15.700193405151367 |

The other 1,036 rows match, and so do all 1,040 rows of ex, cap, line-height normal and baseline.

What the measurements show:

- **Upright faces.** Chrome's advance equals `float(CoreText_advance × float(float(1/size) × size))`. The Core Text advance is computed in double. This matched 1,200 of 1,200 rows of a separate 300-size sweep over four upright fonts.
  - The extra factor is what `SkScalerContextRec::computeMatrices` gives on its `preScale(1/s)` branch. But by the Skia 2ab8add5 source, Mac with `kVertical` and equal scales should take the identity branch.
- **Italic faces.** Chrome has no such factor. Its value is `float(CoreText_advance)`, and the Core Text advance of an italic face is not exactly `units × size / upem`.
- **Control experiment.** I patched only Inter-Regular's `OS/2.fsSelection` italic bit, or only its `post.italicAngle`. Either change removes the factor: 200 of 200 sizes then match the model without the factor, and 174 of 200 match the model with it.
- **Standalone Core Text.** Called outside Chrome through the same Skia call sequence, Core Text returns the plain double advance for both faces.

So the italic-trait dependence lives inside Core Text or Chrome's process, and I cannot derive it from Blink 145.0.7632.6 or Skia source. Matching all four rows would need a special case keyed on the italic trait, which the spec forbids.

The port keeps the upright rule, which is Chrome's behaviour for the fonts Blink measures today. Owner or Judge options:

- (a) accept an empirically proven rule for italic-trait faces, backed by this capture evidence;
- (b) exclude `ch` of italic-trait faces from TXT1-C and label it caveat;
- (c) take `ch` from the HarfBuzz lane (T003) once its advance function is proven.

## B2: the boundary checks in `ua.test.ts` and `s4b.test.ts`

"Colour conversion and rounding live only in css/color.ts" rejects any `Math.round`, `floor`, `ceil`, `trunc` or `fround` under `packages/dragon/src`. Font metrics have to use `Math.fround` and `floor`, because they port Blink's float math.

I did not disguise the calls to get past the regex. Scoping the check to colour code, or exempting `src/fonts/`, needs an edit to those two test files, which are outside allowed_files. That edit fits T011 or a PM task.

## Findings the port follows (numbers decide)

- **Rounding.** Ascent and descent round with Skia's `floorf(x + 0.5f)`, which is half-up. For example, Inter at 16px has ascent 15.5, and Chrome gives 16. The spec's "macOS half-down" is not what Chrome does, so the planted fault is named `metricsRoundHalfDown`. This is a deviation from the fault list.
- **x-height** comes from the path bounds of glyph `x`. The path is drawn at 64px and scaled by `size/64` in float (`SkFont::getPath`).
- **Metrics above 256 device px** go through Skia's 64px canonical strike.
- **Leading.** The ascent-side half-leading is floored to a whole device pixel (`CalculateLeadingSpace`).
- **`getBoundingClientRect`** reads `f32(f32(LU/64) × f32(1/dpr))`.
- **Family names match case-insensitively.** `FontFaceCache` uses `CaseFoldingHashTraits`, so `"mixed case"` selects the face declared as `Mixed Case`. The spec's "exact" grouping keeps exact capabilities, and uses case-folded family keys.
- **`!important` descriptors are dropped.** So are `src` entries with an unsupported `format()` or `tech()`. The rule itself is dropped when no valid `src` remains.
- **Generic families.** Chrome 145's parser knows `serif`, `sans-serif`, `cursive`, `fantasy`, `monospace`, `system-ui`, `-webkit-body` and `math`. It treats `ui-*`, `emoji` and `fangsong` as family names, which all fall back to Times in `platform.json`. The font map still keys them as generics for unquoted identifiers.
- **Math functions** such as `calc()` in descriptors produce the typed build error `unsupported-descriptor`. They are not evaluated.
