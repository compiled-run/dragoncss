# T034: How far is real Tailwind v4 output from compiling in Dragon?

Scout note, 2026-09-27. The owner's idea: "use the tailwind compiler to output vanilla css and that css uses dragon to then style so even regular tailwind css just works."

I ran real Tailwind output through Dragon's public `createProject(...).check(...)`. All experiments are in `/tmp/t034`. The repo was not changed apart from this note. I did not run any of the repo's regenerating scripts.

## 1. Versions

| Item | Value |
|---|---|
| tailwindcss | **4.3.3**, MIT licence (from its package.json) |
| @tailwindcss/node | 4.3.3, MIT |
| postcss (probe helper only, not Tailwind's pipeline) | 8.5.28 |
| node | v24.15.0, which strips types from `.ts` imports without a flag |
| Dragon | `packages/dragon/src/index.ts` from the working tree on `master` (clean) |

## 2. What I ran and what I only read

**Ran**, all under `/tmp/t034`:

```sh
npm init -y && npm i tailwindcss@latest @tailwindcss/node@latest @tailwindcss/oxide@latest
npm i postcss@8
node build.mjs   # @tailwindcss/node compile(css,{base}).build(candidates) -> out/{full,nopreflight,inline}.css
node patch.mjs   # added the class-renaming probes to run.mjs
node run.mjs     # builds a FrontEndResult for each probe, runs check(), writes out/results.json
```

`run.mjs` imports `/Users/jacksm5pro/dev/open-source/dragon/packages/dragon/src/index.ts` directly, without the `dragon-internal` condition. Only the public API is used.

**Read, not run:**
- `docs/api.md` §2, §3.1, §3.2 and §5
- `docs/decisions.md`
- `docs/goals/milestone-1/goal.md` (design principles)
- `packages/dragon/src/types.ts`
- `packages/dragon/src/css/stylesheet.ts`
- `packages/dragon/src/analysis/input.ts:454`
- `packages/dragon/src/diagnostics/codes.ts`
- `packages/parity/src/tree-fixture.ts`
- `packages/parity/fixtures/tree-attribute-equality/*`

### Tailwind inputs

The CSS text passed to `compile()`:

- `full`: `@import "tailwindcss";`. This includes Preflight, the theme and the utilities. Output is 9,704 bytes and 374 lines.
- `nopreflight`: `@layer theme, base, components, utilities; @import "tailwindcss/theme.css" layer(theme); @import "tailwindcss/utilities.css" layer(utilities);`. Output is 5,255 bytes and 219 lines.
- `inline`: the same as `nopreflight`, but the theme import has `theme(inline)`. Utilities then carry literal values, such as `oklch(...)` and `calc(0.25rem*6)`, instead of `var(--color-*)`. Output is 4,460 bytes and 199 lines.

`build()` was called without Tailwind's optimize pass (lightningcss). The output contains no CSS nesting (`&` count 0). Variants appear as `.hover\:x:hover` inside `@media (hover: hover)`, and `md:` appears as `@media (width >= 48rem)`.

### Components and their 27 class candidates

- **card:** `rounded-xl bg-white p-6 text-slate-900 shadow-lg`
- **cardTitle:** `text-lg font-semibold`
- **button:** `rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50 data-[state=on]:bg-sky-800`
- **row:** `flex flex-col gap-4 md:flex-row`, with two `flex-1` children
- **text:** `text-base leading-7 text-gray-700`

### The Dragon input

The FrontEndResult is built the same way as `packages/parity/src/tree-fixture.ts`:

- **Sources:** a pseudo-template source `app.dg` for origins, plus `tailwind.css`.
- **Stylesheet:** one style use, `tw`, with `scope: {kind:'document'}`.
- **Class symbols:** `{owner:'doc', sheet:'tw', name}`.
- **Tree:** `html > body > div.card > [h2, p, div.row > div×2, button]`, with `completeness: 'closed-application'`.
- **Finite states:**
  - `on` has the domain `[false, true]` and drives `data-state` = `"on"` or absent.
  - `disabled` has the domain `[false, true]` and drives the `disabled` attribute = `""` or absent.
- **Not modelled:** hover and focus-visible have no representation in dragon/tree@0.
- **Targets:** `{web:{}, ios:{minimum:'15'}}`.

### Probe ladder

Each rung removes the blocker that hid the next layer of diagnostics. Only `raw` is the real Tailwind output. The later rungs are exposure probes and do not propose workflows.

| Probe | Change applied to the CSS and tree |
|---|---|
| `raw` | none |
| `renamed` | The 7 variant classes (e.g. `md:flex-row`) are renamed to identifier-safe names in both the tree and the CSS selectors. |
| `unwrapped` | Also: `@layer` statements are removed and `@layer` blocks are replaced by their contents. Source order equals layer order here. |
| `hoisted` | Also: rules inside `@media` and `@supports` are moved to the top level. **This changes the meaning.** Its only purpose is to show the diagnostics inside those rules. |
| `hoisted-ui` | Also: `[data-state="on"]` becomes `[ui-state="on"]` and `:disabled` becomes `[ui-disabled]`, with the tree attributes renamed to match. |

## 3. Results

Every probe returned `ok=false` with `{web:'blocked', ios:'blocked'}`.

### 3.1 Diagnostic counts by probe and code

| probe | total | INPUT_INVALID | CSS_PARSE | AT_RULE | SELECTOR | PROPERTY | CSS_INVALID_VALUE | UNSUPPORTED_VALUE | IMPORTANT | ELEMENT | ATTRIBUTE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| full/raw | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| full/renamed | 33 | 0 | 5 | 23 | 0 | 0 | 0 | 0 | 0 | 3 | 2 |
| full/unwrapped | 184 | 0 | 5 | 21 | 42 | 71 | 17 | 22 | 1 | 3 | 2 |
| full/hoisted | 200 | 0 | 0 | 17 | 48 | 88 | 18 | 23 | 1 | 3 | 2 |
| full/hoisted-ui | 196 | 0 | 0 | 17 | 46 | 88 | 18 | 23 | 1 | 3 | 0 |
| nopreflight/raw | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nopreflight/renamed | 31 | 0 | 4 | 22 | 0 | 0 | 0 | 0 | 0 | 3 | 2 |
| nopreflight/unwrapped | 81 | 0 | 4 | 20 | 7 | 30 | 15 | 0 | 0 | 3 | 2 |
| nopreflight/hoisted | 97 | 0 | 0 | 17 | 12 | 47 | 16 | 0 | 0 | 3 | 2 |
| nopreflight/hoisted-ui | 93 | 0 | 0 | 17 | 10 | 47 | 16 | 0 | 0 | 3 | 0 |
| inline/raw | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| inline/renamed | 30 | 0 | 4 | 21 | 0 | 0 | 0 | 0 | 0 | 3 | 2 |
| inline/unwrapped | 75 | 0 | 4 | 20 | 5 | 14 | 3 | 24 | 0 | 3 | 2 |
| inline/hoisted | 91 | 0 | 0 | 17 | 10 | 31 | 3 | 25 | 0 | 3 | 2 |
| inline/hoisted-ui | 87 | 0 | 0 | 17 | 8 | 31 | 3 | 25 | 0 | 3 | 0 |

All codes carry the `DRAGON_` prefix, dropped in the table. Diagnostics with target `null` block every target. The support-profile `UNSUPPORTED_VALUE` rows come in pairs, one for web and one for ios.

**How the diagnostics hide each other:**
- **Class names come first.** The 7 `INPUT_INVALID` diagnostics come from `input.ts:454`, which requires class names to match `/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/`. These are tree validation errors, so no CSS is analysed at all.
- **Then top-level at-rules.** `stylesheet.ts` drops every top-level at-rule with one diagnostic and never looks inside it. In `renamed`, the whole utility layer is therefore hidden behind 5 or 6 `@layer` diagnostics. This fails closed, which is correct, but the user sees about 30 diagnostics while about 200 problems lie underneath.

### 3.2 By CSS construct

Counts are from `nopreflight/hoisted`, 97 diagnostics in total. The `full` column shows what Preflight adds, from `full/hoisted`.

| Construct | Dragon code | nopreflight | full | Detail |
|---|---|---|---|---|
| Tailwind class names in the tree (`md:`, `hover:`, `data-[…]:`) | INPUT_INVALID | 7 (raw) | 7 (raw) | Every class with a variant fails. Arbitrary values, such as `w-[3px]` or `p-0.5`, would fail the same way (inferred from the regex). |
| `@layer` statements and blocks | AT_RULE | 5 | 6 | These wrap all of the output. |
| `@property` | AT_RULE | 17 | 17 | One for each `--tw-*` variable that a used utility touches (shadow, ring, leading, font-weight, outline). |
| `@supports` | AT_RULE | 1 | 2 | Tailwind's fallback `*, ::before, ::after, ::backdrop { --tw-*: initial }` is guarded by an old-Safari/Firefox `@supports`. Preflight adds a placeholder `@supports`. |
| `@media` (`md:` width, `hover: hover`) | AT_RULE | 2 | 2 | `(width >= 48rem)` range syntax and `(hover: hover)`. |
| At-rule prelude parse | CSS_PARSE | 4 | 5 | Zero-width errors ("Colon is expected", "Identifier is expected"). They disappear once the at-rules are hoisted, so they come from `@media`/`@supports` preludes. Which prelude causes which error is inferred, not isolated. |
| Theme custom properties on `:root, :host` (`--color-*`, `--spacing`, `--text-*`, `--radius-*`, `--font-weight-*`) | PROPERTY | 16 | 20 | Each declaration is "not supported". |
| `--tw-*` custom properties | PROPERTY | 20 | 20 | 6 in utilities (`--tw-leading`, `--tw-font-weight`, `--tw-shadow`, 2 each) and 14 in the `@property` fallback block. |
| `var()` chains, including `var(--tw-leading, var(--text-base--line-height))` | CSS_INVALID_VALUE | 16 | 18 | These fail the @webref grammar check because Dragon does no `var()` substitution. They cover every colour, font-size, line-height, padding and gap utility. |
| `calc()` | CSS_INVALID_VALUE (nested in var) / UNSUPPORTED_VALUE | 3 (inside var) | — | In `inline`, 14 of the 20 profile rows are `calc()` values on both targets: `padding-*` (8), `line-height` (2) and `gap` (4, the next row). The other 6 are `rem` font-sizes. |
| `rem` font-size | UNSUPPORTED_VALUE | (inline) 6 | — | `font-size: 1rem`, `0.875rem` and `1.125rem` are unsupported on web and ios by profile m1-s3b. |
| `gap` values (a subset of the calc rows) | UNSUPPORTED_VALUE | (inline) 4 | — | `row-gap: calc(0.25rem*4)` and `column-gap: calc(0.25rem*4)`, on both targets. These are included in the 14 calc rows. |
| `oklch()` | UNSUPPORTED_VALUE | (inline) 5 | — | This is every Tailwind palette colour except white. |
| `color-mix()` | UNSUPPORTED_VALUE | 0 | 1 | Preflight's `::placeholder` colour. |
| `:root`, `:host` | SELECTOR | 2 | 2 | The theme selector. |
| `*`, `::before`, `::after`, `::backdrop` | SELECTOR | 4 | 8 | These carry the `--tw-*` initial values. Preflight's reset adds more. |
| `:hover` | SELECTOR | 1 | 1 | |
| `:focus-visible` | SELECTOR | 3 | 3 | |
| `:disabled` | SELECTOR | 1 | 1 | Becomes 0 with `[ui-disabled]`. |
| `[data-state="on"]` | SELECTOR | 1 | 1 | Only `[ui-*]` is allowed. Becomes 0 with `[ui-state="on"]`. |
| Preflight-only selectors | SELECTOR | 0 | 30 | `::file-selector-button` (4), `::placeholder` (2), `::-webkit-*` (14), `:-moz-*` (2), `:where(...)` (5), `[hidden]`, `[type=…]`, `:where(:not([hidden="until-found"]))` |
| Properties the utilities use | PROPERTY | 11 | 11 | `border-radius` (2), `padding-inline`, `padding-block`, `font-weight`, `box-shadow`, `opacity`, `outline-style`, `outline-width`, `outline-offset`, `outline-color` |
| Properties only Preflight uses | PROPERTY | 0 | about 37 | `font-feature-settings`, `font-variation-settings`, `vertical-align`, `text-decoration`, `-webkit-*`, `tab-size`, `letter-spacing`, `font`, `list-style`, `appearance`, `resize`, `top`/`bottom`, `text-indent`, `border-collapse`, logical margins and padding, etc. |
| Preflight values | UNSUPPORTED_VALUE | 0 | 22 | `inherit` (4), `em`/`%` font sizes (3), `position: relative`, `display: list-item`/`block`, `height: auto`, each on web and ios. There is also 1 `!important` (`[hidden]`) and 2 invalid font-family stacks. |
| Elements `h2`, `p`, `button` | ELEMENT | 3 | 3 | Only `html`, `body` and `div` are allowed in milestone 1. |
| Tree attributes `data-state`, `disabled` | ATTRIBUTE | 2 | 2 | Only `ui-*` attributes take part in matching. |

**What `inline` (theme(inline)) shows:** it removes all 16 theme custom-property diagnostics and 13 of the 16 `var()` diagnostics. The next barrier is then made of three things:
- `oklch()` (5 diagnostics);
- `calc()`, `gap` and `rem` values, which profile m1-s3b does not support (20 diagnostics, 10 per target);
- `--tw-*` plus `@property`, which stay because `shadow-lg`, `font-semibold` and `leading-*` always write through `--tw-*`.

**Owner scoping works as is.** A document-scoped sheet with `{owner:'doc'}` class symbols produced no `DRAGON_CLASS_OWNER` or scope diagnostics. Tailwind utilities are single-class selectors, which fit the scoping rules.

## 4. Fit with Dragon's design

These come from reading the docs and code.

### Already planned in the design; only the implementation is missing

- **Custom properties, `var()`, the custom-property dependency graph and cascade layers.** docs/api.md §5 says: "values checked against the correct grammar after per-condition `var()` substitution; a custom-property dependency graph", and cross-file definitions for "custom properties … layers".
- **`:root` tokens.** §3.1 says: "The document element is the only root for `:root`, root tokens".
- **`@media` and `@supports` as environment conditions.** §5 says: "The core can evaluate CSS media features and `@supports` using profile-backed answers." Width conditions are listed in goal.md principle 1.
- **`:hover` only on hover-capable devices.** goal.md principle 3 says: "It applies `:hover` only on devices that can hover." `@media (hover:hover)` fits this, but `:hover` itself needs an interaction state in the tree model, which does not exist yet.
- **Owner scoping.** Document-scoped sheets with single-class utilities satisfy "a selector may test only its own element, parents in the same component, and app-wide conditions" (decisions.md, Direction).

### Conflicts or gaps in the design

1. **Class-name identifier rule.** `input.ts` rejects any class name that is not a CSS identifier. Tailwind's model relies on class names such as `md:flex-row` and `w-1/2`, which are valid HTML class tokens. `ClassSymbol.name` should take the class-attribute token, and the selector matcher should compare it with the unescaped selector name.
2. **`ui-*`-only attributes.** Tailwind's state variants are `data-*`, `aria-*` and pseudo-classes (`:disabled`, `:checked`, `:hover`, `:focus-visible`, `:active`). Dragon only matches `[ui-*]`. Either admit `data-*` and `aria-*` attributes backed by finite states, or map `:disabled` and `:checked` onto element states from the tree. Interaction states (hover, focus-visible, active/pressed) need a tree-level kind. goal.md already names "pressed" as a condition.
3. **The universal `*` and pseudo-elements carrying `--tw-*` initial values.** On native targets these should not be matched. The design fits a build-time fold better: `@property` initial values plus `inherits: false` define each variable's value on every element with no selector. The `*, ::before, ::after, ::backdrop` rule is only a fallback for browsers without `@property`, guarded by `@supports`. Dragon can evaluate that `@supports` as false from the profile, which removes it without supporting `*`.
4. **Preflight against owner decision 3.** Dragon copies Chrome's UA styles to native and starts projects on its own reset. Preflight is a second reset, full of vendor pseudo-elements and form-control rules: 103 of the 200 diagnostics. Supporting Preflight wholesale is poor value. Recommended: a Tailwind entry without Preflight (the `nopreflight` input above), with Dragon's reset in its place. If the owner later wants Preflight, match it as a builtin dataset rather than author CSS.
5. **`rem` and text size.** Decision 5 says `rem` follows the phone text size. Every Tailwind size is `rem`, so this is the biggest proof item after the parser work.
6. **Diagnostic volume.** A single top-level `@layer` hides everything inside it. This is fail-closed, but it gives a misleading picture of the gap.

**Read, not run: a possible silent drop.** In `stylesheet.ts` (`parseStylesheet`), non-`Declaration` children of a rule block are skipped with no diagnostic: `if (d.type !== 'Declaration') continue;`. Authored CSS nesting, such as `.a { &:hover {…} }`, may therefore vanish silently. Tailwind 4.3.3 `build()` output contained no nesting, so this probe did not trigger it. A Judge or Worker should confirm it with a test.

## 5. Ranked support roadmap

The ranking is by how much Tailwind output each step unblocks, cheapest first where the impact is equal.

1. **Accept any class-attribute token as a class name**, and unescape selector class names when matching. Today every file with a variant fails at input validation (7 of 7 diagnostics). This is small and lives only in the validator and matcher.
2. **`@layer` blocks and statements**, with layer order in the cascade. They wrap 100% of the output. Order: layer order first, then source order.
3. **Custom properties, `var()` substitution with fallbacks, `:root`/document-element tokens and `@property` registration.**
   - This is the largest single group in `nopreflight`: 36 custom-property declarations, 16 invalid `var()` values, 17 `@property` and 2 `:root`/`:host` selectors, 71 of 97 in total.
   - Evaluate `@property` `initial-value`/`inherits` as a build-time fold.
   - `:host` is inert without shadow DOM; drop that selector-list member rather than rejecting the rule.
4. **`@supports` evaluated from profiles**, and `@media` width ranges including the `>=` range syntax. This removes the `*`/`::before`/`::after`/`::backdrop` fallback and unlocks `md:`, `lg:` and so on. Media widths must follow Tailwind's `rem` breakpoints.
5. **`calc()` (length × number) and `rem` in padding, gap, line-height and font-size**, with the text-size rule from decision 5. That covers 20 profile rows in `inline` and every spacing utility.
6. **`oklch()` colours**, converted at build time to the target colour space with a stated rounding. This covers every palette colour.
7. **The common utility properties.** `border-radius`, `box-shadow`, `opacity` and `font-weight` each need backend techniques and proof. `padding-inline` and `padding-block` are logical shorthands and cheap.
8. **Finite-state variants.** Admit `data-*` and `aria-*` attribute selectors bound to tree states. Map `:disabled` and `:checked` to states. Add a tree kind for interaction states (`hover`, `focus-visible`, `active`), gated by the hover-capable environment.
9. **The elements `p`, `h1`–`h6`, `button`, `span` and `img`**, with UA defaults captured from Chrome (decision 3).
10. **Later:** `color-mix()`, the `outline-*` focus ring, `::placeholder` and similar pseudo-elements, and Preflight as a builtin dataset if the owner wants it.

With steps 1 to 4 done, the `nopreflight` probe would be left with about 12 property/value rows plus variants and elements. That estimate comes from subtracting the counts above, not from a run.

## 6. Proposed demo: "regular Tailwind just works"

**Definition.** Dragon checks and compiles a closed-application fixture whose CSS is the byte-for-byte output of pinned `tailwindcss@4.3.3`. That fixture passes the existing Chrome box-parity gate in every reachable state.

- **Input:** `@import "tailwindcss/theme.css" layer(theme); @import "tailwindcss/utilities.css" layer(utilities);`, i.e. without Preflight. Dragon's own reset and the Chrome UA defaults apply.
- **The tree:** it uses the unmodified class tokens from §2, the card, button, row and text components, as a `packages/parity/fixtures/tree-tailwind-*` fixture. The Tailwind output is committed with its compiler version and input hash. A test recompiles it and must match byte for byte, so the CSS is provably unedited.
- **States:**
  - `data-state` on/off and `disabled` on/off, as finite states;
  - `hover` as an interaction state on a hover-capable environment;
  - two viewport widths either side of 48rem.

  That makes 2 × 2 × 2 × 2 = 16 cases, or the reachable subset declared in `expected`.
- **Fonts:** the fixture sets `--font-sans: Ahem`, or the fixture environment's root Ahem, so text geometry is font-independent (decisions, Linux lane).

**Pass criteria.** These use numbers only, and existing tolerances are not changed.

1. `check()` returns `ok: true` with zero error diagnostics for `{web:{}, ios:{minimum:'15'}}`. The web output is `ready` and the iOS output is `analysis-only`, as in milestone 1.
2. For every case, Chrome renders the original HTML with the original Tailwind CSS. Every element box, and every line box for text, matches Dragon's layout within one physical pixel (decision 13).
3. The resolved paint values match Chrome's computed values: `background-color`, `color`, `border-radius`, `box-shadow` and `opacity`. Colours are compared after oklch-to-sRGB conversion, using the same rounding as Chrome's computed style.
4. Largest-text-size and right-to-left runs are included (goal.md principle 2).

**What to measure and report:**
- diagnostics per construct, the table in §3.2, rerun at every slice;
- the share of the 27 candidates, and later of a larger Tailwind corpus such as the Tailwind UI free components, that compile with zero diagnostics;
- cases and boxes compared, and the maximum deviation in px;
- the colour delta.

**Pinning.** A Tailwind upgrade is a new reference (docs/api.md §9): recapture the CSS, rerun the fixture, and record any diagnostic delta.
