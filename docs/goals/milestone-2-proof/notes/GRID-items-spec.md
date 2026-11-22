# GRID-items: replaced elements and buttons as grid items, as Chrome 145 lays them out

Judge-approved package (2026-11-21). It is the prerequisite of REPL-r1 (an img whose src is set at run time,
notes/IMG-dynamic-src-spec.md on branch cw/img-dynamic-src, commit a8d57d4dd5), whose three grid-placed Markless images
need the engine to lay out a replaced grid item. This slice covers static images only; the runtime src follows on
cw/img-dynamic-src.

## Objective

Lay out these as grid items, as Chrome 145 does:
- a replaced element with a build-time src (img; video and iframe share the path);
- a block `<button>` (the button-block control);
- a flex `<button>` (a plain flex box).

## Engine (packages/layout)

- Grid items become LayoutNode (a box, a control box or a replaced leaf).
- layoutItem sizes a replaced item through replacedSize, with the grid area as its available and percentage size.
- A replaced item's column contribution is replacedContribution (Blink ComputeMinAndMaxContentContributionForReplaced), fed
  into the existing contributionFor. CalculateIntrinsicMinimumContribution has no replaced path ("TODO(ikilpatrick): All of
  the below is incorrect for replaced elements"), so no transferred size suggestion is invented.
- justify-self and align-self `normal` on a replaced item is fit-content in both axes, not stretch (grid_item.cc
  AxisEdgeFromItemPosition, `is_replaced`), and an explicit `stretch` is kStretchExplicit. grid.ts selfEdge treated normal as
  stretch for every item.
- A button-block control is laid out through layoutContents with its control facts, so its contents stay centred when the row
  stretches it.
- grid-control stays refused by name for range, fieldset, legend and slider-thumb.

## Analyzer (packages/dragon)

refuseGridItem (analysis/computed-checks.ts) accepts a `<button>` whose blockified display is block or flex. Range and fieldset
grid items stay refused.

## Chrome 145 measurements

The parity lane's headless shell (chromium_headless_shell-1208, Playwright 1.58.2), Ahem 10px, buttons with `appearance: none`,
`border: 2px solid`, `padding: 1px 6px`, in a grid of one 300px column and one 40px row (60px where noted), at DPR 1, 2, 2.625
and 3. Every value below is the same at the four ratios except where a ratio's own snapping shows (2.625: 35.81 for 36).

1. **An auto-width flex `<button>` grid item, under normal and under stretch:** 300 by 40 under both (`justify-self` and
   `align-self` normal, and both stretch). It fills its area; Chrome does not shrink it to its content as it does in block flow
   (T156, where the same button is 36 by 16). Under `justify-self: start` it is 36 wide, its content size. In an `auto` column
   it is 300 wide too. So a flex button in a grid is the plain flex box the engine lays out, and T156's stop does not apply.
2. **A block `<button>` grid item stretched taller than its contents:** in a 60px row it is 300 by 60 and its 20 by 10 content
   sits at x 140, y 25 inside it: centred in the block axis, (60 - 10) / 2. Stretched to 70px by a taller sibling in an `auto`
   row, the button is 100 by 70 and its content sits at y 30, (70 - 10) / 2. A block button also fills its column under normal
   alignment (300 wide), unlike in block flow. For comparison, a flex button stretched to 60px keeps its content at the top and
   stretches it (54px tall), as any flex container does.

## Refused, by name

- grid-control: a range, fieldset, legend or slider thumb as a grid item (engine), and range and fieldset grid items
  (analyzer, `is a grid item`).
- grid-replaced: a replaced grid item with baseline self-alignment, which no fixture proves.

## Proofs

- Fixtures on chrome-dual and linux-dragon-layout, in both directions, at DPR 1, 2, 2.625 and 3: grid-replaced-* (replaced
  group) and grid-button-* (controls group), plus reject-grid-control-* for the refusals that stay.
- The grid corpora (grid-corpus-checks, grid-corpus-hand, grid-corpus-random-0) stay at 0 LU difference.
- Planted faults: `replacedGridItemStretches` (normal stretches a replaced item; fails a grid-replaced fixture) and
  `gridButtonContentNotCentred` (a block button grid item is laid out as a plain box; fails the stretched block-button fixture).

## Stop conditions

- Chrome shrinks an auto-width flex button grid item under normal or stretch (it does not: measurement 1).
- An existing grid, replaced or controls vector or capture changes by more than 0 LU.
- The reviewed size passes about 150 KB (split: replaced first, buttons second).
- A replaced grid item needs baseline alignment, min-width or min-height keywords, or abspos to pass a fixture (refuse the case
  by name instead).
- A fact would have to be re-derived outside the analysis or the engine, or a tolerance, check or fixture loosened.
