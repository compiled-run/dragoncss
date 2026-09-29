# T012 Judge: engine value model V2 (after P5 and V1)

Judge, read-only, 2026-09-28. Read: this board's state.yaml, goal.md and notes/T006-value-model-spec.md (in full); notes/T004-txt1c-spec.md;
docs/research/engine-value-model-plan.md; docs/research/text-plan-summary.md; docs/decisions.md ("Text strategy", "Text shaping: bundled
HarfBuzz", "Device text size", "Native glyph advances", "Coverage roadmap"); docs/research/coverage-roadmap.md §3-§4 and §6;
milestone-2 notes/T015 §3.5, §4 and §5 (P7). Code read: /tmp/dragon-p4 (layout/src input.ts, text.ts, inline.ts, layout.ts zoomInput;
emit/uikit.ts:59, android-views.ts:59, expected-dump.ts:78-84, native-support.ts:526 and :1247; lower/native-program.ts:44 and :217;
parity/src/native-host.ts:119), /tmp/dragon-units analysis/computed.ts `computeLengths`, vendor/fonts/Ahem.ttf (OS/2 v3: sxHeight 800,
sCapHeight 800, unitsPerEm 1000), examples/music-player/styles.css.

## 1. Decision

**Approved, split in two.** V2 as one slice is unsafe: the fixture-viewport list and the text-scale runs rewrite P5's capture and device
harness (chrome.ts, pipeline.ts, dpr.ts, native-dump.ts, device fit), which is a different risk from the engine and compiler change, and it
is not needed to unblock INL1. So:

- **V2a, value model 2 (engine, compiler, case inputs).** env(), sv/lv/dv, plain em and rem as engine leaves, `rootFontSize`, FontSpec
  expressions (calc in font-size and line-height), ex/ch/cap/lh/rlh on Ahem metrics. Every environment input is an explicit literal in
  each case input, like the viewport today. It is on the critical path: inline.ts and text.ts are serial (P5, V, INL1, TXT1), so INL1
  waits for V2a only.
- **V2b, environment runs (harness and host).** `FixtureSpec.viewports`, scaled-root Chrome captures from pinned text-scale tables, the
  native hosts reading the real environment (root view bounds, safe-area insets, UIFontMetrics / applyDimension(SP)), re-layout on
  environment change, and the environment record in the device dump. It does not touch inline.ts or text.ts. P7's largest-text-size run
  depends on V2a **and** V2b.

Checkpoint 3 does not need V2's features directly: the music player uses only rem font sizes (1rem, 2rem, 1.5rem, 1.35rem, 0.78rem,
0.7rem) and number line-heights, at default text scale (T010 note, line 188). V2a is on the path only through the inline.ts and text.ts
serial order, so keep its edits in those two files minimal (below).

## 2. ex, ch and cap: Ahem metrics now; no wait for TXT1a, TXT1-C wiring or HarfBuzz

- **HarfBuzz is not involved.** Blink's `ch` is `WidthForGlyph('0')` as a float, without the 16.16 step (text-plan-summary, "Metrics");
  ex and cap come from font metrics. None goes through shaping, so branch txt1-harfbuzz-gate is not a dependency.
- **TXT1-C (T005 metrics.ts) is compiler-side** (`packages/dragon/src/fonts`). The engine cannot import it; the engine's metrics come from
  `FontData` in text.ts, which the device reads from the bundled font file. T011 (wiring) does not feed the engine either.
- **The engine only lays out Ahem** (`TextFont.family: 'Ahem'`) until TXT1a. For Ahem every candidate source agrees: x-height 800 units
  (OS/2 sxHeight and the bounds of glyph `x`), cap height 800 (OS/2), `0` advance 1000. So V2a can prove ex/ch/cap exactly against
  Chrome with Ahem today.
- **What Ahem cannot prove:** which source Blink uses for x-height (glyph bounds or OS/2) and cap height. The faults `xHeightFromOs2` and
  `capHeightFromBounds` are T005's (compiler, real fonts) and a TXT1a obligation for the engine. V2a names the source of each `FontData`
  field after T005's proven rule (x-height from glyph `x` bounds yMax, cap height from OS/2 sCapHeight, ch from hmtx of `0`) so TXT1a
  only swaps the data. Native ex/ch/cap rows can be `exact` for Ahem only; any other family stays refused until TXT1a.
