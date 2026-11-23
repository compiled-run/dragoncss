# FORM-text-font column flex: a percentage-width text control under a single-line column flex container

Status: Judge APPROVED WITH AMENDMENTS (all applied below, "Judge amendments"); built. First written for #681's `avgWidthReader`
(#685, closed when #681 was rebuilt); now on #665's field-width guard (`checkFieldWidth`, `widthSource`), base
`cw/form-text-font-665` (7f6ceafd1d). The sibling of `FORM-text-font-spec.md`.

## The refusal today

On #665's guard, `widthSource` already lets a percentage width pass through a stretched auto-width column flex item, and refuses
a non-stretched one or one in a wrapping column. Two gaps remain for column flex:
- `checkFieldWidth` refuses a field that is itself a column flex item with `min-width: auto` ("a flex item with min-width: auto,
  whose automatic minimum Chrome takes from the field's intrinsic width"), but a column item's automatic minimum is its height.
- An auto-width item with an auto inline margin is refused as "a column flex item with align-self: normal", naming the wrong
  cause, and an alignment set on the container is named as `align-self` (now `align-items`, as `form-b-select.test.ts` pins).

## Chrome 145 facts (measured)

Pinned Chrome 145.0.7632.6 through `launchChrome` (packages/parity/src/chrome.ts), DPR 1, a 412 × 800 viewport, `box-sizing:
border-box`, 16px, line-height 1.45, an `<input value="Hg">` with `width: 100%` (except where the case says), the face loaded
with `@font-face` from vendor/fonts. Each wrapper `.c` is a block-level child of body; `.i` is an auto-width block item.
Border-box widths in px:

| case | Roboto | Inter | Ahem |
| --- | --- | --- | --- |
| notes shape: `.shell` column flex > `main` (`width: 100%; max-width: 880px; margin: 0 auto; padding: 20px`) > search, and `.form` grid > `.field` grid > input and textarea | 372 (all three) | 372 | 372 |
| column, auto-width item (stretched by `align-items: normal`) | 412 | 412 | 412 |
| column-reverse, auto-width item | 412 | 412 | 412 |
| column, the control itself is the item | 412 | 412 | 412 |
| column, `align-items: center`, the control itself is the item | 412 | 412 | 412 |
| column, `align-items: center`, item `width: 50%` | 206 | 206 | 206 |
| column, `align-items: start`, item `width: 300px` | 300 | 300 | 300 |
| column, item `width: 100%; max-width: 300px; margin: 0 auto` | 300 | 300 | 300 |
| column, `align-items: center`, item `align-self: stretch` | 412 | 412 | 412 |
| column, item `justify-self: start` (ignored in flex layout) | 412 | 412 | 412 |
| column, two items not fitting a 60px height, no wrap | 412 | 412 | 412 |
| **row**, auto-width item | **175** | **195** | **328** |
| **column, `flex-wrap: wrap`, two lines** (60px tall, two 50px items) | **206** | **206** | **328** |
| column, `flex-wrap: wrap`, two lines, item `width: 40%` | 164.8 | 164.8 | 164.8 |
| column, `flex-wrap: wrap` or `wrap-reverse`, one line | 412 | 412 | 412 |
| **column, `align-items`: `start`, `flex-start`, `center`, `flex-end` or `baseline`**, auto-width item | **175** | **195** | **328** |
| **column, item `align-self: start`** | **175** | **195** | **328** |
| **column, item `margin-left: auto`**, or `margin: 0 auto` | **175** | **195** | **328** |
| **`inline-flex` column**, auto width | **175** | **195** | **328** |
| **column container `float: left`** | **175** | **195** | **328** |
| **column container as a row flex item** | **175** | **195** | **328** |
| **column, `align-items`: `safe center`, `anchor-center`, `self-start` or `last baseline`** (Judge) | **175** | **195** | **328** |
| **column, item `align-self: stretch; margin-right: auto`** (Judge) | **175** | **195** | **328** |
| **column, item `margin-inline-start: auto`** (Judge) | **175** | **195** | **328** |
| column, single line, `align-content` center, flex-start or space-between (Judge) | 412 | 412 | 412 |
| column, container `height: max-content`, a grid item, or `direction: rtl` (Judge) | 412 | 412 | 412 |
| column, `display: contents` between container and item (Judge) | 412 | 412 | 412 |
| column, item 150px wide in a two-line wrapping column (Judge) | 150 | 150 | 150 |

(A row flex item that is the control itself with `width: 100%` measured 412 in all three faces; rows stay refused here, as the
brief scopes this slice to columns.)

What follows (css-flexbox-1 §9.4, steps 8 and 11):
1. In a **single-line** column container, the flex line's cross size is the container's inner width when that is definite
   (step 8). An item with a length or percentage width resolves it against that width, whatever its alignment or margins.
2. An item with an **auto width** fills the line only when it stretches (step 11): `align-self: stretch`, or `auto` with the
   container's `align-items` `normal` or `stretch`, and neither inline margin `auto`. Any other alignment, or an auto margin,
   sizes it fit-content, which reads the control's no-width size (175 / 195 / 328).
3. A **multi-line** container sizes each line by its items' contributions before `align-content` spreads the free space, so a
   stretched auto-width item's width reads the control's size once there are two lines (206 / 206 / 328). The compiler cannot
   count lines (they depend on the main size), so an auto-width item under `flex-wrap` other than `nowrap` stays refused.
   A percentage item there measured the same in every face (164.8), and #665's guard accepts it (`step` keeps a percentage). A length-width item is `fixed` in `widthSource`, so the walk stops before the container, so it is accepted under any flex
   container, which is right (150 in every face).
   `align-content` has no effect on a single line (412 in every face), so the rule does not read it.
4. The automatic minimum size of a column item is on the main axis (its height); it never reached the width in any case above.
5. The container's own width is not decided here: `contentSizedAncestor` continues to it, and `widthSource` refuses an
   `inline-flex`, floated, absolutely positioned or intrinsic-width container, and a row flex parent of it.
6. Writing mode is always horizontal: `writing-mode` is not a longhand Dragon accepts.


## The slice

- `checkFieldWidth`: the `min-width: auto` refusal applies to a row flex item and a grid item, not to a column flex item (Chrome:
  the control as a column item with `width: 100%` is 412 in every face, under `align-items` normal or center).
- `widthSource`, column flex branch: an auto-width item that would stretch but has an auto inline margin is refused as "a column
  flex item with margin-left: auto and an auto width" (or `margin-right`). Everything else in the branch is #665's: stretched
  under `nowrap` passes (`parent`), stretched under wrap is refused ("a stretched column flex item in a flex-wrap: wrap
  container"), any other alignment is refused ("a column flex item with align-items: center and an auto width", naming
  `align-self` instead when the item sets it). Values are computed keywords (`keywordOf`); a multi-token value reads as `''` and
  is refused.

## Proof

- **`controls-text-font-column-flex`** (text-latin group, faces checked in Chrome): the notes shell (`min-height: 100vh`, column
  flex) around `main` (`width: 100%; max-width: 360px; margin: 0 auto; padding: 20px`, so the 400px viewport centres it), the
  search field and a `.form` box holding the title input and textarea, in Roboto at line-height 1.45; then a column-reverse
  container in Inter at line-height 1 holding a control as its own item (`min-width: auto`) and a stretched auto-width item with
  a search field and a title field. Matched against live Chrome captures at DPR 1, 2, 2.625 and 3 (`parity.test.ts`,
  `dpr.test.ts`). It differs from notes: `.form` and `.field` are blocks (on #665 an auto-width grid item is refused as "a grid
  item", and a field that is a grid item needs `min-width` set; both are outside this slice), and the textarea has `resize: none`,
  no radius and `scrollbar-width: none` (checkTextAreaChrome keeps those refused).
- **Reject fixtures** (`reject-controls-text-font-*`, #665's wording): `flex-row`, `flex-wrap`, `flex-align`
  (`align-items: center`), `flex-margin` (`margin-left: auto`), `inline-flex` (column) and `flex-float` (a floated column).
- **Compile tests** (`form-b-text-field.test.ts`, FW1's accepted and refused tables, which also lay out the iOS projection, and
  with `fieldWidthAnyContext` expect the engine to throw `text-field-avg-char` for each refused shape): accepted, the control as a
  column item with `min-width: auto` (also under `align-items: center`), a column-reverse stretched item, `align-self: stretch`
  under `align-items: center`, and the notes shell shape; refused, a row item, a wrapping column, `align-items: center`,
  `margin-left: auto`, `align-self: self-start`, `margin-inline-start: auto` (read as `margin-left`), `align-self: stretch` with
  `margin-inline-end: auto` (read as `margin-right`), and an `inline-flex` column.

## Judge amendments (applied)

1. Rule 3 no longer claims a length item is refused under wrap.
2. Compile tests for `self-start`, stretch with `margin-inline-end: auto` and `margin-inline-start: auto`, and their rows in the
   facts table (on #665 they reach `widthSource`'s non-stretch and margin cases). `last baseline` is refused by the native
   lowering of a flex container (no layout mapping), and `safe center` and `anchor-center` earlier still, as values the
   compiler does not take.
3. The `align-content` row.
4. Over-refusals inherited from the guard keep their wording: a floated, `display: table` or inline-block auto-width item
   measured 412 in every face under a column container.
5. The absolutely positioned case, below.

## Outside this slice

- An absolutely positioned box's percentage width resolves against its positioned ancestor's padding box; the guard reads DOM
  ancestors instead. This only over-refuses.
- Grid, which the notes form needs: `widthSource` refuses every auto-width grid item ("a grid item"), even in a grid whose one
  column is its content box (`singleStretchColumn`), and `checkFieldWidth` refuses a field that is a grid item with
  `min-width: auto`. Chrome measured both notes shapes at 372 in every face (and #681 measured the min-content case), so both
  over-refuse; lifting them is a grid slice.
- Row flex items, even the control as a percentage-width row item (412 in every face above).
- Everything `FORM-text-font-spec.md` lists as outside: textarea editing, `resize`, the rounded scroll container, the scrollbar
  gutter, and reading the face's average width.
- The batch regen writes this fixture's committed captures (DPR 1 and the three DPR sets), emitted CSS, layout vectors, DPR
  vectors, hit capture and native profile rows.
