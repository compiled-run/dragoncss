# T015: Which CSS to support on native, ranked by real use

Scout note, read-only research. All web sources were accessed on 2026-09-26. **(unverified)** marks a claim taken from a search-engine summary or from memory that was not confirmed on a primary page during this task. "Evaluator" means the small on-device style evaluator proposed in [T011](T011-styling.md) and the report; "build" means the Markless cascade compiler.

## Short answer

What web developers actually write is concentrated in a small core: box sizing, spacing, flex, positioning, colours, fonts, borders, radius, shadows, opacity, transforms, overflow, transitions, custom properties, media queries and the interactive pseudo-classes. Every one of these maps onto UIKit and Android Views at low or moderate cost.

- **Must-have** tier: about 59% of usage-weighted property adoption in Chrome's live counters (method in "Coverage estimate").
- **Must-have + should-have**: about 80%. Adding web-only properties that should compile to documented no-ops, plus `@font-face` descriptors, the handled share is about 89%.
- **What remains:** SVG paint, masks and blend modes, CSS filters other than opacity and drop-shadow, 3D, anchor positioning, view transitions, floats, multi-column, tables and writing modes. That is roughly 11%, split into later (8%) and never (3%).

Measured by property adoption this looks nearly complete. The real risk is at the value level, not the property level:

- **Inline formatting.** `display: inline`/`inline-block` inside text, and styled `<span>`/`<a>` inside paragraphs, appear on about 90% of pages.
- **Per-side borders.** `border-bottom` is used on 74% of pages, but UIKit only has uniform layer borders.
- **`position: sticky`** (30%) and **`position: fixed`**.
- **Scrolling semantics.** Which element scrolls, plus the safe area and keyboard.

These need deliberate designs, and each is covered below. The recommended range:

- **Must-have:** flex, block-as-flex-column or Taffy block, absolute/relative positioning, box model, per-side borders, radius, box-shadow, colours (including build-time oklch), linear and radial gradients, fonts with Dynamic Type, text overflow and line clamp, inline text runs as attributed strings, opacity, 2D transforms, transitions, custom properties, calc/min/max/clamp, the core selectors with `:not`/`:is`/`:where`, nesting, `@layer`, width/colour-scheme/reduced-motion media queries, safe-area `env()`, logical properties and RTL, and px/rem/em/%/viewport units.
- **Should-have:** CSS grid (Taffy), sticky, fixed, scroll snap and overscroll, keyframes, `backdrop-filter` blur approximated by native materials, `::before`/`::after` as build-time child nodes, `:has()` with static subjects, sibling combinators, container size queries, `@supports` evaluated per target, `@property`, `color-mix`/`light-dark`, text-wrap balance and pretty, and outline and focus rings.

## Data sources and their limits

