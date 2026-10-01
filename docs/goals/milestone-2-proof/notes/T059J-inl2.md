# T059J: INL2 scope amendment (Judge, 2026-10-01)

Supersedes the base and stop rules of T044 §3 INL2, and splits INL2 into three parts. The worker stopped before any edit at /tmp/dragon-inl2, branch inl2 at txt1a-2 e4266eb0e. Both stops were valid.

## Rulings

1. **Base: txt1a-2 e4266eb0e. Do not take SIZE-ar.**
   - A trial merge of size-ar 33ea62809 into txt1a-2 merges all five shared layout files (block, flex, intrinsic, input and validate.ts) with no conflicts.
   - Only 11 source files conflict. The other ~2170 conflicting files are generated and must be regenerated, never hand-merged.
   - The INL1a stack must do the same merge when it catches up after SIZE-ar lands (queue item 4 before 5). Merging now would mean two resolutions that later disagree, and would tie INL2 to SIZE-ar's review.
   - So the spec's 'never concurrent with SIZE-ar on intrinsic.ts or flex.ts' stop is replaced by a merge-conflict test. INL2a's set of conflicted non-generated paths against size-ar, repl-a-phase-b, form-a, form-a2 and inl1a-tags (once it exists) must be a subset of BASE's.
   - INL2a takes master changes only when txt1a-2 catches up, or when the queue reaches it.

2. **Split.**
   - **INL2a (checkpoint-3 path):**
     - inline-block and inline-flex as atomic inlines, with U+FFFC breaks and the resolve.ts collapse fix;
     - shrink-to-fit width through intrinsic.ts;
     - inline-block and inline-flex baselines, with baseline alignment only;
     - the new contexts, and the compare.ts anonymous-box hunk (the north-star disclosure shape).
   - **INL2b, stacked on INL2a:**
     - every CSS2 §10.8.1 vertical-align value in the engine, with top and bottom as a second pass and middle using the x-height;
     - the vertical-align longhand;
     - sub and sup;
     - Chrome fixtures;
     - plants topBottomSinglePass, middleWithoutXHeight, subShiftOwnFont and the compiler plant verticalAlignDropped;
     - the reject-inline-vertical-align retarget per T044.
   - **INL2c (deferred):** inline-blocks inside inline boxes (this changes the generated InlineChild union) and inline-blocks beside real-font text (this needs shaping.ts).
   - The north star uses neither vertical-align, sub nor sup. That is why engine vertical-align moves to INL2b: without the longhand no Chrome fixture could prove it.

3. **Refusals in INL2a.**
   - The engine's validate.ts and unsupported.ts append two codes: 'atomic-in-inline-box' and 'atomic-beside-shaped-text'. The second applies to a text leaf whose face is not Ahem in the same inline formatting context as an inline-block or inline-flex box.
   - The compiler raises DRAGON_UNPROVEN_CONTEXT naming INL2c.
   - Reject fixtures: reject-atomic-in-inline-box and reject-atomic-beside-shaped-text.
   - The existing reject-phrasing-inline-block is retargeted to inline-grid.
   - img, iframe, button and input as atomics stay refused, naming RF-INL (T053).

4. **S16 carve-out.** packages/parity/src/compare.ts, anonymousBoxes and its single use only. An anonymous box passes when it has at least one compared text line or compared inline-block/inline-flex child, and nothing uncompared. A test proves that the uncompared and empty cases still fail. No other S16 path is allowed.

5. **Identity.**
   - Existing captures, vector outputs, break vectors, emitted bodies (apart from relaxed headers and digests) and the pixel manifest base entries are byte-identical.
   - Profiles gain new rows only.
   - Generated union names are unchanged.
   - With no inline-block or inline-flex present, resolve.ts collapseInlineContext equals BASE's on every existing run plus a generated set.

6. **North star.**
   - DRAGON_UNPROVEN_CONTEXT falls 33 -> 31 on both ios and web: styles.css:353 (inline-flex) and :554 (inline-block).
   - No code count rises, and nothing new appears on play-icon, terms-link or privacy-link.
   - min-width 2.25rem, justify-content:center and rem margins must be proven by atomic-inline fixtures.

