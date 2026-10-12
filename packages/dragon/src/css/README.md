# packages/dragon/src/css

The CSS front of the compiler. Each kind of feature has its own module, so feature packages can work in parallel with disjoint
write sets. The split is behaviour-preserving: `packages/dragon/test/seams.test.ts` pins the property order, the FIXTURES order
and ids, and the at-rule refusals as they were before it.

| module | owns |
|---|---|
| `stylesheet.ts` | The parse driver: rules, declarations, `!important`, custom property declarations, declarations holding `var()` (kept pending until substitution), grammar validation (`parseValue`, shared with `parseSubstitutedValue`), and refusal of every node that is not a style rule or declaration (`refuseNode`, pinned by `s4a.test.ts`). It re-exports `CssValue`, `featureOf` and the selector types. |
| `escapes.ts` | CSS escapes as Chrome 145 reads them: css-syntax-3 §4.3.7 decoding, CSSOM identifier serialization, the in-place input preprocessing (U+0000, an escape at the end of the input), and `canonicalizeEscapes`, which the driver runs on each parsed tree before any keyword or grammar matching. |
| `variables.ts` | Token-aware splitting of a value into text and `var()` parts, with parse-time validation of `var()`. |
| `selectors.ts` | Selector parsing into right-to-left compounds with Selectors-4 specificity: type, universal, class, `[ui-*]` attribute, sibling combinators and the structural pseudo-classes (`:nth-*`, `:is()`, `:where()`, `:not()`, `:has()`, `:root`, `:empty`). Matching on each case's fixed tree lives in `analysis/match.ts`. |
| `at-rules.ts` | The at-rule handler registry. Every at-rule is refused today. |
| `shorthands/index.ts` | The shorthand registry: one handler per shorthand, gathered from `box.ts`, `border.ts`, `flex.ts`, `overflow.ts`, `text.ts` and `logical.ts`. `shared.ts` holds the handler type and helpers. |
| `values.ts` | The `CssValue` model, token-to-value conversion, and support-profile feature keys. |
| `units.ts` | The unit registry: px, the absolute units, em and rem convert to px; vw, vh, vi, vb, vmin and vmax are resolved by the engine; small, large and dynamic viewport, font-metric, line-height and container units, env() and the stepped-value and sign functions are refused with their reason. |
| `math.ts` | css-values-4 §10 `calc()`, `min()`, `max()` and `clamp()`: parsing, type checking and Blink's parse-time simplification, the refusals of what V1 of the value model does not support, the lowering to the engine's `CalcExpr`, and Chrome's serialization. |
| `properties.ts` | The aggregate of `properties/<family>.ts`: `LONGHANDS`, `SHORTHANDS`, `INHERITED`, `PROPERTY_ASPECTS`, `PROPERTY_ROLE`. |
| `properties/<family>.ts` | Each family's longhands, shorthands, aspects, inherited set and role memberships. |
| `color.ts`, `lexer.ts`, `grammar.generated.ts` | Colour parsing and serialization, the webref lexer, and the generated grammar (`pnpm run grammar:gen`). |
| `chrome-number.ts` | `chromeNumber`: a registered `@property` number, length or percentage as Chrome 145 serialises it (six significant digits). The only rounding outside `color.ts` and the ports, exempted by path in `ua.test.ts` and `s4b.test.ts`. |

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
- **A math function.** `values.ts` hands `calc()`, `min()`, `max()` and `clamp()` to `math.ts` with the property's context
  (`mathContextFor`): a number calculation folds to a number, a length calculation keeps its text with feature key `<calc()>`
  (or `<min()>`, `<max()>`, `<clamp()>`) and is lowered per element in `lower/ios-layout.ts`, and a refused one keeps its text
  with the reason as a comment and a feature type no profile row supports, so it is refused with that reason.
- **An at-rule.** Replace its entry in `AT_RULE_HANDLERS` in `at-rules.ts`, one line per at-rule. The driver still reports
  the handler's outcome. An outcome other than `refuse` is a new `AtRuleOutcome` kind, which the driver handles.
- **A selector.** Parse the new part in `selectors.ts` and extend `Compound`, then match it in `analysis/match.ts`.
  Specificity is computed in `selectors.ts`.
- **Cascade or `var()`.** The `cascadeGroups` hook in `analysis/cascade.ts` does nothing: logical property groups are applied before
  the per-longhand cascade (below). The cascade orders by importance, specificity and order, and also picks each element's custom property winners.
  `var()` substitution runs through the `substituteVariables` hook in `analysis/computed.ts`; the work is in
  `analysis/variables.ts` (custom property computation with cycle detection, substitution, invalid at computed-value time).
  `@property` registers through `at-rules/property.ts` and `analysis/registered.ts`, and `computeCustoms` applies it; `@layer` is
  ordered by `at-rules/layer.ts` (`layerRanks`) and compared in `beats` (`analysis/cascade.ts`).
- **A flow-relative property.** It is a shorthand of `properties/logical.ts` with a handler in `shorthands/logical.ts`: in
  horizontal-tb it expands to the physical longhands it maps to, an inline mapping once per direction with that direction on
  the `LonghandValue`. `analysis/logical.ts` computes each element's own direction and narrows every declaration to it
  before the cascade, so a flow-relative declaration and a physical one of the same group compete by specificity and order,
  as in Chrome. The order per element is Chrome's: custom properties, then `direction` (with `var()` substituted), then the
  mappings. A declaration holding `var()` records its physical longhands per direction (`PendingSubstitution.sides`), is
  narrowed to one side like any other, and is substituted as that direction's mapping. `writing-mode` accepts only
  `horizontal-tb` (every vertical value is refused), so nothing maps by writing mode.
- **A parity fixture.** Add a new `packages/parity/src/fixture-groups/<group>.ts` and append one entry to `FIXTURE_GROUPS` in
  `packages/parity/src/fixtures.ts`. Never edit `milestone-1.ts`.
