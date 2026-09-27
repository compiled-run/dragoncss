# T012: Integration surfaces, so app developers never think about Dragon (Scout)

Read-only research for T009 (the public API design). Inputs read: `README.md`, `AGENTS.md`, `goal.md` (design principles), `docs/research/T030-agent-guardrails.md`, `testing-plan.md`, `T016-styling-dx.md`, `notes/T007-dragon-dx-pitfalls.md`, `docs/why-not-stylex.md`, `packages/dragon/src/index.ts`. Web sources were all accessed 2026-09-26 and are listed at the end. **(unverified)** marks claims taken from search summaries or secondary pages rather than the primary page. Nothing below exists yet: every name, command and file is a proposal.

The owner's structural questions are referred to by these short labels:

| Label | Question |
|---|---|
| **Q-design** | Remove pitfalls by design instead of documenting them |
| **Q-analysis** | Semantic analysis decides platform choices |
| **Q-one** | Developers focus on one platform, and it just works on the other |
| **Q-agents** | Agents work with it as well as they do with StyleX |
| **Q-neutral** | Framework-neutral |
| **Q-native** | Compile straight to native properties |
| **Q-result** | One compiler result for web, native and test data |
| **Q-invisible** | App developers never have to think about Dragon |

Pitfall ids refer to `notes/T007-dragon-dx-pitfalls.md` (A1 to C10). "T006" refers to the ranked cross-platform pitfalls in `notes/T006-platform-pitfalls.md`.

## 0. Answer in plain words

- **App developers meet Dragon only through their framework.** The framework (Markless first) installs it, passes it the target list and shows its errors. Dragon ships no bundler plugin, no config file and no dev server that an app installs directly. Dragon's audience is framework authors. Its app-facing surfaces are the ones a framework cannot own well: the support query, the parity test helper, generated agent guidance and the native runtime package.
- **Targets live in one place and are checked on every compile.** The framework's config holds `targets: { web, ios: { minimum: '17.0' } }`. Dragon owns the schema and validates it. The integration creates one Dragon project object from that config, and every compile goes through it. No compile call takes a target argument, so no command can skip a target (T007 A1).
- **One compile returns everything, and errors withhold native output.** `project.compile(unit)` returns the web CSS, the native property list, generated Swift and diagnostics from one resolution. When a configured target has an error, that target's native output is absent from the result. It is not flagged with a warning the integration could forget to check. An integration cannot ship native code that has an error.
- **The editor, the terminal, the dev overlay and agents get the same diagnostic object.** Dragon exposes a small language-service API (diagnostics, per-target hover, quick fixes). Framework editor plugins, whether a TypeScript plugin, Volar or an LSP, call it. TypeScript's own docs confirm that editor plugins do not run under `tsc`, so the framework's check command must call `dragon check` as well. This is the surface that actually stops agents (T030 section 5).
- **The dev loop has two Dragon pieces.** A framework-neutral overlay (a custom element) shows per-target errors and native-preview toggles. A live parity layer runs Dragon's pinned Taffy build as WebAssembly on the page in view and outlines every box native would lay out differently. On the simulator, a debug-only applier reads property-list patches. Release builds use only the generated Swift.
- **Adopters prove their own components with one helper.** `dragon/test` produces parity cases per component per reachable state from the same analysis. It exposes no tolerance option, so a check cannot be loosened.
- **Agent guidance is generated, short and ends in "run the check".** Dragon writes one marker-fenced section into AGENTS.md from the project's targets and profiles. It also publishes llms.txt and per-target markdown tables, and offers an optional MCP server whose tools wrap the CLI.
- **Native pieces ship the way native developers expect.** iOS gets a Swift package: a binary Taffy XCFramework plus a small Swift source target, with the dev applier as a separate debug-only product. Android gets an AAR on Maven carrying `jni/<abi>/libtaffy.so`. The npm, Swift package and Maven versions are locked together, and `dragon check` fails on a mismatch.

## 1. Precedent

