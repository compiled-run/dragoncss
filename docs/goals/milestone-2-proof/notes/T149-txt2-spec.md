# T149 Judge: TXT2 text breadth, binding worker spec

Judge, read-only, 2026-10-03. This spec supersedes the T149J split (notes/T149J-txt2.md, "Split and order") for every part after TXT2-a. It keeps T149J's TXT2-a package and its three PM amendments (T149J-1, -2, -3) as they are.

**What I read:**
- AGENTS.md;
- docs/goals/milestone-2-proof/goal.md, and the design principles in docs/goals/milestone-1/goal.md;
- docs/research/coverage-roadmap.md (the TXT2 row; §4 says txt is serial);
- docs/decisions.md ("Text strategy", "Text shaping", "Real-font text in the engine", "Adding engine fields and CSS longhands", "Inline layout", "Native glyph advances", "Porting Chrome's algorithms");
- docs/ports.md;
- the state.yaml card T149, notes/T149J-txt2.md, T059J-inl2.md, T148J-tdec.md, T147J-txt-weight.md, and PM-2026-10-01.md (the restack entries of 2026-10-02);
- the spec shape of T044 §2 and §3 (standard verify block S), and T045 and T046.

**Code I read:** the branches txt2a, inl2b, txt1a-2-v2 and txt-w2-v2, in /tmp/dragon-txt2a, /tmp/dragon-txt1a-2-v2 and /tmp/dragon-txt-w2-v2.

**Chrome evidence:**
- Source at tag 145.0.7632.6, fetched to /tmp/t149j, which has copies of every file cited below.
- Usage numbers: chromestatus.com/data/csspopularity, fetched 2026-10-03 for 2026-10-01 (/tmp/csspop.json).
- Three Chrome 145.0.7632.6 probe runs at DPR 1 with Ahem and Lato 400: /tmp/t149j/probe.mjs, probe2.mjs and probe3.mjs, with outputs in probe2.json, probe2-out.json and probe3-out.json. Each ran under /tmp/heavy-lease.sh.

## 0. State of the earlier TXT2 work (branches txt2a and inl2b)

**txt2a 919021f19 (TXT2-a, host-done 2026-10-01; PM accepted).** It has 8 commits on inl2 08df24673 (INL2a), which sits on the old txt1a-2 e4266eb0e. Neither branch has been restacked onto the v2 text stack.

Done and verified on the host:
- **Graphemes.** packages/layout/src/grapheme.ts implements UAX #29 extended grapheme clusters at Unicode 16.0.0, clean-room. Its data, grapheme-data.ts, comes from `linebreak:gen`, and linebreak-data.ts is byte-identical. GraphemeBreakTest passes 1093/1093. The Chrome `Intl.Segmenter('grapheme')` capture agrees 1109/1109 (packages/layout/test/fixtures/grapheme/).
- **Breaking.** overflow-wrap normal, break-word and anywhere, and word-break: break-word, are ported from Blink LineBreaker: SetCurrentStyleForce, HandleOverflow and RetryAfterOverflow, and the min-content override_break_anywhere_. The port is in inline.ts (Ahem) and in a 37-line shaping.ts hunk (real fonts, PM amendment T149J-1). The HarfBuzz gate still passes 620/620.
- **Engine input.** TextLeaf gains `overflowWrap` and `wordBreak`, migrated by the generator. scripts/check-text-wrap-migration.ts catches its 6 plants. validate.ts and unsupported.ts append the code 'word-break' for break-all, keep-all and auto-phrase.
- **Compiler.** packages/dragon/src/css/properties/text-wrap.ts registers overflow-wrap, word-break and letter-spacing, all inherited. letter-spacing is accepted only at normal or 0, through `checkLetterSpacing` in computed-checks.ts. A new 'mixed-break' refusal covers an inline formatting context whose texts differ in overflow-wrap or word-break. ua:capture adds the three properties to every tag table (amendment T149J-3).
- **Fixtures and plants.** The fixture group text-wrap-break covers Ahem, Lato and flex, each in ltr and rtl, at every DPR. Reject fixtures cover break-all, keep-all and nonzero letter-spacing. All named plants are caught.
- **North star on its own base.** The 4 overflow-wrap and 1 letter-spacing property errors are gone on web and iOS.

Not done:
- the restack onto the v2 text stack;
- the device step (Phase B);
- a PR and its review;
- the `word-wrap` alias (deferred to TXT2-b in the T149J receipt; this spec moves it to TXT2-d);
- a combining-mark layout fixture (the shaping core refuses U+0301; grapheme.test catches the plant instead).

The Android "+8 value refusals" is an artefact of the old base. It disappears at restack.

**Finding F1, which TXT2-b must fix.** txt2a's profiles carry rows `letter-spacing:<length-px>` `exact` in six contexts (ios.ts:1166-1171 and the web twins). Their only proof is cases whose letter-spacing is 0. The real limit, "only 0", is the literal `checkLetterSpacing` in computed-checks.ts. That restates a support fact outside the profiles, which AGENTS.md forbids ("Support facts live in the support profiles").

The fix:
- **At the TXT2-a restack.** The PM decides whether the restacked TXT2-a narrows the row to a value subset of 0, if profile:rows can express it, or keeps the check with this finding recorded. I recommend keeping it, because TXT2-b replaces it.
- **In TXT2-b (binding).** Delete `checkLetterSpacing`. After that, nonzero letter-spacing is accepted only through rows proved by nonzero cases.

**inl2b c638e25d5 (INL2b, host-done 2026-10-01).** It holds no TXT2 work. It stacks on txt2a, so it carries TXT2-a. Its own work is the vertical-align longhand (every CSS2 §10.8.1 value) and the sub and sup tags. It has not been restacked or reviewed.

**Reuse.** TXT2-a is reused as it is: the INL2 lane restacks inl2 → txt2a → inl2b as *-v2 branches (PM-2026-10-01, "INL1a train 3 ready"). Every part below builds on its grapheme segmenter, the LineBreakStyle plumbing, the TextLeaf migration checker pattern and the text-wrap-break fixture group.

**TXT2-a PR split at landing.** txt2a's reviewed diff is about 205 KB, measured against inl2 with the .macroscope ignore shapes and the profiles, the snapshot and north-star-check.json excluded. It must open as two PRs, as INL2a did:
- **txt2a-engine:** grapheme.ts, the generator, linebreak.ts, inline.ts, the shaping.ts hunk, input.ts, validate.ts and unsupported.ts, with their tests;
- **txt2a:** the compiler, the parity group, the UA regeneration commit and the derived pins.

## 1. Usage and order

These are Chrome Platform Status figures (% of page loads, 2026-10-01). The rank is out of all CSS properties.

