# ROW-text-space: a text that changes on the phone collapses its white space over its whole inline formatting context, as Chrome 145 does

Worker spec (2026-11-22) for review before implementation. Measured on master 2c460cb251.

## Why

A Markless page lays out again on the phone when one of its texts changes at run time. The host sends a line to the translated harness (packages/translate/harness/harness.ts `runMarklessRowsLayout`, :4041, which reaches `rowsVariant`, :4391, through `marklessLayout`, :4236). The line names each changed text by leaf id: `$.rows[i].rows[j].texts` for a `@for` row's texts, and `$.texts` for the page's own texts. The harness writes each string into the plan's variant JSON and lays the tree out with Dragon's engine, translated to Swift and Kotlin.

Before layout, each changed string goes through `rowText` (harness.ts:4064-4091). It applies phase I (css-text-3 §4.1.1) to that one string. It replaces each run of white space with one space, and it refuses a segment break next to U+200B. It removes the white space at the string's edges only when the text is `alone`: the only child of a `box` node (rowCopy :4152, withPageTexts :4372). Beside any other inline content it refuses (`fail`) a string that begins with white space (:4073), ends with it, or is empty (:4088). The reason is that the result depends on the neighbours, and `rowText` cannot see them.

The refusal happens on the phone after the app has built. It is a `harness-error`, so the host stops laying out that page. Example: `<p>Total {n} taps, <span>more</span></p>`. The changed text "Total 3 taps, " ends with a space beside `<span>`, so the phone refuses it. Chrome draws "Total 3 taps, more".

The two paths are:
- **Page texts.** `$.texts` (pageTexts :4341, withPageTexts :4356-4375) serves any text leaf outside a list's rows. It applies to any changed text, not just to `@for` rows.
- **Who sends them.** The Markless hosts send every page text whose current string differs from the one laid out (markless ConformanceTest.kt:820-824: "a changed page text goes to the live layout beside no rows"; "a page text at its laid-out string keeps the recorded layout").
- **S42.** Markless S42 (text interpolations, markless commit bfc6a3fc9) is a page of `$.texts` leaves beside spans, with no rows. For example, "Button total: " sits before `<span class="count">`, and "Picked " sits before a span and is followed by " until it changes". Each one is a page text with an edge space beside an inline box.

## What Chrome 145 does (tag 145.0.7632.6)

Blink references are the ones the repo already cites: docs/research/inline-spike/blink-notes.md §1-§2 and docs/research/gen-spike/blink-notes.md R7. Paths are relative to `third_party/blink/renderer/core/layout/inline/`.

### Phase I over the inline formatting context

- **Collapsing crosses text and box boundaries.** Blink's InlineItemsBuilder builds the whole context's text content as one string. A collapsible space is collapsed against `LastItemToCollapseWith` (inline_items_builder.cc:218, `AppendTextItem` :376-440). The first space of a run is collapsed against the last item before it (`AppendCollapseWhitespace` :767-800).
- **Inline box tags are opaque.** Open and close tags (EnterInline :1502-1558, ExitInline :1600-1667) add no character, so a space collapses across them even when the box has padding or a border.
- **An out-of-flow box adds no character either** (:1306-1310).
- **An atomic inline is U+FFFC** (:1245-1251). It is not white space, so a space on each side of it stays.
- **The first space wins.** A run of white space keeps one space, in the text where the run starts. The probe's `'a '` + `' b'` gives "a " and "b".
- **A `<br>` is a forced break** (:1139-1175). White space after it is leading space and collapses (:1162-1166). A space before it stays and hangs (INL-P f2-after-space).
- **The start and end of the block.** White space at the start of the context, and at its end, is removed (css-text-3 §4.1.2). Blink removes the trailing collapsible space when the block's items end. The repo has no line citation for that yet; the probe below shows the behaviour.
- **Segment breaks** (§4.1.3). A segment break is removed when the character on either side of its run is U+200B, across text boundaries too. Otherwise the run is one space.
  - Chrome 145 does not remove a segment break between two East Asian Wide characters: `一\n二` is 3 em wide in the probe.
- **An empty text node** generates no box and adds no character. White space on both sides of it collapses as if it were not there.
- **A context whose texts are all empty or white space** makes no line box. Its block is 0 tall, as in INL-P f1-empty-root.
- **U+00A0 is not white space.** It never collapses and is never removed at an edge.

### Phase II (line layout)

