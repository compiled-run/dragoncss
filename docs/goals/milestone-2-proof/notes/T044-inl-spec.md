# T044 Judge: INL1 and INL2 Worker packages

Judge, read-only, 2026-09-28. Read: this board's state.yaml and goal.md (Decision Rule, Throughput Rules); docs/research/coverage-roadmap.md (INL1/INL2 rows, wave plan, §3 merge order, §4 hotspot rules); docs/research/text-plan-summary.md; docs/decisions.md at 71dbdf4 ("Text strategy", "Text shaping", "Native glyph advances", "Dragon positions every glyph (PM, T014)", "Text selection and editing", tolerance 13); notes/T006, T012 (V2a §4 used as the template), T010 (§1 table, §2 order), T017 (ELB-2 keys), T025 (TREE, `href: INL1`), T033 (T011 Phase B gates). Code: master packages/layout/src/{inline,text,input,linebreak,linefit,index}.ts; master packages/dragon/src/{analysis/elements.ts, emit/native-support.ts:520-640, lower/native-program.ts, lower/ios-layout.ts}; /tmp/dragon-p5 (uncommitted P5 work): the inline.ts export diff, packages/parity/src/line-breaks.ts, native-support device-lines code; examples/music-player/{styles.css, snapshot.html}; the tests that pin span, `<b>` and inline refusals.

## 1. Findings that shape the packages

1. **P5's line-break export is `buildRun` / `breakLines`**, together with the `Char` / `Line` / `Run` types (P5 inline.ts diff, index.ts appends). Three callers re-derive lines from it:
   - P5's `packages/parity/src/line-breaks.ts` (`engineTextLines`, the host harness at :362 and :442);
   - the break-vectors CLI;
   - the native runtime (native-support.ts Swift :590-627 and Kotlin :1316-1358).

   The runtime assumes that every leaf's parent is its block container and that `run.ascent` is one baseline for every line. INL1's mixed fonts and inline boxes break both assumptions. So INL1 must replace the export, and every caller must switch in the same package, or device-lines and glyph placement diverge from the engine.
