# T008 P2 device DPR: BLOCKED

Worker, 2026-09-27, claude-code. Board: `docs/goals/milestone-2/state.yaml`, task T008. Base: 8228b4e.

**Result: blocked.** A T008 stop_if fired: "Any DPR case fails the 1 device px gate after two engine-model fixes, or any node at any DPR is not exact in zoomed LU".

- The DPR captures, both guards, the zoom model and the DPR lane work.
- After two measured engine-model fixes, 768/774 DPR cases pass. Six fail:
  - `color-border-sides` fails the gate at every DPR. No engine change can fix it (see blocker 1).
  - `text-fractional-font-size` is non-exact at every DPR (blockers 2 and 3).
- I stopped there, as the card requires. I did not do the rest of the package: the DPR vector and snap vector writers, the translator and harness extension, the snap fault, and the P1 must-fixes.
- The partial work is on the local branch `t008-p2-dpr-blocked`, commit `69d6934` (parent 8228b4e). `master` is still at 8228b4e with none of my changes. Nothing is pushed.

## Blockers (case, node, Chrome value, engine LU)

LU are zoomed: 1/64 device px. Chrome values are shown as CSS px × 64 × DPR. Edges are left, top, right, bottom. Engine values include the two fixes below.

### 1. `color-border-sides`: Chrome does not zoom the *initial* border width. Fails the 1 device px gate at 2, 3 and 2.625.

Node `long` has `border-style: solid` and no border width.

| DPR | node | Chrome | engine |
|---|---|---|---|
| 2 | long | 384 14464 7168 17408 | 384 14464 7552 17792 |
| 2 | outer | 0 17792 51200 22656 | 0 18176 51200 23040 |
| 2 | html | 0 0 51200 26496 | 0 0 51200 26880 |
| 3 | long | 576 21696 10560 25920 | 576 21696 11328 26688 |
| 3 | html | 0 0 76800 39552 | 0 0 76800 40320 |
| 2.625 | long | 504 18712 9288 22456 | 504 18712 9800 22968 |
| 2.625 | outer | 0 22960 67200 29232 | 0 23472 67200 29744 |

Chrome 145 probe (Playwright 1.58.2, `--force-device-scale-factor=N`, run 2026-09-27), device px of a top border:

| CSS | DPR 1 | DPR 2 | DPR 3 | DPR 2.625 |
|---|---|---|---|---|
| `border-top-style: solid` (initial width) | 3 | **3** (computed 1.5px) | **3** (computed 1px) | **3** (computed 1.14286px) |
| `border-top: medium solid` | 3 | 6 | 9 | 7 |
| `border-top: 3px solid` | 3 | 6 | 9 | 7 |
| `thin` / `thick` | 1 / 5 | 2 / 10 | 3 / 15 | 2 / 13 |

- The initial `medium` stays 3 device px at every zoom. The compiler writes `{ kind: "px", value: 3 }` both for this case and for an authored `3px`, so the engine input cannot tell them apart.
- The correct fix needs one of two things, neither of which a Worker may do here:
  - a compiler change in packages/dragon, outside allowed_files, to carry the initial-width provenance or pre-apply the unzoomed width;
  - an owner-approved Chrome deviation, which the card bans.
- **Owner/PM decision needed.**

### 2. `text-fractional-font-size`: line-height numbers use the font size rounded, not truncated. Not exact at 2, 3 and 2.625.

| DPR | node | Chrome | engine |
|---|---|---|---|
| 2 | q:text0:line1 | 0 51893 8160 53237 | 0 51892 8160 53236 |
| 2.625 | q:text0:line1 | 0 68408 10714 70200 | 0 68407 10714 70199 |
| 3 | q:text0:line1 | 0 78066 12242 80114 | 0 78062 12242 80110 |

- `.q` is `font-size: 10.629px; line-height: 1.2`. The following nodes shift by the same amount: 116 non-exact node rows in total (/tmp/t008-after-2-fixes.txt).
- Probe: `13.7px` with `line-height: 1` gives 877 LU per line at **DPR 1**. The engine gives 876.
- Chrome's basis is `LayoutUnit::FromFloatRound(ComputedFontSize())`, not `LayoutUnit(float)`. The measured values fit it at every DPR: 13.7px at DPR 1, 2, 3 and 2.625 gives 877, 1754, 2630 and 2302; `.q` at 2 and 2.625 gives 1633 and 2143.
- This would be a **third** engine-model fix, and the card allows two.
- It also changes DPR-1 behaviour (see blocker 4).
- Analysis only, reverted: with it applied, only `color-border-sides` (all three DPRs) and blocker 3 fail. The count is 770/774, with exact nodes 8664/8671, 8663/8671 and 8664/8671.

### 3. `text-fractional-font-size` at DPR 3: a flex item's min-content width is 1 LU narrower in Chrome

| DPR | node | Chrome | engine |
|---|---|---|---|
| 3 | r2 | 9888 46209 17798 53625 | 9888 46209 17799 53622 |

