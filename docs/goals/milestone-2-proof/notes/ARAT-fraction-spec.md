# ARAT-fraction: `aspect-ratio` with parts that are not whole 64ths, as Chrome 145 lays it out

Worker spec (2026-11-22), for review before implementation. Follows T050 (notes/T050-size-ar.md), which named this package SIZE-ar-conv.

## Why

The Markless shop app (Markless origin/main f12707d7a, packages/mobile/apps/shop/styles/app.css, line 143) draws its loading cards as:

```css
.skeleton { aspect-ratio: 3 / 3.4; border-radius: var(--radius); background: var(--line); }
```

Each card is an empty `<li>` in `ul.grid`. The grid has `repeat(2, 1fr)` columns with a 12px gap, or 4 columns with an 18px gap at 700px and wider. It sits inside `main.content`, which has `padding: 20px 16px` (32px when wide), and every element has `box-sizing: border-box`. The `@pending` arms of pages/index.tsrx and pages/categories/[slug].tsrx render the cards. Dragon refuses both pages twice:

- packages/dragon/src/analysis/computed-checks.ts checkAspectRatio, on every target: "Chrome converts a ratio whose parts are not whole multiples of 1/64 with a float continued fraction that Dragon does not compute at build time".
- packages/dragon/src/lower/ios-layout.ts aspectRatio, on native: "a ratio whose parts are whole multiples of 1/64, or equal".

## What Chrome 145 does (tag 145.0.7632.6; sources downloaded to /tmp, cited here, deleted)

**Style: the ratio is stored as two floats** (core/css/resolver/style_builder_converter.cc):
- `ConvertAspectRatio` and `GetRatioFromList` build `gfx::SizeF(First().ComputeNumber(), Second().ComputeNumber())`. Each double part is narrowed to a float. Probed: a part beyond the float range becomes FLT_MAX (`1e40` computes to `3.40282e+38`).
- **`gfx::SizeF` zeroes tiny parts** (ui/gfx/geometry/size_f.h): its constructor stores `f > kTrivial ? f : 0`, where `kTrivial = 8 * FLT_EPSILON` = 2^-20 = 9.5367431640625e-7.
  - So `1 / 0.0000005` is stored as `1 / 0`, and Chrome computes it as `1 / 0`, which layout treats as auto. Probed: `0.00000095367432` computes to `0`, `0.0000009536744` to `9.53674e-07`, and `1e-6` to `1e-06`.
- **StyleAspectRatio keeps two forms** (core/style/style_aspect_ratio.h and .cc):
  - `ratio_`, the float pair, which only the computed value reads (longhands_custom.cc `AspectRatio::CSSValueFromComputedStyleInternal`);
  - `layout_ratio_ = LayoutRatioFromSizeF(ratio_)`, computed once in the constructor, which every layout path reads.
  - `GetType()` is `kAuto` when `layout_ratio_.IsEmpty()`. That is how a zero or zeroed part becomes auto.
  - The header comment states the reason: "Layout uses a fixed-precision representation of the aspect-ratio to reduce any floating point errors".

**The conversion: LayoutRatioFromSizeF** (platform/geometry/physical_size.cc):
1. Each float part becomes a `LayoutUnit(float)`: `part * 64`, computed in float, then truncated and saturated (layout_unit.h, `kFixedPointDenominator = 1 << 6`).
2. If both LayoutUnits convert back to their floats exactly, or either part is 0, the result is the two raw values. **This is the only source of "whole multiples of 1/64":** a part is kept as-is exactly when it is a whole number of LayoutUnits.
3. Else, if the parts are equal floats, the result is `LayoutUnit(1) / LayoutUnit(1)`.
4. Else, it runs a continued fraction in float, as follows.
   - Start from `initial = width / height`, a float division.
   - The convergents h/k are ClampedNumeric<int>, and `a = ClampFloor<int>(x)` at each step.
   - It runs at most 16 steps. It stops when x is not finite, when `|initial - float(h1) / k1| < 0.000001f`, or when h2 or k2 saturates.
   - Each step sets `x = 1 / (x - a)`, in float.
   - The result is the convergent itself used as **raw** LayoutUnit values (`FromRawValue(h1)`, `FromRawValue(k1)`). When h1 or k1 is 0, it is the truncated parts from step 1.
   - Examples: 3/3.4 gives 15/17; 0.7 gives 7/10; φ gives 1597/987; 1/π (3.14159265358979) gives 113/355.

