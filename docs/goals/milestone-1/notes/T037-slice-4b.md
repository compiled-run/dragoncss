# T037 S4b: position relative and absolute, rtl environments for HTML fixtures, planted positioning faults, platform rules, T036 must-fix M1-M5, T005 rec1 and rec4

Worker, 2026-09-27, claude-code. Board: `docs/goals/milestone-1/state.yaml`, task T037. Spec: "S4b objective (binding)", the must-fix list and the T005 placement in `notes/T036-s4a-review-s4b-plan.md`; standing rules from `notes/T022-own-layout-plan.md`. Base: 15e4d50 (S4a note). Code commit: 8725ef3, local only, not pushed.

**Flag for the gate: this slice adds one Chrome deviation that T036 did not rule, `wrap-reverse-baseline-line`.** It is recorded with measured nodes on both branches (MF5 pattern). By the T036 gate rule, a Judge round is needed before S5. Everything else in the gate conditions holds (see "Gate conditions" at the end).

## Result

| | Count |
|---|---|
| Fixtures | 135 (97 in S4a): 114 layout (99 HTML, 15 tree), 21 reject (15 HTML, 6 tree) |
| New fixtures | 38: 35 layout and 3 reject |
| New layout fixtures | 27 hand-written positioning (`position-*`, `flex-abspos-*`), 3 M5, 1 tree, 4 generated |
| Layout fixtures that are not generated | 110 (at least 105 required even without the 4 generated ones) |
| Fixtures passing | 135 of 135; failed 0 |
| Parity cases | 254: ltr 161 and rtl 93; 254 pass both lanes |
| `linux-dragon-layout` (1 device px gate) | 254 of 254 cases pass; 6,759 of 6,759 compared nodes exact at 1/64 px (informational) |
| Text nodes / per-line fragments | 567 of 567 / 951 of 951 exact |
| Anonymous boxes (Dragon only, listed in the report) | 55, each with every text line compared |
| `chrome-dual` | boxes 6,773 of 6,773; computed values 294,280 of 294,280; colour channels 32,097 of 32,097 |
| LayoutUnsupported hits | none (`unsupportedCodes: []`) |
| Profiles | ios 1,175 rows (954 exact, 221 caveat), web 1,175 rows (all exact), revision `m1-s4b`; 560 iOS rows carry an `rtl` facet, 120 are paint rows, 324 are positioned item rows |
| Tests | 17 files, 733 tests, both runs |

Per environment:

| Direction | Cases | Layout lane | Dual lane | Nodes exact | Text | Lines | Anon | Dual boxes | Values | Channels |
|---|---|---|---|---|---|---|---|---|---|---|
| ltr | 161 | 161 pass | 161 pass | 4641/4641 | 416/416 | 695/695 | 38 | 4655/4655 | 198464/198464 | 21680/21680 |
| rtl | 93 | 93 pass | 93 pass | 2118/2118 | 151/151 | 256/256 | 17 | 2118/2118 | 95816/95816 | 10417/10417 |

Nothing was loosened. The 1 device px gate and the exact dual equality are unchanged. No fixture, case, node or property is skipped, excluded, deduplicated or factored; symmetric rtl cases run like any other. No generated fixture was dropped or deselected. One registered fixture was changed after it ran, and two had authoring slips fixed before their first run; see "Deviations" 2, 11 and 12.

