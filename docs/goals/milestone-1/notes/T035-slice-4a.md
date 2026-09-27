# T035 S4a: rtl, order, reverse and wrap-reverse flex, baselines, scroll containers, rtl environment, S3b must-fix C1-C6

Worker, 2026-09-27, claude-code. Board: `docs/goals/milestone-1/state.yaml`, task T035. Spec: "S4a objective (binding)" and "Addendum: second T031 pass" in `notes/T031-s3b-review-s4a-plan.md` (the addendum wins where it is more specific); standing rules from `notes/T022-own-layout-plan.md`. Base: a82b849 (S3b). Code commit: a16f7e3, local only, not pushed.

## Result

| | Count |
|---|---|
| Fixtures | 97 (69 in S3b): 79 layout (65 HTML, 14 tree), 18 reject (12 HTML, 6 tree) |
| New fixtures | 28: 21 layout (20 HTML, 1 tree) and 7 reject |
| Fixtures passing | 97 of 97; failed 0 |
| Parity cases | 181: 123 ltr (65 HTML + 58 tree) and 58 rtl (tree); 181 pass both lanes |
| `linux-dragon-layout` (1 device px gate) | 181 of 181 cases pass; 3,521 of 3,521 compared nodes exact at 1/64 px (informational) |
| Text nodes / per-line fragments | 375 of 375 / 579 of 579 exact; 146 text nodes wrap to 2 or more lines |
| Anonymous boxes (Dragon only, listed in the report) | 29, each with every text line compared |
| `chrome-dual` | boxes 3,535 of 3,535; computed values 134,212 of 134,212; colour channels 15,861 of 15,861 |
| LayoutUnsupported hits | none (`unsupportedCodes: []`) |
| Profiles | ios 449 rows (356 exact, 93 caveat), web 449 rows (all exact), revision `m1-s4a`; 145 iOS rows carry the `rtl` facet |
| Tests | 15 files, 562 tests, both runs |

Per environment:

| Direction | Cases | Layout lane | Dual lane | Nodes exact | Text | Lines | Anon | Dual boxes | Values | Channels |
|---|---|---|---|---|---|---|---|---|---|---|
| ltr | 123 | 123 pass | 123 pass | 2958/2958 | 306/306 | 495/495 | 25 | 2972/2972 | 112892/112892 | 13332/13332 |
| rtl | 58 | 58 pass | 58 pass | 563/563 | 69/69 | 84/84 | 4 | 563/563 | 21320/21320 | 2529/2529 |

Nothing was loosened. The 1 device px gate and the exact dual equality are unchanged. No fixture, case, node or property is skipped, excluded, narrowed, deduplicated or factored; symmetric rtl cases run like any other. No Chrome rect is filtered, and no fixture has its own tolerance. C1 ended in a passing proof, not a narrowing (see C1 below).

## Commands run (T035 verify list)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass ("Already up to date"); `pnpm-lock.yaml` unchanged (`shasum -c`); `git diff HEAD` empty for `package.json`, the lockfile, the three package manifests, `tsconfig*` and `vitest.config.ts` |
| `pnpm typecheck` (`tsc -b`, includes `planted/drop-field.ts` and `types.test-d.ts`) | pass (exit 0) |
| `pnpm test`, run 1 | pass: 15 files, 562 tests |
| `pnpm test`, run 2 | pass: 15 files, 562 tests; `packages/parity/out/report.json` byte-identical to run 1 (`cmp`) |
| Regeneration on the committed tree (a16f7e3): `pnpm run grammar:gen && pnpm run ua:capture && pnpm run parity:capture && pnpm run layout:vectors && pnpm run profile:rows`, then `/opt/homebrew/bin/git diff --exit-code -- packages scripts` and `git status --porcelain --untracked-files=all packages/dragon/src packages/parity/expected packages/parity/emitted packages/layout/vectors` | pass: regeneration exit 0, diff exit 0, 0 untracked files |
| Base-capture check (`/tmp/t035/base-check.mjs`, output below) | pass, after the regeneration |
| `pnpm run parity:report`, then `test -s` on `out/report.json` and `out/index.html` | pass: "97/97 fixtures pass, 79 layout (181 cases, 181 pass; ltr 123/123, rtl 58/58); layout 3521/3521 nodes exact at 1/64 px (text 375/375, lines 579/579, 29 anonymous boxes); dual boxes 3535/3535, values 134212/134212, channels 15861/15861"; the CLI report equals the test-run report byte for byte |
| `report.json` summary | 79 layout fixtures (at least 75); failed 0; `unsupportedCodes: []`; every layout case, rtl included, has `linux-dragon-layout: pass` and `chrome-dual: pass`; `anonymousBoxes`, line counts, `caseCounts` per environment, `casesByDirection` and each case's `direction` listed |
| Case-count check (MF1, per environment) | pass: declared = renderer = Dragon for ltr and rtl, one initial case per direction; tree cases from the S3b fixtures 114 (= 2 x 57) |
| rtl coverage test | pass: each tree fixture has exactly one ltr and one rtl case per declared assignment (`<case>` and `<case>-rtl`), each with its own committed capture whose file-level `direction` and root computed `direction` match |
| Profile-proof test | unchanged in strength: rows equal `deriveRows` exactly; every proof names exactly the passing cases that use its key; every used key has a row. Every context has a direction facet, the flex text contexts a main-axis facet; every text row context (12) has a proving case with a text node on 2 or more lines; no iOS paint row is exact, overflow included; every proving case of a `/rtl` row has an rtl element in its Chrome capture and every `/ltr` proof an ltr one; `block-min-max` compiled in the rtl environment blocks with `DRAGON_UNPROVEN_CONTEXT` naming only `/ltr` proofs |
| Planted tests | pass: box-sizing swap, variantCollapse, colourOnly, stateCollapse (now 24 of 32 cases fail, in both directions), dropInheritedText, breakOffByOne as before; rtlAsLtr, ignoreOrder, baselineFromBorderTop and scrollMinAuto each fail the layout lane on named nodes while chrome-dual passes, and pass with the fault off (table below) |
| Text topology test | pass for every case of all 14 tree fixtures in both directions; swapping the declared ltr and rtl contexts fails all 8 projected-text cases |
| Engine unit tests and vectors | pass: `flow.test.ts` (29) pins rtl margins, rtl text-align offsets including overflowing lines, order stability, reverse and wrap-reverse placement, baselines (text, nested, synthesized, column), the scroll-container minimum size and baseline clamp, fractional Ahem metrics and advances in LU; the validator rejects display none (C4), a mixed overflow pair and each malformed anonymous box (C6); `inline.test.ts` still rejects mixed children, text in flex and uncollapsed text; `vectors.test.ts` 181 vectors plus the missing-field fault; `unsupported.test.ts` every code raised, `bidi-neutral` included |
| Diagnostics tests and C6 | pass; `diagnostic-codes.json` grew by 2 (`DRAGON_UNSUPPORTED_NESTED_RULE`, `DRAGON_UNSUPPORTED_BIDI`), nothing removed or reordered |
| Public-entry test (MF2) | pass: the public entry exports `createProject`, `formatDiagnostic`, `TREE_SCHEMA_REVISION`; `createProject.length` is 1; `index.ts` names no Environment, InternalOptions or direction; `types.test-d.ts` has `@ts-expect-error` for importing `Environment` and passing `{ direction }`; derive and enforce digests differ; ltr and rtl digests differ |
| Deviation test (MF5) | pass: 3 deviations (one new, below), 6 branches, every branch has nodes, all 15 nodes exact at 1/64 px |
| S1 greps (no `node:`/fs/path/child_process/url/module/playwright imports in `packages/dragon/src` or `packages/layout/src`; only `import type` from `@dragon/layout`; no `??`, `?:`, `?.` in `packages/layout/src`; rounding only in `units.ts`; no `Date`, `Math.random`, `performance.`, `process.`, `globalThis` in `packages/layout/src`) | pass (0 matches each; the one `@dragon/layout` line is the closing line of the multi-line `import type` in `lower/ios-layout.ts`) |
| Colour conversion only in `css/color.ts`; the web emitter imports neither `lower/ios-layout.ts` nor `@dragon/layout` and matches no selectors | pass (grep plus `ua.test.ts`; the emitter is unchanged) |
| Renderer isolation | pass: `render.ts` imports exactly `css-tree` and `import type` from `dragon`; no renderer or reader file writes a direction or `dir=`; only `chrome.ts` writes the `data-dragon-harness` style, and both renderings are captured through it in the case environment (grep plus test) |
| Registry, committed-captures, distribution tests | pass |
| Dependency, private and export-map checks | pass, unchanged: dragon dependencies `{css-tree: 3.2.1}`; exports only `'.'` with `{dragon-internal, default}`; layout private with no dependencies; parity private |