**Layout: the integer layout ratio and MulDiv** (core/layout/length_utils.cc, platform/geometry/layout_unit.h):
- `ComputedStyle::LogicalAspectRatio()` (computed_style.h) maps `GetLayoutRatio()` to logical axes. `BoxSizingForAspectRatio()` follows box-sizing only for `kRatio` and uses content-box for `auto && <ratio>`.
- **`BlockSizeFromAspectRatio` and `InlineSizeFromAspectRatio`:**
  - with border-box sizing: `max(border_padding sum, size.MulDiv(ratio_to, ratio_from))`;
  - with content-box sizing: the border+padding sum of the given axis is subtracted first, then the other axis's sum is added after.
- **`FixedPoint::MulDiv(m, d)`** computes `int64(raw) * m.raw / d.raw`. C++ division truncates toward zero, and `FromRawValueWithClamp` clamps the result to int.
- The same two functions serve every caller: ComputeInlineSizeForFragmentInternal and ComputeBlockSizeForFragmentInternal (length_utils.cc), the transferred min/max (ComputeTransferredMinMaxInlineSizes/BlockSizes), the intrinsic contributions, block_node.cc ComputeMinMaxSizes, the flex base size (flex_layout_algorithm.cc), and the out-of-flow sizes (absolute_utils.cc).
  - None of them reads the float ratio. So in layout Chrome never multiplies by a float: the float arithmetic all happens once, in the conversion.
- **Device pixel ratio:** Chrome lays out in zoomed (device) px, so MulDiv runs on zoomed LayoutUnits. Dragon's engine already does the same (environment.ts applyEnvironment). The ratio itself has no unit and does not depend on zoom.

**Computed value:** the float parts, each to six significant digits. Probed: `1.23456789` computes to `1.23457 / 1`, `2.000005` to `2.00001 / 1` (its double alone would print `2`), `123.4565` to `123.456 / 1`, `1.0000005` to `1 / 1`, and `1 / 0.0000005` to `1 / 0`.

## Measured in Chrome 145 (the pinned headless shell, packages/parity/src/chrome.ts launchChrome)

The probe scripts were in /tmp/arat-probe (not committed).

- **Method:** each case gets its own absolute wrapper at (0, 0), so a large page offset does not round its getBoundingClientRect.
- **Dragon side:** the CSS goes through the real compiler and `iosLayoutProjection` with a whole placeholder ratio. The probe then replaces that box's `aspectRatio` with `layoutRatio(parts)` from units.ts, plus the SizeF clamp below, and runs the engine (`layout`, `absoluteRects`). The engine's zoomed LU are compared with Chrome's rect × DPR.
- **Matrix:**
  - **17 ratios:** 3/3.4, 1/1.5, 16/9.1, 0.7/1, 1/3.14159265358979, 1.23456789, 2.718281828/1.414213562, 1.618033988749895, 0.3333333333, 1/0.0000005, 0.0000005/1, 1/0.000001, 1/0.00000095, 1000000/1.7 and 1.0000005, plus the controls 3/4 and 16/9;
  - **5 sizes:** 100, 173.5, 333.33, 187 and 12.34 px;
  - **3 sizings:** content-box, border-box, and `auto && <ratio>` (with a box that has 3/5/7/2 px padding and 2/1/3/4 px borders);
  - **10 shapes:**
    - block, with the width given or the height given;
    - flex row, with the width given, the height given, or the cross size stretched;
    - flex column, with the width given;
    - grid, with the width stretched to the column or a height given under `justify-items: start`;
    - abspos, with the width given or the height given;
  - **4 DPRs:** 1, 2, 2.625 and 3;
  - **the shop card's real shape** at viewport widths 320, 360, 375, 390, 393, 412, 414, 430, 768 and 1024. At 768 and 1024 the probe inlined the ≥700px rules, because its harness does not select @media bands.
