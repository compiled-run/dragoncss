# T016: Styling developer experience for native apps

Scout note, read-only research. All web sources accessed 2026-09-26. Claims marked **(unverified)** came from search-engine summaries or secondary articles and were not confirmed on the primary page. Survey freeform counts are small (tens of mentions), so they show direction, not size.

## Short answer

Web developers who move to native want, in order: to keep writing real CSS, dark mode and theming that just work, a clean way to tweak one platform, to be told when a style does nothing, speed, and little setup. Tailwind matters to a large minority. Nobody asks for "native feel" or Dynamic Type up front, but apps are judged on them, and the React Native tools leave both to the developer.

The strongest move for Markless is to answer every one of these with **standard CSS the developer already knows**, given a native meaning:

- `env(safe-area-inset-*)` becomes UIKit safe-area insets.
- `light-dark()`, `color-scheme` and the CSS system colors (`Canvas`, `CanvasText`, `AccentColor`) become UIKit dynamic colors.
- `rem` follows Dynamic Type, and `system-ui` is SF Pro or Roboto.
- `:active` behaves like a UIKit highlighted state.
- `@supports` is answered truthfully for each target.
- A folded `@media (os: ios)` mirrors the proposed `target.os` value.

On top of that, unsupported CSS is a **build error with file, line, reason and a fix**, never a silent drop. And the dev loop edits styles live on the web page and the simulator at once, keeping component state. No surveyed tool combines all three.

## 1. What developers say (evidence)

### Surveys

