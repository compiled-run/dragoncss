# T016: macOS (AppKit) playbook and cross-engine text comparison

Scout note, read-only research. Every source was accessed on **2026-09-26**. Apple API availability and wording come from Apple's documentation JSON (`developer.apple.com/tutorials/data/documentation/<path>.json`, the data behind the public doc pages). Chromium, Skia and Minikin claims come from reading the source files on their `main` branches that day. **(unverified)** marks a claim from memory or a search summary that was not confirmed in a primary source during this task.

Inputs read: `README.md`, `docs/goals/milestone-1/goal.md` (design principles), `docs/research/css-support.md`, `T029-support-evidence.md`, `pitfalls.md` (section 4.3), T006.

## 1. Short answer

**macOS is not "iOS with a mouse".** Three facts change the support table:

1. **Filters and blend modes exist on macOS.** `CALayer.filters`, `backgroundFilters` and `compositingFilter` are documented as "not supported on layers in iOS" but work on macOS (10.5+). AppKit exposes them as `NSView.contentFilters`, `backgroundFilters` and `compositingFilter`. So CSS `filter`, `backdrop-filter` and `mix-blend-mode` can map to Core Image filters. The cost is that the window's layer tree renders inside the app's process instead of the system's render server (`layerUsesCoreImageFilters`, 10.9).
2. **On macOS, AppKit owns the view's own layer, unlike iOS.** Since 10.13, changing `transform`, `anchorPoint`, `masksToBounds`, `shadow*`, `filters` or `compositingFilter` directly on an NSView's layer is *undefined behaviour*, and AppKit resets `transform` and `anchorPoint` whenever the view's geometry changes. iOS-style code that sets `layer.transform` (react-native-macos hit exactly this) is wrong on macOS. Dragon's macOS backend must set these through the NSView API or on sublayers Dragon owns. **Result: general 2D transforms (skew, matrix, custom `transform-origin`) on elements with child views go from `exact` on iOS to `caveat` or `unsupported` on macOS.**
3. **For text, macOS is the platform closest to Chrome.** Chrome on macOS reads font metrics through Core Text (`CTFontGetAscent/Descent/Leading`). It finds fallback fonts with the same Core Text function AppKit uses (`CTFontCreateForString` with the default cascade list), hyphenates with the same Core Foundation call (`CFStringGetHyphenationLocationBeforeIndex`), and draws glyphs through Core Graphics. What differs is how the numbers are combined: CSS half-leading, rounding each metric to whole pixels, and Chrome's own ICU line breaker. Dragon can compute those itself.

**Recommended text strategy: native engines, with Dragon owning the line-box model.** Core Text/TextKit and Android `StaticLayout`/Minikin keep shaping, font fallback, bidi, glyph drawing, selection, accessibility and editing. Dragon computes line-box geometry (half-leading, `line-height: normal`, `text-box-trim`) from the font file at build time, and applies it per line through the engines' public line-geometry hooks. It narrows break differences by setting native options and inserting Unicode control characters (bidi isolates, word joiners, zero-width spaces). Doing its own line layout with HarfBuzz and ICU4X (the Flutter model) is **not** recommended for 1.0. It would match *Linux* Chrome better, but not the Chrome the user actually runs, which already differs from Linux Chrome in fallback, hyphenation and metrics. It also costs native selection, accessibility, input methods, spell-check and several megabytes. Section 5 has the evidence.

## 2. macOS architecture ground rules (apply to every row below)