- **Still (verify), each with an engine vector and a Chrome capture before code relies on it:** whether macOS rounds XHeight and cap
  height (plan §2.2); `metric / font_zoom * z` round trip at z = 2.625; the instance size `trunc(float(size*z)*100)/100` for metrics.
  Capture ex/ch/cap with `computedStyleMap()` on a length property (float32, not LU), the same observable T005 uses.

## 3. Rulings (owner or PM), with recommendations

1. **Plan ruling 1, vector input format (owner; D2 precedent).** Recommended: approve. `LayoutInput` gains required `viewportUnits`
   (small, large, dynamic), `safeArea` and `rootFontSize`, flat as in plan §1.3, and `TextLeaf.font` becomes `FontSpec` (size a
   `CalcExpr`); `LineHeightValue` gains `LengthCalc`. Every vector input, translate corpus line and native case-source input line is
   migrated by its generator only (never by hand), and every output stays byte-identical, checked per file. No field gets an engine
   default.
2. **Plan ruling 3, plain em and rem become engine leaves (owner).** Recommended: approve. UNIT-a fixtures' vector inputs change from px
   to `em` or `rem` leaves; outputs must stay byte-identical. Any changed existing output is a stop that goes to the owner with Chrome's
   value; it is never re-blessed. The `rem` caveat in "Device text size" stays until V2b **and** P7's largest-text-size run pass (not at
   V2a merge); record that reading in decisions.md.
3. **Plan ruling 6, native small, large and dynamic viewports (owner).** Recommended: approve the plan. All three equal the Dragon root
   view's bounds in CSS px; the keyboard does not resize them (Chrome's `interactive-widget=resizes-visual` default). `env(safe-area-inset-*)`
   is the root view's own insets in CSS px (iOS `safeAreaInsets`; Android WindowInsets systemBars plus displayCutout, divided by density).
   The Chrome oracle proves only that sv = lv = dv = v; distinct sizes are proven by engine vectors (TS = Swift = Kotlin) and V2b's device
   probe, and labelled that way.
4. **Text-scale base (owner; a detail of "Device text size").** Recommended: `rootFontSize = S(r)`, where `r` is the root's computed font
   size at scale 1 in CSS px (author px, %, em or keyword on the root included), and `S` is `UIFontMetrics.default.scaledValue(for:)` on
   iOS and `TypedValue.applyDimension(COMPLEX_UNIT_SP, r, metrics) / density` on Android (non-linear on API 34+). The root always scales,
   even when it is authored in px, because the Chrome oracle injects `:root { font-size: S(r)px !important }`; descendants' px sizes do
   not scale. The pinned table stores S per (category or fontScale, r) as captured on the device.
5. **Sequencing on shared files (PM).** Recommended: V2a branches from master after P5 (T007) and V1 Phase B (T009) have merged, and
   ahead of P6 and T011 if they have not started, because INL1 waits on it. If P6 or T011 is already in flight, V2a bases on their merge
   instead; never two in flight on computed.ts, internal.ts, native-program.ts, uikit.ts, android-views.ts, expected-dump.ts or
   native-support.ts. INL1 starts when V2a merges. V2b and INL1 both edit native-support.ts: run INL1 first (checkpoint 3), then V2b
   (P7), unless the PM proves their hunks disjoint.
6. **Viewport cases on devices (owner; a P5 lane rule).** Recommended: every viewport case runs on every device lane at its DPR. V2b
   provisions simulators and AVDs whose window holds each size (for example `dragon-412x915` at 2.625 and a landscape AVD for 844x390);
   it never crops or drops a case. A size that no device can hold is a stop for the owner.
7. **env() oracle (PM).** Recommended: V2a step 0 probes whether Chrome 145's CDP can override safe-area insets
   (`Emulation.setSafeAreaInsetsOverride`). If not, Chrome proves only zero insets, fallbacks and env() inside calc; nonzero insets are
   proven by engine vectors and V2b's device probe, and native env rows stay `caveat` until a device lane with nonzero insets passes.
8. **FontData metric sources (PM).** Recommended as in §2: fields named after T005's proven rule; Ahem-only `exact`.

V2a needs rulings 1, 2, 3, 5, 7 and 8. V2b needs 4 and 6.

## 4. Worker package V2a

