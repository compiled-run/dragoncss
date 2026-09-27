# T018: semantic analysis of CSS for Dragon

Scout note, 2026-09-26. Owner: "I do think we need semantic analysis here, so we need something of CSS that gives that", meaning a CSS analyzer that plays the role yuku's analyzer plays for JavaScript, with Dragon's compiler built on top of it.

Method. Web sources and npm metadata accessed **2026-09-26**; versions are npm `latest` on that date unless noted. Local reads: `~/dev/open-source/yuku` (analyzer README, `npm/yuku-analyzer/{package.json,analyzer.js}`, `src/parser/semantic/*`) and `~/dev/open-source/yuku-tsrx` (`src/dialect/style.zig`, `npm/yuku/{package.json,index.d.ts}`, `build.zig`). **Run, not just read:** a throwaway probe in `/tmp/t018probe` (outside every repo) installed css-tree 3.2.1, lightningcss 1.33.0, vscode-css-languageservice 6.3.10 and @webref/css 8.7.5 on darwin-arm64 / Node 24.15.0 and fed them invalid and valid declarations plus the Markless website stylesheets (`website/styles/global.css` and `brand.css`). Anything marked **(unverified)** comes from a search summary or memory, not a primary source I opened.

Owner structural questions this note serves (from T010/T011 and goal.md), named in plain words:
- **By design:** remove pitfalls so they cannot happen, rather than documenting them.
- **Every state at build time:** resolve each element's styles in every reachable state before the app runs.
- **One platform, the other just works.**
- **Agents like StyleX:** local styles, predictable merging, a warning when only specificity decides, typed diagnostics shaped as fixes.
- **Framework-neutral:** CSS plus an element tree in.
- **Straight to native properties, one compiler result** for Swift, the property list and web output.

## 1. Summary

- **No existing tool is a CSS semantic analyzer in the yuku sense.** Each covers one slice. css-tree and stylelint check values against grammars but give up on `var()`. lightningcss parses into typed values but **silently passes `width: 1foo` through** (probe below). vscode-css-languageservice resolves `--x` and `@keyframes` references **inside one file only**. Svelte and the Vue scoped-CSS lint rule join selectors with a template, but only to answer "used or unused" in one component. Biome has a CSS semantic model (selectors, specificity, declarations) for lint rules, but per file and without an element tree. Stylo has the full cascade but it is a runtime engine for a live DOM. **Nothing** combines cross-file symbols, typed values after `var()` substitution, a custom-property graph, cascade winners, and a join with an element tree across a finite set of states. That combination is exactly what Dragon's principle 1 needs, so Dragon has to own it.
- **The analyzer model** (section 3) has six query families: symbols (`definitionsOf`, `readersOf`), types (`typeOf`), the custom-property graph (`dependencyGraph`), the cascade (`winnersFor`, `specificityOnlyConflicts`, `deadRules`), the element-tree join (`matchesFor`, `ownerOf`, `textContextOf`), and `explain` for agents and editors. All of them answer per **state condition**, not per element alone.
- **Placement: TypeScript inside Dragon now, shaped so the hot parts could move into yuku later only if a measurement demands it.** CSS analysis is part of Dragon's core `compile()`, and T010 found `@tsrx/yuku` publishes only two native platforms (darwin-arm64, linux-x64-gnu) with no published WASM analyzer. The goal's own rule is "build-time code is TypeScript". The probe shows TS-side parsing and grammar matching are fast enough for component stylesheets (1 MB of CSS parsed in 135 ms and 15,469 declarations matched in 46 ms by css-tree). Detail and port criteria in section 4.
- **Recommended building blocks:** grammars from `@webref/css` (spec-extracted; it guarantees its syntaxes parse with css-tree `^3.2.1`), matched by a css-tree lexer forked with those grammars (probe: works, and catches `width: 1foo`), and a Dragon-owned layer that does what none of them do: `var()` substitution per state before matching, cross-file symbols, the graph, the cascade and the tree join. lightningcss stays useful for lowering web output, never as the validator.

## 2. Survey

