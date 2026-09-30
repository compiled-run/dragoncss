# ng-native (Angular Native) compared with Dragon CSS

Research note, 2026-09-29. Read-only research; this file is the only change. The sources are the ng-native site (all 131 pages, read through `/llms-full.txt`) and a shallow clone of `github.com/ng-native/ng-native` at its HEAD on 2026-09-29. The repo was created 2026-09-27 and had 162 stars when read. Dragon facts come from `origin/master` at 1211f422 and the milestone-2-proof board.

## 1. What ng-native is

**One line:** Angular templates, rendered by React Native's Fabric C++ renderer through Expo, styled with real component CSS that is compiled at build time and cascaded at runtime in JavaScript. MIT. Self-described alpha.

### Architecture
- **Renderer.** `@ng-native/platform` implements Angular's `Renderer2`. It drives `@ng-native/fabric`, a framework-agnostic retained tree of elements, text and anchors. Each change-detection pass makes exactly one Fabric `completeRoot` call. Unchanged subtrees pass by reference, and the diff runs in C++ off the JS thread. There is no React: Angular replaces React's JS layer and keeps Fabric's C++ renderer, the event system and the responder. Elements are lowercase (`<view>`, `<text>`, `<scroll-view>`, `<image>`, `<pressable>`) and map to Fabric component names; an unknown element renders as an empty `View` with a dev warning. [architecture](https://ng-native.com/guide/architecture), [fabric](https://ng-native.com/packages/fabric)
- **Layout engine: Yoga**, as React Native configures it. Nothing of its own. Every view is a flex column. `block` and `inline-flex` are read as `flex`. `inline`, `inline-block`, grid, tables, float, multicol, `position: fixed` and `sticky` are dropped with a warning. They document Yoga's divergences from browsers: percentage sizes of absolute children, oversized margins giving a 0-high box, percentage `min-height` resolved against the grandparent, and percentage `gap` growing the box. [supported-css](https://ng-native.com/packages/fabric/supported-css)
- **CSS pipeline: split between build time and runtime.**
  - *Build time, in the Metro transform:* lightningcss parses each component's `styles`/`styleUrl`. Selectors become compounds plus combinators, values are converted to React Native style values, specificity is computed, and rules are sorted once. The rule set is attached to the component class as the static `ɵnativeStyles`, which also gives scoping without generated ids. Colours are converted to sRGB with CSS Color 4 gamut mapping. [css-engine](https://ng-native.com/packages/fabric/css-engine), [metro config](https://ng-native.com/packages/metro/configuration)
  - *Runtime, in `packages/fabric/src/css.ts` (2,014 lines, JS on the device):* right-to-left selector matching, with rules filed by key selector; a real cascade (global sheet, host sheet, creator sheet; component rules get a +1 class bump, like emulated encapsulation); emulated inheritance for 15 text properties (React Native views do not inherit); `var()` resolved per node; `@media` evaluated against `mount()` conditions and re-run by `watchConditions`. Precedence runs native defaults < CSS < explicit props < `[style]` < `!important`.
  - Compiler size: about 6,800 lines in `packages/metro/css/*.cjs`.
