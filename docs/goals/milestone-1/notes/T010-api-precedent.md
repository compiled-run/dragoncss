# T010: API and intermediate-format precedent (Scout)

Question: what compiler and library APIs do framework and tool authors actually adopt, what made adoption easy or painful, and what intermediate formats teach about the shape of Dragon's element-tree input.

Method. Web sources and GitHub issues, all accessed **2026-09-26**. Where it mattered, the published package was downloaded (`npm pack`) and its type definitions read directly, and lightningcss and PostCSS were run locally to see real error and warning objects. Versions are the npm `latest` on 2026-09-26 unless noted. Claims I could not confirm from a primary source are marked **(unverified)**. Local reads: `~/dev/open-source/yuku/npm/*/index.d.ts` and `~/dev/open-source/yuku-tsrx/npm/yuku/index.d.ts` (the working copies on disk; `git log` was unavailable because the Xcode licence blocks git on this machine).

Owner structural questions this note serves: remove pitfalls by design; semantic analysis decides platform choices; focus on one platform and the other just works; agents work with it as well as with StyleX; framework-neutral; compile straight to native properties; one compiler result for web output, native code and test data.

## 0. Summary in plain words

- **The APIs that framework authors adopt are small, synchronous where possible, take plain data in and return plain data out, and keep configuration in one place.** lightningcss `transform()`, Svelte `compile()` and react-native-css `compile()` are single calls. Tailwind's two-phase `compile(css) -> build(candidates)` is the model for a compiler with a slow setup step and a fast repeated step.
- **The biggest recurring pain is not the API shape. It is (a) native binary installs, (b) unstable internals that tools depend on anyway, and (c) extension points that split the ecosystem.** Tailwind's `__unstable__loadDesignSystem` is relied on by Prettier, oxfmt, Biome and linters, and it breaks between patch releases. StyleX had six-plus bundler plugins (official and community) before consolidating on `@stylexjs/unplugin`, and Next.js is still uncovered. SWC Wasm plugins broke on almost every `@swc/core` release until November 2025.
- **Diagnostics are weak almost everywhere.** Only Svelte (string codes, per-code docs page, `warningFilter`) and Vue (numeric codes plus `loc`) give machine-usable codes. lightningcss has no codes and no per-declaration location. It also **silently keeps an invalid value** such as `width: 1foo` as an unparsed token, with no warning even with `errorRecovery: true` (probed locally). react-native-css warnings are buckets of property names with no location at all. Nobody ships a fix object that an agent can apply. This is Dragon's clearest opening.
- **Source spans are inconsistent across every format studied.** Lines and columns are 1- or 0-based depending on the tool, and offsets are UTF-8 bytes (yuku, SWC) or UTF-16 code units (unist). SWC even shares offsets across calls. Dragon must fix one unit, state it in the schema, and convert at its boundary.
- **Formats that survived change share three rules.** Additions only; one reserved extension slot (unist `data`, Mitosis `meta`); and a self-describing wire format with an explicit "unknown" case (SWC's 2025 fix). web-features adds a fourth: IDs never disappear, they become `moved` or `split` redirects. BCD adds a fifth: the schema is semver-versioned, the data is not.
- **Recommendation direction (detail in section 6):** one `compile(input, config)` that is synchronous and pure, returns one frozen result, and has output readers (`web`, `swift`, `properties`). Diagnostics carry a stable string code, severity from the support profile, a UTF-16 span plus line and column, and a structured `fix`. The element tree is a versioned, JSON-only, contextless schema with a single `data` extension slot, required spans on authored nodes, and states listed as finite variants.

## 1. Precedent table

"Sync" means a synchronous main entry. "Codes" means stable machine-readable diagnostic identifiers. Sizes are npm `dist.unpackedSize`.

| API (version) | Main entry | Sync | Binding | Diagnostics | Extensibility | Stability promise | Adoption notes |
|---|---|---|---|---|---|---|---|
| lightningcss 1.33.0 | `transform({filename, code, targets, ...})` -> `{code, map, warnings, exports, dependencies}`; `bundle`, `bundleAsync`, `transformStyleAttribute`, `browserslistToTargets`, `composeVisitors` | yes (`bundleAsync` for async resolvers) | NAPI, 11 platform packages (darwin-arm64 8.2 MB on disk); `lightningcss-wasm` 16.2 MB, **no bundle or visitor API in WASM** | Throws `{message, fileName, source, loc:{line,column}, data:{type,value}}`; warnings `{message, type, value, loc}`; **no codes; no per-declaration location** | JS visitors over a typed AST generated from Rust types; `Exit` visitors; `customAtRules` | semver 1.x; AST types are generated from internal Rust types, so they move with internals (inferred) | Adopted by Vite, Tailwind, StyleX, react-native-css; Vite took ~2 years to stabilize it (preprocessors, targets config confusion, WASM gaps) |
| PostCSS 8.5.28 | `postcss(plugins).process(css, {from})` -> `LazyResult` | lazy: sync getters throw if any plugin is async | pure JS, 218 KB | `CssSyntaxError {name, reason, file, line, column, source, input}`; `result.warn()`, `node.error()`; `result.messages` (type `dependency`) | Event listeners per node type (`Declaration`, `Rule`, `OnceExit`) | Plugin API rewritten in 8.0 to fix dependency duplication and repeated walks | The most adopted CSS plugin host; the 7->8 migration moved `postcss` to `peerDependencies` because mixed-version AST nodes caused "painful bugs" |
| Tailwind 4.3.3 (`tailwindcss`, `@tailwindcss/node`, `@tailwindcss/oxide`) | `await compile(css, {base, onDependency})` -> `{sources, root, features, build(candidates) -> string, buildSourceMap()}`; `compileAst`; oxide `new Scanner({sources}).scan()` | async setup, sync `build` | Oxide NAPI (12 platforms) plus `oxide-wasm32-wasi` 11.6 MB | Plain thrown `Error` (unverified beyond reading types) | CSS-first `@plugin`, `@utility`; no AST plugin API | `__unstable__loadDesignSystem` is explicitly unstable, **yet Prettier, oxfmt, Biome and linters depend on it**; methods appear in patch releases (`candidatesToAst` in 4.1.18) | "Cannot find native binding" (npm/cli#4828) is the top install complaint; Vite 8 LightningCSS config sharing issue #19792 |
| StyleX 0.19.1 (`@stylexjs/babel-plugin`, `@stylexjs/unplugin`) | Babel plugin; output rules on `metadata.stylex` as `Rule = [className, {ltr, rtl?}, priority]`; `processStylexRules(rules, config) -> string` | yes (Babel) | pure JS on Babel; unplugin pulls lightningcss | Thrown Babel errors whose messages come from message functions (`nonStaticValue(fn)`), **no codes**; `propertyValidationMode: 'throw' \| 'warn' \| 'silent'` | Options only; no visitor API | 0.x; `unstable_moduleResolution` naming | Deprecated six per-bundler plugins in 0.12.0 (April 2025), consolidated on unplugin; Next.js still needs Babel plus PostCSS by hand; community SWC port (`@stylexswc/*`) runs in parallel. LLM docs are two markdown files |
| vanilla-extract (`@vanilla-extract/integration` 8.0.10, `@vanilla-extract/compiler` 0.7.2) | `compile({filePath, identOption, cwd, esbuildOptions})` -> `{source, watchFiles}`; `processVanillaFile` | async | JS; executes user TS through esbuild or vite-node | Errors from evaluating user code | Per-bundler plugins over a shared integration package | Vite plugin swapped esbuild for vite-node and **removed `esbuildOptions`** as a breaking change | Path-alias and config-forwarding bugs arise because the compiler runs a second, separate build (issue #1156) |
| Panda 1.12.1 (`@pandacss/node`) | `loadConfigAndCreateContext()` -> `PandaContext`; `Builder`, `codegen`, `cssgen`, `analyze`, `buildInfo` | async, stateful | JS; depends on `ts-morph`, `prettier`, `postcss`, `chokidar` | Logger output (unverified) | Config presets, hooks | 1.x | Static extraction via TypeScript AST; heavy dependency tree; `buildInfo` ships extracted data for libraries (precedent for shipping a result as data) |
| Lynx `@lynx-js/css-defines` 0.0.18 | 238 JSON files, one per property: `{name, id, type, default_value, formal_syntax, is_shorthand, consumption_status, compat_data: {BCD-shaped __compat}}`; generated `.d.ts` | data | data | n/a | New property = new JSON file | 0.0.x; **stable numeric `id` per property**, used by the C++ engine | Single source generating engine C++ and TS types; BCD-shaped support per native platform (`ios`, `android`, `harmony`, `clay_*`, `web_lynx`) |
| react-native-css 3.0.7 (`react-native-css/compiler`) | `compile(code, {filename, inlineRem, inlineVariables, features, hexColors, ...})` -> `{stylesheet(): ReactNativeCssStyleSheet, warnings(): {properties?, values?, functions?}}` | yes | JS on lightningcss | **Warnings are buckets of names with no location** | Runtime-matching style sheet (terse keys `s`, `d`, `v`) read by its own runtime | 3.x, but the NativeWind v4->v5 engine swap was a new package; 3.1 RC turns some silently ignored config into errors | NativeWind v5 reports of styles silently not applied (className plus style #1647, dark mode #1617, `@import` #1631) |
| Taffy 0.14.0 (Rust); `taffy-layout` 3.0.0 (third-party WASM) | `TaffyTree::new()`, `new_leaf(style)`, `new_with_children`, `compute_layout(root, available)`, `compute_layout_with_measure`, `layout(node)`; low-level traits `LayoutPartialTree`, `compute_flexbox_layout` | yes | Rust crate; WASM wrapper 584 KB `.wasm`, needs `await loadTaffy()` | Rust `Result` errors | Low-level trait API for custom trees | 0.x: minor versions may break (no stability statement found) | The official crate has no npm package; the npm one is community-maintained |
| Yoga 3.2.1 (`yoga-layout`) | `Yoga.Node.create()`, setters, `calculateLayout(w, h, dir)`, `getComputedLayout()` | sync after load | WASM embedded base64; **top-level await** in the main entry; `yoga-layout/load` added later | n/a | Measure and dirtied callbacks | 3.0 was a breaking major (React Native 0.74) | The top-level await broke esbuild and Vite targets (solid-start #1614, threlte #1140), so a `load` entry was added in a patch |
| @mdn/browser-compat-data 8.1.3 | JSON tree; `__compat: {support: {browser: {version_added}}, status}` | data | 20.4 MB | n/a | n/a | **Schema and TS types are semver; data changes at any time** | Every compat tool (lightningcss targets, browserslist, web-features) reads it |
| web-features 3.40.0 | `features[id] = {name, description, spec, group, compat_features, status: {baseline, baseline_low_date, support, by_compat_key}, kind}` | data | 4.8 MB | n/a | n/a | IDs are kept: `kind: "moved"` (10) and `"split"` (2) redirects out of 1,216 entries | Baseline gives one human label over many BCD keys |
| Babel 8.0.6 | Plugin `{name, visitor, pre, post, manipulateOptions}`; `api.assertVersion(8)`; `path.buildCodeFrameError` | sync plugins | JS | Code-frame errors, no codes | Visitors; the reference model for plugin ecosystems | Babel 8 (June 2026): ESM-only; AST changes were available earlier behind opt-in flags (`createImportExpressions` from 7.23) | `assertVersion(7)` hard-fails on 8, so every plugin needed a release |
| SWC 1.16.2 | `transform`, `parse`/`parseSync` | both | NAPI (darwin-arm64 26.6 MB); `@swc/wasm` 20.3 MB | Rust diagnostics as strings | Wasm plugins | **Plugins broke on nearly every release until 1.15.0 (Nov 2025)**, fixed by switching rkyv to self-describing CBOR plus `Unknown` enum variants | Span offsets are shared across calls and start at 1 (issues #1366, #5562, #9932) |
| unplugin 3.4.0 | `createUnplugin((options, meta) => ({name, transform: {filter, handler}, load, resolveId, buildStart, ...}))` plus per-bundler escape hatches (`vite`, `webpack`, `esbuild`, ...) | n/a | JS | n/a | Common hooks only; `transformInclude` deprecated for `transform.filter` | 3.x | The common surface covers transform, load and resolve, **not CSS asset emission**, which is why StyleX's unplugin cannot serve Next.js webpack |
| @vue/compiler-sfc 3.5.43 | `parse(source, {filename})` -> `{descriptor, errors}`; `compileTemplate`, `compileScript`, `compileStyle`, **`compileStyleAsync`** | sync plus an async twin for PostCSS | JS, 2.65 MB | `CompilerError extends SyntaxError {code: number \| string, loc?: {start:{offset,line,column}, end, source}}`; numeric `ErrorCodes` enum | Node transforms (`nodeTransforms`, `directiveTransforms`) | 3.4 parser rewrite was "100% backwards compatible for Vue end users" (no stated promise for tool authors) | Volar, eslint-plugin-vue and Vue Macros all consume the template AST |
| svelte 5.57.1 (`svelte/compiler`) | `compile(source, options)` -> `{js:{code,map}, css, warnings, metadata}`; `parse(source, {modern})`; `compileModule`, `preprocess`, `migrate`, `print`, `parseCss`, `VERSION` | sync (`preprocess` async) | JS, 2.94 MB | `CompileDiagnostic {code, message, filename?, start:{line,column,character}, end, position:[s,e], frame}`; string codes with a docs page each; `warningFilter`; `<!-- svelte-ignore code -->` | Preprocessors only | Legacy AST by default; `modern: true` becomes default in 6 and the option is removed in 7 | Svelte 5 renamed all codes from `a-b` to `a_b`; a `legacy_code` warning points to the new name |
| Mitosis 0.14.0 | Parsers -> `MitosisComponent` JSON -> generators | sync | JS | n/a | Plugins with `json.pre/post` and `code.pre/post` hooks, `order` | 0.x for five years | JSON has `'@type'` tags and a free `meta` slot, **no source locations**, and expressions stored as code strings |
| yuku-analyzer 0.11.0 (published; working copy shows 0.5.43 workspace types) | `new Analyzer({resolve})`, `addFile(path, source, opts) -> Module`, `link()`, `definitionOf`, `referencesOf`; `Module.walk(visitors)`, `symbolOf`, `scopeOf`, `parentOf`, `capturesOf` | sync | NAPI, 12 platforms (758 KB darwin-arm64); parser has a separate `yuku-parser-wasm` 391 KB; **no analyzer WASM found** | `Diagnostic {severity, message, help: string \| null, start, end, labels[]}` with **byte offsets**; `LinkDiagnostic` has `module` but no `help` or labels; **no codes** | `walk` visitors; mutable AST plus `yuku-codegen` | 0.x, a minor release roughly every two weeks | `@tsrx/yuku` 0.3.0 ships bindings for **only darwin-arm64 and linux-x64-gnu**; its CSS scanner gives structure only (`CssRule.prelude: CssSelector[]` with `scopeInsert`, no declarations) |

## 2. Per-API findings that matter for Dragon

### 2.1 lightningcss

- Entry points (`node/index.d.ts` in 1.33.0): `transform`, `transformStyleAttribute`, `bundle`, `bundleAsync`, `browserslistToTargets`, `composeVisitors`, plus the `Features` bit flags.
- **Targets are numbers encoded as `major << 16 | minor << 8 | patch`**, one key per browser (`chrome`, `safari`, `ios_saf`, ...), with `include` and `exclude` bitmasks to force or skip lowering.
- Probe (local, 1.33.0):
  - `@@@ {` threw `{fileName:"a.css", loc:{line:1,column:20}, data:{type:"SelectorError", value:{type:"EmptySelector"}}}`.
  - `.b:hoverx{}` with `errorRecovery: true` returned a warning with `type: "SelectorError"`, `value.type: "UnsupportedPseudoClass"`, and a helpful message.
  - `width: 1foo` produced **no warning and no error**. The visitor saw `{property:"unparsed", value:{propertyId:{property:"width"}, value:[token dimension 1 "foo"]}}`, and the output kept `width: 1foo`.
  - `.a{...}` followed by an unclosed `.b {` did not throw.
- Visitor nodes: `Rule` values carry `loc: {source_index, line, column}`. In our probe that looked like a 0-based line and a 1-based column, while the `Location` type documents a 1-based line and a 0-based column (observed; not documented). **`Declaration` nodes carry no location** (keys: `property`, `value`).
- The visitor AST types are generated from Rust types through JSON Schema (PR #363), so they change when the internals change (inference; no incident found). PR #363 also notes that the serde code made the binary "significantly larger".
- WASM: "the bundle and visitor APIs are not currently available in the WASM build" (lightningcss.dev/docs.html). In Vite, `bundleAsync` was missing from WASM until 1.21.8 (September 2023), which blocked StackBlitz.
- Vite's "Stabilizing Lightning CSS" discussion (#13835) found targets set in two places where one "didn't do anything" and `build.cssTarget` was "totally unused". It took until Vite 6.3 (May 2025) to close the preprocessor blocker.
- **Lesson:** lightningcss is a good parser and lowering engine to build on, but Dragon cannot inherit its diagnostics. Dragon must (a) detect unparsed declarations itself and turn each into a coded error, and (b) keep its own per-declaration spans (from yuku's scanner or its own scan), because lightningcss gives none.

### 2.2 PostCSS

- `process()` returns a `LazyResult`. Reading `.css` synchronously throws if any plugin is async, so a sync/async split leaks into every host (Vue added `compileStyleAsync` for this reason).
- The 7->8 plugin migration (Evil Martians guide) fixed three things: every plugin walked the whole AST; plugins bundled their own `postcss` copy, bloating `node_modules`; and "Mixing AST nodes created by different PostCSS versions can cause painful bugs". The fix was `peerDependencies`, event listeners per node type, and helpers passed in as arguments rather than imported.
- **Lesson:** if Dragon ever exposes node objects to plugins, there must be exactly one copy of the types (a peer dependency, or better, plain data only). Keep Dragon synchronous so hosts never need a twin API.

### 2.3 Tailwind v4

- Two-phase compiler: `compile(css, opts)` does the slow work once (config, theme, plugins) and returns `build(candidates)`, which is called again as new class names are found. `onDependency` reports watched files.
- `__unstable__loadDesignSystem` returns the design system (class order, candidate to CSS). The Prettier plugin, oxfmt, Biome's sorter and several linters depend on it. It changes between patch releases (`candidatesToAst` first appeared in 4.1.18, which crashed design-lint on 4.1.17), and oxfmt measured 3+ seconds for the first call.
- Install pain: "Cannot find native binding. npm has a bug related to optional dependencies (npm/cli#4828)" shows up for oxide and lightningcss alike, especially with cross-OS lockfiles and in CI.
- **Lessons:** (1) whatever editors and formatters need (Dragon's equivalents: the support profile, the resolved property list for one element, diagnostics for a file) must be a **stable, documented export on day one**, or tools will bind to internals. (2) A setup-once, run-many compiler fits dev servers. (3) Native bindings bring the npm/cli#4828 support burden, so a pure-TS core is an adoption advantage.

### 2.4 StyleX

- The Babel plugin writes rules to `metadata.stylex` as `[className, {ltr, rtl}, priority]`. The bundler integration concatenates them across files and calls `processStylexRules(rules, {useLayers})` to produce one CSS file. **The compiler result is plain data, and turning it into CSS is a separate, deterministic function.** This is the closest precedent for Dragon's "one result, several outputs".
- Errors are Babel code-frame errors with message text from functions such as `nonStaticValue(fn)`. There are no codes. `propertyValidationMode: 'throw' | 'warn' | 'silent'` is a per-project escape hatch, which is the kind of flag Dragon wants to avoid.
- Integration history: v0.12.0 (April 2025) deprecated the per-bundler packages "to focus on the core toolchain and provide consistent tools across bundlers". Before that there were official rollup, webpack, nextjs and esbuild plugins plus at least three community Vite plugins. After it there is `@stylexjs/unplugin`, but Next.js still needs `@stylexjs/babel-plugin` plus `@stylexjs/postcss-plugin` wired by hand, because unplugin's CSS emission uses Rollup's `emitFile`. A community SWC reimplementation (`@stylexswc/*`) runs alongside with its own plugin set.
- Agent material: two markdown files (installation and authoring) at stylexjs.com/docs/llm-resources. The owner's "agents work really well with StyleX" rests mostly on the authoring model (local styles, static objects, deterministic merging), not on tooling.
- **Lesson:** ship one official integration layer early, and design the core result so that emitting CSS does not need bundler-specific hooks.

### 2.5 vanilla-extract and Panda

- Both **run user code at build time** (vanilla-extract evaluates `.css.ts` through esbuild or vite-node; Panda uses `ts-morph`). Both then suffer from build configuration having to be copied into a second, internal build: path aliases (#1156), Vite config forwarding, and the breaking removal of `esbuildOptions`.
- Panda's `buildInfo` / `ship` writes extracted style usage as JSON so that libraries can hand it to apps. That is a precedent for making the compiler result a shippable artifact.
- **Lesson:** Dragon takes CSS text plus a tree as data and never executes user code, which avoids this whole class of problems. Keep it that way. Semantic analysis (yuku) reads code; it does not run it.

### 2.6 Lynx css-defines

- One JSON file per property, with a **stable numeric `id`**, `formal_syntax`, `default_value`, `consumption_status` (for example `layout-only`), and BCD-shaped `compat_data` with native platforms as the "browsers". One generator produces the engine's C++ and the developer-facing TypeScript types.
- **Lesson:** this is almost exactly Dragon's support profile. Copy the ideas of a BCD-shaped support block per target and stable IDs, and generate the types from the profile. Do not copy the `version_added: "1.0"` style: Dragon's rule is "an entry names a passing test", so the support value should reference a fixture ID, not a version.

### 2.7 react-native-css (NativeWind engine)

- `compile(code, options)` is synchronous and returns lazy getters `stylesheet()` and `warnings()`. The style sheet is a terse, runtime-matched format (`s` = rule sets, `d` = declarations, `v` = variables) that its own runtime reads on the device.
- Warnings are `{properties?: string[], values?: Record<string, unknown[]>, functions?: string[]}`: **no file, no line, no fix**. NativeWind v5 bug reports are dominated by styles silently not applying. The 3.1 RC's main fix is turning silently ignored configuration into explicit errors, and the migration guide tells users not to trust a successful build.
- **Lesson:** this is the anti-pattern Dragon exists to beat. Unsupported means a located, coded error, and the result never contains an unapplied style.

### 2.8 Taffy and Yoga

- Taffy (Rust 0.14.0) has a high-level `TaffyTree` API and a low-level trait API. There is no official npm package; `taffy-layout` 3.0.0 is a third-party WASM wrapper (584 KB `.wasm`, async `loadTaffy()`). Taffy is 0.x, so minor releases can break.
- Yoga 3's top-level-await WASM entry broke bundlers that target older browsers, and a `yoga-layout/load` entry had to be added in a patch.
- **Lesson:** keep layout-engine types out of Dragon's public API. The property list should be Dragon's own schema (CSS property names and resolved values), with a Taffy mapping as an internal adapter in the Linux lane, so a Taffy 0.x break never becomes a Dragon break. Never use top-level await in a public entry.

### 2.9 browser-compat-data and web-features

- BCD's SemVer policy (README, 8.1.3): the public API is "the high-level namespace objects", "the schema definitions" and "the TypeScript definitions"; "expect lower-level namespaces, feature data, and browser data to be added, removed, or modified at any time."
- web-features never deletes an ID. It turns it into `kind: "moved"` (one redirect) or `kind: "split"` (several). It also gives one Baseline label over many BCD keys.
- **Lesson for the support profiles and diagnostic codes:** version the schema with semver, publish data changes freely, never delete a feature ID or diagnostic code (redirect it), and give a one-word summary status over the detailed entries.

### 2.10 Babel, SWC, unplugin

- Babel's visitor plugin model is the reference, and it created the largest plugin ecosystem, along with its costs: `assertVersion(7)` hard-fails on Babel 8, so every plugin needs a release. Babel 8 made the AST change available early behind a flag (`createImportExpressions` from 7.23), the same pattern as Svelte's `modern` option.
- SWC's Wasm plugin ABI story is the strongest warning about exposing a binary AST to plugins. It was fixed by a self-describing encoding plus `Unknown` variants on every enum (blog.swc.rs, 2025-11-04). SWC's own summary: some changes still break, "but they're now much easier to avoid."
- unplugin: one factory, per-bundler escape hatches, hook `filter`s. Its common surface does not cover emitting CSS assets, which is exactly the gap StyleX hit on Next.js.

### 2.11 Vue compiler-sfc and Svelte compiler

- Vue: split per block (`parse`, `compileTemplate`, `compileScript`, `compileStyle`), plus an async twin for style. `CompilerError` has `code` (a numeric enum) and `loc` (offset, line and column). Numeric codes are compact, but they are opaque in logs and fragile to extend (Vue reserves ranges for compiler-dom). **(unverified: any incident of shifted numeric codes.)**
- Svelte: one `compile()` returning code, CSS, warnings and metadata. Diagnostics have string codes, each with a docs page, start and end with line, column and character, and a code frame. `warningFilter` configures filtering in one place, replacing the many places users used to configure it. The Svelte 5 code rename (`a11y-missing-attribute` to `a11y_missing_attribute`) needed a `legacy_code` warning. Svelte's AST shape is opted into with `modern: true`, which will become the default in 6, with the option removed in 7.
- **Lesson:** use string codes that are stable from day one and have a docs page and an agent-readable fix each. Fix the spelling convention before 1.0, because renaming later costs every user.

### 2.12 yuku analyzer (and `@tsrx/yuku`)

- `Analyzer` is a stateful project graph: `addFile` replaces a file and marks the graph for relinking, cross-file queries link on demand, and each `Module` gives `ast`, `diagnostics`, `scopes`, `symbols`, `references`, `walk`, `symbolOf`, `scopeOf`, `parentOf`, `capturesOf`, `imports` and `exports`. It is synchronous, backed by native code, and returns identity-shared ESTree nodes.
- Diagnostics: `{severity: "error" | "warning" | "hint" | "info", message, help: string | null, start, end, labels: {start, end, message}[]}`, with **byte offsets**. `@tsrx/yuku` documents that `scopeInsert` "counts UTF-8 bytes, which matches UTF-16 indices for the ASCII CSS that selectors are written in", and ships `sourcePosition`, `sourceLocation` and `authoredDiagnosticSpan` helpers because diagnostics can land on the wrong offset. There are no diagnostic codes.
- `@tsrx/yuku` 0.3.0 publishes native bindings for darwin-arm64 and linux-x64-gnu only.
- **Lessons:** (1) yuku's diagnostic shape (`severity`, `message`, `help`, `labels`) is a good base, and Dragon should add `code` and a structured `fix`. (2) Convert byte offsets to Dragon's span unit at the boundary. (3) Keep yuku behind a separate front-end entry (`dragon/tsrx` or similar), so the core `compile()` stays pure TypeScript with no native install; frameworks that already have a tree never pay for yuku's platform coverage.

## 3. Intermediate formats

| Format | Versioning | Source spans | Extension rule | How consumers cope with change |
|---|---|---|---|---|
| ESTree (estree/estree) | One file per ES year (`es5.md`, `es2015.md`, ...); "Non-additive modifications ... will not be considered unless immense support"; steering committee from ESLint, Acorn and Babel | `loc: {source, start:{line (1-based), column (0-based)}, end}` or `null`; `range`/`start`/`end` offsets are a common parser extension, not spec | "Contextless" (no parent pointers), "Unique" (no duplicated info), "Extensible" (broad nodes such as `MetaProperty`) | Visitor-key tables (eslint-visitor-keys) let tools traverse unknown node types; TS-ESTree extends by adding node types |
| unist / hast (syntax-tree) | Spec plus `@types/unist` 3.0.3 and `@types/hast` 3.0.5 majors; type majors roll across the ecosystem together (unverified: size of the unified 11 upgrade) | `position: {start:{line>=1, column>=1, offset>=0 (UTF-16)}, end}`; "must not be present if a node is generated" | `data`: "guaranteed to never be specified by unist or specifications implementing unist"; values "must be expressible in JSON" | 40+ small utilities over one tiny core; generated versus authored nodes are distinguishable by whether `position` is present |
| Vue template AST (compiler-core 3.5.43) | Tied to the Vue version, with no separate schema version | `loc: {start:{offset,line,column}, end, source}` on every node, plus `innerLoc` on elements | Numeric `NodeTypes` enum; transforms add `codegenNode` | Tools pin the Vue minor version; the 3.4 rewrite was advertised as compatible for end users |
| Svelte AST (5.57.1) | Legacy and modern shapes side by side, selected with `parse(src, {modern})`; the default flips across majors | `start`/`end` character offsets on every node | String `type` discriminator (`RegularElement`, `SvelteComponent`) | Opt-in early, default later, remove after: a three-major migration path |
| Mitosis JSON (0.14.0) | `'@type': '@builder.io/mitosis/component'` tag; no schema version; 0.x | **none** | Free `meta: JSONObject`, `pluginData`; plugin `json.pre/post` hooks | Generators read the JSON directly; expressions are strings (`bindings: {code}`), so every generator re-parses them |
| SWC AST (1.16.2) | Before 1.15.0: exact version match via rkyv. From 1.15.0: CBOR plus `Unknown` enum variants | `span: {start, end, ctxt}` as UTF-8 byte positions in a process-wide source map; they start at 1 and grow across calls | Rust enums | Plugins pinned to `swc_core` ranges, then a registry, then the stable-ABI fix |
| yuku analyzer output (0.11.0) | 0.x, frequent minors | `start`/`end` UTF-8 byte offsets; `sourcePosition` helpers in `@tsrx/yuku` | Mutable ESTree nodes; semantic tables are "a snapshot of the parsed source and do not track mutations" | Consumers re-analyze after edits and convert offsets themselves |

**What these add up to for Dragon's tree:**

1. **Specify the span unit in the schema.** Every format differs: 0- or 1-based columns, UTF-8 bytes or UTF-16 units, per-call or process-global offsets. Pick UTF-16 offsets (what JS `slice` and LSP use) plus 1-based line and column, and convert yuku's byte offsets at the boundary.
2. **Additions only, within a schema major.** Use one reserved extension slot, `data`, that Dragon promises never to define. Unknown `data` keys are ignored; an unknown node `kind` is a coded error, never a silent skip.
3. **Carry an explicit schema version in the payload** (`"dragon/tree@1"`), not just a package version. Mitosis's `'@type'` is the right idea without the version.
4. **Keep it contextless and unique (ESTree).** Children arrays, no parent pointers, no derived duplicates. The compiler derives ancestry.
5. **Distinguish authored from generated nodes (unist).** A node the compiler inserts, such as a wrapped loose-text node, has no `span`. An authored node must have one, or a diagnostic cannot "name the file and line".
6. **Keep values structured, not code strings (the Mitosis anti-pattern).** State conditions and class lists are finite, structured data, never JavaScript expressions the compiler would have to re-parse or run.
7. **Offer an early opt-in for the next shape (Babel 8, Svelte `modern`)**, so the next major's tree can be tried before it becomes the default.

## 4. What made adoption easy or painful

Easy:
- One call, plain data in and out, synchronous: lightningcss `transform`, Svelte `compile`, react-native-css `compile`.
- A setup-once, run-many design for dev servers: Tailwind `compile -> build`, yuku `Analyzer.addFile` with relinking.
- One official integration layer: `@stylexjs/unplugin` after April 2025, Svelte `warningFilter` as the one place to filter.
- Data packages with a clear SemVer boundary: BCD, web-features.

Painful:
- Native optional-dependency installs (npm/cli#4828) across lightningcss, oxide, oxc and SWC; platform gaps (`@tsrx/yuku` has two platforms).
- WASM builds missing features (lightningcss bundle and visitor APIs); top-level-await entries (Yoga).
- Unstable internals that tools depend on anyway (Tailwind design system).
- Plugin ABIs tied to exact versions (SWC before 1.15; Babel `assertVersion`); mixed-version AST nodes (PostCSS 7).
- Silent drops (lightningcss unparsed values; NativeWind styles not applied); location-free warnings (react-native-css).
- Configuration in two places (Vite `css.lightningcss.targets` versus `build.cssTarget`), or copied into an internal second build (vanilla-extract).
- Breaking renames of codes and options (Svelte codes, vanilla-extract `esbuildOptions`).

## 5. Lessons for Dragon

Each lesson names the owner question it serves.

1. **Pure, synchronous, TypeScript `compile()` with no native dependency in the core.** Serves framework-neutral and agent use; removes the npm/cli#4828 class of install failure, sync/async twin APIs, and WASM feature gaps. yuku lives in an optional front-end entry.
2. **One result object; outputs are views of it, never separate compiles.** StyleX's `Rule[] -> processStylexRules()` generalized. Serves "one compiler result for web, native and test data"; removes drift between outputs by construction.
3. **Targets live in one config object passed once, not per call.** Vite's two ignored target settings and the T007 A1 finding point the same way. There are no per-call escape flags such as `errorRecovery` or `propertyValidationMode`. Serves "remove pitfalls by design".
4. **Diagnostics are the product.** Every unsupported, unparsed or ignored input becomes a coded diagnostic with a span and a structured fix. Detect lightningcss "unparsed" declarations explicitly, and never let a warning mean "dropped". Serves agents and "one platform, the other just works".
5. **Stable string codes with docs, redirects instead of renames, and one filter place.** Svelte's codes and `warningFilter`, web-features' moved/split. Severity comes from the support profile, not from caller flags.
6. **Publish what editors and formatters need, as stable exports, on day one:** the profile, per-element resolved properties, and explanations for a span. The Tailwind `__unstable__` lesson.
7. **No AST plugin API in 1.x.** Dragon's value is proven parity, and a visitor that rewrites values would void the proof (a declaration changed by a plugin has no fixture). Extension happens through the tree's `data` slot and through new profile entries backed by tests. This avoids the fragmentation seen in PostCSS 7, Babel and SWC.
8. **A versioned, JSON-only element-tree schema** with required spans on authored nodes, one `data` slot, structured state variants, additions only within a major, and an opt-in for the next shape.
9. **Keep layout-engine types private.** The property list uses CSS names and resolved values; the Taffy mapping is an internal adapter.
10. **Never execute user code.** Unlike vanilla-extract and Panda, read CSS and the tree as data; yuku reads source statically.

## 6. Candidate shapes

Pseudocode in Dragon's idiom. These are options for T011 and T014 to decide between, not decisions.

### 6.1 `compile()`

**A. One pure call, one frozen result with output readers (recommended starting point)**

```ts
import { compile, defineConfig } from "dragon";

const config = defineConfig({ targets: ["web", "ios"] });  // loaded once by the integration

const result = compile({ css: [{ path, text }], tree }, config);  // sync, pure, no fs access
result.diagnostics;                 // readonly Diagnostic[], always present
result.ok;                          // false if any error for any configured target
result.web();                       // { css, map } compiled from the same resolved result
result.swift();                     // { files: [{ path, text }] }; throws DragonNotOk if !ok
result.properties();                // plain JSON property list for the test lanes
result.explain(elementId, state);   // which rules set each property; for editors and agents
```

Pros: StyleX-like determinism; trivially cacheable (the input hash is the key); nothing async. Cons: whole-app input per call. Fine for milestone 1; the dev server may want B.

**B. Two phases: config once, then incremental per component (Tailwind-style)**

```ts
const compiler = createCompiler(config);        // parses the support profile once, validates targets
const unit = compiler.update({ path: "Button.tsrx", css, tree });  // returns UnitResult for this component
compiler.remove("Old.tsrx");
const app = compiler.snapshot();                // whole-app Result, same shape as A
```

Pros: fast dev loop and HMR; matches yuku's `Analyzer.addFile`. Cons: it is stateful, so the "same input, same output" guarantee must be tested (snapshot equals A's result for the same files).

**C. Source-in front ends over A (framework-neutral core)**

```ts
import { compile } from "dragon";
import { treeFromTsrx } from "dragon/tsrx";      // yuku lives here only

const { tree, diagnostics } = treeFromTsrx(analyzer, "Button.tsrx");  // semantic analysis -> tree
const result = compile({ css, tree }, config);    // front-end diagnostics are merged into the result
```

Pros: the core stays pure TypeScript; frameworks with their own compiler pass a tree; semantic-analysis users get platform decisions for free. Cons: two entries to document. This is the tree-in versus source-in question for T011.

### 6.2 Diagnostics

**A. yuku-compatible superset (recommended)**

```ts
type Diagnostic = {
  code: `DRG${number}` | string;       // stable; never reused; renamed codes redirect
  severity: "error" | "warning";       // from the support profile and target; no caller override
  message: string;                     // one sentence
  target: "ios" | "android" | "web" | null;
  span: Span;                          // primary location in the author's file
  labels: { span: Span; message: string }[];
  help: string | null;                 // human sentence, as in yuku
  fix: Fix | null;                     // machine-applicable; agents apply it
  profileEntry: string | null;         // e.g. "css.properties.gap.flex_context"
  docs: string;                        // https://dragon.dev/d/DRG0123
};
type Span = { path: string; start: number; end: number;          // UTF-16 offsets
              line: number; column: number };                      // 1-based, derived
type Fix = { title: string; edits: { span: Span; text: string }[] };
```

**B. Svelte-style string codes plus LSP-shaped ranges**: `code: "unsupported_property"` in snake_case, `range: {start:{line,character}, end}` (0-based, the LSP convention). Easier for editors; worse for grepping and logs. Pick one convention before 1.0.

**C. Diagnostics as data inside the property list**: each element-state entry carries `unresolved: [{ property, code }]` alongside the resolved properties, so test lanes and agents see gaps per element. This would complement A, not replace it.

Rules common to all three: no warning ever means "dropped" (dropping is always an error); a filter such as Svelte's `warningFilter` exists only in config, applies only to warnings, and each filter entry must name a code.

### 6.3 Element-tree format

**A. Versioned JSON tree with finite state variants (recommended)**

```jsonc
{
  "schema": "dragon/tree@1",
  "source": { "path": "src/Button.tsrx", "hash": "sha256:..." },
  "components": [{
    "id": "Button",
    "span": { "start": 12, "end": 480, "line": 1, "column": 1 },
    "states": { "pressed": ["false", "true"], "variant": ["primary", "ghost"] },
    "root": {
      "kind": "element", "id": "e0", "tag": "button",
      "span": { "start": 40, "end": 470, "line": 3, "column": 3 },
      "classes": [
        { "name": "btn" },
        { "name": "btn-primary", "when": { "variant": "primary" } },
        { "name": "is-pressed", "when": { "pressed": "true" } }
      ],
      "attributes": [{ "name": "ui-state", "value": { "from": "pressed" } }],
      "children": [
        { "kind": "text", "id": "t0", "span": { "start": 90, "end": 95, "line": 4, "column": 5 }, "value": "Click" },
        { "kind": "slot", "id": "s0", "span": { "start": 100, "end": 120, "line": 5, "column": 5 } }
      ],
      "data": { "markless": { "handle": "trigger" } }
    }
  }]
}
```

Properties: `schema` names the major; states are finite enums, so the compiler can enumerate every reachable state (design principle 1); `when` is structured, never code; spans are required on authored nodes and absent on generated ones; `data` is reserved for the producer and Dragon never reads it; an unknown `kind` is error `DRG…` naming the schema version.

**B. unist/hast-compatible tree**: `type: "element"`, `tagName`, `properties`, `position`, with Dragon-specific fields in `data.dragon`. Pros: reuses the unist utility ecosystem, and hast producers exist. Cons: hast has no concept of states or conditional classes, so they would live in `data`, which inverts the "Dragon never reads `data`" rule. The 1-based UTF-16 positions do match recommendation 3.1.

**C. Flat tables (analyzer-style)**: `elements: [{id, parent, tag, span}]`, `classes: [{element, name, when}]`, `states: [...]`. Pros: easy to diff, stream and index; mirrors yuku's `scopes`/`symbols` arrays. Cons: harder for people and agents to read and write by hand; parent pointers break ESTree's "contextless" rule. Could be the internal form, with A as the public one.

For each: schema changes within `@1` are additions only; the next major is first offered as `"schema": "dragon/tree@2"` alongside `@1` for at least one Dragon minor.

## 7. Open questions for T011 and T014 (not decided here)

- Tree-in only (A), or tree-in plus source-in front ends (6.1 C)? This depends on yuku's platform coverage (`@tsrx/yuku` has two bindings) and on whether a front end can be pure WASM.
- Numeric (`DRG0123`) or snake_case codes? Both work, but only one can be used before 1.0.
- Should dynamic values (a style value computed at runtime) be representable in tree `@1`, or be a coded error until a profile entry and fixture exist?

## Sources (all accessed 2026-09-26)

- lightningcss docs https://lightningcss.dev/docs.html ; transforms https://lightningcss.dev/transforms.html ; types from `lightningcss@1.33.0/node/index.d.ts` (npm pack); PR #363 https://github.com/parcel-bundler/lightningcss/pull/363 ; releases v1.17.0 and v1.19.0 https://github.com/parcel-bundler/lightningcss/releases ; Vite discussion #13835 https://github.com/vitejs/vite/discussions/13835 ; local probe with lightningcss 1.33.0 and postcss 8.5.28 on darwin-arm64.
- PostCSS plugin guide https://github.com/postcss/postcss/blob/main/docs/writing-a-plugin.md ; 8.0 migration https://evilmartians.com/chronicles/postcss-8-plugin-migration
- Tailwind: `@tailwindcss/node@4.3.3` and `tailwindcss@4.3.3` `dist/*.d.ts`, `@tailwindcss/oxide@4.3.3/index.d.ts` (npm pack); design-system fragility: Biome #11849 https://github.com/biomejs/biome/issues/11849 , oxc #18072 https://github.com/oxc-project/oxc/issues/18072 , design-lint #1 https://github.com/evilmartians/design-lint/issues/1 ; native binding: tailwind #19974 https://github.com/tailwindlabs/tailwindcss/issues/19974 , npm/cli#4828 ; tailwind #19792 https://github.com/tailwindlabs/tailwindcss/issues/19792
- StyleX: `@stylexjs/babel-plugin@0.19.1` and `@stylexjs/unplugin@0.19.1` types (npm pack); v0.12.0 https://stylexjs.com/blog/v0.12.0 ; unplugin docs https://stylexjs.com/docs/api/configuration/unplugin ; LLM resources https://stylexjs.com/docs/llm-resources ; Next.js adapter PR https://github.com/overengineeringstudio/effect-utils/pull/1380 ; https://github.com/Dwlad90/stylex-swc-plugin
- vanilla-extract: `@vanilla-extract/integration@8.0.10` types; vite-plugin changelog https://github.com/vanilla-extract-css/vanilla-extract/blob/master/packages/vite-plugin/CHANGELOG.md ; issue #1156 https://github.com/vanilla-extract-css/vanilla-extract/issues/1156
- Panda: `@pandacss/node@1.12.1` `dist/index.d.ts` and `package.json`
- Lynx: `@lynx-js/css-defines@0.0.18` (README, `css_defines/1-top.json`, `index.d.ts`), repo https://github.com/lynx-family/lynx/tree/develop/tools/css_generator
- react-native-css: `react-native-css@3.0.7` `dist/typescript/module/src/compiler/*.d.ts`; NativeWind v5 https://www.nativewind.dev/blog/v5-migration-guide , #1647 https://github.com/nativewind/nativewind/issues/1647 , #1617 https://github.com/nativewind/nativewind/discussions/1617 , #1631 https://github.com/nativewind/nativewind/issues/1631
- Taffy https://docs.rs/taffy/latest/taffy/ (0.14.0); `taffy-layout@3.0.0` README; Yoga `yoga-layout@3.2.1/src/index.ts`, README https://github.com/facebook/yoga/blob/main/javascript/README.md , solid-start #1614 https://github.com/solidjs/solid-start/issues/1614 , threlte #1140 https://github.com/threlte/threlte/issues/1140
- BCD `@mdn/browser-compat-data@8.1.3` README (Semantic versioning policy); web-features `web-features@3.40.0` README and `data.json`
- Babel 8 https://babeljs.io/blog/2026/06/16/8.0.0 , API migration https://babeljs.io/docs/v8-migration-api
- SWC Wasm compatibility https://blog.swc.rs/2025-11-4-wasm-backward-compatibility , https://swc.rs/docs/plugin/ecmascript/compatibility , Lingui #179 https://github.com/lingui/swc-plugin/issues/179 ; spans #1366 https://github.com/swc-project/swc/issues/1366 , #5562 https://github.com/swc-project/swc/issues/5562 , #9932 https://github.com/swc-project/swc/issues/9932
- unplugin `unplugin@3.4.0/dist/index.d.mts`
- Vue `@vue/compiler-core@3.5.43` and `@vue/compiler-sfc@3.5.43` types; Vue 3.4 https://blog.vuejs.org/posts/vue-3-4
- Svelte `svelte@5.57.1` `types/index.d.ts`, `src/compiler/utils/compile_diagnostic.js`; https://svelte.dev/docs/svelte/svelte-compiler ; v5 migration guide https://svelte.dev/docs/svelte/v5-migration-guide ; compiler warnings https://svelte.dev/docs/svelte/compiler-warnings
- Mitosis `@builder.io/mitosis@0.14.0` `dist/src/types/{mitosis-node,mitosis-component,plugins}.d.ts`
- ESTree https://github.com/estree/estree/blob/master/README.md , https://github.com/estree/estree/blob/master/es5.md ; unist https://github.com/syntax-tree/unist
- yuku: local `~/dev/open-source/yuku/npm/{yuku-analyzer,yuku-parser,yuku-types}/index.d.ts`, `~/dev/open-source/yuku-tsrx/npm/yuku/index.d.ts`; npm `yuku-analyzer@0.11.0` (published 2026-09-24) and `@tsrx/yuku@0.3.0` optionalDependencies.
- Package sizes: `npm view <pkg> dist.unpackedSize` on 2026-09-26.

```json
{
  "goalbuddy_receipt_v1": {
    "task": "T010",
    "type": "scout",
    "status": "done",
    "output": "docs/goals/milestone-1/notes/T010-api-precedent.md",
    "files_written": ["docs/goals/milestone-1/notes/T010-api-precedent.md"],
    "evidence": [
      "Type definitions read from npm pack of 22 packages (lightningcss 1.33.0, postcss 8.5.28, @tailwindcss/node 4.3.3, @tailwindcss/oxide 4.3.3, tailwindcss 4.3.3, @stylexjs/babel-plugin and unplugin 0.19.1, @vanilla-extract/integration 8.0.10, @pandacss/node 1.12.1, @lynx-js/css-defines 0.0.18, react-native-css 3.0.7, taffy-layout 3.0.0, yoga-layout 3.2.1, @mdn/browser-compat-data 8.1.3, web-features 3.40.0, @swc/core 1.16.2, unplugin 3.4.0, @vue/compiler-core and compiler-sfc 3.5.43, svelte 5.57.1, @builder.io/mitosis 0.14.0)",
      "Local probe: lightningcss 1.33.0 keeps 'width: 1foo' as an unparsed declaration with no warning even with errorRecovery; Declaration visitor nodes carry no location; thrown error shape {fileName, source, loc, data}",
      "Local read of yuku analyzer/parser/types and @tsrx/yuku d.ts: diagnostics {severity, message, help, start, end, labels} in UTF-8 byte offsets, no codes; @tsrx/yuku ships 2 platform bindings",
      "Web sources for adoption pain: Tailwind __unstable__loadDesignSystem dependents, npm/cli#4828 native bindings, StyleX 0.12 plugin deprecation, SWC Wasm ABI fix (1.15.0), Yoga top-level await, NativeWind v5 silent-style issues, Vite lightningcss stabilization"
    ],
    "unverified": [
      "Tailwind compile() thrown error shape",
      "Panda diagnostic shape",
      "Incident of shifted Vue numeric error codes",
      "Scale of the unified/@types/hast v3 ecosystem upgrade",
      "lightningcss Rule loc indexing (observed only, not documented)"
    ],
    "recommendations": {
      "compile": "Pure synchronous TypeScript compile(input, config) returning one frozen result with web(), swift(), properties(), explain() readers; optional incremental createCompiler; yuku only in a separate front-end entry",
      "diagnostics": "yuku-compatible superset: stable code, severity from support profile, UTF-16 span plus 1-based line/column, labels, help, structured fix, profileEntry, docs URL; no warning ever means dropped",
      "tree": "JSON schema 'dragon/tree@1': contextless children arrays, finite state enums with structured 'when' conditions, required spans on authored nodes, reserved 'data' slot, additions-only within a major"
    },
    "open_questions": ["tree-in vs source-in front ends", "numeric vs snake_case codes", "dynamic values in tree@1"],
    "scratch_outside_repo": "/tmp/t010 (npm pack tarballs and probe; not in the dragon repo)"
  }
}
```
