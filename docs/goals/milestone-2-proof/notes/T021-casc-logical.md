# T021: feat-cascade-var and logical properties (casc-logical)

Branch `casc-logical` in `/tmp/dragon-casc-logical`, from 184d6ff (master plus feat-block-elements). Not pushed.

## Commits

1. `a8d9cfb` merges feat-cascade-var. The source conflicts use `/tmp/t002-cascade-var-partial-resolution.patch`, applied to the 184d6ff versions. `fixtures.ts` takes the union of the fixture groups. For the count pins in the layout, parity and translate tests and in `case-count.ts`, master's derived counts are kept, because the branch changes there were only count derivation. Generated files keep master's side and are regenerated in commit 5.
2. `6667845` is the fix (below).
3. `aefb0e0` covers background `!important`. After the merge `!important` is supported on every declaration, which is a semantic conflict with master's `reject-background-important`. That reject fixture is now a Chrome-captured layout fixture, `background-important`, and `background.test.ts` asserts the declaration is important.
4. `317cd7c` adds the fixtures and the planted-fault tests.
5. `2e3d86e` regenerates every output from its inputs with the `/tmp/regen.sh` sequence. profile:rows was run until it reached a fixed point (below).

## Fix (Chrome order: css-cascade-5, css-variables-1 §3.1, css-logical-1 §3)

`cascadeElement` (analysis/cascade.ts) now works in three passes:

1. It computes the element's custom properties over its parent's, and returns the var() scope.
2. It computes `direction`. `elementDirection` in logical.ts now takes part with var()-holding declarations and substitutes the winner through the `substituteVariables` hook. A winner that is invalid at computed-value time is unset, which gives the parent's direction.
3. It runs the per-longhand cascade, with every declaration narrowed to that direction.

A var()-holding flow-relative declaration records its physical longhands per direction (`PendingSubstitution.sides`, set in stylesheet.ts). `inDirection` gives it a per-direction twin that keeps one side (`pending.direction`), and `substituteDeclaration` keeps only that direction's mapping after parsing. writing-mode stays refused, so the only mode is horizontal-tb. `specificityFor(sel, faults)` is kept everywhere, including in `elementDirection`, which used `sel.specificity` before.

Planted faults (faults.ts):

- `directionBeforeVar` skips var() direction declarations, which was the old behaviour.
- `varLogicalBothSides` leaves var() flow-relative declarations un-narrowed.

## Fixtures (fixture group cascade-var, both environment directions)

- `var-direction`: direction set through var(), both inherited and local; fallback; an invalid var() (a missing property, and a grammar-invalid value); `!important`; a custom property set to inherit or initial.
- `var-logical`: margin, padding, inset, border and size flow-relative properties holding var(), in ltr and rtl containers; fallbacks; an invalid var() (missing, and a grammar-invalid colour for padding); `!important`; direction set through var() on the same element.
- `css-wide-keywords-sides`: proves `unset` on direction and on each physical side in both directions. An invalid var() computes to these values, and `checkSubstitution` only accepts features that committed rows prove.

The planted faults fail every case of their fixture in parity.test.ts, with the nodes pinned: `directionBeforeVar` fails var-direction, and `varLogicalBothSides` fails var-logical. Unit tests are in `packages/dragon/test/var-logical.test.ts`. Their expectations match the captures.

## Output changes

- **Captures, vectors and emitted bodies.** No existing capture, vector or emitted CSS body changed; the only change is the compilation digest line in the emitted CSS headers. The new files come from background-important, css-wide-keywords-sides, var-direction and var-logical: 7 captures, 21 DPR captures, 49 vectors and 7 emitted files.
- **Profile rows.** There are 1250 rows per target, up from 1218. 25 come from feat-cascade-var, and 7 are new, all `exact` on ios and web:
  - `direction:unset` in not-flex-container/ltr and not-flex-container/rtl
  - `margin-right:unset` in block/rtl
  - `padding-left:unset` and `padding-right:unset` in block/ltr and block/rtl

  No row was removed and no status changed. 152 rows gained proof cases, only from cascade-var group fixtures and background-important.
- **North star.** Errors went from 746 to 708, and supported declarations from 70 to 103 of 291. One refusal was reclassified at the same span: `max-width: var(--content-max-width)` was CSS_INVALID_VALUE and is now UNSUPPORTED_VALUE per target, because it substitutes to rem, which is not supported yet.
- **Engine.** `packages/layout/src` and `packages/layout/generated` are unchanged.

## Retargets and decisions

- **Retarget: background `!important`.** The old test pinned `DRAGON_UNSUPPORTED_IMPORTANT` for `background: red !important` (`background.test.ts` and the reject fixture `reject-background-important`). After the merge, `!important` is supported on every declaration, so no `!important` value is still refused. The refusal can't be kept on another value, so the check is now stronger: a positive Chrome-captured layout fixture, `background-important`, plus a unit assertion that the declaration is important. The PM should confirm this is not a loosening.
- **Decision: IACVT behaves as unset.** A var() in direction or in a flow-relative property that is invalid at computed-value time behaves as unset on that direction's side only. Evidence: the Chrome 145 captures in var-direction and var-logical (nodes d1, d2, d6, d7, e1, e3, e6 and e7), and css-variables-1 §3.1. Unset direction is proven by literal `unset` in css-wide-keywords-sides.

## Verification

All checks were run on 2e3d86e:

- pnpm install --frozen-lockfile passes.
- pnpm typecheck passes.
- pnpm test: 1258/1258. Two earlier runs failed only on 120s and 900s test timeouts while the machine load average was 8 to 60 (the parity determinism test and planted-swift). Those two files passed when rerun.
- parity:capture and parity:dpr-capture, run twice, leave no diff.
- parity:report: 186/186 fixtures and 317/317 cases pass, failed 0. parity:dpr-report: 951/951, failed 0.
- native:gen leaves no diff in packages/layout/generated.
- parity:lanes --run-host passes, and lanes.json is unchanged.
- north-star:check passes: 708 errors, down from 746.
- The isSpecificityFirstArgument fault still fails selectors-specificity: that parity test passes, and `specificityFor(sel, faults)` is kept in cascade.ts and logical.ts.
- No excluded T025 file was touched: selectors.ts, match.ts, selector-validity.generated.ts, media/**, attributes.test.ts, and the attr-* and tree-attr-* fixtures.
