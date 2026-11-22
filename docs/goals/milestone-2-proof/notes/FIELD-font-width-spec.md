# FIELD-font-width: a text field's intrinsic width in a real font, as Chrome 145 sizes it

Worker spec (2026-11-22) for review before implementation.

## Why

checkTextField (packages/dragon/src/analysis/computed-checks.ts, the `width-font` refusal at about line 1807) refuses, on ios and android, every `<input>` text field whose first font-family is not Ahem. The engine sizes a field from the advance of `0` (packages/layout/src/controls.ts textFieldInlineSize), and that is proven only for Ahem. Any width, min-width, flex or shrink-to-fit sizing may read that size, so the check refuses the field whatever its width.

This blocks the title and search fields of the Markless notes app (`'Que Grotesque'` WOFF2, then `system-ui`) and the inputs of nearly every real app.

## What Chrome 145 does (tag 145.0.7632.6, references only)

Files and licences:

- **LGPL headers:** layout_box.cc, layout_text_control.cc, html_input_element.cc, input_type_view.cc and computed_style.cc. Dragon may not port them (docs/decisions.md "Source and licence", docs/ports.md step 3).
- **BSD headers:** simple_font_data.cc (Apple BSD; it is already a ports.json `port` entry), length_utils.cc and layout_text_control_single_line.cc.

Everything below the "Measured" heading was checked against Chrome numbers. The model is stated as behaviour, not code.

### Where the intrinsic width is used

- **The default size takes the place of the content** (length_utils.cc CalculateMinMaxSizesIgnoringChildren). When LayoutBox::DefaultIntrinsicContentInlineSize gives a size, the field's min-content and max-content sizes are both that size plus border and padding. The value, placeholder and inner editor never count.
- **When the default size applies** (layout_box.cc DefaultIntrinsicContentInlineSize): a text field gets it only while ComputedStyle::ApplyControlFixedSize holds, that is `field-sizing: fixed` (the initial value) or an autofilled control.
- **LayoutTextControlSingleLine** (BSD) has no sizing code left in 145. Only hit testing and overflow remain there.

### The formula

layout_box.cc TextFieldIntrinsicInlineSize works as follows:

- `size` is HTMLInputElement::size(). The `size` attribute is parsed by the HTML rules for non-negative integers. `0`, an empty value, a non-number or a value over 2^31−1 gives the default, 20 (html_input_element.cc ParseAttribute, kDefaultSize).
  - Measured: `size=" 5"` and `size="5px"` give 5, and `size=0` and `size=abc` give 20.
  - InputTypeView::GetSizeWithDecoration adds nothing for text, search, email, url, tel, password or number without min/max (measured: all equal). Only types with a spin button take the decoration branch.
- `float_result = A × size`, where A is the average character width below.
- `max_char_width` (M) is read only when the face passes the validity test below. When `M > A`, `float_result += M − A`. Blink's comment calls this "For text inputs, IE adds some extra width".
- The result is `LayoutUnit(ceilf(float_result))`: a whole number of device px, because the font size is already zoomed.

### The average character width A

layout_text_control.cc GetAvgCharWidth:

- **When the face passes the validity test:** `A = max(avg, roundf(avg))` of the primary font's AvgCharWidth. The rounding applies only when the fraction is ≥ 0.5.
- **Otherwise:** A is the shaped width of the one-character text `0` in the field's style (ComputeTextWidth). Measured: letter-spacing adds to it, and word-spacing does not.

### The validity test

layout_text_control.cc HasValidAvgCharWidth. The face is invalid when any of these holds:

1. the primary font's FontMetrics has a zero width and `AvgCharWidth > 1.7 × ZeroWidth` (a heuristic for faces whose average matches full-width CJK glyphs);
2. the **first family name** of the computed `font-family` is empty;
3. that name is one of a fixed list of 34 family names. The list holds old Mac faces: `Helvetica`, `Times`, `Courier`, `Monaco`, `Lucida Grande`, `Gill Sans`, `Kai`, `Hei`, `#GungSeo`, and so on.

Measured:

- **The name test is case-sensitive.** `HELVETICA` and `helvetica` are valid.
- **The test reads only the name, not the face.** A Lato `@font-face` named `"Helvetica"`, `"Kai"`, `"#GungSeo"` or `"Monaco"` takes the fallback path, while the same Lato named `"Lato Probe"`, `"Arial"` or `"Helvetica Neue"` does not.
- **A generic family is valid.** It has a non-empty name (`sans-serif`), so `sans-serif`, which resolves to Helvetica's face on macOS, takes the valid path.

