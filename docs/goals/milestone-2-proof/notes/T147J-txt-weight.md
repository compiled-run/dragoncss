# T147J TXT-W: font-weight, font-style and font (Judge, 2026-10-01)

Blink and Skia cites are at 145.0.7632.6 and Skia 2ab8add5, from the GitHub mirrors (copies in /tmp/t147j).

## Chrome's behaviour

**Computed values** (style_builder_converter.cc:1107-1185).
- font-weight: a number clamps to [1,1000], held in FontSelectionValue quarter units. normal is 400 and bold is 700.
- bolder and lighter read the parent's computed weight (font_description.cc:158-187):
  - bolder: below 350 gives 400; [350,550) gives 700; [550,900) gives 900; 900 and up is unchanged.
  - lighter: below 100 is unchanged; [100,550) gives 100; [550,750) gives 400; 750 and up gives 700.
- font-style: italic and bare oblique are both slope 14. `oblique <a>` is slope a, and `oblique 0deg` is normal.

**UA stylesheet** (html.css): h1-h6 and th are bold. b and strong are bolder (1318). i, cite, em, var, address and dfn are italic. Dragon's UA rows hold computed 700 and italic, which are wrong under a non-initial parent. That is why T133 refuses nesting.

**Matching.** FontSelectionAlgorithm is already ported (fonts/selection.ts) and proven (matching.json).

**Synthesis** (css_segmented_font_face.cc:115-122).
- Bold is synthesized when the request is >= 600 and the matched face's maximum weight is < 600.
- Italic is synthesized when the request slope is >= 14 and the face's maximum slope is < 14. So oblique 10deg over an upright face draws upright.
- Synthesis is suppressed when the typeface has the bold or italic trait (font_custom_platform_data.cc:286-287).
- Variable faces re-derive synthesis from their wght and slnt axes (:148, :186). They stay fenced (TXT1b).

**Drawing** (font_platform_data_mac.mm:255-256).
- Bold is SkFont embolden. On Mac it becomes a frame-and-fill stroke (SkTypeface_mac_ct.cpp:888, SkScalerContext.cpp:1017-1037).
- The stroke width is size × k. k is 1/24 at 9 px and below, 1/32 at 36 px and above, linear in between: 0.62 px at 16 px. The join is miter with the default miter limit.
- Oblique is skewX -0.25 (14.04deg) for every angle.

**Advances do not change.** CoreText advances come from CTFontGetAdvancesForGlyphs (SkScalerContext_mac_ct.cpp:305-311), and Blink feeds SkFont::getWidths to HarfBuzz (harfbuzz_face.cc:249-273). So synthesis is paint-only: layout uses the base face's HarfBuzz advances, and the shim needs no change.

**Platforms.** Dragon positions every glyph and draws it itself (decisions.md:243). CoreText/UIFont traits and Android Typeface weight are not used for selection. Bundled faces are selected by sha256.

## Scope and split

**Part 1, TXT-W1** (worker package in the receipt). Based on inl1a-tags 1730a3c07, branch txt-w1.
- The font-weight and font-style longhands: numbers 1-1000, keywords, bolder and lighter, italic, and oblique with an angle.
- UA rows become specified values, which lifts T133's nesting refusal.
- Computed weight and slope feed selection and the synthesis predicate.
- Native lays out every bundled static Latin face that is not synthesized: Inter 300/400/700/italic/700-italic and Lato 400/700. A weight that is not bundled matches the nearest face. When that face is >= 600, or the slope is satisfied, nothing is synthesized and native draws it.
- Synthesized text stays DRAGON_SYNTHETIC_FONT_STYLE on native and is accepted on web, with web-only captures.
- A face with the bold or italic trait where Chrome would suppress synthesis is refused (fail-closed).
- North star: the h3/h4 font-weight: 400 refusals go away. `font: inherit` remains until part 2.

**Part 2, TXT-W2.**
- The `font` shorthand: [style || variant-css2 || weight || width-css3]? size [/ line-height]? family.
- It resets every Blink longhand (css_properties.json5:8735-8742), including line-height to normal. Longhands Dragon does not model reset to initial and are refused when set to anything else.
- System-font keywords, small-caps and non-normal stretch are refused. CSS-wide keywords set all longhands.
- font-synthesis plus its -weight, -style and -small-caps longhands. The `font` shorthand does not reset them. With `none`, Chrome draws the base face unsynthesized, so native can lay it out.
- Runs after part 1.

