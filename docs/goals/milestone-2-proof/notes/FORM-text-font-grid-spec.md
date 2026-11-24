# FORM-text-font grid: a percentage-width text control in notes' form grid and label grid

Status: Judge APPROVED (after REJECTING the first draft for two measured defects, both fixed below, "Judge findings", with tests); built. Base: `cw/form-text-font-column-flex-665` (#688), on #665's field-width guard (`checkFieldWidth`,
`widthSource`, `contentSizedAncestor`). The sibling of `FORM-text-font-spec.md` and `FORM-text-font-column-flex-spec.md`.

## The refusal today

Notes' NoteForm is `form.form { display: grid; gap: 18px; padding: 20px }` > `label.field { display: grid; gap: 6px }` > the label
text ("Title", "Note", an anonymous grid item) and `<input>` / `<textarea>` with `width: 100%` (textarea `min-height: 180px`).
Neither grid has a column template, areas or placement: each is one auto-placed implicit `auto` column (`singleStretchColumn`).
`.meta`, a third grid that is `1fr 1fr` at 700px and wider, holds the tag select and the pin checkbox, not a text field, so it is not
on these fields' walk. On iOS and Android #665 refuses:
- the title input (m14) and textarea (m17): "a grid item with min-width: auto, whose automatic minimum Chrome takes from the
  field's intrinsic width" (`checkFieldWidth`);
- the walk through their labels m12 and m15: "takes its width from its content (a grid item)" (`widthSource` returns that for
  every auto-width grid item).

## Chrome 145 facts (measured)

Pinned Chrome 145.0.7632.6 (`launchChrome`), a 412px viewport, `box-sizing: border-box`, 16px, line-height 1.45, the face loaded
with `@font-face` from vendor/fonts. Widths in px, at DPR 1 and 2.625 (DPR 2.625 rounds to its device-pixel grid):

| case | Roboto | Inter | Ahem |
| --- | --- | --- | --- |
| notes form > label > input, textarea, page 362px (input / textarea / label) | 320 / 320 / 320 | 320 | 320 |
| the same, page 120px | 78 | 78 | 80 |
| the same, page 60px or 30px | 34.27 | 36.06 | 80 |
| input `width: 100%` as the grid item, grid 362px / 40px | 362 / 40 | 362 / 40 | 362 / 40 |
| input `width: 300px` as the grid item, grid 40px | 300 | 300 | 300 |
| auto-width block item > input, grid 300px / 40px | 300 / 40 | 300 / 40 | 300 / 40 |
| grid 40px > column flex item > input `width: 100%` | 40 | 40 | 40 |
| grid 40px > row flex item > input `width: 100%; min-width: 0` | 40 | 40 | 40 |
| grid 40px > row flex item > input `flex: 0 0 80px; min-width: 10px` | 80 | 80 | 80 |
| grid 300px > label with an unbreakable 37-letter word > input | 300 | 310.1 | 592 |
| input `min-width: 200px` in a 60px grid | 200 | 200 | 200 |
| **`grid-template-columns: auto auto`**, block item > input | **237.5** | **247.5** | **300** |
| **item `justify-self: start`**, or grid `justify-items: start` | **175** | **195** | **300** |
| **item `margin-left: auto`** | **175** | **195** | **300** |
| **grid `justify-content: start`** | **175** | **195** | **300** |
| **item `width: max-content`** | **175** | **195** | **328** |
| **grid 40px > row flex item > input `flex: 1 1 0; min-width: 0`** (width auto) | **175** | **195** | **328** |
| **the same in a 300px grid** | 300 | 300 | **328** |
| the field itself as the grid item, `justify-self: start` or `baseline`, or `margin-left: auto`, 40px grid (Judge) | 40 | 40 | 40 |
| **label and a sibling both `grid-row: 1`** (or `grid-area: 1 / auto`), 300px grid (Judge) | **232.48** | **242.03** | **284** |