- **Scope rule:** "if React Native's style API can express it, CSS has a spelling for it; if not, the declaration is dropped with a build warning naming file, line, component, reason and the native alternative." The rest of the rule still applies. CSS that does not parse fails the build.
- **Web host.** `@ng-native/web`'s `BrowserEngine` implements the same `HostEngine` interface over the DOM. It is used for the docs site's live examples, for islands inside Angular web apps, and to keep the seam honest. It is not a deployment target. [native-and-web](https://ng-native.com/guide/native-and-web)

### Supported CSS, feature by feature
From [supported-css](https://ng-native.com/packages/fabric/supported-css), [animation](https://ng-native.com/packages/fabric/animation), [theming](https://ng-native.com/guide/theming) and [tailwind/utilities](https://ng-native.com/packages/tailwind/utilities):

- **Selectors.**
  - Supported: type, class, id; attribute selectors with every operator; `:is`/`:where`/`:not` with compound arguments only (plus Tailwind's `group-*` and `peer-*` shapes); `:host`, `:host()`, `:host-context()`; `:first-child`, `:last-child`, `:only-child`, `:nth-child()`, `:nth-last-child()` (no `of S`); `:empty`; `:root` and `html`; `:disabled` from the prop; `:focus` and `:active` tracked by the engine from native events; all four combinators, matched at runtime so they are dynamic.
  - Dropped: every pseudo-element ("permanently"), `:hover`, `:focus-visible`, form-state pseudo-classes and `:has()`.
- **Colours.** Named, hex, `rgb`, `hsl`, `hwb`, `lab`, `lch`, `oklab`, `oklch` and `color-mix()`, folded at build time. `color-mix()` and relative colours containing `var()` are evaluated on the device with CSS Color 4 arithmetic. `light-dark()` works everywhere a colour does. `color(display-p3 …)` is dropped. Output is sRGB only.
- **Backgrounds.** `linear-gradient` and `radial-gradient` only, through Fabric's `experimental_backgroundImage`. Stops may be tokens. `url()` is dropped.
- **Filters.** iOS: `brightness` and `opacity`. Android: also `contrast`, `grayscale`, `hue-rotate`, `invert`, `saturate` and `sepia`; `blur` and `drop-shadow` from API 31. A rule that can apply on iOS drops unsupported functions unless it is scoped with `.platform-android`.
- **Transforms.** translate, scale, rotate, skew and perspective, plus the individual `translate`, `rotate` and `scale` properties. Skew works on iOS only. Angle tokens are read as degrees.
- **Shadows.** `box-shadow` (tokens anywhere), and a single `text-shadow` that iOS clips to the text box.
- **Text.**
  - `white-space: nowrap` becomes 1 line, `line-clamp` becomes N lines, and `text-overflow` becomes the ellipsize mode. The `-webkit-box` idiom compiles. Other `white-space` values are dropped.
  - `font-variant-numeric`: the tabular, proportional, lining and oldstyle values only.
  - `font-family` keeps the first family only, silently: there is no fallback stack.
  - `font-weight` snaps to the nearest hundred, and there is no font matching. A bold face is a separate family (`Inter-700`).
  - `text-decoration-line: overline` is dropped.
- **Display and box.** `display` takes `flex`, `none`, `block` (as flex) and `contents`. `overflow` has one value for both axes: `auto` becomes scroll and `clip` becomes hidden. `border-style` is one value for all sides. Logical properties are all supported, mapped to Yoga start/end edges. `cursor` takes `auto` and `pointer`.
- **Values.**
  - Lengths need units. `rem` is fixed at 16; `em`, `vw` and `vh` resolve on the device.
  - `calc()` can mix one viewport or font-relative term with absolute lengths, or any number of tokens. `min`, `max` and `clamp` fold only when every argument is constant.
  - CSS-wide keywords (`inherit`, `initial`, `unset`, `revert`) are dropped.
  - `!important` is supported.
  - Tailwind's `@layer`, `@supports` and `@property` are flattened or dropped by a pre-pass.
- **Media queries.** `width`, `height`, `orientation`, `prefers-color-scheme` and `prefers-reduced-motion`. `hover`, `pointer`, `print` and `not` are build errors. Nothing re-evaluates unless the app calls `watchConditions(engine)`.
- **Motion.**
  - `transition`: interpolated in JS on a `requestAnimationFrame` loop that commits every frame. Numbers and colours interpolate; lengths only when both ends share a unit.
  - `@keyframes` and `animation`, including the longhands, per-keyframe easing and `play-state`. One animation per element.
  - Durations can be tokens: `calc(var(--i) * 60ms)` staggers a list.
  - **Scroll-driven animation:** `animation-timeline: scroll()` with `animation-range`, handed to React Native's native Animated driver, for opacity and transforms only.
  - Angular's `animate.enter`/`animate.leave` run on top of transitions.
- **Dropped with a warning:** float, grid, list-style, tables, multicol, `will-change`, `contain`, counters, `clip-path`, most blend modes, `position: fixed` and `position: sticky`.

### Text, fonts, accessibility and platform
- **Text.** Text must sit inside `<text>`; bare text renders nothing. Nested `<text>` makes inline runs. Wrapping, shaping and metrics are React Native's (Core Text and StaticLayout). [text](https://ng-native.com/packages/components/text)
- **Fonts.** `@font-face` in CSS is collected at build time, `url()` becomes `require`, and `loadFonts()` runs before mount. Each weight or style is also registered as `<family>-<weight>`, because there is no weight matching. [fonts](https://ng-native.com/packages/expo/fonts)
- **Dynamic Type.** This is React Native's `allowFontScaling`: every font size scales with the OS setting, in px or rem, capped by `maxFontSizeMultiplier`. `watchConditions` re-measures all text when the setting changes. `Accessibility` exposes `fontScale`, `boldText`, `reduceMotion`, `screenReader` and `announce()`. [accessibility](https://ng-native.com/packages/device/accessibility)
- **Safe areas.**
  - `<safe-area-provider>` and `<safe-area-view>` apply the insets natively, in the same layout pass.
  - The insets are also the tokens `--safe-area-inset-*`, and `env(safe-area-inset-*)` compiles to them. Tailwind gets `pt-safe`, `min-pt-safe-4` and similar.
  - A modal needs its own provider, and tab bars need `<tab-safe-area-view>`.
  - Hairline utilities give 1 device px. [safe-area](https://ng-native.com/packages/components/safe-area)
- **Dark mode.** `prefers-color-scheme`, `light-dark()`, a `.dark` root class kept in sync by `watchConditions` or driven by an in-app switcher, and `ColorScheme.set('dark')` to override the native chrome too (headers, switches, keyboard). [theming](https://ng-native.com/guide/theming)
- **Platform variants.** `mount` puts `platform-ios`, `platform-android` or `platform-web` on the root. The compiler knows the platform it is bundling for, so a per-platform drop only happens in that platform's build.
- **Tailwind v4.** The native preset maps `hover:` to `:active` or `[data-hover]` (iPad pointer), `focus-visible:` to `:focus`, and adds `ios:`, `android:`, `web:`, `native:` and `dark:` as a class. [tailwind](https://ng-native.com/packages/tailwind)
- **Images.** `<image>` is React Native's `RCTImageView`, with `src`, `srcSet`, `resizeMode`, `alt` as the accessibility label, intrinsic sizing from the asset, `blurRadius` and `tintColor`. [image](https://ng-native.com/packages/components/image)
- **Platform views.**
  - Any Fabric or Expo view: `registerNativeViews('web-view', 'slider')` and `registerExpoViews('expo-image', 'expo-blur')`. [native-views](https://ng-native.com/packages/expo/native-views)
  - Maps, camera and a video player come as Expo facades.
  - `<dom-component>` embeds a browser-rendered Angular component in a web view, for canvas, charts and editors. [dom-components](https://ng-native.com/packages/expo/dom-components)
- **Gestures, scrolling and keyboard.**
  - Gestures: react-native-gesture-handler plus Reanimated worklets.
  - Scrolling: native `ScrollView`, virtual lists and sticky rows. Sticky rows follow JS scroll events and can trail a fling by a frame.
  - Keyboard: a lot of work, including keyboard-avoiding views and a keyboard dock. VALIDATION.md issues #14, #21, #26 and #27 are all High.
  - [gestures](https://ng-native.com/packages/components/gestures), [limitations](https://ng-native.com/guide/limitations)

### Fidelity checks against a browser
There are three layers, all on the host. None compares device pixels with Chrome.
1. **Cascade oracle.** `packages/integration-tests/scripts/generate-css-oracle.mjs` runs headless Chrome (`--dump-dom`) on hand-written cases and on a corpus from Open Props and Tailwind. It records `getComputedStyle` of a probe, commits it as JSON, and `css-oracle.test.ts` holds the runtime resolver to it. Colour is the probe, so the check is which declaration won, not how values convert.
2. **Tailwind sweep** (`tailwind-sweep-suite.ts`). Every Tailwind v4 utility, and v3 separately, is compiled, and each must either do something or produce a warning. "Compiles cleanly and does nothing" is the failure they fear most. Refusals are a committed snapshot, so a change in what is refused shows up as a diff. Chrome's computed values per utility are an oracle, with a `DELIBERATE` list of accepted differences (display read as flex, no `safe` alignment, nearest-hundred weights, no `scale-down`).
3. **Layout half of the sweep.** One scene is laid out by npm `yoga-layout`, configured like React Native (errata, pixel grid), and compared with Chrome plus their reset. A `YOGA` allowlist holds the three known Yoga divergences. The file itself says the npm Yoga "may trail the one React Native vendors, so each wants confirming on a device".

Device checks are Maestro flows and manual simulator notes (`examples/canary/VALIDATION.md`: 15 P0 app scenarios "Verified" on the iPhone 17 Pro simulator). Their comparison page says "Many platform facades have unit tests and typechecks but no hardware verification." [comparison](https://ng-native.com/guide/comparison), [e2e](https://ng-native.com/packages/testing/end-to-end)

### Developer experience
- **Hot reload keeps component state** for inline templates, `templateUrl`, inline `styles` and `styleUrl`.
  - The compiler embeds Angular's `ɵɵreplaceMetadata` module into the file and ships the recompiled rule set with it.
  - A shared stylesheet edit swaps on every component that uses it.
  - A "shape hash" of the file decides between a hot swap and a forced full reload, because Fast Refresh can report success while running stale code.
  - A swap that throws falls back to a reload.
  - [metro configuration](https://ng-native.com/packages/metro/configuration)
- **Diagnostics.** Warnings name the file, line, component, what was dropped, why, and the alternative. A design-system sheet "builds as it is, with a warning for each web-only declaration". An undefined `var()` warns once per name in dev, "since a phone has no inspector". Capitalised element names are a hard build error. Templates are parsed a second time, to catch cases where oxc silently drops template text.
- **Devtools.** Angular DevTools cannot attach. They point to Hermes, the React Native debugger and `engine.stats`.
- **AI support.** The template ships `AGENTS.md` and `CLAUDE.md`, and every doc page has a `.md` twin plus `/llms.txt` and `/llms-full.txt`. [ai-assistants](https://ng-native.com/guide/ai-assistants)
- **Testing.** Testing Library runs in Node against a fake Fabric, so styles are asserted as flattened props. [testing-styling](https://ng-native.com/packages/testing/testing-styling)

## 2. Property by property: ng-native, Dragon today, Dragon planned

"Dragon today" means `origin/master` 1211f422:
- **Web:** exact where a row exists.
- **iOS:** `exact` for layout rows proven by the layout lane. Paint rows (colours, border styles and colours, overflow) are `caveat` under the milestone-1 cap.
- **Android:** every row is still `unsupported` in `profiles/android.ts`, although P5 device lanes run all 5 devices. Rows are promoted only through generated profile rows.

"Planned" gives the board task or roadmap package.

| Area / property | ng-native | Dragon today (master) | Dragon planned |
|---|---|---|---|
| Layout engine | Yoga (React Native's), flex only, documented browser divergences | Own TS engine translated to Swift/Kotlin, Chrome 145 arithmetic, 1 device px gate on 5 devices | Same engine grows |
| `display: flex` and flex longhands | yes (Yoga) | exact, including baseline, wrap-reverse, `order`, rtl | done |
| `display: block`, margin collapsing | read as flex column (no collapse) | exact (real block flow) | done |
| `display: inline`, `inline-block`, `inline-flex` | dropped (`inline-flex` read as flex) | refused | INL1a T058, INL2 T059 |
| `display: contents` | yes (Yoga) | refused | BLKX |
| `display: grid` and grid-* | dropped | grid-* parsed and computed (G0, #23); layout gated | G1a (grid-g1a branch), GRID |
| float, clear | dropped | refused | FLT (T105 probe) |
| tables, multicol | dropped | refused | TBL, MCOL |
| `position` relative/absolute | yes (Yoga semantics) | exact | done |
| `position: fixed` | dropped | refused | POSX-f T079 |
| `position: sticky` | dropped (virtual-list sticky rows only) | refused | POSX (roadmap) |
| `overflow` | one value for both axes; auto becomes scroll | hidden/visible; iOS caveat | OVFL T078 (auto/scroll) |
| `aspect-ratio` | yes (Yoga) | refused | SIZE-ar T050 |
| min-/max-/fit-content | no | refused | SIZE |
| `gap`, `row-gap`, `column-gap` | yes; % gap diverges | exact | done |
| `box-sizing` | Yoga default only | exact | done |
| Logical properties | all, mapped to Yoga edges | on master (#22 casc-logical); rows ride the fixtures | LOGI done |
| `writing-mode` vertical | no | horizontal-tb only (WM-0 T108) | WM |
| `direction` / rtl | yes | exact | done |
| Colours: hex/rgb/hsl/named | yes, sRGB | caveat on iOS (paint cap) | PNT lanes promote |
| lab/lch/oklab/oklch, `color-mix`, relative colour | yes; with `var()` evaluated on device | not in profile | CASC/colour package (roadmap "mix" row) |
| `display-p3` / wide gamut | dropped (sRGB only) | no | roadmap caveat (native wide gamut) |
| `light-dark()` | yes, everywhere | not in profile | PNT1 T072 (color-scheme) |
| Solid borders, per side | one `border-style` for all sides | per-side widths exact; styles and colours caveat | PNT1 |
| dashed, dotted, double | style must be uniform across sides; native dash | solid/dashed/dotted/double caveat | P6a T075 (Blink-exact dashes) |
| `border-radius` | yes (native) | reference port done (SKIA-AA #20) | PNT1 T072, SKIA-AA T086 |
| `box-shadow` | yes (native), tokens | Skia blur port done (#19) | PNT1 T072 |
| `outline` | no | no | PNT1 |
| `opacity`, `visibility`, `z-index` | yes (z-index native) | no | PNT1 |
| `transform` 2D, individual transforms | yes; skew iOS only | no | PNT2 T073 (skew on Android is Dragon's) |
| 3D transforms, `perspective` | perspective function only | no | PNT2 |
| linear/radial gradient | yes (Fabric experimental) | no | BG2 T074 (Skia dither port done) |
| conic/repeating gradient | no | no | BG2 |
| `background-image: url()` | dropped | no | BG2 + REPL |
| `filter` | iOS: brightness/opacity; Android: most | no | FX (late) |
| `backdrop-filter`, blend, `clip-path`, masks | no | no | FX (late) |
| `text-shadow` | one, clipped on iOS | no | TDEC |
| `font-family` | first family only; silent | Dragon Sans/Mono/Lato pinned; unmapped is an error | TXT1a T083 |
| `font-weight`/`font-style` | nearest hundred; a separate family per face | refused on native until TXT1a | TXT1a |
| `@font-face` | yes (build time, `url` becomes `require`) | vendored map | TXT1C |
| `font-size`, `line-height` | yes; all sizes scale with the OS | exact (Ahem, px); rem/em via V2a | V2a T026 |
| `rem` with Dynamic Type | rem fixed 16; OS scales every font size | decision: root font scales, so rem/em follow and px does not | V2a T026, V2b T027 |
| `letter-spacing`, `text-transform`, `text-align` | yes (inherited by emulation) | text-align exact | TXT2 |
| `white-space` | nowrap only (as numberOfLines 1) | nowrap/normal exact | TXT2 (pre, pre-wrap) |
| `text-overflow`, `line-clamp` | yes (native props) | no | TXT2 |
| `text-decoration` | underline and line-through; no overline | no (`href` refused until TDEC) | TDEC |
| `font-variant-numeric` | 4 values | no | TXT2 |
| Line breaking | React Native's (Core Text/StaticLayout: 70% and 50% Chrome-equal lines per our spike) | Dragon's UAX#14 plus Blink rules, HarfBuzz shaping | INL1a/TXT1a |
| Units px/%/em/vw/vh | yes; em/vw evaluated on device | px/% exact | UNIT, V2a (env, sv/lv/dv, rem, em) |
| `calc`/`min`/`max`/`clamp` | constants fold; tokens on device; % with tokens dropped | constants | V2a + CALC |
| `var()` / custom properties | runtime cascade; bindable from template data | on master (#22), static states | SOV T066 (typed slots) |
| `!important`, `@layer` | important yes; layer flattened | `!important` refused (DRAGON_UNSUPPORTED_IMPORTANT) | CASC |
| CSS-wide keywords | dropped | inherit and others exact on some rows | CASC |
| Selectors: type/class/id/attr | runtime match | static, proven on the closed tree | done |
| `:nth-*`, siblings, `:not/:is/:where` | runtime, dynamic | static when provable (owner ruling) | done |
| `:has()` | dropped | static when provable | done |
| `::before`/`::after` | "permanently unsupported" | refused | GEN (build-time child nodes) |
| `:hover` | dropped; Tailwind `hover:` becomes `:active` | refused | SELD-R2 T064 (Chrome tap traces) |
| `:active`, `:focus`, `:disabled` | runtime state from native events | refused | SELD-R1 T063, SELD-R2 |
| `:focus-visible`, `:checked` | dropped | refused | SELD |
| `@media` width/height/orientation | yes (runtime re-eval by opt-in) | parser in `media/`; wiring queued | MQ-a T030, MQ-R T067 |
| `prefers-color-scheme`, `reduced-motion` | yes | no | MQ-a/MQ-R |
| `hover`/`pointer`/`resolution` queries | build error | no | MQ (roadmap caveat) |
| `@container` | no | no | CQ |
| `@supports` | unwrapped | no | CASC/MQ (build fold) |
| `env(safe-area-inset-*)` | yes (tokens, runtime) | no | V2a T026 |
| `env(keyboard-inset-*)` | no (components instead) | no | **not on the board** (researched in T015/T016) |
| transitions | JS rAF loop, per commit | timing reference (ANIM-a #8) | ANIM-a2 T062, ANIM-b T065 |
| `@keyframes`, `animation-*` | yes, one per element | no | ANIM-b T065 |
| Scroll-driven (`animation-timeline: scroll()`) | yes, native driver (opacity/transform) | no | **not on the board** (roadmap "later") |
| `img`, `object-fit` | `<image>` (`resizeMode`) | UA and reference (#7) | REPL-a T051 |
| Web view / iframe | Expo web view, `<dom-component>` | reference slot design | REPL-a T051 |
| Other native views (map, video, camera, slider) | any Fabric/Expo view by name | no | **no general slot planned** |
| Form controls | native `TextInput`, `Switch`, and so on | reference (#7) | FORM-a T052 (CSS-painted), P6d editing |
| Hairline borders | `border-hairline` utility (device token) | device px model exists (D1) | no explicit plan |
| `cursor`, `pointer-events` | cursor auto/pointer | no | SELD-R1 (pointer-events) |

## 3. Important things they do that we do not plan or have

Ranked by user impact. Each item has a recommendation and a place on the board.

1. **A Tailwind v4 sweep: every utility either works or says why, checked against Chrome.**
   - *What they have:* `tailwind-sweep-suite.ts` compiles every Tailwind utility (v4, and v3 separately). Each one must do something or produce a named warning. Refusals are kept as a committed snapshot, and results are checked against Chrome's computed values with an explicit, reasoned `DELIBERATE` allowlist.
   - *Why it matters:* this is the most-used authoring style for app UI (T016: about 37% use Tailwind; NativeWind's whole market). It turns "what CSS works" into a measured, reviewable ratchet.
   - *What Dragon has:* a WPT import and a Markless corpus (T017), but no Tailwind corpus. T015 itself says "a measured number needs a corpus pass" and left it as a follow-up.
   - *Recommendation:* add **TW-SWEEP**. Build Tailwind v4's full utility set in one sheet (theme plus utilities, no preflight), run it through Dragon's compiler per target, and commit a classification snapshot: supported rows with their proof, refusals with their diagnostic code, and silent cases (none allowed). Report it next to the WPT score. A Chrome computed-value oracle comes for free, because chrome-dual already exists.
   - *Board:* a Scout plus a Worker lane after CASC and MQ-a (T030). It writes new files only (a `packages/tailwind-sweep` or parity fixture group), so it can run in parallel. It also gives the roadmap a third ranking signal next to WPT and usage.

2. **Values bound at runtime flowing through CSS: `[style.--x]` tokens with `color-mix`, relative colours, `calc` and stagger delays.**
   - *What they have:* a list row sets `--cover` from data, and CSS derives shades with `color-mix(in oklch, var(--cover) 70%, white)`. Stagger is written `animation-delay: calc(var(--i) * 60ms)`.
   - *What Dragon has:* finite states plus typed override slots with declared ranges (SOV T066: `translateX(p%)` and the track gradient). Free-form values are refused.
   - *Why it matters:* per-item theming (album art colour, user avatar colour, category colour) and staggered lists are everyday patterns. A finite-state model cannot express them.
   - *Recommendation:* extend SOV with **typed colour slots and integer or index slots**. The on-device evaluator is a translated port of Chrome's colour code (`color-mix`, relative colour, gamut mapping). Proof works like DTXT-0: exhaustive or sampled domains checked against Chrome's computed values (colour space × mix percentage × a colour sample), and index slots enumerate `0..N`.
   - *Board:* write it into T066's spec before it starts, as SOV-b. The colour evaluator is a new translated module, parallel-safe.

3. **Native views embedded by name (maps, video, camera, web view, sliders, date pickers).**
   - *What they have:* `registerNativeViews` and `registerExpoView` let any Fabric or Expo view become an element, laid out like any box.
   - *What Dragon has:* only the iframe/web-view replaced slot in REPL-a, plus CSS-painted controls in FORM-a.
   - *Why it matters:* real apps need maps, video players and camera previews; without them Dragon cannot ship a real screen. The roadmap's REPL also lists `video` but no host-view mechanism.
   - *Recommendation:* generalise REPL-a's web-view slot into a **host view slot**. It is a replaced element with author-given size or `aspect-ratio` (default 300x150, like iframe). Dragon lays it out, paints its box decorations and clips it; the host app supplies the `UIView` or `View` by name. Test frames and applied values only, with content masked, exactly as the iframe ruling already says.
   - *Board:* REPL-slot, a sub-package of T051 (Phase B), or right after it. Record it as a PM ruling in decisions.md ("Images, web views and form controls").

4. **Keyboard-aware layout (`env(keyboard-inset-*)`).**
   - *What they found:* ng-native spent four of its High-severity issues on the keyboard (a composer docked to the keyboard, fields hidden behind it, a dock persisting over sheets).
   - *What Dragon has:* the value is researched (T015 §265, T016 §286: `env(keyboard-inset-height)` backed by `UIKeyboardLayoutGuide` and `WindowInsetsCompat.Type.ime()`), and `pitfalls.md:147` calls it "a later profile row". It is **on no board task**. V2a deliberately keeps viewports unresized by the keyboard (Chrome's `resizes-visual`), which is right, but it leaves chat and form screens without a way to lift content.
   - *Recommendation:* add **KBD**. Add `env(keyboard-inset-top/left/width/height/…)` as V2 environment values (Chrome's VirtualKeyboard API names, with Chrome proof by injecting `navigator.virtualKeyboard.overlaysContent` geometry, or by a fixture override like the scaled root). Add frame-synchronous updates in MQ-R's environment runtime, and scroll-into-view of the focused field.
   - *Board:* after V2b T027 and MQ-R T067, before FORM-a Phase B (T052), because text inputs need it.

5. **Scroll-driven animation (`animation-timeline: scroll()`, `animation-range`).**
   - *What they have:* opacity and transforms driven natively by scroll offset. A collapsing header "follows the finger exactly".
   - *What Dragon has:* `css-support.md` rates it "unsupported: undesigned/later", and nothing on the board.
   - *Why it matters:* collapsing headers and parallax are some of the most common mobile motion patterns, and Chrome 145 ships scroll timelines.
   - *Recommendation:* add **ANIM-S**. Reuse ANIM-b's timing port with progress derived from the engine's scroll offset instead of the clock. It is deterministic, so frames can be proven against Chrome by setting `scrollTop` to sampled offsets with the timeline paused. Frames are applied in the scroll callback of the same frame, as for `position: fixed` counter-offsets (Paint ruling).
   - *Board:* after ANIM-b T065 and OVFL T078.

6. **Accessibility text settings beyond size: Bold Text, and live re-layout on a text-size change.**
   - *What they have:* `Accessibility.boldText` and `fontScale`, and `watchConditions` re-measures every text when the size changes while the app runs.
   - *What Dragon has:* Dragon draws its own glyphs (`CTFontDrawGlyphs` and `Canvas.drawGlyphs`), so the OS **Bold Text** setting (iOS `legibilityWeight`, Android 12 `fontWeightAdjustment`) no longer reaches Dragon text at all. No Dragon doc mentions it (a grep for "bold text", "legibilityWeight" and "fontWeightAdjustment" finds nothing). Live Dynamic Type changes are also not named in MQ-R, which covers resize and rotation.
   - *Recommendation:*
     - Rule it as a named platform rule. When Bold Text is on, computed `font-weight` gains +300, capped at 1000 (Android's own adjustment; iOS maps to the next heavier face). Prove it with Chrome by injecting the adjusted weights, as V2 does for the scaled root.
     - Add `UIContentSizeCategory.didChangeNotification` and `onConfigurationChanged` to the MQ-R environment runtime. Consider `prefers-contrast` and `prefers-reduced-transparency` in the same pass.
   - *Board:* a research ruling now (PM); implement it in V2b T027 for the environment and in TXT1a-2 T084 for weight.

7. **An in-app theme switcher that also re-themes native chrome.**
   - *What they have:* a `.dark` class on the root, plus `ColorScheme.set()` that sets the window's style, so `prefers-color-scheme`, `light-dark()`, native headers, switches and the keyboard all follow.
   - *What Dragon has:* `light-dark()` is planned as native dynamic colours. A user-chosen override is not specified.
   - *Recommendation:* in PNT1 T072 (color-scheme), specify that a root `color-scheme: dark` or `light`, set statically or through a root state, sets `overrideUserInterfaceStyle` on the Dragon root (iOS) and the night mode (Android). The native keyboard and system controls then match. Test it with Chrome's `color-scheme` on `:root`.
   - *Board:* PNT1 T072 spec note.

8. **The development loop: hot style reload and diagnostics in the running app.**
   - *What they have:* style and template edits hot-swap with state preserved, a shape-hash decides between a swap and a reload, and dev-time warnings cover what the build cannot see (undefined `var()`).
   - *What Dragon has:* generated Swift and Kotlin, so every style edit needs a native rebuild. The board has a viewer mode (T040) and a gallery (T037) for owner visibility, but no author dev loop. T016 records that hot reload is a top praise for Flutter and a top complaint for SwiftUI.
   - *Recommendation:* add a **DEV-HR research task**. In debug builds, the host reads the compiled native program (the same plain-data property list the lanes already consume, "one source for both outputs") from the dev server. It re-applies the program on save, keeping the view tree when the element tree shape is unchanged. Structural changes fall back to a rebuild. Nothing new is parsed on the device (the data is the compiled program), so AGENTS.md's rule still holds.
   - *Board:* a Scout after EMS T071, off the checkpoint path.

9. **Hairlines and device-px idioms.** They ship `border-hairline` (1 device px from a device token). Dragon already models device px (D1). *Recommendation:* document the CSS spelling that gives a hairline (`0.5px` at DPR 2, or `@media (min-resolution: 3dppx) { border-width: 0.333px }`, with Chrome's device-px snapping) and prove it in P6a. *Board:* a fixture in P6a T075. It is small.

## 4. Where Dragon is stronger

- **Fidelity is measured on devices, not on the host.** ng-native checks computed styles against Chrome, and Yoga-from-npm against Chrome, both on the host. Its own file says Yoga differences "want confirming on a device". Dragon runs 5 device lanes (layout, frames, applied values, lines and pixels) within 1 device px, and uses WPT as a second oracle.
- **Layout breadth and correctness.** Real block flow with margin collapsing, grid (G0 landed), inline formatting, floats and tables are on the plan. They get Yoga's flex-only model with documented browser divergences.
- **Text.** Their line breaks are Core Text and StaticLayout (per our spike: 70% and 40–53% of paragraphs equal to Chrome), and each font has one family with no weight matching or fallback. Dragon has HarfBuzz at Chrome's revision plus a Blink line breaker.
- **Nothing on the device parses or matches CSS.** Their cascade runs in JS on every commit, and transitions commit a Fabric tree every frame from JS. Dragon resolves everything at build time and computes frames with a Chrome timing port.
- **Pseudo-elements and `:has()`.** They refuse these permanently. Dragon plans `::before`/`::after` as build-time nodes (GEN) and already allows provable `:has()` and sibling selectors.
- **Paint the platform lacks.** Dragon draws per-corner radii, shadow spread, skew on Android and gradients itself, with Skia ports. They drop anything React Native cannot express.
- **Framework independence.** They are welded to Angular, Expo and React Native. Dragon takes plain CSS plus an element tree (Markless first).

## 5. Architectural ideas worth adopting

1. **A "does something or says why" invariant, applied to real corpora.** Their sweep's core check (no utility compiles cleanly while doing nothing) is exactly Dragon's fail-closed rule, applied to a whole real-world vocabulary instead of case by case. It is cheap to adopt through TW-SWEEP (item 1).
2. **Commit browser oracles as fixtures,** so ordinary tests run without Chrome. Dragon already does this with captures. Their split of "cascade oracle" and "layout oracle" per corpus case is a pattern TW-SWEEP could copy.
3. **Platform scoping at compile time.** A rule scoped with `.platform-android`, or a Tailwind `android:` variant, keeps a platform-only feature and drops it from the other platform's build. Dragon's proposed OS condition (css-support "media-os") does the same, and could accept the Tailwind-style root-class spelling as an alias.
4. **Docs as `.md` twins plus `llms.txt` and `llms-full.txt`, and an `AGENTS.md` in the app template.** T030 ranked generated docs and llms.txt fifth among enforcing surfaces. Still, it is nearly free once Dragon has public docs, and ng-native shows the shape.
5. **Validation scenarios by app shape** (feed, chat, forms, keyboard, sheets, gestures), with severity-rated issues. This is a useful checklist for what the north star does not cover. The music player exercises none of chat, keyboard or forms.

Not recommended: their warn-and-drop default for component CSS. It contradicts "No style quietly dropped", and their own undefined-`var()` bug (VALIDATION #36) shows how the warnings get missed. A migration report (`explain`) that lists refusals for a vendored sheet, without passing the build, gets the same adoption benefit.

## Sources read
- https://ng-native.com/ , https://ng-native.com/llms.txt , https://ng-native.com/llms-full.txt (every page; section anchors below)
- https://ng-native.com/packages/fabric , /packages/fabric/css-engine , /packages/fabric/supported-css , /packages/fabric/animation
- https://ng-native.com/guide/architecture , /guide/comparison , /guide/theming , /guide/native-and-web , /guide/limitations , /guide/ai-assistants
- https://ng-native.com/packages/components/text , /components/image , /components/safe-area , /components/scroll-view , /components/gestures
- https://ng-native.com/packages/device/accessibility , /packages/tailwind/utilities , /packages/platform/bootstrapping , /packages/metro/configuration , /packages/testing/testing-styling
- https://ng-native.com/packages/expo/fonts , /packages/expo/native-views , /packages/expo/dom-components
- https://github.com/ng-native/ng-native (HEAD 2026-09-29): `packages/fabric/src/css.ts`, `packages/metro/css/*.cjs` (`values.cjs`: `REM = 16`), `packages/integration-tests/{css-oracle.test.ts, scripts/generate-css-oracle.mjs, scripts/generate-tailwind-oracle.mjs, tailwind-sweep-suite.ts, tailwind-sweep.test.ts, layout.ts}`, `examples/canary/VALIDATION.md`
- Dragon: README.md, AGENTS.md, docs/decisions.md, docs/research/css-support.md, docs/research/coverage-roadmap.md, docs/research/T015-css-range.md, T016-styling-dx.md, T017-css-corpus.md, pitfalls.md, docs/goals/milestone-2-proof/state.yaml, `origin/master:packages/dragon/src/profiles/{ios,web,android}.ts`
