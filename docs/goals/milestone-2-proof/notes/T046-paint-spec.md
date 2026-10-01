# T046: Paint spec (PNT1, PNT2, BG2, OVFL, POSX-f, OVFL-S, P6) and the emitter split

Judge note, 2026-09-28. Read-only review; this note is the only file written. The Decision Rule applies: every open question is
settled here by research and handed to the PM as a ruling to record. Nothing goes to the owner.

**Read:** goal.md, state.yaml (T007, T009, T010, T012, T018, T019, T026, T037, T040, T042-T068); notes T010, T012 (V2a ruling 5),
T044 (INL order), T045 (REPL/FORM, R13), T047 (RT-1 to RT-13); milestone-2 notes/T015 §4-§5; docs/research/coverage-roadmap.md
(PNT1, PNT2, BG2, OVFL, POSX rows, §3 emitter-split paragraph, §4 hotspots); docs/research/platform-playbook.md (§2 technique
table, §3 radius/shadow/gradient/transform/scroll rows, N2, principle 5); docs/decisions.md at 71dbdf4 ("Maximum support",
"Selectors and scrollbars", "Text selection and editing", decisions 9, 13, 17); examples/music-player/styles.css. Code: master
41cc750 `lower/native-program.ts`, `emit/{uikit,android-views,native-support}.ts`, `css/properties.ts`, `analysis/computed.ts`,
`parity/src/{capture,chrome,compare}.ts`, `packages/translate/src/generate.ts`; /tmp/dragon-p5 (read-only): `samples.ts`,
`pixel-reference.ts`, `native-compare.ts` checkPixels, the native-support diff, and the current `lanes.json`.

## 0. Facts that shape the spec

- **The pixel lane (P5, /tmp/dragon-p5).** Colour points (`interior`, `border`, `outside`, `radius`, `clip`, `glyph`) sit
  `SAMPLE_INSET_DEVICE_PX = 2` clear of every edge and compare at `GATE_CHANNEL_DELTA = 0`. Edges are compared by position:
  an `edge` scanline's coverage integral must be within `GATE_DEVICE_PX = 1` of Chrome's. So antialiasing *ramps* never need
  to match bit for bit; *geometry* and *interior colours* do. `SampleBox` has one circular radius; `casePoints` passes 0.
- **P5's current device-pixels failures** (lanes.json, iOS 515 and Android similar) are Dragon-owned border paint: dotted and
  dashed sides sampled at mid-side land where Chrome has a gap (Dragon uses phase 0, dash 3w/gap 3w; Blink fits the pattern
  to the side), plus a `one` border case where native paints a band Chrome does not. That is P6a's input.
- **Where paint lives today.** `native-program.ts` holds the one `WriteKind` union, `VOCABULARY` and `boxPaint`. `uikit.ts` and
  `android-views.ts` each hold one `writeLines` switch. All drawing (`DragonBoxView.draw`/`onDraw`, `dragonDrawBorders`, the
  clip view, the tree builder) is Swift and Kotlin source inside `native-support.ts` (1,521 lines). T010 said the split leaves
  native-support.ts alone; that is wrong, because every paint feature draws there.
- **The translator** reads every top-level `packages/layout/src/*.ts` but emits only what the `engineRoots` in `generate.ts`
  reach. Its library has no `sin`, `cos`, `exp` or `Math.abs` (T047). Layout-size-dependent paint geometry (percent radii,
  gradient lines, shadow rects, transform origins) must run on device, so it belongs in translated `paint-*.ts` roots.
- **Chrome capture flags** include `--hide-scrollbars`; `capture.ts` records `getBoundingClientRect`, which is the *transformed*
  bounding box for transformed elements.
- **The demo's paint** (styles.css): `border-radius` x8 (px, rem, 50%, 999px); `box-shadow` x5 including multiple, inset,
  spread-only rings (`0 0 0 0.35rem`) and blurs up to 70px; `opacity` x6; `z-index` 20/30/40, where `.library-button`
  (relative, z 40, inside `.App`, which clips) must paint above the two fixed overlays; `outline: none`; `linear-gradient` x3,
  `radial-gradient` with hard stops and `transparent`, `repeating-radial-gradient`, two background layers; `transform`
  translate/translateX(%)/rotate/scale with `transform-origin: 0 50%`; `will-change: transform`; `overflow: auto` (the fixed
  `.library`) and `overflow-x: hidden` (html, body, .App, which compute `overflow-y: auto`); `position: fixed` x2;
  `scrollbar-color` + `scrollbar-width: thin` on `*`, plus `*::-webkit-scrollbar*` rules; `color-scheme: dark` on body.
- **Chrome 121+ ignores `::-webkit-scrollbar*` on any element whose `scrollbar-color` or `scrollbar-width` is not `auto`.**
  The demo sets both on `*`, so every `::-webkit-scrollbar` rule in it is ignored by Chrome 145 (SC-SCROLL confirms).
