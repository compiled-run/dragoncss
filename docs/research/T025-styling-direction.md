# T025: Styling direction for native (Judge)

Inputs read: goal.md and the 2026-09-26 owner rulings in state.yaml (real UIKit views first; `@markless/ui` headless on every platform; goal: give web developers a powerful way to build native apps), the T018-T024 receipts, T018-styling-design.md, T020-critique.json, T023-stylex.md, T024-styling-projects.md, with T015, T016 and T017 as evidence. Repo spot checks: `packages/headless/components/SPEC.md` (CSS defaults), `packages/headless/components/src/menu/menu.tsrx:832`, `src/drawer/drawer.tsrx:490-493`, `src/tour/scenarios/{basic,placed}.tsrx`, `website/document.tsrx:20`, `website/components/demos/ui/popover/share.tsrx`. No new web research; external claims are cited in T011-T024.

## 1. Verdict in plain words

**Yes, full browser CSS on native views is a losing battle. Restricted raw CSS is not, and it is the better developer experience.**

- Every system that runs the whole cascade on native views ships its own engine inside its own runtime (Lynx, NativeScript) or draws its own pixels (Blitz with Stylo). Every system that styles real native views from a React-style app cuts the selector model down to "styles come from the element itself" (StyleX with React Strict DOM, react-native-css with only the descendant combinator, T023, T024). None of them runs cross-component matching, `:has()` across components or top-layer semantics on UIKit. T018 tried to do all of that at build time, and T020's findings show where it breaks.
- The better developer experience is **not** a new styling language. Web developers asked for real CSS, dark mode that works, and loud errors instead of silent drops (T016: lack of CSS is a top-3 React Native pain point; NativeWind silent drops are a named complaint). So: keep writing raw CSS in `<style>`. On a native build, a selector may test only its own element, ancestors written in the same component, and app-wide conditions. Anything else is a build error with the file, the line and a fix. The rule fits in one sentence, and most well-written component CSS already follows it (section 3).
- **Would StyleX just work? No.** Its compiler is Babel (a community Rust port exists) and cannot read `.tsrx`. Its `props()` spreads a runtime object that Markless rejects at build. Its only native route is React Strict DOM: React plus React Native, styles resolved at run time in JavaScript, about 2x slower per `div` (unverified talk figure), and less than our first release covers (no `calc`, grid, `fixed`, keyframes or `when.*` markers on native). **Borrow its rule, not its package** (T023).
- **Does the restriction make native styling easy? No, and that should be said up front.** It removes selector matching, specificity across components and runtime `@layer` from the native problem. It does not remove CSS *value* semantics: inheritance, variables, `pointer-events`, `position: fixed`, transitions, trait-dependent colours and inline text. Those are still engine work. The restriction makes each of them *local and provable at build*, which is what turns T020's blockers into specifiable, testable pieces (section 4).

### The four options judged

| Option | Verdict | Why |
|---|---|---|
| 1. Full CSS cascade on native | **Reject** | T020 blocking 2 and majors 3, 5 and 9 are all consequences of reproducing browser matching and ancestry on a tree UIKit reparents. No precedent does this on native views without its own runtime. It would need a whole-app census for every ancestor, sibling and `:has()` compound, and it breaks when components are chosen at run time. |
| 2. Raw CSS in `<style>`, native builds restricted to a StyleX-like rule | **Adopt** | Keeps the web-like API and raw CSS (owner ruling). `@markless/ui` keeps its CSS and `@layer markless` unchanged: layer order among rules that match one element is a static sort at build. Web builds keep full CSS. Matches the one pattern the whole native ecosystem converged on. |
| 3. StyleX or style objects as the authoring model | **Reject as the model** | New authoring surface, not web-like. It would force every `@markless/ui` part to merge style props instead of `@layer`, for no gain on the web. The existing `style={{ ... }}` lowering stays as the inline, dynamic channel; nothing new is added. |
| 4. Tailwind as an optional front end | **Later, free** | Tailwind v4 emits plain CSS. Its utilities are own-element class rules, so they pass the rule by construction. `dark:` and `motion-safe:` are app-wide conditions. `group-*`, `peer-*`, `has-*` and `*:` variants compile only when they stay inside one component, and are build errors otherwise. There is no separate design. Ship it after the first release. |