| Tool (version, source) | What it does | Gap for Dragon |
|---|---|---|
| **css-tree 3.2.1** (npm; [syntax reference](https://csstree.github.io/docs/syntax/)) with **mdn-data** (css-tree pins 2.27.1; latest is 2.37.0) | Parser with positions; `lexer.matchProperty`, `matchDeclaration`, `matchAtruleDescriptor` check values against Value Definition Syntax grammars; `fork({properties, types})` swaps in other grammars. **Run:** `width: 1foo` gives `Mismatch`; `width: 10px` matches; `margin-block: 1px 2px 3px` gives `Mismatch`. | **`var()` is refused:** "Matching for a tree with var() is not supported". On the Markless website sheets, **111** declarations could not be checked at all for that reason. Context-free matching gives false positives: `font-weight: 400 700` inside `@font-face` is reported as a mismatch through `matchDeclaration`, while `matchAtruleDescriptor('font-face', ...)` accepts it, so callers must route by at-rule. The bundled mdn-data is ten minor versions behind. No symbols, cascade or tree. |
| **@webref/css 8.7.5** (npm; [w3c/webref](https://github.com/w3c/webref)) | Data extracted from the specs: for each property `syntax`, `initial`, `inherited`, `appliesTo`, `percentages`, `computedValue`, `animationType`, `logicalPropertyGroup` (**read** from the package: 821 properties, 528 types). Its README says every syntax parses with the css-tree version in `peerDependencies` (`^3.2.1`). **Run:** a css-tree lexer forked with webref property and type syntaxes rejects `width: 1foo` and 5-value `margin`, and accepts `anchor-size(width)` and `light-dark()`. | Data only. "Lives on the edge": lists features from the newest spec levels whatever their browser support, has no unit table, no non-standard variants ([npm README](https://www.npmjs.com/package/@webref/css), [mdn discussion #786](https://github.com/orgs/mdn/discussions/786)). MDN is deprecating mdn-data CSS in favour of webref ([mdn/data README](https://github.com/mdn/data/blob/main/README.md)). For Dragon that is fine: **support comes from Dragon's profile, not from the grammar**, and `initial`/`inherited`/`computedValue` are exactly what the cascade and inheritance need. |
| **lightningcss 1.33.0** (npm; [docs](https://lightningcss.dev/docs.html), [CSS modules](https://lightningcss.dev/css-modules.html)) | Rust (on Servo's cssparser) typed AST for hundreds of properties; lowering by browser targets; CSS modules with `exports` (`name`, `isReferenced`, `composes`), `dashedIdents` scoping of custom properties, keyframes, grid lines, counter styles; JS visitors; `bundle` resolves `@import`. **Run:** `.a{width:1foo}` is printed back unchanged, **no error and no warning**, with or without `errorRecovery`; a visitor sees the declaration as property `unparsed`. `.b{animation-name:k}` marks `k` as `isReferenced: true`. | Invalid values are not errors; T010 also found no codes and no per-declaration locations. Reference tracking is per file and for renaming (hashing), not "who reads this". Composition across files is "the caller's responsibility" in `transform`. WASM build has no bundle or visitor API (T010). Use for web output lowering; Dragon must treat every `unparsed` it sees as its own error. |
| **vscode-css-languageservice 6.3.10** (npm) | Parser, document symbols, completion, hover, references, definition, lint. **Run:** symbols `[":root", ".a", "@keyframes k", ".b"]`; references for `--x` found both sites; definition of `animation-name: k` jumps to `@keyframes k`. | **One document at a time.** Its `doValidation` reported nothing for `width: 1foo` or for an undefined `var(--nope)`. Cross-file custom properties have been an open request since 2016 ([vscode-css-languageservice#156](https://github.com/microsoft/vscode-css-languageservice/issues/156), [#261](https://github.com/microsoft/vscode-css-languageservice/issues/261), [VS Code CSS docs](https://code.visualstudio.com/docs/languages/css)). |
| **stylelint 17.15.0** ([rules](https://stylelint.io/user-guide/rules)) | `declaration-property-value-no-unknown` (uses css-tree), `no-unknown-custom-properties`, `no-unknown-animations`, `no-descending-specificity`, `no-duplicate-selectors`. | Treats every `var()` as valid ([rule page](https://stylelint.io/user-guide/rules/declaration-property-value-no-unknown/)). Custom properties are "known" only if defined in the same source or in configured `referenceFiles` ([rule page](https://stylelint.io/user-guide/rules/no-unknown-custom-properties/)). `no-descending-specificity` is a **source-order heuristic** with no element tree: it cannot tell whether two selectors ever hit the same element. |
| **Biome CSS semantic model** (`crates/biome_css_semantic`, [issue #3411](https://github.com/biomejs/biome/issues/3411), [PR #3546](https://github.com/biomejs/biome/pull/3546)) | Rules, selectors with `Specificity(a, b, c)`, declarations with ranges; powers `noDescendingSpecificity` and `noDuplicateSelectors` (**search summary; source not opened**). | Per file, lint-only, no value types, no custom-property graph, no tree. Closest precedent for "a semantic model for CSS beside one for JS", and it is in Rust inside a linter, not a reusable npm API (no crates.io release found, unverified). |
| **Svelte 5.57.1** ([compiler warnings](https://svelte.dev/docs/svelte/compiler-warnings)) | `css-prune.js` in the analyze phase matches each selector right to left against template elements, marks matches for scoping and warns `css_unused_selector` (docs plus [issue #18792](https://github.com/sveltejs/svelte/issues/18792)). Dynamic classes are matched against statically known values; unknowns **assume a match** (source reading from search summary, unverified). | Errs toward "might match" and allows `svelte-ignore`, the opposite of fail-closed. Answers used/unused, not which declaration wins in which state. Per component. |
| **Vue**: `@vue/compiler-sfc` 3.5.43 scopes by attribute and does no pruning; **eslint-plugin-vue-scoped-css** `no-unused-selector` ([docs](https://future-architect.github.io/eslint-plugin-vue-scoped-css/rules/no-unused-selector.html)) | Statically checks type, id, class selectors, combinators and universal selectors against `<template>`. | Root element limitation is documented; a lint, not a compiler input; no state model. |
| **Tailwind 4.3.3** ([theme variables](https://tailwindcss.com/docs/theme)) | A "design system" object: theme namespaces (`--color-*` makes colour utilities), `candidatesToCss`, `getClassList`, `resolveThemeValue` (used by IntelliSense). | Treats source as text (T011). The design-system loader is `__unstable__` yet Prettier, Biome, oxfmt and linters depend on it (T010). Lesson: **whatever editors need from the analyzer must be a stable, documented export on day one.** Theme namespaces are a useful precedent for a token table keyed by name. |
| **Rust cssparser / Stylo** ([servo/stylo](https://github.com/servo/stylo), crate `stylo` 0.20.x per a 2026-09-01 Blitz trace, unverified) | cssparser is a spec tokenizer and parsing toolkit (lightningcss sits on it). Stylo is Firefox's and Servo's full engine: selector matching, the cascade, computed values; Blitz uses Stylo plus Taffy via `stylo_taffy`. | Built for a live DOM at runtime: one state at a time, no "every reachable state" enumeration, no build-time diagnostics. MPL-2.0 and Rust. Potentially valuable later as an **independent reference cascade** in the Linux lane (a second opinion besides Chrome), not as the analyzer. |
| **Parcel** | Uses lightningcss for CSS (**not re-checked**; T010 covers lightningcss). | Same as lightningcss. |
| **CSS language servers with cross-file analysis**: `css-variables-language-server` 2.8.x ([vunguyentuan/vscode-css-variables](https://github.com/vunguyentuan/vscode-css-variables)), `cssmodules-language-server` ([antonk52](https://github.com/antonk52/cssmodules-language-server)), Zed ([discussion #39618](https://github.com/zed-industries/zed/discussions/39618)) | Scan globs of files for `--x` definitions: completion, colour preview, go to definition. cssmodules server maps imported class names. | Name indexes over text; no scoping, cascade, value types or tree. Show the demand: cross-file token navigation is the most-requested missing CSS editor feature and has been for a decade. |

**The gap, in one line:** tools either type values (css-tree, lightningcss) or index names (language servers) or match a template (Svelte, Vue lint), each alone and each per file or per state. Dragon needs all of them joined, across files, per state, failing closed.

### Probe numbers (run, darwin-arm64, Node 24.15.0)

Markless `website/styles/global.css` + `brand.css`, repeated to about 1 MB (1,001,300 bytes, 15,469 declarations):

| Step | Time |
|---|---|
| css-tree 3.2.1 `parse` with positions | 135 ms |
| css-tree lexer, match every non-custom declaration | 46 ms |
| lightningcss 1.33.0 `transform` (Rust, native) | 13 ms |

One run each, not a benchmark. Dragon's real inputs are far smaller: T018-styling-design counts 73 headless rules and 1,155 hand-written website rules in the whole Markless corpus.

## 3. Analyzer model

### 3.1 Inputs, scopes and identity

```ts
const project = dragon.analyze({
  tree,            // dragon/tree v1 (T011): elements, logical parents, components, binding domains
  sheets,          // raw CSS text per component <style>, document sheet, unscoped globals
  uaLayer,         // captured Chrome built-in styles as data (pitfalls.md 2.7)
  profile,         // per target; used by checks, never by the analysis itself
});
```

Every symbol is `(kind, name, scope)`. Scopes are: the **UA layer**; the **document root** (`:root` tokens, `@font-face`, `@layer` order, `@property`); each **component sheet**, scoped by the per-module hash; **unscoped globals** (errors on native unless listed). A class `.row` in `row.tsrx` and `.row` in `inbox.tsrx` are different symbols, as in Svelte's scoping, which is what makes selector ownership provable per file (A7).

**States** are not enumerated as combinations. Each answer carries a `Condition`: a boolean formula over **atoms**: a binding's value (`class∋open`, `aria-pressed=true`, from the tree's finite domains), a pseudo-class (`:hover` with a real pointer, `:active`, `:focus-visible`), a root condition (`data-theme=dark`, `prefers-color-scheme`), a media or container feature, and target folding (`@supports`, `@media (os: ios)`). This is the "resolve per condition, not per combination" refinement from pitfalls.md 2.1: two conditions are multiplied only where both touch the same property of the same element.

Spans are stored as UTF-16 offsets plus 1-based line and column (T010 lesson 1), converted once from any byte-offset producer, including yuku-tsrx's `scopeInsert`.

### 3.2 Symbols: `definitionsOf` and `readersOf`

| Kind | Defined by | Read by |
|---|---|---|
| custom property `--surface` | a declaration `--surface: ...` (with its selector's condition), an inline `style={{'--x': v}}` binding from the tree, `@property` `initial-value` | `var(--surface)` in any value, `@container style(--surface: ...)` later |
| class `.card` | tree class tokens with their domain condition (the markup defines the class) | selector compounds |
| keyframes `k` | `@keyframes k` | `animation-name`, `animation` shorthand |
| layer `markless` | `@layer a, b;` order statements and `@layer x {}` blocks | the rules inside, ordered by the layer list |
| font family `Inter` | `@font-face { font-family; font-weight; font-style; src }` | `font-family`, `font` shorthand, per weight and style |
| container name `card` | `container-name`, `container` shorthand on an element | `@container card (...)` |

```ts
project.definitionsOf({ kind: 'custom-property', name: '--surface' });
// [{ span: document.tsrx:18:5, subject: ':root', condition: TRUE, value: 'light-dark(#fff, #1c1c1e)' },
//  { span: document.tsrx:26:5, subject: ':root[data-theme="dark"]', condition: 'root.data-theme=dark', ... }]

project.readersOf({ kind: 'custom-property', name: '--surface' });
// [{ span: document.tsrx:28:18, declaration: '.app { background }' }, ...]

project.readersOf({ kind: 'font-family', name: 'Inter', weight: 600 });
// readers whose resolved weight is 600 -> checked against definitions: no face -> error
```

Diagnostics that fall straight out: `var()` with no definition and no fallback anywhere it can be read (the undefined-token case vscode and stylelint miss across files); a class selector with **no definitions** (unused selector, Svelte's check, but fail-closed on open domains); `@keyframes` or `@font-face` never read (info); a `font-weight` reader with no matching face (DRAGON_FONT_FACE_MISSING, P6, C2); `@container` names read but never defined on an ancestor.

**Serves:** P6, C2 (fonts declared once and checked, principle 5); C4 (`:root` tokens outside the document: a definition whose scope cannot reach its readers); A7 (per-file ownership, because scope is part of identity); C10 (the editor, docs and compiler read the same tables). Structural questions: by design, agents like StyleX (go-to-definition across files is what an agent needs to edit a token safely).

### 3.3 Types: `typeOf(declaration)`

```ts
project.typeOf(decl);
// grammar from @webref/css, chosen by context:
//   property in a style rule   -> properties[name].syntax
//   descriptor in @font-face   -> atrules['@font-face'].descriptors[name].syntax
//   inside @keyframes          -> property syntax, and animationType must not be "not animatable"
//   registered custom property -> the @property syntax
//
// no var(): match once                   -> { ok, value: Typed } | error DRAGON_CSS_INVALID_VALUE
// with var(): substitute per alternative -> [{ condition, value: Typed | InvalidAtComputedTime }]

project.typeOf(parse('.x { width: 1foo }'));
// error DRAGON_CSS_INVALID_VALUE  "1foo" is not a <length-percentage>; fix: 1px? 1em? 1rem?
```

`Typed` is a small value algebra: `length(value, unit)`, `percentage`, `color(expression, traitDependencies)`, `keyword`, `calc(tree)`, `env(name)`, `lightDark(a, b)`, lists. `calc()`, `min()`, `max()`, `clamp()` keep their dependencies (T018-styling-design 3.4).

Two rules make this different from every surveyed tool:
1. **`var()` is not a wildcard.** The analyzer substitutes each reachable alternative from the graph (3.4), then matches. A value that parses but is **invalid at computed-value time** is an error. The browser would quietly `unset` it (T018-styling-design 3.3 step 3), which is exactly the "a tool accepted it, the platform did something else" shape.
2. **Grammar validity and target support are separate answers.** `typeOf` answers "is this CSS"; `profile.check(typed, target)` answers "can this target do it". An error names which one failed. Anything lightningcss reports as `unparsed` must already have a `typeOf` error; a test pins that.

Shorthands expand to longhands **after** substitution, per alternative; an open alternative inside a shorthand is DRAGON_CSS_VAR_IN_SHORTHAND (T018-styling-design 3.1).

**Serves:** P15 and B2 (units typed, so `rem`, `px` and `vh` get their Dragon meaning); P9 (a fixed length block size on a text container is detectable); P12 (clamp and ellipsis values typed); P13 (`object-fit` initial values from webref `initial`); P17 (`color-scheme` and `light-dark()` typed, giving the dynamic `UIColor` path); P2 and P7 (`env(safe-area-inset-*)` typed as a host input); B1 (`line-height: normal` flagged for the info hint). Structural questions: typed diagnostics shaped as fixes; straight to native properties (a typed value maps to one native setter).

### 3.4 The custom-property graph: `dependencyGraph`

```ts
const g = project.dependencyGraph();
g.nodes;   // (element, '--b', condition) after the cascade picks the winning --b declaration
g.edges;   // --b -> --a when the winning value of --b contains var(--a)

g.classify('--x', element);
// 'constant'     every alternative is literal tokens: fold at build
// 'environment'  depends on light-dark(), env(), color-scheme, text size, viewport: map to a platform mechanism
// 'state'        winning declaration varies with finite binding domains: emit "when X changes, set these"
// 'open'         depends on an inline binding with an open domain: runtime input; forbidden in shorthands

g.cycles();    // strongly connected components per element and condition
```

Computed at the **declaring element** and inherited as a computed token list (CSS Variables: a child's override of `--a` does not change the parent's `--b: var(--a)`; T018-styling-design 3.3 example). The graph is therefore per element, not per sheet: a static sheet-level pass gives "possible cycle" warnings, and the per-element pass decides. A cycle makes every member guaranteed-invalid; readers use their fallback. Dragon reports a cycle as an error even though the browser would render a fallback, because an agent almost never means one.

**Serves:** principle 1 (every state known before runtime) and the README's "class changes driven by state become when this value changes, set these properties"; P10 (no runtime resolution, so dev and release cannot differ); P17 (theme tokens classified as environment); C1 (constant folding keeps generated code small). Structural questions: every state at build time; straight to native properties.

### 3.5 Cascade: `winnersFor`, `specificityOnlyConflicts`, `deadRules`

```ts
project.winnersFor(element, property);
// [{ condition: 'class∌active', winner: decl@card.tsrx:12, losers: [{ decl@ua, reason: 'origin' }] },
//  { condition: 'class∋active', winner: decl@card.tsrx:15, losers: [{ decl@card.tsrx:12, reason: 'specificity' }] }]
// order: UA layer < named author layers in @layer order < unlayered < inline bindings;
// then specificity, then source order. !important, revert, revert-layer: errors in release 1.

project.specificityOnlyConflicts();
// pairs (A, B): same element, same property, conditions overlap, same layer and origin,
// and the earlier-written declaration wins only because its specificity is higher.
// -> warning DRAGON_CSS_SPECIFICITY_DECIDES, with both spans and the fix
//    "make .b's condition exclusive" or "move this into @layer".

project.deadRules();
// declarations that win for no element under any reachable condition;
// rules whose every declaration is dead; selectors that match nothing (3.6).
```

Stylelint's `no-descending-specificity` and Biome's rule approximate the conflict check from source order alone; Dragon can decide it exactly because it knows which elements both selectors hit and under which conditions. That is the goal's "warning on conflicts decided only by specificity" (StyleX's predictable merging), without false positives from selectors that never meet.

**Serves:** A2 and P4 (the UA layer is a real cascade origin, so "defaults nobody wrote" are visible); P3 and P5 (knowing per state that `box-shadow` and `overflow: hidden` both win on one element triggers the shadow and clip split); P8 and C6 (`z-index` winners per state give sibling order; an escape is an error); P20 (group opacity only when `opacity` wins on an element whose children overlap); B5 (`@supports` and `@media (os:)` branches become conditions, so every escape can be listed). Structural questions: agents like StyleX; one compiler result (web output is regenerated from winners when a native target is configured, principle 4).

### 3.6 Join with the element tree: `matchesFor`, `ownerOf`, `textContextOf`

```ts
project.matchesFor('.list .row');
// [{ element: row.tsrx#li, condition: 'ancestor(ul.list) in same component' }]
// or, when the ancestor may come from another component:
// error DRAGON_CSS_CROSS_COMPONENT naming both files (T018-styling-design section 1)

project.ownerOf(element);            // component that authored it; projected children keep authored ownership
project.parentOf(element);           // logical (authored) parent, never the render parent
project.inheritedFrom(textNode, 'color');
// [{ condition, from: element, value }]: which ancestor's computed value reaches this text node in each state

project.textContextOf(element);
// 'inline-run' only if display computes to inline under every reachable condition, else 'box';
// a switch between them is an error (T018-styling-design 3.5)
```

Matching goes right to left like Svelte, but **fails closed**: an open class domain that a selector depends on is an error with the "type the prop as a union" fix (DRAGON_CLASS_NOT_FINITE), never an assumed match. Release 1 selectors are limited to own-element tests, same-component ancestors and app-root conditions, so matching needs only the element, its authored ancestors and the root; siblings, `:has()` and structural pseudo-classes stay errors (T018-styling-design section 1).

Hover analysis is a join query too: a property that is visible only under a `:hover` condition, for an element on a target without hover, is DRAGON_HOVER_ONLY_REVEAL (P18, C5).

**Serves:** P14 (inherited text styles written on each text node per ancestor state); P1 (text nodes know their resolved font, size and line height for half-leading); P16 and B3 (`direction` resolved from `dir`, inherited through the logical tree); A4 and P2 (the root is known, so "root is a scroll view" is decided from its winners); A7 (ownership proof); principle 2 (the same condition list generates the parity fixtures, deduplicated by resolved-property hash). Structural questions: every state at build time; framework-neutral (only the tree format is needed, not a framework's internals); one platform, the other just works.

### 3.7 `explain` for agents and editors

```ts
project.explain(element, 'padding-inline-start', { condition: 'class∋active' });
// winner, losers with reasons, var() chain with each hop's span, typed value, target mapping, profile row
```

This is the stable, documented export Tailwind never had (T010 lesson). The editor, the dev overlay, `dragon explain` and agent diagnostics all call it, so they give the same answer (C10).

### 3.8 How queries compose into `compile()`

```ts
for (const element of tree.elements)
  for (const property of propertiesTouching(element))          // from winnersFor, not all 821
    for (const { condition, winner } of project.winnersFor(element, property)) {
      const typed = project.typeOf(winner, { element, condition });   // after var() substitution
      propertyList.set(element, condition, property, typed);
    }
// then: profile checks, native mapping, Swift and web emitters, generated fixtures (principle 2)
```

## 4. Placement

Three options: **(A)** a CSS analyzer in Zig inside yuku, beside the JavaScript analyzer and the CSS scanner; **(B)** TypeScript inside Dragon; **(C)** TypeScript first, moved into yuku later.

### Evidence

**Where CSS lives in yuku today (read).** yuku itself (`~/dev/open-source/yuku`, `build.zig.zon` 0.3.0) has **no CSS code**: its scope is JavaScript and TypeScript (parser, binder, scopes, module records in `src/parser/semantic`, about 3,700 lines of Zig). The CSS scanner lives in the **TSRX dialect package** `yuku-tsrx` (`src/dialect/style.zig`, 489 lines). It emits exactly what a byte-splice scoper needs: `StyleSheet { source, children, scanned }`, `CssRule { prelude: CssSelector[], block }`, `CssAtrule { name, block, keyframes }` and `CssSelector { scopeInsert }`. Declarations are skipped, selectors are not decomposed into compounds, keyframes bodies are empty, and anything it cannot model sets `scanned: false` with no diagnostic. A semantic analyzer is therefore **not an extension of that scanner; it is a new CSS front end** (tokenizer, value parser, grammar data, matcher) plus everything in section 3.

**Binary coverage (read).** `@tsrx/yuku` 0.3.0 lists two `optionalDependencies`: `@tsrx/yuku-darwin-arm64` and `@tsrx/yuku-linux-x64-gnu`. The working copy of `yuku-analyzer` (0.5.43) lists 11 platform bindings and no WASM analyzer; a parser-only WASM exists (`yuku-parser-wasm`, 391 KB per T010). yuku-tsrx has a `zig build wasm` step that the default build does not run and that is not published. So option A, built where the CSS scanner lives, would ship to two platforms and no browser, editor-web or StackBlitz environment, and it would put a native install into Dragon's **core** `compile()`, which T010 and T011 deliberately keep pure TypeScript (yuku only behind `dragon/tsrx`). Native optional-dependency failures (npm/cli#4828) are the top install complaint across lightningcss, Tailwind oxide and SWC (T010).

**Speed (run).** css-tree in plain JS parses 1 MB in 135 ms and grammar-matches 15,469 declarations in 46 ms; lightningcss (native) transforms the same 1 MB in 13 ms. Roughly a 10x gap for parsing, on inputs 10 to 100 times larger than a real app's component CSS. The expensive part of Dragon's analysis is not parsing but the per-element, per-condition cascade and graph, which is plain data work over small sets. yuku's own architecture is suggestive: per-file analysis is native, but **cross-file linking is JavaScript** (`npm/yuku-analyzer/analyzer.js`, `#resolveExport`), because once data is decoded, the join is cheap. Not measured: Dragon's full analysis on a real app; that is the number that should decide any port.

**Reuse by linters and editors.** A TypeScript analyzer with a stable export (`dragon/analysis` or similar) runs in Node, in VS Code's web host, in a browser playground and in any LSP without a platform matrix. A Zig analyzer would be reusable by other Zig and yuku tools, but none exists yet: T018-styling-design 3.2 says a standalone package waits for a second real consumer. The editor demand is real (cross-file `--x` navigation requested since 2016), and a pure-JS package can serve it immediately.

**Iteration speed.** The design is still moving: the profile, the condition atoms, the tree format (T011), owner decisions in pitfalls.md section 6. In yuku every new node kind is a change to `schema.zig`, the generated decode tables (`decode-analyzer.js` tags such as `CssRule = 183`), the napi transfer and a multi-platform publish on Zig 0.16. In TypeScript it is a type change and a test. The goal's non-negotiable rule is "build-time code is TypeScript; Rust only for the Taffy lane binary", and AGENTS.md says the same.

### Recommendation

**Choose C, weighted toward B: build the CSS analyzer in TypeScript inside Dragon now, and move a part into yuku only when a measurement shows it is the bottleneck.**

Reasons: it keeps `compile()` free of native installs, which is the adoption lesson from every tool in T010; it matches the goal's TypeScript rule; parsing speed is not the constraint at component scale; and the model will change weekly for a while, which is cheap in TypeScript and expensive across a Zig ABI.

How to keep the door to yuku open:
- **Shape the data like yuku.** Flat tables (`symbols`, `references`, `declarations`, `selectors`, `conditions`) with integer ids, and lazily built views on top, so a later native producer can fill the same tables through one buffer, as `yuku-analyzer` does.
- **Keep grammar data outside the code.** `@webref/css`, pinned and snapshotted into the repo, so a Zig port reads the same data.
- **Pin agreement with the yuku-tsrx scanner.** A test runs both over the Markless corpus and checks that Dragon's selector spans and scope-insertion points equal the scanner's `scopeInsert`, so Markless scoping and Dragon analysis cannot disagree.
- **Port only when all hold:** the analysis of the largest real app takes more than an agreed budget (propose 50 ms per full compile or 16 ms per dev-loop edit, **proposed, not measured**); the table format has been stable for one release; and yuku publishes the analyzer for Dragon's platform set **plus WASM**. The natural first candidate is the tokenizer and value parser, which is what lightningcss's 10x advantage covers.

Building blocks for the TypeScript version, to confirm in T001 and T002:
- Grammar data: `@webref/css` 8.x (pinned).
- Matching: a css-tree 3.2.x lexer created with `fork()` from webref syntaxes (probe: works), routed by context (property, `@font-face` descriptor, `@keyframes`, `@property`).
- Parsing with positions: css-tree `parse({ positions: true })`, or `@csstools/css-parser-algorithms` 4.0.1 if spec-exact tokenization matters more than speed (**not probed**).
- Web output lowering: lightningcss, with every `unparsed` declaration already rejected by `typeOf`.

## 5. Risks and open points

- **webref "lives on the edge".** It contains syntax no browser ships. Harmless for Dragon, because support comes only from the profile, but a grammar match must never be read as support. Units have no table in webref; Dragon needs its own unit list (in the profile).
- **css-tree plus webref forks** were checked on four declarations only. A corpus run over the Markless sheets should come before relying on it, including type-name normalisation (`<length>` versus `length`).
- **State explosion** is contained by per-condition resolution in the design, but not measured on a real component.
- **Biome's model** was read only through search summaries; worth a direct look before designing the selector tables, since it has solved specificity storage already.
- **Open question for the owner, not blocking:** should the CSS analyzer become its own published export for editors (as Tailwind's design system effectively did) in milestone 1, or stay internal until the table format is stable? I'd say internal, with `explain` as the only public query for now, because an unstable public surface is the Tailwind pitfall.

## Sources

All accessed 2026-09-26.
- css-tree 3.2.1, mdn-data 2.37.0, @webref/css 8.7.5, lightningcss 1.33.0, vscode-css-languageservice 6.3.10, stylelint 17.15.0, svelte 5.57.1, @vue/compiler-sfc 3.5.43, tailwindcss 4.3.3, @csstools/css-parser-algorithms 4.0.1: `npm view <pkg> version`.
- https://csstree.github.io/docs/syntax/ ; https://github.com/w3c/webref ; https://www.npmjs.com/package/@webref/css ; https://github.com/mdn/data/blob/main/README.md ; https://github.com/orgs/mdn/discussions/786 ; https://github.com/orgs/mdn/discussions/667
- https://lightningcss.dev/docs.html ; https://lightningcss.dev/css-modules.html
- https://github.com/microsoft/vscode-css-languageservice/issues/156 ; https://github.com/microsoft/vscode-css-languageservice/issues/261 ; https://code.visualstudio.com/docs/languages/css
- https://stylelint.io/user-guide/rules ; https://stylelint.io/user-guide/rules/declaration-property-value-no-unknown/ ; https://stylelint.io/user-guide/rules/no-unknown-custom-properties/
- https://github.com/biomejs/biome/issues/3411 ; https://github.com/biomejs/biome/pull/3546 ; https://github.com/biomejs/biome/commit/085d324b963f12b4ceaf901c36875b196d383cc4
- https://svelte.dev/docs/svelte/compiler-warnings ; https://github.com/sveltejs/svelte/issues/18792
- https://future-architect.github.io/eslint-plugin-vue-scoped-css/rules/no-unused-selector.html
- https://tailwindcss.com/docs/theme
- https://github.com/servo/stylo ; https://crates.io/crates/stylo ; https://servo.org/blog/2026/04/13/servo-0.1.0-release/
- https://github.com/vunguyentuan/vscode-css-variables ; https://github.com/antonk52/cssmodules-language-server ; https://github.com/zed-industries/zed/discussions/39618
- Local: `~/dev/open-source/yuku/{build.zig.zon,npm/yuku-analyzer/README.md,npm/yuku-analyzer/package.json,npm/yuku-analyzer/analyzer.js,src/parser/semantic/}`; `~/dev/open-source/yuku-tsrx/{src/dialect/style.zig,npm/yuku/package.json,npm/yuku/index.d.ts,build.zig}`.

```json
{
  "goalbuddy_receipt_v1": {
    "task_id": "T018",
    "role": "scout",
    "status": "done",
    "result": "complete",
    "board_path": "docs/goals/milestone-1/state.yaml",
    "files_written": ["docs/goals/milestone-1/notes/T018-css-semantic-analysis.md"],
    "decision": "Build the CSS semantic analyzer in TypeScript inside Dragon now (option C weighted to B), with yuku-shaped flat tables and pinned @webref/css grammar data; move parts into yuku only if a measured budget is exceeded, the table format is stable for one release, and yuku ships Dragon's platforms plus WASM.",
    "full_outcome_complete": false,
    "rationale": "No surveyed tool joins cross-file symbols, typed values after var() substitution, a custom-property graph, cascade winners and an element-tree join across finite states. CSS analysis is part of the core compile(), which T010/T011 keep free of native installs; @tsrx/yuku ships two platforms and no published WASM; yuku core has no CSS and the yuku-tsrx scanner emits structure only (no declarations or selector components), so a Zig analyzer is a new front end, not an extension. TS parsing and matching are fast enough at component scale.",
    "evidence_run": [
      "css-tree 3.2.1: width:1foo Mismatch; var() refused ('Matching for a tree with var() is not supported'), 111 declarations in Markless website sheets unchecked; @font-face descriptor false positive via matchDeclaration, correct via matchAtruleDescriptor; pins mdn-data 2.27.1 vs latest 2.37.0",
      "css-tree forked with @webref/css 8.7.5 syntaxes: rejects width:1foo and 5-value margin, accepts anchor-size() and light-dark()",
      "lightningcss 1.33.0: width:1foo passes silently with and without errorRecovery; visitor sees property 'unparsed'; CSS-modules exports mark keyframes isReferenced",
      "vscode-css-languageservice 6.3.10: in-file symbols, --x references and keyframes definition work; no diagnostic for width:1foo or undefined var(); single document only",
      "Speed on ~1 MB: css-tree parse 135 ms, match 15,469 declarations 46 ms; lightningcss transform 13 ms (single runs)"
    ],
    "evidence_read": [
      "yuku-tsrx src/dialect/style.zig: StyleSheet/CssRule/CssAtrule/CssSelector{scopeInsert}, declarations skipped, scanned:false on bail",
      "@tsrx/yuku 0.3.0 optionalDependencies: darwin-arm64, linux-x64-gnu only; wasm build step exists but unpublished",
      "yuku-analyzer 0.5.43 working copy: 11 native platforms, no analyzer WASM; cross-file linking implemented in JS (analyzer.js #resolveExport)",
      "@webref/css: property syntax, initial, inherited, appliesTo, computedValue, animationType; peerDependency css-tree ^3.2.1"
    ],
    "analyzer_queries": ["definitionsOf", "readersOf", "typeOf", "dependencyGraph (classify constant/environment/state/open, cycles)", "winnersFor", "specificityOnlyConflicts", "deadRules", "matchesFor", "ownerOf", "parentOf", "inheritedFrom", "textContextOf", "explain"],
    "missing_evidence": [
      "Full Dragon analysis time on a real app (decides any yuku port)",
      "css-tree+webref fork run over the whole Markless corpus",
      "Biome biome_css_semantic source not opened (search summary only)",
      "Svelte css-prune internals from search summary; stylo version from a secondary trace",
      "@csstools/css-parser-algorithms not probed"
    ],
    "owner_questions": [
      "Publish the analyzer as an editor-facing export in milestone 1, or keep it internal with only explain() public? Recommend internal until the table format is stable."
    ],
    "blocked_tasks": [],
    "required_board_updates": [
      "Record T018 done with evidence notes/T018-css-semantic-analysis.md",
      "Feed into T001: confirm @webref/css + css-tree fork over the corpus, and parser choice",
      "Feed into T002: the first slice needs typeOf (with var() substitution), winnersFor with the UA layer, and inheritedFrom for text nodes"
    ]
  }
}
```