- **Spaces at the end of a line hang** (line_breaker.cc `HandleTrailingSpaces` :2384). Box boundaries do not change this: a hanging space inside a closing span stays in the span (:3975-3983, f3-trailing-space-close).
- **A wrapped line never starts with a collapsible space.** The break opportunity comes after the space run, so the run hangs at the end of the previous line.
- So phase II never removes a space at a block's start or end, or after a `<br>`. Phase I already has.

### Probe (Chrome 145.0.7632.6, darwin-arm64, `launchChrome(1)`, Ahem 10px/10px, DPR 1)

The probe script is in ~/wt/scratch-op/rowspace/probe.ts and probe2.ts. Widths come from per-text-node Range rects, in CSS px.

| Case | Markup | Result |
| --- | --- | --- |
| trailing space beside a span | `Total 3 taps, <span>more</span>` | 140 + 40: the space stays |
| leading space after a span | `<span>more</span> 3 taps` | 40 + 70 |
| double space across a boundary | `a <span> b</span>` | "a " 20, " b" 10 |
| the same, at a close tag | `<span>a </span> b` | 20, 10 |
| across a padded and bordered span | `a <span style="padding-left:5px;border-left:2px solid"> b</span>` | " b" at x 27, 10 wide |
| across an empty padded span | `a <span style="padding-left:5px"></span> b` | " b" at x 25, 10 wide |
| empty text between spans | `<span>a</span>""<span>b</span>` | 10, no rect, 10 |
| space-only text between spans | `<span>a </span> <span>b</span>` | 20, no rect, 10 |
| start of block | ` a<span>b</span>` | 10, 10 |
| end of block | `<span>a</span>b ` | 10, 10 |
| nbsp at both edges | ` a <span>b</span>` | 30, 10 |
| before and after `<br>` | `a <br> b<span>c</span>` | "a " 10 (the space hangs), " b" 10 on line 2 |
| segment break | `a\n<span>b</span>` | 20, 10 |
| segment break next to U+200B | `a\n<span>​b</span>` | 10, 10 |
| segment break, CJK | `一\n<span>二</span>`, `一\n二` | 20 + 10; 30 |
| across an atomic inline | `a <span style="display:inline-block">f</span> b` | " b" 20: both spaces stay |
| across abspos and float | `a <span style="position:absolute">f</span> b` | " b" 10: they collapse |
| all empty, all space | `<span></span>`, `<span>  </span>` | p height 0 |
| tabs across a boundary | `a\t` + `\tb` | 20, 10 |
| a run time change | text "Total 3 " then span " more"; then `data = "Total 4"` | 80 / 80, then 70 / span at 70, 50 wide: the span's own space comes back |
| CR and FF set from script | `a\rb`, `a\fb` | 11.95 and 23.34: neither is collapsed as a space |

## What Dragon does today

### The build: phase I (packages/dragon/src/analysis/resolve.ts)

- **collapseInlineContext** (:128-166) is phase I over one inline formatting context's runs, with null for a `<br>`.
  - White space is `[ \t\n\r\f]` (WHITE_SPACE :81).
  - A run of white space collapses across run boundaries. It keeps one space in the run where it starts (`run: c.run`, :162).
  - It keeps that space only when there is content before it on the line and anything after it (`before !== undefined && after !== undefined`, :162). So it removes white space at the context's start, after a `<br>` (`lineStart`, :136-141, :159) and at the context's end. It keeps a space before a `<br>`.
  - A run with a segment break next to U+200B on either side is removed (:161-162).
  - collapseInlineRun (:90-121) is the version without `<br>`s. packages/parity/test/inline.test.ts:104-148 proves the two agree.
- **The context** (:571-629).
  - `gather` walks the texts, inline boxes (recursing into their pending children), `display: contents` children and `<br>`s (null). It skips `display: none`.
  - An atomic inline is pushed as U+FFFC (ATOMIC_RUN :240; :614-621).
  - Any other element ends the context (`flush()`, :623).
  - `flush` (:581-593) applies text-transform first (transformRun), then collapseInlineContext. It uses phaseOneContext (:192-228) when any text's mode is not `collapse`.
