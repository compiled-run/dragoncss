# T109 SKIA-0: exact box-shadow blur and gradient dither (Worker receipt notes)

Branch `skia0-blur-dither` (worktree /tmp/dragon-skia0), head ed172d06, three commits on origin/master d47caba8. Not pushed.

## Result
Chrome 145.0.7632.6 was captured on the CPU raster path (SystemInfo checked on every launch: rasterization and
gpu_compositing `disabled_software`, skia_graphite `disabled_off`; the zoom guard ran before and after each DPR).
There were 84 crops: 28 cases at each of DPR 2, 3 and 2.625. Every compared pixel equals the TS reference at channel
delta 0, and no tolerance is used.

| Family | Pixels compared, all equal | Pixels captured |
|---|---|---|
| box-shadow | 5,318,929 | 5,483,058 |
| gradient | 1,129,151 | 1,129,151 |

- **Pixels left out.** Uncompared pixels come from two sources, and the reference marks them itself:
  - pixels in rounded cases that depend on an anti-aliased arc pixel (the source mask or the clip);
  - one fallback case with a fractional edge, `sb-b125` at DPR 2.625.
- **Paths covered.** At every DPR these paths have exact pixels: nine-patch rect, nine-patch rrect, triple box and small_blur.

## Files
- **`packages/layout/src/paint-blur.ts`** ports:
  - SkBlurMaskFilterImpl filterRectsToNine and filterRRectToNine, and draw_nine;
  - BlurRect, with the cubic gaussianIntegral, profile, ProfileLookup, ComputeBlurredScanline (including the unsigned `sw` wrap) and SkMulDiv255Round;
  - PlanGauss and Scan, with the ring buffers and the 64-bit `weight*sum` as a split multiply (tested against BigInt);
  - small_blur and SkGaussFilter;
  - sigma = fround(blur * 0.5) capped at 128;
  - SkDraw compute_mask_bounds;
  - Blink PaintNormalBoxShadow over white.
- **`packages/layout/src/paint-dither.ts`** ports:
  - Blink FillSkiaStops;
  - the SkGradientBaseShader stop setup: uniform detection at 1/4096, dedupe, and removal of repeated first and last stops;
  - pts_to_unit_matrix and the SkMatrix concat and invert that feed the shader matrix;
  - the stages 2-stop, evenly spaced and arbitrary stops, the dither, clamp_01, srcover and store_8888.

  Arithmetic follows arm64 NEON. `mad` is a fused float32 FMA (an exact TwoSum emulation, tested against BigInt). Stores round half to even (vcvtnq).
- **Tests and capture script:**
  - `packages/layout/test/paint-blur.test.ts` and `paint-dither.test.ts`;
  - `scripts/capture-skia-oracle.ts`, run as `node --conditions=dragon-internal scripts/capture-skia-oracle.ts [--check]`;
  - the crops and manifest are in `docs/research/skia-oracle/`, 640 KB in total.
- **Subset.** Both reference files pass `layout:subset` with 0 violations. They use only rt-easing's rounding wrappers, push-only arrays and mutable `{v}` cells, with no bitwise operators, `%` or BigInt. Neither file is an engine root, so `native:gen` changed only the sources digest header in Strings.swift, Unions.swift and Unions.kt. That header change has its own commit.

## Findings
1. **Dither phase.** The (2,0) that T085 left open comes from cc raster tiles, not the layer origin.
   - The dither's (dx, dy) and the shader matrix translate are local to the tile bitmap.
   - Blink layer_tree_settings.cc:285-287 sets 512 px tiles on Mac and ChromeOS at DSF ≥ 2. Otherwise tiles are 256.
   - Tiles have one border texel (cc TilingData), so tile i's bitmap starts at 510·i.
   - T085's ramp covered x = 400..912. Most of it is in tile 1, and 510 ≡ 6 (mod 8), which gives phase +2. The 2.7% leftover was tile 0.
   - The tile origin also changes the float32 rounding of t, so the tile model is needed for exact colors, not only for the dither.
   - With 512/510, every gradient pixel matched at all three DPRs. 256 px tiles and page coordinates both fail.
2. **Large blurs depend on the tile.** Box sigmas of 2 and above that don't fit the nine-patch go through `SkDraw::DrawToMask`.
   - compute_mask_bounds trims the source mask to the clip outset by min(margin, kMaxMargin = 128) (SkDraw.cpp:1088-1119). The clip here is the tile bitmap.
   - A triple-box border above 128 therefore loses source pixels near tile edges. `tb-b40-wide` hits this at DPR 3 (σ 60, border 168) and DPR 2.625, with values off by 1 around x ≈ 509.
   - The reference blurs each tile's trimmed source. With that model the case is exact.
3. **Values confirmed.**
   - T069's sigma = blur·dpr/2 holds exactly.
   - A black shadow over white gives 255 − coverage, exactly, through lowp srcover.
   - Stop colors are fround(c/255).
   - Legacy gradients interpolate premultiplied.
   - Chromium's non-FMA C++ float code is modelled with a separate fround per operation. BlurRect needed no contraction.
4. **exp.** Skia's SkGaussFilter calls the platform `exp`. On this host, Apple libm differs from fdlibm and V8 by 1 ulp on about 9.5% of inputs.
   - The subset has no `exp`, so the port uses fdlibm's algorithm.
   - The test shows a ±2 ulp change in `exp` leaves the uint16 factors unchanged on a 20,001-point σ grid in [1/3, 2).
5. **Scope.**
   - Rounded-rect AAA stays with SKIA-AA (T086). Pixels in a border-box corner square (±1 px, the anti-aliased clip) and pixels whose blur window reaches an arc pixel of the source rrect are marked non-exact.
   - Straight-edge strips are exact: rr-np 21,080 of 24,964 pixels at DPR 2, and rr-tb 7,972 of 27,556.
   - Rounded shadows with spread, and fallback rects with fractional edges beyond tainting, are not modelled. The reference throws, or taints the pixels.

## Plants (each caught; pixels differing across all crops)
| Plant | Pixels differing | Crops |
|---|---|---|
| blurSigmaFormula | 2,690,537 | 60 |
| ninePatchAlways | 1,320,927 | 27 |
| tripleBoxRoundingOff | 774,555 | 21 |
| ditherDisabled | 315,698 | 18 |
| ditherPhaseShift | 87,787 | 15 |
| gradientUnpremultiplied | 256,917 | 6 |

`--check` was also shown to fail on a stored crop with one byte changed (exit 1, `STALE`). The crop was then restored.

## Verification (final, on ed172d06)
- `pnpm install --frozen-lockfile`: ok.
- `pnpm typecheck`: ok.
- `pnpm test`: 88 files and 1,877 tests passed.
- `pnpm layout:subset`: 0 violations.
- `pnpm native:gen`: no diff after the header commit.
- `capture-skia-oracle.ts --check`: 84 crops, 0 reference mismatches, 0 stale, exit 0.
