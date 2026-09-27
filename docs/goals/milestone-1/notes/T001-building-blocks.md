# T001 Building blocks for milestone 1

Scout, 2026-09-26. Host: macOS arm64, Node 24.15.0, cargo 1.97.1 (Homebrew), rustup stable 1.98.1.
"Ran" means executed today under /tmp. "Read" means read from source or a registry. Nothing in the repo was changed except this note.

## 0. Summary for the first Worker

- **CSS values:** `css-tree@3.2.1` (MIT) forked with `@webref/css@8.7.5` (MIT) grammars works (ran). Substitute `var()` before matching, because css-tree refuses to match `var()` (ran). `@webref/css` loads with `fs`, so generate a grammar JSON at build time and do not import it at runtime.
- **yuku is not needed in milestone 1.** Decision 16 and api.md 4.4 put source readers after milestone 1 and outside the core dependency graph. Milestone-1 input is CSS text plus a `dragon/tree@0` element tree.
- **Taffy:** crate `taffy = "=0.14.0"` (MIT). Its default `Style` is **not** the web default (see 3.3). Taffy supports `direction: rtl` (since 0.10) in block, flex and grid.
- **Run Taffy from Node:** use a small Rust CLI that reads a batch of JSON fixtures on stdin (ran: 2,000 layouts in 6 ms per process; 1.25 ms per Node spawn). Use Dragon's own JSON schema, because Taffy's serde form of `Dimension` is a packed u64 (ran). Postpone WASM.
- **Playwright:** pin `playwright@1.58.2`. It maps to chromium-1208 (Chrome 145.0.7632.6), which is fully cached on this host and is already used by markless. Capture ran: 0.87 s for launch, capture and close.
- **Ahem:** WPT `fonts/Ahem.ttf` v1.50 is public domain with a CC0 fallback. It has ascent 800, descent 200, line gap 0 and 1000 units per em in hhea, OS/2 typo and OS/2 win (ran). So `line-height: normal` is exactly 1em in every engine (Chrome confirmed: 10 px at 10 px).
- **Blink `html.css` is LGPL-2+.** Do not vendor it. Capture computed UA values from Chrome, as decision 3 already says.
- **Local Rust builds are blocked by the unaccepted Xcode licence.** The `cc`, `/usr/bin/ld`, `git` and `python3` shims all refuse to run. Workaround used today: link with `zig cc` (see 4.3). Linux CI is not affected.

## 1. CSS parsing and validation (css-tree + webref)

Versions read with `npm view` today:

| Package | Version | Licence | Notes |
|---|---|---|---|
| css-tree | 3.2.1 | MIT | parse, walk, generate, lexer, fork, definitionSyntax exported |
| @webref/css | 8.7.5 | MIT | peerDependency `css-tree ^3.2.1`; `index.js` uses `require('fs').promises` |
| @webref/idl | 3.84.0 | MIT | not needed |

API facts (ran in /tmp/csst):
- `csstree.parse(text, { positions: true })` gives an AST where `node.loc.start.{line,column,offset}` is set. `parse(v, { context: 'value' })` parses a bare value.
- `csstree.walk(ast, { visit: 'Declaration', enter(node) {...} })`. Each declaration has `node.property` and `node.value` (a Value AST).
- `csstree.lexer.matchProperty(prop, valueAst)` returns `{ error }`. An error has `name` (`SyntaxMatchError`, etc.) and `message` ("Mismatch").
- **`var()` is not matched:** the error is "Matching for a tree with var() is not supported". This fits T018/api.md section 5: substitute per condition first, then match.
- Fork with webref: `csstree.fork({ properties: {name: syntax}, types: {name: syntax} }).lexer`. Load the data from `@webref/css/css.json` (816 properties and 432 types with syntax). Ran: `flex-basis: content`, `gap: 4px 8px`, `width: fit-content(10px)` and `align-items: safe center` match; `padding: -1px` is rejected. The webref grammar does not encode range checks such as non-negative; css-tree handles `[0,∞]` only where the syntax string contains it. **Worker must verify that range restrictions like padding ≥ 0 are enforced for each milestone property.** Here the rejection came from the syntax `<length-percentage [0,∞]>`.
- webref also gives `initial`, `inherited`, `appliesTo`, `percentages` and `computedValue` for each property (read, `flex-basis` entry). These are useful for the initial-value and inheritance tables. They are not support facts (api.md 4.4).

