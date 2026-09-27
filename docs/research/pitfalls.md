# Cross-platform pitfalls: what Dragon removes by design

Synthesis of two research notes written on 2026-09-26:

- `docs/goals/milestone-1/notes/T006-platform-pitfalls.md`: 21 real-world "works on web, broken on the phone" bugs that users of React Native, Expo, NativeWind, React Strict DOM, Lynx, Tamagui, Flutter and Capacitor hit, ranked by how often they bite. Cited below as **P1 to P21**.
- `docs/goals/milestone-1/notes/T007-dragon-dx-pitfalls.md`: 24 places where Dragon's own design could surprise a developer, in three tiers. Cited below as **A1 to A7, B1 to B7, C1 to C10**, the note's own labels.

Evidence strength follows those notes: most issue numbers were checked with `gh api`; many other claims come from search summaries and are leads, not facts. This document adds no new external evidence. Where a proposal below depends on something not yet verified, it says so.

## 1. Summary in plain words

The owner's promise is: **write CSS while looking at one platform, and the other platform just works.** Almost every pitfall in both notes has the same shape: a tool accepted a style, the platform then did something different on its own, and nobody found out until someone looked at a device. Dragon can break that shape in four ways, in order of preference.

**Removed by design (it cannot happen).** 24 of the 45 pitfalls. These are the cases where the difference comes from a choice that a platform or a runtime makes on the developer's behalf: defaults nobody wrote, text styles that do not inherit, shadows that disappear under clipping, `z-index` fighting Android elevation, fonts registered under the wrong name, hot reload taking a different path from release. Dragon's compiler sees the whole component tree, resolves every style for every reachable state before the app runs, and writes every value explicitly, so none of those choices is left to the platform. "Cannot happen" still needs a test proving the mechanism works; the difference is that the developer never has to know about it.

**A default that matches the web (the developer never writes it).** 14 pitfalls. The browser does things for a page that native views do not: it scrolls a tall page, keeps content out of the notch, stays light unless the page asks for dark mode, reads direction from `dir` rather than the phone's language, and measures `rem` from 16px. Dragon gives native the browser's meaning for each, so a page that looks right in the browser gets the same behaviour on the phone.

**A build error with a fix.** 5 pitfalls where the platform genuinely cannot do what the CSS says (a `z-index` that escapes its container, `position: fixed` outside an overlay, a feature below the declared Android version). Many "by design" rows also keep an error for their leftover edge cases, such as a font weight with no font file. Errors appear for every configured target on every compile, in the editor and in `typecheck`, not weeks later in a phone build.

**A generated test.** 2 pitfalls are mainly about states nobody previews: the largest accessibility text size, and text overflow with clamps and letter spacing. The same analysis that resolves each state also generates a Chrome comparison for it. Most other rows use generated tests as their proof as well.

**Accepted differences.** No row is left entirely to chance, but some leftovers cannot be removed: font rasterisation and system fonts (`system-ui` is a different font on each host), the look of focus rings, how nested scroll gestures are shared, sub-pixel anti-aliasing, and raw speed on old devices. Each is labelled `caveat` in the support profile, never `exact`.

Five working rules, drawn from the six principles below, do most of the work. If only these hold, "focus on one platform" is true for the style layer:

1. **The compiler decides every platform choice, from the whole tree, before the app runs.** Nothing is resolved at run time on the device and nothing falls through to a platform default.
2. **Native reproduces what the browser does when the author wrote nothing.** Chrome's built-in element styles are the lowest layer, and the web meanings of `color-scheme`, `dir`, viewport scrolling, `viewport-fit` and `rem` apply on native too.
3. **The browser preview shows the compiled result.** When a native target is configured, the web output comes from the same resolved styles, and a live check in the dev server outlines any box native would lay out differently.
4. **Every configured target is checked on every compile.** Native errors show up while developing on web, in the editor and in `typecheck`.
5. **Every state the analysis finds gets a Chrome comparison,** including the largest text size and right-to-left, with dev and release output proven identical.

## 2. The six owner-approved principles, evaluated

Each principle below lists the pitfalls it removes, what it costs, what it cannot remove, and any refinement the evidence supports. Every refinement proposed here is a researched default that fits inside the approved wording; the choices that need the owner are collected in section 6.

### 2.1 Principle 1: resolve every style for every reachable state at build time

**Removes.**
- Text style inheritance (P14), including the hard part: inherited values that change when an ancestor's state changes. Each descendant gets its own resolved values per ancestor state.
- Dev works, release breaks (P10): there is no run-time style resolution for dev and release to disagree about.
- It makes the other removals possible. Shadow plus clipping (P3), `z-index` versus elevation (P8), group opacity only where children overlap (P20) and hover-only reveals (C5) are all decided per state, because the compiler knows which properties an element has in each state.
- The selector rule's errors moving between files (A7): once classes are a finite, known set per element, ownership is provable per file.

**Costs.**
- **State explosion.** Five independent boolean conditions on one element give 32 combinations. Resolving naively multiplies build time, generated code size (C1) and test count.
- **Class expressions must be finite.** `class={props.variant}` typed as `string` cannot be traced. It must become an error that suggests a string union type (A7).
- The analysis has to follow projected `{children}` and component props across files.

**Cannot remove.**
- Values known only at run time: custom properties set from script through `style`, text content length, container and screen size. These stay inputs to the on-device layout engine, which is exactly why it exists.
- Children supplied by code the analysis cannot see (a library that renders arbitrary children). Those elements get the element's own styles plus inherited text styles, and nothing that depends on a parent selector.

