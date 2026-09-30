# T069 SC-RASTER: Chrome 145 raster facts for box-shadow, dashes, dither, focus ring, radius AA

Chrome 145.0.7632.6 launched through `packages/parity/src/chrome.ts` (`launchChrome(2|3|2.625)`, `openPage`), full-page PNG
screenshots decoded in-process. Scripts and raw numbers: `/tmp/sc-raster/m.mts`, `/tmp/sc-raster/m3.mts`,
`/tmp/sc-raster/results.json`. Blink source is from tag `145.0.7632.6`. googlesource returned HTTP 503 for most files (it rate-limits),
so most files came from the GitHub mirror `raw.githubusercontent.com/chromium/chromium/145.0.7632.6` (same tag). Copies are in
`/tmp/sc-raster/src/`. Skia source was not opened.

## 0. Cross-cutting fact: Blink paints in device pixels
With `--force-device-scale-factor=N`, Blink uses zoom-for-DSF, so EffectiveZoom is N and every length below is in device px.
Border widths snap to whole device px. Measured at DPR 2.625, CSS widths 1/2/3/4/6 became 2/5/7/10/15 device px
(floor(w*dpr), from the dash periods in §2). All thresholds such as "thickness >= 3" apply to device px, not CSS px.

## 1. box-shadow blur sigma
- Source: `core/style/shadow_data.h:76-82`, `BlurRadiusToStdDev(radius) { return radius * 0.5f; }` ("Per spec, sigma is
  exactly half the blur radius"). Also `:88`, `BlurAsSigma() = BlurRadiusToStdDev(BlurValue())`. The shadow is painted
  through `DrawLooperBuilder::AddShadow(offset, BlurAsSigma(), ..., kShadowRespectsTransforms, kShadowIgnoresAlpha)` at
  `core/paint/box_painter_base.cc:331-336` (outer) and `:457-460`, which goes to `platform/graphics/draw_looper_builder.cc:53-74`.
- **T046's hypothesis `sigma = 0.288675*blur + 0.5` is refuted.** Rule: sigma_device = blur_css * dpr / 2.
- Measurement: a 100x100 black box with `box-shadow: 0 0 Bpx #000`. The alpha profile along the mid-row outside the right edge
  was fitted to the separable Gaussian rect model. Errors are in 8-bit levels:

| blur | dpr | best sigma/(blur*dpr/2) | best rms/max | sigma=blur/2 rms/max | 0.288675b+0.5 (css) rms/max |
|---|---|---|---|---|---|
| 1 | 2 / 3 / 2.625 | 1.04 / 1.04 / 1.04 | 0.72/1.6 | 1.17/3.3 | 10.7/25.6 |
| 4 | 2 / 3 / 2.625 | 1.035 / 1.04 / 1.035 | 0.77/1.6 | 1.49/3.2 | 7.5/14.0 |
| 16 | 2 / 3 / 2.625 | 1.036 / 1.034 / 1.035 | 0.87/1.6 | 1.72/3.2 | 17.6/30.1 |
| 40 | 2 / 3 / 2.625 | 0.966 / 0.972 / 0.971 | 1.24/2.2 | 1.75/2.8 | 17.4/29.7 |
| 70 | 2 / 3 / 2.625 | 0.958 / 0.952 / 0.980 | 0.94/2.1 | 1.49/3.1 | 13.9/24.4 |

  The residual against a true Gaussian (max about 3 levels, and a best-fit sigma about 3.5% wide for small blurs and about
  3-4% narrow for large ones) is Skia's blur approximation, not the sigma rule. Recommendation: use sigma = blur*dpr/2. A pure
  analytic Gaussian is within 3.4 levels everywhere measured. Channel-delta 0 would need a port of Skia's CPU blur at the
  Chrome 145 Skia revision (not opened; open question for PNT1).

## 2. Dashed and dotted border geometry (P5 failures)
Source: `platform/graphics/styled_stroke_data.cc` and `core/paint/box_border_painter.cc`. Thickness t and lengths are in
device px.
- `box_border_painter.cc:561-596` `DrawDashedOrDottedBoxSide`: integer side coordinates. The stroke runs along the mid line
  `y1 + thickness/2` (integer division) from x1 to x2 across the whole outer side, starting at the outer corner.
- `box_border_painter.cc:500-513` `DrawLineWithStyle`: `width = roundf(thickness)`; `length = dx + dy` (int); open path.
- `styled_stroke_data.cc:64-66` `DashLengthRatio(t) = t >= 3 ? 2 : 3`; `:72-74` `DashGapRatio(t) = t >= 3 ? 1 : 2`.
- `styled_stroke_data.cc:81-113` dashed: dash = t*ratio and gap = t*gapRatio. If length <= 2*dash, no dashes. If
  length <= 2*dash + gap, there are exactly 2 dashes scaled by length/(2*dash + gap). Otherwise
  gap = `SelectBestDashGap(length, dash, gap, closed)`, butt caps.
- `styled_stroke_data.cc:40-57` `SelectBestDashGap`: avail = closed ? L : L + gap; nMin = floor(avail/(dash+gap)),
  nMax = nMin+1; gaps = n-1 (open); g = (L - n*dash)/gaps. It picks the g closest to the nominal gap, or gMin if gMax <= 0.
  The result is that a dash lands on both ends of the side.
- `styled_stroke_data.cc:115-131` dotted with t > 3: intervals `{0, gap + t - 0.01}`, round caps,
  gap = `SelectBestDashGap(L, t, t, closed)`. `StrokeIsDashed` (`:~174`): dotted with t <= 3 goes through the dash path with
  dash = gap = t, plus integer start/end dot growth by `L % 4` and `L % 6` at `box_border_painter.cc:404-~500`.
- Every path effect is `MakeDash(intervals, 2, 0)`, which is phase 0 (`styled_stroke_data.cc:152-160`).
- Rounded sides (`:1795-1827`) stroke the centre-line path with `static_cast<int>(path.length())`.
- Measured runs along the top side mid row, where X is ink and . is gap (device px), match these rules. At DPR 2: dashed w1
  (t=2) is `X6 .4`, w2 (t=4) is `X8 .4`, w3 (t=6) is `X12 .6`, w4 is `X16 .8/9`, w6 is `X24 .9-12`. Dotted w1 (t=2) is
  `X2 .2`. Dotted w2 (t=4) gives round dots with an 8 px period. At DPR 2.625, dashed w2 (t=5) is `X10 .5` and w4 (t=10) is
  `X20 .10`. The partial-coverage pixels (~) around dashes come from the fractional fitted gap. Full RLE for 3 DPRs, w1-6 and
  side lengths 100/137/200 is in results.json under `dash`.
- **Dragon's current rule (phase 0, dash 3w/gap 3w, CSS px) is wrong on three counts:** the ratios are 3:2 or 2:1 by device
  thickness, the gap is fitted, and dotted t > 3 uses round dots.

## 3. Gradient interpolation and dithering
- Source: `platform/graphics/gradient.cc:362-363` "Legacy behavior: gradients are always dithered." `flags.setDither(true)`.
- Measured at DPR 2: in a ramp rgb(0)->rgb(16) over 2048 device px, 1342 of 2048 columns vary vertically. In a colour ramp,
  1944 of 2048 do. A 16x8 block of a 0->4 ramp at value ~1.9 shows ordered-dither ±1 values. Rows 1,3,5,7 are flat and rows 0,
  2, 4 and 6 hold different 1-positions, so the period is 8 in y. This is consistent with Skia's 8x8 ordered dither (from the
  raster pipeline's dither stage; Skia source not opened).
- Transparent stops: `linear-gradient(red, transparent)` over white gives [255,128,128] at 50% and [255,64,64] at 25%, which is
  **premultiplied** interpolation (unpremultiplied would give about [255,191,191] at 50%).
- Recommendation: premultiplied sRGB interpolation plus Skia's 8x8 ordered dither of ±0.5 LSB. Until the matrix is ported
  from Skia at the pinned revision, expect a ±1-level residual on about 65-95% of gradient pixels.

## 4. FocusRingPainter geometry (`outline-style: auto`)
Source: `core/paint/outline_painter.cc`.
- `:37-46` `FocusRingStrokeWidth = 3 * zoom` (outline-width is ignored). `:48-55` outer = W*2/3, inner = W/3.
- `:57-75` `FocusRingOffset = outline-offset`, minus 1*zoom if min(border widths) >= 1*zoom.
- `:748-790` corner radius: an author border-radius is used with a minimum of W; otherwise the default radius is W (`:750`),
  or a NativeTheme part radius for appearance elements.
- `:851-890` `PaintFocusRing`: the outer ring (width W*2/3) is painted at offset + ceil(W/3) in white, or `#101010` in dark
  scheme. Then the inner ring (also width W*2/3) is painted at offset in the outline colour. On non-Mac only, a dark scheme
  forces the inner colour to white (`#if !BUILDFLAG(IS_MAC)`, `:857-860`). The ring is stroked centred on the offset path
  (`platform/graphics/graphics_context.cc:400`, `:846-847`).
- Measured (the box edge is device offset 0; negative is outside):
  - DPR 2, light: `#005FCC` from -2 to +1 (4 px = W*2/3 centred on the edge). The white outer ring is invisible on white.
  - DPR 2, dark: `#101010` at -4..-3 and `#99C8FF` at -2..+1.
  - DPR 3: inner -3..+2 and dark outer -6..-4.
  - DPR 2.625: an AA-partial edge at -3 and +2 (width 5.25), and the outer ring from -5.625 to -2.625.
  - The ring is identical for widths 1px, 3px and 5px. A square box gets rounded ring corners.
  - The capture host is macOS, so the dark inner ring is `#99C8FF` (focus-ring colour), not white.

## 5. Radius antialiasing
Measured: a 100x100 black box with 20px radius, DPR 2/3/2.625. Arc-pixel coverage was compared to exact area (16x16
supersampled) and to a distance model clamp(0.5 - d):
- Area model: mean |err| 1.15 / 0.25 / 5.16 and max 64 / 44 / 215. Distance model: 1.12 / 0.31 / 5.14 and max 56 / 41 / 215.
- For example, DPR 2 row y=43: Chrome `2,95,224,255` against area `12,111,221,255`.
- Neither model matches per-pixel. Chrome's arc coverage differs by up to about 16 levels on ordinary arc pixels and more at
  shallow tangents. That points to Skia's analytic AA scan conversion of flattened conics.
- The 2.625 outliers (215) mean the box edge is snapped while the model used the unsnapped 52.5 px. The model must use
  snapped device geometry.
- Recommendation: the area model plus snapped geometry meets the edge-integral gate (within 1 device px). Channel-delta 0 at
  arc pixels needs a port of Skia's AAA/conic flattening. PNT1 should treat arc pixels as edge samples, not colour-exact.

## 6. Raster path
`chrome://gpu` is blocked in the capture context (net::ERR_FAILED), and WebGL is unavailable (`getContext('webgl')` returns
null). This is consistent with software (CPU Skia) raster in the headless capture. It is indirect evidence, not a direct
readout.

## Open items
- The Skia revision at 145 (blur engine, dither matrix, AAA) was not opened.
- The raster path is inferred, not read.
- Dotted t <= 3 end-dot growth (`box_border_painter.cc:421-~500`) needs a line-by-line port.
