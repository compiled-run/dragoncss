# T104 G-P: Chrome grid corpus and Blink notes (Worker receipt note)

Worktree /tmp/dragon-grid-probe, branch grid-probe, from origin/master 43da1152. Commits: 970ed966 (script, notes, pointer) and
cc1d4a6c (corpus, regenerated output). Nothing pushed.

## Delivered
- `scripts/capture-grid-probe.ts` (new). It captures the corpus, `--check` recaptures and compares byte for byte, `--only=<family>`
  captures one family, and `--plants` checks the plant and deviation pins against the committed corpus without Chrome.
- `docs/research/grid-spike/probe/*.json`: 20 files, 4,501,212 bytes (8 MB cap).
  - 2,258 cases: 258 hand-written cases in 12 families (placement, sets, fr, minmax, gutters, alignment, intrinsic, percent,
    abspos, subgrid, auto-repeat, baselines) and 2,000 seeded random grids in 8 shards.
  - Each case runs in 24 environments: DPR 1, 2, 3 and 2.625, ltr and rtl, horizontal-tb, vertical-rl and vertical-lr.
- `docs/research/grid-spike/README.md`: the format and the page setup.
- `docs/research/grid-spike/blink-notes.md`: GR1-GR18 at file:line, 28 plants, and the 4 deviation verdicts.
- A pointer paragraph appended to `docs/research/grid-plan-summary.md`.

## Verify
- pnpm install: done. pnpm typecheck: exit 0. pnpm test: 84 files, 1,839 tests passed.
- The capture wrote all 20 files. `--check` then printed `same` for 20 of 20 (byte-identical).
- `--plants`: 28 of 28 plants and 9 of 9 deviation pins pass.
- The only changes are new paths plus the appended pointer in grid-plan-summary.md.

## Key findings
- **Units.** Chrome lays out at CSS px x DPR with 1/64 precision. Every client rect is a whole number of 1/(64 x DPR) px units,
  so the corpus stores exact integers.
- **fr uses float32** (TSA:1181, :1261, :1267). With 1fr 1fr 1fr over 100px, all three tracks are 2133 units, total 6399; a
  double implementation gives 2134 for the last. Dragon must use Math.fround throughout.
- **The equal share truncates in unsigned 32-bit division** (TSA:647), and the remainder flows to later sets. The computed
  gridTemplateColumns truncates set / track count (layout_grid.cc:296).
- **An abspos line in the middle of a set** gives the division remainder to the first tracks (grid_layout_utils.cc:251).
- **Center alignment truncates toward zero** (layout_unit.h:622): -3821 / 2 is -1910.

## Deviations
- grid-maximize-no-max-redo: confirmed, block axis only (i-maximize-max-block).
- grid-max-content-auto-min: confirmed (m-max-content-auto-min).
- grid-default-self-overflow-unsafe: confirmed (a-self-overflow-scroller, a-content-overflow-scroller).
- grid-flex-no-minmax-redo: refuted. The GLA:681-705 extra pass redoes flex rows with the clamped size (four cases match the
  spec).

## Differences from the spec note
- 28 plants rather than 27: frLeftoverFloat64 was added.
- Boxes are stored logical, in raw zoomed LayoutUnits, rather than physical CSS px. The README gives the exact inverse. This
  keeps the corpus near 4.5 MB and exact.
- Wrappers overlap at the page origin, to avoid float32 client-rect precision loss on tall pages.
- Two of the 15 spec anchors point at neighbouring functions:
  - GLA:328 is `ComputeSubgridMinMaxSizes`; `ComputeMinMaxSizes` is at GLA:270. Both are cited.
  - TSA:282 is the `ComputeUsedTrackSizes` header; `ComputeFirstSetGeometry` is at :157.
