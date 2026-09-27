# T023 S1: own layout engine walking skeleton

Worker, 2026-09-26, claude-code. Board: `docs/goals/milestone-1/state.yaml`, task T023. Plan: `notes/T022-own-layout-plan.md`.

## Result

- All 14 planned fixtures were attempted and all 14 pass: 13 layout fixtures and 1 rejection fixture.
- The gate is 1 device px on every absolute edge (decision 13). No fixture overrides it, and none is skipped, excluded or narrowed.
- 230 of 230 compared nodes match Chrome exactly at 1/64 px (informational). The worst edge delta is 0 px.
- No `LayoutUnsupported` code was hit by any fixture.
- The flow is: fixture HTML, then `FrontEndResult`, then public `createProject().compile()`, then the internal ios layout projection, then `validateLayoutInput`, then `@dragon/layout`, then the absolute-edge compare against live Playwright 1.58.2 / Chrome 145.0.7632.6.

| Fixture | Kind | Result | Compared nodes | Exact at 1/64 px | Worst edge delta (px) |
|---|---|---|---|---|---|
| block-ua-divs | layout | pass | 9 (2 display:none nodes have no box in either) | 9 | 0 |
| block-content-box-padding-border | layout | pass | 9 | 9 | 0 |
| block-border-box | layout | pass | 6 | 6 | 0 |
| block-percent-width-padding | layout | pass | 6 | 6 | 0 |
| block-min-max | layout | pass | 9 | 9 | 0 |
| block-auto-margin-center | layout | pass | 9 | 9 | 0 |
| flex-row-grow-shrink-basis | layout | pass | 25 | 25 | 0 |
| flex-min-max-freeze | layout | pass | 19 | 19 | 0 |
| flex-column | layout | pass | 14 | 14 | 0 |
| flex-wrap-gap-align-content | layout | pass | 33 | 33 | 0 |
| flex-justify-content | layout | pass | 45 | 45 | 0 |
| flex-align-items-stretch-center | layout | pass | 22 | 22 | 0 |
| text-ahem-single-line | layout | pass | 24 (text boxes compared by `Range` rect) | 24 | 0 |
| reject-display-grid | reject | pass: `DRAGON_UNSUPPORTED_VALUE` on span `grid`, ios blocked, no layout projection | - | - | - |

## Commands run (verify list on the T023 card)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass (lockfile up to date) |
| `pnpm typecheck` (`tsc -b`, includes the planted `@ts-expect-error` files) | pass |
| `pnpm test`, run 1 | pass: 7 files, 99 tests |
| `pnpm test`, run 2 | pass: 7 files, 99 tests; `packages/parity/out/report.json` byte-identical to run 1 (`cmp`) |
| Regeneration check: `git add -A`, then `pnpm run grammar:gen`, `pnpm run ua:capture`, `pnpm run parity:capture`, `pnpm run layout:vectors`, then `git diff --exit-code` and `git status --porcelain --untracked-files=all packages/dragon/src packages/parity/expected packages/layout/vectors` | pass: no diff, no untracked files |
| `pnpm run parity:report && test -s packages/parity/out/report.json && test -s packages/parity/out/index.html` | pass: 14/14 fixtures, 230/230 nodes exact; the report is identical to the test-run report |
| grep: no `node:`/fs/path/child_process/url/module/playwright imports in `packages/dragon/src` or `packages/layout/src` | pass (no matches) |
| grep: no value import of `@dragon/layout` in `packages/dragon/src` | pass (only `import type`) |
| grep: no `??`, `?:`, `?.` in `packages/layout/src` | pass |
| grep: no `Math.round/floor/ceil/trunc/fround`, `parseFloat`, `toFixed` in `packages/layout/src` outside `units.ts` | pass |
| grep: no `Date`, `Math.random`, `performance.`, `process.`, `globalThis` in `packages/layout/src` | pass |
| dragon dependencies are exactly `{css-tree: 3.2.1}`; layout dependencies `{}` and private; parity private | pass |
| dragon `exports` keys are exactly `'.'`, with `{dragon-internal: ./src/internal.ts, default: ./src/index.ts}` | pass |

git is `/opt/homebrew/bin/git`. Nothing was pushed and no remote was added.

## What was built

