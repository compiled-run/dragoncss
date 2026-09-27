# T005: agent evaluation design and harness (Scout, design phase)

Status: the harness is built and validated. No subject runs have happened yet. The PM runs them by dispatching fresh general-purpose subagents.
Snapshot: commit `a82b849`, extracted to `/tmp/t005/snap`. `pnpm install --offline --frozen-lockfile` succeeded, and `pnpm test` gives 13 files and 394/394 tests passing. Chrome 145 comes from the Playwright 1.58.2 cache.
Harness: `/tmp/t005/harness`, which is a symlink to `/tmp/t005/snap/eval`. It holds `score.ts`, `tasks.ts`, `objects.ts` and `solutions/`. Run folders go in `/tmp/t005/runs/`.

## 1. Method

**Pass definition.** A subject output passes only if all four of these hold:

1. `typecheck`: the typed-object arm only; `tsc --strict --exactOptionalPropertyTypes` is clean.
2. `check`: the public `createProject({ projectId, targets: { ios: { minimum: '15.0' }, web: {} } }).check(input).ok`.
3. `parity`: the snapshot's own `runFixture` passes for every case, in both lanes: linux-dragon-layout within 1 device px of authored Chrome, and chrome-dual exact.
4. `intent`: task assertions on boxes and computed values, run against the subject's authored CSS in pinned Chrome.

The scorer also reports `checkAndParityOnly`, which is the brief's literal definition. Intent is needed because parity compares the authored CSS against Dragon's output of that same CSS. On its own it is self-referential: an empty or wrong stylesheet still passes check plus parity.

**Ad-hoc fixtures.** The scorer writes the task's fixed markup plus the subject's CSS into `packages/parity/fixtures/eval-<task>-<pid>`. HTML tasks use `.html`; the tree task uses a folder with `fixture.json`. Everything then runs through the unmodified `fixtureInput`, `casesOf`, `runFixture` and `captureFixture`, and the files are deleted in `finally`. There are no committed-fixture writes and none of the regeneration scripts run.

**Three measurements:**

- **(a) First-try pass rate in raw CSS.** A subject writes `attempt1` before it may run the scorer. Later attempts (at most 5) measure repair with feedback.
- **(b) Diagnostic repair.** Each repair task starts from broken CSS aimed at specific codes. The scorer reports each target code as `present`, `gone-intent-ok` (a correct fix) or `gone-intent-broken` (the error went away but the design broke). Each intent assertion is tagged with the code it guards. Setting `EVAL_MESSAGE_ONLY=1` prints only the first line of each diagnostic, with no `why` and no `fix`. This ablation isolates the value of the fix text.
- **(c) Typed objects.** `objects.ts` is a scratch StyleX-like adapter. It has camelCase longhands, numbers meaning px, `variants` for the element's own `ui-*` attributes, `under` for ancestor-class states, and `$body` for the body element. `sheet()` returns CSS text, and that text goes through exactly the same check, parity and intent pipeline. The types are syntax-level: literal unions, template-literal lengths and colours. They do not encode the support profile; for example, `display: 'block'` typechecks, but Dragon rejects it. Both arms get the same rules text.

**What (c) can show:** whether a typed surface, with errors at typecheck time, raises the first-try pass rate or cuts attempts on these tasks, compared with the same model writing CSS.

**What (c) cannot show:**

- the effect of real StyleX familiarity, since the adapter API is new to every subject;
- editor autocomplete;
- diagnostics mapped back to object locations (Dragon spans point at the generated CSS, which the scorer prints; this biases against objects);
- merging, tokens, dark mode or larger apps;
- non-Claude agents.

With n=15 task attempts per arm, only large effects are visible.

## 2. Tasks (in `eval/tasks.ts`)

Print any brief with `node --conditions=dragon-internal eval/score.ts --brief <id>`. It shows the brief, the fixed markup and any starting CSS.