## Commands run (T037 verify list)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass ("Already up to date"); `pnpm-lock.yaml` unchanged (`shasum -c` before and after); `git diff` empty for `package.json`, the lockfile, the package manifests, `tsconfig*` and `vitest.config.ts` |
| `pnpm typecheck` (`tsc -b`, includes `planted/drop-field.ts` and `types.test-d.ts` with the new union pins) | pass (exit 0) |
| `pnpm test`, run 1 | pass: 17 files, 733 tests |
| `pnpm test`, run 2 | pass: 17 files, 733 tests; `packages/parity/out/report.json` byte-identical to run 1 (`cmp`) |
| Regeneration on the committed tree (8725ef3): `node scripts/gen-granularity-fixtures.ts && pnpm run grammar:gen && pnpm run ua:capture && pnpm run parity:capture && pnpm run layout:vectors && pnpm run profile:rows`, then `/opt/homebrew/bin/git diff --exit-code -- packages scripts` and `git status --porcelain --untracked-files=all` on `packages/dragon/src`, `packages/parity/expected`, `packages/parity/emitted`, `packages/parity/fixtures`, `packages/parity/generated` and `packages/layout/vectors` | pass: regeneration exit 0 (G1 55 selected, 3 rejected; G2 24 containers; G3 78 declarations; 254 vectors; 1,175 rows per target), diff exit 0, 0 untracked files. `scripts/import-taffy-gentest.ts` was not written (the optional import was skipped) |
| Base-capture check against 15e4d50 (`/tmp/t037/base-check.mjs`, output below) | pass, after the regeneration |
| `pnpm run parity:report`, then `test -s` on `out/report.json` and `out/index.html` | pass: "135/135 fixtures pass, 114 layout (254 cases, 254 pass; ltr 161/161, rtl 93/93); layout 6759/6759 nodes exact at 1/64 px (text 567/567, lines 951/951, 55 anonymous boxes); dual boxes 6773/6773, values 294280/294280, channels 32097/32097"; the CLI report equals the test-run report byte for byte |
| `report.json` summary | 114 layout fixtures (at least 105); 27 hand-written positioning fixtures (at least 20); `generatedFixtures` has 4 entries (at most 4); failed 0; `unsupportedCodes: []`; every layout case in both environments has `linux-dragon-layout: pass` and `chrome-dual: pass`; `anonymousBoxes`, line counts, `caseCounts` per environment, `casesByDirection` and each case's `direction` listed |
| Registry test | pass: every `position-*` and `flex-abspos-*` HTML fixture declares `environments: ['ltr','rtl']` and has one case and committed capture per environment, whose file-level `direction` and root computed `direction` match; no fixture id ends in `-rtl`; `packages/parity/generated/granularity-selection.json` is committed, names exactly the fixtures registered as generated, and each appears in the report and passes. No Taffy filter exists (import skipped) |
| Case-count check (MF1, per environment) and text topology test | pass for every tree fixture in both directions, `tree-position-toggle` included (4 cases per environment; its declared topology changes the panel text context with the state) |
| Profile-proof test | unchanged in strength: rows equal `deriveRows` exactly; every proof names exactly the passing cases that use its key; every used key has a row. Every context has a direction facet; the flex text contexts a main-axis facet; positioned item contexts the scheme plus the parent and containing-block directions; paint rows are exactly `@paint/<dir>`. Every text row context (12) has a proving case with a wrapped text node. No iOS paint row is exact. `block-min-max` compiled in rtl still blocks with `DRAGON_UNPROVEN_CONTEXT` naming only `/ltr` proofs. Every proving case of a row has an element of each of the row's direction facets (`cb-<dir>` included) in its Chrome capture. Structural paint tests (i)-(iii) pass (`s4b.test.ts`, plus the existing `ua.test.ts` colour grep) |
| Planted tests | pass: box-sizing swap, variantCollapse, colourOnly, stateCollapse, dropInheritedText, breakOffByOne, rtlAsLtr, ignoreOrder, baselineFromBorderTop, scrollMinAuto as before; the four new engine faults, ignoreEnvironmentDirection, metricHalfUp and untruncatedFontSize (tables below) |
| Deviation and platform-rule test (MF5) | pass: 4 deviations with 9 branches and 2 platform rules with 2 branches; every branch has nodes; all 28 nodes (22 deviation, 6 platform-rule) exact at 1/64 px in this run; `auto-margin-overflow-cross-start` includes `column-wrap-reverse-rtl`; both platform rules carry `darwin-arm64` |
| Engine unit tests and vectors | pass: `position.test.ts` (38, new), `flow.test.ts` (30, with the M3 test), `validate.test.ts` (5, with the S4b rejections), `vectors.test.ts` (254 vectors plus the missing-field fault), `unsupported.test.ts` (every code raised, `abspos-in-inline` included) |
| Diagnostics tests | pass; `diagnostic-codes.json` unchanged (no code added or removed); `s4b.test.ts` shows the `DRAGON_UNSUPPORTED_AT_RULE` fix is manual and `applyFix` keeps the enclosed rules; the reject fixtures `reject-position-fixed`, `reject-position-sticky` and `reject-abspos-in-inline` yield `DRAGON_UNSUPPORTED_VALUE` on `fixed`, `sticky` and `absolute` with ios and web blocked |
| Public-entry test (MF2) | pass: the default entry exports exactly `createProject`, `formatDiagnostic`, `TREE_SCHEMA_REVISION`; `createProject.length` is 1; `Environment`, `InternalOptions` and direction stay internal; derive and enforce digests differ; ltr and rtl digests differ; the public `createProject` explains html `direction` as cascade `environment` (`s4b.test.ts`) |
| S1 greps | pass, 0 matches each: no `node:`/fs/path/child_process/url/module/playwright imports in `packages/dragon/src` or `packages/layout/src`; only `import type` from `@dragon/layout` in `packages/dragon/src`; no `??`, `?:`, `?.` in `packages/layout/src`; Math rounding only in `units.ts`; no `Date`, `Math.random`, `performance.`, `process.`, `globalThis` in `packages/layout/src` |
| Colour conversion only in `css/color.ts`; the web emitter imports neither `lower/ios-layout.ts` nor `@dragon/layout` and matches no selectors | pass (grep plus `ua.test.ts`; the emitter's import list is unchanged) |
| Renderer isolation | pass: `render.ts` imports exactly `css-tree` and `import type` from `dragon`; only `chrome.ts` writes the harness style, and both renderings are captured through it in the case environment |
| Fixture registry, committed-captures, distribution, C6 tests | pass |
| Dependency, private and export-map checks | pass, unchanged: dragon dependencies `{css-tree: 3.2.1}`; exports only `'.'` with `{dragon-internal, default}`; layout private with no dependencies; parity private |

Tests per file: dragon color 32, compile 40, diagnostics 33, s4a 24, s4b 13 (new), text 15, tree 10, ua 12; layout engine 17, flow 30, inline 25, position 38 (new), units 13, unsupported 1, validate 5, vectors 256; parity 169.

git is `/opt/homebrew/bin/git`. The PM's uncommitted files (`docs/` except this note, `README.md`, `state.yaml`) were not touched or committed. Scratch probes are under `/tmp/t037`.

## New fixtures and match counts

Exact LU is informational; the gate is 1 device px. The existing 97 fixtures keep their S4a counts (see the base-capture check). Their dual value counts grow by four inset values per element.

| Fixture | Kind | Result | Cases (per environment) | Exact LU | Lines | Dual boxes | Values | Channels | Anon | Reject code |
|---|---|---|---|---|---|---|---|---|---|---|
| position-relative-block | html layout | pass | 2 (ltr 1 + rtl 1) | 54/54 | 0/0 | 54/54 | 3024/3024 | 324/324 | 0 |  |
| position-relative-percent | html layout | pass | 2 (ltr 1 + rtl 1) | 44/44 | 0/0 | 44/44 | 2464/2464 | 264/264 | 0 |  |
| position-relative-flow | html layout | pass | 2 (ltr 1 + rtl 1) | 60/60 | 16/16 | 60/60 | 2016/2016 | 224/224 | 0 |  |
| position-relative-flex | html layout | pass | 2 (ltr 1 + rtl 1) | 56/56 | 0/0 | 56/56 | 3136/3136 | 336/336 | 0 |  |
| position-relative-flex-baseline | html layout | pass | 2 (ltr 1 + rtl 1) | 98/98 | 28/28 | 98/98 | 2464/2464 | 290/290 | 0 |  |
| position-absolute-containing-block | html layout | pass | 2 (ltr 1 + rtl 1) | 46/46 | 0/0 | 46/46 | 2576/2576 | 276/276 | 0 |  |
| position-absolute-static-block | html layout | pass | 2 (ltr 1 + rtl 1) | 62/62 | 0/0 | 62/62 | 3472/3472 | 372/372 | 0 |  |
| position-absolute-static-direction | html layout | pass | 2 (ltr 1 + rtl 1) | 60/60 | 16/16 | 60/60 | 2016/2016 | 224/224 | 0 |  |
| position-absolute-initial-containing-block | html layout | pass | 2 (ltr 1 + rtl 1) | 26/26 | 0/0 | 26/26 | 1456/1456 | 156/156 | 0 |  |
| position-absolute-shrink-to-fit | html layout | pass | 2 (ltr 1 + rtl 1) | 122/122 | 56/56 | 122/122 | 2128/2128 | 256/256 | 0 |  |
| position-absolute-auto-margins | html layout | pass | 2 (ltr 1 + rtl 1) | 46/46 | 0/0 | 46/46 | 2576/2576 | 276/276 | 0 |  |
| position-absolute-over-constrained | html layout | pass | 2 (ltr 1 + rtl 1) | 32/32 | 0/0 | 32/32 | 1792/1792 | 192/192 | 0 |  |
| position-absolute-min-max | html layout | pass | 2 (ltr 1 + rtl 1) | 52/52 | 14/14 | 52/52 | 1792/1792 | 198/198 | 0 |  |
| position-absolute-height | html layout | pass | 2 (ltr 1 + rtl 1) | 42/42 | 14/14 | 42/42 | 1232/1232 | 138/138 | 2 |  |
| position-absolute-percent | html layout | pass | 2 (ltr 1 + rtl 1) | 30/30 | 0/0 | 30/30 | 1680/1680 | 180/180 | 0 |  |
| position-absolute-out-of-flow | html layout | pass | 2 (ltr 1 + rtl 1) | 52/52 | 4/4 | 52/52 | 2464/2464 | 268/268 | 0 |  |
| position-absolute-scroll-container | html layout | pass | 2 (ltr 1 + rtl 1) | 32/32 | 0/0 | 32/32 | 1792/1792 | 192/192 | 0 |  |
| position-absolute-flex-container | html layout | pass | 2 (ltr 1 + rtl 1) | 44/44 | 2/2 | 44/44 | 2240/2240 | 242/242 | 0 |  |
| position-absolute-nested | html layout | pass | 2 (ltr 1 + rtl 1) | 42/42 | 4/4 | 42/42 | 2016/2016 | 218/218 | 0 |  |
| flex-abspos-justify | html layout | pass | 2 (ltr 1 + rtl 1) | 100/100 | 0/0 | 100/100 | 5600/5600 | 600/600 | 0 |  |
| flex-abspos-align | html layout | pass | 2 (ltr 1 + rtl 1) | 90/90 | 0/0 | 90/90 | 5040/5040 | 540/540 | 0 |  |
| flex-abspos-column | html layout | pass | 2 (ltr 1 + rtl 1) | 104/104 | 0/0 | 104/104 | 5824/5824 | 624/624 | 0 |  |
| flex-abspos-reverse | html layout | pass | 2 (ltr 1 + rtl 1) | 164/164 | 0/0 | 164/164 | 9184/9184 | 984/984 | 0 |  |
| flex-abspos-wrap-reverse | html layout | pass | 2 (ltr 1 + rtl 1) | 172/172 | 0/0 | 172/172 | 9632/9632 | 1032/1032 | 0 |  |
| flex-abspos-center-shrink | html layout | pass | 2 (ltr 1 + rtl 1) | 76/76 | 28/28 | 76/76 | 2016/2016 | 228/228 | 0 |  |
| flex-abspos-insets | html layout | pass | 2 (ltr 1 + rtl 1) | 38/38 | 0/0 | 38/38 | 2128/2128 | 228/228 | 0 |  |
| flex-abspos-excluded | html layout | pass | 2 (ltr 1 + rtl 1) | 76/76 | 6/6 | 76/76 | 3584/3584 | 390/390 | 0 |  |
| flex-baseline-nested-reverse (M5) | html layout | pass | 1 (ltr 1) | 64/64 | 17/17 | 64/64 | 1680/1680 | 197/197 | 0 |  |
| flex-auto-margins-reverse-overflow (M5) | html layout | pass | 1 (ltr 1) | 25/25 | 0/0 | 25/25 | 1400/1400 | 150/150 | 0 |  |
| flex-order-baseline-wrap-reverse (M5) | html layout | pass | 1 (ltr 1) | 39/39 | 11/11 | 39/39 | 952/952 | 113/113 | 0 |  |
| profile-initial-values-box (G1) | html layout, generated | pass | 2 (ltr 1 + rtl 1) | 604/604 | 0/0 | 604/604 | 33824/33824 | 3624/3624 | 0 |  |
| profile-initial-values-text (G1) | html layout, generated | pass | 2 (ltr 1 + rtl 1) | 268/268 | 144/144 | 268/268 | 4256/4256 | 504/504 | 24 |  |
| gap-contexts (G2) | html layout, generated | pass | 2 (ltr 1 + rtl 1) | 196/196 | 0/0 | 196/196 | 10976/10976 | 1176/1176 | 0 |  |
| color-syntax-matrix (G3) | html layout, generated | pass | 2 (ltr 1 + rtl 1) | 162/162 | 0/0 | 162/162 | 9072/9072 | 972/972 | 0 |  |
| tree-position-toggle | tree layout | pass | 8 (ltr 4 + rtl 4) | 60/60 | 12/12 | 60/60 | 2240/2240 | 248/248 | 0 |  |
| reject-position-fixed | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-position-sticky | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |
| reject-abspos-in-inline | html reject | pass | 0 | - | - | - | - | - | 0 | DRAGON_UNSUPPORTED_VALUE |

## Mapping rules (measured in Chrome 145.0.7632.6, probes `/tmp/t037/p1.mts`-`p11.mts`, each held on every capture)

### Relative positioning (CSS2 §9.4.3)

1. The offset is applied after layout. The box's in-flow position, its siblings, margin collapsing, flex lines, baseline groups and container baselines all keep the in-flow position (probe p1 `a2`, p1 margin case, p10 `g2`/`g3`, fixture node `f3ba`'s parent `f3b`).
2. The containing block is the parent's content box and its direction: `top` wins over `bottom`. `left` wins over `right` when the parent is ltr, and `right` wins when it is rtl, whatever the box's own direction (p1 `i2`, fixture nodes `d4`, `e1`). One auto side is minus the other; both auto is zero.
3. `left`/`right` percentages resolve against the containing block width. `top`/`bottom` percentages resolve against its height when it is definite, and behave as auto when it is not (p1 `e`, `h`; p10 `m1`). Against a flexed height that §9.8 does not make definite, they are refused as `percent-height-flex`.

