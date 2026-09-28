# CSS Anchor Positioning in Dragon's layout engine: implementation plan

This is design work, 2026-09-28. Owner decision: docs/decisions.md, "Anchor positioning". Anchor positioning is an engine feature in `packages/layout`, translated to Swift and Kotlin. It is not an overlay adapter. It is sequenced after milestone 2, next to other layout-breadth work.

## How the work is split

- **Compiler.** It resolves everything it can decide from styles alone:
  - try-tactics;
  - logical and `self-*` keywords;
  - `inside`/`outside`;
  - wrong-axis anchor sides;
  - what an invalid function turns into.
- **Engine.** It decides everything that depends on the box tree or on geometry:
  - which anchor a name finds;
  - whether that anchor is acceptable;
  - anchor rectangles;
  - the position-area grid;
  - fallback trials;
  - overflow;
  - position-visibility;
  - scroll-compensation dependencies.

Anchor lookup is a pure tree algorithm, so it stays correct for runtime trees with conditional children.

## What the repo has today

**Engine** (`packages/layout/src`):
- `layoutWithFaults` (layout.ts) lays out every in-flow box first. Then `placeOutOfFlow` places absolutely positioned boxes from a queue that `flatten` builds.
- A box's own absolutely positioned children are queued before its descendants', and nested ones are appended at the end. That order is wrong for anchors (see §2.3).
- `layoutAbsolute` (position.ts) implements CSS2 §10.3.7 and §10.6.4. It has no justify-self/align-self for absolutely positioned boxes, and no scrollable-overflow rectangle.
- The input (input.ts) is horizontal-tb only. It has no `fixed`, no `calc()`, overflow is only visible or hidden, and nothing scrolls.

**Compiler:**
- `lower/ios-layout.ts` accepts only px, % and keywords.
- `css/stylesheet.ts` turns every function into `{kind:'other'}` and refuses every at-rule.
- Only html, body and div are supported, and only Ahem text.

**The translator subset**, as `subset.ts` and `lower.ts` actually enforce it:

| | |
|---|---|
| Banned | `Set`, `Object`, `Array` and `String` globals; `??`, `?.` and `%`; bitwise operators, `in` and `typeof`; optional fields or parameters; destructuring, except `for (const [k, v] of map)`; tuples; generic functions (refused, although native-strategy.md §1.2 lists them as allowed) |
| Array methods allowed | length, push, map, forEach, filter, find, some, flatMap, slice(start), reverse, sort(cmp) |
| Map methods allowed | get, has, set, for...of |
| Also allowed | closures that don't capture a `for` header binding; recursive discriminated unions |

**WPT at 375cf25:**
- 531 test `.html` files. 56 carry `data-expected-*` or `data-offset-*`; 44 of those load `support/test-common.js`, which only wraps `checkLayout`.
- `checkLayout` makes one subtest per matched node and also checks that node's parent.
- No Chromium expectation files are vendored, so every Chrome 145 behaviour below must be measured.

**Spec, WPT and Chrome disagree** in two places:
- **Anchor lookup.** The Editor's Draft picks "the nearest ancestor with the name, else the last in tree order". But `anchor-name-001.html` expects 30 for a target inside a 10px ancestor anchor. So the pinned WPT, and probably Chrome 145, use plain "last acceptable in tree order".
- **position-visibility.** The WPT parsing test expects the initial value `anchors-visible`, with combinable flags. The spec page showed a single keyword with initial `always`. Dragon follows WPT and Chrome.

## 1. Engine input (`packages/layout/src/input.ts`)

Every field is required, and there are no defaults. Where CSS would need a default (IACVT, `normal`), the compiler writes the result explicitly.

### 1.1 Anchor-bearing lengths