- **Dropped texts.** A text whose phase I result is "" is dropped from the tree (`if (text.length === 0) continue`, :640). So the variant has no leaf for it.
- **Preserved text beside inline boxes or `<br>`s is refused** (computed-checks.ts:598). So a context that holds preserve-breaks text holds only texts, and phaseOneContext runs them together (:193-195).
- **Floats beside inline content are refused** (computed-checks.ts:948).
- **Out-of-flow boxes.** An abspos box among inline content ends the context in `gather` (:623). Chrome collapses across it (probe). This spec does not change it. See Q7.
- **The lowered leaf.** The leaf carries the collapsed string (lower/ios-layout.ts:687 `text: t.text`). That string is the only text a plan variant holds.

### What the harness knows at re-layout

- **The plan's variants** (`plan.variants[vi].root`, read by variantRootJson :4216). For every leaf the build kept, the variant has the phase I result, not the authored string. Each leaf also has its `whiteSpaceCollapse` (decodeText :1051-1065). The variant also has the inline boxes (`kind: 'inline'`), `<br>`s (`kind: 'br'`), atomic boxes, anonymous boxes, and each box's `strut`. Validation requires a box with inline content to have a strut, and a box without one to have none (layout/src/validate.ts:924-942).
- **Each row's own variant**, found by `boxJson` (:4093). Each copy's ids are suffixed `@key` (rowCopy :4127-4155).
- **The changed strings**: `$.texts` and each row's `texts`, as the host typed them.
- **`plan.transformed`** (markless-style-input.ts withTransformed :786-814): the leaves laid out with a text-transform. A page text for one is refused (:4453).
- **Missing facts:**
  - **(F1)** the phase I input (after text-transform) of each fixed text;
  - **(F2)** every text phase I dropped: its leaf, its place among its siblings, and the strut its box would have.

  Without F1 the harness cannot tell that a fixed " more" lost its leading space at build time because the changed text before it ended with one. Without F2 it cannot bring back a space-only fixed text, such as `<b>{a}</b> <i>b</i>` when `a` stops ending with a space. It also cannot accept a changed text that was empty at build time: rowsVariant refuses it as "no text leaf" (:4200, :4458).

### Can neighbours change at run time?

Yes. One line can change several texts in one context:
- `$.texts` takes any number of page leaves (pageTexts :4341);
- a row's `texts` takes any number of its template's leaves (:4417-4427);
- a row's top element may be an inline box, because planRepeats (markless-style-input.ts:923-933) refuses only bare text at a row's top. Then the row copies and the page texts around them share one context.

The plan does not say which leaves change: the Markless style input has no such flag (MarklessStyleInput text node, markless-style-input.ts:39). So every text leaf may change, and every other leaf is fixed at its build-time string for that line.

### Phase II in the engine (packages/layout/src/inline.ts)

- **Spaces at a line end hang.**
  - visibleEndOf (:1244-1252) ends what a line shows after its last character that does not hang;
  - isHangingSpace (linefit.ts:39-41) is U+0020 and U+3000;
  - spacesHang (:1353-1360) applies it to collapsible text;
  - the fit test leaves out hanging spaces (fitEndOf :1362).
- **No line-start trimming.** The engine never removes a space at the start of a line or of the block, or a space at the block's end. It relies on phase I in the build. A leading space that reached it would be drawn.
- **An empty context.** A box whose context makes no line boxes is empty (block.ts:860-867, `hasContent: r.lines > 0`).

### Existing tests

- **packages/parity/test/markless-rows.test.ts:**
  - :237-250 pins today's refusals: " Groceries", "Groceries " and "" beside a `<b>` are refused, and "Buy  milk" is accepted;
  - :143 and EDGE_ROWS (:40-46) cover edge white space in a row's title that is alone in its box, compared with the build (expectAsBuilt);
  - :179-183 cover page texts against the build;
  - :199-211 cover the text-transform refusal;
  - :331-332 cover the pre-line refusal;
  - :334-380 compare 0, 1 and 3 rows with Chrome at the export's ratio (Android, `captureMarklessAssignment`, GATE_DEVICE_PX = 1). No edge white space beside inline content is compared with Chrome.
- **packages/parity/test/inline.test.ts:104-148** cover collapseInlineContext: across runs, across `<br>`, and U+200B across runs.
- **packages/dragon/test/inline-atomic.test.ts:49-52** cover U+FFFC.

## The change

**The harness runs phase I again over every inline formatting context that holds a changed text.** It runs the same function the build runs, over the current strings of every text in that context, changed and fixed alike. A changed text is then never refused because of its edges.

### C1. One phase I for the build and the phone

