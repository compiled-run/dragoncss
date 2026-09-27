# T015: Android (Views) engineering playbook

Scout note, read-only research, 2026-09-26. Scope: for every feature group in `docs/research/css-support.md`, the Android View technique that best matches Chrome, how close it gets, the minimum API level, what it costs, and whether it could move the Android column of the support table. Every "upgrade" below is a **proposal**: under AGENTS.md nothing changes status until a Chrome-vs-Android parity fixture passes.

## How to read this

- **Fidelity.** `exact`: same geometry and paint as Chrome within a measured tolerance, by construction. `near`: same model, small known numeric differences (rounding, anti-aliasing, blur kernel). `approx`: visibly different in some cases; needs a warning.
- **Min API.** The lowest Android API level where the public API exists. "37.2" is a minor SDK version (the numbering scheme Android introduced with Android 16), as printed in the reference page.
- **Cost.** `main`: work on the UI thread per layout or per frame. `record`: only re-records the view's display list on change (cheap). `RT`: RenderThread/GPU. `offscreen`: an intermediate buffer (memory = width × height × 4 bytes per layer, plus a GPU pass).
- **Evidence tags.** `[doc]` = Android reference page fetched and read 2026-09-26 (API level copied from the page). `[src]` = open-source code read 2026-09-26. `[unverified]` = my own engineering knowledge or a secondary source; a lead that needs a fixture or a primary read. All URLs accessed 2026-09-26.
- **Current status** is the Android column of `css-support.md` today; **proposed** is what a passing fixture could justify.

## Summary

