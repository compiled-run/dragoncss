# T026 S2: web emitter, dual Chrome check, colours, engine growth

Worker, 2026-09-26, claude-code. Board: `docs/goals/milestone-1/state.yaml`, task T026. Plan: `notes/T025-s1-review-s2-plan.md`, with the S1 rules from `notes/T022-own-layout-plan.md` still in force. S1 baseline: commit eb0f442.

This slice was finished by a second Worker. The first one was stopped part-way through, and its uncommitted work was reviewed and kept:

- the product side: emitter, dual check, colours, faults, and must-fix 3, 4 and 5;
- 16 of the fixture files.

The second Worker added the rest:

- the engine growth;
- 5 more fixtures, and registered all the new ones;
- profile rows, tests, regeneration, verification and this note.

## Result

| | Count |
|---|---|
| Fixtures | 37 (34 layout, 3 reject), 23 of them new in S2 |
| Fixtures passing | 37 of 37; failed 0 |
| `linux-dragon-layout` (1 device px gate) | 34 of 34 layout fixtures pass; 735 of 735 compared nodes match Chrome exactly at 1/64 px (informational) |
| `chrome-dual` boxes | 737 of 737 equal (authored against compiled) |
| `chrome-dual` computed values | 36,350 of 36,350 `getComputedStyle` strings equal (50 longhands on every element) |
| `chrome-dual` colour channels | 4,362 of 4,362 match exactly (Dragon against the authored and compiled renderings) |
| LayoutUnsupported hits | none (`unsupportedCodes: []`) |

Nothing was loosened:

- the 1 device px gate, and exact equality in the dual lane;
- no fixture is skipped, narrowed or given its own tolerance;
- no node or property is excluded.

The flow is:

1. fixture HTML;
2. `FrontEndResult`;
3. public `createProject().compile()` with ios and web targets;
4. the `linux-dragon-layout` lane: ios layout projection, then validator, then `@dragon/layout`, then the edge compare with live Chrome;
5. the `chrome-dual` lane: `outputs.web` CSS (`dragon.css`), rendered on the same markup with classes in the same Chrome, then boxes, values and channels compared with the authored rendering and with Dragon's resolved colours.