- `r2:text0` itself is 9888 to 17799 in both. Chrome's box `r2` is 1 LU narrower than its text: 7910 against the text's 7911. 4 × 30.9px Ahem = 7910.4 LU, so the item width looks truncated while the line box is ceiled.
- The engine uses the ceiled width for both, which is what matched at DPR 1 (2637).
- The cause is not identified. It remains after the analysis-only third fix.

### 4. The measured Chrome rules change DPR-1 behaviour outside the corpora (ruling needed)

Fix 2 below, and the candidate fix of blocker 2, are what Chrome does **at DPR 1 too**:
- `line-height: 9.6171875px` gives 616 LU in Chrome at DPR 1. The base engine truncates to 615.
- `13.7px` with `line-height: 1` gives 877 in Chrome. The base engine gives 876.

So the base engine is already wrong against Chrome at DPR 1 for such inputs. No milestone-1 vector, capture or corpus input hits them (proof below). Still, applying the rules changes DPR-1 output for those untested inputs. The card says DPR-1 behaviour must be preserved bit for bit, and it also bans DPR-specific exceptions.
- **Ruling needed:** apply the Chrome rule everywhere (it fixes DPR 1; every DPR-1 artifact stays byte-identical), or keep it zoom-only. Keeping it zoom-only is a DPR-specific exception.

## What was built (branch `t008-p2-dpr-blocked`)

### Captures and guards (objective item 1): done and passing

- `packages/parity/src/chrome.ts`:
  - `chromeArgsAt(N)` replaces only the `--force-device-scale-factor` value.
  - `launchChrome(N = 1)`: every milestone-1 caller still launches at 1.
  - `CHROME_ARGS` is unchanged, so `report.run.flags` is unchanged.
- `packages/parity/src/dpr.ts`:
  - `SHARED_DPRS = [2, 3]`;
  - `EXTRA_DPRS = [{ dpr: 2.625, name: 'android-extra-420dpi', platform: 'android' }]`;
  - `ZOOM_GUARD` (0.5px, 0.333333px and 0.380952px) and `zoomGuard()`;
  - paths `packages/parity/expected-dpr/darwin-arm64/dpr-<N>/<case>.web.json`, outside `expected/darwin-arm64`, so platform.test.ts:119 is unaffected;
  - `DPR_GATE_DEVICE_PX = GATE_DEVICE_PX`, imported and never a literal.
- `pnpm run parity:dpr-capture` does the following:
  - It launches Chrome once per DPR.
  - It runs the zoom guard before and after the cases.
  - It checks each capture's `devicePixelRatio` through `openPage`'s guard and in the capture record.
  - It first proves the guard rejects a planted flag-1 launch with a context `deviceScaleFactor` of N.

Output, run twice:

```
planted flag-1 capture at DPR 2 rejected: zoom guard: a 0.5px border computes to 1px at DPR 2, not 0.5px; ...
planted flag-1 capture at DPR 3 rejected: zoom guard: a 0.5px border computes to 1px at DPR 3, not 0.333333px; ...
planted flag-1 capture at DPR 2.625 rejected: zoom guard: a 0.5px border computes to 1px at DPR 2.625, not 0.380952px; ...
DPR 2: zoom guard 0.5px border -> 0.5px; devicePixelRatio 2; 258 captures in 12.6 s
DPR 3: zoom guard 0.5px border -> 0.333333px; devicePixelRatio 3; 258 captures in 12.9 s
DPR 2.625: zoom guard 0.5px border -> 0.380952px; devicePixelRatio 2.625; 258 captures in 13.0 s
```

- The second run's 774 files are byte-identical to the first (`diff -r`), 38 MB in total.
- Each DPR set has the same 258 case ids as DPR 1, taken from `casesOf` over `FIXTURES`.

### Engine zoom model (item 2), plus two measured engine-model fixes

- `layout.ts` `zoomInput`:
  - At DPR 1 the input is returned as given, so the model is the identity.
  - At DPR N:
    - every `px` length is multiplied by N (`zoomCssPx`, double);
    - font sizes become `fround(fround(size) * N)` (`zoomFontSize`);
    - px line heights are multiplied by N, and number line heights are unchanged;
    - `devicePixelRatio` becomes 1, so borders snap to whole zoomed px.
  - Output LU are 1/64 device px.
  - It uses one object spread into `LayoutStyle` and per-union helpers. It stays inside the subset: `pnpm run layout:subset` reports 0 violations.
- **Fix 1: viewport** (`units.ts` `zoomViewportPx`). The ICB is `ceil(viewport × N)` device px.
  - Probe at 2.625: 300 → 788, 301 → 791, 299 → 785, 302 → 793, 401 → 1053. That is ceil, not round, because 790.125 gives 791.
  - At DPR 1 it is not applied, because Chrome viewports are whole CSS px.
  - It fixed `percent-height-chain` and `position-absolute-initial-containing-block[-rtl]` at 2.625.
- **Fix 2: px line-height** is `LayoutUnit::FromFloatRound(float(v))` (`units.ts` `fromFloatRound`, used in `inline.ts`).
  - Probe: 9.6px gives 1229 at DPR 2 (1228.8), 17.3px gives 3322 at DPR 3 (3321.6), and 9.6171875px gives 616 at DPR 1 (615.5).
  - It is applied at every DPR (see blocker 4).
