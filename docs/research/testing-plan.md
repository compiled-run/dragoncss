# Testing plan: proving CSS works the same on web and on phones, without a human doing QA

Judge note for the native-targets goal, 2026-09-26. Built from the testing landscape research (`T035-testing-landscape.md`), the repo test-infrastructure survey (`T036-test-infra.md`), the support tables (`css-support.md`, `css-support-profile.draft.json`) and the guardrail design (`T030-agent-guardrails.md`). Research only: nothing here exists yet, and every command and file name below is a proposal.

New facts since those notes: `compiled-run/markless` is public (checked with `gh api` today), so standard GitHub runners, macOS included, cost nothing; concurrency caps still apply. The owner expects the CSS compiler to become its own project, working name **dragon** (an npm name the owner holds): a build-time compiler in TypeScript on top of yuku, small Swift and Kotlin runtimes that apply style tables, and Taffy for layout. Markless consumes it. This replaces the earlier "build the styling package inside Markless first" default in `css-support.md`.

## 1. Plain-words summary

**What proves parity.** Numbers, not pictures. For every test page (a "fixture"), headless Chrome records where every box landed and what every style resolved to. The phone renders the same fixture and writes down the same things: each view's frame and every property the Swift runtime actually set. A program compares the two lists, node by node, with a written tolerance. If they match, the row in the support list that the fixture covers is proven for that platform. Pictures are still produced, side by side with a heatmap, but only as evidence a person or agent can look at after the numbers have failed. Pictures never decide pass or fail, and neither does an AI model.

**Why not screenshots as the gate.** Web and iPhone text, anti-aliasing and shadow blur differ by design, so a web-versus-phone pixel diff is never zero. The research shows loose screenshot thresholds hide exactly the layout shifts this suite exists to catch, and the best vision model found only 40.7% of single-CSS-property differences in a May 2026 benchmark. Pixel comparison is used only where it is reliable: two renders on the *same* renderer (reftests, regression goldens).

**What runs where and when.**

- Every pull request, on Linux (free, fast, no flake from devices): the support-list check (unsupported CSS is a build error), the Chrome capture, and a Linux run that feeds the compiled style table into Taffy and compares its boxes with Chrome's. This catches most bugs, because iOS and Android both lay out with Taffy: if Taffy on Linux gets the right boxes, a phone mismatch can only come from text measurement or from copying boxes onto views.
- Pull requests that touch the Swift runtime, the compiler's native output or the support list, plus every night: the iPhone simulator run on a macOS runner, which produces the numeric comparison and the side-by-side report.
- Nightly: the full fixture set, translated web-platform-tests with a published pass rate, the accessibility comparison, interaction scripts (press, dark mode, text size, rotation, keyboard), and a harness self-test that plants known bugs and checks they are caught.

**What a human still does.** Approves any new tolerance or baseline image (agents may not loosen a check). Approves promoting or demoting a released support-list row. Reviews translated web-platform-tests once when they are imported. Approves email client screenshots if a paid email rendering service is bought. Glances at the side-by-side report before a release. Nothing else is routine human QA.

## 2. The layers (oracles), cheapest and most trusted first

Each layer answers a question the one before cannot. The order also gives a deterministic "where is the bug" answer (section 4.3).