| id | kind | area | success beyond check+parity |
|---|---|---|---|
| T1-toolbar | build | flex row, grow, centring, gap | bar 300x40; logo (9,8) 24x24; spacer (41,16) 178x8; action (227,6) 64x28; border rgb(204,204,204) |
| T2-card | build | flex column fill | card 160x120; title/content/footer at y 10/34/94, heights 20/56/16, width 140 |
| T3-colours | build | colours and borders, block flow | four 24x24 swatches at y 0/30/60/90; exact computed colours, including rgba(...,0.5), per-side borders, and hsl(210,100%,40%) = rgb(0,102,204) |
| T4-text | build | text (Ahem) | label 60x28; two lines centred (x 5 w 50; x 15 w 30); colour, font-size, line-height, text-align |
| T5-toggle | build | component state variant (tree@0, `ui-on`) | 2 cases. Off: track #ccc, knob at x 2. On: track #0366d6, knob at x 22 |
| R1-selectors | repair | DRAGON_UNSUPPORTED_SELECTOR (`+`, `:first-child`) | items at y 0/14/28; `.lead` blue |
| R2-values | repair | DRAGON_UNSUPPORTED_VALUE (display: grid), _PROPERTY (border-radius), _IMPORTANT | panel 132x40; rows at y 6 and 22 |
| R3-context | repair | DRAGON_UNSUPPORTED_AT_RULE (@media), then _FONT and _UNPROVEN_CONTEXT (margin-top: auto in block) | width 80 kept (the @media must be unwrapped, not deleted); y 0; Ahem; two lines (height 24) |

Reference solutions are in `eval/solutions/*.css`, plus `T1-toolbar.ts` and `T5-toggle.ts` for the typed arm. All of them pass (section 5).

## 3. Subject prompts

Replace `<RUN>` with the run folder name, for example `c1`, `o1` or `r1`, and `<TASKS>` with the ordered task list from section 4.

### 3.1 Shared rules block

This is the guidance an app developer would see. It follows T030 §4.4, with limits taken from the a82b849 catalogue and profiles.

```text
This app builds for web and ios with Dragon, which compiles regular CSS to native views and checks the result against Chrome.
- Selectors: class names, optionally with a tag (html, body, div) and ui-* attributes ([ui-x] or [ui-x="v"]), joined by descendant (space) or child (>) combinators. No +, ~, *, ids, pseudo-classes or pseudo-elements.
- No at-rules (@media, @supports, ...) and no !important.
- Properties: display, position, box-sizing, overflow(-x/-y), direction, width, height, min-/max-width/height, margin*, padding*, border and its side/width/style/color forms, flex, flex-flow, flex-direction, flex-wrap, flex-grow, flex-shrink, flex-basis, order, justify-content, align-items, align-self, align-content, gap, row-gap, column-gap, font-size, font-family, line-height, text-align, white-space, color, background-color.
- display accepts flex or none; elements are block by default.
- Text must use font-family: Ahem (a test font: every glyph and space is exactly 1em square).
- Whether a value is supported can depend on the formatting context where it is used (block, flex-row, flex-column); the check names the proven contexts.
- Before finishing, run the check. An error for any target fails it; change the styles, do not work around the check.
```

### 3.2 Arm CSS (build)

```text
You are styling UI in a Dragon app. Complete each task below in the order given.
<RULES BLOCK>
For each task:
1. Read the task: cd /tmp/t005/snap && node --conditions=dragon-internal eval/score.ts --brief <TASK>
2. Write your first attempt to /tmp/t005/runs/<RUN>/<TASK>/attempt1.css BEFORE scoring this task. Never edit it afterwards.
3. Score it: cd /tmp/t005/snap && node --conditions=dragon-internal eval/score.ts <TASK> /tmp/t005/runs/<RUN>/<TASK>/attempt1.css
4. If it fails, write attempt2.css, attempt3.css ... and score each. Stop at PASS or after attempt5, and copy the last attempt to final.css.
Only run the two commands above. Do not read files under /tmp/t005/snap or /tmp/t005/harness, and do not look at other folders in /tmp/t005/runs.
Tasks: <TASKS>
Finish with one line per task: task, attempts used, final PASS/FAIL, and what tripped you (one phrase).
```

### 3.3 Arm OBJ (build)

This is the same as 3.2, with these changes:

- Replace the file extension `.css` with `.ts`.
- Add after the rules block: "Write styles as a TypeScript module, not CSS: `import { sheet } from '/tmp/t005/harness/objects.ts'; export default sheet({ ... });`. You may read /tmp/t005/harness/objects.ts, which holds the types and the only API. Keys are class names; '$body' styles body. Use `variants: [{ attr: 'ui-x', equals: 'v', style: {...} }]` for the element's own ui-* state, and `under: [{ cls: 'parent', attr?, equals?, child?, style }]` for styles under an ancestor. Numbers mean px, except flexGrow, flexShrink, order and lineHeight. The scorer typechecks your module first."
- Change the read restriction to allow objects.ts.