- **Worktree / branch:** `/tmp/dragon-v2`, branch `v2a-value-model`.
- **Base:** master after the integrator has merged P5 (T007) and V1 Phase B (T009). Record `BASE=<sha>` in the note.
- **Objective.**
  - **Step 0.** Probes, each a committed test before the code relies on it: the CDP safe-area override (ruling 7); Ahem ex/ch/cap at
    sizes 1, 7, 10, 10.625, 13, 16, 17.5, 23.3, 37, 64 and 100 px and DPR 1, 2, 2.625 and 3 through `computedStyleMap()`; `lh` for
    normal, number, px and percent; `vw` inside font-size; a brute-force search for the finding-2 triple at z = 2.625 (a fixture if
    found at a lane DPR, otherwise an engine vector).
  - **Engine.** In input.ts: `ViewportLength.size`, `RootFontLength`, `FontMetricLength`, `LineHeightLength`, `EnvLength`, `FontSpec`,
    `LengthCalc` in `LineHeightValue`, and the three `LayoutInput` fields. The environment pass (V1's environment.ts, run inside the
    exported zoomInput) now takes the measurer and resolves every leaf to zoomed px per plan §2.2, folds `FontSpec` to a px size and a
    `LengthCalc` line-height to px, then the existing layout runs unchanged. Add `environmentDependencies(input)`, translated. In text.ts,
    `FontData` gains `xHeight`, `capHeight` and `zeroAdvance` in font units (Ahem 800, 800, 1000) and one function returning the float
    metric lengths; float arithmetic stays in units.ts. inline.ts changes only in how it reads a leaf's font size and line-height
    (through one helper over the resolved input); no break, fit or leading arithmetic changes.
  - **Compiler.** computed.ts stops folding em and rem: font-size becomes an expression (em and % as products of the parent's, rem and
    the root's own size as `rem` leaves); calc/min/max/clamp in font-size and line-height (number-only calc folds to Number; number mixed
    with length is refused); ex/ch/cap/lh inside font-size and line-height read the parent's font. css/units.ts gains sv/lv/dv (w, h,
    i, b, min, max), ex, ch, cap, lh, rlh; `ic`, `ric` and container units stay refused. env() with the four safe-area names, a
    fallback, and inside math functions; other names follow Chrome's capture. lower/ios-layout.ts `fontSpec()`; native-program.ts's
    `font` write carries the FontSpec and the runtime takes the size from the resolved input. internal.ts exports `Environment`.
  - **Case inputs.** uikit.ts, android-views.ts, expected-dump.ts `programInput`, native-host.ts and the native-support runtimes build
    `LayoutInput` with explicit environment literals per case: `viewportUnits` all equal to the case viewport, `safeArea` 0 and
    `rootFontSize` the compiler's root size at scale 1. No platform reads (that is V2b).
  - **Fixtures,** new group `font-values` (400x300 only), at DPR 1, 2, 3 and 2.625, ltr and rtl, Chrome-dual computed strings:
    `rem-{16,10px-root,62.5pct}`, `em-chain-fractional`, `calc-font-size`, `calc-line-height`, `font-size-percent-em-calc`,
    `lh-{normal,number,px,percent}`, `rlh`, `ex`, `ch` and `cap` at 10.625px and 17.5px, `ex-in-font-size`, `sv-lv-dv-{w,h,i,b,min,max}`,
    `env-safe-area-zero`, `env-fallback`, `env-in-calc` (nonzero env only per ruling 7). Rejects: `ic`, container units, typed
    arithmetic, number mixed with length in line-height, non-Ahem ex/ch. Engine vectors: `rootFontSize` 13, 21.25 and 53 (TS = Swift =
    Kotlin, no Chrome claim), distinct small/large/dynamic sizes, nonzero safe areas.
  - **Planted faults.** Engine: `lhUnsnapped`, `exUntruncatedFontSize`, `rootFontSizeIgnored`, `safeAreaIgnored`, `lhNormalUnrounded`,
    `viewportSizeKindIgnored` (vector only). Compiler: `emFoldedAtCompile`, `fontMetricOwnFontInFontSize`, `envFallbackForKnownName`.
  - **Phase B (device lease, same branch, after Phase A is green):** every native case-source input line changed, so every device lane
    reruns. Break, pixel and Chrome data are added for the new cases only.