### Containing block (CSS2 §10.1)

4. An absolutely positioned box's containing block is the padding box of its nearest ancestor with `position` other than static. Without one it is the initial containing block: the viewport rectangle at (0, 0), with the root's direction (p3 `a1`/`b1`, p5 `a2`/`a3`, rtl probe `b3`).
5. A scroll container is a containing block only when positioned. Its padding box is used unscrolled (p5 `sca`, `sc2a`).
6. Percentages of an absolutely positioned box resolve against the containing block: `left`/`right`/`width`/margins/padding against its width, and `top`/`bottom`/`height` against its height (p3 `p1`-`p3`, p9 `m1`/`m2`).

### Static position (css-position-3 §4.1)

7. **Block flow.** Blink `HandleOutOfFlowPositioned`: the static position is the parent's content-box start edge in the parent's direction (left edge in ltr, right edge in rtl). Vertically it is the flow cursor plus the pending collapsed margins once the parent's block offset is fixed, and the content top before that (p2 `a1`, `a2`; p5 `ea`, `eb`, `ed`, `eg`). The box's margin edge sits there.
8. **Flex containers** (css-flexbox-1 §4.1): the position of a sole flex item of the container's used size.
   - Main axis: `justify-content` in flow terms, exactly as for items. The reverse directions swap flex-start and flex-end; `left`/`right` are physical in rows. `space-between`, `normal` and `stretch` act as flex-start, and `space-around` and `space-evenly` as center.
   - Cross axis: `align-self` (auto takes `align-items`). `normal` and `stretch` act as flex-start, which wrap-reverse moves to the end; `baseline` acts as `start`; `self-start`/`self-end` follow the child's own direction in columns.
   - `align-content` has no effect.
   - A centre is the content-box start plus LayoutUnit / 2 of the content size, measured from the flow start of that axis (probes p6: 320 containers, p7, p8).
