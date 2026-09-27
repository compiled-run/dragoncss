# T022 First slice with Dragon's own layout engine

Judge, 2026-09-26, claude-code. Decision: approved. This replaces the engine parts of T002. Everything in T002 that doesn't depend on the engine is kept: the public compile/check API, the css-tree plus webref grammar, captured UA data, the live Playwright 1.58.2 capture, the 1 device pixel gate (decision 13), and exact profile rows only through passing fixtures.

## T023 (S1) constraints

- **Engine location:**
  - `packages/layout` (`@dragon/layout`) is private, has no dependencies and exports only `.`.
  - It is pure synchronous TS with no Node built-ins, I/O, clocks, randomness or globals, so it can be ported.
  - `packages/dragon` lists it only as a devDependency (`workspace:*`) and uses only `import type` from it (verbatimModuleSyntax), so importing `dragon` never loads the engine (api.md 4.4).
  - `packages/parity` is the only runtime importer.
- **Internal access:**
  - `packages/dragon` exports `'.': {'dragon-internal': './src/internal.ts', 'default': './src/index.ts'}`.
  - vitest `resolve.conditions` and the parity tsconfig `customConditions` select the internal entry.
  - There is no public `properties()` reader and no new subpath.
- **Fully specified input** (`packages/layout/src/input.ts`):
  - `LayoutInput = { viewport:{width,height}, root:LayoutBox }`.
  - `LayoutBox = { id, style:LayoutStyle, children: readonly (LayoutBox|TextLeaf)[] }`.
  - `TextLeaf = { id, text, font:{family:'Ahem', size}, lineHeight }`.
  - Every field is required and readonly, with no `?:`, no index signatures and no engine defaults.
  - Values are tagged per property and narrowed to what CSS allows:
    - width: `{kind:'px'|'percent'|'auto'}`;
    - padding: px or percent, no auto;
    - maxWidth: px, percent or `'none'`;
    - flexBasis: px, percent, `'auto'` or `'content'` (content reports Unsupported in S1).
  - Enums are string-literal unions:
    - display: `'block'|'flex'|'none'`;
    - boxSizing, flexDirection, flexWrap, justifyContent, alignItems, alignSelf, alignContent;
    - direction: `'ltr'`, with `'rtl'` Unsupported until S4;
    - position: `'static'` only;
    - overflow: `'visible'` only.
  - Initial and UA values are filled by the compiler from captured Chrome data and webref initial values, never by the engine.
- **Validator:** `validateLayoutInput(json)` rejects missing keys, extra keys and wrong tags with typed errors. Shared vectors and future native ports go through it.
- **Unsupported input:** the engine returns a typed `LayoutUnsupported {code, nodeId, specSection}`. It never falls back or guesses, and a fixture that hits it fails.
- **Arithmetic** (`packages/layout/src/units.ts` is the only file allowed Math rounding or fround):
  - LU is a branded integer holding Blink's LayoutUnit raw value (1/64 px) and saturates to int32 like Blink.
  - CSS px to LU follows Blink `LayoutUnit(float)`: `trunc(fround(fround(v)*64))`. A unit vector must show 33.3px becomes raw 2131, i.e. 33.296875 (T001 §4.1).
  - Percentages follow Blink `ValueForLength`/`MinimumValueForLength`.
  - Multiplication, division and flex free-space distribution each use one named rounding mode chosen to match Blink. Each call site cites the Blink function in one line, and unit tests pin each mode.
- **Output and gate:**
  - The engine outputs a preorder list of `{id, x, y, width, height}` in LU, relative to the parent border box.
  - Parity sums positions to absolute LU in integers, then converts once to px.
  - The gate is 1 device px on each absolute edge against `getBoundingClientRect` (decision 13). It is one constant, and fixtures may only name it as `'default'`.
  - Exact 1/64 match counts and unrounded deltas are informational.
- **Spec keying:**
  - Every algorithm function begins with a one-line comment naming its section: CSS2 §10.3.3, §10.4, §10.6.3, §10.7, css-sizing-3, css-flexbox-1 §9.2–§9.8 and §4.5.
  - `packages/layout/src/chrome-deviations.ts` lists each Chrome departure from the spec with its section, Blink behaviour and the fixture that proves it. A test asserts every deviation names a fixture that passed in this run.
- **S1 block scope:**
  - display block or none; width and height as px, percent or auto.
  - Percentage heights against an indefinite containing block behave as auto (§10.5).
  - Content-box and border-box; padding and border.
  - Percentage padding and margins resolve against the containing block width.
  - Min/max width and height (§10.4, §10.7).
  - Horizontal auto margins centre the box (§10.3.3), including over-constrained LTR.
  - Root margins never collapse. Margin collapsing is deferred to S2. Until then the engine returns `LayoutUnsupported('margin-collapse')` when:
    - two adjoining vertical margins are both non-zero;
    - any vertical margin is negative; or
    - a zero-height box with non-zero margins would collapse through.
  - Zero-margin adjoining cases lay out normally.
