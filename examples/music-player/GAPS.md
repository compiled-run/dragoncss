# North-star gap map: the Markless music player

Measured by `pnpm run north-star:check` on the worktree at `4c1331c` (support profiles `m1-s5`). The numbers come from
`dragon/north-star-check.json`. Re-run the check after each step of the work list; the output file is deterministic.

## Summary

| Measure | Today |
|---|---|
| Declarations supported on web and ios | **60 / 291 = 20.6%** (web 60, ios 60) |
| Elements supported | 18 / 62 (html, body and 16 div) |
| Unique diagnostics (3 states x 3 passes, deduplicated) | **646**, all errors |
| Outputs | web and ios **blocked** in every state and pass |

Diagnostics by code:

| Code | Count |
|---|---:|
| `DRAGON_UNSUPPORTED_VALUE` | 159 ios + 159 web |
| `DRAGON_UNSUPPORTED_PROPERTY` | 103 |
| `DRAGON_UNSUPPORTED_ELEMENT` | 44 |
| `DRAGON_UNSUPPORTED_ATTRIBUTE` | 40 |
| `DRAGON_UNPROVEN_CONTEXT` | 38 ios + 38 web |
| `DRAGON_CSS_INVALID_VALUE` | 21 |
| `DRAGON_UNSUPPORTED_FONT` | 21 (ios) |
| `DRAGON_UNSUPPORTED_SELECTOR` | 20 |
| `DRAGON_UNSUPPORTED_AT_RULE` | 3 |

**What "supported" means.** A declaration is supported when no error from any pass lands on:

- the declaration itself,
- its rule's selector, or
- (for an unsupported-at-rule error) its enclosing at-rule.

**The per-case checks come from a probe.** The per-case checks (contextual proof, fonts, computed-value refusals) only run in
pass C, the context probe. That pass projects the tree to `div` and blanks every declaration that has a target-less error.
Rules keyed on type selectors (`nav`, `h1`–`h4`, `button`, `p`, `a`, `img`, `input`, `span`) match nothing there, so their
contextual diagnostics will appear only once those elements are supported. Expect some of the 60 to move when that happens.

**Dragon has no Android target yet.** Every Android route below is planned, not checked.

### Top 10 gaps (by blocked declarations and elements)

1. **Custom properties and `var()`.** 13 definitions and 30 `var()` uses, including all 21 `DRAGON_CSS_INVALID_VALUE`. They
   block every colour on the screen. Route: build-time fold.
2. **Relative and viewport units and math functions.** `rem` has 75 uses; there are 9 `vw` and 6 `vh`, plus `clamp()` x4,
   `min()` x8 and `calc()` x3. They cause most of the 159 `UNSUPPORTED_VALUE` per target. Route: fold `rem`; resolve
   `vw`/`vh` and the math functions in the engine.
3. **Elements beyond html/body/div.** 44 elements across 11 tags: `nav`, `h1`–`h4`, `p`, `span`, `a`, `button`, `img` and
   `input`, plus the inline formatting context that `span`, `a`, `inline-flex` and `inline-block` need.
4. **Real-font text.** `'Lato', sans-serif` (21 `UNSUPPORTED_FONT`), `font-weight`, `font`, `letter-spacing`,
   `overflow-wrap` (4) and `white-space`, plus the symbol glyphs ♪ ▶ ❚❚ ‹ ›.
5. **The `background` shorthand and gradients.** 20 declarations: `linear-gradient` x2, `radial-gradient` and
   `repeating-radial-gradient`.
6. **Transforms.** `transform` (11 declarations: `translate`, `translateX`, `rotate`, `scale`) and `transform-origin`.
7. **Positioning and paint order.** `position: fixed` (4), `z-index` (3), stacking contexts, and 20 `UNPROVEN_CONTEXT`
   diagnostics for abspos children of a flex row.
8. **Box decoration.** `border-radius` (8) and `box-shadow` (5, including inset and multiple shadows).
9. **Replaced elements.** `img` x5 with `object-fit` (2) and `aspect-ratio` (5).
10. **Interaction runtime.** `:hover` x4, `:focus`, `transition` x4, `animation`/`@keyframes`, `animation-play-state` x2,
    `cursor` and `pointer-events`.