### Allowed files (V2a)
- `packages/layout/src/input.ts`, `units.ts`, `calc.ts`, `environment.ts`, `validate.ts`, `layout.ts` (zoomInput body and signature)
- `packages/layout/src/inline.ts` (font-size and line-height reads through the resolved-font helper only)
- `packages/layout/src/text.ts` (`FontData` metric fields, the Ahem constants, one metric-length function)
- `packages/layout/src/box.ts` (only if a V1 length helper must accept a new leaf kind)
- `packages/layout/src/block.ts` (EngineFaults and NO_ENGINE_FAULTS appended only)
- `packages/layout/src/platform-rules.ts`, `packages/layout/src/chrome-deviations-dpr.ts` (entries with a capture and a fault)
- `packages/layout/src/index.ts` (append-only exports)
- `packages/layout/generated/**` (native:gen output only)
- `packages/layout/vectors/**` (new files; existing files input-only under ruling 1), `packages/layout/vectors/README.md`
- `packages/layout/test/calc*.test.ts`, `packages/layout/test/environment*.test.ts`, `packages/layout/test/font-metric*.test.ts`; existing count pins in `packages/layout/test/*.test.ts` converted to derived counts only
- `packages/translate/src/corpus.ts`, `packages/translate/src/corpus-dpr.ts`, `packages/translate/harness/harness.ts` (additive suites and input migration)
- `packages/translate/corpus.json`, `packages/translate/corpus-dpr.json`, `packages/translate/corpus-m1-cases.json` (native:gen lock output only)
- `packages/dragon/src/css/math.ts`, `packages/dragon/src/css/values.ts`, `packages/dragon/src/css/units.ts`, `packages/dragon/src/css/README.md`, `packages/dragon/src/css/properties/**` (feature keys only)
- `packages/dragon/src/analysis/computed.ts`, `packages/dragon/src/analysis/computed-checks.ts`
- `packages/dragon/src/lower/ios-layout.ts`, `packages/dragon/src/lower/native-program.ts` (the `font` write only)
- `packages/dragon/src/internal.ts` (`Environment` and exports only)
- `packages/dragon/src/faults.ts` (appended), `packages/dragon/src/diagnostics/catalogue.ts` (one entry per line), `packages/dragon/test/diagnostic-codes.json` (append-only)
- `packages/dragon/src/emit/uikit.ts`, `packages/dragon/src/emit/android-views.ts` (case-input constructor line and font write only)
- `packages/dragon/src/emit/expected-dump.ts` (`programInput` and the pass call only)
- `packages/dragon/src/emit/native-support.ts` (the pass call, resolved font size, FontData reader fields, `engineValue` encoders for the new leaves)
- `packages/dragon/src/profiles/*.ts` (profile:rows output only)
- `packages/dragon/test/math.test.ts`, `packages/dragon/test/units.test.ts` (refusal assertions swapped for acceptance only), `packages/dragon/test/seams.test.ts` (append-only pins)
- `packages/parity/src/native-host.ts` (`programInput` environment and the pass call only)
- `packages/parity/src/fixtures.ts` (one appended group entry), `packages/parity/src/fixture-groups/font-values.ts` (new), `packages/parity/fixtures/*` (new files only)
- `packages/parity/expected/**`, `packages/parity/expected-dpr/**` (new files only), `packages/parity/emitted/**` (new bodies; headers relaxed)
- `packages/parity/test/font-values.test.ts` (new); existing count pins in `packages/parity/test/*.test.ts` converted to derived counts only
- Phase B: `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**`, `packages/parity/expected-pixels/**` (new case files and appended manifest entries only)
- `packages/parity/out/lanes.json`, `examples/music-player/dragon/north-star-check.json`, `packages/wpt/expectations/*.json` (generator output only)
- `docs/goals/milestone-2-proof/notes/T012a-v2a-value-model.md` (Worker note)

