# T148J TDEC and T149J TXT2 (Judge, 2026-10-01)

Blink cites are at 145.0.7632.6, fetched to /tmp/t148j. Skia is at 2ab8add5. ICU is 77.1 (Unicode 16.0, DEPS icu a86a32e6).

Licence rule (decisions.md, porting): these files are LGPL and are behaviour references only. Their behaviour is implemented from the spec and matched to Chrome by test:
- text_break_iterator.cc
- computed_style.cc
- style_adjuster.cc
- layout_text.cc

Every other cited file is BSD.

North-star use (styles.css):
- `letter-spacing: 0` (:54);
- `overflow-wrap: break-word` (:244, :456) and `anywhere` (:527, :550);
- `white-space: normal` (:528, already supported);
- `text-decoration-color` and `text-underline-offset: 0.2rem` on the two a[href] links (:461-462), which also get the UA underline.

It uses no text-transform, text-overflow, word-break or preserved white-space.

---

## Part 1: T148 TDEC, text-decoration

### Chrome's behaviour

**Properties** (css_properties.json5):
- text-decoration-line (:5800) is not inherited. Its keywords are none, underline, overline, line-through, blink, spelling-error and grammar-error.
- text-decoration-skip-ink (:5817) is inherited, with none and auto only.
- text-decoration-thickness (:5849) is not inherited: auto, from-font, length or %.
- text-underline-offset (:5995) is inherited: auto, length or %.
- text-underline-position (:6015) is inherited: auto, from-font, under, left and right.
- The shorthand text-decoration (:9076) sets line, thickness, style and colour.

**UA rules** (html.css):
- a:-webkit-any-link sets color -webkit-link and text-decoration: underline (:1501-1505).
- :active sets -webkit-activelink (:1507). That is a state rule, owned by SELD/LINK-RT.

**Thickness** (text_decoration_info.cc):
- auto is the computed font size / 10 (:74-81). A length is roundf'd (:98-101). from-font reads the font's underline thickness, falling back to auto (:90-94).
- The minimum is 1 for non-SVG text (:460-463, text_decoration_painter.cc:95).

**Underline position** (text_decoration_offset.cc):
- auto is integer Ascent, plus a gap of max(1, ceil(t/2)) only when the offset is auto, plus roundf(offset) (:16-33).
- from-font is roundf(FloatAscent + font underline position + offset) (:35-45).
- under uses the bottom of the em height (:49-81, :103-110).

**Overline** uses the TextTop path, floor minus floor(t) (:76-77; text_decoration_info.cc:366-392).

**Line-through** is at 2*FloatAscent/3 - t/2 (:395-400).

**Double and wavy offsets:** t + 1, floored for line-through (:276-301).

**The decorating box:**
- The font and size come from the decorating box, and the offset is converted from it (:205-255, :319-330).
- The decorating box is not used when the baseline is central.

**Drawing** (decoration_line_painter.cc):
- Solid and double are drawn as non-antialiased rects. y snaps to floor(y+0.5), and the height is max(floor(t), 1) (:15-27, :75-93, :327-337).
- Dotted and dashed use StyledStrokeData strokes, antialiased, with odd widths shifted by +0.5 (:33-73). This is the same dash code as p6a-dash-v2's port.
- Wavy (:91-158, :340-361):
  - wavelength 1 + 2*round(2t + 0.5);
  - control-point distance 0.5 + round(3t + 0.5);
  - phase -wavelength;
  - three cubics, tiled as a repeating shader.

**Paint order:**
- Shadows first when decorations are present.
- Then underline and overline, then the text, then line-through (text_fragment_painter.cc:543-557).

**Skip-ink** (text_painter.cc:548-590):
- It applies to underline and overline only.
- The band is the decoration Bounds inset by 0.5 px vertically.
- The intercepts come from Font::GetTextIntercepts (Skia glyph intercepts).
- Each clip rect is outset by 1 px vertically and by min(t, 13) horizontally, then clipped out.