| Property | Rank | % | Part |
|---|---|---|---|
| white-space | 34 | 81.4 | TXT2-c1, TXT2-c2 |
| text-transform | 56 | 72.1 | TXT2-e |
| letter-spacing | 68 | 68.2 | TXT2-b |
| text-overflow | 74 | 65.6 | TXT2-f |
| word-break | 88 | 57.6 | TXT2-d (break-word is done in TXT2-a) |
| overflow-wrap | 121 | 44.6 | done in TXT2-a; the word-wrap alias is in TXT2-d |
| -webkit-line-clamp | 124 | 44.3 | TXT2-g (`line-clamp` is 0.0, and invalid in Chrome 145) |
| text-indent | 142 | 35.8 | TXT2-h |
| hyphens | 219 | 18.5 | TXT2-i |
| word-spacing | 271 | 13.9 | TXT2-b (the same Blink function as letter-spacing) |
| tab-size | 272 | 13.8 | TXT2-c3 |

Blink's -webkit-box-orient sits at rank 103 (50.5%), almost entirely from the line-clamp idiom.

**Serial chain.** Every part except TXT2-e edits inline.ts, shaping.ts or linebreak.ts. Those files are serial under roadmap §4 and decisions.md "Inline layout". The chain follows usage order:

**TXT2-c1 → TXT2-c2 → TXT2-b → TXT2-f → TXT2-d → TXT2-g → TXT2-h → TXT2-i → TXT2-c3**

**TXT2-e** is compiler-only. It runs in parallel with the chain from the same base (R13).

## 2. Rulings

Each ruling cites its evidence. "Probe" means my Chrome 145.0.7632.6 run above; the worker re-captures every probed number as a committed Chrome case, and a probe is never the gate.

**R1. Base and dependencies.**
- **BASE for TXT2-c1 and TXT2-e:** the head of inl2b-v2, the INL2 lane's restack of inl2b onto the v2 text stack. Each later chain part stacks on the branch of the part before it. Its PR opens against `review/<parent>`, per the 2026-10-02 PM rule.
- **Why this base.** The v2 text stack today is:

  ```text
  C2 afec4d619 → txt1a-1a-v2 → txt1a-1b-v2 → txt1a-1-v2 → txt1a-2-v2 9f2f87286 → inl1a-tags-v2 398c8bc16 → txt-w1-v2 53699e28b → { txt-w2-v2 5b0f783a8 ; tdec-a1-v2 c9cf2a312 → tdec-a2-v2 b5e9339ed }
  ```

  TXT2 must follow INL2b on inline.ts. It needs TXT1a's shaping path to prove real-font cases, and TXT2-a's TextLeaf fields and segmenter. Any base below inl2b-v2 would force a restack when the INL2 lane lands. inl2b-v2 is the earliest base that does not.
- **What the PM must do first.** The text stack forks: txt-w2-v2 and tdec-a1-v2 are siblings on txt-w1-v2. When the INL2 lane restacks, base inl2-v2 on the text-stack branch that lands last, so that all TDEC-a and TXT-W2 work is beneath TXT2. TXT2-f must see TDEC-a's decoration list (R9).
- **Phase 0 may start now** on a scratch branch from inl2b c638e25d5. It covers new files only: the data generators, the Chrome corpus capture scripts, and the corpora they write. It is cherry-picked onto inl2b-v2. Nothing else starts until inl2b-v2 exists and passes S4.
- **Master is frozen** for train 1. Landing order is train 1 → REPL-a → FORM-a → INL1a (B1, B2, C1, C2) → PNT2 → PNT1, then the text stack, then the INL2 lane (INL2a, TXT2-a, INL2b), then TXT2. No TXT2 part catches up with master until the landing queue calls it.

**R2. Scope follows Chrome 145's parser.** A value Chrome 145 rejects is invalid in Dragon too (DRAGON_CSS_INVALID_VALUE), not "unsupported". The probe's CSS.supports results:

| Property: value | Chrome 145 |
|---|---|
| line-clamp: 2 | false (CSSLineClamp is experimental, runtime_enabled_features.json5:1529) |
| -webkit-line-clamp: 2, none | true |
| text-indent: 1em hanging; 1em each-line | false (CssTextIndent is "test", :1753) |
| text-overflow: "x"; clip ellipsis; fade | false (TextOverflowString is "test", :5318) |
| text-transform: full-width; full-size-kana | false (CSSTextTransformFullWidth is experimental, :1769) |
| text-transform: math-auto | true |
| white-space-collapse: preserve-spaces; discard. white-space-trim | false |
| letter-spacing and word-spacing: 10% and calc(1em + 10%) | true (CSSLetterAndWordSpacingPercentage is stable, :1525) |
| hyphens: auto; hyphenate-character; hyphenate-limit-chars | true |
| word-wrap: anywhere, break-word | true (alias of overflow-wrap) |

The worker commits these as a CSS.supports matrix test against the grammar, in the INL2b manner, which matched 34/34. scripts/gen-css-grammar.ts SUBSET or SYNTAX_OVERRIDES entries make the grammar equal Chrome's.

**R3. white-space-collapse preserve modes (TXT2-c1, c2).** The model is Blink InlineItemsBuilder::AppendText, inline_items_builder.cc:616-662:
- **preserve** (AppendPreserveWhitespace, :1018-1113): spaces are kept, and each LF becomes a forced break (AppendForcedBreak, :1139). A soft wrap opportunity exists after leading preserved spaces, and after a forced break (InsertBreakOpportunityAfterLeadingPreservedSpaces). A tab becomes a control item (TXT2-c3). CR and FF become control items that LineBreaker::HandleControlItem ignores (line_breaker.cc:2938-2944).
- **preserve-breaks** (AppendPreserveNewline, :1116-1136): each LF is a forced break, and the text between is collapsed.

The compiler does phase I (resolve.ts, as today for collapse). The engine gets the text after phase I, with U+000A kept as a forced break.

Probe facts at Ahem 10px, width 100:
- pre-wrap `XXXXXXXX····XX` has line 1 at 80 wide with 4 spaces hanging past the edge (the rect is 80..120), then `XX`.
- break-spaces breaks after every space, and its spaces do not hang. Line 1 is 100 wide (8 X and 2 spaces); line 2 is 40 (2 spaces and XX). This is SetCurrentStyleForce, :4552-4557, kAfterEverySpace.
- pre `XX··XX\nX×13` gives a 60 line, an empty line-end rect, then 130, which overflows.
- pre-line `··XX···XX··\n··XX` gives lines of 50 and 20.
- `\n\nXX` in pre-wrap is 30 tall. `XX\n` is 10 tall, so a final LF makes no extra line.
- An inline-block with pre-wrap `XX···` is 50 wide, and the same with break-spaces is 50: trailing preserved spaces count toward max-content.

Ported from line_breaker.cc: HandleTrailingSpaces (:2384-2492), ComputeTrailingCollapsibleSpace (:2609-2715) and HandleForcedLineBreak (:2814-2901).

**R4. letter-spacing and word-spacing (TXT2-b).**

Computed value:
- 0 computes to `normal`;
- em is resolved to px (0.1em at 16px gives 1.6px);
- a percentage stays a percentage (10%, and calc(10% + 1px));
- a negative value is allowed.

Source: longhands_custom.cc:6619-6636, and the probe.

