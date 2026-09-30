# T092 SC-GLYPH (Scout findings, recorded by PM)

Scratch files: /tmp/sc-glyph (m.mts, m.json, s.js, s2.js, and the Skia 2ab8add5 darwin sources). Blink sources: /tmp/blink145.

- **Where the fringe comes from.** Blink 145 turns on font smoothing and subpixel positioning with default hinting (font_platform_data_mac.mm:213-270). Skia's mac scaler (SkScalerContext_mac_ct.cpp) then:
  - requests smoothing (:468);
  - calls CGContextSetShouldSmoothFonts(true) even for A8 masks (:193-201, :261), so Core Graphics dilates the outline by an undocumented amount (:359-360);
  - squares the result through gLinearCoverageFromCGLCDValue (:374, :478-500).

  Skia decides at runtime whether this dilation applies (SkCTFont.cpp:218-270), so the result depends on the macOS version.
- **Subpixel positioning.** x snaps to 4 phases per pixel, with 1/8 rounding (SkGlyph.h). y snaps to whole pixels.
- **Measured coverage.** It is a pure function of (device size, x phase bucket):

  | Mode | Edge pixels | Seams |
  |---|---|---|
  | `-webkit-font-smoothing: antialiased` | exactly 1, 3/4, 1/2, 1/4; no dilation | 0.75 dark |
  | default | extra coverage on the outer pixel grows with size: 26/255 at 20 device px, 64/255 at 48 device px; inner pixels are raised non-linearly | filled to 0.82-1.0 dark |

  In default mode the total extra ink is at most about 0.5 px per edge.
- **Recommendation: A.** Keep sample points at least 1 device px inside glyph edges and skip seam columns within ±1 px of glyph boundaries. A 1-px glyph shift is still caught. B would mean fitting a private Core Graphics model on two platforms and refitting it whenever macOS changes.
- **Option C (for the Judge).** Inject antialiased mode into the Chrome harness. That changes the reference and needs a recapture, and the seams still read 0.75.
