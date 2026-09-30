# T037: native gallery and the showcase fixture

Worktree /tmp/dragon-gallery, branch `native-gallery`, from origin/master 1211f422.

## What was built

- `pnpm run native:gallery [-- --cases <id>,<id>...]` (packages/parity/src/cli/gallery.ts, pure parts in packages/parity/src/gallery.ts,
  tests in packages/parity/test/gallery.test.ts). It writes packages/parity/out/gallery/index.html and img/{chrome,ios,android}/<case>.png.
  That directory is already ignored by `.gitignore` (`packages/parity/out/*`) and by `.macroscope/ignore.md` (the `out/` shape).
- Columns: Chrome 145.0.7632.6 at DPR 3 (launchChrome(3), zoomGuard, openPage, CDP Page.captureScreenshot, which is the
  parity:pixel-capture path); the iPhone 17 simulator (DPR 3); the dragon-smoke AVD (DPR 2.625). Device shots use runApp with the
  hold flag and onHold -> stableScreenshot, which is the capture-trust path in device-lanes.ts. Each OS screenshot is cropped to
  the root (rootOriginPx from the app's device record, size by the raster rule).
- Rows are labelled with the case id and its CSS features: the distinct `<property>:<value subset>` of the case's ios profile row
  keys (compiledFeatures), context dropped.
- The page says that text is set in Ahem until real fonts land, and that screenshots are evidence only.
- A new fixture group `showcase` (last in FIXTURE_GROUPS) with `showcase-player-card`.

## Rulings

1. **calc() and clamp() are not in the showcase fixture.** On origin/master both are refused: `reject-unit-calc` pins
   `width: calc(10px + 2em)` as DRAGON_UNSUPPORTED_VALUE ("calc() is a css-values-4 math function"). V1 (calc, min, max, clamp)
   is only on pr/v1a-engine-values (PR #25, open) and pr/v1b-compiler-values (no PR yet). The brief says "built only from
   features Dragon supports today", so that rule wins over the list. The card uses fixed px, flex-grow and a percentage width
   instead. Follow-up once V1b merges: add `calc()` and `clamp()` sizes to showcase-player-card (a small fixture edit plus the
   usual regeneration).
2. **Default rows: one case per layout fixture.** The brief says "all non-reject fixtures". A fixture's row is its initial
   left-to-right case, or its first case when it has none. That gives 184 rows, not 376 cases. `--cases` takes any layout case
   ids (rtl and tree states included), in the order given. Unknown or repeated ids are refused.
3. **Showcase rows come first**, then the other fixtures in registry order.
4. **Device choice:** VECTOR_DEVICES (iPhone 17, dragon-smoke), as the brief says. Chrome is shown at DPR 3 for every row. The
   Android column is at 2.625, its own DPR. All three are scaled to 400x300 CSS px on the page.
5. **Batches of 20 cases per app launch.** runApp's time budget is 180 s plus 3 s per case. With a hold and a stable screenshot
   per case, one launch of 184 cases could exceed it. Batches keep the proven budget and do not change runApp.
6. **Chrome shows the authored HTML**, the same rendering the pixel reference uses.
7. **Failure handling:** a device that fails to build, boot or run fills its column with the reason. Each missing or bad
   screenshot is listed under "Problems in this run" on the page. The page is always written, and the command then exits 1.
   Chrome failures are handled the same way, per case (PR #34 round 1, Macroscope 4140473637): an aborting Chrome
   failure lost the page and every other case's result, so a missing Chrome cell is recorded as a problem instead.

## Audit (AGENTS.md step 3)

- External input: `--cases` is parsed strictly (empty ids, repeats, unknown flags and non-layout ids are all refused). OS
  screenshots are decoded under a try, and the crop is bounds-checked. The device record comes through parseAppRecord (runApp).
  Every chosen case must have the same viewport.
- Error paths: each missing cell adds to problems, and the exit code is 0 only when every cell is an image and there are no problems.
- Subsets: the exit judgement covers every row and column.
- Cleanup: devices are released in `finally`, and Chrome pages and the browser are closed in `finally`.