| Fixture | Lanes (layout / dual) | Exact LU | Dual boxes | Computed values | Channels |
|---|---|---|---|---|---|
| block-ua-divs | pass / pass | 9/9 | 11/11 | 550/550 | 66/66 |
| block-content-box-padding-border | pass / pass | 9/9 | 9/9 | 450/450 | 54/54 |
| block-border-box | pass / pass | 6/6 | 6/6 | 300/300 | 36/36 |
| block-percent-width-padding | pass / pass | 6/6 | 6/6 | 300/300 | 36/36 |
| block-min-max | pass / pass | 9/9 | 9/9 | 450/450 | 54/54 |
| block-auto-margin-center | pass / pass | 9/9 | 9/9 | 450/450 | 54/54 |
| flex-row-grow-shrink-basis | pass / pass | 25/25 | 25/25 | 1250/1250 | 150/150 |
| flex-min-max-freeze | pass / pass | 19/19 | 19/19 | 950/950 | 114/114 |
| flex-column | pass / pass | 14/14 | 14/14 | 700/700 | 84/84 |
| flex-wrap-gap-align-content | pass / pass | 33/33 | 33/33 | 1650/1650 | 198/198 |
| flex-justify-content | pass / pass | 45/45 | 45/45 | 2250/2250 | 270/270 |
| flex-align-items-stretch-center | pass / pass | 22/22 | 22/22 | 1100/1100 | 132/132 |
| text-ahem-single-line | pass / pass | 24/24 | 24/24 | 700/700 | 84/84 |
| color-syntax (new) | pass / pass | 22/22 | 22/22 | 1100/1100 | 132/132 |
| color-border-sides (new) | pass / pass | 11/11 | 11/11 | 550/550 | 66/66 |
| cascade-compound-variants (new) | pass / pass | 15/15 | 15/15 | 750/750 | 90/90 |
| block-fractional-values (new) | pass / pass | 10/10 | 10/10 | 500/500 | 60/60 |
| percent-height-chain (new) | pass / pass | 12/12 | 12/12 | 600/600 | 72/72 |
| margin-collapse-siblings (new) | pass / pass | 11/11 | 11/11 | 550/550 | 66/66 |
| margin-collapse-parent-child (new) | pass / pass | 27/27 | 27/27 | 1350/1350 | 162/162 |
| margin-collapse-through (new) | pass / pass | 27/27 | 27/27 | 1350/1350 | 162/162 |
| margin-collapse-min-height (new) | pass / pass | 42/42 | 42/42 | 2100/2100 | 252/252 |
| margin-collapse-body (new) | pass / pass | 5/5 | 5/5 | 250/250 | 30/30 |
| flex-auto-margins-main (new) | pass / pass | 21/21 | 21/21 | 1050/1050 | 126/126 |
| flex-auto-margins-cross (new) | pass / pass | 21/21 | 21/21 | 1050/1050 | 126/126 |
| flex-auto-margins-negative (new) | pass / pass | 17/17 | 17/17 | 850/850 | 102/102 |
| flex-align-content-remaining (new) | pass / pass | 42/42 | 42/42 | 2100/2100 | 252/252 |
| flex-align-content-odd (new) | pass / pass | 80/80 | 80/80 | 4000/4000 | 480/480 |
| flex-wrap-line-grow (new) | pass / pass | 27/27 | 27/27 | 1350/1350 | 162/162 |
| flex-intrinsic-wrap-column (new) | pass / pass | 24/24 | 24/24 | 1200/1200 | 144/144 |
| intrinsic-percent (new) | pass / pass | 29/29 | 29/29 | 1450/1450 | 174/174 |
| flex-nested (new) | pass / pass | 25/25 | 25/25 | 1250/1250 | 150/150 |
| flex-percent-definite (new) | pass / pass | 22/22 | 22/22 | 1100/1100 | 132/132 |
| flex-stretch-percent-minmax (new) | pass / pass | 15/15 | 15/15 | 750/750 | 90/90 |
| reject-display-grid | reject: pass | - | - | - | - |
| reject-color-lab (new) | reject: pass, `DRAGON_UNSUPPORTED_VALUE` on `lab(50% 40 59)` | - | - | - | - |
| reject-shorthand-filled (new) | reject: pass, `DRAGON_UNSUPPORTED_VALUE` on `3px` (`border: 3px` fills `border-*-style: none`) | - | - | - | - |

In every reject fixture, the ios and web outputs are blocked, there is no layout projection and no web files are written.