### Where AvgCharWidth and MaxCharWidth come from

simple_font_data.cc PlatformInit (BSD), per platform:

- **Apple (macOS, the Dragon reference platform darwin-arm64):**
  - `avg_char_width_` is **the advance of the glyph the cmap maps `x` to** (WidthForGlyph, the SkFont advance at the platform size, without shaping). When the face has no `x` glyph it is the x-height.
  - **OS/2 xAvgCharWidth is not read on Apple at all.**
  - `max_char_width_ = max(avg_char_width_, FloatAscent())` runs *before* `avg_char_width_` is set, when it is still −1, so M is the ascent. That is the rounded ascent after FontMetrics::AscentDescentWithHacks, ascent-override included. Measured: Lato with `ascent-override: 50%` gives M = 8 < A at 16px, so no extra width.
- **Windows:** `max = SkScalarRoundToInt(fMaxCharWidth)` (or 2 × ascent when below 1), and `avg = fAvgCharWidth`.
- **Linux, ChromeOS and Android (the `#else` branch):**
  - `max = SkScalarRoundToInt(fXMax − fXMin)`, the font bounding box width at the size;
  - `avg = fAvgCharWidth`, which Skia's FreeType port takes from OS/2 xAvgCharWidth scaled by size/unitsPerEm. When that is 0, avg falls back to the `x` advance or the x-height.
  - This branch is the one the task statement describes. It was **not measured here**, because there is no Linux host.

### Which sizes read the intrinsic width

Measured with Que Grotesque 24px. Its intrinsic width is 248px with no padding or border, and 145px for the narrower size in the first run.

| Context | Used width | Reads it? |
| --- | ---: | --- |
| `display:block; width:auto` in a 150px or 600px block | 145, 248 | **yes**: an auto-width field does not stretch |
| `display:block; margin:0 auto` | 248 | yes |
| `width:fit-content`, `min-width:min-content` | 248, 145 | yes |
| `width:stretch` in 600px | 600 | no |
| `width:100%` or `120px` in a 150px block | 150, 120 | no |
| `width:auto; max-width:100%` in 100px | 100 | yes (`min(intrinsic, 100)`) |
| `width:100%` in an `inline-block`, `float` or `width:max-content` parent, or an auto-width abspos | 145, 248 | **yes**: the parent shrinks to fit |
| `width:100%` grid item, auto track, 100px grid | 100 | no (see below) |
| `width:auto` grid item | 248 (overflows) | yes |
| row flex, `width:auto` (any container width) | 248 | yes |
| row flex, `flex:1 1 0`, `min-width:auto`, 100px | 248 (overflows) | **yes**: the automatic minimum is the intrinsic width |
| row flex, `flex:1`, `min-width:0` | 150 | no |
| row flex, `width:100%` and a rigid 100px sibling, 150px | 50 | no: it shrinks below the intrinsic 145 |
| stretched column flex item | 150 | no |
| column flex item, `align-self:start` | 145 | yes |
| `field-sizing: content` | 1 | no: it sizes from the value, a different feature |

The two "no" rows for a percentage width in grid and flex show css-sizing-3 §5.2.2 (compressible replaced elements): a text field with a percentage `width` or `max-width` has its min-content contribution, and so its content-based minimum, compressed to zero. Its max-content contribution is still the intrinsic width, so a grid with more than one auto track, or a `justify-content` other than normal/stretch, does read it.

## Measured (Chrome 145.0.7632.6 on darwin-arm64, the pinned Playwright Chrome, `launchChrome`)

Fields had no padding or border, so the measured width is the intrinsic width. The faces were vendored Lato Regular, Markless's QueGrotesque-Regular.woff2 (`'Que Grotesque'`) and vendored Ahem. Each was measured at font sizes 10, 13.3333, 16, 17, 24 and 31.5px and at `size` 1, 2, 3, 5, 10, 20 (the default), 37 and 100, at DPR 1. A second run covered DPR 1, 2, 2.625 and 3 at sizes 1 and 20.

**The Apple model matches every row: 224 of 224** (144 at DPR 1 and 80 across the DPRs). Dragon's own faceMetrics gave the platform size and ascent. The model:

