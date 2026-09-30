# T061: ANIM-a, the rt timing and interpolation reference

Worker note, 2026-09-28. Branch `anim-a-timing` in /tmp/dragon-anim-a, commit 3a4c124a on BASE 41cc750. Not pushed.

## Result

The TypeScript reference equals Chrome 145.0.7632.6 on every oracle sample: 54,588 in total, with no tolerance.

| Oracle file | Samples | Compared |
|---|---|---|
| timing.json (1,037 timing combos) | 36,785 | progress and currentIteration, bit for bit |
| easing.json (73 timing functions) | 10,439 | progress, bit for bit |
| hold.json (paused animations, read 3 frames later) | 903 | progress and currentIteration, bit for bit |
| interp.json (91 interpolation cases) | 6,461 | getComputedStyle string, string for string (and progress bits) |

- `rt:oracle` run twice gives byte-identical files.
- `rt:oracle -- --check` reports failed 0 and stale files 0.
- The library frame: the oracle has `cubic-bezier(0.25, 0.1, 0.25, 1)` at x = 0.5 as bits 3fe9ad49e059a61d (0.8024033910598437), and the reference returns the same value.
- `rotate(0deg)` to `rotate(360deg)` at 0.25 serialises as `matrix(0, 1, -1, 0, 0, 0)` in both Chrome and the reference.

Planted faults. Each one, switched on alone, gives this many oracle mismatches, and each is caught by `pnpm test` (rt-faults.test.ts):

| Fault | Mismatches |
|---|---|
| newtonIterations3 | 27 |
| epsilon1e-6 | 1,121 |
| noSplineGuess | 5,598 |
| stepsIgnoreBeforeFlag | 439 |
| rotateViaMatrix | 546 |
| colorUnpremultiplied | 434 |
| holdTimeLost | 292 |

## Source confirmation (Chrome 145.0.7632.6)

- The gitiles web UI on chromium.googlesource.com returned 503 for every request, including requests with a browser user agent.
- The git protocol on the same host worked. `git ls-remote` gives tag 145.0.7632.6 as 47e20adcc15fc15f01825aa17e570c8f5492ac0f (committed 2026-01-13).
- I read the files from a shallow, blobless, sparse clone of that commit, in /tmp/anim-a-src/cr145.

What the source shows:

- **gfx::CubicBezier** (ui/gfx/geometry/cubic_bezier.{h,cc}):
  - 11 spline samples for the initial guess;
  - `kMaxNewtonIterations = 4`;
  - `kBezierEpsilon = 1e-7`, and Newton stops when `|dx/dt| < 1e-7`;
  - then bisection;
  - `ToFinite` on the y coefficients;
  - start and end gradients follow the 4-case rule.
- **Blink wrapping.** `CubicBezierTimingFunction::Evaluate` calls `Solve`. `StepsTimingFunction` evaluates `floor(steps*t + offset)`, then takes one step back on the LEFT limit when `steps*t` is integral. The before flag comes from `TimingCalculations::CalculateTransformedProgress`.
- **Time type.** `AnimationTimeDelta` is a double in seconds. core/animation/BUILD.gn has `blink_animation_use_time_delta = false`, so the class holds `double delta_`, with exact comparison operators. JS milliseconds convert as `ms / 1000.0`. `base::TimeDelta` (integer microseconds) is not used. The reference therefore models double seconds, not integer µs.
- **Timing model** (timing_calculations.cc):
  - a 1 µs time tolerance, and phase-boundary snapping that is passed through to the active time;
  - `TimingCalculationEpsilon = 2 * DBL_EPSILON`;
  - `fmod`-based iteration progress;
  - forwards direction is endpoint-exclusive at the active-after boundary;
  - `MultiplyZeroAlwaysGivesZero`.
  - The reference uses `fmod` as an exact loop, because the subset has no `%`.

## Rulings made by research (for the PM to record)

1. **Float narrowing points.** Chrome narrows to float at these points, and so does the reference:
   - opacity storage;
   - `blink::Length` values, with the transform-argument blend written as `Blend(float, float, double)`;
   - `FloatValueForLength` percent;
   - `gfx::Transform` translate and scale in the axis-2D form;
   - `blink::Color` channels.

   Property-level lengths (InterpolableLength) blend in double and narrow once, when the Length is created. Chrome shows no FMA contraction: plain double operations reproduce every sample.
