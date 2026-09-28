# Dragon CSS: post-milestone-2 coverage roadmap

Judge planning note, 2026-09-28. Read-only; no repo file was changed. Everything here is reproducible from /tmp/roadmap:
- `classify2.py`: extends /tmp/wpt-scout/classify.py (same web m1-s5 feature set, same kind rules). It adds blockers for **reftests (test file plus every match/mismatch ref file)**, splits at-rules and pseudo-classes, and detects `!important`, custom-property declarations and the `font` shorthand. Output: `blockers.tsv` (38,054 rows; the 2 runnable numeric tests match the scout exactly).
- `packages.py`: maps every raw blocker (2,016 distinct) to one work package. `tail.txt` lists what maps to no package.
- `final.py`: impact greedy (formula below). `recommended.py`: cumulative counts in the recommended order.

Caveats. The classifier is regex-based and context-free, so it overestimates. Counts are test **files**, not subtests. "Unblocked" means every feature in the file is covered by the packages so far; it is not a pass. Reftests additionally need a paint lane (milestone-2 P6 or a Chrome-rendered Dragon lane) before any can count. 4 numeric and 1,165 reftests stay blocked after every package: they need shadow DOM parts (`::part`, `::slotted`, `:host`), Houdini `layout()`, `border-shape`, invalid-property tests and similar (`tail.txt`).

Inputs: /tmp/wpt-scout/REPORT.md and tests-all.tsv; docs/research/T015-css-range.md (usage); T011-styling.md; packages/dragon/src/profiles (web m1-s5: 56 longhands, 1,179 rows); diagnostics/catalogue.ts; packages/layout/src; docs/goals/milestone-2 (P4 = T014 in flight); docs/decisions.md including the 2026-09-28 course corrections (coverage runs in waves alongside milestone 2; engine and API packages merge after P4; the text-strategy spike decides before P5 device-lines; tiered gates; the Markless music-player north star).

## 0. Where Dragon is today

Supported (all targets web-proven, native rows pending P5/P6): `display` block/flex/none; `position` static/relative/absolute; the box model with px and %; per-side borders (solid, dashed, dotted, double); flexbox fully; `overflow` hidden/visible; `direction`; Ahem text only (`font-size` px, `line-height`, `text-align`, `white-space` nowrap/normal); colours. Refused: every other property, every at-rule, nesting, `!important`, selectors beyond type/class/descendant/child/`[ui-*]`, every element except html, body and div, and non-Ahem fonts.

Result: **2 of 1,138** numeric WPT files and **23 of 25,145** reftests have no blocker.

## 1. Work packages

Route codes (per platform; web is always the compiled CSS that Chrome renders):
- **C**: compiler only (build-time fold in TypeScript);
- **E**: engine (packages/layout, translated to Swift and Kotlin);
- **N**: native property (UIKit layer or View property);
- **D**: Dragon-owned paint or shader in generated Swift/Kotlin;
- **T**: text-engine hook (TextKit 1 / StaticLayout line hooks, per the pending text-strategy decision);
- **R**: runtime helper emitted with the output (condition bits, scroll listeners, animation tables);
- **I**: WPT importer tooling (packages/wpt only).

Proof codes: **PF** parity fixtures (Chrome boxes, chrome-dual computed values, engine vectors); **WN** WPT numeric; **WR** WPT reftests; **PL** paint lanes (P6 sample points); **DL** device lanes (P5); **RJ** reject fixtures for refused sub-cases.

