# T012 P3: shared lane core for iOS and Android: DONE

Worker, 2026-09-27, claude-code. Board: `docs/goals/milestone-2/state.yaml`, task T012. Branch `t012-p3-lane-core` from master 2beb4a2, worktree `/tmp/dragon-p3`. One commit, **4c1331c**, local only (`git remote -v` is empty; nothing pushed).

**Result: done.** Every verify item passes on 4c1331c. `pnpm test` passes 946/946: the 895 prior tests plus 51 new ones.

## What was built (T009 P3 items 1-9)

1. **`native-dump.ts`.** `NATIVE_DUMP_SCHEMA` is one data description of every field of `dragon.native-dump/1`: name, type, `required` and when it may be null. deviceEdges are integers on nodes and on lines.
   - The TS types (`NativeDump`, `DumpNode` and the rest) are inferred from the description by type-level mapping, so they cannot drift from it.
   - `validateNativeDump` walks the same description. It rejects:
     - a missing or extra key at every level;
     - a missing or empty node id, and duplicate ids;
     - an unknown parent;
     - non-integer deviceEdges;
     - out-of-range RGBA8 values and wrong lengths;
     - a null outside the reference lane.
2. **`targets.ts`.** It configures ios and android, each with the six lanes. Case lists are derived, never literal:
   - `layoutCaseIds()` comes from `layoutCases()`: 261 ids.
   - DPR sets come from `DPRS`, `SHARED_DPRS` and `EXTRA_DPRS`.
   - Corpus counts come from the parameters in `corpus.json` and `corpus-dpr.json`, and the P1 vectors come from `corpus-m1-cases.json`.
   - Vectors lanes hold 261 + 783 = 1044 vectors plus 503,824 corpus cases, on both targets.
   - Device lanes use the target's device DPRs: ios 2 and 3 (522 cases); android 2, 3 and 2.625 (783 cases). 2.625 appears only through `EXTRA_DPRS`, as `android-extra-420dpi`.
   - Tolerances (`GATE_DEVICE_PX`, `GATE_CHANNEL_DELTA`), `SAMPLE_RULES`, `DUMP_FAULTS` and `nativeLayoutProjection` are imported; both targets hold the same objects.
3. **`lanes.ts`, `cli/lanes.ts` and the `parity:lanes` script.**
   - Parity checks cover:
     - lanes, case lists (against the derived lists and across targets) and corpora;
     - named extras;
     - tolerance values, sample rules, dump faults and the projection;
     - the manifests against the derived counts.
   - A source scan of the six lane files looks for numeric tolerance literals.
   - Lane states are pass, fail, `blocked (owner tooling)` and `not run`. `blocked` is used only when the Swift or Kotlin tool lookup fails.
   - `--run-host` spawns `packages/translate/src/cli/native.ts swift|kotlin` and parses its counts and digests. It also runs the reference proof and writes `out/lanes.json`, which is deterministic and has no timings.
   - Without `--run-host`, it reads the committed `out/lanes.json` and fails if the file is stale.
   - `--require-all` fails on any lane that did not pass. `--plant <fault>` exits 1 when the fault is caught.
4. **`samples.ts`.** A deterministic generator over snapped device-px boxes, with the rules interior, border, outside, radius, clip and edge. Colour points are at least `SAMPLE_INSET_DEVICE_PX` (2, from T002 section 6) from any edge. Edge probes are 6-pixel scanlines from outside to inside.
5. **`native-compare.ts`.** The four checks:
   - (a) `checkAgainstChrome`: `|delta css px| * dpr <= GATE_DEVICE_PX` on nodes and line boxes, plus the anonymous-box rule from `compareLayout`.
   - (b) `checkApplied`: exact after canonical JSON.
   - (c) `checkPixels`: channel delta `<= GATE_CHANNEL_DELTA` (0). Edge positions come from coverage along the scanline, within `GATE_DEVICE_PX`.
   - (d) `checkAgainstEngine`: deviceEdges equal `snapEdges` of the engine output, and each frame equals deviceEdges / scale exactly.
   - `referenceDump` builds the TS-engine-plus-snapRect dump.