- **Other specs already bind this one:** T044 (INL1a never concurrent with the emitter split; INL2 never concurrent with it or
  with P6 on native-support/uikit/android-views); T045 (REPL-a and FORM-a Phase B write `emit/paint/image.ts`,
  `foreign-view.ts`, `control.ts` in the split's directory; PNT1 carries `color-scheme` and radius clipping of foreign views);
  T047 (RT-2 Dragon drives frames, no platform animators; RT-9 Dragon hit testing in `rt-hit.ts`; RT-13 additive registry hunks;
  SELD-R2 waits for PNT1 and PNT2 facts; SOV writes through BG2's gradient writer and PNT2's transform writer).

## 1. Rulings: native layer API or Dragon drawing, per feature

The test is Chrome's rasterisation under the lane rules above: exact geometry and exact interior colours, edges within one
device px. A native API is used only where its model equals CSS for every value the package accepts.

| Feature | Ruling | Why (research) |
|---|---|---|
| **border-radius** (P1) | **Dragon geometry + Dragon drawing.** One translated reference (`paint-radius.ts`) resolves the 8 radii: percentages per axis against the border box, the css-backgrounds-3 §5.5 clamp factor f = min(L/S), inner (padding-edge) radii = max(0, outer − border). Background, borders and the rounded clip use that one path. | `CALayer.cornerRadius` is one circular radius (per-corner selection only via `maskedCorners`; `cornerConfiguration` is iOS 26, floor 15); `masksToBounds` clips at the **outer** border-box curve, but CSS clips at the **padding-box** curve, which differs whenever there is a border (`.mini-video-shell` 1px, `.record-label` 0.4rem). Android `Outline.setRoundRect` is one radius and path clipping via `Outline` needs API 33 (floor 31). |
| rounded clip (P1) | iOS: a `CAShapeLayer` mask on the Dragon clip view (inner rrect path). Android: `canvas.clipPath(inner rrect)` in the clip view's `dispatchDraw`. Foreign views (the iframe slot, T045 R13) are clipped the same way; **fallback** for Android `WebView` only, if pixels show the path clip is not honoured: `setClipToOutline` with `Outline.setRoundRect`, which is exact when the inner radii are uniform (the demo's are). | Both mask paths antialias; the lane measures edges by coverage within 1 device px, so AA differences are covered and geometry is exact. |
| **box-shadow** (P1) | **Dragon drawing, one algorithm on both platforms.** Outer shadows are drawn by a Dragon companion view directly beneath the box (same host, so paint order is CSS's), clipped out of the border box (N2). Inset shadows are drawn inside the padding-box inner rrect. The blur mask is computed by a translated reference (`paint-shadow.ts`) using only +, −, ×, ÷ and sqrt, and drawn as a device-pixel-aligned bitmap, cached by size and parameters. Spread-only shadows (blur 0) are plain rrect fills. | CALayer shadows have no spread, no inset, an undocumented blur-to-radius mapping and show through translucent backgrounds (N2). Android elevation has a fixed light source and reorders siblings (N2, never used). `BlurMaskFilter` is Skia but a different Skia revision from Chrome's. One translated algorithm keeps iOS and Android bit-identical, so any difference from Chrome is one measured number, not two. The sigma rule is taken from Blink 145 source (reported as `BlurRadiusToStdDev`, sigma = 0.288675 × blur + 0.5, i.e. Skia's ConvertRadiusToSigma of blur/2; SC-RASTER confirms at the pinned revision), and the algorithm (analytic Gaussian with a polynomial erf, or Skia's triple box blur) is whichever SC-RASTER shows matches Chrome's capture raster path. |
| **opacity** (P1) | **Native property** (`UIView.alpha`, `View.setAlpha`), with the alpha set to Chrome's effective 8-bit quantised value if SC-RASTER shows Chrome quantises. | Both platforms composite the subtree as a group (iOS `UIViewGroupOpacity` defaults to YES; Android `hasOverlappingRendering()` defaults to true), which is CSS group opacity. Drawing it ourselves would be a paint island, the same offscreen pass. Pitfall recorded for SELD-R: iOS views with alpha < 0.01 are not hit-testable by UIKit; RT-9's Dragon hit test must not use UIKit hit testing (it doesn't). |
| **z-index / stacking** (P1) | **Dragon compile-time paint order** (CSS2 Appendix E on the fixed tree): stacking contexts, then native **hosting**: a node whose paint position needs it is re-hosted under its stacking context's host view, wrapped in a clip chain replicating each clipping ancestor in its containing-block chain. Sibling order is native child order; `zPosition`, `translationZ` and elevation are never used. A stacking context is atomic: nothing is ever hosted outside its SC's view, so group opacity and transforms stay correct. | `zPosition`/`setZ` only order siblings of one parent and Android Z draws elevation shadows. The demo needs cross-parent order: `.library-button` (z 40, inside the clipping `.App`) above `.library` (z 30) and `.mini-video-shell` (z 20). |
| **outline** (P1) | **Dragon drawing** at the stacking context's outline phase, outside the border box, following the border radius (Chrome ≥ 94), styles solid/dashed/dotted/double sharing P6a's side painter; `outline-style: auto` is Chrome's focus ring, drawn by Dragon from Blink's `FocusRingPainter` geometry at 145 and SC-RASTER's measurement (T047 RT-7 puts `auto` paint here). | No platform outline API matches CSS. |
| **color-scheme** (P1, per T045 R13) | Compile-time: the inherited `color-scheme` longhand and a `usedColorScheme(el)` query that selects ELB-2's dark tables for system colours and UA defaults. | Not paint, but T045 already binds it to PNT1; the resolution itself stays in the consumers (FORM, UA). |
| **transforms** (P2) | **Native view transform as the display mechanism, Dragon as the resolver.** A translated reference resolves the transform list and `transform-origin` (percentages against the border box) as typed functions; native glue composes the matrix with platform `sin`/`cos` and Chrome's exact-multiple-of-90deg snap (T047 RT-4), then sets it: iOS `layer.transform` via `setAffineTransform` with the origin compensated and `layer.allowsEdgeAntialiasing = true` (default false gives aliased edges, unlike Chrome); Android the decomposition into `pivotX/Y`, `translationX/Y`, `rotation`, `scaleX/Y`, exact for translate/rotate/scale lists (the demo's). Skew, `matrix()` with skew and 3D are refused (`DRAGON_UNSUPPORTED_VALUE` naming PNT2-m). | Transforms don't affect layout; they must move hit testing (RT-9, Dragon's own via facts), accessibility frames and per-frame updates (RT-2). Drawing transformed subtrees ourselves would re-render every frame on the main thread. Android `setAnimationMatrix` is an animation hook, not used. |
| **gradients / multiple backgrounds** (BG2) | **Dragon rasterisation.** A translated reference (`paint-gradient.ts`) evaluates CSS linear, radial and repeating gradients at each device pixel centre: gradient line and ending shape (css-images-3 §3), colour-stop fix-up, hard stops, **premultiplied sRGB interpolation**, and Skia's dither pattern if SC-RASTER shows Chrome dithers. The result is drawn as a device-pixel-aligned bitmap per background layer, bottom layer first, over `background-color`, clipped to the border-box shape. | `CAGradientLayer` interpolates unpremultiplied (transparent stops darken), has no repeating gradients and sizes radials to the layer bounds; Android `LinearGradient`/`RadialGradient` are Skia shaders that interpolate unpremultiplied and are a different Skia revision. The demo's `transparent 12.5%` and the shine's transparent stops expose both. |
| **overflow auto/scroll** (OVFL) | **Engine + native scroll view.** The engine computes scroll containers, scrollable overflow (css-overflow-3 §2.2), viewport propagation (§3.3) and a zero scrollbar gutter; iOS uses a `UIScrollView` subclass (`contentInsetAdjustmentBehavior = .never`); Android a Dragon scroll view built on `OverScroller` and `EdgeEffect` (the pieces `ScrollView` uses; `ScrollView` is vertical-only). Content size comes from the engine. Physics, bounce and stretch are native (decision 9 precedent: positions exact, motion native). | Overlay scrollbars take no space (decision "Selectors and scrollbars"); OVFL proves Chrome agrees under the capture flags with numbers. |
| **scrollbar styling** (OVFL-S) | At rest, no thumb is drawn, as in Chrome's overlay capture. While scrolling, Dragon draws the thumb only where Chrome honours styling: `scrollbar-color` and `scrollbar-width` (the demo's case), with thickness and colour from SC-SCROLL's measurement; `::-webkit-scrollbar*` rules are **ignored where Chrome ignores them** (standard properties set: the demo) with a warning, and the honoured `::-webkit-scrollbar` path (which Chrome draws as a classic, space-taking scrollbar) is refused naming OVFL-S2. Unstyled scroll containers keep the native overlay indicator. | decisions.md "Selectors and scrollbars". |
| **position: fixed** (POSX-f) | **Engine + runtime helper.** The engine places fixed boxes against the viewport; natively a fixed box stays in the root stacking context's host (the viewport scroll content) and is counter-offset by the viewport scroll offset in the scroll callback, synchronously in the same frame (the playbook's sticky technique). It escapes non-containing-block clips through PNT1's hosting. | Putting fixed views outside the scroll view would break z-order with scrolling content (`.library-button` z 40 must paint above both fixed overlays and still scroll). |

**Common to all paint (T047 alignment):**
- **No platform animators (RT-2).** Paint never uses `CABasicAnimation`, `CAKeyframeAnimation`, `UIView.animate`,
  `UIViewPropertyAnimator`, `ValueAnimator`, `ObjectAnimator` or `ViewPropertyAnimator`. Implicit actions on Dragon-owned
  sublayers (`CAShapeLayer` masks, bitmap layers) are disabled with `CATransaction.setDisableActions(true)` on every write,
  because standalone CALayers animate property changes by 0.25 s otherwise. A grep verify enforces it.
- **Runtime-callable writers (RT-1, RT-2, RT-11).** Every paint write is a public Swift/Kotlin writer function; the emitted case
  code applies static values **only** by calling those same writers, so a runtime write (ANIM-b per frame, SOV per update) is
  equal to the static build by construction. Writers whose value depends on the box size are re-applied by the after-layout
  hook after every layout.
- **Hit-testing facts (RT-9).** PNT1 and PNT2 publish program facts that `rt-hit.ts` reads without their writers changing:
  per node the paint-order index, stacking-context id, host and clip chain, the typed radii (with `paint-radius.ts`
  exported for the used values), the typed transform list and origin (with `paint-transform.ts` for the resolved functions).
  OVFL extends `rt-hit.ts` itself with scroll offsets and the scroll-container clip.

## 2. How each is proven: numbers first, then pixels

**Numbers first (in this order, every package):**
1. **Chrome-dual computed strings** on the web target for every new longhand (`border-*-radius`, `box-shadow`, `opacity`,
   `z-index`, `outline-*`, `transform`, `transform-origin`, `background-*`, `overflow-*`, `position`, `scrollbar-*`).
