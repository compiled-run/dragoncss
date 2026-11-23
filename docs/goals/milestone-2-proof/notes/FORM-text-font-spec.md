# FORM-text-font: a text control in a real face, when its size cannot read the face's average character width

Status: spec, awaiting the Judge. Base: `cw/notes-batch-6` (#680, 3bd1c18a2b).

## The refusal today

`computed-checks.ts` (checkTextControl) refuses every `<input>` text field and `<textarea>` whose first `font-family` is not Ahem,
on iOS and Android (`width-font`, DRAGON_UNSUPPORTED_FONT): "Chrome sizes a text control by the face's average character width,
which Dragon proves only for Ahem". The engine uses the advance of 0 as the average width (`controls.ts` textFieldInlineSize,
textAreaInlineSize), equal to Chrome's only when the face is Ahem. This refuses the notes app's title field, body textarea and
search field (Que Grotesque, a bundled web font) on `/new`, `/edit` and `/`.

## Chrome 145 facts (measured, DPR 1, Que Grotesque Regular from the notes app vs Ahem, 16px, line-height 1.45)

The page: the notes field CSS (`.field` a single-column grid; `input`/`textarea` `width: 100%`, padding 12px 14px, 1px border;
textarea `min-height: 180px`), the search field (`width: 100%`, padding 12px 16px, border-box), each in a wrapper of width W, plus
a field in a `width: min-content` wrapper, plus bare controls with no author width. Border-box rects (width × height):

| case | Que Grotesque | Ahem |
| --- | --- | --- |
| input `width: 100%`, W = 362 / 200 / 120 | 392 / 230 / 150 × 49.19 | the same |
| textarea `width: 100%`, W = 362 / 200 / 120 | 392 / 230 / 150 × 206 | the same |
| search `width: 100%` (border-box), W = 362 / 200 / 120 / 60 | 362 / 200 / 120 / 60 × 49.19 | the same |
| input `width: 100%` in a `width: min-content` wrapper | 60 × 49.19 | the same |
| input, no author width (size 20) | **174** × 29.19 | **328** × 29.19 |
| textarea, no author width (cols 20, rows 2) | **185** × 52.38 | **342** × 52.38 |

At W = 60 the `.field` input is 90 (Que) vs 110 (Ahem) wide: the single auto track is sized by the label text ("Title" in
Ahem at 16px is 80px), not by the control. The control itself never widened the track, though its no-width size (174 in Que)
exceeds 60.

What follows:
1. **Percentage width:** the used inline size is the percentage of the containing block. The min-content contribution is the
   padding and border alone in both faces: the `min-content` wrapper case is identical. A text control is compressible
   (css-sizing-3 §5.2.2), and this matches the engine's existing compressed min-content (`grid.ts`, `intrinsic.ts`).
2. **Automatic minimum size:** with `min-width: auto` as a grid item, the control's own no-width size never enters the track.
   At W = 60 Que's 174 would have widened it, and didn't. So a percentage-width control's layout does not read the average width.
3. **Definite length width:** reads nothing from the face, by CSS sizing; the engine already takes it as is.
4. **Block size** with a numeric or length `line-height` is rows × line-height plus padding and border, the same in both faces
   (52.38 and 49.19 above). The text's baseline in the line comes from the face's ascent and descent, which Dragon already
   takes from its loaded fonts for ordinary text in that face.
5. **No author width** (or a `width` keyword `auto`, `min-content`, `max-content` or `fit-content`, or shrink-to-fit sizing) reads
   the average width: 174 against 328. This stays refused.

## The slice

Lift `width-font` for a text field or textarea in a face Dragon loads, only when the control's inline size cannot read the
average character width:
- its `width` is a definite length, or a percentage;
- its `min-width` is `auto` (fact 2), a length or a percentage, and its `max-width` is `none`, a length or a percentage, with no
  intrinsic keyword on any of the three;
- it is not a flex item whose `flex-basis` is `content`, or `auto` with an intrinsic width;
- its `line-height` is a number or a length. `normal` stays refused until the field's normal line height is measured in real
  faces.

Everything else keeps the refusal, with the message naming which size reads the average width. The search field's cancel box
(#645/#666) is unaffected: its side is font size × DPR (FORM-search), not the average width.

## Proof plan

- A parity fixture `controls-text-font`: the notes field and search CSS in a bundled real face, at three widths, plus a
  `min-content` wrapper. Chrome layout captures at DPR 1, 2, 2.625 and 3 must equal the engine's boxes, in ltr and rtl. The
  fixture registers the face the way existing web-font fixtures do.
- A reject fixture: the same face with no author width, with `width: fit-content`, and with `line-height: normal`, each refused
  with its named reason.
- A unit test pinning that the lifted case compiles and the intrinsic cases refuse.

## Outside this slice

- **Editing:** a `<textarea>` stays refused for editing natively. Host text editing (#645/#646, `textEditing: 'host'`) lifts
  the editing refusal for `<input>` only (`computed-checks.ts`: `!(hostEdits && tag === 'input')`). The notes body textarea
  therefore still needs a textarea editing slice.
- **Textarea chrome:** `resize: vertical`, a rounded scroll container and the scrollbar gutter on the notes textarea stay refused
  (checkTextAreaChrome). These need owner rulings or their own slices.
- **The average width itself:** reading OS/2 xAvgCharWidth from a loaded face. Blink's validity check is in an LGPL file, so
  that would have to be measured, not ported.
