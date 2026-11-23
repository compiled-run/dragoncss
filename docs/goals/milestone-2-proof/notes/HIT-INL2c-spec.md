# HIT-INL2c: hit testing through an atomic inline that forms a stacking context

## Why

Batch 6 (master 24d5a17fb4) made `.button { display: inline-flex }` reachable as an atomic inline. The Markless notes app's
`.button:active { transform: scale(0.97); opacity: 0.85 }` makes a button a stacking context while it is pressed. Wherever such a
button sits on a line, master refuses every `:active`, `:focus` and `:focus-visible` rule in the document with INL2c
(`rt-hit.ts` `contextAtomicRefusal`, `interaction.ts` `hitUnmodelledBox`). That refusal came with #643, so this is a regression
from batch 6.

**The trigger in notes**, found by running `apps/measure.ts --styles` at Markless main cc3638315 against Dragon 24d5a17fb4:

- **`/notes/[id]`, `m17`:** the "Back to notes" link `<a class="button">`. It sits alone on the line after an `<h1>`, in the
  not-found `<section class="missing">` (`padding: 48px 0; text-align: center`).
- **`/notes/[id]/edit`, `m39`:** the same link, in a plain `<section>`.

The same shape refuses shop `/cart` (`h15`) and checkin `/checkins/[id]` (`m21`).

The button is a stacking context only in the `:active` assignment. At rest and under `:focus-visible`, it is a plain atomic
inline, which #643 already models.

## Chrome 145 facts

Each fact was measured with `elementFromPoint` in the pinned Chrome 145.0.7632.6 (`launchChrome`), at forced DPR 1, 2, 2.625 and
3. All four ratios agree at every probe point except one, noted in F10. Ahem 10px on 20px lines, except the notes shape. The probe
page and script are `scratch/inl2c-probe.ts` with its page (not committed). The fixture below reproduces each case.

| # | Case | Hit |
|---|------|-----|
| F1 | `opacity: 0.5` inline-block with a negative left margin, over the text before it | the atomic |
| F2 | the same with a negative right margin, over the text **after** it | the atomic |
| F2b | baseline: a **plain** inline-block with a negative right margin, over the text after it | the text (the block), as #643 measured |
| F3 | a plain atomic and then an `opacity` atomic, overlapping the text before them | each atomic |
| F4 | a child of an `opacity` atomic | the child; the atomic where the child doesn't cover |
| F5 | `transform: scale(0.5)`: the scaled box's centre, and a point inside the layout box but outside the scaled box | the atomic; the line's block |
| F6 | `transform: translate(10px, 3px)`: the moved box, and the spot it vacated | the atomic; the line's block |
| F7 | `opacity: 0` | the atomic (still hit) |
| F8 | `opacity: 0.5; pointer-events: none` | through it, to the line's block |
| F9 | two `opacity` atomics overlapping | the later one in tree order |
| F9b | a `position: relative` atomic, then an overlapping `opacity` atomic | the later one (the `opacity` atomic) |
| F9c | an `opacity` atomic, then an overlapping `position: relative` atomic | the later one (the positioned atomic) |
| F10 | rtl: an `opacity` atomic over the text on either side | the atomic |
| F11 | **notes shape**, at rest: the centre and the left edge of the button | the button |
| F12 | **notes shape**, pressed (`scale(0.97); opacity: 0.85`): the centre, and a point inside the scaled box | the button |
| F13 | notes shape, pressed: the layout box's left edge + 0.4px, outside the scaled box | the section, at every DPR |
| F13b | the same at the top edge + 0.4px | the section at DPR 2, 2.625 and 3; the button at DPR 1 |

F13b is the 1x1 px hit rect of Blink's point hit at DPR 1. The scaled top edge sits 0.78px below the layout top edge, inside the
rect. That is #650's existing transformed-location rule (`mappedLocation`), not a new fact.

**Conclusion:** an atomic inline that forms a stacking context paints and hits in the stacking context's z-index:auto/0 layer
phase (CSS 2.1 Appendix E step 8, Blink `PaintLayer` hit order). That puts it above every in-flow item of its line, the text before
and after included (F1, F2, F10), unlike a plain atomic inline (F2b). Among positioned boxes and other such atomics it follows
tree order (F9, F9b, F9c). Its geometry is its transformed box (F5, F6, F12, F13). Its children hit inside it (F4). `opacity: 0`
still hits (F7), and `pointer-events: none` passes through it (F8).

