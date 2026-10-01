# T149J TXT2 (Judge, 2026-10-01)

Shared header (licence, north-star use): see notes/T148J-tdec.md.

## Part 2: T149 TXT2, text breadth

### Chrome's behaviour

**white-space.**
- The shorthand already expands (shorthands/text.ts on txt-w2). pre is preserve + nowrap, pre-wrap is preserve + wrap, pre-line is preserve-breaks + wrap, and break-spaces is break-spaces + wrap.
- The item builder dispatches on preserve (AppendPreserveWhitespace :1018), preserve-breaks (AppendPreserveNewline :1116) and collapse (:767) at inline_items_builder.cc:656-661. Forced breaks are at :1139.
- Line breaker:
  - preserved trailing spaces hang (HandleTrailingSpaces :2384-2480, :1873-1966);
  - break-spaces breaks after every space and does not hang (:4555-4557, :2429);
  - tabs follow tab-size (:2921-2926).

**letter-spacing** (inherited, css_properties.json5:3848).
- It is added after every grapheme cluster, the last one included, in TextRunLayoutUnit (shape_result.cc:986-1039; shape_result_spacing.cc ComputeSpacing).
- It is skipped for zero-width spaces and cursive scripts (IgnoreLetterSpacingInCursiveScripts is stable).
- It disables liga and clig (font_features.cc:64-74).
- It changes widths and so breaks, min-content and max-content.

**word-break and overflow-wrap.** In line_breaker.cc:4476-4560:
- break-all and keep-all choose the iterator mode. text_break_iterator.cc:51-145 and :249-330 are LGPL, so clean-room.
- break-word is normal plus anywhere-if-overflow.
- overflow-wrap: anywhere applies always. break-word applies in content mode only, so it does not change min-content.
- In min-content mode, anywhere sets override_break_anywhere_ (break-character: grapheme clusters).
- Overflow retry: HandleOverflow and RetryAfterOverflow (:4008-4250).

**text-transform** (ComputedStyle::ApplyTextTransform, LGPL behaviour, computed_style.cc:2114-2145).
- uppercase and lowercase use ICU CaseMap with the content-language locale. Only tr, az, el, lt and nl are special (case_map.cc:161-190). The uppercase result has new Georgian capitals disabled.
- capitalize uses Blink's Capitalize (capitalize.cc:15-58, BSD): an ICU word-break iterator, u_totitle on the first character of each word, NBSP treated as a space, and the previous character carried across text nodes. ICUCapitalization is experimental (runtime_enabled_features.json5:2973), so it is off.
- The data is Unicode 16.0: UnicodeData simple mappings, SpecialCasing (unconditional, plus Final_Sigma), and WordBreakProperty for capitalize.

**text-overflow** (line_truncator.cc, BSD).
- It applies only when the block truncates overflowing text (inline_layout_algorithm.cc:421-440).
- The ellipsis is styled with the line style, meaning the block's font (:43-48). It is U+2026 if the primary font has it, otherwise '...' (:50-60). It is shaped, and its width is SnappedWidth (:62-71).
- OffsetToFit truncation is at :505-557. The text after the ellipsis is hidden at paint, and the block's layout size does not change.

### Split and order

The order on inline.ts and linebreak.ts is serial:

INL2a -> TXT2-a -> INL2b -> TXT2-b -> TXT2-c -> TXT2-d -> TXT2-f.

TXT2-e touches no layout file. It goes in any slot after TXT2-a, and may run beside INL2b under the merge-conflict test.

**TXT2-a (now; checkpoint-3 path). Branch txt2a on inl2 996450466.**
- overflow-wrap normal, break-word and anywhere, and word-break: break-word.
- UAX #29 grapheme clusters at Unicode 16, clean-room, with generated data and conformance tests.
- The anywhere-if-overflow port and min-content.
- A TextLeaf migration adding overflowWrap and wordBreak.
- letter-spacing accepted only as normal or zero.
- The worker package is in the receipt. INL2b restacks on it.

**TXT2-b. letter-spacing.**
- A TextLeaf letterSpacing field as a CalcExpr, resolved by the environment pass. em follows font size and text scale. % only if Chrome's CSS.supports accepts it.
- The ApplySpacingOrExpansion port in shaping.ts.
- liga and clig turned off through the shim's feature ranges. This is a text-shaper carve-out limited to the feature input, and the HarfBuzz gate must stay 620/620.
- Plants: trailingSpacingDropped, ligaturesKept and spacingPerCodePoint.