- **Result: 9,099 of 10,360 boxes equal Chrome to the 1/64 device px.** Every one of the 1,261 differences falls in a class below, and none is a ratio-conversion error:
  - **All 160 shop boxes are exact, at every width and DPR.** For example, at 390px wide each card is 173 css px wide. Its height is 196.0625 css px at DPR 1, and 392.125, 514.8125 and 588.1875 device px at DPR 2, 2.625 and 3.
  - **429 are the two huge ratios, 1/0.000001 and 1000000/1.7, outside grid.** Their transferred widths are 7.2 million px and more. A float rect cannot show 1/64 px there (float precision is 0.5 px or coarser), so the readback cannot judge them.
  - **764 are `grid` with a given height under justify-self start, for every ratio, the whole controls 16/9 and 3/4 included.** Dragon lays the item out at its border+padding width (12px) instead of the width transferred from the height. **This is a defect that already exists on master, independent of fractions:** a whole-ratio grid item in this shape compiles with no diagnostic in `enforce` mode and lays out wrong. The profiles' `aspect-ratio:<ratio>@grid/*` rows are proven only by replaced items (grid-replaced-items, grid-replaced-media, grid-replaced-markless), and the grid-aspect-ratio fixture covers a grid *container* with a ratio, not a grid item.
  - **68 are `grid` with a stretched width, border-box, where border+padding exceeds the ratio's height,** at the 12.34px column, or in any column for the two huge ratios. Chrome widens the item past its column, through the automatic minimum, and Dragon keeps the column width. This also fails for 16/9, so it too exists already, independent of fractions.
- **The SizeF clamp is needed.** Without it, units.ts `layoutRatio(1, 0.0000005)` returns 2000000/1, while Chrome lays out auto. With it, all four tiny-part ratios match in every non-grid shape.
- **Single nodes that tell the steps apart** (DPR 1, abspos, width given; each value is Chrome's and equals Dragon's):

  | ratio | width | Chrome height | if the step were different |
  |---|---|---|---|
  | 1.1875626880641925 | 111 / 148 / 185 px | 93.453125 / 124.609375 / 155.765625 | the continued fraction in double gives 1184/997, not 1165/981, and the exact quotient gives 93.46875 / 124.625 / 155.78125 |
  | 1 / 3.14159265358979 | 56.5 px | 177.5 | the exact quotient gives 177.484375 |
  | 1.618033988749895 | 240 px | 148.3125 | the exact quotient gives 148.328125; an 8-step cap gives 34/21, off at every probed size |
  | 3 / 3.4 | 100 px | 113.328125 | truncated parts (192/217) are off at every probed size |

- Note: `1 / 1.5` is already in the accepted subset (1.5 × 64 = 96), so today's path covers it.

## What Dragon does today

- **Parse** (css/values.ts `ratioValue`, from stylesheet.ts parseValue): `CssValue { kind: 'ratio', auto, width, height }`, whose parts are JS doubles. The parse matches Chrome (aspect-ratio.test.ts, 46 probed values).
- **Computed value** (analysis/computed.ts valueToString): `${width} / ${height}`, the double, not Chrome's six digits of the float.
- **Web output** (emit/web-css.ts): `cssNumber(width) / cssNumber(height)`, the authored double. Chrome re-parses it, so the web output is exact once the refusal is lifted.
- **The accepted subset** (css/values.ts `exactLayoutRatio`): steps 1 to 3 of LayoutRatioFromSizeF using only `* 64` and `Number.isInteger`.
  - The parts must be whole 64ths with raw values ≤ 2^24, so they are also exact as floats. Equal parts give 64/64, and a zero part is degenerate (auto).
  - Everything else returns null and is refused on every target (computed-checks.ts checkAspectRatio) and in the native lowering (lower/ios-layout.ts aspectRatio).
- **Why the subset, rather than a bug:** T050 §7 and its PM ruling.
  - The compiler core may import @dragon/layout **for types only** (test/ua.test.ts "dependency boundaries"; @dragon/layout is a devDependency of the published `dragon`).
  - `Math.fround` and the other rounding calls are banned in dragon/src outside named per-file exemptions (ua.test.ts and s4b.test.ts).
  - So the compiler cannot run the continued fraction, and the PM ruled "keep this fail-closed conversion; no exemption".
  - T050 named the follow-up: "the engine owns the conversion. The layout input carries the authored ratio parts as doubles, `layoutRatio` runs in the engine, and the inexact-ratio refusal goes away. It needs an input.ts change and a vector migration."
