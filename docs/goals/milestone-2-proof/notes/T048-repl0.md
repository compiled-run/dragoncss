# T048: REPL-0, image data and asset core (Worker note)

Worker note, 2026-09-28. Spec: notes/T045-repl-form-spec.md §3 P1, with rulings R1–R4 and R7.

**Where the work is:**
- Worktree `/tmp/dragon-repl0`, branch `repl0-image-data`.
- Base 41cc750, commit c63b0537. Local only; nothing pushed.

## What landed

**`packages/dragon/src/images/`** (new; core, so no Node built-ins and no `Math.round`-style rounding):
- **`sniff.ts`:** Blink's `ImageDecoder::SniffMimeType` order: GIF, JPEG, WebP, PNG, ICO/CUR, BMP, then AVIF (an ftyp brand of avif or avis). It needs at least 14 bytes, as Blink does.
- **`png.ts`:**
  - The chunk parse checks every CRC and IHDR validity. It reads PLTE, tRNS, sRGB, gAMA, cHRM, iCCP, cICP, acTL and pHYs.
  - `pngColourRefusal` implements R3.
  - `decodePng` returns unpremultiplied RGBA8 for bit depth ≤ 8, interlaced (Adam7) or not, with all five filters.
- **`jpeg.ts`:** SOFn (baseline, progressive, arithmetic), component count, APP2 ICC presence, and APP1 EXIF in both byte orders. The EXIF tags read are Orientation, XResolution/YResolution, ResolutionUnit, and PixelX/YDimension from the Exif IFD.
- **`natural-size.ts`:** R4, using the measured rule below.
- **`manifest.ts`:** R1.
  - `resolveImageSource` handles a data: URL, a src the asset map names, or a problem: `remote-image`, `unmapped-image` or `bad-data-url`, never an entry.
  - `imageEntry` and `buildImageManifest` produce entries sorted by src.
  - `manifestDigestInput` is the canonical JSON, as in fonts/manifest.ts.
  - `imageRefusal` names the owning package.
- **`faults.ts`:** the plants `ihdr-swap`, `exif-ignored` and `density-ignored`.
- **`check.ts`:** `compareNaturalSizes`, shared by the script's `--check` and the tests.

**`scripts/capture-image-data.ts`** (new):
- It uses `launchChrome`, `chromeArgsAt` and `openPage`, imported unchanged.
- It writes `packages/dragon/test/images/corpus/` (70 files) and `packages/dragon/test/images/chrome-145/`:
  - `natural.json`
  - `pixels.json` (full getImageData)
  - `probe.json`
- `--check` recaptures into a temporary directory and requires every file to be byte-identical. It also requires header natural size = Chrome on 64/64 images.
- `--plant` breaks 44, 7 and 4 pairs for ihdr-swap, exif-ignored and density-ignored respectively.

**UA keys `iframe` and `img[src]`** (the src is a data: PNG):
- They are in new tables `replacedKey{Specs,Computed,Longhands,Declared,Contexts,TextFonts,Unmodelled,Forced}`, appended after `systemColors` in both generated files.
- The existing tables are byte-identical: the diff is 165 added lines per file and 0 removed; `--compare` against the base reports 281 entries, 0 differ.
- Values: iframe declares a 2px inset border and has `overflow: clip` **forced**; img[src] equals the existing `img` key (overflow clip declared). Both have `overflow-clip-margin: content-box` unmodelled.

**Tests:**
- `packages/dragon/test/images/images.test.ts` (new, 52 tests).
- `packages/dragon/test/ua-elb2.test.ts` has 2 appended pins. Nothing was retargeted.

## Measurements and rulings (decision by research)

**M1. Natural size (R4): header = Chrome on 64/64 PNG and JPEG images.**
- PNG: IHDR, always. **pHYs is ignored:** 144 dpi gives 13x7.
- JPEG: Chrome applies Blink's `ExtractDensityCorrectedSize` (image_decoder.cc), then the orientation. The Exif pixel dimensions are the size only when all of these hold:
  - ResolutionUnit is 2 (inch);
  - the resolution is non-empty;
  - PixelX/YDimension are present;
  - round(physical x 72 / resolution) equals them on both axes.