**Part 3, TXT-W3.** Native synthetic bold and oblique.
- iOS: CG fill-and-stroke with line width = Skia's stroke width and miter limit 4, and a text-matrix skew of +0.25 in y-up coordinates around the baseline.
- Android: a FILL_AND_STROKE Paint with the same width and join, and a canvas skew of -0.25 about the baseline, through Canvas.drawGlyphs.
- The glyph rule's expected ink comes from stroked and skewed outlines, not padded boxes. The miter can reach 4 × the half-width.
- Plants: no embolden, doubled stroke width, flipped skew sign, wrong skew origin.
- Needs a T147-3J slice, which first measures whether the DPR applies to the stroke textSize and checks ink against Chrome at DPR 1, 2, 3 and 2.625. It runs after part 1 and T084 Phase R.

## Proof for part 1

- Chrome getComputedStyle captures for the grammar table. Every existing capture gains only the two keys; the rest is byte-identical to BASE.
- Per-node platformFonts face keys in each direction.
- Lines, advances and breaks at DPR 1, 2, 3 and 2.625, plus pixel PNGs, through FIXTURES.
- Swift and Kotlin transcript replay on the host. Device runs follow T084 Phase R.
- Six plants, each caught by a named test.

## Not in scope

- Variable-font wght/slnt instances (TXT1b).
- The accessibility Bold Text setting (+300, clamped at 900; decisions.md:299), which goes to MQ-R and builds on part 1's computed weight.
- font-stretch beyond normal.
- Symbol fallback (TXT1d).

## TXT-W1 worker package (verbatim from the T147J receipt; PM accepted 2026-10-01)

**Objective.** TXT-W1 (T147 part 1), on a new branch txt-w1 in worktree /tmp/dragon-txtw1 based on inl1a-tags 1730a3c07. (1) Add font-weight and font-style as inherited, layout-aspect longhands. font-weight takes <number [1,1000]> (calc allowed), normal, bold, bolder or lighter. Its computed value is Blink ConvertFontWeight: numbers clamp to [1,1000] and quantize to FontSelectionValue quarter units, and bolder/lighter use FontDescription::BolderWeight/LighterWeight bands against the parent's computed weight. font-style takes normal, italic, oblique, or oblique <angle [-90deg,90deg]>. Its computed value is ConvertFontStyle: bare oblique becomes 14deg and oblique 0deg becomes normal. (2) Rewrite the userAgentTextFonts rows as html.css specified values: h1-h6 and th bold, b and strong bolder, i, em and address italic. Resolve them through the cascade, and lift T133's nested-tag refusal (b in h1 computes to 900). Retarget the two reject-inline-tags-* fixtures to accepted cases. (3) project.ts: replace UaTextFont with the computed weight and slope, used by engineFacesOf, checkSyntheticStyles and checkUserAgentDefaults. Change the syntheticStyle predicate to Blink's: bold when the request is >= 600 and the face maximum is < 600; oblique when the request slope is >= 14 and the face maximum slope is < 14. When synthesis is predicted on a face file that has the bold or italic trait (Chrome suppresses synthesis there, font_custom_platform_data.cc:286-287), refuse fail-closed with a typed reason. (4) Web accepts every value, including synthesized text. Native lowers bundled, static, Latin faces that are not synthesized. Synthetic, variable and Ahem-bold text stays refused. (5) Add a text-weight fixture group, appended last. It covers Inter 300/400/700/italic/700-italic and Lato 400/700 reached through numeric weights, keywords, bolder/lighter chains across every band edge, and oblique angles that do not synthesize. It runs at DPR 1, 2, 3 and 2.625, plus breaks, plus pixel PNGs. Add a web-only synthetic lane (Lato italic, Dragon Mono bold, Inter oblique 20deg) and reject fixtures for native synthesis. Add Chrome computed-value captures for the grammar table, including invalid values. (6) Add plants, each caught against Chrome by a named test: bolderBandEdge, lighterBandEdge, weightNotInherited, obliqueAngleDropped (the existing obliqueAsItalic fault), syntheticBoldThreshold700, and quarterUnitRounding.

