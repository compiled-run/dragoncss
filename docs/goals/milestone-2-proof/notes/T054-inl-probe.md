# T054 INL-P: inline probe corpus (Worker note)

- Worktree `/tmp/dragon-inl-probe`, branch `inl-probe`, BASE 41cc750, commit ee305987 (local only; not pushed).
- Spec: notes/T044-inl-spec.md §3 INL-P.

## Delivered

- **`scripts/capture-inline-probe.ts`** (new).
  - It imports `packages/parity/src/chrome.ts` unchanged, so Chrome is pinned to 145.0.7632.6.
  - It captures 162 Ahem-only cases at DPR 1, 2, 3 and 2.625, in ltr and rtl.
  - It writes `docs/research/inline-spike/probe/family{1..6}-*.json`.
  - `--check` recaptures and exits 1 unless every file is byte-identical.
- **Recorded per case:**
  - line box top and height, from an inline-level abspos marker at the line top;
  - baselines, from a 0x0 inline-block marker, kept only when inserting it moves nothing;
  - per-leaf Range client rects;
  - `getClientRects` and `getBoundingClientRect` of inline boxes, `<br>` and atomics;
  - computed styles;
  - for paint order, screenshot pixel samples.
- **`docs/research/inline-spike/README.md`:** the method, the format and the case index.
- **`docs/research/inline-spike/blink-notes.md`:** file:line at 145.0.7632.6 for every required topic, each matched to case ids.

## Key rules (details and citations in blink-notes.md)

1. **Metrics come only from inline boxes** (the strut, and every open tag even when empty) in standards mode.
   - Text items and `<br>` add none.
   - A `<br>` uses its parent box's text top and height, so its own font-size and line-height are ignored.
   - Sources: logical_line_builder.cc:359-376, :408-449.
2. **Half-leading.**
   - The ascent-side half-leading is floored to a whole device px, and the descent side gets the rest (line_utils.cc:32-41).
   - Font ascent and descent are rounded to whole device px (font_metrics.cc:111-112), and this happens after zoom, so at DPR N it is in device px.
   - Cases: f1-*; f1-number baseline 10 / 10.5 / 10.333 / 10.286.
3. **Breaks.**
   - The ASCII break table is Blink's FillAscii (character_property_data_generator.cc:433-471), plus the hyphen-before-digit rule (text_break_iterator.cc:204-215).
   - **Correction to T044 §1.2: Chrome does not break after `|`.** It breaks after `-` and `?` only.
   - Box boundaries are transparent: a break opportunity before a close tag moves after it (line_breaker.cc:3975-3983).
   - Atomics always allow a break before and after (:1127-1150).
4. **vertical-align:**
   - sub is `parent size/5 + 1` and super is `−(parent size/3 + 1)`, in LU (inline_box_state.cc:1281-1286);
   - a percentage is of the element's own line-height;
   - middle uses the rounded half x-height of the parent;
   - text-top and text-bottom are applied when the parent closes;
   - top and bottom are applied last, against the aligned subtree (:1150-1206, :1359-1418).
5. **Atomic baselines.**
   - inline-block uses its last line baseline. With no line box, or when it is a scroll container, the baseline is its bottom margin edge (logical_box_fragment.cc:14-62, block_layout_algorithm.cc:1448-1451, :3622-3647).
   - inline-flex uses its first baseline, in the order major, then minor, then the first item (flex_layout_algorithm.cc:80-142).
6. **Paint order is line by line**, with each box background painted before its descendants (box_fragment_painter.cc:1963-2006, inline_box_fragment_painter.cc:61-94). A later line's span background covers earlier-line glyphs (f4-overlap).
7. **`smaller` and `larger`** are ÷1.2 and ×1.2, even from keyword parents. `code` gets 13px only from a `medium` keyword under a monospace change (font_builder.cc:324-358).

## Open questions

Each is listed with its case id and none is guessed.

1. f2-in-span: after a DOM mutation, a span's `getClientRects()` drops the zero-width `<br>` piece. The corpus records the first-layout value.
2. Metric halves round down on macOS (f1-fractional; f1-normal at dpr 2.625). This is covered by the existing measured platform rule (decisions.md, platform-rules.ts), not by the Blink source.

## Rulings made by this Worker

- **Line assignment.**
  - If an item's two abspos gaps disagree, the item goes on the line whose box contains the centre of its first rect.
  - A space goes on the earliest line its gaps or rect allow, because a soft wrap never starts a line with a space.
  - With these rules, line texts are identical across all 8 environments for all 162 cases.
- **Unrecorded baselines.** A baseline is not recorded where the marker perturbs layout, and the reason is written in the record:
  - f1-negative-leading, where the marker's zero descent raises the line;
  - f4-wider and f5-stf-min, where the marker adds a break opportunity;
  - rtl pre-wrap hanging spaces, where the marker falls off the line.
- **Draft fixtures.** No draft fixture files. Each case's `html`, `style` and `width` are in the JSON.

## Verification

- `E pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`: passed on the second run, with 74 files and 1508 tests passed.
  - The first run under load average 50 hit one timeout: parity.test.ts "determinism (S5 (c))" at 120 s.
  - Rerun alone, parity.test.ts passed 237/237.
- `E node --conditions=dragon-internal scripts/capture-inline-probe.ts && ... --check`: exit 0, all six files "same".
- `E git diff --name-only --diff-filter=MD 41cc750..HEAD`: empty. Every added path is under docs/research/inline-spike/ or is scripts/capture-inline-probe.ts.
- `E git remote -v`: **not empty.**
  - It shows `origin git@github.com:compiled-run/dragoncss.git` from the shared `.git/config`, which the main checkout also has.
  - This task did not add it and did not push.
  - Removing it is an owner action (remotes), so this item is reported and left alone.