```
x  = f32(platformSize × xAdvanceUnits / unitsPerEm)        (both product orders gave the same 224 results)
A  = max(x, roundf(x))
M  = the face's rounded ascent at the platform size (faceMetrics ascent, device px)
W  = ceil(f32(A × size) + (M > A ? f32(M − A) : 0))        device px; CSS px = W / DPR
```

Sample rows at DPR 1. W1 and W20 are the widths at `size` 1 and 20. "With xAvgCharWidth" is what the OS/2 value would give.

| Face, size | x advance | A | M | W1 | W20 | With xAvgCharWidth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ahem 16 | 16 | 16 | 13 | 16 | 320 | 314.2 (982/1000) |
| Lato 16 (upem 2000, x 996, xAvg 1108) | 7.968 | 8 | 16 | 16 | 168 | 177.3 + bbox |
| Lato 17 | 8.466 | 8.466 | 17 | 17 | 178 | |
| Que Grotesque 16 (upem 2048, x 1037, xAvg 941) | 8.1016 | 8.1016 | 12 | 12 | 166 | 147.0 + bbox |
| Que Grotesque 17 | 8.608 | 9 | 12 | 12 | 183 | |

More results:

- **The fallback path** (`Helvetica`, `Times`, `Courier`, or a listed name used as an `@font-face` alias) gives `W = ceil(size × width of "0")` with no M term. Helvetica 16 is 20 × 8.8984 → 178, and with `letter-spacing: 2px` 218.
- **No effect:** synthetic bold, small-caps, text-transform, placeholder or value length, the input type (text, search, email, number, password) and `size=0`.
- **Scales A:** a size-adjust of 150% and `zoom: 1.5` both equal 24px. `font-size-adjust: 0.6` changes A.
- **Apple system faces do not fit the model with the shaped `x`.** `system-ui` (SF) and PingFang SC differ: the `x` advance in text includes Core Text tracking (`trak`), and Chrome's WidthForGlyph does not. For SF at 16px the measured slope gives A ≈ 8.389, while the shaped `x` is 8.078. Arial, Georgia, Menlo, Hiragino Sans and Times New Roman are valid-path faces and fit the shape of the formula, but they were checked only by slope, not exactly.

## What Dragon does today

- **The engine** (packages/layout/src/controls.ts textFieldInlineSize, read by intrinsic.ts intrinsicContentInlineSize) computes `ceil(max(z, roundf(z)) × size)`, where z is `measurer.lengths(font).zeroWidth`, the advance of `0`.
  - For Ahem it agrees with Chrome by luck: `x` and `0` are both 1em, and M = 0.8em < A.
  - It has no M term.
  - Its doc comment calls the advance of `0` "the face's average character width", which is true only on the fallback path.
- **ControlKind `text-field`** is `{ size, font, lineHeight }` (layout/src/input.ts). It is built in packages/dragon/src/lower/ios-layout.ts (textFieldSize).
- **FontData** (layout/src/text.ts) has `zeroAdvance` but no `x` advance.
  - `advances` covers `x` only in the Ahem font-data measurer. HarfBuzz host faces pass `advances: []`.
  - Every host fills FontData:
    - parity/src/text-shaper-host.ts fontDataOf;
    - dragon/src/emit/native-support.ts dragonMetricUnits and dragonFontData, in Swift and Kotlin;
    - parity/src/system-fonts/provider.ts and coretext-helper.swift;
    - the harness wire readers (translate/harness/harness.ts and the generated Harness.swift and Harness.kt);
    - parity/src/native-shim.ts;
    - the lengths tuple in parity/src/markless-plan.ts.
- **The compiler** reads sfnt tables in dragon/src/fonts/sfnt.ts (OS/2 is read without xAvgCharWidth, and hmtx through `advance`). It decodes WOFF and WOFF2 author fonts (fonts/woff.ts decodeFontFile) and measures faces in fonts/metrics.ts faceMetrics, whose `ascent` is exactly the M above.
- **The select already has this narrow rule.** checkSelect refuses every width that would read a menulist's widest option, through widthShape, widthSource and contentSizedAncestor (computed-checks.ts, about lines 1815-1890 and 1950-1975). The text field's narrow slice reuses those helpers.
- **The layout engine does not model compressible contributions** (no css-sizing-3 §5.2.2 code in intrinsic.ts, flex.ts or grid.ts).

