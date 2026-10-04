# T064 SELD-R2: :hover, :focus, :focus-visible, :active and cursor on device, binding worker spec (Judge, 2026-10-03)

This supersedes notes/T047-runtime-spec.md §3.4 and Amendment T064J wherever they differ, and keeps everything in them that is
not changed here. It also says how T146 (SELD-R2b, hit testing through transforms and stacking) relates and fixes its contract.
Read-only review: nothing in the repo was changed. Chrome probes are in /tmp/t064-probe (probe1.mjs, probe2.mjs). The Chrome
sources fetched at the tag are in /tmp/t064-src, and html.css is at /tmp/t064-html.css.

**Read:**
- AGENTS.md;
- goal.md for milestone 1 (design principles; principle 3 says "It applies `:hover` only on devices that can hover") and for
  milestone-2-proof (the Decision Rule, Throughput, the landing queue and trains);
- PM-2026-10-01.md and PM-2026-10-03.md (the queue after train 1, the T150 order, the SELD-P gap);
- docs/research/coverage-roadmap.md: the SELD row (usage `:hover` 91%, `:focus` 80.9%, `:focus-visible` 58.3%), §4
  (hotspots: `cascade.ts` CASC, `match.ts` and `selectors.ts` SELS);
- docs/research/pitfalls.md: P18, C5 and §4.5 (":hover rules become 'while a real pointer hovers' on native and never stick
  after a tap"; the hover-only-reveal warning);
- docs/decisions.md: "Runtime styles and animation (T047)" ("Hover and focus: tap behaviour follows recorded Chrome traces"),
  "Paint (T046)", "Adding engine fields and CSS longhands", "Porting Chrome's algorithms", "Selectors and scrollbars", the
  P6 split (P6e keyboard focus); docs/ports.md; docs/api.md §4.2 to §4.4 and the environment list in §10;
- state.yaml: T047, T063/T134, T064, T065, T146, T150, T052;
- notes: T047 (RT-6 to RT-9, RT-12, RT-13, §3.3, §3.4, amendments T063J and T064J), T065-anim-b-spec.md (R1, §11 gap SELD-P,
  the b2 hook), T150-visibility-spec.md (R6, R7, landing order), T046 §1 and §5.7, T045 (the button press visual is "CSS
  `:active` only (SELD-R)"), T052J;
- examples/music-player: styles.css (lines 43, 101, 273, 305, 343, 409, 465), tree/fixture.json, north-star-check.json;
- master 0ef8c05ee: `lower/state-program.ts` (`MAX_STATE_TABLE_ASSIGNMENTS = 64`), `emit/runtime/state.ts` (the state
  writes: background, border styles, border colours, clip, text), `attributes.ts` (tabindex is refused);
- branches seld-r2, seld-r2a, seld-r2b, seld-r2c (all on 129c5ea420), seld-r1 (#75), seld-lanes-v2 (#111), form-a4-v2
  (#79), and the open PR list.

**Chrome 145 sources** (gitiles at 145.0.7632.6). For each, the licence is noted:
- `core/input/gesture_manager.cc` (BSD Chromium): `GetHitTypeForGestureType` at 95-117, and `HandleGestureTap` at 219-330,
  with the fake mousemove that sets tap hover at 250-262 and the TODO crbug.com/368256331;
- `core/input/mouse_event_manager.cc` (BSD Chromium): `HandleMouseFocus` at 497-590;
- `core/input/keyboard_event_manager.cc` (BSD Chromium): 330-338, where a keydown without ctrl, alt or meta sets
  HadKeyboardEvent;
- `core/input/event_handler.cc` (BSD Apple): `SelectCursor` at 572;
- `ui/android/.../ViewAndroidDelegate.java` (BSD Chromium): `onCursorChanged` at 309;
- **LGPL, class A, reference only:** `core/css/selector_checker.cc` (`MatchesFocusVisiblePseudoClass` at 3669-3709),
  `core/dom/element.cc` (`SetFocused` at 8036-8058, `MayTriggerVirtualKeyboard` at 10688),
  `core/html/forms/html_input_element.cc`, and `core/html/resources/html.css` (`:focus-visible` at 1375-1377, 1399-1423;
  cursors at 406, 489, 737).

## 0. Facts that shape the spec

### 0.1 What the music player uses

The music player is on master north-star-check.json, which has 343 errors: web 163, ios 199, android 199.

| Line | Rule | Declarations | Subject | Today |
|---|---|---|---|---|
| 43 | `button` | `cursor: pointer` | 7 buttons | UNSUPPORTED_PROPERTY |
| 101 | `.library-button:hover` | background, border-color, color (with `transition: all .3s`) | `<button>` | UNSUPPORTED_SELECTOR |
| 273 | `input[type=range]` | `cursor: pointer` | the range | UNSUPPORTED_PROPERTY |
| 305 | `input[type=range]:focus` | `outline: none` (T014: `changed: false`) | the range | UNSUPPORTED_SELECTOR |
| 343 | `.play-control button:hover` | `color`, `transform: scale(1.08)` | 3 `<button>` | UNSUPPORTED_SELECTOR |
| 409 | `.library-song:hover` | background (`.library-song.selected` follows at equal specificity) | 4 `<button>` (LibrarySong × 4 songs) | UNSUPPORTED_SELECTOR |
| 465 | `.youtube-disclosure a:hover` | color | `<a href>` (refused until TDEC) | UNSUPPORTED_SELECTOR |

That is 5 SELECTOR errors and 2 PROPERTY errors, counted once each in `summary.errors` and per target. Every subject is a
`<button>`, `<input>` or `<a href>`, so nothing resolves before FORM-a (#77 to #79). seld-r2c's
interaction-corpus.test pins exactly that: "no north-star case resolves today".

The app has 4 assignments (`libraryStatus` × `isPlaying`, from `checkReport.method`). The hover candidates are the library
button, 3 play-control buttons, 4 library songs and the link, giving about 9 distinct hover chains. Add focus on the range and
`.selected` per song, and the interaction states multiply the app's 4 assignments past R1a's
`MAX_STATE_TABLE_ASSIGNMENTS = 64` (state-program.ts:16). This decides R7.

### 0.2 What the earlier branches hold

All four branches are on 129c5ea420, the old seld-lanes, before train 1. None can be merged; each is reused by cherry-pick of its
source commits followed by regen, as BG2 was (PM-2026-10-03).

| Branch | Head | Ahead of master | Reviewable source diff | Content | Reuse |
|---|---|---|---|---|---|
| seld-r2 | d085ea7fe | 31 | 169 KB, 61 files | Monolithic first R2a (Amendment T064J): selectors, partition, web conditions, TS runtime, traces. It has no cursor | **None directly.** Superseded by the a/b/c split, which carries its fixes (forced cases counted beside the reachable ones, `isForcedCaseId`) |
| seld-r2a | 0c6c05f69 | 26 | 130 KB | Part A: lifts the selectors in `selectors.ts`; `match.ts` `InteractionState`; `analysis/interaction.ts` partition (to a fixed point); resolve, cascade and project hunks; web conditions from dg classes; `INTERACTION_FORCED`; forced cases `~ix<k>` through the `forced-pseudo.ts` prepare hook; fixtures interaction-hover and interaction-focus; reject-interaction-active and reject-interaction-direction; test retargets | **Yes, as the base of PR 1.** Change it per R4 to R9: add `:active`, use dimensions and products instead of one partition, collapse equal states, gate hover on web, and delete `combinedStateRefusal` |
| seld-r2b | 514ecd546 | 28 | 44 KB | Part B: `lower/interaction-program.ts` (one interaction variable in the R1a table), `emit/runtime/interaction.ts` (TS reference runtime), `trace-capture.ts`, `trace-report.ts`, expected-traces (touch, mouse and forced; Chrome shows sticky hover after a touch tap) | **Trace capture: yes**, extended per R14. **Runtime: the logic is kept but moves** into a translated root `rt-interaction.ts` (R12). The tap semantics change (R1). **interaction-program.ts: replaced** by the two-level table (R7) |
| seld-r2c | d30b29054 | 34 | 93 KB | Part C: `cursor` longhand (grammar, UA capture; label's UA `cursor: default`); `emit/runtime/cursor.ts` (Chrome `SelectCursor` composed with `ViewAndroidDelegate.onCursorChanged` gives an Android PointerIcon); cursor identity (`expected-cursor/identity-base.json`, `cursor-capture-identity.test.ts`); interaction-corpus.test (completeness, exclusivity, identity); fixtures interaction-cursor and reject-interaction-cursor-url; the plants `cursorMapShifted` and `interactionRuleDropped` | **Yes, almost whole, as PR 2.** The identity bases are rewritten against the new base. The `uikit` "no map" becomes the iPadOS pointer style (R11) |

Native glue (Swift or Kotlin), a device lane, `:active`, `tabindex` and the product states exist on **no** branch. Their whole
size: seld-r2c is +3,049/−527 source lines over 95 files, and 2,518 files including generated output.

### 0.3 Chrome measurements

The measurements use Chrome 145.0.7632.6 and Playwright 1.58.2, with CDP `Input.dispatchTouchEvent` (radius 0) and
`Input.dispatchMouseEvent`. Touch cases use `Emulation.setTouchEmulationEnabled`. The probes are in /tmp/t064-probe.

| # | Probe | Result |
|---|---|---|
| P1 | Touch tap on a plain div | `:hover` **sticks** on the tapped chain until the next tap elsewhere (also in seld-r2b's expected-traces) |
| P2 | Media under touch emulation | `(hover: hover)`, `(any-hover: hover)` and `(pointer: fine)` are false; `(pointer: coarse)` is true. Without touch: the reverse |
| P3 | `@media (hover: hover) { .g:hover {…} }` in the touch context, after a tap | **The style does not apply** (`background` stays `.h:hover`'s). In the mouse context it applies |
| P4 | Touch press held 400 ms, then release | `:active` is **never** set on the CDP touch path, during or after. Mouse press: `:active` on the target and its ancestors (`wrap,inner`); cleared on release |
| P5 | Tap or click focus | Focus goes to the nearest focusable inclusive ancestor (`bspan` focuses `bwrap`): button, `a[href]`, `tabindex=0`, `tabindex=-1`. Otherwise focus is cleared (activeElement is body). Touch focus happens **at release**; mouse focus at **press** |
| P6 | `:focus-visible` from a pointer | False for button, range, link and tabindex elements. **True for `input[type=text]`**, by tap and by click |
| P7 | Touch tap on `input[type=range]` | **Nothing changes**: no hover, no focus (the slider consumes the touch). A mouse click focuses it, without focus-visible |
| P8 | Tab order | `t1 t2 btn rng lnk t0 txt bwrap`, then out of the document (body), then `t1`. `tabindex=-1` and plain divs are skipped. Keyboard focus sets focus-visible |
| P9 | A click after keyboard focus, then a Shift keydown | The click gives `:focus` without focus-visible; Shift then turns **focus-visible on** for the focused button |
| P10 | `CSS.forcePseudoState` focus-visible on a div, button, range and tabindex div | Computed `outline: auto 1px rgb(0, 95, 204)`, offset 0. Forced `:focus` alone: `outline-style: none` |
| P11 | Mouse over A; A gets `display: none` | Hover moves to B (now under the stationary pointer) at the next frame, and stays (0 to 500 ms) |
| P12 | Mouse moves outside the viewport | Hover is empty |

The Blink source agrees with these:
- `HandleGestureTap` sends a fake mousemove to the tap point "deliberately" (gesture_manager.cc:250-262). Chromium's own TODO
  calls this "a tap-based hover state".
- `HandleMouseFocus` walks the flat-tree parents to the first `IsMouseFocusable` element, else blurs (mouse_event_manager.cc:513-521,
  590-594).
- The focus type is `kMouse` for taps and clicks. `MatchesFocusVisiblePseudoClass` returns
  `always_show_focus || is_text_input || !last_focus_from_mouse || had_keyboard_event`. This is reference only (LGPL).
- `SetFocused(kMouse)` clears HadKeyboardEvent (element.cc:8057-8058, reference).
- A non-meta keydown sets it again (keyboard_event_manager.cc:333-338).
- `GestureShowPress` and `GestureTapUnconfirmed` request `kActive`, and `GestureTap` releases it
  (gesture_manager.cc:95-117). So real-device touch `:active` is a timer-driven ShowPress that the CDP path does not produce (P4).

### 0.4 Tailwind precedent

Tailwind 4.3.3 is pinned in the repo (`node_modules/.pnpm/tailwindcss@4.3.3/.../dist/lib.js`). It compiles `hover:` as
`&:hover { @media (hover: hover) { … } }`: the most-used CSS framework already removes sticky tap hover by design.

## 1. Scope

### Supported

- **Selectors.** `:hover`, `:focus`, `:focus-visible` and **`:active`** in any compound and any position, including inside
  `:is()`, `:where()`, `:not()`, `:has()` and `:nth-*(… of S)`, as seld-r2a's `selectorIsInteractive` already handles. They
  resolve through the cascade with every other condition: specificity and order still decide, so `.library-song.selected` beats
  `:hover` (T014).
- **`cursor`.** An inherited longhand with the 36 CSS UI 4 keywords (seld-r2c `CURSOR_KEYWORDS`). Chrome's UA values are
  captured: `button`, label and `input[type=range]` `default`; `input` `text`; `a:any-link` `pointer`.
- **`tabindex`.** Valid integers (HTML "rules for parsing integers", with no trailing garbage). It feeds focusability (R9) and
  is rendering-neutral in the none state (attr-neutral proof pair). Sequential order is recorded for P6e (R10).
- **`@media (hover: hover)`** wrapping rules whose every selector requires `:hover` (the Tailwind variant shape, R3). Any other
  use of the `hover`, `any-hover`, `pointer` or `any-pointer` features stays refused as MQ-R2.
- **Targets.** web, ios, android, at DPR 1 (host), 2, 2.625 and 3, in ltr and rtl.
- **Input sources:**
  - **iOS:** finger touch; iPad pointer (trackpad, mouse); Apple Pencil hover (iPadOS 16.1 and later, on hardware that has it).
  - **Android:** finger touch; mouse; stylus hover and contact.
  - **Lanes:** the forced hook (`CSS.forcePseudoState` equivalence).

### Refused (each has a reject fixture)

| Case | Code | Message (shape) | Owner |
|---|---|---|---|
| `:focus-within`, `:visited`, `:link`/`:any-link`, `:target`, `:checked`, `:disabled`, `:enabled`, `:placeholder-shown`, other user-action or form pseudo-classes | DRAGON_UNSUPPORTED_SELECTOR | unchanged ("… depends on user interaction or document state …") | SELD-R3, FORM-b, TDEC |
| `direction` in an interaction rule | DRAGON_UNSUPPORTED_SELECTOR | seld-r2a's message | SELD-R2 (kept) |
| More than **256** interaction states in one app assignment after collapse (R7) | DRAGON_UNSUPPORTED_SELECTOR | `… <n> interaction states in <case>; at most 256 are compiled (package SELD-R2s)` | SELD-R2s (T019) |
| On native, an interaction rule in a case whose hit table holds a compiled paint fact the hit test does not model (R13 whitelist: transform, z-index, opacity < 1, border-radius, visibility, scrolling, clip-path…) | DRAGON_UNSUPPORTED_SELECTOR `[ios]`, `[android]` | `<pseudo> needs Dragon hit testing through <property> on <element>, which is not built yet (package SELD-R2b)` | T146 |
| A reachable interaction state that needs a state-program write that does not exist | the writer's existing refusal, located at the interaction rule's declaration | e.g. `transform in a state program … (package ANIM-b2)`; radius, shadow, outline name **SELD-P**; visibility names T150b | ANIM-b2, SELD-P, T150b |
| A reachable `:focus-visible` state whose resolved `outline-style` is `auto` (Chrome's UA focus ring, P10, not overridden) | DRAGON_UNSUPPORTED_VALUE `[ios]`, `[android]` | `the focus ring (outline: auto) on <element> is not drawn yet (package P6e)` | P6e |
| `cursor: url(…)`, `image-set()`, and the `-webkit-` cursor aliases | DRAGON_UNSUPPORTED_VALUE | seld-r2c's message (package CUR-u) | CUR-u |
| `tabindex` that is not a valid integer | DRAGON_UNSUPPORTED_ATTRIBUTE | `tabindex="<v>" is not a valid integer …` | none |
| `contenteditable`, `autofocus`, `disabled`, `inert`, `accesskey` | DRAGON_UNSUPPORTED_ATTRIBUTE (unchanged) | owners P6d, P6e, FORM-b | — |
| `hover`, `any-hover`, `pointer` and `any-pointer` media features other than the R3 shape | DRAGON_UNSUPPORTED_AT_RULE (unchanged) | MQ-R2 | MQ-R2 |

**Deleted:** seld-r2a's `combinedStateRefusal` (":focus … together with :hover is not supported"). It would refuse the music
player: the range is a focusable `:focus` candidate and hover chains exist. R7 compiles the combined states instead.

**New warning (pitfalls P18 and C5):** `DRAGON_HOVER_ONLY_REVEAL` `[ios]`, `[android]`. It fires on an element that is not
rendered in any reachable non-hover state of a case but is rendered in some hover state, with the fix text from pitfalls.md:378-383.
- In SELD-R2 it covers `display` (branch creation).
- The opacity and visibility forms are added by ANIM-b2 and T150b through the same helper,
  `hoverOnlyReveal(partition, rendered)`.

### Not in scope

- **Keyboard traversal and its platform glue:** Tab and Shift+Tab, hardware keys, UIFocusSystem, Android key focus, Full
  Keyboard Access. These are P6e. R10 fixes the semantics P6e must follow.
- The focus ring's paint (P6e with PNT1's `outline-style: auto` row).
- Accessibility focus (P6b): VoiceOver and TalkBack focus never sets `:focus`, as in Chrome.
- Touch adjustment (Chrome's fuzzy tap targeting, `touch_adjustment.cc`): Dragon taps the exact point, and the traces use radius 0.
- Drag, long-press and selection gestures (P6c).
- Text-entry focus-visible: no editable element compiles yet (P6d). The rule is in R8 so it applies the day one does.

## 2. Rulings

**R1. A touch tap never sets `:hover`, on any target.** Hover comes only from a pointer that can hover: an iPad pointer, Apple
Pencil hover, an Android mouse or stylus hover. T064J's "touch tap gives a sticky hit chain until the next tap" and decisions.md's
"tap behaviour follows recorded Chrome traces" are **reversed for hover**. They still hold for focus (R8) and activation (R1b).

Evidence:
- **Owner design principle 3** (milestone-1 goal.md:51): "applies `:hover` only on devices that can hover".
- **pitfalls.md P18, C5 and §4.5:** "never set by a tap"; the sim test is "tap does not apply hover state".
- **Chrome itself treats tap hover as a compatibility hack.** The fake mousemove is at gesture_manager.cc:250-262, and its TODO
  is crbug.com/368256331.
- **P1:** the trace shows the sticky behaviour this removes.
- **The Tailwind 4.3.3 precedent (§0.4).**

The device is still judged against Chrome, through R3's web output. The owner principle outranks a PM ruling, and research
backs it, so under the Decision Rule this is a PM ruling and not an owner question.

**R2. The trace oracle compares effective states.**
- For each step, `hoverEffective = matches(':hover') && matchMedia('(hover: hover)').matches`.
- `:focus` and `:focus-visible` are taken as recorded; `:active` is taken from mouse traces only (R6).
- Touch traces run in the touch-emulated context (P2: hover media false), so Chrome's effective hover after a tap is empty, and
  equals Dragon's R1.
- Mouse traces run without touch emulation, where the two are identical.
- A second, style-level check makes R1 a Chrome measurement rather than a claim. After every touch step, Chrome renders
  **Dragon's own web output** (R3), and the computed style of every hover candidate must equal its none-state value (P3).
- The capture records `matchMedia` with each step and fails closed if a touch step reports `(hover: hover)` true.

**R3. Web output gates hover on `@media (hover: hover)`.**
- Generated web conditions that test `:hover` are emitted inside `@media (hover: hover)`, exactly Tailwind's shape.
- Conditions without `:hover` (focus, focus-visible, active) are not wrapped.
- So the browser preview on a phone does what the phone does (principle 4), and desktop browsers are unchanged. This is P3.
- chrome-dual is unaffected: the parity reference context has `hasTouch: false` (P2), where the condition holds and forced
  hover applies.
- The music player's Chrome reference is mobile (`isMobile`, `hasTouch`). Its forced cases run on the **authored** CSS through
  `CSS.forcePseudoState`, so they keep applying.
- **The R3 fold:** an authored `@media (hover: hover)` whose every rule requires `:hover` compiles to the same thing. It is
  redundant with R1 on native and emitted as authored on web.
- Plant `webHoverUngated`.

**R4. Interaction states are four dimensions per case, and each is linear in elements.**
- **H, hover:** the distinct hover-candidate sets of every element's chain, plus none. The chain is the element and every
  ancestor up to `html` (seld-r2b traces).
- **A, active:** the same construction, for `:active` candidates.
- **F, focus:** none, or one focusable `:focus` candidate. Focus on a non-candidate is none.
- **V, focus-visible:** none, or one `:focus-visible` candidate, reachable only together with focus on the same element.
- The candidates come from seld-r2a's fixed-point probe, unchanged.
- Forced states (lane only) are one element and one pseudo-class each, as seld-r2a builds them.

**R5. Equal states collapse.** A dimension value, or a combination, whose per-case program is byte-identical to another's is
stored once.

Evidence: `input[type=range]:focus { outline: none }` is `changed: false` (T014), so the music player's focus dimension
collapses to none. This is a compile-time equality on the existing per-case programs, so it costs no new oracle.

**R6. Pointer semantics** (the TS reference in `rt-interaction.ts`, R12). Each rule is backed by Chrome where Chrome can
measure it.

| Event | hover (H) | active (A) | focus (F, V) | Evidence |
|---|---|---|---|---|
| Pointer hover move to p (mouse, trackpad, pen hover) | chain(hit(p)) | unchanged | unchanged | P1 mouse, seld-r2b mouse traces |
| Pointer leaves the view or is hidden | none | unchanged | unchanged | P12 |
| Mouse press at p | unchanged (stays chain(hit(p))) | chain(hit(p)) | nearest focusable inclusive ancestor of hit(p), else none; V = R8 | P4, P5 (focus at press) |
| Mouse release | unchanged | none | unchanged | P4 |
| Touch press at p (finger; Pencil or stylus contact) | unchanged (none) | chain(hit(p)) | unchanged | Blink ShowPress (95-117). **Caveat:** the CDP path cannot show it (P4), and native immediacy is the platform feel (UIControl highlight, View pressed state) |
| Touch release, a tap | unchanged | none | nearest focusable inclusive ancestor, else none, unless the target's control consumes touch (range, P7); V = R8 | P5, P7 |
| Touch cancel (system cancel; scroll later with OVFL) | unchanged | none | unchanged | — |
| A committed state setter or layout change while a hovering pointer is present | chain(hit(last p)) at the same frame | unchanged | an element that left the tree is dropped | P11 |
| forcePseudo(e, x) | exactly e for x; everything else cleared | | | T047 RT-6(a), seld-r2b |

- `hit` is the R1b translated hit test (`rt-hit.ts`). `pointer-events: none` and positioned layers are already modelled.
- "Focusable" is R9.
- Plants:
  - `tapSetsHover`: a tap gives the chain, the T064J behaviour;
  - `activeWithoutAncestors`;
  - `activeStaysAfterRelease`;
  - `focusAtTouchPress`;
  - `hoverNotRecomputedAfterLayout`;
  - `rangeTapFocuses`.

**R7. The interaction table is a second level under each app assignment, not more assignments in the 64-cap state table.**
- For each R1a app assignment, the compiler stores the reachable combinations of (H × A × F/V), after R5, as `StateDelta`
  records over the base. The runtime holds the indices `[app][combo]`.
- The cap is **256 combos per app assignment**, a new constant `MAX_INTERACTION_STATES` beside, not instead of, the 64-assignment
  app cap. Beyond it, the R1 refusal fires (SELD-R2s).
- Every (app, combo) per-case program is the oracle (RT-1): after any script, the dump equals it.
- Evidence: §0.1. Seld-r2b's single interaction variable puts app × interaction into the 64 cap, which the music player
  exceeds: 4 app cases × at least 9 hover chains × focus.
- Combinations are compiled in full, not composed at run time. Composition would need a delta-merge proof per pair, and the
  table is small: 4 × at most 30 for the music player.
- Plant `comboStateDropped`: the H×F combination is taken from H alone.

**R8. Focus and focus-visible follow Blink's heuristic exactly.**
- Pointer focus (tap or click) sets V only if the focused element may trigger a virtual keyboard (P6). No such element compiles
  yet, so pointer-reachable V is empty today.
- The forced hook reaches V.
- Keyboard focus sets V (P8). A non-meta keydown after pointer focus sets V on the focused element (P9). Both are P6e's
  triggers (R10). The state model carries them now, so P6e adds glue and no compiler change.
- Pointer focus clears the keyboard flag (element.cc:8057, reference).
- The rule is implemented from selectors-4 §9.4 and the probes. It is not ported, because selector_checker.cc is LGPL, class A.
- Plants `focusVisibleOnPointer` and `focusOnNonFocusable` (seld-r2b).

**R9. Focusability is a compiled fact per element** (HTML §6.6.3 and Blink `IsMouseFocusable`, measured in P5):
- focusable: `button`; `input` except `type=hidden`; `select`; `textarea`; `a[href]`; any element with a valid `tabindex`
  (negative values included, P5);
- only when its used `display` is not `none` and its box exists;
- when T150b lands, also only when `visibility` is `visible`. That is T150b's one-line hunk in `analysis/interaction.ts`, the
  hunk its spec says SELD-R2 reads (T150 R6, M6).
- Form controls whose touch Chrome consumes (range, P7) carry `touchConsumesTap` from FORM-a's control kind.
- Plant `focusOnNonFocusable`.

**R10. Keyboard order is fixed now and built in P6e.**
- Sequential focus navigation follows HTML §6.6.3:
  - positive `tabindex` first, ascending, ties in tree order;
  - then `tabindex=0` and default-focusable elements in tree order;
  - negative values excluded;
  - after the last element, focus leaves the document (Chrome: body, then the first again; P8);
  - Shift+Tab is the reverse.
- SELD-R2 compiles this order as a per-case table, `tabOrder`. It is proven on the host by a keyboard trace (`Input.dispatchKeyEvent`
  Tab), which is evidence and not a gate.
- No platform key glue ships in SELD-R2, and the profile rows for keyboard focus stay `unsupported`.
- P6e must deliver:
  - the glue: iOS `pressesBegan` with `UIKeyboardHIDUsage.keyboardTab`, and Android `dispatchKeyEvent` `KEYCODE_TAB`;
  - the ring (outline `auto`, PNT1 row);
  - the SELD-P outline write.
  
  Before P6e, every focusable element whose UA ring is not overridden would be refused once keyboard V became reachable.
- Board note (§10).

**R11. Cursor.** This keeps seld-r2c, plus the iPad mapping:
- **Android, exact.** `onResolvePointerIcon` returns `PointerIcon.getSystemIcon(TYPE_*)` from the composition of
  `SelectCursor` and `onCursorChanged`, for the hit target's computed cursor (`auto` resolves by hit: an I-beam over text,
  else arrow).
- **iPadOS, caveat.** `UIPointerInteraction` styles: `text` gives `.verticalBeam`, `vertical-text` gives `.horizontalBeam`,
  `none` gives `UIPointerStyle.hidden()`, and every other keyword the system pointer. iPadOS has no hand cursor.
- **iPhone:** no effect.
- **Proof:** the applied-value dump of the resolved icon per hit point, against Chrome's computed `cursor` (cursors are not in
  screenshots).
- The longhand's additive capture key is admitted only with `cursor-capture-identity.test.ts` (the pointer-events precedent,
  T063J).
- Plant `cursorMapShifted`.

**R12. Where the logic lives.** The interaction runtime is a **translated root**, `packages/layout/src/rt-interaction.ts`.
It holds:
- the R6 event rules over the partition tables;
- the chain, focus target and tab-order lookups;
- the R7 index arithmetic.

It moves seld-r2b's `InteractionRuntime` logic out of `emit/runtime/interaction.ts`, as R1b moved `hitTableOf` into `rt-hit.ts`.
The result is the same function on the host and, translated, on the device, with rt vectors, which is what RT-12 requires of
runtime algorithms.

`emit/runtime/interaction.ts` keeps only the platform glue sources and the table emitter. Nothing on the device matches a
selector. It looks up tables.

**R13. The hit test is fail-closed for paint facts. T146 lifts it.**
- `rt-hit.ts` gains a whitelist, `HIT_MODELLED`, of the facts R1b models:
  - box geometry;
  - `overflow` clip;
  - positioned layers with `z-index: auto`;
  - `pointer-events`;
  - and, in SELD-R2, **replaced** (`img`, host-view slots; Chrome's `elementFromPoint` returns the element over its border box)
    and **FORM-a control boxes** (the button box; the range as one box whose shadow parts retarget to the input).
- The compiler refuses, on native, every interaction rule in a case where any element has a compiled non-initial value outside
  `HIT_MODELLED`. This is the §1 refusal naming SELD-R2b.
- Being fail-closed, a later lander (PNT2 transforms, PNT1 radius, z-index and opacity, T150a visibility, OVFL scrolling) is
  refused automatically, never silently mis-hit.
- Plant `hitUnmodelledNotRefused`.
- R1b's `hitTableOf` today refuses replaced elements at run time (7d78a13b8). The music player has an iframe, so without this
  hunk its hit table cannot be built at all.

**R14. Proof is three-way:** TS, Chrome and device.
- **trace-report** (host): seld-r2b's capture, extended with:
  - `press`, `release`, `hold(ms)`, `keydown` and `move-out` steps;
  - matchMedia per step;
  - the R2 effective rule and the R2 style check on Dragon's web output.
  
  The TS trace must equal Chrome's effective trace at every step. Touch `:active` and keyboard steps are recorded and are not
  gated (P4, R10).
- **device-traces** (new lane): the case scripts drive the device entry points with `move`, `exit`, `press`, `release`,
  `tap`, `click`, `force`, `set` and `trace` steps. The device's per-step sets must equal the TS trace.
- **Android, twice:**
  - through the entry points;
  - through real `MotionEvent`s on the root (`dispatchTouchEvent` with `SOURCE_TOUCHSCREEN`/`TOOL_TYPE_FINGER`, and
    `dispatchGenericMotionEvent` `ACTION_HOVER_*` with `SOURCE_MOUSE` and `SOURCE_STYLUS`), including the platform's
    `HOVER_EXIT` before a mouse `DOWN` (R15).
  
  Both must give the same trace.
- **iOS:** entry points only. Simulator automation cannot synthesise pointer hover (XCUITest's `hover()` is macOS-only), so
  the recogniser glue is caveat. Touch press and release go through the R1b touch path.
- **Forced cases** (`~ix<k>`) also pass `device-frames`, `device-applied` and `device-pixels` at every DPR.

**R15. The Android hover-exit quirk.**
- Android sends `ACTION_HOVER_EXIT` to a hovered view when a mouse button goes down, and `HOVER_ENTER` after release. Chrome
  keeps hover during a press (P4).
- So on `HOVER_EXIT`, Dragon defers clearing hover to the next frame, and cancels the clear if a `SOURCE_MOUSE` `ACTION_DOWN`
  arrives first.
- The device injection proves it. Plant `hoverExitOnPress`.

**R16. Change hook for ANIM-b2.**
- Every committed interaction change calls `onInteractionChange(app, oldCombo, newCombo)` once, on the same frame as its writes.
  ANIM-b2 binds the R4 style-change event there.
- The hook replaces the ANIM-b spec's "one hunk in `emit/runtime/interaction.ts`", and the PM updates T065b's allowed hunk.
- Two changes in one frame (for example press and move) are one event per step, as R4 of ANIM-b requires.

## 3. How it reaches each target

The compiler resolves every platform difference:
- every (app, combo) program;
- the web gate;
- the focusability and tab-order facts;
- the cursor map per backend;
- the hit-model refusal per target.

The device code never parses CSS or matches selectors. It runs `rt-interaction.ts` lookups and writes through the existing
writers.

### Web

- **Generated condition selectors.** seld-r2a's, built from dg classes and pseudo-classes only and mutually exclusive per
  (app, combo).
- **Hover conditions** go inside `@media (hover: hover)` (R3).
- **`cursor`** is emitted resolved. **`tabindex`** is kept as an attribute.
- **The browser runs the states.** Dragon emits no script.
- **Exclusivity** is checked by Dragon's matcher on the emitted CSS (seld-r2c `webInteractionExclusivity`), across every combo.

### iOS (UIKit, iOS 15 floor)

- **Root view** (`DragonStateMount`'s root): an observing `UIGestureRecognizer` subclass with `cancelsTouchesInView = false`,
  `delaysTouchesBegan = false`. It sees touches over every subview, host-view slots included. Its callbacks:
  - began, with `UITouch.type` `.direct` or `.pencil`: **touch press**;
  - began with `.indirectPointer` (when `UIApplicationSupportsIndirectInputEvents` is YES; the generated host's Info.plist sets
    it): **mouse press**;
  - ended: release, plus tap focus and activation through R1b's path;
  - cancelled: cancel.
- **`UIHoverGestureRecognizer`** (iOS 13): began and changed call `pointerMoved(p)`; ended and cancelled call `pointerExited()`.
  It covers the iPad trackpad and mouse, and Apple Pencil hover (iPadOS 16.1). It never fires on iPhone, so an iPhone never
  hovers.
- **`UIPointerInteraction`** delegate `styleFor:` returns R11's style for the hit target's cursor.
- **Writes** go through the R1a delta path (`DragonStateMount` rebuild), unchanged.
- **Profile rows:**
  - `:hover` on ios is exact for state styles (forced proofs), with the pointer glue as caveat;
  - `:active` touch timing is caveat;
  - `:focus` is exact;
  - `cursor` is caveat.

### Android (View/Canvas, minSdk 31)

- **The root `ViewGroup` observes without stealing:**
  - `onInterceptTouchEvent` returns false. It reads `ACTION_DOWN`, `UP` and `CANCEL` with `getToolType(0)`. `FINGER` and
    `STYLUS` give touch press; `MOUSE` gives mouse press.
  - `onInterceptHoverEvent` (with `dispatchHoverEvent` observed) reads `HOVER_ENTER`, `MOVE` and `EXIT` from `SOURCE_MOUSE` and
    `SOURCE_STYLUS`. It applies R15.
  - Interception also sees events over a host-view `WebView` (REPL-a).
- **`onResolvePointerIcon(event, index)`** returns R11's icon.
- **Profile rows:** `:hover` and `cursor` exact (proven by real MotionEvent injection); `:active` touch timing caveat;
  `:focus` exact.

## 4. Proof

### Lanes and gates (all existing tolerances unchanged)

| Lane | What | Gate |
|---|---|---|
| chrome-dual, `parity:report`, `parity:dpr-report` | base and forced (`~ix<k>`) cases; author CSS against Dragon's web output | failed 0 at 1, 2, 2.625 and 3 |
| `parity:hit-report` | TS hit equals Chrome `elementFromPoint` over the derived grid, including the new replaced and form-control facts | failed 0 |
| `parity:trace-report` (new step kinds) | TS trace equals Chrome effective trace (R2), and the R2 style check | failed 0; touch active and keyboard recorded, not gated |
| `device-states` (R1b) | the (app, combo) dumps equal the per-case expected dumps, and A→B→A equals A | iOS 2 and 3; Android 2, 2.625 and 3 |
| `device-hit` (R1b) | unchanged, plus the new facts | same DPRs |
| **`device-traces`** (new, appended to LANES and targets.ts) | the device trace per step equals TS; Android also through MotionEvent injection | same DPRs; no lane `not run` |
| `device-frames`, `device-applied`, `device-pixels` | the forced cases | P5 gates unchanged |
| rt vectors | `rt-interaction.ts` TS equals Swift equals Kotlin (`native:swift`, `native:kotlin`) | bit-equal |

### Fixtures

Group `interaction`, in ltr and rtl, reusing seld-r2a and seld-r2c and adding to them:
- **interaction-hover** (seld-r2a): subject, sibling (`.a:hover + .b`), ancestor-to-descendant (`.card:hover .title`),
  `.selected` against `:hover`, a layout-changing hover (`.tall:hover`).
- **interaction-focus** (rewritten): real focusables, needing FORM-a: a button with a span inside (P5's `bspan` → `bwrap`),
  tabindex 0 and −1 divs, the range (P7), `.wrap:hover .f`. The focus-visible subjects use `outline: none` plus a background, so
  the UA ring refusal does not apply.
- **interaction-active**: the press chain, `.x:active .y`, `:active` against `:hover` order, release.
- **interaction-combo**: `.x:hover:focus`, hover on A while B is focused, a pressed-and-moved pointer (H×A×F), and a
  collapse case (`:focus { outline: none }` only).
- **interaction-relayout**: P11's shape (the hovered element removed by a state setter under a stationary pointer).
- **interaction-cursor** (seld-r2c), plus `auto` over text and over a box, and inheritance.
- **interaction-tabindex**: tabindex values, `tabOrder` evidence.
- **interaction-replaced**: an img and an iframe slot hit.
- **interaction-tw-hover**: the Tailwind `@media (hover: hover)` shape.
- **interaction-reveal**: `display: none` to `block` under `:hover`, which gives the warning.
- **Rejects:** reject-interaction-direction, reject-interaction-cursor-url, reject-interaction-cap (257 combos),
  reject-interaction-tabindex-invalid, reject-interaction-focus-within, reject-interaction-ring (forced focus-visible with the UA
  ring), reject-interaction-hover-media (`@media (hover: none)`).
- **The hit-unmodelled refusal** is proven by a unit test with a synthetic compiled fact. Its fixture lands with whichever of
  PNT2 or PNT1 first compiles an unmodelled fact on master (§10).

### Planted faults

Every plant is caught on the host. The device column also catches runtime plants.
- **Compiler:** `interactionRuleDropped`, `comboStateDropped`, `webHoverUngated`, `hitUnmodelledNotRefused`, `cursorMapShifted`.
- **Runtime, host and device:** `tapSetsHover`, `hoverWithoutAncestors`, `forcedSetsAncestors`, `focusOnNonFocusable`,
  `focusVisibleOnPointer`, `activeWithoutAncestors`, `activeStaysAfterRelease`, `focusAtTouchPress`, `rangeTapFocuses`,
  `hoverNotRecomputedAfterLayout`.
- **Android only:** `hoverExitOnPress`.

### Support-profile rows (`profile:rows`, additions only)

- `selector:pseudo-class(:hover|:focus|:focus-visible|:active)` per target, with proofs: the fixture ids, the traces and
  device-traces.
- `cursor:<keyword>`: web exact; android exact; ios caveat.
- `attribute:tabindex`: exact for focusability; keyboard order `unsupported` until P6e.
- `media-feature:(hover: hover)`: only in the R3 shape.

## 5. Base, dependencies and landing

| Package | Development base (now) | Lands | Needs |
|---|---|---|---|
| **SELD-R2 (T064), PRs 1 to 4** | `review/seld-r2-base`, which the PM creates: `form-a4-v2` (#79, FORM-a top on REPL-a) merged with `seld-lanes-v2` (#111, on #75) | after FORM-a, as the next single position, or at the tail of train 3 | #75 (tap and hit), #111 (device-states and device-hit lanes, device-jobs), FORM-a (button, range, `selectors.ts`/`match.ts`/`cascade.ts` edits), REPL-a (replaced hit) |
| **SELD-R2b (T146)** | master after the PNT1 train, train 4 (PNT2), T150a+T150b, SELD-R2 and OVFL Phase B's `rt-hit.ts` hunk | after all of those | PNT2 transform matrices, PNT1 stacking and radii as program facts (T046 §1), T150b's `visible` |

Why this base:
- It is the earliest base with no later restack. FORM-a edits SELD-R2's hotspot files (`selectors.ts`, `match.ts`,
  `cascade.ts`, `resolve.ts`, `attributes.ts`, `project.ts`, `web-css.ts`, `state.ts`; checked with
  `git diff origin/master...form-a4-v2`), so basing below FORM-a would force a restack.
- Nothing SELD-R2 needs sits later than FORM-a. R13's fail-closed rule removes the reason T047 §3.4 waited for PNT1 and PNT2.
- T150's note that T150b precedes SELD-R2 is amended: SELD-R2 lands first, and T150b adds the `visible` clause to R9 (§10).
- The later landers, from train 3 to vis/BG2, catch up over SELD-R2's additive hunks at their own catch-up (AGENTS.md step 2).

**Order constraints:**
- **Not concurrent with GEN-a** on `selectors.ts`/`match.ts` (SELS hotspot).
- **`state.ts`** is shared with PNT2, PNT1, vis-a, bg2 and ANIM-b1 PR 3. SELD-R2's hunk is additive: the second-level index and
  `applyInteraction`. Those branches resolve it at their catch-up.
- **`rt-hit.ts`** is serial: SELD-R2, then T150b, then OVFL Phase B, then T146.

## 6. allowed_files

**Worktree** `/tmp/dragon-seld-r2`. **Branches** `seld-r2-compiler`, `seld-r2-cursor`, `seld-r2-runtime` and
`seld-r2-native`, stacked in that order.

**Compiler (PRs 1 and 2):**
- `packages/dragon/src/css/selectors.ts` (lift `:hover`, `:focus`, `:focus-visible`, `:active`)
- `packages/dragon/src/analysis/match.ts` (the `InteractionState` gains `active`)
- `packages/dragon/src/analysis/cascade.ts` (condition hunk only)
- `packages/dragon/src/analysis/resolve.ts` (interaction option; the label UA cursor default)
- `packages/dragon/src/analysis/elements.ts` (UA cursor default and focusability facts only)
- `packages/dragon/src/analysis/interaction.ts` (new)
- `packages/dragon/src/project.ts` (interaction hunk)
- `packages/dragon/src/attributes.ts` (`tabindex` only)
- `packages/dragon/src/media/**` (only the R3 fold, at the MQ-R2 refusal site)
- `packages/dragon/src/css/properties.ts` (append `cursor`)
- `packages/dragon/src/css/grammar.generated.ts` and `scripts/gen-css-grammar.ts` (the cursor SUBSET hunk)
- `packages/dragon/src/ua/*.generated.ts` (regenerated)
- `scripts/capture-ua-defaults.ts`: retarget FORM-a's drop-unmodelled plant away from `cursor` (Throughput rule), and add the
  forced-focus-visible UA capture for P10
- `packages/dragon/src/emit/web-css.ts` (interaction conditions and the hover gate)
- `packages/dragon/src/lower/interaction-program.ts` (rewritten for R7)
- `packages/dragon/src/faults.ts`, `diagnostics/catalogue.ts` and `test/diagnostic-codes.json` (append)
- `packages/dragon/test/interaction*.test.ts`, `cursor.test.ts` and `tabindex.test.ts` (new)
- Retargets keeping intent (list each one in the receipt):
  - `compile.test.ts`, `selectors.test.ts` and `seams.test.ts`: refusal pins move to `:focus-within` or `:visited`;
  - `grid.test.ts`, `pointer-events.test.ts` and `s4b.test.ts`: registry order;
  - `ua*.test.ts` and `blockify.test.ts`: cursor rows;
  - parity `css-escapes`, `fixture-reader`, `values`, `parity`, `platform`, `android-profile`, `device-vectors` and
    `pixel-reference`: derived counts;
  - translate `native-*.test.ts` and `translate.test.ts`: the rt suite list.

**Runtime and native (PRs 3 and 4):**
- `packages/layout/src/rt-interaction.ts` (new)
- `packages/layout/test/rt-interaction.test.ts` (new)
- `packages/layout/rt-vectors/interaction/**` (new)
- `packages/layout/src/rt-hit.ts` (the `HIT_MODELLED` whitelist; replaced and form-control facts; additive)
- `packages/layout/test/rt-hit.test.ts`
- `packages/layout/rt-vectors/hit/**`
- `packages/dragon/src/emit/runtime/interaction.ts` (glue and tables)
- `packages/dragon/src/emit/runtime/cursor.ts`
- `packages/dragon/src/emit/runtime/index.ts` (append)
- `packages/dragon/src/emit/runtime/state.ts` (additive: the second-level index, `applyInteraction`, the R16 hook)
- RT-13 hunks in:
  - `emit/native-support.ts`
  - `internal.ts`
  - `packages/parity/src/native-host.ts`
  - `native-dump.ts`
  - `lanes.ts`
  - `targets.ts`
  - `device-jobs.ts`
  - `chrome.ts`
  - `capture.ts`
  - `packages/translate/src/generate.ts`
  - `corpus.ts`
  - `harness/harness.ts`
- `packages/parity/src/trace-capture.ts`, `cli/trace-capture.ts`, `cli/trace-report.ts`, `forced-pseudo.ts`,
  `interaction-identity.ts`, `cli/interaction-identity.ts`, `state-cases.ts` (script step kinds), `hit-capture.ts` and
  `cli/hit-capture.ts` (the cursor identity hunk)
- `packages/parity/src/fixture-groups/interaction.ts` (new)
- `packages/parity/src/fixtures.ts` (one import and one concatenation)
- `packages/parity/fixtures/interaction-*.html` and `reject-interaction-*.html` (new)
- New files only under `packages/parity/expected*/**`, `expected-traces/**`, `expected-cursor/**`, `packages/layout/vectors/**`,
  `break-vectors/**` and `packages/parity/emitted/**` (headers relaxed)
- `packages/parity/test/interaction-*.test.ts`, `trace-*.test.ts` and `cursor-capture-identity.test.ts`
- `packages/parity/out/lanes.json`
- Regenerated `packages/layout/generated/**`, `packages/translate/corpus*.json`, `packages/dragon/src/profiles/*.ts`,
  `packages/tailwind-sweep/snapshot/**` and `examples/music-player/dragon/north-star-check.json`
- `examples/music-player/tools/check.ts` (seld-r2c's export-only hunk)
- `package.json` (script hunk: `parity:trace-capture`, `parity:trace-report`, `parity:interaction-identity`)
- `.macroscope/ignore.md` (only if a new output directory falls outside the existing patterns; `expected-traces` and
  `expected-cursor` are covered by `expected-*/`)

**Shared files and their order:**
- `state.ts` (§5);
- `rt-hit.ts` (§5);
- `native-host.ts`, `lanes.ts` and `targets.ts`: RT-13 additive only, checked with `git diff -U0 BASE -- <file>` showing only `+`
  lines inside registration blocks;
- `catalogue.ts`: one entry per line.

## 7. verify

`ENV` and C1 to C6 are as in notes/T047 §3. Every heavy command runs through `/tmp/heavy-lease.sh`, and device steps hold the
`ios`, `android` or both leases.

1. C1: `ENV pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`. Nothing is `.skip`, `.only` or `.todo`.
2. `ENV pnpm regen` reaches a fixed point. Regenerated output goes in its own commit naming the command.
3. C4 (captures twice, byte-identical) and C5 (no modified or deleted expected files). Exception: the cursor key, admitted by
   `cursor-capture-identity.test.ts` against `expected-cursor/identity-base.json`, rewritten on the PR base.
4. `ENV pnpm run parity:report && pnpm run parity:dpr-report`: failed 0, forced cases included.
5. `ENV pnpm run parity:hit-capture` twice, byte-identical; then `parity:hit-report` failed 0.
6. `ENV pnpm run parity:trace-capture` twice, byte-identical; then `parity:trace-report`: TS equals Chrome effective at every
   gated step, and the R2 style check holds. The receipt records P1 to P12 as re-measured.
7. C2 (`layout:subset` 0 violations), and C3 (`native:gen`: only regenerated output, with header-only files listed).
8. `ENV pnpm run native:swift && pnpm run native:kotlin && pnpm run native:planted`: the rt-interaction suite is bit-equal, and
   every plant is caught.
9. `ENV pnpm run profile:rows`: additions only (§4).
10. `ENV pnpm run native:build -- --target ios && pnpm run native:build -- --target android`. Existing case sources are
    byte-identical apart from relaxed digests.
11. On both leases, `ENV pnpm run parity:lanes -- --run-host --run-device`:
    - `device-states`, `device-hit` and **`device-traces`** pass on iOS 2 and 3 and Android 2, 2.625 and 3;
    - the forced cases pass frames, applied and pixels;
    - the Android MotionEvent run equals the entry-point run;
    - no lane is `not run`, and existing verdicts are unchanged.
12. Every §4 plant is caught: compiler and runtime plants on the host, runtime plants also on device, `hoverExitOnPress` on
    Android.
13. `ENV pnpm run north-star:check` gives the §8 delta exactly, and no other count rises.
14. `ENV pnpm run wpt:run -- --target web && pnpm run wpt:update-expectations -- --target web`: no pass becomes a fail.
15. `interaction-corpus.test.ts`: completeness over every fixture and the north star; exclusivity of the web conditions; identity
    of every document without interaction rules or cursor against `expected-cursor/compile-identity-base.json` (rewritten on
    the PR base, more than 400 documents).
16. C6: the files lie inside allowed_files, and the RT-13 check passes.

## 8. stop_if

- Any Chrome probe (P1 to P12) re-measures differently on the base, or a trace disagrees with R6 at a gated step after the
  Worker has read the cited source. Report the step and both values; no rule is bent to fit.
- The R2 style check fails: Dragon's gated web output still shows a hover style after a touch tap in Chrome.
- A forced or pointer-reachable focus-visible fixture needs the UA ring, which is P6e's.
- R7 needs a change to an existing writer in `native-program.ts`, `uikit.ts` or `android-views.ts`, or to R1a's 64-assignment cap.
- FORM-a's control boxes or REPL-a's replaced boxes cannot be given hit facts without changing their writers.
- A state rule would need matching at run time (RT-12).
- An existing capture, vector, emitted body, profile status or case source changes, other than the identity-admitted cursor key.
- An RT-13 file needs a non-additive edit.
- The lease is not held.
- A file is needed outside allowed_files.
- Verification fails twice. Timeouts under load do not count (Throughput).

## 9. PR split, size and risk

| PR | Branch | Content | Reviewed size |
|---|---|---|---|
| 1 | seld-r2-compiler | Selectors (with `:active`), the R4/R5/R7 analysis, resolve, cascade and project hunks, web conditions and the R3 gate, forced cases, fixtures (hover, focus, active, combo, relayout, rejects), tests. seld-r2a part A cherry-picked and reworked | ~145 KB |
| 2 | seld-r2-cursor | `cursor` (seld-r2c), `tabindex` and focusability, the UA focus-visible capture and ring refusal, the hover-only-reveal warning, the `@media (hover: hover)` fold, corpus completeness, identity and exclusivity checks | ~110 KB |
| 3 | seld-r2-runtime | `rt-interaction.ts` (translated root and vectors), the R7 second-level table, the R16 hook, the R13 `rt-hit.ts` hunk, the trace capture and report (seld-r2b extended), host plants | ~120 KB |
| 4 | seld-r2-native | UIKit and Android glue, `device-traces` lane, script steps, Android MotionEvent injection, cursor PointerIcon and UIPointerInteraction, profile rows, the north-star regen | ~120 KB |

Regenerated output is in separate commits under `.macroscope/ignore.md` patterns. PRs 1 and 2 can be reviewed while 3 and 4 are
built. They land together as consecutive positions, because PR 1 alone would compile hover with no device runtime and leave the
`device-states` scripts for the combo cases without a runtime.

**Size.** L: about 495 KB reviewed over 4 PRs, plus generated output, comparable to seld-r2c's 2,518 files.

**Risk: medium-high.**
- The compiler side is low risk: seld-r2a and seld-r2c are proven code, and the rework is bounded.
- The real risk is:
  - the two-level table on `state.ts`, which five lineages touch;
  - the native glue (the Android hover-exit quirk; iOS observing recognisers);
  - device lane time (new scripts at 5 DPRs);
  - the R1 reversal, which the PM must record.

**T146 (SELD-R2b).** M, about 130 KB in 1 or 2 PRs.
- **Scope:**
  - `rt-hit.ts` maps the point through the inverse of PNT2's resolved matrix per transformed box. A non-invertible matrix
    is never hit.
  - The order follows PNT1's stacking contexts and z-index paint order, with opacity and transform creating stacking contexts.
  - Rounded borders use the contoured test (contoured_rect.cc and float_rounded_rect.cc are already cited by R1b).
  - It lifts the R13 refusals for transform, z-index, opacity and radius.
- **Fixtures** in ltr and rtl at every DPR:
  - a library-like `translateX(100%)` overlay, unhittable;
  - `scale(1.08)` hover, with hit near its scaled edges;
  - `rotate(45deg)` corners;
  - `scale(0)`;
  - z-index overlap, negative z-index and an opacity stacking context;
  - radius corners.
- **Plants:** `hitIgnoresTransform`, `hitIgnoresStacking`, `hitIgnoresRadius`, `singularTransformHit`.
- **Proof:** `hit-report` and `device-hit`, plus `device-traces` over the transformed hover fixtures.
- Medium risk: the matrix inverse is in the translator subset with exact LU flooring, and its Chrome measurement is needed at
  ±0.5 device px edges.

## 10. Music-player north-star delta

On the music player (examples/music-player/dragon/north-star-check.json), per target, measured at SELD-R2's landing (after FORM-a, before PNT2):
- **SELD-R2:**
  - `DRAGON_UNSUPPORTED_SELECTOR`: −5 (4 `:hover`, 1 `:focus`);
  - `DRAGON_UNSUPPORTED_PROPERTY`: −2 (`cursor` × 2);
  - total −7 per target, matching seld-r2c's regen (369 to 362 on its old base).
  - No count may rise: at this base `transform`, radius, z-index and opacity are still unsupported properties, so R13 and the
    state-write refusals add nothing.
- **PNT2 landing (train 4):** `transform` compiles, so R13 refuses the interaction rules on native:
  - +4 `DRAGON_UNSUPPORTED_SELECTOR [ios]` and +4 `[android]` (3 `:hover`, because the link's subject stays refused, plus 1
    `:focus`);
  - plus PNT2's own transform-in-state-program refusal for `.play-control button:hover`, +1 per native target.
  - These are named, owned rises (SELD-R2b and ANIM-b2). PNT2 records them; they are not regressions.
- **PNT1 landing:** adds nothing new for interaction; the same rules are already refused.
- **T146:** −4 per native target.
- **ANIM-b2:** −1 per native target (the transform state write).
- **TDEC:** the link's `:hover` resolves.

Net after T146 and ANIM-b2: every interaction and `cursor` diagnostic is 0 on every target.

## 11. Board updates for the PM

1. **T064.**
   - Replace T064J's objective with this spec. It has 4 PRs on `review/seld-r2-base` (form-a4-v2 + seld-lanes-v2), and lands
     after FORM-a.
   - Record R1 to R16 in decisions.md under "Runtime styles and animation". Amend "Hover and focus: tap behaviour follows
     recorded Chrome traces" to: "a tap never hovers (principle 3); focus and activation follow Chrome traces".
2. **T146.** Base: after the PNT1 train, train 4, T150a+b, SELD-R2 and OVFL Phase B's `rt-hit.ts` hunk. Scope as in §9. It
   lifts R13 per fact.
3. **T150.** Amend "T150b precedes SELD-R2a/R2b": SELD-R2 lands first, and T150b adds the `visible` clause to R9 in
   `analysis/interaction.ts` (one hunk, plus its allowed file), with a focus fixture (M6). T150b still precedes T146.
4. **T065b (ANIM-b2).** Its hook is `onInteractionChange` (R16) in `emit/runtime/state.ts`/`interaction.ts` glue, not an
   `InteractionRuntime` method. The stop "the interaction runtime exposes no change hook" is resolved.
5. **PNT2 (#70, #73, #74) and PNT1.** Their north-star checks accept §10's named SELD-R2b and ANIM-b2 rises on native, only if
   SELD-R2 is on master first.
6. **P6e.** Record R10 as its contract:
   - the tab order;
   - focus-visible from keyboard and from a non-meta key after pointer focus;
   - the ring via PNT1 `outline-style: auto` and the SELD-P outline write.
   
   It depends on SELD-R2 and SELD-P.
7. **SELD-P.** It is not on the checkpoint-3 path for hover: the music player's hover states write background, border colour,
   colour and transform only. It is needed by P6e (outline) and any authored hover radius or shadow.
8. **T019.** Queue SELD-R2s (more than 256 interaction states per assignment), SELD-R3 (`:focus-within`, `:target`, `:visited`),
   CUR-u (`url()` cursors), and touch adjustment (TADJ, Chrome's fuzzy tap targeting).
9. **FORM-a.** It must expose `touchConsumesTap` per control kind (the range, P7) as a program fact. If #79 does not, SELD-R2
   PR 3 adds it in `analysis/elements.ts`'s fact table.

## Receipt

**Spec:** /tmp/specs/T064.md

**R-rulings:**
- R1: a touch tap never sets `:hover` (owner principle 3, pitfalls P18, Blink's own TODO, Tailwind precedent). Hover comes only
  from an iPad pointer, Pencil hover, or an Android mouse or stylus hover. This reverses T064J's sticky tap hover.
- R2: traces compare effective states (hover && `(hover: hover)`), plus a Chrome style check that Dragon's web output shows no
  hover after a tap.
- R3: web output wraps hover conditions in `@media (hover: hover)`; an authored Tailwind-shape `@media (hover: hover)` folds.
- R4: four dimensions (hover chain, active chain, focus, focus-visible), each linear in elements.
- R5: states with byte-identical programs collapse (the music player's range `:focus` becomes none).
- R6: the pointer event table. Mouse focus at press, touch focus at release; a touch press sets active (caveat); hover is
  recomputed after layout; the range tap is consumed.
- R7: the interaction table is a second level per app assignment (cap 256), not more of R1a's 64 assignments; combos are
  compiled in full.
- R8: focus-visible follows Blink's heuristic, implemented from spec and probes (LGPL, class A). Pointer focus gives it only for
  text-entry elements; keyboard and non-meta keys give it.
- R9: focusability is a compiled fact (HTML §6.6.3 plus probe; tabindex −1 is mouse-focusable); T150b adds `visible`.
- R10: HTML sequential order (probe P8), compiled as a table; platform keys, the ring and the outline write are P6e.
- R11: cursor is exact on Android (PointerIcon via Chrome's two tables), caveat on iPadOS (UIPointerInteraction beams), none on
  iPhone.
- R12: the runtime is the translated root `rt-interaction.ts`; on device, only table lookups.
- R13: `rt-hit.ts` gets a fail-closed `HIT_MODELLED` whitelist (adding replaced and form-control boxes); unmodelled paint facts
  refuse interaction on native until T146.
- R14: three-way proof (TS = Chrome traces; device = TS on a new `device-traces` lane); Android is also proven through real
  MotionEvents.
- R15: Android `HOVER_EXIT` before a mouse `DOWN` does not clear hover.
- R16: `onInteractionChange` is the ANIM-b2 style-change hook.

**Open questions for the owner:** none. R1 applies the owner's own design principle 3 against a PM ruling (decisions.md
"Hover and focus"). Under the Decision Rule, the PM records the reversal.
