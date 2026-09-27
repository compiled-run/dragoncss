# T038 S5: T039 must-fix M1-M4, full report and summary.md, platform keying and the Linux workflow, determinism, browser-worker and packed-consumer checks, vector format, api.md §10 items, T005 recs 2, 3, 5, 6

Worker, 2026-09-27, claude-code. Board: `docs/goals/milestone-1/state.yaml`, task T038. Spec: "S5 objective (binding)" in `notes/T039-s4b-review-s5-plan.md`; standing engine rules from `notes/T022-own-layout-plan.md`. Base: 45d7b83 (S4b note). Code commit: 7873ee0, local only. Nothing was pushed, and the repository has no remote.

## Flags for T999 (read first)

1. **One existing deviation is contradicted by measurement (stop_if: "Blink source or measurement contradicts an existing deviation").** I recorded it with its nodes, finished the slice, and am flagging it here.
   - The spec-reading fault of `auto-margin-overflow-cross-start` (`autoMarginOverflowSpec`) leaves all 9 registered nodes exact (`am-a`, `am-b`, `am-c`, `amc-a`, `amc-b`, `amc-c`, `amr-a`, `amr-b`, `amr-c`).
   - The captures show why. Each of these nodes fills its flex line exactly. For example, `am` has a 20px content box, but its one line is 30px, from y 132.296875 to 162.296875. A wrap-reverse container is multi-line, so each line is as big as its largest item (css-flexbox-1 §9.4 step 8), and the §9.6 step 13 overflow rule never applies.
   - The "10px past the container" placement comes from packing the line at the cross-start edge. The spec does the same thing.
   - The entry keeps its nodes, which are all exact. It is marked `finding: { kind: 'contradicted', detail }`, and report.json and summary.md state the finding.
   - Its M2 test asserts the contradiction: the nodes stay exact under the fault. If that ever stops being true, the test fails.
   - **T999 should rule** whether to retire the entry. The engine's `wrapReverse ? available : ZERO` branch is only reached with `available === 0`, where both readings agree.
