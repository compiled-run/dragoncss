# Milestone 2 proof: HarfBuzz gate, wave-1 integration, P5 device lanes, north star on device

## Objective

Resume the milestone-2 work that stopped on 2026-09-28 when the weekly limit was hit, and carry it through the three checkpoints the owner was given:

1. **HarfBuzz gate (TXT1-0).** WASM HarfBuzz, at Chrome 145's pinned revision, plus the Zig shim reproduces Chrome's LU widths on all 620 spike paragraphs.
2. **P5 device lanes.** The full fixture suite on master passes on real iOS simulators and Android emulators, at every device pixel ratio. The pixel check against Chrome is included.
3. **North star on device.** The music-player demo renders end to end on iPhone and Android, compared against Chrome.

If all three pass, the approach is proven. If one fails, the board records exactly where, and the goal goes back to the owner before more work is put in.

Work runs in parallel lanes. Each writing lane has its own git worktree and a disjoint write scope. All merges into master go through one serial integrator lane.

## Original Request

"setup a new /goal and continue this work. Also maximum parallelization please." The attached screenshot shows the previous session's three checkpoints. It also shows the TXT1-0 HarfBuzz gate Worker and the wave-1 integrator, both killed by the rate limit, and the owner's answer on text selection and editing: "Dragon builds it, native feel (Recommended)".

## Intake Summary

- **Input shape:** `recovery`, continuing an existing plan. The plan lives in:
  - docs/goals/milestone-2 (T015 note §2–§5);
  - docs/research/text-plan-summary.md;
  - docs/research/coverage-roadmap.md;
  - docs/decisions.md.
- **Audience:** the owner, then framework authors (Markless first).
- **Authority:** `requested`.
- **Proof type:** `test` plus `demo`.
- **Completion proof:** all three checkpoints met on both platforms and audited by T999.
- **Likely misfires:**
  - Parallel lanes collide on shared files (inline.ts, text.ts, package.json, the generated files).
  - Generated files are hand-merged instead of regenerated.
  - One platform finishes and the other becomes "later".
  - A HarfBuzz mismatch gets tolerated instead of going back to the owner.
  - The north star is "verified" by screenshot judgement instead of numbers.
- **Blind spots:**
  - The integration worktree is mid-merge (feat-block-elements), with half-regenerated files.
  - The P5 stop depends on the decisions.md edits being on master.
  - The north star needs many roadmap packages (CASC, UNIT, CALC, BG, PNT, ANIM, INL1/2, FORM-a and more), so checkpoint 3 is the longest pole.
  - The simulators and emulators are shared machine resources, so two device-lane runs cannot overlap.

## Goal Oracle

`pnpm test` is green on master, plus:

1. **TXT1-0 gate:** 620/620 spike paragraphs, with WASM HarfBuzz and the shim equal to Chrome's LU widths. The build also succeeds for the iOS xcframework and the Android .so.
2. **P5:** every device lane passes, with `parity:lanes` reporting no stale or not-run lane on either platform:
   - iOS simulator at scale 2 and 3;
   - Android emulator at 2, 2.625 and 3;
   - layout-vectors-device, device-frames, device-applied, device-lines and device-pixels.
   - All of this runs over every fixture on master at P5 start, with derived counts, and the raster plant is caught.
3. **North star:** `examples/music-player` runs end to end on the iPhone simulator and the Android emulator. Its frames, applied values and pixels match Chrome under the same lane rules as P5. Any workaround is proven the same way before it is labelled.

A lane blocked on owner tooling is reported as not met, never counted as passing.

## Goal Kind

`recovery`

## Current Tranche (parallel lanes)

| Lane | Tasks | Worktree | Writes |
|---|---|---|---|
| PM | T001: land the uncommitted docs on master, record the owner's selection and editing ruling, fix O2, close milestone-2 T015 | main checkout | docs only |
| Integrator | T002: finish the block-elements merge, then cascade-var, units, wpt-breadth, engine-linebreak and P4 (with M1 and M2), then fast-forward master | /tmp/dragon-int | merges and regeneration |
| Text | T003: TXT1-0, the HarfBuzz Zig shim and gate | /tmp/dragon-hb | new files only (vendor/harfbuzz, packages/text-shaper or equivalent) |
| Fonts | T004 (Judge spec), then T005: TXT1-C, `@font-face`, the font manifest and matching | /tmp/dragon-fonts | new files only |
| Engine | T006 (Judge spec), then T009: the V value model, after P4 merges | /tmp/dragon-v | engine files that P5 does not touch |
| Device | T007: P5, after T002 lands P4, with T008 reviewing it | /tmp/dragon-p5 | P5 files, per T015 §4 |
| North star | T010 (Judge gap plan), then Worker packages | per package | per package |

Only one lane at a time may boot simulators or emulators. The PM serialises device use.

## Non-Negotiable Constraints

- **Everything in AGENTS.md and docs/decisions.md holds:**
  - no claim without a test;
  - numbers decide pass or fail;
  - never loosen tolerances or skip tests;
  - Dragon owns its engines;
  - the TypeScript engine is the reference;
  - generated engines are never edited by hand.
- **Generated files are regenerated at merge, never hand-merged.** Relaxed-tier files (headers, digests, report formatting, notes) may change with their inputs; the receipt lists them.
- **`inline.ts` and `text.ts` are strictly serial:** P4, then engine-linebreak, then P5, then V, then INL1, then TXT1.
- **HarfBuzz stays upstream, unmodified,** at fa2908bf16d2ccd6623f4d575455fea72a1a722b. Any gate mismatch stops the lane and goes back to the owner.
- **Stay inside this repo:** no pushes, no remotes, no publishing. Markless is read-only.
- **Do not touch `design/`,** which is the owner's unrelated homepage work.
- **Environment for every verification:**

  ```text
  JAVA_HOME=/opt/homebrew/opt/openjdk@17
  ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
  DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt
  ```

## Stop Rule

Stop only when T999 proves all three checkpoints on both platforms. A HarfBuzz gate mismatch, or a P5 failure that needs an owner ruling, blocks only its own lane; the other lanes continue.

## Canonical Board

`docs/goals/milestone-2-proof/state.yaml`. History: `docs/goals/milestone-2/` (T001–T015).

## Run Command

```text
/goal Follow docs/goals/milestone-2-proof/goal.md.
```