- **A new file.** Move collapseInlineContext and phaseOneContext's preserve-breaks branch into packages/layout/src/white-space.ts. Write them in the translator subset (no regex, no closures; index loops as in rowText). Add the file to the engine roots (translate/src/generate.ts:47-116, beside text-decoration.ts and rt-band.ts).
- **The build runs a byte-for-byte copy.** The published dragon package has css-tree as its only runtime dependency, and the core imports `@dragon/layout` for types only (packages/dragon/test/ua.test.ts; dist.test.ts f4 and f5 install the tarball without @dragon/layout). So packages/dragon/src/analysis/white-space.ts is a byte-for-byte copy of the layout file, and resolve.ts imports collapseInlineContext and preserveBreaksContext from `./white-space.ts`; its own versions go. Every `@dragon/layout` import left in resolve.ts is `import type`. packages/dragon/test/white-space-copy.test.ts reads both files and fails unless they are equal, and its message says to edit the layout file and copy it over. Only the layout file is a translated engine root. The planted compiler fault `preLineKeepsSpaceBeforeNewline` becomes a parameter.
- **What proves the move.** inline.test.ts and inline-atomic.test.ts must pass unchanged, the layout differential test compares the new code with verbatim copies of the old loops, and a regen must change no generated output except the Swift and Kotlin engines.
- After this, the build and the phone run the same source text: the build runs the TypeScript copy, and the phone runs its translation, which the translator corpus checks against the TypeScript.

### C2. The build exports the missing facts (F1, F2)

- **Where they come from.** The compiled result's resolved tree, beside `resolvedTextTransforms` (markless-style-input.ts:1064). They are never rebuilt from the plan's strings. Call it `resolvedTextSources(compiled, assignment, band)`. Per text node it gives the phase I input (after transform) and the phase I result, from resolve.ts `flush`.
- **The plan gains `texts?`, keyed by variant index** (MarklessPlan, markless-plan.ts:57-67):
  - `[variant, leaf, source]` for each kept leaf whose phase I input differs from its laid-out string (F1). A leaf that is not listed has a source equal to its text, which is most leaves.
  - `[variant, parent, next, leaf, source, strut]` for each text phase I dropped (F2):
    - `parent` is the box or inline id it sits in;
    - `next` is the id of the next sibling the variant keeps, or null at the end;
    - `leaf` is the text leaf JSON as ios-layout.ts:687 would lower it, with text "";
    - `strut` is the parent's strut when that box has no other inline content (otherwise null).
  - Each dropped leaf gets a plan name (`planNames`) like a kept one, so the host can name it.
- **The harness reads `plan.texts`** in checkMarklessPlan, so a malformed table fails at build time (markless-plan.ts:150-151). The plan version stays `dragon.markless-plan/1` while the field is optional (Q2).
- **Cost.** Only leaves whose source differs from their text are listed, and only dropped texts, so for typical pages the table is small. The plan's size is measured on the Markless yardstick inputs before landing.

### C3. The harness re-collapses after splicing

1. **Substitute.** withPageTexts and rowCopy write each changed string as typed. For each fixed leaf listed in `plan.texts` of its own variant, they write its source instead of its laid-out string. Dropped leaves from `plan.texts` are inserted before `next`, or at the end of `parent`. A row copy gets its row's own variant's dropped leaves, with ids suffixed `@key`.
2. **Splice.** withRows (:4161) runs as now.
3. **Collapse.** One pass over the spliced root, `withPhaseOne`, finds each inline formatting context. A context is a box's run of inline-level children, flattened through `kind: 'inline'` nodes. A `br` is null, and an atomic inline is U+FFFC (layout/src/inline-box.ts isAtomicInline). Anonymous boxes delimit contexts as they do in the build.
   - When a context holds no changed text and no inserted leaf, the pass leaves it untouched, so pages without edge cases lay out exactly as today.
   - Otherwise it runs white-space.ts phase I over the context's current strings (collapse, or preserve-breaks when every text is preserve-breaks). It writes each result back, and drops each leaf whose result is "" (today's emptyLeaf rule, :4115).
4. **Struts.** A box whose context becomes empty keeps its strut and makes no line box (block.ts:860-867), as Chrome's 0-tall block does. A box with no strut that gains a non-empty inserted leaf takes the strut exported with it.
5. **What goes.** rowText's edge refusals (:4073, :4088) and the `alone` parameter of rowCopy and withPageTexts go. isPhaseOneSpace goes too, since white-space.ts owns the white space set.
6. **Leaf checks.** The leaf-existence checks (:4200, :4458) accept dropped leaves.