7. **Grammar (INL2b).**
   - Add a new SYNTAX_OVERRIDES table in scripts/gen-css-grammar.ts. It replaces a property's syntax, unlike SYNTAX_EXTENSIONS, which adds to it.
   - Its one entry, vertical-align, uses Chrome 145's CSS2 keywords plus <length-percentage>, cites Blink 145.0.7632.6 file:line, and is a longhand with initial baseline, not inherited.
   - A test pins the override list.
   - A Chrome CSS.supports matrix (each keyword; length, %, calc; 'first'; 'last'; 'sub 2px') must agree with the generated grammar N/N.
   - The longhand goes in a new packages/dragon/src/css/properties/inline.ts, which avoids FORM-a A2's box.ts and the TXT lanes' text.ts, plus its css/properties.ts registration line.
   - A new scripts/check-vertical-align-migration.ts, with plants that must fail, proves that captures, emitted bodies and UA entries differ only by vertical-align at its initial or UA value (the object-fit and appearance precedent).
   - FORM-a A2 also edits gen-css-grammar.ts. The later of the two regenerates at merge, and neither hand-merges.

## INL2a package

The objective, allowed_files, verify and stop_if are in the T059J receipt, copied onto T059a. In brief:
- Engine files: inline.ts, inline-box.ts, block.ts, flex.ts (export only), intrinsic.ts, box.ts, input.ts (Display union only), validate.ts, unsupported.ts and index.ts.
- Compiler files: resolve.ts (named hunks), blockify.ts (conditional), context.ts, computed-checks.ts and ios-layout.ts. The native emitters only if needed.
- Parity: compare.ts (the carve-out), the new atomic-inline group and outputs.
- Plants:
  - engine: inlineBlockFirstBaseline, overflowBaselineIgnored, inlineFlexLastBaseline, atomicMarginExcluded, noBreakAroundAtomic, atomicShrinkToFitIgnored;
  - compiler: atomicCollapsesAsLineEnd.
- Phase B (S18) runs when the landing queue reaches the branch.

## INL2a worker package (verbatim from the T059J receipt; PM accepted 2026-10-01)

**Objective.** INL2a on branch inl2 (/tmp/dragon-inl2), BASE = txt1a-2 e4266eb0e. (1) Engine: Display gains inline-block and inline-flex (input.ts, Display union only). An inline-block or inline-flex box is a LayoutBox among a block container's inline-level children (not inside an InlineBox), whose item is U+FFFC in the break text (INL-P family 5). Its margin box is the inline advance. Its width is shrink-to-fit (CSS2 10.3.9) through intrinsic.ts, and its min- and max-content contributions feed inlineIntrinsicSize. Baselines: inline-block uses its last line box's baseline, or the bottom margin edge when it has no in-flow line or overflow is not visible (block.ts exports the last-line baseline); inline-flex uses FlexResult.baseline per Blink InlineBlockBaseline (flex.ts: an export only, if any). Only vertical-align: baseline; other values stay refused (INL2b). validate.ts and unsupported.ts append the codes 'atomic-in-inline-box' and 'atomic-beside-shaped-text'. The second applies when an inline formatting context holding an inline-block or inline-flex box also holds a text leaf whose face is not Ahem (no shaping.ts change). (2) Compiler: resolve.ts collapseInlineContext/gather/flush keep the box as U+FFFC, so 'aa <ib> bb' keeps 'aa ' and ' bb' as Chrome does (INL-P f5-break-space-atomic). context.ts adds ItemBase 'atomic-inline' and TextContext text-beside-atomic/<dir>. computed-checks.ts handles the contexts, plus DRAGON_UNPROVEN_CONTEXT, naming INL2c, for an inline-block or inline-flex inside an inline box or beside real-font text. ios-layout.ts lowers these boxes inside inline content and includes them in CSS2 9.2.1.1 anonymous wrapping. blockify.ts is changed only if a UA-default inline-block or inline-flex on a supported non-replaced, non-control tag needs the lift; img, iframe, button and input stay refused, naming RF-INL. (3) Parity: compare.ts anonymousBoxes and its single use only: an anonymous box passes when it has at least one compared text line or compared inline-block/inline-flex child and nothing uncompared. (4) Fixture group atomic-inline, ltr and rtl at DPR 1, 2, 3 and 2.625: INL-P family 5 including f5-break-space-atomic; an empty inline-block; an overflow-hidden inline-block baseline; an inline-flex span with min-width 2.25rem and justify-content:center inside a blockified flex item; a disclosure-shaped case (a block span plus two inline-block a elements without href, margin 0.55rem 0.35rem 0, giving an anonymous box that holds only inline-blocks); and rejects reject-atomic-in-inline-box and reject-atomic-beside-shaped-text. Retarget reject-phrasing-inline-block to inline-grid. (5) Plants. Engine: inlineBlockFirstBaseline, overflowBaselineIgnored, inlineFlexLastBaseline, atomicMarginExcluded, noBreakAroundAtomic, atomicShrinkToFitIgnored. Compiler: atomicCollapsesAsLineEnd. Each is caught by a named fixture or vector.