**TXT2-c. white-space preserve modes.**
- pre, pre-wrap, pre-line and break-spaces (white-space-collapse preserve, preserve-breaks and break-spaces).
- Compiler phase I in resolve.ts follows the item builder.
- Engine: forced breaks from preserved newlines, hanging preserved spaces, and break-spaces.
- Refused: tabs (code 'tab-stop', a later part); the pre tag (Chrome's 13px monospace quirk); preserved text across inline boxes until Chrome cases cover it.
- Plants: preservedSpaceCollapsed, trailingPreWrapNotHanging and breakSpacesHanging.

**TXT2-d. word-break: break-all and keep-all.**
- Clean-room from css-text-3 §5.2 over UAX #14 in linebreak.ts. The Chrome opportunity corpus is captured the way chrome145-rules.json was.
- auto-phrase stays refused.

**TXT2-e. text-transform: none, uppercase, lowercase and capitalize, at build time over static text.**
- A new analysis/text-transform.ts and generated Unicode 16 case and word data, with one call site in resolve.ts before collapsing.
- Refused:
  - full-width, full-size-kana and math-auto;
  - lang tr, az, el, lt or nl;
  - Georgian;
  - script-set text slots (DTXT) with a transform.
- Proof: Chrome text-content captures (the transformed string per line) plus lines and pixels.

**TXT2-f. text-overflow: ellipsis.**
- Requires overflow other than visible on the block.
- An engine line truncation pass and a native ellipsis glyph run (paint).
- Refused: string values, rtl, atomic inlines in a truncated line, and line-clamp.
- Plants: ellipsisInTextFont, noDotsFallback and truncateChangesBlockSize.

### Proof (every part)

- Chrome captures of lines, advances and breaks at DPR 1, 2, 3 and 2.625.
- Pixel PNGs.
- Grammar and computed-value tables.
- Named plants, each caught.
- Existing outputs byte-identical, apart from declared migrations through a check script whose plants fail.
- Phase B on both leases when the landing queue reaches the branch.
- No tolerance is added anywhere.

### Checkpoint-3 path

- TDEC-a and TDEC-b, plus TDEC-d only if the bounds proof fails.
- TXT2-a.
- Everything else is top-100 breadth, off the path.


## TXT2-a worker package (verbatim from the receipt; PM accepted 2026-10-01)

**Objective.** TXT2-a (T149 part a, checkpoint-3 path), on a new branch txt2a in worktree /tmp/dragon-txt2a. BASE = inl2 996450466: TXT2-a takes the inline.ts slot right after INL2a, and INL2b stacks after it.
(1) Grapheme clusters. A new packages/layout/src/grapheme.ts implements UAX #29 extended grapheme cluster boundaries at Unicode 16.0, the version of ICU 77, which Chrome 145 pins in DEPS (icu a86a32e6). It is clean-room work: text_break_iterator.cc is LGPL and is a behaviour reference only.
  scripts/gen-linebreak-data.ts emits a new packages/layout/src/grapheme-data.ts from GraphemeBreakProperty.txt, emoji-data Extended_Pictographic and DerivedCoreProperties InCB, each pinned by sha256. linebreak-data.ts stays byte-identical.
  linebreak:conformance also runs GraphemeBreakTest-16.0.0 N/N.
  A Chrome Intl.Segmenter('grapheme') capture over a corpus is committed under packages/layout/test/fixtures/grapheme/ and must agree N/N.
(2) linebreak.ts. LineBreakStyle accepts overflowWrap break-word and anywhere, and wordBreak break-word. Add a break-character opportunity mode: every grapheme boundary.
(3) inline.ts. Port Blink LineBreaker's anywhere-if-overflow path:
  - SetCurrentStyleForce (line_breaker.cc:4476-4560). word-break: break-word is normal plus anywhere-if-overflow. overflow-wrap: anywhere always applies. break-word applies in content mode only, never in min-content.
  - The BreakText overflow hunk (:1567-1700, :1635).
  - HandleOverflow and RetryAfterOverflow (:4008-4250). An emergency grapheme break is taken only when a line overflows with no earlier opportunity.
  - In min-content mode, anywhere and word-break: break-word set override_break_anywhere_ (break-character), which shrinks min-content and the flex automatic minimum.
  - nowrap is unaffected (auto_wrap_ is false).
(4) Engine input. TextLeaf gains overflowWrap and wordBreak (input.ts), migrated by the generator only.
  A new scripts/check-text-wrap-migration.ts proves that vector inputs, emitted bodies and captures differ only by these keys at 'normal'. Its plants must fail.
  validate.ts and unsupported.ts append the code 'word-break' for break-all, keep-all and auto-phrase, naming TXT2-d.
(5) Compiler. A new packages/dragon/src/css/properties/text-wrap.ts registers overflow-wrap (with Chrome's word-wrap alias), word-break and letter-spacing, all inherited.
  letter-spacing is accepted only as normal or a literal zero length, with the computed value as Chrome captures it. Any other value is DRAGON_UNSUPPORTED_VALUE naming TXT2-b. line-break other than auto stays refused.
  lower/ios-layout.ts writes the two fields, and native-support.ts changes only the TextLeaf literal.
(6) Fixture group text-wrap-break, in Ahem and Lato 400/700, ltr and rtl (Latin), at DPR 1, 2, 3 and 2.625, with breaks and pixel PNGs. Cases:
  - anywhere, break-word and word-break: break-word on an overflowing word;
  - an earlier opportunity that wins over an emergency break;
  - combining marks (e + U+0301) never split;
  - nowrap with anywhere;
  - a flex item whose min-content changes under anywhere but not under break-word;
  - the north-star shapes: an h2 at 20rem with anywhere, and the disclosure span (flex 1 1 100%, max-width 100%).
  Reject fixtures: break-all, keep-all, and nonzero letter-spacing.
(7) Plants. Engine: anywhereMinContentIgnored, breakWordShrinksMinContent, graphemeClusterSplit, breakAnywhereAlways, emergencyBreakBeforeOpportunity, wordBreakBreakWordIgnored. Compiler: overflowWrapNotInherited.

**allowed_files**
- packages/layout/src/grapheme.ts (new)
- packages/layout/src/grapheme-data.ts (new; linebreak:gen output only)
- scripts/gen-linebreak-data.ts (grapheme data emission and the GraphemeBreakTest conformance; linebreak-data.ts output byte-identical)
- packages/layout/src/linebreak.ts
- packages/layout/src/inline.ts
- packages/layout/src/intrinsic.ts (min-content hunk only, if needed)
- packages/layout/src/shaping.ts (break-offset hunk in the line view only, if needed; named in the receipt)
- packages/layout/src/input.ts (TextLeaf fields only)
- packages/layout/src/validate.ts
- packages/layout/src/unsupported.ts (append)
- packages/layout/src/index.ts (append)
- packages/layout/generated/** (native:gen output)
- packages/layout/vectors/** (new files and generator-migrated inputs)
- packages/layout/break-vectors/** (new files)
- packages/layout/test/grapheme.test.ts (new), inline-wrap*.test.ts (new)
- packages/layout/test/linebreak.test.ts, inline.test.ts, unsupported.test.ts (appends and derived pins)
- packages/layout/test/fixtures/grapheme/** (new: Chrome Intl.Segmenter capture script and JSON)
- scripts/check-text-wrap-migration.ts (new)
- packages/translate/src/corpus.ts, corpus-dpr.ts, packages/translate/harness/harness.ts (additive)
- packages/translate/corpus.json, corpus-dpr.json, corpus-m1-cases.json (lock output)
- packages/dragon/src/css/properties/text-wrap.ts (new)
- packages/dragon/src/css/properties.ts (one import and spread)
- packages/dragon/src/css/grammar.generated.ts (grammar:gen only)
- scripts/gen-css-grammar.ts (SUBSET entries only)
- packages/dragon/src/analysis/computed-checks.ts (the TXT2 refusals)
- packages/dragon/src/analysis/computed.ts (one hunk, if needed)
- packages/dragon/src/lower/ios-layout.ts (TextLeaf fields)
- packages/dragon/src/emit/native-support.ts (TextLeaf literal only)
- packages/dragon/src/faults.ts (append)
- packages/dragon/src/diagnostics/catalogue.ts (append)
- packages/dragon/test/diagnostic-codes.json (append-only)
- packages/dragon/test/text-wrap.test.ts (new), seams.test.ts (append-only)
- packages/dragon/src/profiles/*.ts (output: new rows only)
- packages/parity/src/fixtures.ts (one appended group)
- packages/parity/src/fixture-groups/text-wrap-break.ts (new)
- packages/parity/fixtures/text-wrap-break-*.html, reject-text-wrap-*.html (new)
- packages/parity/src/fonts.ts (MAPS entries for the new fixtures)
- packages/parity/expected/**, expected-dpr/**, expected-breaks/**, expected-pixels/** (new case files and appended manifest entries)
- packages/parity/emitted/** (new bodies; relaxed headers)
- packages/parity/test/text-wrap-break.test.ts (new); other parity tests (derived count pins only)
- packages/parity/out/lanes.json, examples/music-player/dragon/north-star-check.json, packages/wpt/expectations/*.json, packages/tailwind-sweep/snapshot/tailwind-4.3.3.json (generator output; every verdict change listed)
- docs/goals/milestone-2-proof/notes/T149-txt2a.md (main checkout only)

**verify**
- E = export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&; BASE=996450466
- S1-S17 of notes/T044-inl-spec.md (standard verify block S) with BASE=996450466. S16 is unchanged: linebreak-data.ts, packages/text-shaper and package.json must be byte-identical.
- cd /tmp/dragon-txt2a && E pnpm run linebreak:gen && git diff --exit-code $BASE -- packages/layout/src/linebreak-data.ts && pnpm run linebreak:conformance  # LineBreakTest and GraphemeBreakTest-16.0.0 N/N
- cd /tmp/dragon-txt2a && npx vitest run packages/layout/test/grapheme.test.ts  # Chrome Intl.Segmenter grapheme capture N/N
- cd /tmp/dragon-txt2a && E node scripts/check-text-wrap-migration.ts  # inputs differ only by overflowWrap/wordBreak = 'normal'; its plants fail
- Identity: `git diff --diff-filter=MD --exit-code $BASE -- packages/parity/expected packages/parity/expected-dpr packages/layout/break-vectors packages/parity/expected-breaks`; every existing vector output is unchanged (S6 check); generated union names are unchanged
- S8: failed 0 at DPR 1, 2, 3 and 2.625. The text-wrap-break group matches Chrome's frames, lines and breaks in ltr and rtl, and engine breaks equal Chrome's N/N.
- S10: each named plant fails its named case at every DPR, and the unfaulted run passes
- S15 north star: property:overflow-wrap 4 -> 0 and property:letter-spacing 1 -> 0 on web and ios; no code count rises on any target
- Merge-conflict test: for B in txt-w2, inl1a-tags, size-ar, form-a, form-a2, the conflicted non-generated paths from `git merge-tree --write-tree --name-only --no-messages HEAD $B` are a subset of BASE's; the receipt lists both sets
- S18 (Phase B) only when the landing queue reaches this branch; until then report 'device step pending'

**stop_if**
- Any stop_if of INL2a in notes/T059J-inl2.md, with BASE = inl2 996450466.
- INL2b has already been dispatched on inl2, or inl2 is rewritten. Stop; the PM restacks.
- A file outside allowed_files is needed: packages/text-shaper, package.json, linebreak-data.ts, text.ts, layout.ts, or shaping.ts beyond the one named hunk.
- Chrome's breaks or min-content disagree with the port, and line_breaker.cc at 145.0.7632.6 does not explain it.
- Intl.Segmenter disagrees with UAX #29 16.0 on a case (an ICU tailoring). Report it with the case.
- Any existing output changes beyond the migration keys, new profile rows, relaxed headers and appended manifest entries.
- The work needs an LGPL file ported (text_break_iterator.cc, layout_text.cc).
- A plant is not caught, or a tolerance, gate, case, DPR or direction would be loosened.
- The diff, excluding generated outputs, goes over about 150 KB. Split into txt2a-engine and txt2a (compiler and fixtures), as INL2a did.
- Verification fails twice (test timeouts under load that pass on rerun excepted).

## PM amendment T149J-1 (2026-10-01): a shaping.ts retry hunk

**What is allowed.** About 40 lines that port Blink HandleOverflow and RetryAfterOverflow (line_breaker.cc:4182-4186, :1635) into shaping.ts breakItemLines. This is the anywhere-if-overflow path for real-font text, such as the north-star h2 in Lato.

**Why it is needed.** inline.ts cannot emulate the path. Grapheme opportunities added up front would let the previous line take part of the overflowing word, which Blink does not do.

**Conditions.**
- With the flags off, every existing output is byte-identical, and the HarfBuzz gate still passes 620/620.
- A shaped-path plant must be caught by the Lato fixtures.
- Stop if the hunk grows past about 80 lines, or touches text.ts or layout.ts.