Tests per file: dragon color 32, compile 40, diagnostics 33, s4a 24 (new), text 15, tree 10, ua 12; layout engine 17, flow 29 (new), inline 25, units 13, unsupported 1, validate 4, vectors 183; parity 124.

git is `/opt/homebrew/bin/git`. PM-owned uncommitted files (`docs/` except this note, `README.md`, `state.yaml`) were not touched or committed. Scratch files and probes are under `/tmp/t035`.

## Fixtures and match counts

Exact LU is informational; the gate is 1 device px. Lines: per-line text fragments exact / compared. Dual: boxes, computed values, colour channels. Anon: Dragon-only anonymous boxes over all cases.

| Fixture | Kind | Result | Cases (per environment) | Exact LU | Lines | Dual boxes | Values | Channels | Anon | Reject code |
|---|---|---|---|---|---|---|---|---|---|---|
| block-ua-divs | html layout | pass | 1 (ltr 1) | 9/9 | 0/0 | 11/11 | 572/572 | 66/66 | 0 |  |
| block-content-box-padding-border | html layout | pass | 1 (ltr 1) | 9/9 | 0/0 | 9/9 | 468/468 | 54/54 | 0 |  |
| block-border-box | html layout | pass | 1 (ltr 1) | 6/6 | 0/0 | 6/6 | 312/312 | 36/36 | 0 |  |
| block-percent-width-padding | html layout | pass | 1 (ltr 1) | 6/6 | 0/0 | 6/6 | 312/312 | 36/36 | 0 |  |
| block-min-max | html layout | pass | 1 (ltr 1) | 9/9 | 0/0 | 9/9 | 468/468 | 54/54 | 0 |  |
| block-auto-margin-center | html layout | pass | 1 (ltr 1) | 9/9 | 0/0 | 9/9 | 468/468 | 54/54 | 0 |  |
| flex-row-grow-shrink-basis | html layout | pass | 1 (ltr 1) | 25/25 | 0/0 | 25/25 | 1300/1300 | 150/150 | 0 |  |
| flex-min-max-freeze | html layout | pass | 1 (ltr 1) | 19/19 | 0/0 | 19/19 | 988/988 | 114/114 | 0 |  |
| flex-column | html layout | pass | 1 (ltr 1) | 14/14 | 0/0 | 14/14 | 728/728 | 84/84 | 0 |  |
| flex-wrap-gap-align-content | html layout | pass | 1 (ltr 1) | 33/33 | 0/0 | 33/33 | 1716/1716 | 198/198 | 0 |  |
| flex-justify-content | html layout | pass | 1 (ltr 1) | 45/45 | 0/0 | 45/45 | 2340/2340 | 270/270 | 0 |  |
| flex-align-items-stretch-center | html layout | pass | 1 (ltr 1) | 22/22 | 0/0 | 22/22 | 1144/1144 | 132/132 | 0 |  |
| text-ahem-single-line | html layout | pass | 1 (ltr 1) | 34/34 | 10/10 | 34/34 | 728/728 | 94/94 | 0 |  |
| color-syntax | html layout | pass | 1 (ltr 1) | 22/22 | 0/0 | 22/22 | 1144/1144 | 132/132 | 0 |  |
| color-border-sides | html layout | pass | 1 (ltr 1) | 11/11 | 0/0 | 11/11 | 572/572 | 66/66 | 0 |  |
| cascade-compound-variants | html layout | pass | 1 (ltr 1) | 15/15 | 0/0 | 15/15 | 780/780 | 90/90 | 0 |  |
| block-fractional-values | html layout | pass | 1 (ltr 1) | 10/10 | 0/0 | 10/10 | 520/520 | 60/60 | 0 |  |
| percent-height-chain | html layout | pass | 1 (ltr 1) | 12/12 | 0/0 | 12/12 | 624/624 | 72/72 | 0 |  |
| margin-collapse-siblings | html layout | pass | 1 (ltr 1) | 11/11 | 0/0 | 11/11 | 572/572 | 66/66 | 0 |  |
| margin-collapse-parent-child | html layout | pass | 1 (ltr 1) | 27/27 | 0/0 | 27/27 | 1404/1404 | 162/162 | 0 |  |
| margin-collapse-through | html layout | pass | 1 (ltr 1) | 27/27 | 0/0 | 27/27 | 1404/1404 | 162/162 | 0 |  |
| margin-collapse-min-height | html layout | pass | 1 (ltr 1) | 42/42 | 0/0 | 42/42 | 2184/2184 | 252/252 | 0 |  |
| margin-collapse-body | html layout | pass | 1 (ltr 1) | 5/5 | 0/0 | 5/5 | 260/260 | 30/30 | 0 |  |
| flex-auto-margins-main | html layout | pass | 1 (ltr 1) | 21/21 | 0/0 | 21/21 | 1092/1092 | 126/126 | 0 |  |
| flex-auto-margins-cross | html layout | pass | 1 (ltr 1) | 21/21 | 0/0 | 21/21 | 1092/1092 | 126/126 | 0 |  |
| flex-auto-margins-negative | html layout | pass | 1 (ltr 1) | 17/17 | 0/0 | 17/17 | 884/884 | 102/102 | 0 |  |
| flex-align-content-remaining | html layout | pass | 1 (ltr 1) | 42/42 | 0/0 | 42/42 | 2184/2184 | 252/252 | 0 |  |
| flex-align-content-odd | html layout | pass | 1 (ltr 1) | 80/80 | 0/0 | 80/80 | 4160/4160 | 480/480 | 0 |  |
| flex-wrap-line-grow | html layout | pass | 1 (ltr 1) | 27/27 | 0/0 | 27/27 | 1404/1404 | 162/162 | 0 |  |
| flex-intrinsic-wrap-column | html layout | pass | 1 (ltr 1) | 24/24 | 0/0 | 24/24 | 1248/1248 | 144/144 | 0 |  |
| intrinsic-percent | html layout | pass | 1 (ltr 1) | 29/29 | 0/0 | 29/29 | 1508/1508 | 174/174 | 0 |  |
| flex-nested | html layout | pass | 1 (ltr 1) | 25/25 | 0/0 | 25/25 | 1300/1300 | 150/150 | 0 |  |
| flex-percent-definite | html layout | pass | 1 (ltr 1) | 22/22 | 0/0 | 22/22 | 1144/1144 | 132/132 | 0 |  |
| flex-stretch-percent-minmax | html layout | pass | 1 (ltr 1) | 15/15 | 0/0 | 15/15 | 780/780 | 90/90 | 0 |  |
| flex-distribution-grid | html layout | pass | 1 (ltr 1) | 170/170 | 0/0 | 170/170 | 8840/8840 | 1020/1020 | 0 |  |
| text-wrap-spaces | html layout | pass | 1 (ltr 1) | 43/43 | 25/25 | 43/43 | 520/520 | 68/68 | 0 |  |
| text-wrap-zwsp | html layout | pass | 1 (ltr 1) | 29/29 | 14/14 | 29/29 | 468/468 | 60/60 | 0 |  |
| text-align-multi-line | html layout | pass | 1 (ltr 1) | 47/47 | 22/22 | 47/47 | 728/728 | 95/95 | 0 |  |
| text-line-height-multi-line | html layout | pass | 1 (ltr 1) | 38/38 | 21/21 | 38/38 | 520/520 | 67/67 | 0 |  |
| text-unbreakable-overflow | html layout | pass | 1 (ltr 1) | 26/26 | 11/11 | 26/26 | 468/468 | 60/60 | 0 |  |
| text-whitespace-collapse | html layout | pass | 1 (ltr 1) | 29/29 | 14/14 | 29/29 | 468/468 | 60/60 | 0 |  |
| text-anonymous-block-mixed | html layout | pass | 1 (ltr 1) | 33/33 | 16/16 | 34/34 | 520/520 | 68/68 | 5 |  |
| flex-text-anonymous-item | html layout | pass | 1 (ltr 1) | 28/28 | 12/12 | 28/28 | 468/468 | 61/61 | 5 |  |
| flex-text-min-content-shrink | html layout | pass | 1 (ltr 1) | 31/31 | 12/12 | 31/31 | 624/624 | 79/79 | 0 |  |
| flex-column-text-wrap | html layout | pass | 1 (ltr 1) | 29/29 | 13/13 | 29/29 | 520/520 | 66/66 | 0 |  |
| text-fractional-font-size | html layout | pass | 1 (ltr 1) | 97/97 | 45/45 | 105/105 | 1716/1716 | 225/225 | 0 |  |
| rtl-block-auto-margins | html layout | pass | 1 (ltr 1) | 19/19 | 0/0 | 19/19 | 988/988 | 114/114 | 0 |  |
| rtl-text-align-multi-line | html layout | pass | 1 (ltr 1) | 93/93 | 48/48 | 95/95 | 1300/1300 | 172/172 | 0 |  |
| rtl-flex-row-justify | html layout | pass | 1 (ltr 1) | 90/90 | 0/0 | 90/90 | 4680/4680 | 540/540 | 0 |  |
| rtl-flex-wrap | html layout | pass | 1 (ltr 1) | 53/53 | 8/8 | 53/53 | 2184/2184 | 255/255 | 0 |  |
| rtl-text-anonymous | html layout | pass | 1 (ltr 1) | 61/61 | 31/31 | 62/62 | 884/884 | 116/116 | 8 |  |
| rtl-flex-column-align | html layout | pass | 1 (ltr 1) | 38/38 | 2/2 | 38/38 | 1768/1768 | 206/206 | 0 |  |
| direction-mixed-subtree | html layout | pass | 1 (ltr 1) | 50/50 | 17/17 | 50/50 | 1352/1352 | 163/163 | 0 |  |
| flex-order | html layout | pass | 1 (ltr 1) | 38/38 | 4/4 | 38/38 | 1612/1612 | 189/189 | 3 |  |
| flex-row-reverse | html layout | pass | 1 (ltr 1) | 64/64 | 0/0 | 64/64 | 3328/3328 | 384/384 | 0 |  |
| flex-column-reverse | html layout | pass | 1 (ltr 1) | 44/44 | 1/1 | 44/44 | 2184/2184 | 253/253 | 0 |  |
| flex-reverse-start-end | html layout | pass | 1 (ltr 1) | 60/60 | 0/0 | 60/60 | 3120/3120 | 360/360 | 0 |  |
| flex-wrap-reverse | html layout | pass | 1 (ltr 1) | 105/105 | 0/0 | 105/105 | 5460/5460 | 630/630 | 0 |  |
| flex-baseline-text | html layout | pass | 1 (ltr 1) | 63/63 | 21/21 | 63/63 | 1248/1248 | 162/162 | 0 |  |
| flex-baseline-synthesized | html layout | pass | 1 (ltr 1) | 28/28 | 4/4 | 28/28 | 1040/1040 | 124/124 | 0 |  |
| flex-baseline-nested | html layout | pass | 1 (ltr 1) | 81/81 | 21/21 | 81/81 | 2028/2028 | 255/255 | 0 |  |
| flex-align-self-baseline-wrap | html layout | pass | 1 (ltr 1) | 63/63 | 18/18 | 63/63 | 1404/1404 | 180/180 | 0 |  |
| flex-baseline-column-fallback | html layout | pass | 1 (ltr 1) | 27/27 | 4/4 | 27/27 | 988/988 | 118/118 | 0 |  |
| overflow-hidden-bfc | html layout | pass | 1 (ltr 1) | 26/26 | 4/4 | 26/26 | 1092/1092 | 127/127 | 0 |  |
| overflow-hidden-flex-min-size | html layout | pass | 1 (ltr 1) | 47/47 | 13/13 | 47/47 | 1248/1248 | 154/154 | 0 |  |
| tree-switch-two-instances | tree layout | pass | 32 (ltr 16 + rtl 16) | 416/416 | 64/64 | 416/416 | 14976/14976 | 1792/1792 | 0 |  |
| tree-correlated-state | tree layout | pass | 24 (ltr 12 + rtl 12) | 96/96 | 0/0 | 96/96 | 4992/4992 | 576/576 | 0 |  |
| tree-controlled-aliases | tree layout | pass | 8 (ltr 4 + rtl 4) | 84/84 | 0/0 | 84/84 | 4368/4368 | 504/504 | 0 |  |
| tree-branch-arms | tree layout | pass | 6 (ltr 3 + rtl 3) | 28/28 | 0/0 | 28/28 | 1456/1456 | 168/168 | 0 |  |
| tree-slot-projection | tree layout | pass | 4 (ltr 2 + rtl 2) | 32/32 | 0/0 | 32/32 | 1664/1664 | 192/192 | 0 |  |
| tree-shared-class-one-module | tree layout | pass | 2 (ltr 1 + rtl 1) | 12/12 | 0/0 | 12/12 | 624/624 | 72/72 | 0 |  |
| tree-colliding-modules | tree layout | pass | 2 (ltr 1 + rtl 1) | 16/16 | 0/0 | 16/16 | 832/832 | 96/96 | 0 |  |
| tree-ordered-sheets | tree layout | pass | 2 (ltr 1 + rtl 1) | 8/8 | 0/0 | 8/8 | 416/416 | 48/48 | 0 |  |
| tree-ordered-sheets-reversed | tree layout | pass | 2 (ltr 1 + rtl 1) | 8/8 | 0/0 | 8/8 | 416/416 | 48/48 | 0 |  |
| tree-param-args | tree layout | pass | 2 (ltr 1 + rtl 1) | 12/12 | 0/0 | 12/12 | 624/624 | 72/72 | 0 |  |
| tree-nested-instances | tree layout | pass | 16 (ltr 8 + rtl 8) | 144/144 | 0/0 | 144/144 | 7488/7488 | 864/864 | 0 |  |
| tree-attribute-equality | tree layout | pass | 6 (ltr 3 + rtl 3) | 30/30 | 0/0 | 30/30 | 1560/1560 | 180/180 | 0 |  |
| tree-projected-text | tree layout | pass | 8 (ltr 4 + rtl 4) | 140/140 | 60/60 | 140/140 | 2496/2496 | 320/320 | 8 |  |
| tree-whitespace-leaves | tree layout | pass | 2 (ltr 1 + rtl 1) | 100/100 | 44/44 | 100/100 | 728/728 | 126/126 | 0 |  |
| reject-display-grid | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-color-lab | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-shorthand-filled | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-unproven-context | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNPROVEN_CONTEXT |
| reject-tree-alias-cycle | tree reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_ALIAS_CYCLE |
| reject-tree-choice-overlap | tree reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_CHOICE_OVERLAP |
| reject-tree-unknown-state | tree reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_STATE_UNKNOWN |
| reject-tree-initial-domain | tree reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_STATE_VALUE_DOMAIN |
| reject-tree-producer-error | tree reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_PRODUCER_ERROR |
| reject-tree-raw-html | tree reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_TREE_RAW_HTML |
| reject-white-space-pre | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-nesting-ampersand | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_NESTED_RULE |
| reject-nested-media | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_AT_RULE |
| reject-overflow-single-axis | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-overflow-body | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-overflow-scroll | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-last-baseline | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-bidi-neutral | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_BIDI |