2. **Number serialisation** is `CSSNumericLiteralValue`:
   - an integer fast path for |v| ≤ 999999;
   - otherwise libc `%.6g` of the exact binary value, with **ties to even** (macOS libc; confirmed on 10.03125, 123456.5 and 1234565).

   The reference derives the digits with exact integer arithmetic, because the subset has no number formatting. Colour alpha uses double-conversion `ToPrecision` (ties away from zero), with trailing zeros trimmed.
3. **Legacy colour parsing quantises alpha.** Blink's parser applies `alpha = round(alpha * 255.0) / 255.0` (css_color_function_parser.cc:373). The reference applies the same rule in `legacyColorFromCss`, and the compiler must use it when it builds colour values. I found this through an oracle mismatch (`rgba(…, 0.5)` to `rgba(…, 0.25)`) and then confirmed it in the source.
4. **InterpolableColor::Resolve** clamps the interpolated alpha to [0, 1] before it unpremultiplies. At alpha 0 it keeps the premultiplied channels, which then clamp to 0. So `transparent` to red below progress 0 gives `rgba(0, 0, 0, 0)`.
5. **Rotation interpolation** uses `Rotation::Slerp`, with `GetCommonAxis` treating |angle| < 1e-4 as zero. Promotion from `none` is `angle * p`; promotion to `none` is `angle * (1 - p)`. The matrix uses `gfx::SinCosDegrees`:
   - exact at multiples of 45°;
   - otherwise octant range reduction, then the injected platform `sin` and `cos` (the `Trig` parameter, per RT-4).
6. **Transform-function families** match as Blink's `CanBlendWith` does: translate, translateX and translateY blend with each other, and likewise the scale functions. Different families are refused (ANIM-m).
7. **The T047 text quotes `translateX(19.7596…%)`.** That is a truncation. The stored float is 19.75966…, which `%.6g` prints as 19.7597.

## Retargeted pinned test (Throughput rule)

- **Test:** `packages/translate/test/translate.test.ts`, the T038 item 21 guard "Math rounding only in units.ts" (line 93).
- **Why it pinned this package:** RT-3 and RT-12 require Blink's float and floor rounding in new `packages/layout/src/rt-*.ts` files.
- **What changed:** the rt modules route every rounding call through four wrappers in `rt-easing.ts` (`floorOf`, `truncOf`, `roundOf` and `froundOf`). The guard now exempts `units.ts` and `rt-easing.ts` by name only.
- **Intent kept:** rounding stays in audited numerics modules, and every other file under packages/layout/src is still checked.
- The file is outside the package's `allowed_files`. The PM should confirm this retarget or overrule it.

## Deviations

- The plant `epsilon1e-6` is the field `epsilon1e6`, because subset field names must be identifiers. rt-faults.test.ts maps the plant name to the field.
- `PlayState` carries `heldAt`, the timeline time at which the hold time was set, so that `holdTimeLost` can model a paused animation running on.
- The rt vectors equal the oracle byte for byte, since reference equals Chrome. They are kept as separate TS-reference files so that ANIM-a2 compares against the reference, not against Chrome.
- A new test file, rt-vectors.test.ts, matches `packages/layout/test/rt-*.test.ts`. It keeps the vectors current.

## Verify

1. **C1:** `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`.
   - Full run: 1538 of 1540 passed.
   - The 2 failures were 120 s timeouts under load: lanes.test.ts (iosLayoutProjection) and parity.test.ts (determinism). Both passed on rerun: 255 of 255 in those 2 files.
   - An earlier full run had 4 load timeouts (dist, lanes, native-compare and parity), plus the guard and generated-freshness failures that this commit fixes.
   - No `.skip`, `.only` or `.todo`.
2. **`rt:oracle` run twice, then `git diff --exit-code packages/layout/rt-oracle`:** exit 0.
3. **`rt:oracle -- --check`:** failed 0, stale files 0. The sample counts are in the table above.
4. **The library frame and the rotate matrix:** as stated above, asserted in rt-easing.test.ts and rt-interpolate.test.ts.
5. **C2:** 0 violations.
6. **C3:** `native:gen` changes only the header lines of 3 files, all relaxed tier. The sources digest moved because 3 new engine files exist.
   - Unions.kt
   - Strings.swift
   - Unions.swift
7. **Plants:** all 7 caught.
8. **C6:**
   - The diff lies inside allowed_files, except the retarget listed above.
   - The RT-13 check does not apply, because no RT-13 file was touched.
   - `git remote -v` is **not empty**. It shows `origin git@github.com:compiled-run/dragoncss.git`, which already exists in the shared repository config and applies to every worktree. This package did not add it and did not push.
