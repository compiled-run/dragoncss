# FORM-search: `<input type=search>` laid out and drawn as Chrome 145 does

For the Markless notes list page's "Search notes" field (item 15 of the notes checkpoint): `<input class="search" type="search" aria-label="Search notes" placeholder="Search notes">` with `width: 100%; padding: 12px 16px; border: 1px solid; border-radius: 999px; background`, under `* { box-sizing: border-box }` and `input { font: inherit; color: inherit }`. Today `checkRange` refuses every input type it does not lay out ("of type search is not supported"). This slice builds on the text field from #571: a search field is a text field whose UA shadow tree holds one more part, the cancel button, which takes inline space.

Every number below was measured in the pinned Chrome 145.0.7632.6 headless shell (Linux), using `getComputedStyle`, CDP `DOM.getBoxModel` on the user-agent shadow tree, and screenshots. The fonts were Ahem at 5, 10, 13.333 (the UA default), 16, 17.5, 20, 24 and 40 px, at DPR 1, 2.625 and 3.

## Chrome facts

1. **UA style.** The search input's computed style differs from `type=text` only in `box-sizing: border-box` (html.css `input[type="search" i]`). The default border box is the text field's: 153 × 21 at 13.333px, from `width: 153px; height: 21px` against the text field's content-box 145 × 15 plus its padding and border. Under the app's `* { box-sizing: border-box }`, the two compute identically.
2. **Shadow tree.** The tree is: the placeholder (if any, `display: block !important`, as in a text field) and `-webkit-textfield-decoration-container` (`display: flex; flex-direction: row; align-items: center`). The container holds `#editing-view-port` (`display: block; flex-grow: 1`), which holds the inner editor (`display: flow-root`). After them comes `-webkit-search-cancel-button` (`display: block; flex-shrink: 0; margin-inline-start: 1px; margin-inline-end: 3px`). The container takes the text field's inner editor box (same origin and size), so the field's block size and baseline are a text field's.
3. **Cancel button size.** The cancel button is a square of side clamp(round(9 × f × z / 13), 5, 21) / z CSS px, where f is the computed font size in CSS px and z is the device scale factor. This matches Chromium's `LayoutThemeDefault::AdjustSearchFieldCancelButtonStyle` (BSD, `third_party/blink/renderer/core/layout/layout_theme_default.cc`; register it in `docs/ports.json`): `kDefaultCancelButtonSize` 9, min 5, max 21, scale against a 13px default font. The clamp is in device pixels.

   | font | DPR 1 | DPR 2.625 | DPR 3 |
   | --- | --- | --- | --- |
   | 5px | 5 | — | — |
   | 10px | 7 | — | — |
   | 13.333px | 9 | — | — |
   | 16px | 11 | 8 (21 device px) | 7 (21 device px) |
   | 17.5px | 12 | — | — |
   | 20px | 14 | — | — |
   | 24px | 17 | — | — |
   | 40px | 21 (clamped) | — | — |

   On a phone at DPR 3 the notes field's 16px text gives a 7px button, so the editor's width depends on the DPR.
4. **Editor width.** The viewport, the inner editor and the placeholder are as wide as the container less the button and its 4px of margins. At 16px, DPR 1, in a 300px pill with 16px padding, the container is 266px wide and the editor and placeholder are 251px. The button is centred in the container's block size (`align-items: center`): its top is the container's top plus (container height − side) / 2, which can be fractional.
5. **rtl.** The container lays out in the field's direction. In rtl the button sits at the inline start (left): 3px from the container's left edge and 1px before the viewport (measured at 16px: button at x 7, viewport at x 19).
6. **`appearance: none`** changes nothing in this layout. The button still takes its space.
7. **When the button shows.** In every state the button has `opacity: 0; pointer-events: none` except one: the field is enabled, not readonly, its value is not empty, and it is focused or hovered. An empty value sets `opacity: 0; pointer-events: none` inline. Readonly and disabled fields keep it hidden even with a value.
8. **Pixels.** With the notes field's styles (pill, padding, border, background, Ahem 16px), a search field's screenshot equals a `type=text` field's screenshot in these states: unfocused and empty with a placeholder, unfocused with a short value, unfocused with a value longer than the editor, and focused and empty. They differ only when the field is focused with a value, where Chrome paints the cancel icon. A long value is clipped at the input, not at the narrower editor, so it paints as in a text field.
9. **Focus.** A tap on a search field gives `:focus` and `:focus-visible`, as for every keyboard input type; Dragon's `TEXT_FIELD_TYPES` in `internal.ts` already lists `search`.