## Commands (T026 verify list)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass (lockfile up to date) |
| `pnpm typecheck` (`tsc -b`, includes `packages/parity/test/planted/drop-field.ts` under `@ts-expect-error`) | pass |
| `pnpm test`, run 1 | pass: 8 files, 197 tests |
| `pnpm test`, run 2 | pass: 8 files, 197 tests; `packages/parity/out/report.json` is byte-identical to run 1 (`cmp`) |
| Regeneration check, on the committed tree: `pnpm run grammar:gen && pnpm run ua:capture && pnpm run parity:capture && pnpm run layout:vectors`, then `git diff --exit-code -- packages scripts` (scoped because the PM's docs, README and state.yaml edits are uncommitted) and `git status --porcelain --untracked-files=all packages/dragon/src packages/parity/expected packages/parity/emitted packages/layout/vectors` | pass: no diff, no untracked files |
| `pnpm run parity:report`, then `test -s` on `out/report.json` and `out/index.html` | pass: 37/37 fixtures; the report is byte-identical to the test-run report |
| `report.json` summary | 37 fixtures (at least 35 required); failed 0; `unsupportedCodes: []`; all 34 layout fixtures have `linux-dragon-layout: pass` and `chrome-dual: pass` |
| S1 greps: no `node:`/fs/path/child_process/url/module/playwright imports in `packages/dragon/src` or `packages/layout/src` | pass |
| S1 grep: only `import type` from `@dragon/layout` in `packages/dragon/src` | pass |
| S1 grep: no `??`, `?:` or `?.` in `packages/layout/src` | pass |
| S1 grep: no `Math.round/floor/ceil/trunc/fround`, `parseFloat` or `toFixed` in `packages/layout/src` outside `units.ts` | pass |
| S1 grep: no `Date`, `Math.random`, `performance.`, `process.` or `globalThis` in `packages/layout/src` | pass |
| Colour conversion and rounding only in `packages/dragon/src/css/color.ts`, with css-color-4 citations | pass (grep, plus the `ua.test.ts` test) |
| The web emitter imports neither `lower/ios-layout.ts` nor `@dragon/layout` | pass (grep, plus the `ua.test.ts` test) |
| Dependency, private and export-map checks | pass, unchanged from S1 (see below) |
| Planted tests | pass (see below) |
| `parity.test.ts` profile and deviation checks | pass (see below) |

Dependency, private and export-map checks:

- dragon `dependencies` is exactly `{css-tree: 3.2.1}`, with devDependency `@dragon/layout: workspace:*`;
- dragon `exports` is exactly `'.'`, with `{dragon-internal, default}`;
- layout has no dependencies, is private and exports only `.`;
- parity is private;
- no change against eb0f442 in `package.json`, `pnpm-lock.yaml`, `tsconfig*` or `vitest.config.ts`.

Planted tests (each fails for the right reason):

- The box-sizing swap fails the layout gate on `block-content-box-padding-border`: node `box` exceeds 1 device px.
- `variantCollapse` fails `chrome-dual` on `cascade-compound-variants`, with fewer computed values equal.
- `colourOnly` fails `chrome-dual` on `color-syntax` on colour channels only: every problem names a colour property, boxes are all equal, and `linux-dragon-layout` passes.

`parity.test.ts` checks:

- There are 127 exact web rows. Every one names fixtures that passed `chrome-dual` in this run and use the feature.
- No ios colour or paint row is exact: they are `caveat`, with aspect `computed-value` on lane `chrome-dual`.
- Both Chrome deviations name a passing fixture and a node that matches Chrome exactly.

git is `/opt/homebrew/bin/git`. The commit is local only: nothing was pushed and no remote was added.

## Product (docs/api.md 4.1, 7, 7.1)

**Web emitter** (`packages/dragon/src/emit/web-css.ts`):

- It works from the stage-1 resolved result only and emits one rule per element, `.dg<preorder index>`.
- All 50 milestone longhands are written explicitly, so the output does not depend on the UA stylesheet.
- It emits no authored selectors, and authored lengths are written unchanged.
- `outputs.web` is `ready` with `dragon.css` and the compilation digest. iOS stays `analysis-only`.
- The element-to-class map is internal (`webClassMap` on the dragon-internal entry).
- Emitted CSS for each fixture is committed in `packages/parity/emitted/` and must equal the compiler output in `pnpm test`.

**Dual check** (`packages/parity/src/dual.ts`, the `chrome-dual` lane):

- Both renderings use the same markup and the same Ahem face.
- The compiled page gets the class attributes and `dragon.css` instead of the authored `<style>`.
- Boxes must be exactly equal, `getComputedStyle` strings must be equal for every longhand, and colour channels must be equal.
- Authored captures stay live and must equal the committed expected JSON byte for byte.

**Colours** (`packages/dragon/src/css/color.ts`):

- Supported: named colours, hex 3/4/6/8, `rgb()`/`rgba()` (legacy and modern, including `none`), `hsl()`/`hsla()` (deg, turn, rad and grad), `transparent` and `currentcolor`.
- `color` is inherited, and `currentcolor` as the value of `color` inherits. Border colours resolve `currentcolor`.
- The initial `color` comes from Chrome's captured root, because CanvasText depends on the environment.
- Any other syntax gives `DRAGON_UNSUPPORTED_VALUE` on its span.

**Profiles:**

- `ProofAspect` is `layout | computed-value`, and `ProofLane` is `linux-dragon-layout | chrome-dual`.
- Web rows: layout features are `exact`, with proofs `layout` and `computed-value` on `chrome-dual`. Colour and paint features are `exact` with `computed-value` on `chrome-dual`.
- ios rows: layout features are `exact`, with `layout` on `linux-dragon-layout`. Colour and paint rows are capped at `caveat`, with `computed-value` on `chrome-dual`, until a native paint lane exists. **This needs owner visibility.**
- Rows are the features the passing fixtures use, each naming those fixtures: 127 rows per target (ios: 84 exact layout rows and 43 colour or paint rows at caveat; web: all 127 exact).

**Faults** (`packages/dragon/src/faults.ts`, internal switches used through `createProjectWith`):

- `swapBoxSizing`;
- `variantCollapse`: the resolver drops the last class of any compound selector with two or more classes;
- `colourOnly`: every non-inherited resolved colour's red channel moves by one step.

## Engine growth (`packages/layout`)

- **CSS2 §8.3.1 margin collapsing** (`block.ts`):
  - A `Strut` holds the largest positive and the most negative margin, and resolves to their sum.
  - It covers sibling margins, parent and first child, parent and last child, negative and mixed signs, and nested escapes.
  - It covers collapse-through boxes, including explicit `height: 0` and boxes whose children all collapse through. A collapse-through box sits where a non-zero bottom border would put it, or at the parent's top.
  - Body and first child collapse, while root margins never collapse.
  - Flex containers and flex items establish independent formatting contexts.
  - The S1 `LayoutUnsupported('margin-collapse')` is gone.
- **Flex auto margins** (css-flexbox-1 §8.1, §9.5 step 12, §9.6 step 13):
  - On the main axis, positive free space is split among auto margins as rounded cumulative shares, and justify-content then has no effect. With negative free space, auto margins are 0 and justify-content applies.
  - On the cross axis, auto margins take the positive space (both auto: `LayoutUnit / 2`). With negative space the item sits at the start. An auto cross margin disables stretch.
- **Content distribution:** this model now covers justify-content and align-content. It replaces S1's truncation model for space-around and space-evenly:
  - space-between: `round(free*k/(n-1))`;
  - space-around: `trunc(free/2n) + round(free*k/n)`;
  - space-evenly: `trunc(free/(n+1)) + round(free*k/(n+1))`.
- **align-content:**
  - Newly supported: `flex-end`, `end`, `start`, `space-around` and `space-evenly`.
  - With negative free space, `center`, `flex-end` and `end` stay unsafe. `space-*` and `stretch` fall back to start, which is safe center for around and evenly. This was measured on `flex-align-content-odd` row 2.
  - `baseline` returns `flex-baseline` (S4).
- **§9.9 intrinsic sizes:**
  - For a multi-line row container, max-content is the sum of contributions plus gaps, and min-content is the largest contribution.
  - A column nowrap container uses the largest contribution.
  - A multi-line column container returns `flex-intrinsic-wrap-column`, which no fixture hits.
- **Percentage heights** (CSS2 §10.5, css-flexbox-1 §9.8):
  - `height`, `min-height` and `max-height` percentages resolve against a definite basis: the ICB, a fixed or percentage height, a single-line stretched item in a container with a definite cross size (rule 1), or a column item's flexed size in a container with a definite main size (rule 2).
  - Against an indefinite basis they behave as auto, 0 or none.
  - A flexed or stretched size that these rules do not make definite still returns `percent-height-flex`, which no fixture hits.
- **Stretched cross size:** percentage `min-*` and `max-*` now resolve: against the container's content width for column items, and against the definite cross size for row items. See must-fix 1.

## Chrome arithmetic pinned by measurement (this slice)

- **Content distribution:**
  - A probe of 2,280 cases, each run with 1 LU resolution, matched the model above with 0 mismatches. The cases covered justify-content and align-content; space-around, space-evenly, space-between and center; n = 2, 3, 4, 5 and 7; and free space from 1 to 393 LU in steps of 7.
  - S1's truncation model gave 544 mismatches. For example, justify space-around with n=2 and 29 LU free gives `[7, 22]`, where S1 predicted `[7, 21]`.
  - Unit vectors in `units.test.ts` pin the model, including `[138, 415, 692, 968]` for 1107 LU over 4 lines from `flex-align-content-odd`.
- **Main-axis auto margins:** the offset after j auto margins is `round(free*j/count)`. For example, 3712 LU over 3 margins gives 1237, then 1238 (`flex-auto-margins-main`, node `c1c`).
- **align-content stretch:** each line gets `free / lines` (raw truncation), and the remainder is dropped. This was confirmed with 4 lines and 1107 LU free.

## Chrome deviations (packages/layout/src/chrome-deviations.ts)

| Deviation | Spec | Blink behaviour (measured) | Proving fixture and node |
|---|---|---|---|
| `half-leading-floor` (S1) | CSS2 §10.8.1 | The top half-leading is floored to a whole px. | text-ahem-single-line, `t3:text0` |
| `min-max-end-margin` (new) | CSS2 §8.3.1, §10.6.3: a parent with auto height and non-zero min-height does not collapse its bottom margin with its last child; the child's margin counts toward the parent's height. | Chrome 145 leaves end margins out of the auto height. They collapse through the parent's bottom when min/max-height leave the height unchanged, and are dropped when min/max-height change it. | margin-collapse-min-height, `p9`: min-height 20px with 12px content and a 20px child bottom margin gives height 20 (the spec gives 32). The next sibling sits 6px below, not 20px. `p4`, `p5` and `p6` show the same rule. |

`parity.test.ts` requires each proving node to match Chrome exactly at 1/64 px in this run.

## S1 must-fix items

1. **Percentage min/max-width ignored for stretched column items.** Fixed in `stretchedCrossSize`, which also resolves percentage min/max-height for row items against a definite cross size. Fixture: `flex-stretch-percent-minmax`, which has `max-width: 50%`, `min-width: 75.5%`, conflicting min > max, border-box with padding and border, margins, and row `max-height: 25%`, `min-height: 60.5%` and `max-height: 12.5%` with border-box. It passes with 15/15 nodes exact.
2. **px-only fallthroughs.** Each one either now resolves percentages, returns a typed LayoutUnsupported, or is proved against Chrome by a fixture:
   - `flex.ts` stretched cross size: now resolves percentages (item 1).
   - `flex.ts` column-item percentage `min-height`/`max-height` and percentage `height`: now resolve against a definite basis, and otherwise behave as 0/none/auto or return `percent-height-flex`. Fixture: `flex-percent-definite`.
   - `box.ts` percentage `height`/`min-height`/`max-height`: resolve against a definite basis. Fixture: `percent-height-chain`, a chain from html 100% through body 80% with border-box, min/max clamping, an auto parent breaking the chain, and 150% overflow.
   - `intrinsic.ts` contributions with percentage width, padding, margins and min/max-width: treated as cyclic percentages (css-sizing-3 §5.2.1). They are proved against Chrome by `intrinsic-percent` (29/29 exact), and the code comment cites that fixture.
   - Percentage gaps still return `percent-gap`.
3. **Shorthand-filled longhands skipped profile checks.** `checkSupport` now checks every longhand a declaration sets, and the message names the shorthand. This is covered by a compile unit test and the reject fixture `reject-shorthand-filled`.
4. **DPR as a module constant.** Replaced:
   - `Environment {viewport, devicePixelRatio}` feeds the projection (`iosLayoutProjection(compiled, env)`), `LayoutInput.devicePixelRatio` (validated as greater than 0), the engine's border snapping (`units.ts snapBorderWidth`), Chrome's `deviceScaleFactor` and the gate scaling.
   - Every fixture runs at DPR 1. Other ratios are unverified against Chrome, as the `units.ts` comment says.
5. **UA-vs-initial origin unpinned.**
   - `ua:capture` now records, per tag, the longhands whose Chrome value differs from the same element under `<longhand>: initial` (`userAgentLonghands`).
   - The resolver uses that table.
   - `ua.test.ts` pins the table and every longhand's origin and value for html, body and div.
   - The root's display is blockified (css-display-3 §2.7).
6. **Fixtures too easy.** 23 new fixtures, 20 of them layout; see the table. They cover:
   - nested flex three levels deep, with `flex: 1 1 0`, a negative margin, and a percentage basis;
   - negative and mixed-sign margins, and fractional ones such as 13.3px;
   - collapse-through, including with min-height;
   - body and first-child collapse;
   - auto margins with negative free space;
   - align-content over 3–4 lines with odd remainders;
   - per-line grow in wraps with max/min freezing;
   - fractional px and % values;
   - percentage-height chains;
   - §9.8 definite percentages after flexing;
   - colour syntax and per-side border colours;
   - two new reject fixtures.

## Deviations from the task text

1. **Five fixtures were designed and added by this Worker, beyond those the first Worker left:** `block-fractional-values`, `percent-height-chain`, `flex-percent-definite`, `flex-stretch-percent-minmax` and `reject-shorthand-filled`. They cover the T025 list items that had no fixture file (fractional values, percentage-height chains, §9.8), plus must-fix 1 and 3.
2. **S1's `space-around`/`space-evenly` truncation model was replaced**, because the 2,280-case probe disproved it. S1 fixtures still pass exactly.
3. **`LayoutUnsupported` codes changed:**
   - removed: `margin-collapse`, `percent-height-definite` and `flex-auto-margin`;
   - `flex-intrinsic-wrap` renamed to `flex-intrinsic-wrap-column`, since row wrap is now supported.
4. **`ContentsArgs` gained a required `forcedHeightDefinite`** so §9.8 definiteness is explicit at each call site.
5. **Profile rows were generated** from the features the passing fixtures use, then written into `profiles/ios.ts` and `profiles/web.ts` with a throwaway script, as in S1. The script is not committed.

## Deferred

- **The true per-state collapse fault moves to S3.** It needs tree@0 finite states (checked and unchecked on one element). S2 uses the `variantCollapse` compound-class fault instead.
- **Still refused with typed LayoutUnsupported, and hit by no fixture:**
  - percentage heights against a stretched size in a multi-line or auto-height container, or a flexed size in a column container with an indefinite height;
  - the intrinsic inline size of a multi-line column container;
  - multi-line column containers with an indefinite height;
  - percentage gaps;
  - `flex-basis: content`;
  - `justify-content` start/end/left/right;
  - `align-self` start/end/self-*;
  - baselines, `order`, reverse directions and wrap-reverse (S4);
  - multi-line text and mixed text and blocks (S3).

## Risks and open items for the PM

- **iOS colour and paint rows are capped at `caveat`** until a native paint lane exists. This needs owner visibility, per T025.
- **The capture has only run on macOS.** The `ua:capture` root `font-family` is `Times`. A Linux capture may differ.
- **The DPR is an input everywhere,** but only DPR 1 is measured.
- **The deviation `min-max-end-margin` and the distribution model are measured, not read from Blink source.**
- **css-tree's `createRequire` import** remains for the S5 browser-worker check.
- **PM-owned files were left alone:** uncommitted changes under `docs/` (other than this note), `README.md` and `state.yaml` were neither touched nor committed.
