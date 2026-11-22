# FORM-checkbox: a themed checkbox, laid out and drawn as Chrome 145 draws it

Scope: `<input type="checkbox">` with `appearance: auto` (its initial value), in a light colour scheme, checked or not from its
`checked` attribute, with `accent-color` auto or an opaque colour. The Markless notes form needs it: `/new` and `/edit` render
`<label class="check"><input type="checkbox" name="pinned" checked={pinned}> Pin to the top</label>`, styled
`.check { display: flex; align-items: center; gap: 10px; min-height: 44px }` and
`.check input { width: 22px; height: 22px; accent-color: var(--accent) }`, `--accent` being `#c2410c`, or `#fb923c` under
`prefers-color-scheme: dark`. The app sets no `color-scheme`, so Chrome draws the light theme in both modes.

## Measured facts

Chrome 145.0.7632.6 through `launchChrome` (`packages/parity/src/chrome.ts`), Ahem 10px, DPR 1, 2 and 3. Pixels are read from
`Page.captureScreenshot`.

### Style

1. The UA computed style of `input[type=checkbox]`: `display: inline-block`, margin `3px 3px 3px 4px`, `box-sizing: border-box`,
   padding 0, border 0 (`none`), `background-color: transparent`, `cursor: default`, `appearance: auto`, and no `::before` or
   `::after` box. It is captured as its own UA key, `input[type=checkbox]`, by `pnpm ua:capture`.
2. With `appearance: auto`, an author's padding and border compute to 0. `padding: 3px; border: 2px solid red;
   box-sizing: content-box; width: 22px` gives a 22x22 border box with computed padding `0px` and border width `0px`. Dragon
   keeps any author padding, border or `box-sizing` other than border-box refused on a themed checkbox. The notes app sets none of
   them on its checkbox: `* { box-sizing: border-box }` is the UA value.

### Layout

3. `width: auto` and `height: auto` are each 13px, the theme's part size (`native_theme_base.cc` `kCheckboxSize`). An author
   length replaces each axis alone: `width: auto; height: 30px` is 13x30, `width: 5px; height: auto` is 5x13, `display: block;
   width: 22px` is 22x13. The box is not stretched or compressed further than a block or flex item with those definite sizes.
4. The baseline is the border box's bottom edge. In a 19px Ahem-10px line, `X<input type=checkbox>X` puts the 13px box at
   y 3 (its top margin) and the line is 19px: border-box bottom 16 on the baseline, plus the 3px bottom margin below it. At
   font-size 40px the box's top is at y 19 (the 32px strut ascent minus 13), and a 22px box makes a 28px line.
5. In the notes row (`display: flex; align-items: center; min-height: 44px`) a 22px checkbox is at (4, 11): its 28px margin box
   centred in the 44px line, its left margin 4px.

### Paint

The theme draws in the checkbox's border box, as `NativeThemeBase::PaintCheckbox` and `PaintCheckboxRadioCommon`
(`ui/native_theme/native_theme_base.cc`, BSD, Chromium at the tag) do, scaled by the zoom (the device pixel ratio), so every
length below is in CSS px times the DPR:

6. The theme paints at zoom 1 in a whole-px rect: the snapped border box in device px divided by the zoom and truncated, then
   scaled back by the zoom (at DPR 2.625 a 13px box is 34 device px, painted as 12 x 2.625 = 31.5). The drawn square is the
   largest square centred in that rect (a 30x22 box draws the same 22px square as a 22x22 box, centred). The drawing is not
   mirrored in rtl.
7. Unchecked: the background, a rounded rect inset 0.2px with radius 2, in the checkbox background colour; then the border, a
   1px stroke of the square inset 0.5px, radius 2, in the border colour.
8. Checked: the background as above, then the square filled with radius 2 in the accent colour, with no border; then the check, a
   stroked open path from (x + 0.2w, centre y) by (0.2w, 0.2h) to (right - 0.2w, y + 0.2h), stroke width 0.16h, in the checkbox
   background colour.
9. A square no wider than 2px is a plain rect in the border or accent colour.
10. Colours, light scheme: checkbox background `#ffffff`, border `#767676`, default accent `#0075ff`. An authored opaque accent
    replaces the accent. When the accent's contrast ratio against white is below 3 (WCAG 2 relative luminance), Chrome draws a
    checked box in its dark colours: background and check `#3b3b3b`. Gray 148 (contrast 3.03) keeps a white check and gray 149
    (2.995) turns it dark; `rgb(0 172 0)` (3.045) is white and `rgb(0 174 0)` (2.98) dark; `rgb(255 90 90)` (3.06) white;
    `rgb(140 140 255)` (2.87) dark; `#c2410c` white, `#fb923c` dark. The rule is a Chrome observation (Blink's choice is in
    LGPL `theme_painter_default.cc` and is not ported).