Also required for 100%: `input[type=range]` as a Dragon-drawn slider, scroll containers and Dragon-owned scroll indicators,
`@media` (x2), `opacity` (6), and non-matching attributes (40 diagnostics).

### Ordered work to 100%

Each step lists its unblocks, the declarations it should move, and its size. Sizes: **S** is up to 2 days, **M** up to 1 week,
**L** 1–3 weeks, **XL** more than 3 weeks.

1. **Producer and tree: the screen as a tree fixture.** (S–M)
   - Accept void elements in the fixture subset.
   - Pass non-`ui-*` attributes through as element data rather than errors. They still take no part in matching, except the
     folded `[type]` selector.
   - Model `libraryStatus` and `isPlaying` as free states: 4 cases instead of 3 hand-derived snapshots.
   - Unblocks the 40 attribute diagnostics.
2. **Build-time folds.** (M)
   - `var()` and `:root` custom properties.
   - `rem`, with a root `font-size` of 16px from the UA dataset.
   - Shorthand expansion: `background`, `inset`, `padding-inline`, `font`, `border-*` with folded values.
   - `*`, `:root`, `#id`, and `[type='range']` against static attributes.
   - Drop `::-moz-range-thumb` the way Chrome does, as an invalid selector.
   - Estimate (not measured): about 110 declarations, the largest single jump. The check measures the real figure after it lands.
3. **Engine layout values and contexts.** (L)
   - `vw`/`vh` from the environment viewport, and `calc()`/`min()`/`clamp()` resolved at layout time.
   - `aspect-ratio`, `position: fixed`, and overflow propagation to the viewport.
   - Parity fixtures for every unproven context: abspos in a flex row, relative in a flex row or column, text in a flex
     column, `root/ltr`, and `not-flex-container`.
4. **Elements and inline layout.** (L–XL)
   - UA defaults for `nav`, `h1`–`h4`, `p`, `span`, `a` and `button` from the keyed UA dataset.
   - An inline formatting context covering `span`, `a`, `inline-flex` and `inline-block`.
   - Accessibility roles.
5. **Text on real fonts.** (XL, gated by the text-strategy spike in course correction 2)
   - One pinned open font for `sans-serif` on every side.
   - `font-weight`, glyph fallback for the symbols, `overflow-wrap: break-word`/`anywhere`, `letter-spacing`, `line-height`.
   - Dragon-drawn underline with `text-decoration-color` and `text-underline-offset`.
6. **Paint.** (L)
   - `background-color` everywhere, the three gradient kinds, `border-radius` (including `50%` and `999px`), `box-shadow`
     (outer, spread, inset, multiple), `opacity`, `transform`/`transform-origin`, and `z-index`/stacking.
   - Proved in a new paint lane: pixel diff against the Chrome screenshots here.
7. **Replaced elements and controls.** (L)
   - `img` with `object-fit` and intrinsic size.
   - `input[type=range]` as a Dragon slider styled by `::-webkit-slider-thumb`.
   - Scroll containers (`overflow: auto`, and `overflow-x: hidden` computing `overflow-y: auto`) with Dragon-owned scroll
     indicators from `scrollbar-color`/`scrollbar-width`.
8. **Runtime.** (L)
   - State switching between precomputed cases.
   - `:hover` and `:focus` as runtime states.
   - `transition` (property interpolation between cases, including layout-affecting `margin-right`).
   - `@keyframes`/`animation`/`animation-play-state`, plus `pointer-events` and `cursor`.
9. **Android.** (L) The public Android target (P4), then the same device lanes as iOS.
10. **End to end.** (M) The screen on iPhone and Android, compared with `chrome/<device>/*.png` and `*.boxes.json` per state.

## 1. Tree format and producer gaps

These are things the fixture format or dragon/tree@0 cannot express today, found while feeding the screen in.

