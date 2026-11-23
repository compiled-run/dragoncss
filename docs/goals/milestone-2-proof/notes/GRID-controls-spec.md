# GRID-controls: form controls as grid items (2026-11-22)

Who needs it: the Markless notes form. Its `label.field` is `display: grid`, so its input, textarea, select and buttons are grid items.

- **Before:** `grid.ts` buildGrid threw `grid-controls` for any control child. The compiler refused a button and a text field as a grid item by name (computed-checks.ts refuseGridItem).
- **Change:**
  - The grid places a block button, a select (menulist) and a single-line text field as in-flow items. Each is laid out by its control kind, as block flow and flex already do: `layoutContents` with the ControlBox.
  - A range and a block fieldset stay refused (refuseGridItem, and grid.ts `gridPlacesControl`).
  - A select keeps its own width refusals (#618 checkSelect: a grid item's percentage width or automatic minimum reads its widest option).
- **Compressible text fields:** css-sizing-3 §5.2.2 makes a text field compressible. In its min-content contribution as a grid item, a percentage in `width` or `max-width` resolves against zero, so `width: 100%` contributes only its padding and border. That is what lets notes' `.field input { width: 100% }` stay inside its column.
  - Chrome 145 does not compress a button: a `width: 100%` or `max-width: 80%` button contributes its content.
  - Both are pinned in `grid-controls`. Measured locally against live Chrome at DPR 1 and 3, every box was within 0.02 device px before the fixture was added.
- **Proof:** fixture `grid-controls`, in both directions, through the regular chrome-dual and native layout lanes:
  - a fixed, an fr and an auto column of buttons, readonly text fields and a fixed-width select;
  - a one-column grid like notes' `.field`;
  - a narrow two-column grid that overflows, holding a `width: 100%` button, a `width: 50%` text field, a `max-width: 80%` button and a select;
  - `justify-self: center` and `align-self: end`.

## Judge ruling (2026-11-22): rejected 39c8d0db2b, the design sound. Its blockers are now fixed.
- The two tests that still expected the old refusal now expect a button to compile and a range to stay refused: `dragon/test/controls.test.ts` and `layout/test/grid.test.ts`.
- `grid-controls` now also holds a `display: flex` button grid item, which is a plain flex box, so the fixture now proves it. It also holds a shrink-to-fit `inline-grid` with a `width: 100%` text field. Every box matches live Chrome at DPR 1 and 3, measured locally.
- The Chrome expected and emitted outputs come from the PR's regen, in their own commit. The receipt is CI green.
- **Ledger, not fixed here:** `intrinsic.ts` `inlineContribution`, which block and flex intrinsic sizing use, still treats a text field's percentage width as auto, not compressed. That gap predates this change. Next: probe a `width: 100%` text field in a shrink-to-fit block and a flex item against Chrome, and fix it or refuse it by name.
- **Follow-up:** `<textarea>` as a grid item comes with #575.
- **Directions:** `grid-controls` (buttons and selects) runs in both directions. The text fields moved to `grid-controls-fields`, ltr only, because Dragon refuses an rtl text field's preserved editor text (#571). Measured locally, both match live Chrome in every direction they run in, at DPR 1 and 3.

## Textarea in the notes form (2026-11-22)

This brings in the #575 follow-up, on the branch that merges `cw/form-textarea` (#631) into `cw/form-select-width`.

- **Grid:** `gridPlacesControl` also places a `text-area`. A textarea is laid out by its control kind, as in block flow.
- **Compressible:** css-sizing-3 §5.2.2 lists textarea as compressible. Its percentage `width` or `max-width` resolves against zero in its grid min-content contribution, as a text field's does. Chrome confirms it: without the rule, a `width: 100%` textarea in the one-column grid widens the auto track by 6 px, and every item in it misses Chrome by that much.
- **Hit table:** `hitModelsControl` and `hitControlBox` model a textarea as one box with no children, since Chrome retargets its editor and placeholder parts to it. `hitUnmodelledControl` no longer refuses a textarea. `hitRetargetsParts` already covered it, because `textFieldPartOf` returns `part: null` for a textarea host.
- **Compiler:** the textarea goes through `checkTextField`, which never refused a grid item. `refuseGridItem` still refuses only a range and a fieldset.
- **Proof:** `grid-controls-fields` (ltr only) now holds a readonly `rows="3"` `width: 100%` textarea in the one-column grid, and a `rows="1" cols="3"` `width: 50%` one in the narrow overflowing grid. Measured locally against live Chrome at DPR 1 and 3, all 24 element boxes are within 0.02 device px.