- `snap.ts`: `snapEdges` and `snapRect`, using `units.ts` `snapEdge(lu) = floor((lu + 32) / 64)`. Edges are absolute (`absoluteRects`), right and bottom use the saturating `add`, sizes come from the snapped edges, and results are numbers. Exported from `index.ts`. It is not yet a translator root and has no tests, because I stopped before item 3.

**DPR-1 identity with fixes 1 and 2, measured:**
- `vitest run packages/layout`: 392/392. The 258 top-level vectors reproduce exactly.
- I ran the P1 corpus DPR-1 cases through `runEngineCase` in this tree and in a /tmp worktree at 8228b4e: 5,504 cases (258 vectors plus 5,246 engine-corpus inputs at DPR 1). The sha256 of inputs plus results is `b5929a4718134f19ccffcb0e9d6214206c1a1d0a1e3428a94023518a5184ff36` in both trees, so they are identical.

### DPR lane (item 5): built

- `compare.ts` `compareZoomedLayout`:
  - It uses the same `GATE_DEVICE_PX` on `|delta css px| × DPR`.
  - It judges exactness in zoomed LU: `round(px × 64 × N) === LU` and `|px × 64 × N − LU| <= 1/16`. Chrome's readback carries float error of about 0.004 LU.
  - `compareLayout` has the same code path and output as before. Only the anonymous-box section moved into a shared helper, with identical pushes and order.
- `pnpm run parity:dpr-report` needs no browser, writes no file and takes 11 s. Output with fixes 1 and 2:

```
DPR 2 (shared): 256/258 cases pass the 1 device px gate; 8644/8671 nodes exact in zoomed LU
DPR 3 (shared): 256/258 cases pass the 1 device px gate; 8609/8671 nodes exact in zoomed LU
DPR 2.625 (android extra android-extra-420dpi): 256/258 cases pass the 1 device px gate; 8644/8671 nodes exact in zoomed LU
parity:dpr-report: 768/774 cases pass the 1 device px gate; exact 8644/8671 at 2, 8609/8671 at 3, 8644/8671 at 2.625; failed 6
```

Progression of the failures:
- Zoom model alone: 765/774, exact 8594, 8583 and 8574. Failing: color-border-sides ×3, text-fractional-font-size ×3, percent-height-chain@2.625 and position-absolute-initial-containing-block(-rtl)@2.625.
- With fixes 1 and 2: 768/774.
- With the analysis-only third fix: 770/774.

## Not done (stopped per stop_if)

- Item 3 (rest): `snapEdges` as a translator root.
- Item 4: DPR vectors, snap vectors, `dpr-vectors.ts`, and the layout tests.
- Item 6: the regenerated Swift and Kotlin engines, the 1032-vector, engine and snap suites, and the snap planted fault.
- Item 7: the must-fixes (listTree root-only ignores, for-loop let capture, the Kotlin blocked-path test, the suite-timeout cause).
- The branch has **stale generated engines**: packages/layout/src changed without `native:gen`. So `pnpm test`'s freshness tests fail on the branch. `master` is untouched at 8228b4e.

**Planning finding for the PM:** the P1 tests pin the P1 corpus. `translate.test.ts` requires the suite sizes to equal exactly `{vectors: 258, units: 320000, engine: 20258, library: 22000}` and `FAULTS` to equal the 7 ids. `native-swift.test.ts` and `native-kotlin.test.ts` require exactly those four suite strings. The verify item "git diff 8228b4e -- 'packages/*/test' shows only new files" forbids editing them. Meanwhile the P2 verify asks for native:swift to print vectors 1032/1032, engine ≥ 21032 and a snap suite, and planted to include the snap fault. The workable reading is:
- keep `buildCorpus()` and `FAULTS` P1-shaped;
- add an extended corpus and an `ALL_FAULTS` for the CLIs and new tests;
- or allow those P1 test files to be updated.

A ruling would avoid ambiguity in the resumed package.

## Commands run

| Command | Result |
|---|---|
| `pnpm run parity:dpr-capture` (twice) | pass: 3×258 captures, guards printed as above, planted flag-1 rejected at all three DPRs, second run byte-identical |
| `pnpm run layout:subset` | pass: 0 violations (validate.ts exempt) |
| `npx tsc -b` (= `pnpm typecheck`) | pass, exit 0 |
| `pnpm run parity:dpr-report` | **fail**: 768/774, failed 6 (blockers above) |
| `npx vitest run packages/layout` | pass: 392/392 |
| DPR-1 corpus identity against the 8228b4e worktree | pass: 5,504 cases, same sha256 |
| Chrome probes (/tmp, Playwright cache, no download) | viewport ceil, line-height rounding, number line-height basis, initial border width (tables above) |

Not run, because the package stopped: the full `pnpm test`, native:gen, native:swift, native:kotlin, planted, xcodebuild, layout:vectors, profile:rows and parity:report cmp.
