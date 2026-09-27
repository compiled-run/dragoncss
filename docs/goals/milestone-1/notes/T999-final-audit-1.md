# T999 final audit, round 1

Judge, 2026-09-27, claude-code. Decision: **not_complete**, full_outcome_complete: false.

Oracle met on re-run: 792/792 twice, 116 layout fixtures (111 hand-written) pass at 1 device px, reports byte-identical, regeneration clean, all 2137 exact rows link to passing cases. Two binding T039 items fail: auto-margin-overflow-cross-start is a registered deviation whose fault changes none of the 258 outputs (dead branch, false claim), and there is no record the owner has seen the iOS caveat cap. The Linux-lane clause is not met but descoped by the recorded owner-delegated decision, so it does not block. Next: retire the entry, record the caveat cap, re-audit.

## Oracle mapping
- **pnpm_test_green:** pass: 20 files, 792/792 in both runs of a /tmp clone after removing build outputs (/tmp/t999/test1.log, test2.log); typecheck exit 0; lockfile a3d7207d unchanged. The clone's git remote made platform.test.ts:172 fail until removed.
- **at_least_100_box_flex_fixtures_pass_compile_dragon_layout_chrome_at_1_device_px:** pass: 116 layout fixtures (111 hand-written, 5 generated), 137/137 fixtures, 258/258 cases (ltr 163, rtl 95), failed 0, unsupportedCodes []; 8671/8671 nodes exact at 1/64 px; chrome-dual boxes 8685/8685; GATE_DEVICE_PX = 1 unchanged since eb0f442 at DPR 1
- **report_generated:** pass: report.json 12,889,090 B, index.html 2,952,982 B, summary.md 4,260 B, byte-identical across two pnpm test runs and parity:report
- **exact_entries_name_passing_fixtures:** pass: 2358 rows, 2137 exact, 0 rows with a non-passing proof case; 7 rows hand-traced; 0 iOS paint rows exact
- **lane:** Oracle lane: macOS-captured Chrome 145.0.7632.6 (darwin-arm64) plus the platform-free Dragon layout lane; Linux lane unavailable (not run). The goal title's 'on a Linux lane' is not met.

## Rulings
- **1_auto_margin_overflow_cross_start:** Retire it. Independent check: autoMarginOverflowSpec changes 0 of 258 vector outputs. Multi-line lines are as big as their largest item (css-flexbox-1 §9.4 step 8), so flex.ts:696 only runs at available === 0, where both readings agree. No support claim is invalidated, because profile rows derive from passing cases and all 9 nodes stay exact. Only the registry's claim that Chrome departs from the spec is false. Keep the nodes as ordinary fixture coverage.
- **2_min_max_end_margin:** Legitimate. p4, p6 and p7 agree under both readings (checked by hand) and stay asserted exact as frame-relative controls. x5 and x6 already existed at 45d7b83 and no fixture changed. The engine fault moves p9 32, p5 20, x5 6 and x6 20 px absolute (14 px within its frame). The CSS 2.1 §8.3.1 'min-height of zero' wording is correct.
- **3_baseline_source_matrix_min_width_0:** Legitimate. Every matrix column source (.fc) and the hand-written .c container has width 100px and flex-shrink 0, so min-width auto versus 0 is layout-neutral in Chrome. The change only avoids Dragon's flex-intrinsic-wrap-column refusal (intrinsic.ts:52, still covered by engine.test.ts), matches the T039 probe shape and came before any Chrome run. Selections are printed and committed; 50/50 pass.
- **4_m2_verify_line:** Not met today (3/4). It is met once ruling 1 retires the entry and no contradicted entry remains.
- **5_linux_lane:** Not met and must be reported as not met. The owner delegated the decision on 2026-09-27; decisions.md scopes milestone 1 to macOS Chrome plus the platform-free engine, and the oracle signal does not need Linux. So this clause alone does not force full_outcome_complete false, but the completion receipt must carry the not-met statement and the PM must annotate the title. The lane id 'linux-dragon-layout' actually runs on macOS; summary.md says so.
- **6_design_principles_1_to_4:** Covered. #1: 15 tree fixtures with declared per-state case counts and a stateCollapse fault. #2: every state generated as a case, with an rtl case for every tree case (case-count test MF1). #3: inherited text styles on text nodes (dropInheritedText fault) and 55 compiler-made anonymous boxes. #4: chrome-dual exact on boxes, values and channels (colourOnly fault).
- **7_likely_misfires:** Support without a test: none (profile-proof test plus trace). iOS runtime before the Linux proof: none (no Swift, Kotlin or Xcode files; T004 blocked). Screenshots or AI deciding: none (no screenshots; drawings labelled evidence). Fixtures narrowed: none (fixture list only grows at every commit since eb0f442; no fixture file modified 45d7b83..HEAD).

