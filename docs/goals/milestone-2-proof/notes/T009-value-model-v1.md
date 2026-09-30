# T009 V1 engine value model: Phase A

Worker, 2026-09-28. Worktree /tmp/dragon-v, branch v1-value-model, BASE 12af7cb. Binding spec: notes/T006-value-model-spec.md §3-§4, with the PM rulings of 2026-09-28:
- the two unit rejects are retargeted;
- verify 5 is restated;
- notes stay off the branch;
- the throughput and decision rules apply.

No simulator or emulator was booted. Phase B (device lanes, break and pixel data) is not started.

## What landed

**Engine (packages/layout/src)**
- `input.ts` adds the recursive `CalcExpr` and `LengthCalc`, which joins every length family except LineHeightValue and font size.
  - Leaves: px, percent, number, viewport, em.
  - Nodes: sum, product, invert, min, max, clamp, and pixels-and-percent.
- `environment.ts` (new) is the environment pass, which `zoomInput` calls at every DPR.
  - It takes over the zoom walk from layout.ts. The `zoomInput(input, faults)` signature is unchanged.
  - It resolves each calculation as Blink does:
    - no percentage: evaluated in double, stored as a float px (`ComputeLengthPx`, then `Length::Fixed`);
    - percentage only: becomes a percentage;
    - otherwise: `ToPixelsAndPercent`, or `ToCalculationExpression` with `CreateSimplified`, plus the NaN and infinity clamp.
- `calc.ts` (new) evaluates at layout in float (`CalculationExpressionNode::Evaluate`) and applies the non-negative clamp.
- `units.ts` holds every float and double primitive, including R6 `viewportUnitBase`. calc.ts and environment.ts do no arithmetic of their own.
- `box.ts` adds `hasPercent`, `resolveLength`, `resolveLengthOrNull` and `resolveMinLength`, used at every call site in block, flex, position and intrinsic.
  - The fault-aware forms are the `*With` helpers.
  - The original exported signatures stay as no-fault wrappers, because the native hosts call `box_resolvePadding`.
- `validate.ts` gets a hand-written recursive `calc` rule.
- `block.ts` appends the 8 engine faults.
- `platform-rules.ts` adds `dprPlatformRules` with R6 `viewport-device-ceil`.

**Compiler (packages/dragon/src)**
- `css/math.ts` (new) is a port of Blink 145's parser, covering:
  - `CreateArithmeticOperationSimplified`, `MaybeDistributeArithmeticOperation`, `MaybeSimplifySumOrProductNode`, `CreateInvertFunction` and `CreateComparisonFunction`;
  - type checks, refusals, the lowering to `CalcExpr`, and Chrome serialization, including the computed form rebuilt from a CalculationValue.
- `css/values.ts`:
  - a length calc stays `other` with feature keys `<calc()>`, `<min()>`, `<max()>` and `<clamp()>`, so web output stays verbatim;
  - a number calc (flex-grow, flex-shrink, order, and the flex shorthand) is folded;
  - a refused calc carries its reason.
- `css/units.ts`: vw, vh, vi, vb, vmin and vmax become `viewport` conversions. sv, lv and dv units carry a V2 reason, and `mathFunctionRefusal` now lists only round, mod, rem, abs, sign and env.
- `lower/ios-layout.ts`:
  - `lengthPercentage` lowers viewport units and calculations;
  - em takes the element's specified size and rem the root's, at text scale 1 (decisions.md, Text scale);
  - border-width calculations are lowered.
- `faults.ts` appends `sumOrderSwapped` and `dropExplicitZeroPercent`.
- `emit/native-support.ts` gets an additive encoder for `LengthCalc` and `CalcExpr`.

**Parity**
- The `values` group has 25 layout fixtures (every one in ltr and rtl) and 11 rejects, all named `values-*`.
- The goldens are `packages/layout/vectors/calc/*.json`: 17 engine vectors, one or more per (verify) point.

