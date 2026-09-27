# T030 S3b: multi-line Ahem text engine and S3a must-fix MF1-MF6

Worker, 2026-09-27, claude-code. Board: `docs/goals/milestone-1/state.yaml`, task T030. Spec: "S3b objective (binding)" in `notes/T029-s3a-review-s3b-plan.md`; standing rules from `notes/T022-own-layout-plan.md`. Base: c70254d (S3a). Code commit: 98af595, local only, not pushed.

## Result

| | Count |
|---|---|
| Fixtures | 69 (57 in S3a): 58 layout (45 HTML, 13 tree), 11 reject (5 HTML, 6 tree) |
| Fixtures passing | 69 of 69; failed 0 |
| Parity cases | 102 (45 HTML fixtures with 1 case each; 13 tree fixtures with 57 cases); 102 pass both lanes |
| `linux-dragon-layout` (1 device px gate) | 102 of 102 cases pass; 1,761 of 1,761 compared nodes match Chrome exactly at 1/64 px (informational) |
| Text nodes (Range bounding rect) | 130 of 130 exact |
| Per-line text fragments (`<text>:line<j>`, Range client rects) | 232 of 232 exact; 71 text nodes wrap to 2 or more lines |
| Anonymous boxes (Dragon only, listed in the report) | 14, each with every text line compared (see below) |
| `chrome-dual` boxes | 1,764 of 1,764 equal |
| `chrome-dual` computed values | 72,904 of 72,904 `getComputedStyle` strings equal (52 longhands per element) |
| `chrome-dual` colour channels | 8,542 of 8,542 equal, including each text node against its parent's computed color |
| LayoutUnsupported hits | none (`unsupportedCodes: []`) |
| Profiles | ios 244 rows, web 244 rows; every row generated; no row has context `single-line-text` |
| Tests | 13 files, 394 tests, both runs |

Nothing was loosened. The 1 device px gate and the exact dual equality are unchanged. No fixture, case, node or property is skipped, excluded, narrowed, deduplicated or factored, and no fixture has its own tolerance. No Chrome rect is filtered: every captured text node and every client rect is a compared node.