2. **Paint vectors:** each translated `paint-*.ts` root has vectors, TS = Swift = Kotlin bit for bit (EMS's harness).
3. **Chrome geometry where Chrome exposes it:** transforms: untransformed layout boxes (the capture's transform twin, below),
   the computed matrix string and `DOM.getContentQuads` against engine rect × matrix within `GATE_DEVICE_PX`; overflow:
   `scrollWidth`, `scrollHeight`, `clientWidth`, `clientHeight`, which must equal the engine exactly (after Chrome's integer
   snapping); fixed: boxes at pinned scroll offsets; hit order: RT-9's `elementFromPoint` grids.
4. **device-applied:** every writer has a readback key (radii in device px, shadow parameters, alpha, the transform function
   list and origin, native child order and hosts, content size and offset).

**Then the pixel lane:**
- Existing rules keep their gates. New points come from the paint-samples registry: elliptical `radius` points per corner;
  `shadow` points (the blur ramp) and `gradient` points (area samples 2 device px clear of hard stops, with hard stops
  checked as `edge` scanlines along the gradient line); transformed boxes map their interior, outside and glyph points through
  the matrix and suppress axis-aligned edge scanlines (their edges are proven by the quads in step 3); overlap fixtures put
  `interior` points in overlap regions, so paint order is compared as exact colours.
- **Two-stage paint proof for Dragon rasters:** the device must equal the TS reference raster **exactly** at every sample
  (translated code, no allowance); the TS reference is compared with the Chrome PNG **at every pixel of the painted area on the
  host** (a new host test), and that comparison is what an allowance, if any, covers.

**Measured allowances (decision 13, now a research-backed PM ruling under the Decision Rule).** Allowed only for the `shadow`
and `gradient` rule kinds, and only if all of these hold:
1. It is a named constant in its own file (`packages/parity/src/allowances/{shadow,gradient}.ts`, pre-created by EMS at
   `GATE_CHANNEL_DELTA`) that the lanes literal scan covers.
2. Its value is the measured maximum per-channel difference between the TS reference and Chrome over a committed calibration
   fixture set at DPR 2, 3 and 2.625, rounded up to a whole channel level, and **at most 2**. More than 2 is a stop and a new
   Judge review.
3. It is recorded in decisions.md with the measurement and the Blink source reasoning (dither, blur approximation).
4. The NS plants still fail with it in place: a 1-device-px shift of a gradient, a shadow and a radius each fails the lane.
5. A row proven under an allowance is `caveat` with the allowance named in its proof. `exact` needs delta 0.

Every other rule stays at `GATE_CHANNEL_DELTA = 0` and `GATE_DEVICE_PX = 1`. AA ramps are never an allowance; they are the
edge rule's job. Opacity gets no allowance: if Chrome's quantised alpha cannot be matched, PNT1 stops with the counts.

**The transform twin (PNT2, a case-kind capture registration in capture.ts).** For a fixture with transforms, the box capture
sets `transform: none` plus `will-change: transform` on each element whose computed transform is not `none`, then captures
boxes. `will-change: transform` keeps the containing block for positioned descendants and the stacking context, so layout is
unchanged and the boxes are the untransformed layout boxes the engine produces. The computed matrix and content quads are
captured on the untouched page.

## 3. The emitter split (EMS): what it is and when it lands

**What.** A behaviour-preserving package that turns paint into one writer module per feature and pre-creates every module the
paint, REPL and FORM packages will fill, so those packages write disjoint files and never touch the hotspot orchestrators
again. After EMS, a paint package edits only its own module files and new data. Concretely:
1. **Lowering registry.** `lower/paint/{types,registry}.ts`; `WriteKind`, `VOCABULARY`, `WRITE_CSS` and `boxPaint` move into
   `lower/paint/{background,border,clip}.ts`. `native-program.ts` keeps orchestration, the `font`/`text-color` writes (V2a
   and INL1a own them) and gains an extensible, non-projected `facts` record per `ProgramNode` and a `host` field equal to the
   DOM parent for every existing node.
2. **Emit registry.** `emit/paint/{types,registry}.ts`; each module exports the UIKit and Android lines, its Swift and Kotlin
   support source (emitted as new support files `Support/Paint/DragonPaint<Name>.swift` and
   `kotlin/dev/dragon/views/paint/DragonPaint<Name>.kt`), its applied-value readback, its expected-dump projection and its
   raster plants. `uikit.ts`, `android-views.ts` and `expected-dump.ts` dispatch through the registry.
3. **Native hooks in native-support.ts** (restructured once, then frozen to registration points): a `DragonBoxShape` (border
   box plus 8 radii, zero until PNT1) passed to every stage; box-view stages in CSS order (outer shadow, background, background
   layers, inset shadow, border, outline) with stage dispatchers that ask the radius module first for rounded border and clip
   paths; an after-layout hook per node; a container factory (clip view by default, scroll view once OVFL fills it); hosting
   and companion views (a node may be hosted under a view other than its DOM parent, with clip-chain wrappers; frames stay
   absolute-from-engine and readback stays in DOM terms); the runtime writer entry points (§1); and the plant list generalised
   so modules declare plants (the P5 `glyph-offset-1` plant unchanged). RT-13's registration points are kept intact and extended
   with named paint points in the same style.
4. **Stubs, all registered once, in final order:** `lower/paint/` and `emit/paint/`: `radius`, `shadow`, `effects` (opacity,
   z-index, color-scheme), `stacking`, `outline`, `transform`, `gradient`, `scroll`, `fixed`, `scrollbar`, `image`,
   `foreign-view`, `control` (the last three for T051/T052). `analysis/paint-values/` stubs with the same names plus a
   `computePaintValues` hook called once after `computeLengths`. `css/properties/{radius,shadow,effects,outline,transform,
   background-layers,scrollbar}.ts` and `css/shorthands/{radius,outline}.ts` as empty families registered in the aggregates.
   `packages/layout/src/paint.ts` plus `paint-{radius,shadow,gradient,transform,dash,scrollbar}.ts` stubs, one export line in
   `index.ts`. `packages/parity/src/paint-samples/` registry and stubs, with a filter hook through which a module suppresses
   base points it replaces (shadowed `outside` points, transformed boxes). `SAMPLE_RULES` appends `shadow` and `gradient`;
   `checkPixels` looks up a per-kind channel delta, and every existing kind maps to `GATE_CHANNEL_DELTA`.
5. **Translator and vectors:** a roots hunk in `generate.ts` making every exported function of `packages/layout/src/paint-*.ts`
   a root (RT-13 style), a harness suite hunk that runs `packages/layout/paint-vectors/<feature>/*.json`, and a
   `layout:paint-vectors` script that writes them from the TS reference.

**Proof that it preserves behaviour:** tests unchanged; profiles, captures, vectors, expected dumps and emitted bodies
byte-identical; native case sources equal except relaxed digest headers; and on both leases every device lane gives the same
state, the same compared counts and the **same failure list** as the BASE run.

**When it lands.** Serial on the emitter hotspot chain (T012 ruling 5, T044, RT-13): **after P5 (T007) and V1 Phase B (T009)
merge, and before V2a (T026) starts**. It is not concurrent with V2a, INL1a, SELD-R1 (T063), T040 or any package making
non-additive edits in native-support.ts, native-program.ts, uikit.ts, android-views.ts or expected-dump.ts. Placing it here
costs the checkpoint path (P5, V1B, V2a, INL1a, TXT1a, INL2, REPL, FORM-a) one M-sized package. In exchange, the whole paint
wave, P6a, REPL-a/FORM-a Phase B and the RT chain's paint prerequisites run beside V2a and INL1a instead of after them. Its
translator hunks are additive and may overlap ANIM-a2 (T062) under RT-13.

## 4. Order, parallelism and file ownership

```
now (read-only):   SC-RASTER ∥ SC-SCROLL     (Scouts; Chrome in /tmp; no repo writes, no lease)
after T007 + T009B: EMS                       (serial emitter window; both leases for its lane rerun)
after EMS:         V2a (T026) ∥ PNT1 ∥ PNT2 ∥ BG2 ∥ P6a   (+ SELD-R1, REPL/FORM Phase B per their specs)
after INL1a (T058): OVFL (A engine, then B native after PNT1)  ∥  P6b (serial emitter window; before INL2 or after, PM)
after OVFL:        POSX-f (A engine; B native after PNT1)  ∥  OVFL-S (after SC-SCROLL, T043)
after P6b:         P6c
conditional:       P6a-g, only if P5's final list has glyph-rule failures (serial emitter window)
```

| Package | Owns (write scope after EMS) | Runs alongside | Never concurrent with |
|---|---|---|---|
| EMS | the orchestrators, all registries, all stubs, translate hunks | P5 data merges, V1 (different files) | V2a, INL1a, SELD-R1, T040, any non-additive writer of the emit/lower orchestrators |
| PNT1 | `radius`, `shadow`, `effects`, `stacking`, `outline` modules in lower/emit/paint-values/paint-samples; `css/properties/{radius,shadow,effects,outline}.ts`, `css/shorthands/{radius,outline}.ts`; `paint-radius.ts`, `paint-shadow.ts`; `allowances/shadow.ts` | PNT2, BG2, P6a, V2a, INL1a, SELD-R1 | — (its files are its own) |
| PNT2 | `transform` modules; `css/properties/transform.ts`; `paint-transform.ts`; the capture.ts transform-twin registration hunk | PNT1, BG2, P6a, V2a, INL1a | V2b, OVFL B (both edit capture.ts) |
| BG2 | `gradient` and `background` modules; `css/properties/background-layers.ts`, `css/shorthands/background.ts`; `paint-gradient.ts`; `allowances/gradient.ts` | PNT1, PNT2, P6a, V2a, INL1a | any writer of css/shorthands/background.ts |
| P6a | `border` modules; `paint-dash.ts`; `parity/src/profile-rows.ts`; the project.ts outputs block; digest | the paint wave, V2a | TREE, MQ-a B, TXT1-C B on project.ts |
| OVFL | engine: input, validate, box, layout, new overflow.ts, ios-layout; `scroll` modules; `rt-hit.ts` hunk | P6b, TXT1a if disjoint | V2a, INL1a, INL2, REPL-a A, SIZE-ar, TXT1a on the same engine files; SELD-R2 on rt-hit.ts; V2b and PNT2 on capture.ts |
| POSX-f | engine: input, validate, position, layout, overflow.ts; `fixed` modules | OVFL-S | same engine-file rule as OVFL |
| OVFL-S | `scrollbar` modules, `css/properties/scrollbar.ts`, `paint-scrollbar.ts`, a `css/selectors.ts` hunk | POSX-f | any selectors.ts writer |
| P6b, P6c | text view accessibility and selection in native-support.ts | the paint wave | INL1a, TXT1a, INL2, V2b, each other |

Shared outputs are regenerated at merge and never hand-merged (profiles, lanes.json, north-star-check.json, WPT expectations,
generated engines, corpus json). `packages/parity/src/fixtures.ts` takes one import and one concatenation per group (T010
precedent). `package.json` takes one script line per package, unioned by the integrator (M2 precedent). Device steps hold the
platform lease; the PM serialises them.

## 5. Worker packages

`ENV` means the literal prefix `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`,
which starts **every** verify command; the JSON receipt spells it out. BASE is the recorded base sha.

**Common to every package:** no push, remote or install outside /tmp; notes only in the main checkout, never committed on the
branch; `design/` untouched; generated files regenerated, never hand-edited; nothing loosened; pinned tests may be retargeted
under the Throughput rule and listed; the RT-13 check (`git diff -U0 BASE -- <file>` shows only `+` lines in the named blocks)
for every RT-13 file touched.

**Common verify items C1-C14** (each is `ENV <command>`):
- **C1** `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`: green; BASE's `vitest list` is a subset of HEAD's;
  nothing `.skip`, `.only` or `.todo`; modified existing tests are only the package's listed pins.
- **C2** `pnpm run layout:subset`: 0 violations.
- **C3** `pnpm run native:gen && pnpm run native:swift && pnpm run native:kotlin && pnpm run native:planted -- --target swift && pnpm run native:planted -- --target kotlin`: every suite equal including paint vectors; plants caught.
- **C4** `pnpm run layout:paint-vectors && pnpm run layout:paint-vectors && git diff --exit-code packages/layout/paint-vectors`: byte-identical rerun.
- **C5** `pnpm run layout:vectors && pnpm run layout:dpr-vectors && git diff --diff-filter=MD --exit-code BASE -- packages/layout/vectors`.
- **C6** `pnpm run parity:capture && pnpm run parity:capture && pnpm run parity:dpr-capture && pnpm run parity:dpr-capture && git diff --exit-code packages/parity/expected packages/parity/expected-dpr && git diff --diff-filter=MD --exit-code BASE -- packages/parity/expected packages/parity/expected-dpr`; emitted files differ in header lines only.
- **C7** `pnpm run parity:report && pnpm run parity:dpr-report`: failed 0, at 1, 2, 3 and 2.625; chrome-dual strings equal for every new fixture.
- **C8** `pnpm run profile:rows && git diff BASE -- packages/dragon/src/profiles`: only the package's declared rows; no existing status changes except P6a's promotion rule.
- **C9** `pnpm run native:build -- --target ios && pnpm run native:build -- --target android && pnpm run native:encoders -- --target swift && pnpm run native:encoders -- --target kotlin`: derived counts; floor checks pass.
- **C10** (lease) `pnpm run layout:break-vectors && pnpm run parity:break-capture && pnpm run parity:pixel-capture && git diff --diff-filter=MD --exit-code BASE -- packages/layout/break-vectors packages/parity/expected-breaks packages/parity/expected-pixels`: new case files and appended manifest entries only.
- **C11** (lease) `pnpm run native:smoke -- --target ios && pnpm run native:smoke -- --target android && pnpm run parity:lanes -- --run-host --run-device && pnpm run parity:lanes -- --require-all`: no `not run` lane; every new case passes every lane on both platforms at every DPR; pre-existing cases keep BASE's verdicts and failure list; `--require-all` gives BASE's verdict.
- **C12** `pnpm run north-star:check`: the package's diagnostics fall; no per-target count rises.
- **C13** `pnpm run wpt:run -- --target web && pnpm run wpt:update-expectations -- --target web`: no pass becomes a fail; new fail entries carry a reason.
- **C14** `git diff --name-only BASE..HEAD && git remote -v`: inside allowed_files; no remote; plus the no-animator grep `grep -rnE "CABasicAnimation|CAKeyframeAnimation|UIView\.animate|UIViewPropertyAnimator|ValueAnimator|ObjectAnimator|ViewPropertyAnimator" packages/dragon/src/emit` prints nothing.

### 5.1 EMS: emitter split and paint seams
- **Base / wait-for:** master after T007 (P5) and T009 Phase B (V1) are merged. Not concurrent with T026 (V2a), T058 (INL1a),
  T063 (SELD-R1), T040, or any non-additive writer of the orchestrators. **Worktree** `/tmp/dragon-ems`, **branch** `ems-paint-seams`.
- **Objective:** §3 items 1-5, behaviour-preserving, with the runtime-callable writer rule of §1 applied to the moved
  background, border and clip writes.
- **allowed_files:**
  - `packages/dragon/src/lower/native-program.ts`
  - `packages/dragon/src/lower/paint/**` (new)
  - `packages/dragon/src/emit/uikit.ts`, `packages/dragon/src/emit/android-views.ts`, `packages/dragon/src/emit/expected-dump.ts`
  - `packages/dragon/src/emit/native-support.ts` (DragonBoxView, DragonClipView, DragonTree node creation, apply and readback, the support-file list, the plant list and new named registration points; not DragonTextView, `engineValue`/`VALUE_CLASSES`/`inputFunctions`, or the P5 points, run-file and capture code)
  - `packages/dragon/src/emit/paint/**` (new)
  - `packages/dragon/src/css/properties.ts` (imports and spreads of the new empty families only)
  - `packages/dragon/src/css/properties/{radius,shadow,effects,outline,transform,background-layers,scrollbar}.ts` (new, empty)
  - `packages/dragon/src/css/shorthands/index.ts` (registration of the new empty files only), `packages/dragon/src/css/shorthands/{radius,outline}.ts` (new, empty)
  - `packages/dragon/src/analysis/paint-values/**` (new), `packages/dragon/src/analysis/computed.ts` (one `computePaintValues` call after `computeLengths` only)
  - `packages/dragon/test/seams.test.ts` (append-only pins), `packages/dragon/test/paint-seams.test.ts` (new)
  - `packages/layout/src/paint.ts` and `packages/layout/src/paint-{radius,shadow,gradient,transform,dash,scrollbar}.ts` (new stubs), `packages/layout/src/index.ts` (one export line)
  - `packages/layout/paint-vectors/**` (new), `packages/layout/test/paint-seams.test.ts` (new)
  - `packages/translate/src/generate.ts` (RT-13 roots hunk), `packages/translate/harness/harness.ts` and `packages/translate/harness/host.ts` (RT-13 suite hunk), `packages/translate/test/paint-roots.test.ts` (new)
  - `packages/parity/src/paint-samples/**` (new), `packages/parity/src/pixel-reference.ts` (`casePoints` appends registry points after the existing ones and applies the filter hook; existing points and order unchanged), `packages/parity/src/samples.ts` (`SAMPLE_RULES` append only), `packages/parity/src/native-compare.ts` (per-kind channel delta lookup only), `packages/parity/src/allowances/{shadow,gradient}.ts` (new, equal to `GATE_CHANNEL_DELTA`), `packages/parity/src/lanes.ts` (RT-13 lane block: the literal scan covers `allowances/**`)
  - `packages/parity/src/cli/paint-vectors.ts` (new), `package.json` (one script line, `layout:paint-vectors`)
  - `packages/parity/test/samples.test.ts` (SAMPLE_RULES pin, append only), `packages/parity/test/paint-seams.test.ts` (new)
  - Regenerated only: `packages/layout/generated/**`, `packages/translate/corpus*.json`, `packages/parity/out/lanes.json`, `packages/parity/emitted/**` (headers)
- **verify:** C1; C2; C3; C4 (stubs give empty suites; the harness runs them); C5; C6 with **no** diff at all besides headers;
  C7; C8 byte-identical; C9 with native case sources equal to BASE except relaxed digest fields (the receipt lists them);
  `ENV pnpm vitest run packages/dragon/test/expected-dump.test.ts packages/dragon/test/native-backends.test.ts` green with
  expected dumps byte-identical to BASE; C11 on both leases where the lanes.json device records (states, compared counts,
  `failuresByKind`, `firstFailures`) equal the BASE run exactly (a node script diffing the two files, ignoring timing and run
  digests, exits 0); `ENV node --conditions=dragon-internal -e "<print casePoints for every case at 2, 3, 2.625>"` equal to BASE
  byte for byte; C14; the RT-13 check on generate.ts, harness.ts, host.ts and lanes.ts.
- **stop_if:** any expected dump, applied key, capture, vector, profile row or emitted body changes; any device lane verdict,
  count or failure differs from BASE; a translator core file (`emit-swift.ts`, `emit-kotlin.ts`, `lower.ts`, `ir.ts`,
  preludes) must change; the P5 points, run-file or capture code, DragonTextView or the encoder region must change; another
  package is in flight on a file in this list; a lease is not held; a file outside allowed_files is needed; verification fails
  twice.

### 5.2 PNT1: box decorations, stacking and opacity
- **Base / wait-for:** master after EMS; SC-RASTER receipt on the board (sigma rule, raster path, opacity quantisation, focus
  ring). Phase B needs both leases. **Worktree** `/tmp/dragon-pnt1`, **branch** `pnt1-box-decorations`.
- **Objective:**
  - **Compiler:** `border-radius` and its 8 longhands (px, %, elliptical `/`); `box-shadow` (lists, inset, spread, blur,
    colour, `none`); `opacity`; `z-index` (integer and `auto`); `outline`, `outline-{style,width,color,offset}` (none, solid,
    dashed, dotted, double, auto); `color-scheme` (normal, light, dark, `only`) with `usedColorScheme(el)`. Values are
    computed in `analysis/paint-values/*` (rem/em inside shadows and radii included). Refused with a located diagnostic:
    rounded dashed/dotted/double borders (named PNT1b), inset shadows on elements that are not boxes, and a UA or system
    colour that needs dark resolution with no consumer yet.
  - **Stacking (Appendix E):** stacking contexts (root, positioned with z-index not `auto`, fixed and sticky by value, opacity
    < 1, and `transform`/`will-change: transform|opacity` read by property name so they switch on when PNT2 lands), the paint
    order, and native hosting plus clip chains through EMS's hooks. Facts per node for `rt-hit.ts`: paint-order index,
    stacking-context id, host, clip chain, typed radii.
  - **Geometry (translated):** `paint-radius.ts` (resolution, clamp, inner and content radii, rrect paths as data) and
    `paint-shadow.ts` (shadow rects, spread, clip-out region, blur mask with basic operations only), with paint vectors and
    fault flags (`radiusUnclamped`, `innerRadiusNotReduced`, `spreadIgnored`, `sigmaHalfBlur`, `shadowNotClippedOut`).
  - **Native (Phase B):** rounded background, border (solid) and clip on both platforms; foreign-view clip incl. the
    WebView fallback of §1; outer shadows as companion views, inset shadows inside the inner rrect; alpha; hosting; outline
    at the SC's outline phase; the focus ring for `auto`; runtime writers for every write; `CATransaction.setDisableActions`
    on Dragon sublayers; raster plants `radius-offset-1`, `shadow-offset-1`, `order-swap`, `alpha-ignored`.
  - **Proof:** fixture groups `radius`, `shadow`, `opacity`, `stacking`, `outline`, `color-scheme` in ltr and rtl at DPR 1,
    2, 3 and 2.625, with rejects; the calibration set for the shadow allowance (§2); overlap fixtures including a z-index
    child escaping a clipping non-containing-block ancestor, a stacking context with opacity containing a z-index child, and
    the demo's `.library-button`-over-fixed pattern with fixed replaced by absolute until POSX-f.
- **allowed_files:**
  - `packages/dragon/src/css/properties/{radius,shadow,effects,outline}.ts`, `packages/dragon/src/css/shorthands/{radius,outline}.ts`
  - `packages/dragon/src/analysis/paint-values/{radius,shadow,effects,stacking,outline}.ts`
  - `packages/dragon/src/lower/paint/{radius,shadow,effects,stacking,outline}.ts`
  - `packages/dragon/src/emit/paint/{radius,shadow,effects,stacking,outline}.ts`
  - `packages/layout/src/paint-radius.ts`, `packages/layout/src/paint-shadow.ts`
  - `packages/layout/paint-vectors/{radius,shadow}/**` (new)
  - `packages/parity/src/paint-samples/{radius,shadow,effects,stacking,outline}.ts`
  - `packages/parity/src/allowances/shadow.ts` (the measured value only, after the PM records the ruling)
  - `packages/parity/src/fixture-groups/{radius,shadow,opacity,stacking,outline,color-scheme}.ts` (new), `packages/parity/src/fixtures.ts` (one import and one concatenation per group)
  - `packages/parity/fixtures/{radius,shadow,opacity,stacking,outline,color-scheme,reject-radius,reject-shadow,reject-outline,calib-shadow}-*.html` (new)
  - New files only under `packages/parity/expected/**`, `packages/parity/expected-dpr/**`, `packages/layout/vectors/**`, `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**`, `packages/parity/expected-pixels/**` (plus appended manifest entries)
  - `packages/dragon/test/paint-{radius,shadow,opacity,stacking,outline,color-scheme}.test.ts` (new), `packages/layout/test/paint-{radius,shadow}.test.ts` (new), `packages/parity/test/pnt1-*.test.ts` (new); derived-count pins in `packages/parity/test/*.test.ts` (literals only)
  - Regenerated only: `packages/dragon/src/profiles/*.ts`, `packages/parity/emitted/**`, `packages/parity/out/lanes.json`, `packages/layout/generated/**`, `packages/translate/corpus*.json`, `examples/music-player/dragon/north-star-check.json`, `packages/wpt/expectations/*.json`
- **verify:** C1-C9; `ENV pnpm vitest run packages/parity/test/pnt1-reference.test.ts`: the TS reference raster of every
  shadow fixture against the committed Chrome PNG at every shadow pixel, max per-channel difference printed and at most the
  `allowances/shadow.ts` value, and radius/background/border/outline pixels outside blur ramps at delta 0; C10; C11 including
  the four plants each failing device-pixels (or device-applied for `alpha-ignored`) on both platforms while frames and lines
  pass; the stacking readback (native child order and hosts) equal to the TS paint order on every case; the `rt-hit.ts`
  facts test (`packages/parity/test/pnt1-facts.test.ts`) showing each fact present for every node of the stacking fixtures;
  C12 (radius, shadow, opacity, z-index, outline and color-scheme diagnostics on the demo go to 0 per target); C13; C14.
- **stop_if:** Chrome disagrees with the reference beyond the rules of §2 after reading Blink 145 source (report case, DPR,
  point, both values); a shadow allowance above 2 would be needed; opacity cannot match without an allowance; the translator
  subset cannot express the geometry; a hosting need that EMS's hook cannot serve (report it; do not edit native-support.ts);
  a file outside allowed_files is needed; any existing output changes; a plant is not caught; the lease is not held;
  verification fails twice.

### 5.3 PNT2: transforms
- **Base / wait-for:** master after EMS. Not concurrent with V2b (T027) or OVFL Phase B on capture.ts. **Worktree**
  `/tmp/dragon-pnt2`, **branch** `pnt2-transforms`.
- **Objective:** `transform` (translate, translateX/Y, scale, scaleX/Y, rotate, and `matrix()` without skew; lengths and
  percentages), `transform-origin`, `will-change` (auto, transform, opacity: no-op paint, SC and containing-block trigger).
  Typed transform lists in the program as facts for `rt-hit.ts` and SOV; `paint-transform.ts` resolves functions at the box
  size (percentages, origin) without sin/cos, and the Swift/Kotlin glue composes the matrix with platform sin/cos and the
  90deg snap (RT-4). Native writers as in §1 with runtime entry points; the transform-twin case-kind capture registration and a
  content-quads capture; transformed sample points through the paint-samples filter hook; plants `transform-origin-ignored`,
  `translate-percent-of-parent`. Refused: skew, 3D, `perspective`, transformed descendants that would extend a scroll
  container's scrollable overflow (`DRAGON_UNPROVEN_CONTEXT`, named PNT2-o), fixed descendants of transformed elements (POSX-f2).
- **allowed_files:**
  - `packages/dragon/src/css/properties/transform.ts`, `packages/dragon/src/analysis/paint-values/transform.ts`
  - `packages/dragon/src/lower/paint/transform.ts`, `packages/dragon/src/emit/paint/transform.ts`
  - `packages/layout/src/paint-transform.ts`, `packages/layout/paint-vectors/transform/**` (new)
  - `packages/parity/src/paint-samples/transform.ts`
  - `packages/parity/src/capture.ts` (RT-13 case-kind capture registration hunk: the transform twin), `packages/parity/src/transform-capture.ts` (new: computed matrix and `DOM.getContentQuads`), `packages/parity/expected-quads/**` (new)
  - `packages/parity/src/fixture-groups/transforms.ts` (new), `packages/parity/src/fixtures.ts` (one import and one concatenation), `packages/parity/fixtures/{transform,reject-transform}-*.html` (new)
  - New files only under `packages/parity/expected/**`, `expected-dpr/**`, `packages/layout/vectors/**`, `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**`, `packages/parity/expected-pixels/**` (plus appended manifest entries)
  - `packages/dragon/test/paint-transform.test.ts`, `packages/layout/test/paint-transform.test.ts`, `packages/parity/test/pnt2-*.test.ts` (new); derived-count pins (literals only)
  - Regenerated only: as PNT1
- **verify:** C1-C9 (C6 must show existing captures byte-identical: the twin applies only to cases with a transform);
  `ENV pnpm vitest run packages/parity/test/pnt2-quads.test.ts`: engine rect × resolved matrix equals Chrome's content quads
  within `GATE_DEVICE_PX` at 1, 2, 3 and 2.625, and the untransformed twin boxes equal the engine exactly under the existing
  gates; C10; C11 including device-applied equality of the function list and origin, and both plants caught on both platforms;
  C12 (transform diagnostics on the demo go to 0); C13; C14; the RT-13 check on capture.ts.
- **stop_if:** Chrome's quads disagree beyond one device px after reading Blink's `TransformationMatrix`/`gfx::Transform`
  source; the twin changes any box (it must not, since `will-change` keeps containing blocks); Android decomposition cannot
  express an accepted list; an existing capture changes; a file outside allowed_files is needed; the lease is not held;
  verification fails twice.

### 5.4 BG2: gradients and multiple backgrounds
- **Base / wait-for:** master after EMS; SC-RASTER receipt (premultiplication, dither, raster path). **Worktree**
  `/tmp/dragon-bg2`, **branch** `bg2-gradients`.
- **Objective:** `background-image` with `linear-gradient`, `radial-gradient`, `repeating-linear-gradient` and
  `repeating-radial-gradient` (angles, sides and corners, circle/ellipse, extent keywords, `at <position>`, length and
  percentage stops, hard stops, `transparent`, legacy sRGB), multiple layers, `background-position`, `-size`, `-repeat`,
  `-origin`, `-clip`; the `background` shorthand expanded to layers (BG1's reset rules kept). `url()` images are refused
  naming REPL; `background-attachment: fixed`, conic gradients, interpolation-space syntax (`in oklab`) and gradient hints
  are refused naming BG2b. Dragon rasterisation per §1 with a runtime writer (SOV's track gradient, RT-11); plant
  `gradient-offset-1`; calibration fixtures for the gradient allowance.
- **allowed_files:**
  - `packages/dragon/src/css/properties/background-layers.ts`, `packages/dragon/src/css/shorthands/background.ts`
  - `packages/dragon/src/analysis/paint-values/gradient.ts`
  - `packages/dragon/src/lower/paint/{gradient,background}.ts`, `packages/dragon/src/emit/paint/{gradient,background}.ts`
  - `packages/layout/src/paint-gradient.ts`, `packages/layout/paint-vectors/gradient/**` (new)
  - `packages/parity/src/paint-samples/gradient.ts`, `packages/parity/src/allowances/gradient.ts` (the measured value only, after the PM ruling)
  - `packages/parity/src/fixture-groups/gradients.ts` (new), `packages/parity/src/fixtures.ts` (one import and one concatenation), `packages/parity/fixtures/{gradient,bg-layers,reject-gradient,calib-gradient}-*.html` (new)
  - New files only under the expected, vectors, break and pixel directories (as PNT1)
  - `packages/dragon/test/paint-gradient.test.ts`, `packages/dragon/test/background.test.ts` (refusal pins retargeted to still-refused values only), `packages/layout/test/paint-gradient.test.ts`, `packages/parity/test/bg2-*.test.ts` (new); derived-count pins (literals only)
  - Regenerated only: as PNT1
- **verify:** C1-C9; `ENV pnpm vitest run packages/parity/test/bg2-reference.test.ts`: the TS reference raster against the
  committed Chrome PNGs over every gradient pixel at 2, 3 and 2.625, max per-channel difference printed and at most the
  `allowances/gradient.ts` value, and 0 on solid-colour areas and hard-stop plateaus; C10; C11 with device gradient samples
  equal to the TS reference exactly and `gradient-offset-1` caught on both platforms; C12 (gradient and background
  diagnostics on the demo go to 0); C13; C14.
- **stop_if:** Chrome interpolates in a way Blink 145 source does not explain; a gradient allowance above 2 is needed; the
  dither pattern cannot be reproduced and the residual is above 2; `css/values.ts` would have to change (V2a owns it; parse the
  gradient in `paint-values/gradient.ts`); an existing capture or BG1 output changes; a file outside allowed_files is needed;
  the lease is not held; verification fails twice.

### 5.5 P6a: fix and promote (Dragon-owned paint fidelity, promotion, outputs, digest)
- **Base / wait-for:** master after EMS and after P5's final lanes.json is on master. **Worktree** `/tmp/dragon-p6a`,
  **branch** `p6a-fix-promote`.
- **Objective:**
  1. Fix every device-pixels failure in P5's final list that lies in Dragon-owned box paint on both platforms: dashed and
     dotted sides per Blink 145's `BoxBorderPainter` and `StrokeData` dash-gap selection and corner handling (ported into the
     translated `paint-dash.ts`), and the `one` border band. Glyph-rule failures, if any, go to P6a-g (below).
  2. **Promotion (oracle clause 4):** `profile-rows.ts` takes the committed lanes.json device records as input. An ios or
     android row is `exact` only if every proving case passes every device lane of that target at every DPR, and paint-aspect
     rows also need device-pixels. The 958 iOS rows are re-derived this way and android rows derived the same way; anything
     else is `caveat` or lower.
  3. **Rulings implemented:** `outputs.ios` / `outputs.android` become `ready` only with a committed lanes.json in which
     every lane of that target passes, none stale (a test asserts it); `docs/api.md` documents it. The native compilation
     digest includes that backend's emitter versions and `supportDigest` (relaxed-tier header change); the web digest is
     unchanged.
- **allowed_files:**
  - `packages/dragon/src/lower/paint/border.ts`, `packages/dragon/src/emit/paint/border.ts`
  - `packages/layout/src/paint-dash.ts`, `packages/layout/paint-vectors/dash/**` (new)
  - `packages/parity/src/profile-rows.ts`, `packages/parity/src/cli/profile-rows.ts` if it exists (input wiring only)
  - `packages/dragon/src/project.ts` (the native outputs block only), `packages/dragon/src/digest.ts` (native digest inputs only)
  - `docs/api.md` (outputs section)
  - `packages/parity/fixtures/{border-dash,border-dot}-*.html` (new), `packages/parity/src/fixture-groups/border-paint.ts` (new), `packages/parity/src/fixtures.ts` (one import and one concatenation)
  - New files only under the expected, vectors, break and pixel directories
  - `packages/parity/test/p6a-*.test.ts`, `packages/layout/test/paint-dash.test.ts`, `packages/dragon/test/outputs-ready.test.ts` (new); profile pins in existing tests retargeted to the derived rule (listed)
  - Regenerated only: as PNT1
- **verify:** C1-C9 (C8 shows exactly the promotions and demotions the rule implies, each listed with its cases); C10; C11
  where every P5 failure of kind `pixel` on border and edge rules is gone on both platforms and no new failure appears;
  `ENV pnpm run parity:lanes -- --require-all` exits 0 if P5 left no other failure, otherwise names only lanes outside P6a's
  scope with the reason; C13; C14.
- **stop_if:** a fix needs native-support.ts, uikit.ts, android-views.ts, native-program.ts or expected-dump.ts (report; the
  PM schedules P6a-g in the serial window); a failure is outside box paint and glyphs; Blink's dash algorithm cannot be
  reproduced within the lane rules; project.ts is in flight elsewhere (TREE, MQ-a B, TXT1-C B); the lease is not held; a file
  outside allowed_files is needed; verification fails twice.
- **P6a-g (conditional).** Only if P5's final list has `glyph`-rule failures: fix the glyph raster in DragonTextView (the
  rasteriser's origin and subpixel positioning against Chrome), in the serial emitter window (not concurrent with V2a, INL1a,
  TXT1a, INL2, V2b, P6b, P6c). Worktree `/tmp/dragon-p6a-g`, branch `p6a-g-glyph-raster`; allowed files: native-support.ts
  (DragonTextView draw only), new pixel data, `packages/parity/test/p6a-g-*.test.ts`, regenerated outputs; verify C1, C3, C9,
  C10, C11 (glyph failures gone, `glyph-offset-1` still caught), C14; stop_if as P6a.

### 5.6 P6b: accessibility parity for Dragon-drawn text
- **Base / wait-for:** master after INL1a (T058), in the serial emitter window (PM orders it against TXT1a and INL2; never
  concurrent with them, V2b or P6c). **Worktree** `/tmp/dragon-p6b`, **branch** `p6b-accessibility`.
- **Objective:** per-line accessibility for every Dragon text node: iOS `UIAccessibilityElement` per line
  (`accessibilityFrameInContainerSpace` = line rect, label = line text, `.staticText`), Android an `AccessibilityNodeProvider`
  with a virtual child per line; element roles from the tree (button, link, heading levels, image alt via REPL when merged);
  traversal in **DOM order** regardless of PNT1 hosting (iOS `accessibilityElements` on containers; Android
  `setAccessibilityTraversalBefore/After`). The oracle is Chrome's AX tree (CDP `Accessibility.getFullAXTree`, InlineTextBox
  bounds and names, StaticText and roles). A new lane `device-a11y` per target: iOS in-app traversal of the UIAccessibility
  container protocol; Android `uiautomator dump` plus the in-app provider, with equal coverage on both; frames within
  `GATE_DEVICE_PX`, names and roles equal. Plant `a11y-line-dropped`.
- **allowed_files:** `packages/dragon/src/emit/native-support.ts` (DragonTextView and DragonBoxView accessibility only, plus
  RT-13 registration points), `packages/dragon/src/emit/a11y/**` (new), `packages/parity/src/ax-capture.ts` (new),
  `packages/parity/src/cli/ax-capture.ts` (new), `packages/parity/src/device-a11y.ts` (new), `packages/parity/expected-ax/**`
  (new), RT-13 hunks in `packages/parity/src/native-host.ts`, `native-dump.ts` and `lanes.ts`, `packages/parity/test/a11y-*.test.ts`
  (new), `packages/parity/test/lanes.test.ts` (lane-list pin, append only), `package.json` (one script line), regenerated
  outputs as PNT1.
- **verify:** C1; `ENV pnpm run parity:ax-capture && pnpm run parity:ax-capture && git diff --exit-code packages/parity/expected-ax`;
  C3; C9; C11 with `device-a11y` passing on both platforms at every DPR and the plant caught; C14; the RT-13 check.
- **stop_if:** Chrome's AX tree is not deterministic run to run; a platform exposes a line differently and no API makes them
  equal (report both); INL1a's line model is not on master; a non-additive edit is needed in native-host.ts, native-dump.ts or
  lanes.ts; the lease is not held; a file outside allowed_files is needed; verification fails twice.

### 5.7 P6c: selection of Dragon-drawn text (editing ruled below)
- **Base / wait-for:** master after P6b; same serial window rule. **Worktree** `/tmp/dragon-p6c`, **branch** `p6c-selection`.
- **Objective:** selection with native feel. iOS: DragonTextView conforms to `UITextInput` in a non-editable mode (positions,
  `caretRect`, `selectionRects`, `closestPosition`, `characterRange(at:)` from the engine's glyph positions) with a
  `UITextInteraction(for: .nonEditable)`, which gives the system handles, loupe, menu and haptics. Android: Dragon hit-testing
  over the same data, handles drawn from the theme's `textSelectHandleLeft/Right` drawables, the loupe via
  `android.widget.Magnifier` (API 28), and copy via a floating `ActionMode.Callback2`. Selection spans nodes in DOM order.
  Proof: a `device-selection` lane driving long-press and drag on both platforms, compared with Chrome's
  `Selection`/`Range.getClientRects` for the same points (numbers), plus the clipboard content.
- **Editing ruling:** caret movement and text input have no subject until an editable element compiles (no text input or
  textarea is supported). They become **P6d**, starting with the first editable element (FORM text controls), reusing P6c's
  `UITextInput` and an Android `InputConnection`. This is recorded, not dropped. Keyboard traversal and keyboard-initiated
  `:focus-visible` (T047 RT-7) are **P6e**, after SELD-R2.
- **allowed_files:** `packages/dragon/src/emit/native-support.ts` (DragonTextView selection only, RT-13 points),
  `packages/dragon/src/emit/selection/**` (new), `packages/parity/src/selection-capture.ts` and `cli/selection-capture.ts`
  (new), `packages/parity/expected-selection/**` (new), RT-13 hunks in `native-host.ts`, `native-dump.ts`, `lanes.ts`,
  `packages/parity/test/selection-*.test.ts` (new), `packages/parity/test/lanes.test.ts` (append only), `package.json` (one
  script line), regenerated outputs as PNT1.
- **verify:** C1; `ENV pnpm run parity:selection-capture` twice byte-identical; C3; C9; C11 with `device-selection` passing on
  both platforms and a plant `selection-off-by-one` caught; C14; the RT-13 check.
- **stop_if:** as P6b; also if UIKit's text interaction needs an editable view to show handles (report; then Dragon draws the
  iOS handles like Android and records it).

### 5.8 OVFL: overflow auto/scroll, scroll containers, viewport propagation
- **Base / wait-for:** Phase A: master after INL1a (T058), not concurrent with any package in flight on `input.ts`,
  `validate.ts`, `box.ts`, `layout.ts`, `position.ts`, `lower/ios-layout.ts` or `analysis/context.ts` (V2a, INL1a, INL2,
  REPL-a A, SIZE-ar, TXT1a if it touches them). Phase B (same branch): after EMS, PNT1 and SELD-R1 (T063) are merged; not
  concurrent with SELD-R2 on `rt-hit.ts`, or V2b/PNT2 on capture.ts; SC-SCROLL receipt on the board. **Worktree**
  `/tmp/dragon-ovfl`, **branch** `ovfl-scroll`.
- **Objective:**
  - **Phase A (engine):** `overflow`, `overflow-x/y` values `auto`, `scroll`, `clip` (the pair rule already exists); scroll
    containers; scrollable overflow (§2.2: descendants' border boxes and their scrollable overflow, the end padding, fixed
    boxes excluded once POSX-f lands); zero gutter; viewport propagation (§3.3) from html, or from body when html is
    `visible`, with the demo's html/body/.App pattern as fixtures. Scroll metrics capture registration (`scrollWidth`,
    `scrollHeight`, `clientWidth`, `clientHeight`) under `chromeArgsAt` at every DPR; the zero-gutter claim is checked there.
    Engine faults `gutterReserved`, `overflowIgnoresPadding`, `propagationFromBody`.
  - **Phase B (native):** the scroll container (§1) through EMS's container factory, the viewport scroll container at the root,
    content size from the engine, a scroll-offset case kind (RT-13 hunks: set the offset on device; Chrome captures boxes,
    pixels and hit grids at the same offsets), a listener registry and a decoration hook in `emit/paint/scroll.ts` for POSX-f
    and OVFL-S, descendants re-hosted by PNT1 across a scroll container follow its offset, and `rt-hit.ts` extended with
    scroll offsets and the scroll-container clip, proven against `elementFromPoint` at offsets. Plants `content-size-short`,
    `offset-ignored-in-hit`.