### Verify (V2a)
Every command runs as `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt && <command>`; BASE is the recorded base sha.
1. `pnpm install --frozen-lockfile`
2. `pnpm run layout:subset` (0 violations)
3. `pnpm typecheck`
4. `pnpm test` (BASE's `vitest list` a subset of HEAD's; no skip, `.only` or `.todo`; `git diff --diff-filter=MD --name-only BASE -- '*/test/*'` lists only the pins above)
5. `pnpm run native:gen && pnpm run native:swift && pnpm run native:kotlin && pnpm run native:planted -- --target swift && pnpm run native:planted -- --target kotlin` (pre-existing suites keep count and results; plants unchanged)
6. `pnpm run layout:vectors && pnpm run layout:dpr-vectors`, then the output check: `node -e 'const {execSync:x}=require("child_process"),fs=require("fs"),B=process.env.BASE;let bad=0;for(const f of x("git diff --diff-filter=M --name-only "+B+" -- packages/layout/vectors").toString().split("\n").filter(f=>f.endsWith(".json"))){const a=JSON.parse(x("git show "+B+":"+f)),b=JSON.parse(fs.readFileSync(f));if(!("output" in a)||JSON.stringify(a.output)!==JSON.stringify(b.output)){console.log("changed",f);bad++}}process.exit(bad?1:0)'` exits 0
7. `pnpm run parity:capture && pnpm run parity:dpr-capture && git diff --diff-filter=MD --exit-code BASE -- packages/parity/expected packages/parity/expected-dpr` (existing emitted files differ in relaxed header lines only)
8. `pnpm run parity:report && pnpm run parity:dpr-report` (failed 0; failed 0 at 2, 3 and 2.625; Chrome-dual strings equal for every new fixture)
9. `pnpm run profile:rows && git diff --stat BASE -- packages/dragon/src/profiles` (only declared new rows; no existing row changes; no ios or android row promoted)
10. Planted faults: each of the 9 fails its named fixture or vector with its named kind; the unfaulted run passes.
11. `pnpm run native:build -- --target ios && pnpm run native:build -- --target android` (derived case count; Android floor 0 references above 31; pre-existing case sources differ from a BASE build only on the case-input line and the font write, shown by a normalised diff in the note)
12. `pnpm run native:encoders -- --target swift && pnpm run native:encoders -- --target kotlin` (all valid and equal; 4/4 plants caught)
13. `pnpm run parity:lanes -- --run-host`
14. `pnpm run north-star:check && pnpm run wpt:update-expectations` (refusals only shrink; no WPT pass becomes a fail; each new fail has a written reason)
15. Protected paths, `git diff --exit-code BASE -- <path>` on: packages/parity/src/{chrome,capture,pipeline,compare,dpr,dual,targets,lanes,samples,native-compare,native-dump,report,render,device-run,device-lanes,device-vectors,line-breaks,pixel-reference}.ts; packages/translate/src/{emit-swift,emit-kotlin,lower,ir,walk,check,templates,prelude-swift,prelude-kotlin,generate,subset,faults}.ts; package.json; .github
16. `git diff --name-only BASE..HEAD` lies inside allowed_files; `git remote -v` is empty
17. Phase B, with the PM's device lease: `pnpm run layout:break-vectors && pnpm run parity:break-capture && pnpm run parity:pixel-capture` (files added for V2a cases only; engine equals Chrome breaks N/N), then `pnpm run parity:lanes -- --run-host --run-device` (no `not run` lane; layout-vectors-device equals host on both targets; device-frames, device-applied and device-lines pass on both targets; no device-pixels failure on a V2a case beyond master's recorded list) and `pnpm run parity:lanes -- --require-all` (same verdict as master)

### Stop if (V2a)
- BASE lacks P5 (T007) or V1 Phase B (T009) on master; or rulings 1, 2, 3, 5, 7 and 8 are not recorded.
- P6, T011, INL1 or casc-logical is in flight on a file in this allowed_files list (ruling 5).
- A file outside allowed_files is needed, in particular any protected path in verify 15, `FixtureSpec`, a platform environment read, or a break, fit or leading change in inline.ts.
- Any existing engine output changes: a vector `output`, a capture, an expected-dpr file, an emitted body, a profile row, a pre-existing native case source beyond the input line and font write, a WPT pass, or a lanes check.
- Float arithmetic is needed outside units.ts, or the translator core must change.
- A (verify) point disagrees with Chrome and Blink 145.0.7632.6 does not explain it; ex/ch/cap on Ahem disagree with Chrome after the arithmetic is checked.
- A planted fault is not caught.
- Any tolerance, gate, case, DPR or direction would be loosened, skipped or reduced.
- Verification fails twice. Fallback split (only then): V2a-1 (environment fields, env(), sv/lv/dv, em and rem leaves, FontSpec) and V2a-2 (ex/ch/cap/lh/rlh), both on the same files in series.
- Phase B: the lease is not held; a non-pixel device lane fails on any case; V2a cases add device-pixels failures; a simulator or AVD fails to boot twice.

## 5. Worker package V2b (environment runs; after V2a merges and after INL1 per ruling 5)