### Planted faults (harness, set only by the test, see Q4)

- `givenTextCollapsedAlone`: each changed text collapses as a context of its own, with its edges removed. This is today's `alone` rule applied everywhere, with no refusal.
- `fixedTextsAsLaidOut`: fixed leaves keep their laid-out string instead of their source, and dropped leaves are not inserted.

## Still refused, by name (`harness-error` on the phone)

- **Characters Chrome does not collapse.** U+000D or U+000C in a changed text whose leaf collapses. Chrome 145 does not collapse a script-set CR or FF as a space (probe), but the build's WHITE_SPACE and isPhaseOneSpace do. "a changed text holding U+000D (or U+000C) is not supported: Chrome does not collapse it as white space". See Q6.
- **pre-line, if the Judge says so (Q3).** C1 and C3 make preserve-breaks the same code on both sides, and a preserve-breaks context holds only texts (computed-checks.ts:598). The spec proposes to drop the refusal at :4065 and add the pre-line fixtures below.
- **Capitalize after a changed text.** A fixed leaf with `text-transform: capitalize` whose previous character in its context comes from a changed text. capitalize reads the previous character (text-transform.ts capitalize :96, its previous-character argument documented at :93), so the build's transformed source depends on the old string. This needs `transformed` to say which transform it is (Q5). Uppercase and lowercase do not read the previous character, so their sources stand.
- **Unchanged refusals:**
  - a page text for a transformed leaf (:4453);
  - a segment break beside U+200B is no longer refused; white-space.ts removes it as resolve.ts does;
  - preserved control characters, which the engine refuses (inline.ts:662);
  - the row and list refusals of :309-325.

## Fixtures

### Where they run

- **The test.** A new file, packages/parity/test/markless-row-text-space.test.ts, in the style of markless-rows.test.ts:334-380.
  - Each case is a Markless style input built at its initial strings.
  - The phone's line gives the changed strings.
  - `captureMarklessAssignment` captures Chrome's page with the changed strings written in (writtenOut).
  - Every element box, the inline boxes included, must agree within GATE_DEVICE_PX.
  - The device result must also equal a fresh build of the written-out page (expectAsBuilt). A fault that fooled one oracle would then have to fool both.
- **Fonts.** Vendored Ahem at 16px, where a lost or extra space moves the next box by 16 CSS px. Every case runs again in vendored Lato as an author font, where a space is not 1 em.
- **Boxes that show a space.** Each changed text sits beside a `<span>` with a 1px border, inside a shrink-to-fit `display: inline-block` paragraph with a border. Each span's x, and the paragraph's width, then show every space Chrome keeps, including one removed at the block's end.
- **Ratios.** DPR 1, 2, 2.625 and 3.
  - The plan records text only at PLAN_DENSITIES (markless-plan.ts:24: ios 2 and 3, android 2, 2.625, 2.75, 3 and 3.5), and the harness refuses any other ratio ("the plan holds no text measured at ratio", :4233).
  - So DPR 2 and 3 run on iOS and Android, and 2.625 on Android.
  - DPR 1 needs a test-only density list passed to marklessPlan (Q1).

### Cases (row and page variants of each, unless marked)

1. **Trailing space beside a span.** `<p>{t}<span>more</span></p>`, t: "Total 2 taps," at build, "Total 3 taps, " at run time.
2. **Leading space after a span.** `<p><span>more</span>{t}</p>`, t: " 3 taps".
3. **Double space across a boundary.** `<p>{t}<span> b</span></p>` with t "a ", which removes the fixed span's leading space. Also `<p><span>{t}</span> b</p>` with t "a " (across a close tag), and across a span with padding and a border.
4. **Empty text between spans.** `<p><span>a </span>{t}<span> b</span></p>`, t: "" and "  ". The spans' spaces still collapse to one, as if t were not there. t then becomes "x", which brings the second span's space back.
5. **A fixed space-only text phase I dropped.** `<p><b>{a}</b> <i>b</i></p>`. a is "x " at build, so the " " between `</b>` and `<i>` is dropped. At run time a is "x", and the space must come back owned by the `<p>`, not the `<b>`. The `<b>` gets a different font-size, so the owner shows in the boxes' x.
6. **A text at the start of the block** (` x` beside a span) and **at its end** (`x ` after a span). Both cases also run in a `<br>` context: the text after the `<br>`, and the text before it, whose space hangs.
7. **nbsp.** t: " x ", which keeps both.
8. **From ending in a space to not.** `<p>{t}<span> more</span></p>`, t "Total 3 " at build, then "Total 4": the span's leading space comes back (probe: span at 70, 50 wide). Then the reverse: from "Total 4" to "Total 3 ".
9. **Two changed neighbours in one line.** `<p>{a}<span>{b}</span></p>` with a "x " and b " y". The second space goes, from b.
10. **A changed text that was empty at build** (F2). `<p>{t}<span>b</span></p>` and `<p>{t}</p>`, t "" at build, then "x " at run time. In the second, the box takes its exported strut, and the empty context is 0 tall before the change.
11. **Segment breaks.**
    - "a\n" beside `<span>b</span>`;
    - "a\n" beside a fixed "​b", where the space is removed across the boundary;
    - "一\n" beside `<span>二</span>`, where Chrome keeps the space.
