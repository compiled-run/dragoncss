# Engine value model (package V): design plan

This is design work from 2026-09-28. It is the first wave-2 engine package in docs/research/coverage-roadmap.md, and it lands after P4. Blink citations are to the 145.0.7632.6 source through the GitHub mirror (`raw.githubusercontent.com/chromium/chromium/145.0.7632.6/...`), because chromium.googlesource.com returned 503. Points marked **(verify)** get a dedicated engine vector before any code relies on them.

## 0. Findings that change the brief

1. **`rem` on native.** UNIT-a folds `rem` at text scale 1 on every target, native included (`feat-units`, `analysis/computed.ts` `computeLengths`). That breaks decision 5 on native. Until V2 lands, native rows for sizes that depend on `rem` should be `caveat` for any text scale other than 1.
2. **`em` precision.** UNIT-a's `em` fold can differ from Chrome in the last float bit at a fractional DPR.
   - Chrome computes `value * float(em_ * zoom)` (css_length_resolver.cc `kEms`) and stores a float Length.
   - Dragon computes `value * em` in double, then zooms.
   - V makes `em` an engine leaf. A brute-force search finds a (value, em, z) triple where the two orders truncate to different LU. That triple becomes a proving fixture and a planted fault.
3. **Floats.** `units.ts` is declared the only file that rounds or holds floats. All float calc arithmetic goes there as primitives, and `calc.ts` only composes them.
4. **`zoomInput`.** The P4 native host calls `zoomInput`. V replaces what it does inside, so the host call moves to the new pass. That is a P4-file change and must be sequenced.
5. **The translator.** It already supports a recursive `CalcExpr`: unions of named object types become protocols in Swift and sealed interfaces in Kotlin, and classes are reference types. Step 0 runs a probe to prove it. New string literals renumber `Strings.swift`, which is regenerated at merge.
6. **`validate.ts`.** Its `Infer<R>` scheme cannot infer a recursive type, so it needs a hand-written `calc` rule kind. validate.ts is exempt from the subset.
7. **WPT reality.**
   - css-values has only 9 numeric files, all blocked by scrollbars or overflow.
   - Across all of WPT, 99 numeric files use calc or runtime units, and V alone unblocks none. The ones with the fewest blockers also need GRID, SIZE, INL1 or ANCH.
   - V's direct WPT value is therefore reftests, once a reftest lane exists, and `test_computed_value` testharness files, once the importer has a computed-value mode (§5).

## 1. Value types (packages/layout/src/input.ts)

### 1.1 One recursive expression type, in two phases

The compiler emits **CSS-level** trees: Blink's parse-time simplification is already applied, and leaves keep their own units. The environment pass (§2.1) rewrites them into **Blink CalculationExpression shape**. Only nodes that resolve at layout time survive that pass.

