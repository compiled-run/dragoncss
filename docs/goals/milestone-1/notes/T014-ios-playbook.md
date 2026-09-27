# T014: iOS (UIKit) engineering playbook

Scout note, read-only research, 2026-09-26. Written from the point of view of a senior iOS graphics engineer. For every feature group in [css-support.md](../../../research/css-support.md), it gives the UIKit technique that comes closest to Chrome, how close it gets, the minimum iOS version, what it costs, and whether it could upgrade the table's current iOS status.

Nothing here changes a status. Under AGENTS.md, a row moves only when a parity fixture passes. "Upgrade" below means "a candidate for a new proposed status, with the technique that would earn it".

## How to read this

- **Evidence levels.** `[doc]`: Apple's documentation JSON (`developer.apple.com/tutorials/data/documentation/...`), fetched and quoted on 2026-09-26. `[read]`: a web page or search summary read on 2026-09-26. `[unverified]`: my own engineering knowledge, not checked against a primary source in this pass. Treat it as a lead for a simulator fixture, not a fact.
- **Fidelity.** **exact**: same geometry and paint, within fixture tolerance, by construction. **near**: same model, but small measured differences are expected (antialiasing, blur kernel, sampling). **approximate**: a different model that looks similar.
- **Cost.** **MT**: main-thread CPU work (per layout, per frame or one-off). **OS**: an offscreen render pass in Core Animation. **Mem**: extra backing-store memory (width × height × scale² × 4 bytes for a bitmap).
- **Technique tiers**, cheapest first. The API design (T017) must allow all six:
  1. **Property**: set a UIView/CALayer property (`cornerRadius`, `alpha`, `transform`).
  2. **Layer**: add a Core Animation sublayer (`CAShapeLayer`, `CAGradientLayer`, `CAReplicatorLayer`, `CATransformLayer`, a mask layer).
  3. **Custom draw**: `draw(_:)` or a `CGBitmapContext` producing `layer.contents`, rendered once per size or state change.
  4. **Paint island**: one view that paints a whole stacking context (backgrounds, borders, text, images) in one Core Graphics pass, so blend modes and filters apply across it. The subviews stay for hit testing and accessibility; their own paint is switched off.
  5. **Text engine**: `NSAttributedString` attributes, TextKit 1 (`NSLayoutManager`) or TextKit 2 (`NSTextLayoutManager`) delegates and subclasses.
  6. **Runtime helper**: a small Swift routine that runs the CSS algorithm itself (sticky offsets, snap selection, balanced wrapping, transition reversal, container query passes), driven by scroll, layout or display-link callbacks.

## Earlier conclusions, re-checked

| Earlier claim | What is actually true | Consequence |
|---|---|---|
| "iOS has no public view filters or blend modes." | **True at the property level.** Apple's docs for `CALayer.filters`, `compositingFilter` and `backgroundFilters` each say "This property is not supported on layers in iOS." [doc] Setting them with Core Animation's undocumented string filter names works in practice but is private behaviour, so it is excluded. **False as an outcome.** Colour filters can be folded into colours at build time; blends and filters work inside a paint island (Core Graphics has every CSS blend mode as `CGBlendMode`); Core Image works on images and on snapshots. | `filter`, `mix-blend-mode` and `background-blend-mode` gain restricted, provable paths (below). Arbitrary live filters over arbitrary UIKit controls stay unsupported. |
| "SwiftUI shaders can be bridged into UIKit." | **Not for UIKit content.** `layerEffect`, `colorEffect` and `distortionEffect` exist from iOS 17 [doc], but Apple says "Views backed by AppKit or UIKit views may not render into the filtered layer" [doc], and `drawingGroup` "will not include ... most types of UIKit and AppKit views" [doc]. Developers see a yellow "no" placeholder in their place [read: gostrobrod Medium]. Hosting a SwiftUI view in `UIHostingController` does not help: the shader only sees SwiftUI-rasterised content. | SwiftUI effects are only usable if Dragon renders a paint-only subtree (text, images, shapes) as SwiftUI. Tier 4 in Core Graphics does the same without a second UI framework, so I do not recommend SwiftUI islands. |
| "`UIVisualEffectView` can take a custom blur radius." | **No public radius.** `UIBlurEffect` exposes only styles. Custom-radius libraries use the private `_UICustomBlurEffect`, or pause a `UIViewPropertyAnimator` part-way through a blur animation (public calls, undocumented result, known to reset after backgrounding) [unverified]. | Exact `backdrop-filter: blur(r)` needs a snapshot pipeline (Core Image or Metal Performance Shaders). Materials stay an opt-in approximation. |
| "UIKit has no balanced wrapping." | **True for the text system.** `NSParagraphStyle.LineBreakStrategy` has only `standard`, `pushOut`, `hangulWordPriority` [doc]. **But** balance is a width search any runtime can do: Chrome only balances 6 lines or fewer [read: developer.chrome.com]. | `text-wrap: balance` becomes a runtime helper (bisection on width). `pretty` maps approximately to `pushOut`, which "pushes out individual lines to avoid an orphan word on the last line" [doc]. |
| "Word spacing has no native attribute." | **True, but kerning a space is the same thing.** `.kern` on a space character adds to that character's advance, which is exactly what CSS `word-spacing` does to word separators [unverified: kern on U+0020 honoured by UILabel]. | `word-spacing` moves from unsupported to near. |
| "Per-side borders and dashes need custom drawing." | **True, and it can match Chrome.** Blink's dash rules have been reproduced in open source: dash 2× width with 1× gap (3× and 2× under 3 px wide), dotted 1× and 1×, gap stretched so each side starts and ends on a whole dash, sides shorter than two dashes painted solid [read: hiwave-macos PR #217, takumi PR #1710; Chromium source not opened]. | Dashed and dotted become near, not approximate, with a per-side `CAShapeLayer` that runs the same selection. |
| "Group opacity default on iOS unverified." | **Verified.** `allowsGroupOpacity` defaults to true for apps linked against the iOS 7 SDK or later, unless `UIViewGroupOpacity` in Info.plist says otherwise [doc]. | `opacity` matches CSS's group behaviour by default. |
| "Per-corner radii need a path mask." | **Until iOS 26.** `UIView.cornerConfiguration` (iOS 26) takes `.corners(topLeftRadius:topRightRadius:bottomLeftRadius:bottomRightRadius:)` [doc]. It is still circular only, so elliptical radii still need a path. Whether it also clips subviews and draws borders is [unverified]. | A cheaper path on iOS 26 for circular per-corner radii; the mask path remains the fallback. |

## Per-feature technique tables

Row names and anchors follow css-support.md. "Now" is the table's current iOS status. "Upgrade" is the proposed new status and stays proposed until a fixture passes.

### Layout and sizing (iOS-specific parts only)

Taffy owns the geometry of every layout row. The rows below are those where UIKit behaviour, not Taffy, decides the outcome.