- **allowed_files:**
  - Phase A: `packages/layout/src/{input,validate,box,layout}.ts` (overflow values and the call site), `packages/layout/src/overflow.ts` (new), `packages/dragon/src/lower/ios-layout.ts` (overflow values only), `packages/dragon/src/css/properties/overflow.ts`, `packages/dragon/src/css/shorthands/overflow.ts`, `packages/dragon/src/analysis/context.ts` (overflow contexts only), `packages/layout/test/overflow*.test.ts` (new), `packages/layout/src/block.ts` (EngineFaults append only)
  - `packages/parity/src/scroll-metrics.ts` (new), `packages/parity/expected-scroll/**` (new), RT-13 hunks in `packages/parity/src/capture.ts` and `chrome.ts`
  - Phase B: `packages/dragon/src/lower/paint/scroll.ts`, `packages/dragon/src/emit/paint/scroll.ts`, `packages/dragon/src/analysis/paint-values/scroll.ts`, `packages/parity/src/paint-samples/scroll.ts`, `packages/layout/src/rt-hit.ts` (scroll offsets and clip hunk), `packages/layout/rt-vectors/hit/**` (new files), `packages/parity/expected-hit/**` (new files), `packages/parity/src/hit-capture.ts` (scroll-offset registration hunk), RT-13 hunks in `packages/parity/src/native-host.ts`, `native-dump.ts`, `lanes.ts`
  - `packages/parity/src/fixture-groups/overflow.ts` (new), `packages/parity/src/fixtures.ts` (one import and one concatenation), `packages/parity/fixtures/{overflow,scroll,viewport-prop,reject-overflow}-*.html` (new)
  - New files only under the expected, vectors, break and pixel directories; `packages/parity/test/ovfl-*.test.ts`, `packages/dragon/test/overflow.test.ts` (new); refusal pins retargeted to still-refused values (listed); derived-count pins
  - Regenerated only: as PNT1