### 3.4 Arm REPAIR

```text
You maintain a Dragon app. Each task has a starting stylesheet that fails the Dragon check. Fix it using the check's output and the task description.
<RULES BLOCK>
For each task:
1. Read the task: cd /tmp/t005/snap && node --conditions=dragon-internal eval/score.ts --brief <TASK>
2. Save the starting stylesheet unchanged as /tmp/t005/runs/<RUN>/<TASK>/attempt0.css and score it: cd /tmp/t005/snap && node --conditions=dragon-internal eval/score.ts <TASK> /tmp/t005/runs/<RUN>/<TASK>/attempt0.css
3. Write attempt1.css, attempt2.css ... and score each. Stop at PASS or after attempt5, and copy the last attempt to final.css.
Only run these commands; read nothing under /tmp/t005/snap or /tmp/t005/harness.
Tasks: <TASKS>
Finish with one line per task: attempts, final PASS/FAIL, and which diagnostic was hardest and why.
```

For the ablation run, prefix both scorer commands with `EVAL_MESSAGE_ONLY=1`.

## 4. Run plan (12 subject runs at most)

Run them in this order. Interleave the arms so that drift in the PM or the environment hits both equally.

| # | run | arm | task order |
|---|---|---|---|
| 1 | c1 | CSS | T1 T2 T3 T4 T5 |
| 2 | o1 | OBJ | T1 T2 T3 T4 T5 |
| 3 | c2 | CSS | T3 T5 T1 T4 T2 |
| 4 | o2 | OBJ | T3 T5 T1 T4 T2 |
| 5 | c3 | CSS | T5 T4 T3 T2 T1 |
| 6 | o3 | OBJ | T5 T4 T3 T2 T1 |
| 7 | r1 | REPAIR full text | R1 R2 R3 |
| 8 | r2 | REPAIR full text | R2 R3 R1 |
| 9 | r3 | REPAIR full text | R3 R1 R2 |
| 10 | m1 | REPAIR message-only | R1 R2 R3 |
| 11 | m2 | REPAIR message-only | R3 R2 R1 |
| 12 | spare | first re-run of any run lost to a harness fault. If unused: CSS with no rules block (guidance ablation), order T1..T5 |

Before run 1, re-score two reference solutions to confirm the environment. Each run takes roughly 5 to 25 scorer calls, at 3 to 6 s each.

Validity checks per run: confirm from the transcript that `attempt1` was written before the first scorer call for that task, that no file under snap or harness was read (objects.ts excepted for OBJ), and that the files are present. Any violation invalidates that task attempt, which is reported, not dropped.

## 5. Scorer usage and validation

```text
cd /tmp/t005/snap
node --conditions=dragon-internal eval/score.ts --brief <task>
node --conditions=dragon-internal eval/score.ts <task> <file.css|file.ts> [--json]    # exit 0 = PASS
EVAL_MESSAGE_ONLY=1 node --conditions=dragon-internal eval/score.ts <task> <file>     # diagnostics without why/fix
```

`--json` prints these keys: task, input, pass, typecheck, check, parity, intent, checkAndParityOnly, perCode, diagnostics (code, severity, target, text), parityDetail, intentRows, typeErrors, css.

Validation run (from `/tmp/t005/validation.log`, with "related:" lines dropped):