- **S1 flex scope** (css-flexbox-1 §9):
  - Row and column; nowrap and wrap.
  - flex-grow, flex-shrink, and flex-basis as px, percent or auto.
  - The §9.7 freeze loop with min/max violations.
  - Automatic minimum size (§4.5) for empty boxes, block children and single-line text.
  - row-gap and column-gap.
  - justify-content: flex-start, flex-end, center, space-between, space-around, space-evenly.
  - align-items and align-self: stretch, flex-start, flex-end, center.
  - align-content: normal, stretch, flex-start, center, space-between.
  - §9.9 intrinsic container sizes for single-line nowrap only.
  - Baseline alignment, auto margins on flex items, `order` and wrap-reverse return LayoutUnsupported in S1.
- **Text:**
  - A `TextMeasurer` interface is injected into the engine.
  - The Ahem implementation is pure: every code point advances 1em, a zero-width space advances 0, and `line-height: normal` is 1em. Number and px line-heights are supported.
  - S1 handles single lines only. If the available inline size is below max-content and the text has a break opportunity, the engine returns `LayoutUnsupported('multi-line-text')`. Unbreakable text overflows on one line, which is correct behaviour.
- **Shared vectors:** `pnpm run layout:vectors` writes `packages/layout/vectors/<fixture>.json` (`{input, output}`) for each passing fixture. They are committed and regenerated only by that script. A test checks that engine output equals the vectors exactly and that the vectors pass the validator.
- **Grammar:** `scripts/gen-css-grammar.ts` reads @webref/css 8.7.5 and writes `packages/dragon/src/css/grammar.generated.ts`. The core forks css-tree 3.2.1 over it synchronously. Verify range checks such as padding ≥ 0 for each milestone property.
- **UA and initial values:**
  - `scripts/capture-ua-defaults.ts` captures Chrome computed values for html, body, div and an unstyled element, for every property in the subset, and writes `packages/dragon/src/ua/chrome-145.generated.ts`.
  - html and body are real nodes, with no `body{margin:0}` unless the fixture authors it.
  - The layout viewport is the fixture's viewport.
- **Capture:**
  - playwright 1.58.2 exact, with the T001 §5 flags, DPR 1, and Ahem as a data URI from `vendor/fonts/Ahem.ttf` (WPT v1.50, CC0 notice in README).
  - It asserts `browser.version()` is 145.0.7632.6.
  - It runs live in `pnpm test`, where a missing Chromium fails the run, never skips.
  - The capture must equal the committed `packages/parity/expected/*.web.json` exactly.
  - Nodes join by `data-dragon-id`, and an unmatched node fails the fixture.
- **Fixtures** (about 14, none with gentest base CSS):
  - block-ua-divs, block-content-box-padding-border, block-border-box, block-percent-width-padding, block-min-max, block-auto-margin-center;
  - flex-row-grow-shrink-basis, flex-min-max-freeze, flex-column, flex-wrap-gap-align-content, flex-justify-content, flex-align-items-stretch-center;
  - text-ahem-single-line: text in a block and as a flex item, with a number line-height;
  - one rejection fixture (e.g. `display:grid` or `float:left`). It expects a typed `DRAGON_*` diagnostic with a span and a blocked ios output, with no layout run.
- **Planted faults** (each asserted to fail for the right reason):
  1. `packages/parity/test/planted/drop-field.ts` builds a LayoutStyle without boxSizing under `// @ts-expect-error`, inside `tsc -b`.
  2. An internal fault switch on the ios lowering swaps content-box and border-box. With it on, `block-content-box-padding-border` must fail the gate.
  3. A vector with a missing field must be rejected by the validator.
- **Profiles:** entries default to unsupported. A row is exact only if it names fixture ids that passed in this run, with aspect `layout` on lane `linux-dragon-layout`. Nothing is exact for colour or paint.
- **Determinism and scope:**
  - No timestamps or absolute paths in outputs; reports go to gitignored `packages/parity/out/`.
  - No screenshot gating, and the dual authored-vs-compiled check is S2.
  - Use `/opt/homebrew/bin/git`, with no pushes and no remotes.
  - The Worker writes `notes/T023-slice-1.md` with the commands run, pass counts, exact-LU match counts and any LayoutUnsupported codes hit.

## Open evidence

- Blink's rounding modes for flex free-space distribution and percentage resolution aren't measured yet. T023 pins each one with a Chrome vector.
- Packaging of `@dragon/layout` types needs a plan before any publish. It isn't needed in milestone 1.

## Revised sequence

- **S2:**
  - Product: web emitter and the dual Chrome check (authored vs compiled), colours by channel, seeded state-collapse and colour-only faults.
  - Engine: full CSS2 §8.3.1 margin collapsing, flex auto margins, the remaining align-content values, §9.9 for wrap and column, and percentage heights against definite sizes.
  - About 35 fixtures.
- **S3:**
  - Product: tree@0 finite states and the api.md §10 conformance cases, the diagnostics catalogue and negative type tests.
  - Engine: multi-line Ahem inline formatting (breaks, text-align, line-height, white-space normal), inherited text styles on text nodes, loose text wrapped, and text min-content inside flex.
- **S4:**
  - Corpus reaches 100 or more.
  - Engine: rtl, position relative and absolute (CSS2 §10.3.7/§10.6.4, flex abspos §4.1), `order`, wrap-reverse, baseline alignment, and overflow hidden with its effect on min-size.
  - Optionally re-capture Taffy gentest HTML inputs (MIT notice) as Chrome-oracle fixtures only.
- **S5:** full report and summary, profile checker, Linux CI workflow (not pushed), determinism, browser-worker import checks for the core and `@dragon/layout`, and the documented vector format. Then T999.
