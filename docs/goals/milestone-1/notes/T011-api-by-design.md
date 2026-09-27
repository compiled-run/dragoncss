# T011: An API that removes pitfalls by design (Scout)

Read-only scout note, 2026-09-26. Pseudocode is Dragon idiom and is not compiled or tested. Pitfall ids follow `docs/research/pitfalls.md` (written during this task, read at the end): `T006 #n` is its `Pn` (`notes/T006-platform-pitfalls.md`), and A1-C10 come from `notes/T007-dragon-dx-pitfalls.md`.

Inputs read: `README.md`, `AGENTS.md`, `goal.md` (design principles 1-6), `docs/research/T018-styling-design.md`, `T025-styling-direction.md`, `docs/research/pitfalls.md` (sections 2.1, 2.4 and the table), `docs/why-not-stylex.md`, both pitfall notes, `packages/dragon/src/index.ts`.
Inspected read-only:
- **yuku:** `~/dev/open-source/yuku/npm/yuku-analyzer/README.md` and `index.d.ts`, plus `npm/yuku-parser/README.md` (`lang` accepts `js`, `ts`, `jsx`, `tsx`, `dts` and `tsrx`).
- **Markless compiler:** `~/dev/open-source/markless/packages/compiler/src/passes/semantic-graph/types.ts`, `artifacts.ts` (`SemanticHostNode`, `SemanticTemplateRead`, `SemanticStateWrite`), `passes/public-render/style-scopes.ts` and `passes/semantic-graph/constant-values.ts`.
- **frameless:** `~/dev/open-source/frameless/packages/compiler/src/schema.ts` (`EnrichedIR`, `TemplateNode`, `ExpressionSite`).

## 0. Summary in plain words

1. **Both, in layers.** The compiler core accepts exactly one input: a versioned element tree (`dragon/tree` v1). Dragon also ships its own source front ends (`dragon/tsrx`, `dragon/jsx`, `dragon/html`), built on yuku, that produce that tree. A framework with a richer semantic model, such as Markless, may emit the tree itself. Its tree then goes through the same validator, so a producer can never claim more than it proved.
2. **The key missing semantic is the value set, not the state.** Today neither Markless's graph nor frameless's record says which values a `class` or `data-*` binding can take. Markless's `SemanticTemplateRead` carries source text and a target, and frameless's `DynamicBinding` carries an AST and graph reads, but neither carries a value set. Dragon's tree needs a **domain** on every binding that a selector can test: either a finite list of values with source evidence, or `open`. An `open` domain that a native selector depends on is a build error. This domain is plain JavaScript value analysis over the binding expression (`open ? 'open' : 'closed'` always has two values), so it is framework-neutral and yuku can compute it. What *is* framework-specific is how to subscribe to changes. The tree represents that as an opaque binding-site id, which the framework's own native code calls.
3. **Wrong use is made unreachable in the types.** There is one project handle built from one config, and targets come only from that config. `compile()` has no per-call target, severity or ignore options. A target with errors returns no output object at all, only diagnostics. There are no allow comments. Output is byte-deterministic.
4. **One `Resolved` result, several emitters.** Web CSS, native Swift and test data are views of the same resolved per-element, per-state table, and they carry the same digest. When any native target is configured, web CSS is generated from that table, not passed through from the author's CSS, so the browser shows what the phone gets. The dev overlay and hot reload consume `project.update()` deltas, which are labelled `paint` or `structure`.
5. **A React Native mode is another emitter, not another engine.** It emits a lookup table keyed by binding site and value, which a tiny runtime reads. Nothing on the device matches selectors. A truly open "match any className at run time" mode would give up per-state proof. It is an owner decision, and I recommend no.

## 1. Tree-in, source-in, or both

### Options

| | Tree-in only | Source-in only | Both (recommended) |
|---|---|---|---|
| Adoption effort for a framework author | High. They write a lowering, including value sets, which is the hard part. | Zero for supported syntaxes. Unsupported syntaxes (Vue templates, Svelte, Angular) get nothing. | Zero for tsrx, jsx and html. Other frameworks write a tree emitter and get the validator for free. |
| Correctness of state enumeration | Only as good as each producer. A producer that says "finite" wrongly causes a silent device mismatch. That is react-native-css's class of bug: PR #462 shipped conditioned rules with no condition, so "the style then applied in every state". | Dragon owns it. One inference, one test suite. | Dragon owns the inference for its front ends. For external producers, the validator re-checks evidence spans, and dev builds assert at run time that each value is in its domain. |
| Who owns semantic analysis | The framework | Dragon | Dragon owns value sets, component ownership and style scoping. The framework owns reactivity (which expression changes when) and view construction. |
| Framework-neutral? | Yes | Only for languages yuku parses | Yes |

