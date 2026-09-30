# T106 WM-P: writing-mode probe corpus (Worker receipt note)

- **Branch:** `wm-probe` in /tmp/dragon-wm-probe, from origin/master 43da1152. Not pushed.
- **Commits:**
  - 91bff8d2: the script, README and blink-notes.
  - 5b112e83: the corpus, produced by `node --conditions=dragon-internal scripts/capture-writing-mode-probe.ts`.
- **New paths only:**
  - scripts/capture-writing-mode-probe.ts
  - docs/research/writing-mode-spike/{README.md, blink-notes.md, probe/*.json}
- **Blink source:** 145.0.7632.6 from the GitHub mirror (raw.githubusercontent.com/chromium/chromium/145.0.7632.6/...).

## Corpus

- **Coverage.** 193 Ahem-only cases in 8 families.
  - Each case runs in 5 writing modes × ltr/rtl × DPR 1, 2, 3 and 2.625, which is 40 environments.
  - The computed-value family runs under horizontal-tb and vertical-rl containers only, 16 environments.
  - That makes 6,568 measured environments.
- **Size.** 8.4 MB in 9 files, the largest 1.7 MB.
- **Compaction.** An entry identical to the DPR 1 entry is stored as `"=dpr1"`. Duplicate computed styles are dropped from DPR 2, 3 and 2.625 entries.
- **Sideways modes.** Chrome 145 accepts `sideways-rl` and `sideways-lr` (probe/support.json), so no mode was dropped. `-webkit-writing-mode` rejects both.
- **Families and case counts:**
  1. block flow: 17
  2. orthogonal flows and the fallback: 22
  3. flex: 30
  4. abspos static positions: 14
  5. inline line boxes with Ahem sideways: 27
  6. text-orientation and text-combine-upright: 30
  7. screenshot glyph grids: 5
  8. legacy and computed values: 48

## Key rules (details and file:line in docs/research/writing-mode-spike/blink-notes.md)

- **WritingModeConverter::SlowToPhysical** (writing_mode_converter.cc:71-105) matches every mode × direction. sideways-lr ltr has inline-start at the bottom.
- **The orthogonal fallback inline size** is min(ICB block-axis size, the parent's fixed height clamped by fixed max-height then min-height, content-box for border-box). A non-fixed padding falls back to the ICB. Sources: space_utils.cc:32-80, applied by constraint_space_builder.h:74-82 and :85-100. The orthogonal child's auto inline size is fit-content. Its min/max contribution is its laid-out block size (length_utils.cc:372-386).
- **Upright and mixed-CJK Ahem advance by the integer font height** round(0.8·S·N)+round(0.2·S·N) device px: 17.5px → 17 at DPR 1, 23.3px → 24. Ahem has no vhea, vmtx or VORG, so Blink uses height_fallback_ (harfbuzz_font_data.h:58, open_type_vertical_data.cc:265-276) and origin (advance/2, ascent) (:294, :326-327). Rotated glyphs keep their horizontal advance.
- **Upright runs** shape with HB_DIRECTION_TTB (harfbuzz_shaper.cc:241-251). The canvas rotation per run is set at :460-482, and mixed runs split on ICU Vertical_Orientation != R (orientation_iterator.cc:19-48, character.cc:95-99).
- **Baselines.** Vertical mixed and upright use the central baseline, and sideways uses alphabetic (computed_style.cc:2266-2270). Line-over is on the right in vertical-rl and vertical-lr (writing_mode.h:67-78), and on the left in sideways-lr.
- **`text-orientation` has no effect in sideways-*** (computed_style.cc:3205-3221, writing_mode.h:97-101).
- **`text-combine-upright: all`** only combines in vertical-*. The box is line-height × 1em (style_adjuster.cc:417-451), and content is scaled to 1.1em, or to 1em under an underline (layout_text_combine.cc:68-84, inline_node.cc:2302-2348). `digits` is rejected.
- **Legacy values.** lr, lr-tb, rl and rl-tb compute to horizontal-tb, which WM-0 may accept. tb and tb-rl compute to vertical-rl (css_parser_fast_paths.cc:1663-1671). Both are proven by computed style and by layout.

## Native rotation plan (WM-2/3/4)

- **Rotation matrix.** Blink rotates the canvas into line-relative space per text fragment (line_relative_rect.cc:19-75).
  - For vertical-rl, vertical-lr and sideways-rl: `(0, 1, -1, 0, L+O+B, O-L)`, a 90° clockwise turn.
  - For sideways-lr: `(0, -1, 1, 0, L-O, L+O+I)`, a 90° counter-clockwise turn.
  - Upright blobs are turned a further -90° about their origin (shape_result_bloberizer.cc:611-645).
- **Dragon keeps the T014 primitive:** `CTFontDrawGlyphs` on iOS and `Canvas.drawGlyphs` on Android (API 31). Each text fragment gets:
  - a save;
  - the engine-computed matrix, via `CGContext.concatenate` or `Canvas.concat` (Android row-major values given in the notes);
  - the existing horizontal glyph draw;
  - for upright runs, an extra rotate of -90° about the run origin, with engine-supplied TTB positions. `CTFontGetVerticalTranslationsForGlyphs` is never used.
- **Combine** draws horizontally, scaled by scale_x (layout_text_combine.cc:208-212).
- **Device lanes** compare against the family 7 glyph grids.

## Verification

- `pnpm install --frozen-lockfile` passed.
- `pnpm typecheck` passed (exit 0).
- `pnpm test` passed: 84 files and 1839 tests.
- The capture wrote the 9 files. `--check` reported `same` for all 9 in two runs, both exit 0: once before and once after the last script edit, which changed type imports only.
- The diff against base 43da1152 is only added paths (12 files).

## Open items (evidence only, not rulings)

- **Combined text.** Range rects inside a text-combine box do not match its painted position. WM-4 should use the screenshot evidence.
- **Flex.** An orthogonal item in a column flex container uses its max-content inline size (350) as its flex base, not the fallback (o2-flex-column-item).
- **Base drift.** origin/master has moved past 43da1152. The PM merges it before the PR.