**Refinement (researched default).** Resolve per condition, not per combination. Two conditions are multiplied only when both set the same property on the same element; otherwise each condition gets its own small table. Identical property sets across states share one entry, in both generated code and tests. The build summary reports the number of distinct states per component, and a state count above a budget becomes an info diagnostic naming the conditions that multiply.

### 2.2 Principle 2: generate parity tests per component per state, plus largest text size and right-to-left

**Removes, or proves the fix for.**
- Layout defaults (P4, A2), text line height (P1), overflowing text (P12), text scaling (P9) and right-to-left (P16): each needs a fixture in a state nobody previews, and the analysis already knows every state.
- Different answers in different places (C10): the same data drives the tests.
- It turns "untested state" from a hope into a checked property: a state with no passing comparison cannot be marked `exact`.

**Costs.**
- Chrome capture time grows with states × text sizes × directions. Deduplication by property-list hash (a state that resolves to the same properties as another shares its test) keeps this to distinct results only.
- Tests at the largest text size prove that native matches Chrome, not that the layout is good. If both clip a label identically, the comparison passes. See owner decision 5.

**Cannot remove.**
- Anything Chrome cannot show: the on-screen keyboard, touch versus hover, device fonts, frame rate.
- **A blind spot introduced by principle 4.** If Chrome renders Dragon's own compiled web output, a bug in Dragon's cascade resolution appears identically in both, and the comparison passes. See the refinement under principle 4.

**Refinement (researched default).** Right-to-left fixtures depend on Taffy supporting `direction`. That is not verified (T006 marks it unverified; T001 owns Taffy facts). If Taffy lacks it, the right-to-left profile rows stay `unsupported` until an adapter passes, and generated right-to-left tests are recorded as expected failures in the report rather than skipped silently.

### 2.3 Principle 3: the compiler owns platform choices

Covers: text run versus view from context, wrapping loose text, writing inherited text styles onto every text node, per-platform borders and shadows with `shadowPath` from known geometry, `z-index` resolved to sibling order, and `:hover` only on devices that can hover.

**Removes.**
- Text style inheritance (P14): every text node carries its full resolved font, colour, alignment and spacing.
- Shadows (P3): the compiler splits "shadow" and "clip" onto two layers whenever both are present in a state, and always sets `shadowPath` from the border-radius geometry, so the iOS clipping bug and the offscreen rendering cost both disappear. No surveyed tool does this automatically (T006).
- Border radius and clipping (P5): clip-to-rounded-rect is always emitted when `overflow: hidden` and `border-radius` are both set.
- `z-index` versus elevation (P8): one ordering, from sibling order, and hit testing follows draw order. On Android, shadows must either be drawn without elevation or elevation must be part of the same ordering.
- Hover (P18, C5): `:hover` rules become "while a real pointer hovers" on native and never stick after a tap.
- Performance cliffs from generated code (P20, B7): the compiler always emits the cheap native form.

**Costs.**
- **The native view tree is no longer the authored tree.** A shadow host wraps a clip layer; adjacent text spans merge into one styled text view. Debugging, the accessibility tree, test dumps and hot reload all need a map from each authored element to its generated views. The property list must carry that map.
- More generated code per element in states that need the split.

**Cannot remove.**
- Real platform limits: dashed borders with correct corner geometry, per-side border colours with radius on Android until a fixture proves a path-based border, `box-shadow` below Android API 28 (outset) or 29 (inset). These stay build errors.
- Differences between text engines (Core Text, Android `StaticLayout`) in line breaking and glyph placement.

**Refinement (researched default).** Add **text layout** to the compiler-owned list: reproduce the browser's half-leading line height (section 4.3). This is the top-ranked pitfall in T006, unsolved for nine years in React Native, and it is a platform choice the compiler can make from font metrics.

### 2.4 Principle 4: web output compiled from the same result when a native target is configured

This is the main owner decision (section 6).

**Removes.**
- Layout defaults on the web side (P4, A2): every value is written explicitly, so browser built-in styles no longer decide anything. This also removes differences between Chrome's, Safari's and Firefox's built-in styles.
- Viewport units (P15): `vh` gets the same meaning on both (section 4.6).
- Simulator-first surprises (C8) and guarded escapes (B5): what the browser shows is what the compiler produced, so a web-only rule outside an explicit escape cannot hide.
- Dev versus release on web (P10).
- Together with the live parity overlay, it makes the web preview the honest preview of native for everything in the style layer.

**Costs.**
- **Self-comparison.** If Chrome only ever renders Dragon's output, Chrome stops being an independent reference for the cascade. A resolution bug passes every test.
- Browser DevTools show compiled rules, not authored ones. Source maps from compiled rule to authored declaration are needed from day one.
- Web CSS gets larger, because every resolved value is written. Shared atomic classes (StyleX-style) keep this bounded; the size must be measured, and labelled as downloaded bytes, not code executed.
- Third-party global CSS on web (not compiled by Dragon) can still override compiled output. It must either go through Dragon or be listed as an escape.

**Cannot remove.** Text metrics and system fonts, the on-screen keyboard, safe areas on a desktop browser, touch versus hover, performance.