## Rule

The hit table already hits a stacking context as its own layer (`ownLayer`: `layer || context`, collected into `layers` in
preorder tree order, with #650's transform spaces), and #643's `lineHit` already skips an atomic that is its own layer. So the
slice is:

1. **Table** (`rt-hit.ts`): stop refusing an atomic inline on a line whose facts make it a stacking context or transform it
   (`contextAtomicRefusal`, in `boxNodes`, `replacedNode` and `hitFactsRefusal`). Such an atomic becomes a context node:
   - it sits at its line-placed rect, with its paint facts (`hitPaint`), as any context box;
   - `lineHit` keeps skipping it;
   - the layer pass hits it in preorder, after in-flow content;
   - its transform maps through #650's spaces;
   - its children are its subtree.

   It still counts toward its line's ink overflow, at its untransformed rect. That doesn't change any hit: a layer is tested
   before any line, and a line only reaches its text items.
2. **Compiler** (`interaction.ts` `hitUnmodelledBox`): stop naming INL2c for these atomics. The compiler and the table keep one
   definition (`hitFactContext`), and the agreement test (`atomic-inline-hit.test.ts`) pins it.
3. **Still refused, unchanged:**
   - a rotate (SELD-R2b);
   - a non-axis-aligned transform;
   - sticky and fixed boxes;
   - a transformed atomic with a fixed descendant (the existing `fixed inside a transformed box` refusal);
   - an atomic inline whose block has percentage padding (INL2a);
   - an inline `<iframe>` or `<video>` on a line (INL2d);
   - plain inline boxes (INL1a).

   Filters (`filter`) aren't in `hitFactContext`, and the compiler's paint-fact checks already refuse them for hit testing.

## Proof

- **Fixture `hit-atomic-inline-context`:** extended with F1 to F13. Captured with `parity:hit-capture` at DPR 1, 2, 2.625 and 3,
  ltr and rtl, matching Chrome at every captured point (hit-report).
- **Planted fault `contextNotLayered`:** already exists. It makes F2 and F9 fail.
- **Agreement test:** the compiler refuses exactly when the table refuses, over every fixture.
- **Notes:** `measure.ts --styles` on `/notes/[id]` no longer names INL2c. Shop `/cart` and checkin `/checkins/[id]` too.
- **Device-hit lane:** inherits, unrun on phones (stated, as for #643).

## Allowed files

- `packages/layout/src/rt-hit.ts`
- `packages/layout/test/rt-hit.test.ts`
- `packages/dragon/src/analysis/interaction.ts`
- `packages/dragon/src/project.ts`, the refusal text only
- `packages/dragon/test/interaction.test.ts`
- `packages/parity/fixtures/hit-atomic-inline-context.html`
- `packages/parity/src/fixture-groups/atomic-inline.ts`
- `packages/parity/test/atomic-inline-hit.test.ts`, `packages/parity/test/hit-refusals.ts`, `packages/parity/test/hit-report.test.ts`
- generated: hit captures and facts, vectors and native engines for the fixture (batch regen)
- this spec

## Open: the press ring (Judge amendment 1), stopped

`emit/runtime/interaction.ts` hits the press on the at-rest table and the release on the `:active` (scaled) table. Chrome 145 was
captured with real CDP touch taps (`Input.dispatchTouchEvent`, a touchStart then a touchEnd 60 ms later, `hasTouch`) on the notes
button. Its layout box is (77, 98, 246, 66), and `:active` is `scale(0.97); opacity: 0.85`. The results are identical at DPR 1, 2,
2.625 and 3:

| Release point | pointerdown | pointerup | click |
|---|---|---|---|
| centre (200, 131) | button | button | button |
| inside the left edge, in the ring (78.5, 131) | button | button | **section** |
| inside the top edge, in the ring (200, 98.6) | button | button | **button** |
| 3 px outside the layout box (74, 131) | button | button | **button** |

Chrome's click target comes from its gesture tap, with touch adjustment, not from a point hit. Touch adjustment is why a tap
outside the box still clicks the button, and why the left and top ring points disagree. The hit table models neither, so a release
in the ring doesn't match Chrome's tap target. Per the Judge's stop condition, the build stops here for a ruling: refuse the ring
by name, model Chrome's gesture-tap targeting, or scope the parity claim to point hits.
