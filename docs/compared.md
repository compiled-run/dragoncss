# How Dragon compares

Plenty of good tools style apps with CSS or CSS-like code. Dragon exists for one job none of them does: taking the regular CSS you already write, turning it into real native view properties at build time, with no framework lock-in, and proving each feature against Chrome.

This is a summary. The evidence, with sources accessed on 2026-09-26, is in [T024](research/T024-styling-projects.md), [T011](research/T011-styling.md) and [T023](research/T023-stylex.md).

## At a glance

| | Regular CSS in | Real native views | Styles resolved at build time | Works with any framework | Checked against a browser |
|---|:-:|:-:|:-:|:-:|:-:|
| **Dragon** | ✅ | ✅ | ✅ | ✅ | ✅ |
| NativeWind / react-native-css, Uniwind | ✅ | ✅ | Partly (matched at runtime) | React Native only | ❌ |
| Unistyles, Tamagui | ❌ (JS objects) | ✅ | Partly | React Native only | ❌ |
| StyleX + React Strict DOM | ❌ (JS objects) | ✅ | Web only; native is a runtime polyfill | React only on native | ❌ |
| Lynx, NativeScript | ✅ | ✅ | ❌ (runtime engine) | Their own runtime only | ❌ |
| Blitz / Dioxus Native | ✅ | ❌ (draws its own pixels) | ❌ | Rust | ❌ |
| Tailwind, Panda, vanilla-extract, Linaria | ✅ or objects | ❌ (web only) | ✅ | ✅ | n/a |

## The families

**React Native styling** (NativeWind, react-native-css, Uniwind, Unistyles, Tamagui). Mature and well loved, and the right pick if you are already on React Native. All of them live inside React Native's runtime, and none checks its native output against a browser. The closest in shape, react-native-css, compiles CSS to tables at build time but still matches selectors on the device, keys rules by class name, flattens `@layer` and supports only the descendant combinator.

**StyleX and React Strict DOM.** StyleX is excellent on the web, and Dragon borrows its best idea: an element's styles come only from what is written for that element. Its only native route, React Strict DOM, is React-specific and resolves styles at runtime. The full comparison is in [T023](research/T023-stylex.md).

**Engines with their own runtime** (Lynx, NativeScript, Blitz). Real CSS, but welded to a runtime you have to adopt wholesale. Lynx and NativeScript match selectors on the device. Blitz draws its own pixels instead of using platform views.

**Web-only CSS tooling** (Tailwind, Panda, vanilla-extract, Linaria, Pigment). Great at producing CSS for browsers, and none has a native target. Tailwind's output can still feed Dragon, since it is plain CSS.

**Native UI toolkits** (SwiftUI, UIKit, Jetpack Compose, Android Views). These are Dragon's output, not its competition. Dragon writes the code you would write by hand, using platform features like dynamic colours and font metrics where they exist.

## What only Dragon does

1. **Plain CSS in, plain native code out.** Nothing on the device parses CSS or matches selectors. The only library that ships is the layout engine.
2. **Any framework.** The input is CSS plus a description of the element tree, so any compiler that knows its templates can use it.
3. **Build errors instead of silent drops.** If a platform can't do something, the error names the file, the line and a fix.
4. **Proof.** A feature counts as supported only when a test comparing it with Chrome passes.