- **The engine already has the port, unused in layout:**
  - **units.ts `layoutRatio`** is LayoutRatioFromSizeF in float via Math.fround. It reproduces 41 of 42 Chrome heights (T050), and ratio.test.ts pins 12 of them. It lacks the SizeF clamp.
  - **units.ts `mulDiv`** is exact int64 MulDiv.
  - **ratio.ts** (`blockFromRatio`, `inlineFromRatio`, transferred min/max) and **replaced.ts** (`replacedAspectRatio`) read `style.aspectRatio.width/height` as raw LayoutUnits.
  - The translator already emits `units_layoutRatio` in Swift (Units.swift) and Kotlin (Units.kt), with `jsFround` for every float step.
- **The engine input** (input.ts `AspectRatioValue`) is `auto | { ratio | auto-ratio, width, height }`, with raw LayoutUnit parts. validate.ts requires positive integers ≤ INT_MAX.
  - **Vectors:** 28 vectors in packages/layout/vectors carry a non-auto ratio, times 4 DPR directories, so 112 files. corpus.ts and corpus-dpr.ts (packages/translate) draw raw ratios for about 10% of the random styles.

## Slice ARAT-1: the engine converts the authored parts, exactly as Blink does

One PR, with its regen in its own commit.

1. **Engine input** (input.ts, validate.ts):
   - `AspectRatioValue`'s `ratio` and `auto-ratio` arms carry the **authored `<number>` parts**, not raw LayoutUnits. The field names stay `width` and `height`; Q1 asks about renaming them.
   - The validator accepts finite, non-negative numbers. A form control still takes none.
   - The doc comment says the engine converts the parts as LayoutRatioFromSizeF does.
2. **Conversion** (units.ts `layoutRatio`): before step 1, a part at or below 2^-20 (`8 * FLT_EPSILON`, after the float narrowing) becomes 0, as gfx::SizeF does. Nothing else in the function changes.
3. **One accessor** (ratio.ts): `styleLayoutRatio(s): LayoutRatio | null` is `layoutRatio(width, height)` for a ratio arm and null for auto.
   - `hasAspectRatio`, `ratioInline` and `ratioBlock` read it.
   - replaced.ts `replacedAspectRatio` and `ratioBoxSizing` read it too, so a degenerate ratio is auto everywhere, as `GetType()` makes it in Chrome. flex.ts's `aspectRatio: { kind: 'auto' }` copy stays.
   - layout:subset must still report 0 violations, and native:gen re-emits Swift and Kotlin from the same TS. There is no hand-written native code.
4. **Compiler** (dragon/src):
   - lower/ios-layout.ts `aspectRatio` writes `{ kind, width, height }` straight from the CssValue. It lowers a zero part to auto, as now.
   - css/values.ts `exactLayoutRatio` is deleted, and its 8,000-input equality test with it.
   - computed-checks.ts checkAspectRatio drops the "inexact" refusal and keeps the size-keyword and percentage-block-size refusals.
     - The percentage refusal now applies beside any ratio whose parts are both non-zero. That also covers parts at or below 2^-20, which Chrome treats as auto, so for those Dragon refuses more than it must; it never refuses less. Q3 asks about this.
   - The web output needs no change.
5. **The computed value** (analysis/computed.ts): it serialises each part as Chrome does, six significant digits of the SizeF-clamped float. That needs one float narrowing in an exempt file (css/chrome-number.ts already is one). Q2 asks whether to do this, since no lane compares Dragon's own serialisation with Chrome's today: chrome-dual compares Chrome with Chrome.
6. **Migration:**
   - The 112 ratio vectors regenerate from their fixtures. Their inputs change from raw values to parts, for example 1024/576 becomes 16/9, and **their outputs stay byte-identical**.
     - The reason: for whole-64th parts, `layoutRatio(p, q)` is (64p, 64q), the same rational as the old raw pair. MulDiv truncates the same rational quotient, so it gives the same LayoutUnit.
   - scripts/check-aspect-ratio-migration.ts gains a mode that proves the following:
     - every changed vector differs only in `aspectRatio` parts equal to old raw / 64;
     - every output, line and other key is byte-identical;
     - the captures and emitted CSS are unchanged except for new fixtures.
   - corpus.ts and corpus-dpr.ts draw authored parts, including fractional ones, long decimals and parts at the 2^-20 boundary, so the native differential runs the continued fraction in Swift and Kotlin against TS.
