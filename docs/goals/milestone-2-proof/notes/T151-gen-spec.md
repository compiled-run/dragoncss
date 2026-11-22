# T151 Judge: GEN, generated content (::before/::after) and list markers

Judge, read-only, 2026-10-03. Binding worker spec. Nothing in the repo was changed.

**Read.**
- AGENTS.md; docs/goals/milestone-2-proof/goal.md; docs/goals/milestone-1/goal.md (design principles); docs/research/coverage-roadmap.md (GEN row, §4); docs/decisions.md; docs/ports.md.
- state.yaml (T151, T019, T058, T059, T083/T084, T133, T147-T149, T155) and notes/PM-2026-10-01.md.
- notes/T044-inl-spec.md (shape and verify block S), T045, T046, T058-inl1a.md, T059J-inl2.md.

**Code read.**
- master 0d04dc09a5.
- inl1a-lowering (INL1a C2) afec4d619 in /tmp/dragon-c2: resolve.ts, computed-checks.ts, selectors.ts, capture.ts.
- form-a4-v2 14a12e7836 in /tmp/dragon-forma4-v2: FORM-a A4's `Selector.pseudoElement`, `partSelectorMatches`, `CascadePart`, `partElement`, `rangeStyledParts` in web-css.ts, and `captureRangeParts` in capture.ts.
- examples/music-player (styles.css, tree, north-star-check.json).
- The Tailwind 4.3.3 preflight.css in node_modules.

**Chrome 145.0.7632.6 source, fetched at the tag.**
- list/list_marker.cc, list/unpositioned_list_marker.cc, list/layout_outside_list_marker.cc, list/layout_list_item.cc, list_item_ordinal.cc, counter_style.cc, counter_style_map.cc, inline/inline_node.cc, block_layout_algorithm.cc, block_node.cc, paint/text_fragment_painter.cc, counters_attachment_context.cc, computed_style_utils.cc: BSD ("The Chromium Authors").
- html.css, style_adjuster.cc, layout_quote.cc, layout_counter.cc: LGPL, so class A (reference only).
- pseudo_element.cc: BSD-google.

**Chrome probes run.** Pinned Playwright Chrome 145.0.7632.6 with the parity flags and Ahem, in /tmp/t151probe (probe*.mjs, cases*.json; not committed; GEN-P recreates them). Every probe ran under /tmp/heavy-lease.sh.

**Usage.** Fetched from chromestatus.com/data/csspopularity on 2026-10-02:

| Property | Rank | Share |
|---|---|---|
| content | #37 | 80.7% |
| list-style | #71 | 66.4% |
| list-style-type | #109 | 46.6% |
| list-style-position | #293 | 10.9% |
| counter-increment | #295 | 10.8% |
| counter-reset | #326 | 8.7% |
| quotes | #337 | 8.0% |
| list-style-image | #370 | 5.3% |

`::before` is on 41% of pages and `::after` on 38% (T015).

**Existing branches.** None for GEN (`git branch -a | grep -i -E "gen|list|marker|pseudo|content|before"` is empty). What to reuse:
- **FORM-a A4.** The pseudo-element selector plumbing (`Selector.pseudoElement`, `partSelectorMatches`, `CascadePart`), the synthetic part elements in `resolveTree` (`partElement`), the per-class `::pseudo` web rules (`rangeStyledParts`), and the CDP part capture (`captureRangeParts`).
- **INL1a C2.** `collapseInlineContext` and the inline box and InlineBox lowering.
- **INL-P** (docs/research/inline-spike). The probe corpus layout.
- **SKIA-AA** (paint-aa.ts on master): the SkPath oval and the SkPathStroker.
- **SIZE-ar and INL2b.** The additive longhand migration checkers (scripts/check-aspect-ratio-migration.ts and the planned check-vertical-align-migration.ts).

## 1. Findings that shape the packages

1. **Dragon refuses every pseudo-element selector today** (selectors.ts `PseudoElementSelector` branch). That includes the first rule of the Tailwind 4 preflight, `*, ::after, ::before, ::backdrop, ::file-selector-button { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid }`, and the modern-normalize equivalent. So every stylesheet built on them fails at its first rule, although none of those rules generates a box (none sets `content`). The preflight's `ol, ul, menu { list-style: none }` hits the second refusal: `display: list-item` is refused on every target (computed-checks.ts checkUserAgentDefaults, pinned by block-elements.test.ts:120). Accepting these two preflight rules is the largest practical gain in this package, and needs no layout.
2. **FORM-a A4 already built the machinery GEN needs.** A pseudo-element ends its selector and adds [0,0,1] to the specificity. The part cascades only its own pseudo-element's rules on the host's chain. The part is a synthetic element visited as a child in `resolveTree`. Web output writes `.cls::pseudo { every longhand }`. The capture reads the parts through CDP (DOM.getDocument, DOM.getBoxModel, CSS.getComputedStyleForNode). GEN widens `RangePart` to a pseudo-element union and adds `before` and `after`. So GEN must base after FORM-a A4, or it re-implements and conflicts with FORM-a.
3. **A generated box behaves exactly like an element in the box tree** (CSS2 §12.1; Chrome probe):
   - an inline `::before` is an inline box whose text sits in the host's inline formatting context;
   - in a flex container it is blockified (computed `block`, a flex item, its width honoured);
   - absolutely positioned, it is `block`.

   So once INL1a has landed, `::before` and `::after` need no engine change. Every support row and refusal of an element with the same display, position and context applies as it stands.
4. **White space collapses across the generated-text boundary.** `::before{content:'x  '}` + `"  m  "` + `::after{content:'  y'}` lays out as "x m y", 80 px of Ahem 16 (probe whitespace-collapse). A `\A` without preserving white-space collapses to a space ("a b", 48 px). Generated text therefore has to enter resolve.ts's inline-context collapse, not be collapsed on its own.
5. **The computed `content` value (probe content-values, before-none, content-on-element):**

   | Declared | On `::before` / `::after` | On an element |
   |---|---|---|
   | `normal` | `none` | `normal` |
   | `none` | `none` | `normal` (it has no effect on an element) |
   | `'a' 'b'` | `"ab"` | `"zzz"` is kept as specified, with no layout or paint effect |
   | `'a' / 'alt'` | `"a" / "alt"` | |
   | `counter(x)` | renders "0" | |
   | `attr(data-x)` | the value | |
   | `open-quote` | renders “ | |
   | `url()` | an image box | |

   On ::before and ::after, `content: ''` generates a zero-size inline box.