```ts
export type AnchorLength =
  | Px | Percent
  | { readonly kind: 'anchor'; readonly anchor: AnchorRef; readonly edge: AnchorEdge; readonly fallback: AnchorLength | null }
  | { readonly kind: 'anchor-size'; readonly anchor: AnchorRef; readonly dimension: 'width' | 'height'; readonly fallback: AnchorLength | null }
  | { readonly kind: 'sum'; readonly terms: readonly AnchorLength[] }
  | { readonly kind: 'product'; readonly factor: number; readonly term: AnchorLength };
export type AnchorRef = { readonly kind: 'default' } | { readonly kind: 'name'; readonly name: string };
export type AnchorEdge = { readonly percent: number; readonly from: 'physical' | 'containing-block' };
// Per property family (the subset refuses generics): { kind: 'anchored'; expr: AnchorLength; invalid: <plain value> }
```

- **New union members:**
  - `InsetValue` gains `AnchoredInset`.
  - `SizeValue`, `MinSizeValue`, `MaxSizeValue` and `MarginValue` gain an `Anchored…` form that allows `anchor-size` only.
- **Resolved by the compiler:**
  - `inside`/`outside`.
  - Physical sides become 0/100 `physical`, and `center` becomes 50.
  - `self-start`/`self-end` resolve with the element's own direction.
  - `anchor-size(inline|block|self-*)` becomes width or height. That holds only while Dragon is horizontal-tb; revisit it when writing-mode lands.
  - The implicit `anchor-size()` dimension is the property's axis.
- **Left for the engine:** `start`/`end`/% are passed as `containing-block`, because the engine decides the containing block's direction.
- **Statically invalid queries** are replaced by the fallback or by `invalid`. The validator refuses `anchored` on boxes that aren't absolutely positioned.
- **`inherit` of resolved anchor values** is refused with a diagnostic for now.

### 1.2 New `LayoutStyle` fields

| Field | Type | Compiler resolution |
|---|---|---|
| `anchorNames` | `readonly string[]` | idents in order; `[]` for `none` |
| `anchorScope` | none / all / names | verbatim |
| `positionAnchor` | none / name | `normal` becomes `none` without a position-area, else `auto`. `auto` becomes `none`, because Dragon has no implicit-anchor sources. `match-parent` is refused until it is measured |
| `positionArea` | none / area `{x: AreaSpan; y: AreaSpan}` | `AreaSpan = {first: 0|1|2; last: 0|1|2; from}`; keywords expanded; `self-*` resolved |
| `justifySelf` | normal, start, end, center, stretch, left, right, anchor-center | new longhand; `place-self` shorthand |
| `alignSelf` | existing type plus anchor-center | now read for absolutely positioned boxes too |
| `positionTryOrder` | normal, most-width, most-height | logical values become physical |
| `positionTryOptions` | `readonly TryStyle[]` | §1.3 |
| `positionVisibility` | `{anchorsValid; anchorsVisible; noOverflow}` | `always` is all false; initial is `anchors-visible` (WPT) |

The compiler also adds these shorthands and longhands:
- `inset`;
- `inset-inline` and `inset-block`, with their longhands (logical property groups);
- `margin-inline` and `margin-block`;
- `place-self`.

### 1.3 `@position-try`, fallbacks and tactics are resolved by the compiler

A `TryStyle` holds these properties: insets, margins, sizes, min and max sizes, justifySelf, alignSelf, positionAnchor and positionArea.

- **Building each option.** An option is the base style overridden by its rule, using the position-try origin, which author `!important` still beats.
- **Tactics are applied to computed values.** The engine never sees a tactic.
  - `flip-block` swaps top and bottom insets and margins, maps anchor edges to `100 − p` in y, swaps align start and end, and mirrors the y span.
  - `flip-inline` does the same in x.
  - `flip-start` swaps the axes.
  - `flip-x` and `flip-y` equal inline and block in horizontal-tb.
- **`@position-try` stops being a refused at-rule.** A descriptor outside the accepted list is diagnosed.
- **`var()` in rules** waits for custom properties.

