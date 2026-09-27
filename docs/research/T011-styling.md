# T011: CSS and CSS-like styling on native

Scout note, read-only research. All web sources accessed 2026-09-26. Claims marked **(unverified)** came from search-engine summaries and were not confirmed on the primary page; everything else was read on the cited page.

## Short answer

CSS on native is split in two. The layout part of CSS is largely solved: flexbox everywhere, and CSS grid and block layout in Taffy, a Rust library. The cascade part is solved only by products that ship their own style engine: Lynx and NativeScript match selectors on the device, and Blitz embeds Firefox's Stylo engine. The React Native world handles cascade by compiling it away or refusing it. React Native itself has no selectors; StyleX and React Strict DOM ban styling at a distance; NativeWind compiles CSS to tables and picks entries at runtime. Nobody ships CSS anchor positioning on native. Nobody ships `@layer` on native views, with one exception: Stylo implements it because Firefox does, but that is inference, not checked in Blitz. General block/inline text flow on retained native views is also unsolved (Blitz has it, but Blitz draws its own pixels).

The current Markless proposal is in the mainstream, and it is the NativeWind/react-native-css shape: parse at build time, encode selectors, conditions and declarations as data, run a small dependency-tracking evaluator on the device. What Markless adds is the cascade that NativeWind leaves out, namely layers and a specificity order fixed at build time. Recommendation: build the cascade compiler and evaluator ourselves and do not embed Stylo. For layout, embed Taffy behind our own small C interface, with Yoga as the fallback if a Rust toolchain is ruled out.

## Per-solution findings

### Layout engines