## Evidence
- /tmp/t999/typecheck.log: tsc -b exit 0
- /tmp/t999/test1.log and /tmp/t999/test2.log: 20 files, 792/792, exit 0 (clone remote removed)
- /tmp/t999/report.log: '137/137 fixtures pass, 116 layout (111 hand-written, 5 generated; 258 cases, 258 pass; ltr 163/163, rtl 95/95); layout 8671/8671 nodes exact at 1/64 px ...; failed 0; unsupportedCodes []; platform darwin-arm64; linux-chrome (linux-x64): unavailable (not run)'
- cmp of /tmp/t999/out1, out2 and out3: report.json, index.html and summary.md identical
- /tmp/t999/regen.log: regeneration exit 0, git diff exit 0, no untracked files
- git diff --name-only 45d7b83..HEAD (749 files) lies within T038 allowed_files; no git remote; working tree holds only PM docs (18 entries, unchanged by this audit)
- Fixture list only grows since eb0f442; no fixture modified 45d7b83..HEAD except the 2 added
- /tmp/t999/all.mts: autoMarginOverflowSpec changes 0 of 258 vector outputs
- /tmp/t999/mm.mts: minMaxEndMarginSpec moves p5 20, x5 6, p9 32 and x6 20 px (absolute)
- Hand traces: web margin-top@block/ltr 162/162; ios flex-grow@flex-row/ltr 18/18; ios line-height@text-in-anonymous-block/ltr 1/1; web justify-content:center@flex-column-single-line/rtl 6/6; web position:absolute@absolute-in-block/ltr/cb-ltr 14/14; web background-color:<hex-color>@paint/ltr 105/105 (exact); ios same key caveat. All cases pass both lanes and link back through caseRows.
- platformRules keyed darwin-arm64 only (packages/layout/src/platform-rules.ts); 'Times' only in block-ua-divs expected and emitted files
- T034 nested-rule silent drop closed by C6 (s4a.test.ts:210)
- Named tests present for f1-f5, d, c plus its negative, T005 recs 2, 3, 5 and 6, T039 M3 and M4 (s5.test.ts, dist.test.ts, parity.test.ts)

## Missing evidence
- The auto-margin-overflow-cross-start entry is still registered with a fault that fails nothing (binding item 'every spec-reading fault fails').
- No record that the owner has seen the iOS caveat cap: 221 caveat rows (iOS paint and overflow) proved only by Chrome computed-value cases (binding Profiles item).
- No Linux Chrome run: Linux baselines, the Linux default font string, and arm64 against x64 are all unmeasured (accepted as not met under the recorded scope).
- The macOS half-down metric rule is inferred from CoreText, not traced in source (the rule is still measured with exact nodes).

## Required board updates
- Record this T999 receipt as not_complete and keep the goal active.
- Add a Worker task T040 with the worker_package above, then a Judge re-audit task that re-checks only the changed items plus a full pnpm test and report cmp.
- PM: record in docs/decisions.md that 221 iOS rows (paint and overflow) are capped at caveat with Chrome-only computed-value proofs until the simulator lane exists. Put this in front of the owner and record the acknowledgement, or record that it was surfaced and is awaiting acknowledgement.
- PM: annotate goal.md and the state.yaml goal.title with the recorded scope, e.g. 'Linux lane: workflow written, not run (docs/decisions.md 2026-09-27)', so the completed title does not claim a Linux run. The final receipt must state the Oracle lane sentence verbatim.
- PM: note that platform.test.ts:172 ('no remote') fails whenever a git remote exists and hardcodes /opt/homebrew/bin/git. It will turn pnpm test red the first time the owner adds a remote. It is owner-visible, not a milestone blocker.
- PM: consider committing the board docs (state.yaml, goal.md, decisions.md, notes) before the final re-audit so the audited scope decision is in history. This needs no push.