- **verify:** C1-C8; `ENV pnpm vitest run packages/parity/test/ovfl-metrics.test.ts`: engine scrollable overflow and client
  sizes equal Chrome's metrics on every overflow case at 1, 2, 3 and 2.625, and `clientWidth` equals the padding-box width on
  every `overflow: scroll` case (zero gutter); C9; C10 (including captures at offsets); C11 with device frames and pixels at
  scroll top and scroll end equal to Chrome, content size and offset readback equal to the engine, both plants caught;
  `ENV pnpm run parity:hit-capture && pnpm run parity:hit-report` at offsets: TS equals Chrome at every grid point, and the
  device hit test equals TS; C12 (`overflow` diagnostics on the demo go to 0); C13; C14; the RT-13 check.
- **stop_if:** Chrome reserves a gutter under `chromeArgsAt` (this contradicts decisions.md; report with numbers); Chrome's
  metrics disagree with the engine and Blink 145 source does not explain it; any existing vector or capture changes; an
  engine file is in flight elsewhere; a hosting case crosses a scroll container in a way PNT1's facts cannot express; a
  non-additive RT-13 edit is needed; the lease is not held; a file outside allowed_files is needed; verification fails twice.

### 5.9 POSX-f: position: fixed
- **Base / wait-for:** Phase A after OVFL merges (same engine-file rule); Phase B after PNT1 and OVFL are merged.
  **Worktree** `/tmp/dragon-posx`, **branch** `posx-fixed`.
