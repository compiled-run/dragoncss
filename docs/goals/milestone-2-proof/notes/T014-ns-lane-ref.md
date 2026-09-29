# T014: NS-REF, the north-star lane reference on the Chrome side

Worker receipt note, 2026-09-28. The spec is WP2 in notes/T010-north-star-plan.md. It was done at base 8df7574 (master plus
docs-only commits) instead of 2d2e4dd.

- **Branch and worktree:** `ns-lane-ref` in `/tmp/dragon-ns-ref`.
- **Commit:** e1068c5, not pushed.

## What was built

- **Case manifest.** `examples/music-player/tools/lane-manifest.ts` derives the cases, and `lane/manifest.json` records the
  derivation. The test checks that the two are equal. There are 20 cases per platform and DPR:
  - **Free states** (8): `libraryStatus` x `isPlaying`, each at scroll top and at scroll end.
  - **Forced states** (5): one per `:hover` or `:focus` selector parsed from `styles.css` (4 hover, 1 focus). They are
    captured in the steady state at scroll top.
  - **Frames** (7):
    - `album-spin` paused and playing, at 0 and 5000 ms;
    - the library opening and closing, at 250 ms;
    - playing until 5000 ms, then paused, read at 6000 ms.
- **Matrix.** iOS 390x844 at DPR 2 and 3; Android 412x915 at DPR 2, 2.625 and 3. That makes **100 captures**.
- **`snapshot.ts`.** Additive only: `FreeStateId`, `FREE_STATES` and `freeStateHtml`. All existing exports are unchanged.
- **`capture-chrome.ts`.** Rewritten. It launches one Chrome per DPR through `launchChrome(d)`, and runs `zoomGuard` at each
  DPR. `chromeArgsAt` is recorded in the pixel manifest. None of the three was changed. Per capture it writes:
  - a PNG from CDP `Page.captureScreenshot`;
  - a JSON dump with:
    - the boxes;
    - the computed values of the used properties plus the core longhands;
    - per-text-node line rects and line `start`/`end` offsets (single-code-unit Range rects grouped by line);
    - the platform fonts from `CSS.getPlatformFontsForNode`;
    - the animation clocks;
    - the forced target.
- **Pixel manifest** (`chrome/pixel-manifest.json`). It records:
  - the sha256 and size of every file;
  - the Chrome and Playwright versions;
  - the flags and zoom guard per DPR;
  - the context options;
  - the raster rule: each side is `ceil(css x DPR)`, so 1081.5 rasterizes to 1082 and 2401.875 to 2402;
  - the font key: `f2115f3b…`, from Helvetica, Helvetica-Bold, LucidaGrande and ZapfDingbatsITC on darwin-arm64;
  - the cover sha256s.
- **Covers.** `tools/cover-png.ts` writes 1280x720 RGB PNGs with no dependency. It has integer pixels, its own fixed-Huffman
  deflate with a fixed match search, and its own CRC-32 and Adler-32. Each cover is about 39 KB. Chrome is served the PNGs
  (`image/png`).
- **Test.** `packages/parity/test/north-star-reference.test.ts` has 11 tests and needs no Chrome. It checks:
  - the manifest equals the derivation;
  - the counts;
  - the pinned version, flags and zoom guard;
  - every file is listed and present, and nothing else is under `chrome/`;
  - the sha256s;
  - the raster size of every PNG;
  - the dump identity;
  - that line offsets partition each text node;
  - the font key;
  - that the covers regenerate byte-identically and inflate to the generator's pixels.
- **README.** It documents the matrix, the cases, the virtual clock, the per-capture contents, the pixel manifest, the raster
  rule and the font-key staleness rule.

## Findings

- **Timeline stopped for determinism.** A playing-state PNG was not byte-identical from run to run. This happened even though
  `pause()` and `currentTime = 0` were set right after load; the dumps were identical. A running transform animation that was
  composited even briefly rasterizes differently.
  - **Fix, inside capture-chrome.ts:** CDP `Animation.setPlaybackRate(0)` before navigation, so the document timeline never
    advances. All times are set explicitly through `currentTime`.
  - **Result:** three runs in a row were byte-identical.
- **Forced target rule.** The target is the first subject match whose declared properties change under the pseudo-class.
  - For `.library-song`, the first song is `.selected`, and `.selected` wins over `:hover` (same specificity, later rule).
    The target is therefore `library-song-2`, captured with the library open (`FORCED_BASE_STATE`).
  - `input[type='range']:focus` only sets `outline: none` and changes nothing. It falls back to the first match, recorded
    as `changed: false`.
- **Pause frame.** The pause-at-5000 ms frame is read at 6000 ms, so every transition has finished. The record stays at
  90deg (`matrix(0, 1, -1, 0, 0, 0)`), which shows that pausing keeps the phase.
- **Old layout removed.** The old `chrome/iphone-390x844-dpr3` and `chrome/android-412x915-dpr2.625` directories (18 files)
  are replaced by `chrome/<platform>-<w>x<h>/dpr-<d>/`, which the spec allows. `coverStandIn` (SVG) stays exported but is
  unused.

## Deviations

1. **Where the manifest code lives.** The manifest code is `tools/lane-manifest.ts`, and `lane/manifest.json` is its derived
   output, not a `lane/manifest.ts`.
   - **Reason:** the example's tsconfig (`composite`, include `tools`) is not in allowed_files. A `lane/*.ts` imported by
     tools would fail `tsc -b` with TS6307.
2. **How the test loads the example modules.** The parity test loads the example modules with a run-time `import()` and
   local types.
   - **Reason:** the parity project does not reference the example project. A static import would fail with TS6307.
3. **Line breaks inside collapsed whitespace.** A code unit with no rect joins the current line, so the lines partition
   `[0, length)`. P5's grouping rule is not specified beyond "single-code-unit Range rects grouped by line".

## Verification

All commands ran with the env prefix.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass. |
| `pnpm typecheck` | Pass. |
| `pnpm test` | Pass: 50 files, 1186 tests, none skipped. |
| `pnpm run north-star:capture` x2, then `git diff --exit-code examples/music-player/chrome examples/music-player/covers` | Exit 0. The zoom guard passed at 2, 2.625 and 3. |
| `pnpm run north-star:check`, then `git diff --exit-code examples/music-player/dragon/north-star-check.json` | Exit 0 (713 errors, 70/291, unchanged). |
| `du` of chrome and covers | 27 MB plus 160 KB, about 27.7 MB, which is under 50 MB. |
| Printed counts | 20 per platform and DPR, equal to the derivation. |
| `git diff --name-only 8df7574..HEAD` | Inside allowed_files. Under `packages/`, only the new test changed. `package.json` is unchanged. There is no remote. |
