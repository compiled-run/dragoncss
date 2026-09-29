# Grid probe corpus (G-P)

A frozen Chrome 145.0.7632.6 (Playwright 1.58.2) record of CSS grid layout, for the G1a engine and later grid packages. The
Blink reading behind it is in [blink-notes.md](blink-notes.md).

## Regenerate and check

```
node --conditions=dragon-internal scripts/capture-grid-probe.ts            # writes probe/*.json
node --conditions=dragon-internal scripts/capture-grid-probe.ts --check    # recaptures and compares byte for byte
node --conditions=dragon-internal scripts/capture-grid-probe.ts --plants   # checks the plant and deviation pins, no Chrome
node --conditions=dragon-internal scripts/capture-grid-probe.ts --only=fr  # one family
```

## Contents

2,258 cases: 258 hand-written cases in 12 families, and 2,000 seeded random grids in 8 shards of 250. Each case runs in 24
environments: DPR 1, 2, 3 and 2.625, ltr and rtl, horizontal-tb, vertical-rl and vertical-lr. The files total about 4.5 MB.

| File | Cases | Scope |
|---|---|---|
| placement.json | 20 | sparse and dense auto-placement, spans, negative lines, named lines and areas, implicit tracks before and after, order |
| sets.json | 20 | ranges and sets, the truncating uint32 share, fr leftover, maximize, span grouping, gutters in spans, weighted flex spans |
| fr.json | 17 | fr restart, flex sum below 1, indefinite fr, the min/max redo cases |
| minmax.json | 16 | minmax, fit-content, auto minimums and their clamp, max-content minimums |
| gutters.json | 8 | fixed, %, calc and fractional gaps; % row gaps with an indefinite block size; auto-fit collapse |
| alignment.json | 108 | every justify-content, align-content, justify-self and align-self keyword, overflow, auto margins |
| intrinsic.json | 16 | inline-grid, min/max/fit-content, float, abspos, padding and border, stretch into min size, maximize under max size |
| percent.json | 9 | % tracks definite and indefinite, % item sizes, margins, padding and relative offsets |
| abspos.json | 11 | absolutely positioned items in grid areas, mid-set lines, auto lines, lines beyond the grid, alignment |
| subgrid.json | 9 | column, row and two-axis subgrids, gap deltas, padding and margin extra margins, nesting, orthogonal |
| auto-repeat.json | 14 | auto-fill and auto-fit counts (floor, ceil, 1px floor), collapse, named lines |
| baselines.json | 10 | first and last baselines, shims, spanning items, synthesized baselines, orthogonal items |
| random-00..07.json | 2,000 | seeded random grids (mulberry32; the generator is in the script) |

## Format

Each file has a header (Chrome version, `envs`, `units`) and `cases`. A case holds its `note`, the wrapper size `cb` (logical
inline x block px), the exact grid `html`, the item `labels` in document order, `env` (for each entry of `envs`, an index into
`distinct`) and `distinct` (the distinct results).

A result is `{ c, cols, rows, items }`:
- Boxes are logical `[inline-start, block-start, inline-size, block-size]` in the case's writing mode and direction, in raw
  LayoutUnits of the zoomed layout: 1/(64 x DPR) CSS px. Chrome lays out at CSS px x DPR with 1/64 precision, so every
  getBoundingClientRect value is a whole number of these units. The script rounds and throws if a value is more than 0.05 units
  off (the float32 noise is under 0.005).
- `c` is the container border box within the wrapper border box. `items` are the item border boxes within the container
  border box.
- `cols` and `rows` are `getComputedStyle(grid).gridTemplateColumns` and `gridTemplateRows` as Chrome serializes them (6
  significant digits).

To get physical boxes back, with W and H the physical width and height of the outer box:
- horizontal-tb: x = inline-start (ltr) or W - inline-start - inline-size (rtl), y = block-start.
- vertical-rl: x = W - block-start - block-size; vertical-lr: x = block-start. In both, y = inline-start (ltr) or
  H - inline-start - inline-size (rtl), width = block-size and height = inline-size.

## Page setup

- Every case wrapper is `position:absolute; top:0; left:0`, so all cases overlap at the page origin. This keeps the float32
  client rects small: on a tall page they lose up to half a unit at DPR 3.
- The wrapper carries `writing-mode`, font-size 10px and line-height 1, and has a fixed logical size (400 x 300; 300 x 200 for
  random cases). The root carries `direction` and Ahem, as in the other probes.
- The grid is the wrapper's only child. Hand cases use logical properties, so one case means the same thing in every writing
  mode.

## Notes on the data

- Most hand cases have 4 distinct results, one per DPR: their logical results match across direction and writing mode. The
  cases that differ are expected: left/right keywords, self-start/self-end, baselines and orthogonal items in vertical modes,
  and inline-grid containers whose line-box position rounds differently at DPR 2.625.
- Random cases average about 7 distinct results.