```text
$ node --conditions=dragon-internal eval/score.ts T1-toolbar eval/solutions/T1-toolbar.css
PASS T1-toolbar  typecheck=ok check=ok parity=pass intent=pass
$ node --conditions=dragon-internal eval/score.ts T2-card eval/solutions/T2-card.css
PASS T2-card  typecheck=ok check=ok parity=pass intent=pass
$ node --conditions=dragon-internal eval/score.ts T3-colours eval/solutions/T3-colours.css
PASS T3-colours  typecheck=ok check=ok parity=pass intent=pass
$ node --conditions=dragon-internal eval/score.ts T4-text eval/solutions/T4-text.css
PASS T4-text  typecheck=ok check=ok parity=pass intent=pass
$ node --conditions=dragon-internal eval/score.ts T5-toggle eval/solutions/T5-toggle.css
PASS T5-toggle  typecheck=ok check=ok parity=pass intent=pass
$ node --conditions=dragon-internal eval/score.ts R1-selectors eval/solutions/R1-selectors.css
PASS R1-selectors  typecheck=ok check=ok parity=pass intent=pass
$ node --conditions=dragon-internal eval/score.ts R2-values eval/solutions/R2-values.css
PASS R2-values  typecheck=ok check=ok parity=pass intent=pass
$ node --conditions=dragon-internal eval/score.ts R3-context eval/solutions/R3-context.css
PASS R3-context  typecheck=ok check=ok parity=pass intent=pass
$ ... score.ts T1-toolbar eval/solutions/T1-toolbar.ts
PASS T1-toolbar  typecheck=ok check=ok parity=pass intent=pass
$ ... score.ts T5-toggle eval/solutions/T5-toggle.ts
PASS T5-toggle  typecheck=ok check=ok parity=pass intent=pass
$ ... score.ts T1-toolbar eval/solutions/T1-toolbar.wrong.css
FAIL T1-toolbar  typecheck=ok check=fail parity=not-run intent=fail

Dragon diagnostics (2):
packages/parity/fixtures/eval-t1-toolbar-51442.html:6:12: error DRAGON_UNSUPPORTED_SELECTOR: selector part "*" is not supported in milestone 1
  why: Scoped selectors may test only their own element and same-owner ancestors through class, type, descendant, child and ui-* attribute parts.
  fix: Rewrite the selector: Use class compounds, optionally with a tag and [ui-*] or [ui-*="value"], joined by descendant or child combinators.

packages/parity/fixtures/eval-t1-toolbar-51442.html:6:13: error DRAGON_UNSUPPORTED_SELECTOR: selector part ":first-child" is not supported in milestone 1
  why: Scoped selectors may test only their own element and same-owner ancestors through class, type, descendant, child and ui-* attribute parts.
  fix: Rewrite the selector: Use class compounds, optionally with a tag and [ui-*] or [ui-*="value"], joined by descendant or child combinators.

Design requirements not met (4/4):
  T1-toolbar bar: width 318 (want 300); height 42 (want 40)
  T1-toolbar logo: y 9 (want 8)
  T1-toolbar spacer: x 139 (want 41); y 17 (want 16); width 0 (want 178)
  T1-toolbar action: x 245 (want 227); y 7 (want 6)
exit=0
$ ... score.ts T5-toggle eval/solutions/T5-toggle.wrong.ts
FAIL T5-toggle  typecheck=fail check=fail parity=not-run intent=fail

TypeScript errors:
eval/solutions/T5-toggle.wrong.ts(3,12): error TS2322: Type '"grid"' is not assignable to type '"none" | "block" | "flex"'.
eval/solutions/T5-toggle.wrong.ts(4,34): error TS2322: Type '"red"' is not assignable to type 'Color'.


Dragon diagnostics (4):
packages/parity/fixtures/eval-t5-toggle-51462/toggle.css:1:19: error DRAGON_UNSUPPORTED_VALUE [ios]: display: grid is unsupported on ios (support profile m1-s3b)
  why: The target's support profile has no passing proof for this value.
  fix: Use a supported value: Use one of: flex, none.

packages/parity/fixtures/eval-t5-toggle-51462/toggle.css:1:19: error DRAGON_UNSUPPORTED_VALUE [web]: display: grid is unsupported on web (support profile m1-s3b)
  why: The target's support profile has no passing proof for this value.
  fix: Use a supported value: Use one of: flex, none.

packages/parity/fixtures/eval-t5-toggle-51462/toggle.css:2:54: error DRAGON_UNPROVEN_CONTEXT [ios]: background-color:<named-color> on knob is used in the block context, which ios has not proven (proven: flex-row)
  why: Profile rows are proven per formatting context; another context may behave differently (docs/api.md §6.3).
  fix: Use a proven context: Use background-color:<named-color> only in a proven context (flex-row), or add a passing parity fixture for block.

packages/parity/fixtures/eval-t5-toggle-51462/toggle.css:2:54: error DRAGON_UNPROVEN_CONTEXT [web]: background-color:<named-color> on knob is used in the block context, which web has not proven (proven: flex-row)
  why: Profile rows are proven per formatting context; another context may behave differently (docs/api.md §6.3).
  fix: Use a proven context: Use background-color:<named-color> only in a proven context (flex-row), or add a passing parity fixture for block.

Generated CSS (diagnostic locations refer to this):
.track { display: grid; width: 40px; height: 20px; padding: 2px; background-color: #cccccc; }
.knob { width: 16px; height: 16px; background-color: red; }


Design requirements not met (4/4):
  T5-toggle#0 track: width 44 (want 40); height 24 (want 20)
  T5-toggle#0 knob: background-color "rgb(255, 0, 0)" (want "rgb(255, 255, 255)")
  T5-toggle#1 track: width 44 (want 40); height 24 (want 20); background-color "rgb(204, 204, 204)" (want "rgb(3, 102, 214)")
  T5-toggle#1 knob: x 2 (want 22)
$ ... score.ts R1-selectors /tmp/t005/runs/start-R1-selectors.css
FAIL R1-selectors  typecheck=ok check=fail parity=not-run intent=pass

Dragon diagnostics (2):
packages/parity/fixtures/eval-r1-selectors-51491.html:8:7: error DRAGON_UNSUPPORTED_SELECTOR: selector part "+" is not supported in milestone 1
  why: Scoped selectors may test only their own element and same-owner ancestors through class, type, descendant, child and ui-* attribute parts.
  fix: Rewrite the selector: Use class compounds, optionally with a tag and [ui-*] or [ui-*="value"], joined by descendant or child combinators.

packages/parity/fixtures/eval-r1-selectors-51491.html:9:12: error DRAGON_UNSUPPORTED_SELECTOR: selector part ":first-child" is not supported in milestone 1
  why: Scoped selectors may test only their own element and same-owner ancestors through class, type, descendant, child and ui-* attribute parts.
  fix: Rewrite the selector: Use class compounds, optionally with a tag and [ui-*] or [ui-*="value"], joined by descendant or child combinators.

Per target code: DRAGON_UNSUPPORTED_SELECTOR=present
$ ... score.ts R2-values /tmp/t005/runs/start-R2-values.css
FAIL R2-values  typecheck=ok check=fail parity=not-run intent=pass

Dragon diagnostics (4):
packages/parity/fixtures/eval-r2-values-51511.html:6:53: error DRAGON_UNSUPPORTED_PROPERTY: border-radius is not supported in milestone 1
  why: The compiler resolves only the milestone-1 longhands and their shorthands.
  fix: Remove the declaration (1 guarded edit)

packages/parity/fixtures/eval-r2-values-51511.html:7:8: error DRAGON_UNSUPPORTED_IMPORTANT: !important on height is not supported
  why: Order and specificity decide the cascade in milestone 1.
  fix: Remove !important (1 guarded edit)

packages/parity/fixtures/eval-r2-values-51511.html:6:19: error DRAGON_UNSUPPORTED_VALUE [ios]: display: grid is unsupported on ios (support profile m1-s3b)
  why: The target's support profile has no passing proof for this value.
  fix: Use a supported value: Use one of: flex, none.

packages/parity/fixtures/eval-r2-values-51511.html:6:19: error DRAGON_UNSUPPORTED_VALUE [web]: display: grid is unsupported on web (support profile m1-s3b)
  why: The target's support profile has no passing proof for this value.
  fix: Use a supported value: Use one of: flex, none.

Per target code: DRAGON_UNSUPPORTED_VALUE=present DRAGON_UNSUPPORTED_PROPERTY=present DRAGON_UNSUPPORTED_IMPORTANT=present
$ ... score.ts R3-context /tmp/t005/runs/start-R3-context.css
FAIL R3-context  typecheck=ok check=fail parity=not-run intent=fail

Dragon diagnostics (1):
packages/parity/fixtures/eval-r3-context-51531.html:6:1: error DRAGON_UNSUPPORTED_AT_RULE: @media is not supported in milestone 1
  why: Milestone 1 resolves only plain style rules; an at-rule would change which rules apply.
  fix: Remove the at-rule (1 guarded edit)

Design requirements not met (1/3):
  R3-context cap: height 12 (want 24); font-family "Times" (want "Ahem")

Per target code: DRAGON_UNSUPPORTED_AT_RULE=present DRAGON_UNSUPPORTED_FONT=gone-intent-broken DRAGON_UNPROVEN_CONTEXT=gone-intent-ok

$ EVAL_MESSAGE_ONLY=1 ... score.ts R2-values <start CSS>
FAIL R2-values  typecheck=ok check=fail parity=not-run intent=pass

Dragon diagnostics (4):
packages/parity/fixtures/eval-r2-values-53039.html:6:53: error DRAGON_UNSUPPORTED_PROPERTY: border-radius is not supported in milestone 1

packages/parity/fixtures/eval-r2-values-53039.html:7:8: error DRAGON_UNSUPPORTED_IMPORTANT: !important on height is not supported

packages/parity/fixtures/eval-r2-values-53039.html:6:19: error DRAGON_UNSUPPORTED_VALUE [ios]: display: grid is unsupported on ios (support profile m1-s3b)

packages/parity/fixtures/eval-r2-values-53039.html:6:19: error DRAGON_UNSUPPORTED_VALUE [web]: display: grid is unsupported on web (support profile m1-s3b)

Per target code: DRAGON_UNSUPPORTED_VALUE=present DRAGON_UNSUPPORTED_PROPERTY=present DRAGON_UNSUPPORTED_IMPORTANT=present

$ ... score.ts T5-toggle /tmp/t005/runs/dry/final.ts   (absolute import path, as subjects will write it)
PASS T5-toggle  typecheck=ok check=ok parity=pass intent=pass
```