- Measured cases:
  - 144 dpi with 24x16: 24x16;
  - with orientation 6: 16x24;
  - 96 dpi with 36x24: 36x24;
  - 144 dpi with no pixel size, a mismatched pixel size, or unit cm: physical 48x32.
- Orientations 5–8 transpose; 9 is invalid and ignored.
- `naturalSize` implements this with exact integers. R4 still holds: REPL-j must refuse or follow this rule. JPEG is refused as REPL-j in any case.

**M2. Decode (R3): the TS PNG decode equals Chrome byte for byte on 34/34 accepted PNGs**, which cover every colour type, bit depths 1/2/4/8, interlaced and not, and tRNS.
- **Finding:** Chrome keeps the decode **premultiplied**. WebCodecs `ImageDecoder` with `premultiplyAlpha:'none'` returns the same bytes as getImageData. (Headless Chrome 145 has no WebGL here, so the raw-upload route is unavailable.)
- So a translucent pixel in getImageData is the decode after a premultiply and unpremultiply round trip:
  - premultiply is SkMulDiv255Round;
  - unpremultiply runs in Skia's float32 raster pipeline: load x f32(1/255), times f32(1/alpha), clamp to 1, x 255, round half to even.
- That model reproduces Chrome on all 65,536 (colour, alpha) pairs x 3 channels (a scratch sweep). It is committed as test code, `throughCanvas` in images.test.ts; it is not in src, which keeps rounding out of src.
- Opaque pixels are compared with no model at all.
- **R3 is not falsified:** the decode is exact, and the only difference is canvas storage.
- **For REPL-a:** any on-device translucent-image comparison must apply the same premultiplied storage, or compare opaque and flat regions only (R8).

