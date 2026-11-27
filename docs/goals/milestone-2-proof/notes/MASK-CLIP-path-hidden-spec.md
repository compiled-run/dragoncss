# MASK-CLIP-path-hidden: a box an empty clip-path hides, and the native inputs inside it

## Why

`@markless/ui` renders each native input of its families (radio group, checkbox, switch and others) inside a visually hidden span
(`base/visually-hidden.tsrx`):

```css
clip-path: inset(50%); height: 1px; overflow: hidden; position: absolute; white-space: nowrap; width: 1px;
```

The check-in app's `/settings` has six such radios. Measured on Dragon master 4f8974931e with #737, #727, #657, #716 and #729
merged in, they account for 54 of the page's 119 refusals (markless#974):

- **FORM-b:** the `<input type=radio>` itself (6).
- **The UA's `border-style: inset`** on the input (12).
- **Three PNT1 outline refusals** (36): the input's focus outline inside the wrapper's overflow clip, the same outline beside the
  wrapper's `clip-path`, and the wrapper's own outline with its `clip-path`.

Dragon already models this pattern for the legacy `clip: rect(...)` property (MASK-CLIP, fixture `clip-rect-sr-only`):

- A box whose clip rect is empty at every size paints nothing.
- Its subtree's text becomes one native accessibility label.

It still refuses an outline inside such a box, because native outlines draw in the root view, outside the hidden box view. It
does not treat an empty `clip-path` shape as hiding the box at all; it lowers it as a shape clip, with that clip's refusals.

## Chrome 145 facts

Measured in the pinned Chrome 145.0.7632.6 (`launchChrome`) at forced DPR 1, 2, 2.625 and 3:

- **Pixels:** each case's page against the same page without the wrapper, at rest and after a Tab moves keyboard focus into it.
- **Hits:** `elementFromPoint` on a 0.5 px grid from 20 px outside the wrapper's rect.
- **Layout:** the boxes after the wrapper, and the scroll container's scroll extent, with the inner input at its UA size and at
  400 × 90 px.
- **Accessibility:** the accessibility tree (`ariaSnapshot`).

The probe is `packages/parity/srprobe.scratch.ts`, which is not committed. All four ratios agree on every fact except F7's
pixels at DPR 2.625, where the wider scroll extent changes the scrollbar.

| # | Case (wrapper as above unless stated) | Paints | Paints, focused | Hit | Layout and scroll extent outside |
|---|---|---|---|---|---|
| F1 | a default-appearance `<input type=radio>` | nothing | nothing (the input has focus and matches `:focus-visible`) | never | unchanged at 400 × 90 |
| F2 | `<input type=checkbox>` | nothing | nothing (focus-visible) | never | unchanged |
| F3 | `<input type=text>`, the UA inset border | nothing | nothing (focus-visible) | never | unchanged |
| F4 | the wrapper's own `outline: 3px solid` and `box-shadow` | nothing | nothing | never | unchanged |
| F5 | a focusable descendant with an outline (offset 6px) and a 10px box-shadow | nothing | nothing (focus-visible) | never | unchanged |
| F6 | a `position: fixed` descendant | nothing | nothing | never | unchanged |
| F7 | `clip-path: inset(50%)`, 1 × 1 px, **no** `overflow: hidden`, a 300 px wide child | nothing | | never | the scroll container's `scrollWidth` grows from 200 to 300 |
| F8 | the shapes `inset(0 50%)`, `inset(50% 0)`, `inset(100%)`, `circle(0)`, `inset(50% round 4px)` on a 30 × 10 box with a background | nothing | | never | |
| F8b | control: `inset(49%)` | (sub-pixel) | | hit | |

- **Accessibility:** the radio, checkbox and text field of F1 to F3 stay in Chrome's accessibility tree, with their roles
  (`radio`, `checkbox`, `textbox: abc`).
- **What a box an empty clip-path hides does:**
  - It paints nothing of itself or its subtree: outlines, box-shadows, focus rings and fixed descendants included (F1 to F6, F8).
  - It is never hit (F1 to F8).
  - Its content changes no layout outside it when its size does not follow its content and it clips its overflow (F1 to F6).
  - Otherwise its content can still reach the scroll extent of its scroll container (F7): `clip-path` clips painting, not
    scrollable overflow.

## Rule

1. **Empty shape.** A `clip-path` basic shape hides its box when its region is empty at every border-box size. That holds for:
   - an `inset()` whose top and bottom percentages, or left and right percentages, sum to 100% or more, with any `round`;
   - a `circle()` or `ellipse()` with a zero radius.

   Lengths in px depend on the box's size and stay a shape clip, unchanged. That shape analysis lives beside `clipsEverything`
   (`css/properties/clip-path.ts`). `clipHidesBox` becomes "the box's clip rect or clip-path hides it" wherever MASK-CLIP reads it:
   `outline.ts`, `clip-label.ts`, `analysis/paint-values/clip.ts` and `lower/paint/clip.ts`.