6. **Reference proof:** see the results below.
7. **Reports.** `report.ts` adds one trailing `nativeLanes` key to report.json, a `## Native lanes` section at the end of summary.md, and `<section id="native-lanes">` before `</body>` in index.html. All are read from `out/lanes.json`, and any lane that is not pass is shown as "not met". `cli/report.ts` prints one extra console line.
8. **Android profile.** `scripts/gen-profile-rows.ts` also writes `profiles/android.ts`: 1179 rows, exactly the iOS keys in iOS order, every row `unsupported` with `proofs: []`. It is exported from `internal.ts`. `KNOWN_TARGETS` and `COMMITTED_PROFILES` are unchanged.
9. **One projection.** `nativeLayoutProjection(compiled, environment, assignment)` is in `internal.ts`, and `iosLayoutProjection` is a one-line delegate to it. `project.ts` renames `iosLowered` to `nativeLowered` and changes nothing else: the digest, diagnostics and KNOWN_TARGETS are untouched.

## Commands and results (JAVA_HOME and ANDROID_HOME exported before each)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass; lockfile unchanged |
| `pnpm typecheck` | pass, exit 0 |
| `pnpm test` | pass: 41 files, 946/946. `vitest list` at 2beb4a2 (895 names) against 4c1331c (946): 0 base names missing, 51 added (native-projection 6, lanes 18, native-compare 13, native-dump 8, samples 6). No skip, todo or only. `git diff 2beb4a2 -- 'packages/*/test'` shows 5 added files only |
| `pnpm run layout:subset` | pass: 0 violations (exempt: validate.ts) |
| `pnpm run parity:capture` + `git status` | pass: clean, 0 changes under expected or emitted |
| `pnpm run layout:vectors && pnpm run profile:rows` | pass: `git diff --exit-code 2beb4a2 -- packages/layout/vectors ios.ts web.ts` exits 0. ios 1179, web 1179, android 1179 (all unsupported). A second `profile:rows` leaves android.ts byte-identical (sha1 6f3f6d24...) |
| `pnpm run layout:dpr-vectors` + `git diff --exit-code -- packages/layout/vectors packages/parity/expected-dpr` | pass, exit 0 |
| `pnpm run parity:dpr-report` | pass: 783/783 pass the gate; exact 8795/8795 at 2, 3 and 2.625; failed 0. Registry unchanged: nodes 18/18 exact, 18/18 non-exact under the fault; controls 15/15 exact and held |
| `pnpm run parity:report` + strip script | pass: 140/140 fixtures, 261 cases, failed 0. `/tmp/t012-strip.mjs` removes only the Native lanes section. After removal, report.json (13,026,688 B), summary.md (3,212 B) and index.html (2,995,380 B) are each byte-identical to the files generated at 2beb4a2 in this worktree before any edit (`/tmp/t012-base`) |
| `pnpm run native:gen` + `git diff --exit-code` (generated, corpus.json, corpus-dpr.json) | pass, exit 0 |
| `pnpm run native:swift` | pass: vectors 258/258, units 320000, engine 20258, library 22000; vectors-m2 3/3, vectors-dpr 783, engine-dpr 783, units-m2 120000, snap 20783; digests ae0f4087...48af38e and b9b2fb6b...10a8037; status pass (Apple Swift 6.4) |
| `pnpm run native:kotlin` | pass: the same counts and digests; status pass (kotlinc 2.4.20, JRE 17.0.20.1) |
| `pnpm run native:planted -- --target swift` / `--target kotlin` | pass: 8/8 each |
| `xcodebuild -scheme DragonLayout -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/t012-ios build` | BUILD SUCCEEDED; tree clean |
| `pnpm run parity:lanes -- --run-host` (twice) | exit 0 both times. ios and android layout-vectors-host pass with every count equal to the declared list and both digests. All 10 device lanes are `not run`. out/lanes.json is byte-identical on the second run and equals the committed file |
| `pnpm run parity:lanes -- --require-all` | exit 1, naming the 10 not-run lanes (5 per target) |
| `pnpm run parity:lanes -- --plant <fault>` | each exits 1 with its own first message (next table) |
| `pnpm run parity:lanes` (default) | exit 0; reads the committed lanes.json, which is not stale |
| Kotlin lookup injected as not found (lanes.test.ts) | android layout-vectors-host is `blocked (owner tooling)` with no counts, never pass; `notPassed` (the `--require-all` set) names it; pnpm test is green |
| `git diff --exit-code 2beb4a2 -- <protected list>` | pass, exit 0 |
| `git diff 2beb4a2 -- packages/parity/src/compare.ts` | one added line, `export const GATE_CHANNEL_DELTA = 0;`, and nothing removed |
| T038 item-21 greps on packages/layout/src | 0 / 0 / 0 |
| `git diff --name-only 2beb4a2..HEAD` | 20 files, all in allowed_files; no remote |

