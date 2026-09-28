# T016 A: MQ-a Phase A (media query parser, evaluator, band partition, Chrome corpus)

Worker note, 2026-09-28. Branch `mq-a-media` in `/tmp/dragon-mq`, based on 12af7cb. Only new files. The spec is T025 §3, Phase A.

## What landed

`packages/dragon/src/media/` is pure TypeScript. It has no `node:` imports and no rounding functions.

| File | Content |
|---|---|
| `tokens.ts` | CSS Syntax 3 tokenizer and component values. Offsets index the source, so `<general-enclosed>` keeps its authored text. |
| `parse.ts` | MQ4 grammar: media types all, screen, print and any other type (an unknown type matches nothing); `only`; `not`, `and` and `or` (no mixing, no `or` after a media type); the comma list; plain, boolean and range features (`a < name < b`, where both comparisons must point the same way). An invalid query becomes `not all`, and a `( … )` or function that doesn't parse is `<general-enclosed>`. `parseMediaPrelude(node)` takes css-tree's prelude, either Raw (`parseAtrulePrelude: false`) or parsed (it is generated back to text). It also provides the serialisers and `featuresOf`. |
| `length.ts` | px, em and rem, plus `calc()` with Chrome's simplification (terms combined, sorted em, px, rem, zero terms kept). em and rem are always 16px. A unitless 0 is allowed. |
| `features.ts` | Evaluated features: width, height, aspect-ratio and orientation, with min- and max-. Environment features (refused until MQ-R): every prefers-*, hover, pointer, any-*, resolution, -webkit-device-pixel-ratio, color and the rest of Chrome's list. |
| `evaluate.ts` | `evaluateMediaQueryList(list, { width, height })` uses Kleene logic and treats top-level unknown as false (the `not` modifier included). A list that uses a refused feature is refused whole, with typed refusals. `evaluateWithOracle` is the hook for per-band evaluation. |
| `band.ts` | `band(lists)` collects the width and height atoms and builds exact real intervals on [0, ∞). Each threshold is its own point region, and neighbouring regions that give the same truth vector merge. Bands are the width groups × the height groups, ordered by width then height. The condition text is `atom` or `(not atom)`, joined with ` and `, or `all` when there are no atoms. Typed refusals: `too-many-bands` (more than 16), `non-axis-feature` (aspect-ratio or orientation) and `refused-value`. `bandAt` and `evaluateInBand` complete the API. |
| `faults.ts` | The five planted faults, local to the module. |

**Proof.**
- `scripts/capture-media-data.ts` uses `launchChrome` and `openPage` unchanged.
- `packages/dragon/test/media/corpus.json` holds 184 evaluated queries, 20 refused queries and 13 band sheets (10 captured, 3 must be refused).
- `captures/chrome-145.json` holds 204 queries and 10 band sheets at 109 viewports, on pages whose root font size is 16px and 20px. It records mediaText and matchMedia for every query and every derived band condition.
- The viewports come from each threshold: equal and ±1, or floor and ceil for a fractional threshold; the midpoints between neighbours; below the first and 100 past the last; aspect-ratio and orientation boundaries at height 300; and one integer sample per band. They are limited to 50–2000 × 50–1200.
- `--check` recaptures byte-identically.
- `test/media/media.test.ts` and `faults.test.ts` run 42,639 comparisons with 0 mismatches unfaulted.
- Every captured band holds at least one captured viewport. At every captured viewport, Chrome matches exactly the one band condition `bandAt` names, at both roots.

**Planted faults.** Each flips comparisons against the capture:

| Fault | Mismatches | First one |
|---|---|---|
| `maxWidthExclusive` | 538 (428 matches, 110 band) | `only screen and (max-width: 768px)` at 768 |
| `emFromRoot` | 156, all on the 20px root | `(max-width: 25em)` at 401 |
| `unknownAsTrue` | 6176 | `(foo: bar)` |
| `notBindsTighterThanAnd` | 482 (478 matches, 4 mediaText) | `not screen and (max-width: 768px)` at 769 |
| `bandGapAtBoundary` | 281 band | north-star at 640 |

## Decisions (with evidence)