## 2. The direction

### 2.1 The rule (native builds)

A style rule compiles for a native target only if every part of its selector is one of these:

1. **Own element.** Type, class, id, attributes (including the `ui-*` and ARIA attributes a `@markless/ui` part writes on itself), and state pseudo-classes: `:active`, `:focus`, `:focus-visible`, `:hover`, `:disabled`, `:checked`, `:not()`, `:is()`, `:where()`, `:dir()`. Classes forwarded to a part (`<popover.content class="tip">`) count as own-element: the compiler traces them statically.
2. **Same-component ancestor.** A descendant or child combinator whose ancestor part can only match elements written in this same `.tsrx` component. This is checked app-wide at build, so web behaviour is unchanged. On the device it is an inherited match flag on the logical (authored) tree. That handles nested instances and `{children}` exactly as the browser does, with no selector engine.
3. **App-wide conditions.** `@media` (size, orientation, colour scheme, reduced motion, contrast, pointer), `@media (os: ...)`, `@supports` answered per target, and `:root` / `html` compounds, which test the document component's root element (its class and attribute bindings are state-driven environment bits).
4. **Tokens on the root.** Custom properties that everything shares are declared on `:root` in the document component, the one component that renders `<html>`. Custom properties may also be declared and read inside one component, and a part's published `--ui-*` values are read on that part or under it.

Everything else is a native build error: sibling combinators, `:has()`, structural pseudo-classes, cross-component ancestors, `:root` outside the document component, unknown at-rules and any value outside the supported table. Same-component siblings, `:nth-child()` over a static list or one `@for`, and `:has()` with a template-fixed argument can be added later with the same inherited-flag machinery. They are not in the first release.

What stays hard, and is specified in section 4 rather than hidden: the computed-value pipeline (inheritance, variables, `inherit`/`initial`/`unset`), `pointer-events` hit testing, dynamic colours on layer paint, transitions, inline text and overlay placement.

### 2.2 Pseudocode