## Chrome and Blink evidence for the (verify) points

Blink sources were read from the GitHub mirror at 145.0.7632.6:
- css_math_expression_node.cc, css_math_function_value.cc, css_length_resolver.cc, css_to_length_conversion_data.cc/.h;
- calculation_value.cc, calculation_expression_node.cc, length.h, length_functions.cc;
- length_utils.cc, local_frame_view.cc, layout_view.cc, style_builder_converter.cc, css_primitive_value.cc, css_value_clamping_utils.cc.

Every values case matches Chrome exactly at 1/64 px, at DPR 1, 2, 3 and 2.625, in both directions (values.test.ts reads the committed captures).

| Point | Blink | Chrome proof |
|---|---|---|
| Summation order | binary `+=` of float PixelsAndPercent, left to right | values-calc-sum-order a/b/c (with 0%), 4 DPRs; `sumOrderSwapped` breaks them |
| Constant calc | double `ComputeLengthPx`, then float | values-calc-sum-order g/h (no %) and values-calc-width-vw-em c at 2.625 (`calc(0.1px + 0.2em)`) |
| a / b | the parser folds `1/b` in double; ToPixelsAndPercent multiplies by float(1/b) | values-calc-divide b (`min(41.1%, 500px) / 3` in 125px: 1096 LU, a direct division gives 1095) |
| Percent order | `pixels + percent/100*max` in float, not the plain order | values-calc-percent-order a (3767 LU against 3768) |
| R6 | `ViewWidth(int)/zoom` as float, times `value * (V/100) * z` | values-viewport-units at 2.625 (all 7 nodes non-exact without R6) |
| em leaf | `value * float(specified * z)` | values-calc-em-fractional at 3 (`calc(6.25em)` at 13.33px: 15995 LU, the compile-time fold gives 15996) |
| clamp MIN > MAX | `max(MIN, min(VAL, MAX))` | values-clamp-min-wins a |
| Intrinsic with % | padding and margin against basis 0 | values-calc-intrinsic k |

One finding contradicts the plan (§2.4), and Blink and Chrome agree with each other on it. A min-height with a percentage against an indefinite basis resolves against 0; it does not become 0. Blink `ResolveBlockLengthInternal` kMin sets `percentage_resolution_size = 0`, so `calc(30px + 10%)` is 30px. Chrome shows this on values-calc-min-max-height-indefinite b. The engine does the same in `resolveMinLength`, for blocks and flex items.

Engine-only goldens: the 393x851, 320x568 and 844x390 viewports (spec §3 item 5), plus NaN and infinity.

The computed-value strings of every calc min-width, max-width, min-height, max-height and flex-basis in the values fixtures equal math.ts's serialization of the resolved engine value (values.test.ts, 12 or more compared). For width, margin, padding and insets, getComputedStyle returns used px, so chrome-dual compares boxes and those strings exactly (parity:report: dual values 412064/412064).

## Planted faults (values.test.ts; engine goldens in calc.test.ts)

Each fault fails at the DPR listed, in both directions. "exact" means the nodes stay inside the 1 px gate but are not exact at 1/64 px, which the DPR lane refuses.

| Fault | Fixture | DPR | Failure kind | Nodes |
|---|---|---|---|---|
| `calcPercentPlainOrder` | values-calc-percent-order | 1 | exact | a, d, e, a2, d2, e2 |
| `calcDoubleEval` | values-calc-percent-order | 1 | exact | a, d, e, a2, d2, e2 |
| `calcNoNonNegClamp` | values-calc-nonneg-clamp | 1 | gate | p, k, w, m, q |
| `calcPercentIndefiniteAsLength` | values-calc-zero-percent-height | 1 | gate | z, zz |
| `clampMaxWins` | values-clamp-min-wins | 1 | gate | a |
| `divideDirect` | values-calc-divide | 1 | exact | b |
| `calcLeafUnzoomed` | values-calc-em-fractional | 3 | gate | a, b, c, d |
| `viewportUnitsUnceiled` | values-viewport-units | 2.625 | exact | a-g |
| `sumOrderSwapped` (compiler) | values-calc-sum-order | 1 | exact | a, b, c |
| `dropExplicitZeroPercent` (compiler) | values-calc-zero-percent-height | 1 | gate | z |

