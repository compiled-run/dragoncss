# Dragon CSS

Regular CSS for native apps, tested against the browser.

Dragon compiles the CSS you already write straight into native view properties: UIKit on iOS first, Android Views next. Anything a platform can't do is a build error that names the file, the line and a fix. It never silently drops a style.

Every feature Dragon claims to support is backed by a passing test that compares it with Chrome, so "supported" means measured, not hoped. The goal is as much CSS as possible, proven.

## How it works

1. **Build time (TypeScript, yuku):** read the CSS and the element tree, work out which rules apply to each element and in what order, compute values, and check each target's support list.
2. **Output:** generated native code that sets view properties directly, for example `layer.cornerRadius = 12`. Where the platform already has a mechanism, Dragon uses it instead of reinventing it:
   - `light-dark()` becomes a dynamic `UIColor`;
   - `rem` font sizes become `UIFontMetrics` scaling;
   - `env(safe-area-inset-*)` becomes the safe-area insets;
   - class changes driven by state become "when this value changes, set these properties".

   The only library on the device is the layout engine (Taffy, pending a size and speed measurement), because positions depend on real content and screen size. Nothing on the device parses CSS or matches selectors. The same "which properties go on which element" result is also written out as plain data for the test lanes.
3. **Proof:** Chrome records every box and resolved value. A Linux lane runs the compiled property list through the layout engine, and a simulator lane dumps what the native views actually got. Both are compared number by number. Side-by-side screenshots are published as evidence.

## Status

Early. Nothing is released. The npm package `dragon` will publish as `1.0.0-alpha.x` prereleases, because older `0.x` versions of that name are an unrelated drag-and-drop library.

Markless (`compiled-run/markless`) is the first user. Dragon's input is plain CSS plus a description of the element tree, so any tool that compiles templates can use it.

## Why not StyleX?

StyleX works with any framework on the web, but has no native target of its own. Its only route to native views, React Strict DOM, is React Native-specific and resolves styles at runtime, and nothing proves native output matches the browser. Dragon keeps StyleX's best idea, that styles stay local to the element, and adds real native views and tested parity for any tool. See [docs/why-not-stylex.md](docs/why-not-stylex.md).

## Research

The design and evidence behind this project are in [docs/research](docs/research/README.md).