```ts
export type CalcPx = { readonly kind: 'px'; readonly value: number };
export type CalcPercent = { readonly kind: 'percent'; readonly value: number };
export type CalcNumber = { readonly kind: 'number'; readonly value: number };
export type ViewportLength = { readonly kind: 'viewport'; readonly value: number;
  readonly axis: 'width' | 'height' | 'min' | 'max'; readonly size: 'small' | 'large' | 'dynamic' };
export type RootFontLength = { readonly kind: 'rem'; readonly value: number };
export type EmLength = { readonly kind: 'em'; readonly value: number; readonly fontSize: CalcExpr };
export type FontMetricLength = { readonly kind: 'font-metric'; readonly value: number;
  readonly metric: 'ex' | 'ch' | 'cap'; readonly font: FontSpec };
export type LineHeightLength = { readonly kind: 'lh'; readonly value: number; readonly font: FontSpec;
  readonly lineHeight: LineHeightValue };
export type EnvLength = { readonly kind: 'env'; readonly name: 'safe-area-inset-top' | 'safe-area-inset-right'
  | 'safe-area-inset-bottom' | 'safe-area-inset-left'; readonly fallback: CalcExpr | null };
export type CalcSum = { readonly kind: 'sum'; readonly terms: readonly CalcExpr[] };
export type CalcProduct = { readonly kind: 'product'; readonly terms: readonly CalcExpr[] };
export type CalcInvert = { readonly kind: 'invert'; readonly term: CalcExpr };
export type CalcMin = { readonly kind: 'min'; readonly terms: readonly CalcExpr[] };
export type CalcMax = { readonly kind: 'max'; readonly terms: readonly CalcExpr[] };
export type CalcClamp = { readonly kind: 'clamp'; readonly min: CalcExpr; readonly value: CalcExpr; readonly max: CalcExpr };
export type PixelsAndPercent = { readonly kind: 'pixels-and-percent'; readonly pixels: number; readonly percent: number;
  readonly explicitPixels: boolean; readonly explicitPercent: boolean };
export type CalcExpr = CalcPx | CalcPercent | CalcNumber | ViewportLength | RootFontLength | EmLength | FontMetricLength
  | LineHeightLength | EnvLength | CalcSum | CalcProduct | CalcInvert | CalcMin | CalcMax | CalcClamp | PixelsAndPercent;
export type FontSpec = { readonly family: 'Ahem'; readonly size: CalcExpr };
```

- **Font sizes are expressions,** because text scale makes them runtime values:
  - px becomes `CalcPx`;
  - `em` becomes a product of the value and the parent's expression;
  - `%` becomes a percent-of-parent product;
  - `rem` and the root's own size become a `rem` leaf.
- **Anchor positioning** later adds `AnchorQuery` and `AnchorSizeQuery` members. These replace `AnchorLength` in anchor-positioning-plan.md §1.1, whose sum and product nodes are exactly `CalcSum` and `CalcProduct`, and its `anchorExprUnzoomed` fault is subsumed by `calcLeafUnzoomed`.
- **Container queries** later add a container leaf.

### 1.2 Per-family wrappers (the translator refuses generics)

There is one wrapper: `LengthCalc = { kind: 'calc'; expr: CalcExpr; range: 'all' | 'non-negative' }`. Blink clamps a non-negative range to 0 after evaluating.

| Family | Members after V | Range | Notes |
|---|---|---|---|
| `SizeValue`, `MinSizeValue` | Px, Percent, Auto, LengthCalc | non-negative | SIZE adds intrinsic keywords; ANCH adds anchor-size |
| `MaxSizeValue` | Px, Percent, None, LengthCalc | non-negative | |
| `MarginValue` | Px, Percent, Auto, LengthCalc | all | |
| `PaddingValue` | Px, Percent, LengthCalc | non-negative | |
| `InsetValue` | Px, Percent, Auto, LengthCalc | all | ANCH adds anchor() |
| `FlexBasisValue` | Px, Percent, Auto, Content, LengthCalc | non-negative | |
| `GapValue` | Px, Percent, Normal, LengthCalc | non-negative | % keeps the `percent-gap` refusal |
| `BorderWidthValue` | Px, DevicePx, LengthCalc (no %) | non-negative | resolved to Px in the pass, then `snapBorderWidth` |
| `LineHeightValue` | Normal, Number, Px, LengthCalc | non-negative | a calc of numbers only folds to Number; mixing number and length is refused |
| `TextLeaf.font` | `FontSpec` (V2) | non-negative | |

- Numbers (`flex-grow`, `flex-shrink`, `order`) accept only constant calc, folded by the compiler.
- Still refused with reasons: typed arithmetic, `round()`/`mod()`/`rem()`/`abs()`/`sign()`, trigonometric functions, `progress()` and `random()`.

### 1.3 Explicit environment input (never hidden state)