Recommendation: add `css-tree` as a runtime dependency of `dragon`. Add `@webref/css` as a devDependency. A script, `scripts/gen-css-grammar.ts`, writes `packages/dragon/src/css/grammar.generated.json` (pinned, committed), and the core does `fork()` over it synchronously. This avoids `fs`, WASM and top-level await (api.md 4.4). Lightning CSS is not used.

## 2. yuku (@tsrx/yuku)

- Read: `@tsrx/yuku@0.3.0` (MIT, npm, and `~/dev/open-source/yuku-tsrx/npm/yuku/package.json`). It parses TSRX modules into ESTree plus `JSXStyleElement` (`src/dialect/style.zig`, "style structure"). It is a front-end reader of `<style>` blocks in TSRX source, not a CSS value checker.
- Decision 16: frameworks provide their element trees first, and Dragon source readers come after milestone 1. api.md 4.4: "Yuku belongs there [optional front-end packages], not in the core dependency graph."
- **Conclusion: yuku is not needed in milestone 1.** Package-consumer tests must even prove that the core imports without it.

## 3. Taffy

### 3.1 Version, licence, source
- `cargo search`/`cargo info taffy` (ran): **0.14.0**, MIT, rust-version 1.71. Default features: std, taffy_tree, flexbox, flexbox_balance, grid, block_layout, float_layout, calc, content_size, detailed_layout_info. Optional features: `serde` and `parse` (cssparser).
- GitHub main tarball (downloaded to /tmp/taffy-src today; Cargo.toml says 0.14.0). LICENSE is MIT, "Copyright (c) 2018 Visly Inc. / Copyright (c) 2026 Taffy Authors". Copying fixtures is allowed if the MIT notice is kept. Put it in `vendor/taffy/LICENSE`.
- Forks worth knowing: `genet-taffy 0.14.0` (float, flex `order`). Do not use it; pin upstream.

### 3.2 Tree API (read from taffy-0.14.0 src)
```rust
let mut t: TaffyTree<Ctx> = TaffyTree::new();
t.disable_rounding();                        // or enable_rounding(); rounding is ON by default
let leaf = t.new_leaf_with_context(style, ctx)?;   // new_leaf(style) without context
let node = t.new_with_children(style, &[leaf])?;   // or set_children / add_child
t.compute_layout_with_measure(root, Size { width: AvailableSpace::Definite(w), height: AvailableSpace::Definite(h) },
  |inputs: LayoutInput, id, ctx: Option<&mut Ctx>, style: &Style| -> LayoutOutput {
     taffy::compute_leaf_layout(inputs, style, |_, _| 0.0 /* calc resolver */, |known, avail| Size {..})
  })?;
let l: &Layout = t.layout(node)?;   // location (relative to parent border box), size, border, padding, scrollbar_size, content_size, order
let u: &Layout = t.unrounded_layout(node);
```
**0.14 API change:** the measure closure now receives `LayoutInput` and returns `LayoutOutput`. It wraps `taffy::compute_leaf_layout` (see `examples/measure.rs`). Older blog and tutorial snippets that use `(known, avail, id, ctx, style) -> Size` fail to compile with error E0593 (ran into this today).

`Style` fields (0.14): display, box_sizing, direction, overflow, scrollbar_width, position, inset, size, min_size, max_size, aspect_ratio, margin, padding, border, align_items/self/content, justify_content/items/self, gap, text_align, flex_direction, flex_wrap, flex_basis, flex_grow, flex_shrink, grid_*, float, clear, contain. Constructors: `length(px)`, `percent(0..1)`, `auto()`, `Dimension::AUTO`.