### 1.4 Output

`LayoutResult` gains `anchored: readonly AnchoredOutcome[]`, where each outcome has:
- `id`;
- `defaultAnchor` (string or null);
- `option` (−1 for the base style);
- `hidden`;
- the used `margins`;
- `scrollShiftX` and `scrollShiftY`, the lists of scroll containers.

This changes the vector file format and needs an owner decision, like D2. Every existing vector gets `anchored: []` and byte-identical `output`.

### 1.5 Zoom

`zoomStyle` must zoom the px inside `AnchorLength` recursively, and inside every `TryStyle`. If it doesn't, DPR 2, 3 and 2.625 break silently. The planted fault `anchorExprUnzoomed` covers this.

## 2. Engine algorithm (new `anchor.ts`; changes to `layout.ts` and `position.ts`)

### 2.1 Indexes

These are built once per layout with a preorder walk, using Map only:
- `order`;
- `parentOf`;
- `cbOf`: an in-flow box's parent, or an absolutely positioned box's nearest positioned ancestor, or null for the initial containing block;
- `byName`: box ids for each anchor name, in tree order.

### 2.2 Lookup

`targetAnchor(ref, T)`:
- `default` resolves to T's default anchor for the active option.
- A name walks `byName` from last to first and returns the first acceptable box. The ancestor-first rule sits behind a spec-reading fault until it is measured.

`acceptable(A, T)`:
1. A is not T, and not inside T.
2. **Scope.** For each name that matched:
   - every ancestor-or-self of A whose scope covers the name must contain T;
   - every ancestor of T whose scope covers the name must contain A.
3. **Laid out strictly before T:**
   ```
   E = A
   loop {
     if E === T: return false
     C = cbOf(E)
     if C === cbOf(T): return E.position !== 'absolute' || order(E) < order(T)
     if C === null: return false
     E = C
   }
   ```

This reproduces anchor-name-002 and -003.

### 2.3 Ordering

The queue is replaced with a post-order walk over containing blocks:

```
process(X):
  for each in-flow positioned R whose first containing block is X, in tree order: process(R)
  for each absolutely positioned P with cbOf(P) === X, in tree order: place(P); process(P)
```

- **Invariant:** if A is acceptable for T, A is placed before T. Reading a missing anchor rectangle throws an internal `Error`; it never reads 0.
- **Output order doesn't change:** placements go into a map and are emitted in the current order, so existing vectors stay byte-identical.

### 2.4 `place(T)`

1. **Options:** `[base, ...positionTryOptions]`.
   - `most-width`/`most-height` sort the options, stably and largest first, by the size of their inset-modified containing block (IMCB). Auto insets count as 0, and position-area is applied.
   - Whether the base style is sorted must be measured.
2. **Evaluating an option:**
   - **(a) Default anchor.**
   - **(b) Containing block.** Start from the padding box.
     - If the containing-block element is a scroll container and there is a valid default anchor, use its scrollable-overflow rectangle instead.
     - A position-area with a default anchor turns the containing block into the grid area.
       - Lines are `min(cbStart, aStart), aStart, aEnd, max(cbEnd, aEnd)` in each axis.
       - A span covers `[line(first), line(last + 1)]`.
       - In an rtl containing block, x is flipped when `from` is `containing-block`.
       - Auto insets and auto margins become 0.
   - **(c) Anchor lengths.** Each is evaluated in LU against the anchor's border box, relative to the containing block:
     - `left = aX + p·aW − cb.x`
     - `right = cb.x + cb.w − (aX + p·aW)`
     - top and bottom are the same in y.
     - In an rtl containing block, `p' = 100 − p` in x.
     - `anchor-size` gives the border-box width or height.
     - A missing anchor uses the fallback, else `invalid`, and records `anchorsValid`.
     - `sum` and `product` combine the results; the rounding must be measured.
   - **(d) Place it.** The result is a plain `LayoutStyle`, passed to `layoutAbsolute` extended with self-alignment.
     - `normal` keeps today's CSS2 behaviour when there's no position-area.
     - Under a position-area, `normal` becomes:
       - `center` for the centre track only;
       - `anchor-center` for all three tracks;
       - otherwise, alignment toward the anchor.
     - `anchor-center` sizes from the full IMCB, centres on the anchor, then clamps into the IMCB. anchor-center-htb-htb expects 0, then 35, then 15.
   - **(e) Fits** when the margin box lies inside the IMCB and the IMCB lies inside the scroll-adjusted containing block.
