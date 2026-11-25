# FORM-text-font: a text control in a real face, when its size cannot read the face's average character width

Status: Judge APPROVED WITH AMENDMENTS (all five applied below); built. Base: `cw/notes-batch-6` (#680, 3bd1c18a2b).

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

## Judge amendments, measured (Chrome 145, DPR 1, Roboto and Inter from vendor/fonts, and Ahem, 16px)

1. **Cyclic percentages.** A `width: 100%` field takes its natural width, 197 in Roboto, 217 in Inter and 350 in Ahem, in:
   - a float;
   - an inline-block;
   - a `width: max-content` wrapper;
   - an auto-width absolutely positioned box;
   - a `grid-template-columns: auto auto` grid (244.5 / 254.1 / 284).

   All are refused, each with its own reason (reject fixtures `reject-controls-text-font-{float,inline-block,max-content,absolute,grid-columns}`), as is a flex parent.
2. **`field-sizing` and writing mode.** `field-sizing` other than `fixed` is refused. Vertical writing modes are already refused everywhere: `writing-mode` is not a longhand Dragon accepts.
3. **Line height.** A single-line field's editor is at least the face's ascent + descent tall: at line-height 1 and 0.8 the field is 45 (Roboto), 46 (Inter) and 42 (Ahem), 26 of it padding and border. The engine already gives such a field line-height `normal` (FORM-b, `tf-centre`), which equals ascent + descent for these faces, since neither has a line gap. For a face with a line gap, the engine refuses a line height below ascent + descent (`text-field-line-height`), because there `normal` exceeds the glyphs and Chrome's height is unmeasured. A textarea has no such floor: rows × line-height (58 and 51.59 at 1 and 0.8, in every face).
4. **A second face.** Inter, whose ascent and descent differ from Roboto's (content height 20 against 19), runs in the same fixture at line-height 1.

## The slice (built)

`computed-checks.ts` `avgWidthReader` lifts `width-font` for a text field or textarea when its inline size cannot read the average width:
- `width` is a length or a percentage;
- `min-width` is `auto`, a length or a percentage, and `max-width` is `none`, a length or a percentage;
- `field-sizing` is `fixed`;
- for a percentage, every box from the control up to the first with a length width or the root keeps a width that is independent of its content:
  - a block-level, in-flow, non-floating box with an auto or percentage width;
  - no flex container on the way;
  - a grid container only with one implicit stretching column.

Otherwise the refusal names the box and why. Letter-spacing and text-indent keep their current handling.

## Proof

- **`controls-text-font`** (text-latin group, with each part's face checked in Chrome). It holds the notes title, body and search fields at their real widths (a 362px column) and styles, in Roboto at line-height 1.45 and in Inter at line-height 1, with values and placeholders, ltr. Its Chrome captures at DPR 1, 2, 2.625 and 3 match the engine at every node (`parity.test.ts`, `dpr.test.ts`). Faces are checked through each control's host and, for a textarea, its shadow editor (`font-reference.ts`).
- **The fixture differs from the notes app in two places:**
  - its textarea has `resize: none`, no radius and `scrollbar-width: none`, since `resize`, a rounded scroll container and the scrollbar gutter stay refused (checkTextAreaChrome);
  - its labels are blocks, since text directly in a grid item has no declared-face profile proof yet.
- **Reject fixtures** for the five cyclic cases, plus compile tests (`form-b-text-field.test.ts`) for those, a flex parent, an intrinsic `min-width` and the lifted length and percentage cases.
- **Phones:** a screenshot proof of the placeholder and value baselines in the face is still to run, through a ladder rung on the shared runner, once the native profile rows exist. The native lanes need the batch regen to write the declared-face profile rows for this fixture.

## Outside this slice

- **Editing:** a `<textarea>` stays refused for editing natively; it needs its own textarea editing slice. Host text editing (#645/#646, `textEditing: 'host'`) lifts
  the editing refusal for `<input>` only (`computed-checks.ts`: `!(hostEdits && tag === 'input')`). The notes body textarea
  therefore still needs a textarea editing slice.
- **Textarea chrome:** `resize: vertical`, a rounded scroll container and the scrollbar gutter on the notes textarea stay refused
  (checkTextAreaChrome). These need owner rulings or their own slices.
- **The average width itself:** reading OS/2 xAvgCharWidth from a loaded face. Blink's validity check is in an LGPL file, so
  that would have to be measured, not ported.
