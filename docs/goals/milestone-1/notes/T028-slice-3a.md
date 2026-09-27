# T028 S3a: tree@0 finite states, per-state parity, diagnostics catalogue, S2 must-fix M1-M9

Worker, 2026-09-27, claude-code. Board: `docs/goals/milestone-1/state.yaml`, task T028. Spec: "S3a objective (binding)" in `notes/T027-s2-review-s3a-plan.md`; standing rules from `notes/T022-own-layout-plan.md`. Base: cfcec43 (S2). Commit: local only, not pushed.

## Result

| | Count |
|---|---|
| Fixtures | 57 (37 in S2): 47 layout (35 HTML, 12 tree), 10 reject (4 HTML, 6 tree) |
| Fixtures passing | 57 of 57; failed 0 |
| Parity cases | 88 (35 HTML fixtures, 1 case each; 12 tree fixtures, 53 cases); 88 pass both lanes |
| `linux-dragon-layout` (1 device px gate) | 88 of 88 cases pass; 1,316 of 1,316 compared nodes match Chrome exactly at 1/64 px (informational) |
| `chrome-dual` boxes | 1,318 of 1,318 equal (authored against compiled) |
| `chrome-dual` computed values | 63,800 of 63,800 `getComputedStyle` strings equal (50 longhands per element) |
| `chrome-dual` colour channels | 7,656 of 7,656 equal to Dragon's resolved channels |
| LayoutUnsupported hits | none (`unsupportedCodes: []`) |
| Profiles | ios 221 rows (152 exact, 69 caveat); web 221 rows (all exact); every row generated |
| Tests | 11 files, 321 tests, both runs |

Nothing was loosened: the 1 device px gate and the exact dual equality are unchanged; no fixture, case, node or property is skipped, excluded, narrowed, deduplicated or factored; no fixture has its own tolerance. Every case of every tree fixture runs both lanes. The engine (`packages/layout/src`) is unchanged except `unsupported.ts` (M6) and `chrome-deviations.ts` (M5).

