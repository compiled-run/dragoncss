# Why not StyleX?

StyleX is excellent at what it was built for: styling React apps on the web. Agents work well with it, and Dragon borrows its best idea. But it can't do what Dragon exists for: running regular CSS on real native views, proven against the browser. The evidence is in [research/T023-stylex.md](research/T023-stylex.md), sources accessed 2026-09-26.

## What StyleX gets right, and Dragon keeps

- **Styles are local.** An element's styles come only from what is written for that element, with no styling from a distance. Dragon's native rule is the same idea: a selector may only test its own element, parents in the same component, and app-wide conditions like dark mode.
- **Predictable merging.** Dragon warns when two rules on one element differ only by specificity.
- **Typed, immediate errors.** Dragon's support profiles feed typecheck and the editor, so a style a platform can't render fails at build time with a fix.

## Why it isn't enough

1. **It has no native target of its own.** On the web, StyleX works with any framework: it calls itself "a CSS-in-JS solution, not a CSS-in-React solution", and its docs show Preact, Solid, lit-html, Angular and SvelteKit through `stylex.attrs()`. Its output is atomic CSS classes for browsers. The only route from StyleX to iOS and Android views is React Strict DOM, and that route:
   - is React and React Native specifically;
   - works out styles at runtime in JavaScript, with each `div` about twice as slow as a plain React Native view (a figure from a talk summary, not verified);
   - supports less CSS on native than Dragon's first release: no `calc`/`min`/`max`, grid, inline display, fixed or sticky positioning, keyframes, or `when.*` helpers.

   So StyleX users who aren't on React have no native path at all.
2. **Its input is JavaScript objects run through its own compiler.** StyleX needs Babel or SWC over JS/TSX, and merges styles with `stylex.props()` or `attrs()` calls in the component. That works well for JS-first frameworks. It is a poor fit for compilers that take markup plus CSS and need every style known at build time, such as Markless, which rejects spreads built at runtime. Dragon takes plain CSS plus a description of the element tree, so it fits either kind of tool.
3. **It doesn't solve the hard part.** StyleX's rule removes selector matching and specificity fights. The difficult work in native CSS is what values mean, and StyleX leaves that untouched:
   - variables that read other variables;
   - fixed positioning;
   - `pointer-events`;
   - dark-mode colours on borders and shadows;
   - text layout.

   React Strict DOM mostly avoids these by not supporting them.
4. **It proves nothing about parity.** Unsupported styles show up as runtime warnings in development. Nothing checks, feature by feature, that native output matches the browser. Dragon's core promise is that a feature counts as supported only when a test comparing it with Chrome passes.
5. **It is a different language.** StyleX styles are JavaScript objects, and existing CSS has to be rewritten into them. Headless UI libraries built on `@layer` defaults and attribute selectors, like `@markless/ui`, would need restructuring. Dragon accepts the CSS people and agents already write.

## Could Dragon accept StyleX-style objects too?

Possibly, as a second input that compiles to the same native properties. Whether it's worth adding will be decided by measurement. Agents will do the same styling tasks in raw CSS and in typed objects, and the input with more first-try passes, against Dragon's checks and the Chrome comparison, wins.
