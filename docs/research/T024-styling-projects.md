# T024: Do we need a separate styling project for web and native?

Scout, read-only. All sources were accessed on 2026-09-26. GitHub stars, licences and latest releases come from the GitHub API (`gh api repos/<owner>/<repo>` and `/releases`) on that date. Claims taken from search-engine summaries, not from primary pages, are marked **(unverified)**. This note builds on [T011](T011-styling.md), which already covers Lynx, NativeScript, Blitz, Stylo, Taffy, Yoga, Valdi, React Strict DOM and StyleX. Those findings are summarised here, not repeated.

## Short answer

**Gap verdict.** No framework-independent engine exists that takes CSS in and produces native view styles. Every working "CSS on native" system is welded to its own UI runtime:

- react-native-css (NativeWind v5) and Uniwind are welded to React Native.
- Lynx has its own C++ engine inside its own runtime.
- NativeScript has its own runtime.
- Blitz with Stylo draws its own pixels.

The one reusable piece, react-native-css's `./compiler` export, has a model that is not ours. It is keyed by class names, it flattens `@layer`, and its only combinator is the descendant combinator. Its output is React Native style keys, and its runtime is React hooks. The gap is real, but outside Markless it is narrow. React Native users already have three maintained answers, and Lynx has its own. The only consumer we can name that would clearly use such an engine besides Markless is our own frameless React Native target.

**Recommendation: not a new project yet.** Build it as a package inside the Markless repository, with a framework-neutral boundary from day one:

- Input: CSS text, plus a description of the static element tree and its conditions.
- Output: a versioned style-table format.
- Evaluators: Swift and Kotlin, with no dependency on the Markless runtime.

Spin it out later, the way yuku was, once two conditions hold. First, the two blocking T020 findings (coverage claims, and computed values with inheritance) are closed by a conformance suite. Second, a second consumer, frameless's React Native target, actually uses it. Reasons are in section 4.

## 1. Landscape table

"Native" here means "affects real UIKit or Android views". Stars and releases are as of 2026-09-26.