Rounding: `round_layout` rounds cumulative absolute edges, like Chrome's pixel snapping. It is the same as gentest's `smartRoundedLayout`: `round(right) - round(left)` against the containing block.

### 3.3 Taffy defaults vs web defaults (from `Style::DEFAULT`)
| Property | Taffy default | Web initial / UA for `div` | Consequence |
|---|---|---|---|
| display | `Flex` (`Grid` if flexbox feature off) | `inline`; `div` is `block` by UA | Always set display explicitly from resolved CSS |
| box_sizing | `BorderBox` | `content-box` | Always set it |
| position | `Relative` | `static` | Map `static` to Relative (Taffy has no Static) and document it |
| flex_shrink | 1.0 | 1 | same |
| flex_grow / basis | 0 / auto | 0 / auto | same |
| align_*/justify_* | `None` (acts as normal/stretch) | normal | same if left None |
| min_size | auto | auto | same |
| direction | Ltr | ltr | same |
| overflow / scrollbar_width | Visible / 0 | visible / UA scrollbar | Fixtures use `--hide-scrollbars` or no overflow |
| body margin | none | 8px UA | Reset or capture it; the gentest base CSS sets `body{margin:0}` |
The compiler must emit a complete Taffy style for every node, never relying on Taffy defaults. That is the "no guessed defaults" rule.

### 3.4 Gentest corpus (read)
- `test_fixtures/`: **1,548 HTML files**: flex 678, grid 547, block 241, float 27, leaf 14, blockgrid 14, blockflex 12, contain 8, gridflex 7.
- Format: plain HTML with `<div id="test-root" style="...">` and inline styles. It links `scripts/gentest/test_base_style.css`, which embeds a woff2 **Kozea Ahem** data URI and sets `div { display:flex; box-sizing:border-box; position:relative; border:0 solid; margin:0; padding:0 }` and `#test-root { font-family: ahem; line-height:1; font-size:10px }`. **These are not web defaults.** A Dragon import must include this base CSS as an explicit stylesheet in the fixture.
- Generator `scripts/gentest` (Rust, fantoccini + ChromeDriver): `scripts/getchrome` downloads the **latest Stable** Chrome for Testing, which is not pinned. It launches `--headless --no-sandbox --disable-gpu`, runs `test_helper.js` `describeElement` (getBoundingClientRect relative to the containing block, `offset*`, `scroll*`, `client*`, computed styles) and emits four variants for each fixture: `__border_box_ltr`, `__content_box_ltr`, `__border_box_rtl`, `__content_box_rtl`.
- Expected output now lives in **`tests/xml/**/*.xml`** (6,125 cases; flex 2,672 = 668 × 4). Each XML has the computed style of every node as attributes (`box-sizing`, `direction`, `position`, `width`, ...) plus `<expectations><node x y width height>` rounded values, and `use-rounding` (false in only 8 flex cases). This is a ready-made Chrome oracle and a ready-made Taffy input, which is useful for checking the runner before Dragon's own capture exists.
- Text nodes use Ahem X glyphs with `&#8203;` for min/max-content. The Taffy test measure function is `taffy_test_helpers::test_measure_function`.

### 3.5 RTL
Supported: CHANGELOG 0.10.0 says "`direction` property is now supported ... RTL layout of boxes in Block, Flexbox, and CSS Grid". `Style.direction: Direction::{Ltr,Rtl}` exists in 0.14. Gentest has RTL variants of every fixture.

## 4. Running Taffy from Node tests

### 4.1 Options
| Option | Toolchain for contributors | Per-call cost | Same code as the iOS xcframework | Status |
|---|---|---|---|---|
| **Rust CLI, JSON batch on stdin** | cargo on Linux CI; local macOS needs the Xcode licence or the zig workaround | 1.25 ms per spawn plus about 3 µs per layout (ran) | yes, same crate pin | **recommended for M1** |
| napi-rs addon | cargo plus @napi-rs/cli 3.10.5 | in-process | yes | extra build matrix; no gain for batch tests |
| WASM (own build) | cargo plus wasm target, or prebuilt | in-process after compile | yes | not measured: the rustup `rust-lld` fails with a missing libLLVM.dylib on this host |
| `taffy-layout@3.0.0` (npm, ByteLand, MIT) | none | n/a | **no**: third-party binding with unknown Taffy revision; `main` points at a `dist/index.js` that is absent from the tarball | reject |

