# T101 DTXT-0 (Worker): done after the PM's B1 and B2 rulings

Branch `dtxt0-format-widths` in /tmp/dragon-dtxt0, from origin/master 43da1152. Commits:
- 47802065: code.
- 18ba0de7: captures, written by `node --conditions=dragon-internal scripts/capture-dtxt-widths.ts`.
- 1f719f7c: the generated header lines, written by `pnpm run native:gen`. Line 1 of each file changes and nothing else.
- cee1c49a: an explicit zoomed-LU assertion in the widths test.

Nothing was pushed. Apart from the three header files that the B1 ruling allowed, every change is a new file.

## B1 (resolved: relaxed tier, header-only commit 1f719f7c): a new file in packages/layout/src changes three generated headers

`sourcesDigest` (packages/translate/src/generate.ts:126) hashes every file in `engineFiles()`, whether or not an engine root reaches it. So adding `rt-text-format.ts` changes one header line in each of:
- Strings.swift
- Unions.swift
- Unions.kt

The translated code itself does not change, because the file is not a root. `translate.test.ts` freshness then fails on exactly those three files. Every new file in src has had this effect, rt-*.ts included.

This conflicts with two parts of the task: "native:gen with no diff" and "no existing file changes". The fix is a three-line relaxed-tier header regeneration, done by `pnpm run native:gen` in its own commit. It needs a PM ruling, or those three paths added to allowed_files.

## B2 (resolved: accepted as the established zoomed-LU parity model): Chrome widths depend on DPR in CSS px, but the engine matches in zoomed LU

- **The first capture was invalid above DPR 1.** It used the text-spike gate method as written: a context `deviceScaleFactor`, with no zoom. At DPR above 1 that is the launch parity:dpr-capture plants and rejects: it lays out at zoom 1.
- **Recaptured the valid way.** The capture now launches like parity:dpr-capture: `launchChrome(N)`, meaning `--force-device-scale-factor=N` plus a context deviceScaleFactor, with the zoom guard run before and after. The guard gives 0.5px at DPR 2, 0.380952px at 2.625 and 0.333333px at 3.
- **Chrome lays out in zoomed LU (1/64 device px).** Of the 216 boundary widths at DPR 2, 2.625 or 3, 147 differ from DPR 1 in CSS px. Each is under one device px away. Example: Lato 14px "0:00" is 1784 LU at DPR 1 and 3567 zoomed LU (1783.5 CSS LU) at DPR 2.
- **The engine still matches exactly.** Measured at `zoomFontSize(size, N)`, `shapedMeasurer` equals Chrome on all 288 boundary widths in zoomed LU, as the DPR lanes compare.

**PM ruling.** The DPR lanes compare in zoomed LU (1/64 device px), with the engine at zoomFontSize. The engine matches all 288 boundary widths that way, so this is the established parity model, not a DPR dependence of the engine.

`rt-text-format-widths.test.ts` asserts it explicitly, with a comment: all 216 widths at DPR 2, 2.625 and 3 are exact in zoomed LU. Measuring at the CSS size instead makes that test fail.

## Results

- **Vectors:** 60,000 strings for `{m}:{s:02}`, equal to Markless `formatTime(60m+s)`. The test recomputes them from the verbatim function source recorded in the vectors. `formatText` and `enumerateTexts` match all 60,000 exactly.
- **Guard vectors:** 30 records, of which 22 are refused. Refused inputs: NaN, ±Infinity, fractions, out-of-range values, and 1e21. -0 is accepted and formats as "0".
- **Width oracle:** Chrome 145.0.7632.6, faces pinned by sha256:
  - Lato-Regular: d636e468…
  - Inter-Regular (Dragon Sans): 40d692fc…

  `shapedMeasurer` over the WASM GlyphShaper equals Chrome on 120,000/120,000 exhaustive widths (Lato and Dragon Sans, 16px, DPR 1) and 288/288 boundary widths (2 faces × 14/16/20px × DPR 1/2/2.625/3 × 12 strings).
- **Plants:**

  | Plant | Result |
  |---|---|
  | padDropped | flips 10,000 vectors |
  | minutesWrapped | flips 56,400 vectors |
  | textDomainUnchecked | flips all 22 refused guard records |
  | widthCacheByLength | caught on Dragon Sans, 0 on Lato; each caught string has the length of an earlier string with a different Chrome width (59,936 of 60,000 differ from the first string of their length) |
  | kerningDropped (shaping) | caught |
  | wholePixelPositions (shaping) | caught |

  `advanceNot16_16` and `doubleAccumulation` change no width on these single-run strings, so the test does not list them.
- **Lato kerning:** Lato has GPOS `kern` but kerns no digit/colon pair. Dropping kern changes 0 Lato widths, against 18,557 of the 60,000 Dragon Sans widths. Lato has one width per length: 2038, 2632 and 3226 LU.
- **Repertoire:** U+0030 to U+003A only, with no whitespace, no bidi controls, and Script Common only.
- **Verify:**
  - install: ok.
  - typecheck: ok.
  - layout:subset: 0 violations.
  - capture, then `--check`: all current.
  - the two new tests: 24/24.
  - text:gate: 1260/1260.
  - `pnpm test`: 1863/1863 across 86 files.
  - native:gen: no diff after commit 1f719f7c.