12. **Inline rows** (rows only). `<p>Tags: @for(<span class=tag>{t}</span>)</p>`: row texts with edge spaces sit beside the page's own text and beside each other.
13. **pre-line**, if Q3 is accepted. A pre-line leaf with spaces around a U+000A, and two adjacent pre-line texts that meet at a space. The existing compiler fault `preLineKeepsSpaceBeforeNewline` must fail it.
14. **Refusal tests.** Unit tests, no Chrome:
    - CR and FF;
    - the capitalize neighbour;
    - each of them under the line format's validation;
    - markless-rows.test.ts:237-250 rewritten to accept the three strings it now refuses, each compared with the build.

### Planted faults

- **`givenTextCollapsedAlone` must fail** cases 1, 3, 4, 8 and 9. As measured in RS2 (Chrome alone): it fails cases 1, 3, 5 and 8.
- **`fixedTextsAsLaidOut` must fail** cases 3, 5 and 8. As measured in RS2: it fails cases 5 and 8; case 3 holds no fixed text whose phase I input differs from its laid-out string. Cases 4 and 9 go to RS3; case 10 is refused by name.
- **Both through Chrome, not only through the build.** Each fault is run against the Chrome comparison alone, and must fail there.

## Slices

- **RS1, one phase I** (C1). Add layout/src/white-space.ts and its byte-for-byte copy dragon/src/analysis/white-space.ts, have resolve.ts import the copy, add the generate.ts root, and regen the Swift and Kotlin engines.
  - The proof is inline.test.ts, inline-atomic.test.ts, the translator corpus and an unchanged regen of every expected file.
  - About 15-25 KB reviewed. Generated Swift and Kotlin are not reviewed.
- **RS2, the facts and the pass** (C2, C3, the refusals and planted faults).
  - Its premise that the phone's phase I equals the build's rests on white-space-copy.test.ts's byte equality plus the translator corpus. A1 then checks the harness and the plan table on top of that.
  - resolve.ts exposes each text's phase I input and result. markless-style-input.ts adds resolvedTextSources and `plan.texts`. markless-plan.ts adds the type. harness.ts adds the reader, substitution, insertion, withPhaseOne and the two faults, and drops rowText's edge rules.
  - Tests: markless-rows.test.ts (the rewritten :237-250, and the refusals), plus markless-plan.test.ts for the table's reader.
  - About 55-75 KB reviewed.
- **RS3, the Chrome fixtures.** markless-row-text-space.test.ts with cases 1-12 at the four ratios in Ahem and Lato, plus the fault runs. Case 13 is included if Q3 is accepted.
  - About 25-40 KB reviewed.
- **Total: about 95-140 KB.** That is under the 150 KB limit, but three PRs keep each review on one theme. RS3 can stack on RS2.

### Files

- packages/layout/src/white-space.ts (new), packages/layout/src/index.ts
- packages/translate/src/generate.ts; packages/layout/generated/swift and kotlin (regenerated)
- packages/dragon/src/analysis/resolve.ts, packages/dragon/src/analysis/white-space.ts (new, a byte-for-byte copy), packages/dragon/test/white-space-copy.test.ts (new)
- packages/dragon/src/internal.ts (RS2, added by the coordinator): resolvedTextSources lives beside resolvedTextTransforms, the compiler entry markless-style-input.ts reads.
- packages/dragon/src/lower/ios-layout.ts (RS2, added by the coordinator): a dropped text's leaf and its block container's strut come from the lowering (lowerText, strutOf), kept in a side table keyed by the lowered root, so project.ts and the lowered trees stay as they are.
- packages/parity/src/markless-style-input.ts, packages/parity/src/markless-plan.ts
- packages/translate/harness/harness.ts; the generated Harness.swift and Harness.kt
- packages/parity/test/markless-rows.test.ts, markless-plan.test.ts, markless-row-text-space.test.ts (new)
- packages/parity/test/inline.test.ts (imports only)