```ts
export type Insets = { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
export type ViewportSizes = { readonly small: Viewport; readonly large: Viewport; readonly dynamic: Viewport };
export type LayoutInput = {
  readonly viewport: Viewport; readonly devicePixelRatio: number;
  readonly viewportUnits: ViewportSizes;   // CSS px, before the R1 device ceil
  readonly safeArea: Insets;               // CSS px
  readonly rootFontSize: number;           // CSS px after host text scaling (V2)
  readonly root: LayoutBox;
};
```

Every vector input gains these fields while every output stays byte-identical. That needs a D2-style ruling.

## 2. Resolution rules and Chrome rounding

### 2.1 Three resolution times

| When | What | Where |
|---|---|---|
| Compile | Parse-time simplification; absolute units to px (UNIT-a ratios, in Blink's order); vi/vb to width/height; logical keywords; constant number calc; the structure of em and font-size | css/math.ts (new), computed.ts, lower/ios-layout.ts |
| Device and environment | Each leaf becomes zoomed px as `ZoomedComputedPixels` computes it, then `ToPixelsAndPercent`/`CreateSimplified`. A tree with no percent folds to `Px`; otherwise it stays `LengthCalc` in Blink shape | new `environment.ts`, which replaces `zoomInput`; runs once per layout and again on every environment change |
| Layout | `CalculationValue::Evaluate(max_value)` against the percent basis, and later anchors | box.ts helpers used by block, flex, position and intrinsic |

**Parse-time simplification** mirrors `CSSMathExpressionOperation::CreateArithmeticOperationSimplified`:
- same-unit literals are summed in double, and compatible absolute units are merged into px;
- `calc(10px + 1em)` stays a sum;
- an explicit `0%` is kept;
- a calc nested inside a calc is flattened.

Chrome-dual computed-value strings prove the tree shape.

### 2.2 Leaf values at zoom z (css_length_resolver.cc, css_to_length_conversion_data.cc)

Each leaf value is a double, cast to float per leaf.

- **Viewport units.**
  - `vw` = `value * (W/100) * z`, where `W = float(ViewWidth / z)` and `ViewWidth` is in whole device px (local_frame_view.cc).
  - **R6** is therefore `W_f = fround(ceil(w*z)/z)`, then `(value * (W_f/100)) * z`.
  - `vmin`/`vmax` take the min or max of W and H before dividing.
  - Large = small plus browser controls. Headless Chrome has none, so small, large and dynamic are equal in every capture.
- **`rem` and `em`.** `rem` = `value * float(rootSpecified * z)` and `em` = `value * float(specified * z)`. Both use the specified size, so the minimum font size does not apply.
- **`ex`, `ch` and `cap`** = `metric / font_zoom * z`, in float.
  - The metric comes from the primary font instance, created at `trunc(float(size*z)*100)/100`.
  - `x/z*z` in float may not round-trip exactly, so a vector pins it.
  - Ahem metrics: x-height and cap height are 0.8em, and the zero width is 1em. Whether macOS rounds `XHeight` is **(verify)**.
  - A missing x-height falls back to `em/2`.
- **`ic`** stays refused until real-font text lands, because its value comes from platform font fallback.
- **`lh`** = `ComputedLineHeight / font_zoom * z` (computed_style.cc, around line 2889):
  - a number or percentage line-height truncates the zoomed font size to 1/64 (`LayoutUnit(float)`, not R3's `FromFloatRound`), then applies the percent rounding;
  - a px line-height is its float value, unsnapped;
  - `normal` is `round(ascent) + round(descent) + round(lineGap)` at the instance size.
- **`env()` safe areas** are the inset in CSS px times z. They are 0 on the Chrome oracle.
- **Font-size conversions** use zoom 1. The computed size is `float(specified * z)`. Whether this holds for `vw` in font-size is **(verify)**.
- **Summation.** Each leaf is converted to float `PixelsAndPercent`, and sums accumulate in float `+=`. The exact order is **(verify)**, pinned by vectors.
- **Constant calc with no percent** goes through `ComputeLength` in double, then becomes a float `Length::Fixed` **(verify)**. Vector: `calc(0.1px + 0.2em)` at z = 2.625.

### 2.3 Layout-time evaluation (all float)

- **PixelsAndPercent** evaluates as `pixels + percent / 100 * max_value`. This is a different order from the plain-percent path, `LayoutUnit(float(max * pct / 100.0f))` (length_functions.cc lines 59-83). A fixture proves the difference.
- **`Evaluate`** clamps the result to float range, applies the non-negative clamp to 0, and turns NaN into 0. The result is `LayoutUnit(float)`, which truncates and saturates.
- **Arithmetic.** Add and multiply fold left to right in float. Division is `a * (1/b)` **(verify)**.
- **`min`/`max`** are `std::min`/`std::max` in order.
- **`clamp`** = `max(MIN, min(VAL, MAX))`, so MIN wins when MIN > MAX.
- **Nested `min`/`max`** with no percent fold to px in the pass. Otherwise they stay as nodes.

### 2.4 Calc with a percentage (any explicit percent, including 0%)

- **Indefinite basis:**
  - `height` becomes auto;
  - `min-height` becomes 0;
  - `max-height` becomes none;
  - `top` and `bottom` follow the existing inset rule;
  - `flex-basis` becomes content;
  - the flex-dependent case keeps the `percent-height-flex` refusal.
- **Intrinsic contributions:**
  - a percent-bearing `width`, `min-width` or `max-width` is ignored;
  - padding and margin evaluate with basis 0, so `calc(10px + 5%)` contributes 10px **(verify)**.
- **One predicate,** `hasPercent(v)`, replaces every `v.kind === 'percent'` test of indefiniteness. It sits behind shared `resolveLength` and `resolveLengthOrNull` helpers in box.ts.

### 2.5 Registries

- **R6** (the viewport device ceil) goes in the platform-rule registry. Sources: local_frame_view.cc; `SubtractUnconditionalScrollbarsFromViewportUnits` in layout_view.cc, which is a no-op with overlay scrollbars.
- **If `vw` is not ICB/100 at DPR 2.625,** a DPR deviation `viewport-units-device-ceil` is registered with the fault `viewportUnitsUnceiled`.

## 3. Runtime inputs and re-layout

- **`LayoutInput` carries** viewport, `viewportUnits` (small, large, dynamic), `safeArea`, `rootFontSize` and `devicePixelRatio`. The engine reads nothing else.
- **`environmentDependencies(input)`**, translated to native, returns which inputs the tree reads, so the host re-lays out only when one of those changes.

| Change | iOS | Android |
|---|---|---|
| Size | `layoutSubviews`, `viewWillTransition(to:)` | `onSizeChanged` |
| Safe area | `safeAreaInsetsDidChange` | `OnApplyWindowInsetsListener` (system bars plus display cutout) |
| Text size | `UIContentSizeCategory.didChangeNotification` / `traitCollectionDidChange` | `onConfigurationChanged` (`fontScale`) |
| Scale | `displayScale` trait | `densityDpi` |

- **Native small, large and dynamic viewports** are all equal to the root view bounds. The keyboard does not resize them, which matches Chrome's `interactive-widget=resizes-visual` default.
- **Text-scale semantics** need an owner ruling. The recommendation: the device text size acts as the root element's computed font size, so every `rem` and every `em` chain from the root follows it, and px font sizes do not.
  - iOS: `UIFontMetrics.default.scaledValue(for:)`.
  - Android: `TypedValue.applyDimension(COMPLEX_UNIT_SP, …)/density`, which is non-linear on API 34+.
  - This reading has an exact Chrome oracle: inject `:root{font-size:<scaled>px !important}` when capturing.

## 4. Compiler changes

- **`css/math.ts` (new):**
  - parses calc, min, max and clamp;
  - checks types per css-values-4 §10.9;
  - applies Blink's parse-time simplification;
  - serialises as Chrome does, for chrome-dual.
- **`css/values.ts`:**
  - gains a `math` CssValue;
  - gains feature keys `<calc()>`, `<min()>`, `<max()>` and `<clamp()>` per property.
- **`css/units.ts`:**
  - gains the kinds viewport, root-font, font-metric and line-height;
  - `mathFunctionRefusal` narrows to the functions still refused;
  - container units and `ic`/`ric` stay refused.
- **`analysis/computed.ts`:**
  - folds only absolute units;
  - keeps em, rem and runtime units as values;
  - makes font-size an expression;
  - `lh`/`ex`/`ch` inside `font-size` and `line-height` read the parent's font.
- **`lower/ios-layout.ts`:**
  - `pxOrPercent` becomes `lengthPercentage(…, range)`;
  - gains `fontSpec()` and calc border widths;
  - fills the environment from `Environment` in internal.ts, a P4 file.
- **The native program's `font` write** is resolved by the engine.
- **Web output** keeps math functions and units verbatim.

## 5. Proof plan

**Engine tests** (`packages/layout/test/calc*.test.ts`): golden float evaluations of every §2 rule, run in Swift and Kotlin through the translator's differential corpus. They include:
- percent-order pairs;
- a/b compared with a*(1/b);
- clamp with MIN > MAX;
- NaN and infinity;
- the finding-2 `em` case;
- `x/z*z` for ex and lh at z = 2.625.

**Parity fixture group `values`**, at DPR 1 and the DPR lane (2, 3, 2.625), in ltr and rtl:
- **calc fixtures:**
  - `calc-width-px-percent`, `calc-percent-order`, `calc-nonneg-clamp`;
  - `calc-margin-negative`, `calc-padding-percent`, `calc-inset-abspos`, `calc-relative-offsets`;
  - `calc-flex-basis-{definite,indefinite}`, `calc-height-{definite,indefinite}`, `calc-zero-percent-height`, `calc-min-max-height-indefinite`;
  - `calc-divide`, `calc-multiply`, `calc-nested-min-max`, `clamp-min-wins`, `min-max-many-args`;
  - `calc-intrinsic`, `calc-border-width-vw`, `calc-line-height`, `calc-font-size`, `calc-gap-px`, plus a reject for % in gap.
- **Unit fixtures:**
  - `rem-{16,10px-root,62.5%}`, `em-chain-fractional`;
  - `lh-{normal,number,px,percent}` and `rlh`;
  - `ex`, `ch` and `cap` at 10.625px;
  - `env-safe-area`, only if CDP in Chrome 145 can override the safe area **(verify)**; otherwise engine vectors only.
- **Viewport fixtures:** `FixtureSpec` gains a `viewports` list. Sizes are 400×300, 390×844, 393×851 (which exercises R6 at 2.625), 412×915, 320×568 and 844×390 (landscape, which flips vmin and vmax).
- **Text-scale runs.** Chrome is captured with a root-size override from a pinned table:
  - iOS content-size categories xS through AX5 for 17pt body text;
  - Android fontScale 0.85, 1.0, 1.3 and 2.0, through the API 34 converter.

  The P5 device lanes add a largest-text-size run, and the host reports its `rootFontSize`.
- **Rejects:** container units, `ic`, typed arithmetic, number mixed with length, `round()`/`mod()`, and calc with % in gap.
- **Chrome-dual:** the computed-value strings of every math fixture must match.

**WPT css-values tests unblocked:**
- **Reftests** (need a reftest lane):
  - calc-in-calc, calc-in-max, calc-parenthesis-stack, max-20-arguments, max-unitless-zero-invalid;
  - calc-offsets-{absolute,relative}-{left,right}-1;
  - vh-support, vh-support-margin, vh-zero-support, vh-calc-support, vh-calc-support-pct, vh-em-inherit, vh-inherit.
- **One package away:**
  - calc-width/height/min/max-*-block-1: need `<p>`, `float` or text;
  - lh-unit-001/002 and rlh-unit-001: need `<p>`, `<strong>` or XHTML;
  - percentage-rem-low and calc-rem-lang: need text.
- **Computed-value testharness files** (need an importer mode for them):
  - minmax-length-computed, minmax-length-percent-computed, clamp-length-computed;
  - calc-numbers, calc-catch-divide-by-0, calc-nesting(-002);
  - getComputedStyle-calc-mixed-units-001..003;
  - viewport-units-compute, viewport-units-css2-001, viewport-units-parsing;
  - font-relative-length, rem-unit-root-element, rlh-on-root-lengths, lh-unit-005, update-subpixel-rem-unit.
- **Blocked on scrollbars:** viewport-units-gutter-001..008 and viewport-units-scrollbars-mq-001.

**Planted faults:**
- **Engine:**
  - `calcPercentPlainOrder`, `calcDoubleEval`, `calcNoNonNegClamp`, `calcPercentIndefiniteAsLength`;
  - `clampMaxWins`, `divideDirect`, `calcLeafUnzoomed`, `viewportUnitsUnceiled`;
  - `emFoldedAtCompile`, `lhUnsnapped`, `exUntruncatedFontSize`, `rootFontSizeIgnored`, `safeAreaIgnored`.
- **Compiler:** `dropExplicitZeroPercent`, `sumOrderSwapped`.

## 6. Write scope, order and risks

**Scope:**
- **Engine:**
  - `packages/layout/src/{input,units,validate,layout,box,flex,position,intrinsic}.ts`;
  - new `calc.ts` and `environment.ts`;
  - registry entries.
- **Tests:** `packages/layout/test/calc*.test.ts`.
- **Vectors:** every input gains the environment fields, and every output stays byte-identical.
- **Generated files:** regenerated `generated/**`.
- **Translator:** a probe test only.
- **Compiler:**
  - `css/{math,values,units}.ts`;
  - `analysis/computed.ts`;
  - `lower/ios-layout.ts`;
  - `internal.ts`, for `Environment`.
- **Parity:** the `viewports` field, `fixture-groups/values.ts` and the fixtures.

The call-site edits in box, flex, position and intrinsic must land before SIZE, ALGN and GRID start.

**Order:**
1. Wait for P4 to be accepted.
2. **V1:** calc, viewport units, env and the em leaf, with no text.ts or inline.ts edits. This unlocks SIZE, ALGN, GRID and INL1.
3. **V2:** `FontSpec` expressions, `rootFontSize`, and ex, ch, cap and lh.
   - It touches `TextLeaf` (inline.ts) and `FontMetrics` (text.ts).
   - It comes after P5's text export and before INL1.
   - It also moves the host's `zoomInput` call and the `font` write.
4. **ANCH:** additive anchor leaves.
5. **MQ:** `@media` conditions over the same environment inputs.
6. **CQ:** the container leaf.

**Rulings needed:**
1. The vector input format change.
2. Text-scale semantics.
3. The em-leaf change to UNIT-a outputs, and the interim native caveat for `rem`.
4. Extending "floats only in units.ts" to the calc primitives.
5. The scope expansion above.
6. The native small, large and dynamic viewport policy.

**Risks:**
1. The **(verify)** points. Each gets a dedicated vector before code relies on it.
2. The Chrome oracle cannot show small, large and dynamic viewport differences or nonzero safe areas. Native behaviour there rests on engine vectors and the device lane.
3. Non-linear host text scaling can drift across OS versions. Mitigation: a pinned table plus a device check.
4. Churn in generated union names and `Strings.swift` as ANCH and CQ add members.
5. Recursion in validate.ts inference and in the translator. The step-0 probe covers the translator.
6. Serial ownership of text.ts and inline.ts (P4, then P5, INL1 and TXT1) can stall V2.
7. `ic`, and real-font ex and ch, depend on TXT1's native metrics path.