Measured (ran, release build, macOS arm64, taffy 0.14.0 plus serde_json):
- Cold build including dependencies: about 7.4 s. Binary 1.26 MB.
- 1 fixture: 2 ms wall. 500 fixtures: 3 ms. 2,000 fixtures: 6 ms (one process).
- `execFileSync` from Node: 1.25 ms per call (mean of 50).
- Output check: root 400×300 with 10 px padding and children grow:1, grow:2 with "XXX", and width 33.3 with "X". Taffy rounded gave `[10,10,106,280] [116,10,241,280] [357,10,33,280]` (row stretch). Chrome at 1208 gave x/w of 105.5625, 115.5625/241.140625, 356.703125/33.296875 (auto height 10, since no height was set). Rounded x/w match.

WASM speed (estimate, not measured): Rust layout code compiled to wasm32 typically runs about 1.2–2× slower than native. At these sizes (µs per fixture) it does not matter. The choice is about distribution, not speed. testing-plan.md's "prebuilt WASM" default can wait until contributors need to run without a Rust toolchain.

### 4.2 Recommended runner contract
- `tools/taffy-runner/` Rust crate: `taffy = "=0.14.0"`, `serde`, `serde_json`. Commit `Cargo.lock` and `rust-toolchain.toml`.
- Input: a **Dragon-owned JSON schema**, not Taffy serde. Taffy 0.14's serde form of `Dimension` expects a u64 (ran: "invalid type: map, expected u64"). Each node has a tagged union for lengths (`{"px":n}|{"pct":n}|"auto"`), every Style field explicit, an `id` and optional `text`.
- Batch many fixtures per spawn. Output `{id, x, y, w, h}` both rounded and unrounded for each node, in preorder.
- Measure: the Ahem measure (width = chars × font-size, height = line-height; wrap at `&#8203;`/spaces like the Taffy helper). Keep it in Rust, and give it a TypeScript twin for unit tests.
- Node side: `runTaffy(batch)` builds the binary with `cargo build --release --locked` if it is missing or stale, then spawns it once per test file.

### 4.3 macOS-specific findings (the Linux lane itself has none)
- The Xcode licence is not accepted on this host. `/usr/bin/cc`, `/usr/bin/ld`, `/usr/bin/git` and `python3` all exit 69. Homebrew clang still calls `/usr/bin/ld`. **The workaround that worked:** a linker wrapper that runs `zig cc -target aarch64-macos` (after dropping `-arch arm64`, `-mmacosx-version-min=*` and `-nodefaultlibs`), set with `CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER`. Use `/opt/homebrew/bin/git` for git.
- Nothing in the Taffy+Chrome lane depends on macOS. On `ubuntu-latest`: install Rust stable, run `npx playwright install --with-deps chromium`, and embed Ahem as a data URI (no system fonts). Keep `--font-render-hinting=none` for text fixtures later.

## 5. Playwright and Chrome capture

Cached builds mapped to Playwright versions (read from `playwright-core@<v>/browsers.json` on unpkg):

| playwright | chromium rev | Chrome | cached here |
|---|---|---|---|
| 1.56.1 | 1194 | 141.0.7390.37 | full + headless shell |
| 1.57.0 | 1200 | 143.0.7499.4 | full + headless shell |
| **1.58.2** | **1208** | **145.0.7632.6** | full + headless shell (markless has 1.58.2 installed) |
| 1.59.1 | 1217 | 147.0.7727.15 | no |
| 1.60.0 | 1223 | 148.0.7778.96 | no |
| 1.61.1 | 1228 | 149.0.7827.55 | headless shell only |
| 1.62.1 | 1234 | 151.0.7922.34 | no (markless also uses it) |
| 1.63.0 (latest) | 1243 | 153.0.8010.12 | no |

