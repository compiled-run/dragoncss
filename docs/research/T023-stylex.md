# T023: Would StyleX just work for Markless?

Scout note, read-only. External sources accessed 2026-09-26; claims I could not check at the source are marked **(unverified)**. Repo facts cite file paths.

## Short answer

**Partly, and not as a package.** StyleX does not "just work" for Markless on the web or on native:

- **Its compiler cannot read `.tsrx`.** StyleX is a Babel plugin, with a community Rust port. Markless has no Babel step, and `stylex.create()` throws if it runs uncompiled.
- **Its output does not fit Markless markup.** It produces `{...stylex.props()}` spreads of runtime objects, which Markless's build-time spread rules would reject.
- **It has no native story outside React.** Its native story is React Strict DOM, which is React plus React Native with a JavaScript styling polyfill. That polyfill costs about 2x per `div` and supports far less than T018's first milestone.

What StyleX *does* offer is a model worth borrowing. Every style on an element comes from something written on that element, and conflicts resolve as "last one wins", so there is no selector matching, no specificity and no `@layer`. Tokens and themes are explicit objects.

That model removes the **selector and cascade** half of the native problem. It does **not** remove the hard problems in the T020 critique. Those come from CSS *value* semantics, which StyleX keeps unchanged: variable inheritance, `position: fixed` containing blocks, `pointer-events` on descendants, `transition: all` dependencies, trait-dependent colours and inline text layout. React Strict DOM "solves" several of them by not supporting them.

**Recommendation.** Keep raw CSS in `<style>` as the one authoring model. Borrow StyleX's discipline as the rule for *which selectors compile to native*: the element's own classes, attributes and states, plus app-root conditions. T018 milestone 1 already comes close to that. Optionally allow StyleX-shaped objects later as a second syntax that lowers to the same style tables. Do not take a dependency on `@stylexjs/*` or React Strict DOM.

## 1. StyleX today (facts)

