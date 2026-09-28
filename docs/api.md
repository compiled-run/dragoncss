# Dragon API

T021 revision, 2026-09-26. This is a design, not an implemented API or a support claim. TypeScript below is pseudocode; the small state example is self-contained TypeScript. The verification requirements below are work for implementation, not tests passed by this document.

The evidence is [T010: precedent](goals/milestone-1/notes/T010-api-precedent.md), [T011: design](goals/milestone-1/notes/T011-api-by-design.md), [T012: integration](goals/milestone-1/notes/T012-api-integration.md), [T018: CSS analysis](goals/milestone-1/notes/T018-css-semantic-analysis.md), the [platform playbook](research/platform-playbook.md), [pitfalls](research/pitfalls.md), [owner principles](goals/milestone-1/goal.md), [README](../README.md), [AGENTS.md](../AGENTS.md), and [F1–F25](goals/milestone-1/notes/T013-api-critique.json). Where earlier notes conflict, this revision follows the owner constraints and records unsettled scope under Owner decisions.

## 1. Audience and release boundary

Framework and tool authors pass CSS, immutable source contents and a described element tree to Dragon. App developers write CSS and use their framework's existing check command. Every compile checks every configured target, including while developing for the web. There is no per-call target, severity, tolerance or ignore option. A platform choice the compiler can derive from CSS and the element tree belongs to the compiler.

The public surface should stay small. Nothing is stable during `1.0.0-alpha.x`. The table describes intended tiers at 1.0; promotion requires the conformance cases in section 10. Unexercised contracts stay experimental instead of becoming 1.x promises.

| Tier | Surface | Milestone 1 |
|---|---|---|
| Stable candidate | `dragon`: `createProject`, `compile`, `check`, checked result envelope, `explain` | Implement the narrow slice below |
| Stable candidate | `dragon/diagnostics`: diagnostic types, code catalogue, `formatDiagnostic`; `dragon/support`: `querySupport` | Only evidence-backed answers; no raw profile export |
| Experimental | `dragon/tree`: snapshot/tree schema and `validateInput`; minimal framework adapter | Exercise multi-file and finite-state inputs before freezing |
| Experimental, deferred | Library artifacts, continuous application values, binding manifest, native emission, third-party adapters | No stable signatures or support promise |
| Internal, deferred | Watch patches, language service, overlay, parity helper, agent-guidance generator, source front ends | No exported subpaths in milestone 1 |
| Internal | CSS analyzer tables, backend interface, lowered operations, layout adapter, profile storage, fixture renderer | Excluded from the package export map |

Milestone 1 targets are web and the iOS layout preparation used by the Linux lane. It does not ship Swift or certify UIKit rendering. Milestone 2 (P4) adds android as a configured target with an SDK-integer floor (`android: { minSdk }`). Its output is analysis-only, like iOS. Generated UIKit Swift and Android Views Kotlin exist only inside the internal native lanes. No android support row is anything but `unsupported` until a native android case passes. macOS, email and other targets remain backend designs. No public `swift()`, `kotlin()`, `email()`, `watch()` or `parityCases()` is promised now. Backend names belong to the package facade; the semantic core knows CSS, element relationships and conditions only.

This serves the owner's design tests directly: local ownership and predictable merging help people and agents; one check catches other-target errors; adapters make input framework-neutral; backends own platform engineering; one result supplies all outputs. Support facts, fixes, floors and proof requirements are imported from profiles, never copied into this document as a support table.

## 2. Project input and checked results

### 2.1 One configuration, complete snapshots

```ts
type Targets = {
  web?: {};
  ios?: { minimum: string };
  android?: { minSdk: number };   // an integer API level, 29 to 36
};
type Configured<T> = Extract<keyof T, keyof Targets>;

export function createProject<const T extends Targets>(config: {
  projectId: string;
  targets: T;
}): Project<Configured<T>>;

interface Project<K extends string> {
  compile(input: FrontEndResult): Compiled<K>;
  check(input: FrontEndResult): CheckReport<K>;
}

type FrontEndResult = {
  producer: { name: string; version: string; schemaRevision: string };
  snapshot: SourceSnapshot;
  diagnostics: readonly Diagnostic[];
  tree: DraftTree | null;
  completeness: 'closed-application' | 'library' | 'unknown';
};
type SourceSnapshot = {
  projectId: string;
  revision: string;
  sources: readonly SourceFile[];
  assets: readonly { id: string; hash: string; bytes: Uint8Array }[];
  resolutions: readonly {
    from: SourceRef; specifier: string; kind: 'source' | 'css' | 'asset';
    to: string | null;
  }[];
};
type SourceFile = {
  ref: SourceRef;
  text: string;
  displayPath: string;
  virtualOf?: readonly { generated: Range; authored: Span }[];
};
type SourceRef = { uri: string; revision: string; hash: string };
type Range = { start: number; end: number };
type Span = Range & { source: SourceRef };
```