New layout fixtures and what they prove:

- `text-fractional-font-size` (C1): 10.3, 12.5, 13.7, 10.5, 7.25, 13.3, 10.625, 17.5, 15.625, 22.5, 10.629 and 11.1111 px Ahem; line-height normal, numbers (1.3, 1.37, 1.25, 1.5, 1.2) and px (17.3, 9.6); wrapped lines where two or three leaves share a line (split by `display: none` elements); center, end and right alignment; max-content and min-content items in row and column flex; a baseline row. 97/97 exact.
- `rtl-block-auto-margins`: CSS2 §10.3.3 in rtl: over-constrained (margin-left ignored), one or both margins auto, odd-LU free space (40.3px in 101px), wider-than-container boxes, percentages, min/max-width, border-box, a negative end margin, nesting.
- `rtl-text-align-multi-line`: start, end, left, right, center on wrapped rtl text; odd-LU center; overflowing lines under every value (all overflow to the left); padding and a border on one side; inheritance; three leaves on a line; U+200B ending a line inside the paragraph; line-height.
- `rtl-flex-row-justify`: rtl row with flex-start, flex-end, start, end, left, right, center, the three space values and normal, each with odd free space and with negative free space; column-gap; auto margins; flex-grow.
- `rtl-flex-wrap`: rtl multi-line rows with align-content center, space-between, space-around, flex-end and stretch against justify-content; a margin-right auto item; an rtl column wrap; wrapped text items.
- `rtl-text-anonymous`: rtl anonymous blocks, anonymous flex items in row and column, text in row and column flex items, all wrapped.
- `rtl-flex-column-align`: column cross axis in rtl and ltr: flex-start, flex-end, start, end, self-start and self-end (rtl and ltr items), center, stretch with margins, auto margins.
- `direction-mixed-subtree`: an rtl subtree in ltr with an ltr subtree inside it, and the reverse: block margins, auto centring, text-align start and center, flex main-start.
- `flex-order`: negative, equal and positive `order`, stability, wrap lines by order, a column, anonymous flex items (order 0) between ordered items, rtl.
- `flex-row-reverse`, `flex-column-reverse`: every justify-content value with odd free space, gaps, main-axis auto margins, flex-grow, rtl, negative free space, a wrapped row-reverse, an auto-height column-reverse.
- `flex-reverse-start-end`: start/end against flex-start/flex-end, and left/right, in row-reverse (ltr and rtl), column-reverse and column.
- `flex-wrap-reverse`: align-content flex-start, flex-end, start, end, center and the space values, stretch, with positive and negative free space; align-items flex-start, start, end, flex-end, center; cross auto margins with positive and negative space in a row and a column; rtl columns.
- `flex-baseline-text`: font sizes, border and padding, line-height, margins, a wrapped item, `first baseline`, align-self baseline beside stretch, negative leading, rtl.
- `flex-baseline-synthesized`: items without a baseline (empty boxes, borders and padding below, an empty block with padding, an empty flex container) beside text.
- `flex-baseline-nested`: nested baseline groups, a flex container without one (first item, synthesized), row-reverse, column, column-reverse, order, blocks whose first child has no baseline, scroll containers as baseline sources, clamped and not.
- `flex-align-self-baseline-wrap`: baseline groups on each line of wrapped rows with stretch and fixed items, fixed-height space-between, and wrap-reverse.
- `flex-baseline-column-fallback`: `align-items: baseline` and `first baseline` in ltr, rtl and wrap-reverse columns with margins.
- `overflow-hidden-bfc`: parent/child margins stop at a scroll container; it does not collapse through; sibling margins still collapse; fixed height with overflowing content; min-height; negative margins; clipped text; percentage heights inside.
- `overflow-hidden-flex-min-size`: the automatic minimum size 0 in rows and columns, with padding and border, an explicit min-width, flex-basis, flex-grow.
- `tree-whitespace-leaves` (C2): see C2 below; runs in both directions.

