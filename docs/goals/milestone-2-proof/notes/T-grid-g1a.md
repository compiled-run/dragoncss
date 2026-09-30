# GRID G1a: the grid layout engine (Worker receipt note)

Worktree /tmp/dragon-grid-g1a. Three stacked branches from origin/master 0c7c9cdb (which includes #16, the G-P corpus), each
committed as source then regenerated outputs. Nothing pushed.

| Branch | Base | Commits | Reviewable |
|---|---|---|---|
| grid-g1a | origin/master | 2196d590 source, 314f25fd outputs | 85 KB |
| grid-g1a-engine | grid-g1a | df45f800 source, 9b92d15c outputs | 135 KB |
| grid-g1a-fixtures | grid-g1a-engine | 00a44d1d source, 9e040fdb outputs | 25 KB |

(grid-g1a-all is the pre-split working branch, kept only as a backup; it is not for landing.)

## Scope (T098 GRID table and grid-plan-summary.md)

T098 defines G1a as "grid.ts engine" and G1b as the device step; grid-plan-summary.md defines G1 as placement, sets, the full
sizing algorithm, gutters, alignment and intrinsic sizes, with G2 auto-fill/fit, G3 baselines, G4 abspos areas, G5 subgrid,
G-INL inline-grid and G-WM writing modes after it. G1a here is exactly G1. The device step ran as the task asked (below).

## What changed

**grid-g1a: the input and the lowering.**
- `input.ts`: `display: 'grid'`; `LayoutStyle.grid` (GridContainerStyle: template repeaters with their repeat() counts kept,
  automatic tracks, explicit counts, auto-flow, dense, justify-items) and `LayoutStyle.gridItem` (resolved lines in both axes,
  justify-self). Both are required and `null` where unused (decisions.md, "Adding engine fields").
- `validate.ts`: boolean, array and nullable rules; grid shape rules (grid style iff display grid, a placement on every in-flow
  child of a grid container and nowhere else, not on the root, no flexible minimum, definite lines in order within ±1e7, explicit
  counts covering the template, anonymous grid items auto-placed).
- `layout.ts` zooms px track breadths and fit-content limits. The native harness decodes the new fields and the native emitter
  builds them with the translated constructors.
- `lower/grid-layout.ts` (new): computed track lists to repeaters, areas to explicit counts and implicit `<area>-start/-end`
  lines, and every item line resolved by the compiler as Blink's GridLineResolver does (integers, negatives, spans, named lines,
  named spans against the opposite line, areas, missing names). The engine sees only line numbers. Refused with
  DRAGON_LOWERING_FAILED: repeat(auto-fill/auto-fit), baseline and safe self-alignment, anchor-center.
- `ios-layout.ts`: text directly in a grid container becomes an auto-placed anonymous grid item.
- `analysis/context.ts`: new contexts `grid-container/<dir>` (container properties), `grid/<dir>` (items), `relative-in-grid`,
  `absolute-in-grid`, `text-in-grid-item/<dir>`, `text-as-anonymous-grid-item/<dir>`. G0's inert rows in
  `not-flex-container` are untouched.
- The engine refuses display: grid (LayoutUnsupported grid-layout) on this branch; the next branch replaces that.
- Migration: all 1,500 existing vectors gain `grid: null, gridItem: null` and nothing else;
  `packages/layout/test/tools/check-grid-input-additive.ts origin/master` reports PASS (30,564 styles), and catches a changed output
  and a non-null new field (planted, then restored).

**grid-g1a-engine: grid.ts and the differential test.**
- `grid.ts` (new, about 1,600 lines) ports Blink 145.0.7632.6 grid layout: the auto-placement cursor (grid_placement.cc, sparse
  and dense, locked items), ranges and sets (GridRangeBuilder, BuildSets, InitializeSets), the track sizing algorithm
  (ResolveIntrinsicTrackSizes with span groups and flexible groups, DistributeExtraSpaceToSets with unsigned 32-bit equal shares
  and float weighted shares, MaximizeTracks, ExpandFlexibleTracks in float32 with the leftover carried, StretchAutoTracks), item
  contributions (ContributionSizeForGridItem, the automatic minimum and its clamp, the -1px % margin basis of the measure space),
  content alignment (ComputeFirstSetGeometry), self alignment with auto margins (always safe), the GR15 second pass, container
  intrinsic inline sizes (ComputeMinMaxSizes), relative items, and the first baseline (GridBaselineAccumulator). It is written in
  inline/block terms and mirrors rtl at the end (T098 binding rule).
- `units.ts`: grid float and integer helpers (equalShare, fr share, leftover, intDiv, intMod).
- `GridFaults`: 20 seeded grid faults plus one spec-reading plant, on `Ctx.gridFaults`, reached only through
  `layoutWithGridFaults` (the harness, vectors and native corpora never see them).