`targets` must be nonempty; malformed or unknown target configuration is diagnosed before compilation. Minimum OS versions are already chosen in [owner decision 6](decisions.md#platforms-docsresearchplatform-playbookmd-72); this draft requires explicit values pending only the choice of whether configuration may default to those profile-owned versions. The facade normalizes each backend's configuration and passes only CSS environment facts to the core. Android configuration uses an SDK integer: `android: { minSdk }` must be exactly that key, holding an integer from 29 to 36. Anything else, for example 28, 37, 29.5 or the string "29", is `DRAGON_CONFIG_INVALID`, with a fix. Apple configuration uses parsed version tuples, and email uses named client sets; these are not interchangeable `minimum` strings.

A source URI is canonical within a named project or immutable package identity, for example `dragon-source://demo/src/app.tsx`. It is independent of the checkout's absolute path. Virtual CSS has its own URI, text and mapping to its containing source. Hashes are verified over UTF-8 encoding of the exact text, without newline normalization; asset hashes cover exact bytes. Offsets are half-open UTF-16 code units. Dragon derives 1-based lines and columns, checks bounds and verifies referenced revisions. Producers convert byte offsets once at their boundary.

Stylesheets point to a source range containing their complete CSS text, excluding a surrounding `<style>` tag. The compiler slices that snapshot, never the disk. Unsaved editor contents therefore compile exactly as supplied. A preprocessor must supply its virtual CSS and mappings; a span alone is not CSS input. CSS `@import` and `url()` are resolved through the supplied resolution table. Missing entries or missing destinations are errors; cycles use the pinned CSS import semantics. Import conditions and position in the sheet stay intact. No network or file reads occur inside compilation.

The host discovers and reads dependencies before calling Dragon. Results report the source, stylesheet, asset and configuration dependencies actually used, including import edges and missing requests. Dragon copies input data and asset bytes into an immutable snapshot and freezes its results. The digest covers the complete input envelope, including source contents and revisions, assets, tree, diagnostics, ordered uses, resolutions, producer, normalized config, compiler, grammar, captured browser defaults, profiles and backend revisions. The same snapshot and pinned dependencies produce byte-identical artifacts; output contains no generated timestamp or absolute checkout path. The reference browser comes from the pinned proof environment, not a caller-selected oracle.

```ts
const input = framework.analyze(snapshot);
const compiled = project.compile(input);
const checked = project.check(input);
framework.report(checked);
```

`compile` consumes the entire front-end result. It never accepts a naked tree that could discard front-end errors. Both calls structurally validate input and retain all producer diagnostics, including errors recovered during parsing. `tree: null`, unknown completeness or any producer error blocks affected application outputs. The API cannot discover errors a producer deliberately omitted; that trust boundary is explicit in section 3.4.

### 2.2 No publishable partial output

```ts
type CheckReport<K extends string> = {
  ok: boolean;
  revision: string;
  digest: string;
  sources: readonly SourceFile[];
  dependencies: readonly Dependency[];
  diagnostics: readonly Diagnostic[];
  targets: { readonly [P in K]: 'checked' | 'blocked' };
};
type Compiled<K extends string> = CheckReport<K> & {
  outputs: { readonly [P in K]: ArtifactState };
  explain(query: ExplainQuery<K>): ExplainResult<K>;
};
type ArtifactState =
  | { kind: 'ready'; digest: string; files: readonly GeneratedFile[] }
  | { kind: 'analysis-only'; digest: string; reason: string }
  | { kind: 'blocked'; diagnostics: readonly Diagnostic[] };
```

`ready` means production artifacts passed compilation checks, not that this app has run every parity lane. `ok` means no compile errors across configured targets; it does not turn `analysis-only` into a shipping artifact. Milestone 1's iOS result is analysis-only even when Linux layout tests pass. The android result is analysis-only too. Its profile is all `unsupported` until a native android case passes, so a compile that declares any feature blocks android with `DRAGON_UNSUPPORTED_VALUE`: that is the fail-closed state. An android compile that declares nothing is `analysis-only`. Neither native output becomes `ready` before that target's native cases pass. Its lowered data is available to the internal harness, not through a public `properties()` reader. Failed lowering exposes no test-ready property list. Partial analyzer information may still support diagnostics and `explain`.

Front-end or shared semantic errors block all dependent outputs. A target-only error blocks that target and its previews; the overall check still fails. Integrations must gate an application build on `ok` and require `ready` for its shipping outputs. A blocked variant has no files or fallback CSS. No output reader bypasses validation.

The mapped output object replaces the ineffective `this` restrictions. For a literal web/iOS config, `outputs.android`, `outputs.macos` and `outputs.email` must be TypeScript errors; `outputs.android` exists only when `android` is configured, and `android: {}` is a type error. There is no unrestricted index signature. A configuration annotated as the wide `Targets` type loses the exact keys that are present and relies on runtime validation for target access and queries; preserve literal keys for static checks. Consumer tests include a negative case for each absent key and each removed reader; JavaScript callers receive a located configuration error for an unconfigured target request at the adapter boundary. Dynamically loaded configs are validated before creating the project.

A future development preview is a separate experimental value with `validity: 'current' | 'last-successful' | 'unavailable'`, current revision/digest and, if rendered, rendered digest. After milestone 1, when a native target is configured, the development preview defaults to that target's projection. Invalid edits never relabel old output as current. A preview is not an `ArtifactState` and cannot be supplied to the production artifact writer.

## 3. Element graph and finite states

### 3.1 Document roots, stylesheet order and ownership

The draft tree is JSON data with `schema: 'dragon/tree@0'` and an exact `schemaRevision`. It contains modules, component definitions and explicit document entries. Each entry names its document element, a root component instance, initial arguments and an ordered list of stylesheet uses. The document element is the only root for `:root`, root tokens and eventual screen defaults. Detached component tests create an explicit fixture document.

Each stylesheet use names its source span and either a component owner or the document. Components defined in the same module have separate owners, even if they share an extraction scope. No use infers ownership from file membership. Document order, import position, layer order and declaration order define the cascade; module traversal or filesystem order never decides it. Each document has its own ordered sheet uses, so two app entries need not share one global order.

```ts
type ClassSymbol = { owner: string; sheet: string; name: string };
type StyleUse = {
  id: string; css: Span;
  scope: { kind: 'component'; owner: string } | { kind: 'document' };
};
type DocumentEntry = {
  id: string;
  rootInstance: string;
  documentElement: string;
  styles: readonly string[];
  initial: readonly { state: StateRef; value: Scalar }[];
};
type StateRef = { instance: string; state: string };
type Scalar = string | number | boolean | null;
type Condition =
  | { kind: 'true' }
  | { kind: 'eq'; ref: StateRef; value: Scalar }
  | { kind: 'not'; value: Condition }
  | { kind: 'and' | 'or'; values: readonly Condition[] };
type State = {
  id: string; domain: readonly Scalar[]; initial: Scalar; origin: Origin;
};
type StateAlias = { local: StateRef; caller: StateRef };
type Choice<V> = readonly { when: Condition; value: V }[];
```

State references are qualified by component instance path, never an unqualified widget name. Instance paths are built from document ID, component call-site IDs and typed repeat keys. Template node IDs are local to a component; runtime node addresses also contain the instance path. Producers supply persistent template IDs, not authored array indexes. When a producer cannot preserve identity across an edit it must mark a rebuild; IDs must not silently move to another node.

Component calls supply typed arguments and explicit state aliases for controlled state. Aliases substitute caller state references through all parts of that instance, must have compatible domains, and cannot form cycles. Controlled state takes its initial assignment from the caller; the local default applies only to uncontrolled state. Entry arguments may override that default within its domain, but two explicit assignments to the same aliased state must agree. Arbitrary expressions are not aliases: a value derived from several states is a `Choice` with explicit conditions.

Each component has a root node list and typed parameter/slot declarations. Nodes are elements (tag, static attributes, conditional class symbols/attributes, children), literal text, component calls (definition, arguments, aliases, slot contents), projections (named slot), or branches (predicate and both arms). All authored fields carry an origin. Dynamic text and keyed repeats are experimental extensions; missing fixture data cannot be inferred. Raw HTML and unknown node kinds are errors for resolved native output.

Linking expands calls and slots into a logical element tree. Inheritance follows the actual insertion parent; projected children retain their authored owner. Matching walks that logical ancestry, never a generated shadow host or merged native text view. A scoped selector may test its own element and same-owner ancestors, including explicitly forwarded class symbols, plus document conditions. A caller-owned `.row` forwarded onto a headless button remains the caller's symbol. A library's `.row` is distinct. Two components in one module also have distinct owners: forwarding a token grants that token's placement, not access to all of the callee's internal classes.

### 3.2 Reachability and value identity

A domain is a nonempty list of typed JSON scalar values. Boolean `true`, string `"true"` and number `1` are different; comparisons use type plus value, not stringified map keys. Non-finite numbers and negative zero are rejected. A `Choice` must select exactly one value for each reachable assignment: overlapping or missing arms are errors. Attribute absence is represented by `null`, while the empty string means a present attribute. Branches have explicit predicates and complements, with both arms checked.

Reachability is represented as a condition over declared domains and verified alias constraints. Producers may over-approximate writes; they cannot discard a combination without supplying their analysis justification. Unknown reads of a style-relevant predicate block compilation. Initial assignments choose startup output and do not remove later states. Independent properties retain symbolic conditions; the compiler combines conditions only where values, structure or inheritance interact. This does not require a Cartesian table of whole-component styles. Test coverage is a separate concern and must not be pruned by the resolver's output hash.

The following complete state model is a reduced switch fixture inspired by the Markless playground switch described in T011/T012 and the original API draft. It repeats the `dragon/tree@0` types from sections 2.1, 3.1 and 6.1 so the block compiles on its own, and uses `DocumentEntry`, `State`, `StateAlias`, `Condition` and `Choice` directly. It is not a complete tree payload or framework front end. It demonstrates two instances, controlled aliases, state-derived classes and `ui-*` attributes, a two-input condition, branch reachability and initial values. Offsets and the SHA-256 hash refer to the fixture's own immutable source string.

```ts
type SourceRef = { uri: string; revision: string; hash: string };
type Span = { start: number; end: number; source: SourceRef };
type Origin =
  | { kind: 'authored'; span: Span }
  | { kind: 'inherited'; element: string; from: Origin }
  | { kind: 'builtin'; dataset: string; entry: string }
  | { kind: 'generated'; pass: string; causes: readonly Origin[] }
  | { kind: 'unlocated'; reason: string };
type Scalar = string | number | boolean | null;
type StateRef = { instance: string; state: string };
type DocumentEntry = {
  id: string; rootInstance: string; documentElement: string;
  styles: readonly string[];
  initial: readonly { state: StateRef; value: Scalar }[];
};
type State = {
  id: string; domain: readonly Scalar[]; initial: Scalar; origin: Origin;
};
type StateAlias = { local: StateRef; caller: StateRef };
type Condition =
  | { kind: 'true' }
  | { kind: 'eq'; ref: StateRef; value: Scalar }
  | { kind: 'not'; value: Condition }
  | { kind: 'and' | 'or'; values: readonly Condition[] };
type Choice<V> = readonly { when: Condition; value: V }[];
type ClassSymbol = { owner: string; sheet: string; name: string };

const source = 'switch checked=false disabled=false; ui-checked; ui-disabled; knob; label';
const sourceRef: SourceRef = {
  uri: 'dragon-source://switch/fixture', revision: '1',
  hash: '15f7f7060028580006ec87dc00309aef584b8818e24a6ac212e7332519de5a3f',
};
const fixtureOrigin = (word: string): Origin => {
  const start = source.indexOf(word);
  if (start < 0) throw new Error('Missing fixture source');
  return { kind: 'authored', span: { source: sourceRef, start, end: start + word.length } };
};
const states = [
  { id: 'checked', domain: [false, true], initial: false, origin: fixtureOrigin('checked=false') },
  { id: 'disabled', domain: [false, true], initial: false, origin: fixtureOrigin('disabled=false') },
] as const satisfies readonly State[];
const instances = ['doc/a', 'doc/b'];
const aliases: readonly StateAlias[] = instances.flatMap(instance => states.map(state => ({
  local: { instance: `${instance}/root`, state: state.id },
  caller: { instance, state: state.id },
})));
const entry: DocumentEntry = {
  id: 'doc', rootInstance: 'doc', documentElement: 'html', styles: ['demo-css'],
  initial: instances.flatMap(instance => states.map(state => ({
    state: { instance, state: state.id }, value: state.initial,
  }))),
};
const key = (ref: StateRef): string => JSON.stringify([ref.instance, ref.state]);
type Values = Readonly<Record<string, Scalar>>;
const initial: Values = Object.fromEntries(entry.initial.map(item => [key(item.state), item.value]));
function read(ref: StateRef, values: Values): Scalar {
  const seen = new Set<string>();
  while (true) {
    const id = key(ref);
    if (seen.has(id)) throw new Error('Alias cycle');
    seen.add(id);
    const alias = aliases.find(item => key(item.local) === id);
    if (alias === undefined) {
      const value = values[id];
      if (value === undefined) throw new Error('Unassigned state');
      return value;
    }
    ref = alias.caller;
  }
}
function matches(condition: Condition, values: Values): boolean {
  switch (condition.kind) {
    case 'true': return true;
    case 'eq': return read(condition.ref, values) === condition.value;
    case 'not': return !matches(condition.value, values);
    case 'and': return condition.values.every(value => matches(value, values));
    case 'or': return condition.values.some(value => matches(value, values));
  }
}
function choose<V>(choice: Choice<V>, values: Values): V {
  const selected = choice.filter(arm => matches(arm.when, values));
  const arm = selected[0];
  if (selected.length !== 1 || arm === undefined) throw new Error('Non-exhaustive or overlapping choice');
  return arm.value;
}
function booleanChoice<V>(when: Condition, yes: V, no: V): Choice<V> {
  return [{ when, value: yes }, { when: { kind: 'not', value: when }, value: no }];
}
function switchFixture(instance: string) {
  const checked: Condition = { kind: 'eq', ref: { instance: `${instance}/root`, state: 'checked' }, value: true };
  const disabled: Condition = { kind: 'eq', ref: { instance: `${instance}/root`, state: 'disabled' }, value: true };
  const enabledChecked: Condition = { kind: 'and', values: [checked, { kind: 'not', value: disabled }] };
  const symbol = (name: string): ClassSymbol => ({ owner: 'Demo', sheet: 'demo-css', name });
  return {
    instance,
    nodes: [
      { id: 'trigger', tag: 'button', origin: fixtureOrigin('switch') },
      { id: 'knob', tag: 'span', parent: 'trigger', origin: fixtureOrigin('knob') },
      { id: 'label', tag: 'span', parent: 'trigger', origin: fixtureOrigin('label') },
    ],
    classes: [
      { node: 'trigger', value: [{ when: { kind: 'true' }, value: symbol('switch') }] satisfies Choice<ClassSymbol | null> },
      { node: 'trigger', value: booleanChoice<ClassSymbol | null>(enabledChecked, symbol('on'), null) },
    ],
    bindings: [
      { node: 'trigger', name: 'ui-checked', value: booleanChoice<Scalar>(checked, '', null), origin: fixtureOrigin('ui-checked') },
      { node: 'trigger', name: 'ui-disabled', value: booleanChoice<Scalar>(disabled, '', null), origin: fixtureOrigin('ui-disabled') },
      { node: 'trigger', name: 'aria-checked', value: booleanChoice<Scalar>(checked, 'true', 'false'), origin: fixtureOrigin('ui-checked') },
    ],
    branch: { node: 'label', when: checked, yes: 'On', no: 'Off', origin: fixtureOrigin('label') },
  };
}
const a = switchFixture('doc/a');
const b = switchFixture('doc/b');
function render(fixture: ReturnType<typeof switchFixture>, values: Values) {
  return {
    attributes: Object.fromEntries(fixture.bindings.map(binding => [
      binding.name, choose(binding.value, values),
    ])),
    label: matches(fixture.branch.when, values) ? fixture.branch.yes : fixture.branch.no,
    classes: fixture.classes.flatMap(binding => {
      const symbol = choose(binding.value, values);
      return symbol === null ? [] : [symbol.name];
    }),
  };
}
const observed = [];
for (const checked of states[0].domain) {
  for (const disabled of states[1].domain) {
    observed.push(render(a, {
      ...initial,
      [key({ instance: 'doc/a', state: 'checked' })]: checked,
      [key({ instance: 'doc/a', state: 'disabled' })]: disabled,
    }));
  }
}
if (observed.length !== 4) throw new Error('Incomplete fixture');
const changed = { ...initial, [key({ instance: 'doc/a', state: 'checked' })]: true };
if (render(a, changed).label !== 'On' || render(b, changed).label !== 'Off') {
  throw new Error('Instances are not independent');
}
```

The authored CSS fixture can make `.switch[ui-checked] .knob` change its margin. That decision depends on an ancestor but uses the same instance-qualified checked state. Four assignments are reachable per switch; there are sixteen joint assignments for two independent switches unless a separately proven independence rule permits factoring. The example does not claim transition, shadow or layout support for any target.

### 3.3 Library linking and open classes

A published library is not a closed application. An experimental library artifact contains its immutable sources, component definitions, scoped CSS, parameter/slot requirements, producer and schema versions, and unresolved style predicates. Publication checks local syntax, local ownership and requirements that can be decided locally. It reports `requires-link`, never application parity or universal native support.

At consumption, the application linker specializes each call site, preserves forwarded symbol identity and substitutes state aliases. It discharges all style-relevant requirements against the consumer graph, or reports the failure at the call with a related library span. This supports headless components that forward `class` and children without demanding every future caller at publication.

Class analysis asks whether each selector-relevant token is present. A guaranteed base token remains known when an unrelated open class string is appended. Unknown tokens matter only if they can affect a selector after linking. If membership of `.primary` remains unknown and a rule reads it, that predicate blocks the resolved output; the whole class string need not be enumerated. Unseen CSS or a later unanalysed consumer invalidates the closed-application claim. A publish-and-consume fixture with a class-forwarding button is required before this artifact becomes public.

### 3.4 Validation is not a proof of the producer

```ts
export function validateInput(input: unknown):
  | { ok: true; input: ValidatedInput; diagnostics: readonly Diagnostic[] }
  | { ok: false; diagnostics: readonly Diagnostic[] };
```

Validation checks the schema, source hashes/ranges, unique IDs, roots, linking, domains, aliases and exhaustive choices. A successful validation means structural validity. Evidence spans give provenance; finding a literal at a span cannot prove that the producer found every write or caller.

A producer must account for imports, exported entry points, all style-relevant writes, projections, opaque calls and external inputs. Unknown results fail closed. Producer conformance tests compare independently known fixture behavior with emitted domains, including an omitted write, a recovered syntax error, unknown caller, alias cycle and invalid initial value. The omitted-write test must expose the producer's error; structural validation alone cannot do so. Generated boundary checks reject values outside a domain in development and at untyped/serialized release entry points. Native finite-state setters take generated enums or booleans; typed setters alone do not protect a JavaScript or deserialization boundary. Invalid updates leave the previous valid state intact and report a located error; they never coerce into another state.

## 4. One result, backend lowering and runtime wiring

### 4.1 Three stages with different jobs

1. **Resolved CSS:** the core joins sheets and the logical tree, resolves symbols, variables, cascade, inheritance and conditions. It records winning declarations and typed CSS values per element/property/condition. This stage contains no native properties.
2. **Backend lowering:** each backend chooses compatible implementations for an element or subtree. Its immutable lowered program records generated topology, operations, measurement dependencies and origin mappings. This stage owns platform names and native property values.
3. **Projections:** native source and expected native property dumps are both emitted from that same lowered program. Web CSS is emitted from the resolved CSS within the same compilation result. A native-target web preview projects that target's resolved conditions and approved semantic policy; it is labelled with the target and digest.

```ts
function compileBackend(resolved: ResolvedCss, backend: Backend) {
  const lowered = backend.lower(resolved);
  if (lowered.kind === 'blocked') return lowered;
  return {
    files: backend.emitCode(lowered.program),
    expected: backend.projectExpectedDump(lowered.program),
    layout: backend.projectLayoutInput(lowered.program),
  };
}
```

Emitters cannot re-resolve CSS, rematch selectors or independently choose techniques. A shared digest detects mixed artifacts but is not evidence that emitters are correct. Device tests must still compare actual generated-code dumps with expected dumps and Chrome. A web-versus-layout test alone does not prove Swift property writes or native paint.

The internal lowered schema is versioned per backend and carries: generated node ID and kind; parent and sibling order; authored-node-to-generated-node mappings, including text ranges; creation/removal conditions; literal or fixture-provided content; all resolved text attributes; asset hashes; font identity and metrics; measure constraints and callbacks by algorithm ID; explicit layout fields; property writes; and dependencies of updates. Shadow/clip splits and merged text are represented as topology, not a list of opaque generated IDs. Every layout-engine field is set explicitly from CSS semantics, including browser defaults captured as versioned data.

The Linux lane consumes the backend's layout projection of these operations with a pinned layout engine and Ahem measurement contract. It proves that mapping and geometry within the stated environment. It cannot prove device text shaping, hit testing, paint or platform APIs. Numeric color and resolved-value checks in Chrome verify resolution; native paint claims require a rendering lane. Proof records name the aspect they cover, so a Linux layout result cannot promote an entire UIKit rendering claim.

### 4.2 Binding manifest, experimental until a real integration passes

A future binding manifest has its own schema version and compiler digest. It maps template nodes and component call sites to instance addresses, generated nodes and web hooks. Each binding declares the qualified state/input, domain, initial value, affected descendants, generated setter name and input type. It also describes mount, register, initial apply, update, removal and disposal. Repeats use typed stable keys unique within their parent; removing and recreating a key creates a new instance generation so stale callbacks cannot update the new node.

The manifest supplies a web attribute mutation program and native setter symbols from the same condition dependencies. Static `hostAttributes` are insufficient. State updates are atomic: update the state, recompute the precompiled affected decisions, apply removals and writes, then perform layout/paint. No selector matching occurs during that update.

```ts
const handles = new Map<string, InstanceHandle>();
for (const key of ['a', 'b']) {
  const address = { document: 'doc', path: [{ site: 'switch', key }], generation: 1 };
  const handle = bindings.mount(address, manifest.components.Switch);
  bindings.register(handle, framework.createNodes(handle, manifest));
  bindings.initialize(handle, { checked: false, disabled: false });
  handles.set(key, handle);
}
const first = handles.get('a')!;
framework.onChecked('a', checked => bindings.setChecked(first, checked));
bindings.setChecked(first, true);
framework.assertAttribute(handles.get('a')!, 'trigger', 'ui-checked', '');
framework.assertAttribute(handles.get('b')!, 'trigger', 'ui-checked', null);
framework.assertSelectedCase(first, 'knob', 'checked');
bindings.dispose(first);
handles.delete('a');
```

Here `bindings` is framework glue generated from the manifest. Its generated signature is `setChecked(handle: InstanceHandle, checked: boolean): void`; it updates the root's attribute and the descendant knob's resolved case for that instance. On native the corresponding generated method writes properties directly. Initial values apply before the first visible frame; removal releases generated wrappers, subscriptions and layout nodes. Registering the wrong template/digest, using a duplicate repeat key or updating a disposed handle is an error. The example specifies the adapter's required behavior; no release Dragon runtime library or implemented integration is implied.

### 4.3 Continuous values are a separate contract

Finite style decisions are resolved at build time. Screen size, measured content and approved platform mechanisms can still supply used values through proven backend algorithms. Arbitrary continuous application bindings are experimental; their release scope is a remaining owner decision. A `<length>` label alone does not define a wire value or make an expression supported.

A future value boundary must use structured values, for example the following deliberately small candidate, never raw CSS strings:

```ts
type RuntimeValue =
  | { kind: 'number'; value: number }
  | { kind: 'length'; unit: 'px'; value: number }
  | { kind: 'percentage'; value: number }
  | { kind: 'color'; space: 'srgb'; channels: readonly [number, number, number]; alpha: number };
type Residual =
  | { op: 'literal'; value: RuntimeValue }
  | { op: 'input'; id: string; type: RuntimeValue['kind'] }
  | { op: 'add'; left: Residual; right: Residual }
  | { op: 'scale'; value: Residual; factor: number };
```

All numbers must be finite; color channels and alpha are in `[0, 1]`; percentages use `100` for a whole; `px` means CSS pixels before backend conversion. Property grammar and declared input ranges constrain negative and maximum values. Inputs cannot change unit/type between updates. Every expression has a checked dimension, explicit percentage basis, dependency list and generated evaluation algorithm. Other units/functions require explicit representations and proofs. This is a draft algebra, not the grammar of supported CSS.

A changed input propagates through the compiled dependency graph to affected writes and measurement invalidations. Invalid values fail before mutation, with the boundary behavior in section 3.4. Each selected backend needs a proven lowering over the declared value range and context, including boundary cases; enumerating a few samples is not finite-state completeness. With no such lowering the build fails. The previous claim that a progress expression works on every target is withdrawn.

### 4.4 Release code and dependencies

The only external Dragon-related library required on a device is the layout engine. Native framework calls, platform callbacks, layout bridges and any needed small helper algorithms are emitted as source with the component/backend output. No `DragonRuntime` or `dragon-runtime` package containing CSS algorithms is part of this contract. Platform SDK libraries and the host application's own framework are outside this restriction.

Generated helpers may evaluate only precompiled operations over typed state, content measurements, layout geometry, scroll offsets, time or environment inputs. They cannot receive CSS text, resolve the cascade, match selectors or discover new style states. Helpers have a TypeScript reference, shared vectors for native output and a device fixture before use. Balance search, sticky clamps and transition reversal remain future techniques, not milestone 1 support. A debug property applier is deferred and would need dump equality with release code.

The core compiler and web emitter are synchronous TypeScript/JavaScript. The proposed dependency path is `dragon -> Dragon analysis/emitter -> pinned browser-safe parser/grammar data`. T018's css-tree plus webref proposal supplies grammar matching after variable substitution; it does not supply support facts. Web serialization/lowering for the milestone subset is Dragon-owned TypeScript. Lightning CSS is removed from this required path, and there is no hidden WASM initialization, binary download or top-level await.

Native front-end packages, if the owner chooses Dragon-maintained source readers, must be separately installed optional packages; an export subpath alone does not isolate installation dependencies. Yuku belongs there, not in the core dependency graph. The Dragon layout engine is a separate internal TypeScript module used by the test lanes; it does not load on importing the compiler. Before a browser-safe claim ships, package-consumer tests must import and synchronously compile in Node and a browser worker without yuku, Lightning CSS, Node built-ins, native bindings or an implicit asset fetch.

## 5. CSS analysis and backend selection

The internal analyzer follows T018: cross-file definitions/references for classes, custom properties, keyframes, layers, font families and containers; values checked against the correct grammar after per-condition `var()` substitution; a custom-property dependency graph; cascade winners and losers; and matching joined with element ownership, logical ancestry and text context. Variable inheritance is computed at the declaring element. Unknown style-relevant values and invalid-at-computed-time values produce diagnostics, not guessed defaults.

```ts
analysis.definitionsOf(symbol);
analysis.readersOf(symbol);
analysis.typeOf(declaration, { element, condition });
analysis.dependencyGraph(element);
analysis.winnersFor(element, property);
analysis.matchesFor(selector);
analysis.inheritedFrom(textNode, property);
analysis.textContextOf(element);
```

These calls are internal. `explain` is the narrow public view; broader read-only queries remain deferred under the researched defaults below. The compiler detects specificity-only conflicts where two declarations can meet on a real element. It reports the winning rule, the losing rule and a concrete fix. This gives agents the locality and predictable merging sought in the owner facts without inventing a second styling language. The optional typed-object input remains for T005 to evaluate.

The core gives backends facts in CSS terms: known geometry, static content, overlapping descendants, clipping, stacking contexts, visibility, inherited text attributes and font references. It neither selects an iOS view class nor names an Android drawing API. Package configuration, backend registries and platform diagnostics sit outside this semantic core. Dependency checks enforce that core modules cannot import backend modules.

Backend planning selects a compatible plan for an element or affected subtree, not one cheapest technique per declaration. Techniques declare required geometry/content, resources they own, ordering, clipping boundaries, text representation and composition exclusions. Candidate plans must satisfy all requirements at the configured floor and have applicable proof. Among proven compatible plans, prefer fidelity first, then cost, then a stable technique-ID ordering. A cheaper approximation cannot displace an available exact plan. A plan containing incompatible layer owners is an error.

The playbook's six technique kinds remain internal: native property, owned paint, shader, text-engine hook, build-time fold and generated runtime helper. Their support, value subsets, requirements, costs and proof come from profiles. Joint tests cover opacity with overlapping children, clipping with shadows, transforms with hit testing and text hooks with measurement. Passing each isolated row is insufficient proof of the combination. [Owner decision 8](decisions.md) already allows expensive techniques and requires every use in the build summary; each still needs its implementation and proof before use.

CSS environment conditions stay separate from application state. The core can evaluate CSS media features and `@supports` using profile-backed answers; it has no `interactive` flag or email-specific rule. Removing hover capability may fold a hover condition but cannot set a widget's `checked` state to false. An experimental static backend such as email requires explicit render assignments and content, which may include `checked=true`, or rejects unresolved runtime dependencies. No new platform pseudo-feature is added to the public CSS contract here.

Actual web output targets the configured web environment. A preview for iOS or another backend is a separate named projection with that target's environment and policy digest. There is no single web artifact claimed to show several conflicting environments at once. Every target is still checked in the same compile, regardless of which preview is displayed.

## 6. Diagnostics, explanations and support queries

### 6.1 Resolvable locations and guarded fixes

```ts
type Origin =
  | { kind: 'authored'; span: Span }
  | { kind: 'inherited'; element: string; from: Origin }
  | { kind: 'builtin'; dataset: string; entry: string }
  | { kind: 'generated'; pass: string; causes: readonly Origin[] }
  | { kind: 'unlocated'; reason: string };
type Diagnostic = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  target: string | null;
  origin: Origin;
  message: string;
  why: string;
  related: readonly { origin: Origin; message: string }[];
  fix: Fix | null;
  profile: ProofRef | null;
};
type Fix =
  | { title: string; edits: readonly { span: Span; replacement: string }[] }
  | { title: string; manual: string };
export function formatDiagnostic(diagnostic: Diagnostic, sources: readonly SourceFile[]): string;
```

Every diagnostic transport includes the revisioned source registry from the check report. A CLI JSON consumer never has to guess which file a local integer means. Configuration errors and malformed input may be unlocated; built-in and generated values do not invent authored spans. Fixes require the exact source revision and hash in each span, apply atomically across files and fail as stale if any precondition differs.

Messages, severities and support reasons come from the shared diagnostic catalogue and profiles. A missing implementation, lost proof or dropped declaration is an error. A warning can describe a measured approximation, a specificity conflict, a proven implementation's scheduled deprecation or a cost; it cannot mean the style was omitted. Frameworks render the same objects in editor, terminal and eventual overlay without rewording them.

Milestone 1 adds `formatDiagnostics(diagnostics, sources)` alongside `formatDiagnostic`. It groups diagnostics that are identical except for their target into one block that lists the targets. Diagnostic objects themselves stay one per target.

### 6.2 Explanations address targets and conditions

```ts
type ExplainQuery<K extends string> = {
  target: K;
  at: { node: string; instance: string } | { source: SourceRef; offset: number };
  property?: string;
  assignment?: readonly { state: StateRef; value: Scalar }[];
};
type ExplainResult<K extends string> =
  | { kind: 'found'; target: K; cases: readonly ExplainedCase[] }
  | { kind: 'choose-instance'; candidates: readonly { node: string; instance: string }[] }
  | { kind: 'not-found'; reason: string }
  | { kind: 'invalid-query'; diagnostics: readonly Diagnostic[] };
```

Each explained case names its element, instance, target and symbolic condition, winning origin, losing origins/reasons, custom-property chain, typed CSS value and contextual support decision. Partial assignments leave the other conditions visible. A source-position query first finds authored nodes/declarations, then their linked instances; an ambiguous position returns candidates, never an arbitrary instance. Stale revisions, invalid states and unknown targets are invalid queries. Synthetic defaults and inheritance use `Origin`. A future CLI position query converts 1-based line/column through the same source registry and calls this API.

### 6.3 Possibilities are not contextual support

Milestone 1 shape (exported from the default entry):

```ts
type NormalizedTarget = { kind: 'web' } | { kind: 'ios'; minimum: string } | { kind: 'android'; minSdk: number };
type SupportQuery<K extends string> =
  | { kind: 'possibilities'; target: NormalizedTarget; css: string }
  | { kind: 'resolved'; result: Compiled<K>; target: NoInfer<K>; node: string; instance: string; assignment: Assignment; property: string };
type SupportCandidate = { feature: string; context: string; status: Exclude<Status, 'unsupported'>;
  proofs: readonly { lane: string; cases: readonly string[]; tolerance: 'gate-1-device-px' | 'dual-exact' }[] };
type SupportAnswer =
  | { kind: 'needs-context'; declaration: string; candidates: readonly SupportCandidate[] }
  | { kind: 'unsupported'; declaration: string; reason: string }
  | { kind: 'decided'; cases: readonly { assignment: Assignment; decision: SupportCandidate | null }[] }
  | { kind: 'blocked'; diagnostics: readonly Diagnostic[] }
  | { kind: 'invalid-query'; diagnostics: readonly Diagnostic[] };
```

A declaration with any supported row answers `needs-context`, listing its contexts. A declaration with no row answers `unsupported`. An android possibilities query needs `{ kind: 'android', minSdk }` with an integer from 29 to 36. Today it answers `unsupported` for every declaration, because no android row is proven.

```ts
export function querySupport<K extends string>(query:
  | { kind: 'possibilities'; target: NormalizedTarget; css: string }
  | { kind: 'resolved'; result: Compiled<K>; target: NoInfer<K>;
      node: string; instance: string; condition: Condition; property: string }
): SupportAnswer;
```

A possibilities answer lists profile-backed candidate value subsets and their requirements. If applicability needs tree, geometry, clipping or content facts, the answer is `needs-context` with those requirements, not an unconditional support status. No applicable data means `unsupported`. A resolved query uses the checked element/condition and returns the actual selected plan's support decision or a blocked result.

For resolved queries, `K` comes from the compiled result; `NoInfer<K>` prevents the requested target from widening those keys. A web-only result therefore rejects an iOS query. Wide `Targets` configurations and JavaScript callers rely on runtime validation against the actual configured targets, as in section 2.2.

Each proof reference includes profile version, backend revision, fixture IDs/results, value subset, context, measured aspect, reference browser, lane/environment and tolerance ID. There is no free-form tolerance option. No status above `unsupported`, including `no-effect`, may appear without its passing comparison tests. The document supplies no duplicate literals for live support facts. Editors and generated documentation call the same query rather than reading an internal profile schema.

## 7. Parity and semantic references

Milestone 1 uses a Dragon-owned internal fixture renderer for its finite tree subset. It constructs authored logical markup, applies source-derived assignments and literal content, sets environment inputs, then waits for fonts, images and layout to settle. It does not reconstruct the authored reference from resolved properties. Each case carries actual text, asset identities, component arguments and, when introduced, repeat rows/keys. Missing required data is an incomplete case and cannot pass.

A future framework fixture driver must implement mount, apply assignment/content, settle, capture and dispose for both authored and generated rendering, with a timeout producing failure. It must not depend on manually remembered state mutations. The same two-instance/ancestor-update case used for binding conformance must run through the driver before a public parity helper ships.

Every case binds a configured target, normalized floor/client set, backend revision, lane and reference environment. The environment includes viewport dimensions, DPR, direction, color scheme, pointer and hover capabilities (including `any-*` when read), reduced motion, fonts and text-size policy. Boundaries of media conditions, largest supported text size and right-to-left are explicit coverage requirements. Continuous widths/content are not magically enumerated: finite conditions receive coverage, and ranges require algorithm proof plus named boundary fixtures. An unsupported required case is reported, never silently removed.

The oracle has three distinct checks:

- Authored Chrome behavior versus compiled web behavior checks cascade resolution, values, structure and content for every reachable source case in the declared coverage set.
- Compiled web versus the backend's layout projection checks layout mapping and engine behavior in that environment.
- Actual native output versus the expected dump and Chrome checks code generation and native behavior when a device lane exists.

No source case may be removed because Dragon resolved it to the same properties as another. In milestone 1, do not deduplicate case execution. Any later optimization first captures authored behavior for every case and proves equivalence using structure, text/content, environment, relevant computed values and numeric observables; only then may it share a native execution. Reports retain every covered source case. A deliberate faulty resolver that collapses checked/unchecked values, plus a color-only faulty resolver, must make the harness fail before it is trusted.

Boxes use the milestone's one-device-pixel gate. Supported non-layout claims additionally require numeric computed-value and paint evidence: for example color channels and pixel-region differences with profile-owned thresholds. Screenshots and AI judgment are evidence only. A layout pass does not certify paint. Never widen tolerances, delete a check or skip a case to obtain a pass.

Reports distinguish complete required coverage, a requested subset, mismatches and unavailable required lanes. Subsets cannot upgrade whole-profile claims. Linux layout verification names its actual scope; iOS simulator coverage is unavailable until that lane runs. A required unavailable lane fails that run rather than being counted as a pass. Known unsupported cases may be recorded separately as negative tests, but do not count toward passing parity coverage.

### 7.1 Intentional semantic changes need their own reference

For unchanged CSS semantics, authored and compiled output must match directly. Milestone 1 keeps that strict comparison and uses fixed viewport/Ahem fixtures; it does not silently add phone normalization to the reference.

The owner-approved visible-screen meaning of `100vh`, safe-area root and keyboard defaults belong to the later native milestone. For each normalization, a versioned reference policy must state the intended behavior independently of lowering and test it against explicit reference markup/CSS and numeric expectations. For visible height this includes browser-chrome changes, the chosen viewport box and keyboard behavior. Authored output is still captured and any intentional difference is attributed to that policy, not suppressed as a generic mismatch.

Font metric overrides and text-size scaling can change authored geometry and cannot inherit an authored-equality claim. Shared font metrics remain an owner choice. Text scaling is already recorded in [owner decision 5](decisions.md): `rem` follows the phone's text-size setting, `px` stays fixed, every component is tested at the largest text size, and clipping in a fixed-height box produces a warning. Its reference mapping and fixtures still need implementation. Tests must separately cover unchanged declarations and any approved transformed reference, with the same tolerances. Policies are generated defaults, not settings developers must remember. Text environment types and universal parity claims cannot be frozen before the remaining font decision and these fixtures.

## 8. Host adapter, CLI and edits

The host owns source discovery, reading unsaved buffers, resolution, framework analysis and diagnostic presentation. The core neither loads config files nor executes application code. A minimal experimental adapter supplies the complete inputs, not just targets:

```ts
interface ProjectAdapter {
  load(): Promise<{
    config: { projectId: string; targets: Targets };
    input: FrontEndResult;
    installedArtifacts: readonly { kind: string; version: string; digest?: string }[];
  }>;
}
```

The asynchronous operation belongs to host I/O. After loading, compile/check remain synchronous and pure. The adapter explicitly declares whether native artifacts exist; when native output ships, its layout ABI and generated manifest versions must agree with installed artifacts. A missing required artifact is an error, not an empty successful check. No Swift/Gradle lockfile reader is required inside the milestone 1 core.

Milestone 1's CLI is limited to `dragon check` and `dragon support`, using an explicitly selected adapter or the internal fixture adapter. There is no guessed framework discovery. `check [paths]` always analyzes the complete document/dependency graph and all configured targets; paths filter display only. Global errors are still shown, JSON includes the full report and exit status reflects all errors. `support` uses the same normalized configuration; `needs-context` is not success in an eligibility check. Other CLI commands stay deferred. Human output is formatted from the same objects as JSON.

Whole snapshots are the milestone 1 edit contract. A new compile atomically replaces the previous input, including deletions, module ownership, changed assets and diagnostics. An asset-only change changes the digest and invalidates users through dependency edges. An invalid snapshot has current errors and blocked artifacts; the host may retain a separately labelled last successful preview. Fixing the edit recompiles the new snapshot from scratch.

Watch deltas and a language-service update API stay internal until they can prove equivalence with fresh compilation. Their eventual protocol must include base/next revisions and digests, atomic source/module/asset additions and removals, dependency invalidation, explicit identity remapping or rebuild, and full resynchronization on a stale base. Insertion/reordering cannot reuse another node's identity. Tests must cover additions, deletion, asset changes, failed edits and recovery. Removing the underspecified `update(path, tree)` API avoids freezing a patch format before these rules are exercised.

## 9. Compatibility and proof changes

Schema version and package version are separate. Draft `@0` inputs require an exact revision match; there is no compatibility promise yet. Before a stable `@1`, accept the prior stable schema alongside a next schema for at least one compiler minor, then remove the old one only in a package major. An older compiler presented with an unknown schema rejects it before analysis and names the required version.

Within a stable schema, a compatible addition is an optional field with a documented default that preserves old behavior and can safely be ignored by old readers. New required fields, node kinds, operation variants or changed meanings need a new schema version. Exhaustive public discriminated unions do not gain cases in a minor release. Producer-owned `data` is inert metadata and cannot hide new semantics. Compatibility fixtures run old producer/new compiler and new producer/old compiler, including explicit rejection of unsupported constructs.

Diagnostic codes use readable `DRAGON_*` names and are never reused. Keep the emitted `code` unchanged throughout a package major. A display-name change does not rename the wire code. There is no promised redirect that secretly breaks `diagnostic.code === oldCode`. A later major may introduce an explicit alias catalogue, with compatibility tests, but redirects are not part of this small surface.

Profiles are pinned with the compiler and lockfile. The following transitions separate release compatibility from evidence:

| Change | Required behavior |
|---|---|
| Proven implementation scheduled for removal | May warn while that implementation and its proof remain valid at the advertised fidelity; name the planned breaking version |
| Missing/invalidated proof, absent implementation or wrong output | Immediately `unsupported` and block; no warning grace period |
| Exact becomes a measured caveat/approximation | Invalidate the exact claim immediately; report the fidelity change and its new proof; only emit if the profile's release policy permits that measured result |
| Supported becomes unsupported by scope choice | Deprecate only while old support is still proven; block once removed |
| Promotion | Require passing proof for the specific value subset, context, environment and composed plan |

Upgrade reports must separate deprecation, fidelity change, proof invalidation and missing output. Compatibility cannot preserve a false claim. Profiles remain the only source of status and severity; research proposals never promote a row.

## 10. Milestone 1 acceptance and deferred work

The implementation package must exercise the public compile/check entry point, not just an internal resolver. Its required corpus remains at least 100 box/flex fixtures through compile, Dragon layout and Chrome at one device pixel, plus the side-by-side report and profile-to-passing-fixture links. The API does not reduce that oracle.

The milestone-1 `dragon/tree@0` subset includes document entries, modules, component definitions and ordered stylesheet uses; element nodes with static and finite conditional classes/attributes; literal text nodes; component-call nodes with finite arguments and state aliases; named-slot projection nodes; and branch nodes with explicit predicates and both arms. Calls, aliases, projections and branches are in scope. Dynamic text, keyed repeats, continuous application values and published library artifacts are deferred; raw HTML and unknown node kinds are rejected.

Milestone 1 must pass these conformance cases through the public compile/check path, in addition to the numeric comparison corpus:

- Multi-file imports and ordered sheets, including two components in one module and colliding class names across modules.
- Correlated state, controlled aliases and both branch arms, including two independent component instances.
- Projected literal text that retains its authored owner and inherits from its insertion parent, with explicit topology/text mappings and numeric text-layout checks.
- Invalid sources and malformed trees, including recovered front-end errors that propagate into diagnostics and block affected outputs.
- Missing assets, stale fixes, blocked outputs and negative type cases for absent target keys, including resolved support queries.

Forwarded library classes after publication and consumer linking remain a later conformance requirement before library artifacts become public. Dynamic/native contracts remain experimental until their own integration and device cases run.

The harness also needs seeded resolver failures, color-only errors, explicit topology/text mappings, deterministic repeated compilation, and Node/browser consumer checks. Full snapshot replacement must match a fresh compile after removal and failed-edit recovery. Required checks are not claimed as present merely because this document specifies them.

The first slice keeps CSS tables, profile storage, backend plans and the fixture driver internal. It implements only enough semantic analysis for proven boxes, flex, colors and basic text, with Ahem for layout. Font packaging, screen defaults, native generation and device tests follow later. No support status or native release promise is inferred from the examples. No separate Dragon release runtime, broad source front ends, overlay, HMR protocol or general plugin API is needed to meet this milestone.

### 10.1 Milestone 1 implementation readings

These record how the milestone 1 implementation reads this design. Reviews T027, T029 and T031 accepted each one.

- `DocumentEntry.rootInstance` names the root component. The root instance path is the document id.
- Component arguments are parameters on the definition, with per-call `args`.
- `ExplainQuery` is limited to element plus instance, with an optional partial assignment. Source-position queries and choose-instance are deferred.
- In a component-scoped stylesheet, every compound selector must contain a class. Renaming class tokens per owner is then an exact model of scoping. Tag-only rules, such as `body`, belong in document-scoped sheets.
- `white-space` is a shorthand (webref 8.7.5) over `white-space-collapse` and `text-wrap-mode`. Milestone 1 supports collapse plus wrap. The compiler collapses whitespace and writes the collapsed text onto each text node.
- The compiler creates anonymous boxes for loose text, never the layout engine. Text nodes carry every inherited text property, with origins.
- Inline elements (`span` and similar), mixed fonts on one line, and `text-align: justify` are outside milestone 1.
- `text-align` is read from the block container that holds the text (css-text-3 §7.1). Each text node also carries it with an inherited origin, and the lowering asserts the two are equal.
- Whitespace-only text that survives collapsing is addressed `<element>:space<k>`.
- `display: none` subtrees follow one lowering rule everywhere (S4a, C4).
- The internal fixture environment carries `direction`, for the right-to-left coverage in §7. Profile contexts carry a direction facet, and flex text contexts carry a main-axis facet, so a left-to-right proof never covers right-to-left.
- `ExplainedCase.cascade` includes `'environment'`. The root direction comes from the fixture environment and is reported truthfully, in ltr as well. A type test pins the union.
- Paint-only longhands (colours) are keyed `@paint/<direction>` rather than by formatting context. A structural test proves they never reach the layout input.
- In the harness, the environment direction reaches Chrome through `:where(html){direction:rtl}`, applied identically to both renderings. Emitted CSS writes `direction` on every element.
- A U+200B at the end of a right-to-left paragraph (optionally followed by spaces) is refused as `DRAGON_UNSUPPORTED_BIDI`. Neutral characters are never laid out as ltr.
- `overflow` accepts `visible` and `hidden` on both axes. Any pair that computes to `auto`, `scroll` or `clip` is refused.
- An empty declaration (`;`) inside a rule block and top-level `<!-- -->` are accepted as Chrome accepts them. Every other non-declaration child of a rule block, and every nested rule, is a diagnostic.
- A stylesheet use or resolution that names an absent source or asset, or an asset whose bytes do not match its hash, is a typed diagnostic that blocks every output.
- The fixture environment sets the root font-family to Ahem (cascade `'environment'`), the same way it sets direction. Chrome references, the UA dataset and the platform font rules are keyed by platform (reference: `darwin-arm64`). A platform with no dataset or rules is refused, never given another platform's values.
- The Linux lane scope follows [decisions.md](decisions.md): the Chrome oracle is captured on macOS, and the layout engine is platform-free.
- Milestone 2 (P4): `android` is a configured target, `{ minSdk }` with an integer from 29 to 36. Its output is analysis-only, and its profile holds the iOS row keys, all `unsupported`, until a native android case passes. The font check and the lowering diagnostics are reported for every configured native target. A config without android keeps its diagnostics, outputs and digest. The generated UIKit and Android Views sources are reachable only through the internal entry. There is still no public `swift()` or `kotlin()`.

## Owner decisions

Please choose the remaining release scope and defaults below; I recommend optional source readers later, a first release limited to known style states, shared font measurements after testing, and configuration defaults from the already chosen minimum versions.

These choices do not hold up this documentation task. Until decided, proposed additions stay outside the promised release. [Recorded decisions 5 and 8](decisions.md) already settle text scaling and allowing expensive techniques with every use listed in the build summary; neither is pending here.

1. **Who reads framework source?** Choose framework-provided readers only, or optional readers maintained by Dragon too. Recommend optional Dragon readers after milestone 1, because they help frameworks that cannot yet describe their elements and styles to Dragon.
2. **Which changing style values ship first?** Choose a known set of states, such as on/off, or also arbitrary changing numbers, such as progress from 0 to 1. Recommend known states for the first release, because arbitrary values need more rules and tests for units, allowed ranges and updates.
3. **How should bundled fonts line up?** Choose shared line heights and baselines on web and native, or keep each browser's defaults and report differences. Recommend shared measurements after testing, because they make text placement predictable; tests must show and explain any resulting differences.
4. **Must configuration repeat the minimum versions?** Choose explicit values in every project, or defaults from the versions already chosen in [decision 6](decisions.md). Recommend using those defaults, because repeating an existing choice adds setup without changing which OS versions the project supports. The checked configuration must show the chosen versions; research into how many devices run them does not reopen the recorded choice.

**Researched defaults:** Keep public lookups limited to `explain` and support queries for milestone 1, because the underlying data is still changing; keep the connection for adding platform implementations private until several Dragon implementations pass their tests, because outside implementations need proven checks for combined features before they can claim support. Broader lookups and third-party platform implementations can follow later.

## Critique resolution

- F1 — Section 2.1 supplies immutable text/assets, verified hashes, extraction spans, virtual mappings, import resolution and dependency reporting.
- F2 — Sections 3.1–3.2 define typed domains, initial values, qualified aliases, exhaustive conditions and branches; the switch directly uses the documented `DocumentEntry`, `State`, `StateAlias`, `Condition` and `Choice` types, with guarded lookups checked under strict, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- F3 — Section 4.1 separates resolved CSS from lowering and derives code, expected dumps and layout inputs from the same operations with topology/content/measurement data.
- F4 — Section 7 checks every source case before any future deduplication, includes numeric values/paint, and requires deliberately faulty resolver fixtures.
- F5 — Section 3.4 separates structural validation from producer completeness and requires conformance plus generated domain guards and typed native setters.
- F6 — Section 2 consumes the full front-end envelope with diagnostics; section 3.4 validation returns no validated input on failure.
- F7 — Section 4.2 makes the versioned binding/lifecycle manifest experimental and specifies two independent instances plus an ancestor-driven descendant update.
- F8 — Section 3.1 defines document roots, ordered owned sheet uses, logical ancestry, linking and forwarded class-symbol identity.
- F9 — Section 3.3 defines an experimental requires-link library artifact, consumer specialization and selector-membership analysis, with a publish/consume gate.
- F10 — Section 4.3 defines the structured-value requirements and proven residual evaluation boundary; the release scope for arbitrary changing application values remains an owner choice.
- F11 — Section 2.2 withholds files on errors, separates analysis-only data and development previews, and removes unconditional property/web readers.
- F12 — Sections 2.2 and 6.3 preserve configured target keys in mapped outputs and `querySupport<K>` over `Compiled<K>`; negative type cases cover absent targets, while wide `Targets` configurations and JavaScript callers rely on runtime validation.
- F13 — Section 7 specifies an internal fixture renderer, future driver obligations, concrete content/environment/lane binding and honest coverage reports.
- F14 — Section 7.1 separates strict authored equality from explicit normalization references; text scaling follows recorded decision 5, and shared font metrics remain an owner choice with separate fixture requirements.
- F15 — Section 8 uses atomic whole snapshots now and keeps incremental APIs internal until revision, deletion, invalidation and recovery tests pass.
- F16 — Section 6 supplies revisioned source registries, all origin kinds, stale-fix checks and per-target/condition explanations with position-to-instance lookup.
- F17 — Section 6.3 separates contextual decisions from possibilities/needs-context and ties proof to normalized target, value, context and environment.
- F18 — Section 5 keeps application assignments separate from CSS environments and distinguishes actual web output from target previews; static backends require explicit assignments.
- F19 — Section 5 selects compatible subtree plans by proven fidelity before cost and requires joint-feature proof.
- F20 — Section 9 defines exact draft versions, genuinely compatible optional additions, new-version rules for unions, compatibility windows and unchanged wire codes.
- F21 — Section 9 gives a transition matrix: only still-proven output may deprecate with warnings; lost proof/output blocks immediately.
- F22 — Section 4.4 removes Lightning CSS/native bindings from the core path, uses TypeScript web emission and requires Node/browser package smoke checks.
- F23 — Section 4.4 emits helpers and bridges as source, limits their inputs and leaves layout as the only external on-device Dragon dependency.
- F24 — Sections 8 and 10 define the minimal host adapter, whole-graph path filtering and the milestone-1 tree subset, including calls, aliases, projections and branches; multi-file, correlated-state, projected/inherited-text and invalid-input/front-end-diagnostic cases are required in milestone 1.
- F25 — Owner decisions open with the ask and recommendation, use everyday choices with reasons, batch low-stakes researched defaults, preserve recorded decisions 5 and 8, and limit the minimum-version question to whether configuration repeats or defaults to decision 6.