| # | Layer | Runs on | Catches | Misses | Flake | Evidence |
|---|---|---|---|---|---|---|
| 0 | Support-list build errors | Linux, every PR | CSS a target does not support, with file, line, fix | Wrong implementations of supported CSS | None | T030 section 3.4; `css-support.md` "Agent guardrails" |
| 1 | Chrome capture (geometry + computed values) | Linux, every PR | Produces the expected numbers for every later layer | Nothing by itself; it is the reference | None with pinned flags | Taffy gentest (1,548 fixtures), Yoga gentest (T035 2.1) |
| 2 | Linux Taffy lane | Linux, every PR | CSS-to-Taffy mapping, cascade, value resolution, `calc`, percentages | Text with real fonts, paint, view application | None with Ahem | T035 2.1 "Implication for Markless" |
| 3 | Simulator numeric lane | macOS, PR when native code changes + nightly | Text measurement adapter, point/pixel rounding, view nesting, clipping, wrong or missing applied properties | Whether UIKit draws a property as expected | Low (simulator boot) | T035 2.2, 4 Layer 2; T036 section 6 (`hostNodeId`) |
| 4 | Same-renderer reftests + translated WPT subset | macOS, same trigger; full set nightly | Paint: radius, borders, backgrounds, gradients | Bugs shared by test and reference | Low, timing-sensitive | WPT reftest rules; Servo, Blitz, Ladybird (T035 2.3) |
| 5 | Side-by-side web vs iOS images + heatmap | macOS, nightly and on failures | Evidence for people and agents | Not a gate | n/a | Lynx-vello pattern (T035 2.3) |
| 6 | Accessibility-tree comparison | Linux + macOS, nightly | Roles, names, reading order, clipped text at large text sizes | Visuals | Low | Playwright ARIA snapshots, `performAccessibilityAudit` (T035 2.7) |
| 7 | Interaction scripts | macOS, nightly | Press states, dark mode, text size, rotation, keyboard | Fine paint detail | Highest | Maestro/XCUITest (T035 2.4, 2.6) |
| E | Email lane | Linux per PR; paid rendering nightly or per release | Unsupported email CSS, output HTML drift, client regressions | Classic Outlook locally (Word engine cannot run on Linux) | None static; paid lane medium | caniemail, Mailpit, Litmus/Email on Acid (T035 2.8) |
| S | Harness self-test with planted bugs | Linux + macOS, nightly | A harness that silently stopped catching bugs | n/a | None | Inference; mutation-testing practice |

### Layer 0: support-list build errors

The per-target support profile (T030) is the only source of truth. Every CSS property, value, unit, function, selector and at-rule on iOS and Android defaults to "unsupported". The compiler fails the build with the file, line, reason and a fix. Every `unsupported` row needs a compile fixture that expects that exact diagnostic, so the error text itself is tested. This is already designed; the plan only adds that the profile checker also fails CI when a non-`unsupported` row names a test id that does not exist or is red ("no claim without a passing test").

### Layer 1: Chrome capture

Chrome for Testing, pinned by version, launched with `--headless --disable-gpu --force-device-scale-factor=1 --force-color-profile=srgb --font-render-hinting=none --disable-lcd-text --hide-scrollbars` (flags from Taffy, Yoga, Argos and chrome-launcher docs, T035 2.6). For each fixture node it records:

