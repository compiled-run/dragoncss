# T154: user-select on native, in slices

user-select is the largest unowned row: 67.9% usage, and only `none` compiles on iOS and Android. Native text is not selectable at
all until P6c (T077) builds selection, so this note splits the work into what can be proven now and what waits for P6c.

## Where native stands

- No native text is selectable. An element with no author user-select draws as Chrome draws it, but Chrome lets you select its
  text. That gap belongs to P6c and is accepted today.
- `user-select: none` compiles everywhere, because Chrome then selects nothing, which native already matches.
- Before slice 1, every other author value was refused on native (analysis/selection.ts).

## Slice 1: values that change nothing (this change)

The used value (css-ui-4 §6.1) is what decides selection. `auto` resolves to `none` under a parent whose used value is `none`, to
`all` under `all`, and to `text` otherwise. The root counts as having a `text` parent, and nothing that compiles is editable, so
`contain` never arises.

An author value compiles on native when its used value is either:

- `none` (native matches it exactly), or
- the used value `auto` would get under the same parent. Then the declaration changes nothing in Chrome, and native draws the
  element as it draws the default. Undeclared, the element inherits its parent's computed value, and that resolves to the same
  used value.

So `auto`, `initial`, and `unset` always compile. `text` and `inherit` compile under a parent whose used value is `text`. A
value is refused when it makes text selectable where the default would not (`text` under `none`), or selects content as a unit
(`all`).

**Proof**
- packages/dragon/test/user-select.test.ts covers the rule and its refusals.
- packages/parity/test/user-select-noop.test.ts proves it against Chrome. For each case, Chrome drags a selection across the page
  and inside each block. It compares the selected text and its client rects with the "native model" page, which keeps only the
  `none` rules.
  - Every case Dragon compiles on native must select exactly what the model selects.
  - Every case Dragon refuses must select something different, so each refusal is needed.
  - If the test pretends all 15 cases compile, it fails on all 6 refused cases.
- user-select-none.html gains `auto` and `text` cases that compile on native, so they can prove profile rows.

## Slice 2 and on: real selection (P6c, T077)

These follow notes/T046-paint-spec.md §5.7, which is binding. P6b (T076, accessibility) comes first; it is also still queued.

- **2a:** the selection model in the compiler. It covers selectable text ranges per used value, DOM-order spans, and the
  exclusion of generated content (T151 R7). It is tested against Chrome's `Selection` and `Range.getClientRects` for the same
  drag points, with no device needed.
- **2b, iOS:** `DragonTextView` adopts `UITextInput` in non-editable mode, with `UITextInteraction(for: .nonEditable)` for the
  handles, the loupe and the menu.
- **2c, Android:** hit-testing over the same data, theme handle drawables, `Magnifier`, and a floating `ActionMode` for copy.
- **2d:** a `device-selection` lane that drives long-press and drag on both platforms. It compares positions and the clipboard
  with Chrome, and must catch a planted `selection-off-by-one`. It reuses device-hit's input injection (native-host.ts
  MotionEvent, XCUI).
- **After that:** `text` under `none` and `all` compile once 2d passes, and `::selection` styling becomes its own slice.

2b and 2c need device runs, which the cloud gets through the CI device workflows, never the Mac.