| Gap | Uses | Dragon today | Route (iOS / Android) | Proof | Size |
|---|---:|---|---|---|---|
| Void elements (`<img>`, `<input>`) | 6 | The fixture HTML subset has none. The check adds an explicit end tag (`producerEdits` in the check output). | Producer only: accept the HTML void set. | Fixture-reader unit test | S |
| `<head>`, `<meta>`, `<link rel=stylesheet>` | 1 sheet | No link form. The check inlines `styles.css` into one `<style>`. | Producer: map `<link>` to a style use; dragon/tree@0 already carries `styles[]`. | Reader test | S |
| Image sources (`img src`) | 5 | No asset binding or intrinsic size. `snapshot.assets` is always `[]`. | Tree assets with intrinsic size (1280x720) and a decoded bitmap. iOS: `UIImage`/`CGImage`. Android: `Bitmap`/`ImageDecoder`. | Parity fixture with a data-URI image; WPT `css/css-images/object-fit*` | M |
| `input type=range` | 1 | No control model; the element and its `type`/`min`/`max`/`value` are rejected. | A Dragon control node: a slider with value, min and max. See section 3. | Paint lane plus a value-mapping unit test | M |
| Text in real fonts | 21 text nodes | Only Ahem has a layout mapping (`DRAGON_UNSUPPORTED_FONT`). | Text-engine hook, decided by the text-strategy spike. Pin an open `sans-serif` (the demo never loads Lato). | Real-font text lane; WPT `css/css-fonts`, `css/css-text` | XL |
| Symbol glyphs ♪ ▶ ❚❚ ‹ › | 5 | Covered by the font gap. | Font fallback: bundled symbol coverage, or fallback chains in Core Text and in Android's `SystemFonts`. | Text lane per glyph | M |
| YouTube iframe | 1 | Stripped; the placeholder `div` is sized as the iframe. | Foreign-view slot laid out by Dragon: iOS `WKWebView`, Android `WebView` (or native players). No CSS feature involved. | Box in the parity lane; the content is not compared | M |
| Script-driven inline styles (track gradient per song, progress `translateX(%)`) | 2 | Out of the CSS snapshot. | Runtime helper: a typed style-override API on a node (gradient stops, transform) that re-uses the paint and transform routes. | Runtime unit test plus a paint-lane frame | M |
| Screen states as tree states | 2 states | The check derives 3 static snapshots. | A tree fixture with `libraryStatus` and `isPlaying` as free states (tree fixtures already support states and class choices). | Parity case count (4 cases) | S |

## 2. Elements

| Element | Uses | Dragon today | Route iOS | Route Android | Proof | Size |
|---|---:|---|---|---|---|---|
| `html`, `body`, `div` | 1, 1, 16 | supported | Engine box, native view per box | Same | Existing parity lanes | – |
| `nav` | 1 | `UNSUPPORTED_ELEMENT` | Engine block box with UA defaults; accessibility container | Engine box; `AccessibilityNodeInfo` pane | Parity fixture (UA dataset) | S |
| `h1`, `h2`, `h3`, `h4` | 1, 2, 5, 4 | `UNSUPPORTED_ELEMENT` | Engine block box; UA margins, font-size and bold from the keyed UA dataset; `.header` trait | Same; `setHeading(true)` | Parity fixtures; WPT `css/CSS2` UA defaults | S |
| `p` | 2 | `UNSUPPORTED_ELEMENT` | Engine block box with UA margins (reset here by `*`) | Same | Parity fixture | S |
| `span` | 11 | `UNSUPPORTED_ELEMENT` | Engine inline box (inline formatting context); the record parts are abspos, so they blockify | Same | Parity fixtures; WPT `css/css-display`, `css/css-inline` | L (inline layout) |
| `a` | 2 | `UNSUPPORTED_ELEMENT` | Engine inline or inline-block box; underline paint; tap runtime helper opens the URL (`UIApplication.open`) | `Intent.ACTION_VIEW` | Parity fixture plus paint lane | M |
| `button` | 10 (2 are `display:none`) | `UNSUPPORTED_ELEMENT` | Engine box with Chrome's UA button defaults (inline-block, padding, border, centred content); press runtime helper; `.button` trait | Same; `Button` role | Parity fixture (UA dataset for button) | M |
| `img` | 5 | `UNSUPPORTED_ELEMENT` | Replaced box: intrinsic size and ratio in the engine; paint by `CALayer.contents` with the engine-computed `object-fit` rect and a clip | RenderNode `drawBitmap` into the engine rect with a clip | Parity fixture; WPT `css/css-images` (object-fit, 224 files) | L |
| `input type=range` | 1 | `UNSUPPORTED_ELEMENT` | Dragon-drawn slider view (not `UISlider`). Here the track is transparent and the thumb is a 16x16 box with no background, so it paints nothing, exactly as in Chrome. The visible bar is the `.track` gradient under it. The helper gives hit-testing and value mapping. | Dragon-drawn view (not `SeekBar`) | Paint lane; WPT `css/css-pseudo/slider/` | M |

