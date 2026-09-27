# T025 S1 phase review and S2 package

Judge, 2026-09-26, claude-code. **S1 approved.** The Judge re-ran typecheck and the 99 tests, all green with live Chrome and exact capture equality. Rounding is confined to units.ts with Blink citations. The planted faults fail. Profile rows come only from fixtures that passed. All five Worker deviations are acceptable.

## S1 must-fix items (carried into S2)
1. `finalCrossSize` silently ignores percentage min/max-width on stretched column items. A probe with max-width:50% gave 200px (`packages/layout/src/flex.ts` ~486-494).
2. Other px-only fallthroughs in intrinsic.ts and flex.ts need a fixture or must return LayoutUnsupported.
3. Longhands filled by shorthands (for example border-color as currentcolor) skip profile checks (`project.ts` checkSupport).
4. DPR is a module constant (`REFERENCE_DEVICE_PIXEL_RATIO`), not an environment input.
5. Nothing pins UA-vs-initial origin for each tag and longhand.
6. The fixtures are easy: no nested flex, negative margins or odd remainders.

## S2 constraints
- **Work order:** product first (emitter, dual check, colours, faults), then engine growth, then fixtures. Stay green at every step.
- **Emitter:**
  - Works from stage 1 (api.md 4.1): one deterministic rule per element, with every milestone longhand written explicitly and no dependence on the UA stylesheet.
  - Emits no authored selectors. Emits authored lengths, never iOS-lowered values.
  - The node-to-class mapping stays internal.
  - `outputs.web` becomes ready with files and a digest. iOS stays analysis-only.
- **Dual check:**
  - Both renderings use the same markup and the same Ahem face.
  - Boxes must be equal at 1/64 px, and `getComputedStyle` strings must be equal for all LONGHANDS.
  - The Dragon-layout lane keeps the 1 device px gate.
  - Authored captures stay live and must equal the committed expected JSON exactly.
- **Colours:**
  - color and background-color use the webref grammar.
  - Supported syntax: named, hex 3/4/6/8, rgb/rgba (legacy and modern), hsl/hsla, transparent and currentcolor.
  - color is inherited, and border colours resolve currentcolor.
  - Channels must exactly equal Chrome's authored computed channels. Any other syntax gives DRAGON_UNSUPPORTED_VALUE.
- **Profiles:**
  - Add aspect `computed-value` and lane `chrome-dual`.
  - Web rows need dual-check fixtures that passed in the same run.
  - **iOS colour rows are capped at `caveat`** (computed-value proof) until a native paint lane exists. This is flagged for the owner.
- **Faults:** internal switches in createProjectWith:
  - `variant-collapse`: the resolver ignores one class in compound selectors;
  - `colour-only`: perturbs only colour channels.
  - The true per-state collapse fault is deferred to S3.
- **Must-fix items 1-6 close with fixtures.** At least 21 new fixtures:
  - nested flex;
  - negative and mixed-sign margin collapsing;
  - collapse-through with min-height;
  - body margin collapsing with its first child;
  - flex auto margins with negative free space;
  - align-content across 3 or more lines with odd remainders;
  - wrap with per-line grow;
  - fractional px and % values;
  - percentage-height chains from html/body;
  - §9.8 definite percentages after flexing;
  - colour syntax and per-side border colours;
  - at least one new reject fixture.
- **Engine growth:**
  - full CSS2 §8.3.1 margin collapsing;
  - flex auto margins;
  - the remaining align-content values;
  - §9.9 intrinsic sizes for wrap and column;
  - percentage heights against definite sizes.
- **Housekeeping:** no screenshot gating. Reports are gitignored and deterministic. Commit locally only.
- **Worker note:** notes/T026-slice-2.md.

## Missing evidence
- Blink citations for the flex distribution order and justify share modes (measured only).
- Linux capture of UA defaults (font-family 'Times' on macOS may differ).
- The per-state collapse fault needs S3.
- The browser-worker import issue from css-tree's createRequire (S5).