**M3. Refused PNGs, evidence only.** Chrome's decode compared with the raw decode, opaque images:
| image | max delta |
|---|---|
| gAMA 45455 alone | 0 |
| cHRM alone | 0 |
| iCCP (Chrome's own sRGB profile) | 0 |
| cICP 1/13/0/1 | 0 |
| gAMA + cHRM | 9 (218 bytes differ) |

- The refusal stays as ruled. The zero cases hold only for these particular sRGB-equivalent values, and REPL-c owns the general case.
- 16-bit PNGs are not decoded by TS.

**M4. JPEG decode, R3 input for REPL-j (note only, no test).** macOS ImageIO (via `sips -s format png`) against Chrome getImageData, on the Chrome-encoded 48x32 base JPEG:
- max channel delta **86**;
- 1581 of 4608 channels differ;
- 3027 are equal, 918 differ by 1, and 350 by 2; the tail sits at the sharp red block edge, which is consistent with differing chroma upsampling.

This supports the REPL-j ruling of a build-time transcode.

**M5. toBlob is byte-stable:** within one run (two encodes) and across runs (`--check`), for JPEG q 0.92 and WebP q 1. Chrome's JPEG embeds an APP2 sRGB ICC profile. The corpus reuses that profile as the iCCP payload.

**M6. Quadrant probe (R7): 405 cases** (5 fits x 9 positions x 3 ratios x DPR 2, 3 and 2.625), each read from a device-scale screenshot of a 120x88 img.
- **Method changed from four quadrants to an 8x8 cell grid.** Red encodes the column, green the row, and blue is 0 on a pure-blue background. Natural sizes are wide 160x80, tall 40x80 and square 64x64, so every cell boundary falls on a whole source px.
- **Why:** measured, Chrome's resampling moves interior cell boundaries by a sub-pixel phase: +0.5 device px at 9x upscale, and phases that vary per line at 2.625. Four quadrants gave errors up to 2 device px on the extrapolated axes.
- **How the rect is read now:**
  - Sizes come from both visible image edges, or else a least-squares fit of the interior boundaries.
  - Every fit but `fill` is uniform, so the axis with the longer baseline sets both sizes.
  - Starts come from a visible image edge, which is hard and unbiased, or else from the fit (`anchors` records which).
- **Result against the css-images-3 object-fit rect** (worst deviation, device px):
| | DPR 2 | DPR 3 | DPR 2.625 |
|---|---|---|---|
| size | 0 | 0 | 0.476 |
| edge-anchored start | 0 | 0 | 0.512 |
| line-anchored start | 0.300 | 0.500 | 0.606 |

  - The test requires every case to be within 1 device px (GATE_DEVICE_PX).
- **For REPL-a:** the 2.625 edge residue is Chrome snapping the destination rect to device px. For example, `wide none 50% 50%` has y 10.5 and Chrome paints 11. REPL-a's destination rect must reproduce that snap.
- **Missing precision:** line-anchored starts carry the resampling phase (≤ 0.61 device px). REPL-a should gate on edge-anchored axes where it can. The phase itself is evidence for REPL-f.

## Deviations (inside allowed_files)

1. **`decodePng(bytes, inflate)` takes the inflate function.** The spec says "through node:zlib". The existing boundary test in ua.test.ts forbids Node built-ins in packages/dragon/src, so the build-time caller passes `node:zlib` inflateSync (the script and the tests do). REPL-a's compiler host does the same.
2. **SVG is decided by the declared type,** not by bytes, which R2 would otherwise require. SVG has no signature, and Blink takes the SVG path only for `image/svg+xml`. Mapped files take the type from their extension (`typeOfPath`). Ruling: SVG refuses as **REPL-svg**, a new named follow-up package.
3. **BMP and ICO refuse as REPL-g.** The spec does not name them. Ruling: they are Chrome's other built-in raster decoders, and share REPL-g's pinned-decoder problem. Bytes that match no format refuse with package null, because Chrome shows a broken image.
4. **16-bit PNG refuses as REPL-c** (R3 lists 16-bit without a package). Chrome's high-bit-depth decode path is colour-pipeline work.
5. **The UA keys live in their own `replacedKey*` tables, not in `elementKey*`.** Adding them to the element-key tables would have broken the `elementKeyLonghands` `toEqual` pin in ua.test.ts, which is outside allowed_files. This follows the spec's "T017 separate-table style". iframe is not an ancestor context.
6. **The probe uses an 8x8 grid,** not four quadrants (M6).
7. **Unmapped relative paths are their own problem kind,** `unmapped-image`, next to `remote-image`. REPL-a decides whether both map to DRAGON_REMOTE_IMAGE.

## Verification

All steps ran in /tmp/dragon-repl0 with the env export.

1. `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`.
   - typecheck is clean.
   - The suite has 1562 tests. Three full runs, all at load averages 38–64, each failed only on 120 s timeouts, and every one passed on rerun:
     - run 1: 3 files failed, the 2 identified being `parity.test.ts` (determinism S5 (c)) and `native-compare.test.ts` (negative d);
     - run 2: the same 2 timeouts;
     - run 3: 1561/1562, the only failure the determinism timeout.
   - Rerun of the two files alone with `--testTimeout=900000`: 250/250 pass.
   - The determinism test also passes 237/237 on base 41cc750 and on this branch when run back to back. On its own it takes 275 s on base and 195 s on this branch: it is over 120 s under this load on base too, so the timeout is not caused by this package.
   - Throughput rule: a timeout under load is not a failure.
   - No `.only`, `.skip` or `.todo` was added.
2. Capture twice, then `git diff --exit-code packages/dragon/test/images`: clean.
3. `--check`: exit 0. The output is "byte-identical ... header natural size equals Chrome on 64/64". The tests prove decode 34/34 and the exact refusal list.
4. The three plants: each exits 1; the loop exits 0.
5. `ua:capture` twice, then `git diff --exit-code packages/dragon/src/ua`: clean.
6. `--check` passes (36 elements, self-consistent, light and dark). `--compare` against the base: 281 compared, 0 differ.
7. `parity:capture`, `profile:rows` and `north-star:check`, each with its diff: clean (north star 33/62 unchanged).
8. `git diff --name-only 41cc750..HEAD`: 87 files, all inside allowed_files.
   - The files: 8 in src/images, the 2 ua generated files, 3 captures, 70 corpus files, 2 tests and 2 scripts.
   - `git remote -v` lists `origin` (git@github.com:compiled-run/dragoncss.git). That is the main repository's existing remote, which every worktree shares. This package added no remote and pushed nothing.

## For the PM

- Record the rulings in deviations 2, 3, 4 and 7, and the M1 density rule, in decisions.md.
- **M2 matters to REPL-a Phase B:** Chrome's image pixels are premultiplied-storage values, so translucent image pixels on device must be compared through that storage model or excluded.
- **M6 gives REPL-a** a measured Chrome snap at fractional DPR (edges snapped to device px) that its destination rect must reproduce.