## 3. Selectors

| Selector feature | Uses | Dragon today | Route (iOS and Android: selectors are matched at build time into cases) | Proof | Size |
|---|---:|---|---|---|---|
| Class, compound classes (`.App.library-active`), descendant combinator, selector lists | 66, 5, 22, 5 | supported | Build time | Existing cascade fixtures | – |
| Type selectors (`nav`, `h1`–`h4`, `button`, `input`, `img`, `span`, `p`, `a`, `iframe`, `html`, `body`) | 38 | supported by the matcher; they only take effect once the elements exist | Build time | Section 2 fixtures | – |
| `*` universal | 5 | `UNSUPPORTED_SELECTOR` | Build-time fold: matches every element | Parity fixture; WPT `css/selectors` | S |
| `:root` | 1 | `UNSUPPORTED_SELECTOR` | Build-time fold: the document element | WPT `css/selectors` | S |
| `#root` (matches nothing here) | 1 | `UNSUPPORTED_SELECTOR` | Build-time fold on the `id` attribute | WPT `css/selectors` | S |
| `[type='range']` | 3 | `UNSUPPORTED_SELECTOR` (only `[ui-*]`) | Build-time fold against static attributes | Parity fixture | S |
| `:hover` | 4 | `UNSUPPORTED_SELECTOR` | Runtime helper: hover as a state with a precomputed case delta. iOS: `UIHoverGestureRecognizer` (pointer, iPadOS). Android: `onHoverEvent` (mouse, stylus). On touch, Chrome's sticky hover after a tap is replicated or declared per platform. | Paint lane in a hover state (Playwright `hover()`) | M |
| `:focus` (with `outline: none`) | 1 | `UNSUPPORTED_SELECTOR` | Runtime focus state. Suppress the platform focus ring: iOS `focusEffect = nil`; Android `defaultFocusHighlightEnabled = false`. | Runtime test; WPT `css/css-ui` outline | S |
| `::-webkit-slider-thumb` | 1 | `UNSUPPORTED_SELECTOR` | Styles the thumb part of the Dragon slider | Paint lane | S (with the slider) |
| `::-moz-range-thumb` | 1 | `UNSUPPORTED_SELECTOR` | Chrome drops this whole rule (unknown pseudo-element). Dragon must match Chrome: an invalid-selector no-op with a warning, not an error. | Dual lane: the rule has no effect | S |
| `::-webkit-scrollbar`, `-track`, `-thumb` | 3 | `UNSUPPORTED_SELECTOR` | Chrome 121+ ignores these once `scrollbar-color`/`scrollbar-width` apply (they do, via `*`). Dragon follows the standard properties. See scroll indicators in section 5. | Capture without `--hide-scrollbars`, library scrolled | S |

## 4. At-rules

| At-rule | Uses | Dragon today | Route iOS / Android | Proof | Size |
|---|---:|---|---|---|---|
| `@media screen and (max-width: 768px)` / `(max-width: 640px)` | 2 blocks, 11 rules | `UNSUPPORTED_AT_RULE`; the inner declarations are also checked in pass B | Environment-keyed cases: compile each width band, and a runtime helper selects the band on size change (rotation, split view). Both queries match both target phones. | WPT `css/mediaqueries`; parity at 390, 412 and a wide viewport | M |
| `@keyframes album-spin` (`from`/`to`, `rotate`) | 1 | `UNSUPPORTED_AT_RULE` | Runtime helper. iOS: `CABasicAnimation` on `transform.rotation.z`, 20s, linear, repeat forever. Android: `ObjectAnimator` on the RenderNode rotation with a `LinearInterpolator`. | Paint lane with animations frozen at fixed times (Chrome `Animation.currentTime`); WPT `css/css-animations` | M |

## 5. Properties