## Open questions for the Judge

1. **DPR 1.** No plan records text at ratio 1 (PLAN_DENSITIES), so the phone path cannot run there. Options:
   - add a test-only `densities` argument to marklessPlan (proposed);
   - prove DPR 1 only through a chrome-dual tree fixture of the collapsed result, which proves the rules but not the harness;
   - drop DPR 1 for this path.
2. **The shape of F2.** Options:
   - a side table in the plan (proposed): the engine input and the native node lists are unchanged on every lane;
   - keeping dropped texts in every variant as "" leaves. This is simpler for the harness, but it changes every lowered tree and each host's text views, and it must prove that a "" leaf lays out as nothing.

   Also: does an optional `texts` field keep the plan at `dragon.markless-plan/1`?
3. **pre-line.** Lift the refusal (:4065) in RS2/RS3 with case 13 (proposed), or keep it refused by name until a Markless app needs it?
4. **Harness planted faults.** FAULT_KEYS (:1267) are engine faults. Should the two new faults be a third field of the rows line, read only when present (the harness ignores it otherwise), or a separate test-only entry point beside runMarklessRowsLayout?
5. **Capitalize neighbours.** Export the transform kind in `transformed` and refuse only capitalize after a changed text (proposed), or refuse any transformed fixed leaf in a context that holds a changed text?
6. **CR and FF.** The build treats U+000D and U+000C as phase I white space (resolve.ts:81). Chrome 145 does not collapse them when script sets them (the HTML parser normalises CR in markup). This spec refuses them in a changed text. Should a separate task capture what Chrome does and correct WHITE_SPACE for authored text?
7. **Out-of-flow boxes among inline content.** Chrome collapses white space across an abspos box (probe), but resolve.ts ends the context there (:623). That is outside this spec, but the phone inherits it, because both sides run the same code. Should it be its own task?
8. **Marking texts that change.** The style input does not say which texts change, so `plan.texts` covers every leaf whose source differs, and the harness accepts any leaf. Should Markless mark live texts? The table could then shrink to their contexts, and the phone could refuse a fixed leaf given as changed.

## Judge verdict (2026-11-23)

Approved with amendments.

- **Order.** RS1, then RS2, then RS3. RS2 never lands without RS3: stack them in one landing batch, or fold the Chrome cases 1, 5, 8 and 10 into RS2.
- **A1 (RS2): a self-check.** Over every existing Markless parity fixture and plan, withPhaseOne with every text at its F1 source and every dropped leaf inserted must equal the variant byte for byte.
- **A2 (RS2): struts and the table's shape.**
  - An emptied box's strut becomes null, as the build emits it (layout/src/validate.ts:924-942), not kept as C3 step 4 says.
  - The F2 strut is keyed to the block container, not to `parent`.
  - Ordered entries keep tree order when several dropped leaves sit before the same `next`.
  - checkMarklessPlan checks the ids, the variant range, that `next` is a child of `parent`, and that no entry repeats.