9. The static position is a point plus an edge: start, end or centre. It is converted to the containing block's logical coordinates, where the parent's start edge becomes the end edge if the containing block's direction differs (p2 `a3`, `a4`; fixture `position-absolute-static-direction`).

### Size and position of an absolutely positioned box (CSS2 §10.3.7, §10.6.4, css-position-3 §4)

10. **Both insets auto** in an axis:
    - The inset-modified containing block is `[static, size]` for a start edge and `[0, static]` for an end edge. For a centre it is the widest range centred on the static position (twice the smaller distance to either edge).
    - Auto margins are zero.
    - The box aligns to that edge; centred, it starts at `start + (range - margin box) / 2` with LayoutUnit / 2 (p7 `a11`: width 7122 LU; p8: 3113, 3112, 3114, 3114).
11. **One inset auto**: the box is placed from the other inset, and auto margins are zero (p3 `g4`, `h4`; p4 `s4`).
12. **Width**:
    - specified;
    - or, with both horizontal insets set, stretched between them (auto margins zero);
    - or shrink-to-fit `min(max(min-content, available), max-content)`, where the available size is the inset-modified containing block minus the non-auto margins.
    - Then min/max width apply. A clamped width is treated as specified, so auto margins centre it (p4 `s1`-`s5`, `t1`-`t4`).
13. **Height**: specified; with both vertical insets set and `height: auto`, stretched between them (definite for percentage children, p3 `p3c`); otherwise the content height. min/max height apply.
14. **Over-constrained and auto margins**, solved in the containing block's direction:
    - With no auto margin, the end inset is ignored (right in ltr, left in rtl; bottom always).
    - One auto margin takes the free space.
    - Two auto inline margins give the start margin `free / 2` (LayoutUnit truncation, p4 `o1` 4479 vs `o4` 4480). With negative free space the start margin is zero (p3 `f3`, `f4`).
    - Two auto block margins split the free space even when it is negative (p3 `v2`, p4 `o3`: -4160 LU).
15. **Out-of-flow**: an absolutely positioned box takes no part in its parent's auto height, intrinsic sizes, margin collapsing (a parent holding only one collapses through), baselines, flex lines, gaps, `order` or distribution (p5 `e1`/`mid`, p9 `st`/`stc`, fixtures `position-absolute-out-of-flow`, `flex-abspos-excluded`).
16. **Beside text**: an absolutely positioned box beside text sits in the text's inline formatting context in Chrome and creates no anonymous block. Dragon refuses it (engine `abspos-in-inline`, compiler `DRAGON_UNSUPPORTED_VALUE` at the `position` value on every target), so the compiler's anonymous boxes never differ from Chrome's.

The engine lays out every in-flow box first. It then places each absolutely positioned box in preorder, once its parent and containing block have their final absolute rects (relative offsets included), and appends its subtree to the output after the in-flow boxes.

## Objective items A and B mapped to named fixture nodes

**A. position: relative**