Uses are declaration counts. Status is supported/total declarations and the blocking codes.

### Layout (engine: TS translated to Swift and Kotlin)

| Property | Uses | Dragon today | Route iOS / Android | Proof | Size |
|---|---:|---|---|---|---|
| `display` (`flex`, `block`, `none`, `inline-flex`, `inline-block`) | 17 | 12/17: `inline-flex`/`inline-block` `UNSUPPORTED_VALUE`, unproven contexts, `@media` | Engine; inline values need the inline formatting context | Parity fixtures; WPT `css/css-display` | L (inline) |
| `flex-direction` | 4 | 4/4 supported | Engine | Existing | – |
| `align-items`, `justify-content` | 8, 7 | 7/8, 5/7: `UNPROVEN_CONTEXT` (`not-flex-container`, relative in flex) | Engine; add fixtures for the contexts | Parity fixtures; WPT `css/css-flexbox` | S |
| `flex`, `flex-wrap`, `gap` | 2, 1, 4 | 1/2, 0/1, 1/4: unproven contexts; `rem` gaps | Engine plus `rem` fold | Parity fixtures | S |
| `width`, `height`, `min-*`, `max-*` | 25, 7, 13, 8 | 5/25, 4/7, 1/13, 1/8: `rem`, `vw`/`vh`, `clamp`/`min`/`calc`, `var()`, contexts | Engine: viewport units from the environment; math functions resolved at layout (they mix `%` and `vw`) | Parity fixtures; WPT `css/css-values` (607) | M |
| `margin`, `margin-right`, `padding`, `padding-left`, `padding-inline` | 4, 2, 11, 1, 1 | 1/4, 0/2, 0/11, 0/1, 0/1: `rem`, `var()`, `clamp`; `padding-inline` `UNSUPPORTED_PROPERTY` | Fold `rem`/`var`; logical-to-physical fold by direction; `clamp` in the engine | Parity fixtures; WPT `css/css-logical` | S |
| `box-sizing` | 1 | 0/1: its rule's `*` selector | Fold `*` | Existing | S |
| `position` | 10 | 8/10: `fixed` `UNSUPPORTED_VALUE` | Engine: the viewport as containing block. Native: fixed boxes live in an overlay layer outside the scroll view on both platforms. | Parity fixture with a scroll offset; WPT `css/css-position` (492) | M |
| `top`, `left`, `right`, `inset` | 7, 6, 1, 1 | 1/7, 1/6, 0/1, 0/1: `rem`, abspos-in-flex-row contexts; `inset` `UNSUPPORTED_PROPERTY` | Engine plus shorthand fold | Parity fixtures (abspos in flex) | S |
| `aspect-ratio` | 5 | 0/5 `UNSUPPORTED_PROPERTY` | Engine (css-sizing-4 aspect-ratio) | WPT `css/css-sizing/aspect-ratio` (299) | M |
| `overflow`, `overflow-x` | 5, 2 | 1/5, 0/2: propagation to the viewport; `overflow-x: hidden` alone computes `overflow-y: auto` | Engine: viewport propagation and scroll containers. iOS: Dragon content in a `UIScrollView` with native indicators hidden. Android: a custom scroll container. `hidden` clips (`masksToBounds` / `clipChildren` with an outline clip). | WPT `css/css-overflow` (1334) | L |
| `z-index` | 3 | 0/3 `UNSUPPORTED_PROPERTY` | Engine: stacking-context tree and paint order. iOS: sibling order or `zPosition`. Android: drawing order (`setChildrenDrawingOrderEnabled`) or `translationZ` without elevation shadows. | Paint lane; WPT `css/CSS2` zindex | M |

### Values (build-time folds or engine)

