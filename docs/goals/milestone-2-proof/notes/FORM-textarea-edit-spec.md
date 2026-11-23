# FORM-textarea-edit: an editable `<textarea>` when the host edits it

Status: approved with amendments by the Judge (folded in below), and built. Branch `cw/form-textarea-edit`, built on batch 6
(`cw/notes-batch-6` 3bd1c18a2b).

**What this proves, and what it doesn't.** The Chrome facts show that an editable textarea lays out as a readonly one in
Chrome. They say nothing about whether `UITextView` or `EditText` wraps a value the way Dragon does. This slice proves two
things:
- the compile gate (an editable textarea compiles under host editing, and what the host view can't match is refused);
- the facts Dragon exports for the host view.

Wrap parity on the phones is delegated to the phone rung on the Markless side (R2), and is not claimed here.

## Why

The Markless notes form (`packages/mobile/apps/notes/lib/NoteForm.tsrx` in Markless) has an editable body field,
`<textarea name="body" rows="8">`. #645 lets a Markless export lay out an editable single-line text field when the host
edits it (`compileNativeStyles({ textEditing: 'host' })`, `InternalOptions.hostTextEditing`). Today `checkTextField`
(`packages/dragon/src/analysis/computed-checks.ts`) still refuses an editable textarea on iOS and Android, because the
host-editing exemption is for `tag === 'input'` only:

> `<textarea> … is an editable text control: Dragon draws its value but has no caret, selection or keyboard input on iOS and Android yet (the FORM-b editing slice)`

This slice extends #645's split to the textarea. It changes nothing else about the textarea (#631/#640's layout).

## Chrome 145 facts

All of these come from the pinned Chrome 145 headless shell (`launchChrome`) at DPR 1, 2, 2.625 and 3. The page is an
Ahem 10px textarea, 120px wide, 46px high, `padding: 4px`, a 1px border, `line-height: 12px`, `resize: none` and
`scrollbar-width: none`. Each case was loaded twice, once with `readonly` and once without:

| # | Fact | Evidence |
|---|------|----------|
| E1 | Readonly and editable textareas lay out the same. The border box and the scroll extent are equal for an empty value, a one-line value, a value that fits, and a value that overflows (95 characters with hard line breaks; scroll height 104 against a client height of 54). | Every case at every DPR has the same box; at DPR 2.625 the box is 129.52×55.52 for both. |
| E2 | When not focused, the two draw the same pixels. That holds with the placeholder showing and with an overflowing value. | Screenshots are byte-identical at every DPR. |
| E3 | Typing never moves the textarea's box. Typing the overflowing value gives the same scroll height as the same value set readonly (104), so the value wraps the same way whether typed or set. | `boxStill` is true and the scroll heights are equal at every DPR. |
| E4 | While typing, the editor scrolls to keep the caret in view. After typing, scrollTop is 46 (45.5 at DPR 2, 45.71 at DPR 2.625). | `afterType.scroll[2]`. |
| E5 | When the field loses focus, its scroll offset stays where editing left it, so it no longer returns to 0. Typing 87 characters and then blurring leaves scrollTop at 10 (9.5 at DPR 2, 9.90 at DPR 2.625). | `blurred.scroll[2]`. |
| E6 | The placeholder hides as soon as the value is non-empty, whether typed or set. | `:placeholder-shown` |
| E7 | A tap or click gives a textarea both `:focus` and `:focus-visible`, as on a keyboard-input `<input>`. After blur, it has neither. | `tap fv true`; `blurred fv false`. Dragon's pointer focus (`pointerFocusVisible`) already lists `textarea`. |

The facts follow from html.css and HTML §4.10.11. A textarea's `readonly` attribute changes neither its style nor its
UA shadow tree: Chrome's `html_text_area_element.cc` builds the same inner editor either way. That file is LGPL, so it
is cited as a reference only and nothing is ported from it. Editing changes only the value and the inner editor's
scroll offset.

## The split, as in #645

**Dragon lays out**, as it does for a readonly textarea (#631/#640):
- the textarea box, with its padding and border;
- `<id>::editor`, holding the value wrapped as `white-space: pre-wrap` at the editor's width;
- `<id>::placeholder`, while the value is empty.

The value is the element's text, fixed or set by state.

**R1, the host contract (Judge amendment 1).** The host puts its native multi-line text view (`UITextView` or
`EditText`) over the textarea's **padding box**, its scrollport, not over `::editor`. The device layout exports the frame
and the line facts for every textarea, so the host reads them from Dragon's layout rather than working them out. The
entry is tagged `["text-editors", [[id, [x, y, width, height], [top, right, bottom, left], scrollMaxY, lineHeight, baseline]]]`
(`packages/translate/harness/harness.ts` `textEditorsJson`), in the frames' device px. Each field:
- `[x, y, width, height]`: the scrollport, which is the border box less its device-snapped borders, measured from the
  border box's corner;
- `[top, right, bottom, left]`: the padding. The host sets its text insets to these (`textContainerInset` on iOS, the
  view's padding on Android) and sets `lineFragmentPadding` to 0;
- `scrollMaxY`: how far the content scrolls down. That is the top padding, plus the editor's height, plus the bottom
  padding, less the scrollport's height, or 0 when the content fits. It matches Chrome's `scrollHeight - clientHeight`,
  which includes the bottom padding. Dragon's scroll ranges refuse a textarea, whose at-rest scrolling waits for
  FORM-b2, so the extent is taken from the laid-out editor;
- `lineHeight` and `baseline`: the editor's line height, and the baseline measured from the line's top. The baseline is
  the ascent plus the half-leading (`inline.ts` `metricsOf`, Blink's floored half-leading).

**R2, one takeover rule (Judge amendment 2).** Under host editing, the host draws the value from the first frame, and
nothing draws the `::editor` text under it. The export still carries the editor's text and lines, but only as Dragon's
at-rest layout, for comparison. Dragon's own native emitter never compiles with `hostTextEditing`, so it never draws an
editor's text that a host also draws.

The phone rung must show two screenshots that are identical:
- the page before focus;
- the page after tapping the field, with nothing typed and the focus ring and caret masked.

It must also show both against Chrome's screenshot of the same page. Until that rung runs, native wrap parity is unproven.

**R3, line-height on each platform (Judge amendment 3).** The host turns the exported `lineHeight` and `baseline` into
platform settings as follows:
- **iOS:** set `NSParagraphStyle.minimumLineHeight` and `maximumLineHeight` to `lineHeight`. Set `baselineOffset` so the
  glyph baseline sits `baseline` px below the line's top. UIKit puts the baseline at `lineHeight − |descender|` once the
  line height is fixed, so `baselineOffset = (lineHeight − |descender|) − baseline`, using the face's descender from
  `UIFont`.
- **Android:** set `includeFontPadding = false` and `setLineHeight(lineHeight)`. That API spreads the extra leading
  evenly around the font's ascent and descent. The host checks the resulting first baseline against `baseline`, and
  where the face's metrics make them differ, it adds the difference to the top inset.

These are host facts, and the phone rung is where they are proven.

**What follows from E1 to E5:**
- **Nothing moves:** no box moves on input (E3), and Dragon re-runs no layout.
- **Scroll offset:** after an edit, the scroll offset is the host's (E5), as it is in Chrome.
- **Placeholder:** the host hides it while its value is non-empty (E6).
- **Focus styles:** these resolve from Dragon's interaction states as the host reports focus (E7).

**A value that ends in a line break.** Blink's inner editor ends such a value with a placeholder `<br>`, so the empty
last line counts as a line. Chrome lays out `"XX XXX\n"` two lines tall. Dragon's resolve (`resolve.ts`) now gives the
editor's text the same extra line, for readonly and editable textareas alike. No committed fixture has such a value.

## The slice

In `checkTextField`, lift the editing refusal for `<textarea>` when `hostEdits` is true, as #645 does for `<input>`.

**R4 (Judge amendment 4): refused natively on a host-edited textarea**, in `computed-checks.ts`
`checkHostEditedTextArea`:
- `letter-spacing` and `word-spacing` other than `normal` or `0`;
- `text-indent` other than `0`;
- `text-align: justify`;
- `direction: rtl`;
- padding that isn't a length, because the exported insets are resolved lengths.

**Refused by existing checks before this one** (each pinned by the test):
- the `dir` attribute, `auto` included, and the `wrap` attribute, which the attribute table refuses on every element;
- a tab in the value, which is refused for every preserved white space because tab stops aren't laid out yet.

A readonly textarea is still Dragon's to draw, so the R4 refusals don't apply to it.

**Every other textarea refusal stays:**
- `resize` other than `none`, which `checkResize` refuses. Chrome draws a grip, which needs the owner's ruling.
- A scrollbar gutter (`checkTextAreaChrome`), which needs the owner's ruling.
- Rounded corners on a scrolling box (`checkRoundedScrollContainer`), which needs the owner's ruling.
- `overflow: visible`, an element child, `field-sizing: content`, and position or float.
- A non-Ahem face (FORM-text-font, #681).

**Host contract, not pixel claims:** the host honours `spellcheck`, `autocapitalize`, `autocorrect`, `inputmode` and
`enterkeyhint` natively. Spellcheck squiggles, like the caret, fall outside the parity claim.

**The Markless export:** a textarea's text node is its value, which the export carries as the text of `<id>::editor`.
`markless-style-input.ts` therefore no longer requires a node of its own for that text.

With batch 6, the notes body field still compiles only after the owner's rulings on `resize: vertical` and its rounded
scrolling corners, or after app changes. This slice removes the editing refusal only.

## Proof

**Run here** (`packages/parity/test/form-textarea-edit.test.ts`, against the pinned Chrome 145 with the vendored Ahem
face, at DPR 1, 2, 2.625 and 3):
1. **E1 to E3 and E7.** For six values, Chrome's box, client and scroll sizes, padding, line height and unfocused pixels
   are equal between readonly and editable. Typing a value moves no box, gives the same scroll height as setting it,
   and hides the placeholder. A click gives the field `:focus-visible`.
2. **R5 (Judge amendment 5), Dragon against Chrome.** Each of the six values compiles editable under host editing, and
   the engine's `::editor` height equals Chrome's scroll height less the block padding. The values are:
   - a hard newline;
   - a trailing newline (an empty last line);
   - consecutive and trailing spaces at a wrap point;
   - a long unbroken word (`overflow-wrap: break-word` from html.css);
   - a CRLF;
   - a long value with an empty line.

   Emoji are excluded, because no face here holds them.
3. **R1.** Through the Markless export, at every density the plan measures, the device layout's `text-editors` facts
   for those six textareas equal Chrome's. The scrollport is checked against the border box less the borders, the
   insets against the computed padding, `scrollMaxY` against `scrollHeight - clientHeight`, and the line height against
   the computed `line-height`. All are compared to 1e-4 px, because Chrome reports a fractional ratio through float32
   rects and 6-digit computed styles.
4. **R4.** An editable textarea compiles under host editing and is refused without it. Each refused style and attribute
   has its own case, and a readonly textarea takes none of the R4 refusals.

**For the phone rung (Markless side):** the same six values, at the same four ratios. It must show the R2 screenshots,
and a typing step after which every other box is unchanged.

## Allowed files (Judge amendment 6)

- `packages/dragon/src/analysis/computed-checks.ts` (the lifted refusal and `checkHostEditedTextArea`)
- `packages/dragon/src/analysis/resolve.ts` (the trailing line break)
- `packages/translate/harness/harness.ts` (`textEditorsJson`) and the translated harnesses it regenerates under
  `packages/layout/generated/`
- `packages/parity/src/markless-style-input.ts` (a textarea's text is its editor's)
- `packages/parity/test/form-textarea-edit.test.ts` (new) and `packages/parity/test/form-b-text-field.test.ts` (the old
  "still refuses a textarea" case, now the host-editing case)
- `docs/markless-native-styles.md` and this spec

## Out of scope

- Drawing a caret, selection or spellcheck UI in Dragon.
- Scrolling an overflowing textarea before the first edit. This stays FORM-b2, as it is today.
- `resize`, the scrollbar gutter and the rounded scroll clip, which wait for the owner's rulings.
- Right-to-left editing. Not measured here; a right-to-left editable textarea stays refused until measured.
