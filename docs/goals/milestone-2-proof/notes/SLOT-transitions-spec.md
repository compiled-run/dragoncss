# SLOT-transitions: a property a Markless slot moves is refused when Chrome would transition or animate it

Worker spec (2026-11-23) for review before implementation. Measured on master 2c460cb251. Asked for by the SLOT-colour Judge verdict, Q5 (cw/color-slots, PR #677): refuse it for every slot, before colorpicker ships on phones. The probe scripts and their output are in ~/wt/scratch-op/slottrans/ (chrome.test.ts, chrome.out, probe.test.ts, probe.out).

## Why

On the web, a slot is a number the app writes into a style attribute from script. That changes the computed value of every property that reads it, and a style change event starts a CSS transition on each one whose transition listing covers it. The value animates. On the phone, the harness writes the slot's bound fields and write numbers and lays out again (markless-slots.ts:1-4, harness.ts writeNumbers), so the value jumps to the end. The page would look different on the phone. Animations differ too: a keyframe that sets the property overrides the value the app wrote, or interpolates from it.

## What Chrome 145 does (145.0.7632.6, `launchChrome(1)`)

The probe sets the style attribute from script, then reads `document.getAnimations()` and the computed value in the same task.

| Case (`.t` carries the style attribute) | Running after the write |
| --- | --- |
| `left: var(--x); transition: left 1s`, `--x` 10px to 50px | 1 (`left`) |
| the same with `left` written directly in the attribute | 1 (`left`) |
| `transition: all 1s` | 1 (`left`) |
| `transition: inset 1s` (a shorthand) | 1 (`left`) |
| `transition: --x 1s` (the unregistered custom property) | 0: an unregistered custom property does not interpolate, and `left` is not listed |
| `transition: top 1s` (another property) | 0 |
| `transition: left 0s` | 0 |
| `transition: left 1s -1s` (combined duration 0) | 0 |
| `transition: left 0s 1s` (0s, positive delay) | 1: the value jumps after the delay, still a transition |
| `transition: left 2s -1s` | 1, already halfway (42.1px) |
| `flex: var(--s) 1 0; transition: flex 1s` | 1 (`flex-grow`) |
| `order: var(--o); transition: order 1s` | 1 (`order`: an integer interpolates) |
| `color: var(--c)` on `.t`, `transition: color 1s` on a child | 1 on the child: inheritance moves its computed value |
| `border: solid currentcolor; transition: border-color 1s`, `--c` moves `color` | 0: border-color's computed value stays `currentcolor` |
| `@keyframes k { from, to { width: 100px } }`, `animation: k 10s`, inline width 10px to 50px | the animation keeps 100px |
| `animation: k 0s forwards` (to 100px) | keeps 100px |
| `animation: k 0s` (fill none) | 50px, no effect |

So Chrome starts a transition on (element, longhand) when its computed value changes, the after-change style lists it, the combined duration `max(duration, 0) + delay` is above 0, and the property interpolates (Dragon refuses `allow-discrete`, animation.ts:381). A registered custom property would interpolate itself, but Dragon already refuses a transition that interpolates one (analysis/registered.ts:1-3, SLOT-colour R5).

## What Dragon does today

- **What a slot moves is recorded in engine terms, not longhands.** slotBindings (markless-slots.ts:178-279) diffs whole sample compiles. A `SlotField` (:19) names a box's engine-input style key and a `SlotWrite` (:21) a write kind. On slots.native-style-input.json these are `left`, `flexBasis`, `flexGrow`, `width`, `marginTop`, and the writes `background-color`, `border-colors` (four longhands in one write) and `text-color` (a text node's, from its element's `color`) (probe.out). Mapping them back to longhands would take a hand table, which "one analysis" rules out.
- **The export's animation entries cannot answer the question.** `anim` (native-style-export.ts:97-100, :315) is the AnimProgram that lowerAnimProgram builds (lower/anim-program.ts:88-106). A `TransitionSlot` exists only for an (element, longhand) whose value differs between state assignments (:100, `present.every(same) → continue`), and only for kinds the animator writes (:94). A property that only a runtime slot moves has a constant value across assignments, so it gets no entry. The check at markless-style-input.ts:847-852 reads these entries only to refuse animation inside a `@for` row.
- **The analysis does have the facts.** analyzeAnimations gives each element, per case, its `listings` (analysis/animations.ts:73-86): `all` is every Dragon longhand, a shorthand expands to its longhands, the last repeated entry wins, the initial `all 0s` lists nothing, an unknown name lists nothing (:163-206), and var() in a transition list is substituted per element (:122-142). It also gives each element's animations with `hasKeyframes`, and the `keyframes` by name. ENV-SAFE (refuseAnimatedSafeAreaInsets, :636-663) already joins these listings with resolved values in the same shape this task needs.
- **Resolved values are computed values.** Each ResolvedElement holds `props: Map<Longhand, ResolvedValue>` (analysis/resolve.ts:59-64), after var() substitution (analysis/variables.ts:86-138, :157-181) and inheritance. `currentcolor` stays a keyword on every property except `color` (resolve.ts:386-387), as in Chrome.
- **Today every slot input with any transition or animation is refused, with the wrong reason.** sampleOf compiles each sample without a plan (markless-style-input.ts:695-702), and nativeStyleExport throws at native-style-export.ts:314: "has transitions or animations, which a phone runs only with a layout plan", although `--plan` was given. The probe hits it for `left 1s`, `all 1s`, a transition on the swatch's background, `width 0s` and a keyframe animation alike (probe.out). The base compile at :705 is outside `tried`, so the whole export fails.
- A `transition` or `animation` declaration inside the style attribute itself is already refused at the attribute (docs/markless-native-styles.md:115).

## The rule (ST1)

For each target, each assignment i and each slot k:

- **Moved:** the (element, longhand) pairs whose resolved value in assignment i differs between the base compile and any sample compile of slot k. This includes inheriting descendants and var() users, and leaves out a `currentcolor` border, as Chrome does. Generated boxes are included where the resolved tree has them.
- **Refused when**, for a moved pair, the element's listing in assignment i has mode `listed`, `max(duration, 0) + delay > 0`, and `animationKind(longhand).kind !== 'discrete'`. This uses Chrome's interpolability (the kind table agrees with Chrome's `interpolable`, css/animation-kinds.ts:1-4), not Dragon's admission, so `transition: all` with a slot moving `order` is refused although `order` is smooth-unadmitted.
- **Also refused when** an animation on the element in assignment i has keyframes that set the longhand, whatever its timing (Q2).

The messages, at build time, by name (node is the input's id, slot the slot's id):

- `<target> assignment <i>: <longhand> of <node> follows <slot> and has a transition (<duration>s, delay <delay>s), which Chrome runs when the app writes a new value, and the phone writes the new value at once`
- `<target> assignment <i>: <longhand> of <node> follows <slot> and is set by the keyframes of animation <name>, which Chrome interpolates from the value the app writes, and the phone does not`

**Accepted:** a combined duration of 0 or less (`0s`, or `1s -1s`; `0s 1s` is refused); a moved property the listing does not cover (a transition on `top` only, on the unregistered custom property, or `none`); a discrete property under `all`; an animation whose keyframes do not set the moved property. Inputs like these are refused today (above) and become exportable.

**Where.** A new accessor in packages/dragon/src/internal.ts beside animProgramOf (:462-471): per case, each element's resolved values as JSON, its listings, and its keyframed longhands with each animation's name. sampleOf keeps them per assignment in `SlotSample`. slotBindings checks the rule per assignment and slot, beside its other refusals. Sample compiles stop throwing at native-style-export.ts:314 (they need no animator tables); the final export with `--plan` keeps that check.

## Tests and planted faults

- **The rule against Chrome** (new packages/parity/test/markless-slot-transitions.test.ts). Each row of the Chrome table becomes a one-element slot input plus the same page in Chrome. The test asserts that the export is refused, with the message naming the property, slot and transition, exactly when Chrome has a running animation on the moved pair after the write.
- **Newly accepted inputs:** slots.native-style-input.json with `.thumb { transition: top 1s }` added exports, and its `slotFields`, `slotWrites` and `slotRefusals` equal the unchanged input's.
- **Unchanged:** markless-slots.test.ts, markless-style-choice.test.ts, markless-row-slots.test.ts and markless-rows.test.ts:252-256 pass as they are, and a regen changes no expected file.
- **Planted faults** (build-side, a test-only argument of the check; each must make the Chrome test fail):
  - `slotTransitionDelayIgnored`: the check reads `duration > 0`. The `0s 1s` row is accepted.
  - `slotTransitionOwnElementOnly`: Moved covers only the element with the template. The inherited child `color` row is accepted.
  - `slotTransitionAdmittedOnly`: Dragon's admission replaces Chrome's interpolability. The `order` row is accepted.
  - `slotTransitionAnyBorder`: `currentcolor` resolves to the colour before the diff. The border-color row is refused.

## Existing inputs affected

None would be newly refused. No slot input has a transition or animation today, and if one did, the export would already fail at native-style-export.ts:314. These were checked:

- **Dragon:** examples/markless-styles/input/slots and style-choice, rows.native-style-input.json (the base of markless-row-slots.test.ts), and the inline CSS in markless-slots, markless-style-choice, markless-row-slots and land-parallel tests.
- **Markless origin/main 5565aba6f,** every input with a `styleTemplate`: packages/mobile/proofs u91-slot-percentage, u92-slot-length, u93-slot-number, u94-slot-integer, u95-slot-colour, u101-slot-in-arm, u102-drawer-swipe and u102-row-slots. None of them has a transition or animation.
- **@markless/ui:** no family's own `<style>` declares a transition or animation (packages/headless/components/src/**/*.tsrx; the only hit is a comment at tour.tsrx:255). A transition an app's stylesheet adds is exactly what this rule refuses.

What changes: slot inputs with a transition or animation that the rule accepts are now exported, and the rest are refused with the rule's message instead of ":314"'s.

## Files and size

- packages/dragon/src/internal.ts: the accessor, about 1.5 KB.
- packages/parity/src/markless-slots.ts: `SlotSample` fields and the check, about 3 KB.
- packages/parity/src/markless-style-input.ts: sampleOf keeps the facts, and samples skip the :314 check, about 1 KB.
- packages/parity/src/native-style-export.ts: the sample option, about 0.5 KB.
- packages/parity/test/markless-slot-transitions.test.ts (new): about 6 KB.
- docs/markless-native-styles.md:127: the refusal, about 0.7 KB.
- **About 12-14 KB reviewed,** one PR. There is no generated output and no harness change. The extra cost per sample is one walk of each case's resolved tree.

## Open questions for the Judge

1. **Analysis facts instead of the export's entries.** The verdict says "the export's animation entries". They omit every property whose value is the same in all assignments (anim-program.ts:100), which is the usual slot case, and they name longhands while the bindings name engine keys. Proposed: the analysis's listings, keyframes and resolved values, through one internal accessor.
2. **Animations by timing.** Proposed: refuse any animation whose keyframes set a moved property, whatever its timing. The alternative accepts the case with no effect (0s, fill `none` or `backwards`, delay 0 or less), which Chrome shows has none. That alternative needs its own fill rules and has no current user.
3. **Accepting transitions on other properties.** This newly exports inputs that are refused today. The animator then runs on the plan's roots at the initial slot values (harness.ts:4004-4009 takes no `slots`). That is safe only while no animated track or colour closure write (AnimProgram `closure`, anim-program.ts:57-58) is a moved pair. Proposed: accept, and refuse a closure write that is a moved pair with the same transition message. The alternative keeps the blanket refusal in v1 and corrects only its message.
4. **The order of refusals.** A slot inside a `@for` row with a transition is refused by the row rule (markless-style-input.ts:852) before this one. Proposed: keep the row rule first, since it covers every transition in a row.