| Value feature | Uses | Dragon today | Route | Proof | Size |
|---|---:|---|---|---|---|
| Custom properties (`--*` on `:root`) | 13 | `UNSUPPORTED_PROPERTY` | Build-time fold. Constant on `:root` and never set by script, so it is substituted at compile time; a per-case fold if a state ever sets one. | WPT `css/css-variables` (270) | S–M |
| `var()` | 30 | `CSS_INVALID_VALUE` (21) | Build-time fold (above) | Same | S |
| `rem` | 75 | `UNSUPPORTED_VALUE` | Build-time fold: 1rem = the root computed font-size (UA 16px); becomes engine if a state changes the root font-size | WPT `css/css-values` | S |
| `vw`, `vh` | 9, 6 | `UNSUPPORTED_VALUE` | Engine input from the environment viewport. Native viewport = the root view bounds. Chrome mobile `vh` uses the large viewport, so the environment defines `vh` against the safe-area-free root view. | Parity at both devices | S–M |
| `calc()`, `min()`, `clamp()` | 3, 8, 4 | `UNSUPPORTED_VALUE` or invalid | Engine: a TS calc tree (px, %, vw, vh, rem) resolved at layout and translated | WPT `css/css-values` calc, min/max/clamp | M |
| Colours: hex, `rgba()`, `transparent`, `inherit` | 12, 12, 11, 2 | Blocked only through `var()` and properties | Build-time to sRGB floats; `CGColor` / `Color.pack` | Existing colour fixtures; WPT `css/css-color` | S |
| `deg`, `s`, `%` in transforms and timing | 6, 7, 48 | With their properties | Engine and runtime | With their properties | – |

### Paint (Dragon-owned paint or native layer properties)

| Property | Uses | Dragon today | Route iOS | Route Android | Proof | Size |
|---|---:|---|---|---|---|---|
| `background` (shorthand), `background-color` | 20, 1 | 0/20 `UNSUPPORTED_PROPERTY`; `background-color` 0/1 (its `*::-webkit-scrollbar-thumb` selector) | Fold the shorthand to longhands; colour as `CALayer.backgroundColor` | RenderNode `drawRect` / `drawRoundRect` | Paint lane; WPT `css/css-backgrounds` | S |
| `linear-gradient()` | 2 | with `background` | Dragon paint: `CGContext.drawLinearGradient` with CSS angle and gradient-line length computed by the engine (not `CAGradientLayer` start and end points) | `LinearGradient` shader with the same computed endpoints and stops | Paint lane; WPT `css/css-images` gradients | M |
| `radial-gradient()` with hard stops (`0 8%`, `8.5% 12%`) | 1 | with `background` | Dragon paint: `drawRadialGradient` with duplicated stops for the hard edges and `farthest-corner` radius from the engine | `RadialGradient` shader, same stops | Paint lane; WPT `css/css-images` | M |
| `repeating-radial-gradient()` | 1 | with `background` | Dragon paint: expand the stops over the full radius (`CGGradient` has no repeat mode) | `RadialGradient` with `TileMode.REPEAT` over the normalised period | Paint lane | M |
| `border` (shorthands and widths), `border-color`, `border-left` | 9, 1, 1 | 3/9, 0/1, 0/1: `var()`, `rem` widths, unproven styles in abspos-in-flex | Folds plus existing border paint; DPR snapping already modelled | Same | Existing border fixtures plus DPR lane | S |
| `border-radius` (`0.5rem`, `50%`, `999px`, `1rem`) | 8 | 0/8 `UNSUPPORTED_PROPERTY` | Engine resolves radii with CSS overlap scaling. Uniform: `CALayer.cornerRadius` plus `masksToBounds`. Non-uniform or elliptical: `CAShapeLayer` mask path. | `Outline.setRoundRect` plus `clipToOutline`; `Path` clip otherwise | Paint lane; WPT `css/css-backgrounds` border-radius (32) | M |
| `box-shadow` (outer with spread; inset; multiple) | 5 | 0/5 `UNSUPPORTED_PROPERTY` | Outer: `CALayer.shadowPath` from the engine-inflated spread rect, `shadowRadius` = blur/2 (CSS sigma), `shadowOpacity` 1 with alpha in the colour, one layer per shadow. Inset: Dragon paint (even-odd ring path shadow clipped to the padding box). | Elevation does not match CSS (light model), so: Dragon-owned blur. `RenderEffect.createBlurEffect` on a RenderNode (API 31+) or a precomputed Gaussian nine-patch from a Dragon shader for older SDKs. Inset the same way, clipped. | Paint lane; WPT `css/css-backgrounds` box-shadow (82) | L |
| `opacity` | 6 | 0/6 `UNSUPPORTED_PROPERTY` | `CALayer.opacity` (group opacity on) | `RenderNode.setAlpha` with overlapping rendering (offscreen layer = CSS group opacity) | Paint lane; WPT `css/css-color` opacity | S |
| `transform` (`translate(-50%,-50%)`, `translateX(%)`, `rotate()`, `scale(1.08)`), `transform-origin` | 11, 1 | 0/11, 0/1 `UNSUPPORTED_PROPERTY` | Engine computes the matrix from the used box size and origin (percentages resolve against the box); `CALayer.transform` with `anchorPoint`; hit-testing inverse-maps | RenderNode `setAnimationMatrix`, or Canvas `concat` in Dragon paint | Paint lane plus a hit-test unit test; WPT `css/css-transforms` (1238) | M |
| `will-change: transform` | 1 | `UNSUPPORTED_PROPERTY` | Engine: creates a stacking context only (no paint of its own) | Same | Paint-order fixture | S |
| `color` | 14 | 1/14: `var()` | Fold, then the text colour route | Same | Existing | S |
| `color-scheme: dark` | 1 | `UNSUPPORTED_PROPERTY` | Dark UA dataset for anything the UA paints (controls, scrollbars); `overrideUserInterfaceStyle = .dark` for foreign views | `forceDarkAllowed = false` plus night-mode configuration for foreign views | UA dataset capture in dark mode; WPT `css/css-color-adjust` | S–M |
| `object-fit` (`cover`, `contain`) | 2 | 0/2 `UNSUPPORTED_PROPERTY` | Engine computes the destination rect (css-images-3); paint through the `img` route | Same | WPT `css/css-images` object-fit | S |