## Rules

- **R1 UA key.** Capture `input[type=search]` as its own UA key (`pnpm ua:capture`). It equals the text field's key except `box-sizing: border-box`. `isTextFieldType` in `analysis/elements/controls.ts` admits `search`, so a search field takes every text field rule, check and refusal from #571, including the editing refusal for a field that is not readonly.
- **R2 Layout.** The layout input's text-field control carries a cancel-button side (LU, 0 for every other text field type), computed by the compiler from fact 3 at the case's DPR. `layoutTextField` places a search field's editor and placeholder in the content box less side + 1px + 3px, at the inline start in the field's direction, and places the button as a shadow part box (`::search-cancel`) centred in the block axis at the inline end (inline start in rtl). The planted fault `searchCancelIgnored` lays the editor out at the full content width; a fixture with a centred placeholder must catch it.
- **R3 Paint.** The button paints nothing in every state Dragon compiles. The one state where Chrome paints it (fact 7) needs a focused or hovered field that is enabled and not readonly. Such a field is an editable text field, which #571's editing refusal still refuses on native ("has no caret, selection or keyboard input on iOS and Android yet"). When editing lands, an editable search field stays refused by name until the icon is drawn (Chromium's `PaintSearchFieldCancelButton`) or the host draws its own. So no state that paints the icon compiles.
- **R4 Hit.** The button's box has `pointer-events: none` in every compiled state, so a hit on it lands on the input (the hit table retargets text field parts to the control, as for the editor and placeholder).
- **R5 Refusals kept.** Author styles on `::-webkit-search-cancel-button`, `::-webkit-search-decoration` and `::-webkit-search-results-*` stay refused, as statically empty or unmodelled pseudo-elements (`pseudo-hosts.ts`). `text-align` other than `start` or the field's left edge on a search field is refused, because the narrower editor moves centred and end-aligned text in a way no fixture measures yet. A `list` attribute (a datalist) stays refused.

## Proof

- Fixtures `controls-search` (ltr) and `controls-search-rtl`. They cover a default search field, the notes pill at 16px with a placeholder, with a value, and with a long value, a field at 40px (the button clamped at 21), a field at 5px (clamped at 5), a search beside a text field of the same styles (equal boxes), and a centred-placeholder case that catches `searchCancelIgnored`. They are captured against Chrome at DPR 1, 2, 2.625 and 3 with the shadow part boxes, and the engine boxes, including `::search-cancel`, match within the gate in both directions.
- A Chrome pixel test of the notes pill: search equals text in the four states of fact 8, and Dragon's lowering of a search field equals its lowering of the text field apart from the editor width.
- Refusal tests:
  - `checkRange` no longer names search.
  - An editable search field is refused by the editing refusal.
  - `::-webkit-search-cancel-button` author styles are refused.
  - Centred `text-align` is refused.
- The hit table retargets the button's box to the input (form-controls-hit agreement).
- The Markless notes list page's search field compiles readonly through `markless-style-input`. It compiles editable once editing lands.

## Not here

- Drawing the cancel icon, and clearing the value on a tap (`search` event): both wait on editing.
- `incremental`, `results` and `autosave` attributes (non-standard, refused as unknown attributes).