2. **Paint.** Such a box lowers as the empty clip rect does: the box view is hidden, or takes the clip label write when its subtree
   has text Chrome exposes. The shape clip's refusals don't apply to it. An outline, a box-shadow or a fixed box in the subtree
   is not drawn natively: Chrome draws none of them (F4 to F6). Today the outline refusal names the views outside the box view
   (`outline.ts`, `viewOutsideClip`); for a hidden box, those views are left out instead.
3. **Hits.** The hit table holds no node of the subtree (F1 to F8). Neither `clip` nor `clip-path` is in `HIT_MODELLED` today,
   so a page whose `clip-path` compiles has its interaction rules refused (`hitUnmodelledFact`); the empty clip-path wrapper only
   escapes that now because its value is refused first. The slice adds a hit fact: a box an empty clip or clip-path hides.
   `rt-hit.ts` `boxNodes` leaves that box and its subtree out of the table, which `native:gen` translates. `HIT_MODELLED` takes
   `clip-path` when its shape is empty at every size, and `clip` when its rect is.
4. **Layout.** When the hidden box has a definite width and height and clips its overflow (`overflow` other than `visible` on both
   axes), its content can't change any layout outside it (F1 to F6 against F7). Its subtree's replaced and form elements are then
   laid out as empty boxes at their UA sizes, without the paint refusals of FORM-b or of the UA border styles. Their pixels are
   never seen, and their sizes are measured only where layout reads them, inside the box.

   The layout lane still compares each such element's rect with Chrome's: Chrome reports the radio's 13 × 13 box inside the
   1 px wrapper. So the subtree can't simply be dropped. A radio or checkbox is laid out at Chrome's UA size and margins, which
   needs their UA keys (`scripts/capture-ua-defaults.ts`; #568 has the radio's and checkbox's, for `appearance: none`). Part 2
   lands them on their own, without #568's paint.

   Master lays out a themed checkbox (FORM-checkbox, `computed-checks.ts` `checkCheckbox`) as a 13px block box, but only a
   block-level one: an inline-level checkbox waits for RF-INL. `@markless/ui`'s hidden radio is Chrome's default `inline-block`, an
   atomic inline on a line of the 1px wrapper. So part 2 is three steps:
   - the radio's UA key;
   - the checkbox layout reused for a radio, whose paint is waived inside a hidden box;
   - a checkbox or radio laid out as an atomic inline, in the RF-INL way #717 did for buttons.
5. **Accessibility: an open question (below).** A focusable or accessible element in the subtree (an `<input>`) stays in Chrome's
   accessibility tree. A hidden native view leaves it. MASK-CLIP today refuses anything focusable inside a hidden box for that
   reason (`clipLabelRefusal`), and this slice keeps that refusal until the owner rules.

## Open question for the planner: who exposes a visually hidden native input on phones

The Markless phone runtime already treats checkboxes and radios as host controls (`packages/mobile/src/runtime.ts`: checkedness,
groups by `name`, a person's tick). The options:

- **(a) Recommended: the Markless host.** Dragon marks the input's box as hidden, accessibility owned by the host, in the export.
  The host exposes the control's role, state and label on the element the input is labelled by, or the visible row of its
  family. This matches how a screen reader reaches the web version: the hidden radio is announced as a radio, by its label.
- **(b) Dragon.** Dragon gives the hidden box an accessibility element with the input's role and state, as the clip label does
  for text. That would put control semantics into Dragon's paint lowering, which owns no control state.

## Proof

- **Fixture `clip-path-sr-only`,** built on `clip-rect-sr-only`, with the F1 to F8 shapes: captured with `parity:capture`,
  `parity:pixel-capture` and `parity:hit-capture` at DPR 1, 2, 2.625 and 3, ltr and rtl.
- **Planted fault:** an empty shape lowered as a shape clip draws the subtree's outline outside the clip, and fails the pixel lane.
- **`/settings`:** `measure.ts --styles` no longer names FORM-b, the UA inset border or the three PNT1 outline forms for the
  hidden radios. Whether the radios then compile depends on the accessibility ruling.

## Allowed files

- `packages/dragon/src/css/properties/clip-path.ts`
- `packages/dragon/src/css/properties/clip-rect.ts`
- `packages/dragon/src/analysis/paint-values/clip.ts`
- `packages/dragon/src/analysis/paint-values/clip-label.ts`
- `packages/dragon/src/analysis/paint-values/outline.ts`
- `packages/dragon/src/lower/paint/clip.ts`
- the form and UA-border refusal sites, for rule 4 only
- their tests
- `packages/parity/fixtures/clip-path-sr-only.html`, `packages/parity/src/fixture-groups/clip-rect.ts`
- generated: captures, vectors and native engines for the fixture
- this spec
