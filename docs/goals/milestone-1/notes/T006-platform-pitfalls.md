# T006: Real-world cross-platform styling pitfalls

Scout note, read-only research, 2026-09-26. Owner goal: "people focus on one platform and it just works on the other."

## How to read this

- **Evidence levels.** `[gh]` = issue state, comment count and reaction count pulled with `gh api` on 2026-09-26 (verified numbers). `[read]` = source read through a web search or fetch summary on 2026-09-26; the claim matches the summary but I did not open every page in full. `[unverified]` = my own knowledge or a single secondary source; treat as a lead, not a fact.
- **How often it bites.** GitHub reaction counts badly undercount pain: most people find a Stack Overflow answer and never click the thumbs up. So I use three signals together: reactions/comments on the canonical issue, how many separate issues exist for the same symptom, and whether the bug keeps coming back in new versions. Title-keyword counts in `react/react-native` (all states, `gh api search/issues`, 2026-09-26) give a rough scale: KeyboardAvoidingView 111, shadow 107, borderRadius 104, RTL 93, overflow 86, lineHeight 63, zIndex 56, numberOfLines 41, "Text cut off" 31, fontFamily 30, percentage 27, dashed 22, dark mode 19, letterSpacing 12. These are noisy (titles only, include fixed issues), but they rank consistently with the qualitative evidence.
- All URLs accessed 2026-09-26. `facebook/react-native` links now redirect to `react/react-native`.

## Summary: the ten that hurt most

1. **Text vertical metrics and clipping** (line height model, descenders cut on Android, font padding).
2. **Keyboard avoidance** (the single largest issue cluster; different per platform by design).
3. **Shadows** (iOS shadow vs Android elevation; iOS shadow killed by `overflow: hidden`; offscreen-render cost).
4. **Layout defaults that differ from CSS** (column direction, `flex-shrink: 0`, no `min-width: auto`, `flex` shorthand, box-sizing, position static).
5. **Border radius, clipping and per-side borders on Android.**
6. **Custom fonts: names differ per platform, and `font-weight` silently falls back on Android.**
7. **Safe areas, notches and Android 15/16 edge-to-edge enforcement.**
8. **z-index vs Android elevation** (paint order and hit testing disagree).
9. **Text scaling (Dynamic Type / Android font scale) breaking fixed-size layouts.**
10. **Dev works, release breaks** (styles dropped by a production bundle, splash/dark-mode flashes, device-only rounding).