Used value:
- A percentage, or the percentage in a calc, is relative to the computed font size, not to the width of the space (FontDescription::LetterSpacing and WordSpacing, font_description.cc:202-228).
- The probe confirms it: word-spacing 50% at Lato 16px adds 8px, while Lato's space is 4.109375px.
- This is a Chrome deviation from css-text-4 §8. Dragon follows Chrome, and the decisions.md entry records it.

Applied (ShapeResult::ApplySpacingOrExpansion, shape_result.cc:986-1039; ShapeResultSpacing::ComputeSpacing, shape_result_spacing.cc:120-160):
- **Letter spacing** is added after the last glyph of every HarfBuzz cluster, including the last cluster of the item and of the line. The probe: `XXX` with 3px is 39, and with -3px is 21.
  - The trailing spacing counts when a line is fitted. The probe: `XX XX` with 3px fits at width 65 and breaks at 64.
  - It is skipped for TreatAsZeroWidthSpace characters and for cursive scripts. IgnoreLetterSpacingInCursiveScripts is stable (:2977), and Dragon refuses those scripts anyway.
- **Word spacing** is added to every TreatAsSpace character, NBSP included, except at index 0 of the item text.
  - The probe: `XX XX XX` with 7px is 94; `XX&nbsp;XX` is 57; -15px works.
  - In pre it applies to every preserved space (`XX··XX` is 74). WordSpacingWhiteSpacePre is stable (:6235).
- **Spacing** is converted with TextRunLayoutUnit(float) at shape_result_spacing.cc:15, then accumulated with the existing float model. The probe: 10 glyphs at 0.33px give 103.3125.
- **Ligatures.** Nonzero letter-spacing turns off liga, clig and calt, and does not turn on dlig or hlig (font_features.cc:62-97). T149J missed calt. Kerning stays. The probe: Lato `fi` is 9.171875 as a ligature and 9.453125 with 0.001px; `AV` grows by exactly 2px at 1px spacing.

**R5. TXT2-b needs no text-shaper change.** GlyphShaper.shape already takes `features` (shaping.ts:34), and dhb_shape passes them to hb_shape (dragon_hb.zig:502-509). shaping.ts already builds feature ranges (TAG_HALT, TAG_KERN). So TXT2-b adds liga, clig and calt at value 0 over the whole item when letter-spacing is not 0.

This withdraws T149J's "text-shaper carve-out". packages/text-shaper stays byte-identical (S16), and the HarfBuzz gate stays 620/620.

**R6. Spacing values are engine values.** letter-spacing and word-spacing go on TextLeaf as `CalcExpr` fields, `letterSpacing` and `wordSpacing`, resolved by the environment pass:
- em and % follow the font size, which follows the device text size when it is rem-based (decision "Device text size");
- `normal` lowers to literal 0.

Existing inputs are migrated by generator only (decisions.md "Adding engine fields").

**R7. text-transform is a build-time rewrite (TXT2-e).**
- **Accepted:** none, uppercase, lowercase and capitalize, on static text.
- **Refused** with DRAGON_UNSUPPORTED_VALUE, naming TXT2-e2:
  - math-auto (valid in Chrome; it italicises single math letters);
  - a transform on a script-set text slot (DTXT, because the build cannot see the string).
- **lang** is refused as an attribute today (attributes.ts:39). So the locale is always empty, and the tr, az, el, lt and nl special cases (case_map.cc:161-190) cannot arise. When lang is admitted, the transform under those languages is refused until a later part.

Chrome's behaviour:
- **Order.** The transform is applied to the DOM text before white-space processing, because AppendText receives the TransformedString. So the call site is in resolve.ts, before phase I.
- **uppercase and lowercase** use ICU full case mapping: UnicodeData simple mappings, unconditional SpecialCasing, and Final_Sigma for lowercase. uppercase then maps modern Georgian capitals back (DisableNewGeorgianCapitalLetters, computed_style.cc:1938-1957 and :2128-2133). The probe:
  - `straße ǆ ﬁ ŉ ΐ` → `STRASSE Ǆ FI ʼN Ϊ́`;
  - `İSTANBUL ΣΑΣ ǅ` → `i̇stanbul σας ǆ`.
- **capitalize** is Blink's Capitalize (capitalize.cc:15-58, BSD, portable):
  - it uses ICU word boundaries over the text with the previous character prepended;
  - NBSP counts as a space;
  - u_totitle is applied to the first code unit of each word, as a simple mapping only, so `ﬁsh` stays `ﬁsh`;
  - ICUCapitalization is experimental (:2973), so it is off.
- **The previous character carries across text nodes.** The probe: `ab<span>cd</span> <span>ef</span>gh` → `Abcd Efgh`.

computed_style.cc and layout_text.cc are LGPL, so they are class A: behaviour reference only (T118J).

**R8. capitalize word boundaries follow Chrome's ICU, checked against Intl.Segmenter.**
- **Evidence.** Chrome's word iterator, ICU createWordInstance with the en-US break locale (text_break_iterator_icu.cc:641-660, LGPL, reference only), does not follow plain UAX #29 WB6/WB7 for `.` and `:` between letters:
  - Capitalize gives `X.Y`, `A.B`, `A:B` and `X,Y`, but `Can't`, `Foo_bar` and `3.5x`;
  - `Intl.Segmenter('word')` in the same Chrome gives identical boundaries (probe2: `a.b` → a|.|b, `can't` whole, `foo_bar` whole).
- **What Dragon builds.** Clean-room UAX #29 word boundaries at Unicode 16.0.0: a new packages/dragon/src/analysis/word-break.ts, with data from WordBreakProperty.txt, emoji-data and the GB rules already in grapheme.ts.
- **Its tests:**
  - WordBreakTest-16.0.0 runs N/N;
  - every case where Chrome differs from the default rules is a named tailoring row, each backed by a committed `Intl.Segmenter('word')` capture case;
  - the full corpus capture must agree N/N.
- **Why build-time.** It runs in the compiler only, because the transform is a build-time fold. So it is not translated to Swift or Kotlin.

**R9. text-overflow (TXT2-f).**
- **Grammar.** clip | ellipsis, the only values Chrome 145 parses (R2). The property is not inherited.
- **When it applies.** Only when the block container that owns the line has overflow other than visible, and the line overflows (InlineLayoutAlgorithm::GetLineClampState, inline_layout_algorithm.cc:331-351). For an anonymous block, the owner is its parent. The probe: with overflow visible, the same nowrap line is untouched.
- **The ellipsis:**
  - It uses the line's style: the block's font and colour, not the truncated span's (line_truncator.cc:43-48). The probe: a 5px span in a 10px block gets a 10px ellipsis.
  - It is U+2026 if the block's primary font has the glyph, otherwise "..." (:50-60). Ahem and Lato both have U+2026: the probe shows 10000 ink pixels at 100px in Ahem, and 12px wide in Lato at 16px.
  - It is shaped by HarfBuzz with no letter-spacing applied, and its width is SnappedWidth (:62-71).
- **Truncation** is at grapheme boundaries, not at words: `XX XX XX XX` in 55px draws `XX X…` (probe3).
  - LineTruncator::TruncateLine (:142-209) keeps the original fragment, hidden for paint, and inserts a truncated one. That is why Range.getClientRects reports two rects on the line (probe: 100 and 40).
  - The block's size does not change.
  - In rtl, the ellipsis goes on the left (probe3).
