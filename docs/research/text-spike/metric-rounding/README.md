# Metric rounding probe (R5)

The R5 probe of docs/goals/milestone-2-proof/notes/T056-txt1a-spec.md §2. It answers why the engine rounds an exact half-pixel
Ahem descent down (packages/layout/src/platform-rules.ts, `ahem-metric-half-down`, "inferred, not traced"), while T005 rounds an
exact half-pixel Inter ascent up (packages/dragon/src/fonts/metrics.ts).

Run it with `node --conditions=dragon-internal scripts/capture-metric-rounding.ts`. Add `--check` to capture again and require
byte-identical files. It needs Chrome 145.0.7632.6 (Playwright 1.58.2), `swiftc` and macOS.

## What it measures

- **Core Text directly.** `coretext-probe.swift` makes the calls Skia makes on macOS:
  - `CTFontManagerCreateFontDescriptorFromData` and `CTFontCreateWithFontDescriptor` at size 0 (SkTypeface_Mac from data);
  - `CTFontCopyGraphicsFont` and `CTFontCreateWithGraphicsFont` at the strike size (SkScalerContext_Mac's exact copy);
  - `CTFontGetAscent`, `CTFontGetDescent` and `CTFontGetLeading` (generateFontMetrics).

  It runs for 8 faces (Ahem, the 5 Inter faces and the 2 Lato faces) at every size from 0.01 to 192 px, in hundredths.
- **Chrome 145.0.7632.6**, at DPR 1, 2, 2.625 and 3. The CSS sizes are 1 to 64 px, in hundredths. A size is kept when its device
  size gives an exact n.5 ascent or descent, or when the three candidate rules below disagree. Each kept size has two observables:
  - the Range rect of the text against a 0x0 inline-block baseline marker;
  - T005's line box: the block's height and the marker's offset, with `line-height: normal`.

## Result: outcome (a), one traced mechanism

Core Text keeps each vertical metric as a 16.16 fraction of the em. It returns
`(round(units * 65536 / upem) * upem / 65536) * (size / upem)`, as a CGFloat. This formula reproduces every value the probe
printed: 8 faces × 19,200 sizes × ascent, descent and leading, with 0 mismatches. Skia stores the value as a float. Blink then
rounds with `SkScalarRoundToScalar`, which is `floorf(x + 0.5f)`.

So both earlier rules are the same mechanism:

- **Ahem** (upem 1000). 200/1000 of the em quantises to 13107/65536, just below 0.2, so a 12.5 px descent is 2.49996 and rounds
  to 2. The engine's "half down" is correct for Ahem up to 662.5 px, but it is not a rule of its own.
- **Inter** (upem 2048). The fraction is exact, so a 16 px ascent is exactly 15.5, and it rounds to 16.
- **Lato** (upem 2000). There is no exact half. At 82.16 device px, the descent is 17.50008 before quantisation but 17.49987
  after it, and Chrome gives 17. Both the half-up and the half-down rule give 18 here.

captures/outcome.json has the counts over the 129 Chrome rows. The traced rule misses 0 rows on either observable. Half-up misses
79 and half-down misses 56. The two observables never disagree.

## Files

- `coretext-probe.swift`: the standalone Core Text probe.
- `captures/coretext.json`: face tables and SHA-256 values, and per face the sweep's raw-output SHA-256 and formula mismatch count.
- `captures/chrome.json`: every Chrome row, with the raw DOM values, the Core Text values and each rule's prediction.
- `captures/outcome.json`: the outcome and the mismatch counts per rule and observable.