| Row | Now | Technique | Fidelity | Min iOS | Cost | Upgrade |
|---|---|---|---|---|---|---|
| [inline-box](../../../research/css-support.md#inline-box) inline-block in text | unsupported | Text engine: `NSTextAttachment` with an `NSTextAttachmentViewProvider` hosting the inline box's view (iOS 15, TextKit 2 [doc]). Taffy lays out the box's contents shrink-to-fit; the attachment's `bounds` give its size, and `bounds.origin.y` places the CSS baseline (last line box baseline, or bottom margin edge when `overflow` is not visible). Needs `UITextView` or a custom TextKit 2 host; `UILabel` only draws image attachments [unverified]. | near: box geometry exact, line breaks around it come from Core Text | 15 | MT per text layout; one view per box | caveat, restricted to atomic inline boxes whose inside is a Taffy subtree |
| [float](../../../research/css-support.md#float) text wrap around floats | unsupported | Text engine: `NSTextContainer.exclusionPaths` flows text around a rectangle. Taffy has no float algorithm, so box placement is still missing. | approximate | 7 | MT | none (keep unsupported) |
| [sticky](../../../research/css-support.md#sticky) | unsupported | Runtime helper: in `scrollViewDidScroll`, run the CSS sticky algorithm (clamp the offset between the scrollport's inset edge and the containing block's far edge) and apply it as a layer translation. Same frame as the scroll, so no lag. `UICollectionView` pinned headers are a different model and are not used. | exact geometry | 2 | MT per scroll frame, O(sticky elements) | caveat |
| [fixed](../../../research/css-support.md#fixed) | unsupported | Runtime helper: reparent into an overlay container pinned to the window, laid out as its own Taffy root against the viewport. | exact geometry | 2 | MT on layout | caveat (goal defers it; technique is not the blocker) |
| [scroll](../../../research/css-support.md#scroll) auto/scroll | caveat | Property: `UIScrollView`; `overflow: auto` sets `alwaysBounceVertical = false`, `scroll` keeps bounce. Overlay scroll indicators only while scrolling. | near (physics are native by design) | 2 | none | stays caveat |
| [scroll-controls](../../../research/css-support.md#scroll-controls) snap | unsupported | Runtime helper: `scrollViewWillEndDragging(_:withVelocity:targetContentOffset:)` "can change the value of the targetContentOffset parameter to adjust where the scroll view finishes" [doc]. Compute snap positions from Taffy boxes plus `scroll-padding`/`scroll-margin`; mandatory picks the nearest to the projected target, proximity only snaps within a threshold, `scroll-snap-stop: always` clamps to the adjacent position. Re-snap after layout changes, as CSS requires. When every snap position is a page multiple, `isPagingEnabled` gives native paging. | near: positions exact, deceleration curve native | 5 | MT at drag end | caveat |
| [scroll-controls](../../../research/css-support.md#scroll-controls) smooth scrolling | unsupported | Property: `setContentOffset(_:animated:)` for script and anchor scrolls. Duration is set by the system. | near | 2 | none | caveat |
| [scroll-controls](../../../research/css-support.md#scroll-controls) overscroll | unsupported | Property: `none` sets `bounces = false`. Nested `UIScrollView`s do not chain scrolling like the web's `auto`, so iOS default already behaves like `contain` [unverified]. | approximate for `auto` | 2 | none | `none` and `contain` caveat; `auto` stays approximate |
| [z-index](../../../research/css-support.md#z-index) | caveat | Property: subview order or `layer.zPosition` among siblings. Cross-subtree stacking would need paint to leave its view's subtree; not worth it. | exact within siblings | 2 | none | stays caveat |
| [clip](../../../research/css-support.md#clip) with radius | exact | Property: `clipsToBounds` plus `cornerRadius` for uniform circular radii; layer mask (`CAShapeLayer` path) for per-corner or elliptical radii. | exact geometry; mask path near at edges | 2 | mask costs one OS pass | stays exact; rounded case gets a proof path |
| [visibility](../../../research/css-support.md#visibility) | exact | Not `isHidden` on containers: CSS lets a `visibility: visible` child show inside a hidden parent, and `isHidden` hides the whole subtree. Hide the element's own paint layers and text instead, and exclude it from hit testing and accessibility. `isHidden` only when no descendant can become visible (the compiler knows this per state). | exact | 2 | none | stays exact; mapping corrected |
| [contain-paint](../../../research/css-support.md#contain-paint) | caveat | Property: `clipsToBounds`. | exact | 2 | none | stays caveat |
| [contain-other](../../../research/css-support.md#contain-other) content-visibility | unsupported | Runtime helper: for `content-visibility: auto`, skip building subviews outside the scroll viewport, using `contain-intrinsic-size` as the placeholder size in Taffy. | near | 2 | saves MT | caveat, later |
| [will-change](../../../research/css-support.md#will-change) | no-effect | Omit. Do not map to `shouldRasterize`: it caches a bitmap, costs memory and blurs under transforms. | exact omission | n/a | none | stays no-effect |

### Paint, borders and effects

| Row | Now | Technique | Fidelity | Min iOS | Cost | Upgrade |
|---|---|---|---|---|---|---|
| [colors](../../../research/css-support.md#colors) | exact | Property: build-time conversion to an sRGB `UIColor`/`CGColor` literal. | exact | 2 | none | stays |
| [wide-colors](../../../research/css-support.md#wide-colors) | caveat | Property: build-time conversion of `oklch`/`lab`/`display-p3` to `UIColor(displayP3Red:...)` or an extended-sRGB `CGColor`. Gamut mapping must follow Chrome's choice (clip versus the CSS Color 4 chroma reduction) [unverified which]. | near on P3 screens | 10 | none | stays caveat (screen gamut is real) |
| [mix](../../../research/css-support.md#mix) | caveat | Build fold for constants; runtime evaluator for inputs that depend on state (finite, so it can also be precomputed per state). | exact math | 2 | none | stays caveat |
| [appearance](../../../research/css-support.md#appearance) | caveat | Property: `UIColor(dynamicProvider:)` (iOS 13 [doc]) for view colours. Layer colours (`CGColor`) do not update themselves: re-resolve with `resolvedColor(with:)` on trait change, via `registerForTraitChanges` (iOS 17) or `traitCollectionDidChange` before 17. | exact | 13 | MT on appearance change | exact candidate |
| [opacity](../../../research/css-support.md#opacity) | caveat | Property: `alpha`. `allowsGroupOpacity` is true by default [doc], which is CSS's group behaviour. Switch it off per layer when the compiler proves no children overlap (P20). | exact | 7 | OS pass when alpha < 1 with sublayers | exact candidate |
| [border](../../../research/css-support.md#border) solid, per side | caveat | Uniform width and colour: `layer.borderWidth`/`borderColor` (drawn inside bounds, like CSS). Otherwise Layer: one `CAShapeLayer` per distinct colour. Its path is the border ring (outer rounded rect minus inner rounded rect, even-odd fill) intersected with that side's region, cut along the line from the outer corner to the inner corner, which is how CSS joins sides. Inner radii per CSS: outer radius minus the adjacent border width, never below 0. | exact geometry, near antialiasing at joins | 3 | MT on layout; no OS pass | exact candidate for per-side solid |
| [pattern-border](../../../research/css-support.md#pattern-border) dashed/dotted/double | approx | Layer: per side `CAShapeLayer` stroking the side's centre line with `lineDashPattern` [doc] and `lineDashPhase`, using Blink's dash/gap selection (see above; dotted uses round caps with a zero dash length, square dots up to 3 px per takumi). Double: two strokes of width/3 at the outer and inner thirds. | near (Blink rules taken from reimplementations) | 3 | MT on layout | caveat |
| [other-border](../../../research/css-support.md#other-border) groove/ridge/inset/outset, border-image | unsupported | 3D styles: per-side layers with Chromium's darker/lighter colour pairs [unverified factors]. `border-image` with `stretch`: `layer.contents` with `contentsCenter` (nine-slice). `repeat`/`round`/`space`: custom draw with the CSS tiling arithmetic. | near | 2 | custom draw is MT + Mem | caveat (lower priority) |
| [radius](../../../research/css-support.md#radius) | caveat | Uniform circular: `cornerRadius` with `cornerCurve = .circular`. Per-corner circular: `maskedCorners` only allows one radius, so use `cornerConfiguration = .corners(...)` on iOS 26 [doc] or a path. Elliptical: `CAShapeLayer` mask with a path of quarter-ellipse arcs. Always apply the CSS clamp (scale every radius by the smallest ratio of side length to the sum of its two radii) at layout time. | exact geometry | 3 (26 for the property path) | mask is one OS pass | exact candidate |
| [corners](../../../research/css-support.md#corners) corner-shape | approx | Custom path: build the CSS `superellipse(k)` corner curve from its formula in a `CAShapeLayer` mask, rather than `cornerCurve = .continuous` (Apple's continuous curve is a different curve). | near | 3 | one OS pass | caveat, after Chrome floor is set |
| [rounded-clip](../../../research/css-support.md#rounded-clip) | caveat | Layer split: shadow on an outer layer with `shadowPath`, clip on an inner layer (already in pitfalls P3). | exact geometry | 2 | no OS pass with `shadowPath` | stays caveat |
| [outline](../../../research/css-support.md#outline) | approx | Layer: `CAShapeLayer` sibling drawn outside bounds (no clipping), path = border box expanded by `outline-offset + width/2`, following the border radius as Chrome does, stroked at `outline-width`. Styles reuse the border dash rules. Outline never affects layout, which a sibling layer respects. `outline: auto` or the UA default ring maps to the system `UIFocusHaloEffect` (iOS 15 [doc]); an authored outline on `:focus-visible` sets `focusEffect = nil` [doc] and draws its own. | exact geometry for authored outlines; UA ring approximate | 15 for focus effects | MT on focus change | caveat for authored outlines |
| [shadow](../../../research/css-support.md#shadow) single outset | caveat | Layer: `shadowPath` = border box grown by `spread` (radii grown by spread per the CSS spread rule), `shadowRadius` from the blur radius (CSS says a Gaussian with standard deviation half the blur radius; the CALayer mapping, blur × 0.5, is [unverified], measure it). CSS clips the shadow out of the border box, so it never shows through a translucent background; CALayer does not. Put the shadow on a separate layer masked by "large rect minus border box" when the background is not opaque. | exact geometry, near blur | 3.2 (`shadowPath`) | no OS pass with `shadowPath`; mask adds one | stays caveat |
| [other-shadows](../../../research/css-support.md#other-shadows) inset, multiple | approx | Multiple: one shadow layer per shadow, first listed on top, as CSS paints. Inset: a sublayer clipped to the padding box whose `shadowPath` is a large rect minus the inner rounded rect (even-odd), offset by the shadow offset, spread shrinking the hole. | near | 3.2 | one layer per shadow; inset needs a mask (OS pass) | caveat |
| [gradients](../../../research/css-support.md#gradients) linear/radial | caveat | Layer: `CAGradientLayer` `.axial` with start and end points computed from the CSS gradient line (including the corner-to-corner angle rule); `.radial` (iOS 3.2 [doc]) or `CGContext.drawRadialGradient` under a scaled transform for ellipses. Pre-sample stops in the CSS interpolation space (premultiplied, the space the syntax selects) at build, dense enough that the per-channel error stays under 1/255; the check is part of the build. | near, exact at samples | 3.2 | none | stays caveat until sampling is measured |
| [other-gradients](../../../research/css-support.md#other-gradients) conic/repeating | approx | Conic: `CAGradientLayer` `.conic` (iOS 12 [doc]) with `startPoint` at the centre and `endPoint` setting the zero angle; CSS starts at 12 o'clock and goes clockwise, and the CA direction must be pinned by a fixture [unverified]. For exact per-pixel output, rasterise at layout size into a `CGBitmapContext` (a 300×300 pt box at 3× is 810,000 pixels, a few milliseconds [unverified timing]) or draw with a small Metal shader in a `CAMetalLayer`. Repeating: expand the stop list over the gradient line length once layout gives the size. | near | 12 | raster: MT + Mem once per size | caveat |
| [gradient-hints](../../../research/css-support.md#gradient-hints) | caveat | Build pre-sampling (as above). | near | 3.2 | none | stays caveat |
| [background](../../../research/css-support.md#background) | caveat | Layer per background layer; `background-size`/`position` computed in the CSS arithmetic; tiling with `CAReplicatorLayer` or `CGContext.draw(_:in:byTiling:)`; `round`/`space` via the CSS formulas. Images load asynchronously. | exact geometry | 3 | tiling custom draw costs Mem | stays caveat |
| [text-fill](../../../research/css-support.md#text-fill) background-clip: text | approx | Layer: the background layers (gradient, image) masked by a text layer with the same attributed string: `gradientView.mask = label`. The glyph shapes come from the same renderer, so edges match the non-clipped text exactly. | near | 8 (`UIView.mask`) | one OS pass | caveat |
| [simple-filter](../../../research/css-support.md#simple-filter) opacity/drop-shadow | caveat | `opacity()` is `alpha`. `drop-shadow()`: CALayer shadow with no `shadowPath` follows the alpha of the layer and its sublayers, which is the drop-shadow shape. The blur argument is a standard deviation [read: W3C Filter Effects], not a blur radius as in `box-shadow`. | near | 2 | OS pass (no path possible) | stays caveat |
| [filter](../../../research/css-support.md#filter) colour filters | unsupported | (a) Build fold: `grayscale`, `sepia`, `saturate`, `hue-rotate`, `invert`, `brightness`, `contrast`, `opacity` are affine maps on sRGB values, and CSS says "Filter Functions must operate in the sRGB color space" [read: W3C Filter Effects]. Source-over compositing mixes colours with weights that sum to 1, so applying an affine map to each painted colour before compositing gives the same result as applying it after, as long as no value leaves 0–1 (clamping breaks the equality; the compiler checks it). This covers subtrees whose paint is build-known solid colours, gradient stops, borders, shadows and text colour. (b) Images: apply `CIColorMatrix` to the decoded image once, cache the result. (c) Anything else: paint island or snapshot, see `blur`. | (a) exact when no clamping; (b) near | 2 (a); 5 (b) | (a) none; (b) one-off CPU/GPU per image | caveat for (a) and (b); error otherwise |
| [filter](../../../research/css-support.md#filter) blur | unsupported | Snapshot: `layer.render(in:)` or `drawHierarchy(in:afterScreenUpdates:)` ("use this method when you want to apply a graphical effect, such as a blur, to a view snapshot" [doc]) into an image, `CIGaussianBlur` with sigma = the CSS length (whether `inputRadius` is a sigma is [unverified]), shown in place of the live subtree. Only for subtrees the compiler proves static between state changes. | near | 7 | heavy one-off: snapshot + blur, Mem for the image | caveat, static subtrees only |
| [backdrop](../../../research/css-support.md#backdrop) blur | approx | Tier 1, opt-in approximation: `UIVisualEffectView` + `UIBlurEffect` style (fixed radius, adds tint). Tier 2, near: snapshot the layers behind the element's rect (excluding itself) with `layer.render(in:)`, blur with `CIGaussianBlur` or `MPSImageGaussianBlur`, set as `layer.contents`, clipped to the border radius. Re-run on a `CADisplayLink` only while the backdrop changes (scrolling, animation). | tier 2 near | 7 (tier 2); 8 (tier 1) | tier 2 is the most expensive technique here: snapshot + blur per changed frame on the main thread [unverified ms numbers] | caveat for static backdrops with tier 2; approx stays for live material |
| [backdrop-other](../../../research/css-support.md#backdrop-other) | unsupported | Same snapshot pipeline with the colour-matrix filters in Core Image. | near | 7 | as tier 2 | caveat, static backdrops only |
| [blends](../../../research/css-support.md#blends) background-blend-mode | unsupported | Custom draw: an element's own background layers and colour are drawn in one `CGContext` pass with `setBlendMode`. `CGBlendMode` has all sixteen CSS modes (multiply to luminosity) plus `plusLighter`, and follows the PDF formulas the CSS Compositing spec was written from [unverified: per-mode formula equality]. Self-contained, so no backdrop capture. | near | 2 | MT + Mem per size | caveat |
| [blends](../../../research/css-support.md#blends) mix-blend-mode | unsupported | (a) Build fold when both the element's paint and the backdrop are build-known solid colours: exact formula at build. (b) Paint island: the stacking context is painted by one view in one `CGContext` pass with per-element blend modes; child views stay for hit testing and accessibility. (c) Snapshot + `CIMultiplyBlendMode` etc. for static backdrops. | (a) exact; (b) near; (c) near | 2 | (b) redraws the island on any change inside it; Mem = island area | caveat for (a) and (b) with a paint-only subtree; error when the island would contain UIKit controls, text fields or video |
| [isolation](../../../research/css-support.md#isolation) | unsupported | Falls out of (b): `isolation: isolate` is an island boundary; any blend outside an island is an error, so omission never changes paint. | exact | 2 | none | caveat, together with blends |
| [masks](../../../research/css-support.md#masks) clip-path | unsupported | Layer: `CAShapeLayer` as `layer.mask` for `inset()`, `circle()`, `ellipse()`, `polygon()`, `path()`, with the CSS reference box. CSS also clips hit testing, so override `point(inside:with:)` with `path.contains`. `url(#svg)` stays unsupported. | exact geometry, near edges | 3 | one OS pass | caveat |
| [masks](../../../research/css-support.md#masks) mask-image | unsupported | Layer: `CAGradientLayer` as mask for gradient masks (alpha mode), an image-content layer for image masks with the background sizing arithmetic. `mask-mode: luminance` images converted to alpha at build. | near | 3 | one OS pass | caveat |
| [tint](../../../research/css-support.md#tint) caret/accent | approx | Property: `tintColor` on `UITextView`/`UITextField` sets caret and selection together; `accent-color` maps only to system controls, which headless parts avoid. | approximate | 7 | none | caret-color caveat when selection tint is allowed to follow |
| [cursor](../../../research/css-support.md#cursor) | no-effect | iPhone: omission. iPad: `UIPointerInteraction` (iOS 13.4 [doc]) with `UIPointerStyle`: `text` → vertical beam, `pointer` → hover or highlight effect (no hand cursor exists), `not-allowed` has no equivalent. `UIView.hoverStyle` (iOS 17 [doc]) for the system hover effect. | approximate on iPad | 13.4 | none | iPad profile row: approx |

### Text and interaction

| Row | Now | Technique | Fidelity | Min iOS | Cost | Upgrade |
|---|---|---|---|---|---|---|
| [font-face](../../../research/css-support.md#font-face) | caveat | Bundle and register with `CTFontManagerRegisterFontsForURL` (or Info.plist `UIAppFonts`); the build checks faces exist (principle 5). | exact face selection | 3.2 | launch-time registration | stays caveat |
| [system-font](../../../research/css-support.md#system-font) | caveat | `UIFont.systemFont(ofSize:weight:)`; `system-ui` = SF. Chrome on Linux has no SF, so parity fixtures must use bundled fonts. | near | 8.2 | none | stays caveat |
| [font-size](../../../research/css-support.md#font-size) | caveat | `rem`: `UIFontMetrics(forTextStyle: .body).scaledValue(for:)` / `scaledFont(for:)` (iOS 11 [doc]), with layout re-run when the content size category changes. | exact at default size | 11 | re-layout on size change | stays caveat (policy is owner decision 5) |
| [font-style](../../../research/css-support.md#font-style) | caveat | Real faces only; the build fails on a missing weight (principle 5), so synthetic bold/italic never happens. | exact | 2 | none | exact candidate |
| [font-features](../../../research/css-support.md#font-features) | caveat | `UIFontDescriptor` feature settings with OpenType tags (`font-feature-settings`, `font-variant-numeric` → `tnum`, `lnum` and so on) and variation axes (`font-variation-settings`) [unverified: OpenType-tag keys accepted on the current SDK]. | exact per feature | 7 | none | stays caveat per value |
| [line-height](../../../research/css-support.md#line-height) | caveat | Text engine, two options. (1) Attributes: `minimumLineHeight = maximumLineHeight = L` puts the extra space above the glyphs; move the baseline back up by half the extra space with `baselineOffset`. Community answers disagree whether the value is `(L − lineHeight)/2` or `/4` on `UILabel` [unverified], so a simulator fixture must pick it. (2) Exact control: TextKit 1 `NSLayoutManagerDelegate.layoutManager(_:shouldSetLineFragmentRect:lineFragmentUsedRect:baselineOffset:in:forGlyphRange:)` (iOS 9 [doc]) sets each line's rect to height `L` and its baseline to `(L − (A + D))/2 + A`, which is CSS half-leading. Option 2 needs a custom text view, not `UILabel`. | (1) near; (2) exact line boxes | 9 | (2) one custom text view per text node | exact candidate for line boxes with (2); glyph shapes still native |
| [normal-leading](../../../research/css-support.md#normal-leading) | caveat | Build: fonts are bundled, so the compiler reads the metrics Chrome uses for `normal` (ascent + descent + line gap from the font's tables; which table Chrome picks per platform is [unverified]) and emits an explicit line height through the technique above. | near → exact per font once the table choice is pinned | 9 | none | exact candidate for bundled fonts |
| [letter-spacing](../../../research/css-support.md#letter-spacing) | exact | `.kern` attribute. Whether Chrome and UIKit both add space after the last character is [unverified]; the fixture must check the trailing edge. | exact | 6 | none | stays |
| [word-spacing](../../../research/css-support.md#word-spacing) | unsupported | Text engine: `.kern` on each word separator (U+0020, U+00A0 and the others CSS lists), added to any letter-spacing on that character. | near | 6 | none | caveat |
| [text-align](../../../research/css-support.md#text-align) | caveat | `NSTextAlignment`, with `.natural` for `start`. `justify` → `.justified`; `text-align-last` has no native control [unverified]. | near | 6 | none | stays caveat |
| [decoration](../../../research/css-support.md#decoration) | exact | `.underlineStyle`, `.strikethroughStyle`. | exact | 6 | none | stays |
| [decoration-detail](../../../research/css-support.md#decoration-detail) | approx | Colour: `.underlineColor`/`.strikethroughColor`. Style: `NSUnderlineStyle` `.double`, `.patternDot`, `.patternDash`. Thickness, offset, wavy, `text-underline-position`: TextKit 1 `NSLayoutManager` subclass overriding `drawUnderline(forGlyphRange:underlineType:baselineOffset:lineFragmentRect:lineFragmentGlyphRange:containerOrigin:)` and drawing any geometry; or a custom `NSTextLayoutFragment` draw in TextKit 2 (iOS 15 [doc]). | colour and style exact; geometry near | 7 | custom text view | caveat |
| [case](../../../research/css-support.md#case) | caveat | Build for static text, runtime `uppercased(with:)`/`lowercased(with:)` with the element's language. Do not use Foundation's `capitalized(with:)`: it also lowercases the rest of each word [unverified wording, well known behaviour]; CSS `capitalize` only raises the first letter. Implement word-start uppercasing with `enumerateSubstrings(options: .byWords)`. | near (word boundaries differ at the edges) | 2 | MT per text change | stays caveat |
| [ellipsis](../../../research/css-support.md#ellipsis) | caveat | `numberOfLines = 1`, `lineBreakMode = .byTruncatingTail`; `nowrap` without ellipsis → `.byClipping`. A custom `text-overflow` string needs truncation logic in TextKit (find the last fitting glyph, append the string). | near | 6 | none | stays caveat |
| [line-clamp](../../../research/css-support.md#line-clamp) | caveat | `numberOfLines = n`, `.byTruncatingTail`; Taffy's text measure function must return the clamped height. | near | 6 | none | stays caveat |
| [whitespace](../../../research/css-support.md#whitespace) | caveat | Collapse at build for `normal`; `pre`/`pre-wrap` keep text as is; `tab-size` → `NSParagraphStyle.defaultTabInterval` = tab-size × space advance with `tabStops = []`. | near | 7 | none | stays caveat |
| [breaking](../../../research/css-support.md#breaking) | unsupported | `overflow-wrap: anywhere/break-word`: this is already Core Text's behaviour for a word too long for the line [unverified]. CSS's default `normal` lets the word overflow instead: runtime helper measures the longest unbreakable run and widens the text frame past the box, without clipping. `word-break: break-all` → `.byCharWrapping`; `keep-all` for Korean → `.hangulWordPriority` [doc]. `hyphens: auto` → `hyphenationFactor = 1` (or `usesDefaultHyphenation`, iOS 15 [doc]) plus the element's language on the run; iOS 17 improved hyphenation and line breaking per language and text style [read: WWDC23 10058]. `hyphens: manual` → factor 0 with soft hyphens kept [unverified that TextKit shows the hyphen]. | overflow-wrap near; hyphenation approximate (different dictionaries) | 7 | none | caveat for overflow-wrap and word-break; hyphens stays approximate |
| [balance](../../../research/css-support.md#balance) | unsupported | Runtime helper for `balance`: count lines at the box width; if 2 to 6 lines (Chrome's limit [read: developer.chrome.com]), bisect for the narrowest width that keeps the same line count, then lay the text out at that width inside the unchanged box (the box width does not change, as in Chrome). Chrome's exact scoring is [unverified]. `pretty` → `lineBreakStrategy = .pushOut` [doc], or the same helper checking only that the last line is not one word. | balance near; pretty approximate | 7 | MT: about log2(width) text layouts per paragraph, only when the width changes; cache per width | caveat (balance); approx (pretty) |
| [text-shadow](../../../research/css-support.md#text-shadow) | approx | One shadow: `NSShadow`. Several: custom draw; draw the text once per shadow with `CGContext.setShadow`, using the old trick of drawing the glyphs outside the clip and offsetting the shadow back so only the shadow lands, then the text itself on top. | near | 6 | custom text view | caveat |
| [bidi](../../../research/css-support.md#bidi) | caveat | `.writingDirection` attribute with `NSWritingDirectionFormatType.embedding` or `.override` maps `unicode-bidi: embed` and `bidi-override`; `isolate` → insert U+2068…U+2069 at build. Both engines run the Unicode Bidirectional Algorithm, so the result should match [unverified per value]. | exact candidate | 6 | none | exact candidate per value |
| [vertical-align](../../../research/css-support.md#vertical-align) | caveat | Lengths and percentages → `baselineOffset`; `super`/`sub` → the offset Chrome uses (a fraction of the parent font size [unverified]) plus the smaller font size; image attachments via `NSTextAttachment.bounds`. | near | 7 | none | stays caveat |
| [selection](../../../research/css-support.md#selection) | caveat | `UITextView` with `isEditable = false`, `isSelectable = true` for selectable text; `UILabel` for `user-select: none`. | near | 2 | a text view costs more than a label | stays caveat |
| [inline-paint](../../../research/css-support.md#inline-paint) | unsupported | Text engine: TextKit 2 `NSTextLayoutManager.enumerateTextSegments(in:type:options:)` [unverified signature] gives each line fragment of a run; draw one rounded rect layer per fragment behind the text, with CSS `box-decoration-break: slice` (left padding and border only on the first fragment, right only on the last). Horizontal padding, border and margin change line layout in CSS: add them as `.kern` on the character before the run and on the run's last character. Vertical padding does not change CSS line layout, so it is paint only, as here. | near | 15 | custom text view; layers per fragment | caveat |
| [pointer-events](../../../research/css-support.md#pointer-events) | caveat | Override `hitTest(_:with:)` to skip the view itself while still testing its subviews. | exact | 2 | none | exact candidate |

### Transforms and motion

| Row | Now | Technique | Fidelity | Min iOS | Cost | Upgrade |
|---|---|---|---|---|---|---|
| [transform](../../../research/css-support.md#transform), [matrix](../../../research/css-support.md#matrix), [transform-origin](../../../research/css-support.md#transform-origin) | exact | `CGAffineTransform`/`CATransform3D` with `anchorPoint` compensation. | exact | 2 | none | stay |
| [three-d](../../../research/css-support.md#three-d) | unsupported | `perspective` on the parent → parent's `sublayerTransform` with `m34 = −1/d`, wrapped in translations for `perspective-origin`; `perspective()` inside `transform` goes into the element's matrix. `preserve-3d` → a `CATransformLayer` container; it renders only its sublayers and ignores `backgroundColor`, `contents` and borders [doc], so an element with paint becomes a transform layer holding a separate paint layer. `backface-visibility: hidden` → `isDoubleSided = false`. Intersecting planes: Chrome splits them, Core Animation does not [unverified], so that case is approximate. | near (non-intersecting planes) | 3 | none | caveat, excluding intersecting planes |
| [transition](../../../research/css-support.md#transition) | caveat | `CABasicAnimation` on the layer key path with `CAMediaTimingFunction(controlPoints:)` for any cubic Bézier. Set the model value first, then add the animation. Interruption: the runtime helper applies CSS's "reversing shortening factor" and starts from the presentation layer's current value. | exact curves; interruption exact by construction | 2 | none (render server runs it) | exact candidate once interruption fixtures pass |
| [layout-transition](../../../research/css-support.md#layout-transition) | unsupported | Runtime helper: a `CADisplayLink` interpolates the transitioning computed values each frame, runs Taffy on the affected subtree, and sets frames. This is what CSS means (transition the computed value, lay out every frame). | exact semantics, near timing | 3.1 | MT: one partial Taffy layout per frame; budget it per screen | caveat with a measured frame budget |
| [timing](../../../research/css-support.md#timing) | caveat | Béziers exact. `steps()` → `CAKeyframeAnimation` with `calculationMode = .discrete` and key times at the step boundaries (all four jump modes). `linear()` → key times and values at its stops with linear calculation. | exact | 2 | none | exact candidate |
| [keyframes](../../../research/css-support.md#keyframes) | unsupported | `CAKeyframeAnimation`: `values`, `keyTimes`, and `timingFunctions` with n − 1 entries "for each keyframe segment" [doc], which is CSS's per-keyframe `animation-timing-function`. `animation-iteration-count` → `repeatCount` (fractions allowed, `.infinity`); `alternate` → `autoreverses` with the count halved; `reverse` → reversed arrays; delay → `beginTime`, negative delay → `timeOffset`; `fill-mode` → `fillMode` + `isRemovedOnCompletion = false` + model value at the end; `animation-play-state: paused` → layer `speed = 0` with `timeOffset`. Events through `CAAnimationDelegate`. Non-compositor properties go through the layout-transition helper. | exact for compositor properties | 2 | none | caveat (still a later release by design) |
| [new-motion](../../../research/css-support.md#new-motion) scroll-driven | unsupported | Runtime helper: animation on a layer with `speed = 0`; `scrollViewDidScroll` sets `timeOffset` from scroll progress (`scroll()`) or from the element's position in the scrollport (`view()`). | exact progress mapping | 2 | MT per scroll frame, tiny | caveat, later |
| [new-motion](../../../research/css-support.md#new-motion) view transitions | unsupported | `snapshotView(afterScreenUpdates:)` of old state, apply new state, cross-fade and morph the snapshot's frame (the default view-transition animation). | near | 7 | Mem for snapshots during the transition | approx, later |
| reduced motion (part of [media-appearance](../../../research/css-support.md#media-appearance)) | exact | `UIAccessibility.isReduceMotionEnabled` and its change notification. | exact | 8 | none | stays |

### Units, values and conditions

| Row | Now | Technique | Fidelity | Min iOS | Cost | Upgrade |
|---|---|---|---|---|---|---|
| [viewport](../../../research/css-support.md#viewport) | caveat | Window bounds; `dvh`/`svh`/`lvh` coincide (no collapsing toolbar in an app). | exact | 2 | none | stays caveat |
| [metric-units](../../../research/css-support.md#metric-units) `ex`, `ch`, `cap`, `ic`, `lh` | unsupported | Build: fonts are bundled, so x-height, cap height and the advance of "0" and "水" come from the font files; `lh` from the resolved line height. Container units need the container pass below. | exact for bundled fonts | 2 | none | caveat for font units |
| [media-pointer](../../../research/css-support.md#media-pointer) | caveat | iPhone: `hover: none`, `pointer: coarse`; `UIHoverGestureRecognizer` "doesn't recognize gestures" on iOS [doc]. iPad: primary input stays touch; `any-hover`/`any-pointer: fine` true while a pointer is connected (`GCMouse.current`, iOS 14 [doc]; trackpads may not appear as `GCMouse` [unverified]). What Safari on iPad reports is the reference to pin [unverified]. | near | 14 | none | stays caveat |
| [media-contrast](../../../research/css-support.md#media-contrast) | unsupported | `prefers-contrast: more` → `traitCollection.accessibilityContrast == .high` (Increase Contrast). `forced-colors: active` never matches on iOS (Smart Invert is not forced colours), so it folds to false. `prefers-reduced-transparency` → `UIAccessibility.isReduceTransparencyEnabled`. | exact mapping per value [unverified that Safari maps the same] | 13 | none | caveat |
| [container](../../../research/css-support.md#container) size queries | unsupported | Runtime helper: after a Taffy pass, evaluate the finite set of container conditions (precomputed per state at build); if one flipped, apply that state's styles and re-layout the container's subtree. `container-type: inline-size` makes the container's width independent of its contents, so one extra pass is enough. | exact semantics | 2 | MT: at most one extra layout of the subtree when a condition flips | caveat, later |
| [environment](../../../research/css-support.md#environment) | caveat | `safeAreaInsets` and `safeAreaInsetsDidChange`; keyboard via `keyboardLayoutGuide` (iOS 15 [doc]). | exact values | 15 | MT on change | stays caveat |

### Selectors and states

| Row | Now | Technique | Fidelity | Min iOS | Cost | Upgrade |
|---|---|---|---|---|---|---|
| [states](../../../research/css-support.md#states) `:hover` | caveat | `UIHoverGestureRecognizer` (iOS 13 [doc]) began/ended toggles the state; never fires on iPhone. | exact on iPad | 13 | none | stays caveat |
| [states](../../../research/css-support.md#states) `:active` | caveat | Touch-down tracking (`touchesBegan`/`touchesEnded`/`touchesCancelled`, or `UIControl.isHighlighted`); cancel on scroll, like the web. | near (timing of cancel on scroll) | 2 | none | stays caveat |
| [states](../../../research/css-support.md#states) `:focus-visible` | caveat | Focus system (`didUpdateFocus(in:with:)`) engages with a hardware keyboard or Full Keyboard Access; text inputs as first responder always count, as in Chrome. | near | 15 (focus effects) | none | stays caveat |

## Code sketches

Illustrative only; none of this has been compiled here (the Xcode licence is not accepted on this Mac).

Per-side border ring for one colour (tier 2):

```swift
let ring = UIBezierPath(cssRoundedRect: borderBox, radii: outerRadii)      // quarter-ellipse arcs, CSS-clamped
ring.append(UIBezierPath(cssRoundedRect: paddingBox, radii: innerRadii))  // outer minus side widths, floor 0
ring.usesEvenOddFillRule = true
let side = CAShapeLayer()
side.path = ring.cgPath
side.fillRule = .evenOdd
side.fillColor = topColor
side.mask = trapezoidLayer(outer: borderBox, inner: paddingBox, edge: .top) // cut along outer-to-inner corner lines
```

Blink-style dashes for one side:

```swift
func dashPattern(width w: CGFloat, length L: CGFloat, dotted: Bool) -> (dash: CGFloat, gap: CGFloat)? {
  let dash = dotted ? w : (w < 3 ? 3 * w : 2 * w)
  let gapGuess = dotted ? w : (w < 3 ? 2 * w : w)
  guard L >= 2 * dash else { return nil }                    // paint solid
  let n = max(2, ((L + gapGuess) / (dash + gapGuess)).rounded())
  return (dash, (L - n * dash) / (n - 1))                    // start and end on a whole dash
}
```

Exact CSS half-leading with TextKit 1:

```swift
func layoutManager(_ lm: NSLayoutManager, shouldSetLineFragmentRect r: UnsafeMutablePointer<CGRect>,
                   lineFragmentUsedRect used: UnsafeMutablePointer<CGRect>,
                   baselineOffset: UnsafeMutablePointer<CGFloat>,
                   in c: NSTextContainer, forGlyphRange g: NSRange) -> Bool {
  let (a, d) = (font.ascender, -font.descender)
  r.pointee.size.height = cssLineHeight
  used.pointee.size.height = cssLineHeight
  baselineOffset.pointee = (cssLineHeight - (a + d)) / 2 + a
  return true
}
```

Word spacing:

```swift
for range in separatorRanges(in: text) {   // U+0020, U+00A0 and the other CSS word separators
  s.addAttribute(.kern, value: letterSpacing + wordSpacing, range: range)
}
```

Balanced wrapping:

```swift
func balancedWidth(_ s: NSAttributedString, maxWidth: CGFloat) -> CGFloat {
  let lines = lineCount(s, width: maxWidth)
  guard (2...6).contains(lines) else { return maxWidth }
  var lo: CGFloat = 0, hi = maxWidth
  while hi - lo > 0.5 { let mid = (lo + hi) / 2; if lineCount(s, width: mid) > lines { lo = mid } else { hi = mid } }
  return hi
}
```

Colour filter folded at build (TypeScript, in the compiler):

```ts
const m = grayscaleMatrix(0.6);                 // Filter Effects matrix, sRGB values
const out = paints.map((c) => applyAffine(m, c));
if (out.some(outOfUnitRange)) error("DRAGON_FILTER_CLAMPS", "filter would clamp; fold is not exact");
```

Keyframes:

```swift
let a = CAKeyframeAnimation(keyPath: "opacity")
a.values = [0, 1, 0.4]; a.keyTimes = [0, 0.3, 1]
a.timingFunctions = [CAMediaTimingFunction(controlPoints: 0.25, 0.1, 0.25, 1), .init(name: .linear)]
a.duration = 1.2; a.repeatCount = 2.5; a.beginTime = CACurrentMediaTime() + delay
a.fillMode = .forwards; a.isRemovedOnCompletion = false
layer.opacity = 0.4; layer.add(a, forKey: "css-fade")
```

Sticky:

```swift
func scrollViewDidScroll(_ sv: UIScrollView) {
  for s in stickies {   // static rect and containing-block rect come from Taffy
    let want = sv.contentOffset.y + s.top - s.staticRect.minY
    let dy = min(max(0, want), s.containingBlock.maxY - s.staticRect.maxY)
    s.layer.transform = CATransform3DMakeTranslation(0, dy, 0)
  }
}
```

Scroll snap:

```swift
func scrollViewWillEndDragging(_ sv: UIScrollView, withVelocity v: CGPoint,
                               targetContentOffset t: UnsafeMutablePointer<CGPoint>) {
  t.pointee.y = snapPositions.nearest(to: t.pointee.y, direction: v.y, mode: snapMode)
}
```

## Upgradeable rows

Proposed only. Each needs a passing Chrome comparison fixture (simulator lane) before the profile changes.

| Row | From | To | Technique |
|---|---|---|---|
| appearance | caveat | exact | Dynamic `UIColor`, layer colours re-resolved on trait change |
| opacity | caveat | exact | `alpha`; group opacity is on by default [doc] |
| border (per-side solid) | caveat | exact | Per-colour `CAShapeLayer` ring cut at CSS join lines |
| pattern-border | approx | caveat | Per-side dashes with Blink's dash and gap selection |
| other-border | unsupported | caveat | 3D colour pairs; nine-slice `contentsCenter`; tiling logic |
| radius | caveat | exact | CSS clamp + elliptical path mask; `cornerConfiguration` on iOS 26 |
| corners | approx | caveat | CSS superellipse path mask |
| outline | approx | caveat | Sibling `CAShapeLayer` outside bounds; `focusEffect = nil` when authored |
| other-shadows | approx | caveat | One layer per shadow; inset via even-odd `shadowPath` inside a padding-box clip |
| other-gradients | approx | caveat | `.conic` with pinned angle, or per-pixel raster; repeat stops expanded at layout |
| text-fill | approx | caveat | Background layer masked by a label with the same text |
| filter (colour functions) | unsupported | caveat | Build fold for build-known paint when no clamping; `CIColorMatrix` on images |
| filter (blur) | unsupported | caveat | Snapshot + `CIGaussianBlur`, static subtrees only |
| backdrop | approx | caveat (static backdrops) | Snapshot of layers behind + Gaussian blur; material stays opt-in approx |
| backdrop-other | unsupported | caveat (static backdrops) | Same snapshot pipeline with colour matrices |
| blends (background-blend-mode) | unsupported | caveat | One `CGContext` pass with `CGBlendMode` |
| blends (mix-blend-mode) | unsupported | caveat | Build fold for solid colours; paint island for paint-only subtrees |
| isolation | unsupported | caveat | Island boundary |
| masks | unsupported | caveat | `CAShapeLayer`/gradient/image masks + path hit testing |
| inline-box | unsupported | caveat | `NSTextAttachmentViewProvider` (iOS 15) with a Taffy-laid-out view |
| inline-paint | unsupported | caveat | Per-fragment rects from TextKit 2 + kern for horizontal box edges |
| line-height | caveat | exact (line boxes) | TextKit 1 line-fragment delegate setting CSS half-leading |
| normal-leading | caveat | exact candidate (bundled fonts) | Chrome's `normal` value read from font tables at build |
| word-spacing | unsupported | caveat | `.kern` on word separators |
| decoration-detail | approx | caveat | Colour/style attributes; custom underline drawing for thickness, offset, wavy |
| breaking | unsupported | caveat (overflow-wrap, word-break) | Native char/word wrapping + longest-word overflow helper; hyphens stay approx |
| balance | unsupported | caveat (balance), approx (pretty) | Width bisection helper, 6-line limit; `.pushOut` |
| text-shadow | approx | caveat | Multi-pass custom draw |
| bidi | caveat | exact candidate | Writing-direction embedding/override attributes; isolate controls inserted at build |
| font-style | caveat | exact candidate | Real faces only, missing faces fail the build |
| pointer-events | caveat | exact candidate | `hitTest` override |
| three-d | unsupported | caveat | `m34` perspective, `CATransformLayer`, `isDoubleSided` |
| transition | caveat | exact candidate | Bézier-exact `CABasicAnimation` + CSS reversal logic |
| layout-transition | unsupported | caveat | Display-link interpolation + Taffy per frame, with a frame budget |
| timing | caveat | exact candidate | Discrete keyframes for `steps()`, linear keyframes for `linear()` |
| keyframes | unsupported | caveat | `CAKeyframeAnimation` with per-segment timing functions |
| new-motion (scroll-driven) | unsupported | caveat | `speed = 0` + `timeOffset` from scroll progress |
| sticky | unsupported | caveat | CSS sticky algorithm in `scrollViewDidScroll` |
| scroll-controls (snap, smooth, overscroll none/contain) | unsupported | caveat | `targetContentOffset` snap helper; `setContentOffset(animated:)`; `bounces` |
| metric-units (font units) | unsupported | caveat | Font-table metrics at build |
| media-contrast | unsupported | caveat | `accessibilityContrast`; `forced-colors` folds to none |
| container | unsupported | caveat | One extra layout pass when a precomputed condition flips |
| visibility | exact | exact, mapping corrected | Hide own paint, not `isHidden`, when a descendant can be visible |

Rows that stay where they are: float (no Taffy float algorithm), table, order, subgrid, masonry, vertical writing (text engine can do vertical glyphs, but the layout contract is missing), `filter`/`mix-blend-mode` over UIKit controls, text fields or video (no public path), registration, revert, important, structural selectors.

## Cost ranking (most expensive first)

1. Live backdrop snapshot and blur per frame (tier 2 backdrop). Opt-in per element, reported in the build summary.
2. Paint islands (redraw the whole island on any change inside; memory = island area × scale² × 4 bytes).
3. Layout transitions (Taffy per frame).
4. Snapshot filters on static subtrees (one-off, but memory stays).
5. Mask layers and group opacity (one offscreen pass each).
6. Custom text views (TextKit 1 delegate, TextKit 2 fragments): more memory and setup than `UILabel`; use only when a text feature needs them.
7. Everything else (properties, shape and gradient layers with explicit paths, Core Animation animations) is cheap. Always set `shadowPath`.

## Minimum iOS implications

A floor of **iOS 15** unlocks view-based text attachments, `UIFocusEffect`/`UIFocusHaloEffect`, `keyboardLayoutGuide` and `usesDefaultHyphenation`. **iOS 17** adds `registerForTraitChanges`, `hoverStyle` and the improved per-language line breaking. **iOS 26** adds `cornerConfiguration`. SwiftUI shader effects (iOS 17) do not help UIKit content, so they do not argue for a higher floor.

## Still unverified (each is a simulator fixture)

- CALayer `shadowRadius` versus CSS blur (the 0.5 factor) and `CIGaussianBlur.inputRadius` versus sigma.
- Whether the `UILabel` baseline offset for half-leading is `/2` or `/4`.
- Which font table Chrome uses for `line-height: normal` on each platform.
- Kern on spaces in `UILabel`; trailing letter-spacing in Chrome and UIKit.
- `CAGradientLayer` `.conic` zero angle and direction; its interpolation colour space and premultiplication.
- Blink dash rules (taken from two reimplementations, Chromium source not opened); 3D border colour factors.
- `CGBlendMode` formulas equal to CSS Compositing for all sixteen modes.
- Chrome's current balance algorithm (bisection or score-based).
- `cornerConfiguration` clipping subviews and drawing borders.
- Safari on iPad's `hover`/`pointer` media results; trackpads as `GCMouse`.
- `UIViewPropertyAnimator` blur-fraction trick behaviour (not recommended anyway).
- Snapshot and blur timings on the oldest supported device.

## Sources (all accessed 2026-09-26)

- Apple, CALayer `filters`, `compositingFilter`, `backgroundFilters`, each "not supported on layers in iOS": https://developer.apple.com/documentation/quartzcore/calayer/filters, https://developer.apple.com/documentation/quartzcore/calayer/compositingfilter, https://developer.apple.com/documentation/quartzcore/calayer/backgroundfilters
- Apple, `allowsGroupOpacity` default: https://developer.apple.com/documentation/quartzcore/calayer/allowsgroupopacity
- Apple, SwiftUI `layerEffect` (iOS 17, "Views backed by AppKit or UIKit views may not render into the filtered layer"): https://developer.apple.com/documentation/swiftui/view/layereffect(_:maxsampleoffset:isenabled:); `colorEffect`: https://developer.apple.com/documentation/swiftui/view/coloreffect(_:isenabled:); `drawingGroup`: https://developer.apple.com/documentation/swiftui/view/drawinggroup(opaque:colormode:); `ImageRenderer` (iOS 16): https://developer.apple.com/documentation/swiftui/imagerenderer
- George Ostrobrod, "(MTL S01E15) UI pt.2: SwiftUI" (yellow placeholder for UIKit-backed views) [read]: https://gostrobrod.medium.com/mtl-s01e14-ui-pt-2-swiftui-f566d5433c28
- Apple, `CAGradientLayerType.conic` (iOS 12) and `.radial` (iOS 3.2): https://developer.apple.com/documentation/quartzcore/cagradientlayertype/conic, https://developer.apple.com/documentation/quartzcore/cagradientlayertype/radial; `startPoint`/`endPoint`: https://developer.apple.com/documentation/quartzcore/cagradientlayer/startpoint
- Apple, `CAShapeLayer.lineDashPattern`: https://developer.apple.com/documentation/quartzcore/cashapelayer/linedashpattern
- Apple, `CATransformLayer`: https://developer.apple.com/documentation/quartzcore/catransformlayer
- Apple, `CAKeyframeAnimation.timingFunctions`: https://developer.apple.com/documentation/quartzcore/cakeyframeanimation/timingfunctions
- Apple, `CAMetalLayer`: https://developer.apple.com/documentation/quartzcore/cametallayer
- Apple, `UIView.cornerConfiguration` (iOS 26) and `UICornerConfiguration`: https://developer.apple.com/documentation/uikit/uiview/cornerconfiguration-7l0ja, https://developer.apple.com/documentation/uikit/uicornerconfiguration-swift.struct; Seb Vidal, "What's New in UIKit 26" [read]: https://sebvidal.com/blog/whats-new-in-uikit-26/
- Apple, `drawHierarchy(in:afterScreenUpdates:)`: https://developer.apple.com/documentation/uikit/uiview/drawhierarchy(in:afterscreenupdates:)
- Apple, `NSTextAttachmentViewProvider` (iOS 15): https://developer.apple.com/documentation/uikit/nstextattachmentviewprovider; `NSTextLayoutFragment`: https://developer.apple.com/documentation/uikit/nstextlayoutfragment; `NSTextLayoutManagerDelegate`: https://developer.apple.com/documentation/uikit/nstextlayoutmanagerdelegate
- Apple, `NSLayoutManagerDelegate` line-fragment method (iOS 9): https://developer.apple.com/documentation/uikit/nslayoutmanagerdelegate/layoutmanager(_:shouldsetlinefragmentrect:linefragmentusedrect:baselineoffset:in:forglyphrange:)
- Apple, `NSParagraphStyle.LineBreakStrategy` and `.pushOut`: https://developer.apple.com/documentation/uikit/nsparagraphstyle/linebreakstrategy-swift.struct, https://developer.apple.com/documentation/uikit/nsparagraphstyle/linebreakstrategy-swift.struct/pushout; `usesDefaultHyphenation` (iOS 15): https://developer.apple.com/documentation/uikit/nsparagraphstyle/usesdefaulthyphenation
- Apple WWDC23 10058, "What's new with text and text interactions" (line breaking and hyphenation) [read]: https://developer.apple.com/videos/play/wwdc2023/10058/; WWDC23 10055, "What's new in UIKit" (typesetting language trait) [read]: https://developer.apple.com/videos/play/wwdc2023/10055/
- Apple, `UIFocusEffect`, `UIFocusHaloEffect`, `UIView.focusEffect` (iOS 15): https://developer.apple.com/documentation/uikit/uifocuseffect, https://developer.apple.com/documentation/uikit/uifocushaloeffect, https://developer.apple.com/documentation/uikit/uiview/focuseffect
- Apple, `UIHoverGestureRecognizer` (iOS 13; no gestures on iOS): https://developer.apple.com/documentation/uikit/uihovergesturerecognizer; `UIView.hoverStyle` and `UIHoverStyle` (iOS 17): https://developer.apple.com/documentation/uikit/uiview/hoverstyle, https://developer.apple.com/documentation/uikit/uihoverstyle; `UIPointerInteraction` (iOS 13.4): https://developer.apple.com/documentation/uikit/uipointerinteraction; `GCMouse` (iOS 14): https://developer.apple.com/documentation/gamecontroller/gcmouse
- Apple, `UIView.keyboardLayoutGuide` (iOS 15): https://developer.apple.com/documentation/uikit/uiview/keyboardlayoutguide; `UIFontMetrics` (iOS 11): https://developer.apple.com/documentation/uikit/uifontmetrics; `UIColor(dynamicProvider:)` (iOS 13): https://developer.apple.com/documentation/uikit/uicolor/init(dynamicprovider:)
- Apple, `scrollViewWillEndDragging(_:withVelocity:targetContentOffset:)`: https://developer.apple.com/documentation/uikit/uiscrollviewdelegate/scrollviewwillenddragging(_:withvelocity:targetcontentoffset:)
- W3C Filter Effects 1 ("Filter Functions must operate in the sRGB color space"; `blur()` and `drop-shadow()` take a standard deviation) [read]: https://www.w3.org/TR/filter-effects-1/
- Chrome for Developers, "CSS text-wrap: balance" (6-line limit) [read]: https://developer.chrome.com/docs/css-ui/css-text-wrap-balance; CSSWG issue 8516 (early 4-line limit) [read]: https://github.com/w3c/csswg-drafts/issues/8516
- Blink dash rules reproduced in open source [read]: hiwave-macos PR #217, https://github.com/hiwavebrowser/hiwave-macos/pull/217; takumi PR #1710, https://github.com/kane50613/takumi/pull/1710; naive-dash failure, rinch issue #1078, https://github.com/joeleaver/rinch/issues/1078

## Receipt

```json
{
  "goalbuddy_receipt_v1": {
    "task_id": "T014",
    "role": "scout",
    "status": "done",
    "result": "complete",
    "summary": "iOS UIKit playbook covering every css-support.md feature group: technique, fidelity, minimum iOS, cost and upgrade candidate per row, six technique tiers (property, layer, custom draw, paint island, text engine, runtime helper), code sketches, and proposed upgrades for 41 support-table rows. Re-checked earlier conclusions: CALayer filters/compositingFilter/backgroundFilters are documented as unsupported on iOS (confirmed), but colour filters fold at build when no clamping, blends work inside Core Graphics paint islands, and blur works on snapshots; SwiftUI shader effects do not render UIKit-backed content (Apple doc), so they are not a bridge; group opacity is on by default (Apple doc); per-corner radii have a property path on iOS 26.",
    "key_findings": [
      "CALayer.filters, compositingFilter, backgroundFilters: 'This property is not supported on layers in iOS.' [doc]",
      "SwiftUI layerEffect/colorEffect (iOS 17): 'Views backed by AppKit or UIKit views may not render into the filtered layer.' [doc]",
      "allowsGroupOpacity defaults to true for iOS 7 SDK and later [doc]",
      "UIView.cornerConfiguration with per-corner radii from iOS 26 [doc]",
      "NSLayoutManagerDelegate line-fragment callback gives exact CSS half-leading (iOS 9) [doc]",
      "NSTextAttachmentViewProvider (iOS 15) enables inline-block in text [doc]",
      "CAKeyframeAnimation.timingFunctions per segment equals CSS per-keyframe easing [doc]",
      "scrollViewWillEndDragging targetContentOffset enables CSS snap selection [doc]",
      "CSS filter functions operate in sRGB, so affine colour filters fold into paint at build when nothing clamps [W3C read]",
      "Blink dash/gap selection reproduced by two open-source painters [read, Chromium source not opened]",
      "Chrome balances at most 6 lines [read]"
    ],
    "upgradeable_rows": ["appearance", "opacity", "border", "pattern-border", "other-border", "radius", "corners", "outline", "other-shadows", "other-gradients", "text-fill", "filter", "backdrop", "backdrop-other", "blends", "isolation", "masks", "inline-box", "inline-paint", "line-height", "normal-leading", "word-spacing", "decoration-detail", "breaking", "balance", "text-shadow", "bidi", "font-style", "pointer-events", "three-d", "transition", "layout-transition", "timing", "keyframes", "new-motion", "sticky", "scroll-controls", "metric-units", "media-contrast", "container", "visibility"],
    "evidence": {
      "apple_doc_json_requests": "about 50, 5 returned 404 (not cited)",
      "access_date": "2026-09-26",
      "levels": "[doc] quoted from Apple documentation JSON; [read] web page or search summary; [unverified] engineering knowledge"
    },
    "files_written": ["docs/goals/milestone-1/notes/T014-ios-playbook.md"],
    "commands_run": ["node fetch of developer.apple.com/tutorials/data/documentation/*.json", "WebSearch", "WebFetch w3.org/TR/filter-effects-1"],
    "limitations": [
      "No simulator: Xcode licence not accepted, so no sketch was compiled and no fidelity was measured",
      "Chromium source not opened for dash rules, balance algorithm or normal line-height tables",
      "Upgrades are proposals; none changes css-support.md until a parity fixture passes"
    ],
    "next_suggestion": "T017 should adopt the six technique tiers as the backend technique model and schedule simulator fixtures for the unverified list, starting with line-height half-leading, shadow blur factor and per-side borders."
  }
}
```