- **Objective:** Phase A: `position: fixed` in the engine: the viewport containing block, the static position,
  exclusion from ancestors' scrollable overflow; refused with `DRAGON_UNPROVEN_CONTEXT` naming POSX-f2 when an ancestor has
  `transform`, `will-change: transform`, `filter` or `contain` (the demo has none). Phase B: the fixed module (hosted in the
  root stacking context by PNT1's facts; counter-offset by the viewport scroll via OVFL's listener registry, synchronously),
  the `rt-hit.ts` hunk that makes a fixed box's containing-block chain skip the viewport scroll, a runtime writer, plant
  `fixed-scrolls-with-content`. Fixtures include the demo pattern: a z-index 40 relative box inside a clipping scroll
  container over two fixed boxes (z 20, 30), at scroll top and scroll end.
- **allowed_files:** Phase A: `packages/layout/src/{input,validate,position,layout,overflow}.ts` (fixed only),
  `packages/dragon/src/lower/ios-layout.ts` (the position value only), `packages/dragon/src/css/properties/position.ts`,
  `packages/dragon/src/analysis/context.ts` (fixed contexts only), `packages/layout/test/fixed*.test.ts` (new),
  `packages/layout/src/block.ts` (EngineFaults append only). Phase B: `packages/dragon/src/lower/paint/fixed.ts`,
  `packages/dragon/src/emit/paint/fixed.ts`, `packages/parity/src/paint-samples/fixed.ts`, `packages/layout/src/rt-hit.ts`
  (fixed hunk), `packages/layout/rt-vectors/hit/**` (new files), `packages/parity/expected-hit/**` (new files). Both:
  `packages/parity/src/fixture-groups/fixed.ts` (new), `packages/parity/src/fixtures.ts` (one import and one concatenation),
  `packages/parity/fixtures/{fixed,reject-fixed}-*.html` (new), new files under the expected, vectors, break and pixel
  directories, `packages/parity/test/posx-*.test.ts` (new), derived-count pins, regenerated outputs as PNT1.