| Source | What it measures | Limits |
|---|---|---|
| Chrome Platform Status CSS property counters, JSON at [chromestatus.com/data/csspopularity](https://chromestatus.com/data/csspopularity) (data date 2026-09-24, 952 properties) | Share of Chrome page loads whose stylesheets use each property | Weighted by page loads, so popular sites count more. Includes legacy and CMS CSS. Property-level only, with no values (cannot tell `display: flex` from `inline-block`). |
| Chrome feature counters, JSON at [chromestatus.com/data/featurepopularity](https://chromestatus.com/data/featurepopularity) (2026-09-24) | Selectors, at-rules, media features and some values (for example `PositionSticky`, `CSSGridLayout`, `CSSSelectorPseudoHas`) | Same weighting. `:hover` and `:active` have no counter. |
| [Web Almanac 2022 CSS chapter](https://almanac.httparchive.org/en/2022/css) | Share of the crawled pages, plus some shares within one feature | **The latest CSS chapter.** The 2024 and 2025 editions have none: `/en/2024/css` and `/en/2025/css` return 404, and the [2025 table of contents](https://almanac.httparchive.org/en/2025/) lists 16 chapters without CSS. Data is from 2022. |
| State of CSS 2025, pulled through the Devographics GraphQL API (`api.devographics.com/graphql`, `surveys.state_of_css.css2025.<section>.<feature>.responses.currentEdition`); results site [2025.stateofcss.com/en-US/features](https://2025.stateofcss.com/en-US/features/) | "Used it" share among respondents | A self-selected, enthusiast audience. It measures what developers have tried, not what ships. It shows what new-style app developers expect. |
| Tailwind CSS v4 docs ([variants](https://tailwindcss.com/docs/hover-focus-and-other-states), [colors](https://tailwindcss.com/docs/colors), [v4 release](https://tailwindcss.com/blog/tailwindcss-v4)) | Proxy for app-style UI CSS | Tailwind's defaults are what component-style apps emit. v4 output uses `@layer`, `@property`, `oklch()` and `color-mix(in oklab, …)`. |

### Top properties by Chrome page adoption (2026-09-24)

Ranks are out of 952 properties.

| Rank | Property | % pages | | Rank | Property | % pages |
|---|---|---|---|---|---|---|
| 1 | display | 93.1 | | 32 | box-shadow | 81.8 |
| 2 | width | 92.5 | | 33 | vertical-align | 81.3 |
| 4 | position | 91.2 | | 34 | white-space | 81.2 |
| 5 | margin | 90.9 | | 37 | content | 80.4 |
| 7 | color | 90.2 | | 38 | transition | 79.7 |
| 8 | border | 89.9 | | 39 | align-items | 79.7 |
| 10 | font-size | 89.4 | | 51 | flex-direction | 74.8 |
| 13 | font-family | 88.0 | | 53 | border-bottom | 73.8 |
| 18 | opacity | 86.7 | | 56 | float | 72.2 |
| 19 | overflow | 86.5 | | 60 | custom properties (`variable`) | 71.1 |
| 20 | z-index | 86.2 | | 65 | animation | 68.9 |
| 21 | line-height | 85.6 | | 74 | text-overflow | 65.5 |
| 22 | border-radius | 85.6 | | 76 | gap | 65.3 |
| 25 | transform | 84.0 | | 96 | filter | 53.1 |

Further down:

- Layout: grid-template-columns #106 (48.2%), inset #112 (46.0%), aspect-ratio #135 (38.0%).
- Text and effects: -webkit-line-clamp #124 (44.2%), text-shadow #115 (45.9%), backdrop-filter #140 (35.9%), mix-blend-mode #267 (13.6%).
- Logical properties: margin-inline-start #154 (31.2%).
- Newer features: container-type #199 (21.1%), view-transition-name #278 (12.6%), anchor-name #351 (6.3%), position-area #471 (1.0%).

### Selectors, at-rules and values (Chrome feature counters, % of page loads)

| Area | Counters |
|---|---|
| At-rules and layout modes | `@media` 83.9 · flexbox 83.7 · `@keyframes` 81.2 · `@font-face` 71.7 · `@supports` 53.0 · grid 45.7 · `@container` 24.9 · `@property` 18.7 · `@view-transition` 11.8 · nesting 10.0 · `@layer` 7.1 · `@scope` 0.9 |
| Selectors | `:not()` 84.1 · `:focus` 80.9 · `~` sibling 64.3 · `:focus-visible` 58.3 · `:has()` 54.4 · `:where()` 36.7 · `:is()` 34.4 · `:nth-child(… of S)` 8.5 |
| Media features | prefers-reduced-motion 57.9 · prefers-color-scheme 45.7 · forced-colors 37.3 · prefers-contrast 26.7 |
| Values and functions | `position: sticky` 29.8 · line-clamp 25.9 · `color-mix()` 17.9 · relative colour 12.9 · `display: contents` 12.9 · safe-area-inset-bottom `env()` 10.6 · `light-dark()` 1.6 · anchor positioning 1.6 · subgrid 0.6 · style container queries 0.4 |

From the [2022 Almanac](https://almanac.httparchive.org/en/2022/css):

- Layout: flexbox 74% of pages, grid 12%, floats 89%, inline-block 90%. Clearfix fell to 10%.
- Pseudo-classes: `:hover` 91%, `:focus` 76%, `:active` 73%, `::before` 41%, `::after` 38%.
- Other adoption: custom properties 43%, `transition` 85%, `@supports` 40% (the most-tested feature is `position: sticky`), logical properties 5%, blend modes 18% of desktop pages.
- Pixel lengths are "the most popular at 71%". The page is ambiguous about whether that is a share of lengths or of pages.

### State of CSS 2025 "used it" (Devographics API)

| Feature | Used | | Feature | Used |
|---|---|---|---|---|
| `:has()` | 80.6 | | `@container` size | 41.8 |
| aspect-ratio | 76.6 | | color-scheme | 39.5 |
| intrinsic sizing | 75.4 | | subgrid | 29.8 |
| min/max/clamp | 69.8 | | cascade layers | 29.5 |
| scroll-behavior | 68.4 | | color-mix | 25.9 |
| backdrop-filter | 66.4 | | `@property` | 25.4 |
| nesting | 64.8 | | wide-gamut colours (oklch etc.) | 24.6 |
| viewport units (dvh etc.) | 49.6 | | light-dark | 22.8 |
| `@supports` | 49.6 | | view transitions | 21.0 |
| text-wrap balance | 49.5 | | writing modes | 16.3 |
| logical properties | 48.4 | | scroll-driven animations | 13.6 |
| line-clamp | 47.4 | | anchor positioning | 12.1 |
| blend modes | 42.7 | | `@container` style | 7.3 |
| scroll snap | 42.4 | | `@scope` | 7.5 |

Also from the survey:

- The layout pain points are led by grid (272 mentions) and flexbox (125) ([features page](https://2025.stateofcss.com/en-US/features/)).
- line-clamp is the typography pain point that most often draws negative comment.

## Ranked feature groups with native mapping and tier

Rank reflects combined adoption from the Chrome counters, with State of CSS as the tiebreaker for app-style code.

Cost column:

- **B** means build-time only: zero device cost.
- **E** means on-device evaluator work: condition bits, variable lookup, restyle diff.
- **L** means layout engine work.
- **P** means paint/adapter code in the view layer.

| # | Group (key evidence) | UIKit mapping | Android Views mapping | Cost | Precedent | Tier |
|---|---|---|---|---|---|---|
| 1 | **Box model and sizing**: width/height/min/max 78–93%, box-sizing 85%, aspect-ratio 38% | Layout engine output assigned to `frame` | Layout output set via `layout()` | L | Yoga and Taffy (both have box-sizing and aspect-ratio); RN `aspectRatio` | must |
| 2 | **Flexbox**: 83.7% pages, gap 65% | Yoga or Taffy | same engine through JNI | L | universal (Yoga, Taffy, Lynx, Valdi, NativeScript FlexboxLayout) | must |
| 3 | **`display` values** (93%) | `none` removes the node from layout and hides the view; `contents` is flattened at build (Yoga 3.2 also has it) | same | B+L | RN supports flex/none/contents only ([layout props](https://reactnative.dev/docs/layout-props)) | must for flex/none/contents/block; inline values see Q1 |
| 4 | **Block layout** | Yoga: a documented flex column. Taffy: real block layout (margin-collapsing fidelity not checked). Lynx documents that it has no margin collapsing (T011). | same | L | Taffy block; Lynx "linear" | must (flex-column fallback), exact with Taffy |
| 5 | **Positioning**: position 91%, top/left 89%, z-index 86%, inset 46% | `absolute`/`relative` in the engine; z-index sets subview order or `layer.zPosition` within the stacking parent | `translationZ`/child order | L+P | Yoga, Taffy, RN (`static` added in Yoga 3) | must |
| 6 | **Colours and backgrounds**: color 90%, background-color 89%, gradients 68.8% (`CSSGradient`) | Static colours become `UIColor` at build: oklch/lab/`color(display-p3)` convert to extended-sRGB or P3 `UIColor`. Gradients use `CAGradientLayer` (.axial/.radial/.conic). The CSS angle depends on the box size, so start and end points are recomputed on layout. | `Color.valueOf` (wide gamut on API 26+); `LinearGradient`/`RadialGradient`/`SweepGradient` shaders or `GradientDrawable` | B for static colours, P for gradients | RN `experimental_backgroundImage` supports linear and radial ([view style props](https://reactnative.dev/docs/view-style-props)); Lynx gradients | must (conic and repeating: should) |
| 7 | **Borders and radius**: border 90%, border-bottom 74%, radius 86%, per-corner radii about 52% | Uniform borders use `layer.borderWidth/borderColor`. Per-side or dashed borders need `CAShapeLayer` sublayers, and per-corner radius uses `maskedCorners` or a path mask. `cornerCurve = .continuous` gives the iOS squircle (CSS `corner-shape` is a possible mapping **(unverified)**). | `GradientDrawable` (uniform stroke, `setCornerRadii`); per-side borders need custom drawing | P | RN per-side borders and radii | must |
| 8 | **Typography**: font-size 89%, family 88%, weight 88%, line-height 86%, letter-spacing 68%, text-transform 72%, text-decoration 83%, `@font-face` 72% | `UIFont` plus attributed-string attributes (`.kern`, `NSParagraphStyle` line height with baseline adjustment, `.underlineStyle`). `@font-face` fonts are bundled at build and registered (`CTFontManagerRegisterFontsForURL`). `system-ui` maps to SF Pro. | `Typeface`/res font, `setLineHeight` (API 28), `letterSpacing` in em, spans | B+P | RN Text, Lynx, NativeScript | must |
| 9 | **Dynamic type / font scaling** (no web counter; `rem` is the web analogue) | `UIFontMetrics(forTextStyle:).scaledValue(for:)`; `adjustsFontForContentSizeCategory`. WebKit already exposes `font: -apple-system-body` **(unverified)**. | `sp` units scale with the font scale setting | E (reruns on trait change) | RN `allowFontScaling`; Flutter `textScaler` | must, but the default is an owner question (see Q4) |
| 10 | **Text overflow and clamping**: white-space 81%, text-overflow 65%, line-clamp 44%, word-break 57% | `numberOfLines` + `lineBreakMode = .byTruncatingTail`; `nowrap` sets `numberOfLines = 1` | `setMaxLines` + `setEllipsize(END)`; `setSingleLine` | P | RN `numberOfLines`; Lynx has text-overflow but no line-clamp | must |
| 11 | **Inline text runs** (styled span/strong/a/code inside `<p>`) | One text view per paragraph holding an `NSAttributedString`, with runs from the cascade. Links and handlers hit-test by character index (TextKit). See Q1. | `SpannableString` with `StyleSpan`, `ForegroundColorSpan`, `ClickableSpan` | B (run table) + P | RN nested `<Text>` produces an `NSAttributedString`/`Spannable` ([RN nested views commit](https://github.com/react/react-native/commit/fe5c0d2d0696b4fc5cdd65f1f2198c4f4363e543)); Flutter `TextSpan`/`WidgetSpan` | must |
| 12 | **Opacity and visibility**: 87%, 80% | `alpha`, `isHidden` (keeps layout space, like the CSS behaviour) | `alpha`, `INVISIBLE` | P | universal | must |
| 13 | **Transforms**: transform 84%, translate/scale/rotate 15–17% | `layer.transform` / `CGAffineTransform`; `transform-origin` maps to `anchorPoint` (compensating the position) | `translationX`, `scaleX`, `rotation`, `pivotX` | P | RN, Lynx | must (2D); 3D perspective and backface: later |
| 14 | **Box shadow**: 82% | `layer.shadowColor/Offset/Radius/Opacity`. Set `shadowPath` for performance; spread adjusts the path; clipping with `overflow: hidden` needs a wrapper layer. Multiple shadows mean extra layers; inset is a masked inner layer. | Elevation cannot express arbitrary blur, offset and colour, so custom drawing is needed | P | RN 0.76 `boxShadow` (outset on Android 9+, inset on 10+) | must (outset); inset: should |
| 15 | **Overflow and scrolling**: overflow 87%, overflow-y 69%, overscroll-behavior 22%, scroll-snap 19%, scroll-behavior 24% | `hidden` sets `clipsToBounds`. `auto`/`scroll` wrap the node in a `UIScrollView` sized by the engine's scrollable-overflow result. See Q3. | `ScrollView`/`HorizontalScrollView`/`NestedScrollView` | L+P | RN ScrollView; Lynx scroll-view | must (clip, scroll); snap and overscroll: should |
| 16 | **Transitions**: 80–85% | The evaluator diffs the old and new computed values, then runs `CABasicAnimation` with `CAMediaTimingFunction(controlPoints:)`. Layout properties animate inside `UIView.animate { layoutIfNeeded }`. See Q5. | `ViewPropertyAnimator` / `ObjectAnimator` + `PathInterpolator` | E+P | Lynx transitions; NativeWind experimental | must (opacity, transform, colours, radius, shadow); layout-affecting: should |
| 17 | **Custom properties**: 71% pages; 43% in 2022 | Constant variables are inlined at build. Variables set conditionally are looked up along the known host chain on the device. | same | B+E | react-native-css (inlines single-use variables), Lynx 3.7, NativeScript | must |
| 18 | **calc/min/max/clamp**: SoCSS 69.8%, calc in width on 27% of pages (2022) | Constant operands fold at build. Expressions that need a percentage go to the engine (Taffy has calc; Yoga does not), or are resolved after the containing block is known. | same | B+L | Taffy calc feature; NativeScript calc | must |
| 19 | **Units**: px (71%), %, em/rem, vw/vh/dvh (SoCSS 49.6%) | 1 CSS px = 1 pt: iPhone widths in pt match the CSS widths Safari reports **(unverified)**. rem/em follow the font metrics; viewport units follow the root size (Q4). ch/ex/lh need font metrics: later. | 1 px = 1 dp | B+E | RN supports points and % only ([layout props](https://reactnative.dev/docs/layout-props)); react-native-css inlines rem | must (px, %, rem, em, vw/vh/dvh/svh/lvh, deg, ms); ch/lh/cq units: later |
| 20 | **Selectors, core**: type, class, id, attribute, compound, `:not()` 84%, `:is`/`:where` 34–37%, nesting | All resolved at build into per-node condition lists (T011) | same | B | Lynx, NativeScript (attribute); StyleX bans at-a-distance selectors | must |
| 21 | **Interactive pseudo-classes**: `:hover` 91%, `:focus` 81%, `:active` 73%, `:focus-visible` 58%, `:disabled`/`:checked` | `:active` = touch down (UIControl highlighted). `:hover` = `UIHoverGestureRecognizer` (iPad pointer, visionOS), and should only match when `(hover: hover)`, as Tailwind does. `:focus-visible` = the focus engine with a hardware keyboard. Form states come from the element. | pressed state, `onHover` (mouse), focus | E (condition bits) | Lynx `:active`/`:hover`; RN Pressable state; NativeWind needs an event prop | must |
| 22 | **Structural pseudo-classes** (`:first-child`, `:last-child`, `:nth-child`) | Static lists resolve at build; keyed lists give the evaluator an index bit | same | B/E | Tailwind `first:`/`odd:` | should |
| 23 | **Relational selectors**: `~` 64%, `+`, descendant, child, `:has()` 54% (SoCSS 80.6%) | Only when the related node is fixed by the template: becomes a condition on that node's state (T011). Open-ended matching is rejected. | same | B+E | Lynx (combinators, no `:has`); none have `:has` on native | should (static only); open-ended: never |
| 24 | **`::before`/`::after`** (content 80%, 38–41% of pages in 2022) | Build creates a synthetic child node (text or image) styled from the pseudo-element rules | same | B | none on native: Lynx has no pseudo-elements | should |
| 25 | **Cascade and `@layer`**: 7.1% of pages; SoCSS 29.5%; Tailwind v4 and @markless/ui depend on it | Build-time ordering | same | B | none on retained views (T011) | must (Markless's own headless defaults need it) |
| 26 | **Media queries**: `@media` 84%, width 79–83%, reduced-motion 58%, colour scheme 46%, orientation 30% | `traitCollection` (size class, `userInterfaceStyle`), `UIAccessibility.isReduceMotionEnabled`, window size | `Configuration` (`uiMode` night, `screenWidthDp`, orientation), `ValueAnimator.areAnimatorsEnabled()` | E (environment bits) | Lynx 4.0, NativeWind, NativeScript | must |
| 27 | **Dark mode**: prefers-color-scheme 46%, color-scheme 24%, `light-dark()` 1.6% (SoCSS 22.8%) | `UIColor(dynamicProvider:)` makes `light-dark()` and colour-scheme branches native dynamic colours, with no restyle pass | `values-night` / `uiMode` change | B (dynamic colours) or E | NativeWind `dark:`; Lynx | must (media); `light-dark()`: should |
| 28 | **Safe areas**: safe-area `env()` about 10.6% for bottom | `env(safe-area-inset-*)` = `view.safeAreaInsets` | `WindowInsetsCompat` (systemBars and displayCutout) | E | RN safe-area-context; NativeWind `p-safe` **(unverified)** | must (see Q4) |
| 29 | **Logical properties and RTL**: margin-inline-start 31%, direction 46%; SoCSS 48.4% | `semanticContentAttribute`; the engine's `direction` flips start/end (Yoga has it; Taffy added `direction` for block, flex and grid ([changelog](https://github.com/DioxusLabs/taffy/blob/main/CHANGELOG.md))); `NSParagraphStyle.baseWritingDirection` | `setLayoutDirection`, `start`/`end` | B+L | RN start/end props; Lynx logical properties | must |
| 30 | **CSS grid**: 45.7% of pages; SoCSS pain point #1 | Taffy only. Yoga grid was abandoned (T011). | Taffy | L | Taffy, Lynx | should (needs Taffy); template areas: should; subgrid (0.6%): later |
| 31 | **Keyframe animations**: `@keyframes` 81%, animation 69% | `CAKeyframeAnimation` (`keyTimes`, per-segment `timingFunctions`); iteration count maps to `repeatCount`; `alternate` maps to `autoreverses`; `fill-mode` maps to `fillMode` | `ObjectAnimator` with `PropertyValuesHolder` + `Keyframe` | B (tables) + P | Lynx 3.7 keyframes; NativeScript keyframes | should |
| 32 | **Sticky and fixed**: sticky 29.8%; fixed is not counted separately | Sticky: offset recomputed in the scroll view's `scrollViewDidScroll` (Q2). Fixed: reparent to the screen root as absolute. | `OnScrollChangeListener` + `translationY` | E+P | Lynx has sticky (a direct child of scroll-view before 3.9) and fixed-as-root-absolute ([position](https://lynxjs.org/api/css/properties/position.html)); RN `stickyHeaderIndices` | should |
| 33 | **Backdrop filter**: 35.9% of pages; SoCSS 66.4% | `UIVisualEffectView`, with a blur radius snapped to the nearest `UIBlurEffect.Style` material; there is no public custom radius ([styles](https://developer.apple.com/tutorials/data/documentation/uikit/uiblureffect/style.json)) | `RenderNode.setBackdropRenderEffect` on API 37.2+, else a BlurView-style capture ([search summary](https://github.com/chrisbanes/haze/pull/1278)) **(partly unverified)** | P | Expo BlurView; Lynx lacks it ([properties](https://lynxjs.org/api/css/properties.html)) | should (documented approximation) |
| 34 | **Outline and focus rings** (77%) | Border-like layer outside the bounds | custom drawing | P | RN 0.77 outline props | should |
| 35 | **Container queries**: `@container` 24.9%; SoCSS 41.8% | Q7 | same | E+L (two passes) | NativeWind and react-native-css claim them | should (size only); style queries: later |
| 36 | **`@supports`**: 53% | Evaluated per target profile at build, so it becomes the portable "platform capability" switch | same | B | none | should |
| 37 | **`@property`, `color-mix`, relative colour**: 18.7%, 17.9%, 12.9% | Typed variables and colour maths in the evaluator (oklab mixing is a small function); constant results fold at build | same | B/E | Tailwind v4 emits both | should |
| 38 | **text-wrap balance and pretty**: text-wrap 24%; SoCSS 49.5% / 41.7% | `NSParagraphStyle.lineBreakStrategy` **(unverified mapping)** | `setBreakStrategy(BREAK_STRATEGY_BALANCED)` | P | none | should (best-effort) |
| 39 | **Filters**: filter 53% | `CALayer.filters` is "not supported on layers in iOS" ([Apple](https://developer.apple.com/tutorials/data/documentation/quartzcore/calayer/filters.json)). `opacity()` maps to alpha and `drop-shadow()` to a layer shadow (alpha-shaped by default). Blur, grayscale etc. need snapshot + CIFilter (static) or private API. | `RenderEffect` blur and colour-matrix (API 31) covers every CSS filter function | P | RN: iOS supports only brightness and opacity "due to issues with performance and spec compliance" ([view style props](https://reactnative.dev/docs/view-style-props)) | opacity and drop-shadow: should; the rest: later (iOS gap) |
| 40 | **Mask, clip-path, blend modes**: mask about 21–31%, clip-path 46%, mix-blend-mode 13.6% | `layer.mask` (`CAShapeLayer` for basic shapes); `compositingFilter` for blend modes (not guaranteed on iOS) | `clipToOutline` / `Path` clipping; `setBlendMode` via `Paint` (API 29) | P | RN clip-path (Callstack, 2026); RN mixBlendMode (Android 10+) | later |
| 41 | **SVG paint properties**: fill 65%, stroke 43–46% | Only meaningful with an SVG renderer (for example CAShapeLayer from a parsed path) | VectorDrawable | P | react-native-svg | later (with an `<svg>` element story) |
| 42 | **3D transforms**: perspective 9.5%, backface 25% | `CATransform3D` with m34 | `cameraDistance`, `rotationX/Y` | P | Lynx perspective | later |
| 43 | **View transitions**: `@view-transition` 11.8%, view-transition-name 12.6%; SoCSS 21% | Q5 | shared-element transitions with `transitionName` | E+P | Android `transitionName` is a direct analogue | later (with native navigation) |
| 44 | **Scroll-driven animations, anchor positioning, `@scope`**: 6.0%, 1.6%, 0.9% | Anchor positioning becomes a placement record for the overlay adapter (T011/report) | same | B+E | none | later (anchor: as already planned for headless) |
| 45 | **Floats**: float 72%, clear 59%, overwhelmingly legacy | Taffy `float_layout` can float boxes. Text wrapping around a float would need `NSTextContainer.exclusionPaths` (iOS only). | no exclusion paths | L | Taffy only | never for text wrap (diagnose, suggest flex); block floats: later if free |
| 46 | **Multi-column, tables-as-CSS, writing modes, counters/quotes, `forced-colors`, print** | none sensible | none | – | none | never (diagnose) |
| 47 | **Web-only properties** (`-webkit-font-smoothing`, `-webkit-tap-highlight-color`, `appearance`, `text-size-adjust`, scrollbar styling, `will-change`, `contain`, `content-visibility`, `zoom`): 7.5% of the weight | no effect | no effect | B | – | accept as a documented no-op, with a build note rather than an error, so shared CSS compiles |

## Hard questions

### Q1. Inline formatting and text flow

**Proposal.** The compiler finds an inline formatting context at build time: an element whose children are only text and phrasing elements (`span`, `strong`, `em`, `b`, `i`, `a`, `code`, `small`, `sub`, `sup`, `mark`, `br`, `img`). It emits one native text node for it and a run table.

- Each run carries the cascaded inline properties: font, colour, background colour, decoration, letter-spacing, `vertical-align: super/sub` as a baseline offset.
- On iOS it becomes an `NSAttributedString` in a `UILabel`, or in a `UITextView` when it needs selection or links. On Android it becomes a `SpannableString` in a `TextView`.
- Dynamic text from state rewrites only that paragraph's runs and remeasures that one text node, through the layout engine's measure callback (T011).
- Handlers on an inline element (`<a onClick>`, `<span onClick>`) become character-range hit targets: TextKit hit-testing on iOS, `ClickableSpan` on Android.

**What breaks, or needs a rule:**

- **Box properties on inline runs.** Padding, border, radius and margin on a `<span>` (pill badges inside text) have no attributed-string attribute; a run background is a plain rectangle. Custom TextKit 2 fragment drawing could add rounded run backgrounds later. At first, report them at build time.
- **Inline images** (`<img>` inside `<p>`) become an `NSTextAttachment` / `ImageSpan`. They need a known size, and the attachment sits on the baseline, so bounds must be adjusted for `vertical-align: middle`. React Native hit the same constraints: sizes must be explicit, clipping differs because the view is hoisted, and line-height offsets are wrong on iOS ([RN #9059](https://github.com/facebook/react-native/issues/9059), [NSTextAttachmentViewProvider](https://developer.apple.com/documentation/uikit/nstextattachmentviewprovider)).
- **`inline-block` elements inside text** (a button or badge component mid-sentence) need a placeholder attachment with a real view laid over it after text layout. That is React Native's approach, and it is fragile (above; the TextKit 2 view provider falls back to TextKit 1 if `layoutManager` is touched). Tier: later.
- **`inline-block`/`inline-flex` without surrounding text.** This is the common web case: a row of buttons or icons in a block parent. A run of inline-level boxes with no text siblings lowers to a wrapping flex row aligned to the baseline, plus a build note. This is a heuristic, and it matches almost all app usage.
- **Floats and text wrap** are never supported (above). `::first-letter` and `::first-line` are later.
- **Block inside inline** (for example a `<div>` inside a `<span>`) is a build error, as it already is in HTML content models.

```tsx
export function Notice(props) @{
  <p class="notice">
    Your trial ends <strong>{props.date}</strong>. <a href="/billing" class="link">Upgrade</a>
    <span class="badge">new</span>
  </p>
  <style>
    .notice { font: 15px/1.4 system-ui; color: var(--fg); }
    .link { color: var(--accent); text-decoration: underline; }
    .badge { background: var(--accent); color: white; border-radius: 999px; padding: 0 6px; }
  </style>
}
```

```text
build --target ios:
  p.notice      -> TextNode(runs: [plain, strong{weight 700}, plain, link{color var(--accent), underline, href /billing}, plain, badge])
  .badge        -> warning MLS-NATIVE-INLINE-BOX: border-radius/padding on an inline run in text are not rendered on ios;
                   run background is a rectangle. Use display:inline-flex outside text, or accept the approximation.
on device:      props.date changes -> rebuild runs for this TextNode only -> remeasure -> relayout its ancestors
```

### Q2. `position: sticky`

**How often:** 29.8% of page loads; it is also the most-tested `@supports` feature in 2022.

**Native equivalents:**

- Neither UIKit nor Android Views have a general sticky primitive. `UICollectionView` has pinned section headers, and React Native uses `stickyHeaderIndices`.
- Lynx implements CSS sticky itself, limited to direct children of a scroll view before 3.9 ([Lynx position](https://lynxjs.org/api/css/properties/position.html)).

**Proposal:**

- The layout engine computes the normal position.
- The scroll container adapter gets a sticky list from the build: node, inset, and containing block.
- On each `scrollViewDidScroll` (or `OnScrollChangeListener`), the adapter sets `transform`/`translationY` to `clamp(0, scrollOffset + inset − normalTop, containingBlockBottom − normalBottom)`.
- This is synchronous on the main thread and cheap, so there is no layout pass and no frame polling.

**Rules:**

- A sticky node must have a statically known scroll-container ancestor; otherwise the build reports it.
- Sticky inside a virtualised list is a list-adapter concern (pinned headers), outside this range.

**Tier:** should.

### Q3. Overflow, scrolling semantics, native scroll feel

**Rules:**

- `overflow: hidden`/`clip` sets `clipsToBounds` / `clipChildren`.
- `overflow: auto|scroll` on an axis makes that node a scroll container.
- The adapter wraps its children in a `UIScrollView` whose `contentSize` is the engine's scrollable overflow. Taffy reports scrollable overflow, including RTL start-side fixes ([changelog](https://github.com/DioxusLabs/taffy/blob/main/CHANGELOG.md)).

**Native feel for free:** bounce, deceleration, scroll indicators, scroll-to-top on status-bar tap, and keyboard dismissal on drag, as an opt-in.

**Web-to-native mapping:**

- `overscroll-behavior: none|contain` sets `bounces`/`alwaysBounceVertical`; on Android, `overScrollMode`.
- `scroll-snap-type` + `scroll-snap-align` become a `scrollViewWillEndDragging` target-offset adjustment. `isPagingEnabled` only covers the full-page case. On Android, `SnapHelper` works on RecyclerView only; plain scroll views need custom fling code.
- `scroll-behavior: smooth` becomes `setContentOffset(animated:)`.
- `scrollbar-*` is a no-op.

**Decision needed (for T016):** on the web the document scrolls. On native, nothing scrolls unless a scroll view exists. Recommended default: each route's root scrolls vertically, like a document. Opting out means `overflow: hidden` on the root. Nested scroll containers need explicit overflow, as on the web.

**Tier:** must (clip, scroll); should (snap, overscroll).

### Q4. Viewport units, safe areas and the keyboard

**Units:**

- On a phone there is no browser chrome, so `svh = lvh = dvh = vh` = the root view's height. `vw` = the width. All four are accepted.
- They are re-evaluated on rotation, split view and window resize (E bits).
- `dvh` keeps its web meaning ("current"), and on native it matches `vh`.

**Safe areas:**

- Follow the web `viewport-fit=cover` model: the viewport covers the whole screen, and `env(safe-area-inset-top|right|bottom|left)` reports `safeAreaInsets` / `WindowInsetsCompat`. The Chrome counter shows web developers already use `env(safe-area-inset-bottom)` (10.6%).
- Open question for T016: whether the default root stylesheet pads the route root by the safe area, as a web page without `viewport-fit=cover` effectively gets.

**Keyboard:**

- Expose the Chromium VirtualKeyboard names `env(keyboard-inset-height)` etc., backed by `UIKeyboardLayoutGuide` (iOS 15) / `WindowInsetsCompat.Type.ime()`. Web usage of the overlay policy is tiny (0.38%), so this is a native extension using an existing web name, not a web habit.
- Default behaviour: the scroll container owning a focused input scrolls it into view, matching `interactive-widget=resizes-content`.

**Dynamic Type:**

- Web `rem` scales with the user's browser font size; `px` does not.
- iOS users expect every text to follow Dynamic Type, and on Android `sp` scales.
- Recommendation: font sizes in any unit scale by `UIFontMetrics` / the font scale by default. Non-font lengths in `rem`/`em` scale too, because they derive from font size. Opt out with `font-size-adjust`-like syntax, or keep a web-exact mode. **Owner decision:** it changes px semantics from the web.

```tsx
export function Screen() @{
  <main class="screen">...</main>
  <footer class="bar">...</footer>
  <style>
    .screen { min-height: 100dvh; padding-top: env(safe-area-inset-top); }
    .bar { position: sticky; bottom: 0; padding-bottom: max(12px, env(safe-area-inset-bottom), env(keyboard-inset-height)); backdrop-filter: blur(20px); }
  </style>
}
```

```text
build --target ios:  100dvh -> root.height (E: window-size bit); env(safe-area-*) -> safeAreaInsets (E: insets bit)
                     backdrop-filter: blur(20px) -> UIVisualEffectView(.systemMaterial)  note: radius snapped to material
                     position: sticky -> sticky record on nearest scroll container (route root)
```

### Q5. Animations: transitions, keyframes, springs, view transitions

**Transitions:**

- The evaluator already diffs old and new computed values. For each changed property in `transition-property`, it starts a native animation from the presentation value (so an interruption retargets smoothly):
  - `CABasicAnimation` on the layer key path;
  - `ObjectAnimator` on Android.
- Timing functions map exactly:
  - `cubic-bezier` becomes `CAMediaTimingFunction(controlPoints:)` / `PathInterpolator`;
  - the keywords are the same curves (for example `ease` = 0.25, 0.1, 0.25, 1);
  - `steps()` becomes a discrete keyframe animation;
  - `linear()` (SoCSS 30.7% used) becomes a keyframe animation whose values are sampled at build.
- Layout-affecting properties (width, height, margin, gap) need a new layout pass. The adapter computes the new layout and applies the frames inside a `UIView.animate` block / a `ValueAnimator` over frames. That animates the result, not every intermediate layout, which differs from the web when content reflows mid-transition. Tier: should.
- `transition: all` (the most animated value on 53% of pages in 2022) is allowed. It is expanded at build to the properties that actually vary between that node's conditional rules, which the compiler knows.
- `prefers-reduced-motion` comes from the system setting. Transitions still run with duration 0, so `transitionend` handlers fire.

**Keyframes:**

- Compiled at build into `CAKeyframeAnimation` tables (`keyTimes`, values, per-segment timing functions).
- `animation-iteration-count`, `direction`, `fill-mode`, `delay` and `play-state` map to `repeatCount`, `autoreverses`, `fillMode`, `beginTime` and layer speed 0 for paused.
- Only compositor-friendly properties at first: opacity, transform, colours, shadow, radius.

**Springs:**

- CSS has no spring function. The options are `linear()` approximations, which Tailwind and web developers already generate, or a native extension.
- Recommendation: recognise `linear()` curves at build only as sampled keyframes. Do not add a `spring()` value, per the "web-like API, no invented syntax" rulings in memory.
- `CASpringAnimation` / `SpringAnimation` remain available to platform code.

**View transitions:**

- `view-transition-name` on a node shared by the old and new routes is the direct analogue of an Android shared-element `transitionName`. iOS needs a custom `UIViewControllerAnimatedTransitioning` (snapshot, then animate the frame) or the iOS 18 zoom transition **(unverified API detail)**.
- Tier: later. It depends on native navigation (report, router section).

### Q6. Filters and backdrop-filter

The platforms are asymmetric:

- **Android 12+** can render every CSS `filter` function live through `RenderEffect` (blur plus colour matrices), and backdrop blur only natively from API 37.2.
- **iOS** has no public live content filters (`CALayer.filters` is unsupported on iOS). Backdrop blur exists only as fixed materials (`UIBlurEffect.Style`).

Recommendation:

- `backdrop-filter: blur()` is **should**, mapped to the nearest material, with a build note giving the mapping. It is the frosted nav bar/sheet idiom that app developers want: 66% of SoCSS respondents have used it. Other `backdrop-filter` functions (saturate etc.) are reported.
- `filter: opacity()` and `drop-shadow()` are **should**.
- `blur`/`grayscale`/`sepia` etc. are **later**. On iOS they would need static snapshots or private API; React Native reached the same place (iOS supports only brightness and opacity).
- Offer `@supports (filter: blur(1px))` as the honest per-target switch: false on iOS, true on Android 12+ (the build knows the minimum OS).

### Q7. Container queries

- **Usage:** `@container` is on 24.9% of page loads, used by 41.8% of SoCSS respondents, and built into Tailwind v4.
- **Semantics:** a size container's own size may not depend on its contents (`container-type: inline-size` applies containment). So evaluation is:
  1. lay out the container's ancestors;
  2. read the container's committed inline size;
  3. set the container-condition bits for its subtree;
  4. restyle;
  5. lay out only that subtree.
- **Cost:** a second layout pass per container whose condition changes, bounded by the containment rule.
- **Build checks:** the compiler knows which nodes are containers (static `container-type`) and which rules depend on them. A rule referencing a container name with no statically known ancestor is a build error.
- **Tiers:** size queries are **should**; style queries (7.3% SoCSS, 0.4% Chrome) are **later**; `cq*` units are **later**.

## Coverage estimate

**Method.** Chrome property counters for properties with at least 1% page adoption (about 400 properties). Each property is classified by the tiers above, and each tier is weighted by the property's page-adoption percentage, as a share of the summed adoption. `alias-webkit-*` names count with their unprefixed group. This is a proxy: property-level presence weighted by page loads, not declaration counts.

| Tier | Share of usage-weighted property adoption | Properties |
|---|---|---|
| must | 59.0% | 163 |
| should | 20.6% | 130 |
| later | 8.3% | 98 |
| never | 2.8% | 26 |
| web-only no-op | 7.5% | 46 |
| `@font-face`/`@property` descriptors (handled at build) | 1.9% | 11 |

- **Must + should: about 80%.** Counting the no-ops and descriptors that compile cleanly, about 89% of real-world property adoption is handled.
- **Top 100 properties:** 80 must, 8 should, 6 web-only, 2 descriptors, 2 later (`content` edge cases, filter), 2 never (float, clear).

**Value-level corrections, which lower the real figure:**

- `display: inline-block` (90% of pages in 2022) and styled inline runs are only partly covered: the text-free case lowers to flex, and the text case to attributed runs without box styling.
- `float` (72%) is excluded.
- Filter functions other than opacity and drop-shadow are missing on iOS.

For app-style code (Tailwind-shaped components, not CMS pages), the coverage is higher. The only Tailwind utility families outside must + should are:

- float/clear, columns/break, and table utilities;
- mix and background blend, mask, and filters other than opacity/drop-shadow;
- 3D transforms;
- SVG fill and stroke;
- `forced-colors`/`print` variants.

The Tailwind estimate is a qualitative judgement from the variant and utility lists, not a measurement. A measured number needs a corpus pass: run the compiler's parser over real Markless or Tailwind app stylesheets and count declarations by tier. That is a worthwhile follow-up Worker task, and the headless families are a free first corpus.

## Owner questions surfaced

- **Dynamic Type default:** scale all font sizes (native expectation, breaks px parity) or only rem/em (web parity, breaks iOS accessibility expectations)? Recommend scaling everything, with an explicit opt-out.
- **Grid is should-have only with Taffy.** If Yoga is chosen (T011), grid is dropped: it is used on 45.7% of pages and is the top State of CSS layout pain point.
- **Approximations vs errors:** backdrop blur snapped to materials, `transition: all` expanded at build, inline-block rows turned into flex rows. Recommend build notes (visible in the dev overlay) rather than errors, because each keeps shared CSS compiling.

```json
{
  "goalbuddy_receipt_v1": {
    "task": "T015",
    "result": "done",
    "summary": "Ranked CSS feature groups by live Chrome counters (2026-09-24), Web Almanac 2022 (latest CSS chapter; 2024/2025 editions have none), State of CSS 2025 (Devographics API) and Tailwind v4 as an app proxy. Proposed must/should/later/never tiers with UIKit and Android mappings, cost class and precedent for 47 groups. Must covers about 59% and must+should about 80% of usage-weighted property adoption (about 89% including web-only no-ops and font descriptors). Main value-level risks: inline formatting (lower to attributed runs; text-free inline-block rows become flex rows; box styling on inline runs is reported), per-side borders (shape layers), sticky (scroll-delegate offsets), scroll-container defaults, safe area/keyboard via env(), and filters (iOS has no public live CALayer filters; backdrop blur snaps to UIBlurEffect materials). Grid needs Taffy; Dynamic Type default is an owner decision.",
    "evidence": [
      "notes/T015-css-range.md",
      "https://chromestatus.com/data/csspopularity",
      "https://chromestatus.com/data/featurepopularity",
      "https://almanac.httparchive.org/en/2022/css",
      "https://almanac.httparchive.org/en/2025/",
      "https://2025.stateofcss.com/en-US/features/",
      "https://api.devographics.com/graphql",
      "https://tailwindcss.com/docs/hover-focus-and-other-states",
      "https://tailwindcss.com/docs/colors",
      "https://tailwindcss.com/blog/tailwindcss-v4",
      "https://reactnative.dev/docs/view-style-props",
      "https://reactnative.dev/docs/layout-props",
      "https://lynxjs.org/api/css/properties/position.html",
      "https://lynxjs.org/api/css/properties.html",
      "https://developer.apple.com/tutorials/data/documentation/quartzcore/calayer/filters.json",
      "https://developer.apple.com/tutorials/data/documentation/uikit/uiblureffect/style.json",
      "https://developer.apple.com/documentation/uikit/nstextattachmentviewprovider",
      "https://github.com/react/react-native/commit/fe5c0d2d0696b4fc5cdd65f1f2198c4f4363e543",
      "https://github.com/facebook/react-native/issues/9059",
      "https://github.com/DioxusLabs/taffy/blob/main/CHANGELOG.md",
      "https://github.com/chrisbanes/haze/pull/1278"
    ],
    "accessed": "2026-09-26",
    "caveats": [
      "Coverage is property-level, page-load-weighted adoption, not declaration counts; a corpus pass over real app stylesheets is needed for a measured number",
      "Almanac CSS data is from 2022; no newer chapter exists",
      "State of CSS respondents are self-selected enthusiasts",
      "Tier classification of about 400 properties is by regex rules written for this note; tail misclassifications are low-weight",
      "Items marked (unverified): CSS corner-shape mapping, -apple-system-body, px=pt parity, lineBreakStrategy mapping, iOS 18 zoom transition API detail, Android 37.2 backdrop API (search summary)"
    ]
  }
}
```