2. **I corrected the node registration of `min-max-end-margin`.** The spec-reading fault (CSS 2.1 §8.3.1: a min-height of zero is needed to collapse the last child's bottom margin) showed three things:
   - `p4`: both readings give 40px.
   - `p6`: max-height sets the height in both readings. Only the next sibling moves.
   - `p7`: Chrome's collapse-through is also the spec reading.

   So these three do not distinguish Blink from the spec. They are now `controls`: they are still asserted exact, and under the fault they must keep their rect relative to their frame.

   The distinguishing nodes are now:
   - `dropped`: `p9`, and the new `x6`;
   - `collapsed-through`: `p5`, and the new `x5`.

   I rewrote the `spec` text to quote the CSS 2.1 rule, because the old wording did not mention max-height. The existing `branchOf` assertions were updated to match.
3. **No new deviation or platform rule** was added beyond the M1 column branches of `wrap-reverse-baseline-line`.
4. **Changed after a run:** before any Chrome run, `scripts/gen-baseline-source-matrix.ts` and the new hand-written fixture `flex-baseline-column-wrap-reverse` gained `min-width: 0` on their column containers. The generator's first dry run (compile plus engine only, no Chrome) had refused the 16 multi-line column sources with `flex-intrinsic-wrap-column`, because `min-width: auto` asked for their intrinsic size. The T039 probe shape uses `min-width: 0`. Both printed selections are quoted below. No fixture, generated or hand-written, changed after it ran in Chrome.

## Result

| | Count |
|---|---|
| Fixtures | 137 (135 at 45d7b83): 116 layout (101 HTML, 15 tree), 21 reject |
| Layout fixtures, hand-written | 111 (110 at 45d7b83, plus `flex-baseline-column-wrap-reverse`) |
| Layout fixtures, generated | 5: `profile-initial-values-box`, `profile-initial-values-text`, `gap-contexts`, `color-syntax-matrix`, `baseline-source-matrix` (new) |
| Fixtures passing | 137 of 137; failed 0 |
| Parity cases | 258: ltr 163, rtl 95; all 258 pass both lanes |
| `linux-dragon-layout` (1 device px gate) | 258/258 cases; 8,671/8,671 compared nodes exact at 1/64 px (text 1,123/1,123, lines 1,507/1,507, 55 anonymous boxes) |
| `chrome-dual` | boxes 8,685/8,685; computed values 339,080/339,080; colour channels 37,453/37,453 |
| unsupportedCodes | `[]` |
| Profiles | revision `m1-s5`; 1,179 rows per target; 2,358 rows, of which 2,137 are exact and 221 caveat (iOS paint and overflow). No iOS paint row is exact |
| Tests | 20 files, 792 tests, in both runs |

Per file: dragon color 32, compile 40, diagnostics 33, s4a 24, s4b 13, s5 25 (new), text 15, tree 10, ua 12; layout engine 17, flow 30, inline 25, position 38, units 13, unsupported 1, validate 5, vectors 263; parity dist 6 (new), parity 178, platform 12 (new).

Nothing was loosened. The gate is still `GATE_DEVICE_PX = 1`, the dual lane still needs exact equality, and every layout fixture has gate `'default'`. No test is skipped or marked `.todo` or `.only`. No node, property or case is excluded, deduplicated or factored, and no generated fixture was dropped.

## Commands run (T038 verify list)

| # | Command | Result |
|---|---|---|
| 1 | `shasum pnpm-lock.yaml`, then `pnpm install --frozen-lockfile`, then `shasum` again | pass: "Already up to date"; lockfile `a3d7207d13280803df1ff2885d3f648f43918b1b` both times. Dependencies and devDependencies of all four package.json files equal 45d7b83: dragon `{css-tree: 3.2.1}` plus dev `@dragon/layout`; layout none; parity unchanged; root devDependencies unchanged. Root package.json gained only the `parity:platform-check` and `build` scripts; dragon's gained `files` and `publishConfig` |
| 2 | `pnpm typecheck` (`tsc -b`, including `planted/drop-field.ts` and `types.test-d.ts` with the new querySupport NoInfer negatives, the absent-target keys and the platform-option negative) | pass, exit 0 |
| 3 | Removed `packages/*/dist`, `dist-test`, `build`, `tsconfig.tsbuildinfo` and `packages/parity/out`, then ran `pnpm test` twice | pass: 20 files and 792 tests both times (82.5 s and 84.0 s). `cmp` shows report.json (12,889,090 bytes), index.html (2,952,982) and summary.md (4,260) byte-identical between the runs. The first try at this step did not remove the outputs (a zsh glob error), so I repeated it with explicit paths; the numbers here are from the repeat |
| 4 | `pnpm run parity:report`, then `test -s` on the three files | pass: "137/137 fixtures pass, 116 layout (111 hand-written, 5 generated; 258 cases, 258 pass; ltr 163/163, rtl 95/95); layout 8671/8671 nodes exact at 1/64 px (text 1123/1123, lines 1507/1507, 55 anonymous boxes); dual boxes 8685/8685, values 339080/339080, channels 37453/37453", then "failed 0; unsupportedCodes []; platform darwin-arm64; linux-chrome (linux-x64): unavailable (not run)". All three files are non-empty and byte-identical to the test run's |
| 5 | Regeneration on the committed tree: `node scripts/gen-granularity-fixtures.ts && node scripts/gen-baseline-source-matrix.ts && pnpm run grammar:gen && pnpm run ua:capture && pnpm run parity:capture && pnpm run layout:vectors && pnpm run profile:rows`, then `git diff --exit-code -- packages scripts .github` and `git status --porcelain --untracked-files=all` on the six directories | pass: exit 0 (G1 55 selected and 3 rejected; matrix 50 of 50 selected; 258 vectors; 1,179 rows per target). Diff exit 0; 0 untracked files |
| 6 | Base-capture check against 45d7b83 (`/tmp/t038/base-check.mjs`) | pass (output below) |
| 7 | report.json summary | 116 layout fixtures (at least 114), 111 of them hand-written (at least 110), none removed; failed 0; `unsupportedCodes: []`; all 258 cases in both environments pass both lanes; `run.platform` darwin-arm64; `run.unavailableLanes` lists linux-chrome (linux-x64) as "unavailable (not run)". Every exact row links to passing case ids that are in the report, and every proof id is a passing case (`casesPassingInReport` true for all 2,358 rows) |
| 8 | Guard test | pass (`platform.test.ts`, "no expected or emitted file names a platform default font…"). Only `block-ua-divs` keeps `Times`, and it equals the keyed dataset's html font-family |
| 9 | Platform tests | pass (`platform.test.ts`, 12 tests; list below) |
| 10 | Workflow test | pass: workflow_dispatch only; ubuntu-latest; Node '24', pnpm 10.33.2, Playwright checked to be 1.58.2; exactly the S5 steps; no secrets; no `darwin-arm64`; no remote |
| 11 | Determinism test (c) and its negative | pass (parity.test.ts) |
| 12 | Browser-worker test (d) | pass (dist.test.ts). css-tree's browser build gave results equal to Node for every fixture, so the generated-data fallback was not needed and `csstree-data.generated.ts` was not written |
| 13 | Consumer and publish-shape tests (f4, f5), and the f1-f3 tests | pass |
| 14 | Public-entry test | pass. The default entry exports exactly `createProject`, `formatDiagnostic`, `formatDiagnostics`, `querySupport` and `TREE_SCHEMA_REVISION`, and `createProject.length` is 1. `Environment`, `InternalOptions`, direction, platform and rootFont stay internal (compile.test, s4a.test, types.test-d). Derive and enforce digests differ; ltr and rtl digests differ; public and Ahem-environment digests differ |
| 15 | Profile-proof test | unchanged in strength, and passes: rows equal `deriveRows`; every proof names exactly the passing cases that use its key; every used key has a row; direction and axis facets; paint rows keyed `@paint/<dir>`; no iOS paint row is exact; the ltr-only proof blocks in rtl; paint structural tests (i)-(iii) |
| 16 | Planted tests | pass as before: swapBoxSizing, variantCollapse, colourOnly, stateCollapse, dropInheritedText, breakOffByOne, rtlAsLtr, ignoreOrder, baselineFromBorderTop, scrollMinAuto, absposInFlow, cbIgnoresPadding, staticPosLtr, relativeShiftsFlow, ignoreEnvironmentDirection, metricHalfUp and untruncatedFontSize. Spec-reading faults: see M2 below |
| 17 | Deviation and platform-rule test (MF5) | pass. Every branch has nodes and every node is exact at 1/64 px in every case. `wrap-reverse-baseline-line` has branches `shared-baseline`, `startmost-item`, `column-wrap-reverse` and `column-wrap-reverse-rtl`. Every `blink` field cites a file and lines at 145.0.7632.6 (none needed "measured; source not located"). Controls are exact |
| 18 | Baseline-source matrix | the selection is committed in `packages/parity/generated/baseline-source-selection.json` and printed below from before any Chrome run. 50 of 50 sources pass both lanes in both environments (840/840 nodes exact per environment) |
| 19 | Diagnostics | pass. `diagnostic-codes.json` only grows (one appended code, `DRAGON_MISSING_ASSET`). The rec 2, 3, 5 and 6 tests, the M3 flex-parent case and the M4 prefix pin pass. The applyFix, stale-fix and C6 tests pass; the C6 count of `refuseNode(` calls went from 3 to 5 (see deviations) |
| 20 | Case-count (MF1), text topology, fixture registry, committed-captures and distribution tests | pass |
| 21 | S1 greps | 0 matches each: no `node:`, fs, path, child_process, url, module or playwright imports in `packages/dragon/src` or `packages/layout/src`; only `import type` from `@dragon/layout` in `packages/dragon/src`; no `??`, `?:` or `?.` in `packages/layout/src`; Math rounding only in `units.ts`; no `Date`, `Math.random`, `performance.`, `process.` or `globalThis` in `packages/layout/src` |
| 22 | Colour conversion, web emitter, `render.ts` and harness | pass. Colour conversion is only in `css/color.ts`. The web emitter's import list is unchanged. `render.ts` imports exactly css-tree plus `import type` from dragon. Direction and the root font reach Chrome only through `chrome.ts` `harnessStyle`, and the test now also forbids `font-family: Ahem` in the renderers |
| 23 | Export map | `'.'` is `{dragon-internal, default}` in the workspace; the packed manifest has `{types, default}` pointing into `build/`, with no `publishConfig` left and no dragon-internal. layout and parity are private |

git is `/opt/homebrew/bin/git`. The PM's uncommitted files (`docs/` except this note, `README.md`, `state.yaml`) were neither touched nor committed. `git diff --name-only 45d7b83..HEAD` contains only allowed_files. Scratch files are under `/tmp/t038`.

## Baseline-source matrix selection (printed before any Chrome run)

First dry run of `node scripts/gen-baseline-source-matrix.ts`: compile and engine only, no Chrome. It gave "50 sources, 34 selected, 16 refused". All 16 refusals were `flex-intrinsic-wrap-column` on the multi-line column sources (`s-column-{wrap,wrap-reverse}-*` and `s-column-reverse-{wrap,wrap-reverse}-*`). The cause was `min-width: auto` on a column container that is a flex item; I changed it to `min-width: 0`, as in the T039 probe.

The committed selection (`/tmp/t038/matrix-selection.log`), printed before the first `parity:capture`:

```
baseline-source matrix: 50 sources, 50 selected, 0 refused
  s-{row,row-reverse,column,column-reverse}-{nowrap,wrap,wrap-reverse}-{ltr,rtl}[-bl]: 48 flex sources
    (4 items of Ahem 20, 12, 16 and 10px; nowrap on 1 line, wrap and wrap-reverse on 2 lines; -bl = align-items: baseline)
  s-block-ltr, s-block-rtl: a block container with a 20px and a 10px Ahem child (2 lines)
```

Each source is the baseline source of its own `align-items: baseline` row, beside an Ahem "X". The fixture runs in both environments. Results: both cases pass both lanes, with 840/840 nodes exact at 1/64 px in each. No source was refused.

## T039 must-fix items

- **M1, column wrap-reverse baseline.**
  - `flex.ts` now takes the baseline line as `axes.wrapReverse && !faults.wrapReverseBaselineSpec ? lines.length - 1 : 0` for rows and columns alike, following Blink's reversed line 0.
  - The new hand-written fixture `flex-baseline-column-wrap-reverse` runs in both environments. It covers:
    - ltr and rtl column wrap-reverse containers as baseline sources, each with 20px and 10px first items, in both item orders;
    - a 2-line tall container;
    - baseline-aligned columns;
    - nowrap and wrap controls.
  - Branches `column-wrap-reverse` (nodes `x1`, `x3`) and `column-wrap-reverse-rtl` (`x2`, `x4`) are registered.
  - Re-probe of the T039 finding: `x1` has Chrome top 3 and Dragon top 3 in both environments. Under the spec reading it is 8 px off, which fails the gate, as T039 measured.
- **M2, a spec-reading fault per deviation.** Each fault is an `EngineFaults` switch named in the deviation's `fault` field. Measured with the fault on (`/tmp/t038/faults.log`, largest absolute edge delta):

  | Deviation | Fault | Registered nodes with the fault on |
  |---|---|---|
  | half-leading-floor | `halfLeadingSpec` | `t3:text0`, `neg5:text0:line0`, `neg5:text0:line2` and `neg7:text0:line1` each off by 0.5 px (non-exact; inside the gate) |
  | min-max-end-margin | `minMaxEndMarginSpec` | `p9` 32 px, `x6` 20 px, `p5` 20 px and `x5` 6 px off, all failing the gate. Controls `p4`, `p6` and `p7` keep their rect in their frame |
  | auto-margin-overflow-cross-start | `autoMarginOverflowSpec` | all 9 exact: **contradicted**, flagged above |
  | wrap-reverse-baseline-line | `wrapReverseBaselineSpec` | `f2a` 31, `f1a` 31, `f4a` 9 and `o3a` 18 px off. `x1`, `x2`, `x3` and `x4` are 8 px off in both environments. All fail the gate |

  Tests: parity.test.ts "Chrome deviation <id> (M2): …", one per deviation, and "S5 records exactly one contradicted deviation…".
- **M3, abspos beside text.** I kept the refusal, since no fixture proves the flex case.
  - For a flex parent the message now says: "position: absolute on c beside text in the flex container p: the text becomes an anonymous flex item (css-flexbox-1 §4) and the absolutely positioned child is not a flex item (§4.1); milestone 1 does not lay out this combination".
  - Block parents keep the inline formatting context message.
  - Computed-check refusals (overflow and position) take the catalogue's new `computedWhy`, which claims no missing proof: "Milestone 1 refuses this value where its computed result or placement needs layout the engine does not model, so Dragon never guesses what Chrome would do."
  - Profile refusals keep the profile why.
  - `reject-abspos-in-inline` stays.
  - Tests: s5.test.ts "T039 M3: …" (3 tests).
- **M4, reject message prefixes.**
  - Reject specs carry `messagePrefix`. `reject-shorthand-filled` pins `'border-top-style:none'`, which now matches "border-top-style:none (set by border: 3px) on … is used in the relative-in-block/ltr context…".
  - The profile-independent unit test drops every `border-top-style:none` row from a copy of the profiles, passed through the new internal `supportProfiles` option. `border: 3px` is still refused with "border-top-style: none (set by border: 3px) is unsupported…" at `3px` (s5.test.ts "T039 M4: …").

## (a)-(g) mapped to named tests

- **(a) Report.** `report.json`, `index.html` and `summary.md` are written by the test and by `parity:report`, and are byte-identical.
  - Existing content: per-node Chrome, Dragon and delta rects; exact-LU and dual counts; anonymous and line nodes; per-environment counts.
  - New in `run`: `platform`, `referencePlatform`, `browser`, `flags`, `rootFont`, `oracleLane`, `scope` (quoted from decisions.md) and `unavailableLanes` (Linux lane "unavailable (not run)").
  - New `profileRows`: every row with its proof case ids, and `casesPassingInReport`.
  - New `caseRows`: every case linked back to the rows it proves.
  - `deviations` and `platformRules` list branch, node and per-case exactness, plus the finding.
  - `summary.md` gives the scope, the oracle lane, the Linux lane as unavailable, total, hand-written and generated layout fixtures, failed, unsupportedCodes and the deviation table. It notes that there are no screenshots and that the drawings are evidence, not a gate.
  - Tests: parity.test.ts "writes the report and summary.md: …"; step 4 above.
- **(b) Platform keying.**
  - Captures carry `platform` and `browser`, under `expected/darwin-arm64/`.
  - Vectors carry `platform` and `measurer`.
  - `REFERENCE_PLATFORM = 'darwin-arm64'` is explicit in all three packages and asserted equal.
  - The Ahem root environment is applied through `harnessStyle` (`:where(html){font-family:Ahem}`) and through `Environment.rootFont`, and reported as cascade `environment`.
  - The UA dataset is `ua/chrome-145.darwin-arm64.generated.ts` with a `platform` field. `ua:capture` refuses another platform's file.
  - A reference environment on another platform: `createProjectWith` throws `ReferencePlatformUnavailable` (code `no-ua-dataset`). The digest includes the dataset platform and the root font.
  - The measurer is keyed: `measurerFor(platform)` gives `no-platform-rules` for linux-x64.
  - `.github/workflows/parity.yml` is written and not pushed.
  - `parity:platform-check <platform>` (src/platform-check.ts, cli/platform-check.ts) makes the hard checks (1)-(3) and reports geometry information. The live suite's `beforeAll` calls `requireReferencePlatform`.
  - Tests: platform.test.ts (all 12), s5.test.ts "the Ahem root environment…", parity.test.ts rtl-coverage harness assertions.
- **(c) Determinism.**
  - Every fixture in both environments is compiled twice, and also with shuffled snapshot sources, assets and resolutions, tree modules, components and style use definitions. Digest, sorted diagnostics, dependencies and outputs are equal. Both lanes are re-run on the shuffled input, and the fixture outcome and report are equal.
  - The negative case swaps `document.styles` of `tree-ordered-sheets`, which changes the digest and the CSS.
  - An assets, resolutions and targets-order unit test covers the rest.
  - The digest now sorts order-free lists and targets; the registry `sources` and the source dependencies are sorted by URI.
  - Tests: parity.test.ts "determinism (S5 (c)): …" and "determinism negative: …"; s5.test.ts "(c) the digest does not depend on the order of assets, resolutions or configured targets".
- **(d) Browser Worker.**
  - `pnpm run build` (scripts/build-dist.ts) runs the installed TypeScript with `tsconfig.build.json` (rewriteRelativeImportExtensions, stripInternal, removeComments). It emits JS and .d.ts into gitignored `build/`. dragon's build leaves out `internal.ts` and every `@internal` declaration.
  - The Worker is served through Playwright routes. Bare specifiers resolve as `@dragon/layout` → its built index and `css-tree` → its `./dist/csstree.esm`, because `lib/` imports source-map-js, which is CommonJS. No bundler is used.
  - Tests: dist.test.ts "(d) browser Worker…" (4 tests: exports, every fixture compiled equal to Node, all 258 vectors byte for byte, and no createRequire, `module` or `node:*` imports and no outside request).
- **(e) Vectors.** `packages/layout/vectors/README.md` documents the format, the required fields, LU units, the id and parent order, the output order, and the platform and measurer keys. Tests: vectors.test.ts "(e) the documented vector format…" (3 tests), plus every vector checked for its platform and measurer keys.
- **(f) api.md §10 items.**
  - (f1) s5.test.ts "(f1) missing assets…". There are 5 reason cases, each `DRAGON_MISSING_ASSET` blocking every output, plus a clean case. The new code was needed because no existing why is literally true for a missing source or asset or a bad asset hash.
  - (f2) s5.test.ts "(f2) querySupport…" (4 tests); types.test-d.ts has the ios-on-web-only, android, condition-shape, candidate-status and tolerance negatives.
  - (f3) s5.test.ts "(f3) whole-snapshot replacement" (2 tests).
  - (f4) dist.test.ts "(f4) plain node without --conditions…". It covers the export set, 4 deep paths refused, compile equal to the workspace, and `tsc --noEmit` over the packed .d.ts with `skipLibCheck: false` and @ts-expect-error cases.
  - (f5) dist.test.ts "(f5) the packed package.json has publishConfig applied…".
- **(g) T005 recs.**
  - rec 2: s5.test.ts "T005 rec 2: …" (gap sets column-gap, which is unproven, so "write row-gap: 7px instead of gap"; located at the value, with the declaration related). compile.test "checks longhands a shorthand fills" covers `border` (set by).
  - rec 3: s5.test.ts "T005 rec 3: …" (T005 R3 through the public entry gives AT_RULE, FONT and UNPROVEN_CONTEXT in one pass; top-level and nested at-rules get related entries starting with the code, and nothing is emitted).
  - rec 5: s5.test.ts "T005 rec 5: …".
  - rec 6: s5.test.ts "T005 rec 6: …" ("display: grid is unsupported (support profile m1-s5); in block/ltr use block, flex or none").
  - rec 1 (S4b) and rec 4 (S4b) are unchanged.
  - Blink citations: see below.

## Blink citations (tag 145.0.7632.6, fetched read-only with curl into /tmp/t038)

| Entry | Citation |
|---|---|
| half-leading-floor | `third_party/blink/renderer/core/layout/inline/line_utils.cc` lines 32-41, `CalculateLeadingSpace`: `((line_height - LineHeight()) / 2).Floor()` |
| min-max-end-margin | `core/layout/block_layout_algorithm.cc` lines 1311-1316 (the intrinsic size leaves out the pending end margin) and 1365-1375 (the end margin strut is dropped when the used block size differs from the intrinsic one) |
| auto-margin-overflow-cross-start | `core/layout/flex/flex_layout_algorithm.cc` lines 264-276 (`ResolvedAlignSelf`: an auto cross margin forces flex-start before the wrap-reverse swap), 1868-1877 (the auto-margin space is clamped to zero) and 1928. The measured finding above still stands |
| wrap-reverse-baseline-line | `flex_layout_algorithm.cc` lines 1581-1583 (`ApplyReversals`), 1759-1763 (first line is index 0; `AccumulateLine` only when `!is_column_`), 1945-1946 (`AccumulateItem`), and 88-96 (the first-line fallback) |
| ahem-metric-half-down (platform rule) | `platform/fonts/font_metrics.cc` lines 111-112 (`SkScalarRoundToScalar`) and 114-126 (the Linux 1 px borrow). The macOS half-down is still inferred from CoreText |
| font-size-truncation (platform rule) | `platform/fonts/font_description.cc` lines 268-279 (`EffectiveFontSize` floors size × 100 / 100) with `font_cache_key.h` line 53 (`kFontSizePrecisionMultiplier = 100`). The code is not platform-specific; the rule stays keyed to darwin-arm64, the only platform measured |

## Base-capture check output

```
base 45d7b83: 254 expected files, 6773 nodes, 294280 computed values compared; font-family Times -> Ahem on 1680 element records in 113 Ahem-environment fixtures; block-ua-divs unchanged
every expected file gained exactly the fields browser and platform (chromium-headless-shell, darwin-arm64)
emitted CSS: 160 files, 160 digest header lines changed, 1208 "font-family: Times" lines became "font-family: Ahem", no other change
vectors: 254 files, 6814 output rects identical, inputs identical; added fields platform and measurer only
PASS: no node that existed at 45d7b83 changed kind, hasBox, geometry or order; no computed value changed except font-family Times -> Ahem on the Ahem root environment; no node was added or removed
```

The check ran on the committed tree after the step 5 regeneration. It maps each 45d7b83 capture `expected/<case>.web.json` to `expected/darwin-arm64/<case>.web.json`.

## Deviations from the task text

1. **Two registry corrections.** The `auto-margin-overflow-cross-start` finding and the `min-max-end-margin` controls come from the M2 faults (flags 1 and 2). `ChromeDeviation` gained `fault`, `finding` and `controls`.
2. **The spec reading of min-max-end-margin** is CSS 2.1's wording: a zero min-height is needed for collapse, and max-height plays no part. The old `spec` text is replaced.
3. **The Linux lane's chrome-dual check** (`parity:platform-check`, check 3) renders Dragon's output compiled for the darwin-arm64 reference environment in that platform's Chrome.
   - Fixtures on the UA-default root font (`block-ua-divs`) are listed as refused there, because their compiled CSS pins the reference platform's UA font and Linux has no dataset.
   - Check 2 exempts only `font-family` in those fixtures.
   - None of this could run here: there is no Linux Chrome.
4. **The public `createProject`** compiles with `rootFont: 'ua-default'`, which is unchanged behaviour. The Ahem root environment is the parity fixture environment only, selected through the internal options.
5. **FONT diagnostics now come from the analysis** (`checkFonts`, using the lowering's own message) rather than from the lowering, so they appear even when another error blocks ios (rec 3). The text, code, origin and target are unchanged.
6. **Target-null errors other than `DRAGON_UNSUPPORTED_AT_RULE` still stop resolution.** An unsupported at-rule blocks every output but no longer stops the analysis.
7. **The `DRAGON_UNSUPPORTED_VALUE` and `DRAGON_UNPROVEN_CONTEXT` messages no longer name the target** in their text, so ios and web can be grouped by `formatDiagnostics`. The `target` field and `profile.target` still name it. The UNPROVEN message starts with the feature, then "(set by <shorthand declaration>)" when a shorthand filled it.
8. **The C6 source-scan test** now expects 5 `refuseNode(` occurrences (it was 3). They are the definition plus two callers inside an unsupported at-rule for rec 3. Nothing is skipped: a declaration directly inside a top-level at-rule has no selector and is not analysed, and the at-rule itself is always refused.
9. **The registry test** now reads two committed selection files. The cap of "at most 4 generated" (an S4b rule) became "hand-written at least 110" plus "the generated fixtures are exactly the selections".
10. **Profile revision** `m1-s4b` → `m1-s5`. There are 4 new rows per target, from the two new fixtures.
11. **Test ENV constants in dragon tests** gained `rootFont: 'ua-default'`, and s4a, s4b and ua tests pass the reference dataset to `initialValue`, `defaultOrigin` and `lowerStyle`, whose signatures now take it.
12. **dist.test.ts** writes its pack and consumer directories under `/tmp/dragon-s5-*` and removes them afterwards.

## What T999 must know

- **Rule on the `auto-margin-overflow-cross-start` finding** (flag 1). Everything else in the deviation registry is distinguished by its fault.
- **Oracle lane:** macOS-captured Chrome 145.0.7632.6 (darwin-arm64) plus the platform-free Dragon layout lane. The Linux lane is unavailable (not run). The workflow is written, with workflow_dispatch only, and not pushed. No Linux value was hand-written or captured.
- **The CSS 2.1 min-height reading** used for the M2 fault comes from memory of CSS 2.1 §8.3.1 ("a 'min-height' of zero"). The spec text was not re-downloaded.
- **Browser worker:** the css-tree browser build (`dist/csstree.esm.js` reports version 3.2.0 inside the 3.2.1 package) gave compiles equal to Node's for all 137 fixture inputs, so no data fallback was committed.
- **Still open:**
  - owner visibility of the iOS caveat cap (221 caveat rows);
  - Linux baselines unmeasured;
  - the macOS half-down metric rule is inferred, not traced.
