# Handoff: where milestone-2-proof left off (2026-09-29)

Read this first, then AGENTS.md ("Landing work" is binding), then state.yaml and the notes it names.
The local session that ran this board has stopped. Every local branch is pushed to origin under its own name. Nothing is in a /tmp worktree any more: do not look for /tmp/dragon-* paths named in the notes; check out the origin branch instead.

## The board lags reality

state.yaml says `active_task: T094` and lists many tasks as queued that have landed. Reconcile it first (a PM board update, `docs/goals/**` only, straight to master after `git pull --rebase origin master`):

| Task | Landed as |
|---|---|
| T094 / T007 P5 device lanes | #10 |
| T022 casc-logical | #22 |
| T043 ns-tree | #24 |
| T113 grid G0 | #23 |
| T029 on-device shim replay | #26 |
| T075 P6a-g glyph sampler (the P6a-g part only) | #27 |
| T100 INL-U | #13 |
| T101 DTXT-0 | #15 |
| T103 G-IMP4 | #14 |
| T104, T105, T106 G-P, FLT-P, WM-P corpora | #16 |
| T109 SKIA-0 | #19 |
| T086 SKIA-AA | #20 |
| T110, T111 review fixes | #17, #18 |
| T088 dist README | #1 |

## Open PRs: finish these first (steps 4 to 7 of Landing work)

1. **#28 `css-esc`** (CSS escapes, notes/CSS-ESC.md). Checks green. One finding is unanswered: comment 4139548267 (`escapes.ts:21`, `\17fpan` folding to `span`). Macroscope itself marks it "No longer relevant as of 30984491". Confirm that commit fixed it (ASCII-only case folding), reply `Fixed in 30984491` in the thread, rerun `pnpm pr:review 28`, and merge with `--match-head-commit`.
2. **#29 `txt1c-wiring`** (T038 fonts wiring Phase B, part 1 of 2, notes/T038-txt1c-wiring-b.md). Three unanswered findings:
   - 4139886043 `css/at-rules.ts:37`
   - 4139886047 `project.ts:469`
   - 4139886049 `css/values.ts:116`: `checkSubstitution` calls `featureOf` without the `FamilyKeyContext`, so a substituted pinned `sans-serif` gets `font-family:<family-list>`. Pass the font context through.

   Fix each one, reply to each, and loop until clean. After it merges, open part 2, **`txt1c-wiring-parity`** (stacked on it; fixtures, web-only lane, regenerated outputs): merge origin/master into it and regenerate the outputs, don't hand-merge them.
3. **#25 `pr/v1a-engine-values`** (T090 V1 Phase A split, notes/T009-value-model-v1.md). The PR shows CONFLICTING, and Macroscope skipped its correctness check. Merge origin/master (36 commits behind), regenerate the generated outputs to a fixed point, then run typecheck and test, push, and run the review loop. Then open **`pr/v1b-compiler-values`** (stacked on v1a) the same way. `pr/v1-value-model` and `v1-value-model` are the pre-split originals; they are for reference only, don't land them.

## Pushed branches not yet in a PR (in dependency order)

All were committed and verified on the host when they were pushed. Each needs `git merge origin/master`, regenerated outputs, typecheck and test, then a PR.

- **`native-gallery`** (T037, notes/T037-gallery.md). 1 commit behind master; ready for a PR.
- **`tw-sweep`** (Tailwind 4.3.3 sweep and ratchet, notes/TW-SWEEP.md). 1 behind; ready for a PR.
- **`lane-speed`** (notes/LANE-SPEED.md). The receipt is a draft; its device timings were never filled in. It needs a device run (see "Needs the Mac") before a PR.
- **`inl-bf`** (T057, notes/T057-inl-bf.md). 36 behind.
- **Grid G1a**, three stacked PRs in this order: `grid-g1a` → `grid-g1a-engine` → `grid-g1a-fixtures` (notes/T-grid-g1a.md). Each is 15 behind. `grid-g1a-all` is a backup; don't land it.
- **`wm0-horizontal-tb`** (T107/T108, notes/T107-wm0.md). 150 behind, so expect conflicts in generated files. Regenerate them; never hand-merge.
- **Stack on the old `pr/v1-value-model` base (bb87f427).** Land these only after #25 and v1b merge, and rebase each onto master at that point:
  - `ems-paint-seams` (T071 EMS, notes/T071-ems.md). It changes no output and goes first.
  - Then, stacked on ems:
    - `bg2` (T074, notes/T074-bg2.md);
    - `pnt1` (T072 radius);
    - `pnt2-engine` → `pnt2` (T073 transforms);
    - `p6a-dash-ref` → `p6a-dash` (T075 dashed and dotted borders, notes/T008-p5-review.md).
  - `pnt1-shadow` and `pnt1-effects` (same commit) are **WIP, not verified**; so is `p6a-promote-wip`. Finish them or fold them in before any PR.
  - `size-ar` (T050, notes/T050-size-ar.md) and `anim-a2-translate` (T062, notes/T062-anim-a2.md) sit on the same base. Their device step is pending. size-ar still owes the native-support.ts `STYLE_FIELDS` hunk, which waits on EMS.
- **`v2a-value-model` / `v2a-probes`** (T026 V2a; same commit). 52 behind; comes after V1.
- **Obsolete; don't land:**
  - `integration`, `t016-p5-device-lanes`, `wip/local-master-integration`: the old local integrator. Its content landed through PRs #5, #6, #8, #10 and others.
  - `form0-control-data`, `inl-probe`, `repl0-image-data`, `txt1n-shim-bridge`, `txt1s-shaping-core`, `determinism-scale`, `ns-tree`, `casc-logical`: superseded by merged PRs. Check with `git log origin/master..<branch>` before deleting.
  - `feat-background-shorthand-pre-rebase`: a backup.

## Needs the Mac (cloud agents cannot do these)

Device lanes need the iOS simulators and Android emulators on the owner's machine (`/tmp/device-lease.sh pnpm run parity:lanes -- --run-host --run-device`). Env: `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`. Pending device steps:
- lane-speed timings;
- size-ar (verify 8);
- anim-a2 (54,588 rt lines on device);
- the P5 device step for WM-0's 4 cases and for grid G1b;
- T018 north-star lane;
- T084 TXT1a-2.

Do all the host work, land what needs no device, and record each device step as pending on the board. A branch whose receipt requires a device run does not merge without it.

## Next new work after the queue above

In the board's order:
1. T030 MQ-a Phase B;
2. T027 V2b;
3. T058 INL1a (after T026 and T057);
4. T083 TXT1a-1;
5. T063 SELD-R1;
6. T051 REPL-a;
7. T052 FORM-a;
8. T078 OVFL;
9. T097 YUI-1 (motion fixtures, notes/T096-motion-research.md).

T999 (audit of checkpoints 1 to 3 on both platforms) is the finish line.
