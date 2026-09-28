# packages/dragon/src/css

The CSS front of the compiler. Each kind of feature has its own module, so feature packages can work in parallel with disjoint
write sets. The split is behaviour-preserving: `packages/dragon/test/seams.test.ts` pins the property order, the FIXTURES order
and ids, and the at-rule refusals as they were before it.

| module | owns |
|---|---|
| `stylesheet.ts` | The parse driver: rules, declarations, `!important`, grammar validation, and refusal of every node that is not a style rule or declaration (`refuseNode`, pinned by `s4a.test.ts`). It re-exports `CssValue`, `featureOf` and the selector types. |
| `selectors.ts` | Selector parsing into right-to-left compounds with specificity. Matching lives in `analysis/match.ts`. |
| `at-rules.ts` | The at-rule handler registry. Every at-rule is refused today. |
| `shorthands/index.ts` | The shorthand registry: one handler per shorthand, gathered from `box.ts`, `border.ts`, `flex.ts`, `overflow.ts` and `text.ts`. `shared.ts` holds the handler type and helpers. |
| `values.ts` | The `CssValue` model, token-to-value conversion, and support-profile feature keys. |
| `units.ts` | The unit registry: px, the absolute units, em and rem convert to px; viewport, font-metric, line-height and container units and math functions are refused with their reason. |
| `properties.ts` | The aggregate of `properties/<family>.ts`: `LONGHANDS`, `SHORTHANDS`, `INHERITED`, `PROPERTY_ASPECTS`, `PROPERTY_ROLE`. |
| `properties/<family>.ts` | Each family's longhands, shorthands, aspects, inherited set and role memberships. |
| `color.ts`, `lexer.ts`, `grammar.generated.ts` | Colour parsing and serialization, the webref lexer, and the generated grammar (`pnpm run grammar:gen`). |

## Where a new feature goes

- **A new longhand.** Add it to its family in `properties/<family>.ts`: the `*_LONGHANDS` list, `*_ASPECTS`, and, when it
  applies, `*_INHERITED`, `*_CONTAINER` or `*_TEXT_ROLE`. A new family is a new `properties/<family>.ts` plus one spread per
  table in `properties.ts`, appended after the existing families so the existing order does not change. Add the name to
  `SUBSET` in `scripts/gen-css-grammar.ts` and regenerate the grammar. Computing its value goes in `analysis/computed.ts`.
- **A shorthand.** Add the name to the family's `*_SHORTHANDS` list, and its handler to `shorthands/<family>.ts` (a new family
  file is also one spread in `shorthands/index.ts`). A handler gives the longhands a CSS-wide keyword sets, the expansion, and
  optionally `refuse` for grammar-valid values Dragon cannot express. For example, a `background` shorthand would be
  `properties/background.ts` plus a new `shorthands/background.ts`.
- **A unit.** Register it in `units.ts` with its conversion (`lengthToPx`), or as `refused` with a reason and a fix, which the
  parse driver reports at the token. An unregistered unit already parses and keeps a `<length-<unit>>` feature key, and the
  profiles refuse it. `computeLengths` in `analysis/computed.ts` converts every declared length to px (font-size first); the
  declared value keeps its unit, so its feature key stays `<length-<unit>>`.
- **An at-rule.** Replace its entry in `AT_RULE_HANDLERS` in `at-rules.ts`, one line per at-rule. The driver still reports
  the handler's outcome. An outcome other than `refuse` is a new `AtRuleOutcome` kind, which the driver handles.
- **A selector.** Parse the new part in `selectors.ts` and extend `Compound`, then match it in `analysis/match.ts`.
  Specificity is computed in `selectors.ts`.
- **Cascade or `var()`.** Logical-property cascade groups go in the `cascadeGroups` hook in `analysis/cascade.ts`. `var()`
  substitution goes in the `substituteVariables` hook in `analysis/computed.ts`. Both do nothing today.
- **A parity fixture.** Add a new `packages/parity/src/fixture-groups/<group>.ts` and append one entry to `FIXTURE_GROUPS` in
  `packages/parity/src/fixtures.ts`. Never edit `milestone-1.ts`.
