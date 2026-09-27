# Native styling design: restricted raw CSS

Design revision, 2026-09-26. This is a proposed behavioral contract, not implemented native support. Direction: [restricted CSS](T025-styling-direction.md); critique: [T020](T020-critique.json). Evidence: [CSS range](T015-css-range.md), [developer experience](T016-styling-dx.md), [parsed corpus](T017-css-corpus.md), [StyleX](T023-stylex.md), [engine survey](T024-styling-projects.md).

No TSRX MCP documentation or compile tool was available. The [TSRX specification](https://tsrx.dev/specification), sections 4.3–4.5, was checked on 2026-09-26 for statement-container components, raw CSS and scoped styles. Examples are Markless-idiom pseudocode, not compile-tested fixtures. Existing style-placement fixtures remain the repository's authority where the draft's prose conflicts.

## 1. The native rule

Keep raw CSS in `<style>`. A native selector may test its own element, ancestors authored in the same component, and app-root conditions. Shared tokens belong on the document root. Everything outside the supported profile is a source-located build error with a fix. Web builds keep full CSS. This removes cross-component matching from the native contract; it does not remove CSS value semantics.

Own-element tests include type, class, id, attributes, `ui-*`/ARIA state and supported pseudo-classes. A statically forwarded class on a headless part is an own-element test. `:not()`, `:is()`, `:where()` and nesting must expand entirely to supported selectors. Descendant/child ancestors must be proven unable to match an element authored in another component; uncertain composition is an error, never a narrower native match. Being in one file alone is insufficient if that file defines multiple components.

App-root compounds such as `html.dark .card` and `:root[data-theme="dark"] .card` test the document's state-driven root and are allowed in other components. A declaration whose subject is `:root` outside the component rendering `<html>` is an error: it cannot silently become global on native when web scoping would exclude the root. Component tokens belong on that component's element; published `--ui-*` values are read on the part or below it.

Sibling combinators, structural pseudo-classes, `:has()`, cross-component ancestors and unknown at-rules are errors in the first release. A possible later local structural extension is deferred, not promised for the headless release. Moving a selector between files is only a fix if its ownership proof then succeeds; forwarding a class is the ordinary fix.

## 2. Releases and evidence limits

The [report support table](report.md#native-styling-support) is the authoritative release profile. The simulator proof is a narrow counter/list/share compiler integration experiment with flex CSS. The first styling release requires simulator **and device** acceptance for plain components, including the selected layout engine. The next release adds proven native headless overlay behavior. `@markless/ui` remains headless on every platform; families do not become system widgets. Families whose requirements are not implemented fail the native build.

### Coverage is not compilation evidence

Earlier percentages are withdrawn as release coverage. The old estimates (for example 87.1% website rules, 72.6% headless rules, and later 100% generated rules) were each a **heuristic upper bound**, not checker results. The page-adoption totals around 68% and 89% were also a heuristic upper bound using unreweighted tiers that included descriptors and purported no-effect entries. They measure neither runnable apps nor percentage of CSS supported; no revised percentage is asserted.

The corpus comprises 73 headless rules, 1,155 hand-written website rules, 1,101 generated playground rules and 124 global stylesheet rules. The heuristic cannot classify values, units or host requirements. Known gaps include `ch`/`lh`, SVG `fill`/`stroke`, and five unknown website at-rules: `@anatomy-tree-selection`, `@keyboard-inspection`, `@keyboard-platforms`, `@keyboard-highlights`, `@anatomy-selection`. These are native errors until supported explicitly.

Before coverage claims, run the native-profile checker over the versioned corpus, recording source spans, target/profile version and classifications: exact, approximated, no-effect, unsupported, unknown. Keep a reproducible command and results in the repository; the old temporary parse output is insufficient. Classify each declaration's value/unit and selector/context, then each rule by its most restrictive result; keep unknowns separate from accepted results. Page-adoption weights require fresh membership calculation and a separate denominator excluding descriptors/no-effect entries from rendering support.

### Cost to existing CSS

The direction's inspection identifies the nested-menu selector `[role^="menuitem"] [role="menu"]` as cross-component because menubar items can supply the ancestor. It needs an own-state attribute on nested content; its name is an Open question under the headless naming contract. The tour scenario selector `[data-testid="toolbar"] button` needs a button class. Drawer `:dir(rtl)` is allowed. This preserves layered family defaults but does not prove value coverage: overlay placement and SVG paint remain separate gaps.

Of 169 website cross-component flags, 153 are allowed root conditions; the remaining 16 need ownership checks or forwarded classes. Same-component ownership must be checked for the 517 descendant combinators. Generated playground's 265 `:has()` rules and 13 sibling rules are first-release errors; its generator can express state on the subject. These are heuristic counts from [the corpus](T017-css-corpus.md), not successful native builds.

## 3. Architecture

### 3.1 Build-time checking and ordering

The compiler consumes structured authored nodes before HTML serialization, scoped CSS, finite class/state alternatives and traceable class forwarding. It proves selector ownership and records conditional matches on the logical tree. Repeated instances get their own inherited match flags; projections retain their authored ownership and ancestry. Dynamic composition that prevents proof fails with a forwarding suggestion.

Each element's normal author rules are sorted by named layer order, specificity and source order. Unlayered consumer rules beat `@layer markless`. Inline `style={{ ... }}` bindings outrank normal stylesheet declarations. No runtime selector search or cross-component specificity resolution is required. `!important` is a first-release error; correct reversed layer ordering is a later, tested extension. `revert` and `revert-layer` remain errors.

Parse values, fold target conditions and constants, and preserve dependency/source information. Expand ordinary shorthands using CSS reset semantics. Shorthands containing `var()` are expanded after substitution for each proven finite alternative, not before substitution. Unknown dynamic token sequences produce `MARKLESS_CSS_VAR_IN_SHORTHAND`. Use individual longhands such as `margin-block-start` with checked length values as the general fix. Two-axis shorthands are only accepted if their token arity is proven; merely spelling `margin-block` does not remove this restriction.

### 3.2 Tables and package boundaries

Emit one source-located style table per component: conditional declarations, dependencies, inherited match flags, supported motion and placement descriptions. This describes observable responsibilities, not a frozen storage layout. Keep declaration source spans in development and a separate release mapping file. Serializer owns version/record constants; platform profiles own supported values and diagnostics. Do not restate those facts in adapters.

Build the styling package inside Markless with a framework-neutral CSS-plus-authored-tree input and versioned table output. Reuse the yuku structure scanner and evaluate lightningcss for typed values. Swift/Kotlin evaluators consume the table contract without compiler internals; layout stays behind its own adapter. A standalone project waits for a stable format for one release, browser/iOS conformance for values, hit testing, transitions and colors, and a second real consumer.

### 3.3 Computed values on the logical tree

The logical tree is the authored parent relationship, independent of UIKit render parentage. Compute ancestors before descendants:

1. Select the winning active declaration from the build-sorted list, including inline bindings. An inline update changes the cascaded input, not component execution.
2. Compute custom properties **at the declaring element**. Substitute references using that element's inputs; cycles become guaranteed-invalid. Inherit the resulting computed token list, never an unevaluated ancestor expression. Root-only tokens may share an environment table, while local overrides still obey inheritance.
3. Substitute `var()` in normal declarations. A missing/guaranteed-invalid variable uses its fallback if present. If the resulting property value is invalid at computed-value time, behave as `unset`; do not revive an earlier losing declaration. A valid custom token that is invalid for its consuming property does not trigger the variable fallback.
4. Inherit computed values for normal inherited properties, including `color`, `font-*`, `line-height`, `visibility`, `pointer-events` and `direction`. Support `inherit`, `initial` and `unset`; `unset` inherits inherited properties and initializes other properties. Initial values come from the profile's CSS contract. Unitless line-height remains a multiplier; computed lengths inherit as lengths.
5. Resolve lengths and native paint from those computed values. Percentage/containing-block inputs remain layout dependencies, not an excuse to re-substitute ancestor variables at the child. Diff old and new computed values before layout/paint and transitions.

Conformance follows [CSS Variables](https://www.w3.org/TR/css-variables-1/) and [CSS Cascade](https://www.w3.org/TR/css-cascade-5/). Required browser/native cases, not executed tests:

```tsx
export function Tokens() @{
  <section class="parent"><p class="child">Red</p></section>
  <style>
    .parent { --a: red; --b: var(--a); }
    .child { --a: blue; color: var(--b); }
  </style>
}
```

Expected: child color is red. Parent computed `--b` before the child's blue override.

```tsx
export function Label() @{
  <span class="label">Inherited</span>
  <style>.label { color: inherit; }</style>
}
export function ThroughPart() @{
  <section class="parent"><Label /></section>
  <style>.parent { color: red; }</style>
}
```

Expected: red through the part boundary, with no cross-component selector. Repeat on a reparented overlay: inherited color and tokens stay the same.

```tsx
import { state } from '@markless/core';
export function InlineToken() @{
  let gap = state('8px');
  <button class="tile" style={{ '--x': gap }} onClick={() => (gap = '12px')}>Grow</button>
  <style>.tile { --x: 4px; margin-block-start: var(--x); }</style>
}
```

Expected: inline precedence gives 8px then 12px; only the dependent margin/layout updates. `margin: var(--x)` with an unbounded state input is a build error; a length longhand avoids token-arity ambiguity.

```css
.cycle { --a: var(--b); --b: var(--a); color: var(--a, red); }
.invalid { --x: 12px; color: blue; color: var(--x); }
```

Expected: the cycle uses red fallback. The invalid color inherits its parent's color, rather than restoring blue. Also verify missing fallback, `initial`/`unset`, finite shorthand alternatives and unsupported dynamic shorthand diagnostics.

### 3.4 Evaluator, layout and colors

A Swift evaluator selects compiled conditions from graph writes, host press/focus/pointer state, root state, viewport, keyboard, accessibility and trait changes. It updates subscribed descendants for inheritance and ancestor match flags. It does not parse CSS, walk the native view tree to match selectors, poll frames, rerender components, introduce a VDOM or hydrate. Android later consumes the same contract through its own evaluator.

`calc()`, `min()`, `max()`, `clamp()`, `var()` and `env()` have typed dependencies. Mixed percentage calculations require containing-block support in the selected layout adapter; unsupported/indefinite cases diagnose. Safe-area and keyboard inputs subscribe to host geometry. Proposed `rem` scaling uses a 16pt root at default iOS text size, scaled by body UIFontMetrics; `em` uses the inherited font size for font-size computation, otherwise the element's computed font size. Fixed `px` sizes do not gain an independent Dynamic Type multiplier. The text-size choice remains open.

Taffy offers flex, grid and real block layout; Yoga is flex only. Compare thinned arm64 download size and layout of a representative 1,000-node screen including 200 text nodes and measure callbacks on the oldest supported iPhone. Proposed acceptance: **at most 1 MB added download over Yoga and at most 1.25× Yoga's layout time**, plus a prebuilt xcframework so app authors need no Rust toolchain. These are proposed budgets, not measurements. If Yoga is chosen, grid errors and the documented flex-column approximation of block requires explicit acceptance before release; never change block semantics silently later.

Preserve color expressions and trait dependencies. UIKit properties retaining `UIColor` use dynamic providers. Borders, shadows, gradients and animation endpoints storing `CGColor` must re-resolve and repaint when scheme/contrast or relevant traits change; a cached CGColor is not dynamic. Runtime `color-mix()` supports `srgb`, `oklab`, `oklch` and the default hue method; other spaces/methods error. Compare trait changes during an active transition as well as idle paint. See [Apple color resolution](https://developer.apple.com/documentation/uikit/uicolor/resolvedcolor%28with%3A%29) and [CSS Color 5](https://www.w3.org/TR/css-color-5/#color-mix).

### 3.5 Text and interaction

Coalesce only a proven inline formatting context whose runs have computed `display: inline` in every reachable supported state, including ancestor conditions. Tag names alone are insufficient. Flex/grid containers retain child boxes; required headless part/handle identity remains distinct. Inline-to-box display switches are build errors. Projected text needs the same proof; unknown or unsupported embedded attachments error rather than becoming text. Links retain range hit targets and accessibility actions; selectable/link paragraphs use UITextView where needed. Padding, border and radius on inline runs are errors until their layout/paint is implemented. Compare against [CSS Display](https://www.w3.org/TR/css-display-3/).

`pointer-events` inherits on the logical tree. `none` skips the view itself during hitTest while still testing eligible subviews; an explicit `auto` descendant stays tappable. Do not map it to the broad UIKit interaction flag. Keyboard focus and accessibility remain unaffected; disabled/inert are separate behavior contracts. SVG-only values error. Required case:

```tsx
export function PassThrough() @{
  <div class="wrapper"><button class="child">Still tappable</button></div>
  <style>
    .wrapper { pointer-events: none; }
    .child { pointer-events: auto; }
  </style>
}
```

Verify child activation, propagation along authored ancestors, focus and accessibility using [CSS UI](https://www.w3.org/TR/css-ui-4/#pointer-events-control) as the oracle.

### 3.6 Motion

First release accepts explicit supported paint/compositor properties; `transition: all` errors with “list the properties.” Diffs use computed values, so variables, inheritance, inline bindings and classes follow the same path. Layout transitions remain errors: interpolating final frames does not reproduce intermediate CSS reflow. Do not advertise UIView.animate as CSS layout parity.

Opacity, transforms and supported colors/paint use host-clock animations with CSS timing. Interruptions start from the current presentation value; reversal must implement CSS reversing-shortening behavior, with browser-oracle cases before acceptance. Duration 0 and delay 0 starts no transition and emits no transitionend; cancellation emits transitioncancel for an active transition. Reduced motion and `transition: none` never promise a synthetic end event. Application cleanup must not depend on one. Keyframes remain a later extension. See [CSS Transitions](https://www.w3.org/TR/css-transitions-1/).

### 3.7 Headless overlay placement

Headless parts remain separate views styled through ordinary layered defaults and caller overrides. The later backend consumes supported anchor/placement records and committed geometry, adjusting for safe area, keyboard and scroll. It does not replace content with UIKit-drawn chrome. Family behavior owns showing above the page, focus, dismissal and modal isolation; CSS `position: fixed` alone does not enter the top layer.

First release rejects `position: fixed` outside a headless overlay part; overlay parts also fail until their backend is available. Later fixed support must reject transformed containing-block ancestors until that semantics is implemented. Normal absolute/relative positioning stays within supported containing blocks and stacking; unsupported combinations error.

Render reparenting never changes the logical parent used by inheritance, variables, match flags, event propagation or handles/containment. Required witnesses: an overlay inherits a parent token after moving to a window layer, the family handle still contains it, and a transformed-ancestor fixed example is rejected. See [CSS Positioned Layout](https://www.w3.org/TR/css-position-3/). Cross-component ancestor selectors remain errors even after overlay support arrives.

## 4. Authoring and diagnostics

### Document theme

```tsx
import { state } from '@markless/core';

export default function Document({ children }: { readonly children?: unknown }) @{
  let theme = state<'system' | 'light' | 'dark'>('system');

  <html class="app" data-theme={theme}>
    <body>
      <nav class="schemes">
        <button class="scheme" aria-pressed={theme === 'system'} onClick={() => (theme = 'system')}>System</button>
        <button class="scheme" aria-pressed={theme === 'light'} onClick={() => (theme = 'light')}>Light</button>
        <button class="scheme" aria-pressed={theme === 'dark'} onClick={() => (theme = 'dark')}>Dark</button>
      </nav>
      {children}
    </body>
  </html>
  <style>
    :root {
      color-scheme: light dark;
      --surface: light-dark(#fff, #1c1c1e);
      --raised: light-dark(#f2f2f7, #2c2c2e);
      --ink: light-dark(#111, #f5f5f7);
      --accent: AccentColor;
      --space: 1rem;
    }
    :root[data-theme="light"] { color-scheme: light; }
    :root[data-theme="dark"]  { color-scheme: dark; }
    .app { background: var(--surface); color: var(--ink); }
    .scheme[aria-pressed="true"] { background: var(--accent); color: white; }
  </style>
}
```

On iOS, `color-scheme` on the root sets the window's interface style, and `light-dark()` becomes a dynamic `UIColor`. The root tokens form one app-wide table, so no ancestor walk is needed to read them.


### Component-local styling and Dynamic Type

```tsx
export function Tab(props) @{
  <a class="tab" href={props.href}><span class="label">{props.label}</span><span class="count">{props.count}</span></a>
  <style>
    .tab { --gap: 8px; display: flex; gap: var(--gap); padding: 8px 16px; }
    .label { font-size: min(1rem, 22px); }
    .count { font-size: 11px; }
    @media (os: ios) {
      .label { font: -apple-system-subheadline; font-size: min(1rem, 22px); }
    }
  </style>
}
```

The anchor remains a flex box with two child views. The cap follows the font shorthand, which would otherwise reset size. `em` follows its inherited/computed font basis, not an unconditional system multiplier. Proposed `@media (os:)` is build-folded; existing alternatives are conditional classes driven by `target.os`, capability checks with `@supports`, or component branches for larger differences.

### Build errors

The following are proposed diagnostics using the existing CompilerDiagnostic contract, not implemented error codes. False target `@supports` branches are removed before unsupported-value checks. Native errors block that target and cannot be silenced by allow directives. The owner menu separately asks whether configured native-target errors should appear while working on web without blocking the web build.

```text
error MARKLESS_CSS_CROSS_COMPONENT  src/components/row.tsrx:22:3
  ".list" in ".list .row" can match an element in another component (src/routes/inbox.tsrx:9).
    22 |   .list .row { padding: 12px 16px; }
       |   ^^^^^^^^^^
  why: on ios a selector may look only at its own element, ancestors written in this component, and the app root.
  fix: pass a class through props (<Row class="in-list" />) and style ".in-list", or, if the compiler can prove .list is only rendered there, move this rule into src/routes/inbox.tsrx.

error MARKLESS_CSS_ROOT_OUTSIDE_DOCUMENT  src/components/card.tsrx:3:5
  ":root" is used in a component that does not render <html>.
    3 |   :root { --card-gap: 8px; }
      |   ^^^^^
  why: this rule's scope never reaches the document root on web, and on ios app-wide tokens live only on the root.
  fix: declare the token on ".card" if only this component uses it, or move it to the document component's :root.

error MARKLESS_CSS_SELECTOR_UNSUPPORTED  src/routes/settings.tsrx:40:3
  ":has(input:checked)" is not supported on ios in this release.
    40 |   .option:has(input:checked) { border-color: var(--accent); }
       |          ^^^^^^^^^^^^^^^^^^^
  why: native styles come from an element's own state and ancestors; a selector that looks at descendants needs a runtime matcher.
  fix: put the state on the element itself: <label class="option" data-checked={checked}> and style ".option[data-checked]".

error MARKLESS_CSS_VAR_IN_SHORTHAND  src/components/tile.tsrx:12:5
  "margin: var(--gap)" cannot be expanded for ios: --gap is set inline from state, so its value is unknown at build.
    12 |   .tile { margin: var(--gap); }
       |           ^^^^^^^^^^^^^^^^^
  why: a shorthand holding var() is split into longhands only after the variable's value is known.
  fix: write individual longhands (margin-block-start, margin-block-end, margin-inline-start, margin-inline-end), or give --gap only fixed values in <style>.
```


Additional errors include unsupported at-rule/value/unit, `transition: all`, inline box styling, conditional inline/box display, general fixed positioning, SVG paint and unproven selector ownership. Each names file/line, target, reason and an actionable supported replacement.

### Approximations and no-effect entries

Warnings are reserved for specified paint differences, such as a later blur radius mapped to a named iOS material. The diagnostic names that material; no claim of pixel parity is made. Layout, interaction, accessibility, inline padding/borders and arbitrary selector differences are errors, not warnings. The Yoga block approximation remains a separate explicit layout-engine decision.

The no-effect list is **proposed**, pending an omission test for each property/value/context showing unchanged layout, paint, hit testing and accessibility. A cursor declaration on a touch-only target may qualify; pointer-capable iPads need separate classification. Do not blanket-exempt rendering hints. `contain: paint` requires clipping; other contain values and `content-visibility` error in the first release. `touch-action` and `user-select: none` are gesture/selection behavior: implement and test their context or reject it. `pointer-events`, overscroll behavior and press feedback are behavior too. See [CSS Containment](https://www.w3.org/TR/css-contain-2/).

### Dev loop and inspector

Proposed output, **illustrative and unmeasured**:

```text
markless dev --target ios
  web + iPhone simulator (UIKit)
  style updated Card.tsrx (18 ms — illustrative, unmeasured)
```

Compatible style-table updates keep state and existing boxes without re-running component bodies. Box-structure changes, including text coalescing changes, rebuild the affected node using the existing reload path. Hiding focused content legitimately moves focus; changed scroll extent can clamp the offset. Focus/scroll preservation is conditional even when structure is unchanged.

The proposed inspector shows authored tags/parts, source declarations, computed/native values and diagnostics; environment toggles cover appearance, text size, reduced motion, contrast, RTL and geometry. Save-to-source edits only an unambiguous single authored longhand. Expanded shorthands, shared tokens, generated rules and competing source declarations require opening the authored source and editing explicitly; spans alone do not authorize an automatic rewrite.

## 5. Open questions and acceptance

The [owner menu](decisions.md) carries the four styling choices and layout budgets. Text-size policy, safe-area behavior under viewport-fit auto, precise platform condition vocabulary and the allowed later paint approximations remain researched defaults requiring confirmation/proof. The **nested-menu own-state attribute name is an Open question**: apply the headless SPEC's established names or ask the owner; no new name is proposed here.

No new public package name or storage schema is settled. The package split must retain serializer ownership of protocol facts and target ownership of profile facts. Compiler stability applies only within the supported extension contract.

Required implementation evidence: source-located rejection fixtures; browser/native conformance for section 3 values, text, hit testing, transitions, colors and overlays; source-edit compatibility tests; reproducible corpus classification; measured engine download/layout costs; device focus, accessibility and resource-lifetime checks. This document correction supplies contracts and examples, not those proofs or the later critique/audit outcome.