- **Worktree / branch:** `/tmp/dragon-v2b`, branch `v2b-environment-runs`, from master after V2a (and INL1 unless the PM rules otherwise).
- **Objective.** `FixtureSpec.viewports` (existing fixtures keep exactly 400x300 and their case ids; new cases at 390x844, 393x851,
  412x915, 320x568 and 844x390 for the viewport fixtures only); a pinned text-scale table (iOS content-size categories xS to AX5;
  Android fontScale 0.85, 1.0, 1.3 and 2.0) captured from the simulator and emulator; scaled-root Chrome captures with
  `:root { font-size: S(r)px !important }` for the `font-values` and rem fixtures; the native runtimes reading the real environment
  (root view bounds for all three viewport sizes, root-view safe-area insets, S(r)) and re-laying out when `environmentDependencies`
  says an input changed; the environment record in the device dump (a `NATIVE_DUMP_SCHEMA` bump) with an additive environment check;
  device matrix entries sized for the new viewports (ruling 6); a device probe that changes content size or font scale and checks
  re-layout against the engine at the new `rootFontSize`.
- **Allowed files:** `packages/parity/src/fixtures.ts`, `packages/parity/src/chrome.ts`, `packages/parity/src/capture.ts`,
  `packages/parity/src/pipeline.ts`, `packages/parity/src/dpr.ts`, `packages/parity/src/targets.ts`, `packages/parity/src/lanes.ts`,
  `packages/parity/src/native-host.ts`, `packages/parity/src/native-dump.ts`, `packages/parity/src/native-compare.ts` (additive
  environment check), `packages/parity/src/device-run.ts`, `packages/parity/src/cli/**`, `packages/parity/src/text-scale.ts` (new),
  `packages/parity/src/fixture-groups/viewports.ts` (new), `packages/parity/fixtures/*` (new files only),
  `packages/parity/expected/**`, `packages/parity/expected-dpr/**`, `packages/parity/expected-text-scale/**` (new files only),
  `packages/parity/emitted/**` (new bodies; headers relaxed), `packages/dragon/src/emit/native-support.ts` (environment reads,
  listeners, dump record), `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**`, `packages/parity/expected-pixels/**`
  (new case files only), `packages/parity/test/viewports.test.ts`, `packages/parity/test/text-scale.test.ts` (new), the lanes and
  native-dump schema pins in `packages/parity/test/*.test.ts` (append-only), `packages/parity/out/lanes.json`, `package.json` (one
  script hunk, no dependency), `docs/goals/milestone-2-proof/notes/T012b-v2b-environment-runs.md`.
- **Verify** (same env prefix): V2a verify 1-4, 7-9 and 11-16 with this package's protected list (packages/layout/src/**,
  packages/translate/**, packages/dragon/src/{css,analysis,lower}/**, emit/{uikit,android-views,expected-dump}.ts, .github); the
  text-scale capture run twice byte-identical; engine at every table `rootFontSize` equals the scaled-root Chrome capture at DPR 1, 2, 3
  and 2.625 (failed 0); `pnpm run native:devices` shows each new viewport held by a device window; on the lease, the content-size and
  font-scale probe on both platforms reports `rootFontSize` equal to the pinned table and a re-layout equal to the engine, then restores
  the default; `pnpm run parity:lanes -- --run-host --run-device` with no `not run` lane and the viewport cases in every device lane;
  `--require-all` same verdict as master.
- **Stop if:** V2a is not on master or rulings 4 and 6 are not recorded; an existing capture, case id, vector or emitted body changes;
  a device window cannot hold a viewport case (never crop); the device-reported S(r) differs from the pinned table (OS drift: owner);
  a platform environment read needs a file outside allowed_files; the lease is not held; verification fails twice.

## 6. Required board updates (PM)
- T012 done with this note. Add V2a (Worker) and V2b (Worker) with the packages above; V2a blocked on T007 merged, T009 Phase B merged
  and rulings 1, 2, 3, 5, 7 and 8; V2b blocked on V2a merged, INL1 per ruling 5, and rulings 4 and 6.
- Add integrator merges after each: native:gen, layout:vectors, layout:dpr-vectors, native:swift, native:kotlin (roadmap §3.4).
- INL1 depends on V2a (not V2b). P7's largest-text-size run depends on V2a and V2b.
- Put rulings 1, 2, 3, 4 and 6 to the owner; record 5, 7 and 8 as PM rulings; amend "Device text size" per ruling 2.