**Units.** Under DPR emulation, Blink zooms for the device scale, so every quantity above is in zoomed (device) px. TDEC-a proves this first.

**Propagation** (css-text-decor-3 §2.1; Blink's implementation is LGPL, so it is checked by Chrome cases):
- Decorations go to in-flow descendants: inline boxes, block children and flex items (to be measured).
- They never go into atomic inlines, out-of-flow boxes or floats.
- Each text leaf gets an ordered list of applied decorations, each with its decorating box.

### Split

**TDEC-a (now; checkpoint-3 path). Branch tdec-a on txt-w2 657673bb2.**
- Compiler: longhands and shorthand, propagation, and the a:any-link underline.
- The href lift. rel and target stay refused, naming LINK-RT.
- Engine geometry in a new layout/src/text-decoration.ts (translator subset, not yet called).
- Skip-ink by a conservative bounds proof (glyf control-point y extents against the band). Otherwise refused as 'skip-ink-intercepts' (TDEC-d).
- Web accepts. ios and android refuse any decorated text, naming TDEC-b.
- Proof: a new parity:decoration-capture. Chrome renders with and without decorations; the differing pixels outside glyph ink must equal the engine's snapped rects and colour exactly at DPR 1, 2, 3 and 2.625. Grammar tables are checked too.
- The worker package is in the T148J+T149J receipt.

**TDEC-b (checkpoint-3 path).** Native drawing.
- Base: the first text-stack branch that has merged master with EMS-b. Stack on it; reviews never block.
- Decorations are drawn by a new paint module (emit/paint/text-decoration.ts and lower/paint/text-decoration.ts), as non-antialiased rect views:
  - an under/overline view behind the text leaf's view;
  - a line-through view in front of it.
  - They are positioned by the translated TDEC-a geometry.
  - DragonTextView is not edited.
- Adds RT-13 roots for text-decoration.ts.
- A 'decoration' pixel point kind with exact rows, under the unchanged gate.
- North-star a[href] links on both targets, with the INL2a inline-block propagation case.
- Plants: decorationViewAboveText, deviceSnapInCssPx and decorationColourIgnoresAlpha.
- Phase B holds both leases.

**TDEC-c.**
- double, dotted and dashed, reusing the paint-dash StyledStrokeData port once p6a-dash-v2 lands;
- wavy (a port of the MakeWave and tile code; antialiased edge pixels follow the existing 1-device-px edge rule, with no allowance);
- from-font thickness and position;
- underline-position under, measured first: CoreText's underline metrics against the post table, with a stop on an unexplained gap.

**TDEC-d.** A port of Skia's glyph intercepts (SkGlyph intercept computation at 2ab8add5) over the glyf outlines. It lifts skip-ink-intercepts. It is on the checkpoint-3 path only if TDEC-a's bounds proof fails on 'YouTube Terms' or 'Google Privacy'.

**Not in TDEC.** text-shadow and text-emphasis (TDEC-e, unboarded). The u, ins, s, del and abbr UA rows stay refused tags.

### Refusals

Compiler, DRAGON_UNSUPPORTED_VALUE, naming the part that lifts each:
- blink, spelling-error and grammar-error;
- non-solid styles (TDEC-c);
- from-font (TDEC-c);
- underline-position other than auto (TDEC-c);
- native decorated text (TDEC-b).

DRAGON_UNPROVEN_CONTEXT: a propagation context with no Chrome case.

Code skip-ink-intercepts (TDEC-d).


## TDEC-a worker package (verbatim from the receipt; PM accepted 2026-10-01)

**Objective.** TDEC-a (T148 part a), on a new branch tdec-a in worktree /tmp/dragon-tdec-a. BASE = txt-w2 657673bb2.
(1) Compiler. Add the longhands text-decoration-line, text-decoration-style, text-decoration-color, text-decoration-thickness, text-underline-offset, text-underline-position and text-decoration-skip-ink in a new packages/dragon/src/css/properties/text-decoration.ts, with inheritance and initials as in css_properties.json5. Add the text-decoration shorthand (line || thickness || style || color, css_properties.json5:9076) in a new shorthands/text-decoration.ts.
  Accepted: line none or any mix of underline, overline and line-through; style solid; any supported colour; thickness auto, <length> or <percentage>; underline-offset auto, <length> or <percentage>; underline-position auto; skip-ink auto or none.
  Refused with DRAGON_UNSUPPORTED_VALUE: blink, spelling-error and grammar-error; double, dotted, dashed and wavy, from-font, and every underline-position other than auto (all naming TDEC-c).
(2) Applied decorations. A new packages/dragon/src/analysis/text-decoration.ts implements css-text-decor-3 §2.1 from the spec. style_adjuster.cc and computed_style.cc are LGPL and are behaviour references only.
  Decorations propagate to in-flow inline boxes, block children and flex items. They never propagate into atomic inlines, out-of-flow boxes or floats.
  Each text leaf gets an ordered list of applied decorations: lines, style, colour, thickness, underline offset and the decorating box (the decorating box's font is used, text_decoration_info.cc:205-255 and :319-330).
  A propagation context with no Chrome case is refused with DRAGON_UNPROVEN_CONTEXT.
(3) UA rule. html.css:1501-1505, a:-webkit-any-link: color -webkit-link (#0000ee, measured) and text-decoration: underline. :visited never matches.
  attributes.ts lifts href. rel and target stay refused, with their owner renamed to LINK-RT. The :active and :focus-visible link rows stay unmodelled state rules.
(4) Engine geometry. A new packages/layout/src/text-decoration.ts, written in the translator subset and called by nothing yet. Every quantity is in zoomed px (font size times DPR, the TextFont convention):
  - ComputeDecorationThickness (text_decoration_info.cc:74-102; auto = computed size / 10, a length is roundf), with a minimum of 1 (:460-463).
  - ComputeUnderlineOffsetAuto (text_decoration_offset.cc:16-33): integer Ascent, plus a gap of max(1, ceil(t/2)) only when the offset is auto, plus roundf(offset).
  - Overline through ComputeUnderlineOffsetForUnder with TextTop (text_decoration_offset.cc:49-81; text_decoration_info.cc:366-392).
  - Line-through at 2*FloatAscent/3 - t/2 (:395-400).
  - OffsetFromDecoratingBox (:319-330).
  - DrawLineAsRect with SnapYAxis and RoundDownThickness (decoration_line_painter.cc:15-27, 75-93).
  - Paint order: under/overlines before the text, line-through after it (text_fragment_painter.cc:550-557).
  - Skip-ink, conservative bounds proof: the band is Bounds inset by 0.5 px vertically (text_painter.cc:555-563). If every glyph control-point y on the decorated range, from glyf at the zoomed size, is at least 1/64 px outside the band, nothing is clipped. Otherwise the text is refused with the code skip-ink-intercepts, naming TDEC-d.
(5) Targets. Web accepts every accepted value. On ios and android, any text leaf with a non-empty list of applied decorations is refused with DRAGON_UNSUPPORTED_VALUE, naming TDEC-b.
(6) Proof.
  - A new pnpm script, parity:decoration-capture. Chrome renders each case twice at DPR 1, 2, 3 and 2.625: as authored, and with text-decoration-line: none !important injected.
  - The decoration pixels are the pixels that differ, restricted to pixels that equal the background in the no-decoration render. The engine's snapped rects must equal them exactly, colour included, with no tolerance.
  - Chrome getComputedStyle and CSS.supports grammar tables for every longhand and the shorthand, including invalid values.
(7) Fixture group text-decoration, in Lato 400/700, Inter and Ahem, ltr and rtl. Cases:
  - each line and the combinations;
  - thickness auto, px, em and %;
  - offset auto, px, negative, rem and %;
  - colour with alpha;
  - skip-ink none;
  - an underlined inline box holding a larger-font span;
  - two applied decorations (block plus inline box);
  - wrapped multi-line text, centred;
  - the north-star desktop shape (a flex-item a[href] in Lato 400 at 0.78rem with text-decoration-color rgba(167,175,189,0.45) and text-underline-offset 0.2rem).
  Reject fixtures: wavy, from-font, an Ahem auto underline (which crosses the glyph boxes) and native.
  Retarget reject-attr-href and reject-phrasing-a-href to cases that are still refused.
(8) Plants, each caught by a named test against the Chrome captures:
  - autoThicknessFromFont
  - gapWithFixedOffset
  - offsetNotRounded
  - snapFloorNotHalf
  - thicknessRoundedNotFloored
  - lineThroughFromBaseline
  - decoratingBoxFontIgnored
  - underlineAfterText
  - propagatedIntoOutOfFlow (a compiler plant)
  The receipt runs the bounds proof on 'YouTube Terms' and 'Google Privacy' at every DPR, and states whether TDEC-d is on the checkpoint-3 path.

**allowed_files**
- packages/dragon/src/css/properties/text-decoration.ts (new)
- packages/dragon/src/css/shorthands/text-decoration.ts (new)
- packages/dragon/src/css/shorthands/index.ts (one registration)
- packages/dragon/src/css/properties.ts (one import and spread)
- packages/dragon/src/css/values.ts (additive only)
- packages/dragon/src/css/grammar.generated.ts (pnpm grammar:gen only)
- scripts/gen-css-grammar.ts (SUBSET entries only)
- packages/dragon/src/analysis/text-decoration.ts (new)
- packages/dragon/src/analysis/computed.ts (one call)
- packages/dragon/src/analysis/computed-checks.ts (decoration refusals)
- packages/dragon/src/analysis/elements.ts (only if the a[href] key needs it)
- packages/dragon/src/ua/datasets.ts (the a:any-link rows)
- packages/dragon/src/attributes.ts (href lift; LINK-RT owner text)
- packages/dragon/src/project.ts (support rows for the new properties only)
- packages/dragon/src/fonts/sfnt.ts (additive reads: post underline metrics, per-glyph glyf control-point y extents)
- packages/dragon/src/fonts/metrics.ts (additive)
- packages/dragon/src/faults.ts (append)
- packages/dragon/src/diagnostics/catalogue.ts (append)
- packages/dragon/test/diagnostic-codes.json (append-only)
- packages/dragon/src/profiles/web.ts, ios.ts, android.ts (profile:rows output only)
- packages/dragon/test/text-decoration.test.ts (new)
- packages/dragon/test/seams.test.ts, inl1a-tags.test.ts, blockify.test.ts (pin retargets only)
- packages/layout/src/text-decoration.ts (new)
- packages/layout/src/index.ts (one export line)
- packages/layout/test/text-decoration.test.ts (new)
- packages/parity/src/decoration-capture.ts (new)
- packages/parity/src/cli/decoration-capture.ts (new)
- package.json (one script line: parity:decoration-capture)
- packages/parity/expected-decorations/** (new, capture output)
- packages/parity/fixtures/text-decoration-*.html, reject-text-decoration-*.html (new)
- packages/parity/fixtures/reject-attr-href.html, reject-phrasing-a-href.html (retarget or rename)
- packages/parity/src/fixture-groups/text-decoration.ts (new)
- packages/parity/src/fixtures.ts (one import, one append)
- packages/parity/src/fonts.ts (MAPS entries for the new fixtures)
- packages/parity/test/text-decoration.test.ts (new)
- packages/parity/test/*.test.ts (derived count pins only)
- packages/translate/src/corpus.ts, corpus-dpr.ts (append-only)
- generated outputs from the regeneration chain only: packages/parity/expected/**, expected-dpr/**, expected-breaks/**, emitted/**, pixel references and manifest, packages/layout/vectors/**, native generated engines and harnesses, examples/music-player/dragon/north-star-check.json, packages/wpt/expectations/*.json, tailwind-sweep snapshot, packages/parity/out/lanes.json
- docs/goals/milestone-2-proof/notes/T148-tdec-a.md (main checkout only)

**verify**
- E = export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&; BASE=657673bb2
- cd /tmp/dragon-tdec-a && E pnpm typecheck && pnpm run layout:subset
- cd /tmp/dragon-tdec-a && E pnpm test
- cd /tmp/dragon-tdec-a && E pnpm run grammar:gen && pnpm run parity:capture && pnpm run profile:rows && pnpm run parity:capture && pnpm run profile:rows  # repeat until a fixed point
- cd /tmp/dragon-tdec-a && E pnpm run parity:dpr-capture && pnpm run layout:vectors && pnpm run layout:dpr-vectors && pnpm run layout:break-vectors && pnpm run parity:break-capture && pnpm run native:gen && pnpm run north-star:check && pnpm run wpt:run -- --target web && pnpm run wpt:update-expectations -- --target web && pnpm run tw:sweep && pnpm run parity:pixel-capture && pnpm run parity:glyph-b3 -- --write-bottom-pins && pnpm run parity:lanes -- --run-host
- cd /tmp/dragon-tdec-a && E pnpm run parity:decoration-capture && npx vitest run packages/parity/test/text-decoration.test.ts packages/layout/test/text-decoration.test.ts packages/dragon/test/text-decoration.test.ts  # engine rects = Chrome decoration pixels N/N at DPR 1, 2, 3 and 2.625, colours exact, grammar tables 0 mismatches
- text-decoration.test.ts pins: every pre-existing capture equals BASE (via git show) once the new decoration keys are removed; every existing vector, break vector, break capture and pixel PNG is byte-identical; layoutCaseIds grows by exactly the appended text-decoration ids; each plant fails its named test and the unfaulted run passes
- cd /tmp/dragon-tdec-a && git diff --stat $BASE -- packages/layout/src ':!packages/layout/src/text-decoration.ts' ':!packages/layout/src/index.ts' packages/text-shaper packages/dragon/src/lower packages/dragon/src/emit packages/parity/src/targets.ts packages/parity/src/device-lanes.ts  # must be empty
- north star: on web, the href DRAGON_UNSUPPORTED_ATTRIBUTE (2) and property:text-decoration-color and property:text-underline-offset (1 each) reach 0. On ios and android these become TDEC-b refusals: the receipt lists every move, and no other code count rises
- merge-conflict test: for B in inl2, size-ar, form-a, form-a2, the set of non-generated paths that `git merge-tree --write-tree --name-only --no-messages HEAD $B` reports as conflicted is a subset of the set for BASE $B; the receipt lists both
- cd /tmp/dragon-tdec-a && git diff --name-only $BASE..HEAD lies inside allowed_files; no push, fetch or pull

**stop_if**
- A Chrome decoration capture disagrees with the ported formula at any DPR, and Blink 145.0.7632.6 does not explain it (including the zoom-for-DSF assumption that thickness and offset use the zoomed font size). Report it; never add a tolerance.
- Chrome propagates a decoration differently from css-text-decor-3 §2.1 in a context the fixtures cover. Refuse that context; do not model it from a guess.
- The work needs edits to packages/layout/src (other than the new file and the index.ts line), packages/text-shaper, packages/dragon/src/lower, packages/dragon/src/emit or native drawing (that is TDEC-b), targets.ts or device-lanes.ts, or code derived from an LGPL file.
- A pre-existing capture, vector, break capture or pixel PNG changes beyond the added computed keys.
- A north-star link string fails the skip-ink bounds proof. Report that TDEC-d is on the checkpoint-3 path; do not implement intercepts.
- The reviewed diff, excluding generated outputs, goes over about 150 KB. Split into tdec-a1 (compiler and propagation) and tdec-a2 (geometry, capture and fixtures).
- txt-w2 is rewritten or force-pushed. Rebase only when the PM says so.
- A file outside allowed_files is needed, or a plant is not caught.
- Verification fails twice (test timeouts under load that pass on rerun excepted).