3. The first option that fits wins. If none fits, use the base style.
4. **Visibility.** A box becomes hidden if any of these is set and fails:
   - `noOverflow`: the same fit predicate;
   - `anchorsValid`: a query had no target;
   - `anchorsVisible`: the default anchor is missing, or fully clipped by an overflow-hidden ancestor.

   Geometry is still reported.

**Fitting the subset:**
- plain recursion;
- Map in place of Set;
- `sort(cmp)` with an index tiebreak;
- `T | null` instead of optional values;
- no generics;
- names compared with `===`.

New refusals are added to `UnsupportedCode`.

### 2.5 Scroll compensation (minimal version)

Dragon doesn't scroll yet, so today the snapshot equals the layout.

1. **Engine.** For each anchored box it records which axes compensate. An axis compensates when there is a default anchor and:
   - a position-area is set;
   - or `anchor-center` is used;
   - or an `anchor()` in that axis resolves against the default anchor.

   It emits the scroll containers between the anchor and T's containing block, innermost first, not including the containing block itself.
2. **Runtime helper.** A pure function, `scrollShift(outcome, offsets): Point`, returns `−Σ(offset − remembered)`. It is written in the subset and translated. Native code applies it as a translation without re-layout.
3. **Later:** re-running fallbacks on scroll, and "last successful option" memory. If that memory is added, it is an explicit input map, never hidden state.

The WPT `anchor-scroll-*` tests are out of scope until real scrolling exists.

## 3. Phasing: which WPT numeric tests each phase unblocks

Of the 56 numeric tests:
- 15 become runnable;
- 17 have their anchor logic built, but stay blocked by other missing features;
- 24 are blocked outside anchor work.

**P0 (prerequisites, no WPT test on its own):**
- a numeric-WPT runner (packages/wpt);
- structured `anchor()`, `anchor-size()` and `calc()` values in the compiler, including unterminated functions at the end of a `style` attribute;
- the new longhands and shorthands, with profile rows;
- a diagnostic for a missing anchor name;
- the Chrome 145 measurements in §5.

**P1: `anchor-name`, `position-anchor`, whole-value `anchor()`/`anchor-size()`, lookup, acceptability, layout order, fallbacks, IACVT, logical insets, `anchor-scope`**

anchor-scope is proven by parity fixtures only.

| Test | Needs |
|---|---|
| anchor-position-001 | four `anchor()` insets, two anchors |
| anchor-name-001 | `anchor-size`; last in tree order (depends on the lookup measurement) |
| anchor-name-002 | containing-block chain acceptability |
| anchor-name-003 | the full chain; absolutely positioned vs in-flow tree order |
| anchor-name-004 | multiple names, px fallback |
| anchor-size-001 | `anchor-size` in sizes, insets and margins; the margin checks need `margins`; unterminated-function parsing |
| anchor-size-minmax-001 | `anchor-size` in min/max |
| anchor-inside-outside | default anchor, inside/outside, logical insets |

**P2: `calc()` with anchor terms, and chains**
- Unblocked: anchor-query-fallback.
- Blocked: anchor-function-chain and anchor-size-function-chain (need `<p>` and non-Ahem text); pseudo-element-anchor-tree-order (needs `::before`/`::after`).

