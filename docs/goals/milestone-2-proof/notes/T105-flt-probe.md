# T105 FLT-P: Chrome float corpus and Blink notes (Worker receipt note)

- **Branch.** `flt-probe`, in worktree `/tmp/dragon-flt-probe`, based on origin/master `43da1152`. Not pushed.
- **Commits.**
  - `15db7232`: the script, README.md and blink-notes.md.
  - `00a6de66`: the corpus, from `node --conditions=dragon-internal scripts/capture-float-probe.ts`.
- **Binding spec.** T098-grid-flt-wm-spec.md, section FLT-P.

## What was delivered

- **`scripts/capture-float-probe.ts`.** A new script modelled on `capture-inline-probe.ts`. It uses the pinned Chrome 145.0.7632.6 through `packages/parity/src/chrome.ts`, unchanged. `--check` recaptures everything and exits 1 unless every file is byte-identical.
- **`docs/research/float-spike/probe/*.json`.** Six family files:

| File | Cases | Size |
| --- | --- | --- |
| family1-placement | 50 | 696 KB |
| family2-clearance | 32 | 539 KB |
| family3-bfc | 31 | 415 KB |
| family4-lines | 39 | 650 KB |
| family5-height | 25 | 360 KB |
| family6-shapes | 32 | 1,356 KB |

  - 209 cases, each in 24 environments (DPR 1, 2, 3 and 2.625 × ltr and rtl × `horizontal-tb`, `vertical-rl` and `vertical-lr`). That is 5,016 records, 3.9 MB in total.
  - Each record holds the border boxes, per-line rects, and computed `float`, `clear` and `display` (plus the `shape-*` properties in family 6).
  - Each case also has two lists: `modeDivergent`, where the line-relative geometry differs from `horizontal-tb`, and `dprDivergent`, where it differs from DPR 1.
- **`docs/research/float-spike/README.md`.** How to run the script, the files, the record format and the measurement method.
- **`docs/research/float-spike/blink-notes.md`.** Every spec anchor read at tag 145.0.7632.6 and tied to cases:
  - exclusion_space.cc :233, :341, :639, :671
  - floats_utils.cc :31, :40, :64, :193, :212
  - block_layout_algorithm.cc :159, :187, :1660, :2222
  - line_breaker.cc, including `ShouldPushFloatAfterLine` at :3626
  - shapes/*

## Verification

- `pnpm install`: up to date.
- `pnpm typecheck`: exit 0.
- `pnpm test`: 84 files, 1839 tests passed.
- **Capture, then `--check`.** All six files were reported `same` (byte-identical) and the script exited 0.
- **Only new paths.** The commits add only `scripts/capture-float-probe.ts` and `docs/research/float-spike/**`.
- **Size.** 3.9 MB, under the 8 MB limit that T098 sets for G-P.

## Findings for FLT-0 to FLT-4 and FLT-WM (details and file:line in blink-notes.md)

1. **Lengths truncate to device LU.** They become `trunc(L·DPR·64)/(64·DPR)` CSS px (`layout_unit.h:126-131`), so placement decisions change with DPR:
   - b-fixed-fractional: a 150.01px box fits beside the float at DPR 1 and does not at DPR 2, 3 or 2.625.
   - l-edge-20p01: a 20.01px float shortens the third line at DPR 2 and 3 but not at DPR 1.

   The float engine must work in device LU.
2. **The top-edge rule compares against float tops only** (`floats_utils.cc:31`; `exclusion_space.cc:321`).
3. **Too-wide floats** take the first opportunity that is either full width at the origin or wide enough (`exclusion_space.cc:657-659`).
4. **Floats are laid out against the container's available size**, not the free gap (`floats_utils.cc:101`).
5. **A float inside a line** stays on that line only if its margin box plus the inline-end edges of its open ancestors fits. The fit is retried without trailing spaces (`line_breaker.cc:3637-3648`).
6. **Line and float intersection is strict half-open** (`layout_opportunity.cc:71-76`).
7. **Shape lines step down 1px at a time** when a line does not fit beside a shape (`inline_layout_algorithm.cc:1306`).
8. **`<hr>` is a BFC root** through the UA sheet's `overflow:hidden` (`html.css:112-122`).
9. **Writing modes.** Line-relative geometry is identical across all three writing modes for 187 of 209 cases. Of the 22 that differ:
   - 16 are by design: 15 asymmetric shapes (shape coordinates are physical) and one physically sized orthogonal float.
   - 1 is a vertical baseline effect with no float involved.
   - 5 come from odd-leading rounding in `vertical-lr`, 4 of them only at DPR 2.625.

## Suspected deviations for FLT to reproduce or rule on

1. **A float inside a line box moves one device px in `vertical-lr` when the half-leading is odd.** The float lands at x 1 at DPR 1 and 0.333 at DPR 3, where the spec position is 0 (`inline_layout_algorithm.cc:887-892`). Cases: l-tall-lines, l-odd-leading-23.
2. **Max-content ignores floats before a plain block child** (`block_layout_algorithm.cc:445-449`). Case: h-max-content-block.
3. **A self-collapsing cleared block** puts the next block at 32, not 37 (`block_layout_algorithm.cc:2866-2872`). FLT-1 should confirm this. Case: c-self-collapsing-margins.
4. **Computed `float` is kept where it has no effect.** It stays `left` on flex and grid items and on `display:contents`, and `inline-start`/`inline-end` stay as computed values.

## Deviations from the task text

- **Writing modes.** The corpus runs all three writing-mode axes and records a line-relative comparison per case. The spec asks for the same axes as G-P; the comparison is extra.
- **Image shapes.** These are listed only in README.md and blink-notes.md, as the spec says, and are not captured.
- **Plants.** None were added. T098 lists plants for G-P only.