## Retargets (PM throughput rule 1)

1. `reject-unit-vw`: `width: 50vw` becomes `50svw`. The prefix "width: 50svw is unsupported: small, large and dynamic viewport units" keeps a named viewport refusal.
2. `reject-unit-calc`: `calc(10px + 2em)` becomes `round(10px, 3px)`. The prefix "width: round(10px,3px) is unsupported: round() is a css-values-4 stepped-value function" keeps a named math-function refusal.
3. Positive coverage for the two old values:
   - `values-calc-width-vw-em` holds `50vw` and `calc(10px + 2em)`;
   - `values-viewport-units` holds `50vw`.
4. `packages/dragon/test/units.test.ts`:
   - the refusal lists now use sv/lv/dv units and round, mod, rem, abs, sign and env;
   - new acceptance tests cover vw, vh, vi, vb, vmin and vmax and calc, min, max and clamp, with the lowered calc shape;
   - the "refused unit" diagnostic test uses `50svw`.
5. `packages/layout/test/dpr-vectors.test.ts`: the directory pin adds `calc` for the goldens.
6. `packages/translate/test/corpus-dpr.test.ts`:
   - the suite-name pin appends `snap-values`, `calc-goldens`, `engine-calc` and `units-calc`;
   - the vectors-m2 check now asserts the values vectors come last;
   - the snap size is derived without the values vectors, which `snap-values` reads.
7. `packages/translate/test/native-dpr-swift.test.ts` and `native-dpr-kotlin.test.ts`: the expected suite list appends the four V1 suites, each asserted all-pass.
8. `packages/parity/test/lanes.test.ts`: every suite declared by the protected targets.ts must still equal its lock count; the lock's only other suites must be exactly the four V1 suites.
9. `packages/parity/test/parity.test.ts`, determinism (S5 (c)):
   - every assertion is unchanged; only the time budget moves, from vitest's 120 s default to `max(120 s, 1 s per fixture)`;
   - the loop compiles and runs every fixture again, and 36 new fixtures take it past 120 s;
   - compilation is not slower: HEAD compiles its 231 fixtures (462 compiles) in 33.5 s, BASE its 195 in 40.9 s;
   - BASE already timed out under full-suite load, though it passes alone;
   - the PM may prefer another budget.

## Decisions (PM rule 2), with evidence

1. **Verify 5 corpus shape.** The protected parity `targets.ts` derives declared suite sizes from every layout case:
   - `vectors-m2` is every non-M1 top-level case;
   - `vectors-dpr` is every DPR case;
   - `engine-dpr` is the layout cases times the DPR sets.

   So `parity:lanes` (verify 13) cannot pass with those suites frozen. `corpus-dpr.ts` therefore appends the values vectors after every earlier line of vectors-m2, vectors-dpr and engine-dpr, per DPR block too, and pins the engine-dpr fault draw to the pre-V1 fault list.

   Checked by a stripped comparison with a BASE dump of every suite:
   - every BASE line of every pre-existing suite is unchanged in place once the 8 false V1 fault keys are removed;
   - every result is identical;
   - vectors, units, engine, library, units-m2 and snap keep their line counts;
   - vectors-m2 grows 64 to 114, and vectors-dpr and engine-dpr 966 to 1116, by appended lines only.

   The values snap vectors get their own suite, `snap-values`, because snap's generated lines follow its vector lines. The new suites are snap-values, calc-goldens (17), engine-calc (4000 generated calc trees at every DPR, drawn over all faults) and units-calc (50000).