- The G-P differential test (`packages/parity/src/grid-corpus.ts`, five test files run in parallel, about 32 s): every case of
  the Chrome corpus is compiled through Dragon (inline styles moved to class rules), laid out, and compared with Chrome's boxes
  exactly in raw zoomed LayoutUnits, in the 8 horizontal-tb environments (DPR 1, 2, 3, 2.625; ltr, rtl).

**grid-g1a-fixtures.** Seven fixtures, each in ltr and rtl: grid-placement, grid-named-areas, grid-fr, grid-intrinsic,
grid-alignment, grid-sizing, grid-nested (grids in grids, a flex item in a grid, grids as flex items, text in grid items and
anonymous grid items). All 14 cases pass both lanes and the DPR lane exactly.

## Results

**G-P differential test.** 2,258 cases x 8 environments = 18,064.
- 4,962 match Chrome exactly (hand families 1,256; random shards 870, 952, 952, 932).
- 6 are pinned known mismatches (below).
- 13,096 are refused, every one for a reason an out-of-scope package owns: inline-grid (G-INL), baseline alignment (G3),
  width min-/max-/fit-content (SIZE), auto-repeat (G2), abspos items (G4), subgrid (G5), writing-mode (G-WM), safe/unsafe keywords
  and anchor-center (ALGN), overflow: auto, float, aspect-ratio, calc() gaps (V1), contain. An unowned refusal fails the test.
- Plants: all 21 plant runs are caught (each case matches without the fault and mismatches with it). Four of the notes' catching
  cases show their fault only in getComputedStyle track sizes, which the test does not compare, so box-level random cases were
  found by searching the corpus: gutterNotInSpan rnd-0009, flexSpanEqual rnd-1415, spanGroupingFlat rnd-0081,
  frRestartMissing rnd-0207.
- Chrome deviation grid-maximize-no-max-redo (block axis): the engine matches Chrome on i-maximize-max-block and the spec-reading
  plant `maximizeRedoSpec` mismatches in all 8 environments. grid-max-content-auto-min and grid-default-self-overflow-unsafe are
  followed by construction, but their corpus cases are inline-grid, float or overflow: auto, which G1a refuses, so they stay
  unproven.

**Known mismatches (6), outside grid.ts.** rnd-0313, rnd-1606 and rnd-1834 at DPR 2.625 (ltr and rtl): 7.5px Ahem in a 6297 LU
line. Chrome fits a 6298 LU run because its line breaker compares against AvailableWidthToFit, the width plus LayoutUnit::Epsilon
(line_breaker.h:308). inline.ts breakLines has no epsilon; linefit.ts (the INL line breaker) has it. The details are pinned, so a
fix shows. This belongs to the INL lane, not G1a.

## Rulings (researched, decided)

- **Names resolve in the compiler.** Line names and areas are static (no auto-repeat in G1a), so the compiler ports Blink's
  GridLineResolver and the engine input carries only line numbers; the engine needs no strings. G2 (auto-repeat) must revisit
  this, since auto-repeat line names depend on the repetition count.
- **Repeaters stay unexpanded** in the input, because Chrome sizes each size of a repeat() as one set of n tracks (GR3, GR5):
  `repeat(3, auto)` and `auto auto auto` round differently.
- **Two fields, null when unused** (`grid`, `gridItem`), so existing vectors gain exactly two keys per style.
- **Grid plants are not EngineFaults.** Adding them there would change the native harness keys and the random native corpora;
  `Ctx.gridFaults` with `layoutWithGridFaults` keeps every existing output and harness unchanged.
- **Stable sorts with an index tie-break** where Blink uses std::sort (GR6: libc++ insertion sort keeps tied sets in order up to
  30 sets). Tied sets above 30 are a recorded risk; no corpus case has one.
- **Contexts.** display: grid is proven in block and flex-row contexts and as a grid item; a grid in a column flex container stays
  unproven (reject-display-grid now proves that refusal).

## Pinned tests retargeted (reason given)

- `validate.test.ts`: the "bad enum" example was `display: grid`, which is now valid; it is `display: inline-grid`.
- `vectors.test.ts` and `vectors/README.md`: the documented example has 43 fields (grid and gridItem, null).
- `reject-display-grid`: display: grid is supported in block contexts now; the fixture is a grid in a column flex container and
  expects DRAGON_UNPROVEN_CONTEXT.
- `reject-grid-justify-items`: justify-items: center is proven in grid containers, so on a block it is DRAGON_UNPROVEN_CONTEXT.

## Verify

(Filled in below after the final runs.)

## Findings for other lanes

- The Kotlin emitter mistranslates a local arrow function passed as a callback (`xs.map(localFn)` becomes `jsMap(xs, localFn)`,
  which does not compile); Swift is fine and layout:subset accepts it. grid.ts uses top-level functions instead. A subset check or
  a translator fix belongs to the translate lane.
- inline.ts breakLines lacks Blink's AvailableWidthToFit epsilon (see Known mismatches).