| Topic | Finding | Source |
|---|---|---|
| Latest version | 0.19.1, released 2026-09-15. Cadence: 0.16 (Sep 2025), 0.17 (Nov 2025), 0.18 (Apr 2026), 0.19.0 (Jun 2026). Repo pushed 2026-09-24, not archived, about 10.4k stars. | `gh release list -R facebook/stylex`; https://github.com/facebook/stylex/releases |
| Licence | MIT. | GitHub API `license.spdx_id` |
| Core API | `stylex.create`, `props`, `attrs` (back in 0.18, returns `class` and `style` strings for non-React frameworks), `defineVars`, `createTheme`, `defineConsts`, `firstThatWorks`, `keyframes`, `positionTry`, `viewTransitionClass`, `types.*`, `env.*` (0.18, build-time config values), `when.*`, `defaultMarker` / `defineMarker`. Since 0.18 there is an `sx={}` JSX prop, and since 0.19 an `@stylexjs/atoms` package for inline atomic styles. | https://stylexjs.com/docs/api/ ; repo `packages/docs/content/blog/2026-04-19-Release-v0.18.x.mdx`, `2026-06-14-Release-v0.19.0.mdx` |
| `when.*` | `ancestor`, `descendant`, `anySibling`, `siblingBefore` and `siblingAfter` each take a pseudo-class or (since 0.18) an attribute selector such as `[data-state="open"]`. The watched element must carry `stylex.defaultMarker()` or a `defineMarker()` class. | https://stylexjs.com/docs/api/javascript/when/ ; 0.18 release post |
| Conditions inside a property | `default` plus pseudo-classes and `@media` / `@supports` keys nested in the property value. The docs do not list an attribute condition on the element itself as a `create` key, so it is unclear whether `':is([ui-open])'` compiles **(unverified)**. | https://stylexjs.com/docs/learn/thinking-in-stylex/ ; `when` docs |
| Variables and themes | `defineVars` must be named exports in a `.stylex.ts` file and creates hashed custom properties (keys starting `--` keep their name). `createTheme(vars, overrides)` returns a class that re-sets them on a subtree. `defineVars` values can be functions of other variables in the same group. Dark mode is either `@media (prefers-color-scheme: dark)` inside a variable value, or `light-dark()` plus `color-scheme`, which the docs recommend. | repo `docs/api/javascript/defineVars.mdx`, `createTheme.mdx`, `docs/learn/recipes/light-dark-themes.mdx` |
| Compiler | The official compiler is `@stylexjs/babel-plugin`. There is no Rust code in the official repo; I checked the git tree for `Cargo.toml` and `*.rs`. A **community** Rust/SWC/NAPI compiler, `Dwlad90/stylex-swc-plugin` (`@stylexswc/rs-compiler`), is MIT, validated against the official test suite, and at 0.19.0. Its README says it is "not affiliated with or officially supported by Meta". | https://github.com/Dwlad90/stylex-swc-plugin ; https://www.npmjs.com/package/@stylexswc/rs-compiler |
| Bundlers | `@stylexjs/unplugin` supports Vite, Webpack, Rspack, Rollup, esbuild and Bun. There are also PostCSS and CLI plugins. `useCSSLayers` controls StyleX's own priority layers. | repo `docs/api/configuration/unplugin.mdx` |
| Output | Atomic CSS: one class per property/value/condition, deduplicated across the app, extracted to one static stylesheet at build. `create` and `props` calls in the same file compile away entirely. Styles passed across files leave a key-to-class map and a small `props()` merge at run time. | thinking-in-stylex, "Low-cost abstractions" |
| Rules it enforces | "All styles on an element should be caused by class names on that element itself." Bans `.a > *`, `.a ~ *`, `.a:hover button`. The only style at a distance it allows is ordinary inheritance (`color`), and even then styles set on the element win. Last applied style wins. A longhand beats its shorthand regardless of order (the `styleResolution` default). Reason given: selectors with different specificities are "fragile, less predictable and harder to debug"; an element "could be styled without having any classes applied to it". | https://stylexjs.com/docs/learn/thinking-in-stylex/ |
| Descendant styling | Two options: `when.*` with markers, or a variable set on the parent (with `:hover` as a condition) that the child reads. | repo `docs/learn/recipes/descendant-styles.mdx` |
| Needs React? | No. "A CSS-in-JS solution, not a CSS-in-React solution". Documented with Preact, Solid, lit-html, Angular and SvelteKit (via `attrs`). But the compiler must be able to parse the file as JS/TSX. | thinking-in-stylex "Framework-agnostic"; https://stylexjs.com/docs/learn/ |
| Runtime without the compiler | `create`, `createTheme`, `defineVars` and `defineConsts` throw `Unexpected 'stylex.create' call at runtime. Styles must be compiled by '@stylexjs/babel-plugin'.` | repo `packages/@stylexjs/stylex/src/stylex.js` L67-92 |
| Adoption | Meta's engineering blog calls it the standard styling system across Facebook, Instagram, WhatsApp, Messenger and Threads, with Figma and Snowflake as outside users. | https://engineering.fb.com/2025/11/11/web/stylex-a-styling-library-for-css-at-scale/ ; https://engineering.fb.com/2026/01/12/web/css-at-scale-with-stylex/ (from a search summary, **unverified** at the page) |

## 2. React Strict DOM: how StyleX styles reach native

