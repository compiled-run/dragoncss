# T085 Skia at the Chrome 145 revision (Scout findings, recorded by PM)

Skia is pinned at 2ab8add5be2c46eb6238f4c217f6d6dbc9bccd23 (Chromium 145.0.7632.6 DEPS:315). Sparse checkout: /tmp/sc-skia/skia.

- **Raster path.** Confirmed with CDP SystemInfo.getInfo under the lane flags:
  - rasterization disabled_software; gpu_compositing disabled_software; skia_graphite disabled_off;
  - SwiftShader; headless_shell-1208.
  - So Blink rasters on the CPU with Skia.
- **Blur.** Shadows use SkBlurMaskFilterImpl (cc/paint/draw_looper.cc:29-30; sigma capped at 128).
  - Plain rects that fit the nine-patch (SkBlurMaskFilterImpl.cpp:432-521) take the analytic path:
    - SkBlurMask::BlurRect (SkBlurMask.cpp:405-460);
    - the profile is ceil(6σ) wide, built from the cubic gaussianIntegral (:319-335);
    - rows and columns are combined with SkMulDiv255Round;
    - hand-verified exact at DPR 2 for blur 1, 4 and 16.
  - Rects too small for the nine-patch, and rounded rects, take the triple-box path:
    - filterMask → SkMaskBlurFilter;
    - PlanGauss (SkMaskBlurFilter.cpp:25-90), Scan (:94-202), small_blur for σ<2 (:880, :965-975);
    - not yet verified per pixel.
  - Portable: float32 via Math.fround, plus 64-bit products.
- **Dither.** 8x8 ordered dither (src/opts/SkRasterPipeline_opts.h:2085-2117):
  - rate 1/255, applied only to non-constant shaders (SkRasterPipelineBlitter.cpp:364-407);
  - a 16x8 block matches exactly at phase (2,0);
  - 2.7% leftover mismatches, from the gradient t model or the tile origin.
- **Rounded-rect AA.** Always analytic AA: SkScan_AntiPath.cpp:~130-139 goes to SkScan_AAAPath.cpp, with conics converted to quads. A port is about 2k lines of fixed-point code, not yet verified.

Open items:
- sim.py crashed, so blur 40/70, DPR 3 and DPR 2.625 are unchecked.
- small_blur's weights (SkGaussFilter) were not read.
- The dither phase offset is unexplained.