**State of React Native 2025, styling** ([results](https://results.stateofreactnative.com/en-US/styling/)):

| Approach | Used it |
|---|---|
| Inline styles | 91.2% |
| StyleSheet | 90.3% |
| NativeWind | 42.1% |
| styled-components | 37.6% |
| Unistyles | 28.9% |

Freeform pain points in 2025:

| Pain point | Mentions |
|---|---|
| Light/dark theme | 26 |
| NativeWind issues | 20 |
| "Lack of CSS API" | 16 |
| StyleSheet limitations | 15 |
| Cross-platform support | 14 |
| Performance | 14 |

The report says "Lack of CSS API still shows up as a top pain point" even after box shadows, gradients and filters landed. The 2025 retention and satisfaction figures for each library were not retrieved.

**State of React Native 2024** ([results](https://results.2024.stateofreactnative.com/en-US/styling/)):

| Pain point | Mentions |
|---|---|
| Light/dark theme | 32 |
| Cross-platform support | 29 |
| NativeWind | 23 |
| Performance | 18 |
| "Lack of CSS api" | 14 |
| Excessive complexity | 13 |

The 2024 report also says developers are "most satisfied" with StyleSheet, Unistyles and NativeWind. NativeWind grew +15% and Unistyles +13%.

**State of CSS 2025, Tailwind**: about 37% of respondents actively use Tailwind, and "Excessive Tailwind usage" was the 5th freeform CSS pain point (13 answers). These figures come from secondary summaries **(unverified)**: [Tailkits](https://tailkits.com/blog/popular-css-frameworks/), [State of CSS 2025 usage](https://2025.stateofcss.com/en-US/usage/).

### Per tool: praise and complaints

**React Native StyleSheet**
- Praise: most satisfied users, and simple (2024 survey).
- Complaints: no CSS, no cascade, no media queries.
- Dark mode is hand-rolled with `useColorScheme`.
- Style editing in DevTools has been unreliable for years:
  - "RN style editor doesn't work with themes" ([react-devtools#759](https://github.com/facebook/react-devtools/issues/759)).
  - An RFC on the undocumented hook that powers style editing auto-closed ([react#17148](https://github.com/react/react/issues/17148)).
  - The current RN DevTools docs promise prop and state editing, with no style panel ([docs](https://reactnative.dev/docs/react-native-devtools)).

**NativeWind v4/v5**
- Praise:
  - It is the most-used styling library (42%).
  - Tailwind knowledge transfers directly.
  - Platform variants `ios:`, `android:`, `native:` and `web:` exist ([differences](https://www.nativewind.dev/docs/core-concepts/differences)).
  - v5 accepts raw `@media ios {}`, `@media android {}` and `@media native {}` in CSS ([responsive design](https://www.nativewind.dev/v5/core-concepts/responsive-design)).
  - `p-safe` safe-area utilities ([safe area](https://www.nativewind.dev/docs/tailwind/new-concepts/safe-area-insets)).
- Complaints: failures are silent or intermittent.
  - "Using the nativewind installation verification helper returns no errors or warnings", yet styles are missing ([#924](https://github.com/nativewind/nativewind/issues/924)).
  - Styles fail only in production bundles ([#1481](https://github.com/nativewind/nativewind/issues/1481)).
  - Styles stop applying after a minor upgrade ([#1169](https://github.com/nativewind/nativewind/issues/1169)).
  - Dark mode is a recurring bug source:
    - "Unable to manually set color scheme without using darkMode: class" ([#587](https://github.com/marklawlor/nativewind/issues/587)).
    - "Cannot manually set color scheme, as dark mode is type 'media'" ([#1489](https://github.com/nativewind/nativewind/issues/1489)).
    - The system setting overrides the user's in-app choice ([#866](https://github.com/nativewind/nativewind/issues/866)).
  - The official troubleshooting advice is to generate `output.css` by hand and diff it ([troubleshooting](https://www.nativewind.dev/docs/getting-started/troubleshooting)).
  - The only structured report seen is `IncompatibleNativeValue`, a console dump from `verifyInstallation()` ([#603](https://github.com/nativewind/nativewind/issues/603)).
  - Performance: Uniwind's benchmark on iOS measured NativeWind at 197 ms against 50 ms for StyleSheet ([uniwind-benchmarks](https://github.com/uni-stack/uniwind-benchmarks)). This is a vendor benchmark **(unverified; numbers from a search summary)**.

**Uniwind** (by the Unistyles team)
- It uses Tailwind v4 with CSS-first `@theme`.
- Themes are only CSS variables, with no JS provider.
- The docs mark platform selectors `ios:`/`android:` as "Recommended" and `Platform.select()` as "Not Recommended" ([platform selectors](https://docs.uniwind.dev/api/platform-select)) **(unverified; search summary)**.

**Unistyles 3**
- Praise:
  - Its runtime `rt` object exposes `insets` (including `ime`, the keyboard), `fontScale`, adaptive themes and orientation.
  - Styles that depend on them update "with no re-render, just like CSS on the web" ([mini runtime](https://www.unistyl.es/v3/references/mini-runtime/), [Expo blog](https://expo.dev/blog/unistyles-3-0-beyond-react-native-stylesheet)).
- Complaints:
  - It needs the New Architecture, which rules out Expo Go.
  - React Compiler interplay forced re-renders ([#368](https://github.com/jpudysz/react-native-unistyles/issues/368)).
  - Adaptive themes read device settings, "not user preferences" **(unverified; search summary)**.

**Tamagui**
- Complaints:
  - "Adds a lot of complexity" ([HN](https://news.ycombinator.com/item?id=34192805)).
  - "The setup process for Expo apps is tedious", and the docs are hard to follow ([LogRocket via DEV](https://dev.to/logrocket/best-headless-ui-libraries-in-react-native-13i8)) **(unverified; search summary)**.
  - Config mistakes crash "with cryptic errors" despite TypeScript passing, costing one user 5 hours ([#3361](https://github.com/tamagui/tamagui/issues/3361)).
  - An Expo upgrade broke config discovery, costing one user 20 hours ([#3569](https://github.com/tamagui/tamagui/issues/3569)).
- Praise: once set up, day-to-day work is fast ([PkgPulse](https://www.pkgpulse.com/guides/nativewind-vs-tamagui-vs-twrnc-react-native-styling-2026)) **(unverified)**.

**React Strict DOM (Meta)**
- Only runtime warnings, but structured and greppable:
  - `[warn] React Strict DOM: unsupported style value in "display:inline-flex"`
  - `[error] React Strict DOM: css.keyframes() is not supported`
- The README advises suppressing them with LogBox only "as a last resort" (README content via search summary, [#260](https://github.com/facebook/react-strict-dom/issues/260)) **(unverified wording)**.
- It confirms the need for structured reporting, but the feedback comes at runtime, per screen visited.

**Lynx**
- Praise: a real Chrome-DevTools-style Elements panel against the device. It has a Styles tab (all matched rules, and "find invalid, overridden or broken CSS"), a Computed tab with the box model, and live edits of `element.style` that show on the device ([Elements panel](https://lynxjs.org/guide/devtool/panels/elements-panel)).
- It is the only surveyed native-view tool with browser-grade style inspection.

**Flutter**
- Praise: DevTools Widget Inspector plus Layout Explorer ("One of my favourite features"), with stateful hot reload ([inspector](https://docs.flutter.dev/tools/devtools/inspector), [legacy Layout Explorer](https://docs.flutter.dev/tools/devtools/legacy-inspector)).
- Complaints: "it doesn't feel like an iOS app".
  - Measured causes:
    - The overscroll spring settles in ~0.81 s against ~0.63 s natively ([#181752](https://github.com/flutter/flutter/issues/181752)).
    - Scrolling lags native by one frame ([#110431](https://github.com/flutter/flutter/issues/110431)).
    - Flings travel ~7% short on Android **(unverified; search summary)**.
  - The fix is not "sprinkling Cupertino widgets" ([Medium](https://medium.com/@shreebhagwat94/fixing-a-flutter-app-that-doesnt-feel-like-an-ios-app-507c4d3b8dfb)) **(unverified; search summary)**.

**SwiftUI**
- Praise:
  - Text styles (`.font(.body)`) scale with Dynamic Type automatically.
  - Semantic colors (`.primary`, `.secondary`) adapt to dark mode and increased contrast with no code ([Eidhof](https://chris.eidhof.nl/post/semantic-colors/), [Sundell](https://www.swiftbysundell.com/articles/defining-dynamic-colors-in-swift/)) **(unverified; search summary)**.
  - Xcode Environment Overrides toggle text size and appearance live.
- Complaints: previews "are often slow or stop working after a few minutes" ([dasdom](https://dasdom.dev/hot-reloading-in-swiftui/)).
  - An Apple engineer called PreviewShell crashes "a known issue without a great workaround" ([forum](https://developer.apple.com/forums/thread/762993)).
  - Developers turn to InjectionIII for hot reload.

**Jetpack Compose**
- Live Edit of literals is deprecated. Full Live Edit had change-detection gaps, and edits did not persist across restarts ([deep dive, 2023](https://android-developers.googleblog.com/2023/07/deep-dive-into-live-edit-for-jetpack-compose-ui.html), [iterative development](https://developer.android.com/develop/ui/compose/tooling/iterative-development)).
- Previews cannot build ViewModels that use dependency injection.

**Expo**
- At React Conf 2025, Expo signalled first-party "native CSS" and Tailwind-like styling. This comes from recaps, not a primary announcement ([Callstack wrapped](https://www.callstack.com/blog/react-native-wrapped-2025-a-month-by-month-recap-of-the-year)) **(unverified)**.
- As of mid-2026, Expo's Tailwind guide still sends users to NativeWind or Uniwind ([guide](https://docs.expo.dev/guides/tailwind/)).
- Its setup wraps every primitive by hand in `src/tw/` **(unverified; search summary of Expo skill)**.
- Platform idioms ship as separate components, for example `expo-glass-effect` for iOS 26 Liquid Glass, with manual `isLiquidGlassAvailable()` and reduce-transparency checks ([docs](https://docs.expo.dev/versions/latest/sdk/glass-effect/)).
- Fast Refresh keeps `useState` across edits and falls back to a remount or a full reload in some cases ([Fast Refresh](https://reactnative.dev/docs/fast-refresh)).

### Platform idioms React Native leaves to the developer

- **Dynamic Type.**
  - Layouts break at large sizes: "Text was overflowing, buttons were cramped" (search summary of [Medium](https://medium.com/@commitnobug/how-i-fixed-font-scaling-in-react-native-ba90a8cf069a)) **(unverified)**.
  - Developers globally disable scaling, which is "a big no-no for accessibility" ([Ignite cookbook](https://ignitecookbook.com/docs/recipes/AccessibilityFontSizes/)).
  - `maxFontSizeMultiplier` was reported ignored on Fabric ([RN#35658](https://github.com/react/react-native/issues/35658)).
  - The web has a precedent: `font: -apple-system-body` makes WebKit pages follow Dynamic Type ([WebKit](https://webkit.org/blog/3709/using-the-system-font-in-web-content/), [furbo.org](https://furbo.org/2024/07/04/dynamic-type-on-the-web/)).
- **Press feedback.**
  - Android users expect a ripple, and without it an app "can feel unfinished". `android_ripple` was broken from RN 0.80 to 0.82 ([Medium](https://medium.com/@soodakriti45/android-ripple-isnt-working-in-react-native-here-s-why-600ee87571b4)) **(unverified; search summary)**.
  - Pressable's `pressRetentionOffset` exists because touch is imprecise ([Pressable](https://reactnative.dev/docs/pressable)).
  - Haptics need a third-party package.
- **Safe areas.** They need `react-native-safe-area-context` plus a provider, even with NativeWind's `p-safe`. On the web, standard `env(safe-area-inset-*)` does the same job ([MDN env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env)).
- **Scroll physics.** Retained UIKit/Android scroll views get them for free. Self-drawing engines (Flutter) fight an uncanny valley. This favours the Markless UIKit-view plan.

## 2. What web developers want, ranked

| # | Want | Evidence | Markless answer |
|---|---|---|---|
| 1 | Keep writing real CSS; web knowledge transfers | "Lack of CSS API" is a top-3 pain point both years; NativeWind is the most-used library; Expo signalled native CSS; RSD and react-native-css exist to fake it | Raw `<style>`, unchanged syntax, standard features given native meanings (§3) |
| 2 | Dark mode and theming that just work, including a user override | #1 pain point in 2024 (32) and 2025 (26); NativeWind issues #587, #866 and #1489; SwiftUI semantic colors praised | `color-scheme`, `light-dark()`, custom properties and system colors, mapped to UIKit dynamic colors; the override is one `color-scheme` value |
| 3 | Know when a style does nothing | Silent failures in NativeWind #924, #1169 and #1481; Tamagui cryptic errors (5 and 20 lost hours); RSD needed structured warnings | Build and editor errors with location, reason and fix; `@supports` as the sanctioned escape (§3.8) |
| 4 | Clean platform tweaks | Cross-platform is a top pain point (29, 14); NativeWind/Uniwind platform variants recommended over `Platform.select` | `@media (os: ios)` folded at build time, matching `target.os`; `@supports` for capabilities |
| 5 | Speed | Performance pain point (18, 14); NativeWind is ~4x slower than StyleSheet in a vendor benchmark | Selectors matched at build time and a table evaluator (T011); no CSS parsing on the device |
| 6 | Little setup and no version drift | "Excessive complexity" (13); Tamagui setup complaints; NativeWind package mismatches | Styling is part of the compiler; no provider, Babel plugin or wrapped primitives |
| 7 | Tailwind | ~42% of RN developers use NativeWind; ~37% of web developers use Tailwind **(unverified)** | Tailwind v4 output is plain CSS, so it goes through the same checker, later (§3.9) |
| 8 | Inspector and live style edits | RN's style editor is long broken; Lynx and Flutter inspectors praised; SwiftUI previews unreliable | Lynx-style Elements panel over CDP, with authored rule, computed native value and dropped-rule reasons (§3.10) |
| 9 | Native feel without trying: press states, scroll, system font | Flutter uncanny valley; Android ripple expectation | Retained UIKit scroll views; `:active` with UIKit highlight semantics; default press feedback; `system-ui` |
| 10 | Accessibility idioms: Dynamic Type, reduced motion | RN font-scaling breakage and global opt-outs; SwiftUI makes it default | `rem` follows Dynamic Type; `min()` caps growth; `prefers-reduced-motion` honored |

Items 1–6 are backed by survey counts and issue trackers. Items 8–10 are inferred from tool praise and complaints, not from direct demand data.

## 3. Proposed Markless styling DX

Everything below is a proposal. Property coverage per target is T015's and T018's call. This section defines how the feature feels.

### 3.1 Normal CSS: unchanged

```tsx
import { state } from '@markless/core';
export function Card(props) @{
  let open = state(false);
  <section class={open ? 'card open' : 'card'}>
    <h2>{props.title}</h2>
    <button onClick={() => (open = !open)}>Toggle</button>
  </section>
  <style>
    .card { display: flex; flex-direction: column; gap: 8px; padding: 16px;
            border-radius: 12px; background: var(--surface); }
    .card.open { background: var(--surface-raised); }
    h2 { font: 600 1.25rem/1.3 system-ui; color: CanvasText; }
  </style>
}
```

The same file builds for web and iOS. `system-ui` resolves to SF Pro on iOS and Roboto on Android. `CanvasText` resolves to `UIColor.label`.

### 3.2 Theming, tokens and dark mode: standard CSS only

The app-wide tokens live in a root stylesheet; no provider and no theme hook.

```tsx
// src/app.tsrx
export function App(props) @{
  <main class="app">{props.children}</main>
  <style>
    :root {
      color-scheme: light dark;                  /* follow the system */
      --surface: light-dark(#fff, #1c1c1e);
      --surface-raised: light-dark(#f2f2f7, #2c2c2e);
      --accent: AccentColor;                     /* iOS tint, Android dynamic color */
      --radius: 12px;
    }
    .app { background: Canvas; color: CanvasText; }
  </style>
}
```

A user override is plain state writing one standard property. This is the case NativeWind users kept filing issues about.

```tsx
import { state } from '@markless/core';
export function ThemeRoot(props) @{
  let scheme = state<'light dark' | 'light' | 'dark'>('light dark');
  <div class="root" style={{ colorScheme: scheme }}>
    <select value={scheme} onChange={(e) => (scheme = e.currentTarget.value)}>
      <option value="light dark">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
    {props.children}
  </div>
}
```

Native meaning:
- `color-scheme` on a node becomes `overrideUserInterfaceStyle` on its view (on Android, the night-mode configuration for that subtree).
- `light-dark()` and system colors compile to dynamic `UIColor`s, so they re-resolve on trait changes with no re-render. That matches what Unistyles users praise.
- System colors also follow increased contrast, as SwiftUI's do.

`@media (prefers-color-scheme: dark)` also works, for authors who already write it. It is a condition bit in the T011 table.

### 3.3 Platform-specific CSS: `@media (os: …)` and `@supports`

Two jobs need two standard-shaped tools:

- **Platform idiom** ("iOS lists are inset, Android uses Roboto metrics"): use `@media (os: ios | android | web)`. The compiler folds it away for each target, so no condition ships. It mirrors the proposed `target.os` value in markup, so one idea covers both.
- **Capability** ("use glass where it exists, else a solid fill"): use `@supports`. The compiler answers it from the target's style set, the same table that produces the errors. Unsupported CSS inside a true-negative `@supports` branch is not an error.

```css
.list { padding: 0 16px; }
@media (os: ios)     { .list { padding: 0 20px; border-radius: 10px; } }
@media (os: android) { .list { padding: 0; } }

.toolbar { background: var(--surface); }
@supports (backdrop-filter: blur(20px)) {
  .toolbar { background: transparent; backdrop-filter: blur(20px); }  /* iOS: glass/blur material */
}
```

Why this spelling:
- On the web, `(os: …)` is an unknown media feature, so a browser treats it as false. The web build folds it anyway (`os: web` is true), so the shipped CSS never contains it.
- Rejected alternatives:
  - NativeWind's `@media ios` puts a platform name in the closed media-type slot.
  - `:root[data-os=ios]` adds specificity and a runtime match.
  - Per-platform files (`card.ios.css`) are a second resolution convention the report already declined.
- Anything bigger than a few declarations should be a component chosen with `@if (target.os === 'ios')`, per the report.

### 3.4 Safe areas and keyboard

```css
.screen   { padding-top: env(safe-area-inset-top); }
.tabbar   { padding-bottom: max(8px, env(safe-area-inset-bottom)); }
.composer { margin-bottom: env(keyboard-inset-height, 0px); }
```

- `env(safe-area-inset-*)` becomes the view's `safeAreaInsets`.
- `env(keyboard-inset-height)` (the web VirtualKeyboard API name, [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/env)) becomes UIKit's `keyboardLayoutGuide` height.
- Both are dependency-tracked in the evaluator, so rotation and keyboard show and hide restyle without re-rendering.
- Routes and screens get safe-area padding by default only if T018 decides so. The syntax is unchanged either way.

### 3.5 Dynamic Type and system fonts

- On native targets, the root `font-size` is the platform body size scaled by the user's text setting: 17 pt at the default iOS size, via `UIFontMetrics`. On Android it is 16 sp times `fontScale`. **(Proposal; the exact base size is T018's call.)**
- So every `rem` follows Dynamic Type, and `px` does not. Web developers already learn this rule for browser zoom.
- A cap is standard CSS, which fixes the RN "maxFontSizeMultiplier" problem without a new prop:

```css
body       { font: 1rem/1.4 system-ui; }                 /* scales */
.tab-label { font-size: min(1rem, 20px); }               /* scales, capped */
.badge     { font-size: 11px; }                          /* fixed on purpose */
@media (os: ios) { .title { font: -apple-system-headline; } }  /* WebKit-compatible text style */
```

- Accepting WebKit's `-apple-system-*` text styles keeps parity with Safari, where the same CSS already follows Dynamic Type.
- This makes `min()` a priority for the first native style set. The report currently rejects `min`/`max`/`clamp` at first, and T018 should revisit that.

### 3.6 Press states and haptics

```css
button { transition: opacity 120ms; }
button:active { opacity: 0.6; }                      /* UIKit highlighted-state semantics */
@media (os: android) { button:active { opacity: 1; } } /* keep the default ripple instead */
```

- `:active` is true while the control is highlighted in the UIKit sense. It uses the press-retention area and cancels when a scroll starts, so it is not a naive touch-down.
- `<button>` and `<a>` get the platform's default feedback (iOS dim, Android ripple) unless the author styles `:active` or sets `-webkit-tap-highlight-color: transparent`, which is the web's existing opt-out.
- Haptics are behaviour, not style. They go through the proposed device package in the handler, not a new CSS property:

```tsx
import { vibrate } from '@markless/device/haptics';   // proposed, per the report
<button onClick={() => { vibrate('selection'); liked = !liked; }}>Like</button>
```

### 3.7 Transitions and motion

```css
.sheet { transform: translateY(100%); transition: transform 300ms cubic-bezier(.2,.8,.2,1); }
.sheet.open { transform: none; }
@media (prefers-reduced-motion: reduce) { .sheet { transition: none; } }
```

- Mapped properties (opacity, transform, colors) animate through Core Animation on the host clock.
- `linear()` easing is the standard way to write a spring curve. It is accepted where the profile supports it; otherwise it is a build error with a suggestion.
- `@keyframes` stays deferred, per the report.

### 3.8 Unsupported CSS: exact errors

Errors use the existing `CompilerDiagnostic` shape (`code`, `title`, `message`, `why`, `primarySpan`, `suggestions`, `docsUrl`; `packages/compiler/src/diagnostics.ts`). They appear in the terminal, in the editor through the TypeScript plugin as you type, and in the dev error overlay. The rules:

- Nothing is dropped silently.
- A property with no meaning on touch (`cursor`, `user-select`) is on a documented per-target "no effect" list, and `markless css --target ios` prints that list.
- Anything else unsupported is an error, unless it sits inside an `@supports` branch the target answers false.

```text
error MARKLESS_CSS_UNSUPPORTED_VALUE  src/routes/index.tsrx:14:5
  display: grid is not supported on ios in this release.
    14 |     .grid { display: grid; grid-template-columns: 1fr 1fr; }
       |             ^^^^^^^^^^^^^
  why: the ios layout engine implements flex only; web will render a grid and ios would not.
  fix: use display: flex; flex-wrap: wrap, or guard it:
         @supports (display: grid) { .grid { display: grid; ... } }
  docs: https://markless.dev/docs/native/css#display

error MARKLESS_CSS_UNSUPPORTED_SELECTOR  src/components/menu.tsrx:41:3
  .menu li + li matches on siblings the ios target cannot resolve at build time.
    41 |   .menu li + li { border-top: 1px solid var(--line); }
       |   ^^^^^^^^^^^^^
  why: native styles are matched per element when the app is built; this sibling relationship
       depends on list items created at runtime by @for.
  fix: put a class on every item except the first, e.g. class={i > 0 ? 'item sep' : 'item'}
  docs: https://markless.dev/docs/native/css#selectors

error MARKLESS_CSS_UNSUPPORTED_PROPERTY  src/components/tooltip.tsrx:22:5
  position-anchor is not supported on ios.
  why: CSS anchor positioning has no native layout equivalent yet; the element would appear at its
       normal position on ios while web places it next to its anchor.
  fix: use the Popover part from @markless/ui, which places itself natively on each platform.

info MARKLESS_CSS_NO_EFFECT  src/components/link.tsrx:9:5  cursor: pointer has no effect on ios (touch). Not an error.
```

Other rules:
- A web-only build reports nothing about native. Native errors fire only for targets in the build or dev command.
- In the editor, each rule shows a small "web ✓ ios ✗" hover, the same data as the error.

### 3.9 Tailwind (later, not the core DX)

Tailwind v4 is CSS-first and emits plain CSS with `@layer`, custom properties and `@theme`. Markless can therefore:
- run it as a build step;
- feed its output into the same style checker;
- report unsupported utilities against the markup `class` span that used them.

For example: `error MARKLESS_CSS_UNSUPPORTED_VALUE src/x.tsrx:8:18 class "grid" (display: grid) is not supported on ios`.

- Tailwind v4 output uses `@property`, `color-mix()` and `oklch()`, so native support needs those in the style set. This is **inference; not measured**.
- Platform variants come for free: a custom variant can compile `ios:` to `@media (os: ios)`.
- Recommendation: offer it as an adapter after the raw-CSS path is proven, because 42% of RN developers use NativeWind. Do not make it the default: the owner's surface is raw CSS in `<style>`.

### 3.10 The dev loop

```text
$ markless dev --target ios
  web   http://localhost:5173
  ios   iPhone 17 simulator (UIKit views)          ← opens beside the browser
  inspect  http://localhost:5173/__markless/inspect

  ✓ src/routes/index.tsrx  style updated on web, ios   (state kept, 18 ms)
  error src/routes/index.tsrx:14:5  display: grid is not supported on ios …
```

- **Style edits never re-run components.** Styles compile to a table (T011), so a `<style>` change ships a new table to both hosts and restyles in place. State, scroll position and focus stay put. Markup edits use the existing hot-reload path.
- **One inspector for both hosts.**
  - It follows the Lynx Elements panel model over the Chrome DevTools Protocol, so the familiar Chrome DevTools UI works.
  - It shows the tree as authored tags and parts (`section.card`, `Popover.content`), not `UIView` class names.
  - For each node it shows:
    - matched rules with their `file:line`;
    - the computed native value, for example `padding: 16px → UIEdgeInsets(16,16,16,16) pt`;
    - any rule skipped on this target and why, from the same diagnostic.
  - Live edits in the Styles tab apply to both web and simulator. "Save to source" writes the declaration back to the `<style>` block, which Lynx does not do **(proposal)**.
- **Environment toggles applied to both hosts at once:** light/dark, text size (Dynamic Type), reduced motion and device frame (notch or safe areas). This mirrors Xcode Environment Overrides, which SwiftUI developers value, and it brings Dynamic Type testing into the web browser.
- **No previews to build.** The running simulator is the preview, which avoids the SwiftUI and Compose preview crash and dependency-injection problems.

## 4. Implications for T018

1. The style set's first milestone should include `env()`, `light-dark()`, `color-scheme`, system colors, `rem` scaling, `min()` and `:active`. They carry wants 2, 9 and 10 at low cost.
2. `@supports` answered from the target's style set turns the error table into an authoring tool. That is cheap once errors exist.
3. `@media (os: …)` needs owner acceptance alongside `target.os`. It is one idea in two places.
4. The inspector and style-only hot swap depend on the table format carrying source spans. Put them in the artifact from day one.

## Caveats

- Survey freeform counts are small. Per-library 2025 satisfaction numbers were not retrieved.
- Tailwind 2025 adoption, the Expo "native CSS" announcement, Uniwind's recommendation wording, the RSD README message text and some RN issue summaries are from search summaries **(unverified)**.
- Nothing here measures what a native `rem` base should be, or the cost of dynamic colors.
- The error text, `docsUrl` paths and CLI output are illustrative. The error codes follow the existing naming pattern but do not exist yet.

```json
{
  "goalbuddy_receipt_v1": {
    "task": "T016",
    "result": "done",
    "summary": "Ranked web-developer styling wants with evidence: real CSS, dark mode/theming, loud errors, platform tweaks, speed, low setup, Tailwind, inspector, native feel, accessibility. Top two are backed by State of React Native 2024/2025 pain-point counts; silent failures by NativeWind/Tamagui issues. Proposed Markless DX answers each with standard CSS given native meanings: env() safe areas and keyboard, light-dark()/color-scheme/system colors as UIKit dynamic colors with the user override as one color-scheme value, rem following Dynamic Type with min() caps, system-ui fonts, :active with UIKit highlight semantics, a build-folded @media (os: ...) mirroring target.os, and @supports answered from the target style set. Unsupported CSS is a CompilerDiagnostic-shaped error with file:line:col, why and fix, and it is not an error inside a false @supports branch. The dev loop does style-only hot swap on web and simulator with state kept, plus a Lynx-style CDP inspector showing authored rule, computed native value and skipped-rule reasons. Tailwind comes as a later adapter through the same checker.",
    "evidence": [
      "notes/T016-styling-dx.md",
      "https://results.stateofreactnative.com/en-US/styling/",
      "https://results.2024.stateofreactnative.com/en-US/styling/",
      "https://github.com/nativewind/nativewind/issues/924",
      "https://github.com/nativewind/nativewind/issues/1481",
      "https://github.com/nativewind/nativewind/issues/1169",
      "https://github.com/nativewind/nativewind/issues/1489",
      "https://github.com/nativewind/nativewind/issues/866",
      "https://www.nativewind.dev/v5/core-concepts/responsive-design",
      "https://www.nativewind.dev/docs/tailwind/new-concepts/safe-area-insets",
      "https://docs.uniwind.dev/api/platform-select",
      "https://www.unistyl.es/v3/references/mini-runtime/",
      "https://github.com/tamagui/tamagui/issues/3361",
      "https://github.com/tamagui/tamagui/issues/3569",
      "https://lynxjs.org/guide/devtool/panels/elements-panel",
      "https://docs.flutter.dev/tools/devtools/inspector",
      "https://github.com/flutter/flutter/issues/181752",
      "https://github.com/flutter/flutter/issues/110431",
      "https://developer.apple.com/forums/thread/762993",
      "https://android-developers.googleblog.com/2023/07/deep-dive-into-live-edit-for-jetpack-compose-ui.html",
      "https://docs.expo.dev/versions/latest/sdk/glass-effect/",
      "https://reactnative.dev/docs/fast-refresh",
      "https://ignitecookbook.com/docs/recipes/AccessibilityFontSizes/",
      "https://github.com/react/react-native/issues/35658",
      "https://webkit.org/blog/3709/using-the-system-font-in-web-content/",
      "https://developer.mozilla.org/en-US/docs/Web/CSS/env",
      "https://developer.mozilla.org/en-US/docs/Web/CSS/system-color",
      "https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark",
      "packages/compiler/src/diagnostics.ts"
    ],
    "accessed": "2026-09-26",
    "caveats": [
      "Survey freeform counts are small; 2025 per-library satisfaction not retrieved",
      "Tailwind 2025 adoption, the Expo native-CSS announcement, Uniwind wording, RSD README text and some issue summaries are unverified search summaries",
      "Native rem base size, dynamic-color cost and Tailwind v4 output coverage on native are unmeasured",
      "Error codes, docs URLs and CLI output are illustrative proposals"
    ],
    "files_written": ["docs/goals/native-targets-api/notes/T016-styling-dx.md"]
  }
}
```
