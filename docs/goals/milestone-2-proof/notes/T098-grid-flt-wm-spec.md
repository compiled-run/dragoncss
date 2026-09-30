# T098: GRID, FLT and WM spec (Judge, recorded by PM)

**Order.**
- GRID first: a new grid.ts, parallel to the inline chain.
- FLT second: needs the block.ts and inline.ts window after INL2.
- WM last: cross-cutting, runs alone after FLT-2.
- None of them is on the checkpoint-3 path.

**Binding rule.** grid.ts and the float/exclusion code are written in logical inline/block offsets, with a writing-direction parameter that is horizontal-tb only until WM. The engine is physical today (box.ts Edges, Frag x/y). WM logicalizes the rest once, using Blink's WritingModeConverter (geometry/writing_mode_converter.cc:71, :117).

**Where the numeric WPT files are blocked** (origin/master web.json):

| First blocker | Files |
|---|---|
| grid-column: 1 (almost all from the linked /css/support/grid.css, which matches no element) | 151 |
| grid-template-columns | 158+ |
| writing-mode | 81 + 47 + 39 |
| float | 63 |
| font shorthand | about 48 |

**Native.** The engine owns layout; views get physical frames. The only new native drawing is WM's rotated and upright glyph runs, drawn by Dragon on both platforms.

## Start-now packages

All five work on disjoint scopes, need no device lease, and never push.

