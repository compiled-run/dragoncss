# FORM-text-font column flex: a percentage-width text control under a single-line column flex container

Status: Judge APPROVED WITH AMENDMENTS (all applied below, "Judge amendments"); built. Stacked on FORM-text-font (#681, `cw/form-text-font`); the sibling of `FORM-text-font-spec.md`.

## The refusal today

`avgWidthReader` (`computed-checks.ts`) walks from a percentage-width text control up to the first box with a definite width,
and refuses `width-font` (DRAGON_UNSUPPORTED_FONT, iOS and Android) at the first flex container of any kind: "m9 is a flex item
of m0, sized by its content". The notes app's shell is a flex container: `.shell { min-height: 100vh; display: flex;
flex-direction: column }`, holding `<main class="content">` with `width: 100%; max-width: 880px; margin: 0 auto; padding: 20px`.
Every text control on `/`, `/new` and `/notes/[id]/edit` sits under it, so all of them keep the refusal although their own
widths and every other box on the walk are accepted by #681.

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
   A percentage item there measured the same in every face (164.8), but stays refused as a scope choice: no fixture proves
   wrapped lines yet. A length-width item ends #681's walk before it reaches the container, so it is accepted under any flex
   container, which is right (150 in every face).
   `align-content` has no effect on a single line (412 in every face), so the rule does not read it.
4. The automatic minimum size of a column item is on the main axis (its height); it never reached the width in any case above.
5. The container's own width is not decided here: the walk continues to it and applies #681's rules, which already refuse an
   `inline-flex`, floated, absolutely positioned or intrinsic-width container, and a row flex parent of it.
6. Writing mode is always horizontal: `writing-mode` is not a longhand Dragon accepts.

## The slice

`avgWidthReader`, at a flex container ancestor, asks `columnFlexReader(child, child is the control, container)`; the walk
continues only when:
- `flex-direction` is `column` or `column-reverse`, and
- `flex-wrap` is `nowrap`, and
- the child is the control (its own width is a percentage, checked before the walk), or has a percentage width (a length width
  ends the walk one step earlier), or
  has an auto width with `align-self` (or `align-items` through `auto`) `normal` or `stretch` and no `auto` left or right margin.

Otherwise the refusal names the item, the container and the reason: "in a row flex container", "in a flex-wrap: wrap column,
whose lines are sized by their content", "aligned by align-items: center", "with margin-left: auto". `justify-self` is not read
for a flex item (flex layout ignores it). Values are read as computed keywords (`keywordOr`), never parsed from text.

## Proof

- **`controls-text-font-column-flex`** (text-latin group, faces checked in Chrome): the notes shell (`min-height: 100vh`, column
  flex) around `main` (`width: 100%; max-width: 360px; margin: 0 auto; padding: 20px`, so the 400px viewport centres it), the
  search field and a `.form` grid holding the title input and textarea, in Roboto at line-height 1.45; then a column-reverse
  container in Inter at line-height 1 holding a control as its own item and a stretched auto-width item with a search field and a
  title field. Matched against live Chrome captures at DPR 1, 2, 2.625 and 3 (`parity.test.ts`, `dpr.test.ts`).
  It differs from notes as `controls-text-font` does: block `.field` labels (text in a grid item has no declared-face proof yet),
  and a textarea with `resize: none`, no radius and `scrollbar-width: none` (checkTextAreaChrome keeps those refused).
- **Reject fixtures** (`reject-controls-text-font-*`): `flex-row`, `flex-wrap`, `flex-align` (`align-items: center`),
  `flex-margin` (`margin-left: auto`), `inline-flex` (column) and `flex-float` (a floated column).
- **Compile tests** (`form-b-text-field.test.ts`): the notes shape compiles with no `width-font`; column, column-reverse,
  `align-self: stretch`, a percentage item under `align-items: center`, `justify-self: start` and the control as the item
  compile; row, wrap (also with a percentage item), `align-items: flex-start` and `baseline`, `align-self: center`,
  `margin-left: auto`, `inline-flex` and a floated column are refused with their reasons; so are (Judge) `last baseline`,
  `align-self: self-start`, `align-self: stretch` with `margin-right: auto` and `margin-inline-start: auto` (which reaches the
  check as `margin-left`). `safe center` and `anchor-center` are refused earlier, as values the compiler does not take.

## Judge amendments (applied)

1. Rule 3 no longer claims a length item is refused under wrap; the percentage refusal is stated as a scope choice, with 164.8.
2. Compile tests for `safe center`, `anchor-center`, `last baseline`, `self-start`, stretch with `margin-right: auto` and
   `margin-inline-start: auto`, and their rows in the facts table.
3. The `align-content` row.
4. Over-refusals inherited from #681's walk keep their wording here: a floated, `display: table` or inline-block auto-width item
   measured 412 in every face under a column container, so their "sized by its content" refusal is cautious, not measured.
5. The absolutely positioned case, below.

## Outside this slice

- An absolutely positioned box's percentage width resolves against its positioned ancestor's padding box; #681's walk reads DOM
  ancestors instead. This only over-refuses (an auto-width abspos box is refused), but the walk does not follow the containing
  block.

- Row flex items, even the control as a percentage-width row item (412 in every face above): the shrink and automatic-minimum
  rules on the main axis need their own measurements.
- Everything `FORM-text-font-spec.md` lists as outside: textarea editing, `resize`, the rounded scroll container, the scrollbar
  gutter, and reading the face's average width.
- The batch regen writes this fixture's committed captures (DPR 1 and the three DPR sets), emitted CSS, layout vectors, DPR
  vectors, hit capture and native profile rows.
