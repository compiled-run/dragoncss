# T009 V1 engine value model, Phase A: blocked after step 0

Worker, 2026-09-28. Worktree /tmp/dragon-v, branch v1-value-model, BASE 12af7cb (master with P4, M1 and M2). Binding spec: notes/T006-value-model-spec.md §3-§4. No simulator or emulator was booted.

## Result

Step 0 is done and committed. The package stopped before any engine or compiler edit on stop_if "a file outside allowed_files is needed". A second, spec-internal conflict is recorded below for the same re-dispatch.

## Step 0: the recursive CalcExpr union translates

`packages/translate/test/calc-probe.test.ts` (new) writes a probe module to a temp dir. The module holds:
- the full V1 `CalcExpr` union (px, percent, number, viewport, em, sum, product, invert, min, max, clamp, pixels-and-percent) with recursive fields: `em.fontSize`, `invert.term`, `clamp.min/value/max`, and the `terms` arrays;
- `LengthCalc` inside a `SizeValue` family;
- recursive `hasPercent` and `evaluate` functions, with float folds.

It then checks:
- `checkSubset` finds 0 violations and the Lowerer reports none. The union lowers with 12 members, and `em.fontSize` is typed as the union.
- The Swift translation (`swiftc -O`) and the Kotlin translation (kotlinc, JDK 17) compile. Both return the TypeScript result for 40 values, bit for bit.

The translator core needed no change. One subset fact matters for V1 code: `Math.min`/`Math.max` are outside the subset, so calc min, max and clamp must use explicit comparisons (`b < a ? b : a`, which is `std::min` order).

`pnpm run layout:subset` reports 0 violations at BASE.

## Blocker 1 (stop): two pre-existing reject fixtures contradict the V1 objective

The spec's objective has V1 support:
- `vw`/`vh`/`vmin`/`vmax`/`vi`/`vb` as lengths (§3 item 2);
- `em` inside calc as an `EmLength` leaf (§3 item 3).

Two existing fixtures in the `units` group expect exactly these values to be refused:
- `reject-unit-vw`: `.a { width: 50vw }`, expecting DRAGON_UNSUPPORTED_VALUE with the prefix "width: 50vw is unsupported: viewport units".
- `reject-unit-calc`: `.a { width: calc(10px + 2em) }`, expecting the prefix "width: calc(10px + 2em) is unsupported: calc() is a css-values-4 math function".

Once V1 lands, both stop producing the diagnostic, so parity:report fails.

Retargeting them needs `packages/parity/src/fixture-groups/units.ts` and `packages/parity/fixtures/reject-unit-{vw,calc}.html`. The spec lists `dragon/test/units.test.ts` for this purpose, but not these two files. Its allowed_files permit only new files under `fixtures/*` and one appended entry in `fixtures.ts`.

Suggested amendment, for the PM to decide:
- Allow edits to `fixture-groups/units.ts` and those two fixture files.
- Retarget them to values V1 still refuses:
  - `reject-unit-vw` becomes `50svw`, with the prefix "width: 50svw is unsupported";
  - `reject-unit-calc` becomes `round(10px, 3px)`, or `calc(10px + 2ex)`, with V1's refusal prefix.
- Alternatively, delete both from `units` and add equivalents to the new `values` group. That also needs the units.ts edit.

## Blocker 2 (spec conflict, for the same amendment): verify 5 "the lock changes only by the added calc suites"

The spec requires both of these:
- the 8 engine faults appended to `EngineFaults`/`NO_ENGINE_FAULTS` (block.ts);
- the harness decoder to stay exact-key (`FAULT_KEYS`, harness.ts "exact keys, no defaults").

Every existing corpus line serialises the full faults object (`corpus.ts` `faultsFor`, `vectorCase`, `JSON.stringify({ ..., faults: NO_ENGINE_FAULTS, ... })`). So adding the 8 keys (all false) changes the input text of every line in the existing suites: vectors, engine, vectors-m2, vectors-dpr and engine-dpr. Their per-suite digests change, and so do the `p1`/`extended` digests in lanes.json.

Line counts and results stay identical. P2b (a513d92) changed corpus.json the same way when it added `initialLineWidthZoomed`.

Suggested amendment: restate verify 5 as follows:
- every pre-existing suite has the same line count;
- its results are the same, line for line;
- its inputs are the same after the appended false fault keys are removed;
- corpus.json and lanes.json digests may change for that reason only.

## Design facts found while scoping (for the re-dispatch)

- **Math refusals.** They run in `css/stylesheet.ts`, which is not allowed, through `mathFunctionRefusal(name)` and `unitRefusal(unit)` in `css/units.ts`, which is allowed. They only see the function name, not its contents.
  - `toValue` keeps an unrefused function as `{ kind: 'other', type: 'calc()', text }`. So the feature keys `<calc()>`, `<min()>`, `<max()>` and `<clamp()>` and verbatim web output already follow.
  - Adding a new `CssValue` kind would break the exhaustive switch in `emit/web-css.ts` `valueText`, which is not allowed. V1 should therefore parse the math tree from the `other` text in `css/math.ts`.
  - Refusals of the contents (env(), sv/lv/dv, font-metric units, typed arithmetic, number mixed with length, % in gap) should be raised in computed.ts or the lowering.
- **Viewport units at DPR 1.** At DPR 1, `zoomInput` returns its input unchanged. The environment pass must run at DPR 1 too (spec §3 item 6), and every existing input must come out structurally equal.
- **`inline.ts` reads `LineHeightValue`.** V1 leaves it unchanged, as the spec says.

## Commands

- `pnpm install --frozen-lockfile`: pass (lockfile unchanged)
- `npx vitest run packages/translate/test/calc-probe.test.ts`: pass (3/3)
- `pnpm run layout:subset`: 0 violations
- `pnpm typecheck`: pass
