# T086 SKIA-AA: exact analytic AA for rounded rects and border-radius borders (Worker receipt notes)

Branch `skia-aa` (worktree /tmp/dragon-skia-aa), head af90aa2c, six commits on origin/master d47caba8. Not pushed.

## Result
Chrome 145.0.7632.6 was captured on the CPU raster path. SystemInfo was checked on every launch: rasterization and
gpu_compositing `disabled_software`, skia_graphite `disabled_off`. The zoom guard ran before and after each DPR.

There are 93 crops: 31 cases at each of DPR 2, 3 and 2.625. Every pixel of every crop equals the TS reference at channel
delta 0, with no tolerance. That covers every arc pixel, meaning every pixel within 1 device px of a corner's radius box.

| Family | DPR | Crops | Pixels equal | Arc pixels equal | Partial-coverage pixels |
|---|---|---|---|---|---|
| fill (background) | 2 | 17 | 197,801/197,801 | 66,750/66,750 | 2,719 |
| fill | 3 | 17 | 434,738/434,738 | 146,237/146,237 | 4,167 |
| fill | 2.625 | 17 | 334,192/334,192 | 112,214/112,214 | 3,639 |
| border, DRRect | 2 | 7 | 82,232/82,232 | 18,134/18,134 | 1,674 |
| border, DRRect | 3 | 7 | 180,736/180,736 | 39,065/39,065 | 2,520 |
| border, DRRect | 2.625 | 7 | 139,048/139,048 | 29,935/29,935 | 2,259 |
| border, stroked ring | 2 | 7 | 74,344/74,344 | 23,864/23,864 | 2,219 |
| border, stroked ring | 3 | 7 | 163,144/163,144 | 51,704/51,704 | 3,293 |
| border, stroked ring | 2.625 | 7 | 125,681/125,681 | 39,580/39,580 | 2,851 |

**Cases.**
- **Fills:**
  - uniform radii 3.5, 8 and 24;
  - per-corner radii, including a zero corner;
  - elliptical, and mixed elliptical;
  - radius larger than half the box (30 on 60x40), and 999px clamped;
  - circle (the oval path), pill and ellipse;
  - zero radius (the rect fill);
  - fractional position and size (10.125, 7.875, 45.25x33.5) with fractional radii;
  - small boxes that take the mask blitter (12x12, 10x10, 6x6);
  - a 5px strip.
- **Borders, drawn as a DRRect:**
  - non-uniform widths;
  - elliptical radii;
  - radius smaller than the width (the inner corner is square);
  - per-corner radii with non-uniform widths;
  - a thick border with radius over half;
  - fractional position;
  - a small mask case.
- **Borders, drawn as a stroked ring:**
  - uniform width with circular radii, 2 and 6 px;
  - square corners mixed with round ones (miter joins);
  - a circle ring (the oval stroke);
  - a pill ring;
  - fractional position at 1px;
  - a small mask case.

**Routes covered** (the test asserts all seven): rect fill, mask-convex, rle-convex, mask-edges, safe-rle-edges,
stroke-mask-edges and stroke-safe-rle-edges.

## Files
- **`packages/layout/src/paint-aa.ts`** (3,140 lines, translator subset, 0 `layout:subset` violations) ports Skia 2ab8add5:
  - `SkScan::AntiFillPath` with the cc tile clip, and `AAAFillPath`;
  - the MaskAdditiveBlitter, including its 1-byte-offset flat storage and direct sets;
  - RunBasedAdditiveBlitter, with `CatchOverflow`, snapAlpha 8/247 and the flush order;
  - SafeRLEAdditiveBlitter;
  - the trapezoid rows (`blit_trapezoid_row`, `blit_aaa_trapezoid_row`, `compute_alpha_above/below_line`, `partial_triangle_to_alpha`), with every uint8 store wrapped;
  - `aaa_walk_convex_edges`, including the smooth jump, and `aaa_walk_edges`, including nextNextY, intersections, `edges_too_close` and the yShift quarter rows;
  - SkAnalyticEdge lines and quads in SkFixed/SkFDot6: `quick_inverse` table, `quick_div`, SnapY, `updateQuadratic` snapping;
  - SkEdgeBuilder with `combineVertical` and auto-close lines;
  - SkTQSort (introsort, insertion sort, heap sort);
  - SkGeometry: `computeQuadPOW2`, the `SK_SUPPORT_LEGACY_CONIC_CHOP` chop, `subdivide` with its y-order fix-ups, `SkChopQuadAtYExtrema`;
  - SkPathRawShapes Rect, Oval and RRect with start indices (drawRRect uses 6, drawOval uses 1, SimplifyRRect);
  - SkRRect `setRectRadii`, `scaleRadii` (with SkScaleToSides and nextafterf), `computeType` and `inset`;
  - SkCanvas `onDrawRRect` and `drawDRRect` dispatch, and SkDevice::drawDRRect's even-odd path;
  - SkPathStroker for closed line/conic contours: butt cap; miter join with limit 4; `conicStroke`, `intersectRay`, `strokeCloseEnough`, `SkFindUnitQuadRoots`, `sharp_angle`; `privateReversePathTo`;
  - `SkARGB32_Black_Blitter`: every blit is `dst * (256 - a) >> 8`.

  On the Blink side it ports:
  - `FloatRoundedRect::ConstrainRadii` and `IsRenderable`;
  - the gfx::SizeF 8-epsilon clamp;
  - the explicit `operator SkRRect`;
  - `FillRoundedRect`;
  - `PixelSnappedContouredInnerBorder` radii;
  - `IsSimpleDRRect` (WebCoreFloatNearlyEqual);
  - `FillDRRect`, as a DRRect or as a stroked rrect.

  The subset has no `Math.sqrt`, so the file includes a correctly rounded `sqrt32` (float) and `sqrt64` (double: Newton, then exact midpoint tests on 24-bit limbs). Both are tested against `Math.sqrt` on 20,000 inputs each.