The pattern behind nearly all of them: the tool accepted a style, then the platform did something different at runtime, and nobody found out until a device showed it. The tools that hurt least either (a) move web defaults onto native explicitly (React Strict DOM, NativeWind docs, Tamagui 2), (b) warn at runtime (React Strict DOM), or (c) route to a platform mechanism instead of emulating (Expo's font plugin, `react-native-safe-area-context`, `react-native-keyboard-controller`). None of them prove the result against the browser.

## Ranked pitfalls

Each entry: what breaks and where, how often, root cause, how better tools prevent it, and the lever Dragon has (for T007/T008; not a design decision).

### 1. Text line height, descender clipping and font padding

- **What breaks.** Android cuts off descenders (g, p, y) when `lineHeight` is set, especially when it equals `fontSize`; iOS centres differently and can clip ascenders/diacritics. Nested text with different line heights crops on Android. Padding does not compensate. Mostly Android; iOS differs in placement.
- **How often.** Recurring for nine years and still regressing. RN #13126 (2017, 17 reactions) [gh]; #17064 (2017, 9 reactions) [gh]; #30794 nested text (2021) [read]; #49886 regression in 0.78 New Architecture (2025, 15 comments) [gh]; #53344 reproduced on 0.81 and Android 15 (2025) [gh]. "lineHeight" 63 titles, "Text cut off" 31 titles. OEM system fonts (OnePlus Slate, Oppo, LG) cause the same truncation because text is measured with one font and drawn with another [read: reactnativeschool.com].
- **Root cause.** Different line-box models. CSS centres the glyph box in the line box ("half-leading"); Android's `StaticLayout` puts the extra space relative to the baseline and adds `includeFontPadding` from the font's ascent/descent; iOS puts the line origin at cap height. A line height smaller than the font's natural ascent+descent means something must be clipped, and each platform clips a different side [read: RN #13126 discussion]. The fix `react-native-capsize` is archived [read].
- **How better tools prevent it.** No mainstream tool fully solves it. Workarounds are per-platform padding, `includeFontPadding: false`, `textBreakStrategy="simple"`, editing font metrics, or always setting line height ≥ 1.2× font size [read]. Explicitly setting a bundled `fontFamily` avoids the OEM-font variant [read].
- **Dragon lever.** Compile CSS half-leading into the native line-height setup on both platforms (iOS paragraph style with baseline offset; Android `LineHeightSpan` that distributes space above and below like CSS), bundle fonts by default, and add fixtures with `line-height` < natural height and descender-heavy strings compared against Chrome. This is the pitfall where "proven against Chrome" matters most.

### 2. Keyboard avoidance

- **What breaks.** Content hidden under the keyboard, double adjustment on Android (window `adjustResize` plus JS avoidance), absolute elements permanently moved after the keyboard closes, `ScrollView` inside `KeyboardAvoidingView` not working on Android, headers causing overshoot. Behaviour differs by platform by design (`behavior="padding"` vs `"height"`) [read: reactnative.dev/docs/keyboardavoidingview].
- **How often.** The largest cluster found: 111 RN issue titles mention KeyboardAvoidingView. #28697 absolute elements misplaced (20 comments) [gh]; #23826 ScrollView inside KAV on Android [gh]. Android 15 edge-to-edge made `adjustResize` unreliable again [read: 72technologies.com]. On web, `dvh/svh/vh` ignore the on-screen keyboard entirely; you need `visualViewport` [read: dev.to/rl0425]. Capacitor's keyboard plugin has four resize modes, and switching modes while open leaves a black box [read: capacitor-plugins #2216].
- **Root cause.** The keyboard is an overlay on iOS, a window resize on Android (depending on `windowSoftInputMode` and edge-to-edge), and an overlay that does not change viewport units on the web. No CSS primitive describes it, so every tool bolts on a component.
- **How better tools prevent it.** `react-native-keyboard-controller` (one inset model, `KeyboardAwareScrollView`, `KeyboardStickyView`) is the current community fix [unverified: widely recommended, not measured here]. On web, `interactive-widget=resizes-content` in the viewport meta and the `keyboard-inset-*` env variables of the VirtualKeyboard API are emerging [unverified].
- **Dragon lever.** Treat the keyboard as a safe-area-like inset (`env(keyboard-inset-height)` or equivalent) mapped to the platform's keyboard layout guide/IME insets, never to window resizing. Scroll-to-focused-input is behaviour, not styling; flag as a runtime responsibility outside the style compiler.

### 3. Shadows

- **What breaks.**
  - iOS: `overflow: hidden` removes the shadow, because a layer's shadow is clipped with its bounds; Android elevation survives [gh: RN #33380]. Fix is a wrapper view carrying the shadow.
  - Android (pre-0.76): only `elevation`, a single Material-style shadow with no colour/offset/blur control and much weaker than iOS; needs a background colour [read: logrocket].
  - iOS performance: shadow without an explicit path forces an offscreen pass per frame. RN's warning "has a shadow set but cannot calculate shadow efficiently" fires on transparent backgrounds [gh: RN #27546; read: RN commit e4c53c2]. FPS drops during animation still reported on 0.76.6 [gh: #49128, 13 comments].
  - Android: elevated child under a parent with `opacity < 1` draws banded shadows; a feature-flagged fix is in progress [read: RN PR #58493].
  - RN 0.76 added web-like `boxShadow`, but outset needs Android 9 (API 28) and inset Android 10 (API 29) [read: RN 0.76 blog / react.doctor].
- **How often.** 107 "shadow" titles in RN; every component library (react-native-paper #3593, #3723) hit the efficiency warning [read].
- **Root cause.** CSS `box-shadow` paints outside the border box and is unaffected by the element's own `overflow`; UIKit ties shadow and clipping to one layer; Android shadows come from the elevation/outline system, not from a blur.
- **How better tools prevent it.** RN 0.76 `boxShadow` plus Tamagui 2 steering everyone to one `boxShadow` prop [read: tamagui.dev]; auto `shadowPath` for opaque backgrounds [read]. Nobody auto-inserts the wrapper for `overflow: hidden` + shadow.
- **Dragon lever.** Because CSS semantics are known at build time, the compiler can split "shadow" and "clip" onto two layers (a shadow host plus a clipping content layer) whenever both are present, and always set `shadowPath` from the border-radius geometry. Android below API 28 needs a declared floor or a build error.

### 4. Layout defaults that differ from CSS

- **What breaks.** Web-authored layouts collapse or overflow on native and vice versa: rows become columns; long text in a row overflows instead of shrinking (Yoga `flexShrink: 0`); the reverse on web, where a text child refuses to shrink because of CSS `min-width: auto`; `flex: 1` means something different; `alignContent` differs; `box-sizing` is `border-box` on RN and Lynx, `content-box` on the web; `position` default is `relative` on RN, `static` on the web.
- **How often.** Documented as the first "quirk" by NativeWind [read: nativewind.dev/docs/core-concepts/quirks]; Yoga #1409 "does not respect automatic minimum size" still open (12 comments) [gh]; RNW #1604 `flex: 0` differs on web [read]. Lynx goes further: default `display` is `linear`, no inheritance, no margin collapsing, `min-content` treated as 0, `box-sizing: border-box` [read: lynxjs.org]. Tamagui 2 changed its default flex/position styles to track RN, which itself shifts layouts on upgrade [read: tamagui.dev/blog/version-two]. Yoga 3 keeps legacy bugs behind "errata" that React Native enables by default (for example percentage sizes of absolute children ignore padding, RN #46392) [read: yogalayout.dev blog; gh-linked].
- **Root cause.** Yoga began as "everything is `display: flex; flex-direction: column; flex-shrink: 0; min-width: 0; position: relative; box-sizing: border-box`" [read: css-layout README], and compatibility keeps those defaults.
- **How better tools prevent it.** React Strict DOM injects web defaults on native: `boxSizing: 'content-box'`, `position: 'static'`, and for `display: flex` sets `flexDirection: 'row'`, `flexShrink: 1`, `flexBasis: 'auto'`, `alignContent: 'stretch'`; it emulates `display: block` as a non-shrinking column [gh: react-strict-dom `src/native/html.js`, `modules/createStrictDOMComponent.js` lines 103-119]. NativeWind tells you to always set direction. This is the clearest case of a tool making "write for the web, it works on native" true, at a runtime cost.
- **Dragon lever.** Dragon's plan already says "explicit CSS defaults" with Taffy. Taffy implements `min-width: auto`, block layout and `box-sizing`; the lever is to pass every CSS initial value explicitly (never rely on Taffy's own defaults) and prove each default with a fixture. Percentages against indefinite containers (inside scroll views, RN #24146) need fixtures too.

### 5. Border radius, clipping and per-side borders (Android)

- **What breaks.** Children bleed past rounded corners unless `overflow: hidden` is set, and on Android sometimes even then (needs a transparent border to create a clip path); FlatList ignores rounded clipping (#44671, fixed); clipping flickers after re-render (#20278). Per-side border colours with `borderRadius` render wrong on Android, regressing again in 0.72 and 0.76 (#12403, #16708, #37753, #47905); semi-transparent borders overlap at corners (#49606). Dashed/dotted on one side is broken on both platforms (#24224) and still wrong on iOS in 2025 (#51658).
- **How often.** RN #3198 "overflow:hidden is not supported on Android" 59 comments [gh]; #12403 24 comments [gh]; #24224 dashed single side 62 comments, 58 reactions, the highest reaction count found in this sweep [gh]. 104 "borderRadius" titles, 22 "dashed" titles.
- **Root cause.** Android views draw borders and backgrounds through a custom drawable; clipping to a rounded path needs an outline provider or a canvas clip, and each renderer rewrite (Fabric, 0.76 background drawable) reintroduces edge cases. CSS draws each side as its own trapezoid with corner joins; native APIs model one colour and one style per layer.
- **How better tools prevent it.** None systematically; the fix is "upgrade RN" or draw borders with extra views or SVG.
- **Dragon lever.** Dragon already rejects dashed borders in release one. For per-side colours with radius, either generate the CSS border geometry as a path (CAShapeLayer / Android `Path`) or make it a build error until a fixture passes. Always emit clip-to-rounded-rect when `overflow: hidden` and `border-radius` are both set; never rely on the platform default.

### 6. Custom fonts: family names and weights

- **What breaks.** A font works on Android and silently falls back to the system font on iOS, or the reverse, because Android uses the file name and iOS the PostScript/family name inside the file [read: docs.expo.dev/develop/user-interface/fonts; infinum handbook]. `fontWeight: '700'` with a custom family falls back to the system font on Android; numeric weights on system fonts only distinguish 400/700 below API 28 [gh: RN #26193, 40 comments; #42116 still open]. Variable-font weights need Android 10+ [read]. WOFF/WOFF2 unreliable on Android native [read].
- **How often.** Very common first-week bug; NativeWind's custom-font guide warns it "silently fails to load on iOS while appearing to work on Android" [read: nativewind.dev/docs/guides/custom-fonts]. 30 "fontFamily" titles, plus expo/expo #9149 and many library issues (ui-kitten #1501, RevenueCat) [read].
- **Root cause.** CSS `@font-face` maps (family, weight, style) to a file; native platforms register files, not families, and Android's family grouping needs an XML font family registered in native code.
- **How better tools prevent it.** Expo's config plugin embeds fonts at build time and, with object syntax, lets you name the family; `fontDefinitions` gives Android a weight table [read]. `react-native-font-demo` shows the XML-family approach [read].
- **Dragon lever.** `@font-face` rules are exactly the data a build step needs: compile them into an iOS family table (resolved to PostScript names at build time by reading the font file) and an Android XML font family. A weight or style with no file is a build error naming the missing face, not a runtime fallback.

### 7. Safe areas, notches and edge-to-edge

- **What breaks.** Content under the status bar, camera cutout or gesture bar. On web, `env(safe-area-inset-*)` is 0 unless `viewport-fit=cover`, and WebKit sets it slightly late [read]. Android WebView below Chromium 140 returned wrong insets; Capacitor 8.5.2 injected insets twice (#8623) [read]. Android 15 enforces edge-to-edge for apps targeting SDK 35; Android 16 removes the opt-out; insets returned 0 in `react-native-safe-area-context` for some users (#633, RN discussion #827) [read]. RN's built-in `SafeAreaView` is iOS-only and "not adequate" per React Navigation [read].
- **How often.** Forced on every Android app by the Play Store target-SDK deadline (Aug 2025) [read]. Many blog posts titled "Android 15 broke my layout" [read].
- **Root cause.** Three different inset sources (UIKit safe-area layout guide, Android `WindowInsets`, CSS env) with different timing and different defaults, plus double padding when two layers both apply them.
- **How better tools prevent it.** `useSafeAreaInsets` hook, `edgeToEdgeEnabled` in RN, Capacitor SystemBars plugin with `--safe-area-inset-*` fallbacks [read].
- **Dragon lever.** Dragon already maps `env(safe-area-inset-*)` to platform insets. Pitfalls to design against: timing (insets can change after first layout, rotation, keyboard), double application (a parent and child both padding), and Android edge-to-edge being always on. Make the web target emit `viewport-fit=cover` automatically when `env(safe-area-inset-*)` is used.

### 8. z-index vs elevation (paint order and hit testing)

- **What breaks.** On Android, `zIndex` is ignored or order is reversed, elevation wins over z-index, and touches reach the view behind while the front one draws on top [gh: RN #35565, #32196; read: react-native-paper #2635]. Earlier regressions ignored zIndex for conditionally rendered views (0.45-0.48) [read].
- **How often.** 56 "zIndex" titles in RN. Low reactions per issue (6 on #35565), but perennial.
- **Root cause.** Android draws children by elevation (a real z in the render node tree), then by drawing order; RN emulates `zIndex` by reordering children. When elevation is also set (for shadow), the two orderings disagree, and touch dispatch follows a third order.
- **How better tools prevent it.** Workarounds only: render overlays last, portal to root, give the overlay higher elevation.
- **Dragon lever.** CSS stacking contexts are computable at build time for static trees. Emit one ordering (child order plus `translationZ`/`layer.zPosition`) and make hit testing follow draw order. If shadows use elevation on Android, the compiler must include elevation in the stacking computation or draw shadows without elevation.

### 9. Text scaling (Dynamic Type, Android font scale)

- **What breaks.** Fixed heights, toolbars and rows overflow or clip at large accessibility sizes. RN: `maxFontSizeMultiplier` ignored under Fabric (#35658) [gh]; `Text.defaultProps` global cap no longer works [read]; `letterSpacing` does not scale [read: react-native-text-size]. Flutter: `RenderFlex overflowed` at 3.0× scale; Android 14 changed to nonlinear scaling up to 200%, so the same layout overflows on one platform and not the other [read: docs.flutter.dev breaking-changes]. Flutter #12311: fixed-size widgets ignore text scale [read].
- **How often.** Mostly found late (QA or user reports); a recent audit found six overflows at 3× in one form [read: EASA-Digital-Logbook #135].
- **Root cause.** Web developers write `px` font sizes and fixed heights; browsers rarely scale page text by OS setting, so web testing never exercises it. Native scaling is on by default and nonlinear on Android 14+.
- **How better tools prevent it.** Flutter `MediaQuery.withClampedTextScaling`; RN `maxFontSizeMultiplier`. Neither prevents fixed-height containers.
- **Dragon lever.** Dragon maps `rem` to `UIFontMetrics`. Pitfalls: `px` font sizes (scale or not?), `letter-spacing` and `line-height` in `px` next to scaled text, fixed `height` on text containers. Candidate default: lint/warn when a text-containing box has a fixed block size, and run fixtures at 1×, 2× and 3× scale. Android 14 nonlinear scaling cannot be a simple multiplier.

### 10. Dev works, release (or device) breaks

- **What breaks.** NativeWind styles missing only with `--no-dev --minify` or EAS production builds (nativewind #1416, #1481; eas-cli #2429) [read]; class names built at runtime purged; case-sensitive paths break on Linux CI [read]. Splash screen shows light background in dark mode on Android without a `dark` config and `expo-system-ui` (expo #33842, #13488) [read]. Splash and fonts do not show in Expo Go, only in release builds [read]. Pixel gaps appear on real devices, not emulators (RN #12681) [read]. iOS bounce stays on only on physical iOS 16 in Capacitor (#5907) [read].
- **Root cause.** Different code paths in dev (Babel transforms, Metro caches, runtime style resolution) and release; dev-only validation; emulator vs device density.
- **How better tools prevent it.** Build-time compilation (Unistyles 3, NativeWind v4 compile step) narrows the gap; RSD warns at runtime in dev only.
- **Dragon lever.** One compiler result for dev and release (already an AGENTS.md rule), no dev-only validation, and the test lanes run the release output.

### 11. Pixel rounding and hairlines

- **What breaks.** 1-pixel gaps between adjacent views on Android devices with fractional density (2.625) [gh: RN #24414, 12 reactions]; `StyleSheet.hairlineWidth` invisible on fractional ratios [gh: #22927, 11 reactions]; react-native-web pins hairline to 1 CSS px, three device pixels on a 3× phone [read].
- **Root cause.** Layout in fractional dp, rounding to device pixels at assignment; mixing rounded and unrounded values accumulates error. RN rounds relative to the root to limit this [read: reactnative.dev/docs/pixelratio].
- **Better tools.** Round in the layout engine against absolute positions (Yoga does, Taffy has `round_layout`) [unverified for Taffy config details].
- **Dragon lever.** Chrome also snaps to device pixels; fixtures should run at DPR 2, 3 and 2.625 and compare in device pixels. A CSS `1px` border on a 3× device is 3 device pixels in Chrome; decide deliberately whether Dragon matches that (it should, for parity).

### 12. Overflowing text: ellipsis, `numberOfLines`, letter spacing

- **What breaks.** Android: ellipsis dots cut off (#33487, #36336, #36350; fixed in #41559) [gh/read]; only `tail` ellipsis works for more than one line (#19117, documented) [gh]; early ellipsis with slashes in a row (#35574); text edges cut with margins (#22419); a crash with decorated nested text under `numberOfLines` on 0.87.1 (#58356, three weeks old) [read]. `letterSpacing` breaks lines wrongly on Android (#35039) and adds trailing space after the last character [read].
- **Root cause.** Two different text engines (`StaticLayout`, TextKit/CoreText) and a line-clamp that is a view prop rather than a paint rule. CSS `letter-spacing` also adds space after each character, so parity is achievable but not free.
- **Dragon lever.** Dragon supports line clamping; fixtures should include ellipsis in rows, custom fonts, `letter-spacing`, and multi-line clamps. `text-overflow: ellipsis` with anything other than end truncation on multi-line should be a build error on Android.

### 13. Images: intrinsic size, aspect ratio, fit

- **What breaks.** Remote images have no intrinsic size in RN, so `width: 100%; height: auto` renders zero height; developers call `Image.getSize` at runtime [read: logrocket, xjavascript]. RN's default `resizeMode` is `cover`, while CSS `<img>` defaults to `object-fit: fill` (RSD sets `objectFit: 'fill'` to match) [read + gh: RSD html.js]. Rounded images need the radius on the image itself on Android [read].
- **Root cause.** Native image views do not report intrinsic size to the layout engine until loaded; CSS reflows when the image arrives.
- **Dragon lever.** Require either explicit dimensions, `aspect-ratio`, or build-time known asset dimensions (local assets can be measured at build time). Default `object-fit: fill` to match CSS.

### 14. Text style inheritance

- **What breaks.** `text-align`, `color`, `font-*` set on a container do not reach text on native: RN `Text` does not inherit from `View` (NativeWind #364) [read]; Lynx disables inheritance by default for performance [read: lynxjs.org]; NativeScript says "CSS inheritance is not supported" in general [read: docs.nativescript.org/guide/styling]. RSD adds `ContextInheritedStyles` to emulate it [gh: file listing].
- **Root cause.** Native views have no cascade; inheritance must be computed.
- **Dragon lever.** Dragon resolves the cascade at build time, so inheritance is free for static trees. It still needs a rule for inherited values that change at runtime (state classes on an ancestor).

### 15. Units: rem base, dp vs px, viewport units

- **What breaks.** NativeWind sets `rem` to 14 on native and 16 on web because RN text defaults to 14 [read: nativewind quirks]. `100vh` is taller than the visible area in mobile Safari; `dvh` relayouts on every toolbar change; none of `vh/svh/dvh` respond to the keyboard [read]. Unistyles native breakpoints default to device pixels, not points, so breakpoints fire at different sizes than on web [read: unistyl.es/v3/references/breakpoints].
- **Dragon lever.** One `rem` base on both targets (16, matching Chrome), CSS `px` = points/dp, viewport units defined as the safe layout area of the root view (and a stated answer for what `100vh` means on native: the whole window or the area inside safe insets).

### 16. Right-to-left

- **What breaks.** RN `forceRTL` needs an app restart (#16215, #32509) [gh/read]; `marginLeft` is not flipped, `marginStart` is; manually using `row-reverse` on top of native RTL double-flips [read]; react-native-web converted `marginStart` to fixed left/right once, not dynamically (#2114) [read]; NativeScript needs `android:supportsRtl` [read]. 93 "RTL" titles in RN.
- **Dragon lever.** Logical properties (`margin-inline-start`, `inset-inline-*`) compile to leading/trailing on both platforms; physical properties stay physical, exactly like CSS. `direction` must be switchable at runtime without restart (Taffy supports direction per node [unverified]).

### 17. Dark mode and flashes

- **What breaks.** White flash between splash and first screen in dark mode; `userInterfaceStyle` ignored on Android without `expo-system-ui` [read: docs.expo.dev]; NativeWind requires both light and dark values be declared or transitions misbehave [read: nativewind quirks].
- **Dragon lever.** `light-dark()` to dynamic `UIColor` (already planned) avoids JS re-render flashes; the launch screen/window background is outside the style tree and needs an explicit build output.

### 18. Hover on touch, focus rings and keyboard navigation

- **What breaks.** Web: `:hover` sticks after a tap on touch screens [read: css-tricks]. RNW Pressable hover responds to mouse only, focus styles show on mouse click because `:focus-visible` is missing (RNW #1849) [read]. Native: hardware-keyboard focus is separate from accessibility focus, gets stuck in background screens, cannot be moved in code (RN #35310, #39052); no UIFocusGroup support [read]. Tamagui: hover is web-only [read].
- **Dragon lever.** Compile `:hover` only under `(hover: hover)` semantics on native (i.e. pointer hover on iPad/Android with mouse via `UIHoverGestureRecognizer`/`onHoverEvent`), and `:focus-visible` to the platform focus system (iOS focus effect, Android `defaultFocusHighlight`). Plain `:focus` rings on native should be a caveat, not exact.

### 19. Nested scrolling and absolute positioning in scroll views

- **What breaks.** Android: inner horizontal scroller loses gestures to the outer one; `nestedScrollEnabled` unreliable in some directions (RN #21436, 70 comments) [gh]. Absolute elements inside scroll content move with content (expected in CSS too, but surprising with `position: fixed` habits). Vertical paging unsupported on Android [read]. Capacitor/WKWebView: rubber-band bounce cannot be disabled by CSS alone [read: capacitor #5907].
- **Dragon lever.** `position: fixed` and `position: sticky` need explicit native meaning or a build error; `overflow: scroll` on both axes nested should have fixtures on device.

### 20. Performance cliffs

- **iOS shadows without path** (see 3). **Opacity over overlapping children**: RN Android blends each child separately unless `needsOffscreenAlphaCompositing`, which is "extremely expensive" [read: reactnative.dev/docs/view; gh RN #30904]. **Blur**: expo-blur on Android was experimental until SDK 55, efficient only on Android 12+ (RenderNode), slow via RenderScript below; does not work inside Modal (#44165) [read]. Flutter Impeller backdrop blur raster time 6 → 16 ms/frame vs Skia in lists (#126353), and blurs a whole screen even for a small region (#149368) [read]. Flutter docs: avoid `Opacity` widgets, prefer translucent colours [read: docs.flutter.dev/perf/best-practices]. **Large lists** remain the top RN perf topic (752 "FlatList" titles) but are a component concern, not a styling one.
- **Dragon lever.** The compiler knows when `opacity` sits on a subtree with overlapping paint and can choose group opacity only there; it can refuse `backdrop-filter` below a declared Android floor; it should always set shadow paths. Report the chosen costly paths (offscreen passes) in build output so they are visible.

### 21. Android version and vendor fragmentation (cross-cutting)

Features gated by API level that surfaced in this sweep: `boxShadow` outset API 28, inset API 29; numeric custom font weights API 28; variable fonts API 29; efficient blur API 31; nonlinear font scaling API 34; enforced edge-to-edge API 35, no opt-out API 36; WebView safe-area values correct only from Chromium 140 [all read]. Vendor fonts (OnePlus, Oppo, LG, Samsung/Xiaomi user fonts) change measurement [read]. **Dragon lever.** A declared Android floor in the support profile, with per-feature minimum API levels; anything below the floor is a build error, not a silent no-op.

## What the better tools do (patterns worth copying)

| Pattern | Who does it | Evidence |
|---|---|---|
| Put web initial values onto native explicitly | React Strict DOM (box-sizing, position, flex defaults, block emulation, `object-fit: fill`) | [gh] RSD source |
| Warn on unsupported style values instead of dropping them | React Strict DOM runtime LogBox warnings | [read] RSD README |
| Document the quirks up front | NativeWind Quirks/Differences pages; Lynx per-property "differences from web" | [read] |
| One cross-platform prop replacing platform pairs | RN 0.76 `boxShadow`/`filter`; Tamagui 2 removing longhands | [read] |
| Build-time embedding of fonts, per-platform family tables | Expo font config plugin | [read] |
| Compile styles ahead of time, not per render | Unistyles 3 (C++ core, CSS classes on web), NativeWind v4 | [read] |
| Platform modifiers as escape hatch | NativeWind `ios:`/`android:`/`web:`, Tamagui `$platform-*` | [read] |

What none of them do: prove output against the browser, turn a platform limitation into a build error with a fix, or change the native view structure (shadow host plus clip layer) automatically. Those are Dragon's open lanes.

## Gaps and uncertainty

- Reaction counts undercount; Stack Overflow vote counts were not collected (no search access to SO scores in this run).
- Many entries rely on search-result summaries rather than full page reads; they are marked `[read]`. Items marked `[unverified]` are leads.
- Taffy-specific claims (rounding, `direction`) were not checked here; T001 owns Taffy facts.
- React Strict DOM native compatibility tables were not reachable (docs page 404 on the styling path); defaults were read from source instead.

```json
{
  "goalbuddy_receipt_v1": {
    "task_id": "T006",
    "role": "scout",
    "status": "done",
    "result": "complete",
    "summary": "Ranked 21 cross-platform styling pitfalls (web vs iOS vs Android) from React Native, Expo, NativeWind, React Strict DOM, Lynx, Tamagui, Unistyles, Flutter, Capacitor/Ionic and NativeScript, each with platform, frequency evidence, root cause, how better tools prevent it, and a Dragon lever for T007/T008.",
    "top_pitfalls": [
      "text line-height model and descender clipping",
      "keyboard avoidance",
      "shadows (iOS clip, Android elevation, offscreen cost)",
      "layout defaults differing from CSS",
      "border radius clipping and per-side borders on Android",
      "custom font names and weights per platform",
      "safe areas and Android edge-to-edge",
      "z-index vs elevation",
      "text scaling breaking fixed layouts",
      "dev works, release breaks"
    ],
    "evidence": {
      "gh_verified_issues": ["react-native#3198", "#13126", "#17064", "#49886", "#53344", "#12403", "#47905", "#24224", "#35565", "#32196", "#24414", "#22927", "#26193", "#42116", "#33380", "#27546", "#49128", "#23826", "#28697", "#21436", "#35658", "#16215", "#19117", "#33487", "#35039", "yoga#1409"],
      "gh_verified_source": ["react-strict-dom src/native/html.js defaults", "react-strict-dom src/native/modules/createStrictDOMComponent.js flex defaults"],
      "keyword_title_counts_react_native": {"KeyboardAvoidingView": 111, "shadow": 107, "borderRadius": 104, "RTL": 93, "overflow": 86, "lineHeight": 63, "zIndex": 56, "numberOfLines": 41, "Text cut off": 31, "fontFamily": 30, "percentage": 27, "dashed": 22, "dark mode": 19, "letterSpacing": 12},
      "access_date": "2026-09-26"
    },
    "files_written": ["docs/goals/milestone-1/notes/T006-platform-pitfalls.md"],
    "commands_run": ["gh api repos/facebook/react-native/issues/<n> (reactions/comments)", "gh api search/issues repo:react/react-native in:title <keyword>", "gh api repos/react/react-strict-dom/contents/..."],
    "limitations": ["reaction counts undercount real frequency", "many claims from search summaries, marked [read]", "no Stack Overflow vote data", "Taffy claims deferred to T001"],
    "next_suggestion": "T007 should map each Dragon lever above against the current design; T008 should turn levers 1, 3, 4, 5 and 6 into default behaviours with Chrome-compared fixtures."
  }
}
```