- geometry: border box, padding box, content box, scroll size (Taffy's helper uses `getBoundingClientRect` plus `offset*`, `scrollWidth`);
- computed values: a fixed list driven by the profile, read with `getComputedStyle` (`background-color`, `border-*-width`, `border-*-radius`, `opacity`, `color`, `font-size`, `font-weight`, `line-height`, `transform` and so on), normalised (colours to sRGB floats, lengths to px).

Two font modes, never mixed in one fixture:

- **Layout fixtures use Ahem**, the WPT test font where every glyph is a 1em square, with `font-size: 10px; line-height: 1`. Text width becomes arithmetic, so text measurement is taken out of layout tests. Taffy and Yoga both do this.
- **Text fixtures use real bundled fonts** (the same font files shipped to web and iOS), with tolerances measured per fixture (section 6).

Output is `expected/<fixture>.web.json`, committed and regenerated only by an explicit command, like Taffy's gentest. A Chrome upgrade regenerates it in the same change, with the diff reviewed. WebKit is already cached in Markless CI (T036 section 4); capture it as a second, informational web column for text fixtures, because iOS text is closer to WebKit. Chrome stays the reference because Taffy's own corpus is Chrome-generated.

Reuse: the capture walk copies `inventoryCandidates` in `packages/analyzer/src/playwright.ts` (one `evaluateAll` over every element). If dragon is its own repo, the capture script lives in dragon; Markless reuses the analyzer probe for its integration lane.

### Layer 2: Linux Taffy lane

The dragon compiler turns the fixture's CSS into the same style table the phone would receive. A small program on the pinned Taffy revision (the same revision the iOS xcframework links) builds a Taffy tree from that table, measures text with an Ahem function (width = characters × font size), lays out at the fixture's viewport, and writes `actual/<fixture>.taffy.json`. Compare with Chrome: exact in Taffy's rounded mode, or within 0.01 px unrounded.

This lane is what makes the per-PR gate cheap. Researched default: ship the Taffy runner as a prebuilt WebAssembly build so Node runs it with no Rust toolchain for contributors; the Rust source and revision pin live next to the xcframework build. It also re-runs Taffy's own Chrome-generated fixtures through dragon's table format (section 5).

### Layer 3: simulator numeric lane

The real Swift runtime, on one pinned simulator model and iOS runtime, on arm64 macOS, renders each fixture inside an XCTest host app (Swift Testing, one parameterised test over the fixture list; T036 section 7 memory already chose this). Animations off. After layout settles, the runtime writes a debug-only dump:

```json
{
  "fixture": "flex/row-gap-padding",
  "device": { "model": "iPhone 17", "runtime": "iOS 27.0", "scale": 3 },
  "nodes": {
    "n3": {
      "frame": { "x": 20, "y": 20, "w": 120, "h": 40 },
      "applied": {
        "backgroundColor": [0.2, 0.4, 1.0, 1.0],
        "layer.cornerRadius": 8,
        "layer.borderWidth": 2,
        "alpha": 1.0,
        "font": { "family": "Ahem", "pointSize": 10, "weight": 400 }
      },
      "source": { "table": "Card.css", "rule": 2 }
    }
  }
}
```

Nodes are joined to the web capture by the compiler's node id: the compiler gives every element a stable id; web test builds carry it as an attribute, and the Swift runtime already addresses views by `hostNodeId` (T036 section 6, `MarklessNativeRuntime.swift`). No id means the fixture fails, never "skip unmatched".

Comparison: frames in points within one device pixel (1/3 pt on a 3x device) for Ahem fixtures; applied properties exact after normalisation, or per the profile row's stated caveat; real-font text fixtures per their measured tolerance. The dump is written by the runtime's own applier, so it reports what was set, not what the developer intended; pixels are covered by layer 4.

Markless precedent: fake-DOM tests missed 11 bugs, so a fake UIKit tree is not proof. This lane must run real UIKit in a real simulator.

### Layer 4: same-renderer reftests and a translated WPT subset

For paint rows (radius, borders, backgrounds, gradients, and later shadows), each fixture has a reference written with simpler primitives that should look identical (for example a `border-radius` box against a pre-clipped shape). Both render on the *same* simulator, so font and anti-aliasing noise cancels. Compared with pixelmatch or odiff using a WPT-style per-fixture "fuzzy" pair (maximum channel difference, count of differing pixels), written in the fixture file.

Plus a curated subset of WPT reftests from `css-flexbox`, `css-grid`, `css-box`, `css-backgrounds` and `css-values`, only those whose every feature is in the iOS profile, translated into dragon fixtures. A per-target expectations file (Servo's model) lists each imported test as `PASS` or `FAIL` with a reason and issue link. An unexpected result either way fails CI, so an unexpected pass forces the file to be updated. The pass count is published per night as a trend (for example "iOS: 412 / 530 imported css-flexbox tests").

### Layer 5: side-by-side images (evidence only)

See section 3. Cross-platform pixel scores are recorded as trends. The one exception, opt-in per fixture with owner-approved thresholds: text-free, paint-only fixtures where a measured perceptual score (FLIP or pixelmatch) is stable across 20 runs.

### Layer 6: accessibility-tree compare

Both sides emit a normalised tree (role, name, state, order): Playwright `toMatchAriaSnapshot` style on web, the runtime's accessibility elements on iOS. Compared per fixture. On iOS also run `performAccessibilityAudit()` for the `textClipped` and `dynamicType` categories, the only audits that bear directly on CSS (T035 2.7). No known project compares web and native accessibility trees automatically; this is feasible because dragon/Markless own both emitters.

### Layer 7: interaction scripts

Each script applies the same change on both sides, then re-runs the layer 3 comparison. Numbers remain the oracle.

| Interaction | Web side | iOS side | Checks |
|---|---|---|---|
| Press | Playwright `mouse.down` on node (`:active` styles) | XCUITest press-and-hold, dump while held | Pressed-state properties |
| Dark mode | `emulateMedia({ colorScheme: 'dark' })` | `simctl ui <udid> appearance dark` (timeout + one retry; SIGKILL seen on a macOS 26 runner) | `light-dark()` and media-query values re-resolved |
| Text size | Root font size scaled by the same factor the profile maps `rem` to | Content size category set (`simctl ui ... content_size` is **unverified**; fall back to launch argument `-UIPreferredContentSizeCategoryName`) | `rem` sizes and resulting reflow; `textClipped` audit |
| Rotation | Viewport swapped | `XCUIDevice.shared.orientation` | Width media queries, safe areas, reflow |
| Keyboard | Viewport height reduced by the recorded keyboard height | Tap a text field, dump with keyboard shown | Safe-area and inset handling; bottom-anchored layout |

These are the flakiest tests (T035: Android emulator tests 25% flaky versus 1.7% overall). They run nightly, never gate PRs at first, and get no test retries (boot retry only).

### Email lane

Per PR on Linux: the email profile check (layer 0), text snapshots of the generated HTML, and a caniemail-backed static score (Mailpit's HTML check, 175+ checks, API usable in CI). Nightly or per release, only if the owner funds it: a rendering service (Email on Acid lists API access from about $99/month, Litmus about $500/month; both **unverified** third-party prices) screenshots the client list, and each client is compared with *its own* last approved image. Cross-client pixel comparison is meaningless. A human approves new client images.

### Harness self-test (planted bugs)

To trust "no human QA", the suite has to prove it can still catch bugs. Nightly, a script applies a fixed list of planted defects to a scratch build (padding mapped to margin, radius off by one point, `gap` ignored, colour channels swapped, `rem` ignoring text size, Taffy rounding switched off), runs the lanes, and fails if any defect survives or is blamed on the wrong layer. This is the cheapest answer to "how do we know green means correct".

## 3. The side-by-side artifact

Every run of layers 3 to 7 writes `parity-report/`:

- `index.html`: one row per fixture, failures first, filterable by target, layer and profile row. Each row shows four panels: **web screenshot | iOS screenshot | heatmap | per-node numeric diff table**. Clicking a node in the table outlines that node in both screenshots (the frames come from the dumps, so the outline is exact). A toggle overlays Chrome's boxes on the iOS image.
- Heatmap: pixelmatch diff image by default, FLIP map for paint fixtures; screenshots are compared after scaling both to points. Label: "evidence, not a verdict".
- `report.json`: every failure in the agent format (section 4.1). The HTML is generated from this file, so the two cannot disagree.
- `summary.md`: counts per layer, the WPT pass rate, newly failing and newly passing fixtures, quarantined tests with expiry dates.

Publishing:

- CI artifact on every run (`actions/upload-artifact`, kept 14 days), uploaded even when the job fails (the VoiceOver lane already does this, T036 section 5).
- PR comment: one comment per PR, edited in place, holding `summary.md` plus a link to the artifact. Because the repo is public and takes fork PRs, the comment is posted by a separate `workflow_run` job that only reads the artifact. Never run PR code under `pull_request_target`.
- Nightly: the report for `main` published to GitHub Pages with pass-rate history, so a regression has a date.

## 4. The agent loop

### 4.1 The failure report an agent reads

Numbers first, pictures last. One entry per failing node and property:

```jsonc
{
  "reportVersion": 1,
  "run": { "commit": "abc123", "lane": "ios-sim", "device": "iPhone 17 / iOS 27.0 / 3x", "chrome": "142.0.7444.0", "taffy": "0.9.1@rev" },
  "failures": [
    {
      "fixture": "flex/row-gap-padding",
      "fixtureFile": "fixtures/flex/row-gap-padding.html",
      "layer": "simulator-numeric",
      "node": { "id": "n3", "path": "div.row > div.card:nth(1)", "source": "fixtures/flex/row-gap-padding.html:14" },
      "property": "frame.x",
      "expected": 152,            // Chrome, points
      "actual": 144,              // iOS runtime dump, points
      "delta": -8,
      "tolerance": { "abs": 0.333, "source": "default: one device pixel" },
      "profileEntry": { "target": "ios", "path": "properties.gap", "status": "exact", "tests": ["ios/flex/row-gap-padding"] },
      "otherLayers": { "taffy-linux": "pass", "applied-values": "pass" },
      "likelyCause": {
        "layer": "view-application",
        "reason": "Taffy on Linux produced x=152 from the same table; the iOS frame differs, so the box-to-view copy or parent offset is wrong, not the CSS mapping.",
        "look": ["runtime/swift/Sources/Dragon/ApplyLayout.swift"]
      },
      "repro": "pnpm dragon parity --target ios --fixture flex/row-gap-padding --report out/p",
      "evidence": { "sideBySide": "parity-report/index.html#flex/row-gap-padding", "heatmap": "parity-report/img/flex-row-gap-padding.diff.png" }
    }
  ]
}
```

### 4.2 Rules

1. **Models never decide pass or fail.** A model may read the report, caption a heatmap already flagged by a numeric or reftest failure, and propose a fix. The verdict comes from the comparison program only.
2. **Tolerances, baseline images and expectations entries change only with owner approval** and a measured, written reason (repo rule in `docs/ci-process.md`). CI fails a PR that edits a tolerance or a Chrome expectation file unless the change carries the regeneration command's receipt and an owner-approval label.
3. **Flakes are fixed or quarantined per `docs/ci-process.md`**: named owner, expiry at most two weeks, expired entries fail CI. No test retries. Simulator boot gets one retry because it is environment, not the test.
4. **An agent may not "fix" a failure by editing the expected numbers.** Expected numbers come only from the Chrome capture command.
5. The agent's done condition is the repo's: typecheck, `pnpm ci:local --fast`, and the affected parity job green (CLAUDE.md).

### 4.3 Deterministic "likely cause"

The report's `likelyCause` is computed from which layers passed, not guessed:

| Support check | Taffy on Linux | Applied values | Sim frames | Reftest | Likely cause |
|---|---|---|---|---|---|
| fail | - | - | - | - | CSS not in profile: change the CSS or propose a profile row |
| pass | fail | - | - | - | Compiler's CSS-to-table mapping or cascade |
| pass | pass | fail | - | - | Swift runtime property mapping |
| pass | pass | pass | fail, Ahem fixture | - | Box-to-view copy, rounding or view nesting |
| pass | pass | pass | fail, real-font fixture only | - | Text measurement adapter |
| pass | pass | pass | pass | fail | Platform paint of a correctly set property |

### 4.4 How failures route back to the support list

- Each profile row lists its test ids. A row may be `exact`, `caveat`, `approx` or `no-effect` only if every listed test exists and passes on that target. The profile checker enforces this on every PR.
- A red test for a *proposed* row keeps it unsupported, automatically. An agent can fix the implementation or leave the row unsupported.
- A red test for a *released* row fails CI. The agent fixes the implementation. Demoting a released row is a breaking change for app authors, so it needs owner approval.
- Promotion is a PR that adds passing test ids and moves the row; the PR shows the side-by-side report for those fixtures. Promotion of rows whose tolerance is the default needs no special approval; rows needing a new tolerance do (rule 2).
- The generated docs tables show each row's test ids and last pass date, so the public claim and its proof are one link apart.

## 5. Where fixtures come from

| Source | What | How many (estimate) | Licence |
|---|---|---|---|
| Hand-written, one or more per support row | The core. Each `exact`/`caveat` row gets a positive fixture; each `unsupported` row a rejection fixture expecting the diagnostic; each `no-effect` row an omission fixture (layout, paint, hit testing, accessibility unchanged) | ~1-3 per row | Ours |
| Generated from the profile | Property × value × context matrix: for each supported property, its listed values, units and a few edge values (0, negative where allowed, percentage, `calc`), inside flex, grid and block parents | Hundreds; capped per property | Ours |
| Taffy's gentest corpus | 1,548 Chrome-verified layout fixtures in HTML; filter to profile-supported features, convert to dragon fixtures | Filtered subset | MIT (GitHub API, checked today); keep the notice |
| WPT subsets | Reftests from `css-flexbox`, `css-grid`, `css-box`, `css-backgrounds`, `css-values`, translated | Tens to low hundreds | 3-clause BSD (read `LICENSE.md` today): keep the copyright notice and licence text in the vendored directory |
| Ahem font | From WPT `fonts/Ahem.ttf` | 1 | WPT tree licence; check the font's own notice before vendoring (**not verified**) |
| Real text fonts | The fonts shipped in the app, identical files on web and iOS | Few | Font licence must permit bundling |

Fixture format: dragon fixtures are plain HTML plus `<style>` (Taffy's gentest format), so dragon needs no Markless dependency and Taffy's and WPT's corpora import directly. Markless keeps a smaller integration set of `.tsrx` fixtures that goes through the real Markless compiler into dragon, so a Markless change that breaks the style tables is caught in Markless's own CI (CLAUDE.md: a change affecting a consumer must pass the consumer's checks).

## 6. Flake controls, CI placement and cost

### Flake controls

| Source | Control |
|---|---|
| Fonts | Ahem for layout; exact bundled font files for text; Chrome hinting flags off; wait for `document.fonts.ready` and two animation frames on web, a layout-settled signal on iOS |
| Browser drift | Chrome for Testing pinned; upgrade regenerates expectations in the same PR |
| GPU and colour | `--disable-gpu --force-color-profile=srgb`; compare colours as numbers, not pixels |
| Device scale | Chrome at scale 1; iOS compared in points with a one-device-pixel tolerance |
| Simulator | One pinned model and runtime; arm64 only; Xcode pinned; `simctl boot` then `bootstatus -b` with 3-minute timeout, one boot retry; no Simulator.app; status bar override re-applied after boot |
| Animation and caret | Off on both sides (Playwright `animations: 'disabled'`, `UIView.setAnimationsEnabled(false)`) |
| Architecture | Record and compare images on arm64 macOS only (Intel and Apple Silicon differ) |
| Timing | Explicit ready signal, never sleeps; Blitz found 17 tests passing only because capture was early |
| Parallelism | One simulator per job; fixtures in one app process, reset between fixtures |
| Nondeterminism | A new fixture must pass 20 consecutive local runs before merging (researched default) |

### CI placement

| Lane | Runner | When | Required? |
|---|---|---|---|
| Profile check, compile fixtures, Chrome capture, Linux Taffy lane, email static checks | `ubuntu-latest` | Every PR (skipped by the existing lane hash when inputs are unchanged) | Required |
| Simulator numeric + reftests + side-by-side | `macos-latest` pinned Xcode | PRs touching the Swift runtime, native compiler output, the profile or fixtures; nightly on `main` | Advisory at first (`continue-on-error`, like the VoiceOver lane), then required (owner decision 3) |
| WPT subset, accessibility, interactions, planted-bug self-test, full report to Pages | macOS + Linux | Nightly | Nightly red opens an issue; blocks release |
| Android | Linux JVM (Roborazzi/Robolectric) if Taffy's native library loads there (**unverified**), else an emulator job | After the iOS lane is stable | Later |
| Email real clients | Paid API | Nightly or per release, if funded | Blocks release only |

`scripts/ci/local.mjs` needs a darwin-only policy entry so `pnpm ci:local --job parity-ios` works on a Mac and is skipped with a clear message elsewhere (T036 gap 9).

### Cost, given a public repo

- Minutes: free for standard runners on public repos, macOS included. The private-repo prices ($0.006/min Linux, $0.062/min macOS) matter only if the dragon repo is private; keep it public.
- The binding limit is concurrency: free and team plans allow 5 concurrent macOS jobs across the organisation. The VoiceOver lane already uses one. Path filters, one macOS job per PR, and `concurrency: cancel-in-progress` keep the queue short.
- Time (estimate, not measured): simulator boot 1.5-3 minutes, app build 3-6 minutes, a few hundred fixtures at well under a second each; target under 20 minutes per macOS job. Linux lanes: a few minutes.
- Paid only: an email rendering service, and optionally Cirrus-style flat-rate Mac runners (about $150/month per M4, from memory notes) if queueing becomes a problem.

### Local runs

The Xcode licence on this machine is **still not accepted** today (`xcrun simctl help ui` refused, 2026-09-26; T004's note that it was accepted is out of date). Until the owner runs `sudo xcodebuild -license accept`, no simulator lane runs locally; Linux lanes do. Local simulator runs use the same pinned device and runtime as CI, and images recorded locally are never committed as baselines (CI records them).

## 7. Pseudocode

### A fixture (dragon, HTML + style)

```html
<!-- fixtures/flex/row-gap-padding.html -->
<meta name="dragon-fixture" content='{
  "viewport": [390, 200],
  "font": "ahem",
  "covers": ["ios:properties.display.values.flex", "ios:properties.gap", "ios:properties.padding"],
  "capture": ["frame", "background-color", "border-radius"],
  "tolerance": "default"
}'>
<style>
  .row  { display: flex; gap: 12px; padding: 20px; }
  .card { width: 120px; height: 40px; background-color: #3366ff; border-radius: 8px; }
</style>
<div class="row">
  <div class="card">AB</div>
  <div class="card">CD</div>
</div>
```

The same fixture as a Markless integration fixture:

```tsx
// packages/.../parity-fixtures/flex/row-gap-padding.tsrx
export const fixture = { viewport: [390, 200], font: 'ahem', covers: ['ios:properties.gap'] };

export component RowGapPadding() {
  <div class="row">
    <div class="card">{'AB'}</div>
    <div class="card">{'CD'}</div>
  </div>
  <style>
    .row { display: flex; gap: 12px; padding: 20px; }
    .card { width: 120px; height: 40px; background-color: #3366ff; border-radius: 8px; }
  </style>
}
```

### The harness run

```text
# regenerate expected numbers (human-reviewed diff; only command allowed to write expected/)
pnpm dragon parity capture --browser chrome --fixtures 'flex/**'

# Linux, every PR
pnpm dragon profile check                 # layer 0 + "every claimed row has a green test"
pnpm dragon parity taffy --fixtures all   # layer 2

# macOS
pnpm dragon parity ios --device "iPhone 17" --runtime "iOS 27.0" --fixtures all --report out/parity
```

```ts
// harness core (pseudocode)
for (const fixture of selected) {
  const web = readExpected(fixture);                    // layer 1 output, committed
  const table = dragon.compile(fixture.css, { target: 'ios' });
  const taffy = runTaffy(table, fixture, { measure: ahem });
  const sim = await simulator.render(table, fixture);   // frames + applied props + screenshot
  const results = [
    compareFrames(web, taffy, tol.taffy),
    compareApplied(web, sim.applied, profile),
    compareFrames(web, sim.frames, tol.device(sim.scale)),
    ...reftests(fixture, simulator),
  ];
  report.add(fixture, results, likelyCause(results));   // table in 4.3
  report.attach(fixture, sideBySide(web.png, sim.png, heatmap(web.png, sim.png)));
}
report.write('out/parity');                             // report.json + index.html + summary.md
process.exitCode = report.unexpected().length ? 1 : 0;  // expectations file decides "unexpected"
```

### A failure report

See section 4.1. The agent reads `failures[0]`, sees Taffy on Linux passed and applied values passed, so `likelyCause` points to view application, opens the named Swift file, runs the `repro` command, and fixes the code. It may not edit `expected/`, tolerances or the expectations file.

## 8. First milestone and owner decisions

### First milestone: "one flex card, proven four ways"

About 15 hand-written fixtures covering: `display: flex` row and column, `gap`, `padding`, fixed and percentage `width`/`height`, `border-width`, `border-radius`, `background-color`, `opacity`, plus three rejection fixtures (`:has()`, `transition: all`, `position: fixed`).

Done when:

1. The Linux lanes (profile check, Chrome capture, Taffy lane) are required on every PR in the dragon repo and green.
2. The iOS simulator lane runs on PRs and nightly, produces `report.json` and the side-by-side HTML, uploads it, and posts the PR summary comment.
3. Three planted bugs (padding off by one, radius ignored, `gap` treated as margin) are each caught and blamed on the right layer.
4. The support rows those fixtures cover can be promoted from proposed with real test ids.
5. A Markless integration job compiles the same fixtures from `.tsrx` and runs the Linux lanes in Markless CI.

Prerequisites: the dragon repo exists (public) with a minimal compiler and Swift runtime that emit and apply a style table for these properties; a pinned Taffy revision; the Xcode licence accepted on the owner's Mac.

### Owner decisions

I am asking for four choices that change what gets built; I recommend the first option in each.

**Where the tests live:** the parity suite, fixtures and reports live in the dragon repo, and Markless runs a smaller integration set of its own components through it, because dragon owns the compiler and runtimes that the tests prove, and Markless's rule already requires a consumer to run its own checks when the tool it uses changes.

**How close is "the same" on a phone:** box positions and sizes must match the browser within one physical screen pixel, and text-heavy tests get their own measured allowance written into the test, because one pixel is the smallest difference a phone can show, and a single loose percentage would hide the layout shifts these tests exist to catch.

**When the iPhone test blocks a merge:** start it as a report-only check on pull requests that touch native code, and make it blocking once it has run two weeks without an unexplained failure, because simulator start-up is the flakiest part of the suite and a blocking check that fails randomly teaches people and agents to ignore it.

**Paying for real email client screenshots:** do not pay for a rendering service until the email target is being built; until then email is proven by build-time checks and snapshots of the generated HTML, because classic Outlook cannot be run in CI at all and the services (roughly $99 to $500 a month, unverified) only add value once there is email output to check.

Researched defaults (no decision needed; details above): Chrome is the reference browser with WebKit captured alongside for text; numbers decide, pictures are evidence; AI models never pass or fail a test; tolerance and baseline changes need owner approval; the Taffy runner ships as prebuilt WebAssembly; WPT and Taffy fixtures are vendored with their licences; Android follows the iOS lane using the same fixtures; every support-list claim must name a passing test.

```json
{
  "goalbuddy_receipt_v1": {
    "result": "done",
    "task_id": "T037",
    "board_path": "docs/goals/native-targets-api/state.yaml",
    "decision": "approved",
    "full_outcome_complete": false,
    "rationale": "Parity is proven by numeric oracles: Chrome geometry and computed values against a Linux Taffy lane (every PR) and a simulator dump of frames and applied properties joined by compiler node ids. Same-renderer reftests and a translated WPT subset cover paint. Side-by-side images and heatmaps are evidence only; models never judge. A deterministic layer table names the likely cause. Every support row must name a passing test. Four owner decisions remain.",
    "worker_package": null,
    "evidence": [
      "notes/testing-plan.md",
      "notes/T035-testing-landscape.md",
      "notes/T036-test-infra.md",
      "notes/T030-agent-guardrails.md",
      "notes/css-support.md",
      "gh api repos/compiled-run/markless: public",
      "gh api repos/DioxusLabs/taffy: MIT",
      "web-platform-tests/wpt LICENSE.md: 3-clause BSD",
      "xcrun simctl: Xcode licence not accepted (2026-09-26)"
    ],
    "subgoal_contract": null,
    "parallel_safety": null,
    "blocked_tasks": [],
    "missing_evidence": [
      "No harness, fixture or dump exists; every command name is a proposal",
      "simctl content_size syntax unverified",
      "Taffy native library under Robolectric unverified",
      "Ahem font's own licence notice not checked",
      "macOS job timings are estimates",
      "Email service prices are third-party figures"
    ],
    "required_board_updates": [
      "Record T037 receipt with notes/testing-plan.md",
      "Note owner direction: CSS compiler becomes the separate dragon project; supersedes css-support.md 'package inside Markless' default",
      "Correct T004 claim that the Xcode licence was accepted; it is not as of 2026-09-26",
      "Add the four testing decisions to notes/decisions.md",
      "Link testing-plan.md from report.md testing section"
    ]
  }
}
```