- **`packages/layout/test/paint-aa.test.ts`** checks:
  - manifest and raster preconditions;
  - every pixel of every crop in every family at every DPR;
  - all seven routes exercised;
  - all five plants caught;
  - sqrt32 and sqrt64 correct rounding;
  - fixedMul against BigInt;
  - the hairline refusal.
- **`scripts/capture-skia-aa-oracle.ts`**, run as `node --conditions=dragon-internal scripts/capture-skia-aa-oracle.ts [--check]`:
  - it captures with the lane flags and the SystemInfo precondition;
  - crops and the manifest are in `docs/research/skia-aa-oracle/` (456 KB);
  - every box stays inside cc raster tile 0.

## Findings
1. **The legacy black blitter.** Chrome rasters an opaque black fill on N32 with `SkARGB32_Black_Blitter`, not raster pipeline. The model is `g = floor(g * (256 - a) / 256)` per blit call, in call order, and every multiply-hit pixel matches. Coloured fills use `SkARGB32_Opaque_Blitter` and are not modelled; every case is black on white.
2. **Build flags that decide pixels** (from Chromium 145's `skia/config/SkUserConfig.h` and `build/config/compiler/BUILD.gn`):
   - `SK_RASTERIZE_EVEN_ROUNDING` is not defined, so edge coordinates truncate: `(int)(x * 256)`. The `edgeFixedPointRounding` plant is the other setting, and it changes 3,618 pixels.
   - `SK_SUPPORT_LEGACY_CONIC_CHOP` is defined.
   - `-ffp-contract=off` means every float step rounds on its own.
3. **Blink's border dispatch.** Four solid, uniform-colour sides take `PaintBorderFastPath` then `FillDRRect`.
   - If the widths are uniform and every corner is either square or circular with outer = inner + width (IsSimpleDRRect), Blink strokes the rrect inset by width/2. That goes through SkStroke and then fills the two-contour ring non-zero.
   - Otherwise Blink draws an even-odd DRRect.

   The common CSS case, `border: Npx solid; border-radius: R > N`, is the stroke. A radius at or under the width, elliptical radii, or non-uniform widths give the DRRect.
4. **Arc coverage is not an area or distance model** (T069 §5). It comes from quarter-pixel SnapY, 1/16-px x snapping (kSnapMask) and the triangle approximations in `partial_triangle_to_alpha`. The RLE blitters also snap alpha below 8 to 0 and above 247 to 255, but the mask blitter does not.
5. **Radius clamping happens twice**, in Blink's float ConstrainRadii and then in SkRRect's double scaleRadii. The `rrectRadiiUnclamped` plant drops both.

## Plants (each caught; pixels differing across all 93 crops)
| Plant | Pixels differing | Crops |
|---|---|---|
| supersampleInsteadOfAAA (4x4 point sampling of the flattened path) | 25,047 | 90 |
| conicNotQuadded (each conic taken as one quad) | 36,943 | 69 |
| edgeFixedPointRounding (round, not truncate, into SkFDot6) | 3,618 | 87 |
| rrectRadiiUnclamped (no ConstrainRadii and no scaleRadii) | 83,928 | 12 (3 throw) |
| coverageNotAccumulated (additive blitters store instead of add) | 47,293 | 90 |

`--check` was also shown to fail on a stored crop with one pixel changed (`STALE fill-uniform-8-dpr2.png`, 1 stale). The crop was restored from git.

## Not modelled (the reference throws; none is reached by the oracle)
- Strokes of at most 1 device px, which Skia draws as hairlines.
- Stroked rects (AntiFrameRect).
- `try_blit_fat_anti_rect` on line-only paths.
- Paths crossing their cc tile clip.
- Fractional AA rect fills.
- Degenerate conic strokes (round joins).
- Conics needing 32 quads.
- Non-black paint.
- Borders whose inner rrect is not renderable (the clipped path).

Square borders take `DrawSolidBorderRect` and are outside this package.

## Follow-ups
- **Taint-free shadows (item 5) are not done.** T109's `paint-blur.ts` is on `skia0-blur-dither` (PR #19, still open), not on master. Once it merges, `boxShadowOverWhite` can take its rrect source mask and clip from `paint-aa`'s `antiFillPath`, clearing its arc-pixel taint.
- **TS = Swift = Kotlin.** No engine root reaches `paint-aa.ts`, so `native:gen` changed only the source-digest headers in Strings.swift, Unions.swift and Unions.kt, in their own commits. The file is subset-clean, so it translates once paint wiring (T046/PNT1) makes it a root.
- **The board says "After T072"** (PNT1, still queued). This package did not need it.

## Verification (final, on af90aa2c)
- `pnpm install --frozen-lockfile`: ok.
- `pnpm typecheck`: ok.
- `pnpm test`: 87 files and 1,865 tests passed.
- `pnpm layout:subset`: 0 violations.
- `pnpm native:gen`: only the digest header lines changed, committed separately (6ac443c1, af90aa2c). A rerun gives no diff.
- `capture-skia-aa-oracle.ts` wrote 93 crops. `--check` gave 93 crops, 0 reference mismatches, 0 stale.
- `vitest run packages/layout/test/paint-aa.test.ts`: 8/8 passed.