- **`packages/layout` (`@dragon/layout`, private, no dependencies, exports `.`):**
  - `input.ts`: fully specified, readonly, tagged input, with no optional fields and no index signatures.
  - `validate.ts`: a runtime validator. Its schema's inferred type is asserted equal to `LayoutStyle` and `TextLeaf` at compile time. It rejects missing keys, extra keys, unknown tags, bad enums, out-of-range numbers and duplicate ids.
  - `units.ts`: Blink LayoutUnit (int32, 1/64 px, saturating). This is the only file that rounds or holds floats.
  - `block.ts`: CSS2 §10.3.3, §10.6.3, §10.4, §10.7 and the S1 subset of §8.3.1, plus the single-line inline layout.
  - `flex.ts`: css-flexbox-1 §9.2–§9.8 and §4.5.
  - `intrinsic.ts`: css-sizing-3 §5 and §9.9.1 for single-line containers.
  - `text.ts`: the injected `TextMeasurer`, with a pure Ahem implementation.
  - `unsupported.ts`: typed `LayoutUnsupported {code, nodeId, specSection, detail}`.
  - `chrome-deviations.ts` and `layout.ts` (the entry point, with preorder LU output relative to the parent border box).
- **`packages/dragon`:**
  - The public `createProject().compile()/check()` and the `dragon/tree@0` S1 subset.
  - css-tree 3.2.1 forked over the committed webref 8.7.5 grammar (`src/css/grammar.generated.ts`, 63 properties and 31 types).
  - Cascade by specificity and order, inheritance, and captured Chrome UA data (`src/ua/chrome-145.generated.ts`).
  - The ios lowering to `LayoutInput`, which writes inherited text styles onto text leaves, and support profiles (`src/profiles`).
  - Typed `DRAGON_*` diagnostics with UTF-16 spans and profile-derived fixes, and a pure-TS SHA-256 for source hashes and digests.
  - The internal entry (`src/internal.ts`) is reachable only through the `dragon-internal` condition.
- **`packages/parity` (private):**
  - A strict fixture reader, the Playwright capture (T001 §5 flags, DPR 1, Ahem data URI, `browser.version()` asserted), the edge compare and the pipeline.
  - The report (`out/report.json` and `out/index.html`, with side-by-side SVG boxes and a per-node table), and the `capture`, `report` and `vectors` CLIs.
  - The vitest suite.
- **Scripts:** `scripts/gen-css-grammar.ts` and `scripts/capture-ua-defaults.ts`.
- **Vendor:** `vendor/fonts/Ahem.ttf` (WPT v1.50, SHA-256 `b719ecb3…`) with the CC0 notice quoted from its name table.

## Chrome arithmetic pinned by measurement (probes against Chrome 145.0.7632.6)

Each rule below is implemented in `units.ts` or cited at its call site, and pinned by unit tests with the measured raw values:

- **px to LU:** `LayoutUnit(float)` = `trunc(fround(fround(v) * 64))`. 33.3px becomes raw 2131 (33.296875px).
- **Percentages:** `LayoutUnit(float(max.ToFloat() * pct / 100f))`. 33.3% of 400px is raw 8524 (133.1875px).
- **Flex free-space distribution (§9.7):** each share is `FromFloatRound(remaining * factor / remainingFactors)`, with halves rounded away from zero, handed out **from the last unfrozen item backwards**. Remaining space and factors shrink after each item, so the shares sum exactly.
  - Measured: 3 × grow 1 in 101px gives raw 2154/2155/2155.
  - Shrinking 40/47/61px bases into 100px gives 1730/2032/2638.
  - 7 × grow 1 in 103px gives 941/942/941/942/942/942/942.
  - Per-item independent rounding and forward-sequential rounding both disagree with Chrome.
- **justify-content and align-content distribution:** the offset before item k is a cumulative share of the free space:
  - `space-between` rounds `k*free/(n-1)`, halves up;
  - `space-around` truncates `(2k+1)*free/(2n)`;
  - `space-evenly` truncates `(k+1)*free/(n+1)`;
  - `center` is `LayoutUnit / 2` (raw truncation).
  - With negative free space, distributed values fall back to start: `space-around` and `space-evenly` fall back to safe center per css-align-3 §5.3, and `space-between` to flex-start.
  - My first implementation used an older unsafe center fallback and per-gap truncation. It failed `flex-justify-content` (the gate for `space-around` overflow, and exactness for two gaps); both were fixed to match Chrome.
- **align-content stretch:** each line gets `free / lineCount` (raw truncation), and the remainder is dropped.
- **Auto margins (§10.3.3):** both auto gives `(available / 2)` raw-truncated, clamped at 0.
- **Line box:** ascent and descent are rounded to whole px (`SkScalarRoundToScalar`). The top half-leading is `floor((lineHeight - (ascent+descent)) / 2)` in whole px; see deviations.

## Deviations

- **Chrome versus the spec** (recorded in `chrome-deviations.ts`, and a test requires the proving node to match Chrome exactly):
  - `half-leading-floor` (CSS2 §10.8.1). Blink floors the top half-leading to a whole px.
  - Proved by `text-ahem-single-line`, node `t3:text0`: 10px Ahem with `line-height: 25px` puts the glyph box at 7px, where the spec gives 7.5px.
