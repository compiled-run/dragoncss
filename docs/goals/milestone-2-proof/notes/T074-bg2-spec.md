# T074 BG2: gradients, background longhands, multiple layers and background-image url() (Judge spec, binding)

Judge note, 2026-10-03. Read-only review of the repo; this file is the only thing written. Under the Decision Rule every open
question below is settled by research and handed to the PM as a ruling to record in docs/decisions.md and on the board.

**Read:** AGENTS.md; goal.md (milestone-2-proof) and milestone-1 design principles; coverage-roadmap.md (BG2 row, §3 paint
paragraph, §4 hotspots); decisions.md ("Paint (PM, T046 research)", "Images, web views and form controls", "Box-shadow device
pixels: no allowance", "Porting Chrome's algorithms", "Adding engine fields and CSS longhands"); docs/ports.md; state.yaml T074
(constraints from T069 and T085), T066 SOV, T097 YUI-1; notes T046 §1, §2, §5.4 (this spec replaces §5.4), T069 §3, T085,
T074-bg2.md (the earlier Worker's notes), T051 (REPL-a); PRs #19 (Skia dither reference), #57/#62 (EMS-a/b), #69/#72 (REPL-a
2-3), #70/#73/#74 (PNT2), #80-#87 (PNT1, especially #82's backdrop compositing); examples/music-player/styles.css and
dragon/north-star-check.json; the `bg2` branch in /tmp/dragon-bg2 (5b70b37313).

**Measured for this spec (Chrome 145.0.7632.6 through Playwright 1.58.2, the repo's pinned build; C probes on the capture host,
darwin-arm64; scripts in /tmp/t074probe):**
- **M1. The capture host's libm is not correctly rounded.**
  - tanf ≠ (float)tan((double)x) on 834,665 of the 1,070,141,402 positive floats below π/2.
  - Through Blink's own chain (fmodf, then 90 − a, then `Deg2rad` in float), tanf differs on 2,120 of the 36,000 angles at
    0.01° steps. Among whole degrees it differs at 5, 35, 145, 175, 189, 200, 250, 254, 260, 265, 299, 306, 319, 323, 340, 352
    and 354; 110° (the demo's) agrees.
  - sinf/cosf of `SkDegreesToRadians(a)` differ on 1,948 of the 72,001 angles at 0.01° steps between −360° and 360°.
  - atan2f differs on 179,461 of 2,000,000 grid pairs.
- **M2. A paused transform animation gets its own composited layer.** `animation: spin 20s linear infinite;
  animation-play-state: paused` on a 120 px box at DPR 2 gives CDP LayerTree a 240×240 layer whose compositing reason is "Has an
  active accelerated transform animation or transition". So the demo's `.record` gradients are rasterised in their own layer,
  whose cc tiles start at the element and not at the page.

## 0. State of the existing `bg2` branch, and what to reuse

`/tmp/dragon-bg2`, branch `bg2` at 5b70b37313, not pushed (`origin/bg2` is cba6ebc380). It is stacked on the **pre-split**
`ems-paint-seams` (fce79bfe) and on origin/master 59d9609c (2026-09-29). It has 14 non-merge commits of its own: 6 source
commits and 8 regen or lanes commits. Its device run reported 444 cases per DPR. Every lane passed except device-pixels, whose
135 (iOS) and 182 (Android) failures matched its base, with no failure in a gradient case. Master has since moved:
- EMS was re-landed as #57 (EMS-a) and #62 (EMS-b), with different seams;
- PR #19 put `paint-dither.ts` on master;
- PNT1 (#80-#87) rewrote `emit/paint/background.ts`, the registries, `DragonBoxShape` and the paint stages.

So the branch cannot be merged or rebased as it stands. Its source is reusable:

| Reuse | File (bg2) | Verdict |
|---|---|---|
| Raster reference | `packages/layout/src/paint-gradient.ts` (1,358 lines) | **Reuse,** except `tanF32` and `atan2F32` (lines 130-225), which are ported from a disassembly of Apple's libsystem_m. Those are removed under R3. Keep the parts it builds on: Blink's gradient geometry; the single-tile draw rule; Skia's SkMatrix concat and invert, `pts_to_unit` and the highp stages; `fma64`, `sqrtF64` and `hypotF32` (black-box measured); the reuse of `paint-dither.ts`. |
| Compiler | `css/properties/background-layers.ts`, `css/shorthands/background.ts` (+301), `analysis/paint-values/gradient.ts` (636), the one-hook `css/stylesheet.ts` change, the `computed-checks.ts` call, `scripts/gen-css-grammar.ts` subset line | **Reuse.** Retarget the refusals listed in §1. |
| Native | `lower/paint/gradient.ts`, `emit/paint/gradient.ts` (253), registry lines, `DragonBoxShape.lu` | **Re-port** onto PNT1's seams: the rounded path, the backdrop fact, and the shape. |
| Proof | `paint-samples/gradient.ts`, `bg2-reference.test.ts`, `bg2-samples.test.ts`, the six fixtures and seven rejects, `calib-gradient-ramps.html`, `scripts/check-bg2-additive.ts`, the harness gradient suite, `cli/paint-vectors.ts` gradient inputs | **Reuse.** The device-run and native-devices plant hunks are re-done on PNT1's versions. |
| Notes | notes/T074-bg2.md | Keep. §1 is the measurement record; its §2 rulings are superseded where this spec differs (R3, R4, R6, R7, R8). |

Method: create a fresh branch (§4). Cherry-pick the **source** commits 8552ac5a89, d2189749ec, a54679d491, cba6ebc380,
1abc81efde and 4d5b758fd1, resolving conflicts toward PNT1's seams. Skip every regen, lanes and merge commit, then `pnpm regen`.

## 1. Scope

**Supported (web, iOS, Android), BG2-a:**
- `background-image`, one or more layers of:
  - `linear-gradient()`: angles in deg, grad, rad or turn on the 0.01° grid of R3; `to <side>`;
  - `radial-gradient()`: circle and ellipse, the four extent keywords, explicit px and % sizes, `at <position>`;
  - `repeating-linear-gradient()` and `repeating-radial-gradient()`;
  - stops in px or %, two-position stops, hard stops, `transparent`, translucent and legacy sRGB colours, `currentcolor`;
  - `none`.
- The layer longhands as real longhands, each a comma list:
  - `background-size`: auto, px, %, cover, contain;
  - `background-position-x` and `-y`: keywords, px, %, and edge offsets per R7;
  - `background-repeat`: repeat, no-repeat, repeat-x and repeat-y, under R8's single-tile rule;
  - `background-origin` and `background-clip`: border-box, padding-box and content-box;
  - `background-attachment: scroll`.
- The `background` and `background-position` shorthands expand into all of these. BG1's reset rules are kept.

**Later pieces of this package (§5):**
- BG2-c: `conic-gradient()` and `repeating-conic-gradient()`, with `from` and `at`.
- BG2-u: `url()` PNG images with REPL-a's assets.
- BG2-t: real tiling, plus `space` and `round`.
- BG2-x: gradients inside transformed subtrees (the demo's `.record-shine`).

**Refused.** Each refusal is located at the declaration and the element. Unless a target is named, the refusal applies to every
target. Each diagnostic names the package that lifts it:

| Value | Code | Message names | Why |
|---|---|---|---|
| angle off the 0.01° grid after unit conversion (e.g. `1rad`) | `DRAGON_UNSUPPORTED_VALUE` (ios, android) | BG2b; fix: "round the angle to 0.01deg" | R3 |
| `to <corner>` | `DRAGON_UNSUPPORTED_VALUE` (ios, android) | BG2b | R3: the slope needs atan2f and tanf of the box size at run time |
| colour hints, `in <colorspace>` interpolation | `DRAGON_UNSUPPORTED_VALUE` | BG2b (after COL4, T119) | Blink turns hints into stops with double `pow`/`log`; spaces need COL4 |
| `background-attachment: fixed \| local`, `image-set()`, `cross-fade()`, `element()`, SVG images | `DRAGON_UNSUPPORTED_VALUE` | BG2b | no model yet |
| `url()` before BG2-u; then JPEG (REPL-j), and remote or unmapped (`DRAGON_REMOTE_IMAGE`) | as REPL-a | BG2-u / REPL-j | R10 |
| a layer that really tiles; `space`, `round` (until BG2-t) | `DRAGON_UNSUPPORTED_VALUE` (ios, android) | BG2-t | R8 |
| a translucent stack over a backdrop Dragon does not know | `DRAGON_UNSUPPORTED_VALUE` (ios, android) | BG2c | R6 |
| a gradient inside a subtree whose transform is not the identity (until BG2-x) | `DRAGON_UNPROVEN_CONTEXT` (ios, android) | BG2-x | R13 |
| a gradient in a composited layer Dragon does not model | `DRAGON_UNPROVEN_CONTEXT` (ios, android) | BG2c | R4 |
| viewport units or `calc()` in layer geometry or stops | `DRAGON_UNSUPPORTED_VALUE` | CALC-p | as PNT1 refuses them in radius and shadow (reject-radius-viewport, reject-radius-calc) |
| gradients on `html` or `body` (canvas propagation); `background-clip: text`; inline-level boxes | `DRAGON_UNSUPPORTED_VALUE` | BG2c | canvas and inline painting are not modelled |
| `background-blend-mode` | stays `DRAGON_UNSUPPORTED_PROPERTY` | — | not in BG2 |

## 2. Rulings

- **R1. Dragon rasterises; native gradient APIs are never used.** This is T046 §1, unchanged.
  - CAGradientLayer and Android shaders interpolate unpremultiplied. Chrome interpolates premultiplied (T069 §3 measured
    [255,128,128] at 50% of red→transparent).
  - Chrome always dithers (`platform/graphics/gradient.cc:362-363`), with Skia's 8×8 ordered dither
    (`SkRasterPipeline_opts.h:2085-2117`, T085).
  - The translated `paint-gradient.ts` runs on device, so iOS and Android are bit-identical to the TS reference.
- **R2. The allowance stays 0, and gradient rows can be `exact`.**
  - PR #19 proved the dither reference pixel-exact.
  - bg2 measured 5,340,239 committed pixels, 0 differing, at DPR 2, 3 and 2.625 (notes/T074-bg2.md §1).
  - So `allowances/gradient.ts` stays `GATE_CHANNEL_DELTA`. No gradient row is caveat for an allowance (decisions.md "Paint",
    allowance clause).
  - A residual of 1 or more on a committed case is a **stop** and a new Judge review. It is never an allowance.
- **R3. Libm results enter as measured data; the device never calls tan, sin, cos or atan2 for gradients.**
  - **Where Blink calls libm:**
    - `EndPointsFromAngle` calls `tan(float)` (`core/css/css_gradient_value.cc:1291`, Apple/Google BSD header);
    - magic corners call `atan2(float, float)` (`:1395`);
    - conic rotation calls `SkMatrix::preRotate` → `setRotate` → `SkScalarSinSnapToZero` / `CosSnapToZero` → sinf/cosf
      (`src/core/SkMatrix.cpp:456-458` at Skia 2ab8add5; `platform/graphics/gradient.cc:512-517`).
  - M1 shows these differ from correctly rounded results on real angles, and bg2's `tanCorrectlyRounded` plant changed Chrome
    pixels on 2 of 54 probed angle boxes.
  - **bg2's `tanF32` and `atan2F32` do not land.** They reproduce Apple's polynomial and constants from a disassembly of
    libsystem_m. That is neither a Chrome file at the tag with a BSD header (decisions.md "Porting Chrome's algorithms";
    ports.md) nor a measurement, and the macOS licence forbids disassembly. Instead:
    1. **The probe.** `scripts/capture-libm.ts` (new; `pnpm run libm:capture`) compiles a small C probe with the host `cc`,
       on the capture host (darwin-arm64, the same machine class as the Chrome captures).
       - For every angle a = k/100 degrees, k in [0, 36000), it records the tanf input through Blink's exact float chain and
         the host's tanf output.
       - For every a = k/100 in [−360, 360], it records the sinf and cosf inputs and outputs through Skia's
         `SkDegreesToRadians`.
       - It writes only the entries where the host result differs from `Math.fround` of V8's `Math.tan`, `Math.sin` or
         `Math.cos` (fdlibm ports, deterministic on every host) to `packages/dragon/src/paint-data/libm-darwin-arm64.generated.ts`.
         That is about 2,100 tan and 1,950 sin/cos entries.
       - The header records the host, the macOS build and the libsystem_m UUID.
       - It is a black-box observation of the capture platform, of the same kind as a Chrome capture.
    2. **The compiler** computes each layer's slope (and, for conic gradients, the sin/cos pair) at build time: the table entry,
       or else fround(fdlibm). It writes the float bits into the layer write. `paint-gradient.ts` takes the slope as an input.
       The device gets constants.
    3. **Angles off the grid** are refused natively. `to <corner>` is refused natively (its inputs are run-time box sizes),
       named BG2b. Web accepts both: Chrome draws web output itself, and chrome-dual proves the computed strings.
    4. `libm:capture -- --check` re-runs the probe and fails on any difference. It is a verify step on the capture host and a
       `pnpm regen` step (cached on its inputs).
- **R4. The dither and shader origin is the cc tile of the box's composited layer (M2, T109).**
  - bg2 used the box's page position. That is right only inside the root scroller's layer.
  - The compiler gives each gradient box a layer:
    - the root scroller (the default);
    - its own border box when the element, or an ancestor in the same layer, has a transform animation or transition (when
      ANIM accepts them) or `will-change: transform` (PNT2 accepts it).
  - Any other compositing reason refuses the gradient natively (BG2c): fixed position, scroll containers (until OVFL), iframes,
    3D, video.
  - The layer and its origin are a program fact. `paint-gradient.ts` takes the origin as an input.
  - A new host test, `bg2-layers.test.ts`, opens every gradient fixture in Chrome at DPR 2. Through CDP `LayerTree` and
    `compositingReasons`, it checks that each gradient box's layer and origin are the ones the compiler predicted.
  - The pixel lanes then prove it.
- **R5. Blink draws one tile in one of two ways** (bg2 §1, kept).
  - `OptimizeToSingleTileDraw` decides, at the unsnapped dest size, or at the snapped size for a bottom border-box layer on
    `PaintFastBottomLayer` (`core/paint/box_painter_base.cc`, `background_image_geometry.cc`, both Chromium BSD).
  - Either the gradient shader draws on the layer's cc tile, or the picture shader rasters its own tile image and draws it with
    an image shader, srcover and no dither (`platform/graphics/gradient_generated_image.cc`, `generated_image.cc`).
  - Both models are ported, with the plant `singleTileModelSwapped`.
- **R6. A box's whole stack is one Dragon bitmap. Translucency is allowed only over a backdrop Dragon knows.**
  - Dragon composites the colour and every gradient layer bottom first, with Skia's srcover, into one premultiplied device-pixel
    bitmap, drawn in the background-layers stage. A pixel equals Chrome's whatever lies behind only where the stack is opaque.
  - BG2-a therefore accepts a stack that is translucent somewhere only when its backdrop is known:
    - (a) the stack is opaque wherever a layer paints: an opaque colour whose clip holds every layer's clip, or an opaque
      layer repeating on both axes (bg2's rule);
    - (b) the box isolates its own paint: opacity < 1 on the box itself. Chrome's effect node raster is a saveLayer over
      transparent, so Dragon composites over transparent and PNT1's group alpha does the rest;
    - (c) PNT1's backdrop fact certifies a single solid colour behind every painted pixel. This is the fact the shadow
      module uses ("the background writer tells the shadows whose backdrop it is", PR #82). Dragon then composites over that
      colour in the reference and draws the result opaque.
  - Everything else is refused (BG2c).
  - Evidence: bg2 4d5b758 (found by the device run); decisions.md "Box-shadow device pixels" (the device must composite the
    way Chrome does, with no allowance).
- **R7. Units and positions.**
  - px and %. em and rem fold to px at compile time, following PNT1's precedent (`analysis/paint-values/radius.ts`
    `computeComponent`; bg2 had refused em).
  - Viewport units and calc() are refused, as PNT1 refuses them.
  - **Edge offsets** (`right 10px`, `bottom 20%`) are accepted. Chrome computes them to the string `calc(100% - 10px)`, and
    chrome-dual proves the string. bg2 refused them.
    - **PM amendment (2026-10-05, review of #192):** the string is only how getComputedStyle writes the value. For paint, Chrome
      keeps the right or bottom origin and paints `available − offset` in LayoutUnits, with the offset truncated to a LayoutUnit
      first (background_image_geometry.cc ResolveXPosition/ResolveYPosition). The engine ports that (paint-gradient.ts
      `luPosition`), not `100% − x` evaluated in float. The two differ by 1 LU, and that can move a snapped layer by a device px.
  - **content-box** origin and clip on a box with padding are accepted. `DragonBoxShape` gains the padding widths (one named
    hunk at the EMS shape registration point). bg2 refused these because the shape had no padding.
  - Negative stop positions are accepted: Blink normalises them in AddStops, and bg2's port covers that.
- **R8. Repeat.** BG2-a accepts a repeating axis only when one tile covers the clip (bg2's rule; the device flags anything else
  as not modelled).
  - Real tiling goes through the picture shader with resampling for fractional tiles: Blink `GeneratedImage::DrawPattern` → cc
    paint-record shader → Skia image shader sampling.
  - That, plus `space` and `round`, is BG2-t. BG2-t must be exact (Skia's highp sampling stages are Skia BSD and portable).
    If it cannot be exact, it stops and the refusal stays.
- **R9. Conic gradients (BG2-c)** port Skia's `SkSweepGradient` (`appendGradientStages`: `xy_to_unit_angle`, then the t0/t1
  scale and bias matrix) and Blink's `ConicGradient::CreateShader` rotation (`rotation − 90` through `preRotate`), with the sin/cos
  pair from R3. `xy_to_unit_angle` is Skia's own polynomial, so no libm is involved.
- **R10. `url()` images (BG2-u)** reuse REPL-a without new rules:
  - build-time PNG read and decode (`images/compile.ts`, `images/inflate.ts`), the sha256 in the digest, base64 embedding, and
    ImageIO / BitmapFactory decode on the device;
  - JPEG refused (REPL-j); remote or unmapped refused (`DRAGON_REMOTE_IMAGE`);
  - natural size and ratio are build-time constants for `auto`, `cover` and `contain`.
  - Dragon draws each image layer natively, in layer order, between the gradient bitmap segments of the stack, clipped to the
    layer's clip.
  - Pixels are compared only at REPL-a R8 `image-flat` points, at delta 0 with no allowance. Gradient points above
    non-flat image pixels are dropped.
  - Plant `bg-image-offset-1`.
- **R11. Bitmap upload without conversion.**
  - **Android:** `Bitmap.createBitmap(w, h, ARGB_8888)` plus `copyPixelsFromBuffer` of the premultiplied RGBA bytes. The
    Android docs say this "is not changed in any way (unlike setPixels(), which converts from unpremultiplied 32bit…)".
    `setPixels`, `createBitmap(int[])` and `Color` ints are never used for raster data.
  - **iOS:** a `CGBitmapContext` / `CGImage` with `premultipliedLast` in sRGB, the same colour space as PNT1's Dragon paint.
  - Both draw 1:1 at integer device pixels with no filtering: CGContext interpolationQuality `.none`, and a null Paint.
  - Plant `gradient-unpremultiplied-upload`: a device that uploads through setPixels fails device-pixels.
- **R12. Runtime writers** (RT-1, RT-2, RT-11). The gradient write is a public writer. Static values use the same writer.
  - The after-layout hook re-rasterises when the device size, layer origin phase (mod 8, plus the tile index) or parameters
    change, cached on those keys.
  - SOV's track gradient (T066) writes through it.
  - No platform animators (the C14 grep).
- **R13. Transformed subtrees** (BG2-x, after PNT2 is on master).
  - Chrome rasterises a gradient under a transform with the CTM in the shader matrix. A native transform of a bitmap Dragon has
    already rasterised resamples it, so mapped interior points (PNT2 #74's rule) cannot be exact.
  - BG2-a refuses any gradient whose layer-to-device matrix is not the identity. BG2-x rasterises such layers in device space
    from the full matrix and hosts the bitmap untransformed. It covers the demo's `.record-shine`, which has opacity 0.46 and
    `translateX(-18%) rotate(8deg)`, over transparent per R6(b).
  - BG2-x stops if PNT2's display transform cannot be bypassed for the stage without breaking hit-testing facts.
- **R14. Web output** emits the layer longhands unchanged. chrome-dual compares the computed strings of the authored and
  emitted CSS for every new longhand.

## 3. How it reaches each target

- **Compiler (build time, TypeScript).**
  - Parse, compute and refuse in `analysis/paint-values/gradient.ts`. Gradients are parsed there, not in `css/values.ts`.
  - The single-tile, backdrop, layer and transform decisions are made per element per reachable state.
  - R3 constants are baked in.
  - The lowered `gradient` write carries the typed layers, the slope and sin/cos bits, the layer origin fact and the backdrop
    colour. Nothing on the device parses CSS.
- **iOS (UIKit/CoreAnimation).**
  - `DragonPaintGradient.swift`. The background-layers stage (EMS registration point) asks the translated `planBackground` /
    `backgroundRow` for rows into a cached CGImage.
  - The image is clipped by the radius module's rounded border-box or padding-box path, per `background-clip`.
  - Opacity uses PNT1's native group alpha.
  - Sublayer property writes use `CATransaction.setDisableActions(true)`.
- **Android (View/Canvas, minSdk 31).** `DragonPaintGradient.kt` does the same through `copyPixelsFromBuffer`, with
  `canvas.clipPath` of the radius module's path (API 31 has clipPath; no Outline clipping is needed).
- **Web.** The compiled CSS longhands.

## 4. Base, dependencies and order

- **Base: `origin/pnt1-foreground-v3` at 518bc92d22** (#87, the top of the PNT1 stack). The PR base is
  `review/pnt1-foreground-v3`, which the PM creates as a copy of #87's head, as for the other stacks.
  - This is the earliest base that forces no restack later. BG2 needs PNT1's rounded path (both demo gradients are on rounded
    boxes: `.record` has 50%, `.track` has 1rem), its backdrop fact (R6c) and its opacity group (R6b).
  - Master would conflict with PNT1 in `emit/paint/background.ts`, `native-support.ts` (DragonBoxShape), the lower and emit
    registries, `harness.ts`, `device-run.ts`, `native-devices.ts`, `samples.ts`, `pixel-reference.ts`, `stylesheet.ts`,
    `computed-checks.ts` and the seams, s4b, grid and css-escapes pins.
  - When PNT1's review rounds push fixes, merge `origin/pnt1-foreground-v3` into BG2 (a merge, not a restack).
- **Landing.** BG2-a1..a3 land as one train right after the PNT1 train. The queue is train 1 → REPL-a → FORM-a → INL1a → PNT2
  → PNT1 → **BG2-a**. BG2-a does not need PNT2, REPL-a, FORM-a or INL1a code. Their merges reach it in the train.
- **BG2-c** stacks on BG2-a3, and lands in the BG2-a train or the next one.
- **BG2-u** starts once REPL-a (#69 and #72) is on master, which it will be before PNT1 lands: branch from the BG2 tip and merge
  `origin/master`.
- **BG2-t** stacks on BG2-c, or on BG2-a3 if BG2-c is not ready.
- **BG2-x** starts once PNT2 (#70, #73, #74) and BG2-a are both on master.
- **T150 (visibility)** also stacks on #87. The two share only additive registration lines: the lower, emit and paint-samples
  registries, `css/properties.ts`, `fixtures.ts`, and the seams and paint-seams pins. In `native-support.ts`, BG2 edits
  DragonBoxShape and T150 edits the stage-dispatch gate. Whichever lands second merges them.
- **Not concurrent with:** any other writer of `css/shorthands/background.ts`, `analysis/paint-values/gradient.ts` or
  `packages/layout/src/paint-gradient.ts`; COL4 (T119) on stop colours, which goes after BG2-a.

## 5. PR split (each reviewed diff under about 150 KB; generated output is ignored by `.macroscope/ignore.md` shape)

| PR | Branch | Content | Est. reviewed size |
|---|---|---|---|
| BG2-a1 | `bg2-engine` | `paint-gradient.ts` (without tanF32/atan2F32; slope and layer origin as inputs), the `scripts/capture-libm.ts` probe and its generated table, `paint-vectors` gradient inputs, the harness suite hunk, `layout/test/paint-gradient.test.ts`, `docs/ports.json` entries and `THIRD_PARTY_NOTICES.md` (`pnpm notices:gen`) | ~110 KB |
| BG2-a2 | `bg2-compiler` | layer longhands, the shorthand, `paint-values/gradient.ts`, refusals, R3 constant folding, R4 layer fact, R6 backdrop and opacity checks, `dragon/test/{paint-gradient,background}.test.ts`, `check-bg2-additive.ts` | ~120 KB |
| BG2-a3 | `bg2-native` | lower and emit modules, Swift and Kotlin support, DragonBoxShape padding and `lu`, registries, plants; fixtures, gradient sample points, `bg2-reference`, `bg2-samples` and `bg2-layers` tests, device-run plant wiring | ~130 KB |
| BG2-c | `bg2-conic` | conic in engine, compiler and native; fixtures; plants | ~70 KB |
| BG2-u | `bg2-url` | url() layers on REPL-a's image pipeline; fixtures with flat-quadrant PNGs | ~80 KB |
| BG2-t | `bg2-tiling` | picture-shader tiling, space and round (conditional, R8) | ~90 KB |
| BG2-x | `bg2-transformed` | device-space raster under transforms; the shine pattern | ~70 KB |

Each PR body says what changed, exactly what passed, and why each changed check changed.

## 6. allowed_files (BG2-a; later pieces use the same set plus what their row in §5 names)

- **Compiler:**
  - `packages/dragon/src/css/properties/background-layers.ts`, `packages/dragon/src/css/shorthands/background.ts`;
  - `packages/dragon/src/css/stylesheet.ts`, the one comma-list hook only;
  - `packages/dragon/src/analysis/paint-values/gradient.ts`;
  - `packages/dragon/src/analysis/computed-checks.ts`, one call only;
  - `packages/dragon/src/paint-data/**` (new; the R3 table is generated).
- **Lowering and emit:** `packages/dragon/src/lower/paint/{gradient,background}.ts`, `packages/dragon/src/emit/paint/{gradient,background}.ts`
  (in background.ts, only the hand-off to the layers stage), the gradient lines in `lower/paint/registry.ts` and
  `emit/paint/registry.ts`, and `emit/paint/types.ts` (the stage hand-off types only).
- **`packages/dragon/src/emit/native-support.ts`:** the DragonBoxShape fields `lu` and `padding` and their fill in
  `DragonTree.apply`, on both backends. Nothing else.
- **Engine and translator:**
  - `packages/layout/src/paint-gradient.ts`, and `packages/layout/src/index.ts` (one export block);
  - `packages/layout/paint-vectors/gradient/**`;
  - `packages/translate/harness/harness.ts` (RT-13 suite hunk), `packages/parity/src/cli/paint-vectors.ts` (gradient inputs).
- **Parity:**
  - `packages/parity/src/paint-samples/gradient.ts`;
  - `packages/parity/src/device-run.ts`, `device-lanes.ts`, `cli/native-devices.ts` (plant case and rule hunks only);
  - `packages/parity/src/fixture-groups/{gradients,background}.ts`, `packages/parity/src/fixtures.ts` (one import and one
    concatenation);
  - `packages/parity/fixtures/{gradient,bg-layers,bg-geometry,reject-gradient,reject-background,calib-gradient}-*.html` (new),
    plus the two retargeted BG1 rejects.
- **Tests:**
  - `packages/dragon/test/{paint-gradient,background}.test.ts`, `packages/layout/test/paint-gradient.test.ts`,
    `packages/parity/test/bg2-*.test.ts`;
  - append-only or literal pins in `seams`, `paint-seams` (dragon, layout, parity), `s4b`, `grid`, `css-escapes`, `device-run`,
    `samples` and `pixel-reference` tests, each listed with its reason.
- **Scripts and docs:**
  - `scripts/capture-libm.ts` (new), `scripts/check-bg2-additive.ts` (new), `scripts/gen-css-grammar.ts` (subset line),
    `scripts/regen.ts` (the libm step);
  - `package.json` (one script line), `.gitattributes` (merge line for the table);
  - `docs/ports.json`, `THIRD_PARTY_NOTICES.md` (generated).
- **Regenerated only:** profiles, `packages/parity/{expected,expected-dpr,expected-breaks,expected-pixels,emitted}/**`,
  `packages/layout/{vectors,break-vectors,generated}/**`, `packages/translate/corpus*.json`, `packages/parity/out/lanes.json`,
  `examples/music-player/dragon/north-star-check.json`, `packages/wpt/expectations/*.json`, `packages/tailwind-sweep/snapshot/**`,
  the ua `*.generated.ts` files and `grammar.generated.ts`.
- **Shared files** (named for the PM): `native-support.ts`, both registries, `fixtures.ts`, the pin tests and `package.json`.
  T150 shares the same ones.

## 7. Proof

**Numbers first:**
1. **chrome-dual** computed strings for all eight layer longhands and `background-image`, on every fixture, both directions.
2. **Paint vectors:** TS = Swift = Kotlin bit for bit over the gradient inputs (C3, C4).
3. **`bg2-reference.test.ts`:** the TS raster against the committed Chrome PNGs at **every exactly painted pixel** at DPR 2,
   3 and 2.625. The maximum difference is printed and must be 0. It must also be 0 on solid areas and hard-stop plateaus.
4. **`bg2-layers.test.ts`:** R4's layer and origin against CDP LayerTree.
5. **`libm:capture -- --check`** on the capture host, plus a unit test that the compiler's slope for every fixture angle comes
   from the table or fdlibm exactly as R3 says.
6. **device-applied:** each gradient writer's readback (layer count, kinds, slope bits, layer origin, clip box, bitmap size).

**Pixel lanes:** device-pixels compares gradient points (2 device px clear of hard stops and edges; hard stops as edge
scanlines along the gradient line) at delta 0. The device must equal the TS reference exactly at every sample. This holds at
DPR 2, 3 and 2.625 on the iOS simulator (2, 3) and the Android emulator (2, 2.625, 3). Frames, lines and layout-vectors-device
keep base verdicts.

**Fixtures to add** (ltr and rtl unless marked):
- **from bg2:** `gradient-linear`, `gradient-radial`, `bg-layers`, `gradient-fractional`, `calib-gradient-ramps`, and the
  rejects;
- **new:**
  - `gradient-angles`: the 17 whole degrees of M1 where tanf ≠ correctly rounded, plus 110 and 0.25turn;
  - `gradient-rounded`: the `.record` and `.track` patterns, rounded clip with overflow hidden;
  - `gradient-layer-origin`: will-change: transform, and a paused transform animation, placed off the 8-pixel phase;
  - `gradient-backdrop`: R6 (a), (b) and (c), each against a refused twin;
  - `gradient-units`: em, rem and edge offsets;
  - `bg-geometry`: size, position, origin and clip in every box, with padding;
  - `gradient-north-star`: the demo's three gradient rules verbatim; the shine is a reject until BG2-x;
- **rejects:** off-grid angle, corner (native), hint, space, attachment fixed, translucent over unknown, transformed ancestor,
  calc stop, viewport size, body gradient.

**Planted faults (each must fail its lane; listed in device-run PLANT_CASES/PLANT_RULES or as a reference plant):**
- `gradient-offset-1` (device-pixels, both platforms);
- `gradient-unpremultiplied-upload` (device-pixels, Android);
- reference plants in `bg2-reference`: `libmTableIgnored` (replaces bg2's `tanCorrectlyRounded`), `unpremultiplied`,
  `ditherOff`, `layerOriginIgnored` (page origin instead of layer), `singleTileModelSwapped`, `obscuredBorderIgnored`;
- later pieces add `sweepRotationIgnored` (BG2-c), `bg-image-offset-1` (BG2-u), `tileOriginShifted` (BG2-t) and
  `ctmIgnored` (BG2-x).

**Support-profile rows** (web, ios, android; native rows promoted by P6a's device rule):
- `background-image`: `<linear-gradient()>`, `<radial-gradient()>`, `<repeating-linear-gradient()>`,
  `<repeating-radial-gradient()>`, `<list>`; and later `<conic-gradient()>`, `<repeating-conic-gradient()>`, `<url()>`;
- `background-size`: auto, `<length-px>`, `<percentage>`, cover, contain;
- `background-position-x` and `-y`: keywords, `<length-px>`, `<percentage>`, edge offsets;
- `background-repeat`: repeat, no-repeat, repeat-x, repeat-y; later space, round;
- `background-origin` and `background-clip`: border-box, padding-box, content-box;
- `background-attachment`: scroll.

**Tailwind:** the sweep's backgrounds category rises (bg2 measured 0 → 14 on web and iOS). The `bg-linear-*` utilities stay
refused, because they use `in oklab` (BG2b after COL4).

## 8. Verify (BASE = the recorded base sha; heavy steps through `/tmp/heavy-lease.sh`, device steps through `/tmp/device-lease.sh`)

- **V1.** `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`: green except the device-record tests that fail only
  for a missing device run ("device step pending"). BASE's `vitest list` is a subset of HEAD's. No `.skip`, `.only` or
  `.todo`.
- **V2.** `pnpm run layout:subset` reports 0. `pnpm run native:gen && pnpm run native:swift && pnpm run native:kotlin &&
  pnpm run native:planted -- --target swift && pnpm run native:planted -- --target kotlin` pass.
- **V3.** `pnpm regen` reaches a fixed point; a second run changes nothing. `node scripts/check-bg2-additive.ts BASE`: the new
  longhands are additive only (boxes, lines, vectors and other values byte-identical; its plants fail).
- **V4.** `pnpm vitest run packages/parity/test/bg2-reference.test.ts packages/parity/test/bg2-layers.test.ts
  packages/parity/test/bg2-samples.test.ts`: maximum difference 0, layers equal, plants caught.
- **V5.** `pnpm run libm:capture -- --check`: no difference.
- **V6.** `pnpm run parity:report && pnpm run parity:dpr-report`: 0 failed at 1, 2, 3 and 2.625; chrome-dual equal.
- **V7.** `pnpm run profile:rows && git diff BASE -- packages/dragon/src/profiles`: only the declared rows.
- **V8.** On the device lease, only at the head of the landing queue or in the train: `pnpm run parity:devices` then
  `pnpm run parity:lanes -- --require-all`.
  - Every new case passes every lane on both platforms at every DPR. Old cases keep BASE's verdicts and failure list.
  - `native:devices --plant` catches every device plant.
- **V9.** `pnpm run north-star:check`: the §9 delta, and no per-target count rises.
- **V10.** `pnpm run wpt:run -- --target web && pnpm run wpt:update-expectations -- --target web`: no pass becomes a fail.
- **V11.** `git diff --name-only BASE..HEAD` stays inside allowed_files. The no-animator grep over `packages/dragon/src/emit`
  prints nothing. `grep -n "disassembl\|libsystem_m" packages/layout/src` prints nothing.

## 9. North-star delta (`examples/music-player/dragon/north-star-check.json`)

On master today, the three gradient declarations are blocked on all three targets: styles.css lines 148 (`.record`), 192
(`.record-shine`) and 283 (`.track`). Each carries one target-less `DRAGON_UNSUPPORTED_VALUE`.
- **After BG2-a:**
  - lines 148 and 283 become `supported` on web, iOS and Android: +2 to `supportedWeb`, `supportedIos`, `supportedAndroid`
    and `supportedBothTargets`;
  - target-less `DRAGON_UNSUPPORTED_VALUE` goes 3 → 1;
  - `function:linear-gradient()`, `radial-gradient()` and `repeating-radial-gradient()` are no longer refused;
  - no new diagnostic appears.
  - `.record` relies on R4 (its paused `album-spin` gives it its own layer, M2) and on R6(a) (the opaque repeating layer
    beneath).
- **After BG2-x:** line 192 becomes `supported` (+1 per target), and the count goes 1 → 0.
- BG2-c, BG2-u and BG2-t: no north-star change (the demo uses none of them).

## 10. stop_if

- Chrome differs from the reference anywhere on a committed case after reading the Blink and Skia source (report case, DPR,
  pixel and both values). There is never an allowance.
- The libm table check fails, or a fixture angle needs a value outside the table and fdlibm.
- CDP LayerTree shows a gradient box in a layer the compiler did not predict.
- PNT1's backdrop fact cannot certify R6(c) per pixel, so R6(c) stays refused; report and continue with (a) and (b).
- PNT1's group alpha is not pixel-exact for R6(b) cases, so R6(b) stays refused; report.
- A hosting or stage need that EMS's registration points cannot serve. Do not edit native-support.ts beyond §6.
- An existing capture, BG1 output or other case's verdict changes.
- BG2-t cannot be exact.
- A file outside allowed_files is needed; the lease is not held; verification fails twice (load timeouts excepted, per the
  Throughput Rules).

## 11. Size and risk

- **BG2-a:** L. Most of it is bg2's code moved onto PNT1's seams; new work is R3's table, R4's layer fact, R6(b)/(c) and R7.
  Risk is medium-high, from the R4 layer prediction and the integration with PNT1's rounded clip and backdrop.
- **BG2-c:** M, medium.
- **BG2-u:** M, low-medium (REPL-a's rules).
- **BG2-t:** M-L, high (picture-shader resampling; may stop).
- **BG2-x:** M, medium-high (device-space raster under PNT2).
- **Device time:** about one device run per PR position in the train.

## Receipt

- **Spec:** /tmp/specs/T074.md
- **R1:** Dragon rasterises every gradient (premultiplied, dithered); native gradient APIs are never used.
- **R2:** the gradient allowance stays 0; any residual is a stop; rows can be exact.
- **R3:** tanf, sinf and cosf come from a measured capture-host table on a 0.01° grid, folded at build time. bg2's
  disassembly-derived tanF32/atan2F32 do not land. Off-grid angles and `to <corner>` are refused natively (BG2b).
- **R4:** the dither and shader origin is the box's composited layer, checked with CDP LayerTree. Unmodelled layers are refused.
- **R5:** both of Blink's single-tile draw models are ported, as bg2 has them.
- **R6:** a box's stack is one Dragon bitmap; translucency is accepted only over a known backdrop (opaque stack, own opacity
  group, or PNT1's backdrop fact).
- **R7:** px and %, with em/rem folded; viewport units and calc refused; edge offsets, content-box and negative stops are
  accepted.
- **R8:** single-tile repeats only; real tiling, space and round are BG2-t, exact or refused.
- **R9:** conic gradients port SkSweepGradient plus Blink's rotation, using R3's sin/cos.
- **R10:** url() reuses REPL-a's asset pipeline and `image-flat` proof (BG2-u).
- **R11:** bitmaps are uploaded premultiplied with no conversion (copyPixelsFromBuffer; CGImage premultipliedLast) and drawn
  1:1.
- **R12:** runtime-callable writers, an after-layout re-raster, a cache, and no animators.
- **R13:** gradients under a non-identity transform are refused until BG2-x rasterises in device space.
- **R14:** web output emits the longhands, proven by chrome-dual.
- **Base:** origin/pnt1-foreground-v3 518bc92d22 (#87); land right after the PNT1 train. BG2-u after REPL-a; BG2-x after PNT2.
- **Owner questions:** none required. One item touches publishing: R3 drops bg2's port of Apple's libsystem_m. If the owner
  prefers shipping it to get native `to <corner>` and arbitrary angles, that is an owner call about licence risk. The research
  recommendation is no.
