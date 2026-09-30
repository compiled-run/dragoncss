# T093 Judge ruling on B3 (glyph-edge raster): option A (recorded by PM)

Scratch: /tmp/t093-*.mts, run against /tmp/dragon-p5 and /tmp/sc-glyph.

## What B3 is

- **iOS (377 failures):** 356 on a glyph box edge, 19 within 1 device px of one, 2 not fringe.
- **Android (1146 failures):** 1121 on an edge, 23 within 1 device px, 2 not fringe.
- Most are box-rule sample points that land on glyph antialiasing or seams.
- The 2 non-fringe entries per platform are `position-absolute-out-of-flow@3 edge:i2:bottom` (native 64, Chrome 0). They are re-bucketed out of B3 and stay failing.
- The fringe part to clear is 375 on iOS and 1144 on Android.

## Chrome's fringe, re-measured (/tmp/sc-glyph/m.json)

- Per-edge extra ink is at most 0.41 device px. Width excess is 0.15 to 0.58 device px and levels off with size.
- Centre error is at most 0.155 device px: the dilation is symmetric, so what remains is the 1/8 px quarter-pixel snap. No data exists above 69 device px; the corpus maximum is 96.

## Ruling

**A.** B (port a private, OS-dependent Core Graphics fit) and C (change the oracle) are rejected.

1. **Clearance.** Every colour point and every edge-scanline pixel stays at least k = SAMPLE_INSET_DEVICE_PX (2) device px from every glyph box edge.
   - Clearance is checked against each glyph box separately, so seams between glyphs are excluded.
   - Box rules try the along-positions 1/2, 1/4, 3/4, 1/8, 7/8 in order and drop the point if none is clear. The count of dropped points is pinned in a test.
   - Clearance uses engine geometry only.
2. **Calibration.** A committed Chrome glyph calibration set covers 20 to 192 device px at DPR 2, 2.625 and 3, with 4 phases. It asserts fringe extent at most 1.5 device px and Chrome centre error at most 0.25. A guard fails if the corpus maximum glyph size exceeds the largest calibrated size.
3. **Centre check.** A new constant, GATE_GLYPH_CENTRE_DEVICE_PX = 0.5, applies per line to paired glyph-left/right and glyph-top/bottom scanlines. The worst case without a fault is about 0.28, so a 1 px shift is caught with at least 0.22 margin. The 1 device px ink-edge check stays.
4. **Plants.** Plants are judged against a clean run: 0 clean failures, every centre line fails, the shift is 1 ± 0.05, and the margin is at least 0.2. A glyph-offset-y-1 plant is added.

**Not a loosening.**
- No gate or allowance constant changes.
- The only dropped points are those that depend on private coverage.
- Shift detection gets stronger.
- Raising k or C counts as loosening.
- TXT1a inherits the clearance mask, the centre check and calibration, and may not raise k or C.

The binding P6a-g package (T095) is in the T093 Judge receipt: allowed_files, verify including the glyph-b3 CLI and device runs, and stop_if.

## Addendum: rulings on the T095 findings

The Judge verified these on the P6a-g calibration set.

**F1. The y fringe is one-sided.**
- Measured excess: bottom −0.039 to 0.000 device px; top 0.21 to 0.60; left and right 0.08 to 0.29.
- **Decision (b):** the y detector becomes a bottom-edge position check, |native − Chrome| ≤ GATE_GLYPH_POSITION_DEVICE_PX = 0.5. That constant is renamed from GATE_GLYPH_CENTRE_DEVICE_PX and also covers the x centre.
- The top edge stays under the 1 px ink-edge rule.
- **Calibration bounds:** bottom-edge error ≤ 0.1, x centre ≤ 0.25, fringe ≤ 1.5. The y-centre assertion is retargeted and listed.
- Per-case bottom-scanline counts are pinned, and the plant case needs one on every line.
- A bottom error above 0.1 is a stop; the bound is never widened.
- Option (a), a size-keyed model of the private Core Graphics dilation, is rejected.

**F2. The i2 entries are box paint, not fringe.**
- The failing pixel is in i2's 3-row bottom border, 2 px clear of the Y glyph's top.
- A pixel-level fallback applies when an edge scanline or border point would be dropped: its individually k-clear pixels are emitted as colour points, using the existing rule kinds with a `:<side>:clear` suffix.
- The two entries stay failing and move from B3 to box paint (P6a).
- The selectors-universal-root B2 points that are still dropped go to PNT1.

**F3. iOS floors glyph x.** P6a-g grows to fix it.
- The iOS DragonTextView.draw turns on Core Graphics subpixel positioning. The quantisation setting is chosen by a device A/B, and both results are recorded.
- No Dragon-side compensation, no other drawing API, no coverage change.
- The Kotlin output must stay byte-identical.

Allowed-file additions: the native-support.ts flags in the Swift DragonTextView.draw, the native-build.ts plant log line, and regenerated iOS outputs.