- **Choices I made within the allowed files:**
  1. `LayoutBox` and `TextLeaf` carry a required `kind: 'box' | 'text'` tag, so the union is discriminated by construction. The plan's shapes did not list it.
  2. `LayoutStyle` also carries these required fields:
     - `order` (so a non-zero value reports `flex-order`, as the plan requires);
     - `textAlign` (single-line text position depends on it; values other than start and left report `text-align`);
     - `overflowX`/`overflowY` (the plan's `overflow`);
     - `position: 'static'`.
  3. `tsconfig.base.json` uses `allowImportingTsExtensions` with `emitDeclarationOnly`. Node 24 and vitest run the `.ts` sources directly. `rewriteRelativeImportExtensions` failed with TS2878 across test projects.
  4. **UA and initial values.** A tag's captured Chrome value counts as a UA rule only when it differs from an element with no UA rules (`dragon-unstyled`); otherwise the webref initial value applies.
     - This is needed because `getComputedStyle` reports resolved values: `min-width: auto` shows as `0px`, and `border-width: medium` shows as `0px` under `border-style: none`.
     - Width, height, margins and padding are captured from a `display:none` root, so they are computed rather than used values.
     - Captured keyword widths: thin 1px, medium 3px, thick 5px.
  5. **Border widths** snap in the ios lowering to whole device px at the lane's reference DPR 1 (css-values-4 line-width snapping). Milestone 1 lowers only for that reference environment.
  6. **Fixture format.** `<head>` is not part of the element tree (it generates no boxes). Text nodes get ids `<parent id>:text<k>`, and whitespace-only text is dropped (CSS white-space processing produces no boxes for it). Text leaves are compared by `Range.getBoundingClientRect()`, which is the glyph box.
  7. **Profiles.** Only an explicitly authored longhand is checked against the profile. Longhands a shorthand fills with initial values (for example `border-*-color: currentcolor` from `border: 3px solid`) are not.
     - `iosProfile` has 66 exact rows, each naming the fixtures that use the feature.
     - The parity test checks each row: aspect `layout`, lane `linux-dragon-layout`, every named fixture passed in this run, and at least one named fixture uses the feature.
     - `webProfile` is empty: there is no web emitter or web lane until S2, so any authored CSS blocks the web target.
  8. **Percentage heights against a definite containing block, or inside flex items,** return `percent-height-definite` or `percent-height-flex`. These are S2 scope per T022; no fixture hits them.

## Planted faults (each asserted to fail for the right reason)

1. `packages/parity/test/planted/drop-field.ts` builds a `LayoutStyle` without `boxSizing` under `@ts-expect-error`, inside `tsc -b`. `pnpm typecheck` passes only while the error exists.
2. `createProjectWith(..., { faults: { swapBoxSizing: true } })` swaps content-box and border-box in the ios lowering. `block-content-box-padding-border` then fails the gate, with node `box` failing and the reason "exceeds 1 device px".
3. A vector with a missing field is rejected by `validateLayoutInput` (`missing-key` at `$.root.style.flexShrink`). The unit test also covers a missing `boxSizing`.

## LayoutUnsupported codes

- **Fixtures:** none hit.
- **Unit tests** exercise `margin-collapse` (two non-zero adjoining margins), `multi-line-text`, `direction-rtl` and `flex-order`, and check that a single non-zero margin escaping a parent lays out normally.

## Shared vectors

`pnpm run layout:vectors` wrote 13 vectors, one per passing layout fixture, to `packages/layout/vectors/`. `vectors.test.ts` checks that each passes the validator and that the engine reproduces its output exactly.

## Risks and open items for the PM

- **`css-tree` 3.2.1's ESM entry imports `createRequire` from `module`** (lib/data.js, data-patch.js, version.js). The core itself has no Node imports and the verify grep passes, but the S5 browser-worker import check will hit this through the dependency.
- **The flex-distribution order and the justify share modes are measured, not read from Blink source.** Each is pinned by the probe vectors above. Unmeasured combinations (for example a max violation during reverse distribution) could still differ at 1/64 px.
- **`ua:capture` records `font-family: Times` for html on macOS.** A Linux capture could differ and would then show up as a regeneration diff. Fixtures with text author `font-family: Ahem`, and text leaves are lowered only for Ahem.
- **Out-of-scope files are uncommitted.** When I staged, the working tree had uncommitted changes I did not make: README.md, docs/api.md, docs/decisions.md, goal.md, state.yaml, and untracked T001/T002/T022 notes. I unstaged them and left them as they were.