| Item | Fixture: nodes |
|---|---|
| px and percentage insets | position-relative-block: `a1`, `a2`, `e2`, `e4`; position-relative-percent: `a1`-`a5` (auto height), `b1`-`b5` (definite), `d1`-`d3`, `e1`, `e2` |
| top wins over bottom | position-relative-block: `b2`; position-relative-percent: `a2`, `b2` |
| left wins in ltr, right wins in rtl (containing block direction) | position-relative-block: `b1`, `d1`, `d2`, `d3`, `d4` (ltr box in rtl block), `e1` (rtl box in ltr block); position-relative-flex: `f2b`; both cases of each (the rtl environment flips the unauthored boxes) |
| no effect on siblings | position-relative-block: `s1`, `s2`, `f1b`; position-relative-flow: `s1`-`s4`, `t2` |
| no effect on margin collapsing | position-relative-flow: `p1`/`q1` (relative child), `p2`/`q2` (relative parent), `e1` (relative collapse-through box) |
| no effect on flex line layout | position-relative-flex: `f1b`, `f1c`, `f6a`-`f6d` (wrap), `f3a`/`f3b` (centre, order), `f4a`-`f4c` (column) |
| relative flex items | position-relative-flex: `f1a`, `f2a` (rtl), `f4a` (percentages in a definite column), `f5a` (row-reverse), `f7` (relative container); position-relative-flex-baseline: `f1a`, `f2ba`, `f2c`, `f3c`, `f4a`, `f4c`; tree-position-toggle `panel` |

**B. position: absolute**

