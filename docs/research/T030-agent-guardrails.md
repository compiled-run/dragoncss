# T030: Stopping CSS that does not work on a target (Scout)

Owner concern, 2026-09-26: "it would really be a shame if agents add CSS that just doesn't work" once one `<style>` block compiles to web, iOS, Android and email.

Inputs read: T030 card, T018-styling-design.md section 4 (diagnostics), T025-styling-direction.md. Repo (read-only): `packages/compiler/src/diagnostics.ts`, `packages/compiler/src/type-service.ts`, `packages/typescript-plugin/src/{index,tsc,typecheck}.ts`, `packages/bundler/src/{transform,link-driver}.ts` and `dev-error/index.ts`, `.ruler/ruler.toml`, `packages/cli/src/agents.ts`, `packages/cli/templates/common/**`, `packages/core/agent/markless.md`, `website/public/llms.txt`. External sources are listed at the end, all accessed 2026-09-26.

## 1. Answer in plain words

- **One data file per target decides everything.** For each target (web, ios, android, email) Markless ships one support profile: for every CSS property, value, unit, function, selector feature and at-rule it says `exact`, `caveat`, `approx`, `unsupported` or `no-effect`, with a message, a fix, a docs link and the conformance test ids that prove the claim. The compiler checker, the editor, the docs tables, the agent guidance and the conformance suite all read that file. Nothing restates it.
- **Anything missing from a native profile is `unsupported`.** Fail closed. Lynx's own data warns that "no compat data" means "unspecified", not "supported"; Markless should turn that gap into an error, which T025 already requires ("any value outside the supported table" is a native build error).
- **A profile entry cannot claim support without a test.** Every entry that is not `unsupported` must name at least one conformance test, and CI fails when a named test is missing or red. This keeps the table honest; it is the missing step in every precedent below.
- **What actually stops agents is a failing check they already run, not prose.** The evidence ranks surfaces in this order: build and typecheck errors in a command the agent is told to run, then editor diagnostics, then a short always-loaded rule plus pointer, then on-demand lookups (skill, CLI query, MCP), then llms.txt and docs pages. Section 5 gives the evidence.
- **Repo gap found:** today the TypeScript plugin puts only *parse* failures into the editor (`packages/typescript-plugin/src/index.ts:107-137`, code `MARKLESS_TSRX_PARSE_ERROR_CODE`). Semantic `CompilerDiagnostic`s reach the bundler and the dev error overlay (`packages/bundler/src/transform.ts`, `link-driver.ts`, `dev-error/index.ts`), and the `typecheck` wrapper fails on Markless compile errors (`packages/typescript-plugin/src/tsc.ts:40-60`). A CSS target error therefore needs a new path into the editor; it will not appear there for free.

## 2. Precedent