- **verify:** C1-C9; C10 at scroll offsets; C11 with the fixed boxes' device frames and pixels equal to Chrome at scroll top
  and scroll end on both platforms and the plant caught; the hit report at offsets (as OVFL); C12 (`position: fixed` diagnostics
  on the demo go to 0); C13; C14; the RT-13 check.
- **stop_if:** as OVFL; also if a fixed box's order against scrolling content cannot be expressed through PNT1's hosting.

### 5.10 OVFL-S: scrollbar styling
- **Base / wait-for:** master after OVFL and T043 (TREE's selector-drop warning mechanism); SC-SCROLL receipt on the board; not
  concurrent with another `css/selectors.ts` writer. **Worktree** `/tmp/dragon-ovfl-s`, **branch** `ovfl-scrollbars`.
- **Objective:** `scrollbar-color` and `scrollbar-width` (auto, thin, none) as computed values; `::-webkit-scrollbar`,
  `-track` and `-thumb` parsed and **ignored with a warning** wherever Chrome ignores them (either standard property not
  `auto` on the element), and refused naming OVFL-S2 where Chrome would honour them; at rest no thumb (the lane compares this
  as exact pixels at scroll top and scroll end); while scrolling, a Dragon-drawn thumb through OVFL's decoration hook with
  thickness and colour from SC-SCROLL and geometry from the css-scrollbars formula in the translated `paint-scrollbar.ts`
  (vectors); `scrollbar-width: none` hides the native indicator. If SC-SCROLL finds a deterministic Chrome capture of the
  overlay thumb, the thumb is compared as numbers (thumb rect) and pixels; otherwise its row is `caveat` with that reason.
- **allowed_files:** `packages/dragon/src/css/properties/scrollbar.ts`, `packages/dragon/src/css/selectors.ts` (the
  `::-webkit-scrollbar*` pseudo-elements and the Chrome ignore rule only), `packages/dragon/src/analysis/paint-values/scrollbar.ts`,
  `packages/dragon/src/lower/paint/scrollbar.ts`, `packages/dragon/src/emit/paint/scrollbar.ts`,
  `packages/layout/src/paint-scrollbar.ts`, `packages/layout/paint-vectors/scrollbar/**` (new),
  `packages/parity/src/paint-samples/scrollbar.ts`, `packages/parity/src/fixture-groups/scrollbars.ts` (new),
  `packages/parity/src/fixtures.ts` (one import and one concatenation), `packages/parity/fixtures/{scrollbar,reject-scrollbar}-*.html`
  (new), new files under the expected, vectors, break and pixel directories, `packages/dragon/test/scrollbar.test.ts`,
  `packages/parity/test/ovfls-*.test.ts` (new), `packages/dragon/test/selectors.test.ts` (refusal pins for scrollbar
  pseudo-elements retargeted, listed), regenerated outputs as PNT1.
- **verify:** C1-C9; C10; C11 (at-rest pixels exact at scroll top and end on both platforms; the thumb's device-applied
  geometry equals the reference); C12 (scrollbar selector and property diagnostics on the demo go to 0 errors; warnings list
  the ignored rules); C13; C14.
- **stop_if:** Chrome 145 honours a demo `::-webkit-scrollbar` rule (this contradicts the research; report it); a thumb
  appears at rest in the Chrome reference; selectors.ts is in flight elsewhere; a file outside allowed_files is needed; the
  lease is not held; verification fails twice.

## 6. Scout tasks to run now (read-only; Chrome in /tmp; no lease)

- **SC-RASTER:** under `chromeArgsAt(2 | 3 | 2.625)`:
  - the raster path (GPU or software) in the capture session;
  - the box-shadow sigma rule at Chrome 145's Blink revision, and pixel profiles for blur 0, 1, 4, 16, 40 and 70, spread ±,
    inset, rect against rrect and circle;
  - gradient interpolation (transparent stops), dithering and its pattern, hard stops, repeating radial;
  - opacity's effective quantisation at 0.28, 0.46, 0.5 and 0.9 over known colours, group against per-child;
  - dashed and dotted border geometry (`BoxBorderPainter`, `StrokeData`);
  - rrect edge coverage against an analytic reference;
  - the focus ring geometry (`FocusRingPainter`) in light and dark;
  - rotated solid and gradient interiors, composited and not.

  Output: numbers, source lines and the recommended algorithm per feature.
- **SC-SCROLL:** under the capture flags, with and without `--hide-scrollbars`:
  - the gutter on `overflow: scroll` and `auto` (clientWidth);
  - the Chrome 121+ ignore rule for `::-webkit-scrollbar`;
  - whether `scrollbar-color` and `scrollbar-width: thin` change the overlay thumb, and its thickness and colours;
  - whether any thumb paints at rest;
  - a deterministic way to capture the thumb mid-scroll;
  - the default iOS and Android indicator behaviour.

## 7. Evidence and missing evidence

**Evidence:**
- /tmp/dragon-p5 samples.ts (rules, inset 2) and native-compare.ts checkPixels (colour delta 0, edge coverage integral within
  1 device px);
- lanes.json first failures (border and edge on dotted/dashed and `one`, iOS and Android);
- master native-program.ts (one union and vocabulary), uikit.ts and android-views.ts (one switch each), native-support.ts
  (DragonBoxView draw, the Kotlin `dragonDrawBorders` phase-0 dashes);
- capture.ts (`getBoundingClientRect`), chrome.ts (`--hide-scrollbars`), generate.ts (readdir plus roots);
- styles.css lines 25-31, 64, 96-127, 148-238, 283-306, 363-377, 469-495.

**Missing evidence:**
- Blink 145 source was not opened in this review. The sigma formula, dash selection, dither and focus-ring details are cited
  from memory as hypotheses, and SC-RASTER confirms them before PNT1, BG2 and P6a use them.
- P5's final failure list is not final (T007 in flight).
- Android `WebView` honouring a parent `clipPath` is unverified; PNT1 carries a fallback.
- The `UIViewGroupOpacity` default in DragonHost's Info.plist is not checked.
- Chrome's overlay-thumb behaviour under `scrollbar-color` is unmeasured (SC-SCROLL).

## 8. Required board updates (PM)

1. Record T046 done with this note; record rulings §1 (per feature), §2 (the proof order and the allowance rule), §3 (EMS
   placement) and §5.7 (editing to P6d, keyboard focus to P6e) in decisions.md as PM rulings from this research.
2. Add Scouts SC-RASTER and SC-SCROLL now. Add Workers EMS, PNT1, PNT2, BG2, P6a, P6b, P6c, OVFL, POSX-f and OVFL-S with the
   packages above, plus P6a-g as conditional. Queue on T019: PNT1b (rounded dashed/dotted/double, groove/ridge/inset/outset,
   `visibility`), PNT2-m (skew, 3D, perspective), PNT2-o (transformed scrollable overflow), BG2b (conic, hints, colour
   spaces, `attachment: fixed`, `url()` after REPL), POSX-f2 (transformed or contained ancestors), OVFL-S2 (honoured
   `::-webkit-scrollbar`), sticky, scroll snap and overscroll, P6d, P6e.
3. T026 (V2a) gains the constraint "not while EMS is in flight"; T063 (SELD-R1) and T040 gain "not concurrent with EMS".
   T051 and T052 Phase B use EMS's `emit/paint/{image,foreign-view,control}.ts` and `lower/paint/` stubs.
4. T064 (SELD-R2) reads PNT1/PNT2 facts as specified in §1; T066 (SOV) writes through BG2's gradient writer and PNT2's
   transform writer; T065 (ANIM-b) drives opacity and transform per frame through the runtime writers.
5. INL1b (T060) takes radius and outline on inline fragments after PNT1.
6. T999 constraints: reject if any paint row is `exact` under an allowance; if any allowance is above 2 or unrecorded in
   decisions.md; if a paint plant is not caught on either platform; if `device-a11y` is missing or failing on either
   platform; if `outputs.<target>` is `ready` without that target's passing lanes.
7. Start the two-week report-only clock per device lane when P6a merges, and record the date.

## Amendment T075J (Judge, 2026-10-01), PM accepted: promotion versus #49

This supersedes §5.5 item 2: profile-rows.ts does not take lanes.json as a status input.

**The cycle is real.** Profile text, statuses included, enters the compile digest (project.ts digestInput.profiles). The digest is embedded in every generated case file, and those files make up the app stamp. So a status promoted from device lanes moves the stamp and makes the same lanes stale. p6a's history shows it: bdf590be2, then ada25d3cd, then host-only fallbacks.

**Ruling.**
- Profile statuses follow #49's iOS rule on both targets (layout from linux-dragon-layout, paint capped at caveat), and PROFILE_REVISION stays m1-s5.
- Device gating lives only in profiles/native-lanes.ts (NATIVE_LANES). It feeds outputs.ready and is never in the digest or the host sources.
- A ready output requires every lane to pass, so every row in a ready output is device-proven. That is oracle clause 4 with no churn.
- compile.test.ts stays as on master (width exact on iOS).
- New pins:
  - deriveRows does not read lanes;
  - native-lanes.ts equals nativeLanesSource over the committed lanes (staleLanes plus staleEvidence);
  - ready implies device-proven for every row.
- Split order: p6a-dash is rebuilt on master first (~103 KB, no profile, project or native-lanes changes), then p6a-promote is stacked on it (~52 KB: the outputs gate, the native digest and api.md).
- Cycle proof under the lease: run the device lanes, then profile:rows; the profiles must be unchanged and staleEvidence must stay empty.
