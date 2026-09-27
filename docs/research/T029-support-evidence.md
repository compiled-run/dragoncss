# T029: CSS support evidence across web, iOS, Android and email

Scout note, read-only research. Every web source was accessed on 2026-09-26. **(unverified)** marks a claim from memory or a search summary that was not confirmed on a primary page during this task. Where T015 already cites a source, this note cites T015 rather than repeating it.

Scope: what a Markless author can write in `<style>` and get the same result on web, real UIKit views (iOS, first), Android Views (next) and email (static HTML). This is the evidence for the support matrix; it does not change the design in T018/T025.

## 1. Short answer

**Native layout is the strong part.** If the layout engine is Taffy, flex, grid (without subgrid and masonry), block flow with margin collapsing, relative and absolute positioning, `box-sizing`, `aspect-ratio`, `calc()` and the intrinsic sizing keywords all run the CSS algorithms themselves. Same CSS, same boxes on iOS and Android, with named caveats. Yoga covers flex well but has no grid (style types only, no algorithm), no block flow, no `calc()` and needs four defaults flipped.

**Paint is where "supported" stops meaning "identical".** Colours, radius, borders, shadows, gradients and opacity all exist on both native platforms, but each is a re-implementation: shadows need a blur conversion (iOS 0.5x, Android 0.866x for text/`setShadowLayer`), dashed borders have no defined dash length on the web, gradients interpolate differently unless the build pre-samples them, and iOS has **no public filters or blend modes on views** (`CALayer.filters`, `backgroundFilters` and `compositingFilter` are all "not supported on layers in iOS").

**Text never matches pixel for pixel.** Different system fonts (SF Pro, Roboto, whatever the browser picks for `system-ui`), different line-height models, different line breakers. Font size, weight, colour, alignment, decoration, transform, truncation and line clamp map cleanly; the resulting wrap points and heights do not.

**Email is a different, much smaller target.** Outlook for Windows (classic, Word engine) supports no flex, grid, `border-radius`, `box-shadow`, gradients, `rem`, `calc()`, custom properties or `@media`. Gmail supports no custom properties, `box-shadow`, `transform`, `transition`, `flex-direction`/`justify-content`/`align-items` or most pseudo-classes. Email needs its own profile: inline styles, resolved variables, table layout.

### The four lists (app targets: web, iOS, Android)

**Exact everywhere** (same computed boxes or same visual result; email status in the tables):
`display: flex | block | flow-root | grid | none`, all flex container and item properties except `order`, `gap`, grid templates, named lines and areas, `repeat(auto-fill|auto-fit)`, `minmax()`, `fr`, `fit-content()`, `grid-auto-flow: dense`, grid and flex alignment including `safe`, `position: relative | absolute` with `inset`, `margin`/`padding` (all sides, percentages, `auto` margins), margin collapsing (Taffy only), `width`/`height`/`min-*`/`max-*` with `px`/`%`, `min-content`/`max-content`/`fit-content`/`stretch` on `width`/`height`/`flex-basis`, `aspect-ratio`, `box-sizing`, `direction: rtl` for layout, solid colours (build-converted), `opacity`, `visibility`, `overflow: hidden | clip`, 2D transforms, `transform-origin`, transition and keyframe timing curves, `px`/`%`/`em`/`rem`/`vw`/`vh`, constant `calc()`/`min()`/`max()`/`clamp()`, constant custom properties.

**Exact with a caveat** (state the caveat in docs and the diagnostic):
`border-radius` (iOS elliptical radii need a path; `cornerCurve` is a native-only extra), uniform solid borders, per-side solid borders (need shape layers on iOS/custom drawing on Android), `box-shadow` outset (blur conversion, spread via path, clipping needs a wrapper), `linear-gradient`/`radial-gradient` (interpolation space; pre-sample at build), `text-overflow: ellipsis`, `-webkit-line-clamp`, `text-transform`, `text-decoration` (style and colour are per-platform), `letter-spacing`, `font-weight` numeric, `@font-face` (bundled at build), `position: sticky` (engine lays it out as static; the scroll adapter applies the offset), `overflow: auto | scroll` (becomes a native scroll view: native physics), `z-index` (paint order within siblings; stacking contexts are simplified), `transition` on paint properties, `@keyframes` on compositor properties, `prefers-color-scheme`, `prefers-reduced-motion`, width media queries, `light-dark()`, `oklch()`/`color-mix()` with constant inputs (folded at build), `env(safe-area-inset-*)`, `line-height` (different model, see section 6), `text-align` including `justify` (Android API 26+).

**Per-platform approximation** (looks similar, is not the same algorithm):
`backdrop-filter: blur()` (iOS snaps to `UIBlurEffect` materials; Android only from 37.2), `box-shadow: inset` (masked inner layer on iOS; Android 10+ precedent), multiple shadows, `outline` and focus rings, `border-style: dashed | dotted | double`, conic gradients, `text-shadow` (one shadow per run), `hyphens`, `text-wrap: balance | pretty`, `word-break`/`overflow-wrap`, layout-affecting transitions, `position: fixed` (reparent to screen root), 3D transforms on Android, scroll snap, `overscroll-behavior`, `font-family: system-ui`, container size queries (second layout pass), inline runs with box styling (padding/radius on `<span>` in text).

**Web-only** (compile to a documented no-op or a build error on native):
`filter` other than `opacity()`/`drop-shadow()` on iOS (Android 12+ can do them), `mix-blend-mode`/`background-blend-mode` on iOS, `clip-path` beyond basic shapes, `mask`, `order`, `subgrid`, masonry/`grid-lanes`, `display: table*`, `display: inline | inline-block` inside text (partly: see T015 Q1), `float` with text wrap, `columns`, `writing-mode` vertical, `shape-outside`, anchor positioning (placement record only), view transitions (later), `cursor`, `user-select`, `-webkit-tap-highlight-color`, `will-change`, `contain`, `content-visibility`, scrollbar styling, `@container style()`, `:has()` beyond the T025 rule.

## 2. Legend

App class column (web + iOS + Android):

- **EXACT**: same result from the same CSS. The native path runs the CSS algorithm (Taffy) or a lossless mapping.
- **CAVEAT**: same model with one stated difference.
- **APPROX**: per-platform approximation; similar look, different algorithm or limits.
- **WEB-ONLY**: no native meaning; documented no-op or build error.
- **NO**: not implementable on native views without an own renderer.