**allowed_files**
- packages/dragon/src/css/properties/text.ts
- packages/dragon/src/css/properties.ts
- packages/dragon/src/css/values.ts
- packages/dragon/src/css/math.ts
- packages/dragon/src/css/grammar.generated.ts (pnpm grammar:gen only)
- packages/dragon/src/analysis/resolve.ts
- packages/dragon/src/analysis/computed.ts
- packages/dragon/src/analysis/computed-checks.ts
- packages/dragon/src/analysis/elements.ts
- packages/dragon/src/ua/datasets.ts
- packages/dragon/src/project.ts
- packages/dragon/src/fonts/selection.ts (additive exports)
- packages/dragon/src/fonts/weight.ts (new: BolderWeight/LighterWeight/ConvertFontStyle port)
- packages/dragon/src/fonts/faults.ts (additive plants)
- packages/dragon/src/fonts/metrics.ts (additive bold-trait helper)
- packages/dragon/src/fonts/sfnt.ts (additive reads: usWeightClass, head.macStyle)
- packages/dragon/src/diagnostics/catalogue.ts (DRAGON_SYNTHETIC_FONT_STYLE text only)
- packages/dragon/src/profiles/web.ts, ios.ts, android.ts (profile:rows only)
- packages/dragon/test/font-weight.test.ts (new)
- packages/dragon/test/seams.test.ts, text.test.ts, blockify.test.ts (pin retargets only)
- packages/parity/fixtures/text-weight-*.html, reject-text-weight-*.html, fonts-weight-synthetic.html (new)
- packages/parity/fixtures/reject-inline-tags-bold-in-heading.html, reject-inline-tags-italic-in-italic.html (retarget/rename)
- packages/parity/src/fixture-groups/text-weight.ts (new)
- packages/parity/src/fixture-groups/inline-tags.ts
- packages/parity/src/fixture-groups/fonts.ts
- packages/parity/src/fixtures.ts (one import, one append)
- packages/parity/test/text-weight.test.ts (new)
- packages/parity/test/inl1a-tags.test.ts, text-latin.test.ts, values.test.ts (pin retargets only)
- packages/translate/src/corpus.ts, corpus-dpr.ts (append-only)
- generated outputs from the regeneration chain only: packages/parity/expected/**, expected-dpr/**, expected-breaks/**, emitted/**, pixel references and manifest, vectors/**, native generated engines and harnesses, examples/music-player/dragon/north-star-check.json, WPT expectations, tw-sweep output, lanes.json
- docs/goals/milestone-2-proof/notes/T147-txt-w1.md (worker note)

**verify**
- cd /tmp/dragon-txtw1 && pnpm typecheck
- cd /tmp/dragon-txtw1 && pnpm test
- cd /tmp/dragon-txtw1 && pnpm run grammar:gen && pnpm run parity:capture && pnpm run profile:rows && pnpm run parity:capture && pnpm run profile:rows  # repeat until a fixed point
- cd /tmp/dragon-txtw1 && pnpm run parity:dpr-capture && pnpm run layout:vectors && pnpm run layout:dpr-vectors && pnpm run layout:break-vectors && pnpm run parity:break-capture && pnpm run native:gen && pnpm run north-star:check && pnpm run wpt:run -- --target web && pnpm run wpt:update-expectations -- --target web && pnpm run tw:sweep && pnpm run parity:pixel-capture && pnpm run parity:glyph-b3 -- --write-bottom-pins && pnpm run parity:lanes -- --run-host
- cd /tmp/dragon-txtw1 && npx vitest run packages/parity/test/text-weight.test.ts packages/dragon/test/font-weight.test.ts packages/parity/test/inl1a-tags.test.ts
- cd /tmp/dragon-txtw1 && pnpm run native:swift && pnpm run native:kotlin  # transcript replay of the text-weight vectors
- text-weight.test.ts pins: every pre-existing capture equals BASE 1730a3c07 (via git show) once font-weight and font-style are removed from computed; every existing vector, break and pixel PNG is byte-identical; layoutCaseIds grows by exactly the appended text-weight ids; each plant fails its named test
- cd /tmp/dragon-txtw1 && git diff --stat 1730a3c07 -- packages/layout/src packages/text-shaper packages/dragon/src/lower packages/parity/src/targets.ts packages/parity/src/device-lanes.ts  # must be empty

**stop_if**
- A Chrome capture contradicts a ported Blink rule (band edges, quarter-unit quantization, oblique 0deg as normal, the synthesis predicate, html.css specified values). Report it; never widen a gate.
- A pre-existing capture, vector, break capture or pixel PNG changes beyond the two added computed keys.
- The work needs edits to packages/layout/src, packages/text-shaper, native runtime glyph drawing (Swift/Kotlin), or targets.ts/device-lanes.ts.
- inl1a-tags or txt1a-2 is rewritten or force-pushed, or T133's review changes the files this branch builds on. Rebase only after the PM says so.
- A fixture reaches the bold/italic-trait suppression case or a variable face. Refuse it; do not model it without a Chrome case.
- The reviewed diff, excluding generated outputs, goes over about 150 KB. Split into stacked PRs at the checkpoint: 1a compiler and values, 1b fixtures and captures.
- native:encoders or a device lane is needed to call part 1 host-done. Device runs follow T084 Phase R.

**PM:** dispatch when T133 (inl1a-tags) is host-done; base = T133's final head (the Judge read 1730a3c07). The worker note goes in the receipt (notes are never committed on branches). The decisions.md entry (synthesis is paint-only; weight/style follow Blink's converters; native synthesis refused until TXT-W3) goes in the TXT-W1 PR.