### Why both, and why the tree is the contract

- **Yuku already gives the front end what it needs.** It resolves every identifier to its symbol (`module.symbolOf`, `referenceOf`, `isWrite`), follows imports to definitions (`analyzer.definitionOf`, `referencesOf`), gives closure captures (`capturesOf`), and parses tsrx, jsx and tsx in one native pass ("linking a 2,000-module graph takes about a millisecond", per its README; not re-measured here). It has **no type checker**. So value sets come from dataflow over literals and from syntactic literal-union annotations (`state<'a' | 'b'>`, or a local type alias resolved through yuku's type-space symbols). They do not come from TypeScript inference in general. Open annotations such as `string` stay open. That is fail-closed, which is the right default.
- **Markless should emit the tree, not be re-analysed.** Its semantic graph already has everything but domains:
  - host nodes with ids (`SemanticHostNode`);
  - reads bound to hosts and targets, with source spans (`SemanticTemplateRead`);
  - component edges and projection scopes (`currentProjectionScope`);
  - state writes with value source and spans (`SemanticStateWrite.valueSource`, `valueSpan`);
  - a constant evaluator (`constant-values.ts`).

  A second, Dragon-side analysis of `.tsrx` would duplicate reactivity knowledge that only Markless has, for example `computed()` and shared definitions. Markless adds a domain pass and a tree emitter. `dragon/tsrx` serves other TSRX frameworks (frameless, Ripple).
- **frameless's `EnrichedIR` is precedent for the shape.** It is a versioned (`ENRICHED_IR_VERSION`), target-neutral tree of `host`, `text`, `dynamic-text`, `branch`, `keyed-repeat`, `component-reference` and `default-slot-projection` nodes. Each dynamic site is `{ expression AST, reads[] }`. Dragon's tree borrows that vocabulary, then adds domains, ownership and spans on everything.
- **Tailwind shows the cost of not analysing.** Tailwind "treats all source files as plain text", so it "has no way of understanding string concatenation or interpolation", and its docs then list do's and don'ts (tailwindcss.com, accessed 2026-09-26). That is a pitfall documented instead of removed. Dragon's front ends analyse, and fail with a fix where they cannot.

### Pseudocode

```ts
// Framework with no semantic model of its own: Dragon reads source.
import { tsrx } from 'dragon/tsrx';          // also 'dragon/jsx', 'dragon/html'
const project = await dragon.open(root);     // reads dragon config: targets, assets root
project.add(tsrx.analyze(files, { resolve })); // yuku Analyzer inside; returns DragonTree v1

// Framework with its own semantic graph: emits the tree.
import { validateTree } from 'dragon/tree';
const tree: DragonTree = marklessToDragonTree(semanticGraph); // Markless-owned emitter
project.add(tree);  // validateTree runs inside add(); a claim without evidence is an error
```

Pitfalls removed: **A7** (errors that move between files). Ownership is proven per component from the tree, so an error names both files only when a projection makes it cross-file. **B4** (third-party CSS): library trees are checked at publish with the same validator. **T006 #10** (dev works, release breaks): one inference path, no producer-specific drift. It also removes the Tailwind-style "complete class names only" rule, which becomes a located error instead.

Cost: Dragon maintains three front ends and must track TSRX syntax changes. That is mitigated because yuku owns parsing.

## 2. What the tree must carry

Rule for inclusion: the tree carries a fact only if the compiler needs it to decide a platform choice without asking the developer. Everything is keyed by stable ids. Every node, attribute, binding, CSS rule and declaration has a span.

```ts
// dragon/tree v1: pseudocode schema
type DragonTree = {
  version: 1;
  modules: Module[];                     // one per source file
  assets: Asset[];                       // fonts and images, resolved by the host's resolver
};

type Span = { file: string; start: number; end: number };   // byte offsets; Dragon derives line/col

type Module = {
  file: string;
  components: Component[];
  styles: StyleSheet[];                  // raw CSS text + span; Dragon parses it (lightningcss/yuku scanner)
};

type Component = {
  id: string;                            // unique per component, not per file
  name: string; span: Span;
  styleScope: string;                    // which StyleSheet rules may match this component's own elements
  root: Node[];
  props: PropDomain[];                   // e.g. forwarded `class`: finite set proven from every call site, or open
  exported: 'internal' | 'public';       // public + callable from outside the analysed graph => prop domains open
};

type Node =
  | { kind: 'element'; id: string; tag: string; owner: ComponentId; span: Span;
      static: Attr[]; bindings: Binding[]; children: Node[]; part?: PartRef }
  | { kind: 'text'; id: string; value: string; span: Span }
  | { kind: 'dynamic-text'; id: string; site: SiteId; span: Span }      // content changes, never structure
  | { kind: 'branch'; id: string; site: SiteId; arms: Node[][]; span: Span }
  | { kind: 'repeat'; id: string; site: SiteId; row: Node[]; span: Span }
  | { kind: 'component'; id: string; target: ComponentId; forwarded: Binding[]; children: Node[]; span: Span }
  | { kind: 'projection'; id: string; span: Span }                       // {children}: authored owner preserved
  | { kind: 'raw-html'; id: string; span: Span };                        // innerHTML-style: opaque => native error

type Binding = {
  name: 'class' | `data-${string}` | `aria-${string}` | `ui-${string}` | 'style' | 'dir' | string;
  site: SiteId;                          // opaque id the framework's native code calls on change
  span: Span;
  domain: Domain;                        // for anything a selector can test
  valueType?: CssType;                   // for inline style / custom-property values
};

type Domain =
  | { kind: 'finite'; values: Array<{ value: string | boolean | null; evidence: Span[] }> }
  | { kind: 'open'; reason: 'string-typed' | 'call' | 'spread' | 'external-prop' | 'computed-key'; span: Span };

type Asset =
  | { kind: 'font'; family: string; file: string; span: Span }   // Dragon reads the name table and weights
  | { kind: 'image'; file: string; span: Span };                  // Dragon reads the intrinsic size
```

### Each field, the choice it lets the compiler make, and the pitfall it removes

| Semantic | Why the compiler needs it | Pitfalls removed |
|---|---|---|
| **Elements with tag** | Tag is needed for Chrome's built-in-stylesheet defaults (pinned copy, lowest layer) and the element profile (which tags exist on native). | T006 #4, T007 A2 (never-written defaults), C7 |
| **Text vs dynamic text vs element** | Coalescing into one native styled-text view requires proving `display: inline` in every reachable state (T018 3.5). The tree gives text runs and their parents, and Dragon computes display. Loose text is wrapped automatically, and inherited text styles are written onto every text node (principle 3). Dynamic text changes content only, so the setter never restructures. | T006 #14 (text inheritance), #1 partly (the line-height model is chosen by Dragon, not per call), T007 B1 |
| **Bindings with domains** | Principle 1: resolve every element for every reachable state. The per-element state space is the product of the finite domains the matching rules test, plus the host atoms Dragon adds itself (`:hover`, `:active`, `:focus-visible`, colour scheme, text size, direction, width). | T006 #10 and #17 (flashes: no runtime resolution), T007 A1, and "untested state" (principle 2: tests are generated from the same domains) |
| **Component ownership and style scope per component** | The native selector rule ("own element, ancestors in the same component, app root"). Markless scopes per **module** today (one scope class per module in `style-scopes.ts`); T018 says one file is not enough if it defines several components, while pitfalls.md (A7 row) proves ownership "per file from the scope hash". The tree carries both the component id and the module scope, so T009 can settle this without changing the format. **Open for T009.** | T007 A7, C6 (z-index escaping: ownership plus sibling order are known) |
| **Component edges with forwarded bindings** | A forwarded `class` on a part is an own-element test, but only if it can be traced. Its domain is the union over call sites (yuku `referencesOf`). If it is exported beyond the analysed graph, it is open. | T025 fix path "forward a class", B4 |
| **Projection** (`{children}`) | Inheritance and ancestor matching follow the **logical** (authored) tree, not the native render parent (T018 3.3, 3.7). | Overlay reparenting: T006 #8 (z-index vs elevation) and the inheritance through parts described in T018 |
| **Branch and repeat** | Structure is conditional, but styles are not. Repeats need no index for the first release (structural pseudo-classes are errors). Branch arms are enumerated for generated tests. | Principle 2 coverage |
| **`raw-html`** | Opaque subtree. A native error with fix "render it as markup". | Silent drop (T006 #10) |
| **Spans everywhere** | Every diagnostic, the overlay, "explain" queries for agents, and save-to-source all need spans. frameless uses `{ filename, start, end }`, and Dragon adopts it. | T007 C10, agent usability (goal.md: diagnostics shaped as fixes) |
| **Dynamic values (`valueType`)** | Nothing on the device parses CSS (README), so a value from state must arrive typed. A number goes into `calc(var(--n) * 1px)`. A string into a CSS value needs a finite domain, or it is an error. | T018 `MARKLESS_CSS_VAR_IN_SHORTHAND` becomes one general rule: "open string into CSS is an error". This also removes invalid-at-runtime surprises. |
| **Assets** | Principle 5: fonts are declared once and checked at build. A weight missing from the files fails the build, and the family is registered under the CSS name on native. Image intrinsic sizes reserve the box before load. | T006 #6 (font names and weights), #13 (images), T007 C2, C3 |

### How a domain is inferred (front ends) and checked (validator)

```ts
// binding expression        -> domain
open ? 'open' : 'closed'     -> finite {'open','closed'}          evidence: both literal spans
theme === 'system'           -> finite {true,false}               regardless of theme's own domain
theme  (state<'system'|'light'|'dark'>) -> finite, from annotation span
theme  (let theme = state('a'); every write is a literal) -> finite, from initializer + write spans
cx('tab', active && 'on')    -> finite {'tab','tab on'}           cx/clsx are known pure helpers
`bg-${color}`                -> open 'string-typed'  => error only if a native selector tests this attribute
{...props}                   -> open 'spread'        => error: "forward `class` explicitly"
```

A domain is required only where a selector reads the binding. `data-id={row.id}` can stay open when no rule tests `[data-id]`. That keeps the fail-closed rule from firing on data that styling never reads.

State explosion: this follows pitfalls.md 2.1. Resolve per condition, and multiply two conditions only when both set the same property on the same element. Identical property sets share one entry. Nothing is ever sampled: every reachable state has a resolved entry. The count per component goes into the build summary. Above a budget it is an info diagnostic naming the multiplying conditions, which is pitfalls.md's default. The budget is measured, not guessed.

## 3. Making wrong use impossible

### Targets from one config, not per call

```ts
// dragon.config.ts: the only place targets exist
export default defineDragon({
  targets: ['web', 'ios'],          // scaffolds ship web + ios (T007 A1)
  profile: 'lockfile',              // profile version = package version, never a range
});

const project = await dragon.open(root);        // no targets parameter anywhere below
const result  = project.compile();              // no options object at all
```

Every configured target is checked on every compile, in dev, typecheck, the editor and CI. There is no `--target` flag that narrows checking, which removes **T007 A1** (native errors found weeks later) and **C8** (reverse direction). Web rendering in dev is not blocked by a native error. `typecheck` and CI are blocked. Rendering is a view of the result, and checking is not optional.

### Diagnostics that cannot be ignored

```ts
type Compiled = {
  digest: string;                                    // hash of trees + CSS + profile version + dragon version
  diagnostics: readonly Diagnostic[];                // all targets, sorted by file, then offset, then code
  target(t: ConfiguredTarget): TargetOutput | Blocked;
};
type Blocked = { blocked: true; errors: readonly Diagnostic[] };   // no css, no swift, no table: nothing to ship
type Diagnostic = {
  code: DragonCode; severity: 'error' | 'warning';   // warning only for profile-declared approximations
  target: ConfiguredTarget; span: Span; related: Span[];
  message: string; why: string;                      // why text comes from the support profile, never a literal
  fix: { title: string; edits: TextEdit[] } | { title: string; manual: string };
};
```

- `ConfiguredTarget` is a type generated from the config, so `target('android')` does not typecheck in a web and ios project.
- There is no `ignore`, `allow`, `severity` override or `// dragon-ignore` comment. Svelte's `<!-- svelte-ignore -->` and Markless's former `markless-allow` are the precedent Dragon rejects (T025 already says native errors cannot be silenced by allow directives).
- Warnings are not a softening path. A construct is an error unless the profile names a specific, measured approximation.
- `@supports` and `@media (os:)` stay allowed, because they are web mechanisms, but they are listed in `dragon escapes` and in the build summary (T007 B5).
- Errors are grouped by feature in the overlay (T007 C9), but never downgraded.

Pitfalls removed: T006 #10 (silent drops, NativeWind's named complaint in T016), T007 C9 and C10.

### No escape flags

There is no `unsafe`, `runtime: true`, `skipCheck` or per-rule platform override on any API. The escapes that exist are authored CSS the compiler can see (`@supports`, `@media (os:)`) or framework branches (`@if (target.os …)`). All of them are spanned and listed. This removes the "fix it by flag" path that agents reach for.

### Deterministic output

- Output order is fixed: by component id, then element id, then state key, then property name.
- Output contains no timestamps, absolute paths or hash-map iteration order.
- Ids come from the file path relative to the project root plus the node's order in the source.
- `digest` covers every input. A double compile of the corpus must be byte-identical, and that is a test.
- The same digest is stamped into the web CSS header, the Swift file and the test table (section 4), so a mismatch between outputs is detectable.

This removes T006 #10 (dev and release drift) and T007 B6 (profile updates changing results silently): a profile change changes the digest, and the changelog is generated from the data difference.

### Open (unknown) state fails closed

| Case | Web-only project | Project with a native target |
|---|---|---|
| Open domain, no selector reads it | fine | fine |
| Open domain read by a selector | fine: full CSS in the browser | **error** on every configured target, including web output. Web is generated from the resolved table, so the browser cannot show a state Dragon never resolved. |
| External-prop domain (library entry point) | fine | error at the library's publish check. The consumer sees one error per family (T007 B4). |
| Dev run time: the framework passes a value outside the domain | n/a | dev builds throw a located error from the generated setter. Release setters take an enum, so the value is unrepresentable. |

```text
error DRAGON_OPEN_CLASS  src/components/tab.tsx:14:22
  class={`tab ${variant}`} can take any string; ".tab.primary" (tab.css:3) needs to know every value.
  why: ios styles are resolved per state at build; an unknown value would have no resolved style.
  fix: type `variant` as 'primary' | 'ghost', or map it: class={variants[variant]} with a const object.
```

## 4. Web output from the same result, dev overlay and hot reload

### One result, three views

```ts
const out = result.target('ios');       // TargetOutput | Blocked
if ('blocked' in out) return report(out.errors);

out.swift;          // generated Swift: one setter per binding site, enum-typed values, direct property writes
out.table;          // plain data: element -> state key -> native longhands (test lanes read this)

const web = result.target('web');
web.css;            // stylesheet generated from the resolved table when a native target is configured
web.hostAttrs;      // elementId -> attributes to stamp (the element's Dragon class; state data attributes)
web.sourceMap;      // generated rule -> authored declaration spans (devtools shows the author's file and line)
```

- **The web output when a native target is configured.** Dragon emits rules keyed by element and state from the resolved table, not the author's CSS text. The browser therefore shows Dragon's decisions:
  - text styles written onto text nodes;
  - `z-index` as sibling order;
  - `:hover` under `(hover: hover)`;
  - the pinned default stylesheet;
  - the shadow split onto a host layer and a clip layer.

  pitfalls.md 2.4 finds a blind spot. If Chrome renders only this output, a Dragon cascade bug looks identical on both sides and passes. So the test lanes keep two Chrome references:
  1. the **authored** CSS in Chrome must produce the same boxes as `web.css` in Chrome, which checks resolution;
  2. `web.css` in Chrome must match the Taffy lane and the simulator, which checks the native mapping.

  The API supports this because `result.target('web')` exists alongside `project.authoredCss()`, the scoped authored CSS used only by the test lanes. That is how "focus on one platform and it just works on the other" becomes checkable instead of promised.
- **Web-only projects** get the author's CSS scoped and passed through (today's Markless behaviour). This is chosen by the config, not by a call.
- **The framework's job** is to stamp `hostAttrs` and call binding-site setters. On web, the setter writes a data attribute. On native, it calls the generated Swift function. Framework-neutral: Markless, React and Solid each call the same site ids.

### Dev overlay and hot reload hooks

```ts
const session = project.watch();               // same project, same config
session.on('diagnostics', (all) => overlay.render(all));   // every configured target, from the first keystroke
const delta = session.update(file, source);    // re-analyse one file; yuku relinks dependents
// delta: { digest, kind: 'paint' | 'structure', elements: ElementId[], web: CssPatch, table: TablePatch }
if (delta.kind === 'paint') { hmr.swapCss(delta.web); simulator.applyTable(delta.table); } // state kept
else framework.reload(delta.elements);         // display inline<->box, text coalescing, element profile change
session.explain(elementId);                    // per-state winning declarations with spans: overlay inspector + agents
```

- `kind` is computed by Dragon, not guessed by the framework. That removes T007 A6's "does this edit keep state?" ambiguity.
- The dev-only simulator applier reads `TablePatch`, which is the same data the Linux lane checks. A drift test requires the dev applier and the generated Swift to produce identical property dumps (T007 A6's two guards).
- `explain()` is the agent surface: the same data as the overlay inspector, in JSON. That is what makes styling local and predictable for agents, as StyleX's is (goal.md).

## 5. A React Native runtime-matching mode

A React Native mode only needs a runtime *lookup*, not a runtime *matcher*. Every selector decision is already made at build.

```ts
defineDragon({ targets: ['web', 'react-native'] });

const rn = result.target('react-native');
rn.module;   // JS: export const sites = { card_state: { open: 3, closed: 4 } }; export const styles = [/* RN style objects */]
// the framework's RN code:  <View style={dragonStyle('card_state', open ? 'open' : 'closed')} />
// dragonStyle = two array index lookups; host atoms (pressed, colour scheme, font scale) come from a small hook
```

- It comes from the same `Resolved` result, the same selector rule, the same domains and the same digest. So it inherits the proof: the table the Linux lane checks is the table the device indexes.
- It has its own support profile (`react-native`), because RN style properties differ from UIKit's. Unsupported entries are errors, exactly as for iOS.
- **What it must not become:** react-native-css matches `className` strings on the device. Its PR #462 shows that bug class: rules for condition-only ancestors (`[data-state="on"] .x`, `:hover .x`) compiled with no condition and "applied in every state". An open "match any className at run time" mode would reintroduce open domains and give up per-state tests. If the owner wants it for third-party RN components, it would be a separate target whose profile marks everything as `unproven`. It could not share a config with a proven native target. I recommend not building it.

This removes T006 #10 (runtime matching disagreeing with the build), and keeps README's "nothing on the device parses CSS or matches selectors" true for the RN target too.

## 6. Owner decisions this raises

I am asking you to settle three API-shape choices; I recommend yes, yes and no.

**Take both source and a tree.** Dragon reads TSRX, JSX and HTML source itself, and frameworks with their own analysis, like Markless, can hand Dragon a described element tree instead. I recommend yes, because frameworks without an analyser then need no work, and Markless keeps its own knowledge of state instead of Dragon guessing it.

**Generate the browser's CSS from Dragon's result when a phone target is configured.** I recommend yes, because then the browser preview shows exactly what the phone will get, and Chrome tests that same output. The cost: in those projects the browser runs Dragon's generated CSS, not the author's text, so devtools rely on source maps to show the original file and line.

**Allow a React Native mode that matches class names on the device.** I recommend no, because it is the one design that lets styles go untested per state, and the lookup-table mode gives React Native users the same result without it.

Researched defaults, detailed above:
- open values fail only where a selector reads them;
- no ignore comments or per-call options;
- the state-count budget per element is set later from measurement.

## Sources (all accessed 2026-09-26)

- Tailwind CSS, "Detecting classes in source files": https://tailwindcss.com/docs/detecting-classes-in-source-files ("treats all source files as plain text", no interpolation).
- StyleX, "Defining styles": https://stylexjs.com/docs/learn/styling-ui/defining-styles/ ("all your styles to be statically analyzable"; dynamic styles become CSS variables).
- StyleX, "Using styles": https://stylexjs.com/docs/learn/styling-ui/using-styles/ (conditional styles through `&&` and ternaries, which are finite by construction).
- Svelte, "Scoped styles": https://svelte.dev/docs/svelte/scoped-styles (hash-class scoping); "Compiler warnings": https://svelte.dev/docs/svelte/compiler-warnings (`css_unused_selector` analyses template and style; `svelte-ignore` silences, which is the precedent Dragon rejects).
- react-native-css PR #462: https://github.com/nativewind/react-native-css/pull/462 (condition-only ancestors shipped unconditioned); NativeWind v5 overview: https://www.nativewind.dev/v5 and migration guide https://www.nativewind.dev/v5/guides/migrate-from-v4 (`:root.dark` rejected on native). Read through a search summary, not opened in full.
- yuku-analyzer README and `index.d.ts`, local checkout `~/dev/open-source/yuku` (no version field read; the workspace root has an empty `version`).

```json
{
  "goalbuddy_receipt_v1": {
    "result": "done",
    "task_id": "T011",
    "board_path": "/Users/jacksm5pro/dev/open-source/dragon/docs/goals/milestone-1/state.yaml",
    "decision": null,
    "full_outcome_complete": false,
    "rationale": "Recommend both: one versioned dragon/tree v1 as the only compiler input, Dragon-owned yuku front ends (tsrx, jsx, html), and framework-emitted trees (Markless) that go through the same validator. The missing semantic in both Markless's graph and frameless's EnrichedIR is a value domain per selector-read binding; domains are framework-neutral JS dataflow, and subscription is an opaque binding-site id. Wrong use is unreachable: targets only from config, compile() takes no options, blocked targets return no output, no ignore comments, digest-stamped deterministic outputs, and open domains read by selectors fail closed. Web CSS is generated from the same resolved table when a native target is configured. The dev delta is labelled paint or structure. React Native is a lookup-table emitter, not a runtime matcher.",
    "evidence": [
      "docs/goals/milestone-1/notes/T011-api-by-design.md",
      "~/dev/open-source/yuku/npm/yuku-analyzer/README.md",
      "~/dev/open-source/yuku/npm/yuku-analyzer/index.d.ts",
      "~/dev/open-source/yuku/npm/yuku-parser/README.md (lang includes tsrx)",
      "~/dev/open-source/markless/packages/compiler/src/passes/semantic-graph/types.ts",
      "~/dev/open-source/markless/packages/compiler/src/artifacts.ts (SemanticHostNode, SemanticTemplateRead, SemanticStateWrite)",
      "~/dev/open-source/markless/packages/compiler/src/passes/public-render/style-scopes.ts (scope is per module)",
      "~/dev/open-source/frameless/packages/compiler/src/schema.ts (EnrichedIR, TemplateNode, ExpressionSite)",
      "https://tailwindcss.com/docs/detecting-classes-in-source-files",
      "https://stylexjs.com/docs/learn/styling-ui/defining-styles/",
      "https://svelte.dev/docs/svelte/compiler-warnings",
      "https://github.com/nativewind/react-native-css/pull/462"
    ],
    "missing_evidence": [
      "Ownership granularity unresolved: pitfalls.md proves per file (scope hash), T018/T025 require per component; the tree carries both, and T009 decides.",
      "Domain inference precision on a real corpus (share of class/data bindings that come out finite) is unmeasured.",
      "Per-element state-count distribution and budget unmeasured.",
      "yuku type-alias resolution for literal unions assumed from SymbolFlags.TypeAlias, not exercised.",
      "react-native-css and NativeWind claims came from a search summary, not a full read."
    ],
    "blocked_tasks": [],
    "required_board_updates": [
      "Record T011 done with evidence notes/T011-api-by-design.md.",
      "Carry to T009 docs/api.md: dragon/tree v1 schema with Domain and Span; config-only targets; Compiled/TargetOutput/Blocked types; watch()/update()/explain(); react-native lookup emitter; project.authoredCss() for pitfalls.md's second Chrome reference.",
      "Owner questions: source plus tree input; web CSS generated from the resolved table when a native target is configured; no open runtime-matching React Native mode.",
      "Queue for implementation: Markless tree emitter with a domain pass (graph lacks value sets; style scope is per module, and Dragon needs per component)."
    ]
  }
}
```