**P3: `position-area` and self-alignment for absolutely positioned boxes, `anchor-center`**
- Unblocked: anchor-in-anchor-positioned.
- Blocked:

| Tests | Missing |
|---|---|
| position-area-chain, mixed-dependency-chain | `<p>` and non-Ahem text |
| anchor-center-003, -004 | `position: fixed` |
| anchor-center-htb-htb | `::after` text |
| anchor-center-htb-vrl, -vrl-htb, -vrl-vrl | writing-mode |
| anchor-in-popover | popover |

A small addition, `position: fixed` against the initial containing block with no scrolling, would unblock anchor-center-003, anchor-center-004 and anchor-name-008.

**P4: `position-try-fallbacks`, `@position-try`, tactics, `position-try-order`, `position-visibility`**
- Unblocked: position-try-001 (all six branches), position-try-004 (margins), position-try-position-anchor.
- Blocked:

| Test | Missing |
|---|---|
| position-try-002 | transform, span with inline-block, `min-content` |
| position-try-003 | transform, writing-mode |
| position-try-custom-property | `var()` |
| position-try-grid-001 | grid |

- position-visibility is proven by parity fixtures that probe with `elementFromPoint`.

**P5: the scrollable containing block, scroll-shift dependencies, and the anchors-visible clip test**
- Unblocked: scrollable-containing-block-validity, scrollable-containing-block-position-area.
- Blocked: scrollable-containing-block-size (its grid and `translate` cases). Whether relative offsets are included must be measured.

**Blocked outside anchor work (24 tests):**

| Missing | Tests |
|---|---|
| `position: fixed` | anchor-name-008 |
| transform | anchor-position-002, -003, anchor-position-borders-001 |
| writing-mode | anchor-position-004, anchor-size-writing-modes-001 |
| `<img>`, `aspect-ratio` | anchor-size-replaced-001 |
| inline span anchors, `<br>` | anchor-position-inline-001 to -003, anchor-name-inline-001 |
| multicol | anchor-name-multicol-001, -002; anchor-position-multicol-001, -005, -006; anchor-position-multicol-colspan-001, -002; anchor-position-grid-001 |
| dialog and top layer | anchor-position-top-layer-007 |
| inheriting resolved values | anchor-inherited |
| script-driven state changes | anchor-position-dynamic-001, -002, -004 |

The WPT runner could map the dynamic tests onto Dragon's finite states.

## 4. Proof plan

**4.1 Parity fixtures against Chrome 145.** Div and Ahem fixtures, each with an rtl twin, must match exactly at 1/64 px, at DPR 1, 2, 3 and 2.625.

| Area | Fixtures |
|---|---|
| Lookup and scope | tree order, containing-block chain, the ancestor rule, and anchor-scope `all`, `names` and nested |
| Edges and sizes | rtl edges, fractional sizes, anchor-size in margins, every `invalid` branch, calc rounding, chains |
| position-area | all nine cells and spans, ltr and rtl, an anchor partly outside the containing block; defaults and the clamp |
| anchor-center | div children in place of `::after` text |
| Fallbacks | each option index and "none fits", try order, each tactic |
| Scrollable containing block | block and flex, with and without relative shift |
| Visibility | one fixture per flag, a zero-size anchor, a clipped anchor, all probed with `elementFromPoint` |

Chrome deviations go into `chrome-deviations.ts`, each with a spec-reading fault. The likely ones are the ancestor lookup, the position-visibility initial value, and whether try-order sorts the base style.

**4.2 WPT.** Per-target expectations:
- A Chrome-caused failure is recorded with its deviation id.
- A test blocked by a missing feature is listed with that feature.
- Nothing passes silently.

**4.3 Swift and Kotlin.**
- The harness's JSON reader and writer learn the new input types and `AnchoredOutcome`.
- The vectors are regenerated.
- The corpus generator gets:
  - random names, including duplicates;
  - random absolute and relative nesting;
  - anchored lengths with fallbacks and calc;
  - areas;
  - 0 to 4 try options with random orders;
  - visibility flags.