7. **Chrome deviation:** css-sizing-4 §5.1 defines the ratio as the exact quotient, and Chrome uses an approximation in LayoutUnits. A `chrome-deviations.ts` entry `aspect-ratio-continued-fraction` registers the four nodes from the table above. Its fault `ratioExactSpec` (trunc of size × height / width) makes every registered node non-exact. Q4 asks whether to register it.

## Planted faults (EngineFaults, faults/*; each must fail the named cases and pass every other case)

- `ratioNoTrivialClamp`: skips the SizeF clamp. It must fail `sizing-ratio-fraction-edge` (1 / 0.0000005 and 0.0000005 / 1 lay out as auto in Chrome).
- `ratioDoubleFraction`: runs the continued fraction in double. It must fail 1.1875626880641925 at 111, 148 and 185 px.
- `ratioTruncatedParts`: uses `LayoutUnit(part)` raw values for every ratio (Blink's step 1 without steps 2 to 4). It must fail 3 / 3.4 and 16 / 9.1 in every shape.
- `ratioEightSteps`: caps the continued fraction at 8 steps. It must fail the golden-ratio cases.
- `ratioExactSpec`: the deviation entry's fault (item 7).
- `ratioRoundedMulDiv`: MulDiv rounds instead of truncating. It must fail 3 / 3.4 at a 173.5 px content-box width with no padding (Chrome gives 196.625, and rounding would give 196.640625), and it guards ratio.ts's call sites.
- native:planted runs the engine faults on both translated targets, as it does today.

## Parity fixtures (chrome-dual plus linux-dragon-layout; each `both(...)`, so ltr and rtl, and each also at DPR 2, 2.625 and 3 through parity:dpr-capture)

Every fixture body is Ahem, 10px, with margin 0. A ratio box that is not in flow sits at (0, 0) in an absolute wrapper, so no large offset rounds Chrome's rect.

- **`sizing-ratio-fraction-block`:**
  - 3/3.4, 16/9.1, 0.7, 1/3.14159265358979, 1.23456789 and 2.718281828/1.414213562;
  - widths 100, 173.5, 333.33 and 12.34 px with the height derived, and a given height with the width derived;
  - content-box, border-box and `auto && <ratio>`, with uneven padding and borders;
  - min-height and max-height transferred into the inline min/max.
- **`sizing-ratio-fraction-flex`:** a row with a given height, a row with a stretched cross size (a 60px container), and a column with a given width and a stretched width, for 3/3.4, 16/9.1 and 1.618033988749895.
- **`sizing-ratio-fraction-grid`:** the grid shape Dragon lays out right: the width stretched to fractional columns (`repeat(2, 1fr)` with a 12px gap in 358, 360.5 and 380 px containers), for 3/3.4, 16/9.1 and 0.7. The justify-self-start shape waits for the grid fix (Q5).
- **`sizing-ratio-fraction-abspos`:** the four distinguishing nodes from the table, plus height-to-width for 3/3.4 and 16/9.1.
- **`sizing-ratio-fraction-edge`:**
  - 1 / 0.0000005 and 0.0000005 / 1, laid out as auto, beside a `height: 40px` that wins;
  - 1 / 0.000001, kept with the transferred width under 262,144 px, so a float rect still shows 1/64 px;
  - 1.0000005 and 0.7 / 0.7, which give 1/1;
  - a part of 1e40 is not a fixture, because its transferred size saturates LayoutUnit and Chrome's float rect cannot show it.
- **`sizing-ratio-shop`:** the shop card copied from Markless f12707d7a: `main.content` > `ul.grid` > four `li.skeleton`, with the ≥700px @media rules.
  - It runs at viewport widths 360, 390, 412 and 768 (the 768 width proves the 4-column band). The fixture's environment sets the viewport, as other band fixtures do.
  - At DPR 1, 2, 2.625 and 3, through the DPR lanes.
- **Rejects:**
  - `reject-sizing-ratio-inexact` is deleted. That refusal no longer exists, and this deletion is the one test removed, with this reason.
  - `reject-sizing-ratio-percent-height` stays.
  - New: `reject-sizing-ratio-percent-height-fraction`, `height: 50%` beside `3 / 3.4`.

**Unit tests:**
- ratio.test.ts gains the probed heights of the four distinguishing nodes, the shop's 390px card at DPR 1 and 3, and the SizeF clamp at both sides of 2^-20 (`0.00000095367432` is degenerate, `0.0000009536744` is not).
- aspect-ratio.test.ts pins the lowered parts and the dropped refusal.

**Profiles:**
- **No new feature keys.** The fraction cases add proof cases to the existing `aspect-ratio:<ratio>@block|flex-*|grid|absolute-*` rows.
- The `<ratio>` rows that today rest on whole ratios gain fractional proofs. Q6 asks whether fractions deserve their own value subset.

## Refused after ARAT-1 (DRAGON_UNSUPPORTED_VALUE, every target)

- A percentage height, min-height or max-height beside a ratio whose parts are both non-zero, as today (validate.ts and the engine have no percentage basis for it).
- A calculation inside the ratio (`calc(1/2)`), as today.
- No ratio *value* is refused for being fractional, tiny or large. The engine converts them all as Blink does.

## Not in ARAT-1

- **The two grid-item defects** (a given height with justify-self start, and a narrow column where border+padding wins). They fail for whole ratios today and claim `exact` through replaced-item proofs. Q5 asks whether to refuse them now or fix them in a grid package.
- The media-query `aspect-ratio` feature (media/), which is unrelated.

## Size

The reviewed diff is about 45–55 KB, so this is **small** (under about 60 KB):
- **engine:** units.ts, ratio.ts, replaced.ts, input.ts, validate.ts and the fault plumbing, about 5 KB;
- **compiler:** values.ts, computed-checks.ts, ios-layout.ts and computed.ts, about 2 KB net, with code deleted;
- **tests:** about 10 KB;
- **the migration checker mode:** about 5 KB;
- **corpus.ts:** about 1 KB;
- **six fixtures and the group:** about 12 KB;
- **docs/ports.json entries** for the cited symbols: about 3 KB.

Vectors, captures, emitted CSS, profiles and generated Swift and Kotlin are on the .macroscope/ignore.md list.

## Markless's need, measured against ARAT-1

- **The shop's skeleton card:** exact against Chrome at every probed phone width and DPR, and at the 4-column tablet width. Both aspect-ratio refusals on shop `/` and `/categories/[slug]` go away. Other refusals on those pages are not measured here.
- **ProductCard.tsrx's `aspect-ratio: 4 / 3`** is a whole ratio and is unaffected.
- The PR body reports the shop pages' refusals before and after, through `pnpm run markless:style-export` on the shop's native style input, which Markless must export first.

## Open questions for the Judge

1. **The input field's meaning:** this spec changes `width`/`height` from raw LayoutUnits to authored parts in place. The vector outputs stay byte-identical, which the checker proves, but the inputs change by value, and docs/decisions.md's migration rule only covers adding a key. Alternatives:
   - rename the fields (`ratioWidth`/`ratioHeight`) so a stale reader fails loudly;
   - add new arms beside the raw ones (two forms forever).
   In-place is proposed.
2. **The computed serialisation:** fix computed.ts to Chrome's six digits of the clamped float, with the float narrowing in the exempt chrome-number.ts (proposed), or leave it, since no lane compares it?
3. **Tiny parts beside a percentage block size:** keep refusing a percentage block size beside any non-zero-part ratio (proposed, fail-closed). Or let the compiler decide degeneracy exactly: a part is zeroed exactly when it is ≤ 2^-20 + 2^-44, which is a comparison only, with no rounding call.
4. **The Chrome deviation entry:** register `aspect-ratio-continued-fraction` with `ratioExactSpec` (proposed), or treat the continued fraction as ordinary engine arithmetic pinned by ratio.test.ts?
5. **The grid-item defects found by this probe:** they are unrelated to fractions and already exist. Refuse both shapes on native now, in this PR or a separate small one, or leave the claim standing until a grid package fixes them? Proposed: a separate PR that refuses them by name, then a grid fix. The `aspect-ratio:<ratio>@grid` rows should gain a non-replaced proof either way.
6. **Profile keys:** fractional ratios share `aspect-ratio:<ratio>` (proposed), or get their own value subset (for example `<ratio-fraction>`), so a row's proofs show which conversion branch they cover?
7. **Order:** ARAT-1 lands as one PR (engine, compiler, fixtures, then the regen). Or the engine half (items 1–3, 6, 7 and the faults) first, then the compiler half, as T050 did? One PR is proposed, because the engine half alone changes no fixture.