1. **Android can match much more of the paint table than the current rows claim.** The big levers are `Canvas` drawing in a Dragon-owned `Drawable` (per-side borders, radii, shadows via `BlurMaskFilter` + `clipOutPath`, inset shadows via `drawDoubleRoundRect`), `RenderEffect` (all CSS filter functions from API 31), layer-paint `BlendMode` (blend modes and isolation from API 29), `RuntimeShader`/AGSL (the paint-worklet equivalent, API 33) and `Outline.setPath` clipping (any shape from API 33).
2. **Text is where Android is controllable but hostile by default.** Five defaults must be overridden on every text node: `includeFontPadding` (true), break strategy (`HIGH_QUALITY`, not Chrome's greedy breaking), hyphenation (theme-dependent), fallback line spacing, and `TextView`'s own clip rectangle (the descender-clipping bug). CSS half-leading is reproducible exactly with a `LineHeightSpan` (Jetpack Compose already ships one). `text-wrap: balance` is reproducible in logic (binary search on width), and `word-spacing` has a real API (`Paint.setWordSpacing`, API 29).
3. **Recommend `minSdk 29` (Android 10) as the backend floor**, with feature tiers at 31 (filters), 33 (AGSL, path clipping, line-break config), 35 (per-span no-break/no-hyphenation) and 37.2 (backdrop filters). API 29 is where `BlendMode`, `drawDoubleRoundRect`, `setWordSpacing`, `setAnimationMatrix`, `RenderNode`, `Typeface.CustomFallbackBuilder`, `LineHeightSpan.Standard`, `setForceDarkAllowed` and 64-bit colours all arrive. Features above the declared floor stay build errors per pitfall P21.
4. **Landmines found that are not in `pitfalls.md` yet:** `ArgbEvaluator` interpolates differently from CSS; `View.INVISIBLE` hides the whole subtree while CSS `visibility` lets a child opt back in; `ViewGroup` clips children by default (CSS `overflow` defaults to visible); `LINE_BREAK_STYLE_NO_BREAK` still breaks graphemes "to prevent clipping", so CSS `overflow-wrap: normal` (long words overflow) cannot be matched; `TextView` defaults to `BREAK_STRATEGY_HIGH_QUALITY`; Android 15 flips `elegantTextHeight` and Android 16 ignores it; force-dark can repaint Dragon colours unless disabled; animator duration scale changes every `ValueAnimator`.
5. **About 30 rows can be proposed for an upgrade** (list in section 12). Most are paint rows moving from `approx`/`unsupported` to `caveat`, plus a handful of `caveat` to `exact` candidates (opacity, radii, per-side borders, single outset shadow, colour filters, blend modes).

## 1. Architecture every technique below assumes

One Dragon view type per element kind, each with a Dragon-owned background `Drawable` and a small set of hooks. This keeps the "compiler owns platform choices" principle: the compiler emits resolved values; the runtime only paints them.

- **`DragonBoxDrawable`** (set as the view background) paints, in CSS order: outer box-shadows, background colour, background images/gradients, inset box-shadows, border. CSS paint order is shadow, background, inset shadow, border, then content ([CSS Backgrounds 3 §7](https://www.w3.org/TR/css-backgrounds-3/#shadow-layers), accessed 2026-09-26) [unverified: exact section wording].
- **Outline provider** supplies the rounded shape for clipping (and never for elevation shadows, see section 4).
- **`dispatchDraw` override** on containers for rounded `overflow: hidden` (clip to the *padding-box* inner radii), `clip-path`, masks.
- **`onDrawForeground`** (API 23 [doc]) for `outline` / focus rings, because it draws after children.
- **Parent draws the child's exterior shadow** when the child clips (`overflow: hidden` + `box-shadow`), the Android equivalent of the iOS wrapper-layer rule (pitfall P3).
- **Every `ViewGroup` gets `clipChildren = false` and `clipToPadding = false`** unless CSS says `overflow: hidden|clip`. Android clips children to parent bounds by default; CSS defaults to `overflow: visible`. This must be set on the whole ancestor chain, since each parent clips its own children [unverified: behaviour well known, needs a fixture].
- **Views are laid out on whole device pixels** (`View.layout(int,int,int,int)`); Taffy's rounding runs in device pixels (`px × density`) before calling `layout`.
- **Compose reuse.** Several Compose pieces are open source and usable as references or copied code (Apache 2.0): `LineHeightStyleSpan` (half-leading), `PlaceholderSpan` (inline boxes), the Compose shadow painters, and `androidx.graphics:graphics-shapes` (which outputs `android.graphics.Path`, so it works in Views).

```kotlin
class DragonBoxDrawable(var s: ResolvedBox) : Drawable() {
  override fun draw(c: Canvas) {
    s.outerShadows.asReversed().forEach { drawOuterShadow(c, it) } // first CSS shadow on top
    fillBackground(c)            // colour, then gradient layers bottom-up
    s.innerShadows.asReversed().forEach { drawInnerShadow(c, it) }
    drawBorder(c)                // per-side, see section 2
  }
}
```

## 2. Borders and radii

| Feature (row id) | Technique | Fidelity | Min API | Cost | Current → proposed |
|---|---|---|---|---|---|
| Uniform solid border (`border`) | `Canvas.drawDoubleRoundRect(outer, outerRadii, inner, innerRadii, paint)` fills the ring between the border box and the padding box. Fill, don't stroke: strokes straddle the path and land on half pixels. | exact | 29 [doc] (API 21-28: `Path` with `FillType.EVEN_ODD`, two `addRoundRect`) | record | caveat → **exact** candidate |
| Per-side widths and colours (`border`) | For each side, clip to that side's wedge (a polygon from the outer corner to the inner corner, the join line Chrome uses), then fill the same ring in that side's colour. Inner radii per axis: `max(0, outer − width)`, so unequal widths give elliptical inner corners, as in CSS. | near (join anti-aliasing) | 29 (21 with path fill) | record; 4 clip-and-fill passes | caveat → **caveat** kept, technique defined; pitfall P5's "error until fixture" can lift after a radius+per-side fixture |
| Radii per corner and elliptical (`radius`) | Dragon computes CSS radius clamping itself (if adjacent radii exceed a side, scale **all** radii by the smallest factor, CSS Backgrounds 3 §5.5 [unverified: section number]) and feeds 8 values to `Path.addRoundRect(RectF, float[8], dir)` or `drawDoubleRoundRect(…float[]…)`. `GradientDrawable`'s own clamping differs from CSS, so don't use it. | exact | 21 (path), 29 (double rrect) | record | caveat → **exact** candidate (resolves the "elliptical x/y unverified" note: the 8-value array is x/y pairs per corner) |
| Dashed / dotted / double (`pattern-border`) | `double`: two fills, each `width/3` (Chrome rounds the thirds [unverified]). `dashed`/`dotted`: port Chromium's box border painter (dash length and gap derived from width, adjusted so each side starts and ends on a full dash; dotted = round dots via `Paint.Cap.ROUND` with zero-length dashes) and draw with `DashPathEffect` along the side's centre line. CSS does not define dash lengths, so Chrome's algorithm is the oracle. Source: [Chromium `box_border_painter.cc`](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/paint/box_border_painter.cc) [unverified: not read this pass]. | near once ported; approx otherwise | 1 (`DashPathEffect`, HW-supported for lines from 28 [doc: hardware-accel table]) | record | approx → **caveat** candidate only after porting + fixture |
| Groove/ridge/inset/outset (`other-border`) | Same per-side wedge fills with Chromium's darker/lighter colour derivation. | near after port | 29 | record | unsupported → approx candidate (low priority) |
| Border images (`other-border`) | Nine-slice with `Canvas.drawBitmapMesh` or 9 `drawBitmap` calls. | near | 1 | record + decode | stays unsupported (release scope) |
| Hairlines / sub-pixel widths | Apply CSS's "snap as a border width" rule: widths ≥ 1 device pixel round **down** to whole device pixels, smaller non-zero widths become 1 device pixel ([CSS Values 4](https://drafts.csswg.org/css-values-4/#snap-a-length-as-a-border-width) [unverified: current draft text]). At density 2.625, `1px` is 2.625 device px → 2 device px. Draw fills aligned to device-pixel edges. | exact if Chrome follows the draft (fixture) | 1 | none | feeds pitfall P11 |
| Corner shape (`corners`) | `androidx.graphics.shapes.RoundedPolygon` → `Path` for superellipse/squircle corners ([docs](https://developer.android.com/reference/kotlin/androidx/graphics/shapes/package-summary) [unverified]). | approx (Chrome availability itself unverified) | 21 (library) | record | unsupported → approx candidate, deferred |

```kotlin
// One side of a per-side border: clip to the side's wedge, fill the ring.
fun drawSide(c: Canvas, ring: Pair<RectF, RectF>, radii: Radii, wedge: Path, color: Int) {
  c.save(); c.clipPath(wedge)
  paint.color = color
  c.drawDoubleRoundRect(ring.first, radii.outer, ring.second, radii.inner, paint)
  c.restore()
}
```

## 3. Rounded clipping of children (`clip`, `rounded-clip`, `contain-paint`)

- **What CSS does.** `overflow: hidden` with `border-radius` clips children to the **padding box** with the **inner** radii, not the border box. The box's own border and shadow are not clipped by it.
- **`clipToOutline`** (API 21 [doc]): clips the view's whole drawing (background, border, children and anything drawn outside the outline) to one outline. Limits from the docs: "Only a single non-rectangular clip can be applied on a View at any time", circular reveal wins, and child outline clipping takes priority over a parent's [doc]. `Outline.canClip()`: "As of API 33, all Outline shapes support clipping. Prior to API 33, only Outlines that could be represented as a rectangle, circle, or round rect supported clipping" [doc](https://developer.android.com/reference/android/graphics/Outline#canClip()). `Outline.setRoundRect` takes **one** radius, so per-corner radii need `setPath` (API 30 [doc]) and only clip from API 33.
- **Recommended technique:** in the container's `dispatchDraw`, `canvas.clipPath(paddingBoxInnerRRect)` then `super.dispatchDraw`. This clips only children, with the correct inner radii, at any API level. `clipPath` has been hardware-accelerated since API 18 [doc: hardware-accel table]. Anti-aliasing of `clipPath` edges on the Skia pipeline is [unverified]; if a fixture shows aliased edges, fall back to `clipToOutline` with a path outline on API 33+ (anti-aliased [unverified]) or a `saveLayer` + `DST_IN` mask (anti-aliased, one offscreen buffer).
- **Shadow under clip:** the box's outer shadow is drawn by the parent (or the element's shadow is recorded in a sibling `RenderNode` drawn first by the parent), so clipping never removes it. Same outcome as the iOS wrapper rule.
- **Fidelity:** exact for uniform and per-corner radii with the `dispatchDraw` clip; near at the anti-aliased edge.
- **Cost:** record only; `saveLayer` fallback costs one offscreen buffer the size of the box.
- **Status:** `clip` stays exact; `rounded-clip` caveat → **exact** candidate (fixture: child overflowing each corner, with and without border, plus exterior shadow present).

## 4. Shadows (`shadow`, `other-shadows`, `simple-filter`, `text-shadow`)

**Elevation is the wrong tool for `box-shadow`.** Elevation shadows come from a light source fixed relative to the screen (top-centre, above the display), so the same view casts a different shadow at different screen positions; they have no blur/offset/spread parameters; they change sibling draw order (higher Z draws later), fighting Dragon's `z-index`-as-sibling-order (pitfall P8). `setOutlineAmbientShadowColor`/`setOutlineSpotShadowColor` (API 28 [doc]) colour them but don't fix the geometry. Use elevation only if an author explicitly opts into a platform shadow; never as a lowering of `box-shadow`. [Material "Elevation" and Android Dev Summit talks on shadows, e.g. "Android Graphics" talks by Chet Haase/Romain Guy, unverified]

**Drawn outer shadow (what React Native ships).** React Native's `OutsetBoxShadowDrawable` ([src](https://github.com/react/react-native/blob/main/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/drawable/OutsetBoxShadowDrawable.kt)) requires API 28, draws the shadow rrect with a `BlurMaskFilter` after `canvas.clipOutPath(borderBoxPath)` (so the shadow never shows through a transparent box, matching CSS), uses sigma = blur × 0.5 from the CSS spec, and converts sigma to Android's radius with `(sigma − 0.5) / 0.57735`, citing HWUI's `Blur.cpp` ([src: FilterHelper.kt](https://github.com/react/react-native/blob/main/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/FilterHelper.kt)). Inset: `InsetBoxShadowDrawable` requires API 29 and uses `drawDoubleRoundRect` with the inner radii ([src](https://github.com/react/react-native/blob/main/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/drawable/InsetBoxShadowDrawable.kt)).

Conflict to resolve with a fixture: the official hardware-acceleration table still lists `setMaskFilter()` as unsupported and `setShadowLayer()` for non-text as API 28 ([doc](https://developer.android.com/develop/ui/views/graphics/hardware-accel)), and the `Paint.setShadowLayer` reference says non-text use is "constrained to the software rendering pipeline" [doc]. React Native ships the `BlurMaskFilter` path on API 28+ in production, which suggests the table is stale for the Skia pipeline (default renderer since Android 9) [unverified]. A shadow fixture on an API 28 and an API 29 emulator settles it.

| Feature | Technique | Fidelity | Min API | Cost | Current → proposed |
|---|---|---|---|---|---|
| One outer shadow with spread | Inflate the border-box rrect by spread (radii grow by spread, CSS "spread radius" rule), offset, `BlurMaskFilter(radius(σ=blur/2), NORMAL)`, draw after `clipOutPath(borderBox)`. | near (Skia Gaussian vs Chrome's Skia Gaussian: same library family, differences are the radius↔sigma rounding and the `pxSigma > 0.5` cut-off) | 28 | record; blur rasterised by GPU per draw [unverified caching] | caveat → **exact** candidate within a paint tolerance |
| Multiple shadows | Draw the list in reverse (first shadow on top). | near | 28 | linear in shadow count | approx → **caveat** candidate |
| Inset shadow | Clip to padding box, `drawDoubleRoundRect(huge outer, inner rrect deflated by spread and offset)` with the blur mask filter (RN's approach). | near | 29 | record | approx → **caveat** candidate |
| Coloured shadow | Paint colour (any alpha); wide-gamut via `long` colours. | exact colour | 28 / 29 | none | – |
| `filter: drop-shadow()` | RenderEffect: `blend(dst = blur(colorFilter(SRC_IN color, offset(source))), src = identity, SRC_OVER)`; RN `createDropShadowEffect` does exactly this ([src](https://github.com/react/react-native/blob/main/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/FilterHelper.kt)). | near | 31 | offscreen (effect layer) | caveat stays; technique defined |
| `text-shadow` | One shadow: `TextPaint.setShadowLayer(radius, dx, dy, color)` with the same sigma conversion (Bjango's 0.866 factor is this formula measured). Several shadows: Dragon's text view draws the `Layout` once per shadow (bottom-most first) with each shadow and a transparent-over trick, then the text. | near | 1 (one), 1 (many, custom draw) | one extra text draw per shadow | approx → **caveat** candidate |

```kotlin
fun sigmaToRadius(sigmaPx: Float) = if (sigmaPx > 0.5f) (sigmaPx - 0.5f) / 0.57735f else 0f
fun drawOuterShadow(c: Canvas, sh: Shadow) {
  c.save(); c.clipOutPath(borderBoxPath)                 // API 26
  shadowPaint.color = sh.color
  shadowPaint.maskFilter = sigmaToRadius(sh.blurPx / 2).takeIf { it > 0 }
      ?.let { BlurMaskFilter(it, BlurMaskFilter.Blur.NORMAL) }
  c.drawPath(spreadPath(sh.spreadPx).apply { offset(sh.dx, sh.dy) }, shadowPaint)
  c.restore()
}
```

Drawing outside the view's bounds needs `clipChildren = false` on the ancestors (section 1). Invalidation damage outside bounds is handled by the RenderNode's recorded bounds on the hardware pipeline [unverified].

## 5. Colour, opacity, visibility, gradients, backgrounds

| Feature | Technique | Fidelity | Min API | Cost | Current → proposed |
|---|---|---|---|---|---|
| Solid / wide-gamut colours (`colors`, `wide-colors`) | Build converts to sRGB ints, or `Color.pack(r,g,b,a, ColorSpace.get(DISPLAY_P3))` `long` colours (`Paint.setColor(long)` API 29 [doc]). Needs `android:colorMode="wideColorGamut"` on the window for P3 output (API 26) [unverified: attribute behaviour]. | exact / caveat (screen gamut) | 1 / 29 | none | unchanged |
| Opacity (`opacity`) | `View.setAlpha`. With the default `hasOverlappingRendering() == true`, the view is drawn into an offscreen buffer and composited with alpha, which **is** CSS group opacity [doc: `setAlpha` note recommends overriding `hasOverlappingRendering` or a layer for animations]. Never override it to false for elements with children or borders. During opacity transitions set `LAYER_TYPE_HARDWARE` for the animation's duration. | exact | 1 | offscreen per frame while translucent (or a cached hardware layer) | caveat → **exact** candidate |
| Visibility hidden (`visibility`) | `View.INVISIBLE` keeps layout space **but hides the whole subtree**; CSS lets a `visibility: visible` child show inside a hidden parent. Compiler writes the inherited value onto every node (principle 3) and, for a hidden container with a visible descendant, the runtime suppresses only the container's own drawing (drawable alpha 0, no background) instead of `INVISIBLE`. Also clear focusability and accessibility importance, as CSS does. | exact with that rule | 1 | none | stays exact; add a fixture for the visible-child case |
| Linear gradient (`gradients`) | `LinearGradient(x0,y0,x1,y1, colors, positions, TileMode.CLAMP)`. Dragon computes the CSS gradient line at layout time: length = `|w·sinθ| + |h·cosθ|`, through the centre, and resolves stop positions in px (they depend on size). | near (interpolation, see below) | 1 (`long[]` colours 29) | shader rebuilt on size change | caveat kept |
| Interpolation and hints (`gradient-hints`) | CSS interpolates in **premultiplied** space; legacy colours in sRGB, modern syntax defaults to Oklab. Skia's Android gradients interpolate unpremultiplied by default [unverified]. Two options: (a) build pre-sampling (the existing proposal): emit ~16-32 stops per segment in sRGB so any interpolation error is under 1/255, and replace `transparent` neighbours with same-hue zero-alpha stops; (b) API 33+: an AGSL `RuntimeShader` that evaluates the CSS gradient function per pixel, including Oklab and hints. | near (a), exact (b) | 1 / 33 | (a) none; (b) per-pixel shader, cheap on GPU | caveat kept; (b) is an exact candidate on 33+ |
| Radial gradient (`gradients`) | `RadialGradient` is circular only; ellipses via `shader.setLocalMatrix(scale(rx/ry))`. Dragon resolves `closest-side`/`farthest-corner` etc. to radii at layout time. | near | 1 | shader rebuild on size change | caveat kept; "ellipse scaling unverified" becomes a fixture item, not a blocker |
| Repeating linear/radial (`other-gradients`) | Put the gradient line/radius over **one period** and use `TileMode.REPEAT`; Chrome's first period offset must be matched by translating the local matrix. | near | 1 | none | approx → **caveat** candidate |
| Conic (`other-gradients`) | `SweepGradient(cx, cy, colors, positions)` (API 1 [doc]) starts at the positive x-axis (3 o'clock) and runs clockwise in screen space; CSS starts at 12 o'clock. Rotate with `setLocalMatrix(rotate(from − 90°, cx, cy))`. Repeating conic: expand the period into stops at build. The hard seam at 0°/360° may anti-alias differently. | near | 1 | none | approx → **caveat** candidate |
| Background images, size, repeat, layers (`background`) | `BitmapShader` with `TileMode.REPEAT` + local matrix for `background-size`/`position`; layers drawn bottom-up in `DragonBoxDrawable`; async decode through the app's image loader. | near | 1 | decode memory | caveat kept |
| Text clipped background (`text-fill`) | Set the gradient (or bitmap) shader on the `TextPaint` via a span (`CharacterStyle.updateDrawState`) with a local matrix mapping the element box into text coordinates. | near | 1 | none | approx → **caveat** candidate (gradients and images, not arbitrary backgrounds) |
| Force dark | Android 10+ can auto-darken app drawing when the theme allows it. Dragon resolves `light-dark()` itself, so call `setForceDarkAllowed(false)` (API 29 [doc]) on the root and set `android:forceDarkAllowed="false"` in the theme. | – | 29 | none | removes a pitfall |

```kotlin
// CSS linear-gradient(θ) line for a w×h box, θ in CSS degrees (0 = to top, clockwise).
fun cssGradientLine(w: Float, h: Float, deg: Float): FloatArray {
  val r = Math.toRadians(deg.toDouble())
  val len = (abs(w * sin(r)) + abs(h * cos(r))).toFloat()
  val dx = (sin(r) * len / 2).toFloat(); val dy = (-cos(r) * len / 2).toFloat()
  return floatArrayOf(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy)
}
```

## 6. Filters, backdrop, blending, isolation, clip-path, masks

**RenderEffect** (API 31 [doc](https://developer.android.com/reference/android/graphics/RenderEffect)): `createBlurEffect`, `createColorFilterEffect`, `createOffsetEffect`, `createChainEffect(outer, inner)`, `createBlendModeEffect(dst, src, mode)`, `createShaderEffect` (all 31) and `createRuntimeShaderEffect(shader, uniformName)` (33) [doc]. `View.setRenderEffect` draws the view into a separate layer, then applies the effect [doc]. That layer is the cost: one offscreen buffer per filtered view.

**AGSL `RuntimeShader`** (API 33 [doc](https://developer.android.com/reference/android/graphics/RuntimeShader)) is the nearest thing to a Houdini paint worklet: an SkSL-derived shader that can be a `Paint` shader (a custom `background-image`-like paint), or a `RenderEffect` that reads the view's pixels (a custom filter). Useful for: exact CSS gradient functions (Oklab, hints, conic seams), `mask-mode: luminance`, `backdrop-filter` compositions, noise/dithering. Guide: [AGSL overview](https://developer.android.com/develop/ui/views/graphics/agsl) [unverified: page not re-read this pass].

| Feature | Technique | Fidelity | Min API | Cost | Current → proposed |
|---|---|---|---|---|---|
| Colour filters: `brightness contrast grayscale sepia saturate hue-rotate invert opacity` (`filter`) | Each is a fixed 4×5 `ColorMatrix` given in the Filter Effects spec; concatenate in authored order into **one** `ColorMatrixColorFilter` and apply with `createColorFilterEffect` (RN does this, [src](https://github.com/react/react-native/blob/main/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/FilterHelper.kt)). Colour-only chains can skip `RenderEffect` and use a hardware layer paint's colour filter (`setLayerType(HARDWARE, paint)`, API 11: layer paint honours alpha, blend mode and colour filter [doc]) → works below 31. | exact (matrix math is linear; CSS shorthand filters operate in sRGB [unverified spec wording]) | 11 (layer paint) / 31 (RenderEffect) | offscreen | caveat → **exact** candidate |
| `blur()` (`filter`) | `createBlurEffect(r, r, TileMode.DECAL)` with `r = sigmaToRadius(σ)`; CSS blur's argument is the standard deviation. Whether the blurred output may extend past the view's bounds (CSS: ink overflow) is [unverified]; if clipped, give the view an outset render bounds via a padding wrapper. | near | 31 | offscreen + blur pass per frame the content changes | caveat kept, now defined |
| Chained filters | `createChainEffect(outer, inner)` in reverse authored order. | exact order | 31 | one layer total | – |
| `backdrop-filter` (`backdrop`, `backdrop-other`) | `View.setBackdropRenderEffect(effect)`: "the previous content behind this View will be blurred before this View is drawn" — **Added in version 37.2** [doc]. Below 37.2, no public per-view backdrop API: `Window.setBackgroundBlurRadius` (API 31) blurs only what is behind the *window*. In-app emulation below 37.2: record the content behind the element into a `RenderNode` (API 29), draw it again clipped to the element with a blur `RenderEffect` (31). This is how Haze (Compose, [github.com/chrisbanes/haze](https://github.com/chrisbanes/haze)) and BlurView ([github.com/Dimezis/BlurView](https://github.com/Dimezis/BlurView)) work [unverified: implementation details]. It redraws the backdrop every frame the content under it changes, and cannot see other windows or `SurfaceView`s. | exact-ish on 37.2+; near on 31-37.1 with emulation | 37.2 native; 31 emulated | 37.2: one backdrop pass; emulation: a second draw of the backdrop subtree | approx → **caveat** on 37.2+; emulation stays approx |
| `mix-blend-mode` (`blends`) | Put the element on a hardware layer whose paint has `setBlendMode(mode)` (API 29 [doc]) or `RenderNode.setUseCompositingLayer(true, paint)` (API 29 [doc]). `BlendMode` includes the W3C separable and non-separable modes (`MULTIPLY … HUE, SATURATION, COLOR, LUMINOSITY`) [doc: BlendMode]. The backdrop is whatever the nearest *layer* ancestor contains, so the stacking-context boundary must also be a layer (next row). | exact candidate | 29 | offscreen for the element and for its isolation group | caveat → **exact** candidate |
| `isolation: isolate` (`isolation`) | Give the isolating element its own compositing layer (`setLayerType(LAYER_TYPE_HARDWARE, null)` or `setUseCompositingLayer`). Chrome also isolates at every stacking context (opacity < 1, transforms, filters): mirror that by layering whichever ancestor forms the stacking context when a blended descendant exists. The compiler knows the tree, so it can decide this at build. | exact candidate | 29 | offscreen | unsupported → **caveat** candidate |
| `background-blend-mode` | Draw background layers inside `DragonBoxDrawable` with `Paint.setBlendMode` on each layer after the first, inside a `saveLayer` bounded to the box. | exact candidate | 29 | one `saveLayer` | covered by `blends` |
| `clip-path` basic shapes (`masks`) | Build a `Path` from `inset()/circle()/ellipse()/polygon()/path()` against the reference box; clip in `dispatchDraw` + own `draw`, or `Outline.setPath` + `clipToOutline` on 33+. CSS `clip-path` also clips **hit testing**: override `dispatchTouchEvent` to return `false` outside the path, and `ViewGroup` then offers the touch to the next child underneath, which matches CSS. | near (edge AA) | 1 / 33 outline | record | unsupported → **caveat** candidate |
| `mask-image` gradients and images (`masks`) | `saveLayer(bounds, null)`, draw content, draw the mask with `BlendMode.DST_IN` (alpha mask). `mask-mode: luminance`: luminance-to-alpha `ColorMatrix` on the mask paint, or AGSL on 33+. | near | 21 / 29 | offscreen per masked element | unsupported → **caveat** candidate |

```kotlin
// filter: grayscale(1) blur(4px)  →  chain(outer = blur, inner = grayscale)
view.setRenderEffect(RenderEffect.createChainEffect(
  RenderEffect.createBlurEffect(r, r, Shader.TileMode.DECAL),
  RenderEffect.createColorFilterEffect(ColorMatrixColorFilter(grayscale(1f)))))

// mix-blend-mode: multiply
view.setLayerType(View.LAYER_TYPE_HARDWARE, Paint().apply { blendMode = BlendMode.MULTIPLY })
parentStackingContext.setLayerType(View.LAYER_TYPE_HARDWARE, null) // isolation group
```

## 7. Text

Text is the area where "proven against Chrome" matters most (pitfall P1). Recommendation: **non-editable text uses a Dragon text view that owns a `StaticLayout`** (built with `StaticLayout.Builder`, API 23) and draws it in `onDraw`; Compose's text works this way. `TextView` stays only for selectable or editable text, configured with the same settings. Owning the layout removes `TextView`'s internal clip rectangle (the descender-clipping bug), its theme-dependent defaults and its extra padding.

### 7.1 Defaults to override on every text node

| Setting | Android default | Chrome-matching value | Min API | Why |
|---|---|---|---|---|
| `includeFontPadding` | `true` [doc] | `false` | 1 | Adds ascent padding "to make room for accents"; CSS has none. |
| Break strategy | `TextView`: `BREAK_STRATEGY_HIGH_QUALITY`; `EditText`: `SIMPLE` [doc] | `BREAK_STRATEGY_SIMPLE` (greedy, like Chrome's default) | 23 | HIGH_QUALITY optimises the whole paragraph, so line breaks differ from Chrome. |
| Hyphenation frequency | `NONE`, "set from the theme" [doc] | `NONE` unless `hyphens: auto` | 23 | A theme can silently turn it on. |
| Fallback line spacing | `true` for targetSdk ≥ 28 [doc: required true for some cases] | `true` for `line-height: normal`, overridden by the line-height span for explicit values | 28 | CSS `normal` also grows lines for taller fallback fonts; explicit `line-height` does not. |
| `elegantTextHeight` | `true` for targetSdk 35; **ignored** from targetSdk 36 [doc: Android 15/16 behaviour changes](https://developer.android.com/about/versions/16/behavior-changes-16) | leave default (Chrome uses the full-height fonts) | – | Affects Arabic, Thai, Tamil etc. line heights. |
| Text clip rectangle | `TextView.onDraw` clips to its padding box [unverified: source not re-read] | no clip (own layout), or outset the view by the ink overflow | – | CSS never clips glyph ink that overflows the line box. |
| `useBoundsForWidth` | `false` [doc] | `false` (CSS measures advances, not ink bounds) | 35 | Keep advance-based widths like Chrome. |

### 7.2 Line height: half-leading, rounding, descenders

- **CSS model.** Leading `L = line-height − (A + D)`, with `A`/`D` the font's ascent/descent; half of `L` goes above and half below each line. Glyph ink outside the line box overflows visibly; nothing is clipped.
- **Android built-ins do not do this.** `TextView.setLineHeight` (API 28; unit variant API 34 [doc]) sets "the vertical distance between subsequent baselines" by adding spacing below. `LineHeightSpan.Standard` (API 29 [doc]) scales ascent/descent proportionally [unverified: source not re-read]. Neither splits leading evenly.
- **Technique:** a custom `LineHeightSpan` whose `chooseHeight` sets `fm.ascent = −(A + L/2)` and `fm.descent = D + L/2`. Compose's `LineHeightStyleSpan` does exactly this with `LineHeightStyle.Alignment.Center` and no trimming, and has tests ([src](https://github.com/androidx/androidx/blob/androidx-main/compose/ui/ui-text/src/androidMain/kotlin/androidx/compose/ui/text/android/style/LineHeightStyleSpan.android.kt)); its `chooseHeight` rewrites `fontMetricsInt.ascent/descent` per line, first and last lines included.
- **Rounding.** `FontMetricsInt` is integer device pixels, so each line rounds; 14px × 1.5 at density 2.625 = 55.125 device px, and 10 lines drift 1.25 px from Chrome (which keeps 1/64 px LayoutUnits [unverified]). Fix: error diffusion. `chooseHeight` receives the line's top (`v`) and the paragraph start; choose each line's height so that line *n* ends at `round((n+1) × exactHeight)`.
- **Descender clipping** disappears with the Dragon text view: draw the layout without a clip, and let ancestors not clip (section 1). If `TextView` must be used, outset its frame by the measured ink overflow and add matching padding, so layout geometry still equals the CSS box.
- **`line-height: normal`.** Fonts are bundled and known at build (principle 5), so the compiler can read the font's `hhea`/`OS/2` tables and resolve `normal` to the same number Chrome uses, then emit an explicit line-height span. Which table Chrome uses on each OS is [unverified] and is a fixture question (T016 covers the cross-engine comparison).

```kotlin
class CssLineHeightSpan(private val exact: Float, private val a: Float, private val d: Float,
                        private val paraTop: Int) : LineHeightSpan {
  override fun chooseHeight(t: CharSequence, s: Int, e: Int, spanV: Int, v: Int, fm: Paint.FontMetricsInt) {
    val n = ((v - paraTop) / exact).roundToInt()           // line index from its top
    val h = (paraTop + ((n + 1) * exact).roundToInt()) - v  // error-diffused height
    val half = (h - (a + d)) / 2f
    fm.ascent = -(a + half).roundToInt(); fm.descent = h + fm.ascent
    fm.top = fm.ascent; fm.bottom = fm.descent
  }
}
```

### 7.3 Text feature table

| Feature (row id) | Technique | Fidelity | Min API | Cost | Current → proposed |
|---|---|---|---|---|---|
| Line height number/length (`line-height`) | 7.2 span + error diffusion | near (glyph rasterisation differs) | 1 (span API) | per layout | caveat kept; box geometry becomes an exact candidate |
| Normal line height (`normal-leading`) | resolve at build from bundled font tables | near | 1 | build | caveat kept |
| Letter spacing (`letter-spacing`) | `Paint/TextView.setLetterSpacing(em)` (API 21 [doc]); em = px ÷ font px, recomputed when font size changes. Chrome adds the spacing after each character; Minikin may split it half before and half after each glyph, which shifts glyphs by half the spacing with the same total width [unverified]. | near | 21 | none | stays exact pending fixture |
| Word spacing (`word-spacing`) | `Paint.setWordSpacing(px)` (API 29 [doc]: "Increases the white space width between words with the given amount of pixels") through a `MetricAffectingSpan.updateMeasureState`. Whether `StaticLayout` honours it in measurement is [unverified]. | near if honoured | 29 | none | unsupported → **caveat** candidate |
| Font features (`font-features`) | `setFontFeatureSettings(String)` takes the **CSS `font-feature-settings` syntax** (API 21 [doc]); `font-variant-*` lower to feature tags at build; `font-kerning: none` → `"kern" 0`. | exact (same OpenType features) | 21 | none | caveat kept (per-value tests) |
| Alignment/justify (`text-align`) | `Layout.Alignment` + `setJustificationMode(JUSTIFICATION_MODE_INTER_WORD)` (API 26 [doc]). Chrome justifies by expanding spaces too; last line uses the start alignment in both. `JUSTIFICATION_MODE_INTER_CHARACTER` (API 35) [unverified] ≈ `text-justify: inter-character`. | near | 26 | none | caveat kept |
| Hyphenation (`breaking`) | `setHyphenationFrequency(NORMAL/FULL)` (API 23; `*_FAST` variants API 33 [unverified]) plus the text locale (`setTextLocales`/`LocaleSpan`) from `lang`; per-span opt-out `LineBreakConfigSpan.createNoHyphenationSpan()` (API 35 [doc]). Dictionaries differ from Chrome's. | approx | 23 | layout slower with hyphenation | stays unsupported; `hyphens: manual` (soft hyphens only) could be a separate caveat candidate |
| Word breaking (`breaking`) | `overflow-wrap: anywhere/break-word`: Android already breaks inside a word that doesn't fit ("desperate" breaks). **CSS default `overflow-wrap: normal` lets long words overflow; Android cannot**: even `LINE_BREAK_STYLE_NO_BREAK` "still performs grapheme based line break for preventing clipping text" [doc: LineBreakConfig](https://developer.android.com/reference/android/graphics/text/LineBreakConfig). `word-break: keep-all`/phrase for CJK: `LINE_BREAK_WORD_STYLE_PHRASE` (API 33 [doc]). `line-break: strict/loose`: `LINE_BREAK_STYLE_STRICT/LOOSE` (API 33 [doc]). | approx | 33 | none | stays unsupported; record overlong-word wrapping as a known difference with a fixture that expects the mismatch |
| `nowrap` / `white-space` (`whitespace`, `ellipsis`) | Whitespace collapsing done by the runtime text builder per CSS Text 3 rules (Dragon code, not Android); `nowrap` → layout with infinite width; `pre` tabs → `TabStopSpan`. | near | 1 | none | caveat kept |
| Ellipsis / line clamp (`ellipsis`, `line-clamp`) | `StaticLayout.Builder.setEllipsize(END).setMaxLines(n)` (API 23). | near | 23 | none | caveat kept |
| Balanced wrapping (`balance`) | **Logic, not a property.** Chrome's balance finds the narrowest width that keeps the same line count (limited to a few lines, 6 in Chromium per the Chrome blog [unverified](https://developer.chrome.com/docs/css-ui/css-text-wrap-balance)). Reproduce: lay out greedily at the full width to get the line count *k*, binary-search the width (≈6-8 `StaticLayout` builds) for the smallest width that still gives *k* lines, lay out at that width, keep the box width. `BREAK_STRATEGY_BALANCED` (API 23) uses a different optimiser and is not used. `text-wrap: pretty` stays unsupported (Chrome's pretty only adjusts the last lines; no public Android equivalent). | near | 23 | 6-8 extra layouts per balanced paragraph (cacheable) | unsupported → **caveat** candidate (`balance` only) |
| Text transform (`case`) | Runtime `toUpperCase(locale)`/`toLowerCase(locale)`; `capitalize` via `android.icu.text.BreakIterator.getWordInstance` (API 24) upper-casing the first letter of each word without lowering the rest. Keep the original string for accessibility. | near | 24 | per text change | caveat kept |
| Decoration detail (`decoration-detail`) | Dragon text view draws decorations itself from the `Layout`: per line `getLineBaseline`, `getLineLeft/Right`, run extents via `getPrimaryHorizontal`; thickness/offset from the author or font (`Paint.getUnderlinePosition/Thickness`, API 29 [doc]); `dashed/dotted/wavy` via `PathEffect`/generated path; colour free. `text-decoration-skip-ink: auto` needs glyph outlines (`Paint.getTextPath`) to cut gaps [unverified cost]. | near | 29 | one path per decorated line | approx → **caveat** candidate |
| Super/sub, `vertical-align` lengths (`vertical-align`) | `MetricAffectingSpan` setting `TextPaint.baselineShift` to the CSS value (Chrome's `super`/`sub` offsets are [unverified]); `SuperscriptSpan` uses a different offset, so don't use it. | near | 1 | none | caveat kept |
| Inline-block / inline-flex inside text (`inline-box`) | `ReplacementSpan` placeholder: `getSize` returns the box's Taffy-measured width and sets `fm.ascent = −baseline`, `fm.descent = height − baseline` (CSS inline-block baseline = last line box baseline, or the bottom margin edge when it has no in-flow line or `overflow` is not visible); after layout, position the real child view at `getPrimaryHorizontal(start)`, `getLineBaseline(line) − baseline`. It never breaks internally, like a CSS atomic inline. Compose's `PlaceholderSpan` is the precedent [unverified path]. | near | 1 | one extra measure per box | unsupported → **caveat** candidate |
| Box paint on inline runs (`inline-paint`) | Horizontal padding/border/margin via zero-glyph `ReplacementSpan` spacers at run start/end; background, border, radius drawn per line fragment from `Layout` geometry (`box-decoration-break: slice`), in a `LineBackgroundSpan` or the text view's `onDraw`. Vertical padding paints but doesn't affect line height, as in CSS. | approx→near | 1 | per-line path | unsupported → **approx** candidate |
| Selection (`selection`) | `TextView.setTextIsSelectable(true)` (API 11 [doc]) for `user-select: text` elements; the Dragon text view is not selectable, so the compiler picks the view from context. | caveat | 11 | – | caveat kept |
| Bidi (`bidi`, `direction`) | `setTextDirection`, `TextDirectionHeuristics`; `unicode-bidi: isolate/embed/override` via inserting Unicode control characters (FSI/PDI, RLE/PDF, RLO) at build/runtime (both engines implement UAX #9 [unverified: identical results]). | near | 17 | none | caveat kept |

### 7.4 Fonts

| Feature | Technique | Fidelity | Min API | Current → proposed |
|---|---|---|---|---|
| `@font-face` + family names (`font-face`) | Bundle files at build (res/font or assets); `Typeface.Builder(assets, path)` with `setWeight/setItalic` (API 26) or `Font.Builder`/`FontFamily.Builder` (API 29). Register under Dragon-generated IDs, never Android family-name strings, so name mismatches cannot happen (pitfall list). | exact font data | 26 / 29 | caveat kept |
| Fallback lists (`system-font`) | `Typeface.CustomFallbackBuilder(family).addCustomFallback(…).setSystemFallback("sans-serif")` (API 29 [unverified API level]) reproduces the CSS `font-family` list order; system fallback last. `system-ui` still resolves to Roboto or an OEM font (cannot remove). | near | 29 | caveat kept |
| Weight/italic (`font-style`) | `Typeface.create(Typeface family, int weight, boolean italic)` — **API 28** [doc](https://developer.android.com/reference/android/graphics/Typeface) (resolves T029's "unverified API level"). A missing weight is a build error (principle 5), so Android's synthetic bold never runs. | exact with real faces | 28 | caveat → **caveat**, unverified flag removed |
| Variable fonts | `Paint`/`TextView.setFontVariationSettings("'wght' 650, 'wdth' 90")` (API 26 [doc]) or `Typeface.Builder.setFontVariationSettings`. `font-weight` on a variable face maps to `wght`; `font-stretch` → `wdth`; `font-optical-sizing: auto` → set `opsz` = font size in px yourself (Chrome does this automatically [unverified]). Pitfalls.md says variable weights need API 29; the reference says 26, fixture decides. | exact axis values | 26 | – |
| Font size and scaling (`font-size`, `rem`) | Android 14 made font scaling **non-linear** up to 200% [unverified: Android 14 features page]: large sizes grow less. If `rem` follows the system text size, convert each size with `TypedValue.applyDimension(COMPLEX_UNIT_SP, px, metrics)` (which applies the non-linear curve on 34+), not `px × fontScale`. | depends on owner policy | 34 behaviour | caveat kept; owner decision 5 |

## 8. Transforms

| Feature (row id) | Technique | Fidelity | Min API | Cost | Current → proposed |
|---|---|---|---|---|---|
| translate/scale/rotate + origin (`transform`, `transform-origin`) | Decompose the CSS 2D matrix at build (or runtime for dynamic values) into `translationX/Y`, `scaleX/Y`, `rotation` and set `pivotX/Y` from `transform-origin`. Android composes as translate · pivot · rotate · scale · −pivot, so any skew-free affine matrix decomposes exactly (negative scale allowed). Hit testing follows these properties. | exact | 11 | RenderNode property only (no re-record) | unchanged (exact) |
| Skew / general matrix (`matrix`) | Option A: `View.setAnimationMatrix(Matrix)` (API 29 [doc]); the docs describe it as for animation frameworks and tell app developers to prefer the individual properties, and whether touch hit-testing uses it is [unverified]. Option B (any API): the parent's `drawChild` does `canvas.concat(matrix)`, and the parent's `dispatchTouchEvent` inverse-maps touch points. B is fully public and documented behaviour; A is simpler. | exact geometry; hit testing needs a fixture | 29 (A), 1 (B) | record (B re-records the parent) | unsupported → **caveat** candidate |
| 3D (`three-d`) | `rotationX/Y` + `setCameraDistance` (API 12 [doc]) approximate `perspective` + `rotateX/Y` after a calibration fixture (Android's camera uses a fixed-location camera model, unit mapping [unverified]). No `matrix3d`, no `preserve-3d`. | approx | 12 | – | stays unsupported |

## 9. Motion

| Feature (row id) | Technique | Fidelity | Min API | Cost | Current → proposed |
|---|---|---|---|---|---|
| Transform/opacity transitions (`transition`) | `ViewPropertyAnimator` (`animate().translationX(…)`): ticks on the UI thread's Choreographer but only updates RenderNode properties, no re-record. Use `withLayer()` for opacity. | near (frame timing) | 12 | main-thread tick, cheap | caveat kept |
| Paint transitions (colour, radius, shadow) | `ValueAnimator` driving `DragonBoxDrawable` fields + `invalidateSelf()`. **Do not use `ArgbEvaluator`**: its docs say each channel is interpolated independently on the unpremultiplied ARGB bytes [doc], and it is widely reported to convert to linear light internally since Android 8 [unverified]; CSS interpolates legacy colours in premultiplied sRGB (modern syntax per CSS Color 4 rules). Write a `TypeEvaluator` that interpolates premultiplied in the CSS space. | near | 11 | re-record + redraw per frame | caveat kept |
| Retargeting / interruption | Implement CSS Transitions' rules (start from the current value; reversing-shortening factor when going back to the previous end value) in Dragon's runtime; `Animator` has no such built-in. | exact by construction | 11 | – | caveat kept |
| Easing (`timing`) | `cubic-bezier()` → `PathInterpolator(x1, y1, x2, y2)` (API 21), which samples the curve into a lookup table [unverified precision]; `steps()` and `linear()` → custom `TimeInterpolator` implementing the CSS Easing 2 definitions exactly (including jump terms and linear() input positions). | near / exact | 21 | none | caveat kept |
| Keyframes (`keyframes`) | `ObjectAnimator.ofPropertyValuesHolder(PropertyValuesHolder.ofKeyframe(prop, Keyframe.ofFloat(fraction, value)…))` with `Keyframe.setInterpolator` per interval, which is exactly CSS's per-keyframe `animation-timing-function` semantics. Iteration count/direction: `setRepeatCount`/`setRepeatMode(REVERSE)`; delay `setStartDelay`; negative delay `setCurrentPlayTime`; `animation-play-state` `pause()/resume()` (API 19); fill modes by setting the final/initial value explicitly. | near | 19 | per frame per animated property | stays unsupported (release scope), technique ready |
| Springs | `androidx.dynamicanimation.SpringAnimation`. CSS has no springs; only relevant if an author's `linear()` is a sampled spring. Not a lowering target. | – | 16 (lib) | – | – |
| Reduced motion (`media-appearance`) | `ValueAnimator.areAnimatorsEnabled()` (API 26) is false when "Remove animations" is on; `Settings.Global.ANIMATOR_DURATION_SCALE` scales every `Animator` duration (Chrome ignores it). Decide: treat scale 0 as `prefers-reduced-motion: reduce`, and pin scale 1 on test devices. | exact detection | 26 | – | unchanged |

## 10. Scrolling, sticky, snap, insets, pixel snapping

| Feature (row id) | Technique | Fidelity | Min API | Cost | Current → proposed |
|---|---|---|---|---|---|
| Sticky (`sticky`) | Taffy lays the element out as static (as the table says). The scroll adapter listens with `setOnScrollChangeListener` (API 23 [doc]) and sets `translationY` (or X) = `clamp(scrollTop + top − staticTop, 0, containingBlockBottom − staticBottom)`, the CSS sticky constraint rectangle, computed from Taffy geometry. The sticky view must draw above following siblings (Dragon sibling order). `CoordinatorLayout`/`AppBarLayout` behaviours and `RecyclerView.ItemDecoration.onDrawOver` headers are pattern-specific and non-interactive (decorations) and are not CSS matches. Risk: a one-frame lag if the listener runs after the frame's draw [unverified]; a fixture capturing mid-fling frames decides. | near | 23 | main thread per scroll frame (property set only) | unsupported → **caveat** candidate |
| Scroll snap (`scroll-controls`) | Lists: `RecyclerView` + `LinearSnapHelper`/`PagerSnapHelper` (androidx). Generic scroll containers: override `fling(velocity)`, ask `OverScroller` for the natural end offset, pick the snap position per CSS Scroll Snap (nearest `start/center/end` area, `mandatory` vs `proximity` threshold), `smoothScrollTo`. Motion curve stays native. | approx (native physics) | 1 / androidx | main | stays unsupported unless the owner accepts native feel; could be caveat "snap positions exact, motion native" |
| Overscroll (`scroll-controls`) | `overscroll-behavior: none` → `setOverScrollMode(OVER_SCROLL_NEVER)` (no glow/stretch) + `setNestedScrollingEnabled(false)`; `contain` → only disable chaining. `scroll-behavior: smooth` → programmatic scrolls use `smoothScrollTo`. Chrome latches a gesture to one scroller while Android nested scrolling chains mid-gesture [unverified]. | near | 21 | – | unsupported → **caveat** candidate for `overscroll-behavior` and `scroll-behavior` only |
| Scroll containers (`scroll`) | `ScrollView`/`HorizontalScrollView`, or `NestedScrollView` (androidx). Native physics and Android 12+ stretch overscroll by design. | caveat | 1 | – | unchanged |
| Safe areas / edge-to-edge (`environment`) | Android 15 makes apps targeting API 35 edge-to-edge; Android 16 (targetSdk 36) removes the opt-out: `windowOptOutEdgeToEdgeEnforcement` "is deprecated and disabled" [doc](https://developer.android.com/about/versions/16/behavior-changes-16). So Dragon must always handle insets: `ViewCompat.setOnApplyWindowInsetsListener` + `WindowInsetsCompat.Type.systemBars() or displayCutout()` → `env(safe-area-inset-*)` (per edge, the max of the two), `Type.ime()` → a future `env(keyboard-inset-height)`, `WindowInsetsAnimationCompat` to follow the keyboard frame by frame (native API 30, compat back to 21 [unverified compat range]). Call `WindowCompat.enableEdgeToEdge(window)` on every API level so older devices behave the same. Chrome on Android also exposes `env(safe-area-inset-*)` when drawing edge-to-edge [unverified: Chrome version]. | exact values; timing near | 20 (listener), 30 (typed insets; compat below) | relayout on change | caveat kept |
| Pixel snapping (P11) | Taffy rounds in device pixels (`round_layout` on `px × density`); `View.layout` takes ints; fractional densities (2.625, 2.75) are the stress cases. Paint aligns fills to device-pixel edges; border widths follow the CSS snapping rule (section 2). | near (1 device px) | – | – | unchanged, fixtures at 2.625 |

```kotlin
scroller.setOnScrollChangeListener { _, _, y, _, _ ->
  val want = y + stickyTop - staticTop                     // from Taffy geometry
  sticky.translationY = want.coerceIn(0f, cbBottom - staticBottom)
}
```

## 11. Focus, hover, pointer, outline

| Feature (row id) | Technique | Fidelity | Min API | Current → proposed |
|---|---|---|---|---|
| `:hover` (`states`) | `View.isHovered` / `onHoverEvent` (API 14) fires for mouse and for hovering styluses (`MotionEvent` `TOOL_TYPE_STYLUS`, `ACTION_HOVER_*`). Chrome treats a hovering pen as hover too [unverified]. Compiler emits the hovered state only where `(hover)` can be true (principle 3). | near | 14 | caveat kept |
| `@media (hover)/(pointer)` (`media-pointer`) | Derive from connected devices: `InputManager.getInputDeviceIds()` + `InputDevice.supportsSource(SOURCE_MOUSE / SOURCE_STYLUS)`, listen with `InputManager.InputDeviceListener` (API 16). `hover`/`pointer` describe the *primary* device (touch on phones: `none`/`coarse`); `any-hover`/`any-pointer` flip when a mouse connects, matching Chrome's model [unverified: Chrome's Android implementation]. | near | 16 | caveat kept |
| `:focus-visible` (`states`) | `isFocused && !isInTouchMode`. Android's touch mode is the same idea as focus-visible heuristics (keyboard/D-pad focus shows, touch focus doesn't); listen with `ViewTreeObserver.OnTouchModeChangeListener`. | near | 1 | caveat kept, technique defined |
| Focus ring / `outline` (`outline`) | Draw in `onDrawForeground` (API 23 [doc]) outside the border box by `outline-offset`, with the outline's own radius (Chrome follows `border-radius` for outlines [unverified version]); needs `clipChildren = false` on ancestors. Disable the system highlight on that view with `setDefaultFocusHighlightEnabled(false)` (API 26 [doc]) only when the author styles focus, so an accessible cue always remains. | near | 23 / 26 | approx → **caveat** candidate |
| `cursor` (`cursor`) | `View.setPointerIcon(PointerIcon.getSystemIcon(ctx, TYPE_HAND …))` (API 24 [doc]); CSS keywords map to `PointerIcon.TYPE_*` (arrow, hand, text, crosshair, grab, grabbing, zoom-in/out, resize arrows, help, wait, context-menu, copy, alias, no-drop, all-scroll…) [unverified: full list]. No-op on touch-only devices. | near (system icon art differs) | 24 | no-effect → **caveat** candidate with pointer profile |
| `pointer-events` (`pointer-events`) | `none` on a container: override `dispatchTouchEvent` to skip itself but still dispatch to `auto` children (the table's rule). | exact | 1 | unchanged |
| `z-index` (`z-index`) | Sibling order by child index (or `ViewGroup.setChildrenDrawingOrderEnabled` + `getChildDrawingOrder`, which also drives touch order since API 29 [unverified]). Keep `translationZ`/`elevation` at 0 so Z never reorders siblings. | exact within siblings | 1 | caveat kept |

## 12. API levels and the recommended floor

| API | Android | What Dragon gets |
|---|---|---|
| 21 | 5.0 | `clipToOutline`, `PathInterpolator`, `setLetterSpacing`, `setFontFeatureSettings` |
| 23 | 6.0 | `StaticLayout.Builder`, break strategy, hyphenation, `onDrawForeground`, `setOnScrollChangeListener` |
| 24 | 7.0 | `setPointerIcon`, `android.icu` |
| 26 | 8.0 | `clipOutPath`, variable-font settings, `Typeface.Builder`, justification, `areAnimatorsEnabled` |
| 28 | 9 | `Typeface.create(family, weight, italic)`, `setLineHeight`, fallback line spacing, coloured elevation shadows, hardware `setShadowLayer`/mask-filter shadows (RN's floor for outset shadows) |
| **29** | **10** | `BlendMode`, `drawDoubleRoundRect`, `setWordSpacing`, `setAnimationMatrix`, `RenderNode`, 64-bit colours, `LineHeightSpan.Standard`, `setForceDarkAllowed`, `CustomFallbackBuilder`, `Font`/`FontFamily`, non-convex outlines; RN's floor for inset shadows |
| 30 | 11 | `Outline.setPath`, typed `WindowInsets` |
| 31 | 12 | `RenderEffect` (blur, colour filters, chains), window background blur |
| 33 | 13 | `RuntimeShader`/AGSL, any-shape outline clipping, `LineBreakConfig` (strict/loose, phrase) |
| 35 | 15 | edge-to-edge enforced (targetSdk 35), `LineBreakConfigSpan` no-break/no-hyphenation, `useBoundsForWidth` |
| 36 | 16 | edge-to-edge opt-out removed, `elegantTextHeight` ignored |
| 37.2 | 17 minor release | `setBackdropRenderEffect` |

**Recommendation: `minSdk 29`.** It is the first level where every `caveat`-or-better paint technique in this note runs without a second code path (borders, radii, shadows incl. inset, blend modes, isolation, word spacing, colour management, font fallback lists, force-dark control). API 31/33/37.2 features are profile tiers: a feature above the app's declared floor is a build error (P21), not a runtime fallback. For comparison, React Native's Android floor is API 24 and AndroidX libraries moved to 23 in 2025 [unverified], so 29 is stricter than the ecosystem; the device share at API 29+ should be checked on the Android Studio distribution dashboard before committing [unverified: no distribution figure verified this pass]. If the owner needs 26-28, the costs are: no blend modes/isolation, ring borders via even-odd paths, no inset shadows, no word spacing, no font fallback lists, no force-dark switch.

## 13. Support-table rows that could be upgraded (Android column, all proposed until a parity fixture passes)

**caveat → exact candidates**
1. `opacity` — default group opacity via `hasOverlappingRendering` (API 16+).
2. `radius` — CSS clamping in Dragon + 8-value `Path.addRoundRect` (API 21).
3. `border` — ring fills with `drawDoubleRoundRect` and per-side wedge clips (API 29).
4. `rounded-clip` — `dispatchDraw` clip to padding-box inner radii; parent-drawn exterior shadow (any API; outline path clip 33+).
5. `shadow` — `BlurMaskFilter` + `clipOutPath`, CSS sigma → Android radius conversion (API 28; hardware-support conflict to settle).
6. `filter` (colour functions) — one concatenated `ColorMatrix` (layer paint any API; `RenderEffect` 31); `blur()` stays caveat.
7. `blends` — layer paint `BlendMode` + stacking-context layers (API 29).

**approx → caveat candidates**
8. `other-shadows` — multiple (28) and inset (29) via drawn drawables.
9. `other-gradients` — repeating via `TileMode.REPEAT`; conic via rotated `SweepGradient` (API 1).
10. `text-fill` — shader on `TextPaint` (gradients/images only).
11. `backdrop` — `setBackdropRenderEffect` on 37.2+ (emulation below stays approx).
12. `backdrop-other` — already caveat; defined as `RenderEffect` chains on 37.2+.
13. `text-shadow` — sigma conversion; multiple shadows by redraw.
14. `decoration-detail` — Dragon-drawn decorations from `Layout` geometry (API 29 for font underline metrics).
15. `outline` — `onDrawForeground` + focus-visible = focused and not in touch mode.
16. `pattern-border` — only after porting Chromium's dash algorithm (fixture-gated).

**unsupported → caveat candidates**
17. `isolation` — compositing layer on the isolating element (API 29).
18. `masks` — `clip-path` basic shapes with hit testing; `mask-image` via `saveLayer` + `DST_IN`.
19. `matrix` — `setAnimationMatrix` (29) or parent `canvas.concat` + inverse-mapped touches.
20. `word-spacing` — `Paint.setWordSpacing` (API 29), measurement support unverified.
21. `balance` — binary-search-width runtime helper.
22. `inline-box` — `ReplacementSpan` placeholders positioned after layout.
23. `sticky` — scroll-listener translation from Taffy geometry.
24. `scroll-controls` — `overscroll-behavior` and `scroll-behavior` only; snap stays unsupported unless native motion is accepted.

**Other moves**
25. `cursor` no-effect → caveat on mouse-equipped devices (`setPointerIcon`, API 24).
26. `inline-paint` unsupported → approx (spacer spans + per-fragment drawing).
27. `other-border` (groove/ridge/inset/outset) unsupported → approx (Chromium colour rule port).
28. `font-style` — keep caveat, remove the "weight API-level claim unverified" note: `Typeface.create(family, weight, italic)` is API 28 [doc].
29. `line-height` / `normal-leading` — keep caveat; the technique (half-leading span + error diffusion + build-resolved `normal`) makes box heights an exact-candidate sub-row.
30. `corners` unsupported → approx via `graphics-shapes` (deferred; Chrome availability unverified).

**Stays as is (no public technique that matches Chrome):** `three-d` (no `matrix3d`/`preserve-3d`), `breaking` (Android always breaks overlong words; hyphenation dictionaries differ), `pretty` wrapping, `backdrop` below 31, `keyframes` (technique ready, deferred by release scope), `vertical-layout`, `subgrid`/`masonry`.

## 14. Fixture list this playbook implies (for the Android lane later)

Borders: per-side colours × radii × unequal widths; hairlines at DPR 2.625. Radii: clamping overflow cases, elliptical. Clip: child overflowing each rounded corner, with border and with exterior shadow. Shadows: blur 0/1/4/24 px, spread ±, inset, multiple, on API 28 and 29 emulators (settles the hardware table conflict). Gradients: transparent stops, Oklab vs sRGB inputs, repeating, conic seam. Filters: each colour function at 0/0.5/1/2, blur 2/8 px incl. bounds overflow. Blend: all 16 modes over a known backdrop, with and without an isolating parent. Text: `line-height` < natural height with descender-heavy strings, 10-line paragraphs for rounding drift, `normal` line height per bundled font, letter-spacing glyph positions, balance with 2-6 lines, long-URL overflow (expected mismatch), hyphens. Transforms: skew hit testing. Sticky: mid-fling frame capture. Insets: edge-to-edge on API 35 and 36 targets. Motion: colour transition mid-point values vs Chrome.

## 15. Unverified items (need a primary read or a device run)

- Hardware support of `BlurMaskFilter`/`setShadowLayer` for shapes on API 28+ (doc table vs React Native practice).
- Anti-aliasing of `Canvas.clipPath` and of path outlines on the Skia pipeline.
- Whether `RenderEffect` blur output can extend past view bounds.
- `ArgbEvaluator` linear-light conversion since Android 8 (docs say per-channel linear interpolation).
- Minikin letter-spacing placement; `StaticLayout` honouring `Paint.setWordSpacing`.
- `LineHeightSpan.Standard` distribution rule; `TextView.onDraw` clip rectangle details.
- Chrome's `line-height: normal` metric tables, `super`/`sub` offsets, balance line cap, pen-hover behaviour, dash algorithm, outline radius behaviour, border-width snapping rule adoption.
- `Typeface.CustomFallbackBuilder` API level (believed 29), `HYPHENATION_FREQUENCY_*_FAST` (believed 33), `JUSTIFICATION_MODE_INTER_CHARACTER` (believed 35), `WindowInsetsAnimationCompat` backport range, Android 14 non-linear font scaling details.
- `setAnimationMatrix` effect on touch hit testing; `getChildDrawingOrder` affecting touch order.
- Device share at API 29+ and the current React Native / AndroidX minSdk figures.

## Sources (all accessed 2026-09-26)

Android reference pages, read directly (API levels copied from the pages):
- View: https://developer.android.com/reference/android/view/View (setBackdropRenderEffect 37.2, setRenderEffect 31, setAnimationMatrix 29, setOutlineAmbientShadowColor 28, setForceDarkAllowed 29, setPointerIcon 24, setDefaultFocusHighlightEnabled 26, onDrawForeground 23, setClipToOutline 21, hasOverlappingRendering 16, setLayerType 11, setOnScrollChangeListener 23, setCameraDistance 12)
- Outline: https://developer.android.com/reference/android/graphics/Outline (canClip wording, setPath 30, setConvexPath deprecated 30)
- Paint: https://developer.android.com/reference/android/graphics/Paint (setWordSpacing 29, setBlendMode 29, setFontVariationSettings 26, setLetterSpacing 21, setFontFeatureSettings 21 with CSS syntax, setShadowLayer wording, getUnderlineThickness 29, setColor(long) 29)
- RenderEffect: https://developer.android.com/reference/android/graphics/RenderEffect ; RuntimeShader: https://developer.android.com/reference/android/graphics/RuntimeShader ; RenderNode: https://developer.android.com/reference/android/graphics/RenderNode
- Canvas: https://developer.android.com/reference/android/graphics/Canvas (drawDoubleRoundRect 29, clipOutPath 26, saveLayer 21)
- Typeface: https://developer.android.com/reference/android/graphics/Typeface (create(family, weight, italic) 28)
- LineBreakConfig and Builder: https://developer.android.com/reference/android/graphics/text/LineBreakConfig ; LineBreakConfigSpan: https://developer.android.com/reference/android/text/style/LineBreakConfigSpan
- LineHeightSpan.Standard: https://developer.android.com/reference/android/text/style/LineHeightSpan.Standard
- TextView: https://developer.android.com/reference/android/widget/TextView (setLineHeight 28/34, setFallbackLineSpacing 28, setIncludeFontPadding default true, setUseBoundsForWidth 35, setBreakStrategy defaults, setHyphenationFrequency defaults, setJustificationMode 26, setMinimumFontMetrics 35)
- SweepGradient: https://developer.android.com/reference/android/graphics/SweepGradient ; ArgbEvaluator: https://developer.android.com/reference/android/animation/ArgbEvaluator
- Hardware acceleration support table: https://developer.android.com/develop/ui/views/graphics/hardware-accel
- Android 15 behaviour changes (edge-to-edge, elegantTextHeight): https://developer.android.com/about/versions/15/behavior-changes-15
- Android 16 behaviour changes (edge-to-edge opt-out removed, elegantTextHeight ignored): https://developer.android.com/about/versions/16/behavior-changes-16

Open-source implementations, read:
- React Native box shadows: https://github.com/react/react-native/blob/main/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/drawable/OutsetBoxShadowDrawable.kt (API 28) and InsetBoxShadowDrawable.kt (API 29)
- React Native filters and sigma conversion: https://github.com/react/react-native/blob/main/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/FilterHelper.kt
- Jetpack Compose half-leading span: https://github.com/androidx/androidx/blob/androidx-main/compose/ui/ui-text/src/androidMain/kotlin/androidx/compose/ui/text/android/style/LineHeightStyleSpan.android.kt

Cited, not read this pass [unverified]: Chromium `box_border_painter.cc`; CSS Values 4 border-width snapping; CSS Backgrounds 3 radius clamping and shadow layering; Chrome `text-wrap: balance` article; AGSL guide; Haze; BlurView; `androidx.graphics.shapes`; Android Dev Summit/I/O graphics talks.

```json
{
  "goalbuddy_receipt_v1": {
    "task": "T015",
    "role": "scout",
    "status": "done",
    "output": "docs/goals/milestone-1/notes/T015-android-playbook.md",
    "summary": "Android Views playbook covering every css-support.md feature group: technique, fidelity, min API, cost and proposed status change. Key techniques: Dragon-owned box Drawable (drawDoubleRoundRect rings, per-side wedge clips, CSS radius clamping), BlurMaskFilter+clipOutPath shadows with sigma->radius conversion (RN precedent, API 28/29), RenderEffect filters and chains (31), layer-paint BlendMode and isolation layers (29), AGSL RuntimeShader as paint-worklet equivalent (33), Outline path clipping (33), setBackdropRenderEffect (37.2). Text: own StaticLayout-backed view, override includeFontPadding/HIGH_QUALITY break strategy/hyphenation, half-leading LineHeightSpan (Compose precedent) with error-diffused rounding, balance via binary-search width, word-spacing via Paint.setWordSpacing (29). Recommends minSdk 29 with tiers 31/33/35/37.2.",
    "upgrade_candidates": {
      "caveat_to_exact": ["opacity", "radius", "border", "rounded-clip", "shadow", "filter (colour functions)", "blends"],
      "approx_to_caveat": ["other-shadows", "other-gradients", "text-fill", "backdrop (37.2+)", "text-shadow", "decoration-detail", "outline", "pattern-border (after Chromium port)"],
      "unsupported_to_caveat": ["isolation", "masks", "matrix", "word-spacing", "balance", "inline-box", "sticky", "scroll-controls (overscroll/scroll-behavior only)"],
      "other": ["cursor no-effect->caveat", "inline-paint unsupported->approx", "other-border unsupported->approx", "corners unsupported->approx (deferred)", "font-style unverified API note resolved (API 28)"]
    },
    "new_landmines": ["ArgbEvaluator interpolation differs from CSS", "View.INVISIBLE hides subtree unlike CSS visibility", "ViewGroup clips children by default", "LINE_BREAK_STYLE_NO_BREAK still breaks graphemes: overflow-wrap normal unmatched", "TextView default BREAK_STRATEGY_HIGH_QUALITY", "elegantTextHeight flipped in 15, ignored in 16", "force dark must be disabled", "animator duration scale", "Android 14 non-linear font scaling (unverified)", "hardware-accel doc table vs RN BlurMaskFilter practice"],
    "verified_sources": 17,
    "unverified_items": 14,
    "files_written": ["docs/goals/milestone-1/notes/T015-android-playbook.md"],
    "commands_run": ["curl Android reference pages + node extraction of 'Added in API level' entries", "curl React Native drawable/FilterHelper sources", "gh api androidx LineHeightStyleSpan source"],
    "no_claim_without_test": "All upgrades are proposals; none changes css-support.md or the profile until a parity fixture passes.",
    "next_task_hint": "T017 can take section 13 as the Android upgrade list and section 1 (box drawable, dispatchDraw clip, parent-drawn shadow, text view owning StaticLayout, runtime helpers for balance/sticky) as Android's backend technique model; section 14 seeds the Android lane fixtures."
  }
}
```
