# T006 Judge: engine value model package (V1), ruling on P5 parallelism

Judge, read-only, 2026-09-28. Inputs read: state.yaml and goal.md (this board); docs/research/engine-value-model-plan.md; docs/research/coverage-roadmap.md §3-§4 and the V row (line 229); docs/research/text-plan-summary.md phasing; docs/decisions.md (committed on master in bf9793b: Device text size, Coverage roadmap, tiers); milestone-2 notes/T015 §2-§5; AGENTS.md. Code read: /tmp/dragon-p4 (layout.ts zoomInput, emit/native-support.ts inputFunctions and engineValue, emit/uikit.ts, emit/expected-dump.ts, native-host.ts imports), master (block.ts EngineFaults, fixtures.ts group registration, translate corpus and harness), feat-units stat, examples/music-player/styles.css.

## 1. Ruling: V1 runs in parallel with P5; V1 merges after P5; V2 follows P5

**Decision: parallel_with_P5, for V1 only. V2 is after P5.**

- Disjointness. `git diff --name-only master...t014-p4-backends` and `...engine-linebreak` touch text.ts, index.ts, internal.ts, emit/*, lower/native-program.ts, parity native-* files, linebreak/linefit and generated Text/Unions/Strings. P5 (T015 §4) writes parity device files, native-host.ts, native-build.ts, native-smoke.ts, emit/native-support.ts (points, sampling, glyph plant), internal.ts and index.ts (exports), an inline.ts helper, break vectors, pixel references and lanes.json.
- V1 as cut below writes none of inline.ts, text.ts, native-host.ts, internal.ts, emit/uikit.ts, emit/android-views.ts, emit/expected-dump.ts, lower/native-program.ts or any P5 parity source. The roadmap already allows this (row V: "P5 if P5 is not editing the engine"; P5 edits the engine only by a behaviour-preserving export).
- Overlap that remains, and why it is safe:
  - `emit/native-support.ts`: V1 edits only `engineValue`/`VALUE_CLASSES` (an additive encoder for the new `LengthCalc` and `CalcExpr` nodes), a region P5 does not edit. Pre-existing emitted case sources must be byte-identical (verify 12).
  - `packages/layout/src/index.ts`: append-only exports on both sides.
  - `packages/layout/generated/**`: both regenerate; the integrator reruns native:gen after merging sources, never hand-merges (roadmap §4).
  - `packages/parity/out/lanes.json`: a generated output; V1's Phase B regenerates it with a device run.
  So the overlap is hunk-disjoint source plus generated outputs, not a shared behaviour.
- Why merge after P5, not before. P5 must prove every fixture on master when it starts, and it commits per-case break vectors, Chrome breaks and Chrome pixels, and a device run whose layout-vectors-device digests are the host corpus digests. V1 adds fixtures and corpus suites. If V1 merged first, P5 would have to rebase and redo all of that. If V1 merges second, it only adds new-case data (existing data stays byte-identical because V1 keeps every existing output identical) and reruns the device lanes once. So:
  - **Merge order:** T002 (… engine-linebreak, P4 with M1 and M2, then fast-forward master) → T007 P5 → T009 V1 (Phase B) → V2 → INL1 → TXT1.
  - **Phase A** (all engine, compiler, fixture and host proof) runs now, in parallel with P5, from post-P4 master.
  - **Phase B** runs only after P5 is on master, and needs the device lease: merge master, regenerate, extend P5's data for the new cases, and rerun every device lane so lanes.json is not stale for T999.
- How generated engines interact. P5 builds device apps from the translated engines and consumes the translate harness unchanged. V1 regenerates Swift and Kotlin bodies (Input, Units, Box, Flex, Position, Intrinsic, Layout, Block for EngineFaults, Unions, Strings renumbering, new Calc and Environment files) and adds corpus suites and harness dispatch. None of that reaches P5's branch until Phase B, where the merged tree is regenerated and the device lanes rerun on the new engine. P5's own generated diff stays header-only (plus Inline.* if it adds a helper); the integrator's native:gen after merge produces one consistent set.

## 2. Why V2 cannot be in the same slice

V2 (FontSpec expressions, `rootFontSize`, rem and plain em as engine leaves, ex/ch/cap/lh, `env()`, small/large/dynamic viewports, `environmentDependencies`, moving the host zoomInput call and the `font` write) needs:
- inline.ts (`TextLeaf`) and text.ts (`FontMetrics`), which are strictly serial after P5;
- a `LayoutInput` shape change. The emitters build `LayoutInput(Viewport(...), dpr, root)` positionally (uikit.ts line 59, android-views.ts line 59; expected-dump.ts `programInput`), and those are P4 hotspot files that P5 protects;
- native-host.ts and internal.ts (`Environment`), which are P5 files;
- rulings not yet recorded: the vector input format change (plan ruling 1), the plain-em leaf changing UNIT-a vector inputs (ruling 3), and the native small/large/dynamic policy (ruling 6).

So V2 is a separate package after P5 (and after V1), before INL1. It also lifts the largest-text-size run into P7.

## 3. How V1 differs from the plan's V1 (the cut that makes it parallel-safe)

Each change moves an item to V2 because it needs a `LayoutInput` field, inline.ts or text.ts, or an unrecorded ruling:
1. `env()` → V2 (needs `safeArea` in LayoutInput). V1 refuses it with a named reason. The north star does not use env().
2. `sv*`/`lv*`/`dv*` → V2 (needs `viewportUnits` and ruling 6). V1 supports `vw`, `vh`, `vmin`, `vmax`, `vi` and `vb`, resolved from `input.viewport` with R6. The north star uses only vw and vh.
3. Plain `em`/`rem` outside math functions keep UNIT-a's compile fold, so no existing vector input changes (no ruling 3 needed). Inside a math function, `em` and `rem` are `EmLength` leaves whose `fontSize` is `CalcPx(specified size)` from the compiler: Chrome's `value * float(specified * z)`. rem uses the root's specified size at text scale 1, so the existing decision holds: native rem-dependent rows are caveat at text scale other than 1 until V2. The plan's finding-2 triple becomes a V1 engine vector for `em` inside calc; the plain-em planted fault `emFoldedAtCompile` moves to V2.
4. calc in `font-size` and `line-height`, and ex/ch/cap/lh/rlh → V2 (they reach `TextLeaf` and `FontMetrics`). V1 refuses them with a named reason.
5. The `FixtureSpec.viewports` list → V2 or later, because P5's runner assumes the 400x300 root and checks device fit. V1 fixtures stay 400x300. R6 is still proven by Chrome, since 300 css px at 2.625 is 787.5 device px, which ceils to 788. Other viewport sizes (393x851, 320x568, 844x390 and the vmin/vmax flip) are engine vectors (TS = Swift = Kotlin), not parity fixtures.
6. No `LayoutInput` field is added and the `zoomInput(input, faults)` signature stays. The new `environment.ts` pass runs inside `zoomInput` for every DPR, including 1, so native-host.ts, expected-dump.ts and native-support.ts's `layout_zoomInput` call sites are unchanged.

V1 still includes: the recursive `CalcExpr` (px, percent, number, viewport, em, sum, product, invert, min, max, clamp, pixels-and-percent), `LengthCalc` in every family of plan §1.2 except LineHeightValue and font size, parse-time simplification and Chrome serialisation (css/math.ts), the §2.2-§2.4 arithmetic with the float primitives in units.ts, `hasPercent` with `resolveLength`/`resolveLengthOrNull` in box.ts at every call site (block, flex, position and intrinsic), R6 in the platform-rule registry, and the planted faults `calcPercentPlainOrder`, `calcDoubleEval`, `calcNoNonNegClamp`, `calcPercentIndefiniteAsLength`, `clampMaxWins`, `divideDirect`, `calcLeafUnzoomed`, `viewportUnitsUnceiled` (engine), and `dropExplicitZeroPercent`, `sumOrderSwapped` (compiler). This unlocks SIZE, ALGN and GRID, and the north star's clamp/min/calc/vw/vh lengths.

## 4. Worker package T009 (V1)

- **Worktree / branch:** `/tmp/dragon-v`, branch `v1-value-model`.
- **Base:** master after T002 fast-forwards it, so it includes P4 (t014-p4-backends with M1 and M2), feat-units, feat-cascade-var, feat-block-elements, wpt-breadth, engine-linebreak (unwired) and T001's docs (bf9793b). BASE = that commit.
- **Objective (Phase A, parallel with P5):**
  - Step 0: a translator probe test proving a recursive union type (`CalcExpr`) translates, with `layout:subset` at 0 violations.
  - Then implement V1 as cut in §3, following engine-value-model-plan.md §1-§2, §4 and §5.
  - Each (verify) point used by V1 gets a dedicated engine vector before code relies on it: float summation order, a/b vs a*(1/b), constant calc through ComputeLength, and R6.
  - Parity fixture group `values`: plan §5 calc fixtures minus calc-line-height and calc-font-size, plus vw/vh/vmin/vmax/vi/vb fixtures and rejects for `env()`, `sv*`/`lv*`/`dv*`, font-metric units, typed arithmetic, number mixed with length, round()/mod(), and % in gap. Run at DPR 1, 2, 3 and 2.625, in ltr and rtl, with Chrome-dual computed strings.
  - Commit locally.
- **Objective (Phase B, only after T007 P5 is merged to master, with the PM's device lease):**
  - Merge master into the branch and regenerate every generated file (never hand-merge).
  - Rerun Phase A verify.
  - Extend P5's committed data for the new cases only: `layout:break-vectors`, `parity:break-capture` and `parity:pixel-capture`.
  - Run `parity:lanes -- --run-host --run-device`, so lanes.json covers the V1 cases with no stale lane.

### Allowed files (Phase A)
- `packages/layout/src/input.ts`, `units.ts` (the only file with float arithmetic, including the calc primitives), `validate.ts` (a hand-written calc rule), `box.ts`, `flex.ts`, `position.ts`, `intrinsic.ts`
- `packages/layout/src/calc.ts`, `packages/layout/src/environment.ts` (new)
- `packages/layout/src/layout.ts` (the zoomInput body calls the environment pass; exported signature unchanged)
- `packages/layout/src/block.ts` (EngineFaults and NO_ENGINE_FAULTS entries appended, plus length-resolution call-site substitutions only)
- `packages/layout/src/platform-rules.ts`, `packages/layout/src/chrome-deviations-dpr.ts` (R6; a DPR deviation only with a Chrome capture and its fault)
- `packages/layout/src/index.ts` (append-only exports)
- `packages/layout/generated/**` (native:gen output only)
- `packages/layout/vectors/**` (new files only), plus `packages/layout/vectors/README.md` (a documentation paragraph for the environment pass and R6)
- `packages/layout/test/calc*.test.ts`, `packages/layout/test/environment*.test.ts` (new)
- `packages/translate/test/calc-probe.test.ts` (new)
- `packages/translate/src/corpus.ts`, `packages/translate/src/corpus-dpr.ts`, `packages/translate/harness/harness.ts` (additive calc suites and dispatch only)
- `packages/translate/corpus.json`, `packages/translate/corpus-dpr.json`, `packages/translate/corpus-m1-cases.json` (native:gen lock output only)
- `packages/dragon/src/css/math.ts` (new), `packages/dragon/src/css/values.ts`, `packages/dragon/src/css/units.ts`, `packages/dragon/src/css/README.md`
- `packages/dragon/src/css/properties/**` (`<calc()>`/`<min()>`/`<max()>`/`<clamp()>` feature keys only)
- `packages/dragon/src/analysis/computed.ts`
- `packages/dragon/src/lower/ios-layout.ts`
- `packages/dragon/src/faults.ts` (two compiler faults appended)
- `packages/dragon/src/diagnostics/catalogue.ts` (new refusal entries, one per line)
- `packages/dragon/src/emit/native-support.ts` (`engineValue`/`VALUE_CLASSES` additive encoder for LengthCalc/CalcExpr only)
- `packages/dragon/src/profiles/*.ts` (profile:rows output only)
- `packages/dragon/test/math.test.ts` (new); `packages/dragon/test/units.test.ts` (only refusal assertions for units and functions V1 now supports, each replaced by an acceptance assertion); `packages/dragon/test/seams.test.ts` and `packages/dragon/test/diagnostic-codes.json` (append-only pins)
- `packages/parity/src/fixtures.ts` (one appended group entry), `packages/parity/src/fixture-groups/values.ts` (new), `packages/parity/fixtures/*` (new values fixtures only)
- `packages/parity/expected/**`, `packages/parity/expected-dpr/**` (new files only), `packages/parity/emitted/**` (new bodies; headers relaxed)
- `packages/parity/test/values.test.ts` (new)
- Existing count pins in `packages/layout/test/{dpr-deviations,dpr-vectors,snap}.test.ts` and `packages/parity/test/*.test.ts`: converted to derived counts, or bumped, only where new fixtures or vectors move them
- `packages/parity/out/lanes.json` (parity:lanes output only)
- `examples/music-player/dragon/north-star-check.json` (north-star:check output only)
- `packages/wpt/expectations/*.json` (wpt:update-expectations output; every new fail entry has a written reason)
- `docs/goals/milestone-2-proof/notes/T009-value-model-v1.md` (Worker note)

**Phase B adds:** `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**` and `packages/parity/expected-pixels/**` (new case files and appended manifest entries only), `packages/parity/out/lanes.json` (device run), and regeneration of any generated file above after the merge.

### Verify
Export these before every command: `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` and `DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt`.

1. `pnpm install --frozen-lockfile`: the lockfile is unchanged.
2. The step-0 probe test passes, and `pnpm run layout:subset` reports 0 violations, before and after the engine edits.
3. `pnpm typecheck` exits 0.
4. `pnpm test` is all green.
   - `vitest list` at BASE is a subset of HEAD's; nothing is skipped, `.only` or `.todo`.
   - `git diff --diff-filter=MD --name-only BASE -- '*/test/*'` lists only the pinned files above, each hunk explained in the note.
5. `pnpm run native:gen`, then `native:swift` and `native:kotlin` both pass.
   - Every pre-existing corpus suite has the same line count and results as a BASE run.
   - The lock changes only by the added calc suites.
   - `pnpm run native:planted -- --target swift` and `--target kotlin` report 8/8 each (unchanged).
6. `pnpm run layout:vectors && pnpm run layout:dpr-vectors`, then `git diff --diff-filter=MD --name-only BASE -- packages/layout/vectors` is empty apart from README.md: new files only, and every output byte-identical.
7. `pnpm run parity:capture` and `pnpm run parity:dpr-capture`: `git diff --diff-filter=MD BASE -- packages/parity/expected packages/parity/expected-dpr` is empty. Under emitted/, existing files differ only in relaxed header lines (a body-identical check).
8. `pnpm run parity:report` fails 0. `pnpm run parity:dpr-report` fails 0 at 2, 3 and 2.625. Chrome-dual computed strings match for every math fixture.
9. `pnpm run profile:rows`: the diff equals the declared new rows. No existing row changes, and no ios or android row is promoted to exact.
10. Planted faults: each of the 8 engine faults and 2 compiler faults fails its named values fixture (or its calc golden), with its named failure kind.
11. `pnpm run native:build -- --target ios` and `--target android`:
    - both exit 0 at the derived case count, and the Android floor has 0 references above 31;
    - the emitted case sources of every pre-existing case are byte-identical to a BASE build.
12. `pnpm run native:encoders -- --target swift` and `--target kotlin`: all valid and equal, 4/4 plants caught.
13. `pnpm run parity:lanes -- --run-host` exits 0. The lanes.json diff is limited to the new case counts and digests.
14. `pnpm run north-star:check` and `pnpm run wpt:update-expectations`:
    - north-star refusals only shrink;
    - no WPT pass becomes a fail;
    - every new fail has a written reason.
15. Protected paths: `git diff --exit-code BASE --` on each of these:
    - packages/layout/src/inline.ts and text.ts;
    - packages/parity/src/native-host.ts, chrome.ts, compare.ts, dpr.ts, dual.ts, pipeline.ts, targets.ts, lanes.ts, native-compare.ts, native-dump.ts, samples.ts;
    - packages/dragon/src/internal.ts, lower/native-program.ts, emit/uikit.ts, emit/android-views.ts, emit/expected-dump.ts;
    - packages/translate/src/{emit-swift,emit-kotlin,lower,ir,walk,check,templates,prelude-swift,prelude-kotlin,generate,subset,faults}.ts;
    - package.json and .github.
16. `git diff --name-only BASE..HEAD` lies inside allowed_files. `git remote -v` is empty.
17. Phase B only, on the device lease, after merging master with P5:
    - verify 1-16 again;
    - `pnpm run layout:break-vectors` and `pnpm run parity:break-capture` add files for V1 cases only, and the engine equals Chrome on N/N;
    - `pnpm run parity:pixel-capture` adds V1 cases only, with a byte-identical re-capture of a derived subset;
    - `pnpm run parity:lanes -- --run-host --run-device`: no `not run` lane. layout-vectors-device equals layout-vectors-host on both targets. device-frames, device-applied and device-lines pass on both targets. device-pixels has no failure on a V1 case beyond master's recorded list;
    - `pnpm run parity:lanes -- --require-all` gives the same verdict as master's.

### Stop if
- BASE does not contain the P4 merge (M1 and M2) from T002.
- The step-0 probe shows that the translator core (emit, lower, IR, walk, check, templates, preludes) must change. Report it; that is its own reviewed step.
- Any file outside allowed_files is needed. In particular: inline.ts or text.ts; a `LayoutInput` field or the zoomInput signature; native-host.ts, internal.ts, native-program.ts, uikit.ts, android-views.ts or expected-dump.ts; any protected parity source; package.json.
- Any existing output changes: a vector, capture, expected-dpr file, emitted body, profile row, pre-existing native case source, WPT pass, or lanes check. Existing test assertions may change only as the pins above allow.
- Float arithmetic is needed outside units.ts.
- A (verify) point disagrees with Chrome and cannot be explained from Blink 145 source.
- A new fixture fails Chrome parity at any DPR or direction after the arithmetic has been checked against Blink.
- A planted fault is not caught.
- Any tolerance, gate, case, DPR or direction would be loosened, skipped or reduced.
- Verification fails twice.
- Phase B:
  - P5 is not merged, or the device lease is not held;
  - any non-pixel device lane fails, on any case;
  - V1 cases add device-pixels failures (paint is P6);
  - a simulator or AVD fails to boot twice.

## 5. Required board updates (PM)
- T006 → done, with this note as the receipt.
- T009: fill allowed_files, verify and stop_if from §4. Record Phase A as dispatchable now (in parallel with T007, once T002 has fast-forwarded master), and Phase B as blocked on T007 merged plus the device lease.
- Add an integrator step after P5 for the V1 merge (merge order in §1). After the merge: native:gen, layout:vectors, layout:dpr-vectors, native:swift, native:kotlin (roadmap §3.4).
- Add V2 (Judge spec, then Worker) after P5 and V1, before INL1. Its scope: plan items moved in §3, plus rulings 1, 3 and 6. Add the largest-text-size run to P7's dependencies.
- Record the V1/V2 cut in decisions.md or the board as a PM note, so the rem caveat and the refusals are traceable.