**G-IMP4** (worktree /tmp/dragon-imp4, branch imp4-dead-rules)
- The WPT translator drops a style rule only when css-lite `matches` returns a definite `false` for every selector in its list, on every element, per snapshot state.
- Keep the rule if any selector is unknown or only partly matches. Also keep rules with pseudo-elements, dynamic pseudo-classes, or unevaluated at-rule wrappers. Never rewrite a selector list.
- Record the dropped selectors in the sidecar.
- `--chrome-all` confirms `querySelectorAll(sel).length == 0` for each dropped selector on the original page. A nonzero result refuses the test with `translate:dead-rule-live`.
- Allowed files:
  - packages/wpt/src/{translate,css-lite,chrome,snapshot,run}.ts
  - packages/wpt/test/dead-rules.test.ts (new)
  - packages/wpt/test/data/dead-rules/**
  - packages/wpt/test/translate.test.ts (append)
  - expectations/web.json and web.reftest-layout.json (regenerated)
  - snapshots/** (regenerated)
  - packages/wpt/README.md (numbers and a "Dead rules" section)
- Verify:
  - install; typecheck; test
  - `wpt:run --target web --chrome-all` gives 0 dead-rule-live
  - `wpt:update-expectations` then `wpt:check`: no pass becomes a fail; record the delta and the top reasons
  - dead-rules tests with plants dropLiveRule, dropUnknownSelector, dropFirstStateOnly
  - the 20 reftest-layout verdicts are unchanged
- Stop if: a file outside the allowed list is needed; selector support beyond the cascade guard would be needed; Chrome's querySelectorAll is nonzero and the translator is not at fault; an existing pass changes; verification fails twice.

**G-P** (worktree /tmp/dragon-grid-probe, branch grid-probe)
- A Chrome 145.0.7632.6 grid corpus, written by scripts/capture-grid-probe.ts with a `--check` mode, plus docs/research/grid-spike/blink-notes.md.
- Families: placement (sparse and dense, spans, negative, named lines and areas, implicit), sets and the truncating share, fr and leftover, minmax/fit-content/auto, gutters, every alignment keyword, intrinsic container sizes, %, abspos areas, subgrid, auto-fill/fit, baselines.
- About 2,000 seeded random grids.
- Records item border boxes, gridTemplateColumns and gridTemplateRows, and the container.
- Runs at DPR 1, 2, 3 and 2.625; ltr and rtl; horizontal-tb, vertical-rl and vertical-lr.
- The Blink notes carry the GR1-GR18 rounding points at file:line (grid_track_sizing_algorithm.cc :282, :514, :753, :763, :775, :888, :1001, :1031, :1087, :1280, :133; grid_layout_algorithm.cc :587, :871, :3102, :328), 27 plants each with its catching case, and the 4 suspected deviations.
- At most 8 MB, sharded if needed.
- Allowed files: the script (new), docs/research/grid-spike/**, and a pointer appended to grid-plan-summary.md.
- Verify: install/typecheck/test; capture then `--check` byte-identical; only new paths.

**FLT-P** (worktree /tmp/dragon-flt-probe, branch flt-probe)
- A Chrome float corpus, written by scripts/capture-float-probe.ts with `--check`, plus docs/research/float-spike/blink-notes.md.
- Blink anchors: exclusion_space.cc :233, :341, :639, :671; floats_utils.cc :31, :40, :64, :193, :212; block_layout_algorithm.cc :159, :187, :1660, :2222; line_breaker.cc; shapes/*.
- Families:
  1. placement and the top-edge rule
  2. clearance, including inline-start and inline-end
  3. BFC roots beside floats
  4. line opportunities with Ahem
  5. container height
  6. shape-outside basic shapes (image shapes listed only)
- Records border boxes, per-line rects, and computed float and clear, at the same DPR, direction and writing-mode axes as G-P.

**WM-P** (worktree /tmp/dragon-wm-probe, branch wm-probe)
- A Chrome writing-mode corpus, written by scripts/capture-writing-mode-probe.ts with `--check`, plus docs/research/writing-mode-spike/blink-notes.md.
- Blink anchors: writing_mode_converter.cc; constraint_space_builder.h :49-81, :142; length_utils.cc :372/:471; harfbuzz_shaper.cc :241, :460; orientation_iterator; layout_text_combine.cc.
- Families:
  1. block flow per vertical mode
  2. orthogonal flows and the fallback inline size
  3. flex
  4. abspos static positions
  5. inline line boxes with Ahem sideways
  6. text-orientation and text-combine-upright
  7. screenshot samples of rotated glyphs
  8. legacy computed values
- Runs across all 5 modes, ltr and rtl, and 4 DPRs.
- The notes also carry the native rotated-run drawing plan and Ahem's vmtx/VORG.
- If Chrome 145 rejects sideways-rl or sideways-lr, record that and drop those cases.

**WM-0** (worktree /tmp/dragon-wm0, branch wm0-horizontal-tb; merges after T094 and T022)
- Compiler support for the writing-mode family, accepting only values Chrome computes to horizontal-tb (the legacy lr, lr-tb, rl and rl-tb, proven by a dual computed check).
- text-orientation and text-combine-upright are accepted as inert.
- Vertical values are refused with `DRAGON_UNSUPPORTED_VALUE:writing-mode`.
- Allowed files:
  - css/properties/writing-mode.ts (new)
  - css/properties.ts (appended aggregates)
  - test/writing-mode.test.ts (new)
  - seams.test.ts (retarget the family-order pin only)
  - fixture-groups/writing-mode.ts and one registration line in fixtures.ts
  - fixtures/writing-mode-*.html
  - regenerated new outputs, profiles and web.json
- Verify:
  - install/typecheck/test
  - existing expected files unchanged
  - parity:report and dpr-report failed 0
  - profile:rows adds only the declared rows
  - native:gen gives no diff
  - WPT refusals only shrink
  - plant verticalAcceptedAsHorizontal is caught
- Stop if: an existing output changes; a legacy value computes to something other than horizontal-tb (drop that value); a file outside the allowed list is needed.

## Later packages (Judge receipt has the details)

- **GRID:** G0 (compiler; after T094 and T022), G1a (grid.ts engine; after T090, T050, T026, G0 and G-P), G1b (device), then G2-G5 (auto-fill, baselines, abspos areas, subgrid), G-INL (after INL2), G-WM.
- **FLT:** FLT-0 (compiler), FLT-1 (exclusions; after INL1a/INL2 in the block.ts window), FLT-2 (per-line widths in inline.ts), FLT-3 (device), FLT-4 (shapes), FLT-WM.
- **WM:** WM-1a (engine logicalization, outputs byte-identical) and WM-1b (vertical modes and orthogonal flows), run alone after INL2 and FLT-2; WM-2 (native rotated runs), WM-3 (upright text, CJK, shim TTB direction), WM-4 (combine and sideways), WM-5 (vertical twins).
