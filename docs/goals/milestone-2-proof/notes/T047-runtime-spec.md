# T047: Runtime spec, SELD-R, ANIM, MQ-R and SOV

Judge note, 2026-09-28. This review is read-only; this note is the only file written. The Decision Rule applies: every open
question below is settled by research and handed to the PM as a ruling to record. None of them goes to the owner.

**Read:**
- goal.md and state.yaml (T007, T009, T012, T018, T019, T026, T027, T030, T034, T043, T044 to T046);
- notes T010, T012, T014, T015, T016 and T025;
- docs/decisions.md at 71dbdf4 ("Direction", "Selectors and scrollbars", "Native viewports…", decision 17);
- docs/api.md §3, §4.2 to §4.4, §5 and §7;
- docs/research/coverage-roadmap.md (the SELD, ANIM and MQ rows, and the R helpers);
- examples/music-player/styles.css, `lane/manifest.json` and `tools/capture-chrome.ts` (master);
- the ns-tree sources at 2d812f1;
- the Markless `youtube-controller.ts`, read-only;
- packages/dragon/src/media, lower/native-program.ts and emit/native-support.ts (exports);
- packages/translate/src/generate.ts (how engine files and roots are chosen).

## 0. Facts that shape the spec

- **Master is 41cc750** (71dbdf4 plus board). P5 (T007) is in flight in /tmp/dragon-p5 and edits native-support.ts,
  native-host.ts, lanes.ts, the generated engines and inline.ts. TREE (ns-tree 2d812f1) and V1 (826f991) are not merged. MQ-a
  Phase A is on master; Phase B is T030.
- **Native programs are per case.** `lower/native-program.ts` builds one program per case, which means one per full state
  assignment. Nothing on master switches states on a device: there is no generated setter, binding manifest, hit test, clock or
  runtime helper. T010 §3 requires states to change on device "through the generated state API (decision 17), in one app build
  per target … driven by a synthetic tap through Dragon hit-testing". **No board task owns this.** It is the base of every
  runtime package, so SELD-R1 below takes it.
- **The runtime features the demo uses** (styles.css):
  - **Hover and focus:** `:hover` on 4 subjects (`.library-button` with `transition: all .3s ease`,
    `.play-control button` with `scale(1.08)`, `.library-song`, `.youtube-disclosure a`); `:focus` on the range input
    (`outline: none`, which T014 records as `changed: false`).
  - **Transitions** (all `ease`): `.App` `margin-right .5s`, which changes layout and is active only above 768 px, so in
    landscape; `.library` `opacity .5s` and `transform .5s` (`translateX(100%)` to `0%`); `.play-control button`
    `color .2s` and `transform .2s`.
  - **The animation:** `album-spin` `rotate(0deg)` to `rotate(360deg)`, `20s linear infinite`, with play-state paused or
    running on `.rotating`.
  - **Media queries:** `@media screen and (max-width: 768px)` and `(max-width: 640px)`. Both match in portrait on both
    phones, and neither matches in landscape (844 x 390 and 915 x 412), so rotation changes the band.
  - **Hit testing:** `pointer-events: none` on `.animate-track`, so taps reach the range input underneath, and `cursor: pointer`
    in 2 rules.
- **The script-driven inline styles** (Markless `youtube-controller.ts`, identical in `.claude/worktrees/*` and `demos/`):
  - `.animate-track` `style.transform = translateX(${p}%)` with `p` in [0, 100]. This is the progress bar. **It is a
    transform, not a width**, as the task wording suggests.
  - `.track` `style.background = linear-gradient(to right, c0, c1)`, with the colours from the song's `data-color-*`.
  - The controller also writes `input.max` and `input.value`, which are FORM-a's slider state, and the `.time-*` `textContent`,
    which is dynamic text (§6 gap 1).
- **How the Chrome reference captures state** (T014, master `capture-chrome.ts`):
  - The context is `isMobile: true, hasTouch: true` in dark mode.
  - The clock is `Animation.setPlaybackRate(0)` before navigation, then `currentTime` is moved on each animation that is
    running by its computed play state. This is a **virtual document clock**.
  - Forced states use CDP `CSS.forcePseudoState` on one element, with transitions finished.
  - The 7 frame cases are:
    - spin at 0 ms and 5000 ms, paused and playing;
    - the library opening and closing, each at 250 ms;
    - playing to 5000 ms, then paused, read at 6000 ms, giving `matrix(0, 1, -1, 0, 0, 0)`.
- **The translator** translates only `packages/layout/src/*.ts` (top level) reached from the roots in `generate.ts`
  `engineRoots`. Its library has no `Math.abs`, `sin` or `cos` (native-strategy.md §1.3).

## 1. Rulings (research-backed; the PM records them in decisions.md and on the board)

**RT-1. Finite states compile to typed value tables, not per-state layouts.** Dragon does not precompute a layout per state and
interpolate geometry. CSS interpolates *computed values* and lays out again. For example, `.App`'s `margin-right` transition
reflows a flex column. Layout also depends on the device: text scale, the viewport and the safe area (V2). So:
- The compiler emits each state's resolved properties as **deltas** over the base program. They come from the resolved-CSS
  conditions (api §3.2, symbolic and not Cartesian) through the existing per-property writers.
- A setter applies the delta atomically: update the bits, apply the precompiled writes, then lay out again with the shared engine
  only when a layout-affecting input changed (api §4.2).
- The existing per-case program for an assignment is the **oracle**: after any sequence of setter calls, the dump must equal that
  assignment's per-case expected dump.

**RT-2. Dragon drives animation frames itself; Core Animation and Android animators are not used.** The evidence:
- **Android** `PathInterpolator` (used for any `cubic-bezier`) approximates the curve with `Path.approximate(0.002)` and
  interpolates linearly between points. A progress error of 0.002 on the library slide (412 CSS px) is 1.65, 2.16 and 2.47
  device px at DPR 2, 2.625 and 3. That exceeds the one-device-px gate (decision 13).
- **Android durations are not fixed.** `ValueAnimator` scales every duration by the global "Animator duration scale" developer
  setting and jumps to the end at 0. Chrome does neither.
- **Core Animation** `CAMediaTimingFunction` uses an undocumented solver, and the render server's clock cannot be sampled at a
  chosen time. Its only deterministic seek is `speed = 0` with `timeOffset` on the layer tree, and it runs on the render server,
  not in Dragon's dump.
- **Neither platform can animate layout-affecting properties** (`margin-right`) in step with Dragon's engine. Neither implements
  CSS transition semantics either: the before-change style, the reversing shortening factor, the `all` expansion, or
  cancellation on `display: none`.

The ruling:
- Every animated value is `f(t)` in a TypeScript reference, translated to Swift and Kotlin (RT-3), evaluated per frame.
- The value is applied through the same writers as static values.
- The layout engine runs only when a layout-affecting property is animating.
- Offloading `transform` and `opacity` to the compositor (CA, RenderThread) is a later **performance** package. It may land only
  after proving equality with the reference at sampled times on device. Checkpoint 3 does not need it.