| System | Data shape | How it reaches the author | Lesson for Markless |
|---|---|---|---|
| MDN browser-compat-data (BCD) | Tree keyed `css.properties.<prop>.<value>`; each node has `__compat.support.<browser>` with `version_added`, `version_removed`, `partial_implementation`, `prefix`, `alternative_name`, `flags`, `notes`, plus `status` (`standard_track`, `deprecated`) and `spec_url`/`mdn_url`. | Consumed by MDN tables, caniuse, linters, editors. | Key by property then value; keep "partial" as its own state with a note; carry a docs link per node. Markless adds what BCD lacks: a fix and a test id. |
| caniuse | Per feature, `stats[browser][version]` letters `y`, `a` (partial), `n`, `p` (polyfill), `u` (unknown), `x` (prefix), `d` (disabled), `#n` pointing into `notes_by_num`. | caniuse.com, doiuse, Browserslist-driven tools. | "Unknown" is a separate state; notes are numbered and attached to a status. Markless should treat unknown as unsupported on native. |
| Baseline / web-features | Catalogue of named features mapped to BCD keys; status `baseline` high / low / false with `baseline_low_date` / `baseline_high_date`; high = keystone date at least 30 months old, relative to a core browser set (Chrome, Edge, Firefox, Safari incl. mobile). | MDN banners, caniuse, VS Code hover, linters. | The web profile does not need hand-written support data: derive it from web-features/BCD and the app's configured browser floor. |
| eslint-plugin-compat | Browserslist targets plus compat data; `polyfills` setting whitelists APIs; feature-detection code is exempt by default. | ESLint diagnostic in editor and CI. | An explicit escape for "I handle this" (polyfill list, `@supports` guard). Markless's equivalent is a false `@supports` branch being removed before checks (T018 section 4). |
| doiuse / stylelint-no-unsupported-browser-features | doiuse maps CSS to caniuse ids by property, then by value when the feature lists values. Message: `main.css:5:3: CSS3 Box-sizing not supported by: IE (8-11), ...`. Options `ignore`, `ignorePartialSupport`, inline `/* doiuse-disable */`. | stylelint warning in editor and CI. | The message names file, line, feature and targets, but gives **no fix**. Inline disables are the loophole; Markless target errors stay unsuppressible (`applyMarklessAllowDirectives` already rejects allow directives on errors, `diagnostics.ts:103-106`). |
| React Native style typing | `FlexStyle`/`ViewStyle` are TypeScript interfaces with string-literal unions (`alignContent?: 'flex-start' \| ...`), so an unknown key or value is a type error in `tsc`. | Editor squiggle and `tsc` exit code. | Typing turns support into a type error, the signal agents fix most reliably. But it only covers what the type can express (not per-platform differences, not selectors). |
| Tailwind CSS IntelliSense | Lint rules `cssConflict`, `invalidApply`, `invalidScreen`, `invalidVariant`, `invalidConfigPath`, `invalidTailwindDirective`, `deprecatedAtRule`, `recommendedVariantOrder`, `usedBlocklistedClass`, `suggestCanonicalClasses`; each `ignore`/`warning`/`error`. | Editor only. | Shows a framework can ship its own CSS diagnostics through an extension. Editor-only means CLI agents and CI never see them. |
| NativeWind / react-native-css | Unsupported declarations are dropped. v4: `DEBUG=nativewind` logs. react-native-css PR #430 (open as of 2026-09-26) adds build output like `src/global.css - 3 declarations dropped, no React Native equivalent / properties: columns, float / values: z-index: auto`, default `summary`, because before it "an unsupported declaration therefore did nothing, silently, and the compiler knew and said so into a void". | Metro terminal, if merged. | The named failure mode. Silent drops are the thing to never do; a build log summary is still weaker than a failing build. |
| Lynx | `@lynx-js/css-defines` is "the source of truth for all CSS APIs": it generates engine C++ code, the TypeScript types for inline styles, the compatibility page, and the `lynx-check-css-support` agent skill, which answers `available` / `requires-newer-version` / `conditional` / `unavailable` / `unknown` per backend and version. Runtime has a `LynxError` "Unsupported CSS value" code. | Types, docs, skill, runtime error. | Closest precedent for "one file drives engine, types, docs and agents". Gaps: no build-time failure for stylesheet CSS, and an open issue (#1560) that stylesheet and inline style disagree, i.e. two paths not one. |
| VS Code CSS language service | `css.customData` JSON: `properties`, `atDirectives`, `pseudoClasses`, `pseudoElements`, each with `name`, `description`, `browsers`, `baseline`, `status` (`standard`/`experimental`/`nonstandard`/`obsolete`), `references`, `relevance`. Drives completion and hover. `css.lint.unknownProperties` warns on properties not in the known set. | Editor completion, hover, unknown-property warning. | Good for hover text and completion ordering. It is global, not per target, so it cannot say "unsupported on ios"; per-target errors must come from Markless diagnostics. |
| caniemail | Per feature, support per client family, platform and version: `y`, `n`, `a`, `u`, with numbered notes; published as JSON. Linters and an MCP server (`check_feature_support`, `lint_email`) exist. | Linters, MCP. | The email profile can be derived from caniemail plus Markless's email lowering rules, like the web profile from BCD. |

## 3. The Markless design: one profile per target

### 3.1 Where it lives

The profiles are data exported by the styling engine package that T025 section 5 places inside the Markless repo (package name is an open owner question; `<style-engine>` below). Per the repo rule "protocol and config facts are imported from their owning package", the compiler, `typescript-plugin`, `cli`, the website generator, `core/agent/markless.md` generation and the conformance runner import the profile; none of them hold a copy. T018 section 2 already says "platform profiles own supported values and diagnostics".

- `web`: generated from web-features/BCD for the app's browser floor, plus Markless-specific rows (for example `:root` outside the document component). Baseline `false` below the floor becomes `caveat` or `unsupported` per the app's setting.
- `ios`, `android`: hand-authored, fail closed, every positive row backed by a conformance test.
- `email`: generated from caniemail for a configured client set, plus Markless email lowering rows.

### 3.2 Format sketch

```ts
type Status = 'exact' | 'caveat' | 'approx' | 'unsupported' | 'no-effect';

type Entry = {
  readonly status: Status;
  readonly message: string;          // one sentence, target named, plain words
  readonly fix?: string;             // required when status is 'unsupported' or 'approx'
  readonly docs: string;             // stable URL on the Markless site
  readonly tests: readonly string[]; // conformance ids; required unless 'unsupported'
  readonly context?: Context;        // narrows where the row applies
  readonly since?: string;           // profile version that introduced the row
  readonly source?: string;          // upstream key when derived: BCD path or caniemail slug
};

type Context =
  | { readonly on: 'overlay-part' }                 // e.g. position: fixed only inside a @markless/ui overlay part
  | { readonly on: 'inline-run' }                   // text coalesced into attributed runs
  | { readonly on: 'document-component' };          // :root and html compounds

type Profile = {
  readonly target: 'web' | 'ios' | 'android' | 'email';
  readonly profileVersion: 1;
  readonly default: 'unsupported';                  // anything absent fails closed (native, email)
  readonly properties: Record<string, {             // longhand names; shorthands expand first
    readonly any?: Entry;                           // the property in general
    readonly values?: Record<string, Entry>;        // keyword, <type>, or function name: 'fixed', '<percentage>', 'color-mix()'
  }>;
  readonly units: Record<string, Entry>;            // 'px', 'rem', 'ch', 'lh', 'dvh'
  readonly functions: Record<string, Entry & {      // 'calc()', 'light-dark()', 'color-mix()'
    readonly args?: Record<string, Entry>;          // 'in oklab', 'in hsl'
  }>;
  readonly selectors: Record<string, Entry>;        // ':has()', ':nth-child()', 'combinator:+', 'combinator:~',
                                                    // 'ancestor:cross-component', ':root'
  readonly atRules: Record<string, Entry & {
    readonly features?: Record<string, Entry>;      // '@media': 'prefers-color-scheme', 'os', 'hover'
  }>;
};
```

Example rows for `ios` (illustrative; the real statuses come from T029 and T031, not from this note):

```json
{
  "target": "ios",
  "profileVersion": 1,
  "default": "unsupported",
  "properties": {
    "position": {
      "values": {
        "relative": { "status": "exact", "message": "Positions relative to the view's normal place.", "docs": "https://compiled.run/markless/styling/targets/ios#position", "tests": ["ios/position/relative-offset"] },
        "fixed": {
          "status": "unsupported",
          "message": "position: fixed is not supported on ios outside a @markless/ui overlay part.",
          "fix": "Use a @markless/ui overlay family (popover, dialog, drawer) to show content above the page.",
          "docs": "https://compiled.run/markless/styling/targets/ios#position-fixed",
          "tests": ["ios/position/fixed-rejected"]
        }
      }
    },
    "transition-property": {
      "values": {
        "all": { "status": "unsupported", "message": "transition: all is not supported on ios.", "fix": "List the properties to animate: transition: opacity 120ms, transform 120ms.", "docs": "https://compiled.run/markless/styling/targets/ios#transition-all", "tests": ["ios/transition/all-rejected"] }
      }
    },
    "cursor": {
      "any": { "status": "no-effect", "message": "cursor has no effect on touch-only iPhone; iPad pointer support is separate.", "docs": "https://compiled.run/markless/styling/targets/ios#cursor", "tests": ["ios/no-effect/cursor-omission"] }
    }
  },
  "functions": {
    "color-mix()": {
      "status": "exact", "message": "Mixes colours, re-resolved on appearance change.", "docs": "https://compiled.run/markless/styling/targets/ios#color-mix", "tests": ["ios/color/color-mix-oklab"],
      "args": {
        "in hsl": { "status": "unsupported", "message": "color-mix() in hsl is not supported on ios.", "fix": "Use in oklab, in oklch or in srgb.", "docs": "https://compiled.run/markless/styling/targets/ios#color-mix", "tests": ["ios/color/color-mix-hsl-rejected"] }
      }
    }
  },
  "selectors": {
    ":has()": { "status": "unsupported", "message": ":has() is not supported on ios in this release.", "fix": "Put the state on the element itself (data-checked={checked}) and style [data-checked].", "docs": "https://compiled.run/markless/styling/targets/ios#has", "tests": ["ios/selector/has-rejected"] }
  }
}
```

### 3.3 Status meanings and what each does

| Status | Meaning | Build (target named) | Editor | Docs table |
|---|---|---|---|---|
| `exact` | Matches the web result within the conformance tolerance. | nothing | hover line "ios: exact" | tick |
| `caveat` | Supported; a documented, tested difference (for example font metrics). | nothing | hover line with the caveat | tick with note |
| `approx` | Lowered to something different on purpose (T018: paint-only, e.g. a blur mapped to a named material). | warning `MARKLESS_CSS_APPROXIMATED` | warning squiggle | "approximated" with note |
| `unsupported` | Refused. Includes everything absent from the profile. | error, target build fails | error squiggle | cross with fix |
| `no-effect` | Accepted and dropped, proven by an omission test. | nothing | info, faded | "no effect" |

`no-effect` stays out of the build output because the same CSS legitimately serves web; the editor still shows it so nobody believes it does something on the device.

### 3.4 One profile drives five things

1. **Compiler checker.** A style pass reads each declaration after shorthand expansion and false `@supports`/`@media (os:)` branch removal, looks it up per configured target, and emits a `CompilerDiagnostic` (`diagnostics.ts:11-39`) whose `message`, `suggestions[0]`, and `docsUrl` are copied from the entry. Contract change to flag: `CompilerDiagnostic['phase']` has no style phase today; one must be added.
2. **Editor.** Two channels. (a) Diagnostics: `compileTsrxForTypeService` (`packages/compiler/src/type-service.ts:105`) currently returns parse errors only; it would also run the style pass, and the plugin would add those diagnostics to `getSemanticDiagnostics` the way it adds the parse failure today. (b) Hover and completion: a generated `css.customData` file per app (union over configured targets) whose `description` carries one line per target ("ios: unsupported, use an overlay family") and whose `relevance` pushes cross-target-safe values up. Custom data cannot error per target, which is why (a) is needed.
3. **Generated docs.** One table page per target plus a comparison page, generated from the profiles with the same drift check `.ruler` uses (generated files committed, CI fails on drift).
4. **Agent guidance.** A generated section in `packages/core/agent/markless.md` (the file the managed skill loads, `packages/cli/src/agents.ts:225-240`), a "Styling by target" entry in the website's generated `llms.txt`, and a `markless support` CLI query (section 4.3). An MCP tool is an optional thin wrapper over the same query.
5. **Conformance tests.** Every `tests` id must exist. For `unsupported` rows the test is a compile fixture that expects the diagnostic code (so the error itself is pinned). For `exact`/`caveat` rows it is a browser-oracle comparison on the target. For `no-effect` it is an omission test (layout, paint, hit testing, accessibility unchanged, per T018). A CI check fails when a positive row has no test or a named test is absent.

## 4. What people and agents see

### 4.1 Editor diagnostic (app targets: web, ios)

```text
src/routes/settings.tsrx
  41:3  .panel { position: fixed; inset-block-end: 0; }
                 ~~~~~~~~~~~~~~~
  error  Markless(MARKLESS_CSS_VALUE_UNSUPPORTED)
         ios: position: fixed is not supported on ios outside a @markless/ui overlay part.
         Fix: use a @markless/ui overlay family (popover, dialog, drawer) to show content above the page.
         Blocks the ios build only. Web is unaffected.
         https://compiled.run/markless/styling/targets/ios#position-fixed

  44:3  .panel { cursor: pointer; }
                 ~~~~~~~~~~~~~~~   (faded)
  info   ios: cursor has no effect on touch-only iPhone.
```

Hover on `position` in the same file:

```text
position: fixed
  web      exact
  ios      unsupported outside an overlay part: use a @markless/ui overlay family
  android  unsupported outside an overlay part: use a @markless/ui overlay family
  email    unsupported: most clients strip it
```

Whether ios errors appear while the author works on web is owner decision 2 in T025 section 6; this design assumes the recommended yes.

### 4.2 Build error

```text
error MARKLESS_CSS_VALUE_UNSUPPORTED  src/routes/settings.tsrx:41:12  [target ios]
  position: fixed is not supported on ios outside a @markless/ui overlay part.
    41 |   .panel { position: fixed; inset-block-end: 0; }
       |            ^^^^^^^^^^^^^^^
  why: showing content above the page is overlay behaviour on native, not a CSS side effect.
  fix: use a @markless/ui overlay family (popover, dialog, drawer) to show content above the page.
  docs: https://compiled.run/markless/styling/targets/ios#position-fixed
  profile: ios v1, properties.position.values.fixed (test ios/position/fixed-rejected)

Found 1 Markless style error for target ios. The web build is unaffected.
```

The `profile:` line tells a person or agent exactly which row to dispute if the error is wrong. The error cannot be silenced with `// markless-allow` (existing behaviour for errors).

### 4.3 Support query (CLI; optional MCP wrapper)

```text
$ npx markless support ios "position: fixed"
unsupported  (ios profile v1)
  position: fixed is not supported on ios outside a @markless/ui overlay part.
  fix: use a @markless/ui overlay family (popover, dialog, drawer).
  docs: https://compiled.run/markless/styling/targets/ios#position-fixed

$ npx markless support --json all "display: grid"
{"web":{"status":"exact"},"ios":{...},"android":{...},"email":{...}}
```

A CLI query works in every agent that has a shell, with no extra install; Lynx made the same choice with a skill over a bundled data package. An MCP tool (`can_i_use(target, css)`) is a later convenience over the same function.

### 4.4 Generated agent guidance (section inside `@markless/core/agent/markless.md`)

```markdown
## Styling for more than one target
<!-- generated from <style-engine> profiles v1; do not edit -->

This app builds for: web, ios (from markless.config).

- Write normal CSS in `<style>`. On ios and android a selector may test only its own
  element, ancestors written in the same component, and app-wide conditions
  (`@media`, and `:root` in the document component).
- Before you finish, run `pnpm run typecheck`. A style error for any configured target
  fails it. Target errors cannot be silenced with `markless-allow`; change the CSS.
- To check one declaration: `npx markless support ios "<declaration>"`.
- Not available on ios in this release (most common first): `:has()`, `+` and `~`
  combinators, `:nth-child()`, `position: fixed` outside overlay parts,
  `transition: all`, `color-mix()` outside srgb/oklab/oklch.
- Full table: https://compiled.run/markless/styling/targets/ios
```

Kept short on purpose: the "not available" list is the top entries ranked by how often they appear in the T017 CSS corpus, capped at about eight.

## 5. Which surface actually stops an agent (ranked, with evidence)

1. **A failing build or typecheck in a command the agent is told to run.** Strongest. The AGENTS.md spec says an agent "will attempt to execute relevant programmatic checks and fix failures before finishing the task" when they are listed. Mündler et al. (PLDI 2025) found 94% of compile errors in LLM-written code are type-check failures and that type feedback improves repair of non-compiling code; Blyth et al. (arXiv 2508.14419) cut security issues from over 40% to 13% and reliability warnings from over 50% to 11% by feeding static-analysis output back in a loop. A located error with a fix is the kind of fine-grained feedback those loops use. This is also the only surface that cannot be skipped: it is in the verify array and CI. **Markless status:** `typecheck` already fails on Markless compile errors (`tsc.ts:52-58`); the style pass must feed it.
2. **Editor diagnostics.** High for IDE agents and people, who see squiggles as they write; CLI agents see them only through an IDE bridge or by running the same check. Tailwind IntelliSense shows the approach but is editor-only. **Markless status:** new path needed (section 1, repo gap).
3. **A short rule always in context, with a pointer.** Vercel's evals: a compressed ~8 KB docs index in AGENTS.md passed 100%; the same content as a skill passed 53% without instructions (equal to no docs) and 79% with them, and the skill was never invoked in 56% of runs. Counter-evidence: Gloaguen et al. (arXiv 2602.11988) found context files do not generally raise task success and add over 20% inference cost, and recommend describing only minimal requirements. So: one short rule plus "run typecheck", not a table. **Markless status:** the scaffold deliberately writes no AI files into the project (`AGENT_NOTE_COPY`, `agents.ts:68-75`); guidance reaches agents through the managed skill, which is the weaker, on-demand route. This is acceptable only because surface 1 does the enforcing.
4. **On-demand lookups: skill, CLI query, MCP tool.** Useful for planning ("can I use grid on ios?") but depend on the agent choosing to call them (the 56% never-invoked figure applies). No direct eval found for MCP tool invocation rates; treat as the same class.
5. **llms.txt and docs tables.** For agents that browse the web, and for people. The proposal notes the AI labs publish llms.txt for their own docs; no evidence found that agents consult it unprompted during coding. Lowest enforcement value, highest explanatory value.
6. **Completion ordering (CSS custom data).** Helps people; agents rarely write through completion. No enforcement.

Rule of thumb from the evidence: prose tells the agent what to try; only a failing check makes it stop. Every guidance surface should end in "run the check".

## 6. Open points for T031 and the owner

- Package name and home of the profiles (`<style-engine>` placeholder); T025 section 5 is the owner question.
- New `CompilerDiagnostic` phase for style checks (contract change in `packages/compiler/src/diagnostics.ts`).
- Diagnostic codes: T025 names `MARKLESS_CSS_CROSS_COMPONENT`, `MARKLESS_CSS_ROOT_OUTSIDE_DOCUMENT`, `MARKLESS_CSS_SELECTOR_UNSUPPORTED`, `MARKLESS_CSS_VAR_IN_SHORTHAND`; this note adds `MARKLESS_CSS_VALUE_UNSUPPORTED`, `MARKLESS_CSS_APPROXIMATED` and an info code for `no-effect`, as proposals only.
- Web profile floor: which Baseline year or browser list an app declares, and whether below-floor features are `caveat` or `unsupported`.
- `markless support` CLI command and `markless.config` target list are proposals; neither exists today.
- The markless VS Code extension (outside this repo) was not inspected; it may already have a channel for semantic diagnostics.
- The T029 evidence table supplies the real statuses; every row above is illustrative.

## Sources (all accessed 2026-09-26)

- MDN BCD schema: https://github.com/mdn/browser-compat-data/blob/main/schemas/compat-data-schema.md
- caniuse data format: https://github.com/Fyrd/caniuse/blob/main/CONTRIBUTING.md
- web-features: https://github.com/web-platform-dx/web-features ; Baseline definition: https://raw.githubusercontent.com/web-platform-dx/web-features/main/docs/baseline.md
- eslint-plugin-compat: https://github.com/amilajack/eslint-plugin-compat
- stylelint-no-unsupported-browser-features: https://github.com/RJWadley/stylelint-no-unsupported-browser-features
- doiuse: https://github.com/anandthakker/doiuse
- React Native style types: https://github.com/react/react-native/blob/main/packages/react-native/types_DEPRECATED/Libraries/StyleSheet/StyleSheetTypes.d.ts ; styling docs: https://reactnative.dev/docs/style
- Tailwind CSS IntelliSense: https://github.com/tailwindlabs/tailwindcss-intellisense
- NativeWind troubleshooting: https://www.nativewind.dev/docs/getting-started/troubleshooting ; react-native-css PR #430: https://github.com/nativewind/react-native-css/pull/430
- Lynx: https://lynxjs.org/ai/skills/lynx-check-css-support ; https://www.npmjs.com/package/@lynx-js/css-defines ; https://lynxjs.org/api/errors/error-code.html ; https://github.com/lynx-family/lynx/issues/1560
- VS Code CSS custom data: https://github.com/microsoft/vscode-css-languageservice/blob/main/docs/customData.md ; CSS lint settings: https://code.visualstudio.com/docs/languages/css
- caniemail: https://github.com/hteumeuleu/caniemail ; https://www.caniemail.com/
- AGENTS.md: https://agents.md/
- llms.txt: https://llmstxt.org/
- Claude Code skills: https://code.claude.com/docs/en/skills
- Vercel, "AGENTS.md outperforms skills in our agent evals": https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals
- Gloaguen et al., "Evaluating AGENTS.md": https://arxiv.org/abs/2602.11988
- Mündler et al., "Type-Constrained Code Generation with Language Models" (PLDI 2025): https://arxiv.org/abs/2504.09246
- Blyth et al., "Static Analysis as a Feedback Loop": https://arxiv.org/abs/2508.14419

```json
{
  "goalbuddy_receipt_v1": {
    "result": "done",
    "task_id": "T030",
    "board_path": "/Users/jacksm5pro/dev/open-source/markless/docs/goals/native-targets-api/state.yaml",
    "decision": null,
    "full_outcome_complete": false,
    "rationale": "One machine-readable support profile per target (exact/caveat/approx/unsupported/no-effect, message, fix, docs, conformance test ids; native and email fail closed; positive rows require a test) drives the compiler checker, editor diagnostics and hover, generated docs, agent guidance and conformance tests. Evidence ranks a failing build/typecheck the agent is told to run as the most reliable stop, then editor diagnostics, then a short always-loaded rule, then on-demand skill/CLI/MCP, then llms.txt/docs. Repo gap: the TS plugin surfaces only parse errors in the editor; semantic CompilerDiagnostics reach bundler, dev overlay and the typecheck wrapper, so style errors need a new editor path.",
    "evidence": [
      "docs/goals/native-targets-api/notes/T030-agent-guardrails.md",
      "packages/compiler/src/diagnostics.ts:11-39,103-106",
      "packages/compiler/src/type-service.ts:105-117",
      "packages/typescript-plugin/src/index.ts:107-137",
      "packages/typescript-plugin/src/tsc.ts:40-60",
      "packages/bundler/src/transform.ts, packages/bundler/src/link-driver.ts, packages/bundler/src/dev-error/index.ts",
      "packages/cli/src/agents.ts:68-75,225-240",
      "packages/core/agent/markless.md",
      "website/public/llms.txt",
      ".ruler/ruler.toml"
    ],
    "missing_evidence": [
      "Real per-target statuses (T029).",
      "Agent invocation rates for MCP tools specifically (no study found).",
      "Whether the out-of-repo markless VS Code extension already carries semantic diagnostics."
    ],
    "blocked_tasks": [],
    "required_board_updates": [
      "Record T030 done with evidence notes/T030-agent-guardrails.md.",
      "Feed T031: use section 3.2 as the draft profile schema and section 3.3 status table; statuses come from T029.",
      "Owner questions to batch: profile package name/home, web profile browser floor, new CompilerDiagnostic style phase, markless support CLI command."
    ]
  }
}
```