## Slice FW1: accept a field whose used width never reads its intrinsic width

One PR. FW1 needs no font data, so the LGPL question does not arise.

1. **Replace the blanket `width-font` refusal** in checkTextField. A field whose first family is not Ahem is accepted natively only when all of the following hold. Each failure is refused by name, with the select's manual wording style:
   - **width:** `width` is a length or a percentage (widthShape `fixed` or `percent`). `auto` and every keyword are refused, `stretch` included (Q4).
   - **min-width and max-width:** no intrinsic keyword in `min-width` or `max-width`, as checkSelect already does. `max-width` is `none`, a length or a percentage.
   - **Flex and grid items:** `min-width: auto` is refused on a flex or grid item. Chrome compresses it for a percentage width, but the engine does not model compression (Q3). The manual says "set min-width: 0".
   - **Row flex items:** `flex-basis` is not `content` or an intrinsic keyword. A row flex item with a fixed width, `flex-shrink` > 0 and `min-width: auto` is already covered by the rule above.
   - **Percentages:** when `width` or a row item's `flex-basis` is a percentage, `contentSizedAncestor(chain)` must be null, as for the select. That means no ancestor up to a fixed width takes its width from its content (float, inline-block, abspos with an auto width, table, `max-content` and so on). A field that is itself a grid item with a percentage width is refused as the select's is (`width-content`).
2. **An engine tripwire.** ControlKind `text-field` gains `avgChar: 'proven' | 'unmeasured'`, set by lower/ios-layout.ts (`proven` only for Ahem). intrinsic.ts calls `unsupported('text-field-avg-char', …)` when it would read an `unmeasured` field's intrinsic size.
   - A planted compiler fault, `fieldWidthAnyContext`, accepts every width. The fixtures below must fail with it, through the tripwire or the Chrome comparison.
   - This makes "provably never reads" a checked claim, not only a compile-time argument.
3. **No host or native change.** The text field box, editor and placeholder are already laid out for any face that line layout supports. Only the guard moves.

## Slice FW2: Chrome's formula for faces whose file Dragon holds

FW2 covers bundled faces and author `@font-face` files (sfnt, WOFF, WOFF2). It is two PRs, split at a seam.

- **FW2a, the font data plumbing, with no behaviour change:**
  - FontData gains `xAdvance`, the hmtx advance of the glyph cmap maps `x` to, or −1 when there is none. FontLengths gains `xWidth`, from fontMetricLengths with fontMetricPx.
  - Every host listed above fills it. Ahem is 1000.
  - The bridge self-check (dragonSelfCheck) compares it, and the generated Swift and Kotlin regenerate.
- **FW2b, the formula:**
  - **Compiler** (lower/ios-layout.ts plus a helper beside fonts/metrics.ts): it decides `avgChar: 'x-advance' | 'zero-text'` per field and case:
    - `zero-text` when the first family name of the computed `font-family` is in the captured invalid-name table (see Q1), or when `x advance > 1.7 × 0 advance` in the face's data, or when the face has no `x` glyph (refused, Q6);
    - `x-advance` otherwise;
    - an author face whose primary face is not the first family's (a fallback face) is refused (Q7).
  - **Engine** (controls.ts textFieldInlineSize): in device px at the platform size:
    - `x-advance`: A = max(x, roundf(x)), M = the face ascent from `measurer.metrics(font).ascent`, and the result is `ceil(f32(A × size) + (M > A ? f32(M − A) : 0))`;
    - `zero-text`: A = the measured width of the text `0` in the field's font with its letter-spacing (`measurer.measure('0', font)`), and the result is `ceil(f32(A × size))`.
    - The doc comment is corrected, and the citation of layout_box.cc stays a `reference` use.
  - **Keyed to darwin-arm64**, like platform-rules.ts: the rule is claimed only for the reference platform that iOS and Android target. The Linux Chrome lane keeps FW1's guard for non-Ahem faces until a Linux capture proves the `#else` branch (Q5).
  - **FW1's guard narrows** to the faces FW2 does not measure: system faces (`system-ui`, SF, PingFang and any face from the system-fonts provider), variable instances and font-size-adjust, unless those are proven separately.

## Refused, by name (DRAGON_UNSUPPORTED_FONT or _VALUE, ios and android)

