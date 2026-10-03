# T067 MQ-R: @media on iOS and Android with runtime band switching, @supports per target, env(safe-area-*). Binding worker spec (Judge, 2026-10-03)

This supersedes notes/T047-runtime-spec.md §3.7 and RT-10 wherever they differ, and keeps everything in them that is not
changed here. Read-only review: nothing in the repo was changed. Chrome probes are in /tmp/t067-probe (probe1.mjs to
probe6.mjs, check-fold.ts and its outputs), and the fetched Chrome 145.0.7632.6 sources are in /tmp/t067-src.

**Read:**
- AGENTS.md; goal.md for milestone 1 (design principles) and for milestone-2-proof (Decision Rule, Throughput, landing
  queue, trains); PM-2026-10-03.md (open PR queue);
- docs/research/coverage-roadmap.md: the MQ row (@media 83.9%, @supports 53.0%, env() 10.6%; routes C + R + E; "cas + rt"),
  §4 and §5;
- docs/decisions.md: "Runtime styles and animation (T047)", "Native viewports, text scale and device sizes", the
  2026-09-29 rulings (KBD after V2b and MQ-R; "live text-size changes are part of MQ-R"), "Porting Chrome's algorithms",
  "How decisions are made", decision 6; docs/ports.md; docs/api.md §5 and §7/§7.1;
- state.yaml cards T016, T025, T027, T030, T047, T063/T134, T064, T065, T066, T067, T072/T115;
- notes T025 (MQ-a, §3 Phases A and B), T012 (V2, §1, §3 rulings 3, 6 and 7, §5 V2b), T047 (RT-1, RT-5, RT-10, RT-13,
  §2, §3.7), T065 (ANIM-b; R1, R4, §5);
- master 0ef8c05ee: `packages/dragon/src/media/*`, `css/at-rules.ts`, `css/units.ts`, `project.ts` (band loop,
  `rulesIn`, `nativeBandIndex`, the MQ-R refusals at 765-790), `lower/state-program.ts`, `emit/runtime/{state,clock,index}.ts`,
  `emit/native-support.ts` (`environmentArgs`), `packages/layout/src/environment.ts` (EnvLength, safeArea,
  `environmentDependencies`), `packages/parity/src/{native-host,device-run,chrome,media-sweep}.ts`,
  `scripts/capture-media-data.ts`, `packages/dragon/test/media/captures/chrome-145.json` (109 integer viewports);
