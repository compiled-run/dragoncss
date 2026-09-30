# CSS Grid in Dragon's engine: design summary (2026-09-28)

This summarises the design. The full plan, with Blink citations at 145.0.7632.6, rounding points GR1–GR18, the phased WPT lists and 27 planted faults, is in this session's transcript. Re-derive the detail when G0 starts.

## Key findings
1. **Dead rules block most grid tests.** 203 of the 475 numeric grid tests are blocked only by unsupported rules in shared WPT sheets (grid.css, alignment.css, positioned-grid-descendants.css) that match no element. The fix is IMP4: the importer drops rules that provably match no element, or the compiler gives such rules a warning tier. It is a small package in packages/wpt and should run first.
2. **`display: inline-grid`** is in about half the tests and needs INL2 (atomic inline boxes).
3. **The `font: <size>/<lh> Ahem` shorthand (FONTA)** blocks many text-free tests. It can be a compiler-only slice ahead of TXT1.
4. **Chrome sizes grid tracks in *sets*** (runs of identical tracks cut at item lines). Space is shared per set with truncating uint32 division, which is the largest 1/64 px risk. Dragon must build the same ranges and sets.
5. **Probable Chrome deviations** to register:
   - grid-maximize-no-max-redo;
   - grid-flex-no-minmax-redo;
   - grid-max-content-auto-min;
   - grid-default-self-overflow-unsafe.
6. **Subset limits:** no Math.max/min/abs, no string ops, no indexOf/includes. Integer helpers go in units.ts, derived line names are built by the compiler, and every sort needs a total-order comparator.

## Phases (numeric WPT tests unblocked at base)

| Phase | Scope | Tests |
|---|---|---|
| G0 | compiler, input and validator | 0 |
| G1 | placement, sets, the full sizing algorithm, gutters, alignment, intrinsic sizes | 89 |
| G2 | auto-fill and auto-fit | 5 |
| G3 | baselines | 5 |
| G4 | absolutely positioned grid areas | 46 |
| G5 | subgrid | 14 |

That is about 159 at base. Adding writing modes gives 348; floats, masonry and paint give about 436.

## Ordering
1. After P4.
2. After V1 (the value model).
3. After ALGN (self-alignment types).
4. The intrinsic.ts hunk after SIZE.
5. The block.ts hunk coordinated with INL1.
6. G4 before anchor-positioning P4.

Grid doesn't touch text.ts or inline.ts, so it runs alongside P5.

## Proof
- **Parity fixtures:** div + Ahem, rtl twins, exact at every DPR.
- **Chrome track sizes:** read back through `getComputedStyle(grid).gridTemplateColumns` via computedExtra.
- **Differential corpus:** 20k seeded track-sizing cases across TS, Swift and Kotlin.
- **Frozen Chrome corpus:** about 2,000 random grids.
- **Planted faults:** 27 (frLeftoverDropped, autoPlacementNotDense, spanGroupingFlat, sharePerTrackNotPerSet and others).

## Chrome grid corpus (G-P, 2026-09-28)
The frozen Chrome 145.0.7632.6 grid corpus is in [grid-spike/](grid-spike/README.md): 2,258 cases (258 hand-written, 2,000 seeded random) at DPR 1, 2, 3 and 2.625, ltr and rtl, and three writing modes, written by `scripts/capture-grid-probe.ts` (`--check` recaptures and compares; `--plants` checks the pins). [grid-spike/blink-notes.md](grid-spike/blink-notes.md) has GR1–GR18 at file:line, 28 plants with their catching cases, and the verdicts on the 4 suspected deviations. Three are confirmed (grid-maximize-no-max-redo in the block axis only, grid-max-content-auto-min, grid-default-self-overflow-unsafe). grid-flex-no-minmax-redo is refuted.
