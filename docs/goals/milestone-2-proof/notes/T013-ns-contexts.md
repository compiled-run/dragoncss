# T013: NS-CTX, context proofs for the north star

Worker note, 2026-09-28. Spec: T010-north-star-plan.md WP1 (base 8df7574 in place of 2d2e4dd). Branch `ns-contexts`, worktree
`/tmp/dragon-ns-ctx`. No engine, compiler, gate, snap rule or tolerance change. No pin test needed a new literal: every case
count the tests check is derived.

## Result

| Measure (north-star-check.json) | before (8df7574) | after |
|---|---|---|
| DRAGON_UNPROVEN_CONTEXT | **79 per target** (web 79, ios 79) | **1 per target** (web 1, ios 1) |
| Declarations supported on web and ios | 70 / 291 (24.1%) | 98 / 291 (33.7%) |
| Errors | 713 | 557 |

Every other code count is unchanged.

## The 79 contexts per target and the fixture that proves each

All fixtures are in group `contexts` (packages/parity/src/fixture-groups/contexts.ts). Each runs in both environment
directions (`both`), so every key below is also proven with `/rtl` (and `cb-rtl`). Values are px, % and keywords only.

| Context (ltr and rtl) | Keys from the check | Fixture |
|---|---|---|
| absolute-in-flex-row/cb | border-{top,right,bottom,left}-style:solid, box-sizing:border-box, left/top/width:&lt;percentage&gt;, overflow-x/y:hidden, padding-*:&lt;length-px&gt; (22) | context-absolute-in-flex-row |
| relative-in-flex-row | box-sizing, flex-basis:auto, flex-shrink:&lt;number&gt;, margin-{top,right,left}, min-width:&lt;length-px&gt;, overflow-x/y:hidden, padding-* (13) | context-relative-in-flex-row |
| relative-in-flex-column | box-sizing, display:flex, margin-*, overflow-x/y:hidden, padding-* (12) | context-relative-in-flex-column |
| relative-in-block | box-sizing:border-box (1; rtl was already proven) | context-relative-in-block |
| root | box-sizing, margin-*, padding-* (9) | context-root-zero (the demo's zeros), context-root-box (non-zero margin and padding, border-box width and height) |
| display-none | box-sizing, margin-*, padding-* (9) | context-display-none |
| not-flex-container | align-items:center, justify-content:center (2), flex-wrap:wrap (4 diagnostics) | context-not-flex-container |
| text-in-flex-item/column | text-align:center, text-align:left (2) | context-text-align-flex-column |
| block | top:&lt;length-px&gt;, right:&lt;length-px&gt; on a static box (2) | context-block-insets |
| flex-column | width:&lt;percentage&gt; (1) | context-flex-column-percent-width |

Note on `block`: `.library` reaches block/ltr only because pass C blanks its `position: fixed`; the fixture proves insets on a
static box (no effect, Chrome-equal). The real declaration waits for POSX-f.

## The one remaining context

| Context | Key | Reason |
|---|---|---|
| root/ltr (web, ios) | overflow-x:hidden on html | overflow on html propagates to the viewport (css-overflow-3 §3.3). The compiler refuses it with DRAGON_UNSUPPORTED_VALUE ("overflow-x: hidden on &lt;html&gt; html propagates to the viewport ..."); pinned by the new reject fixture `reject-context-root-overflow`. It needs OVFL (viewport propagation) and cannot be proven by a fixture. |

No context needed `rem`, `var` or `calc`.

## Proof path

- 22 new layout cases (11 fixtures x ltr/rtl) plus 1 reject fixture: 309 cases, 177 fixtures.
- Chrome captures (expected/darwin-arm64), emitted CSS (22 new files), DPR 2, 3, 2.625 captures (66), vectors (22) and DPR and snap
  vectors (132): new files only.
- Existing emitted files: 189 changed, header line only (the compilation hash; the profiles are compilation input).
- Profile rows: web and ios 1218 -> 1384 (+166 rows for the new keys, all exact on web; ios 138 exact and 28 paint rows at caveat);
  android +166 unsupported. 0 rows removed, 0 status changes; 140 existing rows gained only the new context-* case ids in their
  proof case lists.
- corpus-dpr.json: counts and digests regenerated (vectors-m2 29 -> 51, DPR 861 -> 927). The engine-dpr split now has 3
  `unsupported` results; all three are random engine mutations of the new vectors (percent height against an indefinite flexed
  size at m2b and rc1a; percentage flex-basis against an indefinite main size at t5), which the engine refuses as designed.
  Swift and Kotlin match them.

## Verification (env prefix from the task on every command)

1. `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`: 49 files, 1209 tests pass; no skip, todo or only.
2. `parity:capture` (before rows, then after rows, then a third run with no diff); `parity:dpr-capture` twice, second no diff.
3. `layout:vectors`, `layout:dpr-vectors`; `git diff --diff-filter=MD --name-only 8df7574 -- expected expected-dpr vectors emitted` lists only the 189 emitted header-line files.
4. `profile:rows`: as above.
5. `parity:report`: 177/177, 309/309 cases, failed 0. `parity:dpr-report`: 927/927, failed 0 at 2, 3 and 2.625.
6. `layout:subset`: 0 violations. `native:gen`; `git diff --exit-code packages/layout/generated` exits 0.
7. `native:swift` and `native:kotlin`: status pass, all vectors equal.
8. `parity:lanes -- --run-host`: exit 0; lanes.json committed (host lanes pass, device lanes not run).
9. `north-star:check`: UNPROVEN_CONTEXT 79 -> 1 per target.
10. Changed paths lie inside allowed_files; `git remote -v` is empty.

## For the integrator

The branch touches generated files that T002 also regenerates (profiles, lanes.json, corpus-dpr.json, north-star-check.json,
emitted headers). Regenerate them at merge; never hand-merge.
