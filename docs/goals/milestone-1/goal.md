# Dragon CSS milestone 1: regular CSS, proven against Chrome on a Linux lane

> Scope note (2026-09-27, docs/decisions.md): the oracle lane is macOS-captured Chrome 145.0.7632.6 (darwin-arm64) plus the platform-free Dragon layout lane. The Linux lane workflow is written but not run.

## Objective

Build the first working, tested slice of Dragon CSS:
- support profiles (web and iOS);
- a TypeScript compiler that turns CSS plus an element tree into a per-element list of resolved native properties, for boxes, flex, colours and basic text (the same result later generates Swift that sets those properties directly);
- a Chrome capture harness;
- Dragon's own layout engine in TypeScript (block and flexbox for this milestone), with a fully specified input and no hidden defaults;
- a Linux lane that lays the resolved property list out with that engine and compares every box with Chrome, number by number;
- a side-by-side report.

A support-profile entry becomes `exact` only when its comparison test passes.

## Original Request

"Make a new project in the open source folder called dragon / dragon css. We're going to start working on this ability that other solutions don't have where we can easily use regular CSS that is tested really well across platforms (ideally as much CSS as possible)."

## Intake Summary

- **Input shape:** `existing_plan`. The design and testing plan are in `docs/research/`, especially `T025-styling-direction.md`, `T018-styling-design.md`, `testing-plan.md` and `css-support.md`.
- **Audience:** the owner, then tools that compile templates (Markless first).
- **Authority:** `requested`.
- **Proof type:** `test`.
- **Goal oracle:** `pnpm test` runs a corpus of box and flex fixtures through compile, Dragon layout and a Chrome comparison, and passes within 1 device pixel. The report shows each fixture side by side with per-node differences. Each support-profile entry marked `exact` names a fixture that passes.
- **Likely misfire:**
  - claiming support without a passing test;
  - building an iOS runtime before the Linux proof exists;
  - letting screenshots or AI judgement decide pass or fail;
  - quietly narrowing fixtures to make things pass.
- **Blind spots:**
  - the layout engine must take every value explicitly from the compiler, never assume a default;
  - text measurement (use the Ahem font for the layout corpus);
  - the TypeScript engine becomes the reference for native layout, so its arithmetic must be portable (Chrome's 1/64 px fixed point) and its cases exportable as shared vectors;
  - the Xcode licence is not accepted on the owner's Mac, which blocks simulator work;
  - licences for WPT and Ahem.

## Design principles (owner-approved 2026-09-26)

These are meant to remove pitfalls by design, so they cannot happen, instead of documenting them. The developer writes regular CSS once. Every platform-specific choice belongs to the compiler, which sees the whole app through semantic analysis. Anything it cannot decide is a build error with a fix, never a surprise on a device.

1. **Resolve every style for every state at build time.** Semantic analysis lists each component's elements, the finite set of classes each can have from state, and every condition: pressed, `ui-*` attributes, dark mode, width. The compiler resolves each element's final styles in each reachable state before the app runs.
2. **Generate the tests from the source.** The same analysis generates parity tests against Chrome for every component in every state, plus the largest text size and right-to-left. There is no untested state.
3. **The compiler owns platform choices:**
   - It picks native styled text or a view from context, and wraps loose text automatically.
   - It writes inherited text styles (font, colour and so on) onto every text node, so generated native code needs no inheritance.
   - It chooses per-platform border and shadow implementations, and sets `shadowPath` from known geometry.
   - It resolves `z-index` to sibling order.
   - It applies `:hover` only on devices that can hover.
4. **The web output comes from the same compiled result** when a native target is configured. The browser preview then shows what the phone gets, so developers can focus on one platform.
5. **Fonts are declared once and checked at build.** `@font-face` fonts are bundled and mapped per platform, and a font weight that doesn't exist in the font files fails the build.
6. **Platform defaults, not settings to remember:**
   - each screen's root is a scroll container that respects the notch and home-bar areas;
   - focused inputs move clear of the keyboard;
   - `100vh` means the visible screen.

**What milestone 1 covers from these:**
- **#1:** the compiler resolves styles per state for boxes, flex, colours and basic text.
- **#2:** the harness generates fixtures per component state.
- **#3:** inherited text styles are written onto text nodes in the property list, and loose text is wrapped.
- **#4:** Chrome renders both Dragon's own web output and the developer's original CSS. Both must produce the same boxes, so a Dragon bug cannot pass by being identical on web and native.
- **#5 and #6:** belong to the iOS milestone. Milestone 1 uses the Ahem test font.
- **The pitfalls synthesis** (`docs/research/pitfalls.md`) checks each principle against the real pitfall list, says what it removes, what it costs and what it cannot remove, and may refine these principles before the build starts.

## Goal Oracle

`pnpm test` is green. A layout corpus of at least 100 box and flex fixtures, passes the Chrome-vs-Dragon-layout comparison at 1 device pixel. The side-by-side report is generated. Profile entries flip to `exact` only through passing tests.

Lane scope (docs/decisions.md, 2026-09-27): the Chrome oracle is captured on macOS, and the layout engine is platform-free. A real Linux run needs owner approval of a runtime or CI push, and it is not required for milestone 1.

## Goal Kind

`existing_plan`

## Current Tranche

1. Validate the plan against the building blocks: css-tree with webref grammars, Playwright and Ahem (done, T001).
2. Then the profiles, compiler, Dragon layout engine, harness, Linux lane and report.
3. The iOS simulator lane is the next milestone. It stays blocked until the owner accepts the Xcode licence.

## Non-Negotiable Constraints

- **Follow AGENTS.md:** no claim without a test; numbers decide pass or fail; never loosen tolerances or skip tests.
- **Stay inside this repo** (`~/dev/open-source/dragon`). Read Markless and yuku; don't edit them.
- **No publishing, no pushes, no remotes** without an owner directive.
- **All Dragon code in this milestone is TypeScript,** including the layout engine. No Rust, no Taffy (owner, 2026-09-26: a partial engine built on someone else's assumptions cannot make flaws impossible by design).
- **Agents must work well with it.** The owner, 2026-09-26: "agents work really well with StyleX". So:
  - styles stay local to the element;
  - merging is predictable, with a warning on conflicts decided only by specificity;
  - diagnostics are typed and shaped as fixes, coming from the support profile.

  An optional typed-object input is decided by the agent evaluation, not assumed.

## Stop Rule

Stop only when a final audit proves the oracle.

## Canonical Board

`docs/goals/milestone-1/state.yaml`

## Run Command

```text
/goal Follow docs/goals/milestone-1/goal.md.
```