Recommendation: pin `playwright` **1.58.2** exactly (Apache-2.0) for milestone 1. It runs offline here, and CI installs the same revision. Bumping it regenerates `expected/` in the same change (testing-plan.md). Use the `chromium` channel. Headless defaults to headless shell.

Capture API (ran, `/tmp/csst/cap.mjs`, 0.87 s total):
```js
const b = await chromium.launch({ args: ['--force-device-scale-factor=1','--force-color-profile=srgb',
  '--font-render-hinting=none','--disable-lcd-text','--hide-scrollbars'] });
const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(html);   // @font-face { font-family: Ahem; src: url(data:font/ttf;base64,...) }
await page.evaluate(async () => { await document.fonts.ready;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
const rows = await page.locator('[data-dragon-id]').evaluateAll(els => els.map(e => {
  const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  return { id: e.dataset.dragonId, x: r.x, y: r.y, w: r.width, h: r.height,
           padding: [s.paddingTop, ...], border: [...], display: s.display /* etc */ };
}));   // page.evaluate(() => devicePixelRatio) === 1 confirmed
```
- `b.version()` gives the Chrome version for the report's `run.chrome` field.
- Geometry is quantised to Chrome LayoutUnit (1/64 px): 105.5625 vs Taffy's 105.5667 (ran). **testing-plan.md's "within 0.01 px unrounded" is tighter than 1/64 = 0.015625 px.** Use rounded equality or ≤ 1 device px (decision 13). Do not use 0.01. Changing the tolerance is an owner decision, so report it rather than choosing one.
- Relative position: subtract the parent's border-box rect, then compare with Taffy `location`, which is relative to the parent border box. Gentest uses the containing block, which is the same for in-flow items.
- Loading Ahem: use a data URI from the vendored TTF (shown above), or `page.route` a file URL. A data URI avoids fetches and works on Linux.
- markless's reusable probe is `packages/analyzer/src/playwright.ts` `inventoryCandidates` (one `evaluateAll`, line ~361), as testing-plan.md notes.

## 6. Ahem font

- Source: WPT `fonts/Ahem.ttf` (21,768 bytes, downloaded today). Name table v1.50. Copyright record: "The Ahem font belongs to the public domain. In jurisdictions that do not recognize public domain ownership ... Creative Commons Zero declaration applies", and the licence URL is `http://dev.w3.org/CSS/fonts/ahem/COPYING`. **Licence verified from the font itself.** This closes testing-plan.md's "not verified". Vendor it as `vendor/fonts/Ahem.ttf` with a short `vendor/fonts/README.md` quoting the notice. The WPT repo itself is BSD-3.
- Metrics (parsed today): unitsPerEm 1000. hhea ascender 800, descender −200, lineGap 0. OS/2 sTypo 800/−200/0. usWin 800/200. USE_TYPO_METRICS bit off, but every table agrees. WPT docs: the alphabetic baseline is 0.2em above the bottom and ascent + descent = 1em.
- `line-height: normal` with Ahem: Blink and WebKit use hhea on macOS and OS/2 win or typo depending on platform and flag. Firefox uses typo or win. **All give 1.0em with Ahem** because the tables agree. Chrome gave height 10 px at 10 px (ran). The engine choice matters only for real fonts later.
- Taffy's gentest uses the Kozea/Ahem woff2 instead. It has the same design; its revision was not checked. Dragon should use the WPT TTF on both lanes.

## 7. Licences to settle

| Item | Licence | Action |
|---|---|---|
| Taffy crate and fixtures | MIT | Vendor the fixture subset with LICENSE |
| Blink `html.css` | **LGPL-2+** (header: Lars Knoll, Apple; "GNU Library General Public License") | Do **not** copy. Capture computed UA values from Chrome (decision 3) and commit the captured JSON as data |
| WPT Ahem.ttf | Public domain / CC0 | Vendor with notice |
| css-tree, @webref/css | MIT | Dependencies |
| Playwright | Apache-2.0 | devDependency |