**RT-3. Chrome's numerics are reproduced exactly, and the oracle is bit-exact.**
- **Cubic bezier.** Port `gfx::CubicBezier` at Chrome 145's revision in double:
  - the 11-sample spline for the initial guess;
  - up to 4 Newton iterations with `kBezierEpsilon = 1e-7`, stopping when the derivative is below 1e-7;
  - then bisection;
  - start and end gradients outside [0, 1].

  `ease` is (0.25, 0.1, 0.25, 1). The ported solver gives `ease(0.5) = 0.8024033910598437`, so the library-opening frame
  at 250 ms is `translateX(19.7596…%)` and opacity 0.8024…. `fabs` is written as a comparison because the subset has no
  `Math.abs`.
- **Steps.** `steps(n, jump-start | jump-end | jump-none | jump-both | start | end)`, `step-start` and `step-end`, including the
  **before flag** (css-easing-1 §3.4 and Blink `StepsTimingFunction`'s limit direction).
- **Timing model.** The web-animations model exactly as Blink computes it. The Worker must confirm from source whether Blink's
  `AnimationTimeDelta` is backed by integer microseconds, and model the time type Blink actually uses.
- **The oracle.**
  - `Animation.effect.getComputedTiming().progress` and `currentIteration`, read as doubles at pinned `currentTime` values. This
    covers effect-level easing and is compared **bit for bit**.
  - `getComputedStyle` serialisations for interpolated values, compared **string for string** with a TypeScript serialiser that
    follows Blink's number formatting.
- No tolerance is allowed anywhere in the timing or interpolation reference. Frames and pixels then use the existing P5 lane
  gates unchanged.

**RT-4. Transform interpolation follows css-transforms-1 §9 and -2 §16, as Chrome does.**
- Lists with the same functions pairwise interpolate each argument numerically. So `rotate(0deg)` to `rotate(360deg)`
  interpolates the angle: 90deg at 5 s of 20 s, which is exactly T014's record matrix. It is **not** matrix-decomposed; that
  would give no rotation.
- `none` is promoted to identity functions of the other list's types. So `none` to `scale(1.08)` becomes `scale(1)` to
  `scale(1.08)`.
- `%` translate arguments stay length-percentages and resolve against the border box at use.
- Lists that need matrix decomposition (mismatched functions) are **refused** with `DRAGON_UNSUPPORTED_VALUE` naming ANIM-m, a
  later package. The demo has none.
- The final angle-to-matrix step uses platform `sin` and `cos`. These are not in the subset, and a ulp difference cannot move a
  device pixel. It snaps exact multiples of 90deg as `gfx::Transform` does.
- Colours interpolate as Blink does for legacy sRGB (premultiplied). `transparent` to a colour must not darken. The oracle is
  the serialised computed colour, and pixels.

**RT-5. There is one clock abstraction with two drivers.**
- **Display driver:** `CADisplayLink.targetTimestamp` on iOS, `Choreographer.FrameCallback.frameTimeNanos` on Android.
- **Virtual driver**, in lane mode: time moves only by case-script `advance(ms)` steps.

Every animation and transition is a pure function of timeline time, with web-animations start and hold times. So a frame at `t`
on the virtual driver equals T014's Chrome model: `setPlaybackRate(0)`, then `currentTime += Δ` on running animations, with
transitions starting at the state step's time. Two device runs of a frame case must give byte-identical dumps.

Platform motion settings are ignored, as Chrome ignores them: iOS Reduce Motion, and Android's duration scale does not apply
because no Animator is used. `prefers-reduced-motion` stays refused until MQ-R2 (RT-10).

**RT-6. Hover, including touch devices.**
- **(a) Forced-state equivalence.** The lane hook `forcePseudo(node, pseudo)` sets exactly one element's bit, as
  `CSS.forcePseudoState` does. It does **not** set the ancestor chain. The 5 NS forced cases and the parity forced fixtures are
  compared under this hook.
- **(b) Real input matches measured Chrome traces.** Chrome is not assumed to behave any particular way. A capture drives
  Chrome in the reference context (`isMobile`, `hasTouch`) with:
  - touch taps through CDP `Input.dispatchTouchEvent` (touchStart and touchEnd at a point);
  - mouse moves through `Input.dispatchMouseEvent` `mouseMoved`, in a context with `hasTouch: false`.

  After each step it records `matches(':hover')`, `matches(':focus')`, `matches(':focus-visible')` and `document.activeElement`
  for every element. The device state-bit trace must equal the trace for the same point sequence.
  - For touch, Dragon's tap semantics are whatever Chrome's gesture path shows. If Chrome gives sticky hover (hover stays on the
    tapped chain until the next tap elsewhere), Dragon does the same. If Chrome shows none, Dragon sets none.
  - For pointers, hover is the hit target plus its ancestors, as the trace shows.
- **(c) Platform drivers.**
  - iPadOS: `UIHoverGestureRecognizer` for trackpad, mouse and Pencil hover.
  - Android: `View.onHoverEvent` for `ACTION_HOVER_ENTER`, `MOVE` and `EXIT`, from a mouse or stylus.
  - Both feed one Dragon entry point, `pointerMoved(point)`, which the lane drives directly. Android can also inject real
    `MotionEvent`s with `SOURCE_MOUSE` through `dispatchGenericMotionEvent`, so its OS glue is device-proven.
  - iOS simulator automation cannot synthesise pointer hover, so the iOS recogniser glue is labelled **caveat** until a
    pointer run proves it.
  - The iPhone has no hover input, so only the touch semantics in (b) apply there.

**RT-7. Focus.**
- Tap and click focus is a trace from RT-6(b): the focusable inclusive ancestor of the target, or none.
- `:focus-visible` is whatever the same trace shows for pointer- and touch-initiated focus. If any demo trace matches
  `:focus-visible` on an element whose UA outline is not overridden, SELD-R2 stops. Outline `auto` paint belongs to PNT1.
- Keyboard traversal and keyboard-initiated `:focus-visible` go to P6 with accessibility parity. They are recorded as P6 scope,
  not dropped. The demo's only `:focus` rule is `outline: none`.

**RT-8. `cursor`.**
- **Android:** exact. `onResolvePointerIcon` returns the hit element's `cursor` mapped keyword for keyword to
  `PointerIcon.TYPE_*`. That API mirrors CSS cursors and exists since API 24.
- **iPadOS:** caveat. `UIPointerInteraction` styles: `text` becomes the beam, and `pointer` and `auto` become the system pointer.
  iPadOS has no hand shape, and the native feel follows platform convention.
- **iPhone:** no pointer, so `cursor` has no effect there.
- **Proof:** the applied-value dump of the resolved icon per hit point, against Chrome's computed `cursor`. Cursors are not in
  screenshots.

**RT-9. `pointer-events` and hit testing belong to Dragon.**
- Hit testing is Dragon's own: a TypeScript reference, translated. It walks precompiled hit nodes in reverse paint order, using
  engine boxes, inverse transforms, the overflow clip, `border-radius` when PNT1 is on master, and scroll offsets when OVFL is
  on master.
- `pointer-events` supports `auto` and `none`. It is inherited, and descendants with `auto` stay hittable. SVG values are
  refused.
- UIKit's `isUserInteractionEnabled` is not used, because it disables whole subtrees, which is wrong for CSS.
- **Proof:** a grid of Chrome `document.elementFromPoint` results per case, against the TS hit test on the host and the device
  hit test.
- Activation dispatch goes from the hit target to the nearest ancestor with a registered activation handler (button, `a`).
  Chrome's `click` `event.target` equals the `elementFromPoint` result in these fixtures.

**RT-10. MQ-R is band switching at run time.**
- Every band's delta table ships, from the T030 partition. `bandAt` takes precompiled interval tables and uses exact
  `contains` comparisons in a translated root.
- It runs on the root size that V2b's environment listener reports, in CSS px as the engine uses it.
- A band change is an **environment dimension**, separate from app state (api §5). It goes through the RT-1 delta path and is a
  style change event, so transitions fire where Chrome fires them. For example, the landscape library-active state transitions
  `margin-right` over .5 s.
- **Rotation happens in place.**
  - The Android host declares `configChanges` (orientation, screenSize, smallestScreenSize, screenLayout), so state survives,
    as it does in Chrome.
  - iOS uses the root view's bounds change.
  - Dragon lays out at the final size. Chrome has no rotation animation, so no intermediate frames are compared.
- **Proof:**
  - Chrome resize traces through CDP `Emulation.setDeviceMetricsOverride`: portrait to landscape per platform, then frames at 0
    and 250 ms and settled, with the clock frozen.
  - Boundary fixtures at 640, 640.5, 641, 768, 768.5 and 769 CSS px.
  - Device, in lane mode, through a root-resize hook, plus one real OS rotation per platform. On iOS that is
    `UIWindowScene.requestGeometryUpdate` (iOS 16+ simulator); on Android, `setRequestedOrientation`.
- Environment features (`hover`, `pointer`, `prefers-*`, `resolution`) stay refused. They become **MQ-R2**, not needed for
  checkpoint 3, and are kept on T019.

**RT-11. SOV means typed override slots.**
- A tree node declares a slot: `{ node, property, template, inputs }`. The inputs are typed as the api §4.3 `RuntimeValue`
  kinds, with a declared domain. The demo has two:
  - `transform: translateX(<p: percentage [0,100]>)`;
  - `background: linear-gradient(to right, <c0: color>, <c1: color>)`.
- A slot cascades as the style-attribute origin: above every author rule and below author `!important`. A matching `!important`
  author declaration is a build error.
- A shorthand slot resets its longhands as the inline shorthand does.
- **Setters are generated.**
  - Web: `el.style.setProperty` with Dragon's serialisation.
  - Native: evaluate the Residual and write through BG2's gradient writer and PNT2's transform writer.
  - A value outside the domain, or NaN, throws a located error before any mutation (api §3.4).
- A slot write is a style change event through the RT-1 path. A slot on a property with a declared transition is refused until
  ANIM-b is on master; the demo has none.
- **Proof** (api §4.3, "ranges require algorithm proof plus named boundary fixtures"):
  - **Algorithm proof:** reference vectors TS = Swift = Kotlin on a dense grid over the domain.
  - **Named boundary fixtures:** Chrome captures at `p` = 0, 100 and interior values that are not representable, and at colours
    for the extremes, `transparent` and the 4 song pairs, compared on frames and pixels.

**RT-12. Where the code lives.**
- The runtime algorithms are the clock, easing, timing, interpolation, hit testing and band selection. They go in new top-level
  files `packages/layout/src/rt-*.ts`, inside the translator subset, and become translated roots. That gives them a TS
  reference, shared vectors and generated Swift and Kotlin, as api §4.4 requires of helpers. There is no separate runtime
  package, and the helpers never see CSS text or match selectors.
- The native glue goes in new files under `packages/dragon/src/emit/runtime/<feature>.ts`.
- The compiler tables go in new files: `lower/state-program.ts`, `lower/anim-program.ts` and so on.

**RT-13. Registry hunks.** This extends the `fixtures.ts` precedent, so that the rt chain does not serialise against INL1, V2a
and V2b on the hotspot files. In each file below, a runtime package may make only **additive hunks at named registration points**.
The integrator resolves them at merge.

| File | Allowed hunk |
|---|---|
| `emit/native-support.ts` | The support file list, and one import per runtime module |
| `packages/parity/src/native-host.ts` and `native-dump.ts` | Case-kind and dump-record registration |
| `packages/dragon/src/internal.ts` | Exports |
| `packages/translate/src/generate.ts` | `engineRoots` entries |
| `packages/translate/harness/harness.ts` and `src/corpus.ts` | Suite entries |
| `packages/parity/src/lanes.ts` | Lane entries |
| `packages/parity/src/chrome.ts` and `capture.ts` | Case-kind capture registration |

The check at verify time is `git diff -U0 BASE -- <file>`, which must show only `+` lines inside those blocks. Any removed or
changed line in these files is a stop, unless the PM confirms that no other package on the hotspot list (V2a rule 5) is in
flight.

## 2. Order and parallelism

| # | Package | Starts after (on master) | Runs alongside | Serial against |
|---|---|---|---|---|
| 1 | **ANIM-a**: timing and interpolation reference, Chrome oracle. New files only | now (41cc750) | everything | — |
| 2 | **ANIM-a2**: translate the rt roots, native vector equality | ANIM-a, T009 Phase B (V1) | INL1, paint wave | other `packages/translate/**` writers (V2a) |
| 3 | **SELD-R1**: finite-state runtime (setters, deltas), Dragon hit testing, `pointer-events`, tap dispatch, virtual clock skeleton | T007 (P5), T043 (TREE merge), ANIM-a2 | V2a and INL1 (RT-13 hunks only), paint wave | T040 viewer (native-host.ts) |
| 4 | **SELD-R2**: `:hover`, `:focus`, `:focus-visible` from traces, `cursor`, hit test through transforms and stacking | SELD-R1, T030, PNT1, PNT2 | SOV (if the PM confirms disjoint compiler files), INL1 and TXT | ANIM-b |
| 5 | **ANIM-b**: `transition`, `@keyframes`, `animation`, `animation-play-state`; display driver and virtual driver; frame fixtures | SELD-R2, ANIM-a2 | SOV (RT-13) | MQ-R |
| 6 | **SOV**: typed override slots, the progress transform and the track gradient | SELD-R1, BG2, PNT2; the NS cases after T034 | SELD-R2 or ANIM-b (RT-13; the PM checks compiler-file overlap at dispatch) | — |
| 7 | **MQ-R**: band switching on resize and rotation, transitions on band change | ANIM-b, T030, T027 (V2b) | — | — |

The longest runtime pole is P5, then TREE, SELD-R1, SELD-R2 (after PNT1 and PNT2), ANIM-b, and finally MQ-R after V2b. MQ-R's
wait on V2b (after INL1) puts it at the end of checkpoint 3. The PM should not start V2b later than INL1's merge.

Every device step holds the platform lease (`ios`, `android` or both). The T018 NS lane consumes all six packages.

## 3. Worker packages

`ENV` below means the literal prefix
`export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`.
It starts **every** verify command, and the JSON receipt spells it out in full.

**Common to every package:**
- no push, remote or install outside /tmp;
- notes are written only in the main checkout and never committed on the branch;
- `design/` is not touched;
- generated files are regenerated, never hand-edited;
- no tolerance, gate, case, DPR or direction is loosened;
- pinned tests may be retargeted under the Throughput rule, and each retarget is listed in the receipt.

**Common verify items**, referenced as C1 to C6:
- **C1:** `ENV pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`. All green, and nothing is `.skip`, `.only` or
  `.todo`.
- **C2:** `ENV pnpm run layout:subset` gives 0 violations.
- **C3:** `ENV pnpm run native:gen && git diff --stat packages/layout/generated`. Only regenerated output changes, and the
  receipt lists header-only (relaxed) files.
- **C4:** `ENV pnpm run parity:capture && pnpm run parity:capture && git diff --exit-code packages/parity/expected`, and the
  same for `parity:dpr-capture` and `expected-dpr`: the second run gives no diff.
- **C5:** `ENV git diff --diff-filter=MD --name-only BASE -- packages/parity/expected packages/parity/expected-dpr packages/layout/vectors`
  is empty. Emitted files differ in header lines only.
- **C6:** `ENV git diff --name-only BASE..HEAD` lies inside allowed_files, and the RT-13 check passes. `git remote -v` is empty.

### 3.1 ANIM-a: timing and interpolation reference (start now)

- **Base:** master 41cc750. **Worktree:** `/tmp/dragon-anim-a`. **Branch:** `anim-a-timing`.
- **Objective.** Build the TypeScript reference, inside the subset and not yet a translated root, for:
  - the timing functions: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier()`, `steps()` with every jump
    keyword, `step-start` and `step-end`. This is the RT-3 port, with the before flag.
  - the web-animations timing model: delay (including negative), duration, iterations including `infinite`, direction, fill,
    and hold time for pause. It outputs the phase, iteration progress and current iteration.
  - interpolation of number, length-percentage, angle and legacy sRGB colour (premultiplied), and transform lists (RT-4):
    pairwise and `none` promotion, with mismatched lists returning `refused`.
  - serialisers equal to Chrome's computed-value strings.

  A Chrome oracle script captures:
  - `getComputedTiming()` progress and iteration (the doubles as bits hex) over a derived grid of timing functions (keywords,
    the demo's, seeded control points including y outside [0, 1]) and times (boundaries, discontinuities, before and after
    phases, iteration edges);
  - `getComputedStyle` strings for held `element.animate()` interpolations of each primitive.

  The reference must equal the oracle bit for bit and string for string. The work also includes TypeScript vectors for
  ANIM-a2, and planted faults.
- **allowed_files:**
  - `packages/layout/src/rt-easing.ts` (new)
  - `packages/layout/src/rt-timing.ts` (new)
  - `packages/layout/src/rt-interpolate.ts` (new)
  - `packages/layout/test/rt-easing.test.ts` (new)
  - `packages/layout/test/rt-timing.test.ts` (new)
  - `packages/layout/test/rt-interpolate.test.ts` (new)
  - `packages/layout/test/rt-faults.test.ts` (new)
  - `packages/layout/rt-oracle/**` (new)
  - `packages/layout/rt-vectors/**` (new)
  - `scripts/capture-rt-oracle.ts` (new; imports `launchChrome` from packages/parity unchanged)
  - `package.json` (one script hunk, `rt:oracle`; no dependency)
  - `packages/layout/generated/**` (regenerated only; header lines relaxed)
- **verify:**
  1. C1.
  2. `ENV pnpm run rt:oracle && pnpm run rt:oracle && git diff --exit-code packages/layout/rt-oracle`: byte-identical.
  3. `ENV pnpm run rt:oracle -- --check`: failed 0. Every progress is bit-equal and every serialisation is string-equal. The
     derived sample counts are printed and recorded.
  4. The library frame: the oracle has `cubic-bezier(0.25,0.1,0.25,1)` at x = 0.5, and the reference equals it.
     `rotate(0deg)` to `rotate(360deg)` at 0.25 serialises as Chrome's `matrix(0, 1, -1, 0, 0, 0)`.
  5. C2.
  6. C3 shows at most header-only changes.
  7. The planted faults are each caught by `pnpm test`: `newtonIterations3`, `epsilon1e-6`, `noSplineGuess`,
     `stepsIgnoreBeforeFlag`, `rotateViaMatrix`, `colorUnpremultiplied` and `holdTimeLost`.
  8. C6, with BASE 41cc750.
- **stop_if:**
  - Chrome disagrees with the port after the Worker has read the Blink and gfx source at Chrome 145's revision. Report the sample
    and both values. No tolerance is allowed.
  - The subset cannot express the algorithm, and a translator change would be needed.
  - The oracle is not byte-identical run to run.
  - A file outside allowed_files is needed.
  - Verification fails twice.

### 3.2 ANIM-a2: translated rt roots

- **Base:** master after ANIM-a and T009 Phase B. **Worktree:** `/tmp/dragon-anim-a2`. **Branch:** `anim-a2-translate`.
- **Objective.** Add the `rt-*` entry points as `engineRoots`, and add an rt suite to the translate harness and corpus. Swift
  and Kotlin must equal the TypeScript rt vectors bit for bit, and `layout-vectors-device` must carry the rt suite on both
  platforms.
- **allowed_files:**
  - `packages/translate/src/generate.ts` (RT-13 roots hunk)
  - `packages/translate/src/corpus.ts` (suite hunk)
  - `packages/translate/harness/harness.ts` and `host.ts` (suite hunk)
  - `packages/translate/test/rt-*.test.ts` (new)
  - `packages/translate/corpus*.json` (regenerated)
  - `packages/layout/generated/**` (regenerated)
  - `packages/parity/out/lanes.json`
- **verify:**
  1. C1.
  2. C2.
  3. `ENV pnpm run native:gen && pnpm run native:swift && pnpm run native:kotlin`: every suite is equal, including rt.
  4. `ENV pnpm run native:planted`: every plant is caught.
  5. On both leases, `ENV pnpm run parity:lanes -- --run-host --run-device`. `layout-vectors-device` includes the rt suite and
     equals the host on iOS at 2 and 3 and Android at 2, 2.625 and 3. No lane is `not run`, and the existing verdicts are
     unchanged.
  6. C6.
- **stop_if:**
  - `emit-swift.ts`, `emit-kotlin.ts`, `lower.ts`, `ir.ts` or a prelude must change.
  - An existing vector or corpus output changes.
  - The lease is not held.
  - A file is needed outside allowed_files.
  - Verification fails twice.

### 3.3 SELD-R1: state runtime, hit testing and pointer-events

- **Base:** master after T007, T043 and ANIM-a2. **Worktree:** `/tmp/dragon-seld-r1`. **Branch:** `seld-r1-state-hit`.
- **Objective.**
  1. **State runtime (RT-1).** `lower/state-program.ts` derives the base program plus per-condition write deltas for every
     tree fixture with states: free states, branch creation and removal, and text choices. `emit/runtime/state.ts` emits typed
     setters (enums and booleans; invalid values throw in dev) in Swift and Kotlin, and the web attribute program.
  2. **Hit testing (RT-9).** `packages/layout/src/rt-hit.ts` is a translated root. It covers reverse paint order in tree order,
     engine boxes, overflow clips and `pointer-events` `auto`/`none` inherited. `pointer-events` is compiled with a profile row.
     Tap dispatch goes to the nearest registered activation ancestor.
  3. **The clock** interface of RT-5, with only the virtual driver wired. The display driver comes in ANIM-b.
  4. **Case scripts** in the host: `set(state, value)`, `tap(x, y)`, `advance(ms)` and `dump`, registered as a case kind.
  5. **New lanes:**
     - `device-states`: each script's dump equals the expected dump of the assignment it ends in, and A to B to A equals A.
     - `device-hit`: the device hit test equals the TS hit test equals Chrome `elementFromPoint` over a derived grid per case,
       including edges ±0.5 device px.
  6. **Fixture group `states`**, in ltr and rtl, covering:
     - two instances of one component with ancestor-dependent state (api §3.2);
     - a branch;
     - `pointer-events: none` over a hittable sibling;
     - `none` with an `auto` child;
     - overflow-clipped hits.
- **allowed_files:**
  - `packages/dragon/src/lower/state-program.ts` (new)
  - `packages/dragon/src/emit/runtime/state.ts` (new)
  - `packages/dragon/src/emit/runtime/hit.ts` (new)
  - `packages/dragon/src/emit/runtime/clock.ts` (new)
  - `packages/dragon/src/emit/runtime/index.ts` (new registry)
  - `packages/dragon/src/css/properties.ts` (append `pointer-events` only)
  - `packages/dragon/src/faults.ts` (append)
  - `packages/dragon/src/diagnostics/catalogue.ts` (append)
  - `packages/dragon/test/diagnostic-codes.json` (append)
  - `packages/dragon/test/state-program.test.ts` (new)
  - `packages/dragon/test/pointer-events.test.ts` (new)
  - `packages/dragon/src/profiles/web.ts`, `ios.ts` and `android.ts` (regenerated by `profile:rows` only)
  - RT-13 hunks in:
    - `packages/dragon/src/emit/native-support.ts`
    - `packages/dragon/src/internal.ts`
    - `packages/parity/src/native-host.ts`
    - `packages/parity/src/native-dump.ts`
    - `packages/parity/src/lanes.ts`
    - `packages/parity/src/chrome.ts`
    - `packages/parity/src/capture.ts`
    - `packages/translate/src/generate.ts`
    - `packages/translate/src/corpus.ts`
    - `packages/translate/harness/harness.ts`
  - `packages/layout/src/rt-hit.ts` (new)
  - `packages/layout/test/rt-hit.test.ts` (new)
  - `packages/layout/rt-vectors/hit/**` (new)
  - `packages/parity/src/state-cases.ts` (new)
  - `packages/parity/src/hit-capture.ts` (new)
  - `packages/parity/src/cli/hit-capture.ts` (new)
  - `packages/parity/src/cli/hit-report.ts` (new)
  - `packages/parity/src/fixture-groups/states.ts` (new)
  - `packages/parity/src/fixtures.ts` (one import and one concatenation)
  - `packages/parity/fixtures/state-*.html`, `hit-*.html` and `reject-pointer-events-*.html` (new)
  - New files only under:
    - `packages/parity/expected/**` and `expected-dpr/**`
    - `packages/parity/expected-hit/**`
    - `packages/layout/vectors/**`
    - `packages/parity/emitted/**` (headers relaxed)
  - `packages/parity/test/state-*.test.ts` and `hit-*.test.ts` (new)
  - Derived-count pins in `packages/parity/test/*.test.ts` (literals only)
  - `packages/parity/out/lanes.json`
  - `packages/translate/corpus*.json` and `packages/layout/generated/**` (regenerated)
  - `examples/music-player/dragon/north-star-check.json` (regenerated)
  - `package.json` (script hunk)
- **verify:**
  1. C1.
  2. C4.
  3. C5.
  4. `ENV pnpm run parity:report` and `ENV pnpm run parity:dpr-report`: failed 0 at 1, 2, 2.625 and 3.
  5. `ENV pnpm run parity:hit-capture && pnpm run parity:hit-capture && git diff --exit-code packages/parity/expected-hit`,
     then `ENV pnpm run parity:hit-report`: TS equals Chrome at every grid point, failed 0.
  6. C2.
  7. C3.
  8. `ENV pnpm run native:swift && pnpm run native:kotlin && pnpm run native:planted`.
  9. `ENV pnpm run profile:rows`: only `pointer-events` rows and new proofs are added, and no existing status changes.
  10. `ENV pnpm run native:build -- --target ios && pnpm run native:build -- --target android`, at derived counts. Existing case
      sources are byte-identical apart from relaxed digest fields.
  11. On both leases, `ENV pnpm run parity:lanes -- --run-host --run-device`. `device-states` and `device-hit` pass at every DPR
      on both platforms, no lane is `not run`, and existing lanes keep their verdicts.
  12. The plants `stateDeltaDropped`, `setterSkipsRelayout`, `hitIgnoresPointerEventsNone`, `hitReversedOrder` and
      `pointerEventsNotInherited` are each caught on the host and on device.
  13. `ENV pnpm run north-star:check`: `pointer-events` diagnostics are gone, and no per-target count rises.
  14. `ENV pnpm run wpt:run -- --target web && pnpm run wpt:update-expectations -- --target web`: no pass becomes a fail.
  15. C6.
- **stop_if:**
  - A delta cannot be derived without changing an existing writer in `native-program.ts`, `uikit.ts` or `android-views.ts`.
  - The per-condition tables would need a Cartesian product over more than 64 assignments for any fixture. Report the fixture.
  - Chrome's `elementFromPoint` disagrees with CSS hit-testing rules on a case the Worker cannot explain from Blink source.
  - Any existing capture, vector, emitted body, profile status or case source changes.
  - An RT-13 file needs a non-additive edit.
  - The lease is not held.
  - A file is needed outside allowed_files.
  - Verification fails twice.

### 3.4 SELD-R2: hover, focus and cursor

- **Base:** master after SELD-R1, T030, PNT1 and PNT2 (the T046 packages). **Worktree:** `/tmp/dragon-seld-r2`.
  **Branch:** `seld-r2-hover-focus`.
- **Objective.**
  1. **Compile** `:hover`, `:focus` and `:focus-visible` as Dragon interaction states, per subject instance. The domain is
     "hovered chain" and "focused element", linear in instances and not 2^n. They resolve through the cascade with conditions,
     so `.library-song.selected` beats `:hover` as T014 found.
  2. **Traces (RT-6(b), RT-7).** A Chrome capture script drives taps and mouse moves and records the traces. The state-bit
     trace from the device runtime must equal them.
  3. **Platform drivers (RT-6(c)).** Android injects real `MotionEvent` mouse hover.
  4. **Forced hook** (RT-6(a)). The parity forced case kind uses `CSS.forcePseudoState`.
  5. **`cursor` (RT-8).**
  6. **Hit testing** through PNT2 transforms (inverse matrix) and the PNT1 stacking order.
  7. **Lanes:**
     - `device-traces`;
     - forced cases in `device-frames`, `device-applied` and `device-pixels`;
     - `device-hit` over transformed fixtures, for example the library at `translateX(100%)` being unhittable.
  8. **Fixture group `interaction`**, covering:
     - hover on a subject;
     - hover on an ancestor affecting a descendant in the same component;
     - `:focus` with `outline: none`;
     - `.selected` against `:hover` at equal specificity;
     - a transformed and scaled hit;
     - a `z-index` overlap.
- **allowed_files:**
  - `packages/dragon/src/css/selectors.ts` (lift the `:hover`, `:focus` and `:focus-visible` refusals)
  - `packages/dragon/src/analysis/match.ts` (interaction-state conditions)
  - `packages/dragon/src/analysis/cascade.ts` (condition hunk only)
  - `packages/dragon/src/css/properties.ts` (append `cursor`)
  - `packages/dragon/src/lower/interaction-program.ts` (new)
  - `packages/dragon/src/emit/runtime/interaction.ts` (new)
  - `packages/dragon/src/emit/runtime/cursor.ts` (new)
  - `packages/dragon/src/emit/runtime/index.ts` (append)
  - `packages/dragon/src/faults.ts`, `diagnostics/catalogue.ts` and `test/diagnostic-codes.json` (append)
  - `packages/dragon/test/interaction.test.ts` and `cursor.test.ts` (new)
  - Retargets of `packages/dragon/test/compile.test.ts:158`, `selectors.test.ts` and `seams.test.ts` refusal pins, under the
    Throughput rule and keeping their intent: for example `.a:hover` becomes `.a:active`, which is still refused.
  - `packages/dragon/src/profiles/*.ts` (regenerated)
  - `packages/layout/src/rt-hit.ts` (the transform and stacking extension)
  - `packages/layout/test/rt-hit.test.ts`
  - `packages/layout/rt-vectors/hit/**`
  - RT-13 hunks in the same files as SELD-R1
  - `packages/parity/src/trace-capture.ts` (new)
  - `packages/parity/src/cli/trace-capture.ts` (new)
  - `packages/parity/src/cli/trace-report.ts` (new)
  - `packages/parity/src/fixture-groups/interaction.ts` (new)
  - `packages/parity/src/fixtures.ts` (one import and one concatenation)
  - `packages/parity/fixtures/interaction-*.html` and `reject-interaction-*.html` (new)
  - New files only under `packages/parity/expected*/**`, `packages/parity/expected-traces/**`, `packages/layout/vectors/**` and
    `packages/parity/emitted/**`
  - `packages/parity/test/interaction-*.test.ts` and `trace-*.test.ts` (new)
  - Derived-count pins
  - `packages/parity/out/lanes.json`
  - Regenerated generated and corpus files
  - `examples/music-player/dragon/north-star-check.json` (regenerated)
  - `package.json` (script hunk)
- **verify:**
  1. C1.
  2. C4.
  3. C5.
  4. `parity:report` and `parity:dpr-report` both fail 0.
  5. `ENV pnpm run parity:trace-capture` twice is byte-identical, then `ENV pnpm run parity:trace-report`: the TS trace equals
     Chrome's for every tap and move sequence, failed 0. The receipt records whether Chrome shows sticky hover on touch.
  6. `parity:hit-report` fails 0, including the transformed fixtures.
  7. C2.
  8. C3.
  9. `native:swift`, `native:kotlin` and `native:planted`.
  10. `profile:rows`: only additions.
  11. `native:build` for both targets.
  12. On both leases, `ENV pnpm run parity:lanes -- --run-host --run-device`. `device-traces`, the forced cases and
      `device-hit` pass on iOS 2 and 3 and Android 2, 2.625 and 3. The Android `SOURCE_MOUSE` injection gives the same trace.
      iOS pointer glue is labelled caveat in the profile row.
  13. The plants `hoverWithoutAncestors`, `forcedSetsAncestors`, `focusOnNonFocusable`, `hitIgnoresTransform` and
      `cursorMapShifted` are caught.
  14. `north-star:check`: the 4 `:hover` and 1 `:focus` `UNSUPPORTED_SELECTOR` errors and the `cursor` errors are gone, and no
      count rises.
  15. WPT has no pass that becomes a fail.
  16. C6.
- **stop_if:**
  - A Chrome trace shows `:focus-visible` with an un-overridden UA outline in a demo sequence (outline paint belongs to PNT1).
  - A state rule would need matching at run time, which RT-12 forbids.
  - PNT1 or PNT2 do not expose the transform or stacking facts, so hit testing would need their writers changed.
  - Existing outputs change.
  - A non-additive edit is needed in an RT-13 file.
  - The lease is not held.
  - A file is needed outside allowed_files.
  - Verification fails twice.

### 3.5 ANIM-b: transitions, keyframes, animations and play-state

- **Base:** master after SELD-R2 and ANIM-a2. **Worktree:** `/tmp/dragon-anim-b`. **Branch:** `anim-b-css`.
- **Objective.**
  1. **Compile** `transition-*` and `animation-*` longhands and shorthands, and `@keyframes`, including per-keyframe timing
     functions, into typed tables in `lower/anim-program.ts`.
  2. **Refuse, with a named package:**
     - mismatched transform lists (ANIM-m);
     - `linear()` easing;
     - `transition-behavior: allow-discrete`;
     - composite modes;
     - view transitions.
  3. **Runtime** (RT-1, RT-2 and RT-5):
     - style change events from state setters, band changes and slots;
     - the before-change style, `all`, list repetition, delays, the reversing shortening factor, and cancellation;
     - CSS animation start at first style, and play-state pause and resume that keeps phase (T014: 90deg at 6000 ms);
     - animated values applied through the writers, with layout only for layout-affecting properties;
     - the display driver and the virtual driver.
  4. **Web output** keeps `@keyframes` and the transitions verbatim in serialisation.
  5. **A parity frame case kind.** Chrome frames are held with `setPlaybackRate(0)` and `currentTime` at fixed times; the device
     runs a virtual clock `advance()`.
  6. **Fixture group `animations`**, covering:
     - rotate spin at 0, 5000 and 20000 ms;
     - pause at 5000 read at 6000;
     - a `translateX(%)` and opacity transition at 250 ms;
     - a reversal mid-flight;
     - a `margin-right` layout transition;
     - `steps()` at discontinuities;
     - a colour transition from `transparent`;
     - `transition: all` over hover.

     Frames are compared on `device-frames`, `device-applied` and `device-pixels` at every DPR.
- **allowed_files:**
  - `packages/dragon/src/css/properties.ts` (append the animation and transition longhands and shorthands)
  - `packages/dragon/src/css/at-rules.ts` (register `@keyframes`)
  - `packages/dragon/src/css/at-rules/keyframes.ts` (new)
  - `packages/dragon/src/analysis/animations.ts` (new)
  - `packages/dragon/src/lower/anim-program.ts` (new)
  - `packages/dragon/src/emit/runtime/anim.ts` (new)
  - `packages/dragon/src/emit/runtime/clock.ts` (the display driver)
  - `packages/dragon/src/emit/runtime/index.ts` (append)
  - `packages/dragon/src/emit/web-css.ts` (the `@keyframes` serialisation hunk)
  - `packages/dragon/src/faults.ts`, `diagnostics/catalogue.ts` and `test/diagnostic-codes.json` (append)
  - `packages/dragon/test/animations.test.ts` and `keyframes.test.ts` (new)
  - `packages/dragon/src/profiles/*.ts` (regenerated)
  - `packages/layout/src/rt-*.ts` (additive entry points)
  - `packages/layout/test/rt-*.test.ts`, `packages/layout/rt-vectors/**` and `packages/layout/rt-oracle/**` (additive)
  - `scripts/capture-rt-oracle.ts` (additive)
  - RT-13 hunks in the SELD-R1 list
  - `packages/parity/src/frame-capture.ts` (new)
  - `packages/parity/src/fixture-groups/animations.ts` (new)
  - `packages/parity/src/fixtures.ts` (one import and one concatenation)
  - `packages/parity/fixtures/anim-*.html` and `reject-anim-*.html` (new)
  - New files only under `packages/parity/expected*/**`, `packages/parity/expected-frames/**`, `packages/layout/vectors/**` and
    `packages/parity/emitted/**`
  - `packages/parity/test/anim-*.test.ts` and `frame-*.test.ts` (new)
  - Derived-count pins
  - `packages/parity/out/lanes.json`
  - Regenerated generated and corpus files
  - `examples/music-player/dragon/north-star-check.json` (regenerated)
  - `package.json` (script hunk)
- **verify:**
  1. C1.
  2. C4, including the frame cases twice, byte-identical.
  3. C5.
  4. `parity:report` and `parity:dpr-report` fail 0, frame cases included.
  5. `ENV pnpm run rt:oracle -- --check`: failed 0.
  6. C2.
  7. C3.
  8. `native:swift`, `native:kotlin` and `native:planted`.
  9. `profile:rows`: only additions.
  10. `native:build` for both targets.
  11. On both leases, `ENV pnpm run parity:lanes -- --run-host --run-device`. Frame cases pass `device-frames`, `device-applied`
      and `device-pixels` at every DPR on both platforms. Two device runs of the frame cases give byte-identical dumps, which is
      the virtual-clock determinism check.
  12. A display-driver smoke on each platform: the spin angle advances monotonically with the frame timestamps. This is
      evidence, not a gate.
  13. The plants `easeFloat32`, `rotateViaMatrix`, `pauseLosesPhase`, `noReversalShortening`, `transitionOnFirstStyle` and
      `laneUsesWallClock` are caught.
  14. `north-star:check`: the `transition`, `animation`, `animation-play-state`, `will-change` and `@keyframes` errors are
      gone, and no count rises.
  15. WPT has no pass that becomes a fail.
  16. C6.
- **stop_if:**
  - A Chrome frame disagrees with the reference. Report it after the Worker has read the Blink source.
  - A demo transition needs matrix interpolation or `linear()`.
  - A layout transition cannot run the engine per frame without a `LayoutInput` change.
  - Existing outputs change.
  - A non-additive edit is needed in an RT-13 file.
  - The lease is not held.
  - A file is needed outside allowed_files.
  - Verification fails twice.

### 3.6 SOV: typed style overrides

- **Base:** master after SELD-R1, BG2 and PNT2. **Worktree:** `/tmp/dragon-sov`. **Branch:** `sov-overrides`.
- **Objective.** Deliver RT-11:
  - the slot schema in the tree types and the fixture reader;
  - the `style`-origin cascade, which lifts TREE's `reject-attr-style` in favour of slots;
  - Residual lowering;
  - generated setters for web, Swift and Kotlin;
  - the domain guards;
  - the demo's two slots in `examples/music-player/tree/fixture.json`.

  The proof is:
  - dense TS = Swift = Kotlin vectors over each domain;
  - Chrome boundary fixtures (group `overrides`) with inline `style` at named values, on frames and pixels at every DPR;
  - after T034, NS lane cases `progress-0`, `progress-37.5`, `progress-100` and `song-2-colors`, appended to
    `tools/lane-manifest.ts` and captured.
- **allowed_files:**
  - `packages/dragon/src/types.ts` (slot types; additive)
  - `packages/dragon/src/analysis/link.ts` and `analysis/cascade.ts` (style-origin hunks)
  - `packages/dragon/src/attributes.ts` (`style` becomes slot-backed)
  - `packages/dragon/src/lower/override-program.ts` (new)
  - `packages/dragon/src/emit/runtime/override.ts` (new)
  - `packages/dragon/src/emit/runtime/index.ts` (append)
  - `packages/dragon/src/faults.ts`, `diagnostics/catalogue.ts` and `test/diagnostic-codes.json` (append)
  - `packages/dragon/test/override.test.ts` (new)
  - A retarget of the `reject-attr-style` pin to an unslotted `style` that is still refused
  - `packages/layout/src/rt-residual.ts` (new)
  - `packages/layout/test/rt-residual.test.ts` (new)
  - `packages/layout/rt-vectors/residual/**` (new)
  - RT-13 hunks in the SELD-R1 list
  - `packages/parity/src/tree-fixture.ts` (additive slot reading)
  - `packages/parity/src/fixture-groups/overrides.ts` (new)
  - `packages/parity/src/fixtures.ts` (one import and one concatenation)
  - `packages/parity/fixtures/override-*.html` and `reject-override-*.html` (new)
  - New files only under `packages/parity/expected*/**`, `packages/layout/vectors/**` and `packages/parity/emitted/**`
  - `packages/parity/test/override-*.test.ts` (new)
  - Derived-count pins
  - `packages/parity/out/lanes.json`
  - Regenerated generated and corpus files
  - `examples/music-player/tree/fixture.json` (slots only)
  - `examples/music-player/tools/lane-manifest.ts` (append cases)
  - `examples/music-player/lane/**` and `examples/music-player/chrome/**` (regenerated, after T034)
  - `examples/music-player/dragon/north-star-check.json` (regenerated)
  - `package.json` (script hunk)
- **verify:**
  1. C1.
  2. C4.
  3. C5.
  4. `parity:report` and `parity:dpr-report` fail 0.
  5. C2.
  6. C3.
  7. `native:swift`, `native:kotlin` and `native:planted`, including the residual grid.
  8. `native:build` for both targets.
  9. On both leases, `parity:lanes --run-host --run-device`: the override cases pass `device-frames`, `device-applied` and
     `device-pixels` at every DPR. A setter given an out-of-domain value or NaN on device leaves the previous dump unchanged and
     reports the located error.
  10. `ENV pnpm run north-star:capture` twice gives no diff, and `north-star-reference` passes.
  11. The plants `percentBasisContentBox`, `slotBelowAuthorRule`, `shorthandSlotKeepsColor` and `domainUnchecked` are caught.
  12. `north-star:check`: the `style` attribute refusals are gone, and no count rises.
  13. C6.
- **stop_if:**
  - A demo slot needs a value kind outside api §4.3 without a recorded ruling.
  - BG2 or PNT2 writers must change.
  - A slot has a declared transition and ANIM-b is not on master.
  - T034 has not landed when the NS cases are due. Finish everything else and report.
  - Existing outputs change.
  - The lease is not held.
  - A file is needed outside allowed_files.
  - Verification fails twice.

### 3.7 MQ-R: band switching at run time

- **Base:** master after ANIM-b, T030 and T027 (V2b). **Worktree:** `/tmp/dragon-mq-r`. **Branch:** `mq-r-runtime`.
- **Objective.** Deliver RT-10:
  - ship every band's delta table and `bandAt` as a translated root;
  - switch bands on V2b's root-size events;
  - make each switch a style change event, so transitions fire;
  - rotate in place: Android `configChanges` in the generated host, iOS on the bounds change;
  - lift the MQ-R native refusal from T030.

  The proof is:
  - Chrome resize traces (`Emulation.setDeviceMetricsOverride`) and boundary fixtures (group `media-runtime`);
  - device root-resize scripts and one real rotation per platform, compared on frames, applied values and pixels;
  - NS `north-star:check` with 0 `UNSUPPORTED_AT_RULE` per target.

  Environment features stay refused as MQ-R2.
- **allowed_files:**
  - `packages/dragon/src/media/band-tables.ts` (new)
  - `packages/dragon/src/lower/band-program.ts` (new)
  - `packages/dragon/src/emit/runtime/media.ts` (new)
  - `packages/dragon/src/emit/runtime/index.ts` (append)
  - The T030 refusal site: the named hunk in the file T030 lands it in
  - `packages/dragon/src/faults.ts`, `diagnostics/catalogue.ts` and `test/diagnostic-codes.json` (append)
  - `packages/dragon/test/media-runtime.test.ts` (new)
  - `packages/dragon/src/profiles/*.ts` (regenerated)
  - `packages/layout/src/rt-band.ts` (new)
  - `packages/layout/test/rt-band.test.ts` (new)
  - `packages/layout/rt-vectors/band/**` (new)
  - RT-13 hunks in the SELD-R1 list
  - `packages/parity/src/resize-capture.ts` (new)
  - `packages/parity/src/fixture-groups/media-runtime.ts` (new)
  - `packages/parity/src/fixtures.ts` (one import and one concatenation)
  - `packages/parity/fixtures/mqr-*.html` (new)
  - New files only under `packages/parity/expected*/**`, `packages/layout/vectors/**` and `packages/parity/emitted/**`
  - `packages/parity/test/media-runtime-*.test.ts` (new)
  - Derived-count pins
  - `packages/parity/out/lanes.json`
  - Regenerated generated and corpus files
  - `examples/music-player/dragon/north-star-check.json` (regenerated)
  - `package.json` (script hunk)
- **verify:**
  1. C1.
  2. C4, including the resize traces twice.
  3. C5.
  4. `parity:report` and `parity:dpr-report` fail 0.
  5. C2.
  6. C3.
  7. `native:swift`, `native:kotlin` and `native:planted`.
  8. `native:build` for both targets.
  9. On both leases, `parity:lanes --run-host --run-device`. Resize and rotation cases pass on every DPR. After a real rotation,
     the device reports the landscape root size, the landscape band, and the same app state.
  10. The plants `bandBoundaryExclusive`, `bandChangeNoTransition` and `activityRecreated` are caught.
  11. `north-star:check` has 0 `UNSUPPORTED_AT_RULE` on ios and android, and no count rises.
  12. WPT has no pass that becomes a fail.
  13. C6.
- **stop_if:**
  - V2b does not expose a size-change event.
  - No device can hold a landscape case (never crop).
  - Chrome's band boundary behaviour at fractional widths disagrees with `contains`. Report it after reading the source.
  - Existing outputs change.
  - The lease is not held.
  - A file is needed outside allowed_files.
  - Verification fails twice.

## 4. Why these slices

- **ANIM-a runs now.** It is the numerics risk (RT-3), and it writes new files only.
- **SELD-R1 carries all the missing state and hit plumbing** that every other package and the NS lane need. It is one vertical,
  device-proven slice, not helpers.
- **Features stay in separate packages** (hover, animation, overrides, bands). Each has its own oracle kind: traces, frames,
  boundary fixtures and resize traces. Merging any two would double the stop surface without sharing proof.

## 5. Planted-fault principle

Every package's plants must fail its **own** new lane on host and device while leaving the other lanes passing. This follows
T010 §3's integrity rule.

## 6. Gaps and board updates for the PM

1. **Dynamic text is not owned by any package.** The `.time-current` and `.time-duration` `textContent`, "0:00" to "3:07",
   need text relayout on content change. Recommendation: in scope for "end to end" as a typed text slot, **DTXT**, after TXT1a,
   proven with fixed strings. Chrome comparisons stay on static text.
2. **T045 (FORM-a):** the range `value` and `max` are continuous. They must reuse SOV's typed-input mechanism (RT-11), not a
   second one.
3. **T046:**
   - PNT1 and PNT2 must expose stacking order and transform matrices as program facts, readable by `rt-hit.ts` (SELD-R2).
   - OVFL must extend `rt-hit.ts` with scroll offsets and the scroll-container clip, with `elementFromPoint` proof.
4. **T018 (NS-LANE):** it consumes the case scripts (`set`, `tap`, `forcePseudo`, `advance`, `resize`) from SELD-R1, SELD-R2,
   ANIM-b and MQ-R. Add landscape NS cases after MQ-R.
5. **Record in decisions.md, as PM rulings from this research:**
   - RT-1 to RT-13;
   - that the owner's "progress bar width" is a `translateX(%)` transform.
6. **T019:** keep MQ-R2 (environment media features), ANIM-m (matrix interpolation), `linear()` easing, the compositor offload,
   and keyboard focus (P6) on the board. None is needed for checkpoint 3.
