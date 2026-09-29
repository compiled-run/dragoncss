# T010: North-star gap plan (checkpoint 3)

Judge note, 2026-09-28. Read-only review; the only file written is this note.

**Read for this review:**
- goal.md, state.yaml;
- docs/research/coverage-roadmap.md (sections 1–6 and the north-star paragraph);
- docs/decisions.md, including the uncommitted edits in the main checkout ("Text selection and editing", "Selectors and scrollbars", "Device text size", "Native glyph advances");
- milestone-2 notes/T015 sections 2–5;
- text-plan-summary.md;
- engine-value-model-plan.md section 6;
- examples/music-player: styles.css, snapshot.html, tools/*.ts, GAPS.md, README.md, dragon/north-star-check.json;
- `git diff --stat master...<branch>` for every branch in the merge set.

## 0. What the repo measures today (master 2d2e4dd)

`dragon/north-star-check.json` was regenerated at the feat-selectors merge. Note that GAPS.md is stale: it still says 60/291 at 4c1331c.

| Measure | master |
|---|---|
| Declarations supported on web and ios | **70 / 291 (24.1%)** |
| Elements supported | 18 / 62 (html, body, div) |
| Diagnostics | 713 errors |

The 713 errors by code:

| Code | Count |
|---|---|
| UNSUPPORTED_VALUE | 161 per target, plus 3 |
| UNPROVEN_CONTEXT | **79 per target** |
| UNSUPPORTED_PROPERTY | 81 |
| UNSUPPORTED_ELEMENT | 44 |
| UNSUPPORTED_ATTRIBUTE | 40 |
| CSS_INVALID_VALUE | 27 (all `var()`) |
| UNSUPPORTED_FONT | 21 (ios) |
| UNSUPPORTED_SELECTOR | 14 |
| UNSUPPORTED_AT_RULE | 3 |

The check covers the compiler only: web and ios through `createProject`, with android waiting for P4. It has no device side, no Chrome comparison of Dragon output and no pixel comparison. The Chrome reference (`chrome/<device>/`) has these limits:
- it covers only iphone 390x844 at DPR 3 and android 412x915 at DPR 2.625;
- it has three states and animations at t=0;
- its fonts depend on the host (Helvetica for `sans-serif`);
- its covers are SVG stand-ins that a native app cannot decode the same way;
- it has no line-break offsets and no pixel manifest.

## 1. Feature map (every feature, element, selector and at-rule, with its package and state)

States:
- **M**: on master.
- **B:<branch>**: on an unmerged branch in the integrator's merge set.
- **—**: missing.

A package name in *italics* is not in the roadmap table. This plan adds it.

| Demo feature (uses) | Package | State |
|---|---|---|
| class, compound, descendant, list, type selectors | milestone 1 | M |
| `*`, `:root` | SELS | M (feat-selectors) |
| `#root` (matches nothing) | *TREE* (id as element data) | — |
| `[type='range']` x3 | *TREE* (non-ui attributes as element data; SELS already has the operators, `selectors.ts:257` refuses non-ui names) | — |
| `::-moz-range-thumb` (Chrome drops the rule) | *TREE* (Chrome-equal invalid-selector drop, with a warning) | — |
| `::-webkit-slider-thumb` | FORM-a | — |
| `::-webkit-scrollbar`, `-track`, `-thumb` | OVFL-s (owner ruling "Selectors and scrollbars": ignored where Chrome ignores them; proven via `scrollbar-color` on `*`) | — |
| `:hover` x4, `:focus` x1 | SELD (compile states + R) | — |
| `@media` x2 (max-width 768/640) | MQ (build fold per environment, then R band selection) | — |
| `@keyframes`, `animation`, `animation-play-state` | ANIM | — |
| `transition` x4 | ANIM | — |
| custom properties x13, `var()` x30, `inherit` | CASC | B:feat-cascade-var |
| `rem` x75 | UNIT-a (fold at text scale 1), then V2 for device text size | B:feat-units; V2 — |
| `vw` x9, `vh` x6, `calc`/`min`/`clamp` x15 | V1 (CALC + UNIT-b) | — (T006/T009) |
| hex, `rgba`, `transparent` colours | milestone 1 | M |
| `background` colour-only | BG1 | M |
| `linear-`, `radial-`, `repeating-radial-gradient` | BG2 | — |
| `padding-inline`, `inset` | LOGI, milestone 1 | M |
| `display` flex/block/none | milestone 1 | M |
| `display` inline-flex/inline-block | INL2 | — |
| flex properties, `gap`, `box-sizing`, box model, `overflow: hidden`, `position` static/relative/absolute, `top`/`left`/`right` | milestone 1 | M, but **79 UNPROVEN_CONTEXT** per target |
| the unproven contexts: abspos in flex row, relative in flex row/column, root, display-none, not-flex-container, text in flex item/column, `%` widths in flex-column | *CTX* (context-proof fixtures) | — |
| `position: fixed` x2 | POSX-f | — |
| `overflow: auto`, the `overflow-x` computed pair, viewport propagation, scroll containers | OVFL | — |
| `scrollbar-color`, `scrollbar-width` (Dragon-drawn thumb) | OVFL-s | — |
| `aspect-ratio` x5 | SIZE-ar (the aspect-ratio subset of SIZE) | — |
| `z-index` x3, `opacity` x6, `border-radius` x8, `box-shadow` x5 (inset, multiple), `outline: none` | PNT1 | — |
| `transform` (translate, translateX %, rotate, scale), `transform-origin`, `will-change` | PNT2 | — |
| `color-scheme: dark` | PNT1, plus a dark UA dataset (ua lane) | — |
| `cursor`, `pointer-events` | SELD-R (hit testing) | — |
| `-webkit-appearance: none` | FORM-a | — |
| `html`, `body`, `div` | milestone 1 | M |
| `nav`, `h1`–`h4`, `p` | ELB | B:feat-block-elements. Bold h1–h3 is refused on ios until TXT1. |
| `span` x11, `a` x2 | INL1 (a: the UA underline paint via TDEC; tap helper) | — |
| `button` x10 | *ELB-2* (UA button defaults), then INL2 (inline-block), then FORM-a | — |
| `img` x5, `object-fit` x2 | REPL | — |
| `input type=range` | FORM-a (Dragon-drawn slider, value mapping) | — |
| attributes: type, src/alt, aria-label, href/rel/target, min/max/value, data-*, lang | *TREE* (element data), then REPL, FORM-a and accessibility | — |
| void elements, `<link rel=stylesheet>`, free states as a tree fixture | *TREE* | — |
| `'Lato', sans-serif` x21 text nodes | TXT1-C (font map pins `sans-serif`; Lato is not loaded, so Chrome falls back), then TXT1a (HarfBuzz via TXT1-0) | T003 in flight; T004/T005 queued |
| `font` shorthand (`inherit`), `font-weight` 400 plus UA bold | TXT1-C matching, then TXT1a | — |
| symbols ♪ ▶ ❚❚ ‹ › | TXT1d (fallback, or a bundled symbol face in the font map) | — |
| `letter-spacing`, `overflow-wrap` anywhere/break-word, `white-space: normal` | TXT2 subset (the engine-linebreak breaker is wired in TXT1) | engine-linebreak is B (unwired) |
| `text-decoration-color`, `text-underline-offset` | TDEC | — |
| `line-height`, `text-align`, `font-size` px | milestone 1 | M (`rem` sizes wait for UNIT-a) |
| YouTube iframe (stripped), script-driven inline styles | *FV* (foreign-view slot) and *SOV* (typed style override) | **Not CSS. PM/owner must scope them in or out of checkpoint 3 explicitly; never drop silently.** |

## 2. Package order for maximum parallelism

Merge rules that apply throughout:
- inline.ts and text.ts are serial: P4, then engine-linebreak, then P5, then V, then INL1, then TXT1.
- block.ts belongs to INL1 while INL1 is in flight.
- The hotspot owners in roadmap section 4 apply.
- Generated files are regenerated at merge, never hand-merged.
- `packages/parity/src/fixtures.ts` takes append-only edits, one import and one concatenation per group. It is the only shared source edit allowed between compiler/fixture packages. The integrator resolves it at merge; it is never a reason to serialise.

| Wave | Package | Lane and write scope | Can run alongside | Merge after |
|---|---|---|---|---|
| **0 (now)** | T002 integrator (ELB, CASC, UNIT-a, wpt-breadth, engine-linebreak, P4) | int | all | — |
| 0 | T003 TXT1-0 | vendor/harfbuzz, packages/text-shaper | all | its own gate |
| 0 | **NS-CTX** (WP1 below) | new fixtures, `fixture-groups/contexts.ts`, generated outputs | all | the T002 set (regenerate on rebase) |
| 0 | **NS-REF** (WP2 below) | `examples/music-player/**` except check.ts and north-star-check.json; one new parity test file | all | anytime (disjoint) |
| 0/1 | T004 → T005 TXT1-C | new files (T004 decides). It must not claim `contexts.ts`, `context-*` fixtures or `examples/**` | all | T002 |
| 1 (after T002) | T007 P5 | T015 §4 | V1, TREE, MQ-a, emitter split | T002 |
| 1 | T009 V1 | layout input/units/validate/layout/box/flex/position/intrinsic, calc.ts, environment.ts; css/math, values, units; computed.ts; lower/ios-layout.ts | P5 (T006 rules), TREE | P4 |
| 1 | **TREE** (attributes as element data, `[type]`, `#id`, void elements, `<link>`, the `::-moz-range-thumb` drop, and the north-star check rebuilt as a tree fixture with free states `libraryStatus` x `isPlaying` plus the android target) | project.ts (attribute check), css/selectors.ts, analysis/match.ts, parity fixture-reader.ts and tree-fixture.ts, examples/music-player/tools/check.ts and snapshot.ts | V1, P5, MQ-a | T002 and NS-REF |
| 1 | **MQ-a** (`@media` folded per environment at build; native rows stay unsupported until MQ-R) | css/at-rules.ts plus new at-rules/media.ts; analysis/cascade.ts (condition hook; CASC has released it) | TREE, V1, P5 | CASC merged |
| 1 | **Emitter split** (P4 follow-up: `emit/paint/<feature>.ts` writer modules) | emit/uikit.ts, android-views.ts, native-program.ts; **not** native-support.ts | P5, V1 | P5 accepted |
| 1 | **ELB-2** (UA data for button, input, a, img, span; the dark UA dataset) | scripts/capture-ua-defaults.ts, ua/*.generated.ts, ua/datasets.ts (ua lane). Element-table entries wait for their engine package | all except another ua writer | ELB merged |
| 2 (after V1) | POSX-f (position.ts) ∥ SIZE-ar (intrinsic.ts, flex.ts) ∥ OVFL layout half (box.ts, scrollable overflow, viewport propagation) | disjoint engine files | each other, P5 | V1 |
| 2 | V2 (FontSpec, rootFontSize) | inline.ts and text.ts: serial | — | P5 |
| 3 | INL1 (span, a, inline boxes) | inline, text, block, inline-box.ts; elements.ts | POSX-f, SIZE-ar | V1, V2, P5 export |
| 3 | TXT1a (Latin, HarfBuzz) → TXT1d (symbol fallback) → TXT2 subset → TDEC | txt, serial | paint packages | INL1, T003 gate, T005 |
| 4 | INL2 (inline-block/-flex, button box) → REPL (img, object-fit) → FORM-a (button, range slider, `appearance: none`, `::-webkit-slider-thumb`) | eng/inline, then eng+pnt | txt lane | serial chain |
| P (after P6 and the emitter split) | PNT1 ∥ PNT2 ∥ BG2 ∥ OVFL-s (native scroll view and Dragon thumb) | one writer module each | each other | P6 |
| R | SELD-R (hover, focus, pointer-events, cursor) → ANIM (transition, keyframes, play-state) → MQ-R (band selection) | rt | — | P4 emitters; ANIM after PNT1 and PNT2 |
| Lane | **NS-LANE** (section 3): the north-star app host per platform and the device lane, run report-only from the day P5 lands so every later merge moves a number | examples/music-player/lane/**, one new parity CLI | all (device lease serialised) | P5 |
| Final | NS-E2E: all NS lanes pass on both platforms | — | — | everything above |

The longest pole is P4 → P5 → V2 → INL1 → INL2 → REPL → FORM-a, then the NS lane. TXT1a and the paint wave (after P6) run beside it.

Hard stops that do not wait for their package:
- the FV/SOV scope ruling;
- a pinned `sans-serif` face (T004);
- the gradient and blur allowances. Any measured pixel allowance needs owner approval (decision 13).

## 3. The north-star device lane (P5 lane rules applied to the demo)

**Cases.** Derived from a committed manifest, never from literals. Each case is one of:
- the free states `libraryStatus` x `isPlaying` (4), at scroll top and at scroll end (8);
- forced interaction states, steady state, at scroll top: `:hover` on each of the 4 hover subjects, plus `:focus` on the range input;
- animation frames, at t = 0 s and 5 s:
  - `album-spin` in both playing states;
  - the library transition, main → library-open and back, at 0.25 s;
  - a pause at 5 s that keeps the phase.

States change on device through the generated state API (decision 17), in one app build per target. At least the library toggle and the play button are also driven by a synthetic tap through Dragon hit-testing. A per-state rebuild is not allowed.

**Matrix.** Each root is a fixed CSS viewport, and the runner stops rather than crop.

| Platform | Viewport | DPR 2 | DPR 2.625 | DPR 3 |
|---|---|---|---|---|
| iOS | 390x844 | iPad (A16) | — | iPhone 17 (402x874 pt) |
| Android | 412x915 | dragon-320 | **a new AVD** | dragon-480 |

For DPR 2.625 on Android, dragon-smoke is 411 dp wide, so the 412 px root would not fit. Use a new AVD, for example `dragon-ns-2625`: 1440x3040 at density 420, which is 548 dp wide. It is provisioned by the P5 runner code under the device lease.

**Lanes.** There are four per target, recorded in `examples/music-player/dragon/north-star-lanes.json`:
- **ns-frames:**
  - node (d) against the TS engine's snapRect;
  - node (a) against the Chrome capture at that DPR, within `GATE_DEVICE_PX`.
- **ns-applied:**
  - (b) against the expected dump;
  - the native class;
  - an equal `expectedDigest`.
- **ns-lines:**
  - line (a) against Chrome, and (d) against the engine;
  - break offsets against the Chrome breaks, captured with P5's method (single-code-unit Range rects grouped by line);
  - any mismatch is kind `break-mismatch`.
- **ns-pixels:**
  - points come from `generateSamples` over the engine geometry and paint facts;
  - non-text points are strict (`GATE_CHANNEL_DELTA`);
  - text uses the TXT1 text-pixel rule (ink bounds within 1 device px, plus coverage), with a measured allowance only if the owner approves it;
  - the Chrome PNGs and the manifest carry sha256, Chrome version, flags, size, the non-integral raster rule (O4) and the **font key**.

**Integrity**, required on every run:
- **Capture trust:** on every device, the in-app capture equals the OS screenshot.
- **Plants:**
  - `glyph-offset-1` on demo text, and a 1-device-px shift of one gradient or radius, must fail ns-pixels while ns-frames and ns-lines pass;
  - every `DUMP_FAULTS` entry is caught on real north-star dumps, with applicable counts greater than 0.
- **Stale references:** a reference whose font key or stand-in sha differs from the build is **stale**, and stale counts as fail.
- **Text scale:** default. The largest-text-size run follows P7/V2.
- **Report-only:** the lane starts report-only. `--require-all` exits 0 only when all 8 NS lanes pass (4 lanes x 2 targets).

**Pass rules.**
- Checkpoint 3 is met only when all 8 NS lanes pass with no `not run` lane and no stale lane.
- Every compiled declaration and element must be supported for the target, with 0 error diagnostics in `north-star:check`.
- Every workaround label must name a passing NS or parity case.
- Screenshots are evidence only.

## 4. Worker packages that can start now

Both packages below are disjoint from:
- the T002 merge-set sources;
- T003 (vendor/harfbuzz, packages/text-shaper, the workspace and package.json);
- TXT1-C (T004 must not claim these paths);
- each other.

Neither boots devices. Together with T002 and T003 they fill `max_write_workers: 4`. T005 cannot start until one of the four finishes, or until the PM raises the limit with a recorded reason.

Every package is also bounded by these limits:
- no compiler or engine source edit to make a case pass;
- no tolerance change;
- no edit to `design/`.

### WP1: NS-CTX, context proofs for the north star

**Setup.**
- **Base:** master 2d2e4dd.
- **Branch:** `ns-contexts`.
- **Worktree:** `/tmp/dragon-ns-ctx`.

**Objective.** Take every `DRAGON_UNPROVEN_CONTEXT` the north-star check reports on master (79 per target). The list comes from `examples/music-player/dragon/north-star-check.json` and is written into the note. For each one, add a parity fixture that proves that context, in the fixture group `contexts`:
- use px, % and keyword values only, since `rem`, `var` and `calc` are unmerged;
- cover both directions where the context has a direction facet;
- prove each fixture on the full proof path: Chrome captures, chrome-dual, DPR 2, 3 and 2.625 captures, vectors, DPR vectors and profile rows.

The contexts to cover:
- absolute-in-flex-row/ltr/cb-ltr (percent insets and sizes, border styles, overflow, padding);
- relative-in-flex-row and relative-in-flex-column;
- root (margin, padding, box-sizing, overflow-x on html);
- display-none;
- not-flex-container (align-items, justify-content, flex-wrap);
- text-in-flex-item/column (text-align);
- block (top and right);
- flex-column `%` widths.

The result must lower `UNPROVEN_CONTEXT` in north-star-check.json. Every context that remains is listed with its reason.

**Allowed files.**
- `packages/parity/fixtures/context-*.html` and `packages/parity/fixtures/reject-context-*.html` (new)
- `packages/parity/src/fixture-groups/contexts.ts` (new)
- `packages/parity/src/fixtures.ts` (one import and one concatenation entry only)
- New files only under `packages/parity/expected/**`, `packages/parity/expected-dpr/**` and `packages/layout/vectors/**`
- `packages/parity/emitted/**` (new files; header lines relaxed tier)
- `packages/dragon/src/profiles/web.ts`, `ios.ts` and `android.ts` (regenerated by profile:rows only)
- `packages/parity/out/lanes.json`
- `packages/translate/corpus-dpr.json`
- Case-count literals only in:
  - `packages/parity/test/dpr.test.ts`, `lanes.test.ts` and `native-compare.test.ts`;
  - `packages/translate/test/corpus-dpr.test.ts`, `native-dpr-swift.test.ts` and `native-dpr-kotlin.test.ts`;
  - `packages/layout/test/snap.test.ts`, `dpr-deviations.test.ts` and `dpr-vectors.test.ts`.
- `examples/music-player/dragon/north-star-check.json` (regenerated only)
- `docs/goals/milestone-2-proof/notes/T011-ns-contexts.md`

**Verify.** First run `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt`. Then:
1. `pnpm install --frozen-lockfile`, then `pnpm typecheck` and `pnpm test`: all green. No test is skipped, `.todo` or `.only`.
2. `pnpm run parity:capture` and `pnpm run parity:dpr-capture`, each run twice: the second run gives no diff.
3. `pnpm run layout:vectors && pnpm run layout:dpr-vectors`. Then `git diff --diff-filter=MD --name-only 2d2e4dd -- packages/parity/expected packages/parity/expected-dpr packages/layout/vectors packages/parity/emitted` lists only emitted header lines. No existing capture or vector changes.
4. `pnpm run profile:rows`: the diff is only rows or proofs for the new contexts. No existing row is demoted or promoted beyond the profile rules. iOS paint rows stay caveat.
5. `pnpm run parity:report`: failed 0. `pnpm run parity:dpr-report`: failed 0 at 2, 3 and 2.625.
6. `pnpm run layout:subset`: 0 violations. `pnpm run native:gen`, then `git diff --exit-code packages/layout/generated`.
7. `pnpm run native:swift` and `pnpm run native:kotlin`: all vectors equal.
8. `pnpm run parity:lanes -- --run-host`: exit 0, with lanes.json committed.
9. `pnpm run north-star:check`: the UNPROVEN_CONTEXT count falls from 79 per target. The note lists before and after, plus each remaining context.
10. `git diff --name-only 2d2e4dd..HEAD` lies inside allowed_files. `git remote -v` is empty.

**Stop if.**
- Chrome and the engine disagree on any new context case. Report the case, node and values. Do not touch the engine, compiler, snap rule or gate.
- A context needs a compiler change to be recognised or proven, such as analysis/context.ts or profile-rows.ts.
- Any existing capture, vector, profile row or emitted body changes.
- A context can only be expressed with `rem`, `var` or `calc`. List it and continue with the rest.
- A file outside allowed_files is needed.
- Verification fails twice.

### WP2: NS-REF, the north-star lane reference on the Chrome side

**Setup.**
- **Base:** master 2d2e4dd.
- **Branch:** `ns-lane-ref`.
- **Worktree:** `/tmp/dragon-ns-ref`.

**Objective.** Build the Chrome oracle and the case manifest of the north-star device lane (section 3), inside examples/music-player:
1. **Manifest.** A committed lane manifest (`examples/music-player/lane/manifest.ts`) derives the case list:
   - the 4 free states x 2 scroll positions;
   - the forced `:hover` and `:focus` cases;
   - the animation and transition frames;
   - the per-platform matrix: iOS 390x844 at 2 and 3, Android 412x915 at 2, 2.625 and 3.

   `snapshot.ts` gains additive exports for combined states (library-open plus playing). Existing exports stay unchanged.
2. **Capture.** `capture-chrome.ts` is rewritten to capture every case at every DPR with `launchChrome`, `chromeArgsAt` and `zoomGuard`, imported unchanged. For each capture it writes:
   - the boxes (getBoundingClientRect per data-dragon-id element);
   - the computed values of used properties and core longhands;
   - per-text-node line rects and line start/end offsets, using P5's method (single-code-unit Range rects grouped by line);
   - the viewport PNG.

   Two mechanisms make the frames deterministic:
   - animations and transitions are frozen by setting `currentTime` on `document.getAnimations()`;
   - forced states use CDP `CSS.forcePseudoState`, with transitions finished.
3. **Pixel manifest.** Records sha256 per PNG, Chrome version, flags, size, the raster-size rule for non-integral roots (412 x 2.625 = 1081.5), and the **font key** (the platform font per text node from CDP `CSS.getPlatformFontsForNode`).
4. **Covers.** The SVG cover stand-ins become deterministic 1280x720 PNGs, written by a committed TS generator with no dependency, so Chrome and the native apps decode identical bitmaps. They are served to Chrome as PNG.
5. **Test.** A new parity test checks, without Chrome:
   - that the committed reference matches the manifest (case list derived, every file present, sha256 equal);
   - that the stand-in PNGs regenerate byte-identically.
6. **Docs.** README.md documents the lane matrix and the font-key staleness rule.

**Allowed files.**
- `examples/music-player/tools/capture-chrome.ts`
- `examples/music-player/tools/snapshot.ts` (additive exports only)
- `examples/music-player/tools/lane-*.ts` and `examples/music-player/tools/cover-png.ts` (new)
- `examples/music-player/lane/**` (new)
- `examples/music-player/covers/**` (new)
- `examples/music-player/chrome/**` (regenerated; the old per-device layout may be replaced)
- `examples/music-player/README.md`
- `packages/parity/test/north-star-reference.test.ts` (new)
- `docs/goals/milestone-2-proof/notes/T012-ns-lane-ref.md`

**Verify.** First run the same env exports as WP1. Then:
1. `pnpm install --frozen-lockfile`, then `pnpm typecheck` and `pnpm test`: all green, with the new test included.
2. Run `pnpm run north-star:capture` twice. After the second run, `git diff --exit-code examples/music-player/chrome examples/music-player/covers` exits 0. The zoom guard passes for every DPR.
3. `pnpm run north-star:check`, then `git diff --exit-code examples/music-player/dragon/north-star-check.json`: byte-identical.
4. `du -sh examples/music-player/chrome examples/music-player/covers` is at most 50 MB in total.
5. The printed case count equals the manifest derivation for each platform and DPR.
6. `git diff --name-only 2d2e4dd..HEAD` lies inside allowed_files. There is no change under `packages/` except the one new test. `package.json` is unchanged.

**Stop if.**
- `packages/parity/src/chrome.ts`, `dpr.ts` or any `packages/**` source must change.
- A re-capture is not byte-identical.
- The committed reference exceeds 50 MB, which is an owner storage call.
- north-star-check.json changes.
- A case needs Dragon output (this package is the Chrome side only).
- A file outside allowed_files is needed.
- Verification fails twice.

## 5. Board updates for the PM

1. Record T010 as approved, with this note.
2. Add these tasks:
   - T011: WP1 NS-CTX (Worker, lane north-star-a);
   - T012: WP2 NS-REF (Worker, lane north-star-b);
   - T013: TREE (Worker, after T002 and T012);
   - T014: MQ-a (Worker, after the CASC merge);
   - T015: emitter split (after P5 is accepted);
   - T016: ELB-2 (ua lane, after the ELB merge);
   - T017: NS-LANE (after P5; device lease).

   Queue the engine, text, paint and runtime chain in section 2 as Judge-specified packages when their bases land.
3. T004 constraint: TXT1-C must not claim `examples/**`, `fixture-groups/contexts.ts` or `context-*` fixtures. It must decide the pinned `sans-serif` face and how Chrome is made to use it, both for the authored CSS and for the compiled web output. NS-REF's font key detects staleness until then.
4. The integrator's merge of `ns-contexts` runs `native:build` for ios and android at derived counts, after P4.
5. The PM or owner rules on FV (YouTube foreign-view slot) and SOV (script-driven inline styles): are they in checkpoint 3 or not? Record the answer in goal.md.
6. T999 constraint: checkpoint 3 is rejected unless:
   - all 8 NS lanes pass with none stale or not run;
   - `north-star:check` has 0 errors for every target;
   - the plants and capture trust pass on the NS lane.
7. Update GAPS.md's summary from the regenerated check after each merge. The PM does this; it is docs only.
