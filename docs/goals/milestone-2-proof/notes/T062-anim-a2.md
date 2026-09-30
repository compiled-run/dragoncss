# T062: ANIM-a2, the translated rt roots (host step done, device step pending)

Worker note, 2026-09-29. Branch `anim-a2-translate` in /tmp/dragon-anim-a2, commit 43605e72 on BASE bb87f427 (pr/v1-value-model,
stacked on PR #10). Not pushed.

## Result

- **Engine roots.** Every exported function of `rt-easing.ts`, `rt-timing.ts` and `rt-interpolate.ts` is now a root in
  `generate.ts` `engineRoots`. This is one additive hunk after the units loop. The generated engines gain
  RtEasing, RtTiming and RtInterpolate in Swift and in Kotlin.
- **rt suite.** The P1 corpus gets a new suite, `rt`, appended after `library`. It runs in library mode and has one line per
  rt vector record, in this order:

  | File | Lines |
  |---|---|
  | timing | 36,785 |
  | easing | 10,439 |
  | hold | 903 |
  | interp | 6,461 |
  | **Total** | **54,588** |

  - Every number in a line is its bit pattern.
  - The harness adds four library operations: `rt-timing`, `rt-easing`, `rt-hold` and `rt-interp`. They are additive
    `case` lines, plus an additive section at the end of harness.ts.
  - `templates.ts`, the emitters, `lower.ts`, `ir.ts` and the preludes are unchanged. Reusing library mode avoided a new
    harness mode.
- **Trig.** The subset has no `sin` or `cos`, so the harness injects fdlibm's `__kernel_sin` and `__kernel_cos` with a zero
  tail as `Trig`.
  - `gfx::SinCosDegrees` reduces every angle below 9e7 degrees to [0, 45] degrees, so the kernels only ever see |x| ≤ π/4.
  - The kernels are written in the subset. The high-word tests are written as comparisons against bit-pattern constants, and
    `INSERT_WORDS` as an exact floor to 2^-24 or 2^-23.
  - An argument outside the kernel range is a harness error. The harness never guesses. A test covers this case.
- **Equality.**
  - `rt-vectors.test.ts` proves that the TypeScript harness expectations equal every rt vector record: progress and
    iteration bits, and value strings. That includes 1,594 matrix strings.
  - A side check (not committed): on 20,000 random rotations, the harness trig serialises the same as `Math.sin` and
    `Math.cos`.
  - `native:swift`: rt 54588/54588. `native:kotlin`: rt 54588/54588.
  - Every other P1 and extended suite is unchanged. The extended digest is still c7f2f5a4…; the P1 digest moved to
    5b44ea9b… only because the rt suite was added, and the per-suite digests of vectors, units, engine and library are
    unchanged.
- **Lanes.**
  - `targets.ts` declares `p1/rt` with a count derived from the rt vector record counts, not from the lock (T099 pattern).
  - `lanes.ts` `SUITE_LINE` parses `rt`.
  - `parity:lanes -- --run-host`: layout-vectors-host passes on ios and android with `p1/rt 54588/54588 (declared 54588)`.
    frames, applied and lines are unchanged. device-pixels is unchanged (ios 546, android 1397).
  - layout-vectors-device is **not run**, because the declared suites changed. See "Device step pending" below.

## Verify

1. **C1.**
   - `pnpm install --frozen-lockfile`: ok. `pnpm typecheck`: ok.
   - `pnpm test`: 2395 of 2396 pass. The one failure is lanes.test.ts "every device lane ran (P5)", which expects
     layout-vectors-device to be `pass`. It closes with the device step.
   - No `.skip`, `.only` or `.todo`.
2. **C2.** `layout:subset`: 0 violations.
3. **native:gen, native:swift, native:kotlin.** Every suite is equal, including rt 54588/54588, on both targets.
   - Generated changes:
     - 6 new rt files;
     - the harness files;
     - Strings.swift;
     - body renumbering in existing engine files (the string table `S.sN` indices and loop temps `_aN` and `_iN`), because the
       new roots share the numbering. No logic changed.
     - every other file changes only its header (translator digest).
4. **native:planted.** swift 8/8 and kotlin 8/8 are caught.
   - Kotlin `platform-round` also fails 6 rt cases.
   - The `canonical-equality` engine suite timeout (180 s) happens during the plant run and is part of that plant's catch.
5. **Device step pending.** No lease is held. See below.
6. **C6.**
   - RT-13 additive check with `git diff -U0 BASE`:

     | File | Lines removed | Lines added |
     |---|---|---|
     | generate.ts | 0 | 7 |
     | corpus.ts | 0 | 42 |
     | harness.ts | 0 | 203 |
     | host.ts | untouched | untouched |
     | targets.ts | 0 | 2 |
     | lanes.ts | 1 | 1 (the `SUITE_LINE` regex, see deviations) |

   - `git remote -v` shows the owner's origin. No push or fetch was made.

## Device step pending

With both leases, run in /tmp/dragon-anim-a2:

`ENV pnpm run parity:lanes -- --run-host --run-device`

It needs layout-vectors-device = pass on:
- ios at DPR 2 and 3;
- android at DPR 2, 2.625 and 3;

with `p1/rt 54588/54588`. The device harness runs both corpora whole, so rt needs no device-side change. Then commit lanes.json.
The lanes.test.ts failure closes with that commit.

## Deviations

- **The rt suite is in the P1 corpus (`corpus.ts`, lock `corpus.json`), as the spec's allowed_files name it.** The extended
  corpus (`corpus-dpr.ts`) is not in allowed_files. The four P1 suites keep their inputs, results and per-suite digests.
- **Files outside the spec's list, under the PM's T099-pattern instruction:**
  - `packages/parity/src/targets.ts`: one additive declaration.
  - `packages/parity/src/lanes.ts`: `SUITE_LINE` gains `|rt`. This is one changed line, as T099 did for the V1 suites.
  - `packages/parity/test/lanes.test.ts` and `device-vectors.test.ts`: added assertions that a dropped rt line fails the host
    lane, that rt is declared at 54,588, and that a short rt run fails the device lane.
- **Pinned tests retargeted (Throughput rule):**
  - `translate.test.ts`: the P1 sizes gain `rt: 54588`;
  - `native-swift.test.ts` and `native-kotlin.test.ts`: the suite list gains `rt 54588/54588`.

  Each one keeps its intent: exact suite sizes and full passes.
- **No rt fault lines.** The harness runs `RtFaults` all false. The rt plants are proven against Chrome in TypeScript (ANIM-a),
  and the native requirement is equality with the reference vectors.
- **The fdlibm kernels match V8's `ieee754` kernel.** They are fdlibm's `__kernel_sin` and `__kernel_cos`, the kernel V8's
  `ieee754` sin and cos call for |x| ≤ π/4. That is enough, because every vector record, including 1,594 matrices, reproduces.
