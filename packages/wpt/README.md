# @dragon/wpt: web-platform-tests as Dragon's spec oracle

This package reads a pinned copy of [web-platform-tests](https://github.com/web-platform-tests/wpt) (WPT), and gives every CSS test
file one status per target in `expectations/<target>.json`. It follows docs/decisions.md, "Spec conformance through
web-platform-tests". It never edits the WPT copy.

## Numbers (web, WPT `375cf2548a7c0952c54e141d1eb4e6fc4fe59e41`, web profile m1-s5)

**web: 4 pass of 38054 CSS WPT files (numeric runnable 5)**

| kind | files |
|---|---:|
| numeric (check-layout-th.js or `data-expected-*`) | 1,138 |
| testharness-other | 6,609 |
| reftest | 25,145 |
| crashtest | 1,208 |
| manual | 368 |
| other (no harness, has `rel=help`) | 3,586 |
| **total** | **38,054** |

- **Numeric files:** 1,138.
  - Runnable for web: 6. Dragon passes 5 and fails 1.
  - On those 6 files, Dragon passes 6 of 7 subtests and 11 of 12 checks.
  - The passing files: `css/CSS2/normal-flow/unresolvable-max-height.html`, `css/css-flexbox/abspos/position-absolute-004.html` (snapshot, 1 state), `css/css-flexbox/column-reverse-gap.html`, `css/css-flexbox/flexbox-lines-must-be-stretched-by-default.html`, `css/css-flexbox/total-min-max-violation-zero.html`.
  - The failing files, each with its reason and issue or deviation in `expectations/web.json`: `css/css-flexbox/flex-minimum-height-flex-items-012.html` (dragon#flex-min-height-012).
- **Chrome 145 on the same checks,** running the original WPT pages: 7 of 7 subtests and 12 of 12 checks pass.
- **Script-driven numeric files** (the snapshot path, below): 263 files whose scripts, helper scripts or handlers the static translator cannot read.
  - 237 are snapshotted in Chrome 145 into 580 DOM states (one case per `checkLayout` call). 1 of them is runnable and passes; the others stop at Dragon's compiler gate or the layout projection.
  - 26 are refused by the snapshot path with a precise reason: `snapshot:other-subtests` 7, `script:event:click` 6, `snapshot:no-checklayout` 5, and one each of `script:event:error`, `script:nondeterministic:Math.random`, `script:scroll`, `script:timing:requestAnimationFrame`, `script:timing:step_timeout`, `script:top-layer:popover`, `script:top-layer:showModal` and `snapshot:animation-running`.
  - Two captures of each page in fresh contexts are identical, and a later `wpt:run` recaptured the committed store byte for byte.
- **Not runnable:** 1,132 numeric files.
  - 1,072 are gated by Dragon's compiler (its first diagnostic is the reason).
  - 22 are refused by the translator. This was 285 before the snapshot path.
  - 26 are refused by the snapshot path.
  - 11 are blocked at the layout projection.
  - 1 is waiting on an assertion Dragon cannot make yet (`assert:*`).
- **Translator cross-check** (`--chrome-all`):
  - 1,086 numeric files translate into fixtures and checks sidecars: 853 from the file itself and 233 from Chrome snapshots.
  - For all 1,086, the WPT harness's own subtest results in Chrome equal the translated checks read in the same page (for snapshots, at the moment of each `checkLayout` call).
  - Chrome passes 14,956 of 15,481 subtests and 74,150 of 75,120 checks on them. 989 files pass every subtest.
- **reftest-layout** (experimental, report-only, **not** in the headline number or in `wpt:check`'s gate; `--reftest-layout`):
  - Of 25,145 reftests, 23,079 are excluded by the static filter: `reftest-layout:text` 15,356, `replaced` 3,012, `script` 1,518, `reftest-wait` 1,438, `fuzzy` 1,004, `mismatch` 436, `ref-chain` 140, `multiple-refs` 83, `special-element` 80, `ref-missing` 11 and `ref-parse` 1.
  - 2,066 candidates remain. Dragon's compiler gates 2,035 of them (`DRAGON_UNSUPPORTED_PROPERTY` 1,678 is the largest group). The translator refuses 5, and 7 are refused against Chrome's page: `reftest-layout:page-overflow` 3, `reftest-layout:paint:border-style` 2, `reftest-layout:paint:alpha` 1 and `reftest-layout:model-mismatch` 1.
  - 19 reach a verdict, and all 19 pass: Dragon's raster of the test equals Chrome's raster of the reference with 0 pixels different, and every box sits where Chrome puts it on the test page. The list is in `expectations/web.reftest-layout.json`.

### Interop focus areas (wpt-metadata `e6b32d81746942e340e8df5011a9e930f189ebb1`, all years 2021-2026)

**Interop CSS (58 areas, 2021-2026): Dragon web 3/6482; Chrome 145 4/4 on the files this lane ran in Chrome. Mean area score for Dragon web: 0.0%.**

- **The passing files:** interop-2021-flexbox 2/1033 and interop-2023-flexbox 1/102. Every other area is at 0.
- **Where the scores come from:** they are derived from `expectations/web.json` alone. Each entry carries its `interop` labels, so `wpt:check` fails when an area's score changes unexpectedly.
- **Chrome's column:** Chrome 145 runs only where Dragon runs, so it shows pass/run, not Chrome's wpt.fyi Interop score.
- **Excluded labels:** 30 labels with no CSS test files (IndexedDB, WebRTC, navigation and others) are listed in `interop-labels.json` and in the summary.
- **Mixed labels:** 13 areas also name non-CSS files. Only their CSS files are scored.
- **Where the full table is:** `out/summary.md`, after `pnpm wpt:run`.

Top not-runnable reasons for numeric files (grouped by property; the exact reasons are in `out/summary.md` after a run):

| reason | files |
|---|---:|
| `DRAGON_UNSUPPORTED_PROPERTY:writing-mode` | 167 |
| `DRAGON_UNSUPPORTED_PROPERTY:grid-template-columns` | 158 |
| `DRAGON_UNSUPPORTED_PROPERTY:grid-column` (mostly from the linked `/css/support/grid.css`) | 151 |
| `DRAGON_UNSUPPORTED_PROPERTY:float` | 64 |
| `DRAGON_UNSUPPORTED_PROPERTY:font` | 53 |
| `DRAGON_UNSUPPORTED_PROPERTY:grid` | 40 |
| `DRAGON_UNSUPPORTED_ELEMENT` | 37 |
| `DRAGON_UNSUPPORTED_PROPERTY:anchor-name` | 34 |
| `DRAGON_UNSUPPORTED_PROPERTY:outline` | 34 |
| `DRAGON_CSS_INVALID_VALUE:-webkit-flex` | 33 |
| `DRAGON_UNSUPPORTED_PROPERTY:vertical-align` | 31 |
| `DRAGON_UNSUPPORTED_PROPERTY:grid-auto-flow` | 27 |
| `DRAGON_UNSUPPORTED_PROPERTY:margin-trim` | 27 |

`translate:script` (161) and `translate:script-src` (88: `style-change.js` 44, `test-common.js` 44) no longer appear: those files now take the snapshot path.

## Commands

```
scripts/fetch-wpt.sh                         # fetches the pinned commit into vendor/wpt when it is absent
pnpm wpt:run --target web                    # Dragon on every file, Chrome 145 on the runnable ones: out/web.json, out/summary.md, generated/
pnpm wpt:run --target web --chrome-all       # also Chrome on every translated numeric file (the translator cross-check)
pnpm wpt:run --target web --reftest-layout   # also the experimental, report-only reftest-layout lane
pnpm wpt:run --target web --no-chrome        # Dragon only; script-driven tests read the committed snapshots
pnpm wpt:check --target web                  # recomputes Dragon's result for every file (no Chrome: committed snapshots); exits 1 on any difference from expectations/web.json
pnpm wpt:check --target web --reftest-layout # also recomputes the reftest-layout report and prints its differences (never fails on them)
pnpm wpt:update-expectations --target web    # merges the last full wpt:run into expectations/web.json and copies its snapshots into snapshots/
pnpm wpt:interop-labels --metadata <dir>     # re-derives interop-labels.json from a wpt-metadata checkout at the pinned commit
```

- **The WPT copy:** WPT is not committed, and `vendor/wpt/` is gitignored.
  - `packages/wpt/wpt.lock` pins two commits: `wpt <sha>` for the tests and `wpt-metadata <sha>` for the Interop labels.
  - `scripts/fetch-wpt.sh` fetches `css/`, `resources/`, `fonts/`, `images/` and `LICENSE.md` at that commit, and writes `vendor/wpt/README.md`.
  - Set `DRAGON_WPT_DIR` to use a copy somewhere else.
  - Every command, and the tests in `test/`, check that the copy's README records the locked commit.
- **Filtering:** `--filter <path prefix>` limits a run or check to some paths. It is for debugging and the planted-fault test. The published check runs without it, and updates are refused from a filtered run.
- **Outputs:** `out/` and `generated/` are gitignored.
- **Committed Chrome captures:** `snapshots/<wpt path>.json` (script-driven tests) and `reftest-captures/<wpt path>.json` (reftest-layout), like the parity lane's committed captures. `wpt:run` recaptures into `out/`, and `wpt:update-expectations` copies them in, the reftest-layout ones only when the run had `--reftest-layout`. `wpt:check` fails when a script-driven file has no snapshot (`snapshot:missing`), a stale one (`snapshot:stale`, for a changed source or commit), or when a snapshot file belongs to no script-driven file. `--snapshots <dir>` points `wpt:check` at another store; the planted-fault test uses it.

## How a file gets its status

1. **Manifest** (`src/manifest.ts`): every test file under `css/`, with the scout classifier's file and kind rules (/tmp/wpt-scout/classify.py). The kinds are, in order:
   - `manual`;
   - `crashtest`;
   - `reftest`;
   - `numeric`;
   - `testharness-other`;
   - `other`.

   Every file that is not numeric is `not-runnable` with `missing: "kind:<kind>"`.
2. **Translator** (`src/translate.ts`): turns a document tree (`src/dom.ts`) into a fixture in the strict HTML subset that `packages/parity/src/fixture-reader.ts` reads, plus a checks sidecar.
   - **Parsing:** `.html`/`.htm` files go through parse5. `.xht`, `.xhtml` and `.xml` files go through `src/xml.ts`, a namespace-aware XML parser that handles CDATA, comments, processing instructions, internal-subset entities and, for XHTML DOCTYPEs, the HTML named references. It parses all 10,991 such files at the pinned commit. A file that is not well-formed is `translate:xml-parse`, and an `.svg` document is `translate:svg-document`.
   - **XHTML specifics:** `<?xml-stylesheet?>` sheets are inlined first, resolved against the test like `<link>` sheets. `xml:lang` becomes `lang`, and `xmlns` declarations are dropped. Elements outside the XHTML namespace are `translate:foreign-element`.
   - **Removed:** the harness scripts (`testharness.js`, `testharnessreport.js`, `check-layout-th.js`), `<meta>`, `<title>`, non-stylesheet `<link>`s and the Ahem `@font-face` sheet.
   - **Scripts:** an inline script or `<body onload>` may only call `checkLayout('<selector>')`, optionally wrapped in load or `document.fonts.ready` callbacks and `setup({ explicit_done: true })`. Anything else, including helper scripts and other handlers, takes the snapshot path below.
   - **Stylesheets:** every `<style>` and linked WPT stylesheet is joined, in document order, into the one sheet. A linked sheet containing `url()` is refused.
   - **Ids and inline styles:** each `#id` selector becomes a generated class. Each inline `style=""` becomes a class rule after every sheet rule.
   - **The cascade guard** refuses the test (`translate:specificity-rewrite`) if the lift could change the order of any two interacting declarations on any element.
   - **Other attributes** (`dir`, `lang` and so on) are passed through, so the compiler judges them.
   - **The sidecar** holds check-layout's subtests: one per node matched by the `checkLayout` selector, over the parent's own values and the node's subtree, named as check-layout names them.
   - **Snapshot path** (`src/snapshot.ts`), for a numeric file whose static translation meets script logic (`translate:script`), a helper script (`translate:script-src:*`) or an event handler (`translate:event-attribute`):
      - **Capture:** the ORIGINAL page runs in Chrome 145 with its own scripts and helpers. An init script, installed before any page script, intercepts `window.checkLayout`. At each call it records the whole DOM before check-layout reads it: elements, attributes as scripts left them (classes, `data-expected-*` set by helpers), `style=""` as scripts set it, `<style>` text as scripts rewrote it, and the values check-layout reads. Script elements are left out.
      - **Cases:** each call's state is its own fixture case (`<id>.state-<n>`). Subtests keep check-layout's numbering across calls, so a dynamic test that toggles classes between calls is checked at every state.
      - **Deterministic scripts only:** the init script flags every use by test code (the caller frame is not `testharness.js` or `check-layout-th.js`) of timers (`script:timing:*`, including `step_timeout`), event listeners other than load and dispatching events (`script:event:*`), animations (`script:animation`), scrolling (`script:scroll`), resizing and observers (`script:resize`, `script:resize-observer`, `script:intersection-observer`), clocks and randomness (`script:nondeterministic:*`), I/O (`script:io:*`), the top layer (`script:top-layer:*`), shadow DOM, CSSOM sheet edits (`script:cssom-sheet`), `CSS.registerProperty` and `FontFace`.
      - **Other refusals:** the harness not completing or not OK (`snapshot:harness-incomplete`, `snapshot:harness-status:<n>`), no `checkLayout` call (`snapshot:no-checklayout`), subtests not from `checkLayout` (`snapshot:other-subtests`), quirks mode, a scrolled state, and running animations. Any flag refuses the test with the first flag in sorted order.
      - **Determinism check:** the page is captured twice in fresh contexts, and different captures are `snapshot:nondeterministic`.
      - **The check:** `wpt:check` translates the committed snapshots without Chrome, so the result is checked like any other. Chrome's side of the cross-check is the harness's own results and the values read at each call.
      - **Planted faults** (`test/snapshot.test.ts`): a snapshot that drops the style a script set, or that keeps only the first state of a dynamic test, makes the check fail. A committed snapshot that is stale or missing makes `wpt:check` fail (`test/stores.test.ts`).
3. **Gate:** Dragon's own `check` with only the target configured. The first diagnostic that blocks the target is the reason, as `CODE:feature` or `CODE:source text`. There is no hand-written feature list.
4. **Not runnable yet:**
   - `assert:scroll-size`: scroll sizes, until Dragon exposes scrollable overflow.
   - `assert:computed-*`: `display`, padding and margin checks.
   - `assert:root-client-size`: client sizes of the root.
5. **Layout:** the parity lane's path, with WPT's environment of 800x600, DPR 1, ltr and the UA root font.
   - The compile uses the native projection (`nativeLayoutProjection`). A blocked projection is `layout-projection:<first diagnostic>`, for example non-Ahem text.
   - Then `validateLayoutInput`, and `layoutWithFaults` with the reference measurer.
6. **Assertions** (`src/assertions.ts`): check-layout's tolerance, which passes if the difference is under 1 CSS px and otherwise needs exact equality.
   - **offsetParent:** the nearest positioned ancestor, or body.
   - **offsetLeft and offsetTop:** measured from the offsetParent's padding edge, or from the initial containing block when the offsetParent is body.
   - **Rounding:** Chrome 145 rounds offset positions and offset and client sizes half up from the unrounded box. This was measured on 100 fractional boxes, positive and negative. `SnapSizeToPixel` did not match Chrome.
   - **getBoundingClientRect:** the unrounded box.
7. **Chrome** (`src/chrome.ts`): the original WPT file, served from the WPT copy.
   - It runs in the parity lane's pinned Chrome 145 (`launchChrome`, Playwright 1.58.2), at 800x600 and DPR 1.
   - `testharnessreport.js` is replaced by a reporter that keeps the results in the page.
   - Each check's DOM value is read the way check-layout reads it.

## reftest-layout (experimental, report-only)

`src/reftest.ts`, behind `--reftest-layout`. It turns pure-layout reftests into numbers. It is a separate kind, written to `expectations/<target>.reftest-layout.json`. It is not in the headline number, not in the Interop scores and not in `wpt:check`'s gate: the check prints its differences and never fails on them.

1. **Static filter:** the test has exactly one `rel=match` reference, no `mismatch`, no `fuzzy` meta, no `reftest-wait`, and the reference is not itself a reftest. Both pages have no script, no text in the body, and no replaced, foreign or special-rendering elements. Excluded files are counted by reason, not listed.
2. **Dragon:** the test is translated like a numeric test (no checks), gated by the compiler, and laid out. Candidates it cannot lay out are listed with the reason.
3. **Chrome** (committed under `reftest-captures/`): the test and the reference are loaded at 800x600, DPR 1. For each element, Chrome records its border box, background colour, border widths and colour, display, position, float, overflow clip and visibility.
   - **Refusals:** anything a box paint model cannot draw exactly is refused in the page, for example `reftest-layout:paint:outline`, `border-radius`, `alpha`, `z-index`, `scrollbar`, `generated-content` or `page-overflow`.
   - **Model check:** the model's raster of each page must equal Chrome's own screenshot of it pixel for pixel, and the two screenshots must be equal (`reftest-layout:model-mismatch`, `reftest-layout:chrome-fails`).
4. **Verdict:** Dragon's layout of the TEST is painted by the same model, with the test's colours as Chrome computed them but Dragon's border boxes and Dragon's resolved border widths. It is compared with Chrome's raster of the REFERENCE, and passes when 0 pixels differ.
   - The entry also records how many of the test's boxes Dragon places within 1/64 px of Chrome's boxes for the test page.
   - A planted 1 px shift of one Dragon box fails (`test/reftest.test.ts`).
5. **Paint order:** a simplified CSS 2 Appendix E. Block backgrounds come first, then floats, then atomic inlines (each painted atomically), then positioned elements in tree order, with z-index refused. It is only trusted where the screenshots confirm it.

## Interop labels

- **Where the labels come from:** Interop test sets are the `interop-YYYY-<area>` labels in the META.yml files of [wpt-metadata](https://github.com/web-platform-tests/wpt-metadata).
- **The generator:** `src/interop.ts` reads every META.yml at the pinned commit. It reads each label from any item of the `links` sequence, whatever the key order, including `- url: ""` / `label:` items.
  - Test ids map to files: variants are dropped, and `.any*.html` and `.window.html` map back to their `.js` file.
  - A wildcard test under an Interop label stops the generator; none exist at the pin.
- **The committed map:** `interop-labels.json`, sorted.
  - `labels`: the CSS-bearing labels and their CSS test files.
  - `excluded`: labels with no CSS test file.
  - `nonCssFiles`: per label, the non-CSS files it also names.
- **Scores:**
  - An area's CSS files are its labelled files present at the pinned WPT commit. Labelled files missing there are shown as absent.
  - Dragon passes a file when its entry is `pass`.
  - Chrome passes a file when its recorded harness status is OK and every subtest passed.

## Expectations

`expectations/<target>.json` lists every manifest file, tagged with its `interop` labels when it has any. It is sorted, with one line per file, sorted keys and no timings. It pins `wpt` (the commit) and `profileRevision`.

- **`pass`:** records the subtest counts, and Chrome's result on the same page (`chrome`: harness status, subtests, checks).
- **`fail`:** needs a `reason`, plus:
  - a `deviation`, an id from `packages/layout/src/chrome-deviations*.ts`, when Chrome also fails a check that Dragon fails;
  - an `issue` (a Dragon bug) when Chrome passes a check that Dragon fails. Issue ids have the form `dragon#<slug>`: a short, lowercase,
    hyphenated name for the bug, for example `dragon#flex-min-height-012`. One id may cover several files that fail for the same reason.

  The entry also records Chrome's result on the same checks (`chrome.checks` and `chrome.alsoFails`), so the classification is checked mechanically.
- **`not-runnable`:** needs `missing`, which is the kind, the translator refusal, the first compiler diagnostic, or an assertion or projection reason.

`wpt:check` fails on any difference from the expectations. That covers:
- an unexpected pass;
- an unexpected fail;
- a file becoming runnable or not runnable;
- a changed reason;
- a changed subtest or check count;
- an added or removed file;
- a different commit or profile revision;
- changed Interop labels, or a changed Interop area score;
- any fail entry with a `TODO` reason, an unknown deviation, or a classification its Chrome result contradicts.

`wpt:update-expectations` rewrites pass and not-runnable entries from the run. It keeps each existing fail entry's reason, deviation and issue, and never turns a fail entry into a pass, so a person has to delete it. A new failure is written with `reason: "TODO"`, which `wpt:check` rejects.

## Licence and attribution

web-platform-tests is licensed under the 3-clause BSD licence. Its full text ships as `vendor/wpt/LICENSE.md` in every fetched copy, and is reproduced here:

> Copyright © web-platform-tests contributors
>
> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
>
> 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

- **Generated fixtures** (`generated/`, gitignored) are derived from WPT files. Each one's style sheet starts with a comment naming its WPT source path and commit, and pointing to `vendor/wpt/LICENSE.md`.
- **Test data:** `test/data/offsets.html` and everything under `test/data/snapshot/` and `test/data/reftest/` are synthetic pages written for this package, not WPT files. They are served at `/css/dragon-test/` so they can load WPT's own `/resources/` harness.
- **Committed captures:** `snapshots/` and `reftest-captures/` hold Chrome's reading of WPT pages: DOM trees with WPT's markup and text, and box lists. They are derived from WPT files, and each one names its WPT source path and commit.
- **Wording:** following clause 3, say "Dragon passes N WPT tests", never that WPT or its contributors endorse or certify Dragon.
- **Ahem:** the Ahem font Dragon uses (vendor/fonts/Ahem.ttf) is public domain or CC0, according to its name table.