### Text (text-engine hooks)

| Property | Uses | Dragon today | Route iOS / Android | Proof | Size |
|---|---:|---|---|---|---|
| `font-family: 'Lato', sans-serif` | 1 (reaches 21 text nodes) | `UNSUPPORTED_VALUE` and `UNSUPPORTED_FONT` | Text engine per the text-strategy spike. Bundle one OFL font as `sans-serif` for Chrome and native alike. Core Text / TextKit; `StaticLayout` / `Paint`. | Real-font text lane | XL (shared) |
| `font` (`inherit` on `button`, `input`, `iframe`) | 1 | `UNSUPPORTED_PROPERTY` | Build-time shorthand fold to the font longhands | WPT `css/css-fonts` | S |
| `font-size` | 7 | 0/7: `rem`, `@media` | `rem` fold; the font size passes to the text engine | Text lane | S |
| `font-weight: 400` (plus UA bold on `h1`–`h3`) | 1 | `UNSUPPORTED_PROPERTY` | Text engine: face selection by weight (bundled 400 and 700 faces) | Text lane; WPT `css/css-fonts` | M |
| `line-height` (`1`, `1.15`, `1.4`) | 3 | 2/3: one inside `@media` | Supported path plus `@media` | Existing | – |
| `letter-spacing: 0` | 1 | `UNSUPPORTED_PROPERTY` | Text engine: tracking (`kern` attribute / `Paint.letterSpacing` in em) | WPT `css/css-text` letter-spacing | S |
| `text-align: center` / `left` | 4 | 1/4: text in a flex column item unproven, `@media` | Engine line alignment; add the context fixtures | Parity fixtures | S |
| `white-space: normal` | 1 | inside `@media` | Existing line breaker | Existing | S |
| `overflow-wrap: break-word` / `anywhere` | 4 | 0/4 `UNSUPPORTED_PROPERTY` | Dragon line breaker in the engine (course correction 2). `anywhere` also affects min-content size. | WPT `css/css-text/overflow-wrap` (63) | M |
| `text-decoration-color`, `text-underline-offset` (plus UA underline on `a`) | 1, 1 | `UNSUPPORTED_PROPERTY` | Dragon-owned underline paint: engine gives the baseline, thickness from font metrics, and offset. Native attributed-string underlines cannot take an offset. | Paint lane; WPT `css/css-text-decor` (616) | M |

### Interaction and motion (runtime helpers)