## 6. How to report results

Add a "Results" section to this note, with:

1. **Per-arm table (a)/(c):** arm, task attempts (n), first-try passes k/n, final passes k/n, median attempts to pass, and first-try failures split into typecheck / check / parity / intent. Include one row per task per arm (k/3).
2. **First-try diagnostic census:** each code seen on attempt1 and how many times, per arm. This shows what the rules text fails to prevent.
3. **Per-code repair table (b):** code, times shown, `gone-intent-ok` on the next attempt, `gone-intent-ok` by final, `gone-intent-broken` (a wrong fix), and the same columns for message-only. A code is **reliable** if it was fixed correctly in all full-text runs on the first attempt after being shown, and was never intent-broken.
4. **Decision on typed objects (pre-registered):** recommend an optional object input only if OBJ's first-try passes are at least CSS + 5/15 and its final passes are no lower. Otherwise, record "no measured benefit; stay CSS-only", in line with decisions.md. Also list every typecheck error that prevented a Dragon error; those are the candidates for profile-derived types.
5. **Diagnostic wording recommendations:** only for codes that were not reliable, or where message-only did as well as full text. Quote the subject's "what tripped you" line as supporting evidence only.
6. Raw data: `/tmp/t005/runs/<run>/<task>/attempt*.{css,ts}`, plus `--json` of each final.