- **After FW1:**
  - a non-Ahem field whose used width may read its intrinsic width: `width: auto` or a keyword, an intrinsic min-width or max-width, or a flex or grid item with `min-width: auto`;
  - a percentage width under a content-sized ancestor;
  - a percentage-width grid item.
  - Each refusal names the box and its cause, through contentSizedFix.
- **After FW2:**
  - system faces and variable instances;
  - a face with no `x` glyph;
  - a first family that is not the primary face;
  - `font-size-adjust` on a field;
  - any field on the Linux Chrome lane in a non-Ahem face.

## Parity fixtures (chrome-dual plus linux-dragon-layout; Lato and Inter are vendored; Que Grotesque is not, Q8)

FW1:

- **`controls-text-field-font-definite`:** Lato fields with `display:block` at `width:100%`, `120px` and `calc(50% + 10px)`; in a stretched column flex item; as a row flex item with `flex:1 1 0; min-width:0` and with `width:100%; min-width:0`; under `max-width:50px`; with `box-sizing: border-box` and padding. Run at DPR 1, 2, 2.625 and 3, with fractional containing-block widths.
- **Reject fixtures:**
  - `reject-controls-text-field-font-auto`: `width:auto`, `margin:0 auto` and `fit-content`;
  - `reject-controls-text-field-font-flex-min`: `flex:1` with `min-width:auto`;
  - `reject-controls-text-field-font-shrink`: `width:100%` in an inline-block, a float and an abspos;
  - `reject-controls-text-field-font-grid`.

FW2b:

- **`controls-text-field-font-size`:** Lato and Inter at 10, 13.3333, 16, 17 and 24px, `size` 1, 3, 20 and 37, and the size strings `" 5"`, `"5px"`, `0` and `abc`, at the four DPRs. This covers both sides of `roundf` (Lato 16 rounds up, Lato 17 does not), M > A and M ≤ A (with `ascent-override: 50%`).
- **`controls-text-field-font-fallback`:** vendored Lato as `@font-face` aliases named `"Helvetica"`, `"Kai"` and `"Monaco"`, plus `"HELVETICA"` (valid), with letter-spacing 0 and 2px.
- **`controls-text-field-font-wide-x`:** a test copy of Lato whose `x` advance is over 1.7 × the `0` advance, made by a checked-in script (the CJK heuristic).
- **The FW1 reject fixtures** become accept fixtures for these faces.
- **A12-style Markless check:** export the notes fields' style input (below), and report the refusals before and after.

## Markless's need, measured against FW1 and FW2

The probe was a style input of the notes `/` search field and the NoteForm title field: app.css, the Shell, the page and the NoteForm rules, and the Que Grotesque WOFF2 files. It was run through `pnpm run markless:style-export` on master 2c460cb251.

**Today:**

- **Search** (`<input class=search type=search>`, `width:100%` in `main.content`):
  - DRAGON_UNSUPPORTED_ELEMENT on every target: "`<input>` of type search is not supported". `search` is not in TEXT_FIELD_TYPES.
  - Behind it: the UA `display: inline-block` refusal (RF-INL atomic inlines). The app never sets `display`.
- **Title** (`<input name=title>`, a `width:100%` grid item of `label.field`, which is `display:grid`):
  - `grid-item` ("a form control as a grid item is not supported yet");
  - `width-font`;
  - `editing`;
  - SELD-R2b `:focus`, `:focus-visible` and `:active` hit testing through `.form`'s box-shadow.

**With `type=text` and `display:block` on search** (a variant probe): the search field hits `width-font`, `editing` and SELD-R2b (hit testing through `overflow-x` on its `::editor`).

**After FW1:**

- The search field's chain is fixed or percentage all the way up: `main.content` is a non-stretched column flex item with `width:100%`, and `.shell` is a block. So `width-font` goes, once the field is `type=text` and `display:block`. That needs the app or FORM-b to change.
- The title field still hits `grid-item`, and FW1's own percentage-grid-item refusal. Its ancestors `.field` and `.form` are grid items too, which widthSource calls content-sized.
- **Both still hit:**
  - **"`<input>` … is an editable text field: Dragon draws its value but has no caret, selection or keyboard input on iOS and Android yet (the FORM-b editing slice)"**, the `editing` refusal, owned by FORM-b editing;
  - SELD-R2b hit testing (`:focus`, `:focus-visible` and `:active` through box-shadow and overflow);
  - for search, the `type=search` refusal (FORM-b input types) and the `display: inline-block` refusal (RF-INL), unless the app sets `display:block`.