## lanes.json summary per target

| Lane | ios | android |
|---|---|---|
| layout-vectors-host | **pass**: 261 top-level + 261 at each of 2, 3 and 2.625 = 1044 vectors, plus corpora units 320000, engine 20258, library 22000, engine-dpr 783, units-m2 120000 and snap 20783 (504,868 in all); every suite count equals the declared count; digests ae0f4087...48af38e and b9b2fb6b...10a8037; Apple Swift 6.4 | **pass**: identical case list, counts and digests; kotlinc 2.4.20 / JRE 17.0.20.1 |
| layout-vectors-device | not run (P5), 504,868 | not run (P5), 504,868 |
| device-frames / device-applied / device-lines / device-pixels | not run (P5), 522 each (2 and 3) | not run (P5), 783 each (2, 3, and 2.625 `android-extra-420dpi`) |

Parity: pass, 0 problems. Tolerances `{ gateDevicePx: 1, channelDelta: 0 }`. Projection `nativeLayoutProjection` on both targets.

## Reference proof (TS engine plus snapRect; validate, (a) and (d))

| Target | DPR | Cases | Valid dumps | (a) vs Chrome at the DPR | (d) vs engine |
|---|---|---|---|---|---|
| ios | 2 (shared) | 261 | 261 | 261/261 (8,795 nodes and lines) | 261/261 (8,850) |
| ios | 3 (shared) | 261 | 261 | 261/261 (8,795) | 261/261 (8,850) |
| android | 2 (shared) | 261 | 261 | 261/261 (8,795) | 261/261 (8,850) |
| android | 3 (shared) | 261 | 261 | 261/261 (8,795) | 261/261 (8,850) |
| android | 2.625 (extra) | 261 | 261 | 261/261 (8,795) | 261/261 (8,850) |

- (a) compares the same 8,795 Chrome nodes per DPR as the DPR lane.
- (d) also covers the Dragon-only anonymous boxes and their lines: 8,850.
- No failures, so no stop_if was hit.

## Planted and negative tests

| Test | Result |
|---|---|
| `--plant missing-lane` | exit 1: `android lacks lane device-pixels (missing lane)` |
| `--plant dropped-case` | exit 1: `android device-frames: drops 1 declared case(s) at DPR 2: block-ua-divs (declared 261, configured 260)`, plus the cross-target mismatch |
| `--plant tolerance-literal-2` | exit 1: `android tolerance gateDevicePx 2 is not the imported GATE_DEVICE_PX 1` and `packages/parity/src/targets.ts:103: numeric tolerance literal: tolerances: { gateDevicePx: 2, ...` |
| `--plant unnamed-extra-dpr` | exit 1: `android device-frames: DPR 1.5 is neither shared (2, 3) nor an extra named in EXTRA_DPRS (unnamed extra DPR)` (and the other device lanes) |
| lanes.test.ts | each fault's first message matches its own pattern and none of the other three; the unplanted config has 0 problems |
| Edge +2 device px | fails (a) |
| Edge +1 device px | fails (d) (deviceEdges) and passes (a). The edge is picked where Chrome's edge x DPR equals the snapped edge |
| Applied value changed / key missing / extra key | fails (b) with one exact message each; equal values pass (2 compared) |
| Channel delta 1 at an interior point | fails (c) against a synthetic image. Edge shift of 1 device px passes, 2 fails; with a half-covered Chrome column, 0.5 passes and 1.5 fails; a moved or missing sample point fails |
| Missing node | the validator rejects a node without an id (`nodes[i].id missing-key`); dropping the node fails (a) and (d) |
| Snap disabled on android (truncated ints, unsnapped frames) | the dumps still validate; (d) fails in 333/522 cases at 2.625 and 3. In the rest, every edge already sits on a whole device pixel. ios with the snap passes |
| Validator | a missing key at all 65 described keys and an extra key at all 13 object levels are each rejected at the right path; non-integer deviceEdges are rejected on a node and on a line |