| Rule | Why | Source |
|---|---|---|
| One layer-backed `NSView` per element (for hit testing, accessibility, focus and cursor). Paint (background, border, shadow, gradient) goes in **Dragon-owned sublayers**, never on `view.layer` itself for the forbidden properties. | 10.13 AppKit release notes: changing `bounds, position, zPosition, anchorPoint, anchorPointZ, transform, affineTransform, frame, hidden, geometryFlipped, masksToBounds, opaque, compositingFilter, filters, shadowColor, shadowOpacity, shadowOffset, shadowRadius, shadowPath, layoutManager` on a view's layer is undefined. AppKit copies view state onto the layer (`_updateLayerGeometryFromView`) and resets `transform`/`anchorPoint`. | [AppKit 10.13 release notes](https://developer.apple.com/library/archive/releasenotes/AppKit/RN-AppKit/#10_13Layer-backed%20Views) (quoted via [react-native-macos#466](https://github.com/microsoft/react-native-macos/issues/466) and [Apple forums 88567](https://forums.developer.apple.com/forums/thread/88567)); [Jonathan Willing, OS X animations](https://jwilling.com/blog/osx-animations/) |
| Override `isFlipped` to return `true` on every Dragon view. | NSView's default origin is bottom-left with y going up. Taffy and CSS use top-left. | [NSView.isFlipped](https://developer.apple.com/documentation/appkit/nsview/isflipped) |
| `wantsUpdateLayer = true` plus `updateLayer()`. No `draw(_:)` for styled boxes. | Changing layer properties is "significantly faster than redrawing the layer contents using draw(_:)". | [wantsUpdateLayer](https://developer.apple.com/documentation/appkit/nsview/wantsupdatelayer) (10.8) |
| Use `canDrawSubviewsIntoLayer` only for static leaf subtrees with no Dragon sublayers. | It flattens implicitly-layered subviews into the parent layer, using fewer layers and less memory, but disables `updateLayer`. | [canDrawSubviewsIntoLayer](https://developer.apple.com/documentation/appkit/nsview/candrawsubviewsintolayer) (10.9) |
| Snap every Taffy rect with `backingAlignedRect(_:options:)`, and set `contentsScale` on owned sublayers in `viewDidChangeBackingProperties`. | Chrome snaps boxes to device pixels. A window can move between 1x and 2x screens. | [backingAlignedRect](https://developer.apple.com/documentation/appkit/nsview/backingalignedrect(_:options:)) (10.7) |
| `clipsToBounds` defaults to `false` on macOS 14+ (`true` on 13 and earlier). Set it explicitly from `overflow`. | CSS `overflow: visible` is the default. Relying on the OS default gives different results on 13 and 14. | [NSView.clipsToBounds](https://developer.apple.com/documentation/appkit/nsview/clipstobounds) |
| Minimum OS: propose **macOS 13** (TextKit 2 `NSTextView`, `hangulWordPriority`, P3 displays common). Techniques that need 14 (SwiftUI shaders) are marked. | The owner should confirm the macOS floor, as for iOS. | owner decision |

```swift
final class DragonView: NSView {
  override var isFlipped: Bool { true }
  override var wantsUpdateLayer: Bool { true }
  let paint = CALayer()              // Dragon-owned: background, radius, border
  let shadowLayer = CALayer()        // Dragon-owned: shadow with shadowPath from known geometry
  override func makeBackingLayer() -> CALayer { let l = CALayer(); l.addSublayer(shadowLayer); l.addSublayer(paint); return l }
  override func updateLayer() {       // resolved property list -> owned sublayers only
    effectiveAppearance.performAsCurrentDrawingAppearance { paint.backgroundColor = style.bg.cgColor }
  }
}
```

## 3. Part 1: per-feature technique table (macOS/AppKit)

Fidelity: **exact** means the same geometry or maths as the CSS spec and Chrome, still to be proven by a parity test; **near** means differences under about 1 device pixel or 1 colour step are expected; **approx** means visibly similar but different. "Upgrade?" compares with the current iOS column of `css-support.md` (the table has no macOS column yet).

### 3.1 Layout and sizing

| Feature | Technique | Fidelity | Min macOS | Cost | Upgrade? |
|---|---|---|---|---|---|
| Flex, grid, block, sizing, aspect ratio, gap, box-sizing | Taffy, the same as iOS. Frames applied in a flipped view with `backingAlignedRect`. | exact (same as iOS) | any | one layout pass | same as iOS |
| Window resize | Relayout on `viewDidEndLiveResize` and during live resize (`inLiveResize`). Throttle to the display link (`NSView.displayLink(target:selector:)`, 14+) **(unverified API detail)**. | exact boxes | 13 | layout per frame while resizing, which iOS never has | new macOS-only concern |
| overflow hidden/clip | `NSView.clipsToBounds = true` (rectangular). Rounded: `view.layer.mask` = `CAShapeLayer` with the CSS-clamped radii path (`mask` is not on the forbidden list). | exact rect; rounded near (anti-aliasing) | 10.9 | mask = offscreen pass | same |
| overflow auto/scroll | `NSScrollView` + `NSClipView` (flipped document view). `autohidesScrollers`. `scrollerStyle` follows the user's setting (overlay vs legacy), as Chrome on Mac does. Reserve `NSScroller.scrollerWidth(for:scrollerStyle:)` for legacy scrollers. | near (Chrome on Mac also uses system overlay scrollbars **(unverified)**) | 10.7 | scroll view per scroller | caveat → caveat |
| overscroll-behavior | `verticalScrollElasticity` / `horizontalScrollElasticity` = `.none` for `none`, `.automatic` otherwise. Chaining has no equivalent. | near for `none`; `contain` approx | 10.7 | none | unsupported → caveat for `auto`/`none` |
| Sticky position | Simple top header: `NSScrollView.addFloatingSubview(_:for:)`. That floats fully and ignores the containing block. CSS sticky: observe `NSClipView` bounds changes (`postsBoundsChangedNotifications`) and offset a Dragon-owned layer, clamped to the containing block. | logic: exact geometry; floating subview: approx | 10.9 | per-scroll callback (main thread) | unsupported → caveat (logic) |
| Scroll snap | No native snapping on NSScrollView **(unverified)**. Logic: at `scrollWheel` phase `.ended` or momentum end, animate the clip view bounds to the nearest snap point. | approx (feel differs) | 10.7 | small | stays unsupported until a fixture passes |
| Smooth scroll (`scrollTo`) | `clipView.animator().setBoundsOrigin` + `reflectScrolledClipView`. | near | 10.5 | none | — |
| z-index | Sibling order (`sortSubviews` or ordered `addSubview`). `zPosition` on the view layer is forbidden. | exact within siblings | any | none | same |
| Fixed / anchor / overlays | Child `NSPanel`/`NSWindow` or a top-level overlay view. | later | — | — | same |

### 3.2 Paint, borders and effects

| Feature | Technique | Fidelity | Min macOS | Cost | Upgrade? |
|---|---|---|---|---|---|
| Solid, wide-gamut colours | `NSColor(srgbRed:…)`, `NSColor(displayP3Red:…)`. Most Macs have P3 screens; Chrome on Mac is colour-managed **(unverified)**. | exact values; screen gamut near | 10.12 | none | same |
| light-dark(), color-scheme | `NSColor(name:dynamicProvider:)`. CGColors on owned sublayers resolved inside `effectiveAppearance.performAsCurrentDrawingAppearance` and refreshed in `viewDidChangeEffectiveAppearance`. | exact | 10.15 / 11 | re-resolve per change | same |
| Uniform radius, per-corner | `paint.cornerRadius` + `maskedCorners`. Elliptical or unequal radii: `CAShapeLayer` path with CSS radius clamping. `cornerCurve = .circular` (CSS corners are circular arcs). | exact | 10.13 / 10.15 | shape layer for elliptical | same |
| Borders (solid per-side, dashed, dotted) | Uniform: `borderWidth`/`borderColor` on the owned layer. Per side and dashes: `CAShapeLayer` stroke with `lineDashPattern` computed from Chrome's dash rule. | uniform exact; dashes approx | 10.5 | shape layer | same as iOS |
| box-shadow (outset, one) | Owned `shadowLayer` with `shadowPath` from known geometry. `shadowRadius = blur × 0.5` conversion **(conversion factor carried from T029, unverified on macOS)**. Never use `NSView.shadow`/`view.layer.shadow*` (forbidden, and wrong for spread). | near | 10.5 | no offscreen pass when `shadowPath` is set | same |
| Inset / multiple shadows | One owned layer per shadow; inset = masked ring path. | approx | 10.5 | a layer each | same |
| Linear / radial gradients | `CAGradientLayer` `.axial`/`.radial` with stops pre-sampled at build time (premultiplied interpolation). | near | 10.6 / radial 10.? **(unverified)** | layer | same |
| Conic gradient | `CAGradientLayer.type = .conic`. Map CSS `from` angle to start/end points. Repeating: expand stops. | near | **10.14** | layer | approx → caveat |
| CSS `filter` (blur, brightness, contrast, grayscale, hue-rotate, invert, opacity, saturate, sepia) | `NSView.contentFilters = [CIFilter]`. Colour functions as `CIColorMatrix` with the exact CSS matrices (Filter Effects spec); blur as `CIGaussianBlur` (CSS radius = standard deviation; CI `inputRadius` ≈ sigma **(unverified)**). Set filters through the NSView API, which tells AppKit to render in-process, so `layerUsesCoreImageFilters` is only needed for filters on owned sublayers. | maths exact if the working colour space matches: Core Image defaults to a **linear** working space while CSS shorthand filters run in sRGB **(unverified: CA's working space for layer filters)**. Treat as near until a parity test measures it. | 10.5 (10.9 in-process rule) | **forces in-process rendering of the layer tree**; GPU filter pass per frame; offscreen buffer | **unsupported → caveat** |
| drop-shadow() filter | Owned shadow layer with `shadowPath` = alpha outline, or `CIFilter` shadow chain. | near | 10.5 | offscreen when there is no path | caveat → caveat |
| backdrop-filter | `NSView.backgroundFilters = [CIGaussianBlur, CIColorMatrix…]`. Plain blur with no system tint, unlike `NSVisualEffectView`. Extent: `masksToBounds` semantics. The CSS backdrop root (the nearest ancestor with filter or opacity) differs from "content behind the layer". Whether `backgroundFilters` renders for layer-backed views in current macOS needs a probe **(unverified; widely reported as unreliable)**. | near if the probe passes | 10.5 | in-process; samples the backdrop per frame, which is expensive | approx → caveat (after probe) |
| Materials (not CSS) | `NSVisualEffectView` with `material` (`.sidebar`, `.popover`, `.hudWindow`…) and `blendingMode` (`.behindWindow`/`.withinWindow`). `.behindWindow` blurs the **desktop** behind the window, which CSS cannot express. | not a CSS match | 10.10 (named materials 10.14) | cheap, done by the system | escape hatch only (for example a `-dragon-material` extension), never for `backdrop-filter` |
| mix-blend-mode | `NSView.compositingFilter = CIFilter(name: "CI<Mode>BlendMode")`. All 15 non-normal CSS modes have Core Image blend filters (Multiply, Screen, Overlay, Darken, Lighten, ColorDodge, ColorBurn, HardLight, SoftLight, Difference, Exclusion, Hue, Saturation, Color, Luminosity). Colour space caveat as for filters. | near (colour space) | 10.5 | in-process; blends against everything already drawn behind | **unsupported → caveat** |
| isolation | CSS isolates blending inside a stacking context. CA blends against the flattened backdrop. A group with `shouldRasterize` or a filter may isolate **(unverified)**. | unknown | — | — | stays unsupported pending a probe |
| clip-path, mask-image | `view.layer.mask` = `CAShapeLayer` (basic shapes, `path()`) or an image layer (mask-image). Hit testing: override `hitTest(_:)` to test the path, because CSS clip-path also clips hits. | exact geometry, near edges | 10.5 | offscreen pass | **unsupported → caveat** |
| background-clip: text | Text drawn into a mask layer over a gradient layer. | near | 10.5 | offscreen | approx → caveat |
| Outline, focus ring | Authored `outline`: owned `CAShapeLayer` outside the border box with `outline-offset`, not clipped by the element's own `overflow` (CSS rule). `outline: auto` / UA ring: the system ring via `focusRingType = .default` + `drawFocusRingMask()` (rounded path) + `focusRingMaskBounds`, calling `noteFocusRingMaskChanged()` when geometry changes. The system ring also drives Accessibility Zoom focus tracking. | authored outline exact; `auto` approx (Chrome draws its own ring **(unverified)**) | 10.7 | owned layer; system ring free | approx → caveat for authored outlines |
| accent/caret colour | `NSColor.controlAccentColor`; caret: `NSTextView.insertionPointColor`. | near | 10.14 | none | same |
| cursor | Tracking area `.cursorUpdate` and `NSCursor.set()` in `cursorUpdate(with:)` (avoid cursor rects, which are not clipped by superviews and do not work in rotated views). Keyword map: `pointer→.pointingHand`, `text→.iBeam`, `vertical-text→.iBeamCursorForVerticalLayout`, `not-allowed→.operationNotAllowed`, `grab→.openHand`, `grabbing→.closedHand`, `crosshair→.crosshair`, `col-resize→.resizeLeftRight`, `row-resize→.resizeUpDown`, `context-menu→.contextualMenu`, `copy→.dragCopy`, `alias→.dragLink`, `url(...) x y→NSCursor(image:hotSpot:)`. `wait`, `progress`, `help`, `move` and the diagonal resize cursors have no public NSCursor before macOS 15's frame-resize cursors **(unverified)**, so they need a bundled image. | keyword subset exact; others approx | 10.5 | tracking area per element with a cursor | no-effect → caveat on macOS |

```swift
// mix-blend-mode: multiply; filter: grayscale(1) blur(4px)
view.compositingFilter = CIFilter(name: "CIMultiplyBlendMode")
let gray = CIFilter(name: "CIColorMatrix")!   // CSS grayscale(1) matrix rows from Filter Effects §grayscale
gray.setValue(CIVector(x: 0.2126, y: 0.7152, z: 0.0722, w: 0), forKey: "inputRVector") // ...G,B rows likewise
let blur = CIFilter(name: "CIGaussianBlur", parameters: [kCIInputRadiusKey: 4])!
view.contentFilters = [gray, blur]            // NSView API: AppKit switches to in-process rendering itself
```

### 3.3 Interaction and focus

| Feature | Technique | Fidelity | Min macOS | Cost | Upgrade? |
|---|---|---|---|---|---|
| :hover, (hover: hover), (pointer: fine) | `NSTrackingArea(rect:, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner:)`. `.inVisibleRect` keeps the rect in sync with the view. `.activeAlways` because Chrome keeps `:hover` in background windows **(unverified)**. Media queries fold to hover/fine at build for the macOS target. | exact state timing (entered/exited); nested hover = ancestor chain set by Dragon, because CSS hover applies to ancestors too | 10.5 | one tracking area per hover-styled element | caveat → exact on macOS |
| :active | `mouseDown`/`mouseUp` + tracking of mouse-dragged-outside. | exact | any | — | same |
| :focus, :focus-visible | `acceptsFirstResponder`, `canBecomeKeyView`, `nextKeyView` chain in DOM order. focus-visible: Dragon keeps keyboard-modality state (last input was a key event). Full Keyboard Access (the system setting that limits Tab to text fields, off by default) changes Tab order in AppKit; whether Chrome honours it is **(unverified)**. | near | any | — | caveat → caveat |
| Text selection / user-select | `NSTextView` (selectable, non-editable) vs a drawing-only text view. | native feel | 13 | TextKit view per text block | same |
| pointer-events: none | Override `hitTest(_:)` to return children only. | exact | any | — | same |
| prefers-reduced-motion / prefers-contrast / reduced transparency | `NSWorkspace.shared.accessibilityDisplayShouldReduceMotion` (10.12), `…ShouldIncreaseContrast` (10.10), `…ShouldReduceTransparency` (10.10), observed with `accessibilityDisplayOptionsDidChangeNotification`. Chrome maps Increase Contrast to `prefers-contrast: more` **(unverified)**. | near | 10.12 | none | contrast: unsupported → caveat on macOS |

### 3.4 Transforms and motion (the macOS downgrade)

| Feature | Technique | Fidelity | Min macOS | Cost | Upgrade? |
|---|---|---|---|---|---|
| translate | Frame origin offset after layout (transforms do not affect layout, as in CSS). | exact | any | none | same |
| scale (subtree with child views) | Set the view's `bounds.size` = frame size ÷ scale (`setBoundsSize`), which scales the whole coordinate system including subviews. Add a frame-origin shift to emulate `transform-origin`. | exact for positive scale; negative scale (flip) not expressible | any | none | exact → caveat |
| rotate (subtree) | `frameCenterRotation` rotates about the centre; any other `transform-origin` = centre rotation + a translation computed by Dragon. | exact maths | 10.5 | none | exact → caveat |
| skew, `matrix()`, composed transforms on views with children | Not expressible through NSView geometry, and `layer.transform`/`affineTransform` are forbidden on view layers. Options: (a) leaf elements with no child views: apply to the owned paint sublayers (exact); (b) non-interactive subtree: render into a layer-hosting view whose layers Dragon owns (exact visuals, but hit testing and accessibility frames are wrong); (c) build error for interactive subtrees. | leaf exact; subtree unsupported | 10.5 | — | **exact → caveat (leaf only)** |
| transform-origin | No `anchorPoint` on view layers (forbidden). Fold the origin into the translation, as above. | exact maths | any | none | exact → caveat |
| Transitions of opacity/transform | `NSAnimationContext.runAnimationGroup` + `view.animator()` for `alphaValue`/`frame`; `CABasicAnimation` on owned sublayers with a `CAMediaTimingFunction` built from the cubic-bezier. AppKit turns off implicit animations for view layers, which suits CSS (no animation unless a transition is declared). | near | 10.5 | Core Animation, off the main thread | same |
| Keyframes | `CAKeyframeAnimation` on owned sublayers. | later | 10.5 | — | same |

### 3.5 Text group (macOS specifics; the engine comparison is Part 2)

| Feature | Technique | Fidelity | Min macOS | Cost | Upgrade? |
|---|---|---|---|---|---|
| Display text (non-editable) | `NSTextView` with TextKit 2 (`NSTextLayoutManager`) for selectable text. For labels, one Dragon text view that draws `CTLine`s at Dragon-computed baselines (section 5). | near → exact for line boxes | 12 (TextKit 2), 13 as the `NSTextView` default **(unverified: default switch year)** | TextKit view is heavy; CTLine drawing is light | normal line height: caveat → exact line boxes with bundled fonts |
| Custom fonts | `CTFontManagerRegisterFontURLs` (process scope) with fonts bundled from `@font-face` (principle 5). | exact face | 10.15 | load at launch | same |
| Letter spacing | `kCTTrackingAttributeName` (not `.kern`): tracking "treats tracking as trailing whitespace and a nonzero amount disables nonessential ligatures", matching CSS/Chrome turning off optional ligatures when `letter-spacing` is non-zero. | near (Chrome adds after every character; whether the line-end space is trimmed differs **(unverified)**) | 10.12 | none | exact (iOS said kern) → keep exact but switch to tracking |
| Hyphenation (`hyphens: auto`) | `hyphenationFactor` (10.0) / `usesDefaultHyphenation` (12). Chrome on Mac hyphenates with the same `CFStringGetHyphenationLocationBeforeIndex` (10.7). Linux Chrome has no or different dictionaries. | same dictionary as Chrome-Mac; break choice differs | 12 | none | unsupported → caveat |
| Korean word wrap (`word-break: keep-all` for Hangul) | `NSParagraphStyle.LineBreakStrategy.hangulWordPriority`. | near | 11 | none | new |
| Orphan avoidance | `.pushOut` (10.11) pushes words so the last line is not a single word. It is not `text-wrap: pretty`, and it is on by default in `.standard` (11) UI-label strategy, so **Dragon must set `lineBreakStrategy = []`** for Chrome-like greedy breaking. | — | 10.11 | none | important default |

## 4. Part 2: text engines compared

Engines: **Chrome** = LayoutNG line breaker + HarfBuzz shaping + ICU line breaking with Blink's own tables. **Apple** = TextKit 2 / TextKit 1 over Core Text. **Android** = `StaticLayout` over Minikin (+ HarfBuzz inside Minikin) and Skia.

### 4.1 Font metrics and `line-height: normal` (the top pitfall, P1)

| | Chrome | Core Text / TextKit | Android |
|---|---|---|---|
| Where ascent/descent/gap come from | Skia's per-OS backend. **macOS:** `CTFontGetAscent/Descent/Leading` ([SkScalerContext_mac_ct.cpp](https://github.com/google/skia/blob/main/src/ports/SkScalerContext_mac_ct.cpp) lines ~688-691). **Linux/Android/ChromeOS:** FreeType port: OS/2 `sTypo*` **only if `USE_TYPO_METRICS` (fsSelection bit 7) is set, else hhea**. Skia's comment: FreeType "will always use HHEA metrics if they're not zero. It completely ignores the OS/2 fsSelection::UseTypoMetrics bit" ([SkFontHost_FreeType.cpp](https://github.com/google/skia/blob/main/src/ports/SkFontHost_FreeType.cpp) ~1598-1611). **Windows:** DirectWrite `DWRITE_FONT_METRICS` ascent/descent/lineGap ([SkScalerContext_win_dw.cpp](https://github.com/google/skia/blob/main/src/ports/SkScalerContext_win_dw.cpp) ~1870); DirectWrite uses win metrics unless `USE_TYPO_METRICS` **(unverified)**. | `CTFontGetAscent/Descent/Leading` ([CTFontGetLeading](https://developer.apple.com/documentation/coretext/ctfontgetleading(_:)) 10.5). Which OpenType table Core Text reads is not documented (hhea by common report) **(unverified)**. | Skia FreeType port (same rule as Linux Chrome) via `Paint.getFontMetrics` **(unverified: Minikin extent path, fetch failed)**. |
| Rounding | Blink rounds ascent and descent **each to whole pixels** (`SkScalarRoundToScalar`), except tiny fonts. On Linux/Android it moves 1px from ascent to descent if descent was rounded down. It can use the VDMX table on Linux/Android when hinting and no overrides are set. `LineSpacing = lround(a) + lround(d) + lround(gap)` ([font_metrics.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/fonts/font_metrics.cc) `AscentDescentWithHacks`; [simple_font_data.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/fonts/simple_font_data.cc) ~170-178) | fractional | integer `FontMetricsInt` **(unverified)** |
| Where the line gap goes | Split half above, half below (half-leading), per CSS Inline 3 §5.3. | TextKit adds leading below the line **(unverified placement)**. `NSLayoutManager.usesFontLeading` toggles it (10.7). | Ignored by default; `includeFontPadding` adds the font's top/bottom extents on the first and last lines instead. `setFallbackLineSpacing` (API 28) grows lines for tall fallback fonts. |
| Special cases | **macOS only:** +15% ascent for Times, Helvetica and Courier "to match Safari… The AppKit adjustment of 20% is too big and is incorrectly added to line spacing" (font_metrics.cc). So **AppKit itself adds 20% line spacing to those three families.** | iOS 17 / macOS 14: "automatically adjust the line height in UILabel or UITextField to accommodate languages with highly dynamic line heights", depending on text style and language ([WWDC23 10058](https://developer.apple.com/videos/play/wwdc2023/10058/)). | `elegantTextHeight`, `setLocalePreferredLineHeightForMinimumUsed`, `setMinimumFontMetrics` (API 35) change heights for tall scripts. |
| Spec recommendation | [CSS Inline 3 §3.2.1](https://drafts.csswg.org/css-inline-3/): use OS/2 `sTypoAscender/Descender`, fall back to hhea. **Chrome does not follow this** unless the font sets `USE_TYPO_METRICS`. | — | — |

**Consequences for Dragon:**

1. **Chrome disagrees with itself across operating systems.** For a font whose hhea and typo metrics differ and without `USE_TYPO_METRICS`, Linux Chrome (the goal's test lane) and macOS Chrome can produce different `line-height: normal`. A native "match Chrome" target is ill-defined unless the metrics are pinned.
2. **Metric overrides make every Chrome agree.** When `ascent-override`/`descent-override`/`line-gap-override` are set, Blink computes ascent/descent as `size × override` and skips the VDMX path (font_metrics.cc lines 64-80). So pitfalls.md §4.3's plan (read metrics at build time and write overrides into web `@font-face`) removes the OS dependency on web. **Refinement:** the native side must reproduce Blink's rounding too: `round(size·ascent) + round(size·descent) + round(size·gap)`, gap split half above and half below, and the Linux 1px descent adjustment only when the reference is Linux. pitfalls.md §4.3 pseudocode currently uses unrounded values.
3. **Never let native engines use their own `normal` or line-height models.** With AppKit's 20% for Times/Helvetica/Courier, TextKit's leading-below, the iOS 17/macOS 14 tall-script growth and Android's font padding, every one of them differs from CSS. Dragon emits explicit line geometry on every line.
4. **`text-box-trim`/`text-box-edge`** (Chrome 133, [blog](https://developer.chrome.com/blog/css-text-box-trim)): trimming to `cap`/`ex`/`alphabetic`/`text` is pure arithmetic on the same metrics (cap height, x-height from OS/2). Once Dragon owns the line box, this is cheap and exact on native. No native engine offers it directly.

### 4.2 Everything else

| Topic | Chrome | Core Text / TextKit | Android | Match by configuration | Needs Dragon logic or custom layout |
|---|---|---|---|---|---|
| **Line breaking (UAX 14)** | ICU break iterator + Blink ASCII fast-path table; types `kNormal`, `kBreakAll` (own class table), `kBreakCharacter` (break-word), `kKeepAll`, `kPhrase` ([text_break_iterator.cc/.h](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/text/text_break_iterator.cc)). ICU version follows Chrome's. | Core Text's own breaker (system ICU-based **(unverified)**); `lineBreakStrategy` (`.pushOut` 10.11, `.hangulWordPriority`/`.standard` 11); language-dependent CJK/German/Korean rules since iOS 17/macOS 14 that depend on text style ([WWDC23 10055](https://developer.apple.com/videos/play/wwdc2023/10055/)). Public UAX 14 segmenter: `CFStringTokenizer` with `kCFStringTokenizerUnitLineBreak`. | Minikin + ICU; `LineBreakConfig` (API 33): style `strict/normal/loose/none`, word style `phrase` (33), `auto` (35); `android.icu.text.BreakIterator` public **(API 24, unverified)**. | Latin/space-separated text with `lineBreakStrategy = []` and greedy breaking: near. `line-break: strict/loose/normal`: Android maps directly; Apple has no public equivalent. | Break *opportunities* can be forced into every engine by inserting **U+2060 WORD JOINER** (forbid) and **U+200B ZERO WIDTH SPACE** (allow) computed with a UAX 14 segmenter (build time for static text; runtime `CFStringTokenizer`/`android.icu` for dynamic text). Cost: characters show up in copy/paste and caret movement unless stripped **(unverified: VoiceOver/TalkBack ignore them)**. |
| **word-break / overflow-wrap** | `break-all`, `keep-all`, `break-word`/`anywhere` (grapheme breaks when a word overflows) | `.byWordWrapping` vs `.byCharWrapping` per paragraph, not per overflow; `hangulWordPriority` ≈ keep-all for Hangul | `LINE_BREAK_WORD_STYLE_*`, `BREAK_STRATEGY_SIMPLE` | `keep-all` (Korean) near on both | `overflow-wrap: anywhere` needs per-line logic: break normally, and only for a word wider than the line insert ZWSP between graphemes. That is custom logic, not custom layout. |
| **Greedy vs optimal** | Greedy by default; `text-wrap: balance` (Chrome 114) / `pretty` (117) **(unverified versions)** | Greedy + `pushOut` heuristic | `BREAK_STRATEGY_HIGH_QUALITY` (Knuth-Plass-like) is the **TextView default**, `BALANCED` (API 23) | Android: set `BREAK_STRATEGY_SIMPLE` to match Chrome's greedy. Apple: clear `pushOut`. | `balance`: Dragon binary-searches the width (measure with native engine at narrower widths until line count increases) — cheap logic, near. `pretty`: no match. |
| **Hyphenation** | Mac: `CFStringGetHyphenationLocationBeforeIndex` ([hyphenation_apple.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/text/apple/hyphenation_apple.cc)); Android/others: Minikin/AOSP hyphenator with pattern files (`use_minikin_hyphenation`, [platform/BUILD.gn](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/BUILD.gn)) | `hyphenationFactor` (threshold ratio) / `usesDefaultHyphenation` (12) | `setHyphenationFrequency` (23), `HYPHENATION_*` in LineBreakConfig (35) | **Dictionaries match per platform** (Mac Chrome = Apple CF; Android Chrome ≈ Minikin patterns). Which hyphen gets chosen differs (the factor is a threshold, Chrome hyphenates only when a word would overflow **(unverified)**). | Exact: compute breaks with the same CF/Minikin hyphenation points and a Chrome-like choice rule, then insert U+00AD soft hyphens only at chosen points. Reference must be the same-OS Chrome. |
| **Bidi (UAX 9)** | ICU ubidi; `unicode-bidi` values equivalent to control characters (CSS Writing Modes defines them that way) | Core Text UAX 9; `NSWritingDirection` + `NSWritingDirectionFormatType` embedding/override | Minikin/ICU; `TextDirectionHeuristics` | Base direction: paragraph setting on all. | Compile `unicode-bidi: isolate/embed/bidi-override/plaintext` into **LRI/RLI/FSI/PDI, LRE/RLE/PDF, LRO/RLO** characters around the run. Same input to three UAX 9 implementations gives exact levels, bar implementation bugs. Cheap. |
| **Letter spacing** | Adds after each character; disables optional ligatures | `kCTTrackingAttributeName`: trailing, disables nonessential ligatures (10.12) | Minikin adds **half before and half after** each cluster (`letterSpaceHalf`, [LayoutCore.cpp](https://android.googlesource.com/platform/frameworks/minikin/+/refs/heads/main/libs/minikin/LayoutCore.cpp) ~375-483); em units (API 21) | Apple: tracking = near exact. Android: total width equal, glyphs shifted by ls/2. | Android: shift the text view by −ls/2 at line start (start-aligned) and add ls/2 at line end. Logic, exact for widths. |
| **Word spacing** | yes | no attribute | no attribute (API 34 `setWordSpacing` on Paint **(unverified)**) | — | Custom: widen U+0020 advances via kern on the space glyph (Apple `.kern` on the space characters). Near. |
| **Ligatures, font-feature-settings** | HarfBuzz; default features on; `font-variant-*` map to OT tags | `kCTFontFeatureSettingsAttribute` with OpenType tags; `kCTLigatureAttributeName` 0/1/2 | `setFontFeatureSettings` (CSS syntax string, API 21) | Mostly configuration: pass the same OT tags. Default feature sets differ at the edges (for example `calt`, `locl`) **(unverified)**. | Test per feature value, as the support table says. |
| **Shaping** | HarfBuzz on every OS (AAT via HarfBuzz on Mac) | Core Text (AAT `morx` + OpenType) | HarfBuzz in Minikin | Latin/OpenType fonts: same glyphs expected. AAT-only fonts (some Apple system fonts): Core Text is the reference implementation. | None normally. |
| **Font fallback** | Mac: `CTFontCreateForString` with `CTFontCopyDefaultCascadeListForLanguages` ([font_cache_mac.mm](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/fonts/mac/font_cache_mac.mm) ~143-180). Linux: fontconfig. Android: system font map. | `CTFontCreateForString`, cascade list (`kCTFontCascadeListAttribute`) | system fallback chain | **Mac = same algorithm as Chrome-Mac.** Across OSes: impossible (different font sets). | Bundle fonts with full coverage for parity fixtures; system-font fallback stays a documented caveat (B1). |
| **Glyph positioning / subpixel** | Chrome Mac enables subpixel positioning and AA (font_platform_data_mac.mm ~214-246); LayoutUnit = 1/64 px | CTLine fractional positions; CG rasteriser (same rasteriser Chrome-Mac uses through Skia's CT scaler) | Skia with subpixel text on by default (`Paint.SUBPIXEL_TEXT_FLAG` **(unverified)**) | Mac rendering can be pixel-close to Chrome-Mac. | Box comparisons stay at the 1px tolerance; glyph pixels are a caveat. |
| **Per-line geometry hook** | — | TextKit 1: `NSLayoutManagerDelegate.layoutManager(_:shouldSetLineFragmentRect:lineFragmentUsedRect:baselineOffset:in:forGlyphRange:)` sets each line's rect **and baseline** (macOS 10.11; iOS 9 **(unverified iOS version)**). TextKit 2: custom `NSTextLayoutFragment` via `textLayoutManager(_:textLayoutFragmentFor:in:)` (12). Core Text: position each `CTLine` yourself. | `LineHeightSpan.chooseHeight` sets per-line ascent/descent (API 1). | — | This is the lever that makes half-leading exact without custom line breaking. |

## 5. Text strategy recommendation

**Adopt: "native engine, Dragon line box".** For each text block:

1. **Break lines** with the native engine, configured to be Chrome-like: Apple `lineBreakStrategy = []`, `.byWordWrapping`, hyphenation off unless `hyphens: auto`; Android `BREAK_STRATEGY_SIMPLE`, `includeFontPadding = false`, `setFallbackLineSpacing(false)`, `LineBreakConfig` from `line-break`/`word-break`. Pre-process the string with Unicode controls for bidi, `overflow-wrap`, `keep-all` and soft hyphens where Dragon owns the decision.
2. **Place lines** with Dragon's line box: Chrome-rounded ascent/descent/gap from the build-time font table read (pinned rule, the same numbers written to web overrides), half-leading split, `text-box-trim`, applied through the per-line hook (`shouldSetLineFragmentRect…baselineOffset`, custom `NSTextLayoutFragment`, `LineHeightSpan`) or by drawing `CTLine`s at computed baselines for non-selectable labels.
3. **Measure for Taffy** through the same code path used to draw, so the size Taffy sees is the size drawn.

```swift
// TextKit 1 hook: exact CSS half-leading per line, native breaking and shaping untouched
func layoutManager(_ lm: NSLayoutManager, shouldSetLineFragmentRect r: UnsafeMutablePointer<NSRect>,
                   lineFragmentUsedRect u: UnsafeMutablePointer<NSRect>, baselineOffset b: UnsafeMutablePointer<CGFloat>,
                   in c: NSTextContainer, forGlyphRange g: NSRange) -> Bool {
  let box = dragonLineBox(for: g)          // {height, baseline} from build-time metrics, Blink rounding
  r.pointee.size.height = box.height; u.pointee.size.height = box.height; b.pointee = box.baseline
  return true
}
```

```kotlin
// Android equivalent
class CssLineHeight(private val box: LineBox) : LineHeightSpan {
  override fun chooseHeight(t: CharSequence, s: Int, e: Int, v: Int, lh: Int, fm: Paint.FontMetricsInt) {
    fm.ascent = -box.baseline; fm.descent = box.height - box.baseline; fm.top = fm.ascent; fm.bottom = fm.descent
  }
}
```

**Why not own line layout (HarfBuzz + ICU4X + drawing glyph runs with `CTFontDrawGlyphs` / `Canvas.drawGlyphs` API 31):**

| Factor | Native + Dragon line box | Own line layout |
|---|---|---|
| Line-box geometry (the top pitfall) | exact (hook) | exact |
| Break points vs **Linux** Chrome | near; edge cases in CJK, emoji, punctuation | near-exact if the ICU version and Blink's tables are copied (Blink has its own break-all table and ASCII fast path, so plain ICU is not enough) |
| Break points and fallback vs **the user's own** Chrome (Mac or Android) | Mac: same fallback and hyphenation functions as Chrome-Mac | worse on Mac: Chrome-Mac uses CT fallback and CF hyphenation, which a HarfBuzz stack would have to call anyway |
| Selection, VoiceOver/TalkBack text navigation, IME, spell-check, Dynamic Type, system tall-script adjustments, Writing Tools | free | rebuild each (Flutter's path, years of work) **(unverified effort)** |
| Binary size | none | HarfBuzz plus segmenter data; ICU4X line segmenter with dictionary/LSTM data for Thai/Lao/Khmer/Burmese and CJK phrases adds megabytes **(unverified figures)** |
| Main-thread cost | native engines are optimised and cached | own shaping cache, own invalidation |

**When to revisit:** if the parity corpus shows break differences in Latin text at common widths above an agreed rate, add an opt-in "exact text" mode for display-only text (headings, labels) that places glyph runs itself. Editable text always stays native.

**Test implications:** (a) keep Ahem for layout fixtures (goal.md); (b) add tight line-height fixtures that cover the rounding rule (sizes whose ascent and descent round in different directions); (c) text-parity fixtures use bundled fonts with metric overrides, never `system-ui`; (d) hyphenation and fallback parity needs a **macOS Chrome** reference lane later. Linux Chrome cannot be the reference for them.

## 6. Support-table rows that can change for a macOS target

| Row (css-support.md) | iOS today | macOS proposal | Technique |
|---|---|---|---|
| Blur and other color filters | unsupported | **caveat** | `NSView.contentFilters` with `CIColorMatrix` (CSS matrices) and `CIGaussianBlur`; in-process rendering cost; colour-space probe first |
| Backdrop blur | approx | **caveat** (after probe) | `NSView.backgroundFilters` with plain `CIGaussianBlur` (no material tint) |
| Other backdrop effects | unsupported | **caveat** (after probe) | same, colour filters |
| Blend modes | unsupported | **caveat** | `NSView.compositingFilter` with `CI*BlendMode` (all 15 modes) |
| Isolation | unsupported | unsupported | pending probe |
| Clip paths/masks | unsupported | **caveat** | `view.layer.mask` shape or image layer + path hit testing |
| Conic/repeating gradients | approx | **caveat** | `CAGradientLayer.type = .conic` (10.14) |
| Background clipped to text | approx | caveat | text mask layer |
| Outlines/focus rings | approx | **caveat** (authored); approx (`auto`) | owned `CAShapeLayer`; system ring via `drawFocusRingMask` |
| Cursor | no-effect | **caveat** | tracking area `.cursorUpdate` + `NSCursor` keyword map |
| Hover/pointer queries | caveat | **exact** | always hover/fine on macOS; `NSTrackingArea` |
| Active/focus/hover… | caveat | caveat (hover part exact) | tracking areas; key-view loop |
| Overscroll | unsupported | **caveat** (`none`/`auto`) | `scrollElasticity` |
| Sticky positioning | unsupported | **caveat** (logic) | clip-view bounds observer + owned-layer offset |
| Contrast queries | unsupported | **caveat** (`more` only) | `accessibilityDisplayShouldIncreaseContrast` |
| Word breaking/hyphenation | unsupported | **caveat** | `usesDefaultHyphenation`/`hyphenationFactor` + soft hyphens chosen by Dragon; same CF dictionary as Chrome-Mac |
| Normal line height | caveat | **caveat → exact line boxes** with bundled fonts | Dragon line box via layout-manager hook |
| Number/length line height | caveat | **exact line boxes** (with fixtures) | same; closes T029's "offset formula unverified" by not using `baselineOffset` at all |
| Unicode bidi | caveat | caveat → **exact levels** | compile `unicode-bidi` to control characters (applies to iOS and Android too) |
| Letter spacing | exact | exact (switch from `.kern` to `kCTTrackingAttributeName`) | tracking disables nonessential ligatures as Chrome does |
| Balanced wrapping | unsupported | caveat (logic) | width binary search with native measure |
| **Skew/general affine matrix** | exact | **downgrade → caveat (leaf elements only)** | view-layer `transform` is undefined behaviour on macOS |
| **Transform origin** | exact | **downgrade → caveat** | fold into translation; no `anchorPoint` |
| **2D scale/rotate** | exact | **downgrade → caveat** | `setBoundsSize` / `frameCenterRotation` |

## 7. Open questions and probes before claiming any row

1. Core Image working colour space for layer `filters`/`compositingFilter` (linear vs sRGB). This decides whether blend modes and colour filters are exact or near.
2. Whether `backgroundFilters` renders for layer-backed NSViews on macOS 13-26.
3. `CIGaussianBlur.inputRadius` vs CSS blur standard deviation.
4. Where TextKit puts the font leading; whether AppKit's 20% Times/Helvetica/Courier adjustment still applies in TextKit 2.
5. Which table Core Text reads for ascent (hhea vs typo when `USE_TYPO_METRICS` is set). If it differs from FreeType's rule, Linux Chrome and native Mac differ unless the overrides are applied (they are, by design).
6. Whether Chrome trims trailing `letter-spacing` at line end.
7. **Owner decision:** macOS minimum version (proposed 13), and whether macOS is a Dragon target at all in the near term. This note does not change milestone 1 scope.

## 8. Sources (all accessed 2026-09-26)

- Apple docs (via doc JSON): [CALayer.filters](https://developer.apple.com/documentation/quartzcore/calayer/filters), [backgroundFilters](https://developer.apple.com/documentation/quartzcore/calayer/backgroundfilters), [compositingFilter](https://developer.apple.com/documentation/quartzcore/calayer/compositingfilter), [NSView.layerUsesCoreImageFilters](https://developer.apple.com/documentation/appkit/nsview/layerusescoreimagefilters), [NSView.contentFilters](https://developer.apple.com/documentation/appkit/nsview/contentfilters), [NSView.backgroundFilters](https://developer.apple.com/documentation/appkit/nsview/backgroundfilters), [NSView.compositingFilter](https://developer.apple.com/documentation/appkit/nsview/compositingfilter), [NSVisualEffectView](https://developer.apple.com/documentation/appkit/nsvisualeffectview), [addFloatingSubview](https://developer.apple.com/documentation/appkit/nsscrollview/addfloatingsubview(_:for:)), [verticalScrollElasticity](https://developer.apple.com/documentation/appkit/nsscrollview/verticalscrollelasticity), [scrollerStyle](https://developer.apple.com/documentation/appkit/nsscrollview/scrollerstyle), [focusRingMaskBounds](https://developer.apple.com/documentation/appkit/nsview/focusringmaskbounds), [drawFocusRingMask](https://developer.apple.com/documentation/appkit/nsview/drawfocusringmask()), [focusRingType](https://developer.apple.com/documentation/appkit/nsview/focusringtype), [NSTrackingArea](https://developer.apple.com/documentation/appkit/nstrackingarea), [addCursorRect](https://developer.apple.com/documentation/appkit/nsview/addcursorrect(_:cursor:)), [wantsUpdateLayer](https://developer.apple.com/documentation/appkit/nsview/wantsupdatelayer), [canDrawSubviewsIntoLayer](https://developer.apple.com/documentation/appkit/nsview/candrawsubviewsintolayer), [isFlipped](https://developer.apple.com/documentation/appkit/nsview/isflipped), [backingAlignedRect](https://developer.apple.com/documentation/appkit/nsview/backingalignedrect(_:options:)), [clipsToBounds](https://developer.apple.com/documentation/appkit/nsview/clipstobounds), [NSView.shadow](https://developer.apple.com/documentation/appkit/nsview/shadow), [frameCenterRotation](https://developer.apple.com/documentation/appkit/nsview/framecenterrotation), [setBoundsSize](https://developer.apple.com/documentation/appkit/nsview/setboundssize(_:)), [CAGradientLayerType.conic](https://developer.apple.com/documentation/quartzcore/cagradientlayertype/conic), [cornerCurve](https://developer.apple.com/documentation/quartzcore/calayer/cornercurve), [maskedCorners](https://developer.apple.com/documentation/quartzcore/calayer/maskedcorners), [NSColor(name:dynamicProvider:)](https://developer.apple.com/documentation/appkit/nscolor/init(name:dynamicprovider:)), [NSTextLayoutManager](https://developer.apple.com/documentation/appkit/nstextlayoutmanager), [NSTextLineFragment](https://developer.apple.com/documentation/appkit/nstextlinefragment), [kCTTrackingAttributeName](https://developer.apple.com/documentation/coretext/kcttrackingattributename), [LineBreakStrategy](https://developer.apple.com/documentation/appkit/nsparagraphstyle/linebreakstrategy-swift.struct) (+ [pushOut](https://developer.apple.com/documentation/appkit/nsparagraphstyle/linebreakstrategy-swift.struct/pushout), [hangulWordPriority](https://developer.apple.com/documentation/appkit/nsparagraphstyle/linebreakstrategy-swift.struct/hangulwordpriority), [standard](https://developer.apple.com/documentation/appkit/nsparagraphstyle/linebreakstrategy-swift.struct/standard)), [hyphenationFactor](https://developer.apple.com/documentation/appkit/nsparagraphstyle/hyphenationfactor), [usesDefaultHyphenation](https://developer.apple.com/documentation/appkit/nsparagraphstyle/usesdefaulthyphenation), [usesFontLeading](https://developer.apple.com/documentation/appkit/nslayoutmanager/usesfontleading), [shouldSetLineFragmentRect delegate](https://developer.apple.com/documentation/appkit/nslayoutmanagerdelegate/layoutmanager(_:shouldsetlinefragmentrect:linefragmentusedrect:baselineoffset:in:forglyphrange:)), [textLayoutFragmentFor delegate](https://developer.apple.com/documentation/appkit/nstextlayoutmanagerdelegate/textlayoutmanager(_:textlayoutfragmentfor:in:)), [CTFontGetLeading](https://developer.apple.com/documentation/coretext/ctfontgetleading(_:)), [CTTypesetterSuggestLineBreak](https://developer.apple.com/documentation/coretext/cttypesettersuggestlinebreak(_:_:_:)), [CTFontCreateForString](https://developer.apple.com/documentation/coretext/ctfontcreateforstring(_:_:_:)), [kCTFontCascadeListAttribute](https://developer.apple.com/documentation/coretext/kctfontcascadelistattribute), [CTFontDrawGlyphs](https://developer.apple.com/documentation/coretext/ctfontdrawglyphs(_:_:_:_:_:)), [CFStringGetHyphenationLocationBeforeIndex](https://developer.apple.com/documentation/corefoundation/cfstringgethyphenationlocationbeforeindex(_:_:_:_:_:_:)), [kCFStringTokenizerUnitLineBreak](https://developer.apple.com/documentation/corefoundation/kcfstringtokenizerunitlinebreak), [SwiftUI layerEffect](https://developer.apple.com/documentation/swiftui/view/layereffect(_:maxsampleoffset:isenabled:)) (macOS 14), [NSHostingView](https://developer.apple.com/documentation/swiftui/nshostingview) (10.15).
- Apple WWDC: [WWDC23 10058 What's new with text and text interactions](https://developer.apple.com/videos/play/wwdc2023/10058/), [WWDC23 10055 What's new in UIKit](https://developer.apple.com/videos/play/wwdc2023/10055/); [AppKit 10.13 release notes, layer-backed views](https://developer.apple.com/library/archive/releasenotes/AppKit/RN-AppKit/#10_13Layer-backed%20Views) (quoted by the next two).
- [react-native-macos #466](https://github.com/microsoft/react-native-macos/issues/466); [Apple forums thread 88567](https://forums.developer.apple.com/forums/thread/88567); [jwilling.com OS X animations](https://jwilling.com/blog/osx-animations/).
- Chromium source: [font_metrics.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/fonts/font_metrics.cc), [simple_font_data.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/fonts/simple_font_data.cc), [text_break_iterator.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/text/text_break_iterator.cc), [text_break_iterator.h](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/text/text_break_iterator.h), [hyphenation_apple.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/text/apple/hyphenation_apple.cc), [platform/BUILD.gn](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/BUILD.gn), [font_cache_mac.mm](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/fonts/mac/font_cache_mac.mm), [font_platform_data_mac.mm](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/fonts/mac/font_platform_data_mac.mm).
- Skia source: [SkFontHost_FreeType.cpp](https://github.com/google/skia/blob/main/src/ports/SkFontHost_FreeType.cpp), [SkScalerContext_mac_ct.cpp](https://github.com/google/skia/blob/main/src/ports/SkScalerContext_mac_ct.cpp), [SkScalerContext_win_dw.cpp](https://github.com/google/skia/blob/main/src/ports/SkScalerContext_win_dw.cpp).
- Android: [Minikin LayoutCore.cpp](https://android.googlesource.com/platform/frameworks/minikin/+/refs/heads/main/libs/minikin/LayoutCore.cpp); reference pages (API levels read from page text): [TextView](https://developer.android.com/reference/android/widget/TextView), [StaticLayout.Builder](https://developer.android.com/reference/android/text/StaticLayout.Builder), [LineBreakConfig](https://developer.android.com/reference/android/graphics/text/LineBreakConfig), [Canvas](https://developer.android.com/reference/android/graphics/Canvas) (`drawGlyphs` API 31).
- Specs and Chrome: [CSS Inline 3](https://drafts.csswg.org/css-inline-3/) §3.2.1, §5.3, §6.2-6.3; [Chrome text-box-trim blog](https://developer.chrome.com/blog/css-text-box-trim) (Chrome 133).

```json
{
  "goalbuddy_receipt_v1": {
    "task": "T016",
    "role": "Scout",
    "result": "done",
    "harness": "claude-code",
    "summary": "macOS playbook plus cross-engine text comparison. macOS supports CALayer filters/backgroundFilters/compositingFilter (use the NSView contentFilters/backgroundFilters/compositingFilter API; forces in-process rendering), so CSS filter, mix-blend-mode, clip-path and conic gradients can move from unsupported/approx to caveat pending colour-space and backgroundFilters probes. Landmine: since 10.13, changing transform, anchorPoint, masksToBounds, shadow*, filters or compositingFilter on an NSView's own layer is undefined behaviour and AppKit resets transform/anchorPoint, so paint goes on Dragon-owned sublayers and skew/matrix/transform-origin on subtrees are downgraded from exact to caveat (leaf only). Hover becomes exact (NSTrackingArea), cursor maps to NSCursor keywords, authored outlines become exact geometry, sticky via clip-view observer. Text: Chrome reads metrics per OS (Mac CTFontGet*, Linux/Android FreeType typo-only-if-USE_TYPO_METRICS-else-hhea, Windows DirectWrite), rounds ascent/descent/gap each to whole px, and on Mac adds 15% ascent to Times/Helvetica/Courier; metric overrides bypass the OS path. Chrome-Mac shares Core Text fallback (CTFontCreateForString) and CF hyphenation with AppKit. Android letter-spacing is half-before/half-after. Recommendation: native engines for breaking/shaping/fallback/bidi/editing, with Dragon owning the line box (Blink-rounded half-leading, text-box-trim) through per-line hooks (NSLayoutManagerDelegate shouldSetLineFragmentRect/baselineOffset, custom NSTextLayoutFragment, Android LineHeightSpan), plus Unicode controls for bidi/overflow-wrap/soft hyphens; own HarfBuzz+ICU4X layout is rejected for 1.0.",
    "evidence": ["docs/goals/milestone-1/notes/T016-macos-text-playbook.md"],
    "upgrades": ["blur/color filters", "backdrop blur (after probe)", "other backdrop effects (after probe)", "blend modes", "clip paths/masks", "conic gradients", "background-clip text", "authored outlines", "cursor", "hover/pointer queries", "overscroll", "sticky (logic)", "contrast queries", "hyphenation", "line height line boxes", "unicode bidi levels", "balanced wrapping (logic)"],
    "downgrades": ["skew/general matrix (macOS)", "transform origin (macOS)", "2D scale/rotate on subtrees (macOS)"],
    "corrections": ["pitfalls.md 4.3 pseudocode must round ascent, descent and gap each to whole pixels like Blink", "letter-spacing on Apple should use kCTTrackingAttributeName, not kern", "native engines must never use their own line-height normal (AppKit 20% on Times/Helvetica/Courier, iOS 17/macOS 14 tall-script growth, Android font padding)", "hyphenation and fallback parity needs a same-OS Chrome reference, not the Linux lane"],
    "unverified": ["Core Image working colour space for layer filters", "backgroundFilters on layer-backed views in current macOS", "CIGaussianBlur radius vs CSS sigma", "TextKit leading placement", "Core Text ascent table choice", "Chrome trailing letter-spacing at line end", "DirectWrite metric choice", "Chrome :hover in background windows", "binary size of HarfBuzz+ICU4X"],
    "owner_decisions": ["macOS minimum version (proposed 13) and whether macOS is a near-term target", "text strategy: native engine + Dragon line box (recommended) vs own line layout"],
    "files_written": ["docs/goals/milestone-1/notes/T016-macos-text-playbook.md"],
    "full_outcome_complete": false
  }
}
```