**Yoga** (Meta, C++, MIT per the repository; license not re-checked on the fetched page)
- Coverage: "a familiar subset of CSS, mostly focused on Flexbox"; a C API with official and unofficial language bindings ([about](https://www.yogalayout.dev/docs/about-yoga)).
- Releases: 3.2.0 (2024-12-03) added `display: contents` and `box-sizing`; 3.0 added `position: static` ([releases](https://github.com/facebook/yoga/releases)).
- Grid: requested since 2019 ([yoga#867](https://github.com/react/yoga/issues/867)). Meta's "CSS Grid 1/8" PR was **closed unmerged on 2026-06-03**, with the note "the diff D93946262 has been abandoned internally" ([RN#55665](https://github.com/facebook/react-native/pull/55665)). A community patch adds grid to Yoga and React Native ([react-native-css-grid-patch](https://github.com/OgDev-01/react-native-css-grid-patch)). No sign of grid in the React Native 0.84–0.87 headlines **(unverified; search summary)**.
- No block or inline flow. Text is inline and every other node is flex, per the React Strict DOM issue below.
- Used by React Native, Valdi and others.

**Taffy** (DioxusLabs, Rust, MIT)
- Coverage: Flexbox, CSS Grid and Block layout, plus a `float_layout` sub-feature and `calc` support, all behind feature flags ([docs.rs](https://docs.rs/taffy/latest/taffy/)).
- Inline and text layout are not included; the embedder supplies them through measure functions ([docs.rs](https://docs.rs/taffy/latest/taffy/)).
- Version and usage: 0.14.0, updated 2026-08-24, about 14.2M downloads ([crates.io API](https://crates.io/api/v1/crates/taffy)).
- Users: Servo, Blitz, Bevy, Zed (GPUI), Lapce (Floem), Slint ([repository](https://github.com/DioxusLabs/taffy)).
- Bindings: C and WASM bindings are "work in progress" ([repository](https://github.com/DioxusLabs/taffy)).
- Speed: the repository's own benchmark reports 38.6 ms for Taffy against 45.8 ms for Yoga on 100k nodes at depth 5, layout computation only ([repository](https://github.com/DioxusLabs/taffy)).
- Size on iOS and Android: not published; must be measured.

### React Native family

**React Native StyleSheet**
- `StyleSheet.create` is "an identity function"; its benefit is static type checking against native style properties ([docs](https://reactnative.dev/docs/stylesheet)).
- No selectors and no cascade. Array merging lets later entries override earlier ones (`compose`, `flatten`).
- It keeps gaining CSS properties, one at a time: `boxShadow` and `filter` in 0.76, New Architecture only ([0.76 blog](https://reactnative.dev/blog/2024/10/23/release-0.76-new-architecture)); `clip-path` from Callstack on 2026-01-28, which notes "React Native gives us a subset of CSS" ([Callstack](https://www.callstack.com/blog/bringing-css-clipping-to-react-native)).

**StyleX**
- Principle: "All styles on an element should be caused by class names on that element itself." Selectors such as `.a:hover button` are replaced with explicit markers.
- Resolution: compiled at build time to atomic CSS; the last style applied wins; pseudo-classes and media queries are written as conditions inside each property value ([thinking in StyleX](https://stylexjs.com/docs/learn/thinking-in-stylex/)).
- MIT.

**React Strict DOM** (Meta, MIT)
- On native it polyfills "CSS custom properties, inheritance, media queries, pseudo-classes, and more" ([Gallagher, 2025-11-24](https://nicolasgallagher.com/one-react-for-web-and-native/)).
- Flow layout (`display: block` and `inline`) on native is issue #2, still open and labelled "cannot polyfill" ([issue #2](https://github.com/facebook/react-strict-dom/issues/2)).
- Unsupported values are reported with runtime warnings ([setup docs](https://facebook.github.io/react-strict-dom/learn/setup/)); strict layout conformance needs `data-layoutconformance="strict"` **(unverified; search summary)**.
- Adoption: 3.6k stars; used by Meta teams ([repository](https://github.com/facebook/react-strict-dom)).
- Styles are applied at runtime on native. The article does not say this explicitly; it is inferred from the runtime warnings.

**NativeWind v4 and v5, with react-native-css** (MIT)
- v5 is a release candidate "not intended for production use", built on Tailwind v4 and react-native-css ([v5 overview](https://www.nativewind.dev/v5)).
- Resolution: "at build time, it compiles your Tailwind CSS styles into `StyleSheet.create` objects and determines the conditional logic of styles"; the runtime "applies the styles" ([v5 overview](https://www.nativewind.dev/v5)).
- Coverage: pseudo-classes (hover, focus, active on components that support them), media and container queries, CSS variables, animation and transition utilities ([v5 overview](https://www.nativewind.dev/v5)).
- react-native-css describes itself as "the most complete CSS support for React Native, within the limitations of Yoga". It inlines rem units and single-use variables at build time and resolves the rest at runtime; 164 stars ([react-native-css](https://github.com/nativewind/react-native-css)).
- Mechanism: lightningcss parses the CSS into a JSON stylesheet of selectors, media conditions and declarations, and the device tracks dependencies ([DeepWiki](https://deepwiki.com/nativewind/react-native-css)) **(unverified secondary source)**.
- Pseudo-classes need the component's event prop; transitions are experimental **(unverified; search summary of nativewind.dev docs)**.
- No `@layer` cascade: Tailwind's layers are flattened by its own compiler. This is inference, not checked.

**Tamagui**
- The compiler "extracts all types of styling syntax into atomic CSS" on the web. On native it flattens styled components into plain `View` and `Text`, and 30–50% of components typically flatten ([why a compiler](https://tamagui.dev/docs/intro/why-a-compiler)).
- Speed: native render 108 ms against 106 ms for hand-written React Native ([why a compiler](https://tamagui.dev/docs/intro/why-a-compiler)).
- No CSS text on native. Styles are props with media and pseudo keys.

**Unistyles 3** (MIT, 3.0k stars)
- A Babel plugin finds each stylesheet's dependencies. The stylesheets are rebuilt in C++, and changes (theme, breakpoint, orientation) update Fabric's shadow tree directly, "components are never re-rendered" ([how it works](https://unistyl.es/v3/start/how-unistyles-works/)).
- Claims it "adds under 0.1 ms to your StyleSheet" ([repository](https://github.com/jpudysz/react-native-unistyles)).
- Media queries, breakpoints and variants; pseudo-classes only on the web **(unverified)**. No selectors.

### Engines that run CSS on native views

**Lynx** (ByteDance, Apache-2.0, 15.1k stars; [repository](https://github.com/lynx-family/lynx))

Selectors and cascade:
- Supports type, class, ID, universal and compound selectors.
- Supports the descendant, child, `+`, `~` and list combinators.
- Supports `:active`, `:hover`, `:not()` and `:root`. There are no pseudo-elements. `!important` is off by default and can be enabled from engine 3.9 ([selectors](https://lynxjs.org/api/css/selectors.md)).
- Attribute selectors are not listed.

Media queries:
- From SDK 4.0 it supports a subset of Media Queries Level 4: width and height, orientation, hover, pointer, `prefers-color-scheme`, and range syntax.
- They require `enableCSSRule`: "Without it, `@media` rules are not encoded into the template" ([media query](https://lynxjs.org/api/css/media-query)).
- So CSS is encoded at build time into the bundle and matched at runtime by the C++ engine.

Layout:
- Supports linear (the default), flex, grid and relative layout.
- `display` has no `inline` or `block` values, and there is no margin collapsing ([layout](https://lynxjs.org/4.0/guide/ui/layout/)).

Other CSS:
- Custom properties, `@keyframes`, transitions and the full transform stack are covered ([Lynx 3.7](https://lynxjs.org/next/blog/lynx-3-7), 2026-04-16).
- Inherited properties are off unless `enableCSSInheritance` is set **(unverified; search summary)**.

Rendering and size:
- Mobile renders native UIView and Android View ([search summary of lynxjs.org glossary/embedding pages](https://lynxjs.org/guide/embed-lynx-to-native.html)) **(unverified)**. Desktop uses Lynx's own renderer ([Lynx 3.7](https://lynxjs.org/next/blog/lynx-3-7)).
- SDK size: not published.

**NativeScript** (native views, Apache-2.0; license not re-checked)
- Selectors: type, class, ID, descendant, child, adjacent sibling and attribute selectors.
- Pseudo-classes: "Currently, NativeScript supports only :highlighted pseudo-selector."
- Other CSS: media queries (orientation, color scheme, viewport), CSS variables, `calc()`, `@keyframes` ([styling](https://docs.nativescript.org/guide/styling)).
- Layout: done by containers (StackLayout, FlexboxLayout, GridLayout), not CSS `display` ([styling](https://docs.nativescript.org/guide/styling)).
- Resolution: CSS is parsed at runtime, with css-tree as the default parser. Selector candidates are narrowed through a `SelectorsMap` ([config API](https://docs.nativescript.org/api/interface/NativeScriptConfig), [SelectorsMap](https://docs.nativescript.org/api-reference/classes/_ui_styling_css_selector_.selectorsmap)) **(partly unverified)**.

### Engines that run full CSS and draw their own pixels

**Blitz** (DioxusLabs, MIT or Apache-2.0)
- Components: `blitz-dom` uses Stylo for CSS parsing and resolution, Taffy for box layout and Parley for text. Rendering is Vello/anyrender, on WGPU. The README calls it "beta" ([repository](https://github.com/DioxusLabs/blitz)); the about page still says alpha, targeting production in 2026 ([about](https://blitz.is/about)).
- Claims "complex selectors, media queries, css variables". Layout covers flexbox, grid, table, block, inline, absolute and fixed ([repository](https://github.com/DioxusLabs/blitz)).
- Status page: inline, inline-block, contents, floats and fixed positioning are supported; table is partial (emulated with grid); sticky is in progress; transitions and animations are supported; **all anchor-positioning properties are not supported** ([CSS status](https://blitz.is/status/css)).
- Size: 12 MB stripped macOS release, against Servo 98 MB, Electron about 130 MB, Ultralight about 22 MB and Sciter about 34 MB. Stylo is "very fast + reliable (but heavy)", with "poor documentation" ([Web Engines Hackfest 2024 slides](https://webengineshackfest.org/2024/slides/blitz_a_truly_modular_hackable_web_renderer_by_nico_burns.pdf)).
- Does not produce retained UIKit views.

**Stylo** (Servo and Firefox CSS engine)
- Published on crates.io: `stylo` 0.21.0, MPL-2.0, 24 versions, first published 2024-04-29, updated 2026-09-08 ([crates.io API](https://crates.io/api/v1/crates/stylo)).
- The Servo repository rebases onto mozilla-central ([servo/stylo](https://github.com/servo/stylo)).
- `stylo_taffy` converts Stylo computed values into Taffy styles ([lib.rs](https://lib.rs/crates/stylo_taffy)).
- The embedder must implement Stylo's DOM traits. Blitz is the reference example.

**Dioxus native** (Dioxus plus Blitz)
- The Dioxus 0.7 styling guide says "All 1st-party Dioxus renderers leverage CSS" ([styling](https://dioxuslabs.com/learn/0.7/essentials/ui/styling/)).
- The native renderer is Blitz, so its CSS support equals Blitz's. It is still alpha in the 0.8 cycle **(unverified; search summary)**.

**Sciter** (commercial license)
- Claims "a single, compact DLL of 5+ Mb" with flow, grid, flex, variables and transitions. It is used by Norton, ESET and BitDefender, and claims iOS and Android ([sciter.com](https://sciter.com/)).
- The 2024 slides measured about 34 MB.

**Ultralight** (a WebKit fork)
- Licensing: partly LGPL, otherwise commercial.
- Platforms: desktop and consoles; mobile is "coming soon" ([ultralig.ht](https://ultralig.ht/)).
- Not a mobile option today.

### Platform-native styling (not CSS)

**SwiftUI**
- Styling is done with modifiers that produce "a different version of the original value". Reusable styles are `ViewModifier` values ([ViewModifier](https://developer.apple.com/tutorials/data/documentation/swiftui/viewmodifier.json)).
- No selectors. Inheritance goes through the environment.

**Jetpack Compose**
- Modifiers are chained Kotlin objects, and "the order of modifier functions is significant" ([modifiers](https://developer.android.com/develop/ui/compose/modifiers)).
- Theming is done with CompositionLocal and MaterialTheme.

**Flutter**
- Styling uses ThemeData plus `Theme.of(context)`, with local `Theme` overrides. Priority runs: widget property, then nearest theme, then app theme ([themes cookbook](https://docs.flutter.dev/cookbook/design/themes)).
- No CSS. It draws its own pixels (Impeller) **(unverified here)**.

**Valdi** (Snap, MIT, beta)
- Compiles TypeScript UI "directly to native views on iOS, Android, and macOS". It uses a C++ flexbox layout engine and global view pooling ([repository](https://github.com/Snapchat/Valdi)).
- Styles are typed attributes (`backgroundColor`, `padding`). There is no CSS text.
- The layout engine is Yoga, and `<layout>` nodes have no backing platform view **(unverified; search summary of Valdi docs)**.

### Anything newer (2025–2026)

- Lynx 4.0 added media queries (2026).
- Lynx 3.7 added custom properties, keyframes and transitions (April 2026).
- NativeWind v5 RC is built on react-native-css (2026).
- Servo 0.1.0 was published on crates.io on 2026-04-13 ([Servo blog](https://servo.org/blog/2026/04/13/servo-0.1.0-release/)).
- The Yoga grid attempt was abandoned by Meta (June 2026).
- Callstack added `clip-path` to React Native (January 2026).
- Search found no new framework that compiles CSS directly into UIKit or Android views beyond those above.

## Comparison table

In the table, "on views" means "Retained native views?".

| Solution | Selectors (attr / descendant) | Cascade & `@layer` | Media / container | Custom props | Grid | Block/inline flow | Transitions / anims | Pseudo-classes | Resolves at | On views | Size/speed | Maturity | License |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Yoga | n/a | n/a | n/a | n/a | No (Meta PR abandoned 2026-06) | No | n/a | n/a | runtime layout | yes (layout only) | small C++ (unmeasured) | very high | MIT |
| Taffy | n/a | n/a | n/a | n/a | Yes | Block yes, inline via measure fn | n/a | n/a | runtime layout | yes if bridged | beats Yoga in own bench | high (0.14) | MIT |
| RN StyleSheet | none | array override only | none built in | none | No | No | Animated API | Pressable state | runtime | yes | baseline | very high | MIT |
| StyleX / RSD | forbidden by design | last-wins, no layers | per-property conditions | yes (defineVars) | No | No ("cannot polyfill") | polyfilled | polyfilled | build (web) / runtime (native) | yes | unmeasured | medium (Meta internal) | MIT |
| NativeWind v5 / react-native-css | class-based, group/parent state | none (Tailwind flattens) | both | yes | No | No | experimental | hover/focus/active if event exists | build tables + runtime | yes | unmeasured | v4 stable, v5 RC | MIT |
| Tamagui | none (props) | prop merge | media keys | tokens | No | No | via drivers | press/hover props | build flatten + runtime | yes | about equal to RN | high | MIT |
| Unistyles 3 | none | none | breakpoints/mq | themes | No | No | n/a | web only (unverified) | Babel + C++ shadow-tree updates | yes | <0.1 ms claim | medium | MIT |
| Lynx | descendant/child/sibling; attr not listed | specificity + optional `!important`; no layer mentioned | media (SDK 4.0, opt-in); container not mentioned | yes | Yes | No inline/block | yes (keyframes, transition) | active/hover/not/root | build-encoded + C++ runtime match | yes (mobile) | SDK size unpublished | high (ByteDance) | Apache-2.0 |
| NativeScript | descendant/child/+/attr | specificity, 4 levels | media (no container) | yes | GridLayout container, not CSS | No | keyframes | `:highlighted` only | runtime parse | yes | unmeasured | high, older | Apache-2.0 |
| Blitz (Stylo + Taffy) | full (Stylo) | full; `@layer` inferred from Firefox | media yes; container unverified | yes | Yes | Yes | yes | Stylo set | runtime | **no** (draws own pixels) | 12 MB macOS | beta/alpha | MIT/Apache, Stylo MPL-2.0 |
| Sciter | full | own engine | yes | yes | yes | yes | yes | yes | runtime | no | 5+ MB claim / 34 MB measured | high (desktop) | commercial |
| SwiftUI / Compose / Flutter | none | environment / theme inheritance | size classes / APIs | theme tokens | own grids | own | own | own state | compile + runtime | native | n/a | very high | platform |
| Valdi | none | none | none | none | No | No | own | own | build bindings + runtime | yes (UIKit) | "low size impact" (no number) | beta OSS, 8 yrs internal | MIT |

## 1. How far CSS has got on native

Solved:

- **Flex layout.** It is universal: Yoga, Taffy, Lynx, Valdi.
- **Grid and block layout.** Two engines outside browsers have them: Taffy (grid and block) and Lynx (grid). Yoga does not.
- **Media queries, color scheme and custom properties.** These are routinely supported, either compiled into tables (NativeWind, Unistyles) or matched at runtime (Lynx, NativeScript).
- **Transitions and keyframes.** Lynx ships them. React Strict DOM polyfills them. NativeWind lists them as experimental.
- **Selector matching on native views.** It works where an engine ships a matcher. Lynx supports descendant and sibling combinators; NativeScript adds attribute selectors.

Not solved on retained native views:

- **`@layer`.** No retained-view product mentions it. Stylo presumably has it through Firefox, but that is unverified.
- **Anchor positioning.** Unsupported everywhere, including Blitz.
- **General inline/block text flow.** React Strict DOM says it "cannot polyfill"; Lynx has no `inline`/`block` display values.
- **Container queries.** Only NativeWind and react-native-css claim them.
- **Full pseudo-class sets.** Support stops at press, hover and focus. There is no `:has`, and no `:focus-visible` in any source seen here.

The industry pattern is to compile the CSS at build time into a data table plus a small runtime condition evaluator (NativeWind, Unistyles, Lynx's template encoding). Full browser-grade engines (Stylo, Sciter, WebKit) exist, but only paired with their own drawing. None drives UIKit views.

## 2. Embed an engine or build our own evaluator?

**Stylo for the cascade: do not embed.**
- It is a runtime engine: it parses stylesheets and matches selectors on the device against a DOM that the embedder implements through traits. Markless can already do both at build time.
- Its authors call it "heavy", with "poor documentation" (slides above). The whole of Blitz measured 12 MB stripped, and the Stylo share is unmeasured.
- It is MPL-2.0 (file-level copyleft, acceptable for linking but an obligation), rebased monthly on mozilla-central, and needs a Rust toolchain for iOS and Android targets.
- Worth it only if Markless wanted to accept arbitrary CSS at runtime (for example CSS delivered over the air), which the proposal explicitly rejects.

**Taffy for layout: good candidate, with conditions.**
- It covers the gap the proposal defers: block and grid, with inline text via measure callbacks. It is MIT, benchmarks at or ahead of Yoga, and is widely used.
- Costs:
  - A Rust cross-compile to iOS arm64 and simulator slices plus Android ABIs.
  - Its C bindings are "work in progress", so Markless would own a thin `extern "C"` layer, or use `uniffi`/`swift-bridge`; that is an assumption, not researched here.
  - Measure callbacks cross the FFI boundary for each text node, to reach UIKit/TextKit and Android text measurement.
  - Binary size is unmeasured. It must be measured before any decision.
- **Yoga** is the fallback: C++ with no Rust toolchain, battle-tested with UIKit, flex only. Choosing it keeps `display: block` as a flex column and grid unavailable, as the report already proposes.

**Our own cascade compiler and evaluator: build.**
- The work maps onto what Markless's compiler already does. It knows every host node, class alternative, state attribute (`ui-*`) and forwarded class prop, so selector matching can be precomputed per node into condition lists sorted by layer, then specificity, then source order.
- The device evaluator then needs only:
  - bit tests for class, state, pseudo-class and media conditions;
  - custom-property lookup along the known host chain;
  - a diff of the resolved properties, pushed to the layout engine and to view properties.
- It runs in Swift or Kotlin, or in a small shared C core; that choice is open.
- This is the NativeWind/Lynx pattern plus layers.

The headless families' actual CSS confirms this scope. A grep census (approximate) of `packages/headless/components/src/*/*.tsrx` style blocks finds:

- Mostly attribute and compound-attribute selectors, including one prefix match (`[role^=`).
- `:not()`, `@layer` and `var()`.
- One descendant combinator, in menu: `[role^="menuitem"] [role="menu"]`.
- Heavy use of anchor properties (`anchor-name`, `position-anchor`, `position-area`, `anchor-scope`, `anchor()`).
- Only a few `calc/min/max`.

Every selector there has an ancestry fixed by the template, so all of it compiles at build time. Anchor positioning must be lowered to a native overlay placement adapter, because no engine provides it.

## 3. Recommendation

1. **Build** the cascade in the compiler and a table-driven evaluator on the device (the report's proposal, confirmed).
   - Extend the accepted selectors to descendant and child combinators where the ancestor is a statically known host node, compiled into a condition on that ancestor's state. The menu rule needs this.
   - Keep rejecting open-ended matching of descendants.
2. **Adopt Taffy** as the layout engine, behind a Markless-owned C interface, **if** a measured size check passes. The budget number is for the owner to decide.
   - This unlocks `display: block` (as real block layout, not a flex column) and `display: grid`.
   - Inline text runs remain a native text view measured through a callback.
   - If the Rust toolchain or size is rejected, use Yoga and keep the current flex-only profile.
3. **Do not embed** Stylo, Blitz, Sciter or Ultralight on the retained-view path. Blitz stays relevant only as a possible future "drawn" target.
4. **Anchor positioning:** compile `position-anchor` and `position-area` into a placement record consumed by a UIKit overlay adapter. Report `position-try` and `anchor()` math as unsupported at build time until that adapter is proven.

### Pseudocode (Markless idiom)

Source (unchanged authoring):

```tsx
import { state } from '@markless/core';
export function Card(props) @{
  let open = state(false);
  <section class={open ? 'card open' : 'card'} ui-open={open}>
    <button onClick={() => (open = !open)}>Toggle</button>
  </section>
  <style>
    @layer markless { .card { display: flex; flex-direction: column; padding: 16px; } }
    .card[ui-open] { background: var(--surface); }
    .card:active { opacity: 0.8; }
    @media (prefers-color-scheme: dark) { .card { --surface: #222; } }
  </style>
}
```

Build output (sketch of a proposed native style artifact; field names illustrative, protocol constants would live in the serializer package):

```ts
// Emitted per component; no CSS text ships to the device.
const cardStyles = {
  conditions: ['class:open', 'attr:ui-open', 'pseudo:active', 'media:dark'], // bit 0..3
  nodes: {
    section$1: [
      // sorted once at build time: layer rank, specificity, source order
      { when: 0b0000, layer: 0, decl: { display: 'flex', flexDirection: 'column', padding: 16 } },
      { when: 0b1000, layer: 1, decl: { '--surface': '#222' } },
      { when: 0b0010, layer: 1, decl: { background: { var: '--surface', fallback: null } } },
      { when: 0b0100, layer: 1, decl: { opacity: 0.8 } },
    ],
  },
  deps: { background: ['--surface'] },     // which vars invalidate which props
  layout: 'taffy',                          // or 'yoga' profile; decided by target config
};
```

On device (what ships; Swift-flavoured, same shape in Kotlin):

```swift
// Runs on graph writes, pointer/focus changes, or trait changes. No CSS parsing.
func restyle(_ node: HostNode) {
  let mask = node.classBits | node.stateBits | node.pseudoBits | env.mediaBits
  var out = Computed(inheritedVars: node.parent?.computed.vars)
  for rule in table.nodes[node.id]! where rule.when & mask == rule.when {
    out.apply(rule.decl)                        // later entries win: order was fixed at build
  }
  out.resolveVars(deps: table.deps)
  let changed = out.diff(node.computed)
  if changed.affectsLayout { layout.setStyle(node.layoutId, changed) }   // Taffy/Yoga via C ABI
  node.view.applyPaint(changed)                                          // UIView layer props
  node.computed = out
}
```

## Open questions for the owner

- Is a Rust toolchain acceptable in iOS and Android builds (for Taffy)? If not, Yoga keeps layout flex-only.
- What is the binary-size budget for the layout engine? Measure Taffy against Yoga in a stripped iOS and Android hello-world before deciding.

```json
{
  "goalbuddy_receipt_v1": {
    "task": "T011",
    "result": "done",
    "summary": "Layout CSS on native is mostly solved: flex everywhere, grid and block in Taffy, grid in Lynx; Yoga grid was abandoned by Meta in June 2026. Cascade is solved only by shipping an engine: Lynx and NativeScript match at runtime on native views, and Stylo/Blitz only with custom drawing. The React Native ecosystem compiles CSS into tables plus a small runtime (NativeWind/react-native-css, Unistyles) or bans at-a-distance selectors (StyleX/RSD). @layer, anchor positioning and inline flow are unsolved on retained native views. Recommendation: build the Markless cascade compiler and table evaluator (confirms report), extended to template-static descendant selectors; adopt Taffy behind a Markless-owned C interface if a measured size check passes (Yoga fallback); do not embed Stylo/Blitz; lower anchor positioning to a native overlay placement record.",
    "evidence": [
      "notes/T011-styling.md",
      "https://docs.rs/taffy/latest/taffy/",
      "https://github.com/DioxusLabs/taffy",
      "https://crates.io/api/v1/crates/taffy",
      "https://www.yogalayout.dev/docs/about-yoga",
      "https://github.com/facebook/yoga/releases",
      "https://github.com/facebook/react-native/pull/55665",
      "https://reactnative.dev/docs/stylesheet",
      "https://reactnative.dev/blog/2024/10/23/release-0.76-new-architecture",
      "https://www.callstack.com/blog/bringing-css-clipping-to-react-native",
      "https://stylexjs.com/docs/learn/thinking-in-stylex/",
      "https://nicolasgallagher.com/one-react-for-web-and-native/",
      "https://github.com/facebook/react-strict-dom/issues/2",
      "https://www.nativewind.dev/v5",
      "https://github.com/nativewind/react-native-css",
      "https://tamagui.dev/docs/intro/why-a-compiler",
      "https://unistyl.es/v3/start/how-unistyles-works/",
      "https://lynxjs.org/api/css/selectors.md",
      "https://lynxjs.org/api/css/media-query",
      "https://lynxjs.org/4.0/guide/ui/layout/",
      "https://lynxjs.org/next/blog/lynx-3-7",
      "https://docs.nativescript.org/guide/styling",
      "https://github.com/DioxusLabs/blitz",
      "https://blitz.is/status/css",
      "https://blitz.is/about",
      "https://webengineshackfest.org/2024/slides/blitz_a_truly_modular_hackable_web_renderer_by_nico_burns.pdf",
      "https://crates.io/api/v1/crates/stylo",
      "https://dioxuslabs.com/learn/0.7/essentials/ui/styling/",
      "https://sciter.com/",
      "https://ultralig.ht/",
      "https://github.com/Snapchat/Valdi",
      "https://developer.android.com/develop/ui/compose/modifiers",
      "https://developer.apple.com/tutorials/data/documentation/swiftui/viewmodifier.json",
      "https://docs.flutter.dev/cookbook/design/themes"
    ],
    "accessed": "2026-09-26",
    "caveats": [
      "Items marked (unverified) rely on search summaries",
      "No iOS/Android binary-size measurement exists for Taffy, Yoga, Lynx or Stylo alone",
      "Headless CSS census is an approximate grep, not a parser pass",
      "Stylo @layer support inferred from Firefox, not checked in Blitz"
    ]
  }
}
```