11. A translucent accent is not drawn as an opaque one: `rgb(0 0 0 / 0.3)` under `color-scheme: dark` blends with the page, not the
    checkbox background. Dragon keeps a translucent accent refused.

### State

12. A click toggles `checked`. A checkbox's paint follows the element's checkedness, which starts from the `checked` attribute.
    Dragon compiles both drawings (checked and unchecked) for each checkbox and draws the attribute's state at first; the host
    app owns checkedness and sets it on the view (`dragonSetCheckboxChecked`), which redraws. `:checked` in a stylesheet stays
    refused, as it would need the state in the style partition.

    The tap path (Judge amendment 1): a tap on the checkbox's border box, or anywhere in its wrapping `<label>` (HTML label
    activation), reaches the host as a tap whose hit target is the checkbox or an element inside the label; Dragon's hit table
    names the same element as Chrome's `elementFromPoint` there (the checkbox is a plain box in the layout input, so the table
    models it; `controls-checkbox` carries a label row through the hit lane). Markless's native runtime then runs label activation
    (the label's labeled control is its first labelable descendant, or its `for` target), toggles the control's checkedness and
    calls `dragonSetCheckboxChecked`; a form's data reads the current checkedness at submit. Measured in Chrome on the notes row: a
    tap on the label's text gives `pinned=on`, a second tap gives no `pinned`, and a tap on the label outside its text and on the
    box toggle it too.

    Dirty checkedness (Judge amendment 2, HTML §4.10.5.1.15): measured in Chrome, after a user toggle, setting or removing the
    `checked` attribute changes nothing, while on a checkbox no one has toggled it still does. `dragonSetCheckboxChecked` marks the
    view dirty, after which a later `dragonSetCheckbox` write (a re-render) keeps the host's state and takes only its colours.
13. While the pointer is down Chrome draws the pressed colours: unchecked border `#8d8d8d`; checked, the accent with its HSL
    lightness raised 0.11 (`#0075ff` to `#3793ff`, `#c2410c` to `#f15516`), or lowered 0.11 when the dark colours are in use
    (`#fb923c` to `#fa7305`). Hover darkens instead; the phones have no hover. This slice does not draw the pressed colours, so a
    press shows the resting colours. That is a stated deviation for the length of a press, which the Judge rules on.
14. A tap or click gives a checkbox `:focus` and not `:focus-visible` (it is not a keyboard input), so the notes app's
    `:focus-visible` outline does not show on a tap. Dragon's pointer focus already gives this.

## Refused (unchanged or new)

- Author `:hover` and `:active` rules on a themed checkbox (Judge amendment 3), while the pressed and hovered colours are not
  drawn: Chrome would show them under the author's style.
- `color-scheme` that makes the used scheme dark, on the checkbox or inherited (the dark theme colours are measured in part only).
- A translucent `accent-color`.
- Author padding, border, or `box-sizing: content-box` on a themed checkbox.
- `indeterminate` (a script property, never in a stylesheet, so nothing to refuse at compile time; the host does not set it).
- `::before` and `::after` on the checkbox (no box in Chrome; refused on controls as before).
- `appearance` values other than `auto` and `none` keep their current handling; `appearance: none` on a checkbox stays refused
  until its CSS-box paint is captured.
- `type=radio` and every other input type stay refused.
- Disabled checkboxes (`disabled` attribute): refused until their colours are captured.

## Proof

- A parity fixture `controls-checkbox` (both directions) with the measured layout cases: alone in a block, between text in a line
  at two font sizes, the notes flex row, author widths and heights per axis, a non-square box. Its boxes are compared to Chrome
  by the capture lanes as every fixture's are.
- A Chrome pixel test (`packages/parity/test/form-checkbox.test.ts`) at DPR 1, 2, 3 and 2.625 (Judge amendment 4), checked and unchecked, accent auto,
  `#c2410c`, `#fb923c`, 13px and 22px and 30x22: every device pixel fully inside a drawn shape (by at least one device px from
  every edge of it) is that shape's colour exactly, every pixel fully outside every shape is the page's, and the check's covered
  pixels are the check colour; the same test fails a planted fault that draws the check white under a light accent.
- Refusal tests for every item in Refused, and the tap-path test: tap the label text, then again, with the form data and the
  hit table's target checked against Chrome, and dirty checkedness measured.
- The native lanes inherit the paint through the translated geometry (`packages/layout/src/paint.ts`), the device pixel lanes
  run it on the phones after landing.

## Judge ruling

APPROVED WITH AMENDMENTS: (1) specify the tap path through the label to the host and test it against Chrome; (2) measure and keep
dirty checkedness; (3) refuse author `:active` and `:hover` on a themed checkbox while the pressed colours are not drawn; (4) prove a
fractional device pixel ratio. Each is met above: items 6, 12, the Refused list and the Proof list.