- **Q1: no DPR 1 on the phone path.** Prove the rules with function-level unit tests against the Chrome probe strings, at ratios 2 and 3 on iOS and Android, and 2.625 on Android.
- **Q2: a side table,** keeping `dragon.markless-plan/1` (precedent: the optional `slots?` and `transformed?`).
- **Q3: pre-line stays refused,** and case 13 is dropped.
- **Q4: a test-only entry point,** `runMarklessRowsLayoutWithFaults(line, shaper, faults)` (it keeps runMarklessRowsLayout's shaper argument). The production entry passes no faults, and the rows line and FAULT_KEYS stay unchanged.
- **Q5: refuse only a fixed capitalize leaf whose previous character comes from a changed text,** through a new optional `capitalized?: string[]`.
- **Q6: refuse CR and FF in a changed text.** A separate build-side task re-captures Chrome with corrected probes; the CR and FF numbers above, 11.95 and 23.34 px, cannot be right.
- **Q7: abspos inside inline content is a separate build-side task** after RS2, under A1.
- **Q8: don't mark live texts now.** RS2 reports the plan size growth on the Markless yardstick, and goes to the owner if it is over 5%.
- **Proof.** Chrome captures in Ahem and Lato, plus the two planted faults, which must also fail A1, or the PR explains why.
- **Missing evidence before RS2 finishes:** whether the Markless hosts can draw a leaf that had no text view at build time. If they cannot, refuse by name a text that was empty at build time.
- **Licensing.** The Blink files cited in this spec are BSD-licensed (The Chromium Authors). They were read as references only; no code is copied from them.
- **Completion.** Markless S42 passes on both phones against the landed Dragon.

## RS2 rulings (Judge, 2026-11-22)

RS2 is approved with these deviations from the text above:

1. **Two more files:** packages/dragon/src/internal.ts and packages/dragon/src/lower/ios-layout.ts (Files).
2. **Q4's signature** keeps the shaper: `runMarklessRowsLayoutWithFaults(line, shaper, faults)`.
3. **No span borders:** the engine refuses a border, padding or inline margin on an inline box (INL1b), so the fixtures' inline boxes have none, and the padded and bordered case of 3 waits for INL1b.
4. **letter-spacing, not font-size,** tells the boxes apart: the engine refuses adjacent texts in one face, size and spacing (`text-shaping-run`, Blink shapes them as one run), and mixed font sizes add a vertical difference that has nothing to do with white space. A space's width then shows which box owns it.
5. **Every empty text is recorded,** wherever it sits, so a host's string for one is refused by name even alone in its box (`<p>{t}</p>`); a white space only text only where its context keeps a text.
6. **A dropped text takes its owner element's face:** it inherits every font property from it, and faces are resolved for laid-out texts only.
7. **The two rewritten assertions** of markless-rows.test.ts: :237-250 now accepts " Groceries", "Groceries " and "" beside a `<b>`, each compared with the build; the U+200B refusal became the U+000D and U+000C refusals, and a segment break beside U+200B is accepted.
8. **The fault lists as measured** (Planted faults, above), and `fixedTextsAsLaidOut` passes A1: at the build's own strings phase I returns its own output, and a dropped text only ever held a space another text kept, so only a changed neighbour shows the fault.
9. **A textarea's editor keeps its emptied leaf and strut** in the phone's phase I (ruling 2026-11-23, after #672 landed): the build keeps that leaf so a run-time text can fill it, and the engine lays out an empty editor's line from its strut, so dropping it would fail A1 and give the empty textarea no height. The fact comes from the plan's control kinds (a text-editor inside a text-area); input fields still drop an emptied leaf.

**iOS inline-box height.** On iOS the fixtures compare span, b and i with Chrome on x and width only. The iOS target measures fonts as Safari does, rounding Core Text ascent and descent up to whole CSS px (system-fonts/provider.ts:127-136, feeding inline.ts:2241), and the comparator already refuses iOS against Chrome for author faces (markless-style-compare.ts:559-560). Their y and height stay covered by the device-equals-fresh-build check. Block and inline-block boxes keep all four values on both targets, and Android keeps all four everywhere.

Follow-up task: iOS inline-box height in Safari. Run the RS2 fixtures (cases 0-8, Ahem and Lato, iOS 2x and 3x) through Safari on iOS with pnpm markless:style-web-column, and compare span/b/i y and height with the device. If Safari matches, add the check against Safari and close with no build change; otherwise fix provider.ts:127-136 or the inline box metrics feeding inline.ts:2241 in the build, with a planted fault. Also explain why Lato 2x matches Chrome but Lato 3x and Ahem don't.

**RS3 still owes** cases 2, 4, 6, 7, 9, 11 and 12, and the bordered span once INL1b lifts.

## Host evidence (2026-11-22, Markless main plus #1128)

Neither host can draw a text leaf that had no box at build time, so RS2 refuses by name a changed string for a text the build dropped, and inserts dropped texts only for phase I (they never need a view: a restored space is drawn by nobody, it only moves the boxes after it).

- A host sends a page text only when its export node has a frame and its laid-out text differs (StyleExport.kt:309-311, StyleExport.swift:728-736).
- The new tree is built only from the build-time export's nodes, and a result id with no export node is ignored (StyleExport.kt:393-420, StyleExport.swift:834-862).
- On iOS a shown text whose export text was "" and now has content fails the text check (ResolvedStyle.swift:315-318), which is a fatalError (MarklessViewController.swift:440).
- So case 10 is a refusal test, not a Chrome case: "had no text box at build time".