Document component: tokens, dark mode and a theme switch. The header row uses buttons, not `<select>` (T020 #9).

```tsx
import { state } from '@markless/core';

export default function Document({ children }: { readonly children?: unknown }) @{
  let theme = state<'system' | 'light' | 'dark'>('system');

  <html class="app" data-theme={theme}>
    <body>
      <nav class="schemes">
        <button class="scheme" aria-pressed={theme === 'system'} onClick={() => (theme = 'system')}>System</button>
        <button class="scheme" aria-pressed={theme === 'light'} onClick={() => (theme = 'light')}>Light</button>
        <button class="scheme" aria-pressed={theme === 'dark'} onClick={() => (theme = 'dark')}>Dark</button>
      </nav>
      {children}
    </body>
  </html>
  <style>
    :root {
      color-scheme: light dark;
      --surface: light-dark(#fff, #1c1c1e);
      --raised: light-dark(#f2f2f7, #2c2c2e);
      --ink: light-dark(#111, #f5f5f7);
      --accent: AccentColor;
      --space: 1rem;
    }
    :root[data-theme="light"] { color-scheme: light; }
    :root[data-theme="dark"]  { color-scheme: dark; }
    .app { background: var(--surface); color: var(--ink); }
    .scheme[aria-pressed="true"] { background: var(--accent); color: white; }
  </style>
}
```

On iOS, `color-scheme` on the root sets the window's interface style, and `light-dark()` becomes a dynamic `UIColor`. The root tokens form one app-wide table, so no ancestor walk is needed to read them.

A plain component: own element, same-component ancestor and an app-wide condition.

```tsx
import { state } from '@markless/core';

export function Card({ title, children }: { readonly title: string; readonly children?: unknown }) @{
  let open = state(false);

  <section class="card" data-state={open ? 'open' : 'closed'}>
    <header class="head">
      <h2 class="title">{title}</h2>
      <button class="toggle" aria-expanded={open} onClick={() => (open = !open)}>Details</button>
    </header>
    <div class="body" hidden={!open}>{children}</div>
  </section>
  <style>
    .card { display: flex; flex-direction: column; gap: 8px; padding: var(--space); border-radius: 12px; background: var(--raised); }
    .card[data-state="open"] { outline: 2px solid var(--accent); }
    .card[data-state="open"] .title { color: var(--accent); }
    .toggle { transition: opacity 120ms; }
    .toggle:active { opacity: 0.6; }
    :root[data-theme="dark"] .card { box-shadow: none; }
  </style>
}
```

A `@markless/ui` override: the family CSS is unchanged, and the consumer's rule wins over `@layer markless` without `!important`.

```tsx
import { popover } from '@markless/ui';

export function Help() @{
  <popover.root>
    <popover.trigger class="ask">Why?</popover.trigger>
    <popover.content class="tip">
      <popover.title class="tip-title">Receipt retention</popover.title>
      <p class="tip-text">Receipts are kept for seven years.</p>
    </popover.content>
  </popover.root>
  <style>
    .tip { position-area: inline-end; padding: 12px; border-radius: 10px; background: var(--raised); }
    .tip[ui-open] { box-shadow: 0 8px 24px rgb(0 0 0 / 0.2); }
    .tip .tip-text { color: color-mix(in oklab, var(--ink) 70%, transparent); }
  </style>
}
```

`.tip` reaches the part by statically forwarded class, and `[ui-open]` is an attribute the part writes on itself. Both are own-element tests. Ordering against the family default (`[overlay] { position-area: block-end }` in `@layer markless`) is a build-time sort: layer, then specificity, then source order. The winning `position-area` becomes the placement record that the iOS overlay backend reads (T018 section 3.7). Anchor positioning and the overlay backend are still the second release.

### 2.3 Build errors (exact text)

```text
error MARKLESS_CSS_CROSS_COMPONENT  src/components/row.tsrx:22:3
  ".list" in ".list .row" can match an element in another component (src/routes/inbox.tsrx:9).
    22 |   .list .row { padding: 12px 16px; }
       |   ^^^^^^^^^^
  why: on ios a selector may look only at its own element, ancestors written in this file, and the app root.
  fix: pass a class through props (<Row class="in-list" />) and style ".in-list", or move this rule into src/routes/inbox.tsrx.

error MARKLESS_CSS_ROOT_OUTSIDE_DOCUMENT  src/components/card.tsrx:3:5
  ":root" is used in a component that does not render <html>.
    3 |   :root { --card-gap: 8px; }
      |   ^^^^^
  why: this rule's scope never reaches the document root on web, and on ios app-wide tokens live only on the root.
  fix: declare the token on ".card" if only this component uses it, or move it to the document component's :root.

error MARKLESS_CSS_SELECTOR_UNSUPPORTED  src/routes/settings.tsrx:40:3
  ":has(input:checked)" is not supported on ios in this release.
    40 |   .option:has(input:checked) { border-color: var(--accent); }
       |          ^^^^^^^^^^^^^^^^^^^
  why: native styles come from an element's own state and ancestors; a selector that looks at descendants needs a runtime matcher.
  fix: put the state on the element itself: <label class="option" data-checked={checked}> and style ".option[data-checked]".

error MARKLESS_CSS_VAR_IN_SHORTHAND  src/components/tile.tsrx:12:5
  "margin: var(--gap)" cannot be expanded for ios: --gap is set inline from state, so its value is unknown at build.
    12 |   .tile { margin: var(--gap); }
       |           ^^^^^^^^^^^^^^^^^
  why: a shorthand holding var() is split into longhands only after the variable's value is known.
  fix: write the longhands (margin-block: var(--gap); margin-inline: var(--gap);), or give --gap only fixed values in <style>.
```

These use the existing `CompilerDiagnostic` shape. Errors cannot be silenced with `markless-allow`, and they fire only for targets named in the build or dev command, unless the owner chooses otherwise (decision 2).

## 3. What the rule costs our own CSS (T017 data, heuristic)

- **`@markless/ui`**: 73 rules. Only the nested-menu rule and one test-scenario rule break the rule:
  - `menu.tsrx:832` `[role^="menuitem"] [role="menu"]` places submenus. Menubar items also carry `role="menuitem"` from another file, so this is a real cross-component ancestor. Fix: the nested menu content writes its own nesting attribute and the rule keys off that. The attribute name follows `packages/headless/components/SPEC.md` and is an owner question if it falls outside the established set; the implementation goal must not invent it.
  - `tour/scenarios/{basic,placed}.tsrx` `[data-testid="toolbar"] button` is a test scenario. Put a class on the button.
  - `drawer.tsrx:490-493` `:dir(rtl)` is an own-element condition. It passes.
  Everything else is own-attribute CSS inside `@layer`. The family CSS model survives intact.
- **Website hand-written `.tsrx`**: 153 of 169 cross-component flags are `html.dark` / `html[data-*]` root conditions, which are allowed. The other 16 need forwarded classes. Where the 517 descendant combinators have their ancestor in the same file, which T017's heuristic suggests is most of them, they compile.
- **Generated playground**: its 265 `:has()` rules and 13 sibling rules are build errors in the first release. That is the largest casualty, and it is tool-emitted CSS, so the generator can emit own-element state instead.
- These counts are heuristic, not a compiler run (T020 #1). The implementation goal's first measurement is the native-profile checker run over the corpus.

## 4. T020 findings under the chosen direction

"Eliminated" means the restriction makes the problem cannot arise. "Still needs solving" gives the minimal correct answer. "Build error" means the construct is refused with a fix instead of being approximated.

| # | Finding | Under option 2 | Minimal correct answer |
|---|---|---|---|
| 1 (blocking) | Coverage numbers overstate | **Still needs solving, but is now measurable.** | The rule is mechanical, so coverage becomes "run the native checker over the corpus" and count exact / approximated / no-effect / unsupported / unknown. Until then every percentage is labelled a heuristic upper bound. Known gaps are named: `ch`/`lh` units, SVG `fill`/`stroke` (errors until an `<svg>` story exists), and the 5 unknown website at-rules (unknown at-rules are native build errors). The page-adoption proxy measures neither runnable apps nor share of CSS supported. |
| 2 (blocking) | Cascade, inheritance and computed values unspecified | **Half eliminated.** Selector matching, specificity across components and `@layer` become a per-element static sort at build, with no runtime cascade. **Still needs solving:** value computation. | One pipeline on the **logical tree**: (a) cascaded value from the build-sorted list, with inline `style` bindings above normal author rules; (b) custom properties computed **at the declaring element**, `var()` substituted there with that element's inputs, cycles become guaranteed-invalid, then the computed token list inherits (so parent `--a: red; --b: var(--a)` with child `--a: blue` gives the child `color: var(--b)` = red); (c) normal inherited properties (`color`, `font-*`, `line-height`, `visibility`, `pointer-events`, `direction`) inherit their computed values; (d) `initial`, `inherit` and `unset` supported, `revert`/`revert-layer` errors; (e) invalid at computed-value time behaves as `unset`. Root tokens declared only on `:root` are folded into one app-wide environment table, so there is no walk for the common case. Shorthands holding `var()` are pre-expanded when every value of that variable is known at build, and are a build error otherwise. Conformance examples: the `--a`/`--b` case, `inherit` through a part, an inline `--x` from state, and a cycle. |
| 3 | Text coalescing chosen by tag, not display | **Mostly eliminated.** An element's `display` depends only on its own table, so "is this an inline formatting context in every state?" is decidable per element at build. | Coalesce into attributed runs only elements whose computed `display` is `inline` in **every** reachable state of their own and their ancestors' tables. The T018 Tab example (`display: flex` on the anchor) stays a box with two child views. Conditional `display` that flips between inline and a box is a build error. Padding, border and radius on inline runs are **errors**, not warnings, until rounded run backgrounds exist. |
| 4 | `contain` and `content-visibility` on the no-effect list | **Still needs solving (value semantics).** | Remove both from the list. `contain: paint` maps to clipping, and other `contain` values and `content-visibility` are build errors in the first release. `touch-action` and `user-select: none` are behaviour, decided per context. The list is labelled "proposed" until each entry has an omission test. |
| 5 | `position: fixed` conflated with the top layer; logical vs render ancestry | **Selector half eliminated:** selectors never consult render ancestry, because they resolve on the logical tree at build. **Positioning half becomes a build error**, with a narrow remainder. | `position: fixed` outside a `@markless/ui` overlay part is a build error in the first release. Showing something above the page is the family's behaviour (popover, dialog) through the per-platform overlay backend, not a CSS side effect. Reparented overlay views keep their logical parent for inheritance, variables, match flags, events and handles (the section 4 #2 pipeline). A transformed ancestor of a fixed element is an error when fixed arrives later. |
| 6 | `pointer-events` is not `isUserInteractionEnabled` | **Still needs solving (value semantics).** | Inherited property via the #2 pipeline. `none` means the view's `hitTest` skips itself but still tests its subviews, so a `pointer-events: auto` child stays tappable. Focus and accessibility are untouched and kept separate from `disabled`/`inert`. SVG-only values are errors. Conformance: wrapper `none`, child `auto`. |
| 7 | `transition: all`, layout transitions, zero duration | **Partly eliminated:** the non-inherited properties an element can take are closed by its own table. **Still needs solving** for inherited and variable changes. | Build error for `transition: all` in the first release ("list the properties"). For listed properties the evaluator diffs **computed** values, so a change from a class, an inherited value or a variable animates alike. Layout properties stay errors (T018). Spec events: duration 0 with delay 0 starts no transition and fires no `transitionend`; reduced motion does not promise `transitionend`; cancellation fires `transitioncancel`. |
| 8 | Dynamic colours on `CGColor` layers; `color-mix` spaces | **Still needs solving (value semantics).** | Keep colour expressions in the table. Properties backed by `UIColor` (background, text, tint) keep dynamic providers. Layer paint (borders on shape layers, shadows, gradients) and animation endpoints re-resolve on trait changes. `color-mix()` accepts `srgb`, `oklab` and `oklch` with the default hue method; other spaces and hue methods are build errors. The root-token table (#2) makes the set of trait-dependent colours finite and known. |
| 9 | Scoped `:root` in Card; `<select>` in the theme example; font shorthand resets the cap | **Build error / fixed in examples.** | `:root` outside the document component is `MARKLESS_CSS_ROOT_OUTSIDE_DOCUMENT` (section 2.3). Theme example uses buttons (section 2.2). Dynamic Type example: put `font-size: min(1rem, 22px)` **after** the `font:` shorthand inside the iOS branch, and note that `em` scales from the inherited font size. |
| 10 | Conflicting report recommendations | **Still needs solving (editing).** | One authoritative support table for the restricted rule. Replace the older profile rows in place. The shell becomes an optional per-screen fallback. Name the simulator proof separately from the first styling release. |
| 11 | Payload-script claim over-broad | **Unaffected by this decision; still needs solving (editing).** | Qualify it with the inspected conditions (payload present, browser triggers, delta classification). Native delivery is graph and state data plus newly lowered native view records, without HTML script wrappers. |
| 12 | Decision menu bundles choices and misstates budgets | **Replaced.** | The new menu in section 5, plus the layout-engine choice kept with its real budgets: Taffy adds at most 1 MB of download *over Yoga*, lays out within 1.25x Yoga's time, owner may set other numbers. `@media (os:)` is offered alongside conditional classes and `@supports`. |
| 13 (minor) | Dev-loop promises unmeasured | **Still needs solving (wording).** | Label "18 ms" illustrative. State and scroll are kept only for style updates that do not change an element's box structure (for example text coalescing or `display`); otherwise that node is rebuilt. "Save to source" applies only to a single authored longhand, not to generated or shared values. |

Honest remainder: findings 2, 4, 6, 7 and 8 are CSS value semantics, and T023 is right that no selector restriction removes them. What the restriction buys is that each becomes local, finite and testable against a browser. That is why a conformance suite can close them, where under option 1 it could not.

## 5. New project or not

**Not now.** Build it as a package inside the Markless repository, with a framework-neutral boundary: CSS text plus an element-tree description in, a versioned style table out. Swift and Kotlin evaluators depend only on the table, and conformance cases are plain data. Reuse the yuku CSS scanner for structure, lightningcss for typed values and Taffy (or Yoga) for layout (T024). The restriction makes the engine smaller, so it is even less worth a separate project today.

**Split it out when all three hold:**

1. The table format has not changed for one release.
2. The conformance suite covers T020 #2, #6, #7 and #8 on web and iOS.
3. A second consumer uses it, such as frameless's React Native target or an outside project.

## 6. Owner decisions

I am asking you to settle four styling choices for native apps; I recommend yes, yes, no and no.

**Keep CSS, with one rule on phones.** Keep writing normal CSS, but on an iPhone build a style may only look at its own element, parents in the same file, and app-wide things like dark mode; anything else stops the build with a fix. I recommend yes, because running every web selector on native views is where every project that tried has failed, while this rule keeps the CSS web developers know and never silently drops a style.

**Show phone errors while working on the web.** When an app lists iPhone as a target, show the phone-only style errors in the editor and the web dev overlay too, but only block the iPhone build. I recommend yes, because finding a problem weeks later, when you first build for the phone, is the worst experience, and a web-only app sees nothing.

**Add StyleX-style style objects.** Add a second way to write styles as JavaScript objects, or keep raw CSS in `<style>` plus today's inline `style={{ ... }}`. I recommend no, because StyleX itself cannot read our files, and a second styling model would split docs, examples and `@markless/ui` for no gain on the web.

**Make CSS-for-native its own project.** Start a separate project now, or build it as a package inside Markless and split it out later. I recommend inside Markless, because only Markless would use it today, the design is still moving, and one repository means one test run covers the engine and the app.

Researched defaults (details above): Tailwind comes after the first release as plain CSS through the same checker; tokens live on the document component's `:root`; `:has()`, sibling selectors and `transition: all` are errors in the first release; the layout-engine and text-size choices from the earlier menu stay open as they were.

## 7. What the stopped revision (T021) should do now

Resume T021 with a changed objective, the same three files and a different spine:

1. **T018-styling-design.md**: replace sections 1 and 3.1 with the restricted rule from 2.1 above. Keep the tables, evaluator, layout, overlay and diagnostics architecture. Replace the cross-component census and the second-release cross-component matching with "build error, forward a class". Write the computed-value pipeline (4 #2) as its own section with the four conformance examples. Apply the per-finding answers in section 4 in place, fix the examples (theme with buttons, Dynamic Type order), relabel all coverage as heuristic upper bounds with the named gaps, and add the `@markless/ui` casualty list from section 3.
2. **report.md**: one authoritative native styling support table built from the rule. Replace superseded rows in place (T020 #10). Fix the payload-script wording (#11). Add a short "StyleX and new-project answers" subsection citing T023 and T024. Update "Critique resolution" with one line per T020 finding matching section 4's verdicts.
3. **decisions.md**: the four choices in section 6 plus the layout-engine choice with its real budgets, under 250 words, owner-menu format, no task IDs.

T022 then re-reviews the revision against the T020 findings *and* this direction.

```json
{
  "goalbuddy_receipt_v1": {
    "result": "done",
    "task_id": "T025",
    "board_path": "/Users/jacksm5pro/dev/open-source/markless/docs/goals/native-targets-api/state.yaml",
    "decision": "approved",
    "full_outcome_complete": false,
    "rationale": "Full cascade on native views is a losing battle: every precedent either ships its own runtime or cuts selectors to the element itself, and T020's blockers come from reproducing browser matching and ancestry. Adopt option 2: raw CSS in <style>; native builds accept own-element, same-component-ancestor and app-root selectors, root tokens, all else a build error with a fix. @markless/ui CSS and @layer survive (only the nested-menu rule changes). StyleX: borrow the rule, not the package. Tailwind later as plain CSS. Value semantics (T020 #2,4,6,7,8) still need specifying; each has a minimal answer. Package inside Markless, split later. Approves resuming T021 with this spine.",
    "worker_package": {
      "objective": "Revise the native styling design, report and decisions to the T025 direction (restricted raw CSS on native builds) and resolve every T020 finding per notes/T025-styling-direction.md section 4. Workflow guidance: .ruler/skills/markless-spec-maintenance/spec.md",
      "allowed_files": [
        "docs/goals/native-targets-api/notes/T018-styling-design.md",
        "docs/goals/native-targets-api/notes/report.md",
        "docs/goals/native-targets-api/notes/decisions.md"
      ],
      "verify": [
        "test -s docs/goals/native-targets-api/notes/report.md",
        "node -e \"const s=require('fs').readFileSync('docs/goals/native-targets-api/notes/report.md','utf8');const secs=s.split(/^## /m).slice(1);const bad=secs.filter(x=>/^Research:/.test(x)&&!x.includes(String.fromCharCode(96).repeat(3)));if(bad.length||!/^## Critique resolution/m.test(s)||s.includes('<style>{'+String.fromCharCode(96))){console.error('report check failed');process.exit(1)}\"",
        "node -e \"const s=require('fs').readFileSync('docs/goals/native-targets-api/notes/decisions.md','utf8');const w=s.split(/\\s+/).filter(Boolean).length;if(w>250||/^\\s*[-*] /m.test(s)||/\\bT0\\d\\d\\b/.test(s)){console.error('decisions check failed',w);process.exit(1)}\"",
        "node -e \"const fs=require('fs');for(const f of ['report.md','decisions.md','T018-styling-design.md']){if(/\\bislands?\\b/i.test(fs.readFileSync('docs/goals/native-targets-api/notes/'+f,'utf8'))){console.error('forbidden wording',f);process.exit(1)}}\"",
        "node -e \"const s=require('fs').readFileSync('docs/goals/native-targets-api/notes/T018-styling-design.md','utf8');for(const k of ['MARKLESS_CSS_CROSS_COMPONENT','MARKLESS_CSS_ROOT_OUTSIDE_DOCUMENT','logical tree','heuristic upper bound','--b: var(--a)']){if(!s.includes(k)){console.error('T018 missing',k);process.exit(1)}}\"",
        "pnpm run typecheck",
        "pnpm ci:local --fast"
      ],
      "stop_if": [
        "Need files outside allowed_files.",
        "A finding or the nested-menu attribute name needs an owner decision; record it under Open questions instead of guessing.",
        "typecheck or ci:local --fast fails on something this docs-only change did not touch: record the failing command as pre-existing and stop, do not fix.",
        "Verification fails twice."
      ]
    },
    "evidence": [
      "docs/goals/native-targets-api/notes/T025-styling-direction.md",
      "notes/T020-critique.json",
      "notes/T023-stylex.md",
      "notes/T024-styling-projects.md",
      "notes/T017-css-corpus.md",
      "notes/T018-styling-design.md",
      "packages/headless/components/src/menu/menu.tsrx:832",
      "packages/headless/components/src/drawer/drawer.tsrx:490-493",
      "packages/headless/components/src/tour/scenarios/basic.tsrx:16",
      "packages/headless/components/SPEC.md (CSS defaults)",
      "website/document.tsrx:20",
      "website/components/demos/ui/popover/share.tsrx"
    ],
    "subgoal_contract": null,
    "parallel_safety": null,
    "blocked_tasks": [],
    "missing_evidence": [
      "Native-profile checker run over the corpus (exact/approximated/no-effect/unsupported/unknown) - implementation-stage.",
      "Browser-oracle conformance for the value pipeline (#2, #6, #7, #8) - implementation-stage.",
      "Taffy vs Yoga size and layout time - unchanged, implementation-stage."
    ],
    "required_board_updates": [
      "Record T025 done, decision approved, evidence notes/T025-styling-direction.md.",
      "Unblock T021 with the worker_package above (new objective, same allowed_files, added T018 keyword check, typecheck and ci:local --fast).",
      "Retarget T022 to re-review against every T020 finding and the T025 direction.",
      "Record owner questions: restricted rule on native; errors shown on web when iPhone is a target; no style-object model; package inside Markless (four decisions in T025 section 6).",
      "Queue for the implementation goal: nested-menu own-attribute (name per headless SPEC or owner), native-profile corpus run, conformance suite."
    ]
  }
}
```