| Topic | Finding | Source |
|---|---|---|
| What it is | `html.div`, `html.span` and so on, plus `css.create` (the StyleX API). On web it compiles to React DOM + StyleX. On native it renders React Native views. MIT. The repo moved to `react/react-strict-dom`. npm 0.0.55 (Jan 2026); last push 2026-08-31. Still 0.0.x. | https://github.com/react/react-strict-dom ; `npm view react-strict-dom` |
| Native mechanism | "React Strict DOM polyfills CSS features that rely on the element hierarchy – CSS Custom Properties, CSS Media Queries, CSS Inheritance, CSS Relative Units – by using React Context and other runtime information". Transitions run through React Native `Animated`. Block layout is a flex approximation. In practice StyleX objects are flattened and resolved **at run time in JavaScript** on native (`src/native/css/flattenStyleXStyles.js`, `processStyle.js`, `customProperties.js`, `mediaQueryMatches.js`). | repo `packages/website/docs/contribute/02-technicals/02-native.md`; source tree |
| Native support | Polyfilled: `css.create`, `createTheme`, `defineVars`, `firstThatWorks`; `:hover`, `:focus` and `:active` (only on elements with the matching handlers; `active` beats `focus` beats `hover`); `::placeholder`; `@media` for dimensions and colour scheme only; custom properties; `em`, `rem`, `v*`. **Not supported:** `calc()`, `clamp()`, `min()`, `max()`, `url()`, grid, `display: inline*`, `position: fixed` and `sticky`, keyframe animations, `overflowX` / `overflowY`, `whiteSpace`, `wordBreak`, `touchAction`, `translate` / `scale` / `rotate` properties. `inherit` and `unset` are partial. `when.*` markers appear nowhere in the native table or in the native state resolver, which checks only `:hover`, `:focus` and `:active`. | repo `packages/website/docs/api/02-css/index.md`, `api/02-css/01-create.md` L113-154, `src/native/css/index.js` L232-239 |
| Performance | Nicolas Gallagher (React Summit US 2025): an RSD `div` renders about **2x slower** than a React Native `View`; performance improved about 2.5x over 18 months; the cost is called acceptable on low-end devices. The design-goals doc says the overhead is "not insignificant". | https://gitnation.com/contents/react-strict-dom-cross-platform-react-based-on-the-web (search summary, **unverified** at the talk); `01-design-goals.md` "Tradeoffs" |
| Adoption | Meta codemodded large amounts of React DOM + StyleX code onto RSD; Facebook and Instagram on VR use it. T002 records that more than 60% of files are shared between facebook.com and the VR app. | `01-design-goals.md` "Results"; T002-landscape.md |

Takeaway: "StyleX on native" means a strict subset of StyleX, interpreted at run time in JavaScript on top of React Native's layout, not compiled to native views. None of that runtime is usable outside React.

## 3. What Markless has today (repo facts)

- **Scoped raw CSS.** Each module gets one build-hashed scope class, and every selector's subject compound gains it (`packages/compiler/src/passes/public-render/style-scopes.ts:7-10`).
- **Style objects already lower.** `style={{…}}` and same-file `const` objects lower to static inline CSS, or to a dynamic expression. Exported consts, imports, `let` bindings, runtime-chosen objects and arrays of styles are rejected with reasons (`packages/compiler/src/passes/semantic-graph/style-object.ts:59-72`, `:443-516`). This lowering targets the **inline `style` attribute**, not classes, so it is closer to `stylex.create` than to raw CSS, but it has no conditions, no atomic extraction and no cross-file styles.
- **Spreads are resolved at build time.** Only the props rest binding can spread onto a component, and handlers cannot be spread onto an element (`packages/compiler/src/passes/semantic-graph/diagnostics.ts:267-269`, `:1644-1645`). `{...stylex.props(...)}` would be an arbitrary runtime object, so it would be rejected.
- **No Babel in the toolchain.** Package manifests list `rolldown`, `@tsrx/yuku`, `yuku-analyzer` and `yuku-codegen`; no package manifest mentions babel.
- **`@markless/ui` defaults.** Each part carries a `<style>` under `@layer markless`, keyed on attributes the part writes (`[overlay]`, `button[aria-haspopup]`, `[ui-open]`). Consumers win with unlayered rules and no `!important`. Placement is CSS (`position-area`), never a prop (`packages/headless/components/SPEC.md` "CSS defaults"; `packages/headless/components/src/popover/popover.tsrx:68-146`). Consumers style parts with forwarded `class` or `style` (`website/components/demos/ui/popover/share.tsrx`).

## 4. Fit table