New reject fixtures: `reject-nesting-ampersand` (`& .b { … }`), `reject-nested-media` (`@media` inside a rule), `reject-overflow-single-axis` (`overflow-x: hidden`, overflow-y computes to auto), `reject-overflow-body` (`overflow: hidden` on body), `reject-overflow-scroll`, `reject-last-baseline`, `reject-bidi-neutral` (`AB 12.` in an rtl block). Each yields its code on the stated span with ios and web blocked, no projection and no web files.

## The rtl environment (B1, B2)

- The internal `Environment` is `{viewport, devicePixelRatio, direction}`. `InternalOptions` gains `direction`; the public `createProject` compiles for `ltr` and exposes neither.
- Resolution seeds the root's direction from the environment (`ResolveEnvironment`) with origin `environment` and no declaration; it is then inherited. An author declaration on html still wins. `explain` reports `cascade: 'environment'` with the Origin `{builtin, dataset: 'reference environment', entry: 'direction rtl'}`. The lowering and the engine never patch direction.
- The digest covers the direction. `iosLayoutProjection` refuses an environment whose direction the result was not resolved for.
- Chrome receives it through the one harness mechanism: `chrome.ts harnessStyle` appends `:where(html){direction:rtl}` to the `data-dragon-harness` style that `openPage` injects into both the authored and the compiled rendering. Zero specificity, so any author rule on html wins, as in Dragon. A `dir` attribute was not used because the HTML UA sheet also gives `[dir]` `unicode-bidi: isolate`. The dual lane stays exactly equal for every longhand (21,320 of 21,320 rtl values).
- Every tree fixture case also runs in the rtl environment as its own case `<fixture>#<k>-rtl`, with its own capture (`expected/<case>-rtl.web.json`), vector and web CSS (`emitted/<fixture>-rtl.css`). Nothing is deduplicated. HTML fixtures run ltr; their rtl coverage comes from authored `direction: rtl`.
- Captures gain one file-level field, `direction`.
- MF1 declarations stay per assignment; `runFixture` checks declared = renderer = Dragon per environment. The declared text topology gives each entry's context for both directions (`"context": {"ltr": …, "rtl": …}`), and both are checked.