Email column: caniemail latest result per client, in the order **Gmail web / Gmail iOS / Apple Mail iOS / Outlook Windows classic / Outlook.com / Yahoo**, then the count of all tested client-platform pairs as `y/a/n` (yes/partial/no). Letters: `y` yes, `a` partial, `n` no, `u` unknown, `-` not tested. Source: [caniemail data.json](https://www.caniemail.com/api/data.json), `last_update_date` 2026-09-16; per-feature test dates range 2019 to 2026, so old `n` results may be stale.

## 3. Layout engines: what each one implements

### 3.1 Taffy (preferred)

Sources: [README](https://github.com/DioxusLabs/taffy/blob/main/README.md), [CHANGELOG](https://github.com/DioxusLabs/taffy/blob/main/CHANGELOG.md), [`src/style/mod.rs`](https://github.com/DioxusLabs/taffy/blob/main/src/style/mod.rs), [`src/style/grid.rs`](https://github.com/DioxusLabs/taffy/blob/main/src/style/grid.rs), [`src/style/alignment.rs`](https://github.com/DioxusLabs/taffy/blob/main/src/style/alignment.rs), [`Cargo.toml`](https://github.com/DioxusLabs/taffy/blob/main/Cargo.toml), GitHub issues via API. Latest release v0.14.0, 2026-08-24.

| Feature | Taffy status | Evidence |
|---|---|---|
| Algorithms | Block, Flexbox, CSS Grid. No inline/text layout ("neither yoga nor taffy implement" text layout); text comes in through a measure function. | README |
| `display` | `Block`, `FlowRoot` (0.13), `Flex`, `Grid`, `None`. **No `contents`, `inline*`, `table*`.** Default is `Flex` when the flexbox feature is on, so the compiler must set `Block` explicitly for web parity. | `style/mod.rs:222-251` |
| Tables | Not implemented; issue [#1094](https://github.com/DioxusLabs/taffy/pull/1094) open. `item_is_table` exists only as a sizing hint. | issues API, `style/mod.rs:688` |
| `box-sizing` | Both values. **Default `BorderBox`** (web default is `content-box`): the compiler must emit `ContentBox` unless CSS says otherwise. | `style/mod.rs:417-423,851` |
| `position` | Released 0.14: `Relative`, `Absolute`. **Main branch (unreleased):** `Static` (new default), `Relative`, `Absolute`, `Fixed` (containing block = root), `Sticky` (laid out as static; "applying the sticky offset is the responsibility of the caller"). Out-of-flow boxes are hoisted to their real containing block, as in CSS. | CHANGELOG "Unreleased"; `style/mod.rs:318-348` |
| `inset`, margins, padding, border widths | Yes, including percentages, `auto` margins, negative margins. Percentage padding/border resolve against the containing block width (fixed 0.14 and unreleased). | CHANGELOG 0.14, Unreleased |
| Margin collapsing | Yes in block layout, including collapse-through and clearance. | CHANGELOG 0.12-0.14 |
| Floats and `clear` | Yes (`float_layout`, default feature) for boxes. No text wrap around floats (no inline layout). | CHANGELOG 0.10 |
| Sizing keywords | `width`/`height`/`flex-basis`: `min-content`, `max-content`, `fit-content`, `fit-content()`, `stretch`; `flex-basis: content`. **`min-*`/`max-*` do not support the keywords yet.** | CHANGELOG 0.14 |
| `aspect-ratio` | Yes, including transfer through min/max and stretched sizes. | CHANGELOG 0.12-0.14 |
| `calc()` | Yes (`calc` feature): the host resolves calc through a callback with the percentage basis. | CHANGELOG 0.8.0 |
| Flexbox | All container/item properties: direction, wrap, `wrap-reverse`, grow/shrink/basis, `gap`, justify/align content/items/self, auto margins, baseline. Also Flexbox Level 2 `flex-wrap: balance` and `flex-line-count`. Defaults match CSS (`flex-shrink: 1`, `row`). | `style/mod.rs:779-805,889-899`; CHANGELOG 0.14 |
| `order` | **Not implemented**; PR [#1198](https://github.com/DioxusLabs/taffy/pull/1198) open. The adapter could reorder children before layout, but focus/accessibility order would then diverge from visual order exactly as on the web. | issues API |
| Grid templates | `grid-template-rows/columns`, `grid-auto-rows/columns`, `repeat()` with `auto-fill`/`auto-fit`, `minmax()`, `fr`, `fit-content()`, percentage tracks. | `style/grid.rs:150,750-835,1537-1546` |
| Grid names | Named lines and `grid-template-areas` (0.9.0), unnamed `.` cells beyond named areas (0.13). | CHANGELOG 0.9.0, 0.13 |
| Grid placement | Line numbers, spans, names; `grid-auto-flow: row | column | dense`. | `style/grid.rs:308-386` |
| Grid alignment | `justify-items/self`, `align-items/self`, `justify/align-content`, `safe` variants (0.11), `self-start/end` (0.13), first baseline. `last baseline` not implemented ([#1111](https://github.com/DioxusLabs/taffy/pull/1111) open). | `alignment.rs`; issues API |
| Subgrid | **Not implemented** ([#468](https://github.com/DioxusLabs/taffy/issues/468), [#985](https://github.com/DioxusLabs/taffy/pull/985) open). | issues API |
| Masonry / `grid-lanes` | **Not implemented** ([#910](https://github.com/DioxusLabs/taffy/issues/910) open). | issues API |
| `overflow` | `visible`, `clip`, `hidden`, `scroll` per axis, plus `scrollbar_width`. **No `auto`**: the compiler maps `auto` to `scroll` for layout and lets the native scroll view hide indicators. Scrollable overflow is reported (`scrollable_overflow_rect`). | `style/mod.rs:446-471`; CHANGELOG 0.14 |
| `contain` | `layout`, `paint`, `content` layout effects; not `size`. | CHANGELOG 0.14 |
| `direction` | `ltr`/`rtl` for block, flex, grid. | CHANGELOG 0.10 |
| Rounding | `round_layout` rounds in absolute coordinates (fixed on main). | CHANGELOG Unreleased |
| Test basis | Test fixtures are generated from Chrome's layout (gentest) **(unverified this pass)**. | - |

**Consequence:** with Taffy, the layout rows below are EXACT for the in-scope features, provided the compiler emits web defaults (`display: block` for block elements, `box-sizing: content-box`, `position: static`) and ships a Taffy build that includes the unreleased position work, or pins main.

### 3.2 Yoga (fallback)

Sources: [styling docs index](https://github.com/facebook/yoga/blob/main/website/docs/styling/index.md), [`YGEnums.h`](https://github.com/facebook/yoga/blob/main/yoga/YGEnums.h), [`YGConfig.h`](https://github.com/facebook/yoga/blob/main/yoga/YGConfig.h), [`style/Style.h`](https://github.com/facebook/yoga/blob/main/yoga/style/Style.h), commit history via GitHub API. Last tagged release v3.2.1, 2024-12-13; React Native builds from main.

| Difference from the web | Evidence | Fix |
|---|---|---|
| `flex-direction` default `column`, `align-content` default `flex-start`, `flex-shrink` default `0`, `position` default `relative` | docs "Default styles" items 1-4 | `UseWebDefaults` flips the first three. It does **not** change `position` ("to preserve compatibility"); set `static` explicitly. |
| Min size: `min-width/height: auto` treated as 0 | errata bit `YGErrataMinSizeUndefinedInsteadOfAuto = 8` | Spec auto-min-size landed on main 2026-06-03 (commit [4a59d09](https://github.com/facebook/yoga/commit/4a59d0940)), opt-in by clearing the bit; not in a tagged release. |
| Other errata | `StretchFlexBasis`, `AbsolutePositionWithoutInsetsExcludesPadding`, `AbsolutePercentAgainstInnerSize`, `FlexFirstPassUsesRunningTotals` | Use `YGErrataNone` for conformance. |
| Box sizing | Enum has `BorderBox` and `ContentBox`; docs say Yoga "acts as if" border-box | Set explicitly. |
| `display` | `flex`, `none`, `contents`, `grid` enum value only | **No block flow**: block becomes a flex column, so no margin collapsing, no floats. |
| Grid | "CSS Grid 1/9: Grid style types and public API" (2026-03-05) plus track types `Auto/Points/Percent/Fr/Minmax`; no grid algorithm file in `yoga/algorithm/` | **Treat grid as unsupported on Yoga.** |
| Units | Points, percent, auto, max-content, fit-content, stretch. No `calc()`, no `min-content`. "Other units should be absolutized before being given to Yoga." | Fold at build; runtime percent-plus-length calc is impossible. |
| `aspect-ratio` | "added before the same property was added to CSS, and may act subtly different" | Caveat. |
| `position` | `static`, `relative`, `absolute`; no `fixed`, `sticky` | Adapter work, as with Taffy. |
| `overflow` | `visible`, `hidden`, `scroll` | Same as Taffy. |
| Pixel rounding | `pointScaleFactor` rounds to the device pixel grid | Similar to Taffy rounding. |

**Consequence:** on Yoga the "Layout" rows marked EXACT drop to CAVEAT (block as flex column, no margin collapse), and every grid row becomes NO. That is the price named in T015 ("Grid is should-have only with Taffy").

## 4. Property tables

Native mapping details for most paint and text properties are in T015's 47-row table; this section adds the value level, the class, and email.

### 4.1 Layout

Native column = Taffy on iOS and Android (same engine, same numbers). The Yoga column notes where the fallback differs.

| Property / value | Web | Native (Taffy) | Yoga fallback | Email: Gm/GmiOS/ApiOS/OlWin/Ol.com/Y (all) | App class |
|---|---|---|---|---|---|
| `display: flex` | yes | yes | yes | y/a/y/n/y/y (32/2/7); Gmail: "not supported with non Google accounts", no `inline-flex` | EXACT |
| `display: inline-flex` | yes | lowers to flex; inline placement only as T015 Q1 row heuristic | same | not supported in Gmail | CAVEAT |
| `display: grid` | yes | yes (no subgrid/masonry) | NO | y/a/y/n/y/y (32/2/7) | EXACT |
| `display: block` | yes | yes, margin collapsing | flex column | (`display` 25/16/0) | EXACT (Yoga: CAVEAT) |
| `display: flow-root` | yes | yes | flex column | - | EXACT |
| `display: inline`, `inline-block` in text | yes | no inline layout; attributed runs without box styling (T015 Q1) | same | yes (HTML default) | APPROX |
| `display: inline-block` without text siblings | yes | wrapping flex row heuristic (T015 Q1) | same | yes | APPROX |
| `display: contents` | yes | not in Taffy; flatten at build (T015 #3) | native `contents` | - | CAVEAT |
| `display: none` | yes | yes | yes | y/y/y/a/y/y (38/2/1) | EXACT |
| `display: table*` | yes | not implemented (#1094) | no | tables are the email layout primitive | WEB-ONLY |
| `flex-direction`, `flex-wrap`, `wrap-reverse` | yes | yes | yes (set web defaults) | n/n/y/n/y/n (23/0/18) | EXACT |
| `flex-grow`, `flex-shrink`, `flex-basis` (length, %, auto) | yes | yes | yes (`flex-shrink` default 0) | not tested separately | EXACT |
| `flex-basis: content`, `min-content`, `max-content`, `fit-content` | yes | yes (0.14) | max-content and fit-content only | - | EXACT (Yoga: CAVEAT) |
| `flex-wrap: balance`, `flex-line-count` | experimental, not shipped in browsers **(unverified)** | yes | no | - | WEB-ONLY until browsers ship |
| `justify-content`, `align-items`, `align-self`, `align-content` incl. `space-evenly`, `safe`, `baseline` | yes | yes (first baseline; no `last baseline`) | yes except safe; baseline depends on measured text | n/n/y/n/y/n (24/0/17) | EXACT (baseline: CAVEAT, native font metrics) |
| `gap`, `row-gap`, `column-gap` | yes | yes, flex and grid | yes (`YGGutter`) | a/a/y/n/a/n (15/8/13): Gmail supports `column-gap` for flex only | EXACT |
| `order` | yes | not implemented (#1198) | no | - | WEB-ONLY (or reorder at build, visual only) |
| `margin: auto` in flex/grid | yes | yes | yes | Outlook: `auto` not supported | EXACT |
| `grid-template-columns/rows` with px, %, `fr`, `auto`, `minmax()`, `fit-content()` | yes | yes | NO | n/n/y/n/n/n (15/0/21) | EXACT |
| `repeat(n, …)`, `repeat(auto-fill|auto-fit, …)` | yes | yes | NO | as above | EXACT |
| Named lines `[name]`, `grid-template-areas`, `grid-area: name` | yes | yes (0.9.0) | NO | as above | EXACT |
| `grid-auto-rows/columns`, `grid-auto-flow: row | column | dense` | yes | yes | NO | - | EXACT |
| `grid-row/column` with numbers, spans, negative lines | yes | yes | NO | - | EXACT |
| `justify-items`, `justify-self`, `place-*` | yes | yes | NO | - | EXACT |
| `subgrid` | yes (Chrome 117+, Safari 16+, Firefox 71+) **(unverified versions)** | not implemented (#468, #985) | NO | - | WEB-ONLY |
| Masonry / `display: grid-lanes` | Safari TP / Chrome experimental **(unverified)** | not implemented (#910) | NO | - | WEB-ONLY |
| `float`, `clear` (boxes) | yes | yes (boxes only) | no | y/a/y/n/y/a (29/10/2) | CAVEAT (no text wrap) |
| Margin collapsing | yes | yes | no | yes (browser engine), Outlook Word differs **(unverified)** | EXACT (Yoga: NO) |
| `position: static`, `relative` | yes | yes (static on main only) | yes | position: n/n/a/n/a/a (12/21/8) | EXACT |
| `position: absolute` + `inset`, `top/right/bottom/left` | yes | yes, hoisted to real containing block | yes; containing block = parent, errata for padding | inset n/n/y/n/n/n; top/left n/n/y/n/y/n | EXACT (Yoga: CAVEAT) |
| `position: fixed` | yes | main: root containing block; adapter reparents to the screen root, above scroll views | no | Gmail no; others buggy | CAVEAT (native: relative to screen root, not to a transformed ancestor) |
| `position: sticky` | yes | laid out as static; scroll adapter applies the offset (T015 Q2) | no | no in most clients | CAVEAT |
| `z-index` | stacking contexts | paint order among siblings (`subviews` order / `zPosition`, Android `translationZ` or draw order); no cross-subtree stacking contexts | same | n/n/y/n/y/y (34/0/7) | CAVEAT |
| `overflow: hidden | clip` | yes | `clipsToBounds` / `clipChildren`; Taffy `Hidden`/`Clip` | same | overflow a/a/a/n/a/a (11/28/2) | EXACT (clip radius: see 4.2) |
| `overflow: auto | scroll` | scroll container | native scroll view sized from `scrollable_overflow_rect`; `auto` is not a Taffy value, lowers to scroll | same | "cannot scroll through to hidden content" in some clients | CAVEAT (native physics) |
| `overscroll-behavior`, `scroll-snap-*`, `scroll-behavior` | yes | `bounces`, target-offset snap, animated offset (T015 Q3) | same | scroll-snap n/n/y/n/n/n | APPROX |
| `width`/`height` px, % | yes | yes | yes | y/y/y/a/y/y | EXACT |
| `width`/`height`: `min-content`, `max-content`, `fit-content`, `stretch` | yes | yes (0.14) | max-content, fit-content, stretch | intrinsic-size y/a/y/n/y/n | EXACT |
| `min-*`/`max-*` px, % | yes | yes | yes | y/y/y/n/y/y | EXACT |
| `min-*`/`max-*`: intrinsic keywords | yes | **not yet** ("do not yet support these keywords") | no | - | CAVEAT (build error until Taffy adds it) |
| `min-width: auto` (flex item automatic minimum) | yes | yes | only on main with errata cleared | - | EXACT (Yoga: CAVEAT) |
| `aspect-ratio` | yes | yes | "may act subtly different" | n/n/y/n/n/n (17/0/24) | EXACT (Yoga: CAVEAT) |
| `box-sizing` | yes, default content-box | yes, **default border-box: compiler must set content-box** | same | y/y/y/n/y/n (29/0/12) | EXACT |
| Logical properties (`margin-inline-start` etc.), `direction` | yes | map to physical at build per `direction`; Taffy `direction` | Yoga start/end edges | margin-inline n/n/n/n/n/n (21/0/20); direction y everywhere | EXACT |
| `writing-mode: vertical-*` | yes | no | no | y/a/y/n/y/n | WEB-ONLY |
| `columns`, `column-count` | yes | no | no | y/y/y/n/y/n | WEB-ONLY |
| `contain`, `content-visibility`, `will-change` | yes | layout part of `contain` only | no | - | WEB-ONLY (no-op) |
| Anchor positioning (`anchor-name`, `position-area`) | yes | placement record for the overlay adapter (T011/report) | same | - | APPROX (overlay only) |

Layout rendering differences even when EXACT:

- **Subpixel rounding.** Browsers lay out in fractional units and snap at paint (Chromium uses 1/64 px LayoutUnits **(unverified)**). UIKit frames accept fractional points and render at the screen scale. **Android `View.layout(int, int, int, int)` takes whole pixels**, so every Android box is rounded to device pixels; Taffy's `round_layout` should run with the device scale so neighbouring boxes do not gap or overlap. Expect 1-device-pixel differences in hairline borders and in rows of fractional-width items.
- **Text-driven sizes.** Every `auto` size that contains text depends on the native measure function, so layout is exact only relative to native text metrics (section 6).
- **`baseline` alignment** uses native font ascent/descent, which differ per font and per platform.

### 4.2 Box and paint

| Property / value | Web | iOS (UIKit) | Android (Views) | Email: Gm/GmiOS/ApiOS/OlWin/Ol.com/Y (all) | App class |
|---|---|---|---|---|---|
| `background-color`, `color` (named, hex, rgb, hsl) | yes | `UIColor` at build | `Color` at build | y everywhere (36/5/0); rgb partial in Gmail and Outlook | EXACT |
| `oklch()`, `lab()`, `color(display-p3 …)` | yes, wide gamut | build converts to extended-sRGB or P3 `UIColor` (T015 #6) | `Color.valueOf` wide gamut API 26+ (T015 #6) | modern-color n/n/y/n/n/n (7/0/18) | CAVEAT (gamut mapping differs if the screen is sRGB) |
| `color-mix()`, relative colour | yes | fold at build when inputs are constant; evaluator for variable inputs (T015 #37) | same | - | CAVEAT |
| `light-dark()`, `color-scheme` | yes | `UIColor(dynamicProvider:)` (T015 #27) | night `uiMode` | light-dark n/n/y/n/n/n (4/8/17) | CAVEAT |
| `opacity` | yes | `alpha` | `alpha` | y/y/y/n/y/y (29/0/12) | EXACT (group opacity: iOS `allowsGroupOpacity` default on **(unverified)**; Android may need a layer for overlapping children) |
| `visibility: hidden` | yes | `isHidden` keeps layout space | `INVISIBLE` | n/n/y/n/y/y | EXACT |
| `border` uniform solid (width, colour) | yes | `layer.borderWidth/borderColor` (drawn inside the bounds, as CSS with `border-box`) | `GradientDrawable.setStroke` | y/y/y/a/y/y (39/2/0) | EXACT |
| Per-side widths and colours | yes, with mitred corner joins | `CAShapeLayer` per side (T015 #7) | custom drawing (T015 #7) | yes except Outlook partial | CAVEAT (corner join geometry must be drawn by hand; test against the web) |
| `border-style: dashed | dotted` | yes, **dash length unspecified by CSS** (browsers differ) **(unverified: spec wording)** | `CAShapeLayer.lineDashPattern` ([Apple](https://developer.apple.com/documentation/quartzcore/cashapelayer/linedashpattern)) | `setStroke(width, color, dashWidth, dashGap)` / `DashPathEffect`; RN supports `dashed`/`dotted` ([RN view style props](https://reactnative.dev/docs/view-style-props)) | text-decoration-style y; border style not tested separately | APPROX (dots on iOS need round caps; corners differ) |
| `border-style: double | groove | ridge | inset | outset` | yes | hand-drawn | hand-drawn; RN does not offer them | - | APPROX (double) / WEB-ONLY (3D styles) |
| `border-image` | yes | no | no | n/n/y/n/n/n | WEB-ONLY |
| `border-radius` uniform | yes | `cornerRadius` | `setCornerRadius` | y/y/y/n/y/a (28/6/7); Outlook Windows needs VML | EXACT |
| Per-corner radius | yes | `maskedCorners` only if radii equal; otherwise path mask (T015 #7) | `setCornerRadii` | as above | CAVEAT |
| Elliptical radius (`10px / 20px`) | yes | path mask (`UIBezierPath` with elliptical arcs) | `setCornerRadii` takes x/y pairs **(unverified)** | slash notation not supported in some clients | CAVEAT |
| Radius clamping when radii exceed the box | yes, CSS scales all radii down | must reimplement the CSS scaling rule | same | - | CAVEAT |
| `corner-shape` / squircle | new in Chrome **(unverified)** | `cornerCurve = .continuous` iOS 13+ ([Apple](https://developer.apple.com/documentation/quartzcore/calayer/cornercurve)) | no native | - | APPROX (native-only extra) |
| `overflow: hidden` with radius | clips children to the rounded shape | `masksToBounds` plus `cornerRadius` clips, but also clips the layer shadow: needs a wrapper (T015 #14) | `setClipToOutline` API 21 | - | CAVEAT |
| `outline`, `outline-offset` | yes, outside the box, no layout | extra border layer outside bounds (T015 #34) | custom drawing; RN outline props exist | outline y/y/y/n/y/y | APPROX |
| `box-shadow` outset, one | yes | `layer.shadow*`, **blur = CSS blur × 0.5** ([Bjango](https://bjango.com/articles/matchingdropshadows/), [Microsoft Apple UX guide](https://microsoft.github.io/apple-ux-guide/Shadows.html)); spread via inset `shadowPath` | elevation cannot express arbitrary blur/offset/colour; custom drawing or RN-style implementation (RN outset: Android 9+) | n/a/y/n/y/n (24/2/15) | CAVEAT |
| `box-shadow` spread | yes | `shadowPath` = bounds inset by `-spread` | custom drawing | as above | CAVEAT |
| `box-shadow` inset | yes | masked inner shadow layer | custom drawing (RN inset: Android 10+) | as above | APPROX |
| Multiple shadows | yes | one layer per shadow | one draw per shadow | as above | APPROX |
| `background-image: linear-gradient()` | yes | `CAGradientLayer .axial`; start/end recomputed from the CSS angle and box size (T015 #6) | `LinearGradient` shader | y/y/y/n/n/n (24/2/17); Outlook Windows VML only | CAVEAT (interpolation, below) |
| `radial-gradient()` | yes | `.radial` type; ellipse sizing keywords (`farthest-corner` etc.) must be computed by the adapter | `RadialGradient` (circle only; ellipse needs a scale matrix **(unverified)**) | y/y/y/n/n/n (28/1/14) | CAVEAT |
| `conic-gradient()` | yes | `.conic` iOS 12+ ([Apple](https://developer.apple.com/documentation/quartzcore/cagradientlayertype/conic)) | `SweepGradient` (start angle via matrix) | n/n/y/n/n/n (14/1/20) | APPROX |
| `repeating-*-gradient()` | yes | no repeat mode in `CAGradientLayer`: expand stops at build | `Shader.TileMode.REPEAT` / `MIRROR` | - | APPROX |
| Gradient colour hints, `in oklch` interpolation | yes | pre-sample stops at build | same | - | CAVEAT (build sampling) |
| `background-image: url()` | yes | image layer | drawable | y/y/y/n/y/a (31/8/4) | CAVEAT (loading is async on native) |
| `background-size/position/repeat` | yes | adapter computes rect; `contentsGravity` covers only simple cases | `BitmapShader` + matrix | y except Outlook Windows | CAVEAT |
| Multiple background layers | yes | one sublayer per layer | `LayerDrawable` | "does not support multiple values" in some clients | CAVEAT |
| `background-clip: text` | yes | text mask | shader on text paint | y/a/y/n/y/n | APPROX |
| `filter: opacity()`, `drop-shadow()` | yes | alpha; layer shadow (alpha-shaped) (T015 #39) | alpha; `RenderEffect` or shadow | filter n/n/y/n/n/n (18/1/22) | CAVEAT |
| `filter: blur | brightness | contrast | grayscale | hue-rotate | invert | saturate | sepia` | yes | **`CALayer.filters` "is not supported on layers in iOS"** ([Apple](https://developer.apple.com/documentation/quartzcore/calayer/filters)); RN iOS offers only `brightness` and `opacity` | `View.setRenderEffect` API 31 covers blur and colour matrices; RN: blur Android 12+, colour filters all versions | as above | WEB-ONLY on iOS, EXACT-ish on Android 12+ → overall APPROX/NO |
| `backdrop-filter: blur()` | yes | `UIVisualEffectView` with `UIBlurEffect.Style` materials only; `backgroundFilters` "not supported on layers in iOS" ([Apple](https://developer.apple.com/documentation/quartzcore/calayer/backgroundfilters)) | `View.setBackdropRenderEffect` "Added in version 37.2" ([Android](https://developer.android.com/reference/android/view/View#setBackdropRenderEffect(android.graphics.RenderEffect))); earlier: capture-and-blur libraries | n/n/y/n/n/n (11/0/18) | APPROX |
| `backdrop-filter` other functions | yes | no | 37.2+ via `RenderEffect` chains | as above | WEB-ONLY on iOS |
| `mix-blend-mode`, `background-blend-mode` | yes | **`compositingFilter` "not supported on layers in iOS"** ([Apple](https://developer.apple.com/documentation/quartzcore/calayer/compositingfilter)) | `BlendMode` API 29 ([Android](https://developer.android.com/reference/android/graphics/BlendMode)); RN: Android 10+ | y/a/y/n/y/n | WEB-ONLY on iOS |
| `clip-path` basic shapes (`inset`, `circle`, `ellipse`, `polygon`) | yes | `layer.mask` with `CAShapeLayer` | `Canvas.clipPath` / outline | n/n/y/n/n/n | CAVEAT (later tier in T015) |
| `clip-path: path()`, `url()` | yes | path mask | clipPath | as above | APPROX |
| `mask`, `mask-image` | yes | `layer.mask` with an image layer | custom drawing | n/n/y/n/n/n | APPROX (later) |
| `isolation` | yes | n/a without blend modes | - | - | WEB-ONLY |
| `accent-color`, `appearance`, `caret-color` | yes | native controls have their own tint (`tintColor`) | theme colours | accent-color n except Apple | APPROX (tint only) |
| `cursor` | yes | iPad pointer only | mouse only | - | WEB-ONLY (no-op) |

### 4.3 Text

Native text is one text view per inline formatting context holding an attributed string (T015 Q1). All rows assume that.

| Property / value | Web | iOS | Android | Email: Gm/GmiOS/ApiOS/OlWin/Ol.com/Y (all) | App class |
|---|---|---|---|---|---|
| `font-family` custom via `@font-face` | yes | bundle and register at build (T015 #8) | `res/font` or `Typeface` | @font-face n/n/y/a/n/n (9/1/31) | CAVEAT (web font loading and fallback timing differ) |
| `font-family: system-ui`, `-apple-system`, `sans-serif` | OS font | SF Pro | Roboto or the OEM default **(unverified per OEM)** | system-ui y/y/y/n/y/y (24/9/2) | APPROX (different glyphs by design) |
| Font fallback chains | per character | Core Text cascade list **(unverified)** | system fallback | - | APPROX |
| `font-size` px, rem, em | yes | points; Dynamic Type scaling is an owner decision (T015 Q4) | sp vs dp is the same decision | y/y/y/a/y/a | CAVEAT |
| `font-weight` 100-900 | yes | `UIFont.Weight` (system font any value; custom fonts need the face) | `Typeface.create(family, weight, italic)` API 28 **(unverified API level)** | y/y/y/a/y/a | CAVEAT (synthetic bold differs) |
| `font-style: italic` | yes | trait or italic face | italic face | yes | CAVEAT (synthetic oblique differs) |
| `font-variant-*`, `font-feature-settings` | yes | Core Text feature attributes | `setFontFeatureSettings` | - | CAVEAT |
| `line-height` number, length | half-leading split above and below | `NSParagraphStyle` min/max line height puts the extra space above the glyphs; needs `baselineOffset` compensation (T015 #8) **(unverified: exact offset formula)** | `setLineHeight` API 28 ([Android](https://developer.android.com/reference/android/widget/TextView#setLineHeight(int))); `includeFontPadding`, `setFallbackLineSpacing` (API 28) and `setUseBoundsForWidth` (API 35) all change the result | y/y/y/a/y/y (37/4/0) | CAVEAT (major rendering difference, section 6) |
| `line-height: normal` | font metrics | font metrics (different fonts) | font metrics plus padding | - | APPROX |
| `letter-spacing` | px or em | `.kern` in points | `setLetterSpacing` in **em** (API 21): convert at build, re-convert when font size changes | y everywhere (39/2/0) | EXACT (after unit conversion) |
| `word-spacing` | yes | no direct attribute | no | - | WEB-ONLY |
| `text-align: left | right | center | start | end` | yes | `NSTextAlignment` | gravity / `textAlignment` | y/y/y/a/y/a | EXACT |
| `text-align: justify` | yes | `.justified` | `setJustificationMode` API 26 | as above | CAVEAT (justification algorithms differ) |
| `text-decoration-line` underline, line-through | yes | `.underlineStyle`, `.strikethroughStyle` | `UnderlineSpan`, `StrikethroughSpan` | y everywhere except Outlook Windows | EXACT |
| `text-decoration-style/color/thickness`, `text-underline-offset` | yes | style patterns and colour attributes; no offset control **(unverified)** | no style/colour on `UnderlineSpan`; custom span needed | decoration-style y; thickness n in Gmail | APPROX |
| `text-transform: uppercase | lowercase | capitalize` | yes, locale-aware | transform at runtime with the locale (not at build: text is dynamic) | same | y everywhere | CAVEAT (capitalize word rules differ) |
| `text-overflow: ellipsis` + `white-space: nowrap` | yes | `numberOfLines = 1`, `.byTruncatingTail` | `setSingleLine`, `ellipsize END` | y/a/y/n/y/n | EXACT |
| `-webkit-line-clamp` / `line-clamp` | yes | `numberOfLines` | `setMaxLines` + ellipsize | - | EXACT |
| `white-space: pre`, `pre-wrap`, `pre-line` | yes | whitespace preserved at build; wrapping via `lineBreakMode` | same | y/a/y/n/y/y | CAVEAT |
| `word-break: break-all`, `overflow-wrap: anywhere | break-word` | yes | `.byCharWrapping` is all-or-nothing **(unverified)** | `LineBreakConfig` word style (API 33) | word-break y/a/a/y/a/n | APPROX |
| `hyphens: auto` | yes, language dictionaries | `hyphenationFactor` ([Apple](https://developer.apple.com/documentation/uikit/nsparagraphstyle/hyphenationfactor)) | `setHyphenationFrequency` API 23 | n/n/y/n/n/n | APPROX |
| `text-wrap: balance | pretty` | yes | **no balanced strategy**: `NSParagraphStyle.lineBreakStrategy` offers only `standard`, `pushOut`, `hangulWordPriority` ([Apple](https://developer.apple.com/documentation/uikit/nsparagraphstyle/linebreakstrategy-swift.struct)) | `BREAK_STRATEGY_BALANCED` API 23 | n/n/y/n/n/n | APPROX (iOS no-op) |
| `text-shadow` | yes, multiple | `NSShadow` attribute, one per run, blur × 0.5 | `setShadowLayer` API 1, one shadow, blur × 0.866 ([Bjango](https://bjango.com/articles/matchingdropshadows/)) | n/n/y/n/n/y | APPROX |
| `direction`, `unicode-bidi` | yes | `baseWritingDirection`, `semanticContentAttribute` | `setTextDirection`, `setLayoutDirection` | y everywhere | EXACT (bidi algorithm is Unicode on all three) |
| `vertical-align: super | sub` inside text | yes | `baselineOffset` + smaller font | `SuperscriptSpan` | y everywhere | CAVEAT |
| `vertical-align: middle` for inline images | yes | attachment bounds adjusted | `ImageSpan` alignment | y | APPROX |
| `::first-letter`, `::first-line` | yes | no | no | Apple/Yahoo only | WEB-ONLY (later) |
| `user-select`, `-webkit-user-select` | yes | `UILabel` vs `UITextView` choice at build | `setTextIsSelectable` | a/n | CAVEAT |
| `writing-mode: vertical-rl` | yes | no | no | as above | WEB-ONLY |

### 4.4 Transforms, transitions, animations

| Property / value | Web | iOS | Android | Email | App class |
|---|---|---|---|---|---|
| `transform: translate | scale | rotate` (2D), `translate`/`scale`/`rotate` properties | yes | `CGAffineTransform` / `layer.transform` | `translationX/Y`, `scaleX/Y`, `rotation` | transform n/n/y/n/n/n (19/0/22) | EXACT |
| `skew()`, `matrix()` | yes | affine transform | **no View property for skew or a general matrix**: custom draw or `RenderNode` matrix **(unverified)** | as above | APPROX (Android) |
| `transform-origin` | yes | `anchorPoint` with position compensation | `pivotX/Y` | - | EXACT |
| 3D: `perspective`, `rotateX/Y`, `translateZ`, `matrix3d`, `backface-visibility` | yes | `CATransform3D` with `m34` | `rotationX/Y` + `cameraDistance` only; no `matrix3d` | - | APPROX (iOS close; Android partial) |
| `transform-style: preserve-3d` | yes | `CATransformLayer` **(unverified)** | no | - | WEB-ONLY on Android |
| `transition` of opacity, transform, colours, radius, shadow | yes | `CABasicAnimation` from the presentation value | `ViewPropertyAnimator` / `ObjectAnimator` | n/n/y/n/n/a | EXACT (curves) |
| Timing functions `ease*`, `cubic-bezier()` | yes | `CAMediaTimingFunction(controlPoints:)` | `PathInterpolator` | - | EXACT |
| `steps()`, `linear()` | yes | keyframe tables sampled at build (T015 Q5) | same | - | CAVEAT |
| Transition of layout properties (width, margin, gap) | every frame relayouts | animate final frames only (T015 Q5) | same | - | APPROX |
| `@keyframes`, `animation-*` | yes | `CAKeyframeAnimation` (T015 #31) | `ObjectAnimator` + keyframes | @keyframes n/n/y/n/n/y | CAVEAT (compositor properties first) |
| `transition-behavior: allow-discrete`, `@starting-style` | yes | build-time rules **(not designed)** | same | - | APPROX/unknown |
| View transitions | yes | later, with native navigation (T015 Q5) | shared element `transitionName` | - | WEB-ONLY for now |
| Scroll-driven animations | yes | no | no | - | WEB-ONLY |

### 4.5 Units, functions, variables, queries

| Feature | Web | iOS / Android | Email: Gm/GmiOS/ApiOS/OlWin/Ol.com/Y (all) | App class |
|---|---|---|---|---|
| `px` | CSS px | 1 pt / 1 dp (T015 #19) | y everywhere (42/0/0) | EXACT |
| `%` | yes | layout engine | y everywhere | EXACT |
| `em`, `rem` | yes | font-relative at build/evaluator | em y everywhere; rem y/y/y/n/y/n | EXACT (Dynamic Type decision aside) |
| `vw`, `vh`, `dvh`, `svh`, `lvh`, `vmin`, `vmax` | yes | root view size; all v*h equal on native (T015 Q4) | vw y/y/y/n/y/y; vh y/y/a/n/y/y | CAVEAT |
| `ch`, `ex`, `lh`, `cap` | yes | need font metrics (later) | ch y/y/y/n/y/n | CAVEAT (later) |
| `cq*` units | yes | later | - | WEB-ONLY for now |
| `pt`, `cm`, `mm`, `in`, `pc` | yes | fold at build (1in = 96px) | y everywhere | EXACT |
| `deg`, `rad`, `turn`, `ms`, `s` | yes | fold at build | - | EXACT |
| `calc()`, `min()`, `max()`, `clamp()` with constants | yes | fold at build | calc y/a/y/n/n/n (23/2/17); clamp y/a/y/n/n/n | EXACT |
| `calc()` mixing % and length | yes | Taffy calc callback; Yoga cannot | as above | EXACT on Taffy, NO on Yoga |
| Custom properties, constant | yes | inlined at build | variables n/n/y/n/n/n (19/0/23): **must be inlined for email** | EXACT |
| Custom properties set conditionally (theme, state) | yes | evaluator lookup along the host chain (T015 #17, T025) | no | CAVEAT |
| `@property` | yes | typed variables in the evaluator (T015 #37) | - | CAVEAT |
| `@media (min-width/max-width)` | yes | window size bits | @media a/a/y/n/a/a (16/17/8): Gmail only `screen`, min/max width/height | EXACT |
| `@media (prefers-color-scheme)` | yes | `userInterfaceStyle` / night mode | n/n/y/n/y/n | EXACT |
| `@media (prefers-reduced-motion)` | yes | system setting | n/n/y/n/y/n | EXACT |
| `@media (hover)`, `(pointer)` | yes | pointer availability (iPad, Android mouse) | hover n/n/y/n/y/n | CAVEAT |
| `@media (orientation)`, `(resolution)` | yes | traits / configuration | orientation y/n/a/n/y/n | EXACT |
| `@media (prefers-contrast)`, `(forced-colors)` | yes | Increase Contrast / high contrast text; no forced-colours mode | - | APPROX / WEB-ONLY |
| `@container` size | yes | second layout pass (T015 Q7) | - | CAVEAT |
| `@container style()` | yes | later | - | WEB-ONLY for now |
| `@supports` | yes | evaluated per target at build (T015 #36) | at-supports n/n/y/n/n/y | EXACT (it is the portability switch) |
| `@layer`, nesting | yes | build-time ordering and flattening | nesting mostly n: flatten for email | EXACT |
| `env(safe-area-inset-*)` | yes | `safeAreaInsets` / `WindowInsetsCompat` | - | EXACT (semantics per T015 Q4) |
| `env(keyboard-inset-*)` | Chromium only | keyboard layout guide / IME insets | - | CAVEAT |
| `!important` | yes | cascade at build | a/a/y/a/y/a | EXACT |

## 5. Selectors (brief; the rule is in T025)

Selectors are resolved at build under the T025 rule, so on native they are "exact" whenever the build accepts them, and a build error otherwise. The runtime states map as T015 #21: `:active` = touch down, `:hover` only when a pointer exists, `:focus-visible` only with a hardware keyboard or D-pad. Email is the constraint here: Gmail supports class, id, type, attribute (partial), child, descendant and sibling combinators, but **no** `:hover` on mobile Gmail, no `:focus`, `:not()`, `:nth-*`, `:has()`, `::before` or `::after`; Outlook for Windows supports only class, id, type, descendant, grouping and `:link` (caniemail rows `css-selector-*`, `css-pseudo-*`).

## 6. Rendering differences that remain when a feature is "supported"

These should be documented once and referenced from every CAVEAT/APPROX diagnostic.

1. **Fonts and metrics.** `system-ui` resolves to three different typefaces (browser OS font, SF Pro, Roboto or an OEM font). Even with one bundled font, ascent/descent and line gap come from the font's tables and each engine reads them differently (Android `includeFontPadding`, fallback line spacing for scripts taller than the primary font). Result: the same paragraph has different heights and baselines. **Test strategy: compare text boxes within a tolerance, not pixel-exact.**
2. **Line height model.** CSS splits leading equally above and below each line (half-leading). UIKit's paragraph-style line height adds the space above; Android's `setLineHeight` changes baseline-to-baseline distance. Equal single-line centring needs per-platform compensation.
3. **Text wrapping and hyphenation.** Three line breakers (browser ICU-based, Core Text, Android `StaticLayout`/Minikin **(unverified naming)**). Break points differ for long words, CJK, emoji and punctuation; `hyphens: auto` dictionaries differ; `text-wrap: balance` is a no-op on iOS.
4. **Shadows.** Same CSS values need platform scaling (iOS blur × 0.5; Android `setShadowLayer` × 0.866; Android elevation shadows cannot express CSS at all). Spread and inset shadows are hand-built. Shadows under `overflow: hidden` need a wrapper view on iOS.
5. **Dashed and dotted borders.** CSS leaves the dash pattern to the browser, so Chrome, Safari and Firefox already differ; native dash patterns and corner handling will differ again. Treat dashed/dotted as a style, not a measurement.
6. **Gradients.** CSS interpolates in premultiplied alpha, so `transparent` stops do not produce grey fringes, and modern colour syntax defaults to Oklab interpolation while legacy colours use sRGB **(unverified: spec wording; the fetch summary did not quote it)**. `CAGradientLayer` and Android shaders interpolate in their own colour space without these rules **(unverified)**. Fix: the build samples the CSS gradient into enough stops that the native interpolation cannot drift visibly.
7. **Blur.** iOS has no arbitrary-radius blur on live views: `backdrop-filter` snaps to system materials (which also tint and vibrancy-shift), `filter: blur()` is unavailable. Android blur exists from API 31 (content) and 37.2 (backdrop).
8. **Subpixel rounding.** Android views sit on whole device pixels; UIKit uses fractional points; the web snaps at paint. Hairlines (`0.5px` borders) and fractional grids will differ by one device pixel.
9. **Scroll physics.** Native scroll views bring native deceleration, bounce (iOS) or stretch overscroll (Android 12+), scroll indicators and scroll-to-top. This is intended but means `scroll-behavior`, snap timing and overscroll look native, not like a desktop browser.
10. **Focus rings.** The web draws a UA outline for `:focus-visible`. iOS draws a system focus halo (`UIFocusHaloEffect`, iOS 15+, [Apple](https://developer.apple.com/documentation/uikit/uifocushaloeffect)) only with a hardware keyboard; Android draws a default focus highlight (`setDefaultFocusHighlightEnabled`, API 26). CSS `outline` on `:focus-visible` needs a decision: replace the system ring or draw both.
11. **Colour.** Wide-gamut colours map to P3 on capable screens; sRGB screens gamut-map differently from browsers.
12. **Synthetic styles.** Faux bold and faux italic are produced differently when a font lacks the face.

## 7. Email summary

Email clients are the tightest target, and the gap is the client, not Markless. From the caniemail data:

- **Works almost everywhere** (y in Gmail web and Outlook Windows classic and Apple Mail): `background-color`, `border` (Outlook partial), `color`, `font`, `font-family`/size/weight (Outlook partial), `letter-spacing`, `line-height`, `text-align`, `text-decoration`, `text-transform`, `vertical-align`, `direction`, `padding` (Outlook partial), `width`/`height`, `max-width` (Outlook partial), `display: none` (Outlook partial), absolute units, `%`, `em`, `border-collapse`, `list-style-type`, class/id/type/descendant selectors.
- **Everywhere except Outlook Windows classic:** `border-radius`, `display: flex` and `grid` (Gmail: Google accounts only, no `inline-flex`), `min-/max-*`, `box-sizing`, `rem`, `vw`, `@media` (partial), `background-image` url and gradients (Gmail yes, Outlook.com no for gradients), `opacity`, `overflow` (partial), `white-space`, `object-fit`, `calc`/`clamp` (Gmail yes).
- **Not in Gmail:** custom properties, `box-shadow` (webmail), `transform`, `transition`, `animation`, `filter`, `backdrop-filter`, `aspect-ratio`, `position` (all values), `inset`, `z-index`, `flex-direction`/`justify-content`/`align-items` (caniemail marks these `n` while marking `display: flex` `y`; tested 2021-2023), logical properties, `:hover` on mobile, `:focus`, `:not()`, `:nth-*`, `:has()`, `::before`/`::after`, `@font-face`, `prefers-color-scheme`.

Implication for the design (not decided here): the email target needs a profile that inlines styles, resolves variables and `calc()` at build, lowers flex rows to tables for Outlook, and reports anything in the "not in Gmail" list as unsupported.

## 8. Open questions and gaps

- **Taffy position work is unreleased.** `static`, `fixed`, `sticky` and containing-block hoisting are on main only. Pin main or wait for 0.15.
- **Taffy `min-*`/`max-*` intrinsic keywords, `order`, subgrid, masonry, tables, `last baseline`:** all open upstream. Decide build error vs contribute.
- **Yoga grid** is style types only; revisit if the remaining eight steps land.
- **Not verified in this pass:** Chromium LayoutUnit precision, CSS dashed-border wording, gradient interpolation defaults, `CAGradientLayer` colour space, Android `setCornerRadii` elliptical behaviour, Android skew/matrix support on `View`, `Typeface.create` weight API level, iOS text-decoration offset control, Taffy's Chrome-generated fixtures. Each needs a device or primary-doc check before it becomes a user-facing doc claim.
- **Witness plan (recommended, not done):** render a fixed CSS fixture set in Chrome, plain UIKit views and Android Views, and compare box geometry exactly and paint within a tolerance. That turns every CAVEAT here into a measured number.

```json
{
  "goalbuddy_receipt_v1": {
    "task_id": "T029",
    "result": "done",
    "board_path": "/Users/jacksm5pro/dev/open-source/markless/docs/goals/native-targets-api/state.yaml",
    "summary": "Built the per-property/value evidence table across web, UIKit, Android Views and email with exact/caveat/approx/web-only classes and a rendering-differences list. Layout is the strong part with Taffy: flex, grid (no subgrid/masonry/order), block with margin collapsing, sizing keywords, aspect-ratio, calc all implemented; compiler must emit web defaults (Taffy defaults to display:flex and box-sizing:border-box); static/fixed/sticky positioning is unreleased on Taffy main. Yoga has no grid algorithm (style types only, 2026-03), no block, no calc, and needs UseWebDefaults plus explicit position:static and a cleared min-size errata bit (main only). iOS has no public filters, backdrop filters or blend modes on layers (Apple docs); Android has RenderEffect (API 31) and backdrop effects from 37.2. Shadows need blur scaling (iOS x0.5, Android setShadowLayer x0.866). Text never matches pixel-for-pixel (fonts, line-height model, line breakers). Email: Outlook Windows classic and Gmail block most modern CSS; custom properties, box-shadow, transform, position unsupported in Gmail.",
    "evidence": [
      "docs/goals/native-targets-api/notes/T029-support-evidence.md",
      "https://github.com/DioxusLabs/taffy/blob/main/CHANGELOG.md",
      "https://github.com/DioxusLabs/taffy/blob/main/src/style/mod.rs",
      "https://github.com/DioxusLabs/taffy/blob/main/src/style/grid.rs",
      "https://github.com/facebook/yoga/blob/main/website/docs/styling/index.md",
      "https://github.com/facebook/yoga/blob/main/yoga/YGEnums.h",
      "https://github.com/facebook/yoga/commit/4a59d0940",
      "https://www.caniemail.com/api/data.json",
      "https://developer.apple.com/documentation/quartzcore/calayer/filters",
      "https://developer.apple.com/documentation/quartzcore/calayer/compositingfilter",
      "https://developer.apple.com/documentation/quartzcore/calayer/backgroundfilters",
      "https://developer.apple.com/documentation/uikit/nsparagraphstyle/linebreakstrategy-swift.struct",
      "https://developer.android.com/reference/android/view/View#setBackdropRenderEffect(android.graphics.RenderEffect)",
      "https://developer.android.com/reference/android/widget/TextView",
      "https://reactnative.dev/docs/view-style-props",
      "https://bjango.com/articles/matchingdropshadows/"
    ],
    "facts": [
      "Taffy v0.14.0 (2026-08-24): Display = Block, FlowRoot, Flex, Grid, None; default Flex and BorderBox.",
      "Taffy: no order (#1198 open), subgrid (#468/#985 open), masonry (#910 open), tables (#1094 open), last baseline (#1111 open); min/max sizes lack intrinsic keywords.",
      "Taffy main (unreleased): Position Static (default), Relative, Absolute, Fixed, Sticky; sticky offset left to the caller.",
      "Taffy has named grid lines and areas (0.9.0), auto-fill/auto-fit, minmax, fr, fit-content(), dense auto-flow, safe alignment, direction rtl, margin collapsing, floats, calc via callback.",
      "Yoga defaults: column, align-content flex-start, flex-shrink 0, position relative; UseWebDefaults flips the first three only.",
      "Yoga grid: style types and public API only (commit 07524851f, 2026-03-05); no grid algorithm file on main.",
      "Yoga spec auto-min-size: opt-in by clearing YGErrataMinSizeUndefinedInsteadOfAuto, main only (2026-06-03); last Yoga release v3.2.1 2024-12-13.",
      "Apple docs: CALayer filters, backgroundFilters and compositingFilter are 'not supported on layers in iOS'.",
      "Android: RenderEffect API 31, View.setBackdropRenderEffect added in 37.2, BlendMode API 29, setLineHeight API 28, setJustificationMode API 26, BREAK_STRATEGY_BALANCED via setBreakStrategy API 23, LineBreakConfig API 33, setUseBoundsForWidth API 35.",
      "iOS NSParagraphStyle.lineBreakStrategy offers standard, pushOut, hangulWordPriority: no balanced wrapping.",
      "caniemail (2026-09-16): Outlook Windows classic has no flex, grid, border-radius, box-shadow, gradients, rem, calc; Gmail has no custom properties, box-shadow (web), transform, position, :not/:nth/:has, ::before/::after."
    ],
    "contradictions": [
      "T011/T015 said Yoga grid was abandoned; Yoga main restarted grid work in 2026-03 but only style types have landed.",
      "caniemail marks Gmail display:flex yes but flex-direction/justify-content/align-items no; flex in Gmail is effectively unusable beyond a default row."
    ],
    "unverified": [
      "Chromium LayoutUnit precision; CSS dashed pattern wording; gradient default interpolation space and premultiplication wording; CAGradientLayer colour space; Android setCornerRadii elliptical behaviour; Android View skew/matrix; Typeface.create weight API level; Taffy Chrome-generated fixtures; browser versions for subgrid and masonry."
    ],
    "next_task_hint": "T030 can take section 2's classes as the support-profile vocabulary and section 6 as the shared caveat text; a witness task comparing Chrome, UIKit and Android geometry on a fixture set would convert the CAVEAT rows into measured numbers."
  }
}
```