| Item | Fixture: nodes |
|---|---|
| containing block: nearest positioned ancestor's padding box | position-absolute-containing-block: `a1`-`a4`, `b1`/`b2` (static ancestors skipped), `d1`-`d3` (rtl), `e1`-`e3` (absolute containing blocks, nested `x2`); position-absolute-nested: `a1` (relative ancestor with an offset), `a2`-`a4`, `a7`, `ti` |
| initial containing block | position-absolute-initial-containing-block: `a1`-`a9` (static, corners, percentages, stretch, auto margins; rtl root in the rtl case) |
| static position in block flow, ltr and rtl | position-absolute-static-block: `a1`, `a2` (after pending margins), `a3`-`a5` (rtl), `a6` (collapse-through parent), `a7`, `a8` (border-top parent), `a9` (after a collapse-through sibling), `a10`; position-absolute-static-direction: `a1`-`a4`, `t1`-`t4` (parent and containing-block directions mixed) |
| shrink-to-fit with wrapped Ahem text | position-absolute-shrink-to-fit: `s1`-`s6`, `r1`-`r6`, `m1`-`m3` and their `:text0:line<j>`; position-absolute-static-direction: `t3`, `t4`; flex-abspos-center-shrink: `a1`, `a2`, `a5`-`a7` |
| auto margins | position-absolute-auto-margins: `h1`-`h6`, `r1`-`r6` (odd, negative, one side), `v1`-`v6` (vertical, negative split) |
| over-constrained, ltr and rtl | position-absolute-over-constrained: `o1`-`o6`, `p1`-`p6` (including a box direction different from the containing block's) |
| min/max | position-absolute-min-max: `a1`-`a7`, `b1`-`b7` |
| height from insets, from content, with auto margins | position-absolute-height: `h1`, `h2` (insets, `h1k`/`h2k` percentage children), `h3`, `h4` (content, top- and bottom-anchored), `h5` (static); position-absolute-auto-margins: `v1`-`v6` |
| excluded from auto height | position-absolute-out-of-flow: `p1`, `p2`, `i1`, `i2` |
| excluded from intrinsic sizes | position-absolute-out-of-flow: `i1` (22 px wide around a 20 px child and a 300 px absolute box), `i2` |
| excluded from margin collapsing | position-absolute-out-of-flow: `q1` (collapses with `p1` through `a1`), `p2` (collapses through with only `a3`) |
| excluded from baselines | position-absolute-out-of-flow: `b1a`, `b1c`; flex-abspos-excluded: `c3a`, `c3b` |
| excluded from flex lines and gaps | flex-abspos-excluded: `c2a`-`c2c` (wrap), `c4a`, `c5a`/`c5b` (column gap) |
| excluded from order | flex-abspos-excluded: `c1a`-`c1c` beside `a1` (order -5) and `a2` (order 3); `c6a`/`c6b` |
| excluded from anonymous-box creation | refused rather than modelled: reject-abspos-in-inline (`DRAGON_UNSUPPORTED_VALUE` on `absolute`); an absolute box beside elements only needs no anonymous box (`s4b.test.ts`) |
| flex children: static position under justify-content | flex-abspos-justify: `a1`-`a24` (12 values, ltr and rtl, odd sizes on even ids); flex-abspos-column: `a1`-`a12` |
| under align-items and align-self | flex-abspos-align: `a1`-`a20`, `a21`/`b21` (self-start/self-end, rtl child); flex-abspos-column: `a13`-`a22`, `a23`/`b23` and `a24`/`b24` (rtl children in an rtl and an ltr column) |
| with reverse | flex-abspos-reverse: `a1`-`a40` |
| with wrap-reverse (align-content ignored) | flex-abspos-wrap-reverse: `a1`-`a42` |
| with rtl | every `flex-abspos-*` rtl case, and the authored rtl containers in flex-abspos-justify (`a13`-`a24`), flex-abspos-reverse and flex-abspos-wrap-reverse |
| insets on one axis, auto margins | flex-abspos-insets: `a1`-`a6`, `b1`, `b2`, `b4`-`b6` |
| inside a scroll container | position-absolute-scroll-container: `a1`, `a2` (containing block outside), `a3`-`a7` (positioned scroll container, rtl) |
| display: flex absolute boxes | position-absolute-flex-container: `f1`-`f3`, `g1`, `g3` and their items |
| fixed and sticky | reject-position-fixed, reject-position-sticky (`DRAGON_UNSUPPORTED_VALUE`; no profile row, and the lowering has no mapping) |
| engine input and validator | `validate.test.ts`: `position` fixed and sticky, an unknown inset tag, a non-finite inset, a missing inset and an absolutely positioned root are rejected; a relative root with a negative percentage is accepted |
| profile contexts | rows such as `position:absolute@absolute-in-flex-row/rtl/cb-rtl`, `top:<length-px>@absolute-in-block/rtl/cb-rtl`, `position:relative@relative-in-flex-row/rtl` (324 iOS rows) |

## (C) rtl environments

- `FixtureSpec` layout entries gain the committed field `environments` (default `['ltr']`) and `source` (`hand-written` or `generated`).
- Every `position-*` and `flex-abspos-*` fixture and every generated fixture declares `['ltr','rtl']`. Each environment gets its own case (`<id>` and `<id>-rtl`), capture, vector and emitted CSS.
- Tree fixtures keep both directions. `tree-position-toggle` (new) toggles `position: absolute` on the `panel` by `[ui-open]`, and picks its insets by `[ui-side]`. In each environment it has 4 cases; the panel's text is `text-in-flex-item/row/<dir>` when closed and `text-in-block/<dir>` when open.

## (D) Planted engine faults

| Fault | Named fixture | Layout lane with the fault | Named nodes that fail | chrome-dual | Fault off |
|---|---|---|---|---|---|
| `absposInFlow` (absolute boxes laid out as static) | `position-absolute-out-of-flow` | fail | `a1`, `q1`, `p2` | pass | pass |
| `cbIgnoresPadding` (containing block = content box) | `position-absolute-containing-block` | fail | `a1`, `a2`, `b2` | pass | pass |
| `staticPosLtr` (static position ignores rtl) | `position-absolute-static-block` | fail | `a3`, `a4` | pass | pass |
| `relativeShiftsFlow` (relative offset moves later siblings) | `position-relative-flow` | fail | `s1`, `s2`, `s3` | pass | pass |

## Must-fix M1-M5

- **M1, platform rules.** `packages/layout/src/platform-rules.ts` has the MF5 shape plus `platform: 'darwin-arm64'`, a Blink source note and the planted fault. The MF5 test covers it together with the deviations.

  | Rule | Branch | Nodes (text-fractional-font-size) | Planted fault: nodes non-exact | Fault off |
  |---|---|---|---|---|
  | `ahem-metric-half-down` | `half-down` | `s1:text0:line1` (15.625px), `half2:text0:line0`, `h3b:text0:line0` | `metricHalfUp`: all three (glyph boxes 1 px taller; the fault also fails the 1 px gate on the nodes below them) | exact |
  | `font-size-truncation` | `size-truncation` | `half:text0:line0` (10.625px), `q:text0:line1` (10.629px), `q2:text0:line0` (11.1111px) | `untruncatedFontSize`: all three (1 LU wider, or the 10.629px box 1 px higher); the gate still passes, so only the exactness test sees it | exact |

  The measurer takes the two rules through `ahemMeasurerWith(faults)`. `ahemMeasurer` is the no-fault instance.
- **M2, pinned unions.** `types.test-d.ts` pins `ExplainedCase['cascade']` to exactly `'author' | 'inherited' | 'user-agent' | 'initial' | 'environment'`, and `Origin` to its five-member union (structurally and by `kind`). A narrowed union is an `@ts-expect-error`. `s4b.test.ts` shows the public `createProject` explains html `direction` as cascade `environment` with origin `{builtin, 'reference environment', 'direction ltr'}`.
- **M3, engine UAX #9 L1.** `checkRtlText` now finds the whitespace sequence (spaces and U+200B) that ends the paragraph across leaves, and raises `bidi-neutral` if it holds a U+200B. `flow.test.ts` covers:
  - raises: `'AB​ '`, `'AB ​ '`, `['AB​', ' ']` (a trailing space-only leaf) and `['AB', '​', ' ​']`;
  - lays out: `['AB', ' ']` and `'AB​ C'`;
  - ltr is unaffected.
- **M4, `ignoreEnvironmentDirection`.** The compiler fault seeds the root direction ltr whatever the environment. With it on, every rtl case of `tree-param-args` and `tree-projected-text` fails chrome-dual on `html: direction authored "rtl" compiled "ltr"` (the emitted CSS pins the direction), and every ltr case passes. With it off all pass.
- **M5, T035's unmeasured combinations.**
  - `flex-baseline-nested-reverse`: nested wrap-reverse rows (`n1`, `n2`, `n5`), rtl rows (`n3`, `n6`) and an rtl row-reverse (`n4`) as baseline sources. This exposed the new deviation below.
  - `flex-auto-margins-reverse-overflow`: auto cross margins with negative space in row-reverse (`f1`, `f2`), column-reverse (`f3`, `f4` rtl) and a column wrap (`f6` rtl). Also the branch `column-wrap-reverse-rtl` nodes `amr-a`, `amr-b`, `amr-c`: flush left at x = 31, where the spec's inline-start rule gives 21 (probe p11).
  - `flex-order-baseline-wrap-reverse`: `order` with baseline groups in wrap-reverse rows, ltr and rtl, and one as a baseline source (`o3a`).

## T005 recommendations

**rec1, by proof.** `scripts/gen-granularity-fixtures.ts` writes the committed selection `packages/parity/generated/granularity-selection.json` and four fixtures, all run in both environments. The selection was printed before any Chrome run:

- **G1 initial values** (`profile-initial-values-box`, `profile-initial-values-text`). Candidates are every longhand's webref initial value (`display: block` from the captured UA data), plus `justify-content: flex-start` and `align-items: stretch` as T036 requires. A candidate belongs to the value subset when a document authoring it compiles in derive mode with no diagnostic and ready outputs, so no profile row decides it.
  - Selected: 55 values. Contexts:
    - item values in block, flex-row and flex-column parents;
    - container values in `not-flex-container` and the four flex line modes;
    - text values in the 6 text contexts, each text node on 3 lines;
    - paint values in one element.
  - This includes `display: block` in block, flex-row and flex-column parents, `flex-direction: row`, `flex-wrap: nowrap`, `justify-content: normal` and `flex-start`, `align-items: normal` and `stretch`, the insets, `position: static` and every border, margin, padding and size initial value.
  - Rejected (listed in the selection, so they stay unproven): `font-size: medium` (`DRAGON_LOWERING_FAILED`, no px); `font-family: depends on user agent` (`DRAGON_UNSUPPORTED_FONT`); `color: CanvasText` (system colour, `DRAGON_UNSUPPORTED_VALUE`).
  - Contexts listed as not buildable:
    - `flex-direction: row` in the two column modes and `flex-wrap: nowrap` in the two multi-line modes (the value overrides the context's own declaration);
    - every `*/rtl` facet of `direction: ltr` (the declaration sets the facet);
    - root and display-none item contexts.
- **G2 gap contexts** (`gap-contexts`). `gap: 7px`, `gap: 0px`, `row-gap: 5px`, `row-gap: 0px`, `column-gap: 6px` and `column-gap: 0px` in flex-row and flex-column, single-line and multi-line, 3 items each, multi-line containers on 2 or more lines. This proves `row-gap:<length-px>@flex-row-single-line/*` and `column-gap:<length-px>@flex-column-single-line/*`.
- **G3 colour matrix** (`color-syntax-matrix`). 13 syntaxes on the 6 colour longhands, 78 declarations, 0 rejected: hex 3/4/6/8, `rgb()`, `rgba()`, `hsl()`, `hsla()`, named, `transparent`, `currentcolor`, `inherit`, `initial`.
- **Paint role.** `PROPERTY_ROLE` gains `paint`, derived from `PROPERTY_ASPECTS` (layout false, paint true): `color`, `background-color`, `border-*-color`. Paint rows are keyed `@paint/<element direction>`, and iOS paint rows stay caveat. Structural tests:
  - (i) paint holds exactly for those longhands;
  - (ii) for each of them, two elements differing only in it lower to identical `LayoutStyle` and text leaves;
  - (iii) colour rounding stays in `css/color.ts`.
- Nothing is skipped as inert: every declaration keeps a row and every row a passing proof.

**rec4.** The `DRAGON_UNSUPPORTED_AT_RULE` fix is now manual: "Move the rules out of the at-rule". It says to move the declarations into top-level rules and warns that deleting the at-rule deletes them. No edit is attached, and `applyFix` returns the manual instruction with the source unchanged (`s4b.test.ts`). The code is unchanged.

**(G) Taffy gentest import:** skipped (optional). No Taffy file, filter or number was read or vendored.

## Chrome deviations and platform rules

| Entry | Spec | Blink (measured) | Branches and proving nodes |
|---|---|---|---|
| `wrap-reverse-baseline-line` (**new, not ruled by T036: needs a Judge round**) | css-flexbox-1 §8.5: the container's first baseline comes from its first flex line. Lines are numbered from cross-start, so under wrap-reverse a row's first line is the bottom one | Chrome 145 takes a wrap-reverse row container's baseline from its block-start (top) line, the last flex line (fixture flex-baseline-nested-reverse; before the change `f1a`, `f2a`, `f4a` and `o3a` missed by 9 to 31 px) | `shared-baseline`: `f2a` (flex-baseline-nested-reverse), `o3a` (flex-order-baseline-wrap-reverse); `startmost-item`: `f1a`, `f4a` (flex-baseline-nested-reverse) |
| `auto-margin-overflow-cross-start` | unchanged | unchanged | new branch `column-wrap-reverse-rtl` ruled by T036: `amr-a`, `amr-b`, `amr-c` (flex-auto-margins-reverse-overflow) |
| `half-leading-floor`, `min-max-end-margin` | unchanged | unchanged | unchanged |
| platform rules `ahem-metric-half-down`, `font-size-truncation` | CSS does not define font-metric rounding | darwin-arm64 only (T036 M1) | see M1 |

The new deviation's reading of the spec comes from memory of css-flexbox-1 §8.5 and §9.3; the spec text was not re-read (no download), and Blink source was not read. All 28 deviation and platform-rule nodes are exact at 1/64 px.

## Engine (`packages/layout`)

- `input.ts`: `Position` is `static | relative | absolute`. `LayoutStyle` gains the required `top`, `right`, `bottom` and `left` (`InsetValue` = px | percent | auto, no defaults).
- `validate.ts`: schema for the new fields; an absolutely positioned root is `bad-value`; anonymous boxes must carry static position and auto insets. Everything it rejected before is still rejected.
- `position.ts` (new): `relativeOffset`, `layoutAbsolute` (rules 10-14), `isOutOfFlow`, and the `abspos-in-inline` refusal.
- `box.ts`: fragments carry `outOfFlow` (children with their static position: offset plus a near, centre or far edge).
- `block.ts`: records static positions, skips out-of-flow children in flow, applies relative offsets after placement (baselines untouched), and adds the planted faults.
- `flex.ts`:
  - absolutely positioned children are not items; `staticPosition` implements rule 8;
  - relative offsets are applied after alignment;
  - the baseline line is the top line under wrap-reverse (the deviation);
  - a multi-line container with no items no longer divides by zero in `alignContent`. This bug was reachable once a container could hold only absolutely positioned children.
- `intrinsic.ts`: out-of-flow children are excluded.
- `layout.ts`: the placement pass. Containing blocks are looked up per box, with the initial containing block as the fallback, and the root may be relatively offset.
- `text.ts`/`units.ts`: `ahemMeasurerWith(faults)`, `roundFontMetricHalfUpToWholePx` (fault only) and `textAdvanceAt`.
- `platform-rules.ts` (new), exported from `index.ts` with `platformRules`.
- `UnsupportedCode` gains `abspos-in-inline`; the every-code-raised test passes.

## Compiler (`packages/dragon`)

- `LONGHANDS` gains `top`, `right`, `bottom` and `left` (layout aspect, item role). The grammar subset, the UA capture and the captures include them. The UA data gained exactly 4 entries per tag, all `auto`, and no UA longhand changed.
- The lowering maps `position` (static, relative, absolute) and the insets; `fixed` and `sticky` have no mapping.
- Row contexts:
  - positioned item contexts are `relative-in-<parent context>/<parent dir>` and `absolute-in-<parent context>/<parent dir>/cb-<containing block dir>`;
  - paint contexts are `paint/<dir>`;
  - the text of an absolutely positioned child of a flex container is `text-in-block`, not `text-in-flex-item`.
- `computed-checks.ts` refuses an absolutely positioned element beside laid-out text, and an absolutely positioned root, with `DRAGON_UNSUPPORTED_VALUE` at the `position` value on every target.
- The web emitter writes the four insets only when one of them is not auto (deviation 4).
- New compiler fault `ignoreEnvironmentDirection`.
- `internal.ts`: a `transparent` `color` resolves to rgba(0, 0, 0, 0) channels. The harness threw on it before; G3 exposed this.
- The at-rule fix (rec4) and profile revision `m1-s4b`, 1,175 rows per target.

## Deviations from the task text

1. **A new Chrome deviation**, `wrap-reverse-baseline-line` (above). It follows Chrome with measured nodes on both branches, and triggers the gate's Judge round.
2. **`reject-shorthand-filled` changed after it ran.** G1 now proves every value a milestone shorthand fills implicitly (`border: 3px` fills `border-*-style: none`, `border-*-width: medium` and `border-*-color: currentcolor`) in the block and flex contexts. No shorthand-filled longhand can be an unsupported value any more, so the fixture's old expectation (`DRAGON_UNSUPPORTED_VALUE` on `3px`) was false.
   - The fixture keeps its id and markup. It gains `position: relative`, a context in which no fixture proves `border-*-style: none`, and now expects `DRAGON_UNPROVEN_CONTEXT` on `3px`. It still shows that implicitly filled longhands are checked (S1 must-fix 3).
   - The matching unit test in `compile.test.ts` changed the same way. It also asserts that `border: 3px` in block flow now compiles clean.
3. **`compile.test.ts` colour test.** `color: hsl()` on body no longer gives `DRAGON_UNPROVEN_CONTEXT`: colour rows are paint rows (T036 rec1 colour_rows).
4. **The emitter writes inset longhands only when one is not auto.** Writing all four on every rule would have changed every existing emitted file beyond its digest line, against the verify item. Leaving them out gives the same computed values, because auto is their initial value and no Chrome UA rule sets them on html, body or div. `s4b.test.ts` pins this.
5. **Captures gain 4 computed keys per element** (`top`, `right`, `bottom`, `left`), so dual value counts grow. The base check allows exactly those keys and holds every old value.
6. **Abspos beside text is refused with the existing code `DRAGON_UNSUPPORTED_VALUE`**, not a new code, so the public `DiagnosticCode` union does not change (T036: no public type change beyond the pinned cascade union). The engine code is `abspos-in-inline`.
7. **G1 writes two files** (box and text contexts), so all generators write 4 fixtures, meeting both readings of "at most 4 generated".
8. **Output order:** absolutely positioned boxes follow the in-flow boxes in the engine output. No existing vector changes (base check).
9. **Relative `top`/`bottom` percentages against a flexed indefinite height** reuse `percent-height-flex`. No fixture hits it.
10. **A tree topology entry uses `when`** to declare a state-dependent text context (the existing `TopologySpec` field).
11. **`flex-abspos-excluded` lost an unused rule** (`.shrink { display: inline; }`, matching no element) after its first derive-mode run in the dev runner and before registration. Enforced, it would have blocked the fixture. No case, node or declaration that applies to an element changed.
12. **Three flex fixtures were rewritten before any lane ran.** `flex-abspos-justify`, `-align` and `-column` were first produced malformed by a zsh word-splitting slip (all values in one class name), were blocked at compile, and were regenerated with bash.
13. **The probe HTML is under `/tmp/t037`**, and the numbers are quoted in `position.test.ts`. Each engine unit test pins Chrome's LU from a probe or a committed capture, never engine output.

## Base-capture check output

```
base 15e4d50: 181 expected files, 3535 nodes, 134212 computed values compared; every node gained only the computed keys top, right, bottom, left (10324 values)
emitted CSS: 93 files, 93 digest header lines changed, no other change
vectors: 181 files, 3550 output rects identical; 181 inputs differ only by the new required fields top, right, bottom, left (all auto) with position static
PASS: no node that existed at 15e4d50 changed kind, hasBox, geometry or a computed value; no node was added or removed
```

The check (`/tmp/t037/base-check.mjs`) ran on the committed tree after the regeneration. It checks that every 15e4d50 expected file keeps its file-level fields, the same nodes in the same order, and every node's kind, hasBox, x, y, width, height and every old computed value; only the four inset keys may be added. Emitted CSS may differ only in the digest line. Every vector keeps identical output rects, with the input differing only by the four new fields, all auto, with position static.

## Gate conditions (T036) as seen by this Worker

- Every verify item passes, and no stop_if fired except the flagged one: "a new Chrome deviation is needed" was recorded, the slice finished, and it is flagged.
- The note adds one Chrome deviation beyond T036's rulings (`wrap-reverse-baseline-line`), so **a Judge round is needed before S5**.
- No public type or export changed beyond the pinned cascade union. `Origin`, `ExplainedCase` and `DiagnosticCode` are unchanged, and the public entry's exports are unchanged.
- There are 114 layout fixtures, 110 of them hand-written, and every A and B item is mapped to named nodes above.
- The generated fixtures' selection is committed, and rec1 follows the T036 rules.

## Risks and open items for the PM

- **The new deviation's spec reading** was not re-checked against the css-flexbox-1 text or Blink source. A Judge may read §8.5's "first line" as block-start-first and call it spec behaviour.
- **G1 moved many rows from unproven to exact** (1,175 rows, up from 449). Agents will no longer hit the T005 blocks for initial values, gap longhands and colours in block and flex contexts. Positioned contexts still need their own proofs; `reject-shorthand-filled` relies on that.
- **Relative offsets against a flex-dependent height** refuse, and no fixture hits the refusal.
- **Abspos among inline text is refused**, not modelled.
- **Still open from earlier slices:** Linux baselines (the platform rules are darwin-arm64 only; S5 keys them); owner visibility of the iOS paint caveat cap (now 221 caveat rows, 120 of them paint rows); DPR other than 1; css-tree `createRequire` for the browser-worker check; T005 recs 2, 3, 5 and 6 for S5.
