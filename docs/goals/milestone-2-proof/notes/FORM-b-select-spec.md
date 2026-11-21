# FORM-b select: a single-select `<select>` (menulist), as Chrome 145 lays it out and paints it

Worker spec (overlay-port, 2026-11-21) for review before implementation. Stacked on FORM-b1 (#571, text fields), whose control-kind and UA-shadow machinery it reuses.

## Why

Markless's notes app (yardstick screens `/new` and `/notes/[id]/edit`) has a styled `<select name="tag">` inside a form. With Markless #1032 (FormData from a helper), Dragon #572 (`name` is rendering-neutral) and #575 (readonly textarea), Dragon's refusal of `<select>`/`<option>` is the last thing stopping both screens. The notes CSS gives the select `width: 100%`, padding, a 1px border, a border radius, a background and `font: inherit`, and leaves `appearance` at its UA value `auto`.

## What Chrome 145 does (sources at tag 145.0.7632.6, references only)

- **UA style:** html.css `select { appearance: auto; box-sizing: border-box; align-items: center; white-space: pre; color: FieldText; background-color: Field; border: 1px solid light-dark(#767676, #858585); border-radius: 0 }`, plus `select:not(:-internal-list-box) { overflow: visible !important }` and `text-autospace: no-autospace !important`.
- **Box:** a menulist is a flex container (row) with one shadow child, the inner element (menu_list_inner_element.cc CustomStyleForLayoutObject). The inner element has:
  - `display: block`, `flex: 1 1`, `min-width: 0`;
  - `overflow: hidden` on both axes, `text-overflow` from the select, `user-modify: read-only`;
  - `line-height` set to the primary font's metrics height when the select's line height is initial (`normal`);
  - `margin-top`/`margin-bottom: auto` and `align-self: start` when the select's `align-items` is `center`. That is safe centring, the UA value;
  - inline-start/inline-end *margins* (not paddings) of LayoutTheme `PopupInternalPaddingStart`/`End`;
  - block-start/block-end paddings of `PopupInternalPaddingTop`/`Bottom`;
  - direction and unicode-bidi from the selected option.
- **Internal paddings** (layout_theme_default.cc), all 0 when the select has no effective appearance (`appearance: none`):
  - start: 4 × zoom;
  - top and bottom: 1 × zoom;
  - end: 1 × zoom + `ClampedMenuListArrowPaddingSize`, the native theme's scrollbar-arrow width, or 15 when that is 0, times the zoom.
- **Theme:**
  - `LayoutThemeDefault::AdjustMenuListStyle` resets `line-height` (a menulist's line height is always `normal`) and keeps overflow visible.
  - An author background or border devolves `auto` to `menulist-button`.
  - `menulist` with no author box paints Chrome's own field and is out of scope here, like FORM-b1's themed field.
- **Arrow** (theme_painter_default.cc SetupMenuListArrow + native_theme_base.cc PaintMenuList), in horizontal-tb:
  - `arrow_box = ClampedMenuListArrowPaddingSize`;
  - `arrow_size = 8 × arrow_box / MenuListArrowWidthInDIP`;
  - `arrow_x = right - (arrow_box + arrow_size) / 2` in ltr (`left + (arrow_box - arrow_size) / 2` in rtl), where `left`/`right` are the border-box edges inset by the floored border widths;
  - `arrow_y = top + height / 2` (integer division);
  - the "v" is width `arrow_size` and height `floor(arrow_size / 2)`, at `y = arrow_y - height / 2`, clipped and shrunk to the rect;
  - it is stroked open, not closed: 2px antialiased, in the select's `color`.
- **Text:** the inner element holds the label of the selected option: the first option with `selected`, else the first option that is not disabled. Options and optgroups are not rendered in the menulist; they reach only the platform's picker.

## Slices

Each slice is its own PR, with fixtures compared against Chrome (chrome-dual plus linux-dragon-layout) and the regen in its own commit.

1. **S1, `appearance: none`:** a block-level (blockified) single select with `appearance: none`.
   - Internal paddings 0 and no arrow.
   - New control kinds `select-menulist` (a flex row container) and `select-inner` (block, flex 1 1 0, min-width 0, overflow hidden, line-height rule, safe-centring margins).
   - The text is the selected option's label.
   - `<option>`/`<optgroup>` become supported elements with no box in a menulist.
   - Fixtures: `controls-select-none` (ltr and rtl, with and without `selected`, a disabled first option, a long label clipped by overflow) and `reject-controls-select-multiple` (`multiple` or `size` > 1 stays refused, naming FORM-b listbox).
2. **S2, `menulist-button`:** a select whose appearance devolves from auto because of an author border or background.
   - The internal paddings above.
   - The arrow as a paint primitive the native backends draw (a two-segment open path, 2px stroke, antialiased, currentColor).
   - `MenuListArrowWidthInDIP` is captured per reference platform, because the native theme's scrollbar-arrow size differs. A capture script records it with the other FORM-0 control data.
   - Fixture: `controls-select-button` (the notes form's shape: width 100%, padding, border, radius, background, `font: inherit`, ltr and rtl).
   - Pixel comparison for the arrow uses the existing antialiasing tolerance of the paint lanes; no new tolerance.
3. **S3, native hosts:** the iOS and Android lowerings, which draw the box and the arrow and leave the text to the host's text view. Acceptance: the engine emits the arrow in its own paint output (hosts never call `menuListArrow` with their own rect); the translator roots reach `menuListArrow` and `menuListArrowBox`; the generated Swift and Kotlin engines match the TypeScript engine on the `controls-select-button` fixtures.

The `select` element itself stays a Markless-native control: Markless's host opens the platform picker on tap (Markless #901). Dragon lays out and paints the closed control only.

## Refused, by name

- `multiple`, and `size` > 1 (a listbox, FORM-b listbox).
- A themed `menulist` (appearance auto with no author border or background).
- `appearance: base-select` (customizable select).
- An inline-level select (RF-INL).
- An out-of-flow or floated select.
- The UA font: Markless apps write `font: inherit`; without it the select's `font: -webkit-small-control` is not pinned.
- `writing-mode` other than horizontal-tb.
- `::picker()` and `::picker-icon`.

## Open questions for the Judge

1. **Arrow paint:** S2 adds a stroked open path to the paint model. Is a new paint primitive acceptable, or should the arrow go into the existing SVG/drawing path (it is 2 line segments)?
2. **Platform data:** `MenuListArrowWidthInDIP` comes from the native theme (15 is Blink's fallback). Should it be captured per reference platform with the FORM-0 control data, or pinned as a Chrome observation per platform in the UA dataset?
3. **Order:** S1 alone unblocks no yardstick screen (the notes select has author styles), so S1 and S2 can land as one PR if the reviewed diff stays under the size limit. Is one PR preferred?

## Judge verdict (2026-11-21): approved with amendments, folded in here

- **Flex basis.** The inner element sets only flex grow and shrink (menu_list_inner_element.cc:32-33), so its basis stays `auto`; S1 is `flex: 1 1 auto`.
- **Devolve.** An author `box-shadow` devolves `auto` to `menulist-button`, as a background or border does (layout_theme.cc:452-457). S2 covers it, and a themed menulist is one with none of the three.
- **Text and selection.**
  - The closed select shows `TextIndentedToRespectGroupLabel()` (select_type.cc:1025). S1 refuses an option inside an `<optgroup>` by name.
  - The inner element also takes `text-align` from the option (select_type.cc:1040-1047).
  - Which option is selected (several `selected`, none, a disabled first option) is decided by capture, not asserted. The fixture covers each case.
- **Rounding.**
  - The end padding is an int (layout_theme_default.cc:242-248).
  - The clamped arrow size is the scaled size when zoom is below the device scale (284-290).
  - The 2px stroke does not scale with zoom (native_theme_base.cc:799).
  - The lanes' device scale factor is pinned.
- **No radius.** Without a radius `PaintTextField` runs first (native_theme_base.cc:703-710). It is a no-op for `menulist-button` (transparent, no border), and a radius-0 fixture proves it.
- **Ruling on Q1 (arrow).** No new paint primitive. The arrow lowers to the existing SvgShape path (analysis/elements/svg.ts): a three-point open path, stroke 2, butt caps, miter joins. The shared layout engine computes and snaps the points from the snapped border box and the device scale (packages/layout/src/controls.ts `menuListArrow`), since neither exists before layout; hosts run only the generated engine. Recorded 2026-11-21 after S2 showed the paddings truncate to whole device pixels and the stroke is 2 device px.
- **Ruling on Q2 (arrow width).** A capture step in scripts/capture-form-data.ts derives the clamped size per reference platform from the inner element's captured end margin minus 1, and cross-checks it against the arrow's pixels. It is written to the generated per-platform UA data. Missing data means refused.
- **Ruling on Q3 (order).** S1 and S2 are one PR ("a styled single select"; #571 is already the parent, and the stack depth limit is 2), with the regen in its own commit. It splits at the S1/S2 seam only if the reviewed diff passes about 150 KB, and then only after #571 merges. S3 (native) is its own PR. The yardstick screens are unblocked when S3 lands.
- **More refusals, or fixtures where Chrome is modelled:**
  - a shrink-to-fit width (Chrome sizes the select to its widest option): refused by name;
  - `disabled` (opacity 0.7): fixture;
  - focus and `:focus-visible` outlines: refused until FORM-c's states land;
  - no options, or an empty label (has-line-if-empty, menu_list_inner_element.cc:36-37): fixture;
  - the `label` attribute and whitespace in the label: fixture;
  - `text-overflow: ellipsis`: fixture;
  - dark mode (`light-dark` border, Field/FieldText): fixture or refused;
  - an author `line-height` with `appearance: none` (kept, since the reset runs only for themed selects): fixture;
  - an author `flex-direction`, or `align-items` other than `center`: refused.
- **`controls-select-button` variants:** border radius 0, a fractional border width, a box-shadow-only select, and zoom above 1.
- **Capture.** Shadow boxes come through CDP pierce (as FORM-0 does), with `--check` and a planted failure (`arrow-unmirrored`).
- **Split (2026-11-21).** The branch measured 182 KB reviewed (spec+S1 111 KB, S2 97 KB), so spec+S1 is one PR on #571 and S2 opens on it only after #571 merges.
- **S3.** The arrow's points, colour and stroke come from the same compiler result as the plain-data property list. Device lanes follow the async device-refresh rule.
- **Ruling on the measurer (2026-11-21, option C).** A select in a web font (Lato WOFF2) failed its style export with text-glyph, because the device-border, font-size, replaced-paint and arrow helpers resolved the input with the Ahem measurer (layout.ts zoomInput).
  - The menulist line-height rule stays in environment resolution, as Chrome's style-time MenuListInnerElement::CustomStyleForLayoutObject has it.
  - Any caller that holds a measurer resolves with `resolvedInput(input, measurer, faults)`: paint.ts `menuListArrows` takes the measurer, and so do the ExpectedEngine helpers, the export, the harness and the Swift and Kotlin `apply()`.
  - `zoomInput` is only for Ahem or planted-fault inputs.
- **Ruling on scroll ranges (2026-11-21).** The style export refuses a missing scroll range only for a node with a scroll-container write, as expectedDump and the harness do, because a select's inner element clips (overflow hidden) but never scrolls on a phone.
- **Ruling on options (2026-11-21).** The Markless export check treats an `<option>` or `<optgroup>` inside a `<select>`, and its text, as having no box, read from the input's element names and tree, because Chrome's closed control draws only the shown label; an option anywhere else is still required.

## S5: :focus and :focus-visible on a select (2026-11-22)

- **Chrome fact (form-b-select-focus.test.ts):** In Chrome 145 a tap (touch) or click (mouse) on a select, with `appearance: none` or devolved to menulist-button, gives it `:focus` and `:focus-visible`. A button gets `:focus` alone. A select is like T064 P6's text input, unlike its button, range and link.
- **Change:** `analysis/interaction.ts` pointer focus (R6) gives focus-visible to a select it focuses (`pointerFocusVisible`). Every other element keeps focus without focus-visible. #618's select-specific refusal of `:focus` and `:focus-visible` rules is removed.
- **What still gates a select's focus rules:**
  - They are gated like any focus rule: the device proofs, and the native hit model. The hit model refuses every interaction rule in a case that holds a form control (`hitUnmodelledControl`, FORM-a); that is the next slice.
  - A reachable focus-visible state whose outline is Chrome's ring (`outline: auto`) is still refused natively (T064 row 149).
- **Proof:** for a tap and for a click, Chrome's `:focus`, `:focus-visible`, `border-top-color` and `background-color` on two selects and a button equal Dragon's pointer-focus value and its resolved style in that state.
