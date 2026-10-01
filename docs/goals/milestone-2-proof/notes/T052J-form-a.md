# T052J: FORM-a scope amendment (Judge, 2026-10-01)

Supersedes the T045 P5 allowed_files for Phase A. Phase B is unchanged and follows A4. PM accepted 2026-10-01.

## Rulings

1. **Node kind, not a required field.** The new kind is ControlBox, kind 'control': the same id, boxType, style and children fields as LayoutBox, plus control: range | slider-thumb{ratio} | button-block. Reasons:
   - It follows REPL-a (T051J).
   - Existing vectors stay byte-identical with no migration checker. A required field would add a key to every vector and an argument to every emitted native box constructor.
   - The translator has no optional fields.
   - Only packages/layout/generated/** changes text: the union type name.

   The container and track stay ordinary anonymous boxes, so only the input, the thumb and a block-level button carry facts. Flex and grid buttons are plain boxes (F1).
2. **The compiler supplies the ratio** from FORM-0's Decimal model (packages/dragon/src/forms). The engine only lays out.
3. **The worker's 14-item list is approved and split as below.** attributes.test.ts:65 is retargeted: FORM-a now handles input type, min, max, value and step, and other input types are refused naming FORM-b.

## A1 engine

Stacked on repl-a-phase-b, branch form-a.

- **ControlBox kind.** Add a ControlBox kind to input.ts with a required `control` field, one of:
  - `range`: default inline size 129 × zoom, used by intrinsic.ts and auto sizing;
  - `slider-thumb{ratio}`: the track's block layout places it with sliderThumbInlineOffset, mirrored for rtl;
  - `button-block`: safe centring.
- **Box walkers.** Every box walker treats `control` as a box (REPL-a's consumer set).
- **Native code.** native-support emits the kind, and the harness decodes it.
- **controls.test.ts.** Rewritten so that layout() itself produces the following, at 0 LU, with no helper applied after layout:
  - the range boxes, 348/348;
  - the button child rects, 1296/1296.
- **Plants.** Each must fail at least one case:
  - drop the safe clamp;
  - skip the rtl mirror.
- **Identity.** No committed output changes outside packages/layout/generated/**, and the north-star counts are unchanged.
- **Files.** allowed_files, verify and stop_if are in the T052 card.

## A2 appearance longhand (route 2a, like object-fit)

allowed_files:
- scripts/gen-css-grammar.ts and the regenerated grammar
- packages/dragon/src/css/properties/box.ts
- new scripts/check-appearance-migration.ts, with plants that must fail
- the seams pins in packages/dragon/test/seams.test.ts, paint-seams.test.ts and s4b.test.ts
- packages/parity/test/css-escapes.test.ts and paint-seams.test.ts
- regenerated captures, UA data and emitted outputs

The checker proves that captures, emitted bodies and UA entries differ only by appearance, at its initial value or its UA value. Boxes, lines, vectors and pixel manifests must be byte-identical. -webkit-appearance is an alias.

## A3 button (compiler and web)

allowed_files:
- the button element row: new packages/dragon/src/analysis/elements/controls.ts and its elements.ts line
- uaTagOf taking the type attribute
- the datasets.ts UA key and uaRows for button
- the type attribute row in attributes.ts and attributes.test.ts
- resolve.ts and computed-checks.ts:
  - the R11 devolve rule;
  - RF-INL refusal for inline-level controls;
  - R13 system colours, refusing dark ones before PNT1 and the system-ui font
- computed.ts (appearance and system colours only)
- lowering to button-block: ios-layout.ts and native-program.ts
- diagnostics: catalogue.ts or codes.ts and test/diagnostic-codes.json, append only
- fixtures: packages/parity/fixtures/controls-button-*.html and reject-controls-*.html, src/fixture-groups/controls.ts, the fixtures.ts append
- new packages/parity/test/controls-identity.test.ts
- regenerated outputs

verify:
- SIZE-ar verify 1-9 with controls.
- controls-identity proves that every pre-existing FIXTURES case's resolved values, native layout input and web body deep-equal A2.
- north-star:check: the 10 button errors reach 0.
- A3 fixtures capture the default width of block-level controls (Blink AutoWidthShouldFitContent).

## A4 range (compiler parts and web)

allowed_files:
- input[type=range] rows
- the min, max, value and step attribute rows
- cascade.ts: per-part cascade of ::-webkit-slider-thumb and ::-webkit-slider-runnable-track, taken out of the element cascade
- match.ts
- selectors.ts and selector-validity.generated.ts (refused to handled)
- resolve.ts: resolved styles for the container, track and thumb from forms/ua-shadow.generated.ts
- web-css.ts: the pseudo-element rules
- parity/src/capture.ts: shadow boxes through CDP pierce, as FORM-0 does
- range fixtures: ltr and rtl, the min/max/value/step matrix, solid thumb and track colours
- the controls-identity extension

verify:
- Chrome boxes and values match N/N.
- north-star:check: the type, min, max, value, appearance and slider-thumb errors reach 0, except the demo's inline-level range, which is refused naming RF-INL (T053).
- A4 fixtures capture the default width of block-level controls (Blink AutoWidthShouldFitContent).

## Common stop_if

- An existing output changes beyond named keys.
- A Chrome box or value disagrees.
- The native theme (FORM-b), system-ui or a dark system colour is needed.
- A pixel allowance is needed.
- Verification fails twice.

## Order and landing

- **Order.** A1 → A2 → A3 → A4, stacked.
- **A2 alongside A1.** A2's files are disjoint from A1's, so it may run alongside A1 in its own worktree on repl-a-phase-b, and is merged under A3.
- **PRs.** One PR per part. Reviews never block.
- **A1 merge.** A1 may merge once REPL-a has landed and its identity check passes.

## PM amendment A2-1 (2026-10-01)

The A2 worker stopped on two files outside allowed_files. Both are allowed, narrowly:
- **packages/dragon/src/css/shorthands/box.ts:** the '-webkit-appearance' alias handler only, as grid-gap maps to gap. Two pins move:
  - the seams SHORTHANDS order;
  - the css-escapes twin count, 13823 to 13858.
- **scripts/capture-ua-defaults.ts:** the drop-unmodelled plant is retargeted from button appearance to cursor, because appearance is now modelled. A guard makes the plant fail loudly when its target is not an unmodelled row.

Finding: Chrome 145 drops `appearance: base`, although webref's grammar allows it, so gen-css-grammar.ts narrows the grammar to what Chrome parses.
