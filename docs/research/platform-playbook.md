# Platform playbook: how each backend reaches CSS

Judge synthesis (T017), 2026-09-26. Sources: the three platform notes [T014 iOS](../goals/milestone-1/notes/T014-ios-playbook.md), [T015 Android](../goals/milestone-1/notes/T015-android-playbook.md) and [T016 macOS and text engines](../goals/milestone-1/notes/T016-macos-text-playbook.md), plus [css-support.md](css-support.md), [pitfalls.md](pitfalls.md), the design principles in [goal.md](../goals/milestone-1/goal.md) and `AGENTS.md`. This note adds no new external evidence. Evidence tags such as `[doc]` and `[unverified]` carry over from the source notes; look there for the citation.

**Nothing in this note changes a support status.** Under `AGENTS.md`, a support-list entry moves only when a Chrome comparison test passes. Every "proposed" status below is a candidate with a named technique and the test that would earn it. No simulator or emulator has run any of this: the Xcode licence is not accepted on this Mac (T004), and no Android lane exists yet.

## 1. Summary in plain words

**What the platform engineers found.** The current support table was written from the question "is there a native property for this?" The three engineers asked a different question: "how would a senior platform engineer make this look like Chrome?" The answer is almost never "it can't be done". It is one of six moves:

1. **Set a native property** (`cornerRadius`, `alpha`, `setAlpha`, `alphaValue`).
2. **Draw it in a layer or drawable Dragon owns** (a `CAShapeLayer` ring for per-side borders, an Android `Drawable` that paints shadow, background, inset shadow and border in CSS order, a Core Graphics "paint island" that draws a whole group so blend modes work).
3. **Run a shader** (Android `RenderEffect` from API 31 and AGSL `RuntimeShader` from API 33, Core Image filters on macOS).
4. **Hook the text engine** (the per-line callback in TextKit or Android's `LineHeightSpan`, which lets Dragon own the line box while the platform keeps shaping, breaking, selection and accessibility).
5. **Fold it at build time** (colour filters folded into the colours themselves, `line-height: normal` read from the bundled font file, `ch` and `ex` from font tables, gradient stops pre-sampled).
6. **Run a small piece of logic at run time** (balanced wrapping as a width search, sticky offsets from the scroll position, scroll-snap target selection, CSS transition reversal, one extra layout pass for container queries).

**There is always something.** The rows that remain unsupported are unsupported for a stated reason: no layout algorithm exists (floats, tables, `order`, subgrid), only private API would do it (live filters over arbitrary UIKit controls), or the platform refuses the behaviour outright (Android always breaks an overlong word; CSS lets it overflow).

**Per platform, in one paragraph each.**

- **iOS.** 41 rows are candidates to move up. The big wins are exact line boxes through the TextKit line-fragment callback, per-side borders and CSS radius clamping as owned shape layers, `word-spacing` as kerning on spaces, `inline-block` in text via view-backed text attachments (iOS 15), and keyframes, `steps()` and `linear()` with exact timing. Filters and blend modes, previously "impossible" because `CALayer.filters` is not supported on iOS [doc], become reachable three ways: colour filters folded into colours at build when nothing clamps, blends inside a Core Graphics paint island, and blur on snapshots of subtrees the compiler proves static. SwiftUI shaders are a dead end: Apple says UIKit-backed views may not render into them [doc].
- **Android.** 30 rows are candidates. Android can match more paint than iOS: `RenderEffect` gives every CSS filter function from API 31, layer-paint `BlendMode` gives blend modes and isolation from API 29, AGSL shaders from API 33 can evaluate CSS gradients per pixel, and `setBackdropRenderEffect` gives real backdrop blur from 37.2. Text is controllable but hostile by default: five defaults must be overridden on every text node (font padding, the "high quality" line breaker, theme hyphenation, fallback line spacing, `TextView`'s own clip rectangle). Recommended floor: API 29.
- **macOS.** Not "iOS with a mouse". Layer filters, background filters and compositing filters work (via `NSView.contentFilters`, `backgroundFilters`, `compositingFilter`), so filters, blend modes and clip paths move up. Hover becomes exact. But AppKit owns each view's own layer: setting `transform`, `anchorPoint`, shadows or filters directly on it is undefined behaviour since 10.13, so skew, general matrices, `transform-origin` and scale or rotate on elements with children drop from exact to caveat. For text, macOS is the platform closest to Chrome, because Chrome on the Mac uses the same Core Text font metrics, fallback and hyphenation calls.

**The design consequence.** The core compiler keeps speaking only CSS. Each backend owns a catalogue of techniques, each with a fidelity, a minimum OS, a cost and the tests that prove it (section 2). The compiler gives backends platform-free facts about the tree ("this subtree's paint is known solid colours", "no descendant becomes visible", "these children overlap") so a backend can pick the cheapest technique that is correct for each element in each state.

## 2. The backend technique model

### 2.1 Rules

1. **The core stays CSS-only.** The resolved result, analysis facts and diagnostics use CSS names and CSS values. No UIKit, AppKit or Android term appears in a core type (owner, 2026-09-26, T009 card). Techniques live in backend packages.
2. **A technique is data plus code.** Its data (row, value subset, kind, fidelity, minimum OS, cost, tests) lives in the backend's support profile, so the compiler, editor, docs and build summary read the same facts. Its code is the generator that emits native code, plus any runtime helper it needs.
3. **Status is derived, never written.** A technique's status comes from its fixtures' results. A profile row is `exact` only when every technique the compiler may choose for that row has passing `exact` fixtures on the declared lane.
4. **The compiler picks, the developer does not.** For each declaration in each element state, the backend picks the cheapest applicable technique at or below the target's declared minimum OS. If none applies, it is a build error with a fix. A technique above the declared floor is a build error, never a hidden runtime fallback (P21).
5. **Every runtime helper has a TypeScript reference.** Balance search, sticky offsets, snap selection, transition reversal, radius clamping, dash selection and gradient-line geometry are specified once in TypeScript. The Linux lane tests the reference against Chrome, and each native port is tested against the same input and output vectors. Geometry that depends on layout size runs on the device, so the Swift and Kotlin ports must agree with the reference to the last device pixel.
6. **Costly techniques are reported, not hidden.** Anything with an offscreen pass per frame, a snapshot, a paint island or a per-frame layout is listed in the build summary per element (P20, B7).

### 2.2 Typed sketch

Pseudocode, not an implementation. Names are illustrative; T009 owns the real API.

```ts
// ---------- core (CSS only) ----------

type RowId = string;                      // css-support.md anchor: 'border', 'filter', 'line-height'
type StateKey = string;                   // from principle 1: one per distinct resolved state

interface ResolvedDeclaration {
  element: ElementId;
  state: StateKey;
  property: string;                       // CSS property name
  value: CssComputedValue;                // typed CSS value, never a platform value
  row: RowId;                             // which support row governs it
  span: SourceSpan;
}

// Platform-free facts the analysis can prove. Techniques read these to decide if they apply.
interface AnalysisFacts {
  paintIsBuildKnown(el: ElementId, state: StateKey): boolean;      // solid colours, stops, borders, text colour
  subtreeIsStaticBetweenStates(el: ElementId): boolean;            // no runtime content change inside
  descendantMayBecomeVisible(el: ElementId): boolean;              // for visibility: hidden
  childrenMayOverlap(el: ElementId, state: StateKey): boolean;     // for group opacity
  subtreeIsPaintOnly(el: ElementId): boolean;                      // no inputs, text fields, video
  stackingContextOf(el: ElementId, state: StateKey): ElementId;
  fontFor(el: ElementId, state: StateKey): BundledFontRef | 'system';  // principle 5
}

// ---------- backend (owns platform knowledge) ----------

type TechniqueKind =
  | 'native-property'     // set a view/layer/paint property
  | 'owned-paint'         // Dragon-owned layer, drawable, sublayer or paint island; includes snapshot content
  | 'shader'              // AGSL RuntimeShader, RenderEffect chain, Core Image filter, Metal
  | 'text-engine-hook'    // attributes plus per-line callbacks: the Dragon-owned line box
  | 'build-fold'          // value computed at build, emitted as a literal
  | 'runtime-helper';     // small on-device routine running a CSS algorithm

type Fidelity = 'exact' | 'near' | 'approx';

interface Cost {
  mainThread: 'none' | 'per-change' | 'per-layout' | 'per-scroll-frame' | 'per-frame';
  offscreenPasses: number | 'per-frame';  // extra render passes (mask, group opacity, effect layer)
  memory: 'none' | 'per-box-area' | 'per-island-area' | 'per-snapshot';
  reportInSummary: boolean;               // true for islands, snapshots, per-frame work
}

interface Proof {
  lane: 'linux-taffy' | 'ios-sim' | 'android-emu' | 'macos-app';
  reference: 'chrome-linux' | 'chrome-same-os';   // hyphenation and fallback need same-OS Chrome
  fixtures: FixtureId[];                            // must pass before status is anything but proposed
  tolerance: ToleranceRef;                          // named in the profile, never loosened to pass
  helperVectors?: VectorSetId;                      // runtime helpers: shared with the TS reference
}

interface Technique {
  id: string;                             // 'android.border.ring-with-wedges'
  backend: 'ios' | 'android' | 'macos' | 'web' | 'email';
  row: RowId;
  values?: ValuePattern;                  // subcase, e.g. filter colour functions only
  kind: TechniqueKind;
  composes?: TechniqueKind[];             // e.g. balance = runtime-helper over text-engine measure
  fidelity: Fidelity;
  minOs: OsVersion;
  cost: Cost;
  applies(d: ResolvedDeclaration, facts: AnalysisFacts): Applies;  // pure, build time
  lower(d: ResolvedDeclaration, facts: AnalysisFacts): NativePlanFragment; // backend-only type
  proof: Proof;
}

type Applies = { ok: true } | { ok: false; reason: string; fix?: Fix };

// Backend chooses per declaration and state; the core never sees NativePlanFragment.
function choose(d: ResolvedDeclaration, target: Target, facts: AnalysisFacts): Technique | Diagnostic {
  const candidates = target.backend.techniques
    .filter(t => t.row === d.row && matches(t.values, d.value))
    .filter(t => t.minOs <= target.minOs);
  const usable = candidates.filter(t => t.applies(d, facts).ok);
  if (usable.length === 0) return errorWithFix(d, candidates, target);   // e.g. DRAGON_FILTER_CLAMPS
  return cheapest(usable, { preferFidelity: 'exact' });
}
```

### 2.3 The six kinds with examples

| Kind | What it is | Examples from the notes | Typical fidelity | Min OS driver | Cost | Proven by |
|---|---|---|---|---|---|---|
| Native property | One property on the platform view, layer or paint | `alpha` with default group opacity (iOS [doc]); `setAlpha` with `hasOverlappingRendering` (Android); `cornerRadius`; `setFontFeatureSettings` with CSS syntax (Android API 21 [doc]); `NSTrackingArea` for hover | exact when the platform model equals CSS | usually old | none to one offscreen pass | Chrome comparison fixture on the device lane |
| Owned paint | A layer, drawable or sublayer Dragon creates and controls; a paint island draws a whole group in one pass; a snapshot draws a static subtree as an image | Per-side border ring cut at CSS join lines (`CAShapeLayer`; `drawDoubleRoundRect` + wedge clips); shadow with `shadowPath` or `BlurMaskFilter` after `clipOutPath`; outline outside the border box; paint island with `CGBlendMode` for blends on iOS; macOS sublayers because AppKit owns the view layer | exact geometry, near edges | API 26-29 on Android (`clipOutPath`, `drawDoubleRoundRect`) | redraw per layout; islands and snapshots cost memory and are reported | Chrome comparison; per-side and radius fixtures; for islands, a hit-testing and accessibility check too |
| Shader | A GPU program or filter graph | `RenderEffect` colour matrices and blur (Android 31); AGSL CSS gradient evaluator including Oklab and hints (Android 33); Core Image `CIColorMatrix`, `CIGaussianBlur`, `CI*BlendMode` via `NSView.contentFilters`/`compositingFilter` (macOS); Metal conic gradient (iOS, optional) | exact maths, near sampling; macOS colour space unverified | Android 31/33/37.2 | offscreen buffer per filtered view; macOS forces in-process layer rendering | Chrome comparison per function and value; colour-space probe |
| Text-engine hook | Attributed-string attributes plus the engines' per-line geometry callbacks | Dragon-owned line box via `NSLayoutManagerDelegate` `shouldSetLineFragmentRect…baselineOffset` (iOS 9, macOS 10.11), custom `NSTextLayoutFragment` (TextKit 2), Android `LineHeightSpan.chooseHeight` with error diffusion; `.kern` on spaces for `word-spacing`; `NSTextAttachmentViewProvider` and `ReplacementSpan` for inline boxes; bidi control characters | exact line boxes; glyph shapes stay native | iOS 9/15, API 1/23 | a Dragon text view per text node instead of `UILabel`/`TextView` | Line-box fixtures (Ahem on Linux; bundled fonts on device) |
| Build fold | The compiler computes the result and emits literals | Colour filters folded into every build-known colour when no channel clamps; `line-height: normal` and `ch`/`ex`/`cap` from font tables; gradient stops pre-sampled in the CSS interpolation space; `mix-blend-mode` over build-known solid colours; `forced-colors` folded to false on iOS; colour transitions pre-sampled into keyframes | exact when its precondition holds (the compiler checks it) | none | build time only | Unit test of the fold against Chrome's computed or rendered value; precondition error fixture (`DRAGON_FILTER_CLAMPS`) |
| Runtime helper | A small on-device routine running the CSS algorithm | `text-wrap: balance` width bisection (2 to 6 lines, as Chrome); sticky offset clamp in the scroll callback; snap target in `scrollViewWillEndDragging` or `fling`; transition reversal ("reversing shortening factor"); container-query re-layout; scroll-driven animation progress; Android `letter-spacing` start shift | exact semantics, near timing | none | main thread per scroll frame, layout or change; reported | TypeScript reference tested against Chrome on Linux, native ports tested against the same vectors, then a device fixture |

Techniques compose. Balance is a runtime helper over the text engine's own measurement. The Dragon line box is a build fold (font metrics, Blink rounding) applied through a text-engine hook. Colour transitions on Android are a build fold (samples in the CSS colour space) played by a native animator, which avoids `ArgbEvaluator`.

## 3. Cross-platform feature matrix

Columns give the technique per platform and the proposed status, written as **current → proposed**. The macOS column does not exist in `css-support.md` yet; its entries are proposals for a new column. **Every status here is proposed until its fixture passes.** Kinds: P native property, O owned paint, S shader, T text-engine hook, F build fold, R runtime helper.

### 3.1 Layout and sizing

| Row | iOS | Android | macOS |
|---|---|---|---|
| Taffy rows: [flex](css-support.md#flex), [grid](css-support.md#grid), [block](css-support.md#block), [flow-root](css-support.md#flow-root), [display-none](css-support.md#display-none), [flex-direction](css-support.md#flex-direction), [flex-size](css-support.md#flex-size), [gap](css-support.md#gap), [grid-tracks](css-support.md#grid-tracks), [grid-placement](css-support.md#grid-placement), [spacing](css-support.md#spacing), [size](css-support.md#size), [intrinsic](css-support.md#intrinsic), [auto-min](css-support.md#auto-min), [ratio](css-support.md#ratio), [box-sizing](css-support.md#box-sizing) | P: Taffy frames. exact (unchanged) | P: Taffy, rounded in device pixels before `View.layout(int…)`; fractional densities (2.625) are the stress case. exact (unchanged) | P: Taffy in flipped views (`isFlipped = true`), `backingAlignedRect`, relayout during live resize. proposed exact |
| [inline-box](css-support.md#inline-box) | T: `NSTextAttachmentViewProvider` (iOS 15) hosting a Taffy-laid-out view. unsupported → caveat | T: `ReplacementSpan` placeholder, child view placed after layout. unsupported → caveat | T: same TextKit 2 technique [unverified on AppKit]. proposed caveat after probe |
| [float](css-support.md#float), [table](css-support.md#table), [order](css-support.md#order), [subgrid](css-support.md#subgrid), [masonry](css-support.md#masonry), [vertical-layout](css-support.md#vertical-layout), [intrinsic-limits](css-support.md#intrinsic-limits), [experimental-flex](css-support.md#experimental-flex) | unsupported: no layout algorithm | unsupported | unsupported |
| [sticky](css-support.md#sticky) | R: CSS sticky clamp in `scrollViewDidScroll`, applied as a layer translation. unsupported → caveat | R: same clamp in `setOnScrollChangeListener` (API 23), `translationY`; one-frame lag risk to measure. unsupported → caveat | R: clip-view bounds observer, offset an owned layer (`addFloatingSubview` ignores the containing block, not used). proposed caveat |
| [fixed](css-support.md#fixed) | R: overlay root. stays unsupported (release scope, not technique) | stays unsupported | stays unsupported |
| [scroll](css-support.md#scroll) | P: `UIScrollView`. caveat | P: `ScrollView`/`NestedScrollView`. caveat | P: `NSScrollView`, overlay scrollers follow the user setting. proposed caveat |
| [scroll-controls](css-support.md#scroll-controls) | R+P: snap in `targetContentOffset` (positions exact, deceleration native); `setContentOffset(animated:)`; `bounces = false`. unsupported → caveat | P: `overscroll-behavior`, `scroll-behavior` → caveat; R: snap via `fling` override, native motion. snap stays unsupported unless the owner accepts native motion (decision 4) | P: `scrollElasticity` for `none`. proposed caveat for overscroll; snap unsupported |
| [z-index](css-support.md#z-index) | P: sibling order. caveat | P: child order, elevation kept at 0. caveat | P: sibling order; `zPosition` on a view layer is forbidden. proposed caveat |
| [clip](css-support.md#clip) | P: `clipsToBounds`; mask layer for rounded. exact | P: `clipChildren` explicit; `dispatchDraw` clip for rounded. exact | P: `clipsToBounds` set explicitly (default differs between 13 and 14); `layer.mask` for rounded. proposed exact |
| [visibility](css-support.md#visibility) | P: hide own paint, not `isHidden`, when a descendant may become visible. exact, mapping corrected | P: same rule, not `View.INVISIBLE`. exact, mapping corrected | P: same rule (NSView `isHidden` also hides subviews). proposed exact |
| [contain-paint](css-support.md#contain-paint) | P: clip. caveat | caveat | proposed caveat |
| [contain-other](css-support.md#contain-other) | R: skip off-screen subtrees for `content-visibility: auto`. stays unsupported (later) | unsupported | unsupported |
| [will-change](css-support.md#will-change) | omit; never `shouldRasterize`. no-effect | no-effect | proposed no-effect |
| [inline](css-support.md#inline), [contents](css-support.md#contents), [alignment](css-support.md#alignment), [normal-position](css-support.md#normal-position), [absolute](css-support.md#absolute), [logical](css-support.md#logical), [direction](css-support.md#direction), [anchors](css-support.md#anchors) | unchanged | unchanged | same as iOS |

### 3.2 Paint, borders and effects

| Row | iOS | Android | macOS |
|---|---|---|---|
| [colors](css-support.md#colors) | F: sRGB literal. exact | F. exact | F. proposed exact |
| [wide-colors](css-support.md#wide-colors) | F: Display P3 / extended sRGB; Chrome's gamut mapping to pin. caveat | F: `long` colours (API 29) + wide-gamut window. caveat | F: `NSColor(displayP3Red:)`. proposed caveat |
| [mix](css-support.md#mix) | F for constants, per-state fold otherwise. caveat | caveat | proposed caveat |
| [appearance](css-support.md#appearance) | P: dynamic `UIColor`; layer colours re-resolved on trait change. caveat → exact | P: Dragon resolves `light-dark()`; force-dark switched off. caveat (not proposed) | P: `NSColor(name:dynamicProvider:)`, re-resolve in `viewDidChangeEffectiveAppearance`. proposed exact |
| [opacity](css-support.md#opacity) | P: `alpha`, group opacity on by default [doc]; off only where children never overlap. caveat → exact | P: `setAlpha` with `hasOverlappingRendering` true. caveat → exact | P: `alphaValue`; group behaviour [unverified]. proposed caveat until probed |
| [border](css-support.md#border) | O: `borderWidth` if uniform, else per-colour ring `CAShapeLayer` cut at corner join lines. caveat → exact | O: `drawDoubleRoundRect` ring, per-side wedge clips (API 29). caveat → exact | O: same as iOS on owned sublayers. proposed exact |
| [pattern-border](css-support.md#pattern-border) | O+R: per-side dashes with Blink's dash and gap rule. approx → caveat | O+R: port of Chromium's border painter with `DashPathEffect`. approx → caveat (after port) | O+R: same. proposed caveat |
| [other-border](css-support.md#other-border) | O: 3D colour pairs; nine-slice `contentsCenter`. unsupported → caveat | O: 3D colour pairs. unsupported → approx; border images stay unsupported | not covered; proposed unsupported |
| [radius](css-support.md#radius) | O+R: CSS clamp at layout, elliptical path mask; `cornerConfiguration` on iOS 26. caveat → exact | O+R: CSS clamp, 8-value `addRoundRect`. caveat → exact | O+R: same as iOS (`maskedCorners`, path for elliptical). proposed exact |
| [corners](css-support.md#corners) | O: CSS `superellipse()` path mask, not `.continuous`. approx → caveat | O: `graphics-shapes` path. unsupported → approx (deferred) | not covered |
| [rounded-clip](css-support.md#rounded-clip) | O: shadow layer outside, clip layer inside. caveat (unchanged) | O: `dispatchDraw` clip to padding-box inner radii; parent draws the exterior shadow. caveat → exact | O: owned shadow layer plus `layer.mask`. proposed caveat |
| [outline](css-support.md#outline) | O: sibling `CAShapeLayer` outside the border box; system halo for `auto`. approx → caveat (authored) | O: `onDrawForeground`. approx → caveat (authored) | O: owned layer; system ring via `drawFocusRingMask` for `auto`. proposed caveat (authored) |
| [shadow](css-support.md#shadow) | O: `shadowPath` grown by spread; masked out of the border box when the background is translucent. caveat (blur factor to measure) | O: `BlurMaskFilter` after `clipOutPath`, sigma = blur/2, radius = (sigma − 0.5)/0.57735 (React Native, from HWUI). caveat → exact | O: owned shadow layer with `shadowPath`, never `NSView.shadow`. proposed caveat |
| [other-shadows](css-support.md#other-shadows) | O: one layer per shadow; inset via even-odd path in a padding-box clip. approx → caveat | O: reverse-order draws; inset via `drawDoubleRoundRect` (29). approx → caveat | O: one layer each. proposed caveat |
| [gradients](css-support.md#gradients) | O+F: `CAGradientLayer` with CSS gradient line; stops pre-sampled under 1/255 error. caveat | O+F: `LinearGradient`/scaled `RadialGradient`, pre-sampled; S: AGSL exact on 33+. caveat (AGSL exact candidate) | O+F: same as iOS. proposed caveat |
| [other-gradients](css-support.md#other-gradients) | O: `.conic` (iOS 12) with pinned angle; repeating stops expanded at layout. approx → caveat | O: rotated `SweepGradient`; `TileMode.REPEAT`. approx → caveat | O: `.conic` (10.14). proposed caveat |
| [gradient-hints](css-support.md#gradient-hints) | F: pre-sampling. caveat | F, or S on 33+. caveat | F. proposed caveat |
| [background](css-support.md#background) | O: layer per background layer. caveat | O: `BitmapShader` layers in the box drawable. caveat | O. proposed caveat |
| [text-fill](css-support.md#text-fill) | O: background layer masked by the same text. approx → caveat | S: shader on `TextPaint`. approx → caveat | O: text mask layer. proposed caveat |
| [simple-filter](css-support.md#simple-filter) | P/O: `alpha`; layer shadow without a path for `drop-shadow`. caveat | S: `RenderEffect` drop-shadow chain (31). caveat | O or S. proposed caveat |
| [filter](css-support.md#filter) colour functions | F: fold into build-known paint when nothing clamps; S: `CIColorMatrix` on images; otherwise error. unsupported → caveat | S: one concatenated `ColorMatrix`, hardware layer paint (any API) or `RenderEffect` (31). caveat → exact | S: `contentFilters` with CSS matrices; colour-space probe. unsupported → proposed caveat |
| [filter](css-support.md#filter) blur | O: snapshot + `CIGaussianBlur`, static subtrees only. unsupported → caveat | S: `createBlurEffect` (31). caveat | S: `CIGaussianBlur`. proposed caveat |
| [backdrop](css-support.md#backdrop) | O: snapshot of layers behind + blur, static backdrops; material stays opt-in approx. approx → caveat (static) | S: `setBackdropRenderEffect` (37.2); emulation below stays approx. approx → caveat (37.2+) | S: `backgroundFilters`, after a probe that it renders. proposed caveat |
| [backdrop-other](css-support.md#backdrop-other) | O: same snapshot with colour matrices. unsupported → caveat (static) | S: 37.2+. caveat | S: after probe. proposed caveat |
| [blends](css-support.md#blends) | F over build-known solid colours; O: paint island for paint-only subtrees; error over controls, text fields, video. unsupported → caveat | P: layer paint `BlendMode` (29), stacking-context layers. caveat → exact | S: `compositingFilter` with `CI*BlendMode`. unsupported → proposed caveat |
| [isolation](css-support.md#isolation) | O: island boundary. unsupported → caveat | P: compositing layer on the isolating element (29). unsupported → caveat | stays unsupported pending probe |
| [masks](css-support.md#masks) | O: `CAShapeLayer`/gradient/image mask + path hit testing. unsupported → caveat | O: `dispatchDraw` clip or outline path (33); `saveLayer` + `DST_IN` for images; touch filtered by path. unsupported → caveat | O: `layer.mask` + `hitTest` override. unsupported → proposed caveat |
| [tint](css-support.md#tint) | P: `tintColor`. approx; `caret-color` caveat if selection may follow | approx | P: `insertionPointColor`. proposed approx |
| [cursor](css-support.md#cursor) | P: iPad pointer styles. no-effect on iPhone; iPad approx | P: `setPointerIcon` (24). no-effect → caveat | P: tracking area + `NSCursor` keyword map. proposed caveat |

### 3.3 Text and interaction

| Row | iOS | Android | macOS |
|---|---|---|---|
| [font-face](css-support.md#font-face) | P: register bundled files. caveat | P: `Typeface.Builder`/`Font.Builder` under Dragon IDs. caveat | P: `CTFontManagerRegisterFontURLs`. proposed caveat |
| [system-font](css-support.md#system-font) | caveat | P: `CustomFallbackBuilder` (29) for the CSS fallback order. caveat | caveat; fallback is the same Core Text call Chrome-Mac uses |
| [font-size](css-support.md#font-size) | caveat (text-size policy, pitfalls decision 5) | caveat; Android 14 non-linear scaling [unverified] | proposed caveat |
| [font-style](css-support.md#font-style) | P: real faces only, missing face fails the build. caveat → exact | P: `Typeface.create(family, weight, italic)` API 28 [doc]; unverified note removed. caveat (same mechanism; could be exact) | same as iOS. proposed exact |
| [font-features](css-support.md#font-features) | P: OpenType tags. caveat per value | P: CSS-syntax string (21). caveat per value | P. proposed caveat per value |
| [line-height](css-support.md#line-height) | T+F: Dragon line box via the TextKit 1 line-fragment callback. caveat → exact (line boxes) | T+F: `LineHeightSpan` with half-leading and error diffusion. caveat → exact (line boxes) | T+F: same callback or `CTLine` placement. proposed exact (line boxes) |
| [normal-leading](css-support.md#normal-leading) | F+T: `normal` read from bundled font tables with Blink's rounding. caveat → exact (bundled fonts) | F+T: same. caveat (line-box sub-row exact candidate) | F+T: same. proposed exact (bundled fonts) |
| [letter-spacing](css-support.md#letter-spacing) | T: tracking (`kCTTrackingAttributeName`) rather than `.kern`, pending probe. exact (fixture pending) | T+R: em value; Minikin splits the space half before and half after, so shift by −ls/2 at line start. exact (fixture pending) | T: tracking. proposed exact |
| [word-spacing](css-support.md#word-spacing) | T: `.kern` on each word separator. unsupported → caveat | T: `Paint.setWordSpacing` (29 [doc]) in a metric span; measurement support to probe. unsupported → caveat | T: `.kern` on separators. proposed caveat |
| [text-align](css-support.md#text-align) | caveat | caveat | proposed caveat |
| [decoration](css-support.md#decoration) | exact | exact | proposed exact |
| [decoration-detail](css-support.md#decoration-detail) | T: colour and style attributes; custom underline drawing for thickness, offset, wavy. approx → caveat | T: Dragon-drawn decorations from `Layout` geometry (29). approx → caveat | T: same as iOS. proposed caveat |
| [case](css-support.md#case), [ellipsis](css-support.md#ellipsis), [line-clamp](css-support.md#line-clamp), [whitespace](css-support.md#whitespace), [vertical-align](css-support.md#vertical-align), [selection](css-support.md#selection) | caveat (techniques in T014) | caveat (techniques in T015) | proposed caveat |
| [breaking](css-support.md#breaking) | P: `word-break` → char wrapping or Hangul priority; `overflow-wrap: anywhere` native. unsupported → caveat for those two; hyphens approx; `overflow-wrap: normal` with an overlong word unresolved (see 5.2) | stays unsupported: Android always breaks an overlong word, even with `NO_BREAK` [doc]; keep an expected-mismatch fixture | P: same as iOS; hyphenation uses the same Core Foundation dictionary as Chrome-Mac. proposed caveat, judged against macOS Chrome |
| [balance](css-support.md#balance) | R: width bisection, 2 to 6 lines. unsupported → caveat (balance) | R: same. unsupported → caveat (balance) | R: same. proposed caveat |
| `text-wrap: pretty` (in [balance](css-support.md#balance)) | T14 proposes approx via `.pushOut`; this note recommends unsupported (5.2) | unsupported | unsupported; clear `.pushOut` so breaking is greedy |
| [text-shadow](css-support.md#text-shadow) | T+O: `NSShadow` for one; one draw per shadow for several. approx → caveat | T+O: `setShadowLayer` with the sigma conversion; redraw per shadow. approx → caveat | same as iOS. proposed caveat |
| [bidi](css-support.md#bidi) | F/T: `unicode-bidi` compiled into isolate, embed and override control characters. caveat → exact (levels) | same. caveat → exact candidate (levels) | same. proposed exact (levels) |
| [inline-paint](css-support.md#inline-paint) | T+O: per-fragment rects from TextKit 2, kern for horizontal edges. unsupported → caveat | T+O: spacer spans, per-line drawing. unsupported → approx | same as iOS [unverified on AppKit]. proposed caveat after probe |
| [pointer-events](css-support.md#pointer-events) | P: `hitTest` override. caveat → exact | P: `dispatchTouchEvent` override. caveat → exact | P: `hitTest(_:)` override. proposed exact |

### 3.4 Transforms and motion

| Row | iOS | Android | macOS |
|---|---|---|---|
| [transform](css-support.md#transform) | P: affine transform. exact | P: `translationX/Y`, `scaleX/Y`, `rotation`, pivot. exact | P: `setBoundsSize`, `frameCenterRotation`, frame shift; negative scale not expressible. exact → caveat (downgrade) |
| [matrix](css-support.md#matrix) | P: `CGAffineTransform`. exact | P: `setAnimationMatrix` (29) or parent `canvas.concat` with inverse-mapped touches. unsupported → caveat | O: owned sublayers of leaf elements only; subtrees with child views are a build error. exact → caveat (leaf only) |
| [transform-origin](css-support.md#transform-origin) | P: `anchorPoint` compensation. exact | P: pivot. exact | F: fold the origin into the translation (no `anchorPoint`). exact → caveat |
| [three-d](css-support.md#three-d) | P+O: `m34` perspective, `CATransformLayer`, `isDoubleSided`; intersecting planes excluded. unsupported → caveat | stays unsupported | not covered; unsupported |
| [transition](css-support.md#transition) | P+R: `CABasicAnimation` with exact Béziers, CSS reversal logic. caveat → exact | P+R: `ViewPropertyAnimator`; paint via own evaluator in CSS colour space, never `ArgbEvaluator`. caveat | P: `NSAnimationContext`, owned-layer animations. proposed caveat |
| [layout-transition](css-support.md#layout-transition) | R: display-link interpolation with partial Taffy layout per frame, frame budget. unsupported → caveat | same technique possible (Choreographer); not proposed | same technique possible; not proposed |
| [timing](css-support.md#timing) | P: Béziers; discrete keyframes for `steps()`; linear keyframes for `linear()`. caveat → exact | P+R: `PathInterpolator` (precision to measure); exact custom interpolators for `steps()`/`linear()`. caveat | proposed caveat |
| [keyframes](css-support.md#keyframes) | P: `CAKeyframeAnimation` with per-segment timing. technique ready; stays unsupported by release scope (T14 lists caveat) | P: `PropertyValuesHolder.ofKeyframe` with per-keyframe interpolators. technique ready; stays unsupported | technique ready; unsupported |
| [new-motion](css-support.md#new-motion) | R: scroll-driven via `speed = 0` + `timeOffset`. unsupported → caveat (later); view transitions approx later | unsupported | unsupported |
| reduced motion ([media-appearance](css-support.md#media-appearance)) | P. exact | P: `areAnimatorsEnabled`; animator duration scale (5.1). exact | P: `accessibilityDisplayShouldReduceMotion`. proposed exact |

### 3.5 Units, values and conditions

| Row | iOS | Android | macOS |
|---|---|---|---|
| [metric-units](css-support.md#metric-units) (font units) | F: from bundled font tables; `lh` from the resolved line box. unsupported → caveat | F: same technique (not listed in T15). proposed caveat | F: same. proposed caveat |
| [metric-units](css-support.md#metric-units) (container units), [container](css-support.md#container) | R: one extra layout pass when a precomputed condition flips. unsupported → caveat (later) | same technique possible; not proposed | same; not proposed |
| [media-pointer](css-support.md#media-pointer) | P: iPhone none/coarse; iPad pointer detection. caveat | P: input devices. caveat | F: always hover and fine. proposed exact |
| [media-contrast](css-support.md#media-contrast) | P: `accessibilityContrast`; `forced-colors` folds to false. unsupported → caveat | not covered; stays unsupported | P: `…ShouldIncreaseContrast` for `more`. proposed caveat |
| [environment](css-support.md#environment) | P: safe area, `keyboardLayoutGuide` (15). caveat | P: insets listener, edge-to-edge always on (5.1). caveat | not applicable beyond window insets; proposed caveat |
| [viewport](css-support.md#viewport), [common-units](css-support.md#common-units), [rem](css-support.md#rem), [math](css-support.md#math), [mixed-calc](css-support.md#mixed-calc), variables, keywords, [media-size](css-support.md#media-size), [supports](css-support.md#supports), [layers](css-support.md#layers) | unchanged (compiler work, platform-independent) | unchanged | same as iOS |

### 3.6 Selectors and ownership

All selector rows are resolved by the compiler before any backend runs, so they are identical on every native backend. One platform difference: [states](css-support.md#states) `:hover` is **exact on macOS** (`NSTrackingArea`, ancestors hovered too) and stays caveat on iOS (iPad pointer only) and Android (mouse and hovering stylus). `:focus-visible` maps to the focus system on iOS, `isFocused && !isInTouchMode` on Android, and a keyboard-modality flag on macOS; caveat on all three.

## 4. Proposed support-table upgrades

Merged from T014 section "Upgradeable rows" (41 iOS rows), T015 section 13 (30 Android items) and T016 section 6 (macOS changes). One line per row; a dash means no change proposed. **All proposed.** The fixture column names the test that would earn the move; the lane is iOS simulator, Android emulator or a macOS test app unless it says Linux.

| Row | iOS | Android | macOS (new column) | Technique kinds | Fixture needed |
|---|---|---|---|---|---|
| appearance | caveat → exact | – | exact | P | Light and dark per state; layer colours change without relaunch |
| opacity | caveat → exact | caveat → exact | caveat | P | Overlapping children at 0.5 opacity; pixel values against Chrome |
| visibility | exact (mapping fixed) | exact (mapping fixed) | exact | P | Hidden parent with a `visibility: visible` child; hit testing and accessibility of both |
| border | caveat → exact | caveat → exact | exact | O | Per-side colours × radii × unequal widths; hairlines at DPR 2, 3, 2.625 |
| pattern-border | approx → caveat | approx → caveat | caveat | O+R | Dashed and dotted per side at widths 1-6 px, short sides that paint solid; needs the Chromium source read first |
| other-border | unsupported → caveat | unsupported → approx | – | O | 3D styles per side; nine-slice stretch |
| radius | caveat → exact | caveat → exact | exact | O+R | Clamping overflow cases, elliptical radii |
| corners | approx → caveat | unsupported → approx | – | O | Superellipse values, after Chrome's floor is known |
| rounded-clip | – | caveat → exact | caveat | O | Child overflowing each rounded corner, with border and exterior shadow |
| outline | approx → caveat | approx → caveat | caveat (authored) | O | Authored outline with offset and radius; `auto` stays approx |
| shadow | – (blur factor probe) | caveat → exact | caveat | O | Blur 0/1/4/24 px, spread ±, translucent background; on Android API 28 and 29 |
| other-shadows | approx → caveat | approx → caveat | caveat | O | Multiple and inset shadows with radii |
| gradients | – | – (AGSL exact candidate on 33+) | caveat | O+F / S | Transparent stops, Oklab vs sRGB, per-channel error under 1/255 |
| other-gradients | approx → caveat | approx → caveat | caveat | O | Conic zero angle and direction, conic seam, repeating period offset |
| text-fill | approx → caveat | approx → caveat | caveat | O / S | Gradient clipped to multi-line text |
| filter (colour) | unsupported → caveat | caveat → exact | caveat | F / S | Each function at 0, 0.5, 1, 2; clamping case produces `DRAGON_FILTER_CLAMPS` on iOS |
| filter (blur) | unsupported → caveat (static) | – | caveat | O / S | Blur 2 and 8 px including overflow past the box |
| backdrop | approx → caveat (static) | approx → caveat (37.2+) | caveat (after probe) | O / S | Blur over a known backdrop; iOS static only |
| backdrop-other | unsupported → caveat (static) | – (defined for 37.2+) | caveat (after probe) | O / S | Colour functions over a known backdrop |
| blends | unsupported → caveat | caveat → exact | caveat | F / O / P / S | All 16 modes over a known backdrop, with and without an isolating parent |
| isolation | unsupported → caveat | unsupported → caveat | – (probe) | O / P | Same as blends |
| masks | unsupported → caveat | unsupported → caveat | caveat | O | Basic shapes and gradient masks; taps outside the shape fall through |
| cursor | – (iPad approx) | no-effect → caveat | caveat | P | Keyword map with a mouse connected |
| inline-box | unsupported → caveat | unsupported → caveat | caveat (probe) | T | Inline-block in a paragraph; baseline and line breaks around it |
| inline-paint | unsupported → caveat | unsupported → approx | caveat (probe) | T+O | Padded, bordered span wrapping across lines |
| line-height | caveat → exact (line boxes) | caveat → exact (line boxes) | exact (line boxes) | T+F | Linux: Ahem at 0.8, 1, 1.5, px; device: descender-heavy strings, 10-line drift |
| normal-leading | caveat → exact (bundled fonts) | – (line-box sub-row exact candidate) | exact (bundled fonts) | F+T | Per bundled font, sizes whose ascent and descent round in opposite directions |
| letter-spacing | exact (switch to tracking) | – | exact (tracking) | T / R | Glyph positions and trailing edge; ligatures off when non-zero |
| word-spacing | unsupported → caveat | unsupported → caveat | caveat | T | Separators U+0020 and U+00A0 with letter-spacing |
| decoration-detail | approx → caveat | approx → caveat | caveat | T | Thickness, offset, wavy, colour |
| breaking | unsupported → caveat (word-break, overflow-wrap anywhere) | – (expected-mismatch fixture) | caveat (macOS Chrome reference) | P | Long URL at narrow width; Korean keep-all; hyphenation against same-OS Chrome |
| balance | unsupported → caveat | unsupported → caveat | caveat | R | 2 to 6 line headings; reference helper vectors on Linux first |
| text-shadow | approx → caveat | approx → caveat | caveat | T+O | One and three shadows with blur |
| bidi | caveat → exact | caveat → exact | exact | F/T | Each `unicode-bidi` value with mixed Arabic and Latin runs |
| font-style | caveat → exact | – (API note resolved) | exact | P | Every weight and italic of a bundled family; missing weight error |
| pointer-events | caveat → exact | caveat → exact | exact | P | `none` parent with an `auto` child; taps land on the child and on what is below |
| matrix | – | unsupported → caveat | exact → caveat (leaf only) | P / O | Skew with hit testing |
| transform | – | – | exact → caveat | P | Scale and rotate with children, off-centre origin |
| transform-origin | – | – | exact → caveat | F | Origins at corners and in px |
| three-d | unsupported → caveat | – | – | P+O | Perspective, `preserve-3d`, backface; non-intersecting planes |
| transition | caveat → exact | – | – | P+R | Mid-point values; interruption and reversal against Chrome |
| layout-transition | unsupported → caveat | – | – | R | Width transition with per-frame layout under a measured frame budget |
| timing | caveat → exact | – | – | P / R | `steps()` all four jump terms; `linear()` with positions |
| keyframes | unsupported → caveat (release scope keeps it off) | – (technique ready) | – | P | Per-keyframe easing, iteration, direction, fill |
| new-motion | unsupported → caveat (scroll-driven, later) | – | – | R | Progress at known scroll offsets |
| sticky | unsupported → caveat | unsupported → caveat | caveat | R | Mid-fling frame capture; containing-block release point |
| scroll-controls | unsupported → caveat | unsupported → caveat (overscroll, scroll-behavior) | caveat (overscroll) | R / P | Snap positions after fling; bounce off |
| metric-units | unsupported → caveat (font units) | – | caveat | F | `ch`, `ex`, `cap`, `lh` per bundled font |
| media-contrast | unsupported → caveat | – | caveat (`more`) | P | Setting toggled at run time |
| media-pointer / states hover | – | – | exact | P | Hover enter and leave on nested elements |
| container | unsupported → caveat (later) | – | – | R | Condition flip causing exactly one extra layout |

Count check: the iOS column carries T014's 41 rows; the Android column carries T015's 30 items (7 caveat → exact, 9 approx → caveat, 8 unsupported → caveat, 6 other moves, where "other" includes the `font-style` note and the line-height sub-row); the macOS column carries T016's 17 upgrades and 3 downgrades.

**Downgrades are part of the list.** macOS `transform`, `matrix` and `transform-origin` move from the iOS value `exact` to `caveat`, because AppKit resets view-layer transforms. The new macOS column must start from these values, not from a copy of the iOS column.

## 5. New pitfalls and corrections

### 5.1 New pitfalls and how Dragon handles each

Each is removed by design where possible, with a test that proves the mechanism. "Handling" uses the classes from pitfalls.md.

| # | Pitfall | Platforms | Handling | Mechanism | Test |
|---|---|---|---|---|---|
| N1 | `visibility: hidden` mapped to `isHidden` or `View.INVISIBLE` hides the whole subtree; CSS lets a `visibility: visible` child show | iOS, Android, macOS | design | The compiler writes the inherited value onto every node (principle 3) and knows per state whether a descendant may become visible (`descendantMayBecomeVisible`). If so, hide only the element's own paint and remove it from hit testing, focus and accessibility; otherwise the cheap native hide | Hidden parent with visible child: geometry, pixels, taps and accessibility tree |
| N2 | Box shadow shows through a translucent background; CSS clips the shadow out of the border box | iOS, macOS (CALayer shadows); Android (only if drawn wrongly) | design | Shadow drawn outside the border box only: mask "large rect minus border box" on iOS and macOS when the background is not opaque; `clipOutPath(borderBox)` on Android. Never Android elevation for `box-shadow` (fixed light source, no blur or spread, reorders siblings) | Semi-transparent box with a shadow, pixel check under the box |
| N3 | Containers clip their children by default; CSS `overflow` defaults to visible | Android (`clipChildren`, `clipToPadding` true); macOS (`clipsToBounds` true on 13, false on 14+) | design | Every container gets both values set explicitly from its resolved `overflow`, on every OS version | Child overflowing a parent with default overflow, on Android and on macOS 13 and 14 |
| N4 | Colour animation interpolates differently from CSS | Android (`ArgbEvaluator`: unpremultiplied, reported linear-light conversion since 8.0 [unverified]); Core Animation colour interpolation space [unverified] | design | Dragon evaluates colour transitions in the CSS space itself: a Dragon `TypeEvaluator` on Android, or pre-sampled keyframes where endpoints are build-known | Mid-point colour values against Chrome at 25, 50, 75 % |
| N5 | Force-dark repaints Dragon's colours on Android 10+ | Android | design | `setForceDarkAllowed(false)` on the root and `forceDarkAllowed="false"` in the theme; Dragon resolves `light-dark()` itself | Dark-mode device renders a light page with Chrome's colours |
| N6 | Animator duration scale stretches or removes every Android animation; Chrome ignores it | Android | default, accepted | Scale 0 ("remove animations") counts as `prefers-reduced-motion: reduce`. Other scales are honoured as a user setting and labelled caveat. Test devices pin scale 1 | Timing fixtures fail loudly if the scale is not 1 |
| N7 | `elegantTextHeight` changes line heights for tall scripts: default true when targeting API 35, ignored from 36 | Android | design, test | Line heights never come from the engine: the Dragon line box sets them. Fixtures run on API 35 and 36 targets | Arabic and Thai paragraphs on both targets, identical line boxes |
| N8 | Edge-to-edge is forced at target 35, and the opt-out is gone at 36 | Android | default | Always edge-to-edge (`enableEdgeToEdge` on every API level); insets feed `env(safe-area-inset-*)` and the root's safe-area padding (principle 6, P7) | Notch and gesture-bar devices with and without `viewport-fit=cover` |
| N9 | AppKit owns the view's own layer; setting `transform`, `anchorPoint`, `masksToBounds`, shadows or filters on it is undefined, and AppKit resets transform and anchor | macOS | design, error | Paint goes on Dragon-owned sublayers; geometry through the NSView API; skew or matrix on a subtree with child views is a build error | Transform fixtures survive a window resize |
| N10 | Chrome's `line-height: normal` differs by operating system and rounds each metric to whole pixels | Chrome itself | design | Metrics come from the bundled font file with one pinned rule; web output writes `ascent-override`, `descent-override` and `line-gap-override` so every Chrome agrees; native reproduces Blink's rounding in the Dragon line box | Linux: sizes whose ascent and descent round in opposite directions; later the same fixtures in macOS Chrome |
| N11 | Native engines add their own leading: AppKit adds 20 % line spacing to Times, Helvetica and Courier; iOS 17 and macOS 14 grow lines for tall scripts; Android adds font padding | Apple, Android | design | Never let an engine choose line height; every line gets Dragon's box through the per-line hook | Those three families and a tall-script paragraph |
| N12 | Android `TextView` defaults: `HIGH_QUALITY` line breaking (not greedy like Chrome), hyphenation from the theme, `includeFontPadding` true, its own clip rectangle cuts descenders | Android | design | A Dragon text view owning a `StaticLayout` with `BREAK_STRATEGY_SIMPLE`, hyphenation off unless `hyphens: auto`, no font padding, no clip; `TextView` only for selectable or editable text, configured the same way | Paragraph line breaks against Chrome at several widths; descender bounds |
| N13 | Apple's `.standard` line-break strategy includes `.pushOut` (orphan avoidance), so breaks are not greedy | iOS, macOS | design | `lineBreakStrategy = []` on every paragraph | Same line-break fixtures on Apple |
| N14 | Android letter spacing is placed half before and half after each glyph | Android | design | Shift the line by −ls/2 at the start (runtime helper); total width already matches | Glyph x positions with letter-spacing |
| N15 | Android cannot let an overlong word overflow (`NO_BREAK` still breaks graphemes) | Android | error or accepted | `overflow-wrap: normal` with content that can hold an overlong word stays unsupported on Android; the fixture expects the mismatch and fails if Android starts to match | Long URL in a narrow box |
| N16 | SwiftUI shader effects do not render UIKit-backed views | iOS | design | Not used; Core Graphics paint islands instead | none needed (documented dead end) |
| N17 | macOS filters force the window's layer tree to render in the app process | macOS | info | Reported in the build summary as a cost (P20) | Frame-time fixture on the macOS app |
| N18 | A window can move between 1x and 2x screens | macOS | design | `contentsScale` updated in `viewDidChangeBackingProperties`; frames snapped with `backingAlignedRect` | Move-between-screens fixture (manual evidence until automated) |

### 5.2 Conflicts between the three notes, resolved

| Topic | T014 / T015 / T016 say | Resolution |
|---|---|---|
| Letter spacing on Apple | T014: `.kern`. T016: `kCTTrackingAttributeName`, because tracking turns off optional ligatures as Chrome does | Tracking, pending a probe of ligatures and the trailing edge. The css-support.md iOS row text ("Point kern") changes with the fixture |
| `Paint.setWordSpacing` API level | T015: 29 [doc]. T016: 34 [unverified] | 29: T015 read the reference page |
| Scroll snap | T014: caveat (positions exact, motion native). T015: unsupported unless the owner accepts native motion | One rule for all backends: owner decision 4 |
| `text-wrap: pretty` | T014: approx via `.pushOut`. T016: `.pushOut` is not `pretty` and must be cleared for greedy breaking | Unsupported on all backends. `.pushOut` stays off |
| `overflow-wrap: normal` with an overlong word | T014: widen the text frame to the longest word | **Rejected as written**: widening the whole frame changes where every other line breaks. Needs a per-line technique (for example, lay out normally and move only the overlong word's line past the box). Until one passes a fixture, this case is unsupported on every backend, with an expected-mismatch fixture on Android |
| Shadow blur mapping | T014: `shadowRadius` = blur × 0.5 [unverified]. T015: React Native converts sigma to radius with HWUI's formula | Both are measurements, not facts. The iOS 0.5 factor gets its own fixture; the Android formula is taken from shipping code and still gets a fixture |
| `font-style` status | T014: exact candidate. T015: stays caveat | The mechanism is the same on every backend (real faces only, missing face is a build error), so all three are exact candidates |
| `pointer-events` | css-support.md: caveat. T015: "exact, unchanged" | Exact candidate on all three, same fixture |

### 5.3 Corrections to pitfalls.md and css-support.md

These should be applied by the task that owns those files; this note does not edit them.

1. **pitfalls.md §4.3 half-leading must round like Chrome.** Blink rounds ascent, descent and line gap each to whole pixels before adding them (`font_metrics.cc`, `simple_font_data.cc`, read by T016). The pseudocode uses unrounded values. Corrected sketch:

   ```ts
   function lineBox(font, size, lineHeight, reference: 'chrome-linux' | 'chrome-same-os') {
     const m = pinnedMetrics(font);               // one rule, the same numbers written to web overrides
     let a = Math.round(size * m.ascent), d = Math.round(size * m.descent);
     const gap = Math.round(size * m.lineGap);
     if (reference === 'chrome-linux') [a, d] = linuxDescentAdjust(a, d, size, m); // Blink's 1px move on Linux/Android
     const content = a + d;
     const used = lineHeight === 'normal' ? content + gap : resolveLength(lineHeight, size);
     const half = (used - content) / 2;           // gap split half above, half below
     return { height: used, baseline: half + a, clipsGlyphs: false };
   }
   ```

   With metric overrides set, Blink computes ascent and descent from the overrides and skips the VDMX path (T016 section 4.1), which is why overrides make every Chrome agree. Whether rounding still applies to override values should be confirmed in the same Linux fixture.
2. **pitfalls.md §4.3 platform comments.** Replace "iOS: paragraph style min/max line height, baselineOffset" with the per-line hook (the `baselineOffset` factor, `/2` or `/4`, is disputed and the hook avoids it). Android: the `LineHeightSpan` must diffuse rounding error across lines, because `FontMetricsInt` is whole device pixels (14 px × 1.5 at density 2.625 drifts 1.25 px over 10 lines).
3. **pitfalls.md §4.4 and P3.** Add the clip-out rule (N2): the shadow is removed under the border box. On Android, `box-shadow` is drawn, never elevation.
4. **pitfalls.md P5.** Per-side colours with radius on Android now have a defined technique (ring fill with wedge clips); it stays an error only until its fixture passes.
5. **pitfalls.md P11.** Add CSS's border-width snapping: widths of at least one device pixel round down to whole device pixels, smaller non-zero widths become one device pixel [unverified draft text; fixture at DPR 2.625].
6. **pitfalls.md P20.** Add the costly techniques to the build-summary list: paint islands, snapshots, macOS in-process filter rendering, Android `RenderEffect` offscreen layers, per-frame layout transitions.
7. **pitfalls.md P21.** Record the feature tiers from section 7 as the rows a declared floor selects.
8. **pitfalls.md B1 and test plan.** Hyphenation and font fallback parity need a same-OS Chrome reference (macOS Chrome, Android Chrome). The Linux lane cannot judge them.
9. **css-support.md rows whose wording is now wrong:** `visibility` ("Hidden view retains layout space" hides the subtree), iOS `letter-spacing` ("Point kern"), iOS `filter` and `blends` (reason text says "no public API", but outcomes are reachable by other techniques), Android `font-style` (API level now known: 28), iOS `opacity` (group-opacity default is now documented). Wording changes only; statuses still move only with fixtures.

## 6. Text strategy recommendation

**Adopt "native engines, Dragon-owned line box".**

- **The native engine keeps:** shaping, font fallback, line-break opportunities, bidi, hyphenation dictionaries, glyph drawing, selection, VoiceOver and TalkBack, input methods, spell-check and system text features.
- **Dragon owns:**
  - **Line-box geometry.** Height and baseline come from the bundled font file with Blink's rounding and CSS half-leading, plus `text-box-trim`, which is plain arithmetic once Dragon owns the box. They are applied per line through `NSLayoutManagerDelegate` `shouldSetLineFragmentRect…baselineOffset` (TextKit 1), a custom `NSTextLayoutFragment` (TextKit 2) or `LineHeightSpan.chooseHeight` (Android). Non-selectable labels on Apple can draw `CTLine`s at computed baselines instead.
  - **Chrome-like engine settings.** Apple: `lineBreakStrategy = []`, word wrapping, hyphenation off unless `hyphens: auto`. Android: `BREAK_STRATEGY_SIMPLE`, `includeFontPadding = false`, `LineBreakConfig` from `line-break` and `word-break`.
  - **Unicode control characters where Dragon owns a decision.** Bidi isolates and overrides, word joiners and zero-width spaces for break opportunities, soft hyphens.
  - **One measure path.** Taffy measures text through the same code that draws it, so the size Taffy sees is the size drawn.

**Evidence (from T016 section 4 and 5, with T014 and T015 agreeing):**

1. The top pitfall (P1) is line-box geometry, and every engine has a public per-line hook that sets it exactly without replacing line breaking. Compose's `LineHeightStyleSpan` already does this on Android and has tests; the TextKit callback sets each line's rect and baseline [doc].
2. Chrome itself is not one reference for text. It reads metrics per operating system (Core Text on Mac; FreeType's rule on Linux and Android; DirectWrite on Windows) and hyphenates with the platform's own dictionary on Mac. Dragon's own HarfBuzz and ICU4X line layout would match Linux Chrome better, but not the Chrome a user runs on a Mac, which already calls the same Core Text fallback and Core Foundation hyphenation as AppKit.
3. Owning line layout means rebuilding selection, accessibility navigation, input methods, spell-check, Dynamic Type and tall-script adjustments (Flutter's path), and adds megabytes of segmenter data [unverified figures].
4. What native engines get wrong by default (own line-height models, `.pushOut`, `HIGH_QUALITY` breaking, font padding, AppKit's 20 % on three families) is exactly what the hook and the settings override.

**Limits that stay caveat.** Break choices can still differ from Chrome in CJK, emoji and punctuation edge cases; glyph rasterisation differs; `system-ui` is a different font on every host. **When to revisit:** if the parity corpus shows Latin line-break differences above an agreed rate at common widths, add an opt-in exact mode for display-only text (headings, labels) that places glyph runs itself. Editable text always stays native.

**Cost.** Every text node that needs the hook becomes a Dragon text view instead of `UILabel` or `TextView`. That view is also the only way to avoid `TextView`'s clip rectangle, so the cost buys two fixes. The iOS memory and setup cost needs a measurement on the oldest supported device.

## 7. Platform minimums and owner decisions

### 7.1 Proposed minimums and tiers

A feature above the app's declared minimum is a build error for that target, naming the version it needs (P21). Tiers are not runtime fallbacks.

| Platform | Proposed minimum | Why that version | Higher tiers (features unlock only if the app's minimum is at least this) |
|---|---|---|---|
| iOS | **15** | View-backed text attachments (inline boxes), focus effects, `keyboardLayoutGuide` (principle 6), `usesDefaultHyphenation`, TextKit 2 fragments | 17: `registerForTraitChanges`, `hoverStyle`, improved per-language line breaking. 26: `cornerConfiguration` (a cheaper per-corner radius path; the mask path covers older versions) |
| Android | **API 29 (Android 10)** | First level where every caveat-or-better paint technique runs with one code path: `BlendMode`, `drawDoubleRoundRect`, `setWordSpacing`, `RenderNode`, 64-bit colours, `setForceDarkAllowed`, font fallback lists, inset shadows | 31: `RenderEffect` (filters, blur, drop-shadow). 33: AGSL shaders, any-shape outline clipping, `LineBreakConfig`. 35: per-span no-break and no-hyphenation; edge-to-edge enforced. 37.2: `setBackdropRenderEffect` |
| macOS | **13** | TextKit 2 `NSTextView`, `hangulWordPriority`, P3 displays common | 14: `clipsToBounds` default changes (Dragon sets it explicitly either way); `NSView.displayLink` for live resize [unverified] |

Device share at API 29+ and at iOS 15+ was not checked in any note; confirm on the Android distribution dashboard and Apple's figures before committing.

### 7.2 Owner decisions

I recommend accepting all five; the first changes the most.

**Platform minimums.** Recommend iOS 15, Android 10 (API 29) and macOS 13, because each is the lowest version where the techniques in this note need only one code path. Going lower (for example Android 8 or 9) loses blend modes, inset shadows, word spacing and font fallback lists on Android. Features that need a newer version still work for apps that declare that newer minimum.

**Text strategy.** Recommend native text engines with Dragon controlling line height and line position, because that fixes the most common "looks different on the phone" bug exactly while keeping selection, screen readers, input methods and spell-check for free. Building Dragon's own text layout would cost years of that work and still not match the Chrome a Mac user runs.

**Expensive techniques.** Recommend allowing them (paint islands for blend modes on iOS, snapshot blur of content that doesn't change, live backdrop blur, per-frame layout for layout transitions), with each use listed in the build summary, because the alternative is refusing CSS that can be shown correctly. They stay off in the first release wherever the release scope already rejects that feature.

**Native scrolling feel.** Recommend that scroll snapping counts as supported with a caveat when the snap positions match Chrome and the flick speed and bounce are the platform's own, because scrolling already works this way today and users expect their platform's feel.

**macOS as a target.** Recommend keeping macOS in the technique model and support profile now, but building it after iOS and Android, because it proves the core has no iOS assumptions (macOS differs on transforms, filters and hover) without costing milestone time.

Researched defaults, adopted unless the owner objects: all conflict resolutions in 5.2; `text-wrap: pretty` unsupported; Android animator scale 0 treated as reduced motion; hyphenation and font fallback judged against same-OS Chrome in a later lane; the Blink rounding rule in the Dragon line box.

## 8. Probes and measurements before any upgrade is claimed

Grouped by where they can run. Nothing in sections 3 and 4 moves until its item here passes. Items marked Linux can start now; the others wait for their lane.

**Linux lane (can run in milestone 1 or right after):**
1. Blink rounding of ascent, descent and gap with Ahem and a second bundled font, sizes chosen so the two round in opposite directions; also with metric overrides set.
2. The balance helper's TypeScript reference against Chrome on 2 to 6 line headings (Ahem, then a real font).
3. Gradient pre-sampling error under 1/255 per channel against Chrome pixels, including transparent stops and Oklab.
4. Colour-filter fold maths against Chrome's rendered colours, and the clamping detector.
5. CSS radius clamping and gradient-line geometry references against Chrome box and pixel output.

**Primary-source reads (no device needed):**
6. Chromium `box_border_painter.cc` for the dash and dot rule and 3D border colours (both notes relied on reimplementations).
7. Chrome's current balance algorithm and line cap; `super` and `sub` offsets; outline radius behaviour; the border-width snapping draft text.

**iOS simulator (blocked by the Xcode licence, T004):**
8. `shadowRadius` versus CSS blur (the 0.5 factor); `CIGaussianBlur.inputRadius` versus sigma.
9. Line-fragment callback line boxes against Chrome; the Dragon text view's memory and setup cost against `UILabel` on the oldest supported device.
10. Tracking versus kern: ligatures and the trailing edge; kern on spaces for `word-spacing`.
11. `CAGradientLayer` conic zero angle, direction and interpolation space.
12. `CGBlendMode` formulas against CSS Compositing for all 16 modes.
13. Snapshot and blur timings, and paint-island redraw cost.

**Android emulators at API 28, 29, 31, 33, 35, 36 and 37.2:**
14. `BlurMaskFilter` and `setShadowLayer` shadows on the hardware pipeline (the docs table says unsupported; React Native ships it).
15. `clipPath` and outline-path edge anti-aliasing.
16. `RenderEffect` blur extending past view bounds.
17. `setWordSpacing` honoured by `StaticLayout` measurement; Minikin letter-spacing placement.
18. `ArgbEvaluator` behaviour (to document why it is not used).
19. `LineHeightSpan` error diffusion over 10-line paragraphs at density 2.625; `elegantTextHeight` on targets 35 and 36.
20. Sticky offset lag during a fling; `setAnimationMatrix` hit testing; `getChildDrawingOrder` touch order.
21. Edge-to-edge insets on targets 35 and 36.

**macOS test app, plus macOS Chrome as a second reference:**
22. Core Image working colour space for layer filters and compositing filters (decides exact versus near for filters and blends).
23. Whether `backgroundFilters` renders for layer-backed views on macOS 13 to 26.
24. Where TextKit puts font leading; whether AppKit's 20 % adjustment still applies in TextKit 2; which table Core Text reads for ascent.
25. `alphaValue` group-opacity behaviour; whether a filtered group isolates blending.
26. Hyphenation and fallback parity against macOS Chrome.

**Measurements for the build summary and budgets:** frame time for layout transitions per screen, backdrop blur per frame, and macOS in-process filter rendering, each on the oldest supported device.

```json
{
  "goalbuddy_receipt_v1": {
    "task_id": "T017",
    "role": "judge",
    "status": "done",
    "result": "complete",
    "files_written": ["docs/research/platform-playbook.md"],
    "decision": "Adopt a backend technique model with six kinds (native property, Dragon-owned paint incl. paint islands and snapshots, shader, text-engine hook, build fold, runtime helper), each carrying row, value subset, fidelity, min OS, cost and proof; status derived from fixtures only; core stays CSS-only and exposes platform-free analysis facts that techniques query; compiler picks the cheapest applicable technique at or below the declared floor, else a build error with a fix; every runtime helper has a TypeScript reference tested against Chrome on Linux and shared vectors for native ports.",
    "summary": "Synthesised T014 (41 iOS candidates), T015 (30 Android items) and T016 (17 macOS upgrades, 3 downgrades) into a cross-platform matrix per css-support.md row and a merged upgrade table with technique kinds and required fixtures, all proposed. Recorded 18 new pitfalls (visibility vs isHidden/INVISIBLE, shadow under the border box, container child clipping, colour animator interpolation, force-dark, animator scale, elegantTextHeight, edge-to-edge, AppKit-owned layers, Chrome per-OS metrics and rounding, engine-added leading, TextView defaults, Apple pushOut, Android letter-spacing placement, Android overlong-word breaking, SwiftUI shader dead end, macOS in-process filters, backing-scale changes) with mechanisms and tests. Resolved 8 conflicts between the notes (tracking over kern, setWordSpacing API 29, one scroll-snap policy, pretty unsupported, T014 overlong-word helper rejected, shadow factors are measurements, font-style and pointer-events exact candidates everywhere). Listed corrections for pitfalls.md (4.3 must round ascent, descent and gap like Blink; per-line hook instead of baselineOffset; Android error diffusion; shadow clip-out; P5, P11, P20, P21, B1) and css-support.md wording. Recommended native engines plus a Dragon-owned line box. Proposed iOS 15, Android API 29 (tiers 31/33/35/37.2), macOS 13.",
    "owner_decisions": [
      "Platform minimums: iOS 15, Android API 29, macOS 13 (recommend yes)",
      "Text strategy: native engines with a Dragon-owned line box (recommend yes)",
      "Allow expensive techniques (paint islands, snapshot blur, live backdrop, per-frame layout) with build-summary reporting (recommend yes)",
      "Scroll snap counts as caveat with exact positions and native motion (recommend yes)",
      "macOS kept in the model and profile now, built after iOS and Android (recommend yes)"
    ],
    "no_claim_without_test": "No support status changed; every upgrade is proposed until its named fixture passes on its lane.",
    "unverified_carried": [
      "CALayer shadowRadius vs CSS blur; CIGaussianBlur radius vs sigma",
      "Core Image working colour space on macOS; backgroundFilters on layer-backed views",
      "BlurMaskFilter hardware support on Android 28+",
      "Chromium dash rule, balance algorithm, super/sub offsets, border-width snapping",
      "Tracking vs kern trailing edge; setWordSpacing in StaticLayout measurement",
      "Device share at iOS 15+ and Android API 29+"
    ],
    "required_board_updates": [
      "Record T017 done with evidence docs/research/platform-playbook.md",
      "Feed section 2 (technique model, AnalysisFacts) into T009 API design",
      "Queue a PM or Worker task to apply section 5.3 corrections to pitfalls.md and css-support.md wording (statuses unchanged)",
      "Add the Linux-runnable probes in section 8 (items 1-5) to the milestone-1 fixture plan where they fit the box, flex and text scope",
      "Surface the five owner decisions in section 7.2"
    ],
    "full_outcome_complete": false
  }
}
```