## Profile contexts (B3, addendum C7)

Every row context carries the direction of the box whose algorithm consumes the property: the parent's for item properties (the root's own), the element's own for container properties and for text (the block container). `direction` itself is a container property. The flex text contexts carry the main axis: `text-in-flex-item/{row,column}/{ltr,rtl}` and `text-as-anonymous-flex-item/{row,column}/{ltr,rtl}`. Examples: `width:<length-px>@block/rtl`, `direction:rtl@flex-column-single-line/rtl`, `font-size:<length-px>@text-in-flex-item/column/rtl`. All 12 laid-out text contexts have rows, each proven by a case with a wrapped text node. Rows are never keyed by geometry.

## Mapping rules for rtl lines and baselines

Probed first (`/tmp/t035/p3.mts`, `p4.mts`, Chrome 145.0.7632.6), then held on every capture.

rtl lines:

1. In an rtl block container whose text holds only A-Z, a-z, spaces and U+200B, every line is one left-to-right bidi run (the spaces and U+200B sit between strong-L letters, UAX #9 N1 and X9). Characters and leaves keep logical order from left to right, exactly as in ltr, and each leaf still has one client rect per line on which it shows a character. The S3b rule is unchanged: `<leaf>:line<j>` is the j-th line with a visible character; spaces removed at a line end have no rect, and a whitespace-only leaf at a break has none.
2. The line's left offset follows Blink `LineOffsetForTextAlign`: start maps to right and end to left; right takes the free space, left none, center `LayoutUnit / 2` from the left. A line wider than the box is start-aligned, so in rtl its left offset is the (negative) free space, whatever text-align says. Measured: 50.3px center leaves 19 LU and offsets 9 LU in both directions; `XXXXX` in 25px sits at -25px for start, center and left.
3. U+200B that ends the paragraph takes the paragraph level (UAX #9 L1): Chrome makes it a separate fragment at the line's left edge and gives its leaf a second client rect on that line, listed first (probe p4: `r1:text0` has rects `line0` 0 wide at 350px and `line1` 50px wide, both on line 1). No stated fragment rule covers that, so it is refused: the engine raises `bidi-neutral` and the compiler `DRAGON_UNSUPPORTED_BIDI`. U+200B elsewhere, including at the end of a line inside the paragraph and as a whole leaf, keeps logical order (C2 fixture).
4. Any other character (digits, punctuation, symbols) in an rtl paragraph is refused the same way. Neutrals are never laid out as ltr. No UAX #9 reordering is claimed.

Baselines (css-flexbox-1 §8.3, §8.5, §9.4 step 8; css-align-3 §9):

1. A block container's first baseline is its first line box's: border-top + padding-top + floored half-leading + ascent. Otherwise it is the first in-flow child's first baseline plus the child's offset, skipping children without one (probe p8 `rn`).
2. A scroll container's baseline is its content's, clamped to its border box (probe p12: 20px text in a 5px box sits with its bottom border edge on the baseline).
3. A box without a baseline synthesizes one at its bottom border edge (margins excluded).
4. In a row container the items with `align-self: baseline` and no auto cross margin form one group per line. The line cross size is the larger of the tallest other item and the largest distance to the cross-start margin edge plus the largest to the cross-end one. The group sits with its largest cross-start distance flush with the line's cross-start edge, which is the bottom in wrap-reverse: there the first baseline is measured to the bottom margin edge.
5. A flex container's own baseline is its first line's shared baseline, or else the baseline of the first item in flow order on the first line, synthesized from that item's border box if needed. Flow order puts the leftmost item first in row-reverse (probe p9 `rr`), the top item first in column-reverse, and follows `order`.
6. In a column container (no baseline in the cross axis) Chrome synthesizes each item's baseline at its left border edge in both directions: the group's left border edges line up, and the item with the largest distance to the cross-start margin edge is flush with it (probe p6; fixture `flex-baseline-column-fallback`). `align-items: first baseline` computes to `baseline` in Chrome and behaves the same.

## Engine (`packages/layout`)

- `input.ts`: `Display` is `block | flex` (C4); `Overflow` is `visible | hidden`. No field was added.
- `block.ts`: `blockLevelInlineSize` takes the containing block's direction. The start margin is the right one in rtl; both auto give `LayoutUnit / 2` to the start margin; a lone auto start margin takes the free space; over-constrained, the end margin is ignored. A scroll container child establishes a BFC (no parent/child collapsing, no collapse-through). Frags carry `baseline`.
- `inline.ts`: rtl alignment (rule 2 above), the rtl text check (`bidi-neutral`), and the first line's baseline.
- `flex.ts`, rewritten in flow coordinates. Every offset is computed from the writing-mode start edge of its axis, then mapped to physical coordinates. Main axis: row starts at the inline start (right in rtl), column at the top. Cross axis: row starts at the top, column at the inline start. `row-reverse`/`column-reverse` reverse the item order in the flow and swap flex-start and flex-end; `wrap-reverse` does the same for lines and cross alignment. start/end follow the writing mode, self-start/self-end the item's own direction, left/right are physical in rows and act as start in columns. Chrome 145 truncates odd offsets from the writing-mode start edge, not from main-start (probe p5: centred 10px items in 101.3px are at 2281 LU from the left in row-reverse ltr and 2282 in row rtl). Also: order-modified document order (stable), baseline groups, scroll containers' automatic minimum size 0 on both axes, and negative-space fallbacks (space-between to flex-start, space-around/evenly to start, stretch to flex-start; center and end unsafe).
- `units.ts` / `text.ts`: Ahem metrics and advances use the platform font size and round exact halves down (see "Chrome arithmetic").
- `validate.ts`: rejects `display: none`, a mixed overflow pair, and `anonymous-shape` (no text child or a box child, id not `<parent id>:anon<k>`, display not block, any non-inherited field off its initial value).
- `UnsupportedCode`: removed as dead `direction-rtl`, `flex-reverse`, `flex-wrap-reverse`, `flex-order`, `flex-align-value`, `flex-justify-value`; added `bidi-neutral`. `flex-baseline` stays for `align-content: baseline`. The every-code-raised test passes.
- Engine faults through `layoutWithFaults`: `rtlAsLtr`, `ignoreOrder`, `baselineFromBorderTop`, `scrollMinAuto`, besides `breakOffByOne`.

## Compiler (`packages/dragon`)

- Environment direction as above. `ResolvedValue.origin` gains `environment`; `ExplainedCase.cascade` gains `'environment'`.
- The css-overflow-3 §3.1 pair rule in the resolver: visible beside hidden/scroll/auto computes to auto, clip to hidden.
- `analysis/computed-checks.ts`: a computed auto, scroll or clip that the author did not write (the pair rule) and any overflow on html or body give `DRAGON_UNSUPPORTED_VALUE` at the declaration, on every target. rtl text breaking the rule above gives `DRAGON_UNSUPPORTED_BIDI` (target null, so web is blocked too). An authored auto, scroll or clip is refused by the profile check, since no row proves it.
- `first baseline` and `last baseline` parse as one keyword each; the lowering maps `first baseline` to `baseline`, and no row proves `last baseline`.
- `overflow-x`/`overflow-y` are layout and paint aspects, so iOS overflow rows are caveat.
- `direction` joins `TEXT_LONGHANDS` (eight inherited text properties with origins) and is a container property for row keys.
- The lowering: C4, C5, overflow hidden, and html/body overflow refused.
- Stylesheet: C6.
- Catalogue: `DRAGON_UNSUPPORTED_NESTED_RULE` and `DRAGON_UNSUPPORTED_BIDI` (manual fixes).

## Planted engine faults

| Fault | Named fixture | Layout lane with the fault | Named nodes that fail | chrome-dual | Fault off |
|---|---|---|---|---|---|
| `rtlAsLtr` (every rtl box laid out as ltr, so text-align start acts as left) | `rtl-text-align-multi-line` | fail | `s:text0:line0`, `so:text0:line0`, `d:text0:line1` | pass | pass |
| `ignoreOrder` | `flex-order` | fail | `r1b`, `r1d`, `a1a`, `r3c` | pass | pass |
| `baselineFromBorderTop` (the item's baseline loses its top border and padding) | `flex-baseline-text` | fail | `b`, `c2b`, `c3a` | pass | pass |
| `scrollMinAuto` (a scroll container keeps the content-based minimum) | `overflow-hidden-flex-min-size` | fail | `r1a`, `r2a`, `c1a` | pass | pass |

## S3b must-fix items (card C1-C6; the addendum numbering in brackets)

- **C1 fractional text [addendum C2]: ended in a passing proof.**
  - `text-fractional-font-size` passes at the gate with 97 of 97 nodes exact at 1/64 px. No value subset was narrowed.
  - It first failed at 2 px, because Chrome's glyph box at 12.5px is 12px, not 13px. Probing 21 sizes, then 18 more (`/tmp/t035/p11.mts`, `p14.mts`, `p15.mts`), pinned two rules, now in `units.ts` and `text.ts`:
    - Ahem ascent and descent round to the nearest whole px, with an exact half rounding down.
    - Glyph advances and metrics use the font size times 100, truncated (10.625px measures as 10.62px: 4 glyphs are 2719 LU, not 2720). Line-height numbers still multiply the computed size.
  - Both rules leave every whole-px size unchanged. See "Chrome arithmetic" below.
- **C2 line-mapping edges [addendum C3].** `tree-whitespace-leaves` (a tree fixture, in both directions) covers:
  - a whitespace-only leaf `a:space0` in the middle of a line, captured with its rect;
  - whitespace-only leaves at line breaks (`b:space0`, `b:space1`), with no rect on either side;
  - U+200B-only leaves mid-line (`c:text1`) and at a line end inside the paragraph (`a:text2`, `d:text2`);
  - a leaf boundary exactly at a break, and leaves that start a line (`a:text3`, `d:text1`);
  - centred lines with space leaves (`e`).

  All 100 nodes (44 line rects) map one-to-one and are exact in ltr and rtl, and no rect is filtered. Across the corpus 4 `:space` nodes are captured with rects.
- **C3 anonymous-box shape [addendum C6].**
  - The validator code `anonymous-shape` has unit tests per rule.
  - `s4a.test.ts` lowers anonymous boxes in block and flex, ltr and rtl. For each one it checks that the style equals the lowering of the parent's inherited values plus the webref initial value (`initialValue`) of every other longhand.
  - Every lowered case of the corpus passes the validator, so every anonymous box in the corpus meets the shape.
- **C4 one display: none rule.**
  - display: none subtrees are omitted everywhere (CSS2 §9.2.4). The engine's `Display` and the validator reject `none`, and a display: none root is a typed `DRAGON_LOWERING_FAILED`. All vectors were regenerated.
  - A test compiles a hidden subtree that cannot be lowered (`width: 2em`), once beside text and once elsewhere, without the profiles. Both give no diagnostics and a ready projection with no hidden box.
  - The capture's `hasBox: false` nodes stay required-absent.
- **C5 text-align and direction [addendum C5].**
  - `assertTextCarriesContainer` runs for every text leaf against its element or anonymous container. It checks that the leaf's carried `text-align` and `direction` equal the container's lowered `textAlign` and `direction`.
  - Tests: equal values pass in ltr and rtl; a planted text-align or direction mismatch throws; real lowerings pass in both directions.
- **C6 nesting [addendum C1].**
  - `parseStylesheet` no longer skips anything silently. Every top-level node that is not a style rule, and every rule-block child that is not a declaration, goes through `refuseNode`:
    - a nested style rule (including `&`) gives `DRAGON_UNSUPPORTED_NESTED_RULE`;
    - a nested or top-level at-rule gives `DRAGON_UNSUPPORTED_AT_RULE`;
    - anything else gives `DRAGON_CSS_PARSE`.
  - Each has target null and blocks every output, web included.
  - The one exception is a raw node of only `;` and whitespace (an empty declaration), or `<!--`/`-->` at the top level. These produce no CSSOM child and are tested to give no diagnostic.
  - Two reject fixtures pass. `s4a.test.ts` covers `& .b`, `&:hover`, nested `@media` and `@supports`, a malformed declaration and a top-level `@media`, plus a grep that the old `continue` skips are gone.

## Chrome arithmetic pinned by measurement (this slice)

Chrome 145.0.7632.6 on macOS, probes under `/tmp/t035`, each rule held on every capture:

- **rtl block margins** (p1, p2): `x = cb - start - width`, where start is the right margin. With both margins auto the start margin gets `LayoutUnit / 2`: 40.3px in 101px sits at 1943 LU in rtl and 1942 in ltr.
- **Flow coordinates for distribution** (p5, 192 containers; p6; p7): justify-content, align-content and align-items offsets are computed from the writing-mode start edge of their axis. A reverse direction or wrap-reverse reverses the order and swaps flex-start and flex-end. Odd remainders therefore land on different physical sides than a main-start model would put them.
- **Negative free space** (p5, p12): space-between falls back to flex-start, space-around and space-evenly to start (safe center), align-content stretch to flex-start, all in flow terms; center and end stay unsafe.
- **Font size precision** (p14, p15): Ahem glyph advances and metrics use `trunc(size x 100) / 100`, in float math:
  - 10.625, 10.125, 10.375, 10.875 and 12.625px measure as .62, .12, .37, .87 and 12.62 (8 glyphs at 10.625px: 5438 LU, not 5440);
  - 10.629 measures as 10.62 and 10.631 as 10.63 (glyph heights 10 and 11 px);
  - 13.7 stays 13.7, 11.1111 is 11.11, 17.035 is 17.03, 8.3333 is 8.33.
  - This matches Blink's font cache precision multiplier of 100, but it was measured, not read from source.
- **Ahem metric rounding** (p11): ascent and descent round to the nearest whole px, with an exact half rounded down. At 12.5, 7.5, 17.5, 22.5 and 2.5px the descent (2.5, 1.5, 3.5, 4.5, 0.5) rounds to 2, 1, 3, 4, 0; 12.51px gives 3.
- **Scroll containers** (p10, p12): the flex automatic minimum size is 0 on both axes; the container is a BFC root; its baseline is clamped to its border box.
- **Computed values** (p10): `overflow-x: hidden` alone computes overflow-y to `auto`; `overflow: clip hidden` computes to `hidden hidden`; `align-items: first baseline` computes to `baseline`, `last baseline` to `last baseline`.

These are rounding and precision rules, like LayoutUnit truncation, so they live in `units.ts`, not in `chrome-deviations.ts`. See the risks for the one that a reviewer may classify differently.

## Chrome deviations (packages/layout/src/chrome-deviations.ts)

One new deviation, recorded with measured nodes (MF5 pattern). Per the gate rule this needs a Judge round before S4b.

| Deviation | Spec | Blink (measured) | Branches and proving nodes |
|---|---|---|---|
| `auto-margin-overflow-cross-start` (new) | css-flexbox-1 §9.6 step 13: when an item with auto cross-axis margins is larger than its line, the block-start or inline-start margin is set to zero, so the item is flush with the writing-mode start edge | Chrome 145 zeroes the cross-start margin instead; in a wrap-reverse container the item is flush with the cross-start edge, which is the writing-mode end edge (probe p13) | `row-wrap-reverse`: `flex-wrap-reverse` nodes `am-a`, `am-b`, `am-c` (30px items in a 20px line sit 10px above the top, flush with the bottom). `column-wrap-reverse`: `amc-a`, `amc-b`, `amc-c` (30px items in a 20px ltr line are flush with the right). |
| `half-leading-floor`, `min-max-end-margin` | unchanged | unchanged | unchanged |

All 15 deviation nodes are exact at 1/64 px in this run.

## Deviations from the task text

1. **A new Chrome deviation** (`auto-margin-overflow-cross-start`, above). It follows Chrome, with measured nodes on both branches. Refusing that case was the alternative. This triggers the gate's Judge round.
2. **C1 closed with two measured precision rules**, not a narrowing: round exact halves down, and use the platform font size (size x 100, truncated). They sit in `units.ts` as arithmetic, not in `chrome-deviations.ts`.
3. **`ExplainedCase.cascade` gains `'environment'`.** This changes a public union in `types.ts`, so the root direction's winning origin is reported truthfully. api.md §6.2 does not enumerate the union. The PM may want to record it.
4. **Direction reaches Chrome through `:where(html){direction:rtl}`** in the `data-dragon-harness` style, not through a `dir` attribute: `[dir]` would also set `unicode-bidi`. Captures gain one file-level `direction` field (the addendum allows it).
5. **Coverage split.**
   - Tree fixtures run in both directions: case id `<fixture>#<k>-rtl`, emitted CSS `<fixture>-rtl.css`.
   - HTML fixtures run in the ltr environment, and their rtl coverage uses authored `direction: rtl`.
   - The registry test forbids fixture ids ending in `-rtl`.
6. **Declared topology contexts.** Each entry's `context` in `fixture.json` is `{ltr, rtl}`. The `tree-whitespace-leaves` declaration was written from a hand-listed table with a one-off script. It is static data, not derived from the renderer or Dragon.
7. **Trailing U+200B in rtl is refused rather than modelled.** It gets a second rect on its line (mapping rule 3), so it is `bidi-neutral` / `DRAGON_UNSUPPORTED_BIDI`, like digits and punctuation.
8. **The bidi refusal blocks every target** (target null), web included, since no target has a proof for reordered text.
9. **Planted faults.**
   - `rtlAsLtr` lays every rtl box out as ltr: text-align start becomes left, and margins and flex axes flip back. This covers both the card's definition and the addendum's `ignoreDirection`.
   - `baselineFromBorderTop` drops the item's top border and padding from its baseline (the addendum's `baselineFromTop`).
   - `scrollMinAuto` is the addendum's `scrollMinSizeAuto`.
10. **Engine and property classification.**
    - `overflow-x`/`overflow-y` became layout plus paint (iOS clipping is paint), so their iOS rows are caveat.
    - `direction` is a container property for row keys and joins the text longhands.
    - The validator requires `overflowX === overflowY` (the §3.1 pair), and html/body overflow is refused in the lowering as well as by the compiler check.
11. **The C6 exception.** A lone `;` and top-level `<!--`/`-->` produce no CSSOM node and are not diagnosed; both are tested.
12. **Profile revision `m1-s4a`**, 449 rows per target, every row regenerated.

## Base-capture check output

```
base a82b849: 102 expected files, 1764 nodes, 72904 computed values compared; 102 files gained only the file-level "direction": "ltr" field
emitted CSS: 58 files, 58 digest header lines changed, no other change
vectors: 102 files, 1775 output rects identical; 1 inputs differ only by omitted display: none subtrees
PASS: no node that existed at a82b849 changed kind, hasBox, geometry or a computed value; no node was added or removed
```

The check (`/tmp/t035/base-check.mjs`) ran on the committed tree after the regeneration. It checks that every a82b849 expected file keeps kind, hasBox, x, y, width, height and every computed value of every node, with the same nodes in the same order. The only file-level addition allowed is `"direction": "ltr"`. Emitted CSS may differ only in the digest line. Every a82b849 vector must keep identical output rects, with the input differing only by the omitted display: none subtrees (`block-ua-divs`).

## Risks and open items for the PM

- **Gate.** One new Chrome deviation (`auto-margin-overflow-cross-start`) and one public type widening (`ExplainedCase.cascade`). By the gate rule, a Judge round comes before S4b.
- **The font rules were measured on macOS Chrome.** A reviewer may call the size-x-100 truncation a Chrome deviation rather than arithmetic. Linux Chrome (FreeType) may round metric halves differently. The corpus uses only these fractional sizes; whole-px sizes are unaffected.
- **Unmeasured combinations** are computed but have no fixture:
  - the baseline of a nested wrap-reverse or rtl row container used as a baseline source (first line, first flow item);
  - auto cross margins with negative space in reversed containers (outside wrap-reverse);
  - `order` combined with baseline in wrap-reverse.
- **Latent from S1.** The HTML fixture reader drops whitespace-only DOM text, so HTML text split by a whitespace-only node between hidden elements would compile without its space. No fixture does this; C2 used a tree fixture.
- **Still open from earlier slices:** owner visibility of the iOS paint caveat cap (now 93 caveat rows, overflow included), DPR other than 1, css-tree `createRequire` for the browser-worker check, and T005 before the S4 Judge round.