**Refinement (researched default, required if principle 4 is adopted).** Keep two Chrome references in the test lanes:
1. **Authored CSS in Chrome** (the developer's CSS, unchanged). Its boxes must equal the boxes of Dragon's compiled web output. This checks the cascade resolution, including the built-in-styles layer.
2. **Compiled web output in Chrome** versus the Taffy lane (and later the simulator). This checks the layout engine and native mapping.

Milestone 1's goal says "Chrome renders Dragon's own web output as the reference". It should render both.

### 2.5 Principle 5: fonts declared once and checked at build

**Removes.**
- Custom font names and weights (P6, C2): Dragon reads each file's name table, bundles the same file for every target, registers it under the CSS family name, and fails the build if a requested weight or style has no file.
- The OEM-font variant of text clipping (P1), where Android measures with one font and draws with another: a bundled font is the same font everywhere.
- Part of "text differs when every rule is supported" (B1).

**Costs.** A font-file parser at build time (licence to check); local files only for native (a remote-only `@font-face` is an error for native targets); app size grows by the font files.

**Cannot remove.** `system-ui` and other system fonts differ by host: a developer previewing on Windows sees Segoe UI while the iPhone uses SF. Rasterisation and hinting differ. Variable-font weights need Android 10 (API 29).

**Refinement (researched default).** While reading the font file, also extract its vertical metrics (ascent, descent, line gap, units per em). Use them for the half-leading computation on native, and write them into the web `@font-face` as `ascent-override`, `descent-override` and `line-gap-override`. Then `line-height: normal` means the same number on both platforms for bundled fonts. Which metrics table each engine uses by default is unverified; pinning the overrides removes the question.

### 2.6 Principle 6: platform defaults, not settings to remember

Covers: each screen's root is a scroll container that respects the notch and home-bar areas, focused inputs move clear of the keyboard, and `100vh` means the visible screen.

**Removes.**
- Keyboard avoidance (P2), the largest issue cluster found: 111 React Native issue titles.
- Safe areas and edge-to-edge (P7), and safe areas being invisible on a desktop browser (A5).
- Page scrolling (A4).
- Viewport units (P15).

**Costs.**
- Keyboard avoidance is behaviour, not style. It lives in the small native runtime and can only be proven on a device or simulator, so it belongs to the iOS milestone.
- A root scroll view conflicts with app-shell layouts that manage their own scrolling. The opt-out is `overflow: hidden` on the root, as on web.
- Nested scrolling (P19) becomes more common, because the root is now a scroller.

**Cannot remove.** Chat-style composers pinned to the keyboard (they need a keyboard inset such as `env(keyboard-inset-height)`, a later profile row), inset timing on rotation and split screen (handled by relayout, proven on device), and Android edge-to-edge quirks below the declared floor.

**Refinement (researched default, fits the approved wording).** Use the web's own switch for the notch, as iOS Safari does:
- Without `viewport-fit=cover`, the root is laid out inside the safe area, and `env(safe-area-inset-*)` is 0, as in a browser. A naive page is never clipped, and insets can never be applied twice.
- With `viewport-fit=cover`, the root goes edge to edge and `env()` returns the real insets. The web output adds `viewport-fit=cover` to the viewport meta automatically when the author uses it.

### 2.7 Additional by-design decisions

These come from the evidence in T006 and T007 and fit the principles above. Each lists the pitfalls it removes.

| Decision | Removes | Cost and limits |
|---|---|---|
| **Chrome's built-in styles as the lowest native layer.** Capture computed styles from the pinned Chrome for each supported element with no author CSS, and store them as versioned data. Do not copy Blink's `html.css` source: its licence notice must be checked first (T001 owns licences). | P4, A2, C7 in part | Data must be re-captured when the pinned Chrome changes; the "unstyled" fixtures detect drift. |
| **Every layout property written explicitly to Taffy.** Taffy's own defaults are never relied on. Its default is flex, border-box, row, shrink 1; Chrome's is block, content-box. | P4, A2 | A unit test checks that the property list sets every Taffy style field. |
| **Half-leading line height reproduced on native, and text never clipped to its line box.** In CSS, glyphs may paint outside the line box. | P1, B1 in part | Needs font metrics (principle 5). Milestone 1 can prove the line-box geometry with the Ahem test font; glyph placement is proven on device later. |
| **Shadow and clip layers split automatically; `shadowPath` always set.** | P3, P20 in part, B7 | Adds a wrapper view per shadowed and clipped element. |
| **Font files inspected at build, with metric overrides on web.** | P6, C2, P1 in part | See principle 5. |
| **Selector ownership proven per file.** The per-module scope hash means a scoped `.list .row` can only match that component's elements. Only unscoped CSS needs the app-wide check, and its errors name both files. | A7 | Projected `{children}` must be traced; dynamic class strings must be typed as a finite union. |
| **Live parity overlay.** Taffy as WebAssembly in the web dev server lays out the current page from the property list, using the browser's text measurements, and outlines any box native would place more than one device pixel away. It runs in both directions (C8). | A2, B1, C8, P4 | Speed of Taffy as WebAssembly inside a page is not measured. Browser text measurement hides font differences on purpose; those are shown separately. |
| **Dev-only property-list applier for hot reload.** Compiled out of release builds. The simulator lane dumps the applied properties from both the dev applier and the generated Swift on every fixture and requires them to be identical. | A6, P10 | A second code path to maintain; the equality check is what keeps it honest. Changes to box structure rebuild that node. |
| **Configured targets checked on every compile.** Targets live in the project config, never in command flags, with a declared minimum OS version per target that selects the profile rows. | A1, B4, B5, C4, C8, P21, B6 in part | Owner decision 2. |
| **`color-scheme` and `dir` keep their web meanings.** No `color-scheme` on the root means native is forced light; direction comes from `dir`/`direction`, never from the device language. | A3, B3, P16, P17 | Apps that want system-driven direction write `dir={locale.dir}` once. |
| **Launch screen and window background generated from the root's resolved background, for both colour schemes.** | P17 | One generated asset per target. |
| **Image sizes known at build for local assets; `object-fit: fill` from the initial values.** | P13, C3 | Remote images without a size or `aspect-ratio` get a warning on every target, because they shift layout on web too. |
| **One `rem` base of 16 on every target.** CSS `px` means points on iOS and dp on Android. | B2, P15 | Text-size scaling policy is owner decision 5. |
| **Errors grouped by feature, with a per-target readiness count.** | C9 | None; errors are never softened into warnings. |
| **Drift test.** Docs tables, editor data and agent guidance are regenerated in CI and must match the committed files. | C10 | Already implied by one-profile design. |

## 3. Pitfall table

Class names: **design** (cannot happen), **default** (web meaning applied without the author writing it), **error** (build error with a fix; *warning* and *info* are the lighter severities), **test** (generated Chrome comparison), **accepted** (a leftover difference labelled `caveat`). The first class listed is the primary one. "Lane" says where the proof runs: **Linux** (compile, Taffy, Chrome, milestone 1), **sim** (iOS simulator, next milestone), **dev** (dev server), **unit** (compiler unit test).

### From T006 (real-world pitfalls)

| # | Pitfall | Class | Mechanism | Test that proves it |
|---|---|---|---|---|
| P1 | Text line height, descender clipping, font padding | design, test | Half-leading reproduced from font metrics; text never clipped to its line box; bundled fonts by default | Linux: tight `line-height` fixtures (0.8, 1, `px` equal to font size) with Ahem, comparing line-box geometry. Sim: descender-heavy strings, glyph bounds within the element box |
| P2 | Keyboard avoidance | default | Root scroll container moves the focused input clear of the keyboard (principle 6) | Sim: page taller than the screen with an input at the bottom; the input's frame stays above the keyboard frame |
| P3 | Shadows: iOS clip kills shadow, Android elevation only, offscreen cost | design, error | Shadow and clip split onto two layers; `shadowPath` from geometry; below the Android floor for `box-shadow` is an error | Sim: shadow plus `overflow: hidden` fixture checks the shadow layer is present and unclipped; unit: `shadowPath` set on every shadowed layer; unit: floor error |
| P4 | Layout defaults that differ from CSS | design, test | Chrome built-in styles as lowest layer; every Taffy field explicit; web output explicit too | Linux: "unstyled" fixtures with no author CSS; unit: every Taffy field set |
| P5 | Border radius, clipping, per-side borders on Android | design, error | Always emit rounded clip when radius and `overflow: hidden` are both set; per-side colours with radius and dashed borders are errors until a fixture passes | Sim (Android lane later): child overflowing a rounded corner; unit: error for per-side colours with radius |
| P6 | Custom font names and weights | design, error | Name table read at build; same file bundled everywhere; missing weight is an error | Unit: missing-weight fixture produces the error; sim: registered family resolves to the bundled file |
| P7 | Safe areas and Android edge-to-edge | default | Root inside the safe area unless `viewport-fit=cover`; `env()` is 0 without cover, so insets apply once | Sim: notch-device fixture with and without cover; Linux: `env()` resolves to 0 without cover |
| P8 | `z-index` versus elevation (draw order versus touch) | design, error | `z-index` becomes sibling order; hit testing follows draw order; escaping the container is an error | Unit: resolved sibling order; sim: tap on overlapping siblings hits the top one; unit: escape error (C6) |
| P9 | Text scaling breaks fixed layouts | test, warning | Generated largest-text-size state; warning on a text container with a fixed block size | Linux: largest-size variants compared with Chrome at the scaled root size; unit: fixed-height warning. Policy is owner decision 5 |
| P10 | Dev works, release breaks | design, test | One compiler result; dev applier proven identical to generated Swift; no dev-only validation | Sim: dev and release property dumps identical on every fixture |
| P11 | Pixel rounding and hairlines | default, test, accepted | Taffy rounds against absolute positions like Chrome snaps to device pixels; `1px` means one CSS pixel, as in Chrome | Linux: corpus at DPR 2 and 3 (and 2.625 for Android later), compared in device pixels. Sub-pixel anti-aliasing is accepted |
| P12 | Ellipsis, line clamps, letter spacing | test, error | Clamp and ellipsis fixtures per state; non-end multi-line ellipsis on Android is an error | Linux: clamp box heights; sim: truncation position; unit: Android error |
| P13 | Images: intrinsic size and fit | design, warning | Local asset sizes known at build; `object-fit: fill` initial value; unsized remote images warn on every target | Linux: `<img>` with a build-time size and no author CSS; unit: warning |
| P14 | Text style inheritance | design | Inherited styles written onto every text node, per ancestor state | Linux: nested text inside a styled container, with the ancestor toggling state |
| P15 | `rem` base, `px`, viewport units | design | `rem` = 16; `px` = points/dp; `vh` = the root's visible layout box on native, `dvh` on web | Linux: `rem` and `vh` fixtures against Chrome at a fixed viewport |
| P16 | Right-to-left | default, test | Direction from `dir` only; logical properties become leading/trailing; switchable without restart | Linux: generated right-to-left variant (pending Taffy `direction`, see principle 2); sim: runtime switch |
| P17 | Dark mode and launch flashes | default | Web meaning of `color-scheme`; launch background generated from the root | Unit: no `color-scheme` forces light; sim: launch background matches root in both schemes |
| P18 | Hover, focus rings, keyboard navigation | design, warning, accepted | `:hover` only with a real pointer; hover-only reveal warns; `:focus-visible` maps to the platform focus system | Unit: warning; sim: tap does not apply hover state. Focus ring appearance accepted as `caveat` |
| P19 | Nested scrolling; `fixed` and `sticky` in scroll views | error, accepted | `position: fixed` outside overlays and `sticky` are errors until proven; gesture sharing between nested scrollers is accepted | Unit: errors; sim: nested scroller fixture (evidence, not gate, until a numeric check exists) |
| P20 | Performance cliffs: shadows, group opacity, blur | design, info | Cheap native forms always; group opacity only where children overlap; costly paths reported in the build summary | Unit: overlap analysis chooses group opacity only when needed; sim: frame-time fixtures (iOS milestone) |
| P21 | Android version and vendor fragmentation | error, accepted | Declared minimum OS per target selects profile rows; features below it are errors; vendor system fonts accepted | Unit: floor errors per row; vendor fonts remain `caveat` on `system-ui` |

### From T007 (Dragon-specific pitfalls)

| # | Pitfall | Class | Mechanism | Test that proves it |
|---|---|---|---|---|
| A1 | Native errors appear only when building for the phone | design | Configured targets checked on every compile; shown in editor, dev overlay and `typecheck` | Unit: `typecheck` fails for an iOS-only error with no target flag given |
| A2 | Defaults nobody wrote (browser styles vs Taffy and UIKit) | design, test | Chrome built-in styles as lowest layer; explicit Taffy fields | Linux: "unstyled" fixture group |
| A3 | Dark mode follows the system on native | default | No `color-scheme` means forced light; browser default colours, not UIKit semantic colours | Unit: resolved root scheme; sim: dark-mode device renders light page light |
| A4 | Browser scrolls a tall page, native root does not | default | Root compiles to a scroll view when the browser would scroll | Linux: tall-page fixture (scroll content size equals Chrome's document height); sim: reachability |
| A5 | Safe areas invisible on a desktop browser | default | `viewport-fit` web meaning; dev overlay device frame gives `env()` real values | Sim: notch fixture; dev: device frame shows insets |
| A6 | Hot reload dies because output is generated Swift | design, test | Dev-only property-list applier, compiled out of release, proven identical | Sim: dev and release dumps identical |
| A7 | Selector rule surprises; errors move between files | design, error | Ownership proven per file from the scope hash; unscoped CSS errors name both files; non-finite class strings are errors | Unit: scoped descendant selector accepted; unit: error names both files |
| B1 | Text differs even when every rule is supported | default, accepted | Numeric `line-height` in scaffolds; info hint on `line-height: normal` and unbundled `system-ui`; metric overrides for bundled fonts; parity overlay shows font differences separately | Linux: Ahem text fixtures; residual glyph differences accepted as `caveat` |
| B2 | `rem` base 16 vs 17 | design | 16 on every target (section 5) | Linux: `rem` fixtures |
| B3 | Right-to-left flips by device language on native | default | Direction from `dir`/`direction` only | Unit: resolved direction ignores locale; sim: Arabic-locale device keeps authored direction |
| B4 | Headless libraries and third-party CSS | error | Library CSS checked at publish; consumer gets one error per unsupported family, located in their own file | Unit: library manifest produces one located error |
| B5 | `@supports` and `@media (os:)` hiding errors | design, info | Escapes allowed but listed (`dragon escapes`, build summary); guard with no alternative branch is info; never suppressible | Unit: escape listing contains every guard |
| B6 | Support-profile updates break builds | default | Profile version pinned with the package; demotions warn for one release unless output was wrong; `dragon upgrade --check` | Unit: demoted row produces a warning naming the version it becomes an error |
| B7 | Performance cliffs from generated code | design, info | Cheap native forms; costly paths reported | As P20 |
| C1 | Generated-code size and Swift compile time | default, test | Plain statement lists, one file per component, deduplicated state tables; size and compile time reported | Budget check on Dragon's fixture app (sim lane); sizes labelled downloaded vs executed |
| C2 | Fonts are not the same asset | design, error | As P6 | As P6 |
| C3 | Images are not the same asset | design | Same logical asset name everywhere; box reserved from build-time size; density variants from one source | Linux: image box reserved before load |
| C4 | Tokens only on the document root | error | `ROOT_OUTSIDE_DOCUMENT` with a quick fix; scaffold includes the token block | Unit: error and fix text |
| C5 | Hover, focus and touch | design, warning | As P18 | As P18 |
| C6 | `z-index` used to escape a container | error | Escape is an error pointing to overlay families | Unit: error |
| C7 | Unstyled form controls | default, warning | Scaffold reset sets `appearance: none` on both platforms; `appearance: auto` on a native target warns | Unit: warning |
| C8 | Developing on the simulator first | design | `dev` always serves web too; parity overlay runs both ways; principle 4 | Dev: overlay reports a box difference in a seeded fixture |
| C9 | Wall of errors in early releases | default | Errors grouped by feature; readiness count per target | Unit: grouping output |
| C10 | Different answers in different places | design, test | One profile drives compiler, editor, docs and guidance; drift test | CI: regenerated files match committed ones |

## 4. Key defaults in pseudocode

Dragon terms: regular CSS and an element tree in; a resolved property list per element per state out. The property list feeds generated Swift, the dev applier, the test lanes and (with principle 4) the web output.

### 4.1 Resolution: built-in styles, explicit values, states

```ts
function resolveComponent(component, config) {
  const cascade = [
    chromeBuiltInStyles(config.pinnedChrome),   // captured data, not copied source
    ...authorLayers(component),                 // scoped <style>, document :root tokens
  ];
  const out = new PropertyList();
  for (const element of component.elements) {
    // conditions: finite class sets from types, ui-* attributes, :hover/:active,
    // dark mode, width queries, text size, direction
    for (const state of reachableStates(element, groupIndependentConditions)) {
      const computed = cascadeFor(element, state, cascade);
      const layout = allTaffyFields(computed);  // every field, Taffy defaults never used
      const paint = platformPaint(computed, state);
      const text = element.isTextNode
        ? inheritedTextStyles(element, state)   // font, colour, spacing written on the node
        : null;
      out.add(element.id, stateKey(state), { layout, paint, text });
    }
  }
  return out.dedupeIdenticalStates();           // one entry per distinct result
}
```

### 4.2 Loose text and text runs

```ts
for (const child of element.children) {
  if (child.kind === 'text' && element.isBox) {
    // CSS makes an anonymous box for text in a flex container; native gets a text view
    wrapInTextView(child, inheritedTextStyles(element, state));
  }
}
mergeAdjacentInlineRuns();   // spans become ranges in one styled text view; map kept per authored node
```

### 4.3 Half-leading line height

```ts
function lineBox(font, fontSize, lineHeight) {
  const m = font.metrics;                       // read from the font file at build
  const ascent = m.ascent / m.unitsPerEm * fontSize;
  const descent = m.descent / m.unitsPerEm * fontSize;
  const contentHeight = ascent + descent;
  const used = lineHeight === 'normal'
    ? contentHeight + m.lineGap / m.unitsPerEm * fontSize
    : resolveLength(lineHeight, fontSize);
  const halfLeading = (used - contentHeight) / 2;   // may be negative
  return {
    height: used,                               // what layout sees
    baseline: halfLeading + ascent,             // where glyphs sit, as in Chrome
    clipsGlyphs: false,                         // ink may overflow the line box, as in CSS
  };
}
// iOS: paragraph style min/max line height = used, baselineOffset from `baseline`
// Android: a line-height span that distributes halfLeading above and below
// web output: @font-face { ascent-override; descent-override; line-gap-override } from the same metrics
```

### 4.4 Shadow and clip

```ts
if (paint.boxShadow && paint.clipsContent) {
  emit(shadowHost({ shadow: paint.boxShadow, shadowPath: roundedRect(box, paint.radii) }));
  emit(contentLayer({ clip: roundedRect(box, paint.radii), background: paint.background }));
} else if (paint.boxShadow) {
  emit(layer({ shadow: paint.boxShadow, shadowPath: roundedRect(box, paint.radii) }));
}
if (target.os === 'android' && paint.boxShadow && config.minOs.android < profile.rows.boxShadow.minApi) {
  error('DRAGON_BELOW_TARGET_FLOOR', ...);
}
```

### 4.5 Stacking and hover

```ts
children.sort(stableBy(child => resolvedZIndex(child, state) ?? 0));  // draw order = sibling order
hitTestOrder = drawOrder;                         // touches go to what is on top
if (escapesStackingContext(element)) error('DRAGON_ZINDEX_ESCAPES', ...);

for (const rule of hoverRules(element)) {
  applyWhen(rule, 'pointerHovering');            // never set by a tap
  if (revealsOnlyOnHover(rule) && !target.hasHover) warning('DRAGON_HOVER_ONLY_REVEAL', ...);
}
```

### 4.6 Root, colour scheme, direction, viewport

```ts
const root = document.root;
root.colorScheme = resolved(root, 'color-scheme') ?? 'light';     // web meaning: no scheme = light
root.direction = resolved(root, 'direction');                     // from dir, never device locale
root.isScrollView = resolved(root, 'overflow') !== 'hidden';      // browser scrolls tall pages
root.keyboardAvoidance = root.isScrollView;
root.insets = viewportFit === 'cover' ? 'none' : 'safe-area';
env.safeAreaInsets = viewportFit === 'cover' ? platformInsets : zero;   // as in a browser
units.vh = root.layoutBox.height / 100;          // visible screen; keyboard does not change it
webOutput.rewrite('vh', 'dvh');                  // same meaning in the browser
launchScreen.background = resolvedBackground(root, { light: true, dark: root.colorScheme !== 'light' });
```

### 4.7 Configured targets

```ts
for (const target of config.targets) {           // from dragon config, never CLI flags
  const profile = profileFor(target, config.minOs[target]);
  const diags = check(component, profile);
  editor.publish(diags);
  devOverlay.show(diags);                        // web page still renders
  typecheck.failIf(diags.some(d => d.severity === 'error'));
}
```

### Example diagnostics

Shape follows `T030-agent-guardrails.md` section 4.2; the code prefix becomes Dragon's (section 5 of this document).

```text
error DRAGON_FONT_FACE_MISSING  src/styles/document.css:14:3  [targets ios, web]
  font-weight: 600 for "Inter" has no font file.
    14 |   .title { font-family: Inter; font-weight: 600; }
       |                                ^^^^^^^^^^^^^^^^
  why: Inter is declared with @font-face files for weights 400 and 700 only. Browsers fake the weight
       and Android falls back to the system font, so each platform would draw it differently.
  fix: add an @font-face for weight 600 (Inter-SemiBold.woff2), or use 400 or 700.
  profile: fonts.faces.missing-weight (test unit/fonts/missing-weight)
```

```text
error DRAGON_CLASS_NOT_FINITE  src/components/badge.tsrx:7:16  [target ios]
  class={props.variant} can be any string, so Dragon cannot work out which styles this element has.
     7 |   <span class={props.variant}>{props.label}</span>
       |                ^^^^^^^^^^^^^
  why: native styles are resolved for every state before the app runs.
  fix: type the prop as a list of names, for example variant: 'info' | 'warning' | 'error'.
```

```text
warning DRAGON_HOVER_ONLY_REVEAL  src/components/row.tsrx:18:3  [target ios]
  .row:hover .delete { opacity: 1 } is the only rule that makes .delete visible.
    18 |   .row:hover .delete { opacity: 1; }
       |   ^^^^^^^^^^^^^^^^^^
  why: an iPhone has no pointer to hover with, so this button can never be shown or tapped there.
  fix: also show it under :focus-within, or make it visible inside @media (hover: none).
```

## 5. Inconsistencies in docs/research to fix

These files are copied research and are not edited by this task. The resolved values below are what the compiler, profiles and future docs should use; the research files should be corrected when next revised.

| Topic | Conflict | Resolved value |
|---|---|---|
| `rem` base | `T016-styling-dx.md` 3.5 proposes 17pt on iOS; `T018-styling-design.md` 3.4 says 16pt | **16** on every target at the default text size, equal to the browser; scaling with text size is owner decision 5 |
| Style table versus generated Swift | `T018` section 1 and "Dev loop", `T016` 3.10 and `T025` section 5 describe a style table evaluated on the device; `README.md` and `AGENTS.md` say generated Swift with no on-device CSS | **Generated Swift is the release output.** The "style table" is the plain-data property list: used by test lanes, the dev-only applier and the web output, never shipped in release. The hot-reload contract is the dev applier with the identical-dump check |
| Grid on iOS | `T016` 3.8's sample errors say `display: grid` is unsupported on iOS (a Yoga-era assumption); `css-support.md` marks grid `exact` under Taffy | **Grid is not a platform limit under Taffy.** Its profile row is `unsupported` until a grid fixture passes (AGENTS.md: no claim without a test), and the error text says "not proven on ios yet", not "not supported". Sample errors should use a real limit, such as `display: table` or `:has()` |
| Theme example | `T016` 3.2 uses `<select>` and `color-scheme` on a non-root `div`; `T025` 2.2 uses buttons and `color-scheme` on `:root` | **`T025`'s version:** buttons, `color-scheme` on the document root only |
| When native errors show | `T025` section 2.3 and `T016` 3.8 say errors fire only for targets named in the build or dev command; `css-support.md` open questions say configured targets | **Configured targets,** from the project config, on every compile. Whether `typecheck` fails for them is owner decision 2 |
| Built-in element styles | Only `box-sizing` is called out as "emit the CSS default" (`css-support.md`); `display`, margins, fonts and colours are unspecified | **The whole captured subset of Chrome's built-in styles** for supported elements is the lowest layer (owner decision 3) |
| Project home and diagnostic codes | `T025` section 5 says "a package inside the Markless repository" and uses `MARKLESS_CSS_*` codes | **Separate project, Dragon CSS** (owner, 2026-09-26). Codes come from Dragon's profiles with a Dragon prefix; Markless shows them unchanged |

## 6. Owner decisions

I recommend yes to all five; the first is the one that most changes what gets built.

**Build the browser preview from the compiled result.** When an app lists a native target, the web output comes from the same resolved styles as the phone. Recommend yes, because then the browser shows what the phone will get, and developers can work in the browser alone. The catch is that Chrome would stop checking Dragon's own style resolution, so the tests must also render the author's original CSS in Chrome and require the same boxes.

**Fail the type check for any configured target.** Recommend yes, because a developer or agent who only runs the web app must still be stopped, by the command they already run, before writing CSS the phone cannot do. The browser page keeps rendering while they fix it.

**Copy the browser's built-in element styles onto native.** This includes the body's 8px margin and the serif default font. Recommend yes, because parity is the product and those defaults are exactly what nobody tests. New projects start with a small reset that applies to both platforms, so most apps never see these defaults.

**Warn for one release before a support row is withdrawn.** Recommend yes, except when the old output was wrong, because a working app should not fail after a routine update with no warning.

**How text size affects layout.** Recommend: `rem` sizes follow the phone's text-size setting, `px` sizes do not, and every component is automatically tested at the largest text size. Any text cut off by a fixed-height box at that size is reported as a warning, not a failure, because some fixed designs are deliberate. The alternative, failing the build, would block apps whose designers chose to cap text.

Researched defaults, adopted unless the owner objects, are in section 2: resolving per condition, the viewport-fit rule for the notch, `vh` as the visible screen with `dvh` on web, half-leading line height, shadow and clip splitting, metric overrides for bundled fonts, per-file selector ownership, the live parity overlay, the dev-only applier, and web meanings for `color-scheme` and `dir`.

## 7. What changes in milestone 1 scope

The oracle stays as written: at least 100 box and flex fixtures pass at 1 device pixel. The additions below count toward the 100 but must not replace box and flex coverage.

1. **"Unstyled" fixture group.** Supported elements (`div`, `p`, `h1` to `h6`, `span`, `body`, lists) with no author CSS, proving the built-in-styles layer. This needs a capture step that records Chrome's computed styles for each element with no author CSS into versioned data. Taffy defaults never leak: a unit test checks every Taffy style field is set in the property list.
2. **Two Chrome references,** if owner decision 1 is yes. Chrome renders the authored CSS and Dragon's compiled web output; their boxes must match before the compiled output is compared with Taffy. Goal principle #4 for milestone 1 should read "Chrome renders both".
3. **Tight line-height fixtures** using Ahem (ascent 0.8em, descent 0.2em, so half-leading is exact arithmetic): `line-height` 0.8, 1, 1.5, a `px` value equal to the font size, and multi-line text. They compare line-box heights and text positions with Chrome. Glyph placement waits for the iOS lane.
4. **Generated state fixtures deduplicated by property-list hash,** with the per-component state count in the report.
5. **Largest text size variant** for text fixtures: the root font size scaled by the iOS largest-accessibility ratio, in both Chrome and the Taffy lane.
6. **Right-to-left variant,** conditional on T001 confirming Taffy's `direction` support. If Taffy lacks it, the variant is reported as an expected failure and the right-to-left rows stay `unsupported`. It is never skipped silently.
7. **Device pixel ratios.** Run at least the box and flex corpus at DPR 2 and 3 as well as 1, comparing in device pixels, since pixel rounding (P11) is a layout-lane question.
8. **Property-list schema carries what later milestones need:** the authored-node-to-generated-view map (for text-run merging and shadow splitting), the per-state keys and source spans. Then the dev applier, parity overlay and generated Swift can all read it without a format change.
9. **Diagnostics wiring.** Diagnostics are typed and profile-sourced, and are checked for every configured target from the config, not from flags. Only layout-related errors are needed now (for example the `DRAGON_CLASS_NOT_FINITE` error from principle 1).

Out of milestone 1, unchanged: fonts and platform defaults (principles 5 and 6), shadow and clip splitting, keyboard, safe areas, hover and stacking on device, the dev applier and parity overlay. They belong to the iOS milestone and the dev-loop work.

```json
{
  "goalbuddy_receipt_v1": {
    "task_id": "T008",
    "role": "judge",
    "status": "done",
    "result": "complete",
    "board_path": "docs/goals/milestone-1/state.yaml",
    "decision": "Adopt the six principles with refinements. By design: 24 of 45 pitfalls; default: 14; build error: 5; generated test: 2 (primary class; most rows also carry an error or test). Principle 4 adds a self-comparison blind spot, closed by also rendering authored CSS in Chrome.",
    "full_outcome_complete": false,
    "rationale": "Every T006 (21) and T007 (24) pitfall is mapped to a handling class, mechanism and proving test. Principles evaluated for removals, costs and limits. Additions: Chrome built-in styles captured as data (not copied source), explicit Taffy fields, half-leading from font metrics with web metric overrides, shadow/clip split, per-file selector ownership, live Taffy WASM parity overlay, dev applier proven identical, configured targets with OS floors, viewport-fit web meaning with env() zero unless cover, vh as visible screen (dvh on web), color-scheme and dir web meanings, per-condition state resolution with dedupe.",
    "files_written": ["docs/research/pitfalls.md"],
    "owner_decisions": [
      "Web output compiled from the same result when a native target is configured (recommend yes, with a second Chrome reference on authored CSS)",
      "Fail typecheck for any configured target (recommend yes)",
      "Copy Chrome's built-in element styles onto native (recommend yes)",
      "Profile demotions warn one release first unless output was wrong (recommend yes)",
      "Text size: rem follows the setting, px does not, largest-size clipping is a warning (recommend)"
    ],
    "research_inconsistencies_resolved": {
      "rem_base": "16",
      "style_table_vs_generated_swift": "generated Swift in release; property list is test/dev/web data only",
      "grid_on_ios": "not a platform limit under Taffy; unsupported until a fixture passes",
      "theme_example": "buttons, color-scheme on the document root",
      "error_targets": "configured targets on every compile",
      "built_in_styles": "whole captured Chrome subset as lowest layer",
      "project_home_and_codes": "separate Dragon project, Dragon-prefixed codes"
    },
    "milestone_1_scope_changes": [
      "unstyled fixture group plus capture of Chrome built-in styles and an all-Taffy-fields unit test",
      "two Chrome references if principle 4 is adopted",
      "tight line-height fixtures with Ahem",
      "state fixtures deduplicated by property-list hash",
      "largest text size variant",
      "right-to-left variant conditional on Taffy direction support, never skipped silently",
      "DPR 2 and 3 runs",
      "property-list schema carries authored-to-generated view map, state keys, source spans",
      "configured-target typed diagnostics"
    ],
    "missing_evidence": [
      "Taffy direction (right-to-left) support not verified (T001)",
      "Licence of Blink html.css not checked; plan avoids copying it",
      "Which font metrics tables Chrome, Core Text and Android use for line-height: normal not verified",
      "Taffy WebAssembly speed in a dev-server page not measured",
      "Web CSS size growth under principle 4 not measured",
      "Many T006 frequency claims are search-summary level"
    ],
    "blocked_tasks": [],
    "required_board_updates": [
      "Record T008 done with evidence docs/research/pitfalls.md",
      "Surface the five owner decisions in section 6",
      "Feed section 7 scope changes into T002 (first Worker package) and T001 (Taffy direction, html.css licence, font metrics)",
      "If owner decision 1 is yes, amend goal.md milestone-1 coverage of principle 4 to 'Chrome renders both authored CSS and Dragon web output'"
    ]
  }
}
```