1. **`(orientation > portrait)` is refused.** Chrome and MQ4 disagree on it. I ruled on it under the PM decision rule.
   - Chrome 145 matches it exactly like `(orientation: portrait)`. The capture shows this at every width below 300 at height 300.
   - The Blink 145.0.7632.6 source confirms it. `OrientationMediaFeatureEval` in `third_party/blink/renderer/core/css/media_query_evaluator.cc` takes the `MediaQueryOperator` unnamed and ignores it. `media_query_exp.cc` validates only the ident value, not whether the feature allows a range context.
   - MQ4 makes a discrete feature in a range context invalid, which would give `<general-enclosed>` and false.
   - Adopting either reading would leave Dragon disagreeing with one of the two. So a discrete feature in a range context with a valid value is a typed refusal (`refused: 'value'`). Chrome's serialisation is kept, and it is in the corpus's refused list next to `(orientation <= landscape)`.
   - With an invalid value, `(orientation > foo)` stays `<general-enclosed>`. Chrome agrees.
2. **Exact numbers in src, and Chrome's six-digit mediaText format is passed in by the caller.**
   - The dependency boundary tests (`ua.test.ts` "colour conversion and rounding live only in css/color.ts" and `s4b.test.ts` (iii)) ban `Math.round|floor|ceil|trunc|fround|toFixed|toPrecision` anywhere in `packages/dragon/src` except css/color.ts. My first version broke both.
   - There is a correctness reason as well. A band condition written with Chrome's mediaText numbers would move an authored threshold: `1234.5678px` becomes `1234.57px`. Phase B emits these texts into web CSS.
   - So the serialisers take a `NumberFormat`. The default is `exactNumber` (JS shortest round-trip; `1e-7` is valid CSS). The test compares against Chrome with `test/media/chrome-number.ts` (printf `%g`, 6 digits).
   - The capture confirms the format: `1.23457e+08px`, `1e-07px`, `0.0001234px`, `1234.57px` and `1e+06px` for `999999.5px`.
   - Integer viewport sampling also uses floor and ceil, so it lives in the capture script, not in src. `band()` returns exact intervals only; Phase B's sweep can pick samples in parity src.
3. **Unsupported but valid values are refused, not made unknown.** These are the other length units (cm, vw, ex and so on), min(), max() and clamp(), calc keywords such as infinity, and the degenerate ratio 0/0. Chrome evaluates all of them.
4. **Environment features in `band()`.** `band()` ignores environment features. The rule filter in Phase B refuses them anyway.
5. **The environment list is wider than the spec's.** T025 lists prefers-*, hover, pointer, resolution and -webkit-device-pixel-ratio. Chrome also evaluates color, any-hover, display-mode, device-width and others. If they were treated as unknown features, Dragon would disagree with Chrome (`(color)` is true), so they are refused too.

## Chrome facts the capture pins

- em and rem in media ignore the root: `(max-width: 25em)` matches at 400 and not at 401, at both roots.
- `all and X` serialises as `X`, but `only all and X` and `not all and X` keep `all`.
- Case is folded and whitespace normalised (`(width>=600px)` becomes `(width >= 600px)`). `<general-enclosed>` is kept verbatim (`(FOO:   BAR)`, `garbage(`).
- An empty item in the comma list becomes `not all` (`(width), not all, (height)`). An empty list is `""` and matches.
- `and(` and `not(` are function tokens, so `(width) and(height)` is `not all` and `not(width)` is unknown.
- Ratios serialise as `a / b`, and a single number as `n / 1`.
- `not screen and (foo: bar)` is false, because unknown stays unknown under `not`.

## Verify (T025 §3 Phase A)

All with the env prefix, in `/tmp/dragon-mq`:

1. `pnpm install --frozen-lockfile` and `pnpm typecheck`: exit 0. `pnpm test`: 66 files and 1387 tests pass (second attempt).
   - The first run had 2 boundary failures from my src rounding, now fixed.
   - It also had 4 parity/native tests time out at 120 s, at a load average near 49 from the concurrent worktrees. They are unrelated to this diff and passed on the rerun.
2. `pnpm exec vitest run packages/dragon/test/media`: 2 files and 18 tests pass.
3. `node --conditions=dragon-internal scripts/capture-media-data.ts --check`: exit 0 (byte-identical).
4. `grep -rn "from 'node:" packages/dragon/src/media`: no output (grep exits 1).
5. The planted faults all flip (see the table), and the unfaulted run has 0 mismatches over 42,639 comparisons.
6. Commit 2b69f77. `git diff --name-only 12af7cb..HEAD` lists only `packages/dragon/src/media/**`, `packages/dragon/test/media/**` and `scripts/capture-media-data.ts`. `git remote -v` is empty. This note is not committed on the branch (PM rule 3).

## For Phase B

- Filter rules with `evaluateInBand(list, partition, band)`. The atom lookup uses exact serialisation.
- Refused lists and the three typed `band()` refusals map to `DRAGON_UNSUPPORTED_AT_RULE` naming MQ-R.
- Nested `@media` is conjunction at the rule level. `band()` takes every list of the sheet.