- branches: mq-a-media and mq-a-wiring (merged as T016 and #38), seld-lanes-v2 (device-states lane, case-script runner),
  anim-b1-rt and anim-b1-compiler (ANIM-b1 PRs 1-2);
- examples/music-player: styles.css 498-560, north-star-check.json;
- Chrome 145 sources at the tag: `core/css/media_query_evaluator.cc` (BSD 2-clause, Nokia/Apple/Intel),
  `core/css/media_values.cc` (Chromium BSD), `core/frame/local_frame_view.cc` (**LGPL**: reference only),
  `ui/android/java/.../TouchDevice.java`, `ui/base/pointer/pointer_device{,_android}.cc`,
  `ui/accessibility/android/java/.../AccessibilityState.java`, `ui/gfx/animation/animation_android.cc` (all Chromium BSD).

## 0. Facts that shape the spec

**What the music player uses.** `@media screen and (max-width: 768px)` (styles.css 498: `.App.library-active` margin-right 0,
`.mini-video-shell`, `.record` `min(72vw, 18rem)`, `.play-control`, `.library` width) and `@media screen and (max-width:
640px)` (522: `.song-container h2`, `.time-control`, `.youtube-disclosure`). No orientation, no environment feature, no
@supports, no env(). On master each block costs one `DRAGON_UNSUPPORTED_AT_RULE [ios]` and one `[android]` (4 errors). The
other 339 errors are other packages'.

**What master has.**
- MQ-a: a parser and evaluator over `{ width, height }`, a band partition over width and height atoms only (cap 16), band
  blocks in web CSS, a per-band check loop, and native resolved in one band: the fold viewport's band in parity, band 0 with
  a target-scoped MQ-R refusal in the public compile. `orientation` and `aspect-ratio` parse and evaluate, but the partition
  refuses them as `non-axis-feature`, so they are refused on **every** target, web included. Environment features are refused
  everywhere.
- SELD-R1a: the state program (`deriveStateProgram`: base, deltas, layout variants, `next`), typed setters, the mount that
  rebuilds and lays out on each committed set, and the virtual clock. Every layout input carries a **literal** viewport and
  `environmentArgs(viewport, rootFontSize)` = equal sv/lv/dv and **zero safe-area insets**. Nothing reads the device
  environment, and nothing listens for size changes.
- V2a: the engine has `EnvLength`, `SafeAreaInsets`, `ViewportUnitSizes`, `rootFontSize` and
  `environmentDependencies(input)`. The **compiler still refuses env()** (`css/units.ts` REFUSED_FUNCTIONS: "env() reads the
  safe-area insets, which the engine takes as an environment input only from … V2") and refuses sv/lv/dv. So env() has no
  owner after V2a; this package takes it (the roadmap's MQ row includes it).
- The device matrix: iPhone 17 (DPR 3), iPad (A16) (DPR 2), Android `dragon-320` (2), `dragon-smoke` (2.625), `dragon-480`
  (3), all 1080 or 1440 px wide portrait. Cases run in a stage inside the safe area. The Android host activity is locked to
  `screenOrientation="portrait"` and declares no `configChanges`. Portrait stage widths are 402, 820, 540, 411.43 and 480
  CSS px, so a lane case wider than 400 does not fit every device.
- seld-lanes-v2 (PR queue item 2) brings the device-states lane and the case-script runner (`set`, `advance`, `tap`, `dump`).
  ANIM-b1 (queue item 9) brings transitions and the R4 entry point "takes an old and a new program, so MQ-R and SOV call it
  unchanged later" (T065 §1).

**Chrome measurements** (Chrome 145.0.7632.6, Playwright 1.58.2, headless; /tmp/t067-probe):

| # | Probe | Result |
|---|---|---|
| M1 | iframe of CSS width 640.25/640.4/640.5 at DSF 1, 2, 2.625, 3 | the frame snaps to whole device px, rounding half up (640.5 at DSF 3 = 1922 px = 640.667); media `width` is that px / DSF, fractional (640.5 at DSF 2 matches `(width: 640.5px)`), while `innerWidth` is an integer |
| M2 | integer width 640: `(max-width: 639.99px)`, `(max-width: 639.984375px)`, `(min-width: 640.01px)`, `(min-width: 640.015625px)`, `(width: 640.01px)`, `(width: 639.99px)`, `(width <= 639.99px)`, `(639.99px >= width)` | all **true**; `(max-width: 639.98px)` and `(min-width: 640.02px)` false; `(width > 639.99px)` and `(width < 640.01px)` true (strict compares are exact) |
| M3 | 400.75 x 400.25 and 400.25 x 400.75 (DSF 4) | both `(orientation: portrait)` and `(aspect-ratio: 1/1)`; 401 x 400.75 is landscape; 640.25 x 320.25 matches `(min-aspect-ratio: 2/1)` |
| M4 | iframe of exactly 1080 x 2208 device px at DSF 2.625 | `(width > 411.428572px)` and `(width > 411.4285888px)` true, `(width < 411.4285889px)` true; `(height > 841.1428833px)` true. So width = `fround(fround(1080) * fround(1/2.625))` = 411.4285888671875 (double division gives 411.428571…, float division 411.428558…; both are ruled out) |
| M5 | emulated main frame, DIP 402, 412, 393 wide and 300 high at DSF 2.625 | `(width > 402px)`, `(width > 412px)`, `(width > 393px)` and `(height > 300px)` all true: the emulated layout size is **ceil**(DIP x DSF) px (1055.25 to 1056). At DSF 1, 2 and 3 these sizes are exact |
| M6 | `Emulation.setSafeAreaInsetsOverride` | exists; integer insets only (10.5 is "Invalid parameters"); `{top:47,left:10,bottom:34,right:0,topMax:59,bottomMax:34,leftMax:10,rightMax:0}` gives `env(safe-area-inset-top)` 47px, `env(safe-area-max-inset-top)` 59px, `calc(env(safe-area-inset-right) + 1px)` 1px; omitting the max fields gives max insets 0 (not the fallback); `env(nope, 5px)` is 5px |
| M7 | contexts `isMobile+hasTouch`, `hasTouch` only, desktop | touch: `hover: none`, `any-hover: none`, `pointer: coarse`, `any-pointer: coarse`; desktop: `hover`, `fine`; `resolution: 3dppx`, `3x` and `-webkit-device-pixel-ratio: 3` match at DSF 3; `Emulation.setEmulatedMedia` sets `prefers-color-scheme: dark` and `prefers-reduced-motion: reduce` |
| M8 | 400 to 600 wide across `@media (max-width: 500px) { margin-right: 0 }` with `transition: margin-right .5s ease`, clock frozen | a CSSTransition starts at the resize (0 ms, 500 ms); at 250 ms margin-right is 80.2403px; resizing back starts the reversal with duration 401.20169552992184 ms (T065 M5's number) |
| M9 | 400x304 to 304x400 with `width: 50vw`, `width: 50%`, `margin-right: clamp(20px, 22vw, 1000px)` and an `(orientation: landscape)` height, each with a 1 s linear transition | transitions start on the vw width (200 to 152, 176px at 500 ms), the vw-clamp margin (88 to 66.88, 77.44px at 500 ms) and the orientation height; **none on the % width** |
| M10 | `CSS.supports` | `display: grid` true, `display: subgrid` false, `selector(:has(a))` true, `oklch()` colour true, `font-tech(color-COLRv1)` true, `at-rule(@starting-style)` false |
| M11 | north-star check with a native fold viewport (check-fold.ts, a copy of tools/check.ts on createProjectWith) at 402x874, 700x402 and 874x402 | the 4 target-scoped AT_RULE errors go, nothing is added in any band; errors 343 to 339; supportedIos and supportedAndroid 172 to 183; support 59.1% to 62.9% |

**Chrome source** (tag 145.0.7632.6):
- `media_query_evaluator.cc` `CompareDoubleValue` (276-297): `precision = LayoutUnit::Epsilon()` (1/64); `>=` is
  `actual >= query - precision`, `<=` is `actual <= query + precision`, `=` is `|actual - query| <= precision`, `<` and
  `>` are exact; a negative query value goes to `HandleNegativeMediaFeatureValue`. `WidthMediaFeatureEval` and
  `HeightMediaFeatureEval` (660-683) compare the double `Width()`/`Height()`. `OrientationMediaFeatureEval` (456-472) and
  `AspectRatioMediaFeatureEval` (474-484) take `int width = *media_values.Width()` (truncation); a square viewport is
  portrait; aspect ratios compare `width * den` with `height * num` through `CompareDoubleValue`. `EvalResolution`
  (531-591) compares `ClampTo<float>(DevicePixelRatio())` with the float dppx value, and dpcm at 2 decimals.
- `media_values.cc` `CalculateViewportWidth` (109-114) returns `ViewportSizeForMediaQueries().width()`, a `gfx::SizeF`.
  `local_frame_view.cc` `ViewportSizeForMediaQueries` (939-953) scales the integer `layout_size_` by
  `1 / LayoutZoomFactor()` in float. That file is LGPL, so Dragon takes the formula from M4, not from its text (class A).
- Android Chrome: `TouchDevice.availablePointerAndHoverTypes` (TouchDevice.java 60-100): a device with SOURCE_MOUSE,
  STYLUS, TOUCHPAD or TRACKBALL adds `fine`; SOURCE_TOUCHSCREEN adds `coarse`; MOUSE, TOUCHPAD or TRACKBALL adds `hover`.
  `pointer_device_android.cc` 35-55: the primary pointer is **coarse first**, then fine; the primary hover is `hover`
  exactly when the hover set is non-empty. (`pointer_device.cc`, the non-Android rule, is fine first.) `AccessibilityState.prefersReducedMotion()` (503-507) is
  `Settings.Global.ANIMATOR_DURATION_SCALE == 0` (default 1, 533-536), observed with a ContentObserver (955-959);
  `animation_android.cc` feeds it to Blink.

**Findings about master.**
1. **MQ-a's evaluator is not Chrome's at fractional viewports** (M2, M3). It compares exactly and uses doubles for
   orientation and aspect ratio. MQ-a's corpus only used integer viewports at thresholds ±1 px, so nothing caught it. With
   integer viewports it is wrong only for thresholds within 1/64 px of the viewport (`(max-width: 639.99px)` at 640). On a
   device the root size is fractional (M4: 411.43 CSS px on the 2.625 emulator), so MQ-R must fix it first.
2. **The Chrome reference at DPR 2.625 is 400 x 300.19, not 400 x 300** (M5). No committed media fixture has a height
   threshold near 300, so no band differs today. Nothing checks this.
3. **Viewport changes start transitions without any band change** (M9). RT-10 only covered band changes.

## 1. Scope

### Supported, by package (§5 gives the order)

| Package | What it adds | Targets |
|---|---|---|
| **MQ-R0** | Chrome's comparison rules (1/64, truncation, float viewport); `orientation` and `aspect-ratio` in the partition | web (orientation and aspect-ratio become supported); the native fold for parity |
| **MQ-R1** | `width`, `height`, `orientation`, `aspect-ratio` (all `min-`/`max-`/range forms), media types `all`, `screen` and `only`, `not`/`and`/`or`/comma, nested @media; every band shipped; switching on resize and rotation | ios, android |
| **MQ-Rt** | Transitions started by band changes and by viewport-unit value changes | ios, android |
| **MQ-E1** | `env(safe-area-inset-*)`, `env(safe-area-max-inset-*)`, fallbacks, env() inside calc/min/max/clamp | web |
| **MQ-E2** | `env(safe-area-inset-*)` from the root view's live insets | ios, android |
| **MQ-R2** | `prefers-color-scheme`, `prefers-reduced-motion`, `hover`, `any-hover`, `pointer`, `any-pointer`, `resolution`, `-webkit-device-pixel-ratio` (and `min-`/`max-`) | web, ios, android (§2 R9 gives each label) |
| **MQ-S** | `@supports` with declarations, `not`/`and`/`or`, `selector()`, evaluated per target at build time | web, ios, android |

### Refused (each has a reject fixture)

| Case | Code | Message (shape) | Until |
|---|---|---|---|
| More than 16 bands (now counting ratio and environment atoms) | DRAGON_UNSUPPORTED_AT_RULE | the existing `split the viewport into N bands, which is not supported` text, naming MQ-R4 | MQ-R4 (T019) |
| A transitioned property whose computed value differs between two bands of a reachable state, or depends on vw/vh/vmin/vmax/vi/vb (or sv/lv/dv when accepted), on native | DRAGON_UNSUPPORTED_VALUE `[ios]`/`[android]` | `transition on <p> of <element> would start when the screen size changes; transitions started by size changes are not built yet (package MQ-Rt)` | MQ-Rt |
| `@keyframes` or `@font-face` inside @media or @supports | existing refusals | unchanged (ANIM-b and fonts) | — |
| Environment features before MQ-R2 | DRAGON_UNSUPPORTED_AT_RULE | the existing `depends on the device or the user` text, naming MQ-R2 instead of MQ-R | MQ-R2 |
| `prefers-contrast`, `prefers-reduced-transparency`, `prefers-reduced-data`, `forced-colors`, `inverted-colors`, `color`, `color-index`, `monochrome`, `color-gamut`, `dynamic-range`, `video-dynamic-range`, `display-mode`, `scripting`, `update`, `overflow-*`, `grid`, `scan`, `device-*`, `device-posture`, `*-viewport-segments`, `navigation-controls`, `-webkit-transform-3d` | DRAGON_UNSUPPORTED_AT_RULE | `… depends on the device or the user, which Dragon does not read yet (package MQ-R3)` | MQ-R3 (T019) |
| `env(safe-area-max-inset-*)` on native | DRAGON_UNSUPPORTED_VALUE `[ios]`/`[android]` | `env(safe-area-max-inset-<side>) has no native equivalent yet (package MQ-E3)` | MQ-E3 |
| `env()` names other than the 8 safe-area names, with no fallback | DRAGON_UNSUPPORTED_VALUE | `env(<name>) is not defined in Chrome 145, so the declaration computes to unset; give a fallback or remove it` | none (author error) |
| `env(keyboard-inset-*)` | DRAGON_UNSUPPORTED_VALUE | `… (package KBD)` | KBD |
| `env()` in a media query, a selector, or a custom property's registered syntax | existing refusals | unchanged | — |
| `@supports font-tech()`, `font-format()` on native | DRAGON_UNSUPPORTED_AT_RULE `[ios]`/`[android]` | `@supports font-tech()/font-format() is not answered for <target> yet (package MQ-S2)` | MQ-S2 |
| `@supports` containing `@import` conditions or `@layer`/`@container` inside | existing refusals | unchanged | — |

## 2. Rulings

**R1. The card's order is not needed; the work splits into seven packages.** Evidence:
- **T030 is done** (#38).
- **T065 (ANIM-b) is needed only for transitions started by size changes** (M8, M9). Before ANIM-b1 is on master, every
  `transition` declaration is already UNSUPPORTED_PROPERTY, so no native output can contain one. After it, MQ-R1's refusal
  (§1) covers the gap until MQ-Rt. So band switching without animation interplay can go first.
- **T027 (V2b) is needed only for one slice: the native root-size read and its change event.** V2b's other work (pinned
  text-scale tables, scaled-root captures, viewport fixture sets, oversize device provisioning) is not used by MQ-R. MQ-R1
  takes the root-size read, the listener, the environment record in the dump and the Android `configChanges`, because it is
  their first consumer and the rotation proof exercises them. V2b is narrowed and later adds `rootFontSize` to the same
  listener and record (§9 board update). That also delivers the decisions.md item "live text-size changes are part of
  MQ-R": V2b's content-size probe runs on MQ-R1's listener.
- So the first piece, MQ-R1 (width, height, orientation and aspect-ratio bands, switched on resize and rotation, no
  animation interplay) goes right after MQ-R0 and seld-lanes, ahead of ANIM-b, V2b and PNT.

**R2. Media comparisons follow Chrome, not exact MQ4** (M2, M3; `CompareDoubleValue`, `OrientationMediaFeatureEval`).
- For `width` and `height`: `min-` and `>=` match when `actual >= v - 1/64`; `max-` and `<=` when `actual <= v + 1/64`;
  plain and `=` when `|actual - v| <= 1/64`; `<` and `>` are exact. The range forms map to the same operators, with the
  sides swapped as Chrome swaps them (`(639.99px >= width)` is `width <= 639.99px`).
- For `orientation`: `trunc(width) > trunc(height)` is landscape, else portrait (a square is portrait).
- For `aspect-ratio`: `trunc(width) * den` against `trunc(height) * num` with the same 1/64 rule.
- A negative query value follows `HandleNegativeMediaFeatureValue`; the worker reads it at the tag and adds corpus rows.
- `media_query_evaluator.cc` is BSD 2-clause with three copyright holders (`bsd-other`). The rules are three comparisons, so
  Dragon implements them from the measurements and cites the file with `use: reference` in docs/ports.json. That keeps
  the notice-retention rule (ports.md) off media/evaluate.ts. If the worker reproduces its code structure instead, it is a
  `port` and the notice paragraphs go into the file.
- Plants: `mediaCompareExact` (no 1/64), `orientationUntruncated`, `aspectRatioUntruncated`. Each must flip a corpus row.

**R3. The media viewport is Chrome's float value of the root's whole device pixels** (M1, M4, M5).
- The size the evaluator sees is `fround(fround(px) * fround(1 / fround(dpr)))` for each axis. `px` is the root view's size
  in whole device px. On iOS that is points x `UIScreen.scale` (whole for window-derived bounds at scale 2 and 3). On Android
  it is the root view's integer px size, divided by `DisplayMetrics.density`.
- In the Chrome reference, an emulated main frame of DIP size W has `px = ceil(W * dpr)` (M5). An iframe has
  `px = round-half-up(cssWidth * dpr)` (M1).
- This is an observation (local_frame_view.cc is LGPL). The corpus row M4 pins it. Plant: `mediaWidthDouble`.
- Lane resize sizes are multiples of 8 CSS px, so `W * dpr` is whole at 2, 2.625 and 3 and the emulated frame is exact.
- The engine's own viewport (vw, the initial containing block) is **not** changed by MQ-R. Whether Chrome's vw uses the same
  float value is a V2 question; it goes on the board (§9), and no output changes here.
- **Existing fixtures:** a host test checks every committed media fixture, at every DPR, for the same band at the nominal
  size (400 x 300) and at Chrome's emulated size (`ceil(W*dpr)/dpr`, so 300.19 at 2.625). If any band differs, **stop**:
  the native fold would need to become per-DPR. Today none differs (Finding 2).

**R4. The partition becomes a table of atom truth vectors; the device looks bands up and never evaluates CSS.**
- Atoms are the width, height, ratio (orientation and aspect-ratio) atoms and, from MQ-R2, the environment atoms. Each
  compiles to a typed record `{ axis, op, value | num/den | keyword }`.
- A band is one reachable truth vector. Width and height groups stay as MQ-a builds them, with interval ends moved by the
  R2 rule. Ratio atoms add a third factor. A combination is dropped only if it is **proven empty**: no integer pair
  `(trunc w, trunc h)` in the two groups satisfies the ratio truths. Otherwise it stays, because an unreachable band costs
  one unused delta and is harmless.
- `bandAt` evaluates each atom with R2 and R3 and looks up the vector. On device that is `rt-band.ts`, a translated root
  (`froundOf`, `truncOf` from rt-easing). A vector that is not in the table is a located runtime error, never a guessed band.
- The cap stays at 16 bands.
- Web output is unchanged in kind: one `@media <band condition>` block per extra band, conditions built only from authored
  atoms and their negations. It now also covers orientation and aspect-ratio.
- **Totality test:** for every media fixture and the north star, every integer device-px pair in `[0, 2048]²` at each DPR
  maps to exactly one band, and that band's truth vector equals direct evaluation. Plant: `bandGapAtBoundary` (exists).

**R5. A size change re-runs layout; a band change is a precompiled restyle; the device never cascades or matches.**
- **Size change** (any root bounds change): the environment input changes (viewport, and the sv/lv/dv sizes equal to it,
  as decided), and layout runs again with the shared engine. Resolved values are unchanged, because vw and % stay engine
  leaves (V2a).
- **Band change:** the band is an **internal environment dimension of the state program**. It is not an app setter and
  not in the binding manifest (api §5). `deriveStateProgram` gets one extra variable, `env#band`, whose domain is the band
  indices. Every (app assignment, band) pair is an assignment, so the 64-assignment cap counts bands too, and RT-1's delta
  path applies the change atomically.
- **One event, one layout.** A size change computes the new band first, applies the delta if the band changed, then lays
  out once at the new size. No frame shows the old band at the new size, or the new band at the old size. Plant:
  `bandStale` (layout at the new size with the old band).
- **The oracle** for any sequence of `set` and `resize` steps is the per-case program of (final assignment, final band),
  laid out at the final size. In parity that is the program compiled with a fold viewport in that band.

**R6. The environment comes from the Dragon root view, and rotation happens in place.**
- Media `width`/`height`, `100vw`/`100vh` and the env() insets all read the same object: the Dragon root view's bounds and
  its own insets. They do not read the window or the screen. Plant: `mediaSizeFromWindow`.
- **iOS:** the root view observes its own bounds in `layoutSubviews`, which catches rotation, split view and Stage Manager.
  It reads `safeAreaInsets` in `safeAreaInsetsDidChange` (MQ-E2) and trait changes in `traitCollectionDidChange` (MQ-R2).
  All of these exist at the iOS 15 floor.
- **Android:** the root view uses `onSizeChanged` and `setOnApplyWindowInsetsListener` (MQ-E2). The generated host activity
  declares `configChanges="orientation|screenSize|smallestScreenSize|screenLayout"`, plus `uiMode` from MQ-R2.
  `screenOrientation` becomes unspecified; lane runs request portrait at start (`setRequestedOrientation`) so that every
  existing case still runs portrait. A density change is left to recreate the activity.
- An app host that lets the activity recreate must reach the same dump. The state is restored from the binding and the
  band is recomputed. Plant: `activityRecreated` (the recreation loses the state).
- The dump gains an **environment record**: root px, dpr, the media size from R3, the band index, and later the insets
  (E2), environment bits (R2) and `rootFontSize` (V2b). This bumps `NATIVE_DUMP_SCHEMA`, with an additive check that all
  existing dumps compare equal apart from the new key.

**R7. How the device lanes prove a band switch.**
- **(a) Resize scripts, exact against Chrome.** A new case-script step, `resize(w, h)` in CSS px (multiples of 8, at most
  400 x 400, so every portrait stage holds it), sets the lane root's size. On the host, Chrome runs the same steps through
  `Page.setViewportSize` (`Emulation.setDeviceMetricsOverride`) at each DPR with the clock frozen. Frames, applied values and
  pixels are compared after every step on `device-states` (seld-lanes) at DPR 2, 2.625 and 3 (Android) and 2 and 3 (iOS),
  and on chrome-dual and the host lanes at DPR 1.
- **(b) Thresholds that test the 1/64 rule on whole sizes.** Thresholds of `319.99px`, `320.01px` and `319.984375px` at a
  root of 320 test R2 on device without fractional roots. Strict `(width > 319.99px)` tests the exact branch.
- **(c) One real rotation per platform**, in a new lane `device-env`, on every device of the matrix:
  - iOS: `UIWindowScene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))`, which is iOS 16+ and used
    only by the lane on the simulator runtime; the floor code path is the bounds observation.
  - Android: `setRequestedOrientation(SCREEN_ORIENTATION_LANDSCAPE)`.
  - The case is a fluid **fill-the-stage** layout (root = stage, sized by the device), so nothing is cropped. It has
    orientation and `max-width: 500px` atoms and one free state set before rotating.
  - After rotation the dump must report the landscape root px, the band that the Dragon evaluator gives for it, the same
    state, and frames equal to the TypeScript engine at the dumped size. The host recomputes the expected dump from the
    dumped root px.
  - The band is also checked against Chrome: `matchMedia` for every atom inside an iframe of exactly the dumped device px
    at the device DPR (the M1/M4 method), captured on the host from the dump. This is the "band oracle".
  - Pixels are not compared on (c); they are covered by (a). Then rotate back and check the portrait dump again.
- **Frame comparisons never cover the rotation animation.** Chrome has none, and the dump is taken after the size settles
  (decisions.md, RT-10).
- Plants caught on device: `bandBoundaryExclusive`, `bandStale`, `resizeSkipsRelayout`, `mediaSizeFromWindow`,
  `rotationLosesState`, `activityRecreated`.

**R8. Size changes are style change events, so they start transitions (MQ-Rt).**
- Chrome starts transitions on band changes (M8) and on viewport-unit computed values without a band change (M9). `%` does
  not start one, because it stays a percentage at computed time.
- **MQ-R1 refuses** both cases on native (§1). The check is in `lower/band-program.ts`. It reads the transition slots
  through ANIM-b's analysis when that is on the base. Its test (`media-runtime.test.ts`) asserts the right thing on either
  base: with ANIM-b1 on the base, the MQ-Rt refusal appears; without it, the `transition` declaration is itself
  UNSUPPORTED_PROPERTY. Whichever of MQ-R1 and ANIM-b1 PR 2 merges second carries the hunk (≤ 30 lines). No `.skip` is used.
- **MQ-Rt** calls ANIM-b's R4 entry point (old program, new program) once per size change, at `clock.now`, after the band
  delta and before the layout at the new size. That gives a before-change value from the old band at the old size, and an
  after-change value from the new band at the new size; vw-based computed lengths are resolved at each size. M8's numbers
  (80.2403px at 250 ms, reversal 401.20169552992184 ms) and M9's are fixture expectations.
- Plants: `bandChangeNoTransition` (T047), `viewportUnitNoTransition`, `percentTransitionsOnResize`.

**R9. Which features each platform can answer, and how exactly (MQ-R2).**

| Feature | Chrome value | iOS (UIKit) | Android (minSdk 31) | Label |
|---|---|---|---|---|
| width, height | R3 | root bounds x scale | root px / density | exact both |
| orientation, aspect-ratio | truncated R3 | same | same | exact both |
| resolution, -webkit-device-pixel-ratio | `ClampTo<float>(dsf)` vs float dppx; dpcm at 2 decimals | `traitCollection.displayScale` (= `UIScreen.scale`, already asserted by the host) | `DisplayMetrics.density` (the DPR Chrome Android uses) | exact both |
| prefers-color-scheme | emulated (M7) | `traitCollection.userInterfaceStyle == .dark` on the root view | `Configuration.uiMode & UI_MODE_NIGHT_MASK == UI_MODE_NIGHT_YES` | exact both (lane injection plus one OS toggle: `simctl ui appearance`, `cmd uimode night`) |
| prefers-reduced-motion | emulated (M7) | `UIAccessibility.isReduceMotionEnabled` (what every iOS browser reports) | port of Chromium `AccessibilityState.prefersReducedMotion`: `ANIMATOR_DURATION_SCALE == 0` | Android exact; iOS caveat until an OS-toggle device run passes (simctl has no reduce-motion switch) |
| pointer, any-pointer, hover, any-hover | `isMobile`/`hasTouch` contexts (M7) | iPhone: none/coarse, constant. iPad: primary coarse/none; `any-*` adds fine/hover while `GCMouse.mice` is non-empty | port of `TouchDevice.availablePointerAndHoverTypes` and `pointer_device_android.cc` (primary pointer coarse first; primary hover `hover` only when the hover set is non-empty), refreshed by `InputManager.InputDeviceListener` | Android exact; iPhone exact by construction; iPad caveat (no Chrome on iOS) |
| everything else | — | — | — | refused (MQ-R3) |

- Each feature is a discrete atom in R4's table. Its reads feed the same environment record and listener as R6.
- Platform motion settings still do not change animation **timing** (RT-5). They only answer the media feature.
- **`prefers-color-scheme` and `color-scheme`.** Both read the same environment bit. When PNT1's `usedColorScheme(el)`
  meets `color-scheme: light dark` (or `normal` with an author dark rule), MQ-R2 makes the used scheme follow the bit
  through the band table. This needs PNT1 (T072/T115) on master.
- Chrome can emulate the colour scheme, reduced motion, the DSF and the touch-or-mouse context. It cannot emulate "touch
  plus mouse", so the `any-*` mixed rows are proven by the port's vectors against the Chromium Java rule, are labelled
  caveat, and their web rows stay exact (Chrome's own answer).
- Plants: `reducedMotionFromTransitionScale` (reads TRANSITION_ANIMATION_SCALE), `primaryPointerFineFirst` (the desktop
  rule), `colorSchemeFromAppOverride`, `resolutionUsesNativeScale` (iOS `nativeScale`).

**R10. env(safe-area-*) (MQ-E1 and MQ-E2).**
- Chrome can prove nonzero insets (M6), which answers V2 ruling 7. Only whole CSS px can be set, so fractional insets are
  proven by engine vectors (TS = Swift = Kotlin) and the device probe, and labelled that way.
- **Compiler:** accept `env(<safe-area name>[, <fallback>])` wherever a length is accepted, including inside calc, min, max
  and clamp, and lower it to V2a's `EnvLength`.
  - Unknown names fold to their fallback at build time (M6), as Chrome does; with no fallback they are refused.
  - The V2a plant `envFallbackForKnownName` must stay caught.
- **Web:** keep `env()` unresolved, in Chrome's serialisation.
- **Native (MQ-E2):** the root view's own insets in CSS px. On iOS that is `safeAreaInsets` (points). On Android it is
  `WindowInsets` `systemBars() | displayCutout()` divided by density; the host already reads these for its stage. The
  inset change is the same environment event as R6, with one layout.
- `safe-area-max-inset-*` is accepted on web and refused on native (MQ-E3): Chrome's max inset reflects dynamic browser UI,
  which a native root does not have.
- **Proof:**
  - a lane step `insets(t, r, b, l)` in whole CSS px, compared with Chrome under `setSafeAreaInsetsOverride`;
  - one real full-window case per device in `device-env`: iPhone 17 portrait and landscape, and the Android emulator's
    status and navigation bars, under edge-to-edge at targetSdk 36. It is judged against the engine at the dumped insets,
    and against Chrome when they are whole.
- Plants: `safeAreaFromWindow`, `insetsNotDivided` (Android px not divided by density), `safeAreaStale`.

**R11. @supports is answered per target at build time (MQ-S).** api §5: "The core can evaluate CSS media features and
`@supports` using profile-backed answers".
- **The web answer is Chrome 145's.** A declaration is supported when Chrome would parse it; Dragon decides that with its
  property table and value grammar. `selector()` uses TREE's Chrome validity table. `not`, `and`, `or` and
  general-enclosed follow css-conditional-3 (unknown is false).
  - The answers are proven against a committed `CSS.supports` corpus (scripts/capture-supports-data.ts, `--check`
    byte-identical).
  - A condition whose Chrome answer Dragon cannot decide (for example a grammar gap like T126's relative colours) is
    refused, never guessed.
- **The native answer** is the web answer AND the target's committed support profile having a row for
  `<property>:<value-kind>` at status `exact` or `caveat`. `selector()` also needs native selector support. So
  `@supports not (display: grid)` takes its fallback on a target without grid. That is the compiler deciding a platform
  difference (design principle 3).
- Where a native answer differs from Chrome's, the reference is a versioned policy, `supports-per-target` (api §7.1).
  Chrome renders the sheet with that condition rewritten to the target's answer, in Chrome's own CSSOM. This is the
  pinned-generic precedent.
- **Web output** folds the condition with the web answer, writing the rules or dropping them. The web output then means
  the same thing in any browser.
- The answers enter the compilation digest through the profile digest, which already hashes the profiles.
- Plants: `supportsNativeUsesChromeAnswer`, `supportsNotInverted`.

**R12. Where the code lives** (RT-12, RT-13).
- **Compile time:** `packages/dragon/src/media/**` (evaluator, partition, atom records), `lower/band-program.ts` (new),
  `css/supports.ts` (new), `css/env.ts` (new).
- **Runtime algorithm:** `packages/layout/src/rt-band.ts` (new, translated root; vectors in
  `packages/layout/rt-vectors/band/**`).
- **Native glue:** `packages/dragon/src/emit/runtime/media.ts` (new), with the environment listener and record.
- **Shared files:** RT-13 additive hunks only, plus the named hunks in §5.

**R13. Support facts come from profile rows, not literals.**
- New rows, from passing fixtures: `at-rule:@media`; `media-feature:<name>` per target; `media-type:screen|all`;
  `function:env()` and `env:safe-area-inset-<side>`; `at-rule:@supports` and `supports-condition:declaration|not|and|or|selector()`.
- The native media refusal in project.ts (765-790) and at-rules.ts becomes "no row for this feature on this target", read
  from the profile. This retires the "until MQ-R" literal strings.
- Rows are additions only. No existing status changes.

**R14. Chrome sources and licences.**
- `media_query_evaluator.cc`: reference (R2).
- `local_frame_view.cc`: LGPL, reference, class A, observation M4/M5.
- `media_values.cc`: reference.
- `TouchDevice.java`, `pointer_device_android.cc` and `AccessibilityState.java`: Chromium BSD, ported in MQ-R2's Kotlin and
  in `rt-band.ts` where shared, with docs/ports.json entries and `pnpm notices:gen`.

## 3. How each target gets it

| | Web | iOS (UIKit, Core Animation) | Android (Views, minSdk 31) |
|---|---|---|---|
| @media width/height/orientation/aspect-ratio | band blocks from authored atoms; Chrome evaluates | band table plus `rt-band` (translated Swift) on root-bounds changes | the same in Kotlin, on `onSizeChanged` |
| Band change | the browser | RT-1 delta through the state program's `env#band`, then one layout | the same |
| Size change, same band | the browser | one layout with the new viewport (no restyle) | the same |
| Rotation | n/a | in place: bounds change, no view rebuild beyond the delta | in place: `configChanges`; recreation reaches the same dump |
| Transitions on size change | the browser | MQ-Rt: ANIM-b's entry point, per frame on the display driver | the same |
| env(safe-area-*) | `env()` unresolved | `safeAreaInsets` into the engine's EnvLength | `WindowInsets` / density into EnvLength |
| Environment features | band blocks | trait, accessibility and GCMouse reads | `uiMode`, ANIMATOR_DURATION_SCALE, InputDevice reads (Chromium ports) |
| @supports | folded with Chrome's answer | folded with the iOS profile answer | folded with the Android profile answer |

The compiler decides every platform difference. The device reads typed tables (atom records, band truth vectors, deltas)
and platform values; it never sees CSS text.

## 4. Proof

**MQ-R0** (host, Chrome; extends T016's corpus):
- `scripts/capture-media-data.ts` gains an **iframe harness**: each sample is an iframe of exact device px at DSF 1, 2,
  2.625 and 3. That reaches fractional media sizes (M1, M4).
- New corpus rows:
  - thresholds at ±1/64, ±1/128 and ±0.01 around whole and fractional sizes, for every operator and range form;
  - orientation and aspect-ratio at truncation edges (M3);
  - float-formula rows (M4);
  - negative values.
- Captures are committed (`captures/` is ignored by shape), with `--check` byte-identical.
- `media-sweep.ts` samples ratio bands too.
- Web fixtures: `media-orientation`, `media-aspect-ratio`, `media-epsilon` (ltr and rtl, 400x304 root), on chrome-dual and
  the media sweep.
- The R3 guard test and the R4 totality test.
- Plants: `mediaCompareExact`, `orientationUntruncated`, `aspectRatioUntruncated`, `mediaWidthDouble`,
  `emulatedSizeRounded` (round instead of ceil). Each flips a captured row or the guard.

**MQ-R1** (group `media-runtime`, ltr and rtl, roots that are multiples of 8):
1. `mqr-width-switch`: max-width 320, min-width 352 and `(width > 384px)`, with steps 400x304, 304x400, 352x304, 384x304,
   392x304.
2. `mqr-epsilon`: the R7(b) thresholds at a 320 root.
3. `mqr-orientation`: portrait, landscape and square (304x304) and `aspect-ratio: 4/3`.
4. `mqr-height`: max-height and min-height switches.
5. `mqr-state-band`: a free state × 3 bands: set, resize, set, resize back.
6. `mqr-vw-relayout`: vw/vh/% sizes, no media (the relayout-only path).
7. `mqr-nested`: nested and comma-list @media across 4 bands.
8. `mqr-music-shape`: the north star's two max-width atoms with the same overriding rules, roots scaled so 640 and 768
   become 320 and 384.
9. `mqr-rotate` (`device-env` only): R7(c).

Rejects: `reject-mqr-17-bands`, `reject-mqr-transition` (R8; asserts on either base), `reject-mqr-env-feature`.

Lanes:
- vectors: `rt-band` TS = Swift = Kotlin over atom records × sizes, including all M-rows;
- chrome-dual, the host lanes at DPR 1, and `device-states` at every device DPR: frames, applied values and pixels after
  every step;
- `device-env`: the rotation;
- the R5 oracle test: every step sequence's dump equals the final (assignment, band) per-case program at the final size.

Plants: `bandBoundaryExclusive`, `bandStale`, `resizeSkipsRelayout`, `mediaSizeFromWindow`, `rotationLosesState`,
`activityRecreated`, `bandDeltaDropped`. Each fails its own lane on the host and on device, and leaves the others passing
(T047 §5).

**MQ-Rt** (group `media-transitions`, uses ANIM-b1's frame case kind and `device-anim`):
- `mqrt-band` (M8, with the reversal);
- `mqrt-vw` (M9, including the % non-transition);
- `mqrt-app-shape` (the `.App` margin-right shape, `clamp(20rem, 22vw, 26rem)`, at the scaled breakpoints);
- frames at 0, 250 and 500 ms and settled, at every DPR.
- Plants: `bandChangeNoTransition`, `viewportUnitNoTransition`, `percentTransitionsOnResize`.

**MQ-E1:**
- fixtures `env-inset-zero`, `env-inset-nonzero` (M6 insets), `env-fallback-unknown`, `env-in-calc` and `env-max-inset`,
  captured with a per-fixture `safeAreaInsets` in the capture environment;
- reject `reject-env-unknown-no-fallback`.

**MQ-E2:**
- the `insets` step on `device-states`;
- the full-window cases in `device-env`;
- vectors with fractional insets.
- Plants: `safeAreaFromWindow`, `insetsNotDivided`, `safeAreaStale`.

**MQ-R2:**
- fixtures `mqr2-color-scheme`, `mqr2-reduced-motion`, `mqr2-pointer-hover` (touch and desktop contexts),
  `mqr2-resolution` (per DPR);
- Chrome through `Emulation.setEmulatedMedia` and contexts;
- device through a lane step `env(feature, value)` that injects the reading exactly, plus one OS toggle per platform where
  automatable (§2 R9);
- vectors for the Android pointer and hover port against the Java rule over all source combinations.
- Plants: as in R9.

**MQ-S:**
- the `CSS.supports` corpus (declarations across every Dragon property and value kind, `selector()`, logic,
  general-enclosed);
- fixtures `supports-basic`, `supports-logic`, `supports-selector` and `supports-native-fallback`, the last proven under
  the `supports-per-target` reference;
- rejects for font-tech() on native.
- Plants: as in R11.

**DPRs.** Host 1; iOS 2 (iPad (A16)) and 3 (iPhone 17); Android 2, 2.625 and 3. No tolerance, DPR, direction or case is
loosened.

## 5. Base, dependencies and order

| Package | Base | Needs on master | Lands |
|---|---|---|---|
| **MQ-R0** | origin/master 0ef8c05ee (frozen; train 1) | nothing in flight | the first train after train 1, own position (media/** has no other writer) |
| **MQ-S** | origin/master | nothing | any train after ANIM-b1 PR 2, so ANIM-b1 is not rebased (shared at-rules.ts, stylesheet.ts, project.ts hunks) |
| **MQ-E1** | origin/master | nothing | any train; it touches capture.ts and chrome.ts with additive environment hunks only |
| **MQ-R1** | review/mq-r0 (MQ-R0's clean head), then master once MQ-R0 and seld-lanes-v2 merge | MQ-R0, seld-lanes-v2 (queue item 2); host work may start on MQ-R0 merged locally with seld-lanes (never pushed), as ANIM-b1 PR 3 does | own train position with a device run |
| **MQ-Rt** | master | MQ-R1 and ANIM-b1 PR 3 | after both |
| **MQ-E2** | master | MQ-R1 (the listener and record) and MQ-E1 | after both |
| **MQ-R2** | master | MQ-R1; PNT1 (T072/T115) for the colour-scheme bit | after PNT1's train |

- **Shared files**, additive hunks only (RT-13, plus the T099 pattern):
  - generate.ts, corpus.ts, harness.ts, targets.ts, lanes.ts, device-lanes.ts, device-jobs.ts, native-host.ts,
    native-dump.ts, capture.ts, chrome.ts, fixtures.ts, native-support.ts, runtime/index.ts, internal.ts, at-rules.ts,
    stylesheet.ts, project.ts, web-css.ts, faults.ts, codes.ts, catalogue.ts, docs/ports.json, scripts/regen.ts,
    package.json.
- **Named non-additive hunks** (the PM confirms no other in-flight writer at dispatch):
  - native-host.ts `androidManifest()`: the activity line (`configChanges`, `screenOrientation`);
  - native-host.ts, the iOS host bootstrap: the lane's orientation request and restore;
  - native-support.ts `environmentArgs`: it takes the live environment instead of the literal;
  - project.ts 765-790: the MQ-R refusal becomes profile-driven;
  - at-rules.ts `mediaAtRule`: the `why` text.
- **`emit/runtime/state.ts`** is edited by SELD-R1/R2, PNT1, PNT2 and ANIM-b. MQ-R1 edits it only in two named hunks: the
  mount takes an environment (size and band), and a new `resize` script step. Everything else is in `emit/runtime/media.ts`.
- **Against other work:**
  - MQ-R0 and MQ-S run alongside everything.
  - MQ-R1 runs alongside ANIM-b1 and the PNT stacks (state.ts hunks only).
  - MQ-R1 must not be in flight with V2b. That holds trivially, since V2b now goes after MQ-R1.
  - KBD stays after V2b and MQ-R1.

## 6. Worker packages

ENV is the literal prefix `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`.
BASE is the recorded base sha. Heavy steps run under `/tmp/heavy-lease.sh`; device steps run under `/tmp/device-lease.sh`.
C1 to C6 are T047 §3's common verify items.

**Common to every package:**
- no push, remote or install outside /tmp;
- notes only in the main checkout;
- `design/` untouched;
- generated files regenerated, never hand-edited;
- no tolerance, gate, case, DPR or direction loosened;
- pinned tests may be retargeted under the Throughput rule, and each retarget is listed in the receipt;
- regenerated outputs go in their own commit, named after the command that produced them.

### 6.1 MQ-R0: Chrome-exact media evaluation, orientation and aspect-ratio

Worktree `/tmp/dragon-mq-r0`, branch `mq-r0-exact`.

**allowed_files:**
- `packages/dragon/src/media/**`;
- `packages/dragon/test/media/**`;
- `scripts/capture-media-data.ts`;
- `packages/dragon/src/css/at-rules.ts` (the `mediaAtRule` hunk only);
- `packages/parity/src/media-sweep.ts`, `packages/parity/src/cli/media-sweep.ts`, `packages/parity/test/media-sweep.test.ts`;
- `packages/parity/src/fixture-groups/media.ts` (append);
- `packages/parity/fixtures/media-{orientation,aspect-ratio,epsilon}*.html` (new);
- new files only under `packages/parity/expected*/**`, `packages/parity/expected-media/**`, `packages/layout/vectors/**`
  and `packages/parity/emitted/**`;
- `packages/dragon/test/media-guard.test.ts` (new: R3 guard, R4 totality);
- `packages/dragon/src/profiles/*.ts` (regenerated);
- `packages/dragon/src/faults.ts` (append);
- `docs/ports.json` and `THIRD_PARTY_NOTICES.md` (reference entries);
- derived-count pins;
- `packages/parity/out/lanes.json`;
- `examples/music-player/dragon/north-star-check.json` (regenerated; expected unchanged).

**verify:**
1. C1.
2. `ENV node --conditions=dragon-internal scripts/capture-media-data.ts --check`: exit 0, with the M1-M5 rows present.
3. Every existing media capture row is unchanged. The corpus additions are new rows only.
4. C4 and C5.
5. `media-sweep` and `media-sweep --check`: all equal.
6. `parity:report` and `parity:dpr-report`: failed 0.
7. `profile:rows`: only additions (web orientation and aspect-ratio).
8. The R3 guard and the R4 totality tests pass.
9. The 5 plants are each caught, and T016's 5 media plants are still caught.
10. `north-star:check`: byte-identical summary.
11. C6.

**stop_if:**
- A corpus row disagrees with R2 or R3 after the Blink source at the tag is re-read.
- The R3 guard finds a committed fixture whose band differs by DPR.
- Any existing emitted file or capture changes.
- More than 16 bands for any committed fixture.
- A file outside allowed_files is needed.
- Verification fails twice.

### 6.2 MQ-R1: bands on device, switched on resize and rotation

Worktree `/tmp/dragon-mq-r1`, branches `mq-r1-compiler` (PR 1) and `mq-r1-runtime` (PR 2).

**allowed_files:**
- `packages/layout/src/rt-band.ts`, `packages/layout/test/rt-band.test.ts` and `packages/layout/rt-vectors/band/**` (new);
- `packages/dragon/src/lower/band-program.ts` (new);
- `packages/dragon/src/lower/state-program.ts` (the `env#band` variable, an additive hunk);
- `packages/dragon/src/emit/runtime/media.ts` (new);
- `packages/dragon/src/emit/runtime/state.ts` (the two named hunks);
- `packages/dragon/src/emit/runtime/index.ts` (append);
- `packages/dragon/src/emit/native-support.ts` (`environmentArgs` and the record hunks);
- `packages/dragon/src/project.ts` (the profile-driven refusal hunk; every band resolved for native);
- `packages/dragon/src/css/at-rules.ts` (the `why` text);
- `packages/dragon/src/faults.ts`, `diagnostics/catalogue.ts` and `test/diagnostic-codes.json` (append);
- `packages/dragon/test/media-runtime.test.ts` and `band-program.test.ts` (new);
- `packages/dragon/src/profiles/*.ts` (regenerated);
- the RT-13 hunks;
- `packages/parity/src/resize-capture.ts` (new), `packages/parity/src/band-oracle.ts` (new; R7(c));
- `packages/parity/src/state-cases.ts` (the `resize` step);
- `packages/parity/src/native-host.ts` (the named hunks);
- `packages/parity/src/native-dump.ts` (the environment record, a schema bump);
- `packages/parity/src/fixture-groups/media-runtime.ts` (new), `packages/parity/src/fixtures.ts` (one import and one
  concatenation);
- `packages/parity/fixtures/mqr-*.html` and `reject-mqr-*.html` (new);
- new files only under `packages/parity/expected*/**`, `packages/layout/vectors/**` and `packages/parity/emitted/**`;
- `packages/parity/test/media-runtime-*.test.ts` and `dump-environment.test.ts` (new);
- derived-count pins;
- `packages/parity/out/lanes.json`;
- regenerated generated and corpus files;
- `docs/ports.json`;
- `examples/music-player/dragon/north-star-check.json` (regenerated);
- `package.json` (one script hunk).

**verify:**
1. C1.
2. C4, including the resize traces twice, byte-identical.
3. C5. Existing dumps compare equal apart from the environment record key.
4. `parity:report` and `parity:dpr-report`: failed 0.
5. C2 and C3.
6. `native:swift`, `native:kotlin` and `native:planted`, with the rt-band vectors equal.
7. `native:build` for both targets.
8. Both leases: `parity:lanes -- --run-host --run-device`. The `media-runtime` scripts pass `device-states` frames, applied
   values and pixels at every device DPR. `device-env` passes the rotation on every device: landscape root px, band equal
   to the band oracle, the same state, frames equal to the engine, and back to portrait.
9. Every existing case still runs portrait, with failures files byte-identical to master's.
10. The 7 plants are caught on host and device.
11. `north-star:check`: 0 target-scoped DRAGON_UNSUPPORTED_AT_RULE, and the §8 delta exactly.
12. `profile:rows`: only additions.
13. WPT: no pass becomes a fail.
14. C6.

**stop_if:**
- seld-lanes-v2 is not on master at the device step. Finish host work and report "device step pending".
- No device can hold a resize size (never crop).
- The simulator cannot rotate through `requestGeometryUpdate`, or the emulator cannot without recreating the activity.
  Report with the logs; do not substitute a resize.
- Chrome's band at a boundary disagrees with R2 after the source is re-read.
- An existing output changes beyond the dump-schema key.
- A non-additive edit outside the named hunks.
- The lease is not held.
- A file outside allowed_files is needed.
- Verification fails twice.

### 6.3 MQ-Rt: transitions on size changes

Worktree `/tmp/dragon-mq-rt`, branch `mq-rt-transitions`.

**allowed_files:**
- `packages/dragon/src/emit/runtime/media.ts`;
- `packages/dragon/src/lower/band-program.ts` (lift the refusal);
- ANIM-b's entry point call site in `emit/runtime/anim.ts` (a call only);
- `packages/parity/src/fixture-groups/media-transitions.ts` (new), `packages/parity/src/fixtures.ts` (append);
- `packages/parity/fixtures/mqrt-*.html` (new) and their frame sidecars;
- new expected and vector files only;
- `packages/parity/test/media-transitions.test.ts` (new);
- `faults.ts` (append);
- profiles (regenerated);
- `packages/parity/out/lanes.json`;
- `examples/music-player/dragon/north-star-check.json`.

**verify:**
- C1 to C6;
- `anim-capture` and `anim-report` with the resize steps: M8 and M9 numbers bit-equal;
- `device-anim` passes at every DPR, with two runs byte-identical;
- the 3 plants are caught;
- `north-star:check`: the MQ-Rt errors are gone.

**stop_if:**
- ANIM-b's entry point needs a change beyond a call.
- A Chrome frame disagrees after the Blink source (`css_animations.cc`) is read.
- The usual lease, file and verification stops.

### 6.4 MQ-E1 and MQ-E2: env(safe-area-*)

Worktree `/tmp/dragon-mq-e`, branches `mq-e1-env` and `mq-e2-insets`.

**allowed_files, E1:**
- `packages/dragon/src/css/env.ts` (new);
- `css/units.ts` (the env entry);
- `css/math.ts` (the env() hunk);
- `emit/web-css.ts` (env serialisation);
- `lower/ios-layout.ts` (EnvLength emission);
- `packages/parity/src/chrome.ts` and `capture.ts` (the additive `safeAreaInsets` environment field);
- fixtures `env-*.html` and `reject-env-*.html`, `fixture-groups/env.ts`, `fixtures.ts` (append);
- `packages/dragon/test/env.test.ts` (new);
- a retarget of `values-reject-env` to a still-refused env name;
- catalogue, faults and codes (append);
- profiles;
- new expected files;
- ports.json.

**allowed_files, E2:**
- `emit/runtime/media.ts` (the insets read);
- `native-support.ts` (the record hunk);
- `state-cases.ts` (the `insets` step);
- the native-host.ts full-window case hunk;
- `packages/parity/test/env-device.test.ts`;
- `out/lanes.json`.

**verify:**
- C1 to C6;
- the M6 numbers captured twice, byte-identical;
- `device-states` and `device-env` at every DPR;
- the V2a plant `safeAreaIgnored` and E's 3 plants are caught;
- `profile:rows` additions only.

**stop_if:**
- A device inset is not a whole CSS px and has no vector proof.
- The usual stops.

### 6.5 MQ-R2: environment features

Worktree `/tmp/dragon-mq-r2`, branches `mq-r2-scheme-motion` and `mq-r2-pointer-resolution`.

**allowed_files:**
- `media/features.ts` (move the 8 features from refused to evaluated);
- `media/**`;
- `rt-band.ts` (the environment atoms);
- `emit/runtime/media.ts` (platform reads and listeners);
- `native-host.ts` (`uiMode` in `configChanges`; the OS-toggle lane hooks);
- `state-cases.ts` (the `env` step);
- the PNT1 `usedColorScheme` hunk, named;
- the fixture group `media-environment`;
- fixtures `mqr2-*`;
- `capture.ts` (emulated media, an additive field);
- tests, profiles, ports.json, faults and catalogue.

**verify:** C1 to C6; the R9 labels in `profile:rows`; the Android port's vectors over every source combination; the
device-env OS toggles on both platforms; the plants.

**stop_if:**
- An OS toggle cannot be automated: label the row caveat and report, but never mark it exact.
- PNT1 is not on master.
- The usual stops.

### 6.6 MQ-S: @supports per target

Worktree `/tmp/dragon-mq-s`, branch `mq-s-supports`.

**allowed_files:**
- `css/supports.ts` (new);
- `css/at-rules.ts` (the supports line and the conditional outcome kind);
- `css/stylesheet.ts` (`Rule.condition` gains a supports kind; nesting with @media);
- `project.ts` (a per-target rule filter in `rulesIn`);
- `emit/web-css.ts` (fold);
- `scripts/capture-supports-data.ts` and `packages/dragon/test/supports/**` (new);
- the `supports-*` fixtures, group and expected files;
- `packages/parity/src/reference-policy.ts` (the `supports-per-target` policy; new);
- catalogue, faults and codes;
- profiles;
- `docs/api.md` §7.1 (one paragraph naming the policy).

**verify:**
- C1 to C6;
- the corpus `--check`;
- chrome-dual on the web answer;
- native under the policy reference at every DPR (host and device lanes for the new fixtures);
- the plants;
- `north-star:check` unchanged.

**stop_if:**
- Dragon's answer differs from `CSS.supports` on a corpus row it does not refuse.
- The usual stops.

## 7. PR split (each reviewed diff under about 150 KB; generated output is ignored by shape)

| PR | Branch | Content | Est. reviewed | Review base |
|---|---|---|---|---|
| 1 | mq-r0-exact | evaluator rules, ratio partition, iframe harness, corpus rows, sweep, guard and totality tests, web fixtures | ~70 KB | master |
| 2 | mq-r1-compiler | band-program, `env#band` in the state program, rt-band and vectors, the profile-driven refusal, the R8 refusal, resize-capture, band oracle, fixtures, tests | ~120 KB | review/mq-r0-exact |
| 3 | mq-r1-runtime | runtime/media.ts (Swift and Kotlin glue), state.ts hunks, environment record, host hunks, the `resize` step, `device-env`, tests | ~100 KB | review/mq-r1-compiler |
| 4 | mq-rt-transitions | the call, the refusal lift, fixtures and tests | ~40 KB | master |
| 5 | mq-e1-env | compiler env(), web, capture insets, fixtures | ~60 KB | master |
| 6 | mq-e2-insets | native insets, steps, full-window cases | ~50 KB | master |
| 7, 8 | mq-r2-scheme-motion, mq-r2-pointer-resolution | features, reads and ports, fixtures | ~80 KB each | master |
| 9 | mq-s-supports | @supports | ~90 KB | master |

PRs 2 and 3 land in one train, so master never has native band tables without the runtime.

## 8. North-star delta (examples/music-player/dragon/north-star-check.json; on master's numbers, M11)

- **MQ-R0, MQ-S, MQ-E1, MQ-E2, MQ-R2:** no change. The demo uses none of their features. MQ-R0 must leave the file
  byte-identical.
- **MQ-R1:**
  - `DRAGON_UNSUPPORTED_AT_RULE [ios]` 2 → 0 and `[android]` 2 → 0;
  - `summary.errors` 343 → 339; perTarget ios and android errors −2 each; web unchanged;
  - supportedIos and supportedAndroid 172 → 183, supportedBothTargets 172 → 183, supportPercent 59.1 → 62.9;
  - no other count rises. The target-less `@keyframes` AT_RULE stays until ANIM-b1.
- **MQ-R1 together with ANIM-b1** (whichever is second): +1 `[ios]` and +1 `[android]` DRAGON_UNSUPPORTED_VALUE, the R8
  refusal on `.App`'s `transition: margin-right` (the band changes it in `library-active`, and `clamp(20rem, 22vw, 26rem)`
  depends on vw). No other demo transition qualifies: `.library` transitions opacity and a %-based transform, and
  `.play-control button` and `.library-button` are not changed by a band.
- **MQ-Rt:** those 2 errors go. No media or animation diagnostic is left on any target.
- **Landscape cases.** The landscape north-star device cases (T018) come after MQ-Rt. The landscape stage on iPhone 17 is
  about 750 CSS px wide inside its safe area, which is the 640-768 band, not the >768 band. The worker records the measured
  value in the rotation dump.

## 9. Board updates for the PM

1. **T067:**
   - Replace the card with MQ-R0, MQ-R1 (2 PRs), MQ-Rt, MQ-E1, MQ-E2, MQ-R2 (2 PRs) and MQ-S, with the §5 order.
   - MQ-R0, MQ-S and MQ-E1 can start now. MQ-R1 starts after MQ-R0 is host-done (stacked).
   - "After T065 and T027" is replaced by §5.
   - Record R1-R14 in decisions.md under "Runtime styles and animation", and the R11 policy in api.md §7.1.
2. **T027 (V2b):**
   - Narrow to text-scale tables, scaled-root captures, viewport fixture sets and oversize device provisioning.
   - Add `rootFontSize` to MQ-R1's listener and environment record.
   - Order: after MQ-R1. KBD stays after V2b and MQ-R1.
   - New question for V2: does Chrome's vw use the float R3 value? (V2a uses double root bounds.)
3. **T016/T030 finding:** MQ-a's evaluator was exact at integers only. MQ-R0 fixes it. No committed output changes.
4. **T065a:** whichever of ANIM-b1 PR 2 and MQ-R1 merges second carries the R8 refusal hunk.
5. **T019:** queue MQ-R3 (the other environment features), MQ-R4 (more than 16 bands), MQ-E3 (native max insets) and
   MQ-S2 (font-tech/font-format on native).
6. **T018:** add the landscape NS cases after MQ-Rt. iPhone landscape is the middle band (§8).
7. **T072/T115 (PNT1):** `color-scheme: light dark` gets its OS answer from MQ-R2's environment bit; PNT1 keeps its
   compile-time behaviour until then.

## 10. Size and risk

- **Size:**
  - MQ-R0: S-M, ~70 KB.
  - MQ-R1: L, ~220 KB over 2 PRs, plus one device run.
  - MQ-Rt: S.
  - MQ-E1 and MQ-E2: M together.
  - MQ-R2: M-L.
  - MQ-S: M.
  - In total about 660 KB reviewed over 9 PRs.
- **Risk: medium.**
  - The numerics are pinned: M1-M5 settle every comparison, and the evaluator change is small.
  - **The real risks are on the device side:**
    - simulator and emulator rotation automation (`requestGeometryUpdate` on the simulator runtime; `configChanges` on the
      emulator, where the host is locked portrait today);
    - state.ts, shared by five lineages;
    - the environment-record schema bump across every dump;
    - device time: one `device-env` rotation per device, plus resize scripts on `device-states`.
  - MQ-R2's iOS rows have no Chrome on iOS, so they are caveat by design.

## Receipt

**Spec:** /tmp/specs/T067.md

**R-rulings:**
- R1: the card's order is not needed. T030 is done. T065 is needed only for size-triggered transitions (refused until
  MQ-Rt). Of T027, only the root-size read and listener are needed, and MQ-R1 takes them. Seven packages: MQ-R0, MQ-R1,
  MQ-Rt, MQ-E1, MQ-E2, MQ-R2, MQ-S.
- R2: media comparisons are Chrome's. ≤, ≥ and = use 1/64 slack; < and > are exact; orientation and aspect-ratio use
  truncated integer sizes; a square is portrait (M2, M3). This fixes MQ-a's integer-only exactness.
- R3: the media size is `fround(fround(px) * fround(1/dpr))` of the root's whole device px; Chrome's emulated frame is
  ceil(DIP·dpr) (M4, M5). Lane sizes are multiples of 8, and a guard covers the existing 400x300 fixtures.
- R4: bands are a table of atom truth vectors, with orientation and aspect-ratio as a ratio factor. `rt-band` looks the
  vector up on device. The cap stays at 16, and a totality test covers it.
- R5: a size change re-runs layout; a band change is an RT-1 delta through an internal `env#band` state variable; one event
  and one layout. The oracle is the (assignment, band) per-case program at the final size.
- R6: the environment is the Dragon root view's bounds and insets. Rotation happens in place (Android `configChanges`, iOS
  bounds); recreation must give the same dump; the dump gains an environment record.
- R7: proof is `resize` scripts against Chrome resize traces at every DPR, 1/64 thresholds at whole sizes, and one real
  rotation per device in `device-env`, judged against the engine plus a Chrome iframe band oracle.
- R8: size changes start transitions in Chrome, both band and vw changes (M8, M9). MQ-R1 refuses them on native, and MQ-Rt
  wires them into ANIM-b's R4 entry point.
- R9: width, height, orientation, aspect-ratio, resolution and colour scheme are exact on both platforms. Reduced motion is
  exact on Android (Chromium port) and caveat on iOS. Pointer and hover are exact on Android (Chromium port) and on iPhone,
  and caveat on iPad. The rest is refused (MQ-R3).
- R10: env(safe-area-*) is accepted, with nonzero insets Chrome-provable through setSafeAreaInsetsOverride (whole px) (M6).
  Native reads the root view's insets; max insets are web-only.
- R11: @supports is a build-time fold per target: web uses Chrome's answer, native uses Chrome's answer AND a profile row.
  A differing native answer is proven under a `supports-per-target` reference policy (api §7.1).
- R12: the code lives in rt-band.ts, band-program.ts, runtime/media.ts, css/env.ts and css/supports.ts, with RT-13 hunks
  plus five named hunks.
- R13: the support facts become profile rows (at-rule, media-feature, env and supports), and the "until MQ-R" literals are
  retired.
- R14: media_query_evaluator.cc and local_frame_view.cc (LGPL) are reference-only from measurements; the Chromium BSD
  Android pointer and reduced-motion code is ported with registry entries.

**Open questions for the owner:** none. Every item is settled by a Chrome measurement (M1-M11), Blink or Chromium source at
the tag, or decisions.md and api.md precedent, for the PM to rule.