What follows (css-grid-2 §12.4-12.8, css-sizing-3 §5.2.2):
1. A single implicit `auto` column ends at max(its base size, the grid's content box): §12.6 grows it toward its growth limit
   and §12.8 stretches it the rest of the way, so its growth limit (the items' max-content contributions) never decides its size.
2. Its base size is the items' min-content contributions. A percentage-width text control's is its border and padding
   (compressible); a length width's is the length. Neither reads the face (the 40px rows above).
3. Text in the label (its caption) contributes its own min-content width in its own face, which Dragon shapes and measures like
   any text. When it is wider than the grid it widens the column (34.27 / 36.06 / 80 at 60px, the captions "Title" and "Note"),
   but it never reads the control's average character width.
4. A field whose min-content contribution is its intrinsic width still widens the column: an auto-width field with a flexible
   zero basis in a row flex item (175 / 195 / 328, even in a 300px grid in Ahem). #665 accepts that field elsewhere
   (`basisSized`), so under a grid item it must stay refused.
5. An item locked to a row (`grid-row`, `grid-area`), also through a `display: contents` child or a `::before`, puts a second
   item beside it in a new implicit column, sized by content; so `singleStretchColumn` requires every item, looking through
   `display: contents`, to have auto row and column placement.
6. An item that does not stretch (`justify-self` or `justify-items` other than normal, stretch or legacy, or an auto inline
   margin), or a grid whose column is not its whole content box (a template, `justify-content: start`), sizes by content.

## The slice

Compiler (`computed-checks.ts`):
- `widthSource(box, parent, compressed)` and `contentSizedAncestor(chain, compressed)` take whether the field compresses (a
  percentage width). With `compressed`, an auto- or percentage-width grid item of a `singleStretchColumn` grid that stretches
  inline (`stretchesInline`) and has no auto inline margin passes the walk; otherwise the refusal names the reason: "a grid item in
  a grid whose column is not its whole content box", "a grid item with justify-self: start" (or "auto (justify-items: X)"), "a grid
  item with margin-left: auto". Without `compressed` (a row flex basis, `basisSized`, a select), every auto-width grid item stays
  "a grid item", as before.
- `checkFieldWidth`: a percentage-width field that is itself a grid item of a `singleStretchColumn` grid is not refused for
  `min-width: auto`.

Engine (`packages/layout/src/grid.ts`): the engine's track sizing read every item's max-content contribution for the growth
limits, and a text field's max-content size in an unmeasured face is its tripwire (`text-field-avg-char`). `growthLimitsUnused`
skips the two maximum steps of §12.5 (intrinsic-maximums, max-content-maximums) where no growth limit can change a used column
size, with no flexible tracks and neither maximize nor stretch fault planted:
- a min-content sizing whose intrinsic items each span one track: there is one span group, its maximums run last, and
  min-content leaves no free space to maximize or stretch into;
- one stretched `auto` column with a definite available inline size, which ends at max(base size, free space) by 1 above.
With items spanning several tracks, a later span group's minimum steps read the growth limits an earlier group's maximums set
(growth potential, the beyond-limit choice, the sort), so the skip does not apply there: three auto columns at min-content,
`X X` in column 1 and two 15-letter Ahem words spanning 1/3 and 2/4 at 10px, are 225px in Chrome (30 / 120 / 75) and in the
engine, and 230px if the skip applied (pinned by a compile-and-layout test). The parity suite, the DPR suite, the layout and
translate package tests fail exactly the same tests as the base; the Judge's grid corpus run gives 17700 matches, 0
mismatches.

## Proof

- **`controls-text-font-grid`** (text-latin group, faces checked in Chrome): notes' form grid > label grid > title input and
  textarea at 362px in Roboto; the same at 60px in Inter at line-height 1, where the captions widen the column; and an input as
  the grid item itself in Inter. Captions are in Ahem, because text directly in a grid item has no declared-face proof yet (it is
  unproven context on web); the textarea has `resize: none` and `scrollbar-width: none` as in `controls-text-font`. Matched
  against live Chrome captures at DPR 1, 2, 2.625 and 3 (`parity.test.ts`, `dpr.test.ts`).
- **Reject fixtures:** `reject-controls-text-font-grid-item-start`, `-grid-items-start`, `-grid-item-margin`,
  `-grid-flex-basis`; #665's `grid-columns`, `grid-start`, `grid-auto-columns`, `grid-areas`, `grid-flow-column`,
  `grid-column-2` and `grid-min0` stay refused.
- **Compile tests** (FW1 tables, `form-b-text-field.test.ts`): accepted, and the engine lays out the iOS projection with the
  tripwire armed: the notes form shape, a 40px form, the field as the grid item, a column flex item in a 40px grid. Refused, and
  with `fieldWidthAnyContext` the engine throws `text-field-avg-char` at the field: `justify-self: start`, `justify-items: center`,
  `margin-right: auto`, two auto columns, `justify-content: start`, and the zero-basis row flex field in a grid item.

## Judge findings (first draft REJECTED; fixed)

1. High, the engine skip: its min-content arm changed results with spanning items (230 against Chrome's 225px). Now it applies
   only when every intrinsic item spans one track; a test pins 225px, and fails with the old arm.
2. High, `singleStretchColumn` missed row-locked items, `display: contents` children and a `::before` with `grid-row`, which add a
   content-sized column (232.48 / 242.03 / 284). It now requires auto row and column placement on every item, through
   `display: contents`. Refused rows in the FW1 table (row-locked label and sibling, `display: contents` > `grid-column: 2`,
   `::before` with `grid-row: 1`) and a reject page `reject-controls-text-font-grid-row-locked`. This gap was already open in
   #665 for a field that is the grid item with `min-width: 0`; it is closed for that case too.
3. Medium (the refusal list's gaps): as 2.
4. Low: the rows for the field itself with `justify-self` start or baseline and `margin-left: auto` are in the table.
5. Low, planted grid faults in the skipped steps: the skip is off under `maximizeIgnoresLimit` and `stretchIgnoresAlignment`;
   the layout package tests, which include the planted grid faults, fail the same tests as the base.

## Outside this slice

- Text directly in a grid item in a declared face (notes' label text) on web is unproven context; that is a text slice.
- The textarea's `resize`, rounded scroll container, scrollbar gutter and editing stay refused (FORM-text-font-spec.md).
- A length-width field as a grid item with `min-width: auto`, and grids with templates: measured face-independent for a length
  width, but kept refused (no fixture).
- The batch regen writes this fixture's captures, emitted CSS, vectors, hit capture and native profile rows, and retranslates
  the Kotlin and Swift engines for the `grid.ts` change (native-gen).