Lane codes for parallel safety: **imp** (packages/wpt), **css** (compiler front: css/*), **cas** (cascade and computed values: analysis/*), **ua** (UA dataset and element table), **eng** (layout engine; sub-lanes named by file), **txt** (text path), **pnt** (native program and emitters), **rt** (runtime helpers). Two packages may run at the same time only if their write sets are disjoint outside the generated files (section 4).

Numbers: **blocks** = files that name this package among their blockers; **alone** = files unblocked by this package with nothing else added; cumulative counts are in section 2. Usage is the T015 headline share of Chrome page loads (Chrome Platform Status 2026-09-24) unless marked SoCSS (State of CSS 2025 "used it") or Almanac (2022).

| id | package | numeric blocks / alone | reftest blocks / alone | usage (T015) | route | proof | size, risk | depends on | lane |
|---|---|---|---|---|---|---|---|---|---|
| IMP2 | Importer breadth: XHTML/SVG test files (XML parse), support stylesheets inlined, `reftest-wait`, `onload=` checkLayout, `@import`/`@namespace` | 335 / 2 | 11,954 / 1 | n/a (multiplier) | I | translator unit tests; expectations file | M, low | importer v1 (scout §5) | imp |
| IMP3 | Script-driven tests: run the original file in Chrome 145, snapshot DOM and styles at each `checkLayout` call, translate each snapshot; tests whose script mutates styles between checks become multi-state fixtures or stay not-runnable | 465 / 1 | 4,170 / 10 | n/a | I | snapshot must reproduce Chrome's WPT result before Dragon is compared | L, med-high (must never change a test's meaning) | IMP2 | imp |
| BG1 | `background` shorthand, colour-only, with correct reset of the other longhands to initial | 745 / 4 | 9,861 / 13 | background-color 89% | C | PF (chrome-dual), WN | S, low | E2 seam | css |
| UNIT | Units. **a:** in/cm/mm/pt/pc/Q, em/ex/ch/lh over a px font chain, keyword and % font sizes (fold). **b:** rem (Dynamic Type, decision 5) and vw/vh/vmin/vmax/dv*/sv*/lv* (runtime environment) | 105 / 0 | 7,328 / 0 | px 71% of lengths; viewport units 49.6% SoCSS; rem on north star (78 uses) | a: C. b: E value kind + R environment | PF, WN; largest-text-size test for rem | a: S-M, low. b: M, med | a: E2. b: V, P4 | a: css+cas. b: eng |
| CASC | Custom properties and `var()` (per state assignment), CSS-wide keywords, `all`, `!important`, `@layer`, `@property`; nesting | 21 / 0 | 589 / 0 | custom props 71.1%; @layer 7.1%; @property 18.7% | C (+R when a variable depends on runtime conditions) | PF chrome-dual; RJ for cycles and invalid-at-computed-time | M, med | E2 | cas |
| CALC | `calc()`, `min()`, `max()`, `clamp()`; constants fold, % and mixed units go to the engine as a typed expression | 83 / 0 | 468 / 0 | min/max/clamp 69.8% SoCSS; calc in width 27% | C + E | PF, engine vectors, WN | M-L, med (Chrome rounding in LayoutUnit) | UNIT; part of V | eng (value model) |
| SELS | Static selectors: `*`, attribute, `+`/`~`, `:nth-*`, `:first/last/only-*`, `:root`, `:not/:is/:where/:has`, `:empty`, `:lang`, `:dir` resolved at build on the closed tree | 250 / 1 | 9,207 / 0 | :not 84.1%; ~ 64.3%; :has 54.4%; :where 36.7% | C | PF chrome-dual; RJ for open-ended matches | M, med | E2; **owner ruling** (section 6) | css+cas |
| SELD | State pseudo-classes: `:hover`, `:focus`, `:active`, `:focus-visible`, `:checked`, `:disabled`, `:target` | 4 / 0 | 149 / 0 | :hover 91% (Almanac); :focus 80.9%; :focus-visible 58.3% | C + R (gesture/focus to state bits) | PF with CDP forcePseudoState; DL with simulated input | M, med | P4 emitters | cas+rt |
| GEN | `::before`/`::after` as build-time child nodes, `content`, `::marker`, `list-style`, counters, quotes, `li/ol/ul` | 96 / 0 | 1,599 / 7 | content 80.4%; ::before 41% (Almanac) | C (+T for markers) | PF, WN, WR | M-L, med | INL1; TXT1 for marker glyphs | css+cas |
| ELB | Block-level and unknown elements with Chrome UA defaults: p, h1-h6, section, main, nav, header, footer, article, aside, blockquote, pre, hr, figure, dl; custom tags | 288 / 0 | 16,626 / 52 | universal | C (UA capture per tag) | PF (ua-default fixtures), WN | M, low-med (headings need `font-weight` bold: Ahem synthetic bold must be measured) | E2 | ua |
| INL1 | Inline formatting 1: `<br>`, phrasing elements (span, strong, em, a, code, b, i, small, sub, sup, label), `display: inline`, inline box margins/borders/padding, mixed fonts per line | 461 / 1 | 11,756 / 0 | inline runs ~90% of pages | E + T (attributed runs) + D (inline box backgrounds and borders) | PF, vectors, WN, DL device-lines | XL, high | P4, P5 line-break reference | eng/inline + txt |
| INL2 | Atomic inlines: `inline-block`, `inline-flex`, `vertical-align`, baseline of atomic boxes | 255 / 0 | 2,959 / 0 | inline-block 90% (Almanac); vertical-align 81.3% | E + T (placeholder runs sized by the engine) | PF, WN, DL | L-XL, high | INL1 | eng/inline |
| REPL | Replaced elements: img, canvas, video, iframe; `object-fit`, `object-position` | 100 / 2 | 3,115 / 4 | universal (img) | E (intrinsic size and ratio) + N (UIImageView/ImageView content modes) + D (object-position) | PF, WN, WR, PL | M-L, med | INL2; asset pipeline | eng + pnt |
| SIZE | Intrinsic keywords (`min-content`, `max-content`, `fit-content()`, `stretch`, `-webkit-fill-available`), `aspect-ratio`, `contain`, `contain-intrinsic-size`, `content-visibility`, `zoom` | 153 / 6 | 2,030 / 1 | aspect-ratio 38.0%; intrinsic sizing 75.4% SoCSS | E (+C for zoom) | PF, vectors, WN | M-L, med | V | eng/intrinsic |
| BLKX | `display: flow-root`, `display: contents`, `margin-trim` | 42 / 0 | 454 / 0 | display: contents 12.9% | E (flow-root, margin-trim) + C (contents flattening) | PF, WN | S-M, low | P4 | eng/block + cas |
| ALGN | Box alignment breadth: `justify-self`/`justify-items` in block and abspos, `place-*`, `safe`/`unsafe`, `first`/`last baseline`, `align-content` in blocks | 341 / 0 | 463 / 0 | no T015 number | E | PF, vectors, WN (css-align) | M, med | V | eng/block+position+flex |
| LOGI | Logical properties in horizontal writing mode (`inline-size`, `margin-inline-*`, `inset-block-*`, `border-inline-*` ...), sharing the physical property's cascade slot | 125 / 1 | 575 / 0 | margin-inline-start 31.2%; logical props 48.4% SoCSS | C | PF chrome-dual, WN | S-M, low | E2 | css+cas |
| WM | Vertical writing modes: `writing-mode`, `text-orientation`, `text-combine-upright`, orthogonal flows | 384 / 0 | 2,054 / 1 | writing modes 16.3% SoCSS | E (every algorithm in logical axes) + T (vertical text; Android has no vertical text engine, so Dragon lays rotated runs) | PF, WN, WR, DL | XL, very high | LOGI, INL1, TXT1 | eng (cross-cutting) |
| FLT | `float`, `clear`, `shape-outside` | 143 / 0 | 2,297 / 1 | float 72.2%; clear 59% (mostly legacy) | E (float placement, clearance, line shortening) + T (per-line available width) | PF, WN, WR | XL, high | INL1, text strategy | eng/block+inline |
| POSX | `position: fixed` (viewport containing block) and `sticky` | 13 / 0 | 471 / 0 | sticky 29.8% | E + N (fixed: attach to screen root) + R (sticky: scroll listener applies the engine's sticky offset, T015 Q2) | PF, WN, DL with scripted scroll | M-L, med | OVFL | eng/position + rt |
| ANCH | Anchor positioning: `anchor-name`, `position-anchor`, `anchor()`, `anchor-size()`, `position-area`, `position-try`, `position-visibility`, `anchor-scope` | 56 / 0 | 227 / 0 | anchor-name 6.3%; headless UI depends on it | E (+R for scroll-adjust) | PF, WN (css-anchor-position, needs test-common.js in IMP) | XL, high | OVFL, POSX, ALGN (owner: sequence with grid) | eng/anchor (new file) |
| OVFL | `overflow` auto/scroll/clip, scrollable-overflow sizes, scrollbar gutter, scroll snap, overscroll | 70 / 0 | 820 / 1 | overflow 86.5%; overflow-y 69%; scroll-snap 19% | E (scrollable overflow, gutters) + N (UIScrollView/ScrollView sized by the engine) | PF, WN (`scroll*` assertions), DL | L, high (Chrome classic 15 px scrollbars against native overlay scrollbars need a platform rule) | P4 | eng/box + pnt |
| GRID | CSS grid: templates, areas, placement, auto-flow, `inline-grid`, subgrid, gaps | 467 / 1 | 2,309 / 22 | grid 45.7%; grid-template-columns 48.2% | E (new grid.ts) + C (template parsing) | PF, vectors, WN (css-grid has 476 numeric files) | XL, high | V, SIZE, ALGN | eng/grid (new file) |
| MSNY | Grid lanes (masonry) | 36 / 0 | 1,093 / 0 | none | E | WN, WR | L-XL, high (spec moving) | GRID | eng/grid |
| TBL | Tables: table elements, `display: table-*`, `border-collapse`, `border-spacing`, `table-layout`, `caption-side` | 78 / 1 | 2,226 / 2 | T015 tier "never" | E (+C anonymous table objects) + D (collapsed borders) | PF, WN, WR | XL, high | INL1 | eng/table (new file) |
| MCOL | Multi-column and fragmentation: `columns`, `column-*`, `break-*`, `widows`, `orphans` | 47 / 0 | 2,341 / 0 | T015 tier "never" | E (fragmentation) + D (column rules) | PF, WN, WR | XL, very high | INL1, BLKX | eng (cross-cutting) |
| TXT1 | Real-font text: system and bundled fonts, `font-weight`/`style`/`variant`, `font` shorthand, `@font-face` | 428 / 2 | 21,046 / 47 | font-size 89.4%; font-family 88%; @font-face 71.7% | T (per the text-strategy spike) + E (font-data measurer generalised from P4) + C (font matching, bundling) | PF, DL device-lines, WN, WR | XL, very high | text-strategy decision, P4, P5 | txt |
| TXT2 | Text properties: `white-space` pre/pre-wrap/break-spaces, `word-break`, `overflow-wrap`, `hyphens`, letter/word-spacing, `text-transform`, `text-indent`, justify, `text-overflow`, `line-clamp`, bidi | 27 / 0 | 2,947 / 13 | white-space 81.2%; text-transform 72%; letter-spacing 68%; text-overflow 65.5%; line-clamp 44.2% | T + E (+C for static text-transform) | PF, DL, WN, WR | L, high | TXT1 | txt |
| PNT1 | Box decorations: `border-radius`, `outline`, `box-shadow`, `opacity`, `visibility`, `z-index`, groove/ridge/inset/outset | 142 / 0 | 2,665 / 1 | opacity 86.7%; z-index 86.2%; radius 85.6%; box-shadow 81.8% | N (cornerRadius, shadowPath, alpha, zPosition; Android Outline, elevation-free drawing) + D (elliptical per-corner radii, spread, inset and multiple shadows) | PF, PL, WR | L, med | P4 program, P6 paint lanes | pnt |
| PNT2 | Transforms 2D and 3D, `transform-origin`, individual transforms, perspective | 17 / 0 | 983 / 34 | transform 84% | N (CATransform3D; View matrix) + E (transformed scrollable overflow) | PF, PL, WR | M, med | P6 | pnt |
| BG2 | Background images and gradients, background longhands (size, position, repeat, clip, origin), multiple layers, `border-image` | 7 / 0 | 2,257 / 252 | gradients 68.8% | N (CAGradientLayer; Android shaders) + D (repeating and conic gradients, tiling, border-image) | PF, PL, WR (css-backgrounds) | L, med-high (colour interpolation, dithering) | P6, REPL (image assets), BG1 | pnt |
| FX | `filter`, `backdrop-filter`, `mix-blend-mode`, `isolation`, `clip-path`, masks | 0 / 0 | 853 / 46 | filter 53.1%; clip-path 46%; backdrop-filter 35.9% (66.4% SoCSS); blend 13.6% | D/shader (iOS has no public live CALayer filters), N where exact (clip-path via shape masks; Android RenderEffect API 31+) | PL, WR | XL, very high | P6, PNT1 | pnt |
| TDEC | `text-decoration*`, `text-underline-*`, `text-shadow`, `text-emphasis` | 1 / 0 | 926 / 0 | text-decoration 83%; text-shadow 45.9% | T (run attributes) + D (exact thickness, offset, wavy, blur) | PL, WR | M, med | INL1, P6 | txt + pnt |
| ANIM | Transitions, `@keyframes`, animations, view transitions | 6 / 0 | 720 / 3 | transition 79.7%; @keyframes 81.2%; animation 68.9% | R (generated CAAnimation/Animator tables) + C (keyframe compile) | frame-sampled PF with a paused clock; DL | L, high | SELD, PNT1, PNT2; decision 17 | rt |
| MQ | `@media`, `@supports` (per target at build), `env(safe-area-*)` | 1 / 0 | 468 / 0 | @media 83.9%; @supports 53.0%; env() 10.6% | C (@supports) + R (condition bits: width, colour scheme, reduced motion, pointer) + E (env() as an environment value) | PF per environment, DL | M, med | P4 emitters, V | cas + rt |
| CQ | Container size queries, `cq*` units | 1 / 0 | 80 / 1 | @container 24.9% | E (second layout pass under containment) + R | PF, WR | L, high | MQ, SIZE | eng + rt |
| FORM | Form controls (input, button, select, textarea, fieldset/legend, details), `appearance`, `::placeholder` | 63 / 0 | 1,309 / 4 | north star: button, range input | N (native controls) + D (`appearance: none` path first) | PF, PL | XL, very high | REPL, INL2, TXT1 | pnt |
| SVG | Inline SVG content and SVG paint properties | 20 / 0 | 888 / 10 | fill 65% | D (vector renderer) + E (SVG sizing as replaced) | PL, WR | XL, high | REPL | pnt |
| RUBY | Ruby | 4 / 0 | 311 / 0 | none | E + T | WR | L, high | INL1, TXT1 | txt |
| GAPD | Gap decorations (`row-rule`, `column-rule` outside multicol) | 0 / 0 | 418 / 0 | none | D | PL, WR | M, med | GRID, MCOL | pnt |
| MATH | MathML | 0 / 0 | 10 / 0 | none | - | - | defer | - | - |
| PAGE | `@page`, margin boxes, `size` | 0 / 0 | 288 / 0 | print only | - | - | never (native has no pages) | - | - |

Enablers that unlock nothing alone but make the rest parallel and countable:
- **E1, WPT importer v1** (scout REPORT.md §5): manifest, translator, check-layout assertions, per-target expectations over all 38,054 files. Every count above is only a claim once E1 runs it.
- **E2, compiler seams** (section 3): a behaviour-preserving split of the compiler front so that compiler packages have disjoint write sets.
- **V, engine value model:** one engine package that lands the new value kinds everybody else consumes: a calc expression tree (CALC), runtime-environment units (UNIT-b: rem scale, viewport, env()) and intrinsic keywords as values (the value half of SIZE). Landing it once, first, stops every engine package from editing `input.ts`, `units.ts`, `validate.ts` and `lower/ios-layout.ts` in parallel.

## 2. Order by impact

**Formula (impact greedy, `final.py`):** at each step pick the package, together with any unmet dependencies, that maximises
(new numeric files unblocked) + (new reftests unblocked) / 10 + (T015 usage %) / 2, averaged over the packages in the bundle.
Usage is weighted so that a 90%-usage feature counts like 45 numeric files: numeric WPT alone gives almost nothing early, because 795 of the 1,138 numeric files have 6 or more blockers.

The pure numeric greedy (no usage, no dependencies) runs: SIZE 8, BG1 12, TXT1 22, REPL 34, FLT 45, SVG 55, INL2 64, ELB 74, IMP3 89, IMP2 141, GRID 237, INL1 273, WM 307, ALGN 401, SELS 557 ... It front-loads packages that free a handful of files each, so it is shown only for reference.

**Recommended order** (impact order adjusted for gates and parallelism: compiler packages that can run now come first, and paint packages wait for P6). Cumulative counts are measured in this exact order:

| # | pkg | numeric: blocks / alone / cumulative (all CSS) | cumulative (7 first-import dirs) | reftests: blocks / alone / cumulative |
|---:|---|---|---:|---|
| 1 | IMP2 | 335 / 2 / **4** | 4 | 11954 / 1 / **24** |
| 2 | BG1 | 745 / 4 / **8** | 8 | 9861 / 13 / **43** |
| 3 | UNIT | 105 / 0 / **8** | 8 | 7328 / 0 / **47** |
| 4 | CASC | 21 / 0 / **8** | 8 | 589 / 0 / **49** |
| 5 | SELS | 250 / 1 / **11** | 11 | 9207 / 0 / **51** |
| 6 | LOGI | 125 / 1 / **12** | 12 | 575 / 0 / **51** |
| 7 | ELB | 288 / 0 / **13** | 13 | 16626 / 52 / **110** |
| 8 | IMP3 | 465 / 1 / **55** | 20 | 4170 / 10 / **154** |
| 9 | INL1 | 461 / 1 / **57** | 21 | 11756 / 0 / **258** |
| 10 | SIZE | 153 / 6 / **65** | 29 | 2030 / 1 / **273** |
| 11 | ALGN | 341 / 0 / **65** | 29 | 463 / 0 / **273** |
| 12 | TXT1 | 428 / 2 / **97** | 51 | 21046 / 47 / **3815** |
| 13 | INL2 | 255 / 0 / **109** | 63 | 2959 / 0 / **4288** |
| 14 | CALC | 83 / 0 / **115** | 63 | 468 / 0 / **4343** |
| 15 | GRID | 467 / 1 / **281** | 66 | 2309 / 22 / **4653** |
| 16 | PNT1 | 142 / 0 / **306** | 85 | 2665 / 1 / **5133** |
| 17 | PNT2 | 17 / 0 / **306** | 85 | 983 / 34 / **5485** |
| 18 | BG2 | 7 / 0 / **307** | 85 | 2257 / 252 / **6278** |
| 19 | MQ | 1 / 0 / **307** | 85 | 468 / 0 / **6564** |
| 20 | SELD | 4 / 0 / **307** | 85 | 149 / 0 / **6609** |
| 21 | OVFL | 70 / 0 / **349** | 97 | 820 / 1 / **6855** |
| 22 | POSX | 13 / 0 / **350** | 97 | 471 / 0 / **7008** |
| 23 | REPL | 100 / 2 / **399** | 125 | 3115 / 4 / **8364** |
| 24 | GEN | 96 / 0 / **403** | 128 | 1599 / 7 / **9397** |
| 25 | TXT2 | 27 / 0 / **416** | 133 | 2947 / 13 / **11450** |
| 26 | TDEC | 1 / 0 / **417** | 133 | 926 / 0 / **11866** |
| 27 | ANIM | 6 / 0 / **423** | 133 | 720 / 3 / **12334** |
| 28 | FLT | 143 / 0 / **501** | 184 | 2297 / 1 / **13749** |
| 29 | BLKX | 42 / 0 / **540** | 221 | 454 / 0 / **14040** |
| 30 | WM | 384 / 0 / **873** | 383 | 2054 / 1 / **15376** |
| 31 | ANCH | 56 / 0 / **920** | 430 | 227 / 0 / **15552** |
| 32 | CQ | 1 / 0 / **921** | 430 | 80 / 1 / **15614** |
| 33 | FX | 0 / 0 / **921** | 430 | 853 / 46 / **16275** |
| 34 | TBL | 78 / 1 / **987** | 452 | 2226 / 2 / **18274** |
| 35 | MCOL | 47 / 0 / **1017** | 463 | 2341 / 0 / **19898** |
| 36 | FORM | 63 / 0 / **1076** | 497 | 1309 / 4 / **21167** |
| 37 | SVG | 20 / 0 / **1094** | 514 | 888 / 10 / **22024** |
| 38 | MSNY | 36 / 0 / **1130** | 514 | 1093 / 0 / **22999** |
| 39 | GAPD | 0 / 0 / **1130** | 514 | 418 / 0 / **23416** |
| 40 | RUBY | 4 / 0 / **1134** | 514 | 311 / 0 / **23707** |
| 41 | MATH | 0 / 0 / **1134** | 514 | 10 / 0 / **23717** |
| 42 | PAGE | 0 / 0 / **1134** | 514 | 288 / 0 / **23980** |

Reading the table:
- Numeric WPT stays in single digits until **INL1 + TXT1 + IMP3**. The first big numeric jumps are **IMP3** (+42, script-built grid/flex tests), **GRID** (+166), **FLT** (+78) and **WM** (+333, the largest single step, mostly css-writing-modes and css-align). WM is the one package that ranks higher on WPT than on usage; move it earlier only if the owner wants the WPT number first.
- Reftests are gated by **TXT1**: +3,542 when it lands (text without Ahem is in 20,770 reftests). ELB (`<p>`: 15,748) and IMP2 (XHTML: 10,221) are its multipliers.
- The first 11 packages are cheap and high-usage (BG1, UNIT, CASC, SELS, LOGI, ELB are compiler-only) but move WPT little. They are chosen for real-world use and the north star, and because they can run now, in parallel with P4-P6.

**North star (music-player demo, decisions.md course correction 4):** its CSS needs CASC (30 `var()`), UNIT-a/b (78 `rem`, `vw`, `vh`), CALC (`min`, `clamp`, `calc`), BG1/BG2 (20 `background`, linear/radial/repeating-radial gradients), PNT1 (radius, box-shadow, opacity, z-index, outline), PNT2 (rotate, translate, scale), ANIM (transition, animation, `@keyframes`, play-state), MQ (2 `@media`), SELD/SELS (`:hover`, `:focus`, `:root`), POSX (2 `position: fixed`), OVFL (`overflow: auto`, scrollbar styling), SIZE (`aspect-ratio`), REPL (`img`, `object-fit`), ELB (p, h1-h4, nav), INL1/INL2 (span, a, `inline-flex`, `inline-block`), FORM (button, range input, `-webkit-appearance`, slider thumbs), TXT1/TXT2/TDEC (font shorthand and weight, letter-spacing, overflow-wrap, white-space, text-decoration-color, text-underline-offset), and no-op or hit-testing properties (`cursor`, `pointer-events`, `will-change`). It needs no grid, floats, tables, multicol, writing modes, anchors or filters. Everything it needs except FORM is in place by step 27 of the recommended order. Its buttons and range input need FORM (step 36), so pull a small **FORM-a** forward to follow REPL: `<button>` and `<input type=range>` with `appearance: none`, drawn by Dragon.

<details><summary>Impact-greedy order (formula above, dependency bundles)</summary>

| step | pkg | cum numeric | cum reftests |
|---:|---|---:|---:|
| 1 | BG2 | 2 | 275 |
| 2 | TXT1 | 4 | 395 |
| 3 | ELB | 4 | 534 |
| 4 | BG1 | 14 | 655 |
| 5 | PNT2 | 14 | 914 |
| 6 | INL1 | 17 | 1108 |
| 7 | INL2 | 19 | 1198 |
| 8 | REPL | 29 | 1332 |
| 9 | SVG | 34 | 1762 |
| 10 | IMP2 | 40 | 2575 |
| 11 | IMP3 | 96 | 3041 |
| 12 | SELS | 101 | 4010 |
| 13 | UNIT | 104 | 6275 |
| 14 | TXT2 | 113 | 7825 |
| 15 | FLT | 146 | 8806 |
| 16 | TBL | 164 | 10062 |
| 17 | PNT1 | 179 | 11123 |
| 18 | GEN | 189 | 12239 |
| 19 | SIZE | 249 | 13017 |
| 20 | ALGN | 265 | 13052 |
| 21 | GRID | 432 | 13660 |
| 22 | LOGI | 450 | 13758 |
| 23 | WM | 770 | 15052 |
| 24 | MCOL | 791 | 16417 |
| 25 | FORM | 842 | 17523 |
| 26 | OVFL | 899 | 18033 |
| 27 | CALC | 966 | 18367 |
| 28 | MSNY | 1002 | 19275 |
| 29 | TDEC | 1003 | 19833 |
| 30 | FX | 1003 | 20487 |
| 31 | CASC | 1016 | 20892 |
| 32 | BLKX | 1056 | 21296 |
| 33 | SELD | 1058 | 21384 |
| 34 | ANIM | 1064 | 22001 |
| 35 | MQ | 1065 | 22308 |
| 36 | ANCH | 1116 | 22462 |
| 37 | POSX | 1129 | 22922 |
| 38 | GAPD | 1129 | 23339 |
| 39 | RUBY | 1133 | 23630 |
| 40 | PAGE | 1133 | 23893 |
| 41 | CQ | 1134 | 23970 |
| 42 | MATH | 1134 | 23980 |


</details>

## 3. First wave plan (the first 10 packages)

### The shared-file problem, and the enabler that fixes it
Today every compiler feature edits the same few files:
- `packages/dragon/src/css/stylesheet.ts`: parsing, at-rule refusal, selector parsing, `!important`, shorthand expansion, value tokens and feature keys;
- `packages/dragon/src/css/properties.ts`: `LONGHANDS`, `SHORTHANDS`, `PROPERTY_ASPECTS`, roles;
- `packages/dragon/src/analysis/resolve.ts`: `SUPPORTED_TAGS`, selector matching, `beats` (cascade order), value computation;
- `packages/parity/src/fixtures.ts`: the one `FIXTURES` list.

And every feature regenerates shared outputs (section 4). So the first compiler package is a seam split.

**E2, compiler seams (behaviour-preserving).**
- Split `css/stylesheet.ts` into a parse driver plus `css/selectors.ts`, `css/at-rules.ts` (a handler registry; everything still refused), `css/shorthands/index.ts` (a registry, with one file per existing family: `box.ts`, `border.ts`, `flex.ts`, `overflow.ts`, `text.ts`) and `css/values.ts` with a unit registry `css/units.ts`.
- Turn `css/properties.ts` into an aggregate of `css/properties/<family>.ts` lists; the aggregate order stays byte-identical.
- Split `analysis/resolve.ts` into `analysis/elements.ts` (the tag table), `analysis/match.ts` (selector matching), `analysis/cascade.ts` (`beats`, origin and order, plus an empty cascade-group hook for logical properties) and `analysis/computed.ts` (value computation, plus an empty substitution hook for `var()`). `resolve.ts` re-exports them.
- `packages/parity/src/fixtures.ts`: `FIXTURES` becomes the concatenation of `packages/parity/src/fixture-groups/<group>.ts`, with milestone 1 first and in the same order.
- Guards: `pnpm test` (the same test names), and profiles, captures, vectors, emitted CSS bodies and report.json byte-identical.
- Size M, low risk. Touches no P4 file.

### Wave plan

| wave | package | write scope (new files unless marked) | may run alongside | merge point |
|---|---|---|---|---|
| 0 | **E1** WPT importer v1 + **IMP2** breadth | `packages/wpt/**`; root `package.json` (scripts only); `pnpm-workspace.yaml` / root tsconfig references | everything | after P4 is accepted (one script-hunk conflict with P4's `package.json`) |
| 0 | **E2** compiler seams | `packages/dragon/src/css/**`, `packages/dragon/src/analysis/resolve.ts` (split) plus new `analysis/{elements,match,cascade,computed}.ts`, `packages/parity/src/fixtures.ts` plus `packages/parity/src/fixture-groups/**`, `packages/dragon/test/seams.test.ts` | E1, P4 | right after P4 is accepted (outputs byte-identical) |
| 1 | **BG1** background colour-only | `css/shorthands/background.ts`, `css/properties/background.ts` (shorthand entry), `fixture-groups/background.ts`, `packages/parity/fixtures/background-*.html` | every wave-1 package | after E2 |
| 1 | **UNIT-a** absolute and font-relative units | `css/units.ts` (entries), `analysis/computed/units.ts`, `fixture-groups/units.ts`, `fixtures/units-*.html` | every wave-1 package | after E2 |
| 1 | **CASC** var(), CSS-wide keywords, `!important`, `@layer`, `@property`, nesting | `css/at-rules/layer.ts`, `css/at-rules/property.ts`, `css/nesting.ts`, `css/important.ts`, `analysis/cascade.ts` (owner of this file in wave 1), `analysis/computed/vars.ts`, `fixture-groups/cascade.ts`, fixtures; one-line catalogue entries (IMPORTANT, AT_RULE, NESTED_RULE) | BG1, UNIT-a, SELS, ELB; LOGI through the hook only | after E2 |
| 1 | **SELS** static selectors | `css/selectors.ts` (owner), `analysis/match.ts` (owner), `fixture-groups/selectors.ts`, fixtures; catalogue entry UNSUPPORTED_SELECTOR | all wave 1 | after E2 **and the owner ruling** |
| 1 | **LOGI** logical properties (horizontal) | `css/properties/logical.ts`, `css/shorthands/logical.ts`, `analysis/logical.ts` (filled into E2's cascade-group hook; must not edit `cascade.ts`), `fixture-groups/logical.ts`, fixtures | all wave 1 | after E2 |
| 1 | **ELB** block and unknown elements | `analysis/elements.ts` (owner), `scripts/capture-ua-defaults.ts`, `packages/dragon/src/ua/datasets.ts`, regenerated `ua/chrome-145.darwin-arm64.generated.ts`, `fixture-groups/elements.ts`, fixtures; catalogue entry UNSUPPORTED_ELEMENT | all wave 1 | after P4 (the element message text is in `project.ts`, a P4 file); last in wave 1, because it regenerates the UA dataset |
| 1 (imp) | **IMP3** script-driven tests | `packages/wpt/src/snapshot/**`, `packages/wpt/test/snapshot*` | everything except E1 in flight | after E1 |
| 2 | **V** engine value model (CALC + UNIT-b + intrinsic keyword values) | `packages/layout/src/{input,units,validate}.ts`, new `packages/layout/src/calc.ts`, `packages/dragon/src/lower/ios-layout.ts`, `packages/translate/src/**` only if the subset needs recursive unions, `css/units.ts` (runtime units), `fixture-groups/calc.ts`, fixtures, `packages/layout/test/calc*.test.ts` | wave-1 stragglers, IMP3, P5 if P5 is not editing the engine | after P4; before any other engine package |
| 2 | **INL1** inline formatting 1 | `packages/layout/src/{inline,text,block}.ts`, new `packages/layout/src/inline-box.ts`, `input.ts` (additive: an inline-box child kind), `lower/ios-layout.ts`, `lower/native-program.ts` (text runs), `emit/{uikit,android-views,native-support}.ts` (attributed runs), `analysis/elements.ts` (phrasing tags; after ELB), fixtures | SIZE, ALGN, GRID (all later); not V, not TXT1 | after V **and** after P5's line-break engine export (P5 may add line start/end to inline.ts); first engine feature package |

Then, as soon as V lands, these run in parallel with INL1, on disjoint engine files:
- **SIZE** in `intrinsic.ts` and `flex.ts`;
- **ALGN** in `position.ts` plus a new `align.ts` (`block.ts` edits limited to call sites);
- **GRID** in a new `grid.ts`, with a one-line dispatch in `layout.ts`.

After them: **TXT1**, which needs the text-strategy decision and the P5 device-lines lane. **PNT1, PNT2 and BG2** run in parallel after P6 and after a P4 follow-up that splits `emit/uikit.ts` and `emit/android-views.ts` into per-technique writer modules (`emit/paint/<feature>.ts`); without that split, every paint package collides on the same two emitters and `native-program.ts`.

### Merge order around P4, P5 and P6
1. **P4 (T014) lands first.** Its verification pins profiles, `report.json`, vectors and emitted files byte-identical to 4c1331c, so no coverage package merges to master before P4 is accepted.
   - Wave-0 and wave-1 branches start now from 4c1331c. None writes `packages/layout/src/text.ts`, `inline.ts`, `packages/dragon/src/types.ts`, `project.ts`, `internal.ts`, `support.ts`, `index.ts`, `lower/native-program.ts`, `emit/*` or `packages/layout/generated/**`.
   - This follows course correction 1: compiler-only packages run in parallel; engine and API packages merge after P4.
2. **After P4 is accepted**, merge in this order:
   - E1, then E2 (no output change);
   - then BG1, UNIT-a, LOGI, CASC and SELS (smallest generated diff first);
   - then ELB, which regenerates the UA dataset and edits the element message in `project.ts`.

   Each rebase re-runs the generators (section 4); it never hand-merges generated files.
3. **P5 starts from that master**, so its device lanes run the new fixtures too. `layoutCases()` derives from `FIXTURES`, which gives native proof for wave-1 features without extra work. If the PM wants P5 bounded to the 261 milestone-1 cases, wave-1 merges instead wait until P5 is accepted. This is a PM call; either way, native rows for new features stay unsupported until their device cases pass.
4. **Engine packages** (V, then INL1, SIZE, ALGN and GRID) merge after P4, and INL1 also after P5's line-break export.
   - The translator subset check blocks any engine change the translator cannot translate (decision), so translator extensions land inside V first.
   - After each engine merge, the integrator runs `native:gen`, `layout:vectors` and `layout:dpr-vectors`, and `native:swift` and `native:kotlin`.
5. **Paint packages merge after P6**, which provides the sample-points protocol and paint lanes. Before P6, a paint feature can reach web `exact` through chrome-dual computed values, but iOS and Android rows stay unsupported.

## 4. Parallel-safety rules for all packages

**Generated and shared outputs are never hand-merged.** The integrator merges code in the order above, then regenerates:
- `packages/dragon/src/profiles/*.ts` (profile:rows). A strict gate: the diff must equal the union of the packages' declared new rows.
- `packages/parity/expected/**` and `expected-dpr/**` (parity:capture): only the new fixtures' files may appear.
- `packages/parity/emitted/**`: bodies are strict. Headers are relaxed: the compilation digest hashes the configured profiles, so every profile change rewrites every header (course correction 3).
- `packages/layout/vectors/**`: new files only.
- `packages/layout/generated/**` (native:gen).
- `ua/*.generated.ts` (ua:capture; ELB owns it in wave 1).
- `packages/wpt/expectations/*.json` (wpt:update-expectations; new fail entries need a human reason).

**Single-owner hotspot files** (at most one package in flight edits each):
- `analysis/cascade.ts` (CASC), `analysis/match.ts` and `css/selectors.ts` (SELS), `analysis/elements.ts` (ELB, then INL1);
- `packages/layout/src/input.ts`, `validate.ts`, `units.ts` and `lower/ios-layout.ts` (V first; afterwards additive edits only, merged one at a time);
- `inline.ts` and `text.ts` (P4, then P5, then INL1, then TXT1: strictly serial);
- `block.ts` (INL1 owns it while in flight; ALGN, FLT and BLKX edits wait);
- `native-program.ts`, `emit/uikit.ts` and `emit/android-views.ts` (P4 until the emitter split; then one writer module per paint package);
- `packages/translate/**` (one package at a time);
- `diagnostics/catalogue.ts` (one entry per line; distinct entries merge cleanly).

**Lane compatibility at a glance:**
- imp runs with everything.
- css/cas packages run together after E2, given one owner per hotspot file.
- The ua lane is ELB only.
- eng packages run together only on different algorithm files after V: grid.ts, intrinsic.ts, position.ts/align.ts, and later table.ts, anchor.ts and multicol.ts. inline.ts and block.ts are serial.
- txt is serial (INL1, then TXT1, then TXT2/TDEC/RUBY).
- pnt packages run together only after the emitter split.
- Cross-cutting engine packages (WM, MCOL, FLT) run alone in the engine lane.

## 5. Size, risk and route summary per lane

- **Compiler only (C), can start now:** BG1 (S), UNIT-a (S-M), LOGI (S-M), CASC (M), SELS (M), ELB (M).
- **Importer (I):** E1 (M-L), IMP2 (M), IMP3 (L).
- **Engine (E, translated):** V (M-L), SIZE (M-L), ALGN (M), BLKX (S-M), INL1 (XL), INL2 (L-XL), GRID (XL), OVFL (L), POSX (M-L), FLT (XL), WM (XL), ANCH (XL), TBL (XL), MCOL (XL), CQ (L), MSNY (L-XL).
- **Text hook (T):** TXT1 (XL, needs the spike), TXT2 (L), TDEC (M), RUBY (L).
- **Native property plus Dragon paint (N/D):** PNT1 (L), PNT2 (M), BG2 (L), REPL (M-L), FX (XL; shaders on iOS), FORM (XL), SVG (XL), GAPD (M).
- **Runtime helpers (R):** SELD (M), MQ (M), ANIM (L).

## 6. Owner and PM rulings needed before the named packages start

1. **SELS:** decisions.md (Direction, bullet 2) says a native selector "may test only its own element, parents in the same component, and app-wide conditions". Structural, sibling and attribute selectors on a closed, statically known tree resolve at build time (T015 rows 22-23, "static only"). The owner must rule that such selectors are allowed when the compiler proves the match statically, and that anything depending on runtime list structure stays a build error.
2. **UNIT-b:** rem scales with the device text size (decision 5), so rem is not a build-time fold on native. Confirm that WPT and Chrome proof run at scale 1 and the device lanes add a largest-text-size run.
3. **OVFL:** Chrome 145 on macOS in the capture environment against native overlay scrollbars. Decide whether the scrollbar gutter is a platform rule or a named Chrome deviation before any `scroll*` assertion counts.
4. **IMP3 and E1:** a tolerant HTML/XML parser dependency for `packages/wpt` (scout §4 flagged this as a PM or owner call), and running WPT scripts in Chrome to snapshot the DOM. This is test tooling only; nothing runs on device.
5. **P5 scope:** whether P5's device lanes include fixtures that land after P4 (recommended), or stay pinned to the 261 milestone-1 cases.
6. **Headings in ELB:** h1-h6 have UA `font-weight: bold`. Chrome's synthetic bold on Ahem must be measured; if it changes advances, headings move to TXT1.