- **Native drawing.** The engine emits the ellipsis as one glyph piece in the line's output. It carries the block's font, so native draws it with the existing glyph path (decisions.md "Dragon positions every glyph"). There are no platform truncation modes: no `lineBreakMode` and no `TextUtils.ellipsize`.
- **Refused:**
  - an atomic inline or an inline box with padding, borders or margins on a truncated line ('ellipsis-atomic', 'ellipsis-inline-box');
  - a line with applied text decorations ('ellipsis-decorated', naming TXT2-f2; Chrome's decoration of the ellipsis is not yet captured);
  - mixed-direction text, under the existing checkRtlText limits.

**R10. Chrome's fragment model in the engine output.** The engine reports a truncated line as Chrome does: the original piece, flagged hidden, and the visible truncated piece. So the existing Range-based capture (capture.ts:72) and compare.ts stay frozen (S16). If compare.ts cannot match the two pieces unchanged, that is a stop for a PM amendment. The worker never edits compare.ts on its own.

**R11. -webkit-line-clamp (TXT2-g).**
- **The legacy pattern becomes flow-root.** With -webkit-box-orient vertical and -webkit-line-clamp not none, `display: -webkit-box` computes to `flow-root`, and `-webkit-inline-box` to `inline-block` (style_adjuster.cc:821-832). The probe: computed display is `flow-root`.
- **The clamped block's content height** ends at the Nth line, padding included (probe: 2 lines gives 20, and padding 3 gives 26).
- **The ellipsis** goes on line N even when line N fits, if more content follows. The probe: `XXX` plus the ellipsis is 40px of ink on line 2.
- **Later lines are still painted** when overflow is visible, because ShouldHideForPaint needs CSSLineClamp, which is off (line_clamp_data.h).
- **Accepted:** exactly the common pattern, which is Tailwind's `line-clamp-N`:
  - `display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: <integer>`;
  - `overflow: hidden` on the same element, so flow-root equals Dragon's block with overflow hidden and no new Display value is needed.
- **Refused** (code 'line-clamp' with the reason):
  - overflow visible;
  - -webkit-box without both companions (legacy flexbox stays invalid, as today);
  - block children inside the clamp container ('line-clamp-nested'; Chrome counts lines through descendants, line_clamp_data.h, and a later part covers it);
  - `-webkit-box-orient: horizontal`.
- **The web output** must emit the authored trio, not the computed `flow-root`, or Chrome drops the clamp. A compiler plant, webkitBoxEmittedAsFlowRoot, must be caught.
- **Engine.** The clamp is ported from BlockLayoutAlgorithm's line-clamp state (block_layout_algorithm.cc:306-360 and :619-640) for the single-IFC case only, through `lineClamp` on the block's LayoutStyle.

**R12. text-indent (TXT2-h).**
- **Grammar.** `<length-percentage>`, negative allowed. hanging and each-line are invalid in Chrome 145 (R2). It is inherited.
- **Which line.** It applies to the first formatted line of each IFC, not after a `<br>` (ShouldApplyTextIndent, line_breaker.cc:44-54).
- **Its value** is MinimumValueForLength against the available inline size. A percentage resolves to 0 in min-content and max-content (:811-822).
- **Its position.** It is the line's initial position (:843-844). LineInfo::ComputeWidth includes it (line_info.cc:409-415), and the truncator subtracts it (line_truncator.cc:38). In rtl it is measured from the right.
- **Probe facts:**
  - 25px gives a first line at x 25;
  - -15px gives x -15, which overflows to the left;
  - 10% of 100 gives 10;
  - an inline-block with 10% is 40, so the percentage counts as 0;
  - an inline-block with 20px is 60;
  - in rtl the first line ends 25 from the right;
  - after a `<br>` there is no indent.
- **The anonymous-block case** (`<div style="text-indent">` holding a block child and then trailing text) is captured, and Chrome's result is the rule.
- **Engine.** `textIndent` (CalcExpr) on the block container's LayoutStyle.

**R13. TXT2-e may run in parallel.** It touches no layout file. Its only shared code file is resolve.ts: a one-line call site before phase I, plus its own module. It is gated by the merge-conflict test against the chain branch in flight. If that conflict set grows beyond BASE's, it waits for TXT2-c2 and stacks on it.

**R14. hyphens (TXT2-i).**
- **none** turns off soft-hyphen opportunities (break_iterator_.EnableSoftHyphen(false), line_breaker.cc:4543-4549).
- **auto** with no content language hyphenates nothing in Chrome on macOS. The probe: Lato `hyphenation extraordinary` breaks only at the space unless `lang=en` is set.
  - Chrome's macOS hyphenation is the OS dictionary (hyphenation_apple.cc: CFStringGetHyphenationLocationBeforeIndex). It is not reproducible on Android, and it changes with the OS version.
  - So, while `lang` is refused, `auto` is accepted and lowered as `manual`, proven by Chrome cases that hyphenate nothing. Admitting `lang` later must refuse `auto` together with a language.
- **-webkit-hyphens** is an alias (Tailwind `hyphens-*` emits both).
- **Still refused:** hyphenate-character and hyphenate-limit-chars at non-initial values.

**R15. word-break break-all and keep-all (TXT2-d).**
- Clean-room from css-text-3 §5.2 over UAX #14 in linebreak.ts. The line_breaker.cc:4494-4507 iterator modes are the behaviour reference; text_break_iterator.cc is LGPL.
- **break-all** makes letters and numbers (AL, NU, SA) break like ID.
- **keep-all** changes nothing for Latin. The Latin-only script gate makes CJK unreachable, which is proven by Ahem and Lato cases (probe: break-all `XXXXXXXX XX` at 55 gives 50, 50 and 10; keep-all gives 80 and 20).
- **auto-phrase** stays refused.
- **The word-wrap alias** joins here, as a one-longhand shorthand in shorthands/text.ts. The `gap` alias is the precedent.
- **line-break** values other than auto stay refused (6.5%; a later part).

**R16. Tabs and tab-size (TXT2-c3).**
- Tab stops follow ShapeResult::CreateForTabulationCharacters and TabSize::GetPixelSize. With TabSizeWithSpacing stable (:5189), the stop width is `n × (space + letter-spacing + word-spacing)`.
- The probe: `X\tX` in pre with tab-size 8 at 10px gives the tab 70 wide, to the 80 stop.
- The line start is the stop origin, after text-indent (line_breaker.cc:841-844).
- **Until TXT2-c3,** a tab in preserved text is refused with the engine code 'tab-stop'.

**R17. Native targets and web.**
- **On-device code parses no CSS.** Every value arrives as engine input: literal, CalcExpr or text. The translated engine (Swift and Kotlin from TypeScript) produces glyph x positions, and the native views only rasterise them: CTFontDrawGlyphs on iOS and Canvas.drawGlyphs on Android (minSdk 31). That is native-support.ts today (:363-379 on txt1a-2-v2).
- **No platform text attributes are used:** not NSAttributedString `.kern`, not `Paint.setLetterSpacing`, not `numberOfLines`, not `ellipsize`. They differ from Chrome (decisions.md "Text strategy", "Inline layout").
- **Each platform choice is the compiler's,** made from semantic analysis:
  - which lines truncate;
  - the ellipsis font;
  - whether an element is a clamp container;
  - the transformed string.
- **Web output** comes from the same compiled result:
  - It keeps the authored white-space, spacing, indent, text-overflow and the line-clamp trio (R11).
  - For text-transform it emits the original text plus the property, so that copy, find and AX behave as in Chrome. The chrome-dual check proves that Dragon's build-time string equals Chrome's innerText.
- **Accessibility.** Native accessibility labels carry the transformed string, which matches Chrome's innerText. AX parity stays P6.

**R18. Proof (every part).**
- **Chrome.** Chrome-dual computed values, frames and text line rects at DPR 1, 2, 3 and 2.625, in ltr and rtl, in Ahem and in Lato 400 and 700 (Inter where the part names it).
- **Breaks.** Break reference (expected-breaks) with engine equal to Chrome N/N for the new cases.
- **Vectors.** New engine vectors with TS = Swift = Kotlin, including cases Chrome cannot isolate: trailing spacing at the fit boundary, a clamp line that exactly fits, and a 1/64 px indent edge.
- **Pixels.** Pixel PNGs and glyph-centre checks. They cover the ellipsis glyph, which the DOM never reports.
- **Plants.** Each named plant fails its named case at every DPR, and the unfaulted run passes.
- **Identity.** Existing outputs are byte-identical apart from the declared migrations, proven by a committed migration checker whose plants fail.
- **No tolerance** is added or widened.
- **Phase B,** with both leases, runs when the landing queue reaches the part: layout-vectors-device, device-frames, device-applied, device-lines and device-pixels on both platforms at every DPR. No lane may be 'not run', and there may be no new device-pixels failure beyond master's recorded list. Text pixels fall only under the recorded glyph-edge rule (decisions.md T093).
- **WPT.** Refusals only shrink, and new passes are listed. The relevant directories are css-text (white-space, letter-spacing, word-spacing, text-transform, text-indent, word-break, overflow-wrap, hyphens), css-ui text-overflow, and css-overflow webkit-line-clamp.
- **TW-SWEEP.** Each part lists the Tailwind utilities that move from refused to supported. On txt2a today, all of these are refused: whitespace-pre*, uppercase, lowercase, capitalize, tracking-*, truncate, text-ellipsis, text-clip, line-clamp-*, break-all, break-keep, indent-*, hyphens-*, tab-*.

**R19. North star.** The music player uses letter-spacing (one declaration, value 0), overflow-wrap (four declarations) and white-space: normal (already supported). TXT2-a removes the 5 property errors when it is restacked:
- On tdec-a2-v2, DRAGON_UNSUPPORTED_PROPERTY is 61, and 5 of those are text-wrap. The expected result is 56, with no code rising on any target.

Every part from TXT2-c1 on has a north-star delta of 0. Each receipt runs north-star:check and states "no code count changed". A change is a stop.

## 3. Common worker contract (every part)

**E** = `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`. BASE is the recorded parent head. Heavy commands run through /tmp/heavy-lease.sh.

**Common allowed_files.** Each part's list adds to these.
- packages/layout/src/input.ts: the part's declared fields and union widenings only;
- packages/layout/src/validate.ts and unsupported.ts: appends;
- packages/layout/src/index.ts: append;
- packages/layout/src/environment.ts: one hunk resolving the part's CalcExpr fields, if any;
- packages/layout/generated/** (native:gen output);
- packages/layout/vectors/** (new files and generator-migrated inputs);
- packages/layout/break-vectors/** (new files);
- packages/layout/test/helpers.ts: the default literal, for the new fields only;
- packages/translate/src/corpus.ts, corpus-dpr.ts and packages/translate/harness/harness.ts: additive;
- packages/translate/corpus.json, corpus-dpr.json and corpus-m1-cases.json: lock output;
- packages/dragon/src/css/properties.ts: an import and a spread;
- packages/dragon/src/css/properties/text-wrap.ts or a new per-part file;
- packages/dragon/src/css/grammar.generated.ts (grammar:gen only);
- scripts/gen-css-grammar.ts: SUBSET or SYNTAX_OVERRIDES entries;
- packages/dragon/src/analysis/computed-checks.ts: the part's refusals;
- packages/dragon/src/lower/ios-layout.ts: the TextLeaf or LayoutStyle fields;
- packages/dragon/src/emit/native-support.ts: the TextLeaf or LayoutStyle literal only, unless the part names more;
- packages/dragon/src/faults.ts and diagnostics/catalogue.ts: appends;
- packages/dragon/test/diagnostic-codes.json (append-only);
- packages/dragon/test/<part>.test.ts (new); seams.test.ts, grid.test.ts, compile.test.ts and text.test.ts: derived pins only;
- packages/dragon/src/ua/*.generated.ts (ua:capture, append-only, proven);
- packages/dragon/src/profiles/*.ts (profile:rows output, new rows only);
- packages/parity/src/fixtures.ts (one appended group); packages/parity/src/fixture-groups/<part>.ts (new); fixture-groups/fonts.ts (MAPS entries);
- packages/parity/fixtures/<part>-*.html and reject-<part>-*.html (new);
- packages/parity/expected/**, expected-dpr/**, expected-breaks/** and expected-pixels/** (new case files and appended manifest entries);
- packages/parity/emitted/** (new bodies; relaxed headers);
- packages/parity/test/<part>.test.ts (new); other parity tests: derived count pins only (css-escapes, pixel-reference DROPPED addend, text-latin, values, corpus-dpr);
- scripts/check-<part>-migration.ts (new);
- docs/ports.json and THIRD_PARTY_NOTICES.md (`pnpm notices:gen`), for the part's new Chrome citations;
- generator output, with every verdict change listed: packages/parity/out/lanes.json, examples/music-player/dragon/north-star-check.json, packages/wpt/expectations/*.json, packages/tailwind-sweep/snapshot/*;
- the part's note docs/goals/milestone-2-proof/notes/T149-<part>.md (main checkout only; notes are never committed on branches).

**Shared files with other lanes.**
- **inline.ts, shaping.ts and linebreak.ts:** serial within this chain. No other lane touches them while a part is in flight.
- **native-support.ts:** TDEC-b also edits native text drawing. TXT2-f and TDEC-b must not be in flight together. Whichever starts second stacks on the other.
- **resolve.ts:** TXT2-c1, TXT2-c2 and TXT2-e.
- **computed-checks.ts, catalogue.ts, properties.ts, faults.ts:** same-place appends, resolved by keeping both sides at catch-up (the accepted TXT2-a precedent).

**Common verify.**
- V1: S1-S15 and S17 of notes/T044-inl-spec.md §2, with this BASE. S8 must show failed 0 at DPR 1, 2, 3 and 2.625.
- V2: S16 with packages/translate/src removed from its list; translate changes are additive only. packages/layout/src/linebreak-data.ts, packages/text-shaper, text.ts, package.json and .github are byte-identical.
- V3, identity: `git diff --diff-filter=MD --exit-code $BASE -- packages/parity/expected packages/parity/expected-dpr packages/layout/break-vectors packages/parity/expected-breaks`; the S6 check shows every existing vector output unchanged; the generated union names are unchanged except a declared widening; existing pixel manifest entries are unchanged.
- V4: `E node --conditions=dragon-internal scripts/check-<part>-migration.ts`. Inputs, emitted bodies, captures and environment-pass outputs differ only by the part's keys at their neutral value. Its plants fail.
- V5: the HarfBuzz gate is 620/620 (`pnpm run text-shaper:gate` or the repo's gate command).
- V6: each named plant fails its named case at every DPR, and the unfaulted run passes (S10).
- V7: the CSS.supports matrix test for the part's properties matches Chrome N/N.
- V8: north-star:check shows no code count changes (R19), and the receipt quotes the summary.
- V9, merge-conflict test: for every branch in the PM's landing queue that is not an ancestor of BASE (at least form-a-v2, form-a3-v2, form-a4-v2, pnt2-v2, the PNT1 branches and the TDEC-b branch if it exists), the conflicted non-generated paths from `git merge-tree --write-tree --name-only --no-messages HEAD $B` are a subset of BASE's. The receipt lists both sets.
- V10: S18 (Phase B) only when the landing queue reaches the part. Until then the receipt says 'device step pending'.
- V11: `pnpm typecheck` and `pnpm test`, and the receipt states exactly what passed.

**Common stop_if.**
- inl2b-v2 or the parent part is rewritten. Stop, and the PM restacks.
- A file outside allowed_files is needed. In particular:
  - packages/text-shaper, text.ts, linebreak-data.ts, package.json;
  - capture.ts, compare.ts, pixel-reference.ts or any other S16 file;
  - shaping.ts or block.ts beyond the hunks the part names.
- Chrome disagrees with the port, and the cited 145.0.7632.6 source does not explain it.
- The work needs code ported from an LGPL file: computed_style.cc, layout_text.cc, layout_block.cc, text_break_iterator*.cc, character_break_iterator.cc.
- An existing output changes beyond the declared migration keys, new profile rows, relaxed headers and appended manifest entries.
- A plant is not caught, or a tolerance, gate, case, DPR or direction would be loosened.
- A north-star code count changes (R19).
- The reviewed diff goes over about 150 KB. Split it as the part's PR plan says.
- Verification fails twice. Test timeouts under load that pass on rerun do not count.

## 4. Worker packages

Each part lists only what it adds to §3.

### TXT2-c1: white-space pre and pre-line (preserve with nowrap; preserve-breaks)

**Objective.**
- **Compiler.** resolve.ts phase I follows R3 per text:
  - preserve-breaks collapses spaces and tabs except LF, and removes the spaces on either side of each LF;
  - preserve keeps the text as authored.
- **Engine.** TextLeaf.whiteSpaceCollapse widens to `'collapse' | 'preserve' | 'preserve-breaks'`. This is a union widening, not a new key.
  - U+000A in preserved text is a forced break item: the line ends, the next line starts after it, and a trailing LF makes no empty line.
  - Preserved spaces in a nowrap line are measured as text.
  - Leading preserved spaces after a forced break are a break opportunity.
  - This is ported for both the Ahem path (inline.ts) and the real-font path (the shaping.ts breakItemLines forced-break hunk, at most about 60 lines, named in the receipt).
- **Refused** (engine codes appended):
  - 'tab-stop': a tab in preserved text (TXT2-c3);
  - 'preserved-control': CR, FF or other C0 controls;
  - 'mixed-white-space': texts or inline boxes in one IFC with different white-space-collapse or text-wrap-mode (this replaces computed-checks.ts's blanket inline-box refusal only for single-mode IFCs);
  - the pre, listing and xmp tags (the UA monospace 13px quirk and the leading-LF parser rule).
- **validate.ts.** The uncollapsed-text check keeps applying to collapse leaves only. It gains a preserve check: no tab or control characters.

**Fixtures.** Group white-space-preserve, at every DPR, ltr and rtl, in Ahem and Lato:
- pre with doubled spaces;
- pre with LF then an overflowing line;
- pre-line with spaces around LF;
- leading LFs;
- a trailing LF;
- preserved text inside a span (same mode);
- a flex item with pre (max-content);
- pre inside nowrap;
- the north-star-shaped h2 in pre-line.

Rejects:
- a tab;
- mixed modes in one IFC;
- a pre tag.

**Plants.**
- Engine: newlineAsSpace, trailingNewlineEmptyLine, preservedSpaceCollapsed.
- Compiler: preLineKeepsSpaceBeforeNewline.

**Extra allowed files.**
- packages/dragon/src/analysis/resolve.ts (the phase I hunk);
- packages/layout/src/inline.ts, linebreak.ts, and the shaping.ts hunk;
- packages/layout/test/inline-white-space.test.ts (new).

**PR:** one PR, about 90-120 KB reviewed. **Size:** M. **Risk:** medium.

### TXT2-c2: white-space pre-wrap and break-spaces

**Objective.**
- **Engine.** whiteSpaceCollapse widens with `'break-spaces'`. A pre-wrap line is preserve with wrap.
- **Port** HandleTrailingSpaces (line_breaker.cc:2384-2492):
  - preserved trailing spaces hang and are not counted for fit;
  - break-spaces makes an opportunity after every space, and its spaces never hang;
  - SplitTrailingBidiPreservedSpace (:2716-2812) applies for rtl.
- **Intrinsic sizes.** Trailing preserved spaces count in max-content (probe: 50). The min-content rule is captured, then ported, in intrinsic.ts's text hunk.
- **Real-font path.** The shaping.ts hunk is at most about 60 lines.

**Fixtures.** Group white-space-wrap, all DPRs, ltr and rtl, Ahem and Lato:
- the probe shapes (preWrapHang, breakSpaces);
- pre-wrap with an overflowing word combined with overflow-wrap: anywhere;
- an inline-block with trailing spaces in both modes;
- a flex item with pre-wrap (min and max);
- break-spaces at an exact-fit boundary.

**Plants.**
- Engine: trailingPreWrapNotHanging, breakSpacesHanging, preservedSpacesExcludedFromMaxContent, breakSpacesBreaksOnlyAfterRun.

**Extra allowed files:** inline.ts, linebreak.ts, intrinsic.ts (text hunk only), and the shaping.ts hunk.

**PR:** one PR, about 100-130 KB. **Size:** M. **Risk:** medium-high (rtl preserved space).

### TXT2-e: text-transform (compiler only; parallel, R13)

**Phase 0 (new files; may start now, R1).**
- scripts/gen-case-data.ts emits packages/dragon/src/analysis/case-data.generated.ts from Unicode 16.0.0 files, each pinned by sha256:
  - UnicodeData.txt;
  - SpecialCasing.txt;
  - WordBreakProperty.txt;
  - emoji-data.txt (Extended_Pictographic);
  - DerivedCoreProperties.txt (Cased and Case_Ignorable, for Final_Sigma).
- A Chrome capture script, packages/parity/fixtures/text-transform/capture.mjs, records for corpus strings:
  - innerText under uppercase, lowercase and capitalize;
  - `Intl.Segmenter('word')` boundaries.

  The corpus covers:
  - every code point with a case mapping;
  - every SpecialCasing entry;
  - Final_Sigma contexts;
  - Georgian;
  - NBSP;
  - the R8 punctuation set;
  - cross-node pairs.

  It writes chrome-text-transform.json, which has a `--check` mode.

**Objective.**
- A new packages/dragon/src/analysis/text-transform.ts holds:
  - full uppercase and lowercase (Final_Sigma per Unicode 16 §3.13);
  - the Georgian exclusion (R7);
  - Capitalize ported from capitalize.cc, BSD, cited in docs/ports.json;
  - word-break.ts (R8).
- The call site is in resolve.ts before phase I. The previous character is carried across the IFC's text runs in tree order.
- text-transform is registered as an inherited longhand (properties/text-transform.ts), and the UA tables are regenerated append-only.
- Lowering gives native the transformed text. The web emitter keeps the original text plus the property (R17).

**Refused.** math-auto, and a transform on a DTXT slot, with DRAGON_UNSUPPORTED_VALUE (R7).

**Fixtures.** Group text-transform, all DPRs, ltr and rtl, Ahem and Lato 400 and 700. A layout case changes width; for example ß to SS in Lato must change the line breaks.

**Proof.**
- the corpus is N/N against innerText and Segmenter;
- WordBreakTest-16.0.0 is N/N, with the tailoring rows listed;
- the chrome-dual computed value is the keyword.

**Plants.**
- Compiler: finalSigmaIgnored, specialCasingDropped, capitalizeAfterApostrophe, capitalizePrevCharReset, nbspNotSeparator, georgianCapitalized, transformAfterCollapse.

**Extra allowed files.**
- scripts/gen-case-data.ts (new);
- packages/dragon/src/analysis/{text-transform.ts, word-break.ts, case-data.generated.ts} (new);
- resolve.ts (the call site);
- properties/text-transform.ts (new);
- the web emitter's text-content line, only if needed (named in the receipt);
- packages/parity/fixtures/text-transform/** (new).

**PR.**
- e1: the data, the transform module, word-break.ts, the corpus and tests (generated data is in an ignored path; about 80 KB reviewed);
- e2: the compiler wiring and fixtures (about 70 KB).

**Size:** M. **Risk:** low-medium.

### TXT2-b: letter-spacing and word-spacing

**Objective.**
- **Compiler.**
  - Register word-spacing, inherited.
  - Accept letter-spacing and word-spacing as normal or `<length-percentage>`, including calc. The computed values follow R4.
  - Delete `checkLetterSpacing` (finding F1). From then on, rows come only from profile:rows.
- **Engine.** TextLeaf gains `letterSpacing` and `wordSpacing` (CalcExpr; R6).
- **Port.** ShapeResultSpacing::ComputeSpacing and ApplySpacingOrExpansion's spacing path (R4) into:
  - shaping.ts, for real fonts (the per-cluster add on the item's shape result, before line breaking, and the TextRunLayoutUnit conversion);
  - inline.ts, for the Ahem width path, where each Ahem cluster is one code point.
- **Features.** liga, clig and calt are turned off through the existing feature ranges when letter-spacing is not 0 (R5).
- **Native.** Glyph xs already come from the engine, so the native change is the literal only.

**Fixtures.** Group text-spacing, all DPRs, ltr and rtl, Ahem, Lato and Inter:
- px, em, % and calc;
- negative values;
- the fit boundary (65 and 64);
- a span with spacing inside unspaced text;
- `fi` in Lato (ligature off);
- kerning kept (AV);
- word-spacing on NBSP;
- word-spacing in pre (needs TXT2-c1);
- spacing with overflow-wrap: anywhere;
- an em value under a rem root at the text-scale table entries from V2a.

Rejects: none beyond R2's invalid values.

**Plants.**
- Engine: trailingSpacingDropped, spacingPerCodePoint, ligaturesKept, contextualAltKept, wordSpacingAtItemStart, wordSpacingSkipsNbsp, percentOfSpaceWidth.
- Compiler: zeroNotNormal (the computed value).

**Extra allowed files.** shaping.ts (the spacing and feature hunk, at most about 120 lines), inline.ts, and properties/text-wrap.ts.

**PR:** one PR, about 110-140 KB. **Size:** M. **Risk:** medium.

### TXT2-f: text-overflow

**Objective.**
- **Compiler.** text-overflow (clip | ellipsis), not inherited, on block containers. The anonymous-block owner is resolved per R9. The refusals in R9 apply.
- **Engine.** A new packages/layout/src/truncate.ts, called from inline.ts after line placement, ports:
  - LineTruncator::TruncateLine;
  - EllipsizeChild and TruncateChild, at grapheme offsets through grapheme.ts;
  - PlaceEllipsisNextTo.

  It runs only when the owner's overflow is not visible and the line overflows. The ellipsis is shaped through the existing GlyphShaper in the line's font, U+2026 or "...". The output is R10's fragment model plus an ellipsis glyph piece.
- **LayoutStyle** gains `textOverflow` ('clip' | 'ellipsis').
- **Native.** native-support.ts (Swift and Kotlin):
  - draws only the visible piece of a truncated leaf;
  - draws the ellipsis piece as a glyph run in the block's font and colour, as a child glyph view of the block container, placed at engine coordinates;
  - clipping stays the existing overflow clip.

**Fixtures.** Group text-overflow, all DPRs, ltr and rtl, Ahem and Lato:
- nowrap truncation;
- a span in a smaller font (the ellipsis uses the block's font);
- spaces before the cut;
- letter-spacing (no spacing on the ellipsis);
- a wrapped long word with overflow hidden;
- a line that just fits (no ellipsis);
- text-indent (after TXT2-h; added there);
- overflow visible (no ellipsis);
- the Tailwind `truncate` shape.

Rejects:
- an atomic inline in a truncated line;
- a decorated line;
- a string value (invalid).

**Plants.**
- Engine: ellipsisInTextFont, ellipsisWidthUnsnapped, truncateAtWordBoundary, truncateChangesBlockSize, ellipsisWithOverflowVisible, ellipsisRtlOnRight.
- Runtime: hiddenPieceDrawn, ellipsisGlyphMissing (SUPPORT_PLANTS).

**Extra allowed files.**
- packages/layout/src/truncate.ts (new);
- inline.ts (one call site);
- native-support.ts (ellipsis and visible-range drawing, Swift and Kotlin);
- packages/dragon/src/lower/native-program.ts (the ellipsis view hunk, if needed; named in the receipt).

**Stop** if compare.ts, capture.ts or the pixel sampler must change (R10).

**PR.**
- f1: the engine truncation and vectors;
- f2: the compiler, native drawing and fixtures.

Each is under 150 KB. **Size:** M-L. **Risk:** medium-high.

### TXT2-d: word-break break-all and keep-all, and the word-wrap alias

**Objective.** linebreak.ts implements R15. TXT2-a's 'word-break' refusal narrows to auto-phrase. word-wrap becomes a one-longhand shorthand.

**Proof.**
- A Chrome opportunity corpus for break-all and keep-all over the Ahem-covered set and Lato Latin, captured as chrome145-rules.json was. Engine equals Chrome N/N.
- Fixtures in group text-word-break, all DPRs, ltr and rtl.
- Reject: auto-phrase.

**Plants.**
- Engine: breakAllIgnored, breakAllBreaksPunctuation, keepAllChangesLatin.
- Compiler: wordWrapAliasDropped.

**Extra allowed files.**
- linebreak.ts;
- inline.ts (style plumbing);
- packages/dragon/src/css/shorthands/text.ts (the alias);
- packages/layout/test/fixtures/word-break/** (new).

**PR:** one PR, about 70 KB. **Size:** S-M. **Risk:** low-medium.

### TXT2-g: -webkit-line-clamp

**Objective.**
- **Compiler.** Register -webkit-line-clamp (none | `<integer [1,∞]>`), -webkit-box-orient, and `display: -webkit-box` / `-webkit-inline-box` only in R11's combination. The computed display is flow-root or inline-block as Chrome adjusts it; inline-block needs INL2a. Refuse everything else per R11. The web emitter writes the authored trio.
- **Engine.** LayoutStyle gains `lineClamp` (number | 'none'). The block's content height stops at line N, and line N gets the ellipsis through TXT2-f's truncator in clamp mode: an ellipsis even when the line fits, if content follows. Later lines are laid out and stay in the output, clipped by overflow hidden.

**Fixtures.** Group line-clamp, all DPRs, ltr and rtl, Ahem and Lato:
- 2 of 4 lines;
- exactly N lines (no ellipsis);
- padding;
- line N that overflows;
- the Tailwind `line-clamp-3` shape.

Rejects:
- overflow visible;
- nested blocks;
- -webkit-box without orient;
- `line-clamp` (invalid).

**Plants.**
- Engine: clampHeightIncludesHiddenLines, clampEllipsisMissingWhenLineFits, clampEllipsisOnExactLastLine.
- Compiler: webkitBoxEmittedAsFlowRoot.

**Extra allowed files.**
- truncate.ts;
- inline.ts (clamp state);
- block.ts (the content-height hunk, at most about 40 lines, named in the receipt);
- packages/dragon/src/analysis/blockify.ts or the display resolution hunk (the -webkit-box adjustment);
- the web emitter's display line.

**PR:** one PR, about 100 KB. **Size:** M. **Risk:** medium-high.

### TXT2-h: text-indent

**Objective.**
- Register text-indent, inherited, `<length-percentage>`.
- LayoutStyle gains `textIndent` (CalcExpr). The engine ports R12 into both line paths and the intrinsic contribution.

**Fixtures.** Group text-indent, all DPRs, ltr and rtl, Ahem and Lato:
- positive, negative and percentage values;
- a shrink-to-fit block;
- after a `<br>`;
- the anonymous block after a block child;
- with text-align center;
- with text-overflow (appended to TXT2-f's group).

Rejects: hanging and each-line (invalid).

**Plants.**
- Engine: indentEveryLine, indentAfterBr, indentPercentInIntrinsic, indentRtlFromLeft.

**Extra allowed files:** inline.ts, the shaping.ts line-start hunk, intrinsic.ts (text hunk), truncate.ts (the available-width line).

**PR:** about 60 KB. **Size:** S. **Risk:** low.

### TXT2-i: hyphens

**Objective.**
- Register hyphens (none | manual | auto) and the -webkit-hyphens alias.
- TextLeaf gains `hyphens` ('manual' | 'none'); auto lowers as manual (R14). linebreak.ts honours none.

**Fixtures:**
- soft hyphens under manual, none and auto;
- Lato `hyphenation extraordinary` under auto (no hyphenation).

Rejects:
- hyphenate-character;
- hyphenate-limit-chars at non-initial values.

**Plants.**
- Engine: softHyphenBreaksUnderNone.
- Compiler: autoHyphenates (lowers auto as a dictionary mode), webkitHyphensAliasDropped.

**PR:** about 40 KB. **Size:** S. **Risk:** low.

### TXT2-c3: tabs and tab-size

**Objective.**
- Register tab-size (`<number> | <length>`, inherited).
- TextLeaf gains `tabSize` (CalcExpr or a number of spaces).
- Port CreateForTabulationCharacters and the tab control item (R16) on both paths. Lift 'tab-stop'.

**Fixtures:** tabs in pre and pre-wrap; tab-size as a number and as a length; letter-spacing and word-spacing with tabs; text-indent before a tab.

**Plants.**
- Engine: tabStopFromIndent, tabSizeIgnoresSpacing, tabAsSpace.

**PR:** about 60 KB. **Size:** S-M. **Risk:** medium.

## 5. Support-profile rows (all parts)

Rows come only from profile:rows, through passing cases, per value subset and context: text-in-block, text-in-flex-item/row and column, text-in-inline, text-beside-inline, text-in-anonymous-block, each with ltr and rtl. Expected new feature keys:

| Part | Feature keys |
|---|---|
| c1 | white-space-collapse:preserve, white-space-collapse:preserve-breaks |
| c2 | white-space-collapse:break-spaces, and preserve with text-wrap-mode:wrap |
| e | text-transform:none, uppercase, lowercase, capitalize |
| b | letter-spacing:<length-px>, <length-em>, <percentage>, <calc()>; word-spacing:* (same subsets) |
| f | text-overflow:clip, ellipsis (block contexts) |
| d | word-break:break-all, keep-all |
| g | -webkit-line-clamp:<integer>, -webkit-box-orient:vertical, display:-webkit-box (clamp context only) |
| h | text-indent:<length-px>, <percentage>, <calc()> |
| i | hyphens:none, manual, auto |
| c3 | tab-size:<number>, <length-px> |

Each part's receipt lists its rows. No existing row may change.

## 6. Estimate

| Part | Size | Risk | Reviewed KB |
|---|---|---|---|
| c1 | M | med | about 110 |
| c2 | M | med-high | about 120 |
| e | M | low-med | about 150 over 2 PRs |
| b | M | med | about 130 |
| f | M-L | med-high | about 220 over 2 PRs |
| d | S-M | low-med | about 70 |
| g | M | med-high | about 100 |
| h | S | low | about 60 |
| i | S | low | about 40 |
| c3 | S-M | med | about 60 |

The total is L-XL, about 1.1 MB reviewed over 12 PRs. None of it is on the checkpoint-3 path. Only TXT2-a is, and it is done host-side.

The largest risks:
- **R10**, if compare.ts cannot accept Chrome's fragment model unchanged.
- **The native ellipsis view in TXT2-f**, which is shared with TDEC-b in native-support.ts.
- **R11's clamp relayout corner cases.** These are kept small by refusing nested blocks.