- It also gets unit suites for the pure functions.
- The subset check stays clean. Map order matters for `byName`, and the `unordered-map` fault guards it.

**4.4 Planted faults.** Each must make at least one fixture non-exact.

| Fault | What it breaks |
|---|---|
| anchorFirstInTreeOrder | picks the first acceptable anchor, not the last |
| anchorIgnoresLaterAbspos | accepts a later absolutely positioned anchor in the same containing block |
| anchorCbChainSkipped | skips the containing-block chain walk |
| anchorScopeIgnored | ignores `anchor-scope` |
| absposQueueOrder | keeps the old queue order |
| anchorContentBox | uses the content box, not the border box |
| anchorPercentPhysical | ignores rtl for start, end and % |
| anchorExprUnzoomed | leaves expression px unzoomed |
| invalidAsZero | IACVT becomes 0 instead of `invalid` |
| areaNoDefaultAlign | `normal` stays `start` under position-area |
| anchorCenterUnclamped | no overflow clamp |
| tryFitBorderBox | ignores margins in the fit test |
| tryFitNoImcbCheck | skips the IMCB-inside-containing-block check |
| scrollShiftIncludesCb | includes the containing block in the shift list |

Compiler faults:
- `tacticNoAnchorSwap`: flip-block leaves `anchor()` sides alone;
- `tryRuleDropsBase`: an option loses base properties its rule doesn't declare.

There is also a type-level test: a `LayoutStyle` missing `positionVisibility` must not typecheck.

## 5. Risks and open questions

1. **Lookup rule.** Spec and WPT disagree; measure Chrome 145.
2. **position-visibility.**
   - The initial value `anchors-visible` means every anchored box needs a clip test by default, and zero-size anchors may count as clipped.
   - It is unknown whether hidden boxes keep their geometry.
3. **Chrome fit and order details to measure:**
   - the fit predicate at the edges (the IMCB outside the containing block, or negative);
   - whether try-order sorts the base style;
   - whether the anchor-center clamp targets the IMCB or the containing block;
   - the position-area overflow rules;
   - LayoutUnit rounding of anchor percentages and calc division;
   - whether the scrollable containing block includes relative offsets.
4. **The vector format change** needs owner approval.
5. **Chrome 145 feature status:** `position-anchor: normal`, `match-parent` and `anchor-scope`. They are refused until measured.
6. **Scoped names.** Are anchor names document-global or scoped per component? That's a product decision.
7. **Values that need layout inside the compiler:** `inherit`, `match-parent` and `var()` in rules.
8. **Scrolling.** Only the dependency output and the pure shift function exist. Fallbacks aren't re-run on scroll, and there is no remembered option or overflow scroll.
9. **Cost.** N try options mean N subtree layouts. Measure it on native.
10. **Subset friction.** Generics are refused. native-strategy.md §1.2 is out of date on this.
11. **Missing prerequisites.** Fixed positioning, transforms, writing modes, multicol, inline boxes, `<p>`/`<span>`/`<img>` and non-Ahem text block 41 of the 56 numeric tests.
12. **Sequencing.** After milestone 2, alongside grid. P5 shares scroll and overflow machinery with that work.

## Critical files

- packages/layout/src/input.ts, layout.ts, position.ts (new anchor.ts)
- packages/dragon/src/lower/ios-layout.ts, css/stylesheet.ts, css/properties.ts
- packages/translate/src/subset.ts, packages/translate/harness/harness.ts

## Appendix: Chrome 145.0.7632.6 measurements (2026-09-28)

These answer §5 with 302 probes, run with the parity flags, DPR handling and Ahem. The probe HTML and values were in /tmp/anchor-measure/results.json at the time; turn each probe into a parity fixture when building.