| Markless requirement | StyleX package as-is | StyleX *model* adopted by the Markless compiler |
|---|---|---|
| Works in `.tsrx` | **No.** The Babel or SWC plugin parses JS/TSX, not `@{}` component bodies. The unplugin would see `.tsrx` before or after the Markless compiler; neither order works. Before: it cannot parse the file. After: markup has already become templates and view records. | **Yes.** The compiler already parses object literals (`style-object.ts`), and conditions are a small extension. |
| Web-like API, raw CSS | **No.** Replaces CSS text with JS objects and camelCase keys. | **Optional second syntax only.** Raw `<style>` stays primary. |
| No sigils, `state()` / `computed()` as the boundaries | `stylex.create` is a compile-time-only call that throws at run time: effectively a compiler marker. | A Markless-owned object form avoids a foreign marker, but it is still new surface. |
| Static extraction, SSR, resume | Good on web: static CSS file, classes are plain strings, which suits HTML-first resume. Cross-file styles need `props()` at run time. | Good. The compiler can merge cross-file styles at build if it sees whole-program style constants. Today it deliberately refuses imports. |
| Scoped styles | Not needed (hashed atomic classes are globally unique). The per-module scope class becomes redundant for those elements. | The same, or keep scope classes: both work. |
| `@markless/ui` attribute state (`[ui-open]`) | Awkward. `when.ancestor('[ui-open]')` needs a marker class on the ancestor; the element's own attribute is not a documented `create` key **(unverified)**. Consumers do not hold `open`, so `open && styles.open` needs the family to expose state. | The compiler could allow "own attribute" conditions (`'[ui-open]': …`) because they are same-element and statically known. That is exactly T018's condition bits. |
| Consumer overrides beating family defaults | Works by merge order: `props(familyDefaults, consumer)`, last wins. This replaces `@layer markless`. Every part must accept and merge a style prop. | The same. For raw CSS, `@layer` keeps working, so there is no reason to switch families. |
| Anchor placement | The web gets `anchorName`, `positionArea` and `positionTry()`. React Strict DOM has nothing on native. | No help: still needs T018's native placement backend. |
| Tokens and dark mode | Clean: `defineVars` in `.stylex.ts`, `createTheme` classes, `light-dark()`. Fixes the "scoped `:root` tokens" confusion (T020 #9) by giving tokens one global home. | Worth copying as guidance ("tokens live on the document root or a theme class"), not as an API. |
| Native (UIKit) | **No.** React Strict DOM only, React + React Native only, runtime JavaScript, about 2x per element, narrower than T018 milestone 1 (no `calc` or `min`, no grid, no fixed or sticky, no keyframes). | Useful: per-element property/condition tables with no selector engine. That is what T018's build-time cascade compiler already emits for its milestone 1 selectors. |
| Tooling cost | Two compilers, a Babel dependency (or a community Rust port), and an ESLint plugin to keep objects valid. | Owned code, same diagnostics pipeline (file, line, fix). |
| Maintenance | Active: Meta team plus community releases every 1-3 months in 2025-26, MIT. Pre-1.0 with breaking changes (0.19.1 removed debug class names). | N/A |

## 5. Does the StyleX model remove the T020 hard problems?

| T020 finding | Removed by the StyleX model? | Why |
|---|---|---|
| Cross-component selectors, and logical versus native parentage for selectors (#5, part) | **Yes, if you accept the ban.** | No selector ever looks at another element, except `when.*` markers, which React Strict DOM does not implement on native. |
| Cascade order, specificity, `@layer` | **Yes.** | Last-applied-wins merge plus fixed property priority. `@markless/ui` would lose `@layer` and merge style props instead. |
| Variable inheritance and the computed-value pipeline (#2) | **No.** | StyleX variables *are* CSS custom properties inherited down the tree, and `defineVars` functions create exactly the `--b: var(--a)` case T020 cites. React Strict DOM re-implements inheritance with React Context; whether that matches the spec's computed-at-declaration rule is **unverified**. Markless would still need T020's specified pipeline. The model does help one thing: the set of variables is finite and known at build. |
| Normal inherited properties (`color`, `font`) | **No.** | StyleX explicitly keeps inheritance. |
| `position: fixed` containing blocks, overlay parentage (#5) | **No.** | This is layout semantics. React Strict DOM avoids it by not supporting `position: fixed`. |
| `pointer-events` on descendants (#6) | **No.** | This is value semantics (React Native's `box-none` is the nearest match). |
| `transition: all` dependencies (#7) | **Partly.** | Non-inherited properties an element can take are fixed by the style objects applied to it, so the set is closed. Changes from inheritance and variables remain, and style props from other files need whole-program knowledge. |
| Dynamic colours and `CGColor` invalidation, `color-mix` spaces (#8) | **No.** | Per-property `@media (prefers-color-scheme)` makes the dependency explicit, as T018's condition bits already do. Layer paint still needs invalidating. |
| Text lowering by display (#3) | **No.** | React Strict DOM refuses `display: inline*`. |
| Coverage accounting (#1) | **Partly.** | A smaller selector surface makes counting easier, but values, units and host features are still the bulk of the work. |
| Scoped `:root` tokens (#9) | **Yes, as guidance.** | Tokens have one global home, plus theme classes. |

Net result: StyleX's discipline shrinks T018's *cascade compiler* to a merge. That is the part T020 found least wrong. The evaluator and host work T020 flagged remains; React Strict DOM mostly declares it out of scope.

## 6. One component three ways

Assumed component: a disclosure card with an open state, dark mode, a pressed-state button, and a consumer override of a `@markless/ui` popover. This is Markless-idiom pseudocode; B and C show proposed syntax that does not exist today.

### A. Raw CSS in `<style>` (today's model; native via T018 tables)

```tsx
import { state } from '@markless/core';
import { popover } from '@markless/ui';

export function InfoCard() @{
  const card = state({ open: false });

  <section class="card" data-open={card.open}>
    <button class="toggle" aria-expanded={card.open} onClick={() => card.open = !card.open}>
      Details
    </button>
    <div class="body" hidden={!card.open}>Receipts are kept for seven years.</div>
    <popover.root>
      <popover.trigger class="toggle">Why?</popover.trigger>
      <popover.content class="tip">Tax law.</popover.content>
    </popover.root>
  </section>
  <style>
    .card { color-scheme: light dark; background: light-dark(#fff, #1c1c1e); border-radius: 12px; padding: 16px; }
    .card[data-open] { outline: 2px solid AccentColor; }
    .toggle { background: light-dark(#eee, #333); transition: background 120ms; }
    .toggle:active { background: light-dark(#ddd, #444); }
    /* beats the family's @layer markless default without !important */
    .tip { position-area: inline-end; padding: 12px; border-radius: 10px; }
    .tip[ui-open] { box-shadow: 0 8px 24px rgb(0 0 0 / 0.2); }
  </style>
}
```

Every selector here is subject-only (own class, own attribute, own state), so it is already StyleX-shaped and compiles to per-element tables with no cross-element matching.

### B. StyleX-style objects (hypothetical `sx`, lowered by the Markless compiler)

```tsx
import { state } from '@markless/core';
import { popover } from '@markless/ui';
import { styles as sx } from '@markless/style';   // hypothetical: a Markless-owned create()
import { tokens } from './tokens.style.ts';      // hypothetical defineVars equivalent

const s = sx({
  card: { backgroundColor: tokens.surface, borderRadius: 12, padding: 16 },
  open: { outline: `2px solid ${tokens.accent}` },
  toggle: {
    backgroundColor: { default: tokens.control, ':active': tokens.controlPressed },
    transition: 'background-color 120ms',
  },
  tip: {
    positionArea: 'inline-end', padding: 12, borderRadius: 10,
    boxShadow: { default: 'none', '[ui-open]': '0 8px 24px rgb(0 0 0 / 0.2)' }, // own-attribute condition: StyleX lacks it
  },
});

export function InfoCard() @{
  const card = state({ open: false });

  <section sx={[s.card, card.open && s.open]}>
    <button sx={s.toggle} aria-expanded={card.open} onClick={() => card.open = !card.open}>Details</button>
    <div hidden={!card.open}>Receipts are kept for seven years.</div>
    <popover.root>
      <popover.trigger sx={s.toggle}>Why?</popover.trigger>
      <popover.content sx={s.tip}>Tax law.</popover.content>  {/* family merges: defaults, then consumer */}
    </popover.root>
  </section>
}
```

```ts
// tokens.style.ts: dark mode as a per-value condition (or light-dark())
export const tokens = vars({
  surface: { default: '#fff', '@media (prefers-color-scheme: dark)': '#1c1c1e' },
  control: 'light-dark(#eee, #333)', controlPressed: 'light-dark(#ddd, #444)', accent: 'AccentColor',
});
```

Library-author side: each `@markless/ui` part would need `sx` merged as `[familyDefaults, ...rest.sx]`, replacing `@layer markless`. That touches every family, for no gain on the web.

### C. Hybrid (recommended direction if objects are ever added)

```tsx
export function InfoCard() @{
  const card = state({ open: false });

  <section class="card" data-open={card.open}>
    <button class="toggle" onClick={() => card.open = !card.open}>Details</button>
    <div class="body" hidden={!card.open}>…</div>
    <popover.root>
      <popover.trigger class="toggle">Why?</popover.trigger>
      <popover.content class="tip" style={{ maxInlineSize: card.open ? 320 : 240 }}>Tax law.</popover.content>
    </popover.root>
  </section>
  <style>
    /* raw CSS stays the source; the native build enforces a StyleX-like rule:
       a selector may test only its own element (class, attribute, state) plus app-root conditions */
    .card { background: light-dark(#fff, #1c1c1e); }
    .toggle:active { background: light-dark(#ddd, #444); }
    .tip[ui-open] { box-shadow: 0 8px 24px rgb(0 0 0 / 0.2); }
    .card .body { padding: 8px; }  /* allowed: same-component ancestor, resolved at build */
  </style>
}
```

Style objects stay what they are today: the inline, dynamic channel (the `style={{…}}` lowering that already ships). Raw CSS carries conditions. On native, rules that look at other elements outside the component fail with the build diagnostic T018 section 4.9 already specifies. Web builds keep full CSS.

## 7. Verdict and recommendation

**Partly.** Details:

- **Not the package.** StyleX needs Babel or SWC over JS/TSX, replaces raw CSS with objects, and its only native path is React Strict DOM: React-only, a runtime JavaScript polyfill, about 2x per element, and narrower than T018 milestone 1. Adopting it would add a second compiler to a toolchain that has none, and would force `@markless/ui` to drop `@layer` for style-prop merging.
- **Yes to the discipline.** "An element's styles come only from what is written on it" is the right *native compile profile*. It is what makes per-element tables possible with no selector engine, and T002/T004 already recommended it. Markless can enforce it on raw CSS in `<style>` at build time, without changing how authors write.
- **It does not sidestep the critique.** Variable inheritance, containing blocks, `pointer-events`, transitions, dynamic colours and inline text are CSS value and layout semantics. StyleX keeps them on the web and React Strict DOM mostly omits them on native. The Markless native evaluator must still specify them, or reject them with diagnostics.
- **Worth copying:** the token and theme guidance (`defineVars` / `createTheme` / `light-dark()` → "tokens live on the document root or a theme class"), last-wins merging for the inline `style` object channel, and longhand-beats-shorthand determinism.
- **What would change this:** Meta shipping a non-React, build-time StyleX-to-native compiler, or an official Rust compiler exposing a reusable style-table IR. Neither exists as of 2026-09-26.

## Sources (accessed 2026-09-26)

- https://stylexjs.com/docs/api/ ; https://stylexjs.com/docs/api/javascript/when/ ; https://stylexjs.com/docs/learn/thinking-in-stylex/ ; https://stylexjs.com/docs/learn/
- https://github.com/facebook/stylex (releases 0.16.0-0.19.1; `packages/docs/content/**` read via GitHub API: blog 0.18.x and 0.19.0, `defineVars.mdx`, `createTheme.mdx`, `light-dark-themes.mdx`, `descendant-styles.mdx`, `props.mdx`, `unplugin.mdx`, `ecosystem.mdx`; `packages/@stylexjs/stylex/src/stylex.js`)
- https://github.com/Dwlad90/stylex-swc-plugin ; https://www.npmjs.com/package/@stylexswc/rs-compiler (search summary)
- https://engineering.fb.com/2025/11/11/web/stylex-a-styling-library-for-css-at-scale/ ; https://engineering.fb.com/2026/01/12/web/css-at-scale-with-stylex/ (search summary, unverified at the page)
- https://github.com/react/react-strict-dom (formerly facebook/react-strict-dom): `packages/website/docs/api/02-css/index.md`, `api/02-css/01-create.md`, `contribute/02-technicals/01-design-goals.md`, `02-native.md`, `src/native/css/*`
- https://gitnation.com/contents/react-strict-dom-cross-platform-react-based-on-the-web ; https://github.com/facebook/react-strict-dom/discussions/270 (search summaries, unverified at the source)

```json
{
  "goalbuddy_receipt_v1": {
    "task_id": "T023",
    "type": "scout",
    "result": "done",
    "harness": "claude-code",
    "summary": "StyleX does not just work for Markless. Its compiler is Babel (a community Rust/SWC port also exists), it cannot parse .tsrx, it throws uncompiled, and its props() spreads violate Markless build-time spread rules. Its only native path is React Strict DOM: React + React Native, runtime JS polyfill, ~2x per div, no calc/min/max, grid, position fixed/sticky, keyframes or when.* on native. The StyleX model (styles only from the element itself, last-wins merge) removes selector matching, specificity and @layer from the native problem, but not the T020 value-semantics problems (variable inheritance, fixed containing blocks, pointer-events, transition:all, dynamic colours, inline text). Verdict: partly. Keep raw CSS in <style>, enforce a StyleX-like subject-only selector profile on native builds, copy the token/theme guidance, and take no @stylexjs or RSD dependency.",
    "evidence": [
      "notes/T023-stylex.md",
      "packages/compiler/src/passes/semantic-graph/style-object.ts:59-72,443-516",
      "packages/compiler/src/passes/semantic-graph/diagnostics.ts:267-269,1644-1645",
      "packages/compiler/src/passes/public-render/style-scopes.ts:7-10",
      "packages/headless/components/SPEC.md (CSS defaults)",
      "packages/headless/components/src/popover/popover.tsrx:68-146",
      "https://stylexjs.com/docs/learn/thinking-in-stylex/",
      "https://stylexjs.com/docs/api/javascript/when/",
      "github.com/facebook/stylex packages/@stylexjs/stylex/src/stylex.js L67-92",
      "github.com/react/react-strict-dom packages/website/docs/api/02-css/index.md, contribute/02-technicals/02-native.md"
    ],
    "facts": [
      "StyleX 0.19.1 released 2026-09-15; MIT; releases every 1-3 months in 2025-26; pre-1.0 with breaking changes.",
      "Official compiler is @stylexjs/babel-plugin; no Rust in the official repo; the community Dwlad90/stylex-swc-plugin is at 0.19.0 and not Meta-supported.",
      "stylex.when.* supports attribute selectors since 0.18 but needs a marker class on the watched element.",
      "React Strict DOM native: styles resolved at run time via React Context; supports :hover/:focus/:active and @media for dimensions and colour scheme only; no calc/clamp/min/max, grid, inline display, position fixed/sticky, keyframes.",
      "RSD div is about 2x slower than an RN View (Gallagher, React Summit US 2025; search summary).",
      "No package manifest in the Markless repo mentions babel; the toolchain is rolldown + yuku."
    ],
    "contradictions": [],
    "unverified": [
      "Whether stylex.create accepts an own-element attribute condition key like ':is([ui-open])'.",
      "Whether RSD's Context-based custom-property polyfill follows computed-at-declaration semantics.",
      "Figma/Snowflake adoption and the 2x figure come from search summaries of Meta blog/podcast and the GitNation talk page."
    ],
    "next_suggestions": [
      "T024 should treat the StyleX/RSD row as settled: model borrowed, package rejected.",
      "Report styling section: add the subject-only native selector profile as the explicit StyleX-derived rule, and the token-home guidance that answers T020 #9."
    ]
  }
}
```
