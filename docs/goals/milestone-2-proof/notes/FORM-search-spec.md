# FORM-search: `<input type=search>` laid out and drawn as Chrome 145 does

For the Markless notes list page's "Search notes" field (item 15 of the notes checkpoint): `<input class="search" type="search" aria-label="Search notes" placeholder="Search notes">` with `width: 100%; padding: 12px 16px; border: 1px solid; border-radius: 999px; background`, under `* { box-sizing: border-box }` and `input { font: inherit; color: inherit }`. Today `checkRange` refuses every input type it does not lay out ("of type search is not supported"). This slice builds on the text field from #571: a search field is a text field whose UA shadow tree holds one more part, the cancel button, which takes inline space.

Every number below was measured in the pinned Chrome 145.0.7632.6 headless shell (Linux), using `getComputedStyle`, CDP `DOM.getBoxModel` on the user-agent shadow tree, and screenshots. The fonts were Ahem at 5, 10, 13.333 (the UA default), 16, 17.5, 20, 24 and 40 px, at DPR 1, 2.625 and 3.

## Chrome facts

1. **UA style.** The search input's computed style differs from `type=text` only in `box-sizing: border-box` (html.css `input[type="search" i]`). The default border box is the text field's: 153 × 21 at 13.333px, from `width: 153px; height: 21px` against the text field's content-box 145 × 15 plus its padding and border. Under the app's `* { box-sizing: border-box }`, the two compute identically.
2. **Shadow tree.** The tree is: the placeholder (if any, `display: block !important`, as in a text field) and `-webkit-textfield-decoration-container` (`display: flex; flex-direction: row; align-items: center`). The container holds `#editing-view-port` (`display: block; flex-grow: 1`), which holds the inner editor (`display: flow-root`). After them comes `-webkit-search-cancel-button` (`display: block; flex-shrink: 0; margin-inline-start: 1px; margin-inline-end: 3px`). The container takes the text field's inner editor box (same origin and size), so the field's block size and baseline are a text field's.
3. **Cancel button size.** The button is a square of s device px, with s = clamp(lround(9 × P / 13), 5, 21) and P the field's computed pixel size in device px: int(f × z + 0.5), where f is the computed font size in CSS px and z is the device scale factor times the element's effective zoom. The rule is fitted to these measurements and pinned by them: 9px scaled against a 13px default font, clamped to [5, 21], on the zoomed style. Chromium computes the size in `layout_theme_default.cc`, which carries an LGPL header, so nothing is ported from it and no Dragon source cites it (`docs/ports.md`, "If it is LGPL, do not port the file"). The engine implements the measured rule, and `search-cancel.test.ts` checks it at every point in the table. Measured as CDP border-quad extents (`getBoxModel`'s width and height are whole px; the quads are exact):

   | font | DPR 1 | DPR 2 | DPR 2.625 | DPR 3 |
   | --- | --- | --- | --- | --- |
   | 5px | 5 | — | — | — |
   | 10px | 7 | 7 (14 dev) | 6.857 (18 dev) | 7 (21 dev) |
   | 12.4px | 8 | — | — | — |
   | 13.333px | 9 | 9.5 (19 dev) | 8 (21 dev) | 7 (21 dev) |
   | 16px | 11 | 10.5 (21 dev) | 8 (21 dev) | 7 (21 dev) |
   | 17.5px | 12 | 10.5 (21 dev) | 8 | 7 |
   | 20px | 14 | 10.5 | 8 | 7 |
   | 24px | 17 | — | — | — |
   | 40px | 21 (clamped) | — | — | — |

   12.4px at DPR 1 and 13.333px at DPR 2 show that the font size is rounded to whole device px first, because unrounded they give 9 and 18. Page zoom counts in z: at zoom 1.5 and 2, a 16px field's button is 17 and 21 zoomed px (11.33 and 10.5 CSS px). The engine's z is its effective zoom times the DPR, so it follows. On native, though, any text field under a zoom other than 1 stays refused by ZOOM (its editor is a scroll container, which native does not zoom yet), so no zoomed search field compiles. `search-cancel.test.ts` pins the engine's zoom case.

   **In layout units.** The engine lays a field out in zoomed px (device px, with zoom applied), where s is a whole number. The editor's and placeholder's inline-end margin is s + 4 × z zoomed px, the button's side plus its 1px and 3px margins. That is exact in LU whenever 4z is a multiple of 1/64, which holds at every DPR the lanes run (1, 2, 2.625, 3) and at zoom 1.5. In CSS px the side is s / z: 10.5 at 16px and DPR 2, and 6.857 at 10px and DPR 2.625. `packages/layout/test/search-cancel.test.ts` pins s at every measured point above, the margin at DPR 2.625 (21 + 10.5 device px), and the engine's margin at zoom 1.5 (17 + 6). Fixture `controls-search` holds sides that are fractional in CSS px at DPR 2 (13.333px: 9.5), 2.625 (10px: 6.857) and 3 (5px: 10 device px, 3.33 CSS px). Its part boxes are compared with Chrome's at each DPR.
4. **Editor width.** The viewport, the inner editor and the placeholder are as wide as the container less the button and its 4px of margins. At 16px, DPR 1, in a 300px pill with 16px padding, the container is 266px wide and the editor and placeholder are 251px. The button is centred in the container's block size (`align-items: center`): its top is the container's top plus (container height − side) / 2, which can be fractional.
5. **rtl.** The container lays out in the field's direction. In rtl the button sits at the inline start (left): 3px from the container's left edge and 1px before the viewport (measured at 16px: button at x 7, viewport at x 19). The engine places it there (`search-cancel.test.ts`). A native rtl text field is still refused by #571's bidi refusals (the editor's and placeholder's preserved white space in an rtl block), so `controls-search` runs ltr only. It gains its rtl case when those refusals lift.
6. **`appearance`.** On the input, `none`, `auto`, `textfield` and `searchfield` all give the same layout: the button keeps its space and its side. With the notes pill's author border and background, they also give the same pixels. Dragon compiles what #571 compiles for a text field: `none`, and `auto` devolved by an author background or border. `textfield` and `searchfield` stay under #571's theme refusal (`textFieldAppearance`), as they do on a text field, until a fixture measures that refusal's lift for every text field type.
7. **When the button shows.** In every state the button has `opacity: 0; pointer-events: none` except one: the field is enabled, not readonly, its value is not empty, and it is focused or hovered. An empty value sets `opacity: 0; pointer-events: none` inline. Readonly and disabled fields keep it hidden even with a value.
8. **Pixels.** With the notes field's styles (pill, padding, border, background, Ahem 16px), a search field's screenshot equals a `type=text` field's screenshot in these states: unfocused and empty with a placeholder, unfocused with a short value, unfocused with a value longer than the editor, and focused and empty. They differ only when the field is focused with a value, where Chrome paints the cancel icon. A long value is clipped at the input, not at the narrower editor, so it paints as in a text field.
9. **Focus.** A tap on a search field gives `:focus` and `:focus-visible`, as for every keyboard input type; Dragon's `TEXT_FIELD_TYPES` in `internal.ts` already lists `search`.

## Rules

- **R1 UA key.** Capture `input[type=search]` as its own UA key (`pnpm ua:capture`). It equals the text field's key except `box-sizing: border-box`. `isTextFieldType` in `analysis/elements/controls.ts` admits `search`, so a search field takes every text field rule, check and refusal from #571, including the editing refusal for a field that is not readonly.
- **R2 Layout.** The layout input's text-field control carries `searchCancel` (true for a search field). The engine's environment pass, which knows the scale factor, gives the field's editor and placeholder an inline-end margin of s + 4z zoomed px (fact 3). That margin is the right margin in ltr and the left one in rtl. It places them exactly where Chrome's editing view port and placeholder sit, so no box is emitted for the button itself. The button paints nothing and takes no hit in any compiled state (R3, R4), so a point over it hits the input, as a point over its empty margin does. The planted fault `searchCancelIgnored` lays the editor out at the full content width. `controls-search`'s part boxes catch it, at every DPR and in both directions.
- **R3 Paint.** The button paints nothing in every state Dragon compiles. The one state where Chrome paints it (fact 7) needs a focused or hovered field that is enabled and not readonly. Such a field is an editable text field, which #571's editing refusal still refuses on native ("has no caret, selection or keyboard input on iOS and Android yet"). When editing lands, an editable search field stays refused by name until Dragon draws the icon as Chrome does (R6). So no state that paints the icon compiles.
- **R4 Hit.** Chrome gives the button `pointer-events: none` in every compiled state, so a hit on it lands on the input. Dragon emits no box for the button (R2), so a point over its space falls on the input's own box, as a point over the input's padding does.
- **R5 Refusals kept.** Author styles on `::-webkit-search-cancel-button`, `::-webkit-search-decoration` and `::-webkit-search-results-*` stay refused, as statically empty or unmodelled pseudo-elements (`pseudo-hosts.ts`). On a search field, `text-align` passes only as `start`, as `left` when the field's direction is ltr, and as `right` when it is rtl; every other value (`center`, `end`, `justify`, `right` in ltr, `left` in rtl, `match-parent` as it computes) is refused. The narrower editor moves such text in a way no fixture measures yet. A `::placeholder` whose `text-align` is not start-aligned (by the same rule) is refused too. A `::placeholder` with a non-zero `margin-left` or `margin-right` on a search field is refused, because the engine takes the placeholder's inline-end margin for the button. A `list` attribute (a datalist) stays refused.
- **R6 For the editing slice.** When native editing lands, a search field the user can edit must do what Chrome does. It must draw the cancel icon as Chrome 145 does, from Chrome observations matched to Chrome screenshots by test. Chromium's `PaintSearchFieldCancelButton` is in `theme_painter_default.cc`, which carries an LGPL header (`docs/ports.json`), so it is not ported (`docs/ports.md`, "If it is LGPL, do not port the file"). It must clear the value on a tap of the button, firing `input` and `search` events. It must make the button tappable (`pointer-events: auto`) while it shows. A clear button drawn by the host does not count. Until then, an editable search field stays refused.

## Proof

- Fixture `controls-search` (ltr; rtl text fields stay refused, fact 5). It covers a default search field, the notes pill at 16px with a placeholder, with a value, and with a long value, a field at 40px (the button clamped at 21), a field at 5px (clamped at 5), a search beside a text field of the same styles (equal boxes), and an end-aligned field (`.end`, `text-align: start`). They are captured against Chrome at DPR 1, 2, 2.625 and 3 with the shadow part boxes. The engine's editor and placeholder boxes, which end before the button's space, match within the gate, and they catch `searchCancelIgnored`. No box is emitted for the button itself (R2).
- A Chrome pixel test of the notes pill: search equals text in the four states of fact 8, and a readonly field with a value equals text while focused, hovered, or both (the states R3 compiles). Dragon's lowering of a search field equals its lowering of a text field apart from the editor width.
- **Not built in this PR (Judge amendment 5, open):** a Dragon-vs-Chrome pixel comparison of the focused, empty pill, meaning the app's 3px `:focus-visible` outline at a 2px offset around the 999px radius. Dragon compares pixels on the device lanes against committed Chrome screenshots, and a focused state needs an interaction-state fixture there. The outline itself is #625's (outline around a radius) and is unchanged by this slice. The search field's own box under it equals a text field's (fact 8), which `form-search.test.ts` checks in Chrome.
- Refusal tests:
  - `checkRange` no longer names search.
  - An editable search field is refused by the editing refusal.
  - `::-webkit-search-cancel-button` author styles are refused.
  - Centred and end `text-align` on the field, and centred `text-align` on its `::placeholder`, are refused on the phones, as the web output still compiles (`form-search.test.ts`).
  - A `::placeholder` margin is refused on the phones (`form-search.test.ts`).
- Hit: no dedicated hit fixture yet. With no button box (R4), a search field's hits are a text field's, which the existing hit lanes cover.
- The Markless notes list page's search field compiles readonly through `markless-style-input`. It compiles editable once editing lands.

## Not here

- Drawing the cancel icon, and clearing the value on a tap (`search` event): both wait on editing.
- `incremental`, `results` and `autosave` attributes (non-standard, refused as unknown attributes).

## Merged with #645 (planner ruling, 2026-11-22)

#645 (`cw/markless-text-field`) owns the search field's layout. Its `ControlKind` text-field `cancelButton` and `controls.ts`
`searchCancelButtonSize` are the one engine path, and its formula matches every measurement in fact 3: the side is lroundf of the
clamp of 9 × the zoomed font size, rounded first, over 13, to 5..21 device px. This slice's own engine path is gone:
`searchCancelSide`, the editor margin it set, and its UA key and type-list entries, which #645 carries identically. The planted
`searchCancelIgnored` fault now applies to #645's path, and `search-cancel.test.ts` asserts the measured sides through it.

Kept from this slice:
- this spec;
- the R5 refusals;
- `controls-search`, which passes on #645's engine with its Chrome boxes unchanged;
- `form-search.test.ts`;
- the pseudo-element host fix.

Changed by the merge:
- R5 lets end alignment through in ltr, because #645's `controls-text-field-search` measures it at DPR 1, 2, 2.625 and 3. Centred
  text stays refused.
- An rtl search field is refused (#645's `search-rtl`), because #645's engine places the cancel button at the inline end only. The
  rtl measurements above stay as the record for when that is built.
- The Markless export compiles an editable search field, since #645's `textEditing: 'host'` lets the host edit it.