## 7. Findings from building the harness (at a82b849)

- `display: block` is rejected on both ios and web ("Use one of: flex, none"). Agents will write it often, so the rules block states this up front.
- Colour support is proven per formatting context. `rgba()`, `hsl()` and named background colours are proven only in flex-row. Hex border colours are proven only in block, as is 8-digit hex (which passes in block). `margin-top: auto` is proven only in flex. So the original T3 (a flex row with per-side border colours) had no passing solution; T3 now uses block flow. Its brief still names hsl() and "50% opacity", so a literal first try fails with DRAGON_UNPROVEN_CONTEXT.
- Diagnostics are staged. With `@media` present, only DRAGON_UNSUPPORTED_AT_RULE is reported; the FONT and UNPROVEN_CONTEXT errors appear only after it is fixed. Its guarded edit ("Remove the at-rule") deletes the enclosed rules, which here would lose `width: 80px`. That is a wording and fix probe for R3.
- Each target-specific error is printed twice, once for ios and once for web, with identical text. This is noise worth measuring in (b).
- Parity alone cannot fail a design mistake, because the authored CSS is its own oracle. That is why the intent assertions exist.

## 8. Results (PM run, 2026-09-27; 11 subject runs; snapshot a82b849)

Subjects were fresh Claude general-purpose subagents, one per run. The runs happened in three interleaved batches, and both reference solutions were re-scored as PASS before run 1. The spare run was not needed. Every subject reported its per-task attempts. Raw files are in `/tmp/t005/runs/<run>/<task>/`. The PM spot-checked the transcripts' final summaries for rule violations and found none; a file-level audit was not done.

### 8.1 Build tasks, arms CSS and OBJ (n = 15 task attempts per arm)

| arm | first-try pass | final pass | median attempts |
|---|---|---|---|
| CSS (c1, c2, c3) | **5/15** | 15/15 | 2 |
| OBJ (o1, o2, o3) | **7/15** | 15/15 | 1 |