**FW1 alone makes neither notes field build.** It removes the font refusal for definite-width fields. The title also needs a form control as a grid item (grid-control), and a grid rule that accepts a single stretched column (Q3).

## Size estimates

- **FW1:** about 80-120 lines in computed-checks.ts, plus the tripwire (input.ts, intrinsic.ts and the lowering, about 20 lines), unit tests (about 150 lines) and 5 fixtures. About 30-45 KB reviewed. One PR, about 1 worker-day.
- **FW2a:** the FontData field across about 9 host and wire files, the self-check, and the Swift and Kotlin regen (generated, not reviewed). About 25-35 KB reviewed. Half a day.
- **FW2b:** the formula (about 30 lines), the compiler decision and name table with its capture script (about 150 lines), the wide-x font script, 3 fixtures over 4 DPRs, and the profile rows. About 60-90 KB reviewed. About 2 days.
- **Both FW2 PRs** fit under the 150 KB limit, so no further split.

## Open questions for the Judge

1. **LGPL: the family-name list and the formula.**
   - The formula (`size × A`, the `M − A` term, `ceil`, `max(avg, roundf(avg))`), the 1.7 heuristic and the 34-name list all live in LGPL files (layout_box.cc, layout_text_control.cc).
   - The Apple sources of A and M are in BSD simple_font_data.cc and may be ported.
   - The spec author has read the LGPL files. This spec states only behaviour, every number of which is pinned by a measurement above.
   - Proposed:
     - rule the formula class A (a Chrome observation, as T118J ruled layout_theme.cc and html_document.cc), proven by the FW2b fixtures;
     - capture the invalid-name table with a script (scripts/capture-field-avg-char.ts). It probes candidate names as `@font-face` aliases of vendored Lato and records valid or invalid per name.
   - The candidate corpus is the open part:
     - **(a)** every family installed on the reference Mac, the generic names, the Dragon font map names, and case variants. This is clean-room, but it can miss the four `#`-prefixed and the `Apple Li*` names that are no longer installed;
     - **(b)** (a) plus the 34 names, as a reference-only list that the probes confirm;
     - **(c)** no table: refuse natively any field whose first family name is not in a probed valid set. This blocks every author family name, so it is not recommended.
   - Recommended: (b), with a worker who has not read the LGPL files writing FW2b if the Judge wants clean room.
2. **The premise correction.** On Dragon's reference platform (macOS) the average character width is the `x` advance, and the extra width is the ascent. OS/2 xAvgCharWidth and the bounding box are the non-Apple branch. Should FW2 also prove the non-Apple branch for a future Android-matches-Android-Chrome reference, or stay keyed to darwin-arm64 as proposed?
3. **Compressible contributions.** Should FW1 stay conservative (refuse `min-width: auto` flex and grid items, as proposed)? Or should a follow-up (FW3) model css-sizing-3 §5.2.2 in the engine (the min-content contribution of a percentage-width field is zero) and accept a single stretched column, either auto or fr tracks, for grid ancestors in widthSource? The notes title needs FW3 plus grid-control.
4. **`width: stretch`** measured 600, with no intrinsic read. Accept it in FW1, or leave it refused with the other keywords?
5. **The Linux Chrome lane.** Keep non-Ahem fields refused there (proposed), or capture the `#else` branch (xAvgCharWidth and the round(xMax − xMin) bounding box) on the first Linux run?
6. **A face with no `x` glyph** uses the x-height on Apple. Refuse it (proposed), or model and fixture it?
7. **Primary face vs. family name.** The name test reads the first *listed* family, while A and M come from the primary *face*. When the first family has no face (`"No Such Face", Arial` measured as Arial, valid), the name test still reads "No Such Face". Refuse fields whose first family resolves to no face (proposed), or model it?
8. **Fixture faces.** Vendored Lato and Inter carry the proofs. Que Grotesque was measured only as evidence, because its licence for vendoring is unknown. Is that enough for Markless, given that the model reads only the `x` advance and the ascent from the face's own file?
9. **System faces.** SF and PingFang take A from Core Text's untracked `x` advance, which differs from the shaped `x`. This needs its own slice through the system-fonts provider. Leave them refused after FW2 (proposed)?