## Commands run (T030 verify list)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass (exit 0); `pnpm-lock.yaml` unchanged (`shasum -c`, and `git diff` against HEAD is empty) |
| `pnpm typecheck` (`tsc -b`; includes `planted/drop-field.ts` and `types.test-d.ts`) | pass (exit 0) |
| `pnpm test`, run 1 | pass: 13 files, 394 tests |
| `pnpm test`, run 2 | pass: 13 files, 394 tests; `packages/parity/out/report.json` byte-identical to run 1 (`cmp`) |
| Regeneration on the committed tree: `pnpm run grammar:gen && pnpm run ua:capture && pnpm run parity:capture && pnpm run layout:vectors && pnpm run profile:rows`, then `/opt/homebrew/bin/git diff --exit-code -- packages scripts` and `git status --porcelain --untracked-files=all packages/dragon/src packages/parity/expected packages/parity/emitted packages/layout/vectors` | pass: regeneration exit 0, diff exit 0, 0 untracked files |
| Base-capture check (`/tmp/t030/base-check.mjs`, output below) | pass, run before and after the regeneration |
| `pnpm run parity:report`, then `test -s` on `out/report.json` and `out/index.html` | pass: "69/69 fixtures pass (102 cases, 102 pass); layout 1761/1761 nodes exact at 1/64 px (text 130/130, lines 232/232, 14 anonymous boxes); dual boxes 1764/1764, values 72904/72904, channels 8542/8542"; the report equals the test-run report byte for byte |
| `report.json` summary | 69 fixtures (at least 67), 58 layout (at least 57); failed 0; `unsupportedCodes: []`; every layout case has `linux-dragon-layout: pass` and `chrome-dual: pass`; `anonymousBoxes` and line counts listed |
| Case-count check (MF1) | pass (`parity.test.ts`, below) |
| Profile-proof test | unchanged in strength: rows equal `deriveRows` of this run exactly, every proof names exactly the cases that passed its lane and use its key, every used key has a row; no `single-line-text`; every text row context has a proving case with a text node on 2 or more lines; no iOS paint row is exact |
| Planted tests | pass: box-sizing swap, variantCollapse, colourOnly, stateCollapse as before; dropInheritedText and breakOffByOne fail the layout lane on `text-wrap-spaces` and pass with the fault off |
| Text topology test | pass for every case of all 13 tree fixtures |
| Engine unit tests and vectors | pass: `inline.test.ts` (25), `vectors.test.ts` (102 vectors plus the missing-field fault), `unsupported.test.ts` (every code raised) |
| Diagnostics tests plus MF3 | pass; `diagnostic-codes.json` unchanged (no code added or removed) |
| Public-entry test (MF2) | pass |
| S1 greps: no `node:`/fs/path/child_process/url/module/playwright imports in `packages/dragon/src` or `packages/layout/src`; only `import type` from `@dragon/layout` in `packages/dragon/src`; no `??`, `?:`, `?.` in `packages/layout/src`; rounding only in `units.ts`; no `Date`, `Math.random`, `performance.`, `process.`, `globalThis` in `packages/layout/src` | pass (0 matches each; the one `@dragon/layout` line without `import type` closes the multi-line `import type` in `lower/ios-layout.ts`) |
| Colour conversion only in `css/color.ts`; the web emitter imports neither `lower/ios-layout.ts` nor `@dragon/layout` and matches no selectors | pass (grep, plus `ua.test.ts`; the emitter's imports are unchanged) |
| Renderer isolation | pass: `render.ts` imports exactly `css-tree` and `import type` from `dragon`; it writes text itself, byte for byte, and leaves whitespace handling to Chrome |
| Registry, committed-captures, deviation and distribution tests | pass |
| Dependency, private and export-map checks | pass, unchanged against c70254d: `git diff c70254d HEAD` is empty for `package.json`, the lockfile, the three package manifests, `tsconfig*`, `vitest.config.ts` and `diagnostic-codes.json`; dragon dependencies `{css-tree: 3.2.1}`; exports only `'.'` with `{dragon-internal, default}`; layout private with no dependencies; parity private |

Tests per file: dragon color 32, compile 40, diagnostics 33, text 15, tree 10, ua 11; layout engine 18, inline 25, units 13, unsupported 1, validate 4, vectors 104; parity 88.

git is `/opt/homebrew/bin/git`. PM-owned uncommitted files (`docs/` except this note, `README.md`, `state.yaml`) were not touched or committed. Scratch files are under `/tmp/t030`.

## Fixtures and match counts

Exact LU is informational; the gate is 1 device px. Lines: per-line text fragments exact / compared. Dual columns: boxes, computed values, colour channels. Anon: Dragon-only anonymous boxes over all cases.

| Fixture | Kind | Result | Cases | Exact LU | Lines | Dual boxes | Values | Channels | Anon | Reject code |
|---|---|---|---|---|---|---|---|---|---|---|
| block-ua-divs | html layout | pass | 1 | 9/9 | 0/0 | 11/11 | 572/572 | 66/66 | 0 |  |
| block-content-box-padding-border | html layout | pass | 1 | 9/9 | 0/0 | 9/9 | 468/468 | 54/54 | 0 |  |
| block-border-box | html layout | pass | 1 | 6/6 | 0/0 | 6/6 | 312/312 | 36/36 | 0 |  |
| block-percent-width-padding | html layout | pass | 1 | 6/6 | 0/0 | 6/6 | 312/312 | 36/36 | 0 |  |
| block-min-max | html layout | pass | 1 | 9/9 | 0/0 | 9/9 | 468/468 | 54/54 | 0 |  |
| block-auto-margin-center | html layout | pass | 1 | 9/9 | 0/0 | 9/9 | 468/468 | 54/54 | 0 |  |
| flex-row-grow-shrink-basis | html layout | pass | 1 | 25/25 | 0/0 | 25/25 | 1300/1300 | 150/150 | 0 |  |
| flex-min-max-freeze | html layout | pass | 1 | 19/19 | 0/0 | 19/19 | 988/988 | 114/114 | 0 |  |
| flex-column | html layout | pass | 1 | 14/14 | 0/0 | 14/14 | 728/728 | 84/84 | 0 |  |
| flex-wrap-gap-align-content | html layout | pass | 1 | 33/33 | 0/0 | 33/33 | 1716/1716 | 198/198 | 0 |  |
| flex-justify-content | html layout | pass | 1 | 45/45 | 0/0 | 45/45 | 2340/2340 | 270/270 | 0 |  |
| flex-align-items-stretch-center | html layout | pass | 1 | 22/22 | 0/0 | 22/22 | 1144/1144 | 132/132 | 0 |  |
| text-ahem-single-line | html layout | pass | 1 | 34/34 | 10/10 | 34/34 | 728/728 | 94/94 | 0 |  |
| color-syntax | html layout | pass | 1 | 22/22 | 0/0 | 22/22 | 1144/1144 | 132/132 | 0 |  |
| color-border-sides | html layout | pass | 1 | 11/11 | 0/0 | 11/11 | 572/572 | 66/66 | 0 |  |
| cascade-compound-variants | html layout | pass | 1 | 15/15 | 0/0 | 15/15 | 780/780 | 90/90 | 0 |  |
| block-fractional-values | html layout | pass | 1 | 10/10 | 0/0 | 10/10 | 520/520 | 60/60 | 0 |  |
| percent-height-chain | html layout | pass | 1 | 12/12 | 0/0 | 12/12 | 624/624 | 72/72 | 0 |  |
| margin-collapse-siblings | html layout | pass | 1 | 11/11 | 0/0 | 11/11 | 572/572 | 66/66 | 0 |  |
| margin-collapse-parent-child | html layout | pass | 1 | 27/27 | 0/0 | 27/27 | 1404/1404 | 162/162 | 0 |  |
| margin-collapse-through | html layout | pass | 1 | 27/27 | 0/0 | 27/27 | 1404/1404 | 162/162 | 0 |  |
| margin-collapse-min-height | html layout | pass | 1 | 42/42 | 0/0 | 42/42 | 2184/2184 | 252/252 | 0 |  |
| margin-collapse-body | html layout | pass | 1 | 5/5 | 0/0 | 5/5 | 260/260 | 30/30 | 0 |  |
| flex-auto-margins-main | html layout | pass | 1 | 21/21 | 0/0 | 21/21 | 1092/1092 | 126/126 | 0 |  |
| flex-auto-margins-cross | html layout | pass | 1 | 21/21 | 0/0 | 21/21 | 1092/1092 | 126/126 | 0 |  |
| flex-auto-margins-negative | html layout | pass | 1 | 17/17 | 0/0 | 17/17 | 884/884 | 102/102 | 0 |  |
| flex-align-content-remaining | html layout | pass | 1 | 42/42 | 0/0 | 42/42 | 2184/2184 | 252/252 | 0 |  |
| flex-align-content-odd | html layout | pass | 1 | 80/80 | 0/0 | 80/80 | 4160/4160 | 480/480 | 0 |  |
| flex-wrap-line-grow | html layout | pass | 1 | 27/27 | 0/0 | 27/27 | 1404/1404 | 162/162 | 0 |  |
| flex-intrinsic-wrap-column | html layout | pass | 1 | 24/24 | 0/0 | 24/24 | 1248/1248 | 144/144 | 0 |  |
| intrinsic-percent | html layout | pass | 1 | 29/29 | 0/0 | 29/29 | 1508/1508 | 174/174 | 0 |  |
| flex-nested | html layout | pass | 1 | 25/25 | 0/0 | 25/25 | 1300/1300 | 150/150 | 0 |  |
| flex-percent-definite | html layout | pass | 1 | 22/22 | 0/0 | 22/22 | 1144/1144 | 132/132 | 0 |  |
| flex-stretch-percent-minmax | html layout | pass | 1 | 15/15 | 0/0 | 15/15 | 780/780 | 90/90 | 0 |  |
| flex-distribution-grid | html layout | pass | 1 | 170/170 | 0/0 | 170/170 | 8840/8840 | 1020/1020 | 0 |  |
| text-wrap-spaces | html layout | pass | 1 | 43/43 | 25/25 | 43/43 | 520/520 | 68/68 | 0 |  |
| text-wrap-zwsp | html layout | pass | 1 | 29/29 | 14/14 | 29/29 | 468/468 | 60/60 | 0 |  |
| text-align-multi-line | html layout | pass | 1 | 47/47 | 22/22 | 47/47 | 728/728 | 95/95 | 0 |  |
| text-line-height-multi-line | html layout | pass | 1 | 38/38 | 21/21 | 38/38 | 520/520 | 67/67 | 0 |  |
| text-unbreakable-overflow | html layout | pass | 1 | 26/26 | 11/11 | 26/26 | 468/468 | 60/60 | 0 |  |
| text-whitespace-collapse | html layout | pass | 1 | 29/29 | 14/14 | 29/29 | 468/468 | 60/60 | 0 |  |
| text-anonymous-block-mixed | html layout | pass | 1 | 33/33 | 16/16 | 34/34 | 520/520 | 68/68 | 5 |  |
| flex-text-anonymous-item | html layout | pass | 1 | 28/28 | 12/12 | 28/28 | 468/468 | 61/61 | 5 |  |
| flex-text-min-content-shrink | html layout | pass | 1 | 31/31 | 12/12 | 31/31 | 624/624 | 79/79 | 0 |  |
| flex-column-text-wrap | html layout | pass | 1 | 29/29 | 13/13 | 29/29 | 520/520 | 66/66 | 0 |  |
| tree-switch-two-instances | tree layout | pass | 16 | 208/208 | 32/32 | 208/208 | 7488/7488 | 896/896 | 0 |  |
| tree-correlated-state | tree layout | pass | 12 | 48/48 | 0/0 | 48/48 | 2496/2496 | 288/288 | 0 |  |
| tree-controlled-aliases | tree layout | pass | 4 | 42/42 | 0/0 | 42/42 | 2184/2184 | 252/252 | 0 |  |
| tree-branch-arms | tree layout | pass | 3 | 14/14 | 0/0 | 14/14 | 728/728 | 84/84 | 0 |  |
| tree-slot-projection | tree layout | pass | 2 | 16/16 | 0/0 | 16/16 | 832/832 | 96/96 | 0 |  |
| tree-shared-class-one-module | tree layout | pass | 1 | 6/6 | 0/0 | 6/6 | 312/312 | 36/36 | 0 |  |
| tree-colliding-modules | tree layout | pass | 1 | 8/8 | 0/0 | 8/8 | 416/416 | 48/48 | 0 |  |
| tree-ordered-sheets | tree layout | pass | 1 | 4/4 | 0/0 | 4/4 | 208/208 | 24/24 | 0 |  |
| tree-ordered-sheets-reversed | tree layout | pass | 1 | 4/4 | 0/0 | 4/4 | 208/208 | 24/24 | 0 |  |
| tree-param-args | tree layout | pass | 1 | 6/6 | 0/0 | 6/6 | 312/312 | 36/36 | 0 |  |
| tree-nested-instances | tree layout | pass | 8 | 72/72 | 0/0 | 72/72 | 3744/3744 | 432/432 | 0 |  |
| tree-attribute-equality | tree layout | pass | 3 | 15/15 | 0/0 | 15/15 | 780/780 | 90/90 | 0 |  |
| tree-projected-text | tree layout | pass | 4 | 70/70 | 30/30 | 70/70 | 1248/1248 | 160/160 | 4 |  |
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

The dual box count of `text-anonymous-block-mixed` is one higher than its layout count because the `display: none` element `hidden` is compared in the dual lane (both renderings have no box) and has no box to compare in the layout lane.

New in S3b: `text-wrap-spaces`, `text-wrap-zwsp`, `text-align-multi-line`, `text-line-height-multi-line` (line-height normal, 1.5, 1.25 at 12px, 17px, 5px and 7px below the 10px glyph height, and 23px at 20px), `text-unbreakable-overflow` (with `white-space: nowrap`, in a block and as a flex item), `text-whitespace-collapse` (tabs, newlines, runs of spaces, edge spaces, a newline next to U+200B, `white-space: normal`, the two longhands, inherited `nowrap` overridden by `text-wrap-mode: wrap`), `text-anonymous-block-mixed`, `flex-text-anonymous-item`, `flex-text-min-content-shrink`, `flex-column-text-wrap`, `tree-projected-text` (4 cases) and `reject-white-space-pre`.

Anonymous boxes, each listed in `report.json` with its compared lines: `text-anonymous-block-mixed` m1:anon0 [m1:text0:line0], m1:anon1 [m1:text1:line0, line1], m2:anon0 [m2:text0:line0-2], m2:anon1 [m2:text1:line0], m3:anon0 [m3:text0:line0-2]; `flex-text-anonymous-item` f1:anon0 [f1:text0:line0-2], f1:anon1 [f1:text1:line0], f2:anon0 [f2:text0:line0-2], f3:anon0 [f3:text0:line0], f4:anon0 [f4:text0:line0-1]; `tree-projected-text#0-3` card/content:anon0 [card/content:text0:line0-1] in each case.

Tree case counts (declared by hand = rendered = enumerated by Dragon): switch 16, correlated-state 12, nested-instances 8, controlled-aliases 4, projected-text 4, branch-arms 3, attribute-equality 3, slot-projection 2, and 1 each for shared-class-one-module, colliding-modules, ordered-sheets, ordered-sheets-reversed and param-args.

## Chrome per-line rect mapping rule

Probed first (`/tmp/t030/probe1.mts`, Chrome 145.0.7632.6), then held on every capture:

1. The capture records each text node as `<element>:text<k>` (k counts text nodes that are not whitespace-only), with its Range bounding rect, followed by `<text>:line<j>` for the j-th rect of `Range.getClientRects()`. A whitespace-only text node is `<element>:space<k>` (k counts those) and is recorded only when it has client rects.
2. Chrome gives a text node one client rect per line on which it shows at least one character after white-space processing, in line order. The rect covers exactly those characters. Spaces removed at the end of a line are left out of the rect: "XX XX" at 30px gives two rects 20px wide, not 30px.
3. A text node whose only content on a line is such an end-of-line space gets no rect on that line. For example, "XX" followed by the node " YY" at 30px gives the second node one rect, on line 2 only. A whitespace-only node at a line break gets no rect at all.
4. The engine emits fragment `<leaf>:line<j>` for the j-th line on which the leaf has a visible character (after removing the spaces that end the line). Its geometry is:
   - x: the line's text-align offset plus the advance of the line's visible characters before it;
   - width: the advance of the leaf's visible characters on that line;
   - y: k times the line height plus the floored half-leading;
   - height: ascent plus descent.
   The leaf's own rect is the union of its fragments (CSSOM View `getBoundingClientRect` of a Range).
5. With this rule, every Chrome rect maps one-to-one to an engine fragment. In all 102 captures there are 232 line rects, 0 of them empty or zero-width, and 0 recorded `:space` nodes. All 232 match at 1/64 px, and no rect was filtered.

## Engine (`packages/layout`)

- `inline.ts` (new): the inline formatting context of a block container whose children are Ahem text leaves.
  - Soft wrap opportunities (css-text-3 §5.1, UAX #14 LB8/LB18): after a space and after U+200B, following any spaces that follow them. `text-wrap-mode: nowrap` removes them all.
  - Greedy breaking. A segment wider than the line overflows it alone.
  - Spaces at the end of a line hang: they neither count toward fitting nor show (§4.1.2).
  - text-align start/left/end/right/center in ltr. Center is `LayoutUnit / 2`, truncated: 50.3px leaves 19 LU of free space, and the offset is 9 LU. An overflowing line starts at the start edge. `justify` returns `text-align`.
  - Line k sits at k times the line height plus Blink's floored half-leading, which may be negative.
  - Every leaf in a context must share font, line-height and text-wrap-mode; otherwise `mixed-inline-font`.
  - min-content is the widest segment; max-content is the whole context on one line. Both are measured across leaf boundaries, so a word split over two leaves is one unbreakable segment.
- `input.ts`:
  - `TextLeaf` gains `whiteSpaceCollapse: 'collapse'` and `textWrapMode: 'wrap' | 'nowrap'`.
  - `LayoutBox` gains `boxType: 'element' | 'anonymous'`.
  - `LayoutRect` gains `parent`, and `absoluteRects(boxes)` sums positions through it, so line fragments are positioned relative to their leaf.
- `validate.ts` rejects the following, as new ValidationErrorCodes:
  - `mixed-children`: a box with both text and box children;
  - `text-in-flex`: text directly in a flex container;
  - `uncollapsed-text`: under `collapse`, an empty leaf, a tab, a segment break, a doubled space (also across leaves), or a space at either edge of the context.
  The engine never creates boxes: invalid input it would otherwise meet raises a plain error.
- `UnsupportedCode`: `multi-line-text`, `anonymous-block` and `anonymous-flex-item` became dead and were removed. The every-code-raised test still passes.
- `chrome-deviations.ts` (MF5): each deviation declares its branches, and each node names its branch and fixture. `half-leading-floor` now has a `negative-leading` branch, with nodes `neg5:text0:line0`, `neg5:text0:line2` and `neg7:text0:line1`: 5px gives -3px, not -2.5px; 7px gives -2px, not -1.5px.
- `layoutWithFaults(input, measurer, faults)` holds the planted `breakOffByOne`. `layout()` passes `NO_ENGINE_FAULTS`.

## Compiler (`packages/dragon`)

- **white-space longhands.** `white-space-collapse` and `text-wrap-mode` are added to LONGHANDS, INHERITED, PROPERTY_ASPECTS (layout) and PROPERTY_ROLE (text).
  - `white-space` is a shorthand over them. normal, pre, pre-wrap and pre-line set both longhands. Otherwise `<collapse> || <wrap-mode>`, and an omitted longhand takes its initial value.
  - A value with a `white-space-trim` keyword is `DRAGON_UNSUPPORTED_VALUE` on that keyword.
  - Other collapse modes expand normally, and no profile row supports them. The reject fixture: `white-space: pre` gives `DRAGON_UNSUPPORTED_VALUE` on `pre`.
  - Webref 8.7.5 and Chrome 145 agree: Chrome's computed initial values are `collapse` and `wrap`, and no UA rule sets either for html, body or div.
- **White-space phase I** (`collapseInlineRun` in the resolver). It runs over each inline formatting context: a maximal text sequence, where `display: none` elements do not end it. This is also what joins text from projections, branches and calls into one context.
  - Each whitespace sequence becomes one space, kept by the leaf where it starts.
  - A segment break next to U+200B is removed.
  - Spaces at the context's edges are removed.
  - Text that collapses to nothing is dropped.
- **Principle 3.** Each `ResolvedText` carries all 7 inherited text properties, each with origin `inherited`. `lowerText` reads only the text node.
- **Anonymous boxes.** The lowering creates them, `<element>:anon<k>`, one per text run, for text beside visible element boxes and for text directly in a flex container.
  - Style: inherited properties from the enclosing element, every other longhand its webref initial value, `display: block`.
  - `display: none` elements beside text are left out of the lowering: they generate no box.
- **Row keys.** A text property is keyed at each text node its value reaches by inheritance, with the declaration it came from and the text node's context: `text-in-block`, `text-in-flex-item`, `text-in-anonymous-block`, `text-as-anonymous-flex-item` or `text-in-display-none`. `single-line-text` is gone.
- **Internal functions.**
  - `textTopology(compiled, assignment)` returns, per text address: authoring component, template id, Origin, owner instance, insertion parent, context, and the Origin of each inherited text style.
  - `resolvedTextColors(compiled, assignment)` returns each text node's colour channels.
- **Parity lanes.**
  - The chrome-dual lane compares each text node's colour with its parent's computed color in both renderings.
  - The layout lane compares every Chrome node. A Dragon-only node passes only if it is an anonymous box whose text lines are all compared nodes.
  - The renderer separates adjacent tree text nodes with `<!---->`, so each stays its own DOM text node.

## S3a must-fix items

- **MF1.**
  - Every layout tree fixture's `fixture.json` declares `expected: {freeStates, cases, initial, textTopology}`. The 12 S3a fixtures were declared by hand from their sources: instance preorder, aliased states removed, document initial overrides applied.
  - `runFixture` fails a fixture unless the declaration matches both independently:
    - the renderer (free states with domains, count, initial case);
    - Dragon's `compiledCases` (count, exactly one initial case equal to the declared assignment, per-state value sets and order).
  - `parity.test.ts` checks all three counts for every tree fixture, and proves each check can fail. A declaration that is wrong in count, initial value or domain order is reported against both the renderer and Dragon.
- **MF2.**
  - The compile digest includes `profilesMode`. A test shows derive and enforce give different digests, and enforce equals the public digest.
  - The public entry exports none of `createProjectWith`, `NO_FAULTS`, `applyFix`, `textTopology` or `iosLayoutProjection`, and `createProject.length` is 1.
  - `types.test-d.ts` has `@ts-expect-error` for passing options to `createProject` and for importing `InternalOptions` from the public entry.
  - The export map is pinned in the test.
- **MF3.** `applyFix` refuses as stale any two edits in one source that start at the same offset when either is an insertion. It checks this before the overlap rule, so the reason is the same in either order. A test covers insertion+insertion and insertion+replacement in both orders. An insertion where another edit ends still applies, with the same result in either order.
- **MF4.**
  - Whitespace-only text gets the unique address `<element>:space<k>`, so no address is empty.
  - The collapse rule removes it beside a block, after a space, or at a context edge. When its space survives between runs, it is laid out as its own leaf, and the capture records it under the same address.
  - Tests cover the linked addresses, removal, and the surviving case.
- **MF5.** Every deviation node names a declared branch. The test requires at least one node per branch, and every node exact:
  - min-max-end-margin: dropped (p4, p6, p9) and collapsed-through (p5, p7);
  - half-leading-floor: positive-odd-leading (t3:text0) and negative-leading.
- **MF6.**
  - `dropInheritedText` sets every text node's font-size to its initial value, 16px, Chrome's computed root value. On `text-wrap-spaces` this fails the layout lane, starting with `w1:text0:line0`, while chrome-dual passes.
  - `breakOffByOne` makes a line accept one more glyph advance than fits. On `text-wrap-spaces` it fails the layout lane at `w5`, while chrome-dual passes.
  - With both faults off, the same fixture passes both lanes in the main run.

## Base-capture check output

```
base c70254d: 88 expected files, 1318 nodes, 63800 computed values compared; added 2552 new-longhand computed keys and 42 :line<j> nodes
emitted CSS: 47 files, 47 digest header lines changed, 2036 new-longhand declaration lines added, no other change
PASS: no node that existed at c70254d changed geometry, hasBox, kind or a computed value
```

The check compares every node of every `packages/parity/expected` file present at c70254d: kind, hasBox, x, y, width, height and every computed value. The only additions allowed are the keys `white-space-collapse` and `text-wrap-mode`, and `:line<j>` nodes under an existing text node. It also checks that every emitted CSS file of c70254d differs only in its digest line and the new longhand declarations. It ran on the committed tree before and after the regeneration.

## Deviations from the task text

1. **text-align stays on the box.** It applies to block containers (css-text-3 §7.1). The engine reads it from the box that holds the text, which is the element or its anonymous box. The resolved text node still carries text-align, with an inherited Origin, and `lowerText` reads only the text node's fields.
2. **Engine interface changes.** `LayoutBox.boxType`, `LayoutRect.parent`, the new `TextLeaf` fields and `absoluteRects(boxes)` change the engine interface and the vector format. All 102 vectors were regenerated.
3. **TextMeasurer.** `measure` now returns a width only. Break opportunities moved into `inline.ts`.
4. **`display: none` beside text** is left out of the lowering, so it cannot split a text run (no fixture needs it split). A `display: none` element elsewhere is lowered as before.
5. **Text contexts are not split by flex direction.** There are four laid-out contexts. `text-in-display-none` exists, but no wrapped case can prove it, so it has no rows. A text property reaching text in a hidden element blocks with `DRAGON_UNPROVEN_CONTEXT`. The hidden text I first drafted into `text-anonymous-block-mixed` was taken out instead of keying that context by geometry.
6. **MF1 covers layout tree fixtures only.** Reject tree fixtures have no cases, so they declare nothing.
7. **Adjacent text in the renderer.** The renderer writes `<!---->` between adjacent text nodes. Otherwise the HTML parser would merge them into one DOM text node. Comments generate no box; the old captures show no change.
8. **`white-space: nowrap`** sets `text-wrap-mode: nowrap` explicitly and `white-space-collapse: collapse` implicitly (its initial value); Chrome computes the same values.
9. **The planted `breakOffByOne` lives in `@dragon/layout`** through `layoutWithFaults`. The compiler faults stay in `dragon`.
10. **Profile revision `m1-s3b`.** Report case counts now show declared, rendered and Dragon counts.

## Risks and open items for the PM

- **Text measurement.**
  - Only integer px Ahem font sizes are measured. With fractional sizes, Blink's float glyph positions could differ from the per-leaf `ceil` sums at 1/64 px; no fixture covers it.
  - No fixture has a surviving whitespace-only text node (`:space<k>`). The path is unit-tested only, and the capture rule for it is unexercised.
  - `justify`, inline elements, mixed fonts and rtl remain unsupported, as the spec requires.
- **Owner visibility.** The iOS paint caveat cap is still 69 rows, and the Linux lane scope is still open. Both still need the owner.
- **Still open from S3a:**
  - Linux UA capture: root font-family is Times on macOS.
  - DPR other than 1.
  - Blink citations for the distribution model and min-max-end-margin.
  - css-tree `createRequire` in the browser-worker check.
