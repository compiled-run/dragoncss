# T007: Dragon-specific DX pitfalls (Scout)

Owner goal: "people focus on one platform and it just works on the other." This note lists the places where Dragon's current design would break that promise: a developer previews one platform (usually web in a browser) and gets surprised on the other, or Dragon's own rules create friction. Each entry gives the surprise, why this design causes it, and the **default** that removes it without the developer thinking.

Inputs read: `README.md`, `AGENTS.md`, `docs/why-not-stylex.md`, `docs/research/{T025-styling-direction,T018-styling-design,css-support,testing-plan,T030-agent-guardrails,T016-styling-dx}.md`, head of `css-support-profile.draft.json`. Web sources accessed 2026-09-26 are listed at the end. T006 (cross-platform pitfalls in other tools) is a separate note; this one covers only what Dragon's design adds or can prevent.

## 0. Summary in plain words

- The design already gets the hardest thing right: nothing is dropped silently, and every failure is a located build error with a fix. The main remaining risk is **when** and **where** that error shows up. If a web developer only sees native errors weeks later, or only in a build they never run, "it just works" is false even though every error is correct.
- The second risk is **defaults**. A developer who never writes `display`, `font-family`, `color-scheme`, `line-height` or `dir` still gets a result on web, from the browser's built-in stylesheet and settings. Native must get that same result from Dragon, or the parts the developer never wrote are exactly where the platforms differ. Taffy's defaults (flex, border-box) and UIKit's (dark mode follows the system, layout flips in right-to-left locales, content under the notch) are all different from the browser's.
- The third risk is the **dev loop**. Compiling straight to generated Swift is the right release output, but a Swift rebuild on every style edit would kill hot reload. Dev needs a fast path that is proven to set the same properties as the generated Swift.
- Strongest single default: when an app lists a native target, the web dev server runs the native checks **and** a live "native layout would differ here" check (Dragon's own Linux Taffy lane, run in the browser on the current page), so the web preview is honest without opening a simulator.

## 1. Ranked list

Ranked by how much each would erode "it just works" if left to the developer: how often it bites, how late it is found, and how confusing it is when found. Tier A breaks the promise for most apps; tier B for many; tier C for some.

### Tier A: breaks the promise for most apps

**A1. Native errors appear only when someone builds for the phone.**
- Surprise: a web-first developer (or agent) writes `.list .row`, `:has()`, `position: fixed`, `transition: all` for weeks; the first iOS build shows 200 errors.
- Why here: web builds keep full CSS (T025 2.1). T016 3.8 says native errors fire "only for targets named in the build or dev command", so `dev` without `--target ios` hides them. T030 section 1 found the editor today shows only parse errors, so style errors need a new path into the editor.
- Default: the **target list lives in the project config, not the command**. Every configured target is checked on every compile. Native errors show in the editor, the web dev overlay and `typecheck` from the first keystroke; the page still renders on web (non-blocking in the browser), but `typecheck` and CI fail for any configured target. New projects are scaffolded with web and ios both configured, because the owner's promise assumes the other platform exists. Resolve the T016/T025 wording conflict ("named in the command" vs "configured") in favour of configured.

**A2. Things the developer never wrote: browser built-in styles versus Taffy and UIKit defaults.**
- Surprise: an unstyled `<div>` stack lays out as a row on native; padding makes boxes bigger on web than on native; `<p>` and `<h1>` have margins on web and none on native; the body has an 8px margin on web; unstyled text is a serif font on web.
- Why here: Taffy's `Style::DEFAULT` is `display: Flex` (when the flexbox feature is on), `box_sizing: BorderBox`, `flex_direction: Row`, `flex_shrink: 1`, `position: Static` (taffy `src/style/mod.rs`, main, read 2026-09-26). Chrome's defaults come from its built-in stylesheet: `display` depends on the tag, `box-sizing: content-box`, per-tag margins, `font: 16px serif`. css-support.md already notes "emit content-box unless authored otherwise", but only for box-sizing.
- Default: Dragon ships a **pinned copy of Chrome's built-in stylesheet** (the subset for supported elements) as the lowest cascade layer on native, and the compiler always emits every layout property explicitly to Taffy, never relying on Taffy's defaults. Chrome is pinned in the test lanes already, so the copy is versioned with it. Scaffolds include one small reset (`box-sizing`, margins, `font-family: system-ui`, `line-height`) that applies to **both** platforms, so the common case never touches the browser defaults at all. A conformance fixture set named "unstyled" (no author CSS) proves this, since it is exactly what developers never test.
- Precedent in reverse: react-native-web makes web behave like native by giving every `View` `display: flex; flex-direction: column; box-sizing: border-box; flex-shrink: 0; min-width: 0; position: relative` (react-native-web `View/index.js`). React Native's own conformance proposal says RN "items flow in columns by default" and plans an opt-in `StrictLayout` to match W3C behaviour. Dragon should do the opposite of react-native-web: make native match the browser, because the browser is Dragon's reference.

**A3. Dark mode, colour-scheme and the native system colours.**
- Surprise: an app styled only in light colours on web turns partly dark on an iPhone in dark mode, with hard-coded dark text on a now-dark background.
- Why here: on web, a page with no `color-scheme` renders light regardless of the system setting. UIKit views follow the system appearance by default, and if Dragon maps default text and background to `UIColor.label` / `systemBackground` (T016 3.1 maps `CanvasText` to `UIColor.label`), anything the author did not colour flips.
- Default: follow the web rule exactly. No `color-scheme` on the root means the native window is forced light (`overrideUserInterfaceStyle = .light`). Only `color-scheme: light dark` (or `dark`) lets the system choose. The default canvas and text colours are the browser's, not UIKit's semantic colours, unless the author writes `Canvas`/`CanvasText`. The web dev overlay gets a light/dark toggle that applies to the browser and simulator together (T016 3.10 already proposes environment toggles).

**A4. Page scrolling: the browser scrolls a tall page, a native root view does not.**
- Surprise: content below the fold is unreachable on the phone, or the keyboard covers the input being typed into.
- Why here: in a browser the viewport scrolls automatically when content is taller than the window. Native layout sizes the root to the screen; scrolling happens only where there is a scroll view. css-support.md covers `overflow: auto/scroll` but not the viewport's own scrolling.
- Default: the document root compiles to a native scroll view whenever the browser would scroll the viewport (root `overflow` visible or auto), and gets keyboard avoidance for the focused input, which matches what iOS Safari does for the same page. An explicit `overflow: hidden` on the root turns it off on both. Conformance fixture: a page taller than the viewport, with an input at the bottom.

**A5. Safe areas: invisible on a desktop browser, clipped content on the phone.**
- Surprise: a header sits under the notch and a tab bar under the home indicator, though it looked fine on web.
- Why here: on a desktop browser `env(safe-area-inset-*)` is 0, so the developer never sees the problem. T018 section 5 leaves "safe-area behaviour under viewport-fit auto" open.
- Default: copy the web meaning. Without `viewport-fit=cover`, the native root is laid out inside the safe area (what iOS Safari does), so a naive page is never clipped. An app opts into edge-to-edge with the same `viewport-fit=cover` it would use on web, and then must use `env()`. The web dev overlay's device frame gives `env()` real inset values, so the edge-to-edge case can be previewed in the browser.

**A6. Hot reload dies because output is generated Swift.**
- Surprise: a colour tweak needs an Xcode rebuild (tens of seconds) and loses app state; developers stop previewing native at all.
- Why here: README step 2 says output is generated Swift that sets properties directly, with no on-device CSS. T016 3.10 and T018 "Dev loop" promise style edits that keep state, but they were written when the device applied a style table at run time. The contract has to be re-derived for generated code.
- Default: in dev, the simulator app includes a **dev-only applier** that reads the plain-data property list (which README says comes from the same compiler result) and applies it live; release builds use only the generated Swift. Two guards stop dev and release from drifting: (1) the simulator lane dumps the applied properties for both paths on every fixture and requires them to be identical; (2) the dev applier is compiled out of release builds, so no release app parses style data. Style edits that change box structure (text coalescing, `display` flipping between inline and a box) rebuild that node, as T018 already says. Markup edits use the host framework's reload.

**A7. The selector rule surprises web developers, and its errors can move between files.**
- Surprise 1: `.list .row` and `:has()` are ordinary web CSS and become errors.
- Surprise 2 (worse): T025's example error fires in `row.tsrx` because `src/routes/inbox.tsrx:9` also uses `.list`. Editing file B breaks file A. Errors that depend on the whole app are hard to understand and make agents edit the wrong file.
- Why here: T025 2.1 and T018 section 1 check ownership "app-wide at build".
- Default: prove ownership **locally** wherever possible. Markless already scopes each `<style>` with a per-module hash class, so a scoped `.list .row` can only match elements rendered by that component. The proof then depends only on the file, apart from projected `{children}`, which the compiler knows statically. Only unscoped/global CSS needs the app-wide check, and its errors name both files. Every selector error comes with a one-click fix in the editor ("forward a class", "move state onto the element as `data-*`"), and the fix is the same text as the `fix:` line, so people and agents get the same help. Dynamic class strings that defeat tracing (`class={props.variant}` typed as `string`) get their own error suggesting a finite string union type.

### Tier B: breaks the promise for many apps

**B1. Text differs even when every rule is supported.**
- Surprise: a label wraps on the phone and not on web, or a card is 3px taller.
- Why here: css-support.md marks `line-height: normal`, font fallback and wrapping as native metrics. `system-ui` is SF on a Mac browser but Segoe UI on Windows and Roboto on Android Chrome, so a developer on a Windows laptop previews the wrong font for iOS.
- Default: the editor shows an info hint on `line-height: normal` and on `system-ui` without a bundled fallback; the scaffold reset sets a numeric `line-height`. The web dev overlay's "native preview" mode (see D1) uses the target's font files when available. The parity overlay (C-level default in section 2) uses browser text measurement for text nodes so real CSS mapping bugs are not hidden by font noise, and shows font-caused differences separately.

**B2. The `rem` base.**
- Surprise: every `rem`-sized layout is about 6% bigger on iPhone at the default text size.
- Why here: the research disagrees with itself: T016 3.5 proposes a 17pt root, T018 3.4 a 16pt root. 17pt would make every `rem` differ from the browser before the user changes anything.
- Default: 16pt at the default iOS text size (equal to the browser), scaled by the `UIFontMetrics` ratio when the user changes text size. The web dev overlay's text-size toggle scales the browser's root font size by the same ratios, so large-text layouts can be checked on web. The text-size policy is still an owner decision (css-support.md open questions).

**B3. Right-to-left flips on native but not on web.**
- Surprise: in an Arabic or Hebrew locale, native layout mirrors itself; on web the same page stays left-to-right.
- Why here: UIKit flips layout from the device language (semantic content attribute); the browser uses only the `dir` attribute.
- Default: native direction follows the authored `dir` / `direction`, as on web: Dragon forces left-to-right unless the document or an element says otherwise. A preview toggle sets `dir="rtl"` on both platforms. Apps that want locale-driven direction write it once in the document component (`dir={locale.dir}`), which then works on both.

**B4. Headless component libraries and third-party CSS.**
- Surprise: `@markless/ui` popover works on web; the native build fails, and the errors point into library CSS the developer did not write and cannot fix.
- Why here: overlays and `position: fixed` wait for the second release (T018 3.7); the nested-menu rule needs a library change (T025 section 3). Any other web CSS library brings selectors the rule rejects.
- Default: a library's CSS is checked when the library is **published**, and the result (native-ready per target and profile version, or the list of failing families) ships with the package. The consumer sees one error per unsupported family used ("`popover` is not available on ios in dragon 1.0.0-alpha.3; it arrives with overlay support; use `@if (target.os === 'web')` or remove it"), attributed to the usage in their own file, not N errors inside `node_modules`. The docs mark each family per target from the same data.

**B5. `@supports` and `@media (os:)` used to make errors go away.**
- Surprise: an agent wraps `:has()` in `@supports selector(:has(a))`; the error disappears; native quietly lacks the feature. Same with a native-only escape in reverse.
- Why here: T018 section 4 removes false `@supports` branches before checking, which is a sanctioned silent drop.
- Default: allowed, because it is the web's own mechanism, but never silent: (1) a guarded block that changes layout or visibility with no alternative branch for that target is an info diagnostic; (2) `dragon escapes` (and a section of the build summary) lists every `@supports`, `@media (os:)`, `@if (target.os …)` and inline native escape with file and line, so escapes are explicit and searchable; (3) agent guidance says a guard must include the other platform's alternative. No comment-based suppression exists (T030 already requires native errors to be unsuppressible).

**B6. Support-profile updates break builds, or change results silently.**
- Surprise: `pnpm up` moves Dragon from alpha.3 to alpha.4; a row was demoted after a failing test, and CI goes red with no code change. Or a caveat changes and output shifts by a pixel.
- Why here: profiles are data consumed by compiler, editor and docs (T030 3.4) and fail closed; demotion is expected, because "no claim without a test" means a newly failing test removes a claim.
- Default: the profile version is part of the package version (lockfile-pinned), and every profile change has a changelog entry generated from the data diff. Promotions (new support) ship in any release. Demotions ship first as a warning that names the version in which they become errors, unless the demotion fixes wrong output; Vite does something similar for browser targets: its default `baseline-widely-available` target is "updated on each major" (Vite 7 announcement). `dragon upgrade --check` compiles the app against the new profile before the version bump and prints what would change. The app's minimum iOS version selects the profile rows (some rows depend on OS version), so raising the deployment target is also a checked change.

**B7. Performance cliffs from generated code.**
- Surprise: a list with shadows and rounded clipping scrolls smoothly in Chrome and stutters on an older iPhone.
- Why here: `box-shadow` without a shadow path, corner radius with clipping, group opacity and blur force offscreen rendering on iOS; web developers never see this cost. Rendering 1,000 `@for` items creates 1,000 views and layout nodes.
- Default: the compiler always emits the cheap native form: `shadowPath` from the computed box, a wrapper view instead of clipping a shadowed layer (css-support.md already plans the wrapper), and rasterization hints only when proven equivalent. Anything still expensive (large blur, many overlapping group-opacity layers, a long list without virtualization) gets an info diagnostic with the measured reason. The simulator lane records frame times for a small set of performance fixtures, so a regression is caught in Dragon's CI, not in the app.

### Tier C: breaks the promise for some apps, or adds friction

**C1. Generated-code size and Swift compile time.**
- Surprise: the app binary grows, and clean builds slow down as components are added; Swift's type checker is slow on very long expressions.
- Why here: one generated setter block per element per reachable state; state combinations multiply.
- Default: generate plain statement lists (no long chained expressions), one file per component, shared helpers for identical property sets, and deduplicate identical state tables. The build summary reports generated bytes and Swift compile time per component; Dragon's CI has a budget for its fixture app. Label figures as downloaded bytes versus code executed at launch.

**C2. Fonts are not the same asset on both platforms.**
- Surprise: a custom font works on web and falls back to the system font on iOS, because the CSS family name does not match the font's internal name, or the file was never added to the app bundle.
- Default: `@font-face` `src` files are build assets. Dragon reads each file's name table, bundles the **same file** for web and native, registers it at launch under the CSS family name, and fails the build if a referenced file is missing or remote-only for native. Web gets `font-display: block` in dev previews of native mode so the fallback-font flash does not hide a metrics difference.

**C3. Images are not the same asset on both platforms.**
- Surprise: a background image loads on web and is missing on native, is blurry at 3x density, or content jumps when it loads.
- Default: `url()` and `<img src>` for local files become assets with the same logical name everywhere; the compiler knows each image's intrinsic size, so it reserves the box on both platforms before loading (the missing-`width`/`height` layout shift fixed by default); density variants are generated from one source image. SVG paint stays an error until an SVG plan exists (css-support.md). Remote images load asynchronously on both, with the same reserved box when the author gives a size or `aspect-ratio`.

**C4. Tokens and theming live only on the document root.**
- Surprise: `:root { --gap: 8px }` inside a component is a normal web habit; it is a native error (`ROOT_OUTSIDE_DOCUMENT`).
- Default: the scaffold creates the document component with a token block and the light/dark setup already written (T025 2.2's example); the error's quick fix moves the declaration to the document component or rewrites it onto the component's own class, whichever the error text suggests. Colours used on borders and shadows re-resolve on appearance change (T018 3.4), so a token-based theme needs no author work.

**C5. Hover, focus and touch.**
- Surprise: a control revealed only on `:hover` is unreachable on iPhone; focus rings look different.
- Default: `:hover` applies on native only with a real pointer (css-support.md already says so). A rule where `:hover` is the only way to make something visible or tappable (changes `display`, `visibility`, `opacity` from 0, or `pointer-events`) gets a warning on touch targets: "on ios this can never be shown; add `:focus-within` or make it visible under `@media (hover: none)`". The web overlay's native preview mode emulates `hover: none` and `pointer: coarse`.

**C6. `z-index` used to escape a container.**
- Surprise: a dropdown with `z-index: 999` sits on top on web and is hidden behind a sibling subtree on native.
- Default: `z-index` orders siblings only (css-support.md); a `z-index` that would need to escape its ancestor's stacking context is an error that points to the overlay families. On web this is often a bug anyway.

**C7. Unstyled form controls.**
- Surprise: a plain `<button>` or `<input>` looks like the browser's control on web and like something else on native.
- Why here: browser controls with `appearance: auto` draw native-looking chrome that no CSS describes; there is nothing to compare against.
- Default: the scaffold reset sets `appearance: none` on controls for both platforms, so both start from author CSS. An unstyled control with `appearance: auto` on a native target is a warning naming the difference. Which HTML elements exist on native at all is its own fail-closed list (an element profile), in the same profile file.

**C8. Developing on the simulator first (the reverse direction).**
- Surprises: native-only conveniences hide web problems. `-apple-system-*` fonts, SF metrics and `@media (os: ios)` blocks look right on iPhone; web falls back to other fonts and wraps differently. Native keyboard avoidance and safe-area handling (A4, A5) hide web layout problems on a phone browser. No hover or keyboard focus is ever exercised, so the web's keyboard and mouse states go untested.
- Default: `dev` always serves web too, and the web overlay shows the same diagnostics. `@media (os: ios)` blocks with no web counterpart get the same "guard without alternative" info as B5. The parity check (section 2) runs in both directions, so a simulator-first developer sees "web would lay this out differently" in the terminal. Web keyboard focus and hover are covered by the interaction scripts in Dragon's own lanes, and by an optional app-level check.

**C9. Fail-closed early releases produce a wall of errors.**
- Surprise: in alpha, the profile has few proven rows, so real CSS mostly fails, and developers conclude the tool does not work.
- Why here: the draft profile has `"productionUsable": false` and every entry operationally `unsupported` until a test passes; this is correct but harsh.
- Default: group errors by feature ("`display: grid` (14 places) is not proven on ios yet; planned for alpha.N") instead of 200 separate lines, and show a per-target readiness count in the dev overlay ("ios: 187 of 214 rules ready"). Never turn the errors into warnings to soften this.

**C10. Different answers for the same question in different places.**
- Surprise: docs say supported, editor says unsupported, or the hover and the build error disagree.
- Why here: Lynx has an open issue where stylesheet and inline style support disagree (T030 section 2).
- Default: already designed (one profile drives compiler, editor, docs, guidance and tests; T030 3.4). Add a drift test: the docs table, editor data and agent guidance are regenerated in CI and must match the committed files. Inline `style={{…}}` goes through the same checker as `<style>`.

## 2. The defaults that carry the most weight

The ranked list reduces to five mechanisms. If the design adopts only these, most entries above are handled.

1. **Configured targets are always checked** (A1, B4, B5, C4, C8). Config, not command flags. The editor, web overlay, `typecheck` and CI all show every configured target's errors; only the web build ignores native errors, and only in the browser.
2. **Native reproduces what the browser does when the author wrote nothing** (A2, A3, A4, A5, B2, B3, C7). A pinned copy of Chrome's built-in stylesheet as the lowest layer, explicit values to Taffy, and the web meaning of `color-scheme`, viewport scrolling, `viewport-fit`, `dir` and 16px `rem`. Each gets an "unstyled" conformance fixture.
3. **A live parity check on the web preview** (A2, B1, C8). Dragon's Linux lane already feeds the compiled property list into Taffy and compares it with Chrome's boxes. Run the same thing in the dev server (Taffy as WebAssembly, which testing-plan.md already picks for the test runner) on the page the developer is looking at, using the browser's text measurements, and outline any box where native layout would differ by more than one device pixel. This is the main way a web-only developer knows native is fine without opening a simulator.
4. **A native preview mode for the web** (B1, C5, C8, A5). Toggle in the dev overlay: emulate `hover: none`/`pointer: coarse`, safe-area insets and a device frame, the target's text size, target fonts where available, and dark mode. Everything native would reject is already an error, so this mode needs no second renderer. Unlike Expo DOM components (which run web code inside a native web view and are "less optimal than native views", Expo docs), it previews native behaviour with the web build rather than shipping web to native.
5. **Dev fast path proven equal to release** (A6). A dev-only applier of the plain-data property list, compiled out of release, with the simulator lane requiring identical applied properties from both paths.

Pseudocode for the first three:

```ts
// dev server, on every compile
for (const target of config.targets) {             // from dragon config, never from CLI flags
  const diags = check(component, profileFor(target, config.minOs[target]));
  overlay.show(diags);                             // web page still renders
  editor.publish(diags);
}
typecheck.failIf(diags.some(d => d.severity === 'error'));

// compile for native: start from the browser's defaults, not Taffy's
const cascade = [chromeUaSheet(pinnedChromeVersion), ...layersFromAuthor];
const style = computeStyle(element, cascade);
taffy.setStyle(node, explicit(style));             // every layout field written, Taffy defaults never used
view.colorScheme = style.root.colorScheme ?? 'light';   // no color-scheme => light, as on web
root.isScrollView = viewportWouldScroll(style.root);    // browser scrolls tall pages
root.contentInsets = viewportFit === 'cover' ? 'none' : 'safe-area';
view.direction = style.direction;                  // from dir/direction, not device locale

// dev overlay parity check, per page
const chromeBoxes = captureBoxes(document);
const taffyBoxes = taffyWasm.layout(propertyList(page), measureTextWith: browserTextMetrics);
overlay.outline(diffBoxes(chromeBoxes, taffyBoxes, { tolerance: 1 /* device px */ }));
```

## 3. Precedent for "strict on web mirrors native"

| System | What it does | Lesson |
|---|---|---|
| React Strict DOM | Components are "a strict subset of the HTML components found in React DOM". On native, unsupported props and styles are **runtime** warnings (`[warn] React Strict DOM: unsupported style value in "display:inline-flex"`); docs show how to silence them with `LogBox.ignoreLogs` "as a last resort". Web supports everything in its compatibility table; native marks many items as not supported. | The strict subset is enforced on the element set, not on web styles; style problems surface only when running native, and can be silenced. Dragon's build-time, unsuppressible errors shown on web (A1) close exactly that gap. |
| react-native-web | Gives every web `View` React Native's defaults (`display: flex`, column, border-box, `flex-shrink: 0`, `min-width: 0`, `position: relative`). | Proof that making one platform's defaults match the other's is a normal, workable default; Dragon should apply it in the browser-to-native direction (A2). |
| React Native layout conformance proposal | Documents that Yoga differs from browsers in algorithm, defaults (column direction) and capabilities; proposes an opt-in `<unstable_StrictLayout>` and warnings for non-conformant layout. | Opt-in strictness leaves the existing surprises in place. Dragon starts strict, so it never needs an opt-in. |
| Expo DOM components | `'use dom'` runs web components in a web view inside the native app; Expo says they are "less optimal than native views" and recommends "truly native views whenever possible". | "Same on both" by shipping the browser costs performance and native feel. Dragon's web-side native preview (section 2 item 4) gets the preview benefit without shipping a web view. |
| Flutter web | Draws its own pixels on both, so fidelity is high, but earlier HTML-renderer text layout differed and a maintainer-thread commenter was "surprised that there isn't a test (goldens?) that enforces" web/mobile sameness. | Even a single-renderer design drifts without a test that compares platforms. Dragon's number-based Chrome comparison is the missing test; the parity overlay brings it into the dev loop. |
| NativeWind / react-native-css | Dropped unsupported declarations silently; an open PR adds a build summary because the compiler "knew and said so into a void" (T030 section 2). | Confirms "never silent" is the top requirement; a log summary is weaker than a failing check. |
| Vite build target | Default `baseline-widely-available`; "the set of browsers will be updated on each major". | Support data that moves only on a known schedule keeps upgrades predictable (B6). |

## 4. Inconsistencies found in the design documents

These affect the defaults above and should be fixed when the design is next revised:

- **`rem` base:** T016 3.5 says 17pt; T018 3.4 says 16pt. 16 matches the browser (B2).
- **When native errors show:** T016 3.8 says "only for targets named in the build or dev command"; T025 says configured targets. Configured is required for A1.
- **Style application model:** T016 3.10 and T018 "Dev loop" assume a runtime style table on the device; README and AGENTS.md now say generated Swift with no on-device CSS. The hot-reload contract needs rewriting (A6).
- **Grid on iOS:** T016 3.8's sample error says `display: grid` is unsupported on iOS (a Yoga-era assumption); css-support.md marks grid exact under Taffy.
- **Theme example:** T016 3.2 still uses `<select>` and `color-scheme` on a non-root `div`; T025 replaced it with buttons on the root.
- **Default display and UA styles:** only `box-sizing` is called out as "emit the CSS default"; `display`, margins, fonts and colours from the browser's built-in stylesheet are not specified (A2).

## 5. Owner decisions this raises

I recommend adopting all five defaults in section 2; three points need a choice.

**Fail the type check for any configured target:** yes, because an agent or developer who only runs the web app must still be stopped by the command they already run.

**Copy the browser's built-in styles onto native:** yes, including the body's 8px margin and serif default font, because parity is the product; scaffolds hide them with a reset that applies to both platforms.

**Profile demotions:** warn for one release before erroring, except when the old output was wrong, because a green app should not turn red on a routine update without notice.

## Sources (accessed 2026-09-26)

- Taffy `Style::DEFAULT` and `Display::DEFAULT`: https://github.com/DioxusLabs/taffy/blob/main/src/style/mod.rs
- react-native-web View base styles: https://github.com/necolas/react-native-web/blob/master/packages/react-native-web/src/exports/View/index.js
- React Strict DOM, components and warnings: https://facebook.github.io/react-strict-dom/learn/components/ ; CSS API compatibility: https://react.github.io/react-strict-dom/api/css/
- React Native layout conformance proposal: https://github.com/NickGerleman/discussions-and-proposals/blob/patch-2/proposals/0540-vision-for-layout-conformance-parity.md
- Expo DOM components: https://docs.expo.dev/guides/dom-components/
- Flutter web text-layout issue: https://github.com/flutter/flutter/issues/89919 (via search summary; not opened directly)
- Vite 7 default build target: https://vite.dev/blog/announcing-vite7
- NativeWind/react-native-css silent drops: cited in docs/research/T030-agent-guardrails.md section 2

```json
{
  "goalbuddy_receipt_v1": {
    "result": "done",
    "task_id": "T007",
    "board_path": "docs/goals/milestone-1/state.yaml",
    "decision": null,
    "full_outcome_complete": false,
    "rationale": "24 Dragon-specific pitfalls ranked in three tiers, each with the surprise, the design cause and a default that removes it. Top risks: native errors seen too late (fix: configured targets checked everywhere), unauthored defaults differing (Taffy defaults to flex/border-box; UIKit follows system dark mode, flips RTL by locale, has no viewport scrolling or safe-area inset by default; fix: pinned Chrome UA sheet plus web meanings), and hot reload versus generated Swift (fix: dev-only data applier proven equal to generated Swift). Five mechanisms cover most entries; a live in-browser Taffy parity overlay is the main way a web-only developer knows native is fine. Six inconsistencies in the research docs found.",
    "worker_package": null,
    "evidence": [
      "docs/goals/milestone-1/notes/T007-dragon-dx-pitfalls.md",
      "docs/research/T025-styling-direction.md 2.1, 2.3",
      "docs/research/T018-styling-design.md 1, 3.4, 3.7, 4",
      "docs/research/T016-styling-dx.md 3.1-3.10",
      "docs/research/T030-agent-guardrails.md 1, 2, 3.4",
      "docs/research/css-support.md tables and open questions",
      "docs/research/testing-plan.md layers 0-3",
      "taffy src/style/mod.rs main: Display::DEFAULT = Flex, box_sizing BorderBox, flex_shrink 1 (curl, 2026-09-26)",
      "react-native-web View view$raw styles (curl, 2026-09-26)",
      "RSD, Expo DOM, RN conformance proposal, Vite 7 pages fetched 2026-09-26"
    ],
    "subgoal_contract": null,
    "parallel_safety": null,
    "blocked_tasks": [],
    "missing_evidence": [
      "No measurement of Swift compile time or binary size per generated component",
      "Taffy-as-WebAssembly speed inside a dev server page not measured",
      "Chrome UA stylesheet subset for supported elements not extracted",
      "Flutter issue 89919 read via search summary only",
      "RSD web-side enforcement read from docs summaries; source not inspected"
    ],
    "required_board_updates": [
      "Record T007 done with evidence notes/T007-dragon-dx-pitfalls.md",
      "T008 inputs: include section 4 inconsistencies and section 5 owner decisions",
      "Consider a fixture group 'unstyled' (no author CSS) for the first Worker slice, since A2 is a layout-default issue the Linux Taffy lane can prove in milestone 1"
    ]
  }
}
```