## Test-time delta

- Runs on 4c1331c:
  - 116.2 s wall (first run);
  - 99.6 s (final run).
- 2beb4a2 on the same machine, immediately after: 103.3 s (895 tests).
- The board baseline is 93-100 s.
- Delta: -3.7 to +12.9 s against the same-machine base, and at most +16.2 s against the top of the board baseline. That is far under the 5-minute limit.
- The new tests take about 20 s of CPU (lanes 21 s and native-compare 19 s wall inside the parallel run). The biggest costs are the all-case projection equality and the reference proof.

## Deviations

1. **`out/lanes.json` is committed with `git add -f`.** `packages/parity/out/` is gitignored, and `.gitignore` is not in allowed_files. report.json, summary.md and index.html stay untracked build outputs, as before, so the byte check compares them with a 2beb4a2 run made in this worktree before any edit.
2. **Dump schema changes from T002 1.2:**
   - Added:
     - `case.id`: the capture of a case is keyed by case id;
     - `nodes[].parent`: needed for the anonymous-box rule of (a).
   - Line entries are `{ frame, deviceEdges, baseline, start, end }`, absolute like node frames and with integer deviceEdges, instead of relative `top/left/width/height`.
   - `device.densityDpi` is dropped. `scale` carries the ratio on both platforms, so the schema stays symmetric.
   - A third lane value, `ts-reference`. Only a ts-reference dump may hold null in `expectedDigest`, `pixels`, `timing` and line `baseline`/`start`/`end`, because the TS engine has no text engine, no expected dump and no pixels. Device dumps may not.
3. **Tool lookups load at run time.** packages/parity does not depend on packages/translate, and package.json and tsconfig for parity are outside allowed_files. So `lanes.ts` loads `packages/translate/src/native.ts` by a run-time `import()` to reuse `swiftTool`, `kotlinTool` and `defaultKotlinLookup`, and restates the `KotlinLookup` shape structurally.
4. **"Fewer cases on one target".** The device lanes have ios 522 and android 783 by design: the 2.625 extra is named, as native-strategy.md section 2 and P3 item 6 require. The check requires the shared sets to be identical, and the vectors lanes to be identical in full (1044 + corpora). The ios vectors lanes include the platform-free 2.625 vector set, named through `EXTRA_DPRS`, because native:swift runs all 783 DPR vectors.
5. **`SAMPLE_INSET_DEVICE_PX = 2` is sample geometry, not a tolerance.** It is T002 section 6's "at least 2 device px from any edge". It is named, and it is not tolerance-named, so the literal scan does not flag it.
6. **`nativeLayoutProjection` keeps the blocked reason `the ios output is blocked or not configured`.** The lowered tree is still the ios lowering, and keeping the reason makes both functions' outputs identical, reasons included.
7. **`--plant` exit codes.** It exits 1 when the fault is caught, 2 if the unplanted configuration already fails, and 0 if the fault is not caught, which would make the verify fail.
8. **The library corpus count comes from `corpus.json` `cases.library`.** The manifest has no per-operation count. The other five corpus counts come from manifest parameters, and every count is cross-checked against the manifest's `cases`.

## For the board

- P4:
  - Emit the Swift and Kotlin dump encoders from `NATIVE_DUMP_SCHEMA`: `nullable: 'reference-lane'` fields are non-null on device.
  - Device lanes write `lane: 'ios-sim' | 'android-emu'`.
- P5: `layout-vectors-device` and the device-* lanes flip from `not run` to pass or fail through `lanesFile`. `--require-all` currently fails on exactly those 10 lanes.