## Commands run (T028 verify list)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass. The only lockfile change: `css-tree 3.2.1` (already locked) added to the `packages/parity` importer |
| `pnpm typecheck` (`tsc -b`; includes `planted/drop-field.ts` and the extended `types.test-d.ts`) | pass (exit 0) |
| `pnpm test`, run 1 | pass: 11 files, 321 tests |
| `pnpm test`, run 2 | pass: 11 files, 321 tests; `packages/parity/out/report.json` byte-identical to run 1 (`cmp`) |
| Regeneration, on the committed tree: `pnpm run grammar:gen && pnpm run ua:capture && pnpm run parity:capture && pnpm run layout:vectors && pnpm run profile:rows`, then `/opt/homebrew/bin/git diff --exit-code -- packages scripts` and `git status --porcelain --untracked-files=all packages/dragon/src packages/parity/expected packages/parity/emitted packages/layout/vectors` | pass: regeneration exit 0, diff exit 0, 0 untracked files |
| `pnpm run parity:report`, then `test -s` on `out/report.json` and `out/index.html` | pass: "57/57 fixtures pass (88 cases, 88 pass); layout 1316/1316 nodes exact at 1/64 px; dual boxes 1318/1318, values 63800/63800, channels 7656/7656"; the report equals the test-run report byte for byte |
| `report.json` summary | 57 fixtures (at least 50); failed 0; `unsupportedCodes: []`; every layout case has `linux-dragon-layout: pass` and `chrome-dual: pass`; `caseCounts` lists every case id and each tree fixture's count equals the product of its free domains and Dragon's enumeration (switch: 16) |
| Profile-proof, registry, deviation, distribution, planted, diagnostics and conformance tests | pass (see M1-M9 and the sections below) |
| S1 greps: no `node:`/fs/path/child_process/url/module/playwright imports in `packages/dragon/src` or `packages/layout/src`; only `import type` from `@dragon/layout` in `packages/dragon/src`; no `??`, `?:`, `?.` in `packages/layout/src`; rounding only in `units.ts`; no `Date`, `Math.random`, `performance.`, `process.`, `globalThis` in `packages/layout/src` | pass (0 matches each; the one `@dragon/layout` line without `import type` is the closing line of a multi-line `import type` in `lower/ios-layout.ts`) |
| Colour conversion only in `css/color.ts`; the web emitter imports neither `lower/ios-layout.ts` nor `@dragon/layout` and matches no selectors | pass (grep, plus `ua.test.ts`: the emitter's import list is pinned to resolve types, `serializeColor`, `LONGHANDS` and two type imports, and it names no selector, class or attribute matching) |
| Renderer isolation | pass (grep, plus `parity.test.ts`: `render.ts` imports exactly `css-tree` and `import type` from `dragon`; `render.ts`, `cases.ts`, `tree-fixture.ts` and `fixture-reader.ts` reference no `dragon/src/analysis`, `emit` or `lower`) |
| Dependency, private and export-map checks | pass, unchanged: dragon `dependencies` exactly `{css-tree: 3.2.1}`; exports only `'.'` with `{dragon-internal, default}`; layout private, no dependencies, exports `.`; parity private; no change to `tsconfig*`, `vitest.config.ts`, `.gitignore`; no new subpath; no `properties()` reader. The public entry exports `createProject`, `formatDiagnostic` and `TREE_SCHEMA_REVISION` |

git is `/opt/homebrew/bin/git`. PM-owned uncommitted files (`docs/` except this note, `README.md`, `state.yaml`) were not touched or committed.

## Fixtures and match counts

Exact LU is informational; the gate is 1 device px. Dual columns: boxes, computed values, colour channels.

| Fixture | Kind | Result | Cases | Exact LU | Dual boxes | Values | Channels | Reject code |
|---|---|---|---|---|---|---|---|---|
| block-ua-divs | html layout | pass | 1 | 9/9 | 11/11 | 550/550 | 66/66 |  |
| block-content-box-padding-border | html layout | pass | 1 | 9/9 | 9/9 | 450/450 | 54/54 |  |
| block-border-box | html layout | pass | 1 | 6/6 | 6/6 | 300/300 | 36/36 |  |
| block-percent-width-padding | html layout | pass | 1 | 6/6 | 6/6 | 300/300 | 36/36 |  |
| block-min-max | html layout | pass | 1 | 9/9 | 9/9 | 450/450 | 54/54 |  |
| block-auto-margin-center | html layout | pass | 1 | 9/9 | 9/9 | 450/450 | 54/54 |  |
| flex-row-grow-shrink-basis | html layout | pass | 1 | 25/25 | 25/25 | 1250/1250 | 150/150 |  |
| flex-min-max-freeze | html layout | pass | 1 | 19/19 | 19/19 | 950/950 | 114/114 |  |
| flex-column | html layout | pass | 1 | 14/14 | 14/14 | 700/700 | 84/84 |  |
| flex-wrap-gap-align-content | html layout | pass | 1 | 33/33 | 33/33 | 1650/1650 | 198/198 |  |
| flex-justify-content | html layout | pass | 1 | 45/45 | 45/45 | 2250/2250 | 270/270 |  |
| flex-align-items-stretch-center | html layout | pass | 1 | 22/22 | 22/22 | 1100/1100 | 132/132 |  |
| text-ahem-single-line | html layout | pass | 1 | 24/24 | 24/24 | 700/700 | 84/84 |  |
| color-syntax | html layout | pass | 1 | 22/22 | 22/22 | 1100/1100 | 132/132 |  |
| color-border-sides | html layout | pass | 1 | 11/11 | 11/11 | 550/550 | 66/66 |  |
| cascade-compound-variants | html layout | pass | 1 | 15/15 | 15/15 | 750/750 | 90/90 |  |
| block-fractional-values | html layout | pass | 1 | 10/10 | 10/10 | 500/500 | 60/60 |  |
| percent-height-chain | html layout | pass | 1 | 12/12 | 12/12 | 600/600 | 72/72 |  |
| margin-collapse-siblings | html layout | pass | 1 | 11/11 | 11/11 | 550/550 | 66/66 |  |
| margin-collapse-parent-child | html layout | pass | 1 | 27/27 | 27/27 | 1350/1350 | 162/162 |  |
| margin-collapse-through | html layout | pass | 1 | 27/27 | 27/27 | 1350/1350 | 162/162 |  |
| margin-collapse-min-height | html layout | pass | 1 | 42/42 | 42/42 | 2100/2100 | 252/252 |  |
| margin-collapse-body | html layout | pass | 1 | 5/5 | 5/5 | 250/250 | 30/30 |  |
| flex-auto-margins-main | html layout | pass | 1 | 21/21 | 21/21 | 1050/1050 | 126/126 |  |
| flex-auto-margins-cross | html layout | pass | 1 | 21/21 | 21/21 | 1050/1050 | 126/126 |  |
| flex-auto-margins-negative | html layout | pass | 1 | 17/17 | 17/17 | 850/850 | 102/102 |  |
| flex-align-content-remaining | html layout | pass | 1 | 42/42 | 42/42 | 2100/2100 | 252/252 |  |
| flex-align-content-odd | html layout | pass | 1 | 80/80 | 80/80 | 4000/4000 | 480/480 |  |
| flex-wrap-line-grow | html layout | pass | 1 | 27/27 | 27/27 | 1350/1350 | 162/162 |  |
| flex-intrinsic-wrap-column | html layout | pass | 1 | 24/24 | 24/24 | 1200/1200 | 144/144 |  |
| intrinsic-percent | html layout | pass | 1 | 29/29 | 29/29 | 1450/1450 | 174/174 |  |
| flex-nested | html layout | pass | 1 | 25/25 | 25/25 | 1250/1250 | 150/150 |  |
| flex-percent-definite | html layout | pass | 1 | 22/22 | 22/22 | 1100/1100 | 132/132 |  |
| flex-stretch-percent-minmax | html layout | pass | 1 | 15/15 | 15/15 | 750/750 | 90/90 |  |
| flex-distribution-grid | html layout | pass | 1 | 170/170 | 170/170 | 8500/8500 | 1020/1020 |  |
| tree-switch-two-instances | tree layout | pass | 16 | 176/176 | 176/176 | 7200/7200 | 864/864 |  |
| tree-correlated-state | tree layout | pass | 12 | 48/48 | 48/48 | 2400/2400 | 288/288 |  |
| tree-controlled-aliases | tree layout | pass | 4 | 42/42 | 42/42 | 2100/2100 | 252/252 |  |
| tree-branch-arms | tree layout | pass | 3 | 14/14 | 14/14 | 700/700 | 84/84 |  |
| tree-slot-projection | tree layout | pass | 2 | 16/16 | 16/16 | 800/800 | 96/96 |  |
| tree-shared-class-one-module | tree layout | pass | 1 | 6/6 | 6/6 | 300/300 | 36/36 |  |
| tree-colliding-modules | tree layout | pass | 1 | 8/8 | 8/8 | 400/400 | 48/48 |  |
| tree-ordered-sheets | tree layout | pass | 1 | 4/4 | 4/4 | 200/200 | 24/24 |  |
| tree-ordered-sheets-reversed | tree layout | pass | 1 | 4/4 | 4/4 | 200/200 | 24/24 |  |
| tree-param-args | tree layout | pass | 1 | 6/6 | 6/6 | 300/300 | 36/36 |  |
| tree-nested-instances | tree layout | pass | 8 | 72/72 | 72/72 | 3600/3600 | 432/432 |  |
| tree-attribute-equality | tree layout | pass | 3 | 15/15 | 15/15 | 750/750 | 90/90 |  |
| reject-display-grid | html reject | pass | 0 | - | - | - | - | DRAGON_UNSUPPORTED_VALUE |
| reject-color-lab | html reject | pass | 0 | - | - | - | - | DRAGON_UNSUPPORTED_VALUE |
| reject-shorthand-filled | html reject | pass | 0 | - | - | - | - | DRAGON_UNSUPPORTED_VALUE |
| reject-unproven-context | html reject | pass | 0 | - | - | - | - | DRAGON_UNPROVEN_CONTEXT |
| reject-tree-alias-cycle | tree reject | pass | 0 | - | - | - | - | DRAGON_ALIAS_CYCLE |
| reject-tree-choice-overlap | tree reject | pass | 0 | - | - | - | - | DRAGON_CHOICE_OVERLAP |
| reject-tree-unknown-state | tree reject | pass | 0 | - | - | - | - | DRAGON_STATE_UNKNOWN |
| reject-tree-initial-domain | tree reject | pass | 0 | - | - | - | - | DRAGON_STATE_VALUE_DOMAIN |
| reject-tree-producer-error | tree reject | pass | 0 | - | - | - | - | DRAGON_PRODUCER_ERROR |
| reject-tree-raw-html | tree reject | pass | 0 | - | - | - | - | DRAGON_TREE_RAW_HTML |

Case counts per tree fixture (from the source domains = cases rendered = cases Dragon enumerated): tree-switch-two-instances 16 (two instances x checked x disabled); tree-correlated-state 12 (checked x disabled x level in [0, 1, 2]); tree-controlled-aliases 4 (App.open x free.expanded; first and second are aliased to App.open and add no case); tree-branch-arms 3 (mode in ["list", "grid", "empty"]); tree-slot-projection 2 (compact); tree-nested-instances 8 (three nested Row instances); tree-attribute-equality 3 (phase); tree-shared-class-one-module, tree-colliding-modules, tree-ordered-sheets, tree-ordered-sheets-reversed and tree-param-args 1 each (no free states; tree-param-args has only fixed arguments). Every case is listed in `report.json` (`summary.caseCounts` and per fixture) and in `index.html`. The switch cases:

- `tree-switch-two-instances#0` (initial): doc/a.checked=false, doc/a.disabled=false, doc/b.checked=false, doc/b.disabled=false
- `tree-switch-two-instances#1`: doc/a.checked=false, doc/a.disabled=false, doc/b.checked=false, doc/b.disabled=true
- `tree-switch-two-instances#2`: doc/a.checked=false, doc/a.disabled=false, doc/b.checked=true, doc/b.disabled=false
- `tree-switch-two-instances#3`: doc/a.checked=false, doc/a.disabled=false, doc/b.checked=true, doc/b.disabled=true
- `tree-switch-two-instances#4`: doc/a.checked=false, doc/a.disabled=true, doc/b.checked=false, doc/b.disabled=false
- `tree-switch-two-instances#5`: doc/a.checked=false, doc/a.disabled=true, doc/b.checked=false, doc/b.disabled=true
- `tree-switch-two-instances#6`: doc/a.checked=false, doc/a.disabled=true, doc/b.checked=true, doc/b.disabled=false
- `tree-switch-two-instances#7`: doc/a.checked=false, doc/a.disabled=true, doc/b.checked=true, doc/b.disabled=true
- `tree-switch-two-instances#8`: doc/a.checked=true, doc/a.disabled=false, doc/b.checked=false, doc/b.disabled=false
- `tree-switch-two-instances#9`: doc/a.checked=true, doc/a.disabled=false, doc/b.checked=false, doc/b.disabled=true
- `tree-switch-two-instances#10`: doc/a.checked=true, doc/a.disabled=false, doc/b.checked=true, doc/b.disabled=false
- `tree-switch-two-instances#11`: doc/a.checked=true, doc/a.disabled=false, doc/b.checked=true, doc/b.disabled=true
- `tree-switch-two-instances#12`: doc/a.checked=true, doc/a.disabled=true, doc/b.checked=false, doc/b.disabled=false
- `tree-switch-two-instances#13`: doc/a.checked=true, doc/a.disabled=true, doc/b.checked=false, doc/b.disabled=true
- `tree-switch-two-instances#14`: doc/a.checked=true, doc/a.disabled=true, doc/b.checked=true, doc/b.disabled=false
- `tree-switch-two-instances#15`: doc/a.checked=true, doc/a.disabled=true, doc/b.checked=true, doc/b.disabled=true

## Product (docs/api.md §3, §6, §7, §10)

**dragon/tree@0** (`TREE_SCHEMA_REVISION` 0.2; `types.ts`, `analysis/input.ts`, `analysis/link.ts`):
- Modules; components with `params` (typed arguments fixed per call), `states` (domain, initial, origin) and named `slots`; several components per module, each its own owner.
- Nodes: element (tag, `classes: {value: Choice<ClassSymbol | null>, origin}[]`, `attributes: {name, value: Choice<string | null>, origin}[]`, children), text, call (component, args, aliases, slot contents), projection (slot), branch (`when`, `then`, `else`). Every field carries an `Origin`.
- `StateRef`: inside a template `"."` is the enclosing instance; in a call's aliases `local "."` is the callee and `caller` is `"."` or an absolute path (`doc/b`). Instance paths are the document id then call-site ids; node addresses are call-site ids then the template id (`a/trigger`), root-instance nodes keep their id, text is `<element address>:text<k>`.
- Validation: exact shapes, source hashes, spans inside their source, unique ids, references, domains (non-empty, distinct, finite JSON scalars, no NaN/Infinity/-0), values inside domains by type plus value, known state references, class symbols owned by the element's component or the document, `ui-*` attributes only, tags html/body/div (checked on both arms of every branch).
- Linking: instances in preorder, call-cycle rejection, alias substitution (caller domain must be a subset of the local domain), alias-cycle rejection, controlled initial values from the caller, `DocumentEntry.initial` overrides resolved through aliases with conflicts rejected, reachable assignments as the product of free domains, blocked above `MAX_STATE_ASSIGNMENTS` = 1024 (never truncated), and exactly-one-arm checks for every Choice in every reachable case.
- Style uses: component-scoped or document-scoped, ordered by the document's style list. A class symbol is (owner, sheet, name); a class selector matches only symbols of its own sheet and owner. Selectors: type, class, compound, descendant, child, `[ui-x]` and `[ui-x="v"]`; in a component-scoped sheet every compound needs a class, so only the owner's elements (and same-owner ancestors) can match.

**Per-state resolution and outputs** (`project.ts`, `emit/web-css.ts`, `internal.ts`): every reachable assignment is resolved, support-checked and lowered as its own case, keyed by instance-path addresses. The web output is emitted only from the stage-1 results, one class per resolved variant (`dg<n>` numbered by case then preorder), with the internal binding `webClassMap(compiled, assignment)`. `iosLayoutProjection(compiled, env, assignment)`, `resolvedColors(compiled, assignment)`, `compiledFeatures(compiled, target, assignment)` and `compiledCases(compiled)` are internal. `explain({target, at: {node, instance}, property, assignment?})` returns every matching case with the value, cascade origin, `Origin`, losing declarations and the contextual support decision.

**Parity** (`packages/parity`): tree fixtures are directories (`fixture.json`, module sources, CSS files); `tree-fixture.ts` plays the producer and finds every span in the real source text. `render.ts` is the parity-owned authored renderer: from the tree alone it links calls, aliases, projections and branches, enumerates the assignments, and writes logical markup per case; scoping is expressed only by renaming class tokens to `<owner>__<sheet>__<name>` in the markup and (by css-tree positions, text otherwise byte for byte) in the CSS. The compiled page is the same markup with the generated classes and `dragon.css`. Authored captures are committed per case (`expected/<case>.web.json`) and must equal the live capture; vectors are per case.

**Diagnostics** (`diagnostics/`): `Diagnostic = {code, severity, target, origin: Origin, message, why, related, fix: Fix | null, profile: ProofRef | null}`; `Fix` is guarded span edits or manual; diagnostics are built only through the catalogue (`diagnostic(code, init)` takes severity, why and fix kind from the entry). `applyFix` (internal) applies edits atomically across files and refuses stale revisions, hashes, out-of-range spans and overlaps. `formatDiagnostic` is public. Producer diagnostics are `ProducerDiagnostic` (foreign codes) and become `DRAGON_PRODUCER_ERROR` with the original in `related`.

**Diagnostics catalogue summary**: 35 codes (the 19 S2 codes, in their S2 order, then 16 new). Fix kinds: 3 edit (`DRAGON_UNSUPPORTED_AT_RULE`, `DRAGON_UNSUPPORTED_IMPORTANT`, `DRAGON_UNSUPPORTED_PROPERTY`), 32 manual. All severities are `error`. New codes: `DRAGON_TREE_NODE_KIND`, `DRAGON_TREE_RAW_HTML`, `DRAGON_TREE_DUPLICATE_ID`, `DRAGON_TREE_REFERENCE`, `DRAGON_CALL_CYCLE`, `DRAGON_STATE_UNKNOWN`, `DRAGON_STATE_DOMAIN_INVALID`, `DRAGON_STATE_VALUE_DOMAIN`, `DRAGON_ALIAS_CYCLE`, `DRAGON_ALIAS_DOMAIN`, `DRAGON_INITIAL_CONFLICT`, `DRAGON_CHOICE_OVERLAP`, `DRAGON_CHOICE_MISSING`, `DRAGON_STATE_SPACE_LIMIT`, `DRAGON_CLASS_OWNER`, `DRAGON_UNPROVEN_CONTEXT`. `packages/dragon/test/diagnostic-codes.json` is the committed append-only list; `diagnostics.test.ts` checks one entry per code, the S2 codes and the committed list as in-order prefixes, and equality with the live list.

## Tests added or extended

- `diagnostics.test.ts` (32): catalogue completeness; append-only codes; guarded edit fixes applied atomically and refused on a stale revision, a stale hash and a hash that lies about its text; `formatDiagnostic` (1-based line/column, unlocated); 26 malformed or invalid inputs, each with its catalogue code, span text or unlocated origin, `target: null`, both outputs blocked, no projection for any case and no web files: recovered producer error, unknown node kind, raw HTML, duplicate ids, alias cycle, alias domain mismatch, initial value outside its domain (state and document), overlapping arms, missing arms, unknown state reference, five invalid domains (-0, NaN, Infinity, empty, duplicate), stale hash, span outside its source, call cycle, initial conflict, class owner, unknown component, wrong schema revision, state space above the limit; plus the limit itself (1,024 cases compile), typed scalar identity (`true`, `"true"`, `1`) and a condition value outside its domain.
- `tree.test.ts` (10), public path: reversing the sheet order flips the winner (and the losing declaration is reported); same-name `.label` of two components in one module and a third module do not leak; a foreign class symbol is refused; a tag-only compound in a component sheet is refused; projected children keep their owner and address and inherit `color` from the insertion parent (`Origin` inherited from `card/head`); enumeration is the product of the free domains and the aliased state adds none; the two instances are independent (including their web classes); controlled aliases take the caller's initial value while uncontrolled state keeps its own; both branch arms are resolved across the cases and an error in the arm the initial state does not show blocks every output; `stateCollapse` pins one element.
- `types.test-d.ts`: `@ts-expect-error` for absent `outputs` keys (web, android, email), absent `targets` keys on compile and check results, `properties` and `report.outputs`, `explain` with an unconfigured and an unknown target, an unknown config key, an unknown target key, ios without `minimum`, `Compiled<'ios'>` where `Compiled<'web'>` is required, and `Compiled<'ios' | 'web'>` assigned to `Compiled<'web'>`.
- `parity.test.ts` (71): every fixture and case live against committed captures; committed captures are exactly this run's cases; four planted faults; profile proofs; paint table; context keys; deviations; distribution; report; renderer isolation.
- `packages/layout/test/unsupported.test.ts`: every `UnsupportedCode` is raised by the engine.

**Planted faults** (each fails for the right reason):
- box-sizing swap: `block-content-box-padding-border` fails the layout gate, node `box` exceeds 1 device px.
- `variantCollapse`: `cascade-compound-variants` fails `chrome-dual` with fewer computed values equal.
- `colourOnly`: `color-syntax` fails `chrome-dual` on colour channels only (boxes all equal, every problem a colour property); `linux-dragon-layout` passes.
- `stateCollapse` on `a/trigger` (`tree-switch-two-instances`): exactly the 12 cases where instance a is not at its initial state fail, each on `chrome-dual` values (`a/trigger` or `a/knob`) and on `linux-dragon-layout` (every non-initial state of a changes geometry: the knob margin, the `.on` border or the disabled padding); the 4 cases with a at its initial state, including the initial case, pass both lanes.

## S2 must-fix items

- **M1**: `scripts/gen-profile-rows.ts` (`pnpm run profile:rows`) runs every layout case against the committed captures with the profiles not enforced (`InternalOptions.profiles: 'derive'`, used only here) and writes `profiles/ios.ts` and `web.ts` through `packages/parity/src/profile-rows.ts` (`deriveRows`). `parity.test.ts` checks, for every target, row and proof, that the named cases equal exactly the cases that passed that lane and use the row key, that every key any case uses has a row, and that the rows equal `deriveRows` over this run. The regeneration check includes `profile:rows`.
- **M2**: row keys are `<feature>@<context>`, computed by one compiler function (`analysis/context.ts`: `formattingContext`, used by `usedKeys`), which both `checkSupport` and the generator use. Item properties take `root`, `block`, `flex-row`, `flex-column` (or `display-none`); container properties take the container's own line mode (`flex-row-single-line`, `flex-row-multi-line`, `flex-column-single-line`, `flex-column-multi-line`, or `not-flex-container`). A feature proven only in other contexts blocks with `DRAGON_UNPROVEN_CONTEXT`, whose message and fix name the proven contexts (fixture `reject-unproven-context`: `margin-top: auto` in block, proven only on flex items). `Proof` records `valueSubset` and `context`; `ProfileRow` has `feature` and `context`.
- **M3**: px lengths are `<length-px>` (other units `<length-<unit>>`); a test checks no row key contains `<length>`.
- **M4**: `flex-distribution-grid` (justify-content and align-content x space-between/around/evenly/center x n = 2, 3, 5, 7, odd free space in LU: 29, 1107, 333, 2021 and 45, 707, 1111, 1333) passes with 170/170 nodes exact. The test reads the committed capture and finds, for each of space-around, space-evenly and space-between, at least one of the 34 committed nodes the truncation model misplaces (see deviation 1).
- **M5**: `ChromeDeviation.nodes` lists one node per branch: `half-leading-floor` `t3:text0`; `min-max-end-margin` `p4`, `p5`, `p6`, `p7`, `p9`. Every node matches Chrome exactly at 1/64 px in this run (see deviation 2).
- **M6**: `margin-collapse` removed from `UnsupportedCode`, and `flex-align-content-value` too (also never raised); a layout test requires every code to be raised by the engine.
- **M7**: `parity.test.ts` checks every `packages/parity/fixtures` entry (file or directory) is in `FIXTURES` and every `FIXTURES` entry has its file (`<id>.html` or `<id>/fixture.json`), with unique ids.
- **M8**: `PROPERTY_ASPECTS` in `css/properties.ts` classifies every longhand as layout and/or paint (`border-*-style` is both). The generator and the test use it; the test's regex is gone. No iOS row with a paint aspect is exact: 69 iOS rows are `caveat` with a `computed-value` proof on `chrome-dual`, including every `border-*-style` row (solid in block, flex-row and flex-column), and layout-and-paint rows also carry their `linux-dragon-layout` layout proof.
- **M9**: text properties (`font-family`, `font-size`, `line-height`, `text-align`) take the context `single-line-text`; iOS `font-family:Ahem` has only that context. S3b removes it.

## Deviations from the task text

1. **M4, space-between.** S1's code rounded space-between (`round(free*k/(n-1))`, the model still in use), so S1 itself cannot mismatch it. For space-between the test checks the truncating variant `trunc(free*k/(n-1))`; for space-around and space-evenly it checks S1's own truncation model. The test comment says so.
2. **M5 branch labels.** T027 lists p4, p5, p6 as the "dropped" branch and p9 as the other. By the fixture CSS, p4 (min-height 40px), p6 (max-height 8px) and p9 (min-height 20px) change the 12px content height (dropped), while p5 (min-height 5px) leaves it unchanged (collapsed through). The nodes are labelled by the CSS, and p7 (max-height 100px, unchanged) is added so both branches are covered for min and max.
3. **M6** also removed the dead `flex-align-content-value`.
4. **`explain`** implements `at: {node, instance}` with an optional partial assignment. Source-position queries (`at: {source, offset}`) and `choose-instance` are not implemented; S3a does not require them.
5. **`DocumentEntry.rootInstance`** names the root component (as in S1/S2); the root instance path is the document id. api.md's example uses an instance path there. A root component may not take parameters or slots.
6. **Arguments** are modelled as component `params` (finite typed domains) with per-call `args`; conditions read them like states.
7. **Scoping rule.** In a component-scoped sheet every compound must contain a class, so owner scoping is exactly expressible by renaming class tokens; tag-only selectors (`body`) go in document-scoped sheets.
8. **Attributes** take `string | null` values and only `ui-*` names; `aria-*` is refused like any other attribute.
9. **Text context** `single-line-text` is assigned to text properties by role rather than detected per text run: the engine lays out single lines only and refuses the rest.
10. **Colour unit test** (`compile.test.ts`) now asserts that `color: hsl()` on body is `DRAGON_UNPROVEN_CONTEXT` (proven only on flex-row items) and tests colour resolution with the non-enforcing internal option.
11. **Emitted CSS** of the 34 S2 fixtures changed only in its digest header line (the digest covers the profiles and schema revision); rule bodies are identical.
12. **Case ids** are the fixture id for HTML fixtures and `<fixture>#<k>` for tree fixtures; committed files use the same names.

## Risks and open items for the PM

- iOS colour and paint rows stay capped at caveat (now 69 rows, every `border-*-style` row included). This needs owner visibility.
- The authored renderer re-implements linking and condition evaluation independently of Dragon by design; a shared misreading of api.md §3 would pass both. The conformance tests pin the intended readings.
- `MAX_STATE_ASSIGNMENTS` = 1024 is a chosen constant; no required fixture is near it (largest 16).
- Every reachable case is resolved in `check()` too; 1,024 small cases compile in well under a second here, but large trees are unmeasured.
- Still open from S2: Linux UA capture (macOS root font-family Times), DPR other than 1, Blink citations for the distribution model and min-max-end-margin, css-tree's `createRequire` for the browser-worker check.
- S3b items untouched: multi-line text, mixed inline content, loose text wrapping, text min-content in flex, projected literal text (no fixture projects text directly).