**allowed_files**
- packages/layout/src/inline.ts
- packages/layout/src/inline-box.ts
- packages/layout/src/block.ts (last-line baseline export, atomic dispatch, EngineFaults/NO_ENGINE_FAULTS appends)
- packages/layout/src/flex.ts (baseline export only)
- packages/layout/src/intrinsic.ts (atomic contributions and the shrink-to-fit call)
- packages/layout/src/box.ts (additive Frag field, if needed)
- packages/layout/src/input.ts (Display union only)
- packages/layout/src/validate.ts
- packages/layout/src/unsupported.ts (two codes appended)
- packages/layout/src/index.ts (append)
- packages/layout/generated/** (native:gen output)
- packages/layout/vectors/** (new files) and packages/layout/vectors/README.md
- packages/layout/break-vectors/** (new files)
- packages/layout/test/inline-atomic*.test.ts (new); packages/layout/test/inline.test.ts, inline-box.test.ts and unsupported.test.ts (appends and derived pins)
- packages/translate/src/corpus.ts, packages/translate/src/corpus-dpr.ts, packages/translate/harness/harness.ts (additive atomic suite or engine-inline extension)
- packages/translate/corpus.json, packages/translate/corpus-dpr.json, packages/translate/corpus-m1-cases.json (lock output)
- packages/dragon/src/analysis/resolve.ts (collapseInlineContext, gather and flush hunks and an isAtomicInline helper only)
- packages/dragon/src/analysis/blockify.ts (checkInlineLevel only, conditional as stated in the objective)
- packages/dragon/src/analysis/context.ts (the atomic-inline ItemBase and text-beside-atomic context only)
- packages/dragon/src/analysis/computed-checks.ts (the new contexts and the two refusals)
- packages/dragon/src/lower/ios-layout.ts
- packages/dragon/src/lower/native-program.ts, packages/dragon/src/emit/uikit.ts, packages/dragon/src/emit/android-views.ts, packages/dragon/src/emit/expected-dump.ts, packages/dragon/src/emit/native-support.ts (only if the box display mapping needs them; each hunk named in the receipt)
- packages/dragon/src/faults.ts (append)
- packages/dragon/src/diagnostics/catalogue.ts (one entry per line, if needed)
- packages/dragon/test/diagnostic-codes.json (append-only)
- packages/dragon/test/inline-atomic*.test.ts (new); packages/dragon/test/seams.test.ts (append-only); packages/dragon/test/blockify.test.ts (refusal pin retargeted to inline-grid or a replaced element, keeping its intent)
- packages/dragon/src/profiles/*.ts (output: new rows only)
- packages/parity/src/compare.ts (anonymousBoxes and its single use only)
- packages/parity/src/fixtures.ts (one appended group)
- packages/parity/src/fixture-groups/atomic-inline.ts (new)
- packages/parity/fixtures/* (new files; plus the reject-phrasing-inline-block retarget to inline-grid)
- packages/parity/expected/**, packages/parity/expected-dpr/** (new files)
- packages/parity/emitted/** (new bodies; headers relaxed)
- packages/parity/expected-breaks/**, packages/parity/expected-pixels/** (new case files and appended manifest entries)
- packages/parity/test/*.test.ts (appends covering the compare.ts hunk and the new group; derived count pins only)
- packages/wpt/test/reftest.test.ts (only if line 35 pins a refusal)
- packages/parity/out/lanes.json, examples/music-player/dragon/north-star-check.json, packages/wpt/expectations/*.json, packages/tailwind-sweep/snapshot/tailwind-4.3.3.json (generator output; every verdict change listed in the receipt and PR body)
- docs/goals/milestone-2-proof/notes/T059-inl2.md (main checkout only)

**verify**
- E = export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&; BASE=e4266eb0e
- S1-S15 and S17 of notes/T044-inl-spec.md, standard verify block S, with BASE=e4266eb0e
- S16 with packages/parity/src/compare.ts removed from the list; `git diff $BASE -- packages/parity/src/compare.ts` touches only anonymousBoxes and its single use, and the receipt quotes the hunk. A test proves that an anonymous box with an uncompared inline-block child, or one with no lines and no inline-block children, still fails
- Identity: `git diff --diff-filter=MD --exit-code $BASE -- packages/parity/expected packages/parity/expected-dpr packages/layout/break-vectors packages/parity/expected-breaks`; the S6 node -e check shows every existing vector output unchanged; `git diff --diff-filter=M $BASE -- packages/parity/emitted` shows only relaxed header and digest lines plus declared runtime lines; S9 shows new profile rows only; the pixel manifest base entries are unchanged
- Union identity: `git diff $BASE -- packages/layout/generated | grep -E '^-.*U_InlineBox_LineBreak_TextLeaf'` prints nothing (InlineChild is unchanged)
- resolve.ts identity test (new): with no inline-block or inline-flex present, the new collapseInlineContext equals BASE's on every existing fixture text run plus a generated set; and f5-break-space-atomic keeps 'aa ' and ' bb' as Chrome does
- Merge-conflict test: for B in size-ar, repl-a-phase-b, form-a, form-a2 (and inl1a-tags if it exists): the set of non-generated paths that `git merge-tree --write-tree --name-only --no-messages HEAD $B` reports as conflicted is a subset of the same set for BASE $B; the receipt lists both sets
- S8: failed 0 at DPR 1, 2, 3 and 2.625; the atomic-inline group passes Chrome-dual frames and lines in ltr and rtl
- S10: every named plant (inlineBlockFirstBaseline, overflowBaselineIgnored, inlineFlexLastBaseline, atomicMarginExcluded, noBreakAroundAtomic, atomicShrinkToFitIgnored, atomicCollapsesAsLineEnd) fails its named case at every DPR, and the unfaulted run passes
- S15 north star: DRAGON_UNPROVEN_CONTEXT for ios and web each fall by at least 2 (33 -> 31: the inline-flex at styles.css:353 and the inline-block at :554); no diagnostic code count rises on any target; no new diagnostic appears on play-icon, terms-link or privacy-link; WPT numeric passes rise, or the receipt explains why not
- E pnpm run linebreak:conformance passes; S13 existing break vectors byte-identical
- Phase B (S18) only when the PM's landing queue reaches this branch and it has caught up with its base; until then report 'device step pending'

**stop_if**
- Any stop_if from INL1a's list in notes/T044-inl-spec.md, except the BASE-contents check, which this package replaces with BASE = txt1a-2 e4266eb0e
- A file outside allowed_files is needed, including shaping.ts, text.ts, layout.ts, anything under packages/dragon/src/css/**, scripts/gen-css-grammar.ts, the ua generated files, capture.ts, or any S16 path other than compare.ts anonymousBoxes
- The InlineChild union or any generated union name would change
- Any existing output changes beyond relaxed headers and digests, new profile rows, and appended manifest entries: a capture, vector output, break vector, emitted body, profile row, lanes check, WPT pass or pixel manifest base entry
- The merge-conflict test's set grows against size-ar, repl-a-phase-b, form-a, form-a2 or inl1a-tags
- Any fixture needs vertical-align other than baseline, sub, sup, or a font other than Ahem beside an inline-block or inline-flex box
- Chrome's inline-block or inline-flex baseline, shrink-to-fit width or break around U+FFFC disagrees with the engine, and Blink 145.0.7632.6 does not explain it
- A plant is not caught; a tolerance, gate, case, DPR or direction would be loosened
- The branch would merge origin/master, size-ar or any later branch before the landing queue reaches it
- The north-star target is unmet because min-width, justify-content or rem margins in the new contexts cannot be proven by fixtures in this group
- Verification fails twice (test timeouts under load that pass on rerun excepted)

## INL2a host work (2026-10-01): inl2a-engine 93cee282e → inl2 e3742bc66

**Result.**
- 11 atomic-inline cases are Chrome-exact at every DPR, in ltr and rtl.
- All 7 plants are caught.
- Breaks equal Chrome's on 1497/1497.
- Existing outputs are byte-identical, and the profiles gain 45 new rows.

**Refused with typed codes:**
- an atomic an rtl paragraph would reorder;
- a relatively positioned atomic;
- a percentage height on an atomic;
- an inline-block whose last baseline would come from a flex child.

**PM ruling T059J-1:**
- **native-compare.ts:** it gets the same anonymous-box rule as compare.ts.
- **fonts.ts:** it gets MAPS entries for the Lato fixtures.
- **tailwind-sweep chrome.ts:** it waits for `document.fonts.ready`. This fixes a real race that flipped inline-block between mismatch and supported.
- **inl1a-tags overlap:** accepted as append-only. The landing order is TXT1a, then T133, then INL2a.

**Expected north-star result with the amendment:** UNPROVEN_CONTEXT falls from 33 to 31 on ios and web.
