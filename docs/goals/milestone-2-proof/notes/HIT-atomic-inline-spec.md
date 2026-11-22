# HIT-atomic-inline: hit testing an atomic inline on its line

Scope: the native hit table (`packages/layout/src/rt-hit.ts`) models an atomic inline (a box with display `inline-block`,
`inline-flex` or `inline-grid`, and an inline-level replaced element) that the engine places on a line of its block container's
inline formatting context, so the compiler's R13 check (`packages/dragon/src/analysis/interaction.ts`) no longer refuses
interaction rules beside one. The Markless notes app needs this: its empty-state section is
`<section><h1>…</h1><p>…</p><a class="button">Write your first note</a></section>` with an `inline-flex` button, and the button
takes `:active` and `:focus-visible` hits.

## Chrome 145 semantics

Blink paints and hit-tests an atomic inline atomically: like a stacking context for painting, all of its phases (its own
background, its block descendants' backgrounds, its foreground) are tested together, at its place in its line's items
(`BoxFragmentPainter::HitTestItemsChildren` reaching the box item, `HitTestChildBoxFragment`, `IsPaintedAtomically`, then
`HitTestAllPhases`). The line's items are tested last to first, so:

1. An atomic inline is above the text of its line that precedes it, and below the text that follows it.
2. Its children hit within its own subtree (an overflowing child still names itself, even outside the line box and the block).
3. The line box's area outside the atomic and its text hits the block (the line item, `HitTestLineBoxFragment`), in the
   foreground phase, so it is above a later sibling block's background. The line box spans the line's items from the first
   item's start to the last item's end, margins of an atomic inline included.
4. The line's items are tested only when the line's ink overflow holds the point; the ink overflow holds each atomic inline's
   border box and, unless it clips, its descendants'.
5. pointer-events and the clip of an atomic inline with overflow other than visible are the table's existing box rules.
   visibility, transforms and stacking contexts stay refused where the table already refuses them.

The point semantics are the table's existing ones: the point floored to 1/64 px, a 1x1 px box, exclusive intersection.

## Measured facts

Chrome 145.0.7632.6 through `launchChrome` (`packages/parity/src/chrome.ts`), `openPage` at 240x240 CSS px, DPR 1, Ahem 10px,
`document.elementFromPoint` on a 1 px grid sampled at x + 0.5, y + 0.5, then probed at single points. Blocks are 200px wide with
line-height 20px.

Inline-flex button alone in a block (`<section>` with `<h1>`, `<p>`, `<a class="button">` with padding 3px 6px): the button's
border box is (0, 42, 22, 16); every sample inside names `ab`, every sample outside on the line (x 22 to 200, y 39 to 59) names
the section. rtl: the button is at (218, 42, 22, 16) and the rest of the line names the section.

Inline-block between text (`aa<span ib 20x8>b</span>cc`): `bi` at (20, 64, 20, 8), its text `b` at (20, 69, 10, 10) overflows it
below; samples x 19 to 39, y 63 to 71 name `bi`, and the overflowing text names `bi` at x 19 to 29, y 72 to 78. At (39.5, 70) the
following text `cc` (40, 69) wins: the following text is above the atomic. rtl: `bi` at (200, 64), text `aa` at 180 and `cc` at 220.

Atomics over text through negative margins (`aaaa<ib margin-left -25px>bb<inline-flex margin-left -15px>cc<inline-grid
margin-right -15px>dd`): `c1` (15, 93, 20, 8) names itself over `aaaa` (0 to 40), so it is above the text before it; at
(34, 95) `c1`, at (34.2, 95) the block, because `bb` starts at 35 (35 < 34.2 + 1). `c2` (40, 93) names itself over `bb`, and
loses to `cc` from x 59.5 (`cc` at 60). `c3` (80, 93) names itself only at x 79 to 83: `dd` at 85 to 105 covers the rest of it.
rtl: the same order, the line placed at x 135 to 240 (`c1` 150, `c2` 175, `c3` 215; text at 135, 170, 195, 220).

An atomic with a child (`a<ib padding 4px><block 10x6></ib>b`): `d1` (10, 112, 18, 14), `d2` (14, 116, 10, 6): `d2` names
itself, `d1`'s padding names `d1`. `d4`, a child of `d3` with margin-top -12px, is at (38, 106, 10, 6), above its line box and
above its block (`d` starts at 112, over the previous block `c` to 108): every sample in it names `d4`, over `c` too.

Line box extent (`aa<ib margin-right 20px>` followed by a block `e2` with margin-top -20px overlapping it): `e1` at (20, 142,
20, 8); samples x 0 to 59, y 140 to 156 name `e` (its line box from 0 to 60, the margin included, and 137 to 157); from x 60 and
from y 157 they name `e2`.

Inline replaced (`aaa<img 20x12 margin -15px -15px>bbb`): the img at (15, 1, 20, 12), `bbb` at (20, 5): (16, 10) names the img
over `aaa`, (19.5, 10) the block (`bbb` over the img), (20, 3) the img above the text.

## Modelled and refused

Modelled: an inline-block, inline-flex or inline-grid box, and an inline-level replaced element, among the text and atomics of a
block container's inline formatting context, with its line placed by the engine's `placeLines` over the block's content box. The
table checks the engine's own fragments sit where those lines put them and refuses the case otherwise.

Still refused: a block whose own line holds an atomic inline and whose padding is a percentage (the table places the lines over
a content box it does not resolve percentages for; `paddingRefusal`, and the compiler's `hitUnmodelledBox` with
`holdsAtomicLine` names the same block), an atomic inline outside an inline formatting context (never built by the compiler), an
atomic inline inside an inline box (inline boxes are INL1a; the compiler rejects that layout anyway), a line whose items' visual
order is not their tree order (the engine refuses those rtl paragraphs itself; the table checks the pen runs on), and everything
the table refused before. The compiler keeps refusing an inline-grid box under R13 (`hitUnmodelledBox`, G-INL), which is stricter
than the table and unchanged here.

## Device-hit lane

The device-hit lane inherits these cases from the host hit lane's table and vectors; no phone job has run it on this branch, so its
device parity is inherited and unrun. Newly modelled cases: `hit-atomic-inline` and its rtl twin, and every atomic-inline fixture
case the table no longer refuses for an atomic inline (`atomic-inline-shrink`, `atomic-inline-north-star`, `atomic-inline-links`,
`atomic-inline-disclosure`, with their rtl twins where they exist; the others stay out for their `<br>`).

## Judge amendments

The Judge approved with amendments. A positioned atomic inline: `lineHit` skips an atomic that is its own layer, as `foreground`
does, so only the layer pass tests it; and none reaches the table today, as the engine refuses a positioned atomic inline
(`inline-box-position`, CSS2 §9.4.3) before the table is built, which `rt-hit.test.ts` pins. A Chrome capture of one waits on the
engine placing it. With a z-index it is also a stacking context, which the hit capture refuses (PNT1). The captures and the lanes
were rerun on a base carrying the padding-clip narrowing, with no local patch. Inline-grid stays refused under R13, plain inline
boxes and `<br>` under INL1a.
