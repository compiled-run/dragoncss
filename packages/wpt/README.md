# @dragon/wpt: web-platform-tests as Dragon's spec oracle

This package reads a pinned copy of [web-platform-tests](https://github.com/web-platform-tests/wpt) (WPT), and gives every CSS test
file one status per target in `expectations/<target>.json`. It follows docs/decisions.md, "Spec conformance through
web-platform-tests". It never edits the WPT copy.

## Numbers (web, WPT `375cf2548a7c0952c54e141d1eb4e6fc4fe59e41`, web profile m1-s5)

**web: 2 pass of 38054 CSS WPT files (numeric runnable 2)**

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
  - Runnable for web: 2. Dragon passes 2 and fails 0.
  - On those 2 files, Dragon passes 2 of 2 subtests and 3 of 3 checks.
  - The 2 files are `css/css-flexbox/flexbox-lines-must-be-stretched-by-default.html` and `css/CSS2/normal-flow/unresolvable-max-height.html`.
- **Chrome 145 on the same checks,** running the original WPT pages: 2 of 2 subtests and 3 of 3 checks pass.
- **Not runnable:** 1,136 numeric files.
  - 850 are gated by Dragon's compiler (its first diagnostic is the reason).
  - 285 are refused by the translator.
  - 1 is blocked at the layout projection.
- **Translator cross-check** (`--chrome-all`):
  - 853 numeric files translate into a fixture and a checks sidecar.
  - For all 853, the WPT harness's own subtest results in Chrome equal the translated checks read in the same page.
  - Chrome passes 9,185 of 9,651 subtests and 39,556 of 40,276 checks on them. 773 files pass every subtest.

### Interop focus areas (wpt-metadata `e6b32d81746942e340e8df5011a9e930f189ebb1`, all years 2021-2026)

**Interop CSS (58 areas, 2021-2026): Dragon web 1/6482; Chrome 145 1/1 on the files this lane ran in Chrome. Mean area score for Dragon web: 0.0%.**

- **The one passing file:** Dragon's pass is `flexbox-lines-must-be-stretched-by-default.html` in interop-2021-flexbox (1/1033). Every other area is at 0.
- **Where the scores come from:** they are derived from `expectations/web.json` alone. Each entry carries its `interop` labels, so `wpt:check` fails when an area's score changes unexpectedly.
- **Chrome's column:** Chrome 145 runs only where Dragon runs, so it shows pass/run, not Chrome's wpt.fyi Interop score.
- **Excluded labels:** 30 labels with no CSS test files (IndexedDB, WebRTC, navigation and others) are listed in `interop-labels.json` and in the summary.
- **Mixed labels:** 13 areas also name non-CSS files. Only their CSS files are scored.
- **Where the full table is:** `out/summary.md`, after `pnpm wpt:run`.

Top not-runnable reasons for numeric files (grouped by property; the exact reasons are in `out/summary.md` after a run):

| reason | files |
|---|---:|
| `translate:script` (inline script logic besides `checkLayout`) | 161 |
| `DRAGON_UNSUPPORTED_PROPERTY:grid-column` (mostly from the linked `/css/support/grid.css`) | 142 |
| `DRAGON_UNSUPPORTED_PROPERTY:writing-mode` | 121 |
| `DRAGON_UNSUPPORTED_PROPERTY:background` | 106 |
| `DRAGON_UNSUPPORTED_PROPERTY:grid-template-columns` | 106 |
| `translate:script-src` (helper scripts: `style-change.js` 44, `test-common.js` 44) | 88 |
| `DRAGON_UNSUPPORTED_PROPERTY:font` | 47 |
| `DRAGON_UNSUPPORTED_PROPERTY:inline-size` | 36 |
| `DRAGON_UNSUPPORTED_PROPERTY:float` | 35 |
| `DRAGON_UNSUPPORTED_PROPERTY:grid-auto-flow` | 27 |

## Commands

```
scripts/fetch-wpt.sh                         # fetches the pinned commit into vendor/wpt when it is absent
pnpm wpt:run --target web                    # Dragon on every file, Chrome 145 on the runnable ones: out/web.json, out/summary.md, generated/
pnpm wpt:run --target web --chrome-all       # also Chrome on every translated numeric file (the translator cross-check)
pnpm wpt:check --target web                  # recomputes Dragon's result for every file; exits 1 on any difference from expectations/web.json
pnpm wpt:update-expectations --target web    # merges the last full wpt:run into expectations/web.json
pnpm wpt:interop-labels --metadata <dir>     # re-derives interop-labels.json from a wpt-metadata checkout at the pinned commit
```

- **The WPT copy:** WPT is not committed, and `vendor/wpt/` is gitignored.
  - `packages/wpt/wpt.lock` pins two commits: `wpt <sha>` for the tests and `wpt-metadata <sha>` for the Interop labels.
  - `scripts/fetch-wpt.sh` fetches `css/`, `resources/`, `fonts/`, `images/` and `LICENSE.md` at that commit, and writes `vendor/wpt/README.md`.
  - Set `DRAGON_WPT_DIR` to use a copy somewhere else.
  - Every command, and the tests in `test/`, check that the copy's README records the locked commit.
- **Filtering:** `--filter <path prefix>` limits a run or check to some paths. It is for debugging and the planted-fault test. The published check runs without it, and updates are refused from a filtered run.
- **Outputs:** `out/` and `generated/` are gitignored.

## How a file gets its status

1. **Manifest** (`src/manifest.ts`): every test file under `css/`, with the scout classifier's file and kind rules (/tmp/wpt-scout/classify.py). The kinds are, in order:
   - `manual`;
   - `crashtest`;
   - `reftest`;
   - `numeric`;
   - `testharness-other`;
   - `other`.

   Every file that is not numeric is `not-runnable` with `missing: "kind:<kind>"`.
2. **Translator** (`src/translate.ts`, parse5): turns the original page into a fixture in the strict HTML subset that `packages/parity/src/fixture-reader.ts` reads, plus a checks sidecar.
   - **Removed:** the harness scripts (`testharness.js`, `testharnessreport.js`, `check-layout-th.js`), `<meta>`, `<title>`, non-stylesheet `<link>`s and the Ahem `@font-face` sheet.
   - **Scripts:** an inline script or `<body onload>` may only call `checkLayout('<selector>')`, optionally wrapped in load or `document.fonts.ready` callbacks and `setup({ explicit_done: true })`. Anything else is refused.
   - **Stylesheets:** every `<style>` and linked WPT stylesheet is joined, in document order, into the one sheet. A linked sheet containing `url()` is refused.
   - **Ids and inline styles:** each `#id` selector becomes a generated class. Each inline `style=""` becomes a class rule after every sheet rule.
   - **The cascade guard** refuses the test (`translate:specificity-rewrite`) if the lift could change the order of any two interacting declarations on any element.
   - **Other attributes** (`dir`, `lang` and so on) are passed through, so the compiler judges them.
   - **The sidecar** holds check-layout's subtests: one per node matched by the `checkLayout` selector, over the parent's own values and the node's subtree, named as check-layout names them.
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
  - an `issue` (a Dragon bug) when Chrome passes a check that Dragon fails.

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
- **Test data:** `test/data/offsets.html` is a synthetic page written for this package, not a WPT file.
- **Wording:** following clause 3, say "Dragon passes N WPT tests", never that WPT or its contributors endorse or certify Dragon.
- **Ahem:** the Ahem font Dragon uses (vendor/fonts/Ahem.ttf) is public domain or CC0, according to its name table.