1. **Anchor lookup:** Chrome picks the last acceptable anchor in tree order. There is no ancestor-first rule, so §2.2 stands, and the Editor's Draft rule is a Chrome deviation.
2. **position-visibility:**
   - The initial value is `anchors-visible`. The valid values are `always`, `anchors-visible`, `no-overflow` and `anchors-visible no-overflow`.
   - **`anchors-valid` is unsupported:** any value containing it is dropped, and a missing anchor never hides anything. Refuse it, or record a deviation.
   - **Hidden boxes keep their geometry** (rect, offsets, the parent's scrollWidth). Only hit-testing and paint drop the box and its whole subtree. Parity must detect it with `elementFromPoint`.
   - **Which boxes it can hide:** only boxes positioned against their default anchor, meaning `anchor()` resolving to it, `position-area` or `anchor-center`. Static insets, `anchor-size()` alone, or `anchor()` naming another anchor are never hidden.
   - **Which clippers count:** only overflow-clipping ancestors between the anchor and the target's containing block. The containing block itself and the viewport don't.
   - **Visibility test:** a non-empty anchor needs positive-area overlap with the clip rect, so touching the edge from outside hides the target. A zero-size anchor is hidden only when it lies strictly outside; on the edge or corner it stays visible. An anchor with `visibility:hidden` also hides the target.
3. **position-try-order:** it sorts the base style together with the fallbacks, stable and largest first. The first option that fits wins.
4. **Fit test:** the only test is margin box inside the IMCB, exact in LU with inclusive edges. There is **no** "IMCB inside the containing block" clause: drop it from §2.4(e) or record a deviation. A negative IMCB never fits; a zero IMCB with a zero-size box fits. If nothing fits, the base style is used.
5. **anchor-center:** clamps into the IMCB, as §2.4(d) says.
6. **position-area overflow:**
   - A box larger than its area is shifted to stay inside the outer grid extent `[min(cbStart,aStart), max(cbEnd,aEnd)]`, which may lie outside the containing block.
   - A box larger than the extent goes to its inline-start edge.
   - Logical keywords flip in rtl, and mixing physical and logical keywords is invalid.
   - Without a default anchor, position-area still sets auto insets to 0 and applies its default alignment against the whole containing block.
7. **Rounding, with z = 64 × DPR:**
   - specified lengths are `trunc(px × z)`;
   - an `anchor(p%)` edge is `anchorStart + floor(p × anchorSize + 0.5)` in LU, rounded **before** entering `calc()`;
   - `anchor-size()` is the exact LU size;
   - `calc()` is evaluated in float and the final length truncated toward zero;
   - `right` and `bottom` use the same rounded edge.

   This matches all 63 measured values at DPR 1, 2 and 2.625.
8. **Scrollable containing block:** it excludes relative offsets, and applies only when there is a default anchor.
9. **Feature status in Chrome 145:**
   - **Unsupported:** `position-anchor: normal` and `match-parent` (both dropped); the old `position-try-options` and `inset-area` names; `anchor-size()` in padding; `anchor()` in width.
   - **Supported:** `anchor-scope`; `position-try-fallbacks` and the `position-try` shorthand; `anchor-size()` in margins and insets; `inside`/`outside`.
   - **`@position-try`:** keeps insets, margins, sizes, the self-alignment properties, position-anchor and position-area. It drops `position`, `color`, `padding` and `position-try-fallbacks`, and any `!important` declaration is invalid.
10. **Tree scopes:** anchor names are strictly per tree scope. The exceptions are `::part()` from the document and `:host` rules inside the shadow root. Chrome fails WPT anchor-name-shadow-higher-tree. So per-component scoping matches Chrome.

**Chrome deviations to register:**
- the ancestor-first lookup (Q1);
- `anchors-valid` unsupported (Q2);
- no "IMCB inside the containing block" fit clause (Q4);
- stricter tree scoping (Q10);
- `position-anchor: normal` and `match-parent` unsupported (Q9).