2. **linebreak.ts and linefit.ts are on master but unwired.** They are already inside the translator subset: `engineFiles()` lists every file in layout/src. They are not generated yet because nothing reaches them.
   - Master's `breaksAfter` breaks only after a space or U+200B.
   - The Ahem-covered set includes `- ? ! | } ) ,` and others. For these, Chrome 145 (Blink's ASCII table plus UAX #14) breaks differently, for example after `-`, `?` and `|`, and never after `/`.
   - So master is correct only because no fixture exercises these characters.
3. **Placing lines with linefit.fitLines as it is would be wrong across items.** Blink sums per-item LayoutUnit widths, which is what master's `width()` does. fitLines sums float per-code-point advances over the whole line. Its float accumulation is right only within one shaped item, which is TXT1a's concern. Its fit predicate (`fitsAvailable`: ceil to 1/64 px, compared with available + 1 LU) and its hanging-space rule are Blink's, independent of the item model.
4. **North-star inventory.** Every `span` and `a` in the demo is a flex item or absolutely positioned, so it is blockified (css-display-3 §2.7). That covers record-shine, the record markers, record-label, record-center, song-description, disclosure-text, and both links at wide viewports. None needs an inline formatting context.
   - The IFC is needed only by atomic inlines, which are INL2:
     - `.play-icon { display: inline-flex }` inside the blockified `button.play`, in every band;
     - `.youtube-disclosure a { display: inline-block }` in the max-width 640 band, which is the band that applies at phone widths.
   - Both `a` elements carry `href`. Chrome's `a[href]` has an unmodelled `text-decoration-line: underline` (T017), which needs TDEC.
   - So the checkpoint-3 path is V2a → INL1a → INL2, with INL-BF early. INL1b (inline box decorations) is off that path.
5. **Tag data exists only for span, a and a[href] (ELB-2).** It is missing for br, strong, b, em, i, code, small, sub, sup and label. `small`, `sub` and `sup` use `font-size: smaller`, and `code` uses the monospace medium-size behaviour. Both need captured values before the compiler can reproduce them.
6. **Pinned tests.**
   - `packages/layout/test/inline.test.ts:157` (`mixed-inline-font`);
   - `packages/wpt/test/translate.test.ts:84-85` (`<span>` refused);
   - `packages/dragon/test/tree.test.ts:257` (`span` as the unsupported element);
   - `packages/parity/test/line-breaks.test.ts` on P5 (buildRun/breakLines);
   - `packages/dragon/test/block-elements.test.ts:116`: the prefix of the supported-tags message. It holds if new tags are appended to `SUPPORTED_TAGS`.

## 2. Rulings (research-backed; the PM records them)

- **R1, split.** INL1 is not one safe slice. It mixes four risks:
  - Blink measurement unknowns;
  - UA data capture;
  - an input and line-model rewrite across engine, compiler, runtime and P5's harness;
  - Dragon-drawn inline paint.

  INL1 becomes five packages:
  - **INL-P**: a Chrome and Blink probe corpus, new files only;
  - **INL-U**: UA data for the phrasing tags, ua lane;
  - **INL-BF**: blockified phrasing elements, compiler only;
  - **INL1a**: the inline formatting core;
  - **INL1b**: inline box margins, borders and padding.

  INL2 stays one package.
- **R2, UAX #14 wiring.** INL1a wires linebreak.ts `lineBreakOpportunitiesWith`, run over the IFC's text content. Inline box open and close add no characters, `<br>` is U+000A (class BK) and atomic inlines are U+FFFC (INL2). It uses a constant initial `LineBreakStyle`:
  - `collapse`, `wordBreak: normal`, `overflowWrap: normal`, `lineBreak: auto`, `hyphens: manual`, `languageRules: cj-ideographic`;
  - the leaf's existing `textWrapMode`.

  INL1a also adopts linefit's `fitsAvailable` and `isHangingSpace` over per-item LU widths. Faults `noEpsilon` and the linebreak plants are threaded through `EngineFaults`.

  TXT1a owns:
  - HarfBuzz advances;
  - reshaping at unsafe-to-break points;
  - float accumulation inside an item, using fitLines' model;
  - the soft-hyphen advance (U+00AD is not an Ahem-covered glyph today).

  TXT2 owns:
  - non-initial word-break, overflow-wrap, line-break and hyphens;
  - `lang` resolving to Chinese, which INL1a refuses on elements with inline content.

  This amends T010's "the breaker is wired in TXT1". The reasons:
  - INL1a rewrites the break loop in any case, and wiring it twice would re-baseline the break vectors twice on the serial file;
  - master's space-only rule is wrong for Ahem-covered punctuation (§1.2).
- **R3, native lowering (T014 and P4 decisions).**
  - **No attributed strings.** No NSAttributedString, SpannableString, TextKit or StaticLayout, even though the roadmap row says "attributed runs".
  - **Text leaves.** Each text leaf stays one DragonTextView per platform:
    - it draws with `CTFontDrawGlyphs` on iOS and `Canvas.drawGlyphs` on Android;
    - it has its own font instance (family, and size from its FontSpec after V2a);
    - it takes per-line x positions and a per-line baseline from **one translated engine function** (working name `inline_placeLines`). That function returns each line's top and baseline and, for each leaf piece, its code point range, x, width and content top, all in LU.
  - **One source for the lines.** The runtime, the expected dump, P5's line-breaks.ts and the break-vectors CLI all call that function. None re-derives breaks. The break-vector file format is unchanged.
  - **Inline boxes (INL1a)** are unpainted `DragonBoxView`s.
    - Frame: the union of their fragments, which is Chrome's `getBoundingClientRect`.
    - Placement: the IFC's text views and inline-box views are all flat children of the IFC's block-container view, in tree order. Inline boxes do not clip, and a box's union rect need not contain its text.
    - If native-compare needs DOM parents, the dump reports the DOM parent.
  - **Inline boxes (INL1b)** each gain one painted fragment view per line (`<id>:line<j>`, skipped for dump frames the way `DragonTree.isLine` skips text lines).
    - Each fragment paints background and borders with the existing DragonBoxView paint, with sliced edges.
    - Fragments follow Blink's paint order (NGInlineBoxFragmentPainter, line by line).
    - If per-leaf text views cannot reproduce that order where padding overlaps an adjacent line, text views are split per line. Overlap is never refused silently.
  - **`<br>`** is a zero-width node with a frame and no drawing.
  - **Atomic inlines (INL2)** are ordinary box views placed at their engine rects.
  - **Accessibility and selection.** Accessibility stays per text view (parity is P6). Selection is out of scope (owner ruling; a later package).
- **R4, proof for every package that adds cases.**
  - **Chrome.** Chrome-dual computed strings, frames and line rects:
    - at DPR 1, then 2, 3 and 2.625 (dpr-capture);
    - in ltr and rtl;
    - inline-box frames are the union rects, and `<br>` frames are included.
  - **Vectors.** New files, with TS = Swift = Kotlin. They include cases Chrome cannot isolate, such as a strut-only line and extreme mixed sizes.
  - **Break reference.** Engine = Chrome N/N for the new cases, and existing break vectors are byte-identical.
  - **Device lanes (Phase B, with both leases, P5 rules):**
    - all five device lanes: layout-vectors-device, device-frames, device-applied, device-lines and device-pixels;
    - both platforms, every DPR;
    - no `not run` lane, and no new device-pixels failure beyond master's recorded list;
    - text pixels only under the allowance already recorded (decision 13), with no new allowance.
  - **Planted faults.** Named per layer: engine `EngineFaults`, compiler `faults.ts`, runtime `SUPPORT_PLANTS` from P5. Each is caught by a named fixture, vector or lane.
  - **WPT.** Refusals only shrink, no pass becomes a fail, and every new pass is listed.
- **R5, one input migration.** INL1a adds:
  - `InlineBox` (`kind: 'inline'`, whose `style` is a full `LayoutStyle` with `Display` extended by `'inline'`, plus the V2a font and line-height fields);
  - `LineBreak` (`kind: 'br'`, with font and line-height);
  - a required `strut` on `LayoutBox` (the IFC root's font and line-height, or null when it has no inline content);
  - a required `verticalAlign` on `LayoutStyle`, typed with every CSS2 §10.8.1 value. The compiler writes `baseline`, and INL1a refuses the rest.

  Existing inputs are migrated by generator only, and outputs stay byte-identical (the T012 ruling 1 precedent). INL1b and INL2 need no further migration.
- **R6.** `href` stays refused until TDEC draws the UA underline. This amends T025's "href: INL1". The reject-attr-href fixture is unchanged.
- **R7, tags.**
  - span, a (without href) and label are accepted.
  - `<br>` is in INL1a.
  - b, strong, em and i are accepted on web. They are refused on native until TXT1a, because synthetic bold and italic are Skia paint effects (the precedent is the bold-headings refusal).
  - sub and sup go to INL2 (vertical-align).
  - `small` and `code` are accepted only where the compiler reproduces INL-U's captured computed values. A tag that cannot be reproduced stays refused and is listed in the Worker note. That is not a stop (the T025 attribute precedent).
  - New tags are appended to the end of `SUPPORTED_TAGS`.
- **R8, serial order on inline.ts and text.ts.** P5 → V1 Phase B → V2a → INL1a → TXT1a → INL2 → INL1b by default. If TXT1a has no approved spec, or its gates are unmet, when INL1a merges, then INL2 goes next. INL1b is never concurrent with either. block.ts belongs to whichever of these is in flight (roadmap §4).
- **R9, now or later.**
  - **INL-P and INL-U start now** from master 41cc750.
  - **INL-BF** bases on master after T022 (casc-logical, which also edits resolve.ts) and INL-U. It runs alongside V1 Phase B and V2a on disjoint files.
  - **Merge timing.** Every package that adds fixtures merges after P5 and then runs a device step (T025 ruling 4).
- **R10, refusals kept.** These stay refused with typed codes, never laid out approximately:
  - block-in-inline;
  - an abspos child inside inline content (the existing `reject-abspos-in-inline`);
  - `box-decoration-break: clone`;
  - `border-radius` and `outline` on inline boxes (PNT1).

  In rtl, inline boxes are proven or refused and listed, with the existing `checkRtlText` limits.

**Common prefix.** In what follows, **E** means `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`. Every command below is written literally as `E <command>`, and BASE is the recorded base sha.

### Standard verify block S (used by INL-BF, INL1a, INL1b, INL2)
- S1 `E pnpm install --frozen-lockfile`
- S2 `E pnpm run layout:subset` (0 violations)
- S3 `E pnpm typecheck`
- S4 `E pnpm test`
  - BASE's `vitest list` must be a subset of HEAD's.
  - No skip, `.only` or `.todo`.
  - `git diff --diff-filter=MD --name-only $BASE -- '*/test/*'` lists only the declared retargets and pins.
- S5 `E pnpm run native:gen && pnpm run native:swift && pnpm run native:kotlin && pnpm run native:planted -- --target swift && pnpm run native:planted -- --target kotlin` (pre-existing suites keep their count and results)
- S6 `E pnpm run layout:vectors && pnpm run layout:dpr-vectors`, then the T012 §4 verify-6 `node -e` output check (every modified vector keeps its `output`), exit 0
- S7 `E pnpm run parity:capture && pnpm run parity:dpr-capture && git diff --diff-filter=MD --exit-code $BASE -- packages/parity/expected packages/parity/expected-dpr`
- S8 `E pnpm run parity:report && pnpm run parity:dpr-report` (failed 0 at 1, 2, 3 and 2.625)
- S9 `E pnpm run profile:rows && git diff --stat $BASE -- packages/dragon/src/profiles` (declared new rows only; no existing row changes)
- S10 each named plant fails its named case with its named kind, and the unfaulted run passes
- S11 `E pnpm run native:build -- --target ios && pnpm run native:build -- --target android` (derived case count; pre-existing case sources differ only in the lines the package declares, shown by a normalised diff in the note)
- S12 `E pnpm run native:encoders -- --target swift && pnpm run native:encoders -- --target kotlin`
- S13 `E pnpm run layout:break-vectors && git diff --diff-filter=MD --exit-code $BASE -- packages/layout/break-vectors`
- S14 `E pnpm run parity:lanes -- --run-host`
- S15 `E pnpm run north-star:check && pnpm run wpt:update-expectations` (refusals only shrink; no pass becomes a fail; each new fail has a reason; the numeric delta is recorded)
- S16 `E git diff --exit-code $BASE -- packages/parity/src/chrome.ts packages/parity/src/capture.ts packages/parity/src/pipeline.ts packages/parity/src/compare.ts packages/parity/src/dpr.ts packages/parity/src/dual.ts packages/parity/src/targets.ts packages/parity/src/lanes.ts packages/parity/src/samples.ts packages/parity/src/native-compare.ts packages/parity/src/native-dump.ts packages/parity/src/report.ts packages/parity/src/render.ts packages/parity/src/device-run.ts packages/parity/src/device-lanes.ts packages/parity/src/device-vectors.ts packages/parity/src/pixel-reference.ts packages/translate/src packages/layout/src/linebreak-data.ts packages/text-shaper vendor package.json .github`
- S17 `E git diff --name-only $BASE..HEAD` lies inside allowed_files, and `E git remote -v` is empty
- S18 (Phase B, holding both device leases) `E pnpm run parity:break-capture && pnpm run parity:pixel-capture && pnpm run parity:lanes -- --run-host --run-device && pnpm run parity:lanes -- --require-all`
  - Files are added for the new cases only.
  - Engine = Chrome breaks N/N.
  - No `not run` lane.
  - layout-vectors-device equals host on both targets.
  - device-frames, device-applied and device-lines pass on both targets.
  - No device-pixels failure is added beyond master's list.
  - `--require-all` gives the same verdict as master.

## 3. Worker packages

### INL-P: the inline probe corpus (new files only; starts now)
- **Worktree / branch:** `/tmp/dragon-inl-probe`, `inl-probe`. **Base:** master 41cc750, no wait. No device lease.
- **Objective.** A committed, re-runnable measurement corpus of Chrome 145.0.7632.6 plus a Blink source reading, which INL1a, INL1b and INL2 cite for every rounding rule.
  - **Script.** `scripts/capture-inline-probe.ts` imports parity/src/chrome.ts unchanged. It runs at DPR 1, 2, 3 and 2.625, in ltr and rtl, with Ahem only.
  - **Recorded per case:**
    - line box tops and heights;
    - per-leaf Range client rects;
    - `getClientRects` and `getBoundingClientRect` for inline boxes and `<br>`;
    - baselines, from a 0x0 inline-block marker;
    - computed styles.
  - **Case families:**
    1. mixed sizes and line-heights per line: numbers, px, `normal`, the strut larger or smaller than the content, empty inline boxes;
    2. `<br>`: leading, trailing and consecutive, br-only lines, br inside a span, br height with a different br font;
    3. break opportunities across inline box boundaries and at the Ahem-covered punctuation (`- ? ! | / ( ) , . ; : % $ + " { } [ ]`, a hyphen before digits, U+200B), and trailing spaces inside a closing span;
    4. inline box margins, borders and padding: per-fragment rects, slicing, lines wider than available, rtl sides, backgrounds overlapping adjacent lines (paint-order screenshot);
    5. atomic inlines:
       - inline-block baseline with text, empty, and `overflow: hidden`;
       - inline-flex baseline;
       - every `vertical-align` keyword, length and percentage, with `sub`/`super` on nested sizes and `top`/`bottom` with tall atomics;
       - breaks around U+FFFC;
       - shrink-to-fit widths;
    6. the computed font-size of `small`, `sub`, `sup` and `code` under Ahem and monospace parents at 10, 16, 17.5 and 23.3 px.
  - **Source reading.** `docs/research/inline-spike/blink-notes.md` gives file:line at 145.0.7632.6 for:
    - the inline items builder (open/close, `<br>`, U+FFFC);
    - `line_breaker.cc` item handling;
    - `inline_box_state.cc` and FontHeight / half-leading per box;
    - baseline rounding;
    - vertical-align shifts (sub, super, middle);
    - `InlineBlockBaseline` and the inline-flex baseline;
    - `NGInlineBoxFragmentPainter` order;
    - smaller/larger.

    Each measured rule is matched to its source line. Anything unexplained is listed as an open question with the case id, and none is guessed.
- **allowed_files:** `docs/research/inline-spike/**` (new), `scripts/capture-inline-probe.ts` (new), `docs/goals/milestone-2-proof/notes/<task>-inl-probe.md` (main checkout only).
- **verify:**
  - `E pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
  - `E node --conditions=dragon-internal scripts/capture-inline-probe.ts && node --conditions=dragon-internal scripts/capture-inline-probe.ts --check` (the second run is byte-identical)
  - `E git diff --name-only --diff-filter=MD $BASE..HEAD` is empty, and every added path is under the allowed list
  - `E git remote -v` is empty
- **stop_if:**
  - a file outside allowed_files is needed;
  - Chrome is not the pinned 145.0.7632.6;
  - capture is non-deterministic after two attempts;
  - verification fails twice.

### INL-U: UA data for the phrasing tags (ua lane; starts now; merges after P5)
- **Worktree / branch:** `/tmp/dragon-inl-ua`, `inl-ua-phrasing`. **Base:** master 41cc750. No other ua writer may be in flight. T011/T038 never touch ua (T033).
- **Objective.** Extend ELB-2's capture with element keys `br`, `strong`, `b`, `em`, `i`, `code`, `small`, `sub`, `sup` and `label`.
  - It uses the same method: declared ltr/rtl, computed, initial, contexts, text fonts, `userAgentUnmodelled`, `userAgentForced`, and dark.
  - It adds a new table `elementKeyFontSizes`: the computed font-size of each key under Ahem and monospace parents at 10, 16, 17.5 and 23.3 px.
  - New keys go in the ELB-2 separate tables. `CapturedTag` and every existing table stay byte-identical.
- **allowed_files:**
  - `scripts/capture-ua-defaults.ts`;
  - `packages/dragon/src/ua/chrome-145.darwin-arm64.generated.ts` and `packages/dragon/src/ua/chrome-145.darwin-arm64.dark.generated.ts` (generator output only);
  - `packages/dragon/src/ua/datasets.ts` (append-only exports);
  - `packages/dragon/test/ua-inl.test.ts` (new);
  - `packages/dragon/test/ua.test.ts` (append-only);
  - the note (main checkout).
- **verify:**
  - `E pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
  - `E pnpm run ua:capture -- --check` (exit 0: self-consistency for every key, light and dark)
  - `E pnpm run ua:capture -- --compare <BASE copy of chrome-145.darwin-arm64.generated.ts>` (0 existing entries differ; ancestor gains are listed and confined to the new-key tables)
  - `E pnpm run ua:capture -- --check --plant drop-declared`, `-- --check --plant drop-unmodelled`, `-- --check --plant dark-as-light`, plus a new `-- --check --plant drop-font-size-small`: each exits 1 with its named FAULT line
  - `E pnpm run parity:report && pnpm run parity:dpr-report` (unchanged, failed 0)
  - `E git diff --exit-code $BASE -- packages/parity packages/layout packages/translate packages/dragon/src/analysis packages/dragon/src/emit packages/dragon/src/lower package.json`
  - `E git remote -v` is empty
- **stop_if:**
  - an existing UA table entry changes;
  - self-consistency fails for a new key after the capture is checked;
  - an existing tag gains an ancestor context outside the new-key tables;
  - a file outside allowed_files is needed;
  - verification fails twice.
- **Merge:** by the integrator after P5 (T007), regenerating. Emitted headers are relaxed and bodies are unchanged.

### INL-BF: blockified phrasing elements (compiler only; no inline.ts, text.ts or block.ts)
- **Worktree / branch:** `/tmp/dragon-inl-bf`, `inl-blockified-phrasing`.
- **Base.** Master after T022 (casc-logical, which edits resolve.ts; T022 is gated on P5) and after INL-U. Record BASE.
- **Runs alongside.** V1 Phase B, V2a, T038 and MQ-a B, because the files are disjoint: INL-BF writes neither computed.ts, computed-checks.ts, context.ts, project.ts, stylesheet.ts nor values.ts.
- **Objective.**
  - **Tags.** span, a and label are added to `SUPPORTED_TAGS`, appended at the end. The a element is accepted without href; href stays refused (R6).
  - **Blockification (css-display-3 §2.7).** A new file, `analysis/blockify.ts`, is called from one site in resolve.ts beside `blockifyRoot`. For a flex item or an absolutely positioned element:
    - `display: inline` becomes `block`;
    - `inline-block` becomes `block`;
    - `inline-flex` becomes `flex`.

    Chrome's getComputedStyle reports the blockified value, and Chrome-dual proves it.
  - **Fail-closed.** Every other `display: inline | inline-block | inline-flex` has no support row and stays refused. The existing tests prove this: tags are refused by the element table and display values by context rows.
  - **Fixtures.** A new group, `phrasing-blockified`:
    - span, a and label as flex-row and flex-column items;
    - abspos span;
    - `inline-flex` becoming `flex` with its own flex items;
    - `inline-block` becoming `block` with text;
    - rtl variants;
    - rejects: an inline span in a block, `a[href]`, and inline-block in a block.
  - **Plants.** Compiler: `blockifySkipped` and `inlineFlexToBlock`.
- **allowed_files:**
  - `packages/dragon/src/analysis/elements.ts`;
  - `packages/dragon/src/analysis/blockify.ts` (new);
  - `packages/dragon/src/analysis/resolve.ts` (one call site);
  - `packages/dragon/src/faults.ts` (appended);
  - `packages/dragon/src/diagnostics/catalogue.ts` (one entry per line);
  - `packages/dragon/test/diagnostic-codes.json` (append-only);
  - `packages/dragon/test/blockify.test.ts` (new);
  - `packages/dragon/test/tree.test.ts` (the :257 retarget from `span` to a still-refused tag);
  - `packages/wpt/test/translate.test.ts` (the :84-85 retarget from `<span>` to a still-refused tag);
  - `packages/dragon/test/seams.test.ts` (append-only);
  - `packages/dragon/src/profiles/*.ts` (profile:rows output);
  - `packages/parity/src/fixtures.ts` (one appended group);
  - `packages/parity/src/fixture-groups/phrasing-blockified.ts` (new);
  - `packages/parity/fixtures/*` (new files only);
  - `packages/parity/expected/**` and `packages/parity/expected-dpr/**` (new files);
  - `packages/parity/emitted/**` (new bodies; headers relaxed);
  - `packages/layout/vectors/**` (new files);
  - `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**` and `packages/parity/expected-pixels/**` (new case files and appended manifest entries; Phase B);
  - `packages/parity/out/lanes.json`;
  - `examples/music-player/dragon/north-star-check.json`;
  - `packages/wpt/expectations/*.json` (generator output);
  - existing count pins converted to derived counts only;
  - the note (main checkout).
- **verify:**
  - S1 to S17, where S16 also covers `packages/layout/src` and `packages/dragon/src/{emit,lower}`: this package changes no engine or emitter file.
  - S11: existing case sources are byte-identical apart from relaxed headers.
  - north-star:check: the element errors for span fall. List the before and after counts.
  - Phase B: S18.
- **stop_if:**
  - BASE lacks T022 or INL-U;
  - a file outside allowed_files is needed, in particular computed.ts, computed-checks.ts, context.ts, project.ts or any engine or emitter file;
  - any existing output changes (a capture, vector, emitted body, profile row, WPT pass or lanes check);
  - Chrome's blockified computed value disagrees and Blink does not explain it;
  - a plant is not caught;
  - anything would be loosened;
  - verification fails twice;
  - Phase B: a lease is not held, or a device lane fails.

### INL1a: the inline formatting core (engine, compiler, runtime, P5 harness; XL)
- **Worktree / branch:** `/tmp/dragon-inl1a`, `inl1a-inline-formatting`.
- **Base.** Master after P5 (T007), V1 Phase B (T009), V2a (T026), INL-BF and INL-U have merged, with INL-P's corpus on master or readable. Record BASE.
- **Waits for.** V2a, because of the serial order on inline.ts and text.ts and because FontSpec shapes the new input. INL-BF hands over elements.ts.
- **Never concurrent with** any package in flight on:
  - inline.ts, text.ts or block.ts;
  - input.ts, validate.ts or layout.ts;
  - native-support.ts, native-program.ts, uikit.ts, android-views.ts or expected-dump.ts;
  - internal.ts or context.ts;
  - line-breaks.ts.

  That list includes V2b, P6, T038, T040, the emitter split and SIZE-ar's intrinsic.ts. INL1a goes first unless one of them is already in flight (T012 ruling 5 applies). If one is in flight, INL1a bases on its merge.
- **Objective.**
  - **Input (R5).**
    - `InlineBox` and `LineBreak` child kinds;
    - `LayoutBox.strut`;
    - `LayoutStyle.verticalAlign`;
    - a block container's children are all boxes or all inline-level (TextLeaf, InlineBox, LineBreak);
    - validate.ts rules for the new kinds;
    - zoomInput zooms the fonts of inline boxes, line breaks and struts.

    Every existing vector, translate corpus and native case-source input is migrated by generator only.
  - **Engine (inline.ts plus new inline-box.ts).**
    - The IFC is flattened into items: text pieces, open/close tags and `<br>`.
    - Opportunities come from linebreak.ts over the content text (R2). Box boundaries are transparent, and `<br>` is a mandatory break.
    - The greedy fit uses per-item LU widths, `fitsAvailable` and hanging spaces.
    - The line box height and baseline follow CSS2 §10.8 with baseline alignment. Each inline box on the line and the root strut contribute their A and D, with the per-box half-leading floor (deviation half-leading-floor) and LU rounding per INL-P.
    - Lines stack by their own heights.
    - Leaf pieces are placed at the baseline minus the leaf's ascent.
    - Inline box fragments (`<id>:line<j>`) span their content's inline extent over the box's own content area, and the box frame is the union of its fragments.
    - `<br>` gets a zero-width fragment.
    - `firstBaseline` is the first line's baseline.
    - `inlineIntrinsicSize` handles forced breaks; min-content uses the new opportunities with R4 `cachedWidth` across items.
    - It exports `placeLines`, which replaces P5's `buildRun`/`breakLines` export (index.ts), and removes the `mixed-inline-font` code.
    - It refuses, with typed codes:
      - nonzero inline-box margin, border or padding (INL1b);
      - `verticalAlign` other than baseline (INL2);
      - block-in-inline;
      - mixed `text-wrap-mode` inside one IFC;
      - `lang` resolving to Chinese.
  - **Compiler.**
    - Tags: br, plus span, a (without href) and label in inline use; strong, b, em and i on web (refused on native); small and code per INL-U (R7).
    - lower/ios-layout.ts builds InlineBox and LineBreak nodes. Anonymous wrapping groups maximal runs of inline-level content (CSS2 §9.2.1.1).
    - computed.ts: the `smaller` and `larger` keywords only.
    - context.ts: inline facets for support rows.
    - computed-checks.ts: element and context checks for the new tags.
  - **Runtime (R3).**
    - Swift and Kotlin DragonTextView place glyphs from `inline_placeLines`, with a per-line baseline and a per-leaf font.
    - The inline node kind is an unpainted DragonBoxView holding the union frame.
    - The br node kind has a frame and no drawing.
    - Text and inline views are flat under the IFC container.
    - The device-lines dump format is unchanged.
    - line-breaks.ts and the break-vectors CLI call `placeLines`, at the call sites only.
  - **Fixtures.** A new group, `inline`, at every DPR, ltr and rtl, drawn from INL-P families 1 to 3 and the tags. Rejects: one per refusal above.
  - **Plants.**
    - Engine:
      - `lineHeightIgnoresInlineBoxes` (the line height from the strut only);
      - `halfLeadingUnflooredPerBox`;
      - `brIgnored`;
      - `spaceOnlyBreaks` (bypasses UAX #14);
      - `fitWithoutEpsilon` (linefit `noEpsilon`);
      - `breakAtBoxBoundary`;
      - `fragmentFromLineTop` (the leaf top ignores the baseline).
    - Compiler: `brAsSpace` and `inlineWrapperPerElement`.
    - Runtime, in `SUPPORT_PLANTS`: `singleRunBaseline`, which is caught by device-lines and device-frames on mixed-size cases.
- **allowed_files:**
  - `packages/layout/src/inline.ts`, `packages/layout/src/inline-box.ts` (new) and `packages/layout/src/text.ts` (metric helper signatures only);
  - `packages/layout/src/block.ts` (IFC dispatch, strut, and EngineFaults / NO_ENGINE_FAULTS appends);
  - `packages/layout/src/input.ts` (additive, R5);
  - `packages/layout/src/validate.ts`;
  - `packages/layout/src/layout.ts` (the zoomInput body for the new kinds);
  - `packages/layout/src/intrinsic.ts` and `packages/layout/src/flex.ts` (call sites of the changed inline signatures only);
  - `packages/layout/src/unsupported.ts` (codes appended);
  - `packages/layout/src/linebreak.ts` and `packages/layout/src/linefit.ts` (only an import or export surface, if the translator needs it; no behaviour change);
  - `packages/layout/src/index.ts` (P5's inline exports replaced by `placeLines`; otherwise append-only);
  - `packages/layout/src/platform-rules.ts`, `packages/layout/src/chrome-deviations.ts` and `packages/layout/src/chrome-deviations-dpr.ts` (entries with a capture and a fault);
  - `packages/layout/generated/**` (native:gen output);
  - `packages/layout/vectors/**` (new files; existing files input-only under R5) and `packages/layout/vectors/README.md`;
  - `packages/layout/break-vectors/**` (new files);
  - `packages/layout/test/inline.test.ts` (the :157 retarget to a still-refused mix, plus appends), `packages/layout/test/inline-box*.test.ts` (new), `packages/layout/test/linebreak.test.ts` (appends only); existing count pins derived only;
  - `packages/translate/src/corpus.ts`, `packages/translate/src/corpus-dpr.ts` and `packages/translate/harness/harness.ts` (additive suites and input migration);
  - `packages/translate/corpus.json`, `packages/translate/corpus-dpr.json` and `packages/translate/corpus-m1-cases.json` (lock output);
  - `packages/dragon/src/analysis/elements.ts`;
  - `packages/dragon/src/analysis/computed.ts` (relative font-size keywords only);
  - `packages/dragon/src/analysis/computed-checks.ts` (the new tags and inline contexts);
  - `packages/dragon/src/analysis/context.ts` (inline facets only);
  - `packages/dragon/src/lower/ios-layout.ts`;
  - `packages/dragon/src/lower/native-program.ts` (the inline and br node kinds; text-run font per leaf);
  - `packages/dragon/src/emit/uikit.ts` and `packages/dragon/src/emit/android-views.ts` (the node kinds);
  - `packages/dragon/src/emit/expected-dump.ts` (geometry for the new kinds);
  - `packages/dragon/src/emit/native-support.ts` (text placement from `inline_placeLines`, inline and br views, `SUPPORT_PLANTS` appends);
  - `packages/dragon/src/internal.ts` (exports only);
  - `packages/dragon/src/faults.ts` (appended);
  - `packages/dragon/src/diagnostics/catalogue.ts` (one entry per line);
  - `packages/dragon/test/diagnostic-codes.json` (append-only);
  - `packages/dragon/test/inline*.test.ts` (new);
  - `packages/dragon/test/seams.test.ts` (append-only);
  - `packages/dragon/src/profiles/*.ts` (output);
  - `packages/parity/src/line-breaks.ts` (engine call sites only);
  - `packages/parity/src/cli/break-vectors.ts` (engine call site only);
  - `packages/parity/test/line-breaks.test.ts` (call-site retarget only);
  - `packages/parity/src/fixtures.ts` (one appended group);
  - `packages/parity/src/fixture-groups/inline.ts` (new);
  - `packages/parity/fixtures/*` (new files only);
  - `packages/parity/expected/**` and `packages/parity/expected-dpr/**` (new files);
  - `packages/parity/emitted/**` (new bodies; headers relaxed; existing bodies may differ only in the declared runtime and input lines);
  - `packages/parity/expected-breaks/**` and `packages/parity/expected-pixels/**` (new case files and appended manifest entries);
  - `packages/parity/test/inline.test.ts` (new); existing count pins derived only;
  - `packages/parity/out/lanes.json`, `examples/music-player/dragon/north-star-check.json` and `packages/wpt/expectations/*.json` (generator output);
  - the note (main checkout).
- **verify:**
  - S1 to S17, and S16 also covers `packages/layout/src/linebreak-data.ts`.
  - `E pnpm run linebreak:conformance` still passes.
  - S13: every existing break vector is byte-identical.
  - S11: the normalised diff of existing case sources shows only the input-migration line and the runtime placement code.
  - Phase B: S18.
- **stop_if:**
  - BASE lacks P5, V1 Phase B, V2a, INL-BF or INL-U;
  - a package named above is in flight on a shared file;
  - a file outside allowed_files is needed (for example a protected path in S16, package.json, or position.ts);
  - any existing output changes: a vector `output`, a capture, an emitted body beyond the declared lines, a profile row, a break vector, a WPT pass or a lanes check;
  - float arithmetic is needed outside units.ts, or the translator core must change;
  - an INL-P rule or a Chrome capture disagrees with the engine, and Blink 145.0.7632.6 does not explain it;
  - a plant is not caught;
  - a tolerance, gate, case, DPR or direction would be loosened;
  - verification fails twice.

  Fallback split, used only after two failures:
  - INL1a-1: the engine, compiler and vectors, with Chrome proof. The runtime calls `placeLines` for existing cases only, and native refuses inline boxes and br.
  - INL1a-2: the runtime lowering plus Phase B.
  - Both run in series on the same files.
  - Phase B: a lease is not held; a non-pixel device lane fails; new device-pixels failures appear; a device fails to boot twice.
- **Pinned tests likely retargeted:**
  - layout/test/inline.test.ts:157;
  - parity/test/line-breaks.test.ts (call sites);
  - layout/test/unsupported.test.ts code-list pins (append);
  - seams.test.ts and diagnostic-codes.json (append);
  - any dragon test that string-matches `inline_buildRun` in emitted support;
  - native-compare and samples pins only if a node-kind list is pinned.

  Each keeps its intent and is listed in the receipt.

### INL1b: inline box margins, borders and padding (after INL2 by default, R8)
- **Worktree / branch:** `/tmp/dragon-inl1b`, `inl1b-inline-box-decorations`.
- **Base.** Master after INL1a, and after whichever of TXT1a and INL2 are next in R8's order. It is never concurrent with them, with the emitter split, or with P6 on native-support.ts, uikit.ts or android-views.ts.
- **Objective.**
  - **Layout.** Inline-start and inline-end margin, border and padding take inline space on the first and last fragment, so line widths and breaks include them. The block-axis values affect paint only.
  - **Fragments.** Each fragment's border box is the content area plus vertical padding and border, and the box frame is the union.
  - **Slicing.** `box-decoration-break: slice` only; `clone` is refused.
  - **rtl.** Start and end map to right and left.
  - **Paint.** Backgrounds and borders are painted per fragment view in Blink order (R3). Border styles are those box borders support today, and the paint rows follow the current box-paint status rule (P6).
  - **Fixtures.** A group `inline-box-decorations` from INL-P family 4, including one case where padding overlaps an adjacent line.
  - **Plants.**
    - Engine: `decorationOnEveryFragment` (clone behaviour), `blockPaddingAffectsLineHeight` and `endEdgeOnFirstFragment`.
    - Runtime: `fragmentPaintOrderReversed`.
- **allowed_files.** INL1a's list, restricted as follows:
  - layout/src: inline.ts, inline-box.ts, validate.ts, unsupported.ts, index.ts (append), generated, vectors and break-vectors (new);
  - dragon: native-program.ts (paint writes for fragments), uikit.ts, android-views.ts, expected-dump.ts, native-support.ts (fragment views, and splitting text views per line if needed), computed-checks.ts and context.ts (contexts only), faults, catalogue, profiles;
  - parity: fixtures.ts (append), `fixture-groups/inline-box-decorations.ts` (new), fixtures (new), and the expected, emitted, breaks and pixels outputs;
  - tests: new files, appends and derived pins;
  - no input.ts change (R5).
- **verify:** S1 to S17 and S18. S7 and S13: existing files byte-identical.
- **stop_if:** INL1a's list, plus:
  - input.ts would need to change;
  - Blink's paint order cannot be reproduced by fragment and text views.
- **Pinned tests:** INL1a's reject fixtures for inline padding and borders are retargeted to `box-decoration-break: clone` (still refused).

### INL2: atomic inlines and vertical-align (after INL1a, and after TXT1a by default)
- **Worktree / branch:** `/tmp/dragon-inl2`, `inl2-atomic-inlines`.
- **Base.** Master after INL1a, and TXT1a if R8's default holds. Never concurrent with SIZE-ar on intrinsic.ts or flex.ts, nor with any package on inline.ts, text.ts or block.ts.
- **Objective.**
  - **Display.** `Display` gains `inline-block` and `inline-flex` (input.ts, additive; no migration). An atomic inline is a LayoutBox inside inline content, whose item is U+FFFC in the break text (breaks per INL-P family 5).
  - **Sizing.** Shrink-to-fit width (CSS2 §10.3.9) through intrinsic.ts. The margin box is the inline advance, and its min/max-content contributions feed `inlineIntrinsicSize`.
  - **Baselines.**
    - inline-block: the last line box's baseline, or the bottom margin edge when it has no in-flow line box or overflow is not visible (CSS2 §10.8.1). block.ts exports the last-line baseline.
    - inline-flex: per INL-P and Blink (`InlineBlockBaseline`), exported from flex.ts.
  - **vertical-align** on inline boxes and atomics: all CSS2 §10.8.1 values, with top and bottom as a second pass. `middle` uses the parent's x-height from V2a's `FontData.xHeight`. Sub and super shifts follow Blink.
  - **Tags.** sub and sup, from INL-U.
  - **Compiler.** `inline-block` and `inline-flex` are no longer refused outside blockified contexts.
  - **Native.** Atomic inlines are ordinary box views at their engine rects; emitter edits only if the node kind needs them.
  - **Fixtures.** A group `atomic-inline`: INL-P family 5 plus a north-star-shaped case (a blockified button containing an inline-flex span, and inline-block links with margins in a block).
  - **Plants.**
    - Engine:
      - `inlineBlockFirstBaseline`;
      - `overflowBaselineIgnored`;
      - `inlineFlexLastBaseline`;
      - `subShiftOwnFont`;
      - `topBottomSinglePass`;
      - `atomicMarginExcluded`;
      - `middleWithoutXHeight`;
      - `noBreakAroundAtomic`.
    - Compiler: `verticalAlignDropped`.
- **allowed_files:**
  - `packages/layout/src/inline.ts` and `packages/layout/src/inline-box.ts`;
  - `packages/layout/src/block.ts` (last-line baseline, atomic dispatch, EngineFaults appends);
  - `packages/layout/src/flex.ts` (baseline export only);
  - `packages/layout/src/intrinsic.ts` (atomic contributions and the shrink-to-fit call);
  - `packages/layout/src/box.ts` (an additive Frag field, if needed);
  - `packages/layout/src/input.ts` (the Display union only);
  - `packages/layout/src/validate.ts` and `packages/layout/src/unsupported.ts`;
  - `packages/layout/src/text.ts` (sub and super shift helpers only);
  - `packages/layout/src/index.ts` (append);
  - generated, vectors (new) and break-vectors (new) outputs;
  - `packages/dragon/src/analysis/elements.ts`, `computed.ts` (vertical-align computed value only), `computed-checks.ts` and `context.ts` (contexts only);
  - `packages/dragon/src/lower/ios-layout.ts`;
  - `packages/dragon/src/lower/native-program.ts`, `packages/dragon/src/emit/uikit.ts`, `packages/dragon/src/emit/android-views.ts`, `packages/dragon/src/emit/expected-dump.ts` and `packages/dragon/src/emit/native-support.ts` (only if the atomic node kind needs them);
  - faults, catalogue, diagnostic-codes (append), profiles output;
  - parity: fixtures.ts (append), `fixture-groups/atomic-inline.ts` (new), fixtures (new), and the expected, emitted, breaks and pixels outputs;
  - translate corpus suites (additive);
  - tests: new files, appends and derived pins;
  - lanes.json, north-star-check.json and WPT expectations (output);
  - the note (main checkout).
- **verify:**
  - S1 to S17 and S18.
  - S15 must show the WPT numeric passes rising: inline-block is a top-listed blocker. The delta is recorded, and if there is no increase the reason is given.
- **stop_if:** INL1a's list, plus:
  - SIZE-ar or another package is in flight on intrinsic.ts or flex.ts;
  - an existing flex or block baseline output changes;
  - a Chrome inline-flex baseline rule is not explained by Blink.
- **Pinned tests:**
  - wpt/test/reftest.test.ts:35 uses `inline-block` as data. Check it; retarget only if it pins a refusal.
  - The INL1a reject fixtures for `vertical-align` are retargeted to a still-refused value, if any remains, or converted into positive fixtures with the reject case moved to `vertical-align` on a flex item where it does not apply.
  - The INL-BF reject for inline-block in a block is retargeted to `inline-grid`.

## 4. What can be prepared now (new files only)
- **INL-P**, all of it. It is the only new-files-only package, and it de-risks every later package.
- **INL-U** also runs now. It is not new-files-only, but it touches only the ua lane, which has no writer in flight, and it merges after P5.
- Nothing else is safe to prepare ahead.
  - Engine code for inline-box.ts would reference input types that do not exist until INL1a.
  - Unregistered fixture files would enter no group, or would trip the registration tests.
  - Any fixture landing before P5 would stale P5's per-fixture device data.
- Draft fixture HTML may live under `docs/research/inline-spike/fixtures-draft/` (INL-P) and be moved in by INL1a, INL1b and INL2.

## 5. Required board updates (PM)
1. T044 is done with this note. Add Worker tasks INL-P and INL-U (dispatchable now; no device lease), INL-BF (gated on T022 and INL-U), INL1a (gated on T026, INL-BF and INL-U), INL2 and INL1b, with the R8 order. Each fixture-adding package has a Phase B that holds both leases.
2. Record rulings R1 to R10 in docs/decisions.md as PM rulings. In particular:
   - R2 amends T010's "the breaker is wired in TXT1";
   - R6 amends T025's "href: INL1";
   - R3 supersedes the roadmap's "attributed runs" for INL1.
3. Update T019's package order: INL-BF joins wave 2, and INL1b moves after INL2. The checkpoint-3 path is P5 → V1 Phase B → V2a → INL1a → TXT1a → INL2 → REPL → FORM-a, and TDEC is needed for `a[href]`.
4. The TXT1a Judge spec must take over R2's shaping items and R7's native b/strong/em/i.
