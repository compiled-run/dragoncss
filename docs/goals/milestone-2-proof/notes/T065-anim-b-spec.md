# T065 ANIM-b: transitions, @keyframes, animation and play-state, binding worker spec (Judge, 2026-10-03)

This supersedes notes/T047-runtime-spec.md §3.5 wherever the two differ, and keeps everything in it that is not changed
here. It also folds in the T096 owner request (clean-room technique fixtures and the motion proof method) and says what
T097 (YUI-1) reuses. Read-only review: nothing in the repo was changed. Chrome probes and fetched Chrome sources are in
/tmp/t065-probe (probe1.mjs to probe5.mjs) and /tmp/t065-src.

**Read:**
- AGENTS.md; goal.md for milestone 1 (design principles) and milestone-2-proof (Decision Rule, Throughput, landing queue,
  trains); PM-2026-10-01.md (freeze, trains 1 to 4, review/** bases, PNT1 8-PR split);
- docs/research/coverage-roadmap.md: the ANIM row (usage transition 79.7%, @keyframes 81.2%, animation 68.9%), §4, §5;
- docs/decisions.md: "Runtime styles and animation (T047)", decision 17, "Paint (T046)", "Adding engine fields",
  "Porting Chrome's algorithms", "How decisions are made"; docs/ports.md;
- state.yaml cards T047, T061, T062, T063/T134, T064/T146, T065, T066, T067, T072/T115, T073, T096, T097;
- notes T047 (RT-1 to RT-13, §3.5, amendments T063J and T064J), T061 (ANIM-a), T062 (ANIM-a2), T096, T046 §1 and §5;
- examples/music-player: styles.css, north-star-check.json, tools/capture-chrome.ts, lane-manifest.ts, README §Deterministic frames;
- master 0d04dc09a: `packages/layout/src/rt-{easing,timing,interpolate}.ts`, `lower/state-program.ts`, `emit/runtime/{clock,state,index}.ts`,
  `parity/src/state-cases.ts`, `native-host.ts`, `css/{properties,at-rules,stylesheet}.ts`, `emit/web-css.ts`, `project.ts`,
  `diagnostics/catalogue.ts`, `scripts/regen.ts`, `.macroscope/ignore.md`;
- branches anim-a2-translate (merged as #50), seld-r1a (#53), seld-r1 (#75), seld-lanes, seld-r2a/b/c, pnt2-engine-v2,
  pnt2-compiler-v2, pnt2-v2 (#70, #73, #74), pnt1-opacity (#84), pnt1-foreground-v3 (#87);
- Chrome 145.0.7632.6 sources (fetched from gitiles at the tag): `core/animation/css/css_animations.cc`,
  `css_transition_data.cc`, `css_timing_data.cc`, `css_animation_data.cc`, `css_keyframe_effect_model.cc`,
  `core/animation/{animation.cc,animation_time_delta.h,interpolation_effect.cc,keyframe_effect_model.cc}`,
  `core/css/css_properties.json5`.

## 0. Facts that shape the spec

**What the music player uses** (master north-star-check.json, 343 errors: web 163, ios 199, android 199):

| Line | Rule | Declaration | Today |
|---|---|---|---|
| 67 | `.App` | `transition: margin-right 0.5s ease` | UNSUPPORTED_PROPERTY |
| 97 | `.library-button` | `transition: all 0.3s ease` (hover: background, border-color, color) | UNSUPPORTED_PROPERTY |
| 145, 146 | `.record` | `animation: album-spin 20s linear infinite`; `animation-play-state: paused` | UNSUPPORTED_PROPERTY ×2 |
| 164 | `.record.rotating` | `animation-play-state: running` | UNSUPPORTED_PROPERTY |
| 338 | `.play-control button` | `transition: color 0.2s ease, transform 0.2s ease` (hover: `scale(1.08)`) | UNSUPPORTED_PROPERTY |
| 373 | `.library` | `transition: opacity 0.5s ease, transform 0.5s ease` (`translateX(100%)` to `0%`, opacity 0 to 1) | UNSUPPORTED_PROPERTY |
| 488 | `@keyframes album-spin` | `from { transform: rotate(0deg) } to { transform: rotate(360deg) }` | UNSUPPORTED_AT_RULE (+ PROPERTY on the two inner declarations until PNT2) |

That is 8 errors (7 PROPERTY, 1 AT_RULE), each counted once in `summary.errors` and once per target. `will-change: transform`
(line 302) is accepted by PNT2 (pnt2-v2 `css/properties/transform.ts`), so it is not ANIM-b's (this corrects T047 §3.5 verify 14).
In portrait both phones match `max-width: 768px`, where `.App.library-active` sets `margin-right: 0`, so the margin transition
only runs in landscape (MQ-R).

**What master has.**
- ANIM-a and ANIM-a2: `rt-easing.ts`, `rt-timing.ts`, `rt-interpolate.ts` are translated roots, bit-exact against 54,588 Chrome
  samples, on device in `p1/rt`. They have no keyframe segments, no transition update, no animation-list update, and no
  value-range clamp (`interpolateLengthProperty` does not clamp).
- SELD-R1a: per-case programs, `StateDelta`, typed setters, the virtual clock. `advance(ms)` only adds to `clock.now`, which
  nothing reads. `DragonStateMount.render()` rebuilds the whole tree on every state change and lays it out from precomputed
  `LayoutVariant` roots. There is no per-frame write path and no per-frame layout input.
- The device-states lane and the case-script runner are on seld-lanes (not on master). `tap` is on seld-r1 (#75, train 1).
- `emit/web-css.ts` writes resolved values per element; a refused at-rule produces no web output at all.
- Writers: `dragonSetOpacity` (pnt1-opacity `emit/paint/effects.ts`) and `dragonSetTransform` (pnt2-compiler-v2
  `emit/paint/transform.ts`, "the entry point a runtime write calls too") are runtime-callable. Both PNT stacks refuse
  opacity and transform writes inside state programs ("cannot write opacity yet", "a transform in a state program has no
  state-node write").

**Chrome measurements** (Chrome 145.0.7632.6, Playwright 1.58.2, `Animation.setPlaybackRate(0)` before load; scripts in
/tmp/t065-probe):

| # | Probe | Result |
|---|---|---|
| M1 | `currentTime = x` then read, for 1000/60, 1000/120, 16.7, 0.1, 5000, 1e7/3 | round-trips exactly |
| M2 | 60 steps of `currentTime = currentTime + 1000/60` | 999.9999999999991, not 1000 |
| M3 | `document.timeline.currentTime` under rate 0 | 0 at every step |
| M4 | parent `transition: color 1s linear` held at 250 ms | parent and child both `rgb(64, 0, 0)` (the child inherits the animated value) |
| M5 | library open held at 250 ms, then closed | opacity 0.802403, `matrix(1,0,0,1,39.5193,0)`; reversed transitions have duration 401.20169552992184 ms (bits 4079133a25178c38) and start keyframes `0.802403` and `translateX(19.7597%)` |
| M6 | width transition mid-flight, then `display: none`, then back | transition gone; back at 200px with no transition |
| M7 | CSS animation, `display: none` then back | a new animation object at currentTime 0 |
| M8 | `transition: all 0.3s ease` over the library-button hover values | transitions: background-color and the 4 border colours and color; at 150 ms the child span's color equals the parent's |
| M9 | `width: auto` to `100px` | no transition |
| M10 | `translateX(10px)` to `rotate(45deg)` | Chrome transitions by matrix (`matrix(0.92388, …, 5, 0)` at 500 ms) |
| M11 | a transform transition on an element with a running transform animation | no transition (`CSSAnimation:spin` only) |
| M12 | `to { transform: rotate(360deg) !important }` | the declaration is dropped; the `to` keyframe takes the element's current underlying `translateX(50px)` |
| M13 | two `@keyframes dup` | the last one wins |
| M14 | `animation-name` naming no `@keyframes` | no animation |
| M15 | `animation-duration` changed on a running animation held at 300 ms | same object, currentTime 300, duration 4000 |
| M16 | `animation-name` changed, script-paused animation | the old animation is **kept** (paused) beside the new one |
| M17 | `animation-name` changed, not script-paused | the old animation becomes idle; the new one starts at 0 |
| M18 | parent and child both `transition: color`, parent changes | the child starts its own transition (0 to 200 at 250 ms gives 50) |
| M19 | `transition: opacity 1s linear 500ms` at 250 ms; `-500ms` at 0 | 0 (backwards fill); 0.5 with duration still 1000 |
| M20 | `@keyframes part { 50% { opacity: 0 } }` | keyframes `[0,1,linear] [0.5,0,linear] [1,1,linear]` (neutral ends from the underlying value) |
| M21 | `from { animation-timing-function: steps(2, end) }` at 400 ms | 0; keyframe easing `steps(2)`, effect easing `linear` |
| M22 | 0 to 1, held at 250 ms, then to 0.5 | new transition from `0.25` to `0.5`, duration 1000 |
| M23 | `transition: none` set mid-flight | transition cancelled, value jumps to the end (`1`) |
| M24 | `CSS.forcePseudoState` hover on an element with `transition: color 1s linear` | starts a transition (`rgb(100,100,100)` at 500 ms) |
| M25 | play-state paused at creation; set currentTime 5000; switch to running; +1000; switch to paused | 5000 kept on resume (startTime -5000); 6000 gives `matrix(-0.309017, 0.951057, …)` (108deg); paused holds 6000 |
| M26 | `cubic-bezier(.5,-1,.5,2)` from 2px to 50px at 100 ms (progress -0.156) | padding-left `0px`, width `0px`, margin-left `-5.49445px`, opacity and colour clamped |

## 1. Scope

### Supported

- **Properties.** `transition`, `transition-property`, `transition-duration`, `transition-timing-function`, `transition-delay`,
  `transition-behavior: normal`; `animation`, `animation-name`, `animation-duration` (including `auto` = 0s),
  `animation-timing-function`, `animation-delay`, `animation-iteration-count` (including `infinite` and fractions),
  `animation-direction`, `animation-fill-mode`, `animation-play-state`; and the reset-only longhands of the Chrome 145 shorthand
  at their initial values only: `animation-timeline: auto`, `animation-range-start: normal`, `animation-range-end: normal`,
  `animation-composition: replace`. Lists repeat as Chrome repeats them (`CSSTimingData::GetRepeated`).
- **Timing functions.** `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier()` (y outside [0, 1]
  included), `steps()` with every jump keyword, `step-start`, `step-end` (all already in rt-easing).
- **`@keyframes`** at top level: `from`, `to` and percentage selectors, selector lists, duplicate offsets, partial keyframes
  (neutral ends), per-keyframe `animation-timing-function`, duplicate names (last wins).
- **Triggers.** State setters (SELD-R1a), and in ANIM-b2 the interaction states (SELD-R2a) and the forced-pseudo hook.
  The entry point takes an old and a new program, so MQ-R and SOV call it unchanged later.
- **Animated properties** (R13): ANIM-b1 admits the colour family (`color`, `background-color`, `border-*-color`) and the
  length family (`margin-*`, `padding-*`, `width`, `height`, `min-*`, `max-*`, `top`, `right`, `bottom`, `left`,
  `row-gap`, `column-gap`). ANIM-b2 admits `opacity` and `transform`.
- **Targets.** web, ios, android, at DPR 1 (host), 2, 2.625 and 3, ltr and rtl where geometry depends on direction.

### Refused (each has a reject fixture)

| Case | Code | Message (shape) | Named package |
|---|---|---|---|
| `linear()` easing | DRAGON_UNSUPPORTED_VALUE | `transition-timing-function: linear(…) is unsupported: linear() easing is not built yet (package ANIM-L)` | ANIM-L |
| `transition-behavior: allow-discrete` | DRAGON_UNSUPPORTED_VALUE | `… discrete transitions are not built yet (package ANIM-d)` | ANIM-d |
| `animation-composition` other than `replace`, and keyframe `composite` | DRAGON_UNSUPPORTED_VALUE | `… (package ANIM-c)` | ANIM-c |
| `animation-timeline` other than `auto`, `animation-range*` other than `normal`, timeline-range keyframe selectors | DRAGON_UNSUPPORTED_VALUE | `… scroll and view timelines are not built yet (package ANIM-S)` | ANIM-S (T019) |
| `@keyframes` inside `@media` or any conditional group | DRAGON_UNSUPPORTED_AT_RULE | `@keyframes inside @media is not supported (package MQ-R)` | MQ-R |
| `!important` inside a keyframe | DRAGON_UNSUPPORTED_IMPORTANT | the existing message, plus `Chrome ignores it inside @keyframes` | none (author error) |
| A property Chrome ignores inside keyframes (`valid_for_keyframe: false`, other than `animation-timing-function`) | DRAGON_UNSUPPORTED_PROPERTY | `<p> has no effect inside @keyframes in Chrome; remove it` | none |
| CSS-wide keywords (`inherit`, `initial`, `unset`, `revert`, `revert-layer`) in a keyframe | DRAGON_UNSUPPORTED_VALUE | `… (package ANIM-k)` | ANIM-k |
| A keyframe value that resolves differently on two elements using the same `@keyframes` (for example `var()` with different custom properties) | DRAGON_UNSUPPORTED_VALUE | `… one @keyframes resolves to different values on <a> and <b> (package ANIM-v)` | ANIM-v |
| A transition that a reachable state pair would start, or a keyframe property, on a property that is not admitted for the target (R13) | DRAGON_UNSUPPORTED_VALUE `[target]` | `<p> cannot be animated on <target> yet (package ANIM-p)`, or `ANIM-b2` for opacity and transform before ANIM-b2 | ANIM-p, ANIM-b2 |
| A transition and an animation on the same element and property in any reachable state (R12) | DRAGON_UNSUPPORTED_VALUE | `… Chrome blocks transitions on animated properties (package ANIM-o)` | ANIM-o |
| An interpolating pair with a `currentcolor` endpoint and a non-`currentcolor` endpoint | DRAGON_UNSUPPORTED_VALUE | `… (package ANIM-cc)` | ANIM-cc |
| A transform pair that needs matrix interpolation (M10), in a transition or between keyframes (ANIM-b2) | DRAGON_UNSUPPORTED_VALUE | `… mismatched transform functions need matrix interpolation (package ANIM-m)` | ANIM-m |
| A state pair that changes duration, delay, iteration count or direction of a same-named animation whose iteration count is finite (R11) | DRAGON_UNSUPPORTED_VALUE | `… (package ANIM-t)` | ANIM-t |
| `@starting-style`, view transitions, `::view-transition-*`, `animation-trigger` | existing at-rule, property and selector refusals | unchanged | VT, ANIM-s |

**Accepted with a warning** (new code `DRAGON_ANIMATION_NO_EFFECT`, severity warning, appended): an `animation-name` with no
`@keyframes` (M14), and a `transition-property` identifier that is not a property. Both compile to what Chrome does, which is
nothing. A fixture proves each.

**Not in scope:** DOM animation events (Dragon emits no script), `prefers-reduced-motion` (MQ-R2), the compositor offload
(RT-2), `will-change` (PNT2), opacity, transform, border-radius, box-shadow and outline writes in state programs other than
the opacity and transform writes ANIM-b2 lifts (board gap SELD-P, §11).

## 2. Rulings

**R1. Two packages, ANIM-b1 and ANIM-b2.** The north-star motions are transform and opacity, whose writers are on PNT2
(train 4) and PNT1 (the last train). Everything else in ANIM-b (the numerics, the compiler, the runtime, the lane) needs
neither. So:
- **ANIM-b1:** rt roots, compiler, web output, native runtime, display and virtual drivers, the frame case kind and lane,
  colour and length properties, all timing behaviour, all refusals. It proves the whole runtime on colour and layout motion.
- **ANIM-b2:** opacity and transform admission through the PNT writers, state-program writes for both, hover-triggered
  transitions through SELD-R2a, ANIM-m, the demo-shaped fixtures and the remaining T096 technique fixtures.
- Evidence: §0 (writer locations), the landing order (train 1, REPL-a, FORM-a, INL1a, PNT2, PNT1), and coverage-roadmap §4
  (one owner per hotspot). Basing all of ANIM-b on the PNT stacks would hold the runtime behind the last train.

**R2. The lane clock is Blink's held-time arithmetic, per animation.** Blink stores time as double seconds:
`ANIMATION_TIME_DELTA_FROM_MILLISECONDS(x)` is `x / 1000.0` and `InMillisecondsF()` is `delta_ * 1000`
(animation_time_delta.h:48, :55); `currentTime` sets and reads through them (animation.cc `ConvertCSSNumberishToTime`,
`ConvertTimeToCSSNumberish`, `SetCurrentTimeInternal` 644-665).
- On device, every running CSS transition and animation holds `s` (double seconds). It starts at 0 when the animation or
  transition is created. `advance(Δ ms)` sets `s = (s * 1000 + Δ) / 1000` for each one whose play state is running. This is
  an additive `advanceHeld(s, deltaMs)` in rt-timing.ts, so it is translated and vector-checked.
- **Chrome frame capture** uses the same arithmetic by construction: `Animation.setPlaybackRate(0)` before load, and the
  capture asserts `document.timeline.currentTime === 0` at every step (M3). It **never calls `pause()`**: a script-paused
  CSSAnimation survives an `animation-name` change (M16) where Chrome cancels it (M17). `advance(Δ)` sets
  `a.currentTime = Number(a.currentTime) + Δ` on every animation whose `playState` is `'running'`. With the timeline at 0,
  `startTime` becomes `-s` and the read gives back `s` exactly (M25).
- The device and Chrome apply the same sequence of Δ, so their times are bit-equal for any step sequence.
- **T096's "one advance(t) equals N small steps byte for byte" is restated.** It is false in Chrome itself (M2). The rule is:
  device equals Chrome for the same step sequence, byte for byte; one step equals N steps is asserted only where the sums are
  exact (integer-ms and power-of-two-fraction steps). The 60 Hz and 120 Hz grids step by `1000/60` and `1000/120` on both sides.
- The plant `heldTimeShortcut` (using `now - start`) must be caught by the rt vectors.
- The existing north-star capture (capture-chrome.ts) uses `pause()`. Its 7 frame cases have no name change, so it is not
  wrong today. Moving it to this method is a board note for T034 (§11), not ANIM-b's change.

**R3. The display driver uses the same per-animation model.** It is evidence only, never a gate.
- iOS: `CADisplayLink`, Δ from successive `targetTimestamp`s, `preferredFrameRateRange` up to the device maximum (iOS 15
  floor). Android (minSdk 31): `Choreographer.FrameCallback`, Δ from successive `frameTimeNanos`.
- It runs only while some transition or running animation exists, and stops when none does.
- After the app returns from the background, Δ is the real elapsed time, as Chrome's document timeline is.
- iOS Reduce Motion and Android's animator duration scale are ignored, as Chrome ignores them (RT-5). No
  `CADisplayLink`/`Choreographer` callback runs in lane mode (plant `laneUsesWallClock`).

**R4. A style change event happens per setter call, at `clock.now`, and per script step in the lanes.**
- api §4.2 makes each setter atomic, so each call is one event. A lane script step that sets several states is one event,
  as Chrome's capture applies a state step's DOM edits in one style flush.
- Two setter calls at zero elapsed time give the same values as one call. Interrupting at progress 0 either restarts from the
  same start value or is a reversal with shortening factor 0, and duration 0 starts no transition (css_animations.cc:2613-2625).
  A test proves this on every fixture state triple: A→B→C at zero elapsed time dumps equal A→C.

**R5. The transition update is a port of `CSSAnimations::CalculateTransitionUpdateForPropertyHandle`**
(css_animations.cc:2461-2685, Google BSD), in a new translated root `packages/layout/src/rt-transition.ts`. Per (element,
property):
1. A running transition whose end equals the after-change value stays (2502-2506).
2. Otherwise it is cancelled. If the after-change value equals its reversing-adjusted start value, it is a reversal (2509-2517).
3. Before-change equal to after-change starts nothing (2538-2540).
4. A discrete pair (no smooth interpolation, M9) starts nothing (2580-2584).
5. `delay + duration <= 0` starts nothing (2613-2625).
6. A reversal scales the duration, and a negative delay, by
   `clamp(progress × oldFactor + (1 − oldFactor), 0, 1)`, where `progress` is the old effect's eased progress (2627-2645;
   M5: 0.8024033910598437 × 500 ms = 401.20169552992184 ms).
7. Transitions fill backwards (css_transition_data.cc `ConvertToTiming`; M19).
8. A property no longer listed is cancelled and jumps to its value (2862-2868; M23).
9. Of repeated entries for one property, the last wins (2611-2612 comment).

**R6. The before-change value is the value Blink stores.** It is the current displayed value, narrowed where Blink's
ComputedStyle narrows (ANIM-a ruling 1: opacity float, Length float, Color float channels, transform arguments). M5 shows the
reversed transition starting from `0.802403` and `translateX(19.7597%)`. Plant `beforeChangeUnnarrowed`.

**R7. First style, display and lifetime.**
- No transition starts on an element's first style (`old_style` null or rendering not yet begun, css_animations.cc:2814-2819 and 2821): at mount, for a
  branch-created element, and for an element leaving `display: none` (M6). Plant `transitionOnFirstStyle`.
- An element or ancestor becoming `display: none` cancels that subtree's transitions and CSS animations (M6, M7; the animation
  update requires `Display() != kNone`, css_animations.cc:1819-1821). Plant `displayNoneKeepsTransition`.
- CSS animations start at first style, including at mount, so the mounted tree shows their t = 0 values before the first dump.

**R8. `all` and shorthands are expanded by the compiler, per element, from the reachable states.**
- A transition can only start on a property whose resolved value differs between two reachable assignments, so the compiler
  lists exactly those (M8: `all` over the library-button hover gives background-color, the 4 border colours and color).
- Shorthand names expand to Chrome's longhands (`border-color` to 4, `margin` to 4, `background` to its longhands).
- The slot table is bounded: more than 256 (element, property) transition slots in one program is a stop.

**R9. Inherited and currentcolor values follow the animation per frame.**
- A descendant that inherits an animated inherited property (no own declaration in that state) shows the ancestor's animated
  value each frame (M4, M8). `currentcolor` users on the element and on inheriting descendants (border colours, outline colour,
  text-decoration colour) follow an animated `color`.
- The compiler emits this closure per program. A closure of more than 1024 writes per frame is a stop.
- A descendant with its own transition on that property starts its own transition from the inherited change (M18). The
  generic R5 rule gives this, because the descendant's resolved value differs between the two states.
- Plant `inheritedNotPropagated`.

**R10. Keyframes follow Blink's keyframe model.**
- Missing 0% and 100% values are neutral keyframes taken from the element's **current** underlying value
  (css_keyframe_effect_model.cc:196-227; M12, M20). That value is state-dependent, so it is recomputed at each style change.
  Plant `neutralKeyframeStale`.
- Sampling is `InterpolationEffect::GetActiveInterpolations` (interpolation_effect.cc): the segment with
  `apply_from <= fraction < apply_to`, where the first segment extends to −∞ and the last to +∞; local fraction
  `(f − start) / (end − start)`; then the **start keyframe's** easing with the effect's limit direction (M21). This goes in a
  new translated root, `rt-keyframes.ts`.
- The effect's own easing is linear for CSS animations: `animation-timing-function` becomes the default keyframe easing
  (css_animations.cc:1843-1845). For transitions, the easing is on the effect (css_timing_data.cc `ConvertToTiming`).
- Keyframes are resolved per animated element and per state (`var()`, `em`, `rem`, `%`). Equal offsets merge in order, and of
  two `@keyframes` with one name the last wins (M13).
- Several animations on one property compose in name-list order, and the last one wins.
- Plant `perKeyframeEasingIgnored`.

**R11. The animation list update is a port of `CSSAnimations::CalculateAnimationUpdate`** (css_animations.cc:1763-2012), in a
new translated root, `rt-animations.ts`.
- Animations match by (name, nth occurrence). A name that is no longer listed is cancelled; a new name starts at s = 0 (M17).
  Plant `nameChangeKeepsAnimation`.
- A play-state change pauses (holds `s`) or resumes (keeps `s`) (M25; T014's 90deg at 6000 ms). Plants `pauseLosesPhase` and
  `pauseClockRuns`.
- Other timing changes on a kept animation update in place and keep `s` (M15). This is admitted only when the iteration
  count is infinite. Finite animations can finish, and Blink's finished-state hold (`did_seek`) then differs between a seeking
  capture and real time, so such a pair is refused (ANIM-t). The demo's only animation is infinite.

**R12. Transition and animation on one property are refused** (ANIM-o). Chrome blocks the transition while an animation has an
active interpolation for that property (`CanCalculateTransitionUpdateForProperty`, css_animations.cc:2443-2459; M11, and the
code's own TODO crbug.com/1226772). Modelling "active interpolation" needs phase tracking that buys nothing for the demo.

**R13. Which properties may animate is data, per target.**
- `css/animation-kinds.ts` maps each Dragon longhand to its Chrome interpolation:
  - `discrete`;
  - `length` with a value range (`non-negative` for padding, width, height, min/max and gaps; `all` for margins and insets);
  - `color`;
  - `opacity`;
  - `transform`;
  - `smooth-unadmitted` (interpolable in Chrome, with no rt kind or writer yet).
- A committed snapshot of the `interpolable` flags of css_properties.json5 at the tag
  (`packages/dragon/test/data/chrome-145-interpolable.json`, written by `scripts/capture-interpolable.ts`) is checked by a
  test. Every Dragon longhand needs an entry, and `discrete` must agree with `interpolable: false`.
- M26 measured the range clamps: padding and width clamp at 0, margins don't, opacity and colour channels clamp. They are an
  additive `interpolateLengthInRange` in rt-interpolate.ts. Plant `nonNegativeUnclamped`.
- **Admission rule.** A property may be named in a transition or keyframes only if its kind has an rt interpolator and a
  runtime writer on that target. Otherwise the declaration is refused, but only where a reachable state pair would start a
  transition on it, or where a keyframe sets it (§1 table). A transition list that names an unadmitted property that never
  changes is accepted, and does nothing in Chrome either.
- Discrete properties change at once, as in Chrome.
- The admitted set is one set for every target. Web and native rows carry the same proofs.

**R14. Environment-dependent endpoints are resolved on device.**
- Chrome interpolates computed values. For example, `margin-right: var(--library-width)` is `clamp(20rem, 22vw, 26rem)`,
  computed to px.
- Endpoints the compiler can fold are folded at build time. The others are resolved by V2a's environment resolver on device,
  then narrowed and interpolated with rt-interpolate.
- Proof: a fixture with an rem/vw endpoint at every DPR and both phone viewports.
- If the resolver's px is not bit-equal to Chrome's computed px, stop. Never add a tolerance.

**R15. Web output.**
- `emit/web-css.ts` emits the transition and animation longhands as resolved longhands per element and state, as it does for
  every property.
- It emits each used `@keyframes` once, under its authored name, with resolved values. ANIM-v guarantees one resolution per
  name, so the computed `animation-name` stays equal between the authored and compiled renderings (chrome-dual).
- This supersedes T047 §3.5 item 4 ("verbatim"). A verbatim block would carry unresolved `var()` past the compiled result,
  against design principle 1.

**R16. Native application through writers, with the end state as the oracle.**
- Each tick, the animator computes every active value and writes it through runtime writer functions to the live views of
  the mounted tree. A state change rebuilds the tree (`render()`), and the animator writes the current values in the same
  call, so no frame shows the end values first.
- **Writers:**
  - Opacity and transform (ANIM-b2) call `dragonSetOpacity` and `dragonSetTransform`.
  - Colours call new functions in `emit/runtime/anim.ts`. These use the same support conversions as the static code, and
    the static emitted case code is not changed.
- **Layout runs only when a layout-affecting property animates.** It runs through the mount's input builder with a field
  patch: a node index plus a length-percentage. The engine already takes px, % and calc. Needing an engine input field change
  is a stop.
- **Proof:** every frame script ends with a settle step, past every transition's end. The settled dump must equal the end
  assignment's static expected dump (the device-states rule). This covers every colour writer.
- No `CABasicAnimation`, `CAKeyframeAnimation`, `UIView.animate`, `UIViewPropertyAnimator`, `ValueAnimator`, `ObjectAnimator` or
  `ViewPropertyAnimator` (the T046 grep, paint-seams.test.ts:160). Implicit CALayer actions stay disabled.

**R17. The frame case kind, and the motion lane that T097 reuses unchanged.**
- **Scripts.** A frame script is a sidecar `packages/parity/fixtures/<fixture>.frames.json` (`dragon-frames/1`). It holds a
  list of phases, and each phase is an optional state step (`set`, or in ANIM-b2 `force`) plus a span in ms. A fixture body
  cannot carry `<script>`.
- **Derived samples.** `anim-cases.ts` derives each span's sample times from the compiled animation tables (the T096 list):
  - t = 0, d ± 1 ms, the delay ± 1 ms;
  - each keyframe offset ± 1 ms, and segment midpoints;
  - the steepest point and the extrema of each bezier;
  - iteration edges at i = 1, 2 and 1000, ± 1 ms;
  - the active end ± 1 ms and after it;
  - pause and resume;
  - optional 60 Hz and 120 Hz grids;
  - a final settle.

  The same function feeds the Chrome capture and the device script, so they cannot disagree. Counts are printed, never pinned
  by hand.
- **Files.** The animations group loads `anim-*.html` and `motion-*.html` by glob, with their sidecars. YUI-1 (T097) adds
  `motion-yui540-*.html` and sidecars with no code change, inside its own allowed_files.

**R18. Lanes.**
- **Host:** `parity:anim-capture` (Chrome, R2 method) writes `packages/parity/expected-frames/**`. `parity:anim-report`
  compares the TS animator and the engine with Chrome at every sample: computed strings for every animated property, string
  for string, and engine boxes against Chrome rects, at DPR 1, 2, 2.625 and 3.
- **chrome-dual:** the compiled web output matches the authored CSS at every sample.
- **Device:** a new lane, `device-anim`. For every sample dump it runs the device-frames, device-applied, device-lines and
  device-pixels checks against that sample's reference, and relabels failures as `device-anim` (the device-states
  precedent). It also checks the settle rule.
- Two device runs of the frame scripts must give byte-identical dumps.
- Pixels are compared at a derived subset, at most 400 samples per device and DPR: t = 0, every keyframe offset + 1 ms, every
  segment midpoint, every active end + 1 ms, every settle, and every sample of the demo-shaped fixtures. Frames and applied
  values are compared at every sample.
- The pixel gate is unchanged.

**R19. Ports and licences.**
- The ports come from BSD files: css_animations.cc, animation.cc, keyframe_effect_model.cc, animation_effect.cc (Google
  BSD); css_transition_data.cc, css_timing_data.cc, css_animation_data.cc, css_keyframe_effect_model.cc,
  interpolation_effect.cc (Chromium BSD); animation_time_delta.h.
- css_properties.json5 (Chromium BSD) is a data reference.
- style_resolver.cc (LGPL, KDE) is cited as reference only, never ported (class A, T118J).
- Every cited file gets a docs/ports.json entry, and NOTICES are regenerated.

**R20. Decision 17 holds.** States stay finite. Time is the only continuous input, and it reaches values only through the
clock (api §4.4 "time" inputs). Animations add no state space: the runtime holds one record per (element, property) slot and
per animation, not per assignment.

## 3. How each target gets it

| | Web | iOS (UIKit, Core Animation layers) | Android (Views, minSdk 31) |
|---|---|---|---|
| Timing | Chrome runs it from the resolved longhands and `@keyframes` | rt-* in generated Swift, per R2/R3 | rt-* in generated Kotlin, per R2/R3 |
| Driver | the browser | `CADisplayLink`, or the virtual driver in lanes | `Choreographer`, or the virtual driver in lanes |
| Colour | CSS | runtime colour writers on the live views (background, border layers, Dragon-drawn text colour) | the same on the Dragon views and drawables |
| Opacity (b2) | CSS | `dragonSetOpacity` (`UIView.alpha` from Chrome's alpha byte) | `dragonSetOpacity` (`View.setAlpha`) |
| Transform (b2) | CSS | `dragonSetTransform` (`layer.transform`, origin compensated, edge AA on) | `dragonSetTransform` (pivot, translation, rotation and scale decomposition) |
| Layout props | CSS | engine re-run with the patched input, then frames applied | the same |
| Platform settings | n/a | Reduce Motion ignored, like Chrome | animator duration scale irrelevant (no Animator) |

The compiler decides every platform difference. The device never parses CSS. It reads typed tables: slots, timing specs,
segments, resolved endpoints or resolver handles, and the closure lists.

## 4. Proof

**Fixtures, ANIM-b1** (group `animations`; each has a frame script; rtl variants where marked):
1. `anim-color-all`: `transition: all .3s ease` over a free state, from transparent to a colour, with border colours, and a child
   that inherits `color`. This is the library-button shape, driven by a state instead of hover.
2. `anim-reverse`: a width and background-color reversal at mid-flight, an interruption to a third value (M22), and
   `transition: none` mid-flight (M23).
3. `anim-layout-margin` (ltr and rtl): the `.App` shape. A flex column with `margin-right` from 0 to `clamp(20rem, 22vw, 26rem)`
   over .5 s ease, at both phone viewports.
4. `anim-overshoot`: `cubic-bezier(.5,-1,.5,2)` on padding, width, margin and colour (M26).
5. `anim-steps`: `steps(4, jump-start|jump-end|jump-none|jump-both)`, `step-start` and `step-end`, at discontinuities ± 1 ms,
   with a negative delay (the before flag).
6. `anim-delays`: a positive delay (M19), a negative delay, staggered delays across siblings (T096), and duration lists that
   repeat.
7. `anim-keyframes`: offsets 0, 25%, 60% and 100%; per-keyframe easing; partial keyframes whose neutral end follows a mid-run
   state change (R10); duplicate names; 2.5 iterations; `alternate-reverse`; fill `both`; and two animations with comma-list
   fills (T096).
8. `anim-infinite`: an infinite colour and width loop at iteration edges 1, 2 and 1000, ± 1 ms.
9. `anim-play-state`: paused at creation, then resume, pause and resume through states, read at 5000 and 6000 ms (the T014
   shape, on colour).
10. `anim-display-none`: an ancestor hidden mid-transition and mid-animation, then shown again (M6, M7).
11. `anim-branch`: a branch-created element, with no first-style transition and its animation starting at creation.
12. `anim-name-change`: a name swap (M17), and an in-place duration change on an infinite animation (M15).
13. `motion-grid`: a 1 s ease transition on the 60 Hz and 120 Hz grids.
14. `anim-no-effect`: an undefined `animation-name` and an unknown `transition-property` identifier (warnings, no motion).
15. `anim-triple`: the R4 zero-elapsed equivalence.

**Reject fixtures, ANIM-b1:** one per §1 row other than ANIM-m (`reject-anim-*.html`).

**Fixtures, ANIM-b2** (group `animations-paint`):
1. `anim-spin`: rotate from 0 to 360deg, 20 s linear infinite, paused and running by state, at 0, 5000, 6000 (paused at 5000)
   and 20000 ms, and at the 1000th iteration.
2. `anim-slide` (ltr and rtl): `translateX(100%)` to `0%` plus opacity, .5 s ease, open at 250 ms (M5's numbers), and a
   reversal.
3. `anim-hover-scale`: `transition: color .2s, transform .2s` with forced hover, `scale(1.08)`.
4. `anim-hover-all`: `transition: all .3s ease` with forced hover (M24).
5. `motion-translate-percent`: a `translate(%)` keyframe while the box's width transitions (the T096 % technique).
6. `motion-overshoot-translate`, `motion-stagger`, `motion-infinite-rotate`, `motion-comma-fills`: the remaining T096
   techniques, on transform and opacity.
7. Rejects: `reject-anim-mismatched-transform` (M10) and `reject-anim-3d-rotate` (PNT2-m).

**Planted faults.** Each must fail its own lanes on the host and on device, and leave the other lanes passing (T047 §5). The
receipt lists, for each plant, the samples it fails. For the 12 T096 plants it also lists the largest device-px displacement,
which must be at least 1 device px.

| Plant | Where | Package |
|---|---|---|
| wrongEasing, phaseShift, delayDropped, delayRoundedToFrame, perKeyframeEasingIgnored, iterationOffByOne, directionIgnored, fillForwardsDropped, pauseClockRuns, colorUnpremultiplied, infiniteLoopFmodDrift (T096) | rt or compiler | b1 |
| percentAgainstWrongBox (T096) | runtime | b2 |
| easeFloat32, pauseLosesPhase, noReversalShortening, transitionOnFirstStyle, laneUsesWallClock (T047) | rt, runtime | b1 |
| rotateViaMatrix (T047) | rt | b2 |
| beforeChangeUnnarrowed, inheritedNotPropagated, displayNoneKeepsTransition, nameChangeKeepsAnimation, neutralKeyframeStale, nonNegativeUnclamped | rt, compiler, runtime | b1 |
| heldTimeShortcut | rt (vectors and host only; sub-ulp, so no pixel claim) | b1 |

**Support-profile rows.**
- `property:<each longhand above>` with value-kind rows (`<time>`, `<easing-function>` per kind, `infinite`, `<number>`,
  direction, fill and play-state keywords, `none`, `all`, `<custom-ident>`).
- `at-rule:@keyframes`, and `keyframe-selector:from|to|<percentage>`.
- `animatable:<property>` per admitted property.

Every row names its passing fixtures, at status `exact` on web, ios and android once device-anim passes. Rows are additions
only; no existing status changes.

## 5. Base, dependencies and order

| Piece | Base | Why | Lands |
|---|---|---|---|
| b1-1 rt roots | origin/master 0d04dc09a (frozen) | new rt files plus additive translate hunks; needs nothing in flight; the earliest base | own PR, the first train after train 1 (changes p1/rt, so it needs that position's device run) |
| b1-2 compiler and web | b1-1 (review base `review/anim-b-rt`) | uses the new rt types; compiles on master's SELD-R1a programs | with b1-3, in one train |
| b1-3 runtime and lanes | b1-2, after seld-lanes is on master (merge origin/master in) | needs the case-script runner and the device-states lane (seld-lanes 28eb6ede59, 3696a92523) | with b1-2 |
| b2 | master after PNT2 (train 4), the PNT1 train (opacity and stacking), SELD-R2a (seld-r2a/b/c) and b1 | needs the opacity and transform writers, the interaction runtime and the forced hook | own train |

- **b1-3 without seld-lanes.** If seld-lanes is not on master when b1-2 is host-done, b1-3 does its host work on b1-2 merged
  with seld-lanes in a local merge. That merge is never pushed. The device step and the PR wait until seld-lanes lands.
  seld-lanes is ~25 KB, so a restack risk is small and reported.
- **b2's base.** If one of b2's four dependencies is still in review at dispatch, b2 stacks on that one's clean head (the
  review/** pattern). If two are, b2 waits.
- **Shared files** (additive hunks only; RT-13 plus the T099 pattern):
  - generate.ts, corpus.ts, harness.ts, targets.ts, lanes.ts, device-lanes.ts, device-jobs.ts, native-host.ts, native-dump.ts;
  - capture.ts, chrome.ts, fixtures.ts, native-support.ts, runtime/index.ts, internal.ts, properties.ts, at-rules.ts,
    stylesheet.ts, project.ts, web-css.ts;
  - scripts/gen-css-grammar.ts, scripts/regen.ts, package.json, faults.ts, codes.ts, catalogue.ts, docs/ports.json.
- **`emit/runtime/state.ts`** is edited by all five in-flight lineages (seld-r1, seld-r2*, pnt1, pnt2, this one). ANIM-b
  edits it only in four named hunks: mount, setter event, advance, and the script-step batch. In b2 it also lifts the opacity
  and transform state-write refusals. Everything else is in new files.
- **Order against other runtime work.** ANIM-b runs alongside SOV (T066), with the PM checking compiler-file overlap at
  dispatch. It runs before MQ-R (T067) and YUI-1 (T097). DTXT-1 (T102) is serial against SOV, not ANIM.

## 6. Worker packages

ENV is the literal prefix `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`.
BASE is the recorded base sha. Heavy steps run under `/tmp/heavy-lease.sh`, and device steps under `/tmp/device-lease.sh`.
Worktrees: `/tmp/dragon-anim-b1`, `/tmp/dragon-anim-b2`. Branches: `anim-b-rt`, `anim-b-compiler`, `anim-b-runtime`,
`anim-b2-paint`.

### 6.1 ANIM-b1

**allowed_files.**
- **b1-1 (rt):**
  - `packages/layout/src/rt-transition.ts`, `rt-keyframes.ts`, `rt-animations.ts` (new);
  - `packages/layout/src/rt-timing.ts` (additive: `advanceHeld`);
  - `packages/layout/src/rt-interpolate.ts` (additive: `interpolateLengthInRange`, range-aware `interpolateValue` entry);
  - `packages/layout/src/rt-easing.ts` (`RtFaults` fields appended only);
  - `packages/layout/test/rt-{transition,keyframes,animations}.test.ts` (new), and `rt-faults.test.ts` and `rt-vectors.test.ts`
    (additive cases);
  - `packages/layout/rt-oracle/**` and `rt-vectors/**` (new files; existing files byte-identical);
  - `scripts/capture-rt-oracle.ts` (additive sections: keyframe sampling, transition update sequences, animation-list
    sequences, all through CSS on held elements, per R2);
  - `packages/translate/src/generate.ts` (the roots hunk), `corpus.ts` (the suite hunk), `harness/harness.ts` (ops hunk),
    `packages/translate/test/rt-*.test.ts`;
  - `packages/parity/src/targets.ts` (the p1/rt count derivation covers the new vector files);
  - pinned count retargets in `translate.test.ts`, `native-swift.test.ts`, `native-kotlin.test.ts`, `lanes.test.ts` and
    `device-vectors.test.ts`;
  - `docs/ports.json` and `THIRD_PARTY_NOTICES.md` (generated);
  - regenerated: `packages/translate/corpus*.json`, `packages/layout/generated/**`, `packages/parity/out/lanes.json`.
- **b1-2 (compiler and web):**
  - `packages/dragon/src/css/properties/animation.ts` (new: longhands, shorthands, parse as Chrome 145);
  - `packages/dragon/src/css/properties.ts` (family spreads and aspects);
  - `packages/dragon/src/css/at-rules.ts` (the `keyframes` handler line) and `css/at-rules/keyframes.ts` (new);
  - `packages/dragon/src/css/stylesheet.ts` (the keyframes collector, like `fontFaces`);
  - `packages/dragon/src/project.ts` (one hunk passing the collector to analysis);
  - `scripts/gen-css-grammar.ts` (SUBSET hunk) and `css/grammar.generated.ts` (regenerated);
  - `packages/dragon/src/css/animation-kinds.ts` (new), `scripts/capture-interpolable.ts` (new),
    `packages/dragon/test/data/chrome-145-interpolable.json` (new, generated);
  - `packages/dragon/src/analysis/animations.ts` (new: admission, refusals, `all` expansion, keyframe resolution, the closure);
  - `packages/dragon/src/lower/anim-program.ts` (new: typed tables per program);
  - `packages/dragon/src/emit/web-css.ts` (longhands and `@keyframes` hunk);
  - `faults.ts`, `diagnostics/codes.ts`, `diagnostics/catalogue.ts`, `test/diagnostic-codes.json` (append);
  - `packages/dragon/src/internal.ts` (exports);
  - `packages/dragon/test/{animations,keyframes,animation-kinds,anim-program,anim-web}.test.ts` (new);
  - retargets keeping intent: `seams.test.ts:146` (the refused at-rule pin moves `keyframes` to one that is still refused), and
    any refusal pin on `transition` or `animation` (moved to `animation-timeline: scroll()`, which is still refused);
  - `packages/parity/src/fixture-groups/animations.ts` (new; reject fixtures here), `fixtures.ts` (one import, one
    concatenation), `packages/parity/fixtures/reject-anim-*.html`;
  - `examples/music-player/tools/check.ts` (the `unwrapAtRules` hunk, only if pass B must stop blanking `@keyframes`);
  - regenerated: `profiles/*.ts`, `emitted/**` (headers relaxed), `north-star-check.json`, the tw-sweep snapshot, wpt
    expectations.
- **b1-3 (runtime and lanes):**
  - `packages/dragon/src/emit/runtime/anim.ts` (new: the TS reference `Animator`, Swift and Kotlin support, per-program tables);
  - `emit/runtime/clock.ts` (display drivers);
  - `emit/runtime/index.ts` (append `anim`);
  - `emit/runtime/state.ts` (four named hunks: mount, setter event, advance, step batch);
  - `emit/native-support.ts` (the RT-13 hunk);
  - `packages/parity/src/anim-cases.ts`, `frame-capture.ts`, `cli/anim-capture.ts`, `cli/anim-report.ts` (new);
  - RT-13 hunks in `native-host.ts`, `native-dump.ts`, `device-lanes.ts`, `device-jobs.ts`, `targets.ts`, `lanes.ts`, `cli/lanes.ts`,
    `capture.ts` and `chrome.ts` (the frozen-timeline prepare for animation fixtures only);
  - `packages/parity/fixtures/{anim,motion}-*.html` and `*.frames.json` (new); group file additions;
  - `packages/parity/test/{anim,frame}-*.test.ts` (new); derived-count pins (literals only);
  - new files only under `packages/parity/expected*/**`, `expected-frames/**`, `packages/layout/vectors/**`, `packages/parity/emitted/**`;
  - `scripts/regen.ts` (the anim-capture step), `.gitattributes` (its outputs), `package.json` (two scripts);
  - `packages/parity/out/lanes.json`, `packages/parity/out/device-failures-*.json`, regenerated profiles and north-star-check.json.

**verify.**
- **C1** `ENV pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`: green; nothing `.skip`, `.only` or `.todo`; modified
  tests are only the listed pins.
- **C2** `pnpm run layout:subset`: 0 violations.
- **C3** `pnpm run native:gen && pnpm run native:swift && pnpm run native:kotlin`:
  - the rt suite is equal on both, with the new lines;
  - every other suite digest is unchanged;
  - `pnpm run native:planted` is all caught.
- **rt oracle:** `pnpm run rt:oracle` twice, then `git diff --exit-code packages/layout/rt-oracle`. Then `pnpm run rt:oracle -- --check`:
  - failed 0, with the derived counts printed;
  - M5's duration bits 4079133a25178c38 are reproduced;
  - the existing 54,588 samples are unchanged.
- **C4** `parity:capture` twice and `parity:dpr-capture` twice, no diff; `pnpm run parity:anim-capture` twice, byte-identical.
- **C5** `git diff --diff-filter=MD --name-only BASE -- packages/parity/expected packages/parity/expected-dpr packages/layout/vectors`
  is empty; emitted files differ in header lines only.
- **Reports:** `parity:report` and `parity:dpr-report` fail 0. `pnpm run parity:anim-report` fails 0 at every sample, DPR and
  direction, chrome-dual included.
- **Profiles:** `profile:rows`: additions only.
- **Builds:** `native:build -- --target ios` and `-- --target android`; existing case sources are byte-identical apart from
  relaxed digests.
- **Device (both leases):** `/tmp/device-lease.sh pnpm run parity:devices`, then `pnpm run parity:lanes --require-all`.
  - device-anim passes at iOS 2 and 3, Android 2, 2.625 and 3;
  - no lane is `not run`;
  - existing lanes keep BASE's verdicts and failure lists;
  - a second device run of the frame scripts gives byte-identical dumps;
  - every settle dump equals its end assignment's expected dump.
- **Display smoke** (evidence): on each platform, an infinite colour loop's phase advances monotonically with the frame
  timestamps.
- **Plants:** every b1 plant is caught on the host and on device; the T096 plants each move at least 1 device px.
- **North star:** `pnpm run north-star:check` gives §9's delta, and no per-target count rises.
- **WPT:** `wpt:run -- --target web && wpt:update-expectations -- --target web`: no pass becomes a fail.
- **tw:sweep:** no utility regresses; the receipt reports the count change.
- **Ports:** `chrome-ports.test.ts` passes; `pnpm notices:gen && git diff --exit-code THIRD_PARTY_NOTICES.md`.
- **C6** `git diff --name-only BASE..HEAD` is inside allowed_files; the RT-13 `git diff -U0` check shows only `+` lines in
  RT-13 files and only the four named hunks in state.ts; the no-animator grep over `packages/dragon/src/emit` prints nothing.

**stop_if.**
- Chrome disagrees with the reference after reading the Blink source at the tag. Report the sample and both values; no
  tolerance.
- The frozen-timeline capture is not byte-identical run to run, or `document.timeline.currentTime` is ever non-zero.
- An environment-dependent endpoint is not bit-equal to Chrome's computed px through V2a's resolver (R14).
- A layout transition needs an engine input field change (R16).
- A colour writer would need the static emitted case code changed (R16).
- More than 256 transition slots or 1024 closure writes per frame in any program (report the fixture).
- An existing capture, vector, rt oracle line, emitted body, profile status or device verdict changes.
- A non-additive edit is needed in an RT-13 file, or a state.ts edit outside the four hunks.
- The subset cannot express an rt algorithm without a translator change.
- An LGPL file would need a `port` use.
- A file is needed outside allowed_files; the lease is not held; verification fails twice.

### 6.2 ANIM-b2

**allowed_files.**
- `css/animation-kinds.ts` (admit `opacity` and `transform`), `analysis/animations.ts` (ANIM-m, transform % basis),
  `lower/anim-program.ts`;
- `emit/runtime/anim.ts` (adapters to `dragonSetOpacity` and `dragonSetTransform`; transforms re-applied after layout);
- `emit/runtime/state.ts` (lift the opacity and transform state-write refusals through the same writers; one hunk each);
- `emit/runtime/interaction.ts` (one hunk: an interaction change raises the R4 event);
- `faults.ts`, `catalogue.ts`, `codes.ts`, `diagnostic-codes.json` (append);
- `packages/dragon/test/anim-paint*.test.ts` (new);
- `packages/parity/src/fixture-groups/animations-paint.ts` (new), `fixtures.ts` (one line), the forced-step registration hunk
  in `anim-cases.ts`;
- `packages/parity/fixtures/{anim,motion,reject-anim}-*.html` and sidecars (new); new expected files; tests; derived-count
  pins; lanes.json; regenerated profiles, north-star-check.json, tw-sweep snapshot.

**verify:** as 6.1, and:
- every b2 plant is caught (rotateViaMatrix, percentAgainstWrongBox);
- M5's numbers are reproduced on device at 250 ms in `anim-slide`;
- `anim-spin` at 5000 ms dumps `matrix(0, 1, -1, 0, 0, 0)`;
- `north-star:check` gives 0 animation-related diagnostics on every target (§9).

**stop_if:** as 6.1, and:
- a PNT1 or PNT2 writer must change;
- the SELD-R2a interaction runtime exposes no change hook;
- a demo transition needs matrix interpolation or `linear()`;
- rotated content fails device-pixels in a way PNT2's own transformed fixtures don't (report it; PNT2's edge rules apply
  unchanged).

## 7. PR split (each reviewed diff under about 150 KB; generated output is ignored by shape)

| PR | Branch | Content | Est. reviewed size | Review base |
|---|---|---|---|---|
| 1 | anim-b-rt | rt-transition, rt-keyframes, rt-animations, `advanceHeld`, range clamp, oracle sections, tests, translate hunks, ports | ~70 KB | master |
| 2 | anim-b-compiler | properties, at-rule and keyframes parse, animation-kinds and snapshot script, analysis, anim-program, web-css, diagnostics, reject fixtures, pins | ~120 KB | review/anim-b-rt |
| 3 | anim-b-runtime | Animator (TS, Swift, Kotlin), drivers, state.ts hunks, anim-cases, frame-capture, CLIs, device-anim lane, fixtures and sidecars, tests | ~140 KB (if over 150 KB, split the Chrome capture, CLIs and lane into 3b) | review/anim-b-compiler |
| 4 | anim-b2-paint | opacity and transform admission and writers, state-write lift, interaction hook, ANIM-m, b2 fixtures | ~80 KB | master (or the last unlanded dependency, §5) |

Every regenerated output goes in its own commit, named after the command that produced it. PRs 2 and 3 land in one train,
so master never holds a compiler without its runtime.

## 8. T096 and T097

- **T096.** The 12 plants, the sample list, the 60 and 120 Hz grids, and the bits, strings, frames and pixels comparisons are
  all in §4 and R17/R18. The one-step equals N-steps rule is restated per R2, with measurement M2.
- **T097 (YUI-1).** It reuses `device-anim`, `anim-capture`, `anim-report`, the derived samples and the glob loader unchanged.
  Its allowed_files (examples/yui540/**, `motion-yui540-*`, motion test files) are then enough. 糸 needs ANIM-b2 (it uses
  `translate(%)`). The board should change "after CASC and ANIM-b" to "after CASC and ANIM-b2".

## 9. North-star delta (examples/music-player/dragon/north-star-check.json)

- **ANIM-b1, on its base:**
  - `summary.errors` −8: UNSUPPORTED_PROPERTY −7 (transition ×4, animation, animation-play-state ×2), UNSUPPORTED_AT_RULE −1
    (`@keyframes`);
  - every perTarget −8 (on master's numbers: 343 → 335; web 163 → 155, ios 199 → 191, android 199 → 191);
  - the 7 declaration rows become supported on all three targets (supportedBothTargets 172 → 179 on master's numbers);
  - the two keyframe `transform` rows lose `UNSUPPORTED_AT_RULE` and keep PNT2's code until PNT2 lands;
  - no other count rises.
- **ANIM-b1 with PNT2 but before ANIM-b2:** `+3 [ios]` and `+3 [android]` UNSUPPORTED_VALUE (`transform cannot be animated
  … ANIM-b2`): the `.library` transition and the two keyframe declarations. This is expected and named.
- **ANIM-b2** (with PNT1, PNT2 and SELD-R2a): every animation diagnostic is 0 on every target. That covers `transition`,
  `animation`, `animation-play-state`, `@keyframes`, the keyframe `transform` declarations, and the ANIM-b2 placeholders.
  Hover-selector and button-element errors belong to SELD-R2a and FORM-a.
- The north-star device frames (T034/T018) come from NS-LANE, not from ANIM-b. ANIM-b gives it the animator and the script
  steps.

## 10. Size and risk

- **Size:**
  - ANIM-b1 is L: about 330 KB reviewed over 3 PRs, plus regenerated output.
  - ANIM-b2 is M: about 80 KB.
  - Device time: about 15 frame scripts × derived samples. The pixel subset is capped by R18, and each device run should stay
    within the one-process budget (#42).
- **Risk: medium-high.**
  - The numerics are low risk: ANIM-a's port is already bit-exact, and the new rt algorithms are small ports with an oracle.
  - The real risk is integration:
    - state.ts is touched by five lineages;
    - per-frame layout through the mount's input builder;
    - R14's environment-resolver equality;
    - device lane time.
  - The capture method (R2) removes the one Chrome-side trap found (M16).

## 11. Board updates for the PM

1. **T065.** Split into T065a (ANIM-b1: three stacked PRs; PR 1 can start now on master) and T065b (ANIM-b2: after PNT2,
   PNT1, SELD-R2a and ANIM-b1). Record R1 to R20 in decisions.md under "Runtime styles and animation". Correct T047 §3.5:
   verify 14 drops `will-change`, and item 4 is superseded by R15.
2. **T097.** Its order becomes "糸 after CASC and ANIM-b2".
3. **T019.** Queue ANIM-L, ANIM-d, ANIM-c, ANIM-k, ANIM-v, ANIM-o, ANIM-cc, ANIM-t and ANIM-p, beside ANIM-m and ANIM-S.
4. **New gap, SELD-P.** State-program writes for border-radius, box-shadow and outline: PNT1 refuses them in state programs
   today, and ANIM-b2 lifts only opacity and transform.
5. **T034/T018 note.** capture-chrome.ts's `pause()` method is safe for today's 7 frame cases. NS-LANE should move to R2's
   method (no script pause; advance running animations only) before any case changes `animation-name`.
6. **T066 (SOV) and T067 (MQ-R)** call the R4 entry point; SOV's "slot on a transitioned property" refusal stays until it
   proves a slot-triggered transition.

## Receipt

**Spec:** /tmp/specs/T065.md

**R-rulings:**
- R1: split into ANIM-b1 (rt, compiler, runtime and lane, colour and length motion) and ANIM-b2 (opacity, transform, hover,
  ANIM-m).
- R2: lane time is Blink's held seconds, `s = (s·1000 + Δ)/1000` per running animation. The Chrome capture never calls
  `pause()` and advances `running` animations only. T096's one-vs-N equality holds only for exact sums (M2).
- R3: one per-animation Δ model for the display driver too (CADisplayLink, Choreographer). It is evidence only, and OS motion
  settings are ignored.
- R4: one style change event per setter call, and per step in lanes. Zero-elapsed equivalence is proven by a test.
- R5: the transition update is a port of Blink's CalculateTransitionUpdateForPropertyHandle: reversal shortening from eased
  progress (M5), backwards fill, cancel when unlisted, last entry wins.
- R6: the before-change value is the displayed value narrowed as Blink stores it.
- R7: no transitions on first style; `display: none` cancels; animations restart on reappearance.
- R8: `all` and shorthands expand per element over reachable states (cap 256 slots).
- R9: inherited and currentcolor values follow animations per frame; descendants with their own transitions start their own
  (cap 1024 writes).
- R10: keyframes use Blink's segment sampling, start-keyframe easing and current-underlying neutral ends; the last
  `@keyframes` wins.
- R11: the animation list is matched by name and index; a name change restarts; play-state keeps phase; in-place timing
  changes only on infinite animations (else ANIM-t).
- R12: a transition and an animation on one property are refused (ANIM-o), because Chrome blocks the transition.
- R13: admission is data from Chrome's interpolable flags plus an rt kind and a writer; value-range clamps (M26); refused only
  where motion would actually start.
- R14: environment-dependent endpoints are resolved on device by V2a's resolver, and must be bit-equal to Chrome's or stop.
- R15: web emits resolved longhands and `@keyframes` under the authored name (one resolution per name), superseding
  "verbatim".
- R16: values go through runtime writers on live views; layout runs only for layout properties; settle equals the static
  end dump; no platform animators.
- R17: frame scripts are sidecar JSON with derived samples shared by Chrome and device; a glob loader lets YUI-1 add fixtures
  without code.
- R18: anim-capture, anim-report and chrome-dual on the host; a device-anim lane with frames, applied and lines at every
  sample, pixels at a capped subset, and byte-identical reruns.
- R19: BSD Blink animation files are ported with ports.json entries; LGPL style_resolver.cc is reference only.
- R20: decision 17 holds; time is the only continuous input.

**Owner-only questions:** none. Every item is settled by Chrome measurement (M1 to M26), Blink source at the tag, or
decisions.md precedent, for the PM to rule.