| Project | Authoring model | Static extraction | Native support, and how | Framework coupling | Embeddable parts | Licence | Activity |
|---|---|---|---|---|---|---|---|
| **react-native-css** (NativeWind v5 core) | CSS text files, `className` | Build: lightningcss AST to a JSON `ReactNativeCssStyleSheet` (rule sets keyed by class, with specificity, media, pseudo, container and attribute conditions). Inlines `rem` and single-use variables | Yes. A JS runtime (React hooks: `useCssElement`, `useNativeCssStyle`) matches conditions and produces RN style objects; Yoga does layout | React Native only (peers: `react>=19`, `react-native>=0.81`, `@expo/metro-config>=54`) | `react-native-css/compiler` is a separate export; the output format is documented in TS types | MIT | 164 stars; `3.1.0-rc.0` on 2026-09-13 |
| **NativeWind** (v4 stable, v5 RC) | Tailwind utilities (v5: Tailwind v4 CSS-first) | v5: delegates to react-native-css | As react-native-css | React Native | Thin wrapper | MIT | 8.1k stars; last tag 2026-09-14; v5 "not intended for production use" |
| **Uniwind** (free) / **Uniwind Pro** | Tailwind v4 utilities, plus custom CSS classes | Build: its own CSS parser in a Metro plugin; utilities and custom CSS merged at build **(unverified: vendor posts and search summary)** | Yes. Free tier: JS engine. Pro: the Unistyles C++ engine updates the Fabric shadow tree with no re-render | React Native (Metro only) | None advertised | Free tier MIT; Pro is commercial, from $99 per seat per year | 1.7k stars; v1.12.0 on 2026-09-04; Pro 1.0 on 2026-04-07 |
| **Unistyles 3** | JS style objects (`StyleSheet.create` with theme, breakpoints and variants) | Babel plugin finds dependencies | Yes. C++ core rebuilds styles and writes to the Fabric shadow tree | React Native (Fabric) | No | MIT per npm (the GitHub API shows no licence file) | 3.0k stars; v3.3.0 on 2026-07-10 |
| **Tamagui** (core plus static compiler) | Style props and `styled()` objects with media and pseudo keys | Compiler: atomic CSS on web; flattens to plain `View` and `Text` on native | Yes, as RN style objects; no CSS text on native | React and React Native only | Compiler plugins for Vite, webpack, Next and Metro, all React-specific | MIT | 14.2k stars; v2.7.7 on 2026-08-15 |
| **React Strict DOM** (Meta) | StyleX-style `css.create` objects on HTML-like elements | Web: StyleX compile. Native: none | Yes, as a runtime JS polyfill through React contexts (`ContextInheritedStyles`, `ContextCustomProperties`, `usePseudoStates`, `mediaQuery.js`, as seen in `src/native/`). Flow layout "cannot polyfill" (issue #2) | React only | No | MIT | 3.6k stars; `0.0.54` on 2025-10-02 (no release in 2026) |
| **StyleX** | JS objects; conditions inside property values; no styling at a distance | Build: atomic CSS | Only through React Strict DOM | JS objects, not React-specific at the compiler level (T023 covers this) | Babel plugin | MIT | 10.4k stars; 0.19.1 on 2026-09-15 |
| **Lynx** CSS engine | CSS text, class selectors, `@media` (SDK 4.0, opt-in `enableCSSRule`) | Build: CSS is encoded into a binary template | Yes. C++ engine (`core/renderer/css`, computed styles in the `starlight` namespace) matches at runtime and writes to native views | Lynx runtime only; `@lynx-js/css-defines` is a definitions package, not an engine | Not published as a standalone library | Apache-2.0 | 15.1k stars; 4.0.3 on 2026-09-11 |
| **NativeScript** | CSS text, selectors, variables, `@keyframes` | None; parsed at runtime | Yes, as a runtime matcher on native views; layout comes from containers, not CSS `display` | NativeScript runtime | No | Apache-2.0 (not re-checked) | See T011 |
| **Panda CSS** | Objects and recipes, style props, config-first | Build: atomic CSS, uses `@layer` | **No.** Discussion #745 answer: RN "would mean a particularly focused effort" | Multi-framework on web (React, Vue, Solid, Qwik, Preact) | Tokens only | MIT | 6.2k stars; 2.0 betas (2026-09-17) |
| **vanilla-extract** | `.css.ts` typed objects and themes | Build: static CSS | **No** official support (discussion #575). A community fork, neapolitan-extract, routes it through react-native-css-interop **(activity unchecked)** | Framework-agnostic on web | No | MIT | 10.4k stars; last plugin release 2026-08-27 |
| **Linaria / wyw-in-js** | Tagged template CSS (`styled`, `css`) | Build: wyw-in-js evaluates JS at build time and extracts CSS | **No** | Bundler-level, framework-light | wyw-in-js is the shared engine (also used by Pigment and dx-styles) | MIT | Linaria 12.4k stars, 8.2.0 on 2026-08-10; wyw-in-js 324 stars, 2.5.1 on 2026-09-03 |
| **Pigment CSS** (MUI) | styled and `sx` objects | Build, on wyw-in-js | **No** | React | No | MIT | 1.1k stars; v0.0.31 on 2026-05-22; **"Alpha phase, currently, on hold"**. MUI (Jan 2026): "development is paused" |
| **Tailwind v4 engine** ("Oxide") | Utilities plus CSS-first `@theme` | The Rust crate `tailwindcss-oxide` is the file scanner and class-candidate extractor (deps: `globwalk`, `bstr`, `rayon`). CSS generation is TypeScript in `packages/tailwindcss` **(inference from Cargo.toml and repo layout)** | No | Framework-agnostic; produces CSS | Could be a front end whose output CSS feeds a native compiler (react-native-css and Uniwind do exactly this) | MIT | 97.7k stars; v4.3.3 on 2026-07-16 |
| **lightningcss** | Parses and transforms CSS | Rust and JS API with typed property values, a visitor API and minification | Only as a building block (react-native-css uses it) | None | Yes: Rust crate, npm, CLI | **MPL-2.0** | 7.7k stars; v1.33.0 on 2026-07-20 |
| **Taffy** | Layout only (flex, grid, block) | n/a | Building block; C bindings "work in progress" (T011) | None | Yes | MIT | 3.6k stars; v0.14.0 on 2026-08-24 |
| **Stylo** (`stylo` crate) | Full browser cascade | Runtime | Building block; the embedder implements DOM traits; heavy (T011) | Browser-shaped | Yes (Rust) | MPL-2.0 | Updated 2026-09-26 (repo push) |
| **Blitz / Dioxus Native** | HTML and CSS | Runtime (Stylo plus Taffy plus Parley) | Draws its own pixels (WGPU); mobile is pre-alpha **(unverified: third-party design note)**; "no bindings for other languages yet" | Rust | Crates | MIT/Apache (Stylo MPL) | 4.2k stars; active |

Smaller or older "CSS for native views" projects found in the broad search:

- **CSSwiftUI.** Maps a CSS file to SwiftUI modifiers; single-author and tiny.
- **NUI** (`.nss`), **StyleKit** (JSON), **MCSS** (claims ">70%" of CSS, page from 2022). All old and apparently unmaintained **(unverified)**.
- **csscascade** (crate, Nov 2025). A cascade engine for *static* renderers, with no interactive states.
- **ratatui-style.** A framework-agnostic cascade over a `StyledNode` trait, for terminal UI only.
- **Servo `selectors` crate.** Selector matching over a trait.

GitHub repository searches for 2025–2026 "CSS to UIKit/SwiftUI/Compose" projects returned nothing of substance. Search found no Kotlin or Compose Multiplatform library that applies CSS to native views.

Sources:

- react-native-css:
  - [repo](https://github.com/nativewind/react-native-css)
  - [`src/compiler/compiler.types.ts`](https://github.com/nativewind/react-native-css/blob/main/src/compiler/compiler.types.ts). Output format: `s: [className, StyleRule[]]`, each rule with specificity `s`, media `m`, pseudo `p`, container `cq`, attribute `aq`.
  - [`src/compiler/selectors.ts`](https://github.com/nativewind/react-native-css/blob/main/src/compiler/selectors.ts). "We only support the descendant combinator".
  - [`src/compiler/compiler.ts`](https://github.com/nativewind/react-native-css/blob/main/src/compiler/compiler.ts). `layer-block` rules are extracted in place, so layer order is not kept.
  - `package.json` exports and peers.
  - [DeepWiki](https://deepwiki.com/nativewind/react-native-css) **(secondary)**.
- NativeWind: [nativewind.dev/v5](https://www.nativewind.dev/v5).
- Uniwind:
  - [docs](https://docs.uniwind.dev/)
  - [llms.txt](https://docs.uniwind.dev/llms.txt)
  - [Pro release post](https://reactnativecrossroads.com/posts/uniwind-pro-1-release/)
  - [pricing](https://uniwind.dev/pricing)
  - [ReactLibs article](https://reactlibs.dev/articles/uniwind-tailwind-react-native-speed/) **(secondary)**
- Unistyles: [how it works](https://unistyl.es/v3/start/how-unistyles-works/).
- Tamagui: [compiler](https://tamagui.dev/docs/intro/compiler-install).
- React Strict DOM:
  - [repo tree `packages/react-strict-dom/src/native/`](https://github.com/facebook/react-strict-dom)
  - [issue #2](https://github.com/facebook/react-strict-dom/issues/2)
- Lynx:
  - [selectors](https://lynxjs.org/api/css/selectors)
  - [media query](https://lynxjs.org/api/css/media-query)
  - [`@lynx-js/css-defines`](https://www.npmjs.com/package/@lynx-js/css-defines)
  - [core/renderer](https://github.com/lynx-family/lynx/tree/develop/core/renderer)
- Panda: [discussion #745](https://github.com/chakra-ui/panda/discussions/745).
- vanilla-extract:
  - [discussion #575](https://github.com/vanilla-extract-css/vanilla-extract/discussions/575)
  - [neapolitan-extract](https://github.com/marklawlor/neapolitan-extract)
- Pigment:
  - [repo](https://github.com/mui/pigment-css)
  - [MUI 2026 post](https://mui.com/blog/2026-and-beyond/)
- Zero-runtime overview: [dx-styles, 2026-07-27](https://dx-styles.dev/blog/state-of-zero-runtime-css-in-js/). Its author maintains Linaria; it mentions no native support for any web CSS-in-JS tool.
- Tailwind: [crates/oxide/Cargo.toml](https://github.com/tailwindlabs/tailwindcss/tree/main/crates).
- lightningcss: [docs](https://lightningcss.dev/docs.html).
- Blitz: [repo](https://github.com/DioxusLabs/blitz).
- Small projects:
  - [CSSwiftUI](https://github.com/NivekAlunya/com.acme.ios.package.CSSwiftUI)
  - [NUI](https://github.com/tombenner/nui)
  - [MCSS](https://getmcss.com/)
  - [csscascade](https://crates.io/crates/csscascade)
  - [ratatui-style](https://docs.rs/ratatui-style/latest/ratatui_style/)
  - [selectors](https://crates.io/crates/selectors)

## 2. What the landscape shows

1. **Web CSS-in-JS tools do not go native.** Panda, vanilla-extract, Linaria, wyw-in-js and Pigment all end at a `.css` file for a browser. Their native stories are "share tokens" or a community bridge into react-native-css. None of them is a candidate engine; at most they are candidate *front ends*.
2. **Every native CSS engine is welded to one runtime.** Their compile halves are generic: react-native-css parses CSS to JSON with lightningcss, and Lynx encodes CSS into a template. Their runtime halves are the product:
   - react-native-css: React hooks.
   - Uniwind Pro and Unistyles: C++ code writing to the Fabric shadow tree.
   - Lynx: C++ inside its own element tree.
   - React Strict DOM: React contexts.
3. **Nobody does the cascade we need.** react-native-css is the closest shape (build-time tables plus a runtime evaluator). Its gaps against T018:
   - Rules are keyed by class name.
   - Selectors are matched at runtime.
   - Layers are flattened.
   - Only the descendant combinator is supported.
   - There is no build-time knowledge of the element tree.

   Markless's advantage is that the compiler knows every host node, every `ui-*` attribute and the static composition. That lets it resolve matching at build time (T011 §2). No engine offers that, because none has a compiler that sees the templates.
4. **Building blocks are good and reusable.**
   - lightningcss: typed values, colour maths, a visitor API; MPL-2.0 is file-level copyleft, fine as an unmodified dependency.
   - Taffy: layout.
   - Servo `selectors`: selector semantics, if we ever needed runtime matching.
   - Stylo: rejected for weight in T011.
   - Our own yuku CSS scanner (yuku-tsrx 0.1.4) gives *structure*: rules, at-rules, selectors and byte offsets. It does not give typed values, so a native compiler still needs lightningcss or an equivalent value parser for colours, lengths, `calc()` and shorthands.

## 3. Gap verdict

- **Does a framework-independent "CSS in, native view styles out" engine exist?** No. Adoption options:
  - **Adopt react-native-css as the compiler: no.** Its JSON is shaped for class-keyed runtime matching and RN style keys. It drops `@layer` order, which `@markless/ui` depends on (`@layer markless`). And it has no input for the element tree, the thing that makes our build-time matching possible. Forking it would mean rewriting the matcher and the output format, which leaves only the lightningcss plumbing.
  - **Borrow from it: yes.** Worth reading for:
    - its declaration lowering (`declarations.ts`, CSS property to native key)
    - `inline-variables.ts`
    - its media and container condition encodings
    - its test fixtures
  - **Adopt Lynx's engine: no.** It is not published separately, and it is C++ tied to Lynx's element tree and template format.
- **Is it a real gap others would use?** Partly.
  - **Real:** the T020 critique shows the hard part is a correct computed-value pipeline: inheritance, variables computed before inheritance, shorthands with `var()`, transitions, and dynamic colours. Nobody publishes that as a reusable native library. Every engine reimplements a partial one.
  - **Demand outside Markless is weak today.**
    - React Native developers already choose between NativeWind, Uniwind and Unistyles, and none of those would swap its runtime.
    - Lynx has its own engine.
    - Valdi and Compose do not use CSS.
    - The consumers we can name are Markless native and frameless's React Native target. A third, Blitz-like drawn renderers, already use Stylo.
  - So a standalone project would start with one user, us, plus one sibling, frameless.

## 4. New project or package inside Markless?

### What the engine would contain (either way)

| Part | Build or reuse | Notes |
|---|---|---|
| CSS structure scan | Reuse the yuku CSS scanner | Same byte offsets as the web scoping pass, so diagnostics point at the same lines |
| Value parsing and typed values | Reuse lightningcss (Rust or npm) | Colours, lengths, `calc()`, shorthands, `@media` and `@container` conditions |
| Cascade compiler | **Build** | Input: static element tree with conditions (class alternatives, `ui-*` attributes, pseudo-classes, `@for` indices, route composition). Output: per-element ordered declaration lists by layer, then specificity, then source order. Must implement the T020 fixes: computed-value pipeline, logical versus render ancestry, display-aware text coalescing |
| Style-table format | **Build** | Versioned and documented, with source maps (file, line) for every declaration |
| Device evaluators | **Build**, in Swift (iOS) and Kotlin (Android) | Condition bits, variable resolution along the logical tree, inheritance, diffing, dynamic colour invalidation, transitions |
| Layout | Reuse Taffy (or Yoga) | Keep it out of the styling engine's scope. The evaluator outputs a Taffy `Style`; `stylo_taffy` is prior art for that mapping |
| Conformance suite | **Build** | Small cases per T020 finding (variables computed before inheritance, `pointer-events` none/auto, transformed-ancestor fixed position, `transition: all` with inherited changes), each run on web (the oracle) and on each native evaluator |

Rough size, **estimate only, not measured**: the cascade compiler, value lowering and table format are the size of today's `style-scopes.ts` plus a few thousand lines. Each evaluator is a few thousand lines of Swift or Kotlin. The conformance suite grows without bound, and it is the real long-term cost.

### Why inside Markless first

1. **The key input is Markless-shaped.** Build-time matching needs the element tree, and only our compiler produces it today. A standalone project would have to freeze a neutral "static element tree" format before we know what it needs. For example, T020 finding 5 alone adds a logical-versus-render parent split. Freezing that format now means versioning churn across two repositories.
2. **The design is not settled.** T020 rejected it with two blocking and ten major findings, and the T025 styling-direction decision is still pending. It could still move to a restricted component-local CSS or to StyleX-style objects. Spinning out a project for a model that may change is premature.
3. **Precedent fits "spin out when stable".** yuku became separate once the parser had a stable API and a second consumer (the Markless compiler and editor tooling). frameless is separate because it has its own users and output targets. The styling engine has neither yet.
4. **Repo rules favour one tree.** CLAUDE.md says a change affecting a consumer must pass that consumer's checks. With the engine in the Markless repository, `pnpm ci:local` covers the engine and its only consumer in one run. Across two repositories every change needs cross-repo release choreography, and the yuku landing already showed that cost (pins, overrides, publish keystrokes).
5. **External demand is unproven** (section 3). A separate project has a real maintenance cost: releases, issues, docs, semver. It pays back only with outside users.

### Design it so it can leave later

- Put it in its own package, for example `packages/native-style` (name is a placeholder, the owner's call). Its only inputs are CSS text plus an element-tree description, and it must not import the Markless runtime or compiler internals.
- Evaluators live under `native/ios` and `native/android` with no Markless runtime dependency. They consume only the table format.
- The conformance cases are plain data (CSS, tree and expected computed values), so frameless or anyone else can run them.
- Spin-out trigger: the table format has not changed for one release cycle, the conformance suite covers the T020 findings, and frameless's React Native target (or an outside project) consumes it.

### Pseudocode

The app author's code is unchanged:

```tsrx
// Card.tsrx
export default function Card({ tone }: { readonly tone: 'plain' | 'warn' }) @{
  <article class={tone}><h2>{'Title'}</h2><p>{'Body'}</p></article>
  <style>
    @layer app {
      article { padding: 1rem; border-radius: 12px; background: light-dark(white, #111); }
      article.warn { background: color-mix(in oklch, orange 20%, Canvas); }
      article:active { transform: scale(0.98); transition: transform 120ms ease-out; }
    }
  </style>
}
```

The engine boundary is framework-neutral (compiler side):

```ts
// packages/native-style (inside Markless)
import { compileStyles } from '@markless/native-style';

const table = compileStyles({
  css: [{ file: 'Card.tsrx', text: styleText, layerOrder: ['markless', 'app'] }],
  tree: {
    // Markless compiler emits this; frameless could emit the same shape
    nodes: [{ id: 0, tag: 'article', classes: { alternatives: [['plain'], ['warn']] }, logicalParent: null }],
    conditions: ['class:warn', 'pseudo:active', 'media:prefers-color-scheme:dark'],
  },
  target: 'ios',
});
// table.version, table.nodes[0].rules = [{ when: ['class:warn'], decls: [...], src: 'Card.tsrx:7' }, ...]
```

The device side depends only on the table:

```swift
// native/ios/StyleEvaluator.swift
let style = evaluator.resolve(node: 0, bits: [.classWarn, .active], traits: view.traitCollection)
taffy.setStyle(node, style.layout)   // layout handed to Taffy
view.apply(style.paint)               // UIColor / CALayer, with dynamic-colour invalidation
```

## 5. Answers for T025

**New project.** Not now. Build it as its own package inside the Markless repository, behind a framework-neutral boundary, and spin it out like yuku once the format is stable and a second consumer exists. No existing project can be adopted. Reuse lightningcss for values, the yuku scanner for structure and Taffy for layout, and borrow declaration-lowering ideas from react-native-css.

**Front ends.** Tailwind v4 (and Panda or vanilla-extract output) can later feed the same engine as CSS text, the way react-native-css and Uniwind consume Tailwind. That keeps "Tailwind on native" a free side effect, not a separate design.

**Risk to name.** Whichever direction T025 picks (full cascade, or a restricted component-local CSS), the conformance suite is the expensive part. The recommendation holds either way. A restricted CSS makes the engine smaller and even less worth a separate project.

```json
{
  "goalbuddy_receipt_v1": {
    "task_id": "T024",
    "role": "scout",
    "result": "done",
    "output": "docs/goals/native-targets-api/notes/T024-styling-projects.md",
    "accessed": "2026-09-26",
    "findings": {
      "framework_independent_css_to_native_engine_exists": false,
      "closest_candidate": "react-native-css (./compiler export, lightningcss-based, MIT) - not adoptable: class-keyed runtime matching, @layer flattened, descendant combinator only, React Native style keys and React-hook runtime",
      "web_css_in_js_native_support": "none (Panda, vanilla-extract, Linaria/wyw-in-js, Pigment paused)",
      "runtime_welded_engines": ["react-native-css/NativeWind", "Uniwind (Pro commercial)", "Unistyles", "Lynx C++ engine", "NativeScript", "React Strict DOM polyfill", "Blitz/Stylo (own pixels)"],
      "reusable_building_blocks": ["lightningcss (MPL-2.0) for typed values", "yuku CSS scanner for structure", "Taffy (MIT) for layout", "servo selectors crate (only if runtime matching)"],
      "external_demand": "weak; named consumers are Markless native and frameless React Native target"
    },
    "recommendation": "No new standalone project now. Build as a Markless-repo package with a framework-neutral boundary (CSS + element-tree description in, versioned style table out; Swift/Kotlin evaluators without Markless runtime deps; data-only conformance suite). Spin out when the table format is stable for a release cycle, T020 blocking findings are closed by conformance tests, and a second consumer exists.",
    "unverified": ["Uniwind build-time parser internals (vendor posts)", "Tailwind CSS compilation being TypeScript not Rust (inferred from Cargo.toml)", "Blitz mobile status", "neapolitan-extract activity", "old UIKit CSS libraries maintenance"],
    "estimates_not_measured": ["engine size and maintenance cost in section 4"],
    "files_changed": ["docs/goals/native-targets-api/notes/T024-styling-projects.md"],
    "full_outcome_complete": false
  }
}
```