| Property | Uses | Dragon today | Route iOS | Route Android | Proof | Size |
|---|---:|---|---|---|---|---|
| `transition` (`margin-right 0.5s ease`; `all 0.3s ease`; `color`, `transform`, `opacity` at 0.2–0.5s) | 4 | `UNSUPPORTED_PROPERTY` | Runtime diffs the two precomputed cases on a state change. Paint properties use `CABasicAnimation` with `CAMediaTimingFunction(0.25, 0.1, 0.25, 1)`. Layout-affecting properties (`margin-right`) relayout per frame through the engine (`CADisplayLink`). | `ValueAnimator` with `PathInterpolator(0.25f, 0.1f, 0.25f, 1f)`; per-frame relayout via `Choreographer` | Paint lane at fixed transition times (Chrome `Animation.currentTime`); WPT `css/css-transitions` (203) | L |
| `animation`, `animation-play-state` | 1, 2 | `UNSUPPORTED_PROPERTY` | See `@keyframes`. Pause with `layer.speed = 0` and `timeOffset`; resume keeps the phase. | `Animator.pause()` / `resume()` | Frozen-frame paint lane; WPT `css/css-animations` play-state | M |
| `cursor: pointer` | 2 | `UNSUPPORTED_PROPERTY` | `UIPointerInteraction` hand style (iPadOS pointer); no-op on phones | `setPointerIcon(PointerIcon.TYPE_HAND)` | Runtime unit test | S |
| `pointer-events: none` | 1 | `UNSUPPORTED_PROPERTY` | Dragon hit-testing skips the box (`hitTest` override) | Same (`dispatchTouchEvent` routing) | Hit-test unit test; WPT `css/css-ui` | S |
| `-webkit-appearance: none` | 3 | `UNSUPPORTED_PROPERTY` | Alias of `appearance`. Dragon draws all controls itself, so `none` means no UA control paint. | Same | WPT `css/css-ui` appearance | S |
| `outline: none` | 1 | `UNSUPPORTED_PROPERTY` | Focus-ring suppression (with `:focus`) | Same | Runtime test | S |
| `scrollbar-color`, `scrollbar-width: thin` | 1, 1 | `UNSUPPORTED_PROPERTY` | Dragon-owned scroll indicators: `showsVerticalScrollIndicator = false`, plus a Dragon thumb layer (`rgba(155,155,155,.5)`, thin width from the UA dataset) driven by the content offset | `isVerticalScrollBarEnabled = false` plus a Dragon-drawn thumb | Capture of the scrolled library without `--hide-scrollbars`; WPT `css/css-scrollbars` (109) | M |

## 6. Attributes

`DRAGON_UNSUPPORTED_ATTRIBUTE` fires 40 times: only `ui-*` attributes are accepted. None of these attributes is used for
matching except `type` (see `[type='range']`), so the route is to carry them as element data rather than reject them.

| Attribute | Uses | Route | Size |
|---|---:|---|---|
| `type` | 11 | Selects the element kind (`range` becomes the slider). Folded into `[type]` matching. | S |
| `src`, `alt` | 5, 5 | Asset binding. `alt` becomes the accessibility label. | S |
| `aria-label` | 3 | `accessibilityLabel` / `contentDescription` | S |
| `href`, `rel`, `target` | 2 each | Link runtime helper | S |
| `min`, `max`, `value` | 1 each | Slider model | S |
| `data-*` | 6 | Passed through to the app runtime | S |
| `lang` | 1 | Text-engine locale (line breaking) | S |

## 7. Chrome facts the native side must reproduce

These come from `chrome/*/main.boxes.json`.

- **The mini-video placeholder** is 360x202.5 at (12,12) on both devices. It is fixed, at z-index 20, and covers the top of
  the record.
- **DPR 2.625 border snapping.** The 1px shell border snaps to 2 device px there, so the placeholder starts at 12.762.
- **The record** is `min(72vw, 18rem)`: 280.8 px at 390 wide and 288 px at 412 wide.
- **The library sheet** is `width: 100%` and translated fully off-screen at x = viewport width in the main state.
- **The range input** occupies the full `.track` box (176x16) and paints nothing. The visible bar is `.track`'s gradient
  under the `--track-mask` overlay.
- **`::-moz-range-thumb` is ignored by Chrome**, and so are the `::-webkit-scrollbar*` rules, which are superseded by
  `scrollbar-color`/`scrollbar-width`.