## 8. Recommended milestone-1 layout (consistent with api.md 4.4 and section 10)

```
packages/dragon/                      # published 'dragon'; sync TS; deps: css-tree only
  src/index.ts                        # public compile/check, explain, querySupport
  src/css/grammar.generated.json      # generated from @webref/css, committed
  src/css/{parse,values,lexer}.ts     # css-tree parse and walk, var substitution, fork lexer
  src/tree/                           # dragon/tree@0 validation (subset from api.md 10)
  src/analysis/                       # internal: symbols, cascade, inheritance, UA defaults
  src/lower/layout-table.ts           # internal: resolved styles -> full layout style per node
  src/profiles/                       # support profiles (internal storage)
packages/parity/  (private)           # fixture driver, not published, not imported by dragon
  src/capture.ts                      # Playwright 1.58.2 capture -> expected/*.web.json
  src/taffy.ts                        # spawn tools/taffy-runner, batch JSON
  src/compare.ts, src/report.ts       # numeric compare + side-by-side HTML report
  fixtures/{box,flex}/*.html          # HTML + <style>, gentest-compatible
  expected/*.web.json                 # committed; regenerated only by explicit command
  test/*.test.ts                      # vitest: compile -> taffy -> compare
tools/taffy-runner/                   # Rust: Cargo.toml taffy=0.14.0, Cargo.lock, rust-toolchain.toml
vendor/taffy/{LICENSE,fixtures/...}   # filtered subset of test_fixtures + tests/xml
vendor/fonts/{Ahem.ttf,README.md}
scripts/gen-css-grammar.ts
```
The root `pnpm test` (vitest 4) runs both packages. Parity tests need the Taffy binary and Chromium. On Linux CI: `actions-rust-lang/setup-rust-toolchain` plus `npx playwright install --with-deps chromium`.

## 9. Risks for the first slice

1. **Taffy defaults are not web defaults** (display Flex, border-box, Relative). If an emitter falls back to them, a missing mapping looks like a pass on gentest fixtures, which set the same values in base CSS. Mitigation: emit every field; add fixtures without gentest base CSS (plain UA `div` block and content-box).
2. **Tolerance mismatch:** "0.01 px unrounded" (testing-plan.md) against Chrome's 1/64 px LayoutUnit. Needs an owner decision before a failing test tempts someone to loosen it.
3. **Block layout:** UA `div` is `display:block`. Taffy has block_layout, but margin collapsing and inline formatting (text in block) are partial. Keep milestone-1 text to Ahem in flex or single-line block contexts, and mark others unsupported.
4. **Text measurement parity:** the Ahem measure must model wrapping at spaces and ZWSP the way Chrome does. Start with single-line fixtures.
5. **Unpinned Taffy gentest Chrome:** its XML expectations come from an unknown Stable Chrome. Use them to smoke-test the runner only; Dragon's oracle is its own 1.58.2 capture.
6. **css-tree var():** must substitute before matching. A value that is invalid at computed time needs a diagnostic, not a default.
7. **Local toolchain:** the unaccepted Xcode licence blocks cargo linking, git (/usr/bin) and python3. Workers must use the zig linker wrapper and Homebrew git, or the owner must accept the licence.
8. **webref grammar drift:** pin the version; regenerate the grammar only by an explicit command, like `expected/`.

## 10. Commands run (all under /tmp except this note)
`npm view` (css-tree, @webref/css, @webref/idl, playwright*, @tsrx/yuku, taffy-layout, taffy-js, @napi-rs/cli); unpkg `playwright-core@<v>/browsers.json`; `cargo search/info taffy`; GitHub tarball of DioxusLabs/taffy main; cargo build of `/tmp/taffy-cli` (native OK via zig; wasm32-wasip1 failed on rust-lld/libLLVM); timing runs; `npm i css-tree@3.2.1 @webref/css@8.7.5 taffy-layout@3.0.0` in /tmp; Playwright 1.58.2 capture using markless's installed playwright-core; WPT Ahem.ttf download and table parse; chromium googlesource `html.css` header.