6. **Which elements generate `::before` (probe before-on-void):**
   - **None:** img, a text input, select, textarea, iframe, br. Body's own `::before{content:none}` does not either.
   - **One:** `input[type=range]`, `input[type=checkbox]`, button, hr and html (the root's `::before` precedes body).
7. **Capture.**
   - DOM.getBoxModel on a pseudo node gives the exact CSS-px border quad at every DPR. For a two-line inline `::before` it is the union rect: [0,0,64,0,64,32,0,32], which equals what getBoundingClientRect reports for an inline span.
   - Generated text has no DOM node, so a Range cannot reach it.
   - DOMSnapshot.captureSnapshot textBoxes give it in device px. Divided by the DPR, they equal the Range client rects of real text to within 1.0e-5 CSS px at DPR 1, 2, 3 and 2.625 (probe4: 9 lines per DPR).
   - DOMSnapshot *layout* bounds are device px and lose float32 detail, so boxes come from getBoxModel, never from the snapshot.
8. **List markers (probes cases2 and probe3).**

   **Geometry.**
   - An outside marker's computed display is `inline-block`; an inside one is `inline`.
   - Symbol markers (disc, circle, square) are **painted shapes**. Their inline size is `WidthOfSymbol = (ascent*2/3 + 1)/2 + 2`, in integer arithmetic on the primary font's rounded ascent (list_marker.cc:345-361). inline_node.cc:1546-1557 replaces the shaped "• " with a space run of that width. No glyph of U+2022, U+25E6 or U+25A0 is ever measured or drawn.
   - Outside margins come from list_marker.cc:394-432:
     - symbols: start `-(ascent*2/3) - 7 - 1`;
     - text and strings: start `-width`.
   - The offset is taken from the list item's **border box** (unpositioned_list_marker.cc:30-45).

   **DPR.** Chrome lays out at zoom = DPR, so the ascent is rounded in device px, and the 7 and the 1 are **device px, unzoomed**. A 16 px disc is 6 CSS px wide at DPR 1 and 13/2.625 = 4.95 CSS px at 2.625. The prediction `asc = floor(0.8*size*dpr + 0.5)`, `x = padding*dpr - floor(asc*2/3) - 8`, `w = floor((floor(asc*2/3)+1)/2) + 2` matches 48/48 markers: sizes 10, 13, 16, 17.3, 23.3 and 33.33, disc and square, at DPR 1, 2, 3 and 2.625.

   **Painting** (text_fragment_painter.cc:173-215):
   - the rect is `RelativeSymbolMarkerRect` (list_marker.cc:434-458): x 1, y `3*(ascent - ascent*2/3)/2`, size `(ascent*2/3+1)/2`, pixel-snapped;
   - disc: FillEllipse;
   - circle: StrokeEllipse at 1.0 (device px under zoom-for-DSF);
   - square: FillRect.

   **Text markers.** Decimal "1. " is three glyphs (48 px at Ahem 16), at x = -8 in a 40 px padding. String types are taken verbatim; `">> "` is 48 px.

   **Alignment.**
   - The marker aligns with the first line box's baseline, or with the first child's first baseline, down through nested blocks (block_layout_algorithm.cc:3748-3799, unpositioned_list_marker.cc:47-111).
   - When the marker's ascent is larger, the content is pushed down (li 29 tall, text at y+13).
   - An item with no line boxes top-aligns the marker and grows to its height: an empty `div{display:list-item}` is 16 tall.

   **Other observations.**
   - An li in a flex ul stays `list-item` and keeps its marker.
   - rtl symbol markers mirror (x = right edge + 16 - width).
   - rtl decimal markers are bidi-reordered into two text boxes.
   - `list-style-type: none` generates **no marker node**, and an empty `display:list-item; list-style:none` is 0 tall, exactly like a block.
9. **Ordinals and counters.**
   - ol `start` and `reversed` and li `value` follow list_item_ordinal.cc (BSD): reversed starts at the item count, and items after `value=100` continue at 101.
   - A `div{display:list-item}` continues the body-scope list-item counter: "2." after an earlier list-item div.
   - The counter styles' text comes from counter_style.cc (BSD).
   - Quotes come from layout_quote.cc, which is LGPL, so class A (spec plus observation).
   - Counters come from counters_attachment_context.cc (BSD).
10. **Music-player north star.** No pseudo-element other than `::-webkit-slider-thumb` and `::-webkit-scrollbar*` (owned by FORM-a and OVFL-s), no `content`, no list. **The north-star delta of every GEN package is 0** (§6).
11. **Pinned tests.** The PR changing each test lists it in its receipt.
    - packages/dragon/test/selectors.test.ts:59-60 (`.a::before` and `.a::after` as precise refusals);
    - packages/parity/fixtures/reject-selector-pseudo-element.html (`.a::before { width: 20px }`, which becomes an accepted rule that generates nothing);
    - packages/dragon/test/block-elements.test.ts:120 (UA `display: list-item` refused);
    - packages/dragon/test/ua-elb2.test.ts:40 (`userAgentUnmodelled.ol['list-style-type']`; it becomes a declared UA value once list-style-type is a longhand).
    - packages/wpt/test/translate.test.ts:128 keeps `.x::before` only as data, and packages/tailwind-sweep/test/units.test.ts:23 asserts the sweep sheet has no `::before`. Neither changes.

## 2. Rulings (research-backed; the PM records them)

**R1. The split.**

| Package | Scope | Files |
|---|---|---|
| GEN-P | Probe corpus and Blink notes | New files only; starts now |
| GEN-b | `content` and `list-style-*` longhands; list items whose marker generates no box | Compiler only |
| GEN-a | `::before` and `::after` with string content, as build-time elements | Compiler and capture; no engine change |
| GEN-c | Outside list markers: symbol and text markers, ordinals, a handful of counter styles | Engine, compiler and native paint |
| GEN-d family | Later, each with its own Judge amendment (R15) | |

The GEN-d family:
- `counter()` and `counters()` with counter-reset, -increment and -set (d1);
- quotes (d2);
- `attr()` (d3);
- `url()` and images in content, and `list-style-image` (d4, after REPL-a assets);
- alt text after `/` (d5, with P6b);
- `::marker` styling and `content` on it, and inside markers (d6, after INL1b);
- nested-list UA contexts (d7, ua lane);
- generated content that differs between states or bands (d8, with DTXT/SOV);
- abspos generated boxes beside text (POSX-IFC, engine lane).

GEN-b goes first because it is small and independent of INL1a, and it carries the one capture-wide longhand migration for all four new longhands. That keeps GEN-a's diff free of migration churn.

**R2. Generated boxes are elements of the resolved tree.**
- **How they are built.** In `resolveTree`, a host whose `::before` (or `::after`) computes to a box gets a synthetic `LinkedElement`: address `<host address>::before`, `node` and `owner` of the host, no classes, no attributes. It is visited as the host's **first** child (or, for `::after`, its **last**), with the FORM-a A4 `part` path. Its UA defaults are the unstyled key (span's tables: html.css has no `::before` or `::after` rule except `q::before`, and q is unsupported).
- **One text child.** The resolved element has one `ResolvedText` child: the joined string, node address `<host>::before:text0`. It is omitted when the string is empty.
- **No change downstream.** Every later stage (computed-checks, contexts, profiles, ios-layout lowering, native program, emitters, expected dump, device dump) treats it as an element, and no engine file changes in GEN-a. This follows the design principle "Resolve every style for every state at build time" (milestone-1 #1) and the roadmap's "::before/::after as build-time child nodes" (T015 row 24).

**R3. When a box is generated** (css-content-3 §2, css-pseudo-4 §4; finding 5 is the Chrome evidence):
- A `::before` or `::after` box exists iff its computed `content` is a string list (empty included) and its computed display is not `none`.
- `content: normal` computes to `none` on these pseudo-elements.
- On elements, `none` computes to `normal`. Strings stay as specified and have no effect.
- Adjacent strings join into one computed string. The serialization equals Chrome's, and chrome-dual proves it.
- **Refused**, with `DRAGON_UNSUPPORTED_VALUE` at the `content` declaration, message `content: <value> on <address> is not supported yet: <reason> (<owner>)`:
  - `counter()` and `counters()`: counter scopes (GEN-d1);
  - `open-quote`, `close-quote`, `no-open-quote` and `no-close-quote`: quote depth and the `quotes` table (GEN-d2);
  - `attr()` (GEN-d3);
  - `url()` and `image-set()`: an image in content (GEN-d4);
  - alt text after `/`: the accessible name (GEN-d5 with P6b).
- **On elements**, `normal`, `none` and strings are accepted with no effect, proven by chrome-dual on a fixture. Anything else (an image makes the element replaced) is refused, naming GEN-d4.

**R4. Hosts.**
- **Accepted:** every supported non-replaced, non-control tag except html. Body is accepted.
- **Refused**, with `DRAGON_UNSUPPORTED_VALUE` naming the host, the owner package and the probe evidence:
  - on `REPLACED_TAGS`: Chrome generates nothing on img and iframe, and generated content inside replaced boxes is undefined;
  - on `CONTROL_TAGS`: Chrome generates on range, checkbox and button but not on text inputs, select or textarea; the control expansion would need its own proof (FORM follow-up);
  - on html: the root's sibling-of-body box is not modelled.
- **Not proven yet:** hr's `::before` renders, but hr's UA inset border is already refused, so hr is accepted only with an authored border-style, like hr itself.
- **Inside a range input's UA shadow parts:** never generated (they are not selectable hosts).

**R5. Selectors.**
- **Grammar.**
  - `::before`, `::after`, and the legacy `:before` and `:after` (css-tree parses these as pseudo-classes; Chrome treats them as the pseudo-elements, as probe before-single-colon shows) end the subject compound, with FORM-a's rule that nothing may follow.
  - Specificity adds [0,0,1] (probe specificity: `#a::before` beats `.c::before` and `div::before`).
  - A pseudo-element inside `:is()`, `:where()`, `:not()` or `:has()` follows the selector-validity table: Chrome drops it, and so does Dragon.
  - `::before::marker`, `::before:hover` and `::first-line` / `::first-letter` stay refused with the existing message, and pseudoElementOwner names GEN-d.
- **Statically empty pseudo-elements.**
  - `::backdrop` and `::file-selector-button` (both in the Tailwind preflight's first rule), `::placeholder`, `::-webkit-search-decoration`, `::-webkit-date-and-time-value`, `::-webkit-datetime-edit*`, `::-webkit-calendar-picker-indicator`, `::-webkit-inner-spin-button` and `::-webkit-outer-spin-button` are accepted as rules that match no box, **when the compiler proves that no element of the compiled tree can host them**:
    - no dialog, no `[popover]`, no fullscreen element;
    - no input of type file, date, time, datetime-local, month, week, search or number;
    - no input or textarea with a `placeholder` attribute.
  - Otherwise each is refused, naming its owner (FORM, OVFL-s).
  - This follows the provable-selectors ruling ("Selectors and scrollbars", owner 2026-09-28).
  - A fixture holds the full Tailwind preflight rule.

**R6. Cascade and inheritance.**
- A generated element cascades only rules whose selector's pseudo-element is its own, matched on the host's chain (FORM-a `partSelectorMatches`, generalized).
- It inherits from the host (CSS2 §12.1).
- Custom properties are its own cascade over the host's, and `var()` substitutes in `content`. Tailwind 4 writes `content: var(--tw-content)` with `--tw-content` registered through `@property` (CASC).
- Direction: the host's resolved direction, as for range parts.

**R7. Generated text.**
- The joined string enters `collapseInlineContext` (INL1a C2) as part of the host's inline formatting context. With INL2a it is opaque like any text.
- Collapsing across the boundary and `\A` → space follow finding 4.
- A preserving `white-space` on the generated box keeps INL1a's existing refusal until TXT2-c.
- Glyph coverage, fonts and rtl text use the same checks as any text: Ahem-covered set, `checkRtlText`, and after TXT1a the real-font coverage. There is no special case.
- Generated text is never selectable or copyable in Chrome. P6c must exclude text nodes whose address ends in `::before:text0` or `::after:text0`; no new program field is added.
- P6b exposes them to accessibility as Chrome's AX tree does (the `::before` text is part of the name).

**R8. Display and position of a generated box.** The ordinary computation applies:
- blockification by a flex or grid parent or by abspos (css-display-3 §2.7; probe gives computed `block`);
- INL1a's inline box rules for `inline`;
- INL2a's atomic rules for `inline-block` and `inline-flex` (refused until INL2a is in BASE, through the existing path).

In addition:
- `display: list-item`, `table*`, `contents` and `ruby*` on `::before` or `::after` are refused (`DRAGON_UNSUPPORTED_VALUE`, GEN-d6 / TBL).
- An absolutely positioned generated box beside text keeps the existing "position: absolute beside text" refusal: the engine's abspos-in-inline. Its message gains "(POSX-IFC)". This is the most common `::after` overlay shape, so POSX-IFC is boarded as the first follow-up (R15).
- A generated box whose host has only block-level children and no text, such as `.card::after{content:'';position:absolute;inset:0}`, is supported today.

**R9. Capture of generated boxes.** A new `capturePseudoElements` sits beside `captureRangeParts` in packages/parity/src/capture.ts.
- **Finding the boxes.** DOM.getDocument (depth -1) lists `pseudoElements` with `pseudoType` before, after and (GEN-c) marker for every node with a data-dragon-id.
- **Boxes.** For each: a node `<id>::before` with the DOM.getBoxModel border quad, and computed values from CSS.getComputedStyleForNode, with `content` included.
- **Generated text.** One `<id>::before:text0` node (union) and its `:line<j>` nodes, from DOMSnapshot.captureSnapshot textBoxes whose layout object belongs to that pseudo node. Each is divided by the DPR and stored as `Math.fround`.
- **Self-check, fail loud.**
  - In the same page, every real text line's snapshot rect divided by the DPR must equal its Range client rect within 1/1024 CSS px (probe: worst 1.0e-5).
  - The set of pseudo nodes Chrome generated must equal the set Dragon generated for the case. A box Chrome makes that Dragon lacks, or the reverse, is an error, never a skipped node.
- **Cost.** A page without a pseudo-element or marker opens no CDP session, so every existing capture stays byte-identical. This is FORM-a's guard.

**R10. Web output.**
- For every resolved variant class whose element has a generated box, web-css.ts writes `.cls::before { content: <Chrome serialization>; <every longhand> }` (and `::after`), in every band, like FORM-a's range parts.
- It writes nothing for a host without one, so the author's and Dragon's renderings generate the same boxes. Chrome-dual and the R9 set check prove that.

**R11. Native targets.**
- **iOS and Android.** A generated box lowers to the node kinds its display already has: a DragonBoxView (block or flex item, abspos), INL1a's unpainted inline-box view, and a DragonTextView for its text. Glyphs come from `inline_placeLines`, drawn with CTFontDrawGlyphs on iOS (UIKit/CoreAnimation) and Canvas.drawGlyphs on Android (View/Canvas, minSdk 31).
- **Nothing new on device.** No CSS is parsed, no selector is matched and no string is computed on device; content strings are compile-time constants.
- **Platform differences.** The compiler owns them, and none exists for GEN-a or GEN-b.
- **GEN-c** adds one view kind (R14).

**R12. States and bands.** A generated box's existence and its text must be identical in every reachable state and media band of the case. Otherwise `DRAGON_UNSUPPORTED_VALUE` names GEN-d8, for example `.open::after{content:'-'}` against `::after{content:'+'}`. Style changes of an existing generated box (colour, size) follow the state program as for elements.

**R13. GEN-b, the longhands and markerless list items.**
- **The longhands.**
  - `content`: not inherited, initial normal.
  - `list-style-type`: inherited, initial disc. Any `<counter-style>`, `<string>` or `none` parses.
  - `list-style-position`: inherited, initial outside.
  - `list-style-image`: inherited, initial none.
  - The `list-style` shorthand (css-lists-3 §3.4, including the `none` ambiguity rule: `none` sets type and image to none when neither is given).
- **New files.** packages/dragon/src/css/properties/lists.ts and shorthands/lists.ts (the INL2b `properties/inline.ts` pattern, avoiding box.ts and text.ts). Each is registered with one line in properties.ts and shorthands/index.ts.
- **Grammar.** From the existing webref grammar. If the generated grammar disagrees with Chrome's `CSS.supports` on a matrix (each keyword, `'>> '`, `none`, `inside none`, `url() none`, an unknown ident), an override goes in gen-css-grammar.ts per the T059J rule 7 precedent, citing Blink.
- **`display: list-item`** is accepted **iff its marker generates no box**: computed `list-style-type: none` and `list-style-image: none` (finding 8: no ::marker node, height identical to block). It is then lowered and laid out as a block. Blink's LayoutListItem is a LayoutBlockFlow (layout_list_item.cc), and the list-item counter it increments is invisible.
- **Any other list item** is refused, with `DRAGON_UNSUPPORTED_VALUE` at the element, message `display: list-item on <tag> <address> generates a <type> marker (::marker, css-lists-3 §3), which Dragon draws from the GEN-c package`, fix `Set list-style: none on <address> or its list, or set display: block.`
- **`list-style-position`** never matters without a marker, so it is accepted at any value.
- **`list-style-image`** other than none is refused, naming GEN-d4.
- **The migration** is additive only:
  - captures gain the four computed values for every element node;
  - emitted bodies gain four declarations per rule;
  - UA tables gain the declared list-style-type of ul and ol, which leaves `userAgentUnmodelled`.

  A new scripts/check-gen-longhand-migration.ts proves it, with plants that must fail (the check-aspect-ratio-migration precedent; decisions.md "Adding engine fields and CSS longhands").

**R14. GEN-c, outside list markers.**
- **Scope.**
  - Outside markers only.
  - Symbol markers: disc, circle, square.
  - Text markers: decimal, decimal-leading-zero, lower-alpha, upper-alpha, lower-latin, upper-latin, lower-roman, upper-roman, and `<string>`.
  - `list-style-type: none` (GEN-b).
  - Anything else, or an unknown counter-style name, is refused, naming GEN-d1. Chrome falls back to decimal for an undefined name; GEN-c refuses rather than model fallback.
- **Ordinals and text: compile-time.** The tree is static, so Dragon reproduces list_item_ordinal.cc: `start`, `reversed` (item count), `value`, and list-item elements that are not li in the enclosing scope. A port from counter_style.cc gives the text of each listed style:
  - numeric and alphabetic algorithms;
  - additive roman with its 1-3999 range and the decimal fallback outside it;
  - the negative sign;
  - prefix "" and suffix ". " (decimal-leading-zero pads to 2).

  The marker text is a compile-time string. Ordinals that depend on state are covered by R12 (d8).
- **Engine input.** `LayoutBox.marker: ListMarker | null`, a required field with neutral `null`. Existing vectors, translate corpora and case sources are migrated by generator only, with byte-identical outputs (T050/T113 rule). It holds:
  - `ListMarker { id, kind: 'symbol' | 'text', symbol: 'disc' | 'circle' | 'square' | null, text: string | null, font: FontSpec, lineHeight, direction }`.
- **Engine placement.** A new packages/layout/src/marker.ts ports:
  - list_marker.cc `WidthOfSymbol`, `InlineMarginsForOutside` and `RelativeSymbolMarkerRect`;
  - unpositioned_list_marker.cc `InlineOffset`, `ContentAlignmentBaseline`, `AddToBox` and `AddToBoxWithoutLineBoxes`.

  block.ts gains the BlockLayoutAlgorithm `PositionOrPropagateListMarker` and `PositionListMarkerWithoutLineBoxes` steps. Floats do not exist, so `ComputeIntrudedFloatOffset` is 0 and FLT owns it later.
- **Marker box.** The text marker's box is its shaped text width, including the trailing space (`white-space: pre`), with its own strut line. The symbol width is the integer formula on the font's ascent, rounded by T082's rule in **zoomed** space.
- **Unzoomed constants.** The 7 and the 1 are recorded as the Chrome deviation `list-marker-padding-unzoomed` in chrome-deviations-dpr.ts, keyed by DPR, with a proving fixture and a planted spec reading. This is the D1 precedent (`initial-line-width-unzoomed`).
- **First baselines.**
  - The first line box's ascent comes from INL1a's `placeLines`.
  - A block child's first baseline comes from block.ts.
  - A flex or inline-block child's comes from INL2a's exports. **GEN-c bases after INL2a.**
  - A grid first child is refused (`DRAGON_UNPROVEN_CONTEXT`, naming GEN-c2 after G1).
- **Paint.**
  - Square: a fill of the pixel-snapped rect.
  - Disc: a fill of the Skia oval through paint-aa.ts (SkPath oval, analytic AA).
  - Circle: the Skia oval stroked at 1 device px through paint-aa.ts SkPathStroker.
  - The device draws the coverage the translated paint-aa computes, the same path PNT1-radius uses for arcs. **GEN-c bases after PNT1-radius.**
  - GEN-P must first prove paint-aa against a Chrome pixel oracle of markers. A mismatch stops GEN-c (§3 GEN-P) and is never tolerated.
- **Colour.** The marker colour is the list item's `color`; `::marker` styling is refused (GEN-d6).
- **No glyph for symbols, and no TXT1 dependency** (finding 8). This amends the roadmap's "TXT1 for marker glyphs".
  - Text markers are ordinary text through the base's measurer and drawing: Ahem on BASE, and real fonts once TXT1a is in BASE, under the same font refusals as any text.
  - A marker string with glyphs outside the font is refused like any text, through font coverage.
- **Native.** One new node kind, `marker`:
  - a DragonBoxView subclass drawing the symbol coverage;
  - for text markers, a DragonTextView holding the marker text at the engine rect;
  - placed as a child of the list item's view, which does not clip it (overflow visible). A `overflow: hidden` list item clips its marker in Chrome as well (to be proven by a fixture).
- **rtl.** Symbol markers are supported (mirrored, finding 8). Text markers in rtl are refused (`DRAGON_UNSUPPORTED_VALUE`, "bidi reordering of the marker text"), because Chrome reorders "1. " into two runs and Dragon has no bidi package. Strong-L letter strings are included in the refusal.
- **Refused in GEN-c:**
  - `list-style-position: inside` (GEN-d6, needs INL1b margins);
  - the `::marker` selector (GEN-d6);
  - `list-style-image` (GEN-d4);
  - nested lists (the existing ua-context refusal, GEN-d7);
  - a list item whose display is `inline list-item` or `flow-root list-item` (GEN-d6);
  - details and summary disclosure markers (FORM).

**R15. Later packages, recorded now so nothing is dropped** (owner, maximum support). Each needs its own Judge amendment before work.

| Package | What it adds | How |
|---|---|---|
| d1 | Counters | Compile-time port of counters_attachment_context.cc (BSD) over the static tree, plus `counter()` and `counters()` in content, with the remaining counter styles from counter_style.cc |
| d2 | Quotes | `quotes: auto` per lang, from Chrome's table measured by probe (class A; layout_quote.cc is LGPL) |
| d3 | `attr()` | Compile-time string from static attributes; the typed `attr()` after Chrome's grammar |
| d4 | Images | Images in content, and `list-style-image`, after REPL-a's asset pipeline |
| d5 | Alt text | With P6b |
| d6 | `::marker` and inside markers | `::marker` styling and content; inside markers after INL1b |
| d7 | Nested lists | Nested-list UA contexts (ua lane) |
| d8 | State-dependent content | Through DTXT/SOV slots |
| POSX-IFC | Abspos beside text | Abspos children in an inline formatting context whose insets never use the static position, then the general case (engine lane, serial on inline.ts) |

**R16. Proof for every fixture-adding package.** Rules R16-R17 apply as in T044 R4, with the T058/T059J amendments.
- **Chrome.**
  - Chrome-dual computed strings for elements and pseudo nodes (CSS.getComputedStyleForNode), frames, and line rects.
  - DPR 1, 2, 3 and 2.625 (parity:capture and parity:dpr-capture), in ltr and rtl.
  - The R9 set equality and snapshot cross-check run on every capture.
- **Vectors (GEN-c).** New files in which TS = Swift = Kotlin. They include cases Chrome cannot isolate: a marker taller than every line, an empty item with padding, a marker at 1 px font size.
- **Breaks.** Engine = Chrome N/N on new cases, and existing break vectors are byte-identical.
- **Device (Phase B, both leases, through `/tmp/device-lease.sh`).**
  - All five lanes: layout-vectors-device, device-frames, device-applied, device-lines and device-pixels.
  - iOS at DPR 2 and 3; Android at 2, 2.625 and 3.
  - No `not run` lane, and no device-pixels failure beyond master's recorded list.
  - GEN-c's marker symbols get **no allowance**: they pass the pixel gate or the package stops.
- **Planted faults** per layer, each caught by a named fixture, vector or lane (§3).
- **WPT.** Refusals only shrink, no pass becomes a fail, and the delta is recorded. The GEN row: 96 numeric files blocked, 0 alone; reftests 1,599 / 7. A numeric delta of 0 is acceptable with that reason.
- **Support profiles.** Rows come from profile:rows only, and the declared new rows are listed per package (§3).

**R17. Base and order** (merge trains, AGENTS.md step 8).
- **GEN-P** starts now from origin/master 0d04dc09a5. It is new files only.
- **GEN-b** bases on **B0**:
  - the head of the train position that lands INL1a C2 (`pnpm train build` output). Its tree equals master's after that merge, so the later catch-up merge is trivial and nothing is restacked;
  - or origin/master after the INL1a train has merged, whichever exists first.

  The queued order (train 1 → REPL-a → FORM-a → INL1a → PNT2 → PNT1) puts FORM-a A4 before INL1a, so B0 contains both of GEN-a's prerequisites. GEN-b itself needs neither, but sharing B0 keeps one base for the lane and avoids a separate catch-up through computed-checks.ts, where FORM-a and INL1a both edit.
- **GEN-a** stacks on GEN-b, with its PR on `review/gen-b` (the PM's stacked-PR rule of 2026-10-02).
- **GEN-c** bases on master after GEN-a, INL2a (block.ts serial order and the flex and inline-block first-baseline exports) and PNT1-radius (the device paint-aa path) have all merged.
- **The text stack.** It is being restacked onto C2, and TXT-W1/W2 add longhands (font-weight, font-style). Its order against GEN-b is the PM's. Whichever lands second regenerates captures, UA tables and emitted CSS at merge and never hand-merges. A merge-conflict test (T059J rule 1) replaces any "not concurrent" stop: GEN-b's and GEN-a's conflicted non-generated paths against txt1a-1-v2, txt-w1-v2, txt-w2-v2, tdec-a2-v2, inl2, inl2b and pnt1-* must be a subset of the shared set in §4.

## 3. Worker packages

**Common prefix.** **E** means `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`. Heavy commands run as `/tmp/heavy-lease.sh <cmd>`, and device runs as `/tmp/device-lease.sh <cmd>`. BASE is the recorded base sha.

**Standard verify block S.** This is notes/T044-inl-spec.md §2 S1-S18, as amended for INL1a (notes/T058-inl1a.md) and INL2 (notes/T059J-inl2.md), with these GEN-specific S16 carve-outs. Each named function only; the receipt quotes the hunk:
- packages/parity/src/capture.ts: `capturePseudoElements` and its single call site beside `captureRangeParts` (GEN-a; GEN-c widens the pseudoType list to marker);
- packages/parity/src/compare.ts and native-compare.ts: the node-kind or id lists only, if the generated ids need them (GEN-a) or the marker kind needs them (GEN-c).

No other S16 path is allowed.

### GEN-P: generated-content and marker probe corpus (new files only; starts now)

- **Worktree / branch:** `/tmp/dragon-gen-probe`, `gen-probe`. **Base:** origin/master 0d04dc09a5. No device lease.
- **Objective.** A committed, re-runnable Chrome 145.0.7632.6 corpus plus a Blink source reading, which GEN-b, GEN-a and GEN-c cite for every rule.
  - **Script.** `scripts/capture-gen-probe.ts` imports parity/src/chrome.ts unchanged. It runs at DPR 1, 2, 3 and 2.625, in ltr and rtl, with Ahem plus one Inter case per family.
  - **Recorded per case:** CDP pseudoElements and getBoxModel; CSS.getComputedStyleForNode; DOMSnapshot textBoxes with the R9 cross-check; getComputedStyle(el, '::before'); getBoundingClientRect of the real elements.
  - **Families:**
    1. the content-value matrix on ::before, ::after and elements (finding 5), with computed serializations, `var()` content and the full Tailwind preflight first rule;
    2. the host matrix (finding 6);
    3. display and blockification (inline, block, flex item, abspos, inline-block) and inheritance (colour, font-size from the host);
    4. white-space collapse across generated boundaries (finding 4), including `\A`, empty strings and leading or trailing spaces at line ends in a 3-line wrap;
    5. markers: geometry at sizes 10, 13, 16, 17.3, 23.3, 33.33 and 1 px × disc, circle, square and decimal × DPR (the probe3 formula as an executable assertion); ordinals (start, reversed, value, negative, list-item divs, `ol` inside `div`); counter-style text for the R14 list at 0, 1, 26, 27, 3999, 4000 and -1;
    6. marker alignment: nested block with padding, flex first child, inline-block first child, `line-height: 40px`, a larger marker font pushing content down (li font 32, child font 10), an empty item, a border-left on li, `overflow: hidden` on li, and rtl;
    7. **the symbol pixel oracle**: Chrome screenshots of disc, circle and square at each size and DPR, cropped to RelativeSymbolMarkerRect plus 2 device px. A script `scripts/check-marker-paint-oracle.ts` renders each with packages/layout/src/paint-aa.ts (oval fill, oval stroke 1 device px, rect fill) and reports per-pixel equality.
  - **Source reading.** `docs/research/gen-spike/blink-notes.md` gives file:line at the tag for every rule in R3-R14. Each measured rule is matched to its source line, and anything unexplained is an open question with its case id, never a guess.
- **allowed_files:**
  - `docs/research/gen-spike/**` (new; captures under `docs/research/gen-spike/probe/**`, already covered by `.macroscope/ignore.md` `**/probe/**`);
  - `scripts/capture-gen-probe.ts` (new);
  - `scripts/check-marker-paint-oracle.ts` (new; it imports paint-aa.ts read-only);
  - the note `docs/goals/milestone-2-proof/notes/T151-gen-probe.md` (main checkout only).
- **verify:**
  - `E pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
  - `E /tmp/heavy-lease.sh node --conditions=dragon-internal scripts/capture-gen-probe.ts && /tmp/heavy-lease.sh node --conditions=dragon-internal scripts/capture-gen-probe.ts --check` (the second run is byte-identical)
  - `E node --conditions=dragon-internal scripts/check-marker-paint-oracle.ts`: prints N/N per symbol, size and DPR
  - `git diff --name-only --diff-filter=MD $BASE..HEAD` is empty, and every added path is in allowed_files
- **stop_if:**
  - Chrome is not 145.0.7632.6;
  - capture is non-deterministic after two attempts;
  - the R9 cross-check fails;
  - a marker geometry case disagrees with the list_marker.cc formula and Blink does not explain it;
  - a file outside allowed_files is needed;
  - verification fails twice.
- **paint-oracle mismatch.** This is **not** a GEN-P stop: it is recorded per case, and it blocks GEN-c's paint (R14) until a SKIA-AA follow-up closes it. No allowance.
- **PR:** one PR, about 40 KB reviewed (the scripts and notes; probe output is ignored by shape).

### GEN-b: `content` and `list-style-*` longhands; markerless list items (compiler only)

- **Worktree / branch:** `/tmp/dragon-gen-b`, `gen-b-longhands`. **Base:** B0 (R17). Record BASE.
- **Objective.**
  1. Longhands per R13: `content`, `list-style-type`, `list-style-position` and `list-style-image`, plus the `list-style` shorthand, in new files `css/properties/lists.ts` and `css/shorthands/lists.ts`, each registered with one line.
  2. Computed values: in computed.ts, `content` per R3 (element: none → normal; pseudo: normal → none) and list-style-image none.
  3. In computed-checks.ts, the list-item refusal becomes R13's markerless rule. `content` on an element is accepted for normal, none and strings, and anything else is refused per R3.
  4. The UA capture is re-run because LONGHANDS changed: generator output only, `ua:capture -- --compare` with ul/ol list-style-type moving from unmodelled to declared, and no other entry changing.
  5. `scripts/check-gen-longhand-migration.ts <base>`, with plants `drop-content`, `wrong-list-style-initial` and `extra-key`. Each must fail.
- **Fixtures.** Group `list-items` (ltr and rtl, every DPR):
  - `ul`/`ol` with `list-style: none` (the Tailwind preflight shape), with text, nested blocks and padding;
  - every `list-style` shorthand form that yields type none (`none`, `none inside`, `inside none`, `none none`);
  - `div{display:list-item;list-style-type:none}` empty and with text;
  - an li in a flex ul (stays list-item, flex item);
  - `content` on elements: none, normal and strings (chrome-dual: no box change).
- **Rejects:** reject-list-item-disc (the UA default), reject-list-item-decimal, reject-list-style-image, reject-content-element-counter.
- **Plants.** Compiler (faults.ts):
  - `listItemNoneMarkerRefused` (refuses the markerless item, caught by the unit test of the preflight shape);
  - `listItemDiscAccepted` (accepts a disc item, caught by reject-list-item-disc);
  - `contentNoneOnElementKept` (computes `none` on an element; chrome-dual catches it);
  - `listStyleNoneSetsTypeOnly` (the shorthand's `none` sets only list-style-type; caught by chrome-dual on the `list-style: none` fixture, whose computed list-style-image must be none, and by a lists.test.ts case for `list-style: none inside`).
- **Profile rows (new only):**
  - `display: list-item` in the contexts list-item-markerless/<block|flex-item>/<dir>;
  - `list-style-type: none | <other>` (other is accepted only on non-list-items, which is all GEN-b proves);
  - `list-style-position` with all values;
  - `list-style-image: none`;
  - `content: normal | none | <string>` on elements.
- **allowed_files:**
  - `packages/dragon/src/css/properties/lists.ts` (new);
  - `packages/dragon/src/css/shorthands/lists.ts` (new);
  - `packages/dragon/src/css/properties.ts` (registration lines);
  - `packages/dragon/src/css/shorthands/index.ts` (registration line);
  - `scripts/gen-css-grammar.ts` (an override entry only if the CSS.supports matrix requires it) and `packages/dragon/src/css/grammar.generated.ts` (output);
  - `packages/dragon/src/analysis/computed.ts` (the two computed rules);
  - `packages/dragon/src/analysis/computed-checks.ts` (the list-item and element-content checks);
  - `packages/dragon/src/ua/chrome-145.darwin-arm64.generated.ts` and `.dark.generated.ts` (generator output);
  - `packages/dragon/src/faults.ts`, `diagnostics/catalogue.ts` and `test/diagnostic-codes.json` (append);
  - `packages/dragon/src/profiles/*.ts` (output);
  - `packages/dragon/test/lists.test.ts` (new);
  - `packages/dragon/test/block-elements.test.ts` (the :120 retarget: UA disc still refused, `list-style: none` accepted);
  - `packages/dragon/test/ua-elb2.test.ts` (the :40 retarget to the declared table);
  - `packages/dragon/test/seams.test.ts` (append);
  - `scripts/check-gen-longhand-migration.ts` (new);
  - `packages/parity/src/fixtures.ts` (one appended group), `fixture-groups/list-items.ts` (new) and `packages/parity/fixtures/*` (new);
  - parity outputs: `expected/**`, `expected-dpr/**`, `emitted/**`, `expected-breaks/**`, `expected-pixels/**`, `out/lanes.json`;
  - `packages/layout/vectors/**` (new files);
  - `examples/music-player/dragon/north-star-check.json` and `packages/wpt/expectations/*.json` (output);
  - `packages/tailwind-sweep/snapshot/tailwind-4.3.3.json` (generator output: `list-none`, `list-disc` and `content-none` rows may change, and each change is listed);
  - existing count pins converted to derived counts only.
- **verify:**
  - S1-S17. S7 is replaced by the migration check: `E node scripts/check-gen-longhand-migration.ts $BASE` exits 0, and each plant exits 1. No engine file and no emitter file other than through LONGHANDS changes. S16 is unchanged.
  - `E pnpm run ua:capture -- --check && pnpm run ua:capture -- --compare <BASE copy>`: only ul/ol list-style-type moves, and nothing else differs.
  - `E pnpm run north-star:check`: the summary is byte-identical to BASE's (delta 0, §6).
  - Phase B: S18 (both leases) when the landing queue reaches it.
- **stop_if:**
  - BASE lacks INL1a C2 or FORM-a A4 (B0 is wrong);
  - an existing capture value, box, vector, break or emitted declaration changes beyond the four additions;
  - a UA entry other than list-style-type changes;
  - Chrome's `CSS.supports` disagrees with the grammar and Blink does not explain it;
  - a plant is not caught;
  - a conflicted non-generated path falls outside §4's shared set;
  - a file outside allowed_files is needed;
  - anything would be loosened;
  - verification fails twice.
- **PR:** one PR, about 90 KB reviewed. Generated captures, UA tables and emitted CSS are ignored by shape. The ua `*.generated.ts` files are covered by `**/*.generated.ts`.

### GEN-a: `::before` and `::after` with string content (compiler and capture; no engine change)

- **Worktree / branch:** `/tmp/dragon-gen-a`, `gen-a-pseudo`. **Base:** gen-b-longhands (stacked; PR on `review/gen-b`). Record BASE.
- **Objective.**
  1. **selectors.ts.** `RangePart` widens to `PseudoElementName = 'thumb' | 'track' | 'before' | 'after'`. The legacy `:before` and `:after` map to it. The statically empty pseudo-element list and its host proof come per R5, with a new `analysis/pseudo-hosts.ts` if the proof needs the tree. pseudoElementOwner names GEN-d or FORM or OVFL-s for the rest.
  2. **match.ts and cascade.ts.** `partSelectorMatches` and `CascadePart` take the widened name, and the FORM-a behaviour is byte-identical.
  3. **resolve.ts (named hunks).** Generation in `visit` per R2-R4, the generated text entering `collapseInlineContext` per R7, and a `generatedPseudoOf(el)` export.
  4. **New analysis/generated.ts.** The content evaluation (R3: string join, refusals), host eligibility (R4) and the state and band identity check (R12).
  5. **computed-checks.ts.** The R3, R4, R8 and R12 refusals in one appended function. The abspos-beside-text message gains "(POSX-IFC)".
  6. **web-css.ts.** Per R10.
  7. **capture.ts.** `capturePseudoElements` per R9.
  8. **Native lowering.** Unchanged code paths. If an id or kind list rejects `::before` ids, then and only then are expected-dump.ts and native-compare.ts edited, as named list hunks.
- **Fixtures.** Group `generated-content` (ltr and rtl, every DPR):
  - `gen-inline-text`: before and after inline in a wrapping block, with collapse across both boundaries, `\A`, concatenation, an empty `''`;
  - `gen-flex-items`: the probe before-blockified-in-flex case, with row, column and rtl;
  - `gen-abspos-overlay`: a relative host with block children only, `::after{content:'';position:absolute;inset:0;background}`, plus top/left and width/height variants;
  - `gen-block`: `display:block` before with height, and after with text;
  - `gen-cascade`: specificity (probe specificity), the legacy colon, inheritance of colour and font-size, `--tw-content` through `var()`, and the Tailwind preflight first rule both without content (no box) and with an `after:` utility shape;
  - `gen-static-empty`: preflight `::backdrop` and `::file-selector-button` with no host;
  - `gen-hr-li`: `::before` on hr with an authored border-style, and on an li with `list-style: none`.
- **Rejects:**
  - reject-gen-counter, reject-gen-quote, reject-gen-attr, reject-gen-url, reject-gen-alt;
  - reject-gen-on-img, reject-gen-on-input-range;
  - reject-gen-display-list-item, reject-gen-preserved-newline;
  - reject-gen-state-dependent (a `[ui-open]` state flip of content);
  - reject-gen-abspos-beside-text;
  - reject-gen-placeholder-host (`::placeholder` with an input carrying a placeholder);
  - the existing reject-selector-pseudo-element.html **retargeted** to `.a::first-line { width: 20px }` (still refused, same intent).
- **Plants.**
  - Compiler:
    - `pseudoContentNormalGenerates` (caught by the R9 set check on gen-cascade);
    - `pseudoAfterFirst` (gen-inline-text frames);
    - `pseudoInheritsFromHostParent` (gen-cascade chrome-dual);
    - `pseudoSpecificityZero` (gen-cascade);
    - `contentFirstStringOnly` (gen-inline-text);
    - `generatedTextCollapsedAlone` (gen-inline-text lines);
    - `pseudoOnReplacedGenerated` (reject-gen-on-img becomes accepted, so the reject test fails);
    - `staticEmptyIgnoresHost` (reject-gen-placeholder-host).
  - Capture: `snapshotTextNotScaled` (the R9 cross-check at DPR 2, 3 and 2.625) and `pseudoSetUnchecked` (the set check is skipped; a unit test feeds a capture with an extra Chrome box).
- **Profile rows (new only):** `content: <string>` on before and after in the contexts pseudo-inline-in-block/<dir>, pseudo-flex-item/<axis>/<dir>, pseudo-abspos-in-block/<dir> and pseudo-block/<dir>, plus the selector rows for `::before` and `::after`.
- **allowed_files:**
  - `packages/dragon/src/css/selectors.ts`;
  - `packages/dragon/src/analysis/match.ts`, `cascade.ts` (the type widening and its call);
  - `packages/dragon/src/analysis/resolve.ts` (the named hunks);
  - `packages/dragon/src/analysis/generated.ts` and `pseudo-hosts.ts` (new);
  - `packages/dragon/src/analysis/computed-checks.ts` (one appended function plus the one message);
  - `packages/dragon/src/analysis/context.ts` (pseudo contexts only);
  - `packages/dragon/src/emit/web-css.ts`;
  - `packages/dragon/src/emit/expected-dump.ts` and `packages/dragon/src/lower/ios-layout.ts` (id handling only, if needed);
  - `packages/dragon/src/faults.ts`, `diagnostics/catalogue.ts`, `test/diagnostic-codes.json` (append);
  - `packages/dragon/src/profiles/*.ts` (output);
  - `packages/dragon/test/generated-content*.test.ts` (new), `selectors.test.ts` (the :59-60 retarget to `::first-line` / `::first-letter`), `seams.test.ts` (append);
  - `packages/parity/src/capture.ts` (S16 carve-out), and `compare.ts` / `native-compare.ts` (the S16 carve-out, if needed);
  - `packages/parity/test/generated-content.test.ts` (new: the R9 set and cross-check, and the capture plants);
  - `packages/parity/src/fixtures.ts` (one appended group), `fixture-groups/generated-content.ts` (new), `packages/parity/fixtures/*` (new, plus the one retarget);
  - parity outputs, `packages/layout/vectors/**` (new), `out/lanes.json`, `north-star-check.json`, WPT expectations;
  - `docs/ports.json` and `THIRD_PARTY_NOTICES.md` (reference entries for list_marker.cc and computed_style_utils.cc, only if cited; pseudo_element.cc is bsd-google);
  - existing count pins derived only;
  - the note (main checkout).
- **verify:**
  - S1-S17 with the S16 carve-out. S7: existing captures are byte-identical, because a page without pseudo-elements opens no CDP session (R9).
  - S11: existing case sources are byte-identical apart from relaxed headers.
  - `E node scripts/check-gen-longhand-migration.ts $GEN_B_BASE` still exits 0.
  - `E pnpm run north-star:check`: byte-identical summary.
  - S15: WPT refusals shrink (css-pseudo and css-content tests whose only blocker was `::before`/`::after` string content), no pass becomes a fail, and the delta is recorded.
  - Phase B: S18.
- **stop_if:**
  - BASE lacks GEN-b, FORM-a A4 or INL1a C2;
  - an existing capture, vector, break, emitted body or profile row changes;
  - FORM-a range-part behaviour changes (its fixtures and the controls-identity tests must be byte-identical);
  - Chrome generates a pseudo node Dragon does not, or the reverse, and the cause is outside R3 and R4;
  - the R9 cross-check fails;
  - the engine (packages/layout/src) would need a change;
  - a plant is not caught;
  - a conflicted path falls outside §4;
  - a file outside allowed_files is needed;
  - anything would be loosened;
  - verification fails twice;
  - Phase B: a lease is not held, a non-pixel lane fails, or a device-pixels failure is added.
- **PR split (two PRs under ~150 KB reviewed):**
  - **GEN-a1 (compiler, about 100 KB).** Selectors, cascade, resolve, generated.ts, pseudo-hosts.ts, checks, web-css and unit tests. Its fixtures come in a2, so a1 alone enables only rules that generate no box: the preflight's `::before`/`::after` rules and the static-empty pseudo-elements. Every box-generating `content` stays refused in a1 behind one switch removed by a2, so a1 cannot claim untested support.
  - **GEN-a2 (capture, fixtures and proof, about 110 KB).** capture.ts, parity tests, fixtures, the removal of the switch, profiles and the device run.

### GEN-c: outside list markers (engine, compiler and native paint)

- **Worktree / branch:** `/tmp/dragon-gen-c`, `gen-c-markers`. **Base:** master after GEN-a, INL2a and PNT1-radius have merged (R17). Never concurrent with a package in flight on block.ts (INL2b, INL1b, FLT, TXT2-a if it edits block.ts), input.ts, validate.ts, native-support.ts or the emitters. If one is in flight, GEN-c bases on its merge.
- **Phase gate.** GEN-P's paint oracle must be N/N for the symbol and DPR set GEN-c claims. A symbol that is not N/N stays refused on native, naming its SKIA-AA follow-up, and is still accepted on web. This is a recorded split, not a stop.
- **Objective.**
  1. **Engine (R14).** marker.ts (the ports), the `LayoutBox.marker` input with generator migration (`scripts/migrate-marker-input.ts` plus `scripts/check-marker-input-migration.ts`), block.ts placement steps, the validate.ts rules, zoomInput of the marker font, the `list-marker-padding-unzoomed` deviation, and the symbol paint function using paint-aa.ts (new `paint-marker.ts`).
  2. **Compiler.**
     - New `analysis/ordinals.ts` (the list_item_ordinal.cc port) and `css/counter-styles.ts` (the counter_style.cc port, R14 list only).
     - resolve.ts synthesizes `<li>::marker` (a named hunk: an element with `node` of the li, cascading only UA marker defaults; author `::marker` rules are refused).
     - computed-checks.ts lifts R13's refusal for supported types and adds the R14 refusals.
     - ios-layout.ts writes `marker`.
  3. **Native.** The `marker` node kind in native-program.ts, uikit.ts, android-views.ts, native-support.ts (symbol coverage drawing, text marker view) and expected-dump.ts.
  4. **Capture.** `capturePseudoElements` takes pseudoType `marker` (the S16 carve-out).
  5. **Ports registry.** `docs/ports.json` entries with use `port` for list_marker.cc (345-361, 394-458), unpositioned_list_marker.cc, block_layout_algorithm.cc (3748-3830), list_item_ordinal.cc and counter_style.cc (the ported algorithms), and text_fragment_painter.cc (173-215). inline_node.cc (1546-1557) is a reference. Then `pnpm notices:gen`.
- **Fixtures.** Group `list-markers` (ltr and rtl for symbols, ltr for text, every DPR):
  - the GEN-P families 5 and 6 sizes;
  - ol start, reversed, value and negative;
  - roman across 3999/4000 and alpha across 26/27;
  - a string type;
  - li with a nested padded block, a flex first child, an inline-block first child, `line-height: 40px`, push-down, empty, border-left, `overflow: hidden`;
  - `::before` on an li with a marker;
  - the marker colour from li.
- **Rejects:** reject-marker-inside, reject-marker-selector, reject-marker-image, reject-marker-rtl-decimal, reject-marker-unknown-style, reject-marker-grid-first-child. The existing nested-list ua-context reject is unchanged.
- **Plants.**
  - Engine:
    - `markerPaddingZoomed` (DPR 2, 3 and 2.625 frames);
    - `symbolWidthFromGlyph` (every disc frame);
    - `markerFromContentBox` (border-left case);
    - `markerTopAligned` (line-height 40);
    - `markerNoPushDown` (push-down);
    - `markerSkipsNestedBlock` (nested padded block);
    - `emptyItemNoMarkerHeight` (empty item);
    - `symbolRectAscentUnrounded` (device-pixels).
  - Compiler: `ordinalIgnoresValue`, `reversedCountsUp`, `romanNoFallback` and `leadingZeroUnpadded`.
  - Runtime (SUPPORT_PLANTS): `discAsSquare` and `circleStrokeZoomed`. Both are caught by device-pixels.
- **Profile rows (new only):** `display: list-item` with each supported `list-style-type`, in list-item/<block-content|inline-content|flex-first|inline-block-first|empty>/<dir>, for symbol rows in both directions and text rows in ltr.
- **allowed_files:**
  - Engine:
    - `packages/layout/src/marker.ts` and `paint-marker.ts` (new);
    - `block.ts` (the placement steps and EngineFaults appends);
    - `input.ts` (the additive marker field);
    - `validate.ts`, `unsupported.ts`, `layout.ts` (the zoomInput marker body), `index.ts` (append) and `chrome-deviations-dpr.ts` (one entry);
    - `packages/layout/generated/**` and `packages/layout/vectors/**` (new, plus input-only migration);
    - `packages/layout/paint-vectors/**` (new);
    - `packages/layout/test/marker*.test.ts` (new);
    - the translate corpus sources (additive) and their lock outputs;
    - `scripts/migrate-marker-input.ts` and `scripts/check-marker-input-migration.ts` (new).
  - Compiler:
    - `analysis/ordinals.ts` and `css/counter-styles.ts` (new);
    - `analysis/resolve.ts` (the named hunk), `computed-checks.ts` and `context.ts` (contexts only), `lower/ios-layout.ts`;
    - `lower/native-program.ts`, `emit/uikit.ts`, `emit/android-views.ts`, `emit/native-support.ts` and `emit/expected-dump.ts` (the marker kind);
    - faults, catalogue, diagnostic-codes (append), profiles (output);
    - `packages/dragon/test/markers*.test.ts` (new).
  - Parity:
    - `capture.ts` (the carve-out widening) and `compare.ts` / `native-compare.ts` (kind lists, carve-out);
    - `fixtures.ts` (append), `fixture-groups/list-markers.ts` (new), fixtures (new);
    - outputs, lanes.json, north-star-check.json, WPT expectations.
  - `docs/ports.json` and `THIRD_PARTY_NOTICES.md`.
  - The note (main checkout).
- **verify:**
  - S1-S18 with the carve-outs.
  - S6: every existing vector keeps its `output`, and `scripts/check-marker-input-migration.ts` exits 0 with plants failing.
  - S13: break vectors are byte-identical.
  - `E node --conditions=dragon-internal scripts/check-marker-paint-oracle.ts`: N/N for every claimed symbol and DPR.
  - `E pnpm test -- chrome-ports`: the new entries pass.
  - north-star:check is byte-identical.
- **stop_if:**
  - BASE lacks GEN-a, INL2a or PNT1-radius;
  - a package named above is in flight on a shared engine or emitter file;
  - a Chrome capture disagrees with a ported formula and Blink does not explain it;
  - a ported file turns out to be LGPL;
  - float arithmetic is needed outside units.ts, or the translator core must change;
  - an existing output changes (a vector output, capture, break, emitted body or profile row);
  - a plant is not caught;
  - a pixel allowance would be needed;
  - a file outside allowed_files is needed;
  - verification fails twice;
  - Phase B: a lease is not held, a non-pixel lane fails, or a device-pixels failure is added.
- **PR split (three PRs under ~150 KB reviewed):**
  - **GEN-c1 (engine, about 140 KB).** marker.ts, block.ts, the input migration, the deviation, vectors and engine tests. The compiler still refuses list markers, so nothing is claimed.
  - **GEN-c2 (compiler and web, about 120 KB).** Ordinals, counter styles, the resolve hunk, checks, capture, the web fixtures and profiles. Native stays refused behind one switch.
  - **GEN-c3 (native, about 100 KB).** The marker node kind, symbol paint, the native lift and the device run.

## 4. Shared files and parallel safety

- **Single-owner hotspots touched (roadmap §4):**
  - `analysis/resolve.ts`: GEN-a and GEN-c, in named hunks. INL1a, INL2a, T133 and TXT-W also edit it. Merges are line-disjoint, or conflicts are resolved once on landing.
  - `analysis/computed-checks.ts`: appended functions.
  - `block.ts`: GEN-c only, serial with INL2b, INL1b and FLT.
  - `native-program.ts`, the emitters and `native-support.ts`: GEN-c only, after EMS's split. These are the paint-package rules.
  - `diagnostics/catalogue.ts`: one entry per line.
- **The shared set for the merge-conflict test (R17):**
  - css/properties.ts and shorthands/index.ts (registration lines; TXT-W and TDEC add theirs);
  - analysis/computed.ts, computed-checks.ts and resolve.ts;
  - faults.ts and catalogue.ts;
  - parity/src/fixtures.ts;
  - parity/src/capture.ts (FORM-a's neighbour hunk);
  - scripts/gen-css-grammar.ts;
  - test/diagnostic-codes.json and seams.test.ts.

  Everything else that conflicts is generated and is regenerated, never hand-merged.
- **GEN-P** writes new files only and runs beside everything.
- **The ua lane:** GEN-b regenerates the UA files through the unchanged generator. No other writer of `scripts/capture-ua-defaults.ts` is needed. TXT-W1's UA rows also regenerate, so the later of the two regenerates at merge.

## 5. Estimate

| Package | Size | Risk | Why |
|---|---|---|---|
| GEN-P | S, about 1 day | low | |
| GEN-b | S-M | low | Additive longhands and one refusal refined; the risk is the shorthand's `none` rule, pinned by chrome-dual |
| GEN-a | M | medium | A new capture path (CDP pseudo boxes plus snapshot text) and the collapse across generated text; the engine is untouched |
| GEN-c | L | medium-high | The engine input migration, block.ts baseline propagation with DPR-unzoomed constants, ordinals and counter-style ports, and native symbol paint that must be pixel-exact through paint-aa with no allowance |

The GEN-d family is L in total, each package S-M, and none is on the checkpoint-3 path.

## 6. Music-player north-star delta

- **0 on every target**, for GEN-b, GEN-a and GEN-c. examples/music-player/styles.css and tree use no `content`, no `::before`, `::after` or `::marker`, no `list-style` and no ul, ol or li. Their only pseudo-elements, `::-webkit-slider-thumb` and `::-webkit-scrollbar*`, belong to FORM-a and OVFL-s, and GEN must not change their diagnostics (the R5 pseudoElementOwner edits keep their messages byte-identical).
- **The check.** `examples/music-player/dragon/north-star-check.json` may change only in relaxed header and digest fields, and `summary` and `diagnostics` are byte-identical to BASE's. Each package's verify enforces this.
- **Why it still matters.** GEN raises the next real app's compile rate rather than the north star's. It removes the hard error on the Tailwind and modern-normalize preflight (finding 1), and lists with `list-style: none` (GEN-b) are the shape nearly every app uses.

## 7. Required board updates (PM)

1. T151 is done with this spec. Add Worker tasks:
   - GEN-P (dispatchable now; no lease);
   - GEN-b (gated on B0);
   - GEN-a (stacked on GEN-b);
   - GEN-c (gated on GEN-a, INL2a and PNT1-radius).
2. Board the GEN-d family (d1-d8) and POSX-IFC as queued Judge-spec tasks, in this order by usage and pattern frequency:
   1. POSX-IFC (the dominant `::after` overlay shape);
   2. d1 counters (10.8%);
   3. d2 quotes (8.0%);
   4. d6 `::marker` and inside;
   5. d4 images (5.3%);
   6. d7 nested lists;
   7. d3, d5, d8.
3. Record in docs/decisions.md as PM rulings:
   - R2 (generated boxes are build-time elements; no engine change);
   - R5's statically empty pseudo-elements;
   - R9 (pseudo capture method and cross-check);
   - R14's "symbol markers use no glyph" (this amends the roadmap's "TXT1 for marker glyphs");
   - R14's `list-marker-padding-unzoomed` deviation.
4. T019's "ol list-style-type: decimal (GEN/lists)" item is covered by GEN-b (UA declared value) and GEN-c (drawing).

## Receipt

**Spec:** /tmp/specs/T151.md

**Rulings:**
- **R1.** Split into GEN-P (probe), GEN-b (longhands and markerless list items), GEN-a (::before/::after strings), GEN-c (outside markers) and the GEN-d family (counters, quotes, attr, images, alt, ::marker and inside, nested lists, state-dependent content), plus POSX-IFC.
- **R2.** A generated box is a synthetic element of the resolved tree (FORM-a partElement precedent), so it takes every existing support row and refusal and needs no engine change.
- **R3.** A box exists iff the computed content is a string list and display is not none. normal → none on the pseudo-elements, none → normal on elements. counter, quote, attr, url and alt are refused, naming the GEN-d owners.
- **R4.** Hosts are supported non-replaced, non-control tags except html. Replaced elements, controls and html are refused (probe evidence).
- **R5.** `::before` and `::after` plus legacy single-colon, ending the selector, with +[0,0,1]. The preflight's `::backdrop`, `::file-selector-button`, `::placeholder` and input parts are accepted only when no host exists in the tree.
- **R6.** A generated box cascades its own pseudo rules on the host chain, inherits from the host, and `var()` works in content.
- **R7.** Generated text collapses within the host's inline formatting context. It is not selectable (P6c) and is exposed to accessibility per Chrome (P6b).
- **R8.** Display and position follow the normal rules (blockification, INL1a, INL2a). list-item, table and contents on pseudo-elements are refused. Abspos beside text keeps the existing refusal (POSX-IFC).
- **R9.** Capture: CDP getBoxModel and getComputedStyleForNode for pseudo boxes; DOMSnapshot textBoxes / DPR for generated text, cross-checked within 1/1024 px against Range rects; Chrome's pseudo set must equal Dragon's.
- **R10.** Web output writes `.cls::before{content; every longhand}` exactly when Dragon generates the box.
- **R11.** Native uses the existing node kinds, nothing new on device; GEN-c adds a marker view.
- **R12.** Generated content must be identical across states and bands, or it is refused (d8).
- **R13.** GEN-b adds content and list-style-* as longhands, with an additive migration checker. `display: list-item` is accepted when list-style-type and list-style-image are none, laid out as a block.
- **R14.** GEN-c covers outside markers per list_marker.cc and unpositioned_list_marker.cc:
  - symbols are painted shapes sized from the rounded ascent with no glyph and no TXT1 dependency;
  - the 7 and 1 device-px constants are unzoomed (deviation `list-marker-padding-unzoomed`, 48/48 probe);
  - ordinals and counter-style text are compile-time ports;
  - symbol paint goes through the paint-aa oval fill and stroke with no allowance;
  - rtl text markers and inside markers are refused.
- **R15.** The GEN-d family and POSX-IFC are recorded with their methods and licences (quotes class A).
- **R16.** Proof: chrome-dual plus frames and lines at DPR 1, 2, 3 and 2.625, ltr and rtl; vectors with TS = Swift = Kotlin; all five device lanes on both platforms; named plants; WPT refusals only shrink.
- **R17.** GEN-P on master 0d04dc09a5 now. GEN-b on the INL1a train position (tree-equal to master after INL1a, which contains FORM-a A4). GEN-a stacked on GEN-b. GEN-c after GEN-a, INL2a and PNT1-radius. A merge-conflict subset test replaces "not concurrent" stops against the text stack.

**Open questions for the owner:** none. Every question above was settled by source, probe or precedent. The only conditional is GEN-P's paint oracle: if paint-aa does not reproduce Chrome's marker ovals N/N, GEN-c ships those symbols web-only, naming a SKIA-AA follow-up, and does not add an allowance.