2. **Refusal reasons.** The math refusal carries its reason through the profile check, since stylesheet.ts is not in allowed_files. The message is `<property>: <text> /* <reason> */ is unsupported (support profile ...)`.
3. **Border shorthands.** A calc inside a border shorthand is refused with a named reason, because the shorthand would assign it to the colour. The border-*-width longhands take calc.
4. **em and rem inside calc.** The fontSize leaf is the element's specified px, or the root's for rem at text scale 1. Plain em and rem outside math functions keep UNIT-a's fold (spec §3 item 3).
5. **R6 registry.** R6 is registered as `dprPlatformRules` in platform-rules.ts rather than as a DPR Chrome deviation: the spec reading does not differ, Chrome's window rounding does. Its planted fault is `viewportUnitsUnceiled`.

## Deviations

- Engine exports: the fault-aware length helpers are `*With` (resolvePaddingWith, resolveMarginWith, inlineMinMaxWith, specifiedBlockSizeWith, blockMinMaxWith, resolveInlineLengthWith, resolveMaxInlineLengthWith, relativeOffsetWith). The originals keep their exported signatures and delegate with no faults. `resolvePadding` stays reachable for the translator, which the native hosts need.
- Native case sources: every pre-existing case (322 on each target) is identical to BASE apart from its `compilerDigest` field, which is the compilation digest, like the relaxed emitted CSS header.
- Generated engine temp names renumber (`_a14` becomes `_a24`) in unchanged files such as Inline.swift, because the lowering counter is global. native:gen regenerates them at merge.
- Emitted CSS: 224 files changed in the header line only; 0 body differences.
- `packages/wpt/reftest-captures/css/css-values/*` (5 new files): `wpt:update-expectations` writes them with the expectations, and they back the 5 new reftest-layout passes. `wpt:check` needs them.
- `native:build` needs `box_resolvePadding(style, cb)` to stay reachable from the translation roots. `resolvePaddingWith` therefore calls `resolvePadding` whenever no value-model fault is on. This does not change behaviour: the corpus digests are identical with and without it.

## Results

- Profile rows: 96 added on each target: ios and web exact, android unsupported. No existing row removed or changed status, and no proving case was lost; 126 existing rows gained proving cases.
- North-star: support goes from 123 to 129 of 291 declarations, and 6 width/max-width calc, min and clamp declarations move from blocked to supported. None gets worse.
- WPT: `web.json` changes only the reasons of not-runnable files; no status change and no new fail. The reftest-layout lane (report-only) gains 5 passes: vh-support, vh-zero-support, vh-calc-support, vh-calc-support-pct and viewport-unit-011.
- Verification (all in /tmp/dragon-v):
  - `pnpm install --frozen-lockfile`: lockfile unchanged.
  - Step-0 probe: pass. `layout:subset`: 0 violations.
  - `pnpm typecheck`: pass. `pnpm test`: 67 files and 1549 tests passed. Every BASE test name exists at HEAD once derived counts are normalised; no `.only`, `.skip` or `.todo`.
  - `native:gen`, `native:swift` and `native:kotlin`: pass on every suite. `native:planted`: 8/8 on each target.
  - `layout:vectors` and `layout:dpr-vectors`: every existing vector is byte-identical.
  - `parity:capture` and `parity:dpr-capture`: every existing capture is byte-identical.
  - `parity:report`: 231 fixtures, fails 0, 10240/10240 nodes exact. `parity:dpr-report`: 1116/1116 cases pass, exact at every DPR.
  - `profile:rows`: see above.
  - `native:build` ios and android: pass, 372 cases, iOS 15 floor, 0 references above API 31; all 322 pre-existing case sources identical apart from the digest field.
  - `native:encoders` swift and kotlin: 372/372 valid and equal, 4/4 plants caught.
  - `parity:lanes -- --run-host`: exit 0. The lanes.json diff holds only case counts, case-list hashes and digests.
  - `north-star:check`, `wpt:run`, `wpt:update-expectations` and `wpt:check`: pass.
  - Protected paths unchanged; no git remote.