| task | CSS first-try | OBJ first-try |
|---|---|---|
| T1-toolbar | 1/3 | 2/3 |
| T2-card | 1/3 | 3/3 |
| T3-colours | 0/3 | 0/3 |
| T4-text | 3/3 | 1/3 |
| T5-toggle | 0/3 | 1/3 |

**Why first tries failed:**
- **CSS, 10 failures:** all 10 were check failures, and none were typecheck, parity or intent failures.
  - 4 × `flex-direction: row` unproven in a single-line flex row (T1, T5 ×3);
  - 4 × `gap` shorthand, whose other-axis longhand (`column-gap` in a column, `row-gap` in a row) is unproven (T1, T2 ×2, and R1 in repair);
  - 3 × `rgba()`/`hsl()` background unproven in block flow (T3);
  - 1 × `display: block` unsupported (T3).
- **OBJ, 8 failures:**
  - 6 were the same profile-granularity failures: flex-direction row, flex-wrap making align/justify unproven, and rgba/hsl in block;
  - 2 were adapter-specific: `lineHeight: 14` is a unitless multiplier (T4 ×2).
  - None was a typecheck error that prevented a Dragon error.

**Pre-registered decision (typed objects):** OBJ first-try 7/15 is below CSS + 5 = 10/15, so the result is **no measured benefit; stay CSS-only**, consistent with decisions.md. Both arms were limited by the same profile-granularity blocks, not by the authoring format. The syntax-level types caught nothing Dragon would reject, and they added one new trap (the unitless lineHeight). Profile-derived types remain untested and would only duplicate what the check already reports.

### 8.2 Repair tasks, (b)

| arm | first-attempt pass | final pass |
|---|---|---|
| Full text (r1, r2, r3) | 8/9 | 9/9 |
| Message-only (m1, m2) | 4/6 | 6/6 |

**Per-code results:**

- **Reliable (fixed correctly on the first attempt after being shown, never with the intent broken, all runs):**
  - DRAGON_UNSUPPORTED_SELECTOR (`+`, `:first-child`);
  - DRAGON_UNSUPPORTED_VALUE (`display: grid`);
  - DRAGON_UNSUPPORTED_PROPERTY (`border-radius`);
  - DRAGON_IMPORTANT;
  - DRAGON_UNSUPPORTED_AT_RULE (`@media`).

  No subject applied the destructive "remove the at-rule" edit; all unwrapped the width by hand.
- **Not reliable: DRAGON_UNPROVEN_CONTEXT.** Each of the 3 second attempts in the repair arm (r2, m1, m2) was a `gap` shorthand that the subject wrote *during* repair, which then failed on its other-axis longhand. Subjects reported that the message names `column-gap`, not the `gap` they wrote.
- **Font and unproven context in R3 were masked.** With `@media` present, only the at-rule was reported. Every subject found the missing Ahem font from the intent output, not from a Dragon diagnostic. One subject saw UNPROVEN_CONTEXT only as a code in the summary line.
- **Full text vs message-only:** 8/9 against 4/6. The difference is small and comes entirely from the `gap` trap in R1, where the fix text did not name the shorthand either. There is no evidence that the fix text is what makes repair succeed on these codes.

### 8.3 Recommendations (inputs to the S4 review and S5)

1. **Profile granularity is the main barrier for agents, and for people.** Common, harmless declarations are blocked because no fixture authored that exact value in that exact context:
   - initial values such as `flex-direction: row` and `display: block`;
   - the inert other-axis longhand of `gap` in a single-line container;
   - colour syntax keyed by formatting context, although colour does not depend on layout.

   Fix by proof, never by relaxing the rule. Add fixtures that author these values in each context. Key context only for properties whose algorithm depends on the context; colour value syntax is resolved independently of layout, so its rows should not carry a formatting-context facet. Both need a Judge ruling.
2. **Shorthand diagnostics must name the authored shorthand and its span.** Example: "`gap` sets `column-gap`, which is not proven in flex-column; write `row-gap`".
3. **Report all diagnostics in one pass.** An unsupported at-rule should not mask diagnostics for the rules inside it. Check the enclosed rules too, and report them as related diagnostics.
4. **The `@media` guarded fix deletes the enclosed rules.** Replace it with an unwrap edit, or with a manual fix that says to move the declarations out.
5. **Deduplicate identical per-target diagnostics** into one diagnostic that lists its targets.
6. **An unsupported value should list the supported alternatives in context.** For example, for `display: grid`: "use flex (row or column), or remove it to keep block flow".