| System | What it shows | Lesson for Dragon |
|---|---|---|
| **Tailwind v4, Vite plugin** | Setup is two packages, `tailwindcss()` in `vite.config.ts` and `@import "tailwindcss"` in CSS. The docs never mention a config file. Configuration moved into CSS (`@theme`) for "one less file to worry about". Sources are detected automatically: `.gitignore` is respected, binaries are skipped, and `@source` adds exceptions. | Zero config is achievable when the defaults are right. Put per-project facts in the language the developer already writes (CSS) rather than a JS file. For Dragon, fonts and tokens stay in CSS (`@font-face`, custom properties on the root). Only the target list needs a home, because CSS cannot express "this app ships to iOS 17". |
| **Tailwind IntelliSense / `@tailwindcss/language-server`** | For v4 it scans for the root CSS file containing `@import "tailwindcss"`. When detection fails, users must set `tailwindCSS.experimental.configFile` (search summary; a DEV article reports this as a common v4 problem). Diagnostics are editor-only (T030). | Auto-detection that guesses wrong gets a settings escape hatch and a support thread. Dragon avoids guessing: the framework integration tells the editor service the project root and config, because the framework already knows them. |
| **StyleX `@stylexjs/unplugin`** | One package with adapters for Vite/Rollup, Webpack/Rspack, esbuild and Bun. It auto-discovers dependencies that use StyleX and excludes them from `optimizeDeps`. In dev it serves virtual modules (`virtual:stylex:runtime`, `/virtual:stylex.css`) and needs a manual `<link>` plus script injection in the HTML shell. Options include `devMode`, `useCSSLayers`, `externalPackages`, `importSources`. The Babel route has further options (`dev`, `test`, `runtimeInjection`, `treeshakeCompensation`, `unstable_moduleResolution`), plus a PostCSS route that replaces `@stylex;`. | Even the best-regarded setup leaks bundler details (HTML-shell injection, CORS notes, module-resolution options). Dragon should not own a bundler plugin: the framework already has one, and a second plugin doubles the ordering and HMR problems. Auto-discovering library packages is worth copying for `@markless/ui`-style libraries (T007 B4). |
| **NativeWind v4 setup** | Seven files to touch: `tailwind.config.js`, `global.css`, `babel.config.js` (JSX import source plus preset), `metro.config.js` (`withNativeWind`), `app.json` (`"bundler": "metro"`), `nativewind-env.d.ts`, and the CSS import in the app entry. T016 records the consequences: the verification helper "returns no errors or warnings" while styles are missing (#924), production-only breaks (#1481), and breaks after minor upgrades (#1169). | Every hand-edited setup file is a place for silent breakage. Dragon's setup must be zero files for the app, and the one wiring point must fail loudly when absent (section 3.2 `assertWired`). |
| **Expo config and prebuild (CNG)** | `app.json` is the source of truth. `npx expo prebuild` generates `ios/` and `android/`, "short-lived native projects are generated only when needed", and config plugins modify native projects at prebuild so "developers are responsible for only maintaining the definition of their customizations". | Generated native code must be regenerated on every build and never hand-edited. Dragon's generated Swift and Kotlin follow this model (section 8). A future Expo host could add Dragon's native package through a config plugin; that is out of scope here. |
| **Lynx / Rspeedy** | Rspeedy is "the build tool for Lynx", built on Rspack and Rsbuild, described as zero configuration. `pnpm create rspeedy` scaffolds a project. `pnpm dev` prints a QR code that the Lynx Explorer app scans for hot updates. A desktop DevTool connects to devices. `DEBUG=rspeedy` dumps intermediate artifacts. CSS behaviour has config switches (`enableCSSInheritance`, `customCSSInheritanceList`). Support facts live in `@lynx-js/css-defines`, which drives the engine, types, docs and an agent skill (T030). | "Scan to preview" and a device inspector are the bar for native dev loops. The CSS config switches are a warning: an inheritance toggle means the same CSS behaves differently per project. Dragon has no such switches; the compiler writes inherited text styles onto every text node (goal principle 3). A debug dump of intermediate results (`DEBUG=dragon`) is worth copying. |
| **TypeScript language-service plugins** | Configured in `tsconfig.json` `compilerOptions.plugins`. They decorate the language service (completions, diagnostics, quick info). They "aren't loaded during normal commandline typechecking or emitting, (so are not loaded by `tsc`)". | Editor diagnostics alone never reach CI or CLI agents. Every Dragon diagnostic shown in the editor must also fail a command-line check (section 3). Markless already has this split (`typescript-plugin` plus a `typecheck` wrapper, T030). |
| **Volar / vue-tsc / `@volar/kit`** | Volar powers the Vue, Astro and MDX language servers. `vue-tsc` wraps `tsc` so `.vue` files type-check on the command line. `@volar/kit` offers `createTypeScriptChecker()` for other embedded languages. Volar issue #145 asks for one shared CLI because each framework ships its own (`vue-tsc`, `@astrojs/check`). One write-up says the TypeScript Go port will not load third-party code into its server **(unverified)**. | Frameworks embedding CSS already run a language-service host. Dragon should be a library those hosts call, not another language server competing for the same files. Where tsserver plugins may stop working (the Go port), a Dragon API that is independent of tsserver survives. |
| **vscode-css-languageservice custom data** | JSON with `version`, `properties`, `atDirectives`, `pseudoClasses`, `pseudoElements`. Each entry has `name`, `description`, `browsers`, `baseline`, `status`, `references`, `relevance`. It loads through the `css.customData` setting or an extension's `contributes.css.customData`. | Good for hover text and completion ordering in plain `.css` files at no cost. It is global rather than per-target and cannot raise errors (T030), so it is a supplement, never the error channel. |
| **Biome / oxlint** | Biome lints CSS (`noUnknownProperty` and others) and plans cross-language rules, such as detecting CSS unused in JSX (2026 roadmap). Oxlint does not lint CSS; teams pair it with Stylelint. A third-party `oxlint-tailwindcss` plugin checks class names in markup (search summaries). | General linters cannot know per-target support or element ownership, so Dragon should not ship as a lint plugin. Dragon's check must coexist with them: stable codes, no overlap with `noUnknownProperty`, and machine-readable output. |
| **llms.txt** | A markdown file with an H1, a blockquote summary and H2 file lists of `[name](url): notes`, plus an "Optional" section. It suggests `.md` twins of pages. | Cheap to generate from the profiles. It is the lowest-enforcement surface (T030 rank 5), so it explains and points to the check; it never replaces the check. |
| **MCP for dev tools** | Servers expose tools (JSON Schema inputs; `tools/list`, `tools/call`), resources (URI templates) and prompts. The shadcn MCP browses and installs registry components. LogRocket (March 2026) reports that agents with the shadcn MCP produced correct components while agents without it invented props **(unverified)**. Storybook's `@storybook/addon-mcp` serves generated component manifests at `localhost:6006/mcp`. Its docs advise adding "ALWAYS call the storybook MCP server" to the system prompt, because agents do not always call it unprompted (search summary). | MCP helps with lookups ("can I use X on iOS?") only when the agent calls it. It must be a thin wrapper over the CLI, never the only path. Storybook's manifests show the design-system pattern: guidance generated from source data, served live, and kept in step with the code. |
| **Design-system agent guidance** | Storybook manifests are generated from stories and MDX and opt out per page. The shadcn registry and MCP carry component metadata. Lynx's `lynx-check-css-support` skill is generated from `css-defines` (T030). Vercel's eval found that an always-loaded compressed index in AGENTS.md beat an on-demand skill; Gloaguen et al. found that long context files add over 20% cost without raising success (T030). | Generate guidance from the data. Keep the always-loaded part short (targets, the selector rule, "run the check"), and put tables behind a query. |
| **SwiftPM binary targets** | `.binaryTarget(name:url:checksum:)` takes a zipped XCFramework with a SHA-256 from `swift package compute-checksum`. A local `binaryTarget(name:path:)` needs no checksum. Supported archive types are zip, tar.gz and tar. Release automation must rewrite the URL and checksum each version (mlx-swift issue #406 does this in CI). | Taffy ships as a prebuilt XCFramework, so app developers need no Rust toolchain. The Swift glue ships as source. Automate the checksum in the release job. |
| **Android AAR / Maven** | An AAR is a zip whose only required entry is `AndroidManifest.xml`. Optional entries include `classes.jar`, `res/`, `jni/<abi>/<name>.so` and `prefab/`. The recommended distribution is a Maven repository, whose metadata lets transitive dependencies be deduplicated. | Taffy's `.so` per ABI goes in the AAR's `jni/`. Kotlin helpers go in `classes.jar`. Publish to Maven Central. |
| **Taffy in WebAssembly** | Upstream Taffy lists WASM bindings on its roadmap (issue #345). Community packages exist: `taffy-layout` (ByteLandTechnology, v3.0.0 MIT per jsDelivr), `@taffyjs/wasm` and `@taffyjs/node` (napi-rs), and `yoga-layout-taffy` (search summaries, **unverified**). | Proof that the parity overlay is buildable. However, the parity claim requires the same Taffy revision as the XCFramework, so Dragon should build its own WASM from its pinned revision rather than depend on a community binding with a different pin. |

## 2. Configuration: where targets live

### Options

| Option | For | Against |
|---|---|---|
| **A. No config at all** (Tailwind v4 style: infer targets from installed packages, for example "an iOS app folder exists, so iOS is a target") | Nothing for the developer to write. | Inference can be wrong in both directions, and a wrong guess is exactly T007 A1: a target that silently is not checked. Minimum OS versions select profile rows (T007 B6) and cannot be inferred safely. |
| **B. A `dragon.config.ts` in the app** | Framework-neutral, and one obvious file. | The developer now thinks about Dragon (fails Q-invisible). Two files (framework config plus Dragon config) can disagree about the target list. This is the NativeWind many-files trap in miniature. |
| **C. The framework's config holds the targets; Dragon owns the schema and validation** | One file the developer already has. The framework also needs the target list anyway (it builds the iOS app). One schema and one validator for every framework. | Each framework must forward the config, so Dragon needs a conformance test for integrations (section 3.2). |

**Recommendation: C, plus B only for projects without a framework** (for example Dragon's own fixtures, or a design-system package tested with plain HTML and CSS). In that case `dragon.config.ts` uses the same `defineTargets` and the same schema.

### Pseudocode

```ts
// dragon (exported): the one schema every integration uses
export type TargetsConfig = {
  web?: { browsers?: 'baseline-widely-available' | string };   // web profile floor
  ios?: { minimum: `${number}.${number}` };                      // selects profile rows
  android?: { minimumSdk: number };
};
export function defineTargets(t: TargetsConfig): TargetsConfig;  // identity + validation, typed

// Created once per build or dev session. Every compile goes through it.
export function createProject(options: {
  root: string;
  targets: TargetsConfig;            // required; an empty object is an error, not "web only"
  framework: { name: string; version: string };   // stamped into diagnostics and reports
}): DragonProject;

// There is deliberately no per-call target option:
project.compile(unit);              // checks and emits every configured target
```

```ts
// markless.config.ts: what the app developer sees (framework-owned file)
export default {
  targets: { web: {}, ios: { minimum: '17.0' } },   // scaffolded with web + ios (T007 A1)
};
```

Fonts, tokens, dark mode and direction stay in CSS (`@font-face`, root custom properties, `color-scheme`, `dir`), following Tailwind v4's CSS-first lesson and goal principles 5 and 6. The only project facts outside CSS are the targets and their minimum OS versions.

**Serves:** Q-invisible (no new file), Q-one (every configured target is checked while the developer works on one), Q-neutral (one schema across frameworks), Q-design.
**Removes:** T007 A1 (native errors only when someone builds for the phone), B6 (the minimum OS selects rows; changing it is a checked change), and two-config drift (NativeWind-style).

## 3. The split: what the framework integration owns and what Dragon owns

### 3.1 Table

| Concern | Framework integration owns | Dragon owns |
|---|---|---|
| Reading the app's source | Parsing templates; building the element tree, or handing source to a Dragon front end built on yuku (T011 decides) | The tree schema and validation, and the semantic resolution of states, classes and conditions |
| Target list | Storing it in the framework's config; passing it to `createProject` | The schema, validation, profile selection and minimum-OS rows |
| Module graph, watching, bundling | All of it (Vite, Rolldown, Metro, Rspack...) | Nothing. Dragon is a library the framework's plugin calls; there is no `dragon/vite` |
| Compilation | Calling `project.compile(unit)` per component and placing the outputs | Cascade, value resolution, UA defaults, web CSS, property list, Swift/Kotlin, diagnostics |
| Diagnostics | Delivering them to terminal, editor, overlay and check command; never rewording them | Codes, messages, fixes (as text edits), spans, severity, the profile row cited |
| HMR transport | Websocket/HMR channel, module invalidation | The update payload: CSS patch, property-list patch, node ids to rebuild |
| Dev overlay host | Injecting `<dragon-overlay>` in dev HTML; forwarding diagnostics | The overlay element, native-preview toggles, the parity layer |
| Type check | Its check command (`markless typecheck`) calls `project.check()` and fails on errors | `check()` returning the same diagnostics as `compile` |
| Editor | Its TS plugin / Volar service / LSP calls `dragon/language-service` | Diagnostics, hover per target, completions, code fixes |
| Scaffolding | `create-<framework>` writes the target list, reset CSS, document component | The reset CSS content, the AGENTS.md section generator, `dragon init` for plain projects |
| Tests | Runs its own component suite in its own runner | `dragon/test`: generated parity cases, lanes, report format |
| Native app | Its native host app and build scripts | The runtime packages (SPM, Maven), generated code, the dev applier |

### 3.2 Making a wrong integration impossible (or at least loud)

The split only works if a half-wired integration fails loudly. NativeWind's "verification helper returns no errors" while styles are missing (#924) is the failure to avoid.

```ts
// dragon: the result type carries native output only when that target is clean
type CompileResult = {
  diagnostics: readonly Diagnostic[];
  web: { css: string; nodeIds: NodeIdMap };           // always present (browser still renders)
  targets: {
    [T in NativeTarget]?:
      | { ok: true; properties: PropertyList; code: GeneratedSource }
      | { ok: false; blockedBy: readonly Diagnostic[] };  // no code to ship by accident
  };
};

// dragon/integration-test: a conformance suite each framework runs in its own CI
import { integrationConformance } from 'dragon/integration-test';
integrationConformance({
  compileFixture: (fixture) => myFramework.build(fixture),   // adapter the framework writes
  checkCommand: 'pnpm markless typecheck',
});
// asserts: every configured target checked; an ios-only error fails the check command;
// diagnostics text is unmodified; overlay receives them; node ids reach the DOM in dev.
```

**Serves:** Q-neutral (Dragon never assumes a bundler), Q-invisible (the framework hides wiring), Q-result (one result object), Q-design (native output of a failing target cannot exist).
**Removes:** T007 A1, C10 (different answers in different places, because all channels carry the same object), NativeWind-style silent setup failures, and the StyleX-style HTML-shell injection step (the framework does it).

Owner-relevant caveat: Dragon having no bundler plugin means a framework-less Vite app cannot use Dragon directly. That is consistent with "Dragon's input is plain CSS plus an element tree" (README). A generic adapter can come later if a real adopter needs one.

## 4. CLI commands

The CLI is for checks, lookups and tests. It never builds apps; the framework does. Every command has `--json`, and the human output is rendered from the JSON so the two cannot differ (the same rule as the testing plan's `report.json`).

| Command | What it does | Exit code |
|---|---|---|
| `dragon check [paths]` | Compiles through the project and prints every configured target's diagnostics. Frameworks call the same function inside their own check. | 1 on any error for any configured target |
| `dragon support <target\|all> "<css>"` | The support query: status, message, fix, docs, the proving test ids, profile version (T030 4.3) | 0; 1 if unsupported (usable in scripts) |
| `dragon explain <CODE>` | The long explanation for a diagnostic code, generated from profile data | 0 |
| `dragon parity [--component X] [--lane taffy\|ios]` | Runs generated parity cases for the app's own components (section 7) | 1 on any mismatch |
| `dragon init` | Detects the framework from `package.json`. If a known framework is present, it prints that framework's one-line setup and exits, because the framework owns wiring. Otherwise it writes `dragon.config.ts`. In both cases it writes or updates the AGENTS.md section (section 8). | 0 |
| `dragon escapes` | Lists every `@supports`, `@media (os:)` and target guard with file and line (T007 B5) | 0 |
| `dragon upgrade --check <version>` | Compiles against a newer profile and prints what would change (T007 B6) | 1 if new errors |

```text
$ npx dragon support ios "position: fixed"
unsupported  ios profile 1.0.0-alpha.3 (minimum 17.0)
  position: fixed is not supported on ios outside an overlay part.
  fix: use an overlay family (popover, dialog, drawer) to show content above the page.
  docs: https://<dragon-site>/targets/ios#position-fixed
  proof: ios/position/fixed-rejected (passing)
```

```ts
// the CLI is a thin shell over exported functions; MCP (section 8) wraps the same functions
export function querySupport(target: Target | 'all', css: string, project?: DragonProject): SupportAnswer;
export function explain(code: DiagnosticCode): Explanation;
```

**Serves:** Q-agents (every agent with a shell can run it; T030 evidence ranks failing checks first), Q-one, Q-design.
**Removes:** T007 A1 (`check` covers configured targets), B5 (escapes are listed), B6 (upgrade preview), C9 (`check` groups errors by feature with a readiness count, never downgraded to warnings), and "unknown equals supported" (the query fails closed).

## 5. The editor story

Two channels, both fed by the same profile data and the same diagnostic objects.

1. **Diagnostics, hover, quick fixes: `dragon/language-service`.** A library, not a server. The framework's existing editor host calls it: the Markless TypeScript plugin, a Volar service plugin, or a framework LSP. It never runs a second language server over the same file.
2. **Plain `.css` files: generated custom data.** For hover and completion ordering only, Dragon writes `.dragon/css-data.json` (the `version`, `properties`, `atDirectives`, `pseudoClasses` format), with one hover line per configured target and `relevance` raised for cross-target-safe values. A tiny VS Code extension, or the framework's extension, contributes it through `contributes.css.customData`. Errors in plain `.css` files come from `dragon check` and the framework's plugin, not from custom data, which cannot error per target.

```ts
// dragon/language-service
export function createLanguageService(project: DragonProject): {
  diagnostics(file: string, text: string): Diagnostic[];          // same objects as compile()
  hover(file: string, offset: number): {
    declaration: string;                                          // "position: fixed"
    perTarget: Array<{ target: Target; status: SupportStatus; line: string }>;
  } | null;
  completions(file: string, offset: number): Completion[];       // ordered: safe on every target first
  codeFixes(diagnostic: Diagnostic): TextEdit[][];                // the diagnostic's fix, as edits
  update(file: string, text: string): void;                       // incremental; no file watching inside
};

// inside a framework's TS plugin (sketch)
getSemanticDiagnostics(fileName) {
  const base = inner.getSemanticDiagnostics(fileName);
  return [...base, ...dragon.diagnostics(fileName, read(fileName)).map(toTsDiagnostic)];
}
```

Hover output, generated from the profiles:

```text
position: fixed
  web  exact
  ios  unsupported outside an overlay part: use popover, dialog or drawer
       (ios profile 1.0.0-alpha.3, minimum 17.0)
```

Design rules:
- The hover shows only configured targets. An app without Android never sees Android lines (Q-invisible).
- Quick fixes are the same text as the diagnostic's `fix:` line, expressed as edits, so people, IDE agents and CLI agents apply the same change (T007 A7).
- Selector-ownership errors are computed from the file where possible (T007 A7: scoped styles are proven locally), so the editor can answer without the whole app. Only unscoped CSS waits for the project-wide pass, and that error names both files.
- The API is independent of tsserver. If the TypeScript Go port stops loading plugins (unverified), frameworks move the same calls to their LSP.

**Serves:** Q-one (native errors visible while writing web), Q-agents (IDE agents see squiggles; the same fixes reach CLI agents), Q-neutral (a library for any host), Q-result.
**Removes:** T007 A1, A7 (errors that move between files, and fixes that differ by channel), C10, and the Tailwind "IntelliSense guessed the wrong root" class of problem (the framework passes the project).

## 6. Dev overlay and hot reload

### 6.1 Update payload

```ts
// dragon/dev
export function createDevSession(project: DragonProject): {
  update(unit: SourceUnit): DevUpdate;        // called by the framework's watcher
};

type DevUpdate = {
  diagnostics: Diagnostic[];                  // every configured target
  web: { cssPatch: CssPatch };                // restyle in place, keep state (T016 3.10)
  native: {
    [T in NativeTarget]?: {
      propertyPatch: PropertyListPatch;       // for the debug applier
      rebuildNodes: NodeId[];                 // box structure changed: text runs, display flip
    }
  };
  parity: ParityInput;                        // property list + node ids for the overlay's Taffy run
};
```

The framework sends `DevUpdate` over its own HMR channel (Vite's HMR API, Metro's, or any other). Dragon never opens a socket in the web dev server.

### 6.2 The overlay element

`<dragon-overlay>` is a custom element with shadow DOM, so it is framework-neutral and its CSS cannot leak into the page. The framework injects it only in dev when a native target is configured.

- **Errors per target**, grouped by feature ("`display: grid` in 14 places is not proven on ios yet"), with a readiness count ("ios: 187 of 214 rules ready", T007 C9). The page still renders; the build does not stop in the browser.
- **Native preview toggles**, applied together: `hover: none` and `pointer: coarse` emulation, safe-area insets with a device frame, text size (root font scaled by the target's ratios), dark mode and `dir="rtl"` (T007 section 2 item 4, T016 3.10).
- **Live parity layer** (the owner's idea): see 6.3.

### 6.3 Live parity overlay: Taffy as WebAssembly in the dev server

```ts
// inside <dragon-overlay>, lazy-loaded only when the parity layer is switched on
const taffy = await import('dragon/dev/taffy.wasm');            // built from Dragon's pinned Taffy revision
const chrome = captureBoxes(document, '[data-dragon-id]');      // border boxes per node id
const native = taffy.layout(parity.propertyList, {
  viewport: currentDeviceFrame(),
  measureText: (nodeId, width) => browserTextMetrics(nodeId, width),  // isolates mapping bugs from font noise
});
for (const d of diffBoxes(chrome, native, { tolerance: '1 device pixel' })) {
  outline(d.nodeId, { reason: d.likelyCause, rule: d.sourceRule }); // "flex-shrink default differs: rule card.tsrx:12"
}
```

- It needs `data-dragon-id` on every element in dev builds. The framework emits these from the node-id map in `CompileResult.web.nodeIds`, which the testing plan already requires for the simulator lane.
- It uses the **same WASM build** as the Linux test lane, so "the overlay is clean" and "the lane passes" mean the same thing. Do not depend on a community Taffy binding with a different pin.
- Text is measured by the browser, so only CSS-to-native mapping differences light up. Font differences are shown in a separate, dimmer style (T007 B1).
- It runs in both directions: the terminal reports the same diffs for a developer who works simulator-first (T007 C8).
- Cost is not measured: the WASM size and layout time on a large page are open (T007 missing evidence). Lazy loading keeps it out of the default dev page.

### 6.4 Simulator hot reload

```swift
// DragonDevApplier: a separate SPM product, linked only in Debug
DevApplier.connect(to: devServerURL)   // receives PropertyListPatch; applies by node id
// Release links only DragonRuntime plus the generated Swift. No style data is parsed on device.
```

A guard keeps the two paths equal: Dragon's simulator lane dumps the applied properties from both the dev applier and the generated Swift for every fixture and requires them to be identical (T007 A6).

**Serves:** Q-one (the browser preview is honest about native), Q-result (overlay, lane and device read one property list), Q-native (release is generated Swift only), Q-analysis (rebuild decisions come from the analysis).
**Removes:** T007 A1, A2 (unauthored-default differences outlined live), A5 and C5 (safe areas and hover previewed on web), A6 (hot reload without a Swift rebuild), B1 (text differences separated), B3 (RTL toggle), C8 (reverse direction), C9 (grouped errors). T006's flex-default differences are made visible before anyone opens a simulator.

## 7. The testing helper adopters use

Adopters (framework authors and app teams) prove their own components with the same machinery Dragon uses to prove its profile rows. The helper generates cases; it does not ask the adopter to write fixtures.

```ts
// dragon/test: runner-neutral core
export function parityCases(project: DragonProject, options?: {
  components?: string | string[];         // glob or names; default: all components
  lanes?: Array<'taffy' | 'ios' | 'android'>;   // default: 'taffy' (runs on Linux, no simulator)
}): ParityCase[];

type ParityCase = {
  name: string;                           // "Card / pressed / dark / text-xxl / rtl"
  component: string;
  state: StateAssignment;                 // generated from the analysis: every reachable state
  environment: { colorScheme: 'light' | 'dark'; textSize: TextSize; dir: 'ltr' | 'rtl'; viewport: Size };
  run(): Promise<ParityReport>;           // report shape = testing-plan section 4.1
};
// No tolerance option exists. Tolerances come from Dragon and change only with owner approval.
```

```ts
// adopter's test file (Vitest shown; any runner works)
import { parityCases } from 'dragon/test';
import { project } from './dragon-project';     // the framework exports this; one line for the app

for (const c of parityCases(project)) {
  test(c.name, async () => {
    const report = await c.run();
    expect(report.failures).toEqual([]);         // failures carry node, property, both values, likely cause
  });
}
```

- **The state set comes from the analysis** (goal principle 2): each component's finite classes from state, `ui-*` attributes, pressed, dark mode, width queries, plus the largest text size and right-to-left. An adopter cannot forget a state, and there is no untested state.
- **The Chrome side renders Dragon's own web output** (goal principle 4), so the test compares like with like.
- **Lanes are selectable, not skippable.** When a lane cannot run on the host (iOS on Linux), the case fails with "lane unavailable on this machine". It never passes silently. Frameworks choose which lanes their CI requires.
- The same cases back `dragon parity` (section 4), and the same report format feeds the side-by-side HTML.

**Serves:** Q-one (the other platform is proven by tests, not by opening it), Q-result (test data comes from the same compile), Q-analysis, Q-agents (a failing test with a located failure is the strongest agent signal).
**Removes:** untested states, loosened tolerances, "works in dev, breaks in release" drift (T006; covered because the lane uses the release property list), T007 A2 (unstyled defaults get covered when components have unstyled parts), and B7 in part (performance fixtures are Dragon's job, not the adopter's).

## 8. Generated agent guidance

Evidence from T030: a failing check the agent is told to run stops it; prose only tells it what to try. So every surface below ends in "run the check".

### 8.1 AGENTS.md section (always loaded, short)

`dragon init`, or the framework's scaffold through `dragon.agentGuidance(project)`, writes a marker-fenced section. It is regenerated when targets or profiles change. A drift check fails CI when the committed text differs from the generated text.

```markdown
<!-- dragon:begin (generated from targets web, ios 17.0 and profile 1.0.0-alpha.3; do not edit) -->
## Styles for web and iOS
- Write normal CSS. A selector may test only its own element, parents in the same
  component, and app-wide conditions (media queries, dark mode).
- Before finishing, run `pnpm typecheck`. A style error for any target fails it and
  cannot be silenced; change the CSS as the error's `fix:` line says.
- To check a declaration first: `npx dragon support ios "<css>"`.
- Not available on iOS yet (most common first): `:has()`, `+`/`~`, `position: fixed`
  outside overlays, `transition: all`.
<!-- dragon:end -->
```

The "not available" list is capped at about eight entries, ranked by frequency in the T017 corpus. Frameworks with a managed skill (Markless) put the same generated text there instead, following their own policy on project files.

### 8.2 llms.txt and markdown tables (for agents that browse)

```ts
export function generateLlmsTxt(profiles: Profile[]): string;
// # Dragon CSS
// > Regular CSS compiled to native views; every supported feature proven against Chrome.
// ## Targets
// - [iOS support table](https://<dragon-site>/targets/ios.md): status, fix and proving test per feature
// ## Optional
// - [Diagnostic codes](https://<dragon-site>/codes.md)
```

### 8.3 MCP server (optional, thin)

```ts
// `dragon mcp` (stdio). Every tool calls the same function as the CLI.
tools: {
  support:  { input: { target: 'ios' | 'android' | 'web' | 'all', css: string } }, // querySupport
  explain:  { input: { code: string } },                                          // explain
  check:    { input: { paths?: string[] } },                                      // project.check
}
resources: { 'dragon://targets/{target}': 'the support table as markdown' }
```

Storybook's docs show agents often do not call an MCP unprompted, so the AGENTS.md section names the CLI command. MCP is a convenience, not a guardrail.

### 8.4 How agents get StyleX-level reliability

StyleX works well for agents because styles are local, merging is predictable and errors are immediate. Dragon's integration surfaces deliver the same three: local selector ownership proven per file (section 5), a warning on conflicts decided only by specificity (goal.md), and typed diagnostics with a `fix` as text edits in every channel. Whether an optional typed-object input helps further is T005's measurement, not an integration choice.

**Serves:** Q-agents, Q-invisible (guidance is generated, not written by the developer), Q-design (guidance points at the check, which is the enforcement).
**Removes:** stale guidance (drift check), agents trusting prose over the check, T007 B5 (guidance says a guard needs the other platform's alternative), and C10.

## 9. Native packaging

### 9.1 iOS: Swift package

```swift
// Package.swift of dragon-swift (tag == npm version)
let package = Package(
  name: "Dragon",
  platforms: [.iOS(.v17)],
  products: [
    .library(name: "DragonRuntime", targets: ["DragonRuntime"]),
    .library(name: "DragonDevApplier", targets: ["DragonDevApplier"]),   // Debug only
  ],
  targets: [
    .binaryTarget(name: "Taffy",
                  url: "https://github.com/<org>/dragon/releases/download/1.0.0-alpha.3/Taffy.xcframework.zip",
                  checksum: "<swift package compute-checksum, written by the release job>"),
    .target(name: "DragonRuntime", dependencies: ["Taffy"]),   // dynamic colour, font metrics, safe area, layout bridge
    .target(name: "DragonDevApplier", dependencies: ["DragonRuntime"]),
  ]
)
```

### 9.2 Android: AAR on Maven

`run.compiled:dragon-runtime:<version>` (group id is a placeholder) contains `classes.jar` (the Kotlin runtime helpers) and `jni/{arm64-v8a,armeabi-v7a,x86_64}/libtaffy.so`. A separate `dragon-dev-applier` artifact is declared as `debugImplementation`.

### 9.3 Generated code: regenerate every build (the Expo CNG lesson)

- The framework's native build step calls `project.emitNative(target, outDir)`. It writes `Generated/Dragon/<Component>.swift` plus a `manifest.json` (Dragon version, profile version, input hash).
- Generated files are never hand-edited. They are regenerated on each build and may be git-ignored; the framework chooses.
- Version lock: the generated code embeds the Dragon version. `DragonRuntime` checks it at launch in Debug, and `dragon check` compares `package.json`, `Package.resolved` and the Gradle lock, failing on a mismatch.

```ts
export function emitNative(project: DragonProject, target: NativeTarget, outDir: string): {
  files: string[];
  manifest: { dragon: string; profile: string; inputHash: string };
};
```

**Serves:** Q-native (generated code sets properties; Taffy is the only on-device library), Q-result (the generated code comes from the same compile as the property list and web CSS), Q-invisible (standard SPM and Gradle dependencies; no Rust toolchain for app developers), Q-design.
**Removes:** version skew between compiler and runtime (the NativeWind "broke after a minor upgrade" class, T016 #1169), hand-edited generated code drifting (Expo's CNG rationale), a dev applier leaking into release (separate product, debug-only), and T007 B6 (lockfile-pinned profile).

## 10. What the app developer touches, end to end

1. `create-markless`: targets `web` and `ios` are already in the config; the reset CSS and document component are scaffolded; the AGENTS.md section is written.
2. They write CSS in components. Editor squiggles and hovers show both targets.
3. `pnpm dev`: the browser opens with the overlay and parity layer. The simulator, if running, hot-reloads through the dev applier.
4. `pnpm typecheck`, which also runs in CI, fails on any target's error.
5. Optional: they add the parity test file (section 7) to prove their own components.

The word "Dragon" appears only in error codes, the overlay title, the AGENTS.md section and the native dependency added by the scaffold.

## 11. Owner decisions

I am asking for four choices. I recommend the first option in each.

**Where the target list lives:** in the framework's own config, with Dragon supplying the schema, because a second config file is one more thing to think about and can disagree with the first. A `dragon.config.ts` exists only for projects with no framework.

**Whether Dragon ships its own bundler plugin:** no, frameworks call Dragon as a library, because every framework already has a plugin and a second one doubles the ordering and hot-reload problems. A generic adapter can follow when a real framework-less adopter asks.

**Whether the parity overlay is in the first dev release:** yes, as an opt-in toggle, because it is the main way a web-only developer knows the phone is fine without opening a simulator. Its WebAssembly size and speed still need measuring before it becomes on by default.

**Whether the MCP server ships in the first release:** no, ship the CLI query and the AGENTS.md section first, because the evidence says agents act on checks and short always-loaded rules, and often do not call MCP tools unprompted.

Researched defaults (no decision needed; details above): no per-call target option; native output absent when a target has errors; one diagnostic object in every channel; custom data for plain `.css` hover only; a runner-neutral test helper with no tolerance option; generated native code regenerated each build; npm, Swift package and Maven versions locked together.

## 12. Gaps and unverified points

- Taffy WASM size and per-page layout time in a dev server are not measured.
- The claim about TypeScript Go port plugin support comes from a secondary write-up and is unverified.
- Tailwind v4 IntelliSense root-detection failures come from a DEV article summary and are unverified.
- The shadcn MCP accuracy result (LogRocket) and Storybook's "agents don't always call it" advice come from search summaries.
- Community Taffy WASM package facts (versions, licences) come from search summaries.
- Lynx Rspeedy config specifics beyond `llms.txt` (the config file name, `defineConfig`) were not read on the primary page.
- The Apple binary-framework documentation page did not render; the SwiftPM facts come from WWDC20 session 10147 via search and from secondary guides.
- Whether an SPM build-tool plugin could run the Dragon emitter (Node) inside Xcode was not researched. The proposal keeps emission in the framework's build step instead.

## Sources (all accessed 2026-09-26)

- Tailwind v4 Vite install: https://tailwindcss.com/docs/installation/using-vite
- Tailwind v4 announcement (CSS-first config, detection, Vite plugin): https://tailwindcss.com/blog/tailwindcss-v4
- Tailwind IntelliSense: https://github.com/tailwindlabs/tailwindcss-intellisense ; editor setup: https://tailwindcss.com/docs/editor-setup ; v4 detection problems (unverified): https://dev.to/mrpaulishaili/vscode-intellisense-broken-in-tailwind-css-v4-heres-the-solution-4d5
- StyleX installation: https://stylexjs.com/docs/learn/installation/ ; unplugin README: https://github.com/facebook/stylex/blob/main/packages/%40stylexjs/unplugin/README.md
- NativeWind installation (v4.2.7): https://www.nativewind.dev/docs/getting-started/installation ; issues cited through T016 (#924, #1481, #1169)
- Expo CNG: https://docs.expo.dev/workflow/continuous-native-generation/
- Lynx Rspeedy: https://lynxjs.org/rspeedy/ ; https://lynxjs.org/llms.txt
- TypeScript language-service plugins: https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin
- Volar: https://volarjs.dev/ ; vue-tsc: https://github.com/vuejs/language-tools/tree/master/packages/tsc ; @volar/kit: https://www.npmjs.com/package/@volar/kit ; shared CLI issue: https://github.com/volarjs/volar.js/issues/145 ; tsgo write-up (unverified): https://www.elecmonkey.com/en/blog/vue-tsc-runtime-patch-hack
- CSS custom data: https://github.com/microsoft/vscode-css-languageservice/blob/main/docs/customData.md
- Biome CSS rules: https://biomejs.dev/linter/css/rules/ ; roadmap: https://biomejs.dev/blog/roadmap-2026/ ; oxlint: https://oxc.rs/docs/guide/usage/linter ; oxlint-tailwindcss (unverified): https://sergioazocar.com/en/blog/oxlint-tailwindcss-the-linting-plugin-tailwind-v4-needed/
- llms.txt: https://llmstxt.org/
- MCP server concepts: https://modelcontextprotocol.io/docs/learn/server-concepts
- shadcn MCP: https://ui.shadcn.com/docs/mcp ; LogRocket (unverified): https://blog.logrocket.com/ai-shadcn-components/
- Storybook MCP and manifests: https://storybook.js.org/docs/ai/mcp/overview ; https://storybook.js.org/docs/ai/manifests
- SwiftPM binary targets: WWDC20 session 10147 https://developer.apple.com/videos/play/wwdc2020/10147/ ; https://www.avanderlee.com/swift/binary-targets-swift-package-manager/ ; https://github.com/ml-explore/mlx-swift/issues/406 ; https://github.com/swiftlang/swift-package-manager/issues/9219
- Android AAR: https://developer.android.com/studio/projects/android-library
- Taffy WASM: https://github.com/DioxusLabs/taffy/issues/345 ; https://github.com/ByteLandTechnology/taffy-layout ; https://github.com/hyfdev/taffyjs (unverified details)
- Repo-internal: T030 section 5 evidence ranking (Vercel AGENTS.md eval, Gloaguen et al., Mündler et al.)

```json
{
  "goalbuddy_receipt_v1": {
    "result": "done",
    "task_id": "T012",
    "board_path": "docs/goals/milestone-1/state.yaml",
    "decision": null,
    "full_outcome_complete": false,
    "rationale": "Integration design with precedent and pseudocode. Targets live in the framework's config with a Dragon-owned schema; createProject is built once and compile() takes no target argument, so every configured target is checked on every compile. The result withholds native output for any target with errors. Dragon is a library (no bundler plugin): the framework owns graph, HMR transport, overlay host and check command; Dragon owns resolution, diagnostics, web CSS, property list, generated Swift, the language-service API, the overlay element, the parity layer (Taffy WASM from the pinned revision), the dev applier, the test helper and agent guidance. CLI: check, support, explain, parity, init, escapes, upgrade --check, all with --json. Editor: a language-service library called by TS plugin, Volar or LSP, plus custom data for plain-CSS hover. The TS plugin limitation (not loaded by tsc) makes the check command mandatory. Test helper: runner-neutral parityCases generated per reachable state with no tolerance option. Agent guidance: a generated, marker-fenced AGENTS.md section ending in 'run typecheck', llms.txt and an optional thin MCP. Native: an SPM package with a Taffy XCFramework binaryTarget and a debug-only applier product, an AAR with jni .so per ABI, generated code regenerated each build (Expo CNG lesson), versions locked across npm, SPM and Maven. Four owner decisions flagged.",
    "worker_package": null,
    "evidence": [
      "docs/goals/milestone-1/notes/T012-api-integration.md",
      "docs/goals/milestone-1/notes/T007-dragon-dx-pitfalls.md (A1-C10 mapping)",
      "docs/research/T030-agent-guardrails.md section 5 (surface ranking)",
      "docs/research/testing-plan.md sections 2, 4.1, 7",
      "docs/research/T016-styling-dx.md 3.8, 3.10",
      "Primary pages fetched 2026-09-26: Tailwind v4 install and blog, StyleX install and unplugin README, NativeWind install, Expo CNG, TS LS plugin wiki, Volar home, vscode-css-languageservice customData, llmstxt.org, MCP server concepts, Android AAR docs, lynxjs.org/llms.txt"
    ],
    "subgoal_contract": null,
    "parallel_safety": null,
    "blocked_tasks": [],
    "missing_evidence": [
      "Taffy WASM size and dev-page layout time not measured",
      "TypeScript Go port plugin policy unverified",
      "Tailwind v4 IntelliSense detection failures, shadcn MCP accuracy, Storybook MCP invocation advice and community Taffy WASM details are from search summaries",
      "Apple binary-framework doc page did not render; SwiftPM facts from WWDC20 via search and secondary guides",
      "SPM build-tool plugin running a Node emitter not researched"
    ],
    "required_board_updates": [
      "Record T012 done with evidence notes/T012-api-integration.md",
      "T009 inputs: sections 2 to 9 pseudocode (createProject/defineTargets, CompileResult with blockedBy, language-service, dev session, parityCases, agentGuidance, emitNative) and the section 3.1 ownership table",
      "Batch owner decisions: targets in framework config; no Dragon bundler plugin; parity overlay opt-in in first dev release; MCP deferred",
      "T013 critique should check that no API takes a per-call target or tolerance option"
    ]
  }
}
```
