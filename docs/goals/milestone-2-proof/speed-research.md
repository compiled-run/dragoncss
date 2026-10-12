# Speed research: tooling and runtime multipliers (2026-10-04)

**Status:** research only. Nothing here has landed. Every number below was measured on the 18-core M-series Mac on 2026-10-04 (load average 10–110 while measuring; the load is given where it matters), or read from logs in /tmp. The scratch patches used for the measurements are not committed.

**Rule kept:** every proposal leaves each check, tolerance and comparison exactly as strict as it is. Where a change could alter an output, the table says so, and says what proves it doesn't.

## 1. Baselines

### Full `pnpm test` on the Mac (26 landing-driver runs, /tmp/land-*-test*.log)

| | Wall | Cumulative import | Cumulative tests |
|---|---:|---:|---:|
| Quietest run (land-139 quiet, 185 files) | 445 s | 554 s | 3,627 s |
| Median of 26 runs | ~750 s | | |
| Worst (land-141, load 60–110) | 2,328 s | 4,051 s | 23,665 s |

- The same tree runs **5.2× slower** under load. The "import 4,713 s" figure in the brief comes from a loaded run. Import is cumulative wall time across 17 workers, not CPU.
- 9 of the 26 runs had failing files. Almost all were timeouts under load (`Test timed out`, `killed after 180 s`), and each one cost a quiet rerun of 435–2,028 s.
- **Solo vs in-suite** times for the same file:
  - corpus-dpr: 39 s solo, 437 s in a loaded suite (11×)
  - fonts-wiring: 92 s solo, 905 s (10×)
  - p6a-dash-oracle: 328 s solo, 754 s
- The largest multiplier on the Mac is therefore contention, not the toolchain.

### CI and GitHub runners (gh run view)

- **`ci.yml` checks** (ubuntu-latest, 4 vCPU): 180 s. Typecheck takes 20 s; `vitest run packages/layout packages/dragon` takes 146 s.
- **`capture-proof`** on standard macOS arm64 (3-core M1, 7 GB):
  - capture: 107–124 s
  - dpr-capture: 145–187 s
  - pixel-capture: 338–352 s

  The Mac's regen averages for the same steps are 64, 112 and 193 s. A free macOS runner is about 1.7× slower than this Mac, even with the Mac loaded.
- **Plan:** the org `compiled-run` is on the **free** plan, and the repo is public. Limits: 20 concurrent jobs, at most 5 of them macOS. Standard runners cost nothing.

### Regen steps (about 220 regen logs under /tmp, steps that ran)

| Step | Avg | Max |
|---|---:|---:|
| tw-sweep | 366 s | 1,462 s |
| pixel-capture | 193 s | 1,164 s |
| lanes-host | 180 s | 874 s |
| dpr-capture | 112 s | 715 s |
| break-capture | 112 s | 782 s |
| wpt | 99 s | 460 s |
| profile-rows | 80 s | 327 s |
| hit-capture | 72 s | 513 s |

A tw-sweep log breaks down as: 23,286 utilities, a Dragon compile phase of 168 s (16 worker threads), and 4,158 Chrome dual checks taking 214 s on one page.

### Typecheck

| Tool | Cold | Warm (no change) | One file touched |
|---|---:|---:|---:|
| `tsc -b` (TS 5.9.3) | 5.7 s | 0.7 s | 0.8 s |
| text-shaper test step | 0.6 s | | |
| tsgo 7.0.0-dev | 0.9 s | 0.17 s | |

tsgo reports 5 new errors from the ambient css-tree declarations (`generate`, `context`). Typecheck is not a bottleneck.

### Device lanes (land-*-devices.log, 7.4–17 min per devices run)

- **Host phase:** must finish before any device boots (`cli/lanes.ts:74-83`), which serializes about 6 min.
- **Boot:**
  - iOS: 16–37 s, up to 85 s.
  - Android: 37–56 s cold, 135–275 s while waiting on the memory budget. Always `-no-snapshot`.
- **App builds:** iOS `swiftc -O` takes 79–238 s; Android kotlinc plus d8 takes 50–138 s. Both are cached by source stamp, but only inside each worktree.
- **The vectors lane** is the longest single item: 94–206 s on iOS, 117–188 s on Android.
- **Batching:** the 507 cases already run in one launch.

### Native host suites (packages/translate)

- **Swift:**
  - Each build runs `-O -wmo` with no `-num-threads`, plus a separate engine `-typecheck` (`native.ts:15, 129-131`).
  - Swift binaries are cached by a key over source, flags and compiler, under `<worktree>/packages/translate/out`. Every worktree and land checkout therefore starts cold.
  - planted-swift compiles 7 faults: 14 swiftc calls, 400 s solo. It is the longest test file and on the suite's critical path.
- **Kotlin:**
  - A hello-world kotlinc takes 12.2 s wall (4.9 s CPU); the harness takes 44 s. kotlinc runs with no daemon.
  - `java -jar` startup is 0.08 s, so the JVM per suite is not the cost.
- **Timeout:** `SUITE_TIMEOUT_MS = 180_000` is wall time (`native.ts:217`). In land-141, 12 suites were "killed after 180 s" only because of load.
- **Compiler flags:** see section 3.5 for the swiftc flag measurements.

## 2. Where the CPU actually goes (CPU profiles of single files)

The profiles came from `--cpu-prof` on single test files and CLIs. The hot spots are in our own TypeScript, and every one is algorithmic. None needs a native or WASM port.

### 2.1 The compile digest: 75–90% of every Dragon compile

`packages/dragon/src/project.ts` hashes the canonical JSON of the whole compilation input for every compile. That input includes the three support profiles, which are megabytes of text, through a pure-JS SHA-256 in `digest.ts`. The JS SHA-256 runs at 70 MB/s; Node's native one runs at 2,142 MB/s, 30× faster. There are three costs:

1. **Pure-JS SHA-256 and UTF-8 over several MB per compile.** In a tailwind compile it is 74% of the time for `sha256HexBytes` plus 13% for `utf8`.
2. **The `canonicalInput` sort.** Its comparator calls `canonicalJson(a)` and `canonicalJson(b)` up to four times per comparison (`project.ts:718`). Assets are font bytes, which serialize to a 1.1 MB JSON number array per font. In fonts-wiring this sort was 62% of the time.
3. **`statusOf` / `provenContexts`** (`profiles/types.ts:25-33`) scan all ~3,900 profile rows on every lookup. That is 27% of a music-player compile.

**Patch A** is a 13-line scratch patch whose outputs are byte-identical:
- sort on precomputed `canonicalJson` keys;
- native `createHash('sha256')` through `process.getBuiltinModule('node:crypto')` when the string `isWellFormed()`, falling back to the JS hash otherwise (checked equal on ASCII, multilingual text and astral characters);
- a per-feature row index for `statusOf` and `provenContexts`, which keeps first-match order;
- a WeakMap memo of a `Uint8Array`'s JSON.

| Workload | Before | Patch A | Evidence |
|---|---:|---:|---|
| tailwind `compileUtility`, 583 utilities (load ~50) | 190 ms/compile | 20 ms | /tmp/sr-tw.mts |
| tailwind, 117 utilities (load ~10) | 65.8 ms | 4.0 ms | |
| music-player `north-star:check` | 4.37 s | 1.05 s | north-star-check.json byte-identical |
| fonts-wiring.test.ts | 98.8 s wall, 45 CPU-s | 9.2 s | 36/36 pass |
| parity.test.ts (load ~40) | 587 s | 177 s | 759/759 pass |
| layout+dragon (the CI set), 91 files | 210 CPU-s, 162 s wall | 141 CPU-s, 41 s wall | 2,055/2,055 pass |
| lanes-records.test.ts | 23.0 s | 9.6 s | 10/10 pass |

**Already in flight.** The native SHA-256 part already exists, unopened as a PR, on the branches `digest-native-hash` (REGEN-SPEED) and `compile-speed-work`. Measured on its own, it does not help every workload:
- tailwind compile: 65.8 → 4.6 ms;
- music-player check: 4.37 s → 4.37 s, unchanged, because the sort and `statusOf` dominate there.

The sort keys and the row index are new. They are the whole win on music-player (4.37 → 1.05 s) and most of fonts-wiring's (98.8 → 18.3 s before the memo). In parity.test, `statusOf` and `provenContexts` alone are 12% of the time.

**Patch B** goes further. It digests each profile by its SHA-256 instead of its full text, which takes the tailwind compile from 20 ms to 3.6 ms (53× over the baseline). It changes every committed digest value once, so it needs a regen commit, but nothing about a check changes.

### 2.2 Playwright's result serializer in Chrome captures

The tw-sweep `capture()` runs `page.evaluate` returning about 5 elements × ~350 `[property, value]` pairs. Playwright's own value serializer dominates that call. On 200 real sweep fixtures (Chrome 145, load ~100):

| Method | ms per capture | Identical to the baseline |
|---|---:|---|
| Playwright `setContent` + `evaluate` (today) | 53–62 | baseline |
| Playwright `evaluate` via `document.write` | 56 | 200/200 |
| **Playwright `setContent` + `evaluate` returning `JSON.stringify(...)`, parsed in Node** | **9.8** | 200/200 |
| the same, 8 pages in parallel | **3.1** | 200/200 |
| raw CDP `Page.setDocumentContent` + `Runtime.evaluate` (returnByValue) | 6.2–7.3 | 200/200 |
| raw CDP, 8 pages | 2.4 | 200/200 |

Without the JSON string, 8 pages gave nothing: 64.6 ms vs 58 ms on 1 page. The bottleneck is Playwright's serializer on the single Node thread, not Chrome.

This matters for the in-flight `tw-sweep-parallel` branch (REGEN-SPEED), which opens 8 pages but keeps the structured `evaluate`. I expect little gain from it on the Chrome phase until the result comes back as a JSON string. That is an estimate from this microbenchmark, not from that branch.

Moving to raw CDP or puppeteer-core gains only about 1.3× over the JSON-string fix, so Playwright stays.

**Caveat:** `JSON.stringify` turns `-0`, `NaN` and `±Infinity` into `0` or `null`. Use a replacer that tags them, so the strings stay lossless.

This did not speed up parity.test.ts's `captureFixture`: 177 s became 181 s, because its payloads are small. The win applies where results are large: the tw-sweep and media-sweep computed-style dumps.

### 2.3 Serial Chrome loops

pixel-capture opens one context per case, serially, for each DPR. On 43 real cases at DPR 2, comparing bytes with the committed PNGs:

| Contexts in parallel | ms per screenshot | Byte-identical PNGs |
|---:|---:|---|
| 1 | 70 | 43/43 |
| 4 | 21 | 43/43 |
| 8 | 14 | 43/43 |

The software-raster path is deterministic. `--recheck` and capture-proof already prove byte identity.

### 2.4 Other hot spots found

- **p6a-dash-oracle.test.ts** (328 s solo): 77% of the time is in the test's own geometry. `overlaps`, `proj`, `pairs` and `cover` run for every pixel and every op, rebuild polygons, and spread arrays into `Math.min(...)`. Precomputing the polygons once per op, plus a bounding-box early-out ahead of the same exact predicate, should give about 10×. `decodePng` is a further 8%: 10–16 ms per 0.48 Mpx, or 30–47 Mpx/s, from a branchy per-byte unfilter. Hoisting the filter type out of the row loop gives about 3×.
- **corpus build** (`buildCorpus` 10.6 s, corpus-dpr 39 s): this is the translated harness's own JSON parser plus rt-hit. That parser is meant to mirror the Swift and Kotlin code, so leave it alone. Instead, cache the built corpus on disk, keyed by its source hash, across the 11 test files that build it.
- **cascade-var.test.ts:** `substituteSteps` recomputes `used.split(SEPARATOR).join('').length` on strings up to 2 MB, which is quadratic. Tracking the length separately fixes it. This is a small file.
- **The CSS front end is not hot.** In the music-player profile, the tokenizer, parser, cascade, selectors and value parsing are each under 2% of the time. Replacing css-tree with Lightning CSS or a native parser would save nothing, and it would put Chrome-exact parsing at risk.

## 3. Tool and runtime options, measured

### 3.1 Vitest configuration

Measured on the CI set (packages/layout + packages/dragon, 91 files), one run each under the heavy lease, load 37–55.

| Config | CPU (user+sys) | Wall | Note |
|---|---:|---:|---|
| default (vite module runner, forks, isolate) | 210 s | 162 s | |
| `experimental.viteModuleRunner: false` + `execArgv: --conditions=dragon-internal` (Node 24 type stripping) | 209 s | 114 s | wall confounded by load |
| `experimental.fsModuleCache` cold / warm | 199 / 196 s | 80 / 83 s | |
| default + patch A | 141 s | 41 s | |
| native runner + patch A | 144 s | 39 s | |

Single files at load ~10 (default → native runner):

| File | Total | Import |
|---|---|---|
| inline.test | 4.6 → 2.6 s | |
| cascade-var | 7.3 → 6.5 s | 0.96 → 0.21 s |
| lanes-records | 23 → 18.7 s | 3.5 → 1.0 s |

An import-only file went from 13–28 s / 4.5 CPU-s down to 4.1 s / 1.9 CPU-s.

**Verdict:** the native runner is worth turning on, for about 5% of CPU and a 0.5–2.5 s import saving per heavy file. Only `emulator-log.test.ts` uses `vi.mock` (of `node:fs`), so it needs the default loader, through its own project or by keeping `nodeLoader`. Neither config is a multiplier. The real multipliers are patch A and less contention.

`isolate: false` was not measured. It would share module state across files, which is a risk to test independence, so I don't recommend it.

### 3.2 Other test runners

- **Bun 1.3.14** (`bun test --conditions=dragon-internal`):
  - inline.test: 1.24 s vs 4.6 s for vitest, because its `expect` is native (47k `expect` calls).
  - all of packages/layout: 28 s in one process, 1,070 of 1,072 passing. One failure is `node:module` `stripTypeScriptTypes` missing.
  - **Not recommended.** JavaScriptCore's `Math.*` may differ from V8 in the last ulp, and the vectors and the oracle assume V8. It also lacks the fork isolation the suite relies on, its Playwright support is partial, and it would mean migrating 185 files.
- **`node --test`:** no `expect`. It would mean rewriting about 4,800 tests' assertions, a large effort for less than the native vitest runner already gives.

### 3.3 Parsers: Yuku, Oxc, tsgo (owner question)

- **What translate uses.** `packages/translate` uses the TypeScript compiler API with a full `ts.Program` and the type checker. There are 47 `checker.*` calls in `lower.ts` (`getTypeAtLocation`, signatures, `isArrayType`, …).
- **What the alternatives give.** Yuku and Oxc produce ESTree / TS-ESTree ASTs with no type information. The node shapes also differ from `ts.Node` (for example `TSTypeReference` vs `TypeReferenceNode`, and `range` vs `pos/end`). Neither could replace the checker.
- **Parse speed**, 76 files and 1.28 MB of engine and compiler source:

  | Parser | Time | Throughput |
  |---|---:|---:|
  | TypeScript `createSourceFile` | 42 ms | 30 MB/s |
  | oxc-parser 0.x | 12.9 ms | 99 MB/s |
  | yuku-parser 0.17 | 6.4 ms | 201 MB/s |

  On the 2.2 MB web profile: 36, 12.5 and 4.8 ms.
- **What that would save.** `lowerAll()` takes 0.82 s in total, of which TypeScript's parse and check is about 0.6 s. The most a parser swap could save is about 35 ms per run. **Not worth it.**
- **tsgo:** 6× faster cold, but a full typecheck is only 5.7 s, so it saves about 5 s per landing. Adopt it when tsgo is stable and the css-tree declaration errors are fixed. **Low priority.**
- **Biome:** there is no lint step to speed up.

### 3.4 Native or WASM ports (Rust, Zig, napi-rs)

- **Hashing:** Node's built-in crypto is already native at 2.1 GB/s, so a `napi-rs` hasher adds nothing. WASM SHA-256 (hash-wasm) only matters if the browser build must avoid `node:crypto`; the JS fallback can stay for that.
- **PNG decode:** a native decoder such as sharp or libspng would do about 10× better than 30–47 Mpx/s. But decode is under 10% of any profile, and a JS fix gets about 3×.
- **JSON of large vector files:** `JSON.parse` is already native. The slow parser is the harness's own, which deliberately mirrors the native code.
- **Layout engine:** it is translated to Swift and Kotlin, so it stays in TypeScript. It is also not hot in any profile.

**Verdict:** no port is justified. The gains come from algorithms (sections 2.1–2.4).

### 3.5 Swift and Kotlin host builds

- **swiftc flags** (37 files, 840 KB of generated Swift, heavy lease, load 20–50):

  | Flags | Wall | CPU |
  |---|---:|---:|
  | `-O -wmo` (today) | 87 s | 36 s |
  | `-O -wmo -num-threads 8` | 88 s | 33 s |
  | `-O -j 8` (batch mode, no WMO) | 34 s | 24 s |
  | `-Onone -wmo` | 19 s | 5 s |

  - `-num-threads` gives nothing.
  - Batch mode is 2.6× faster to build. Its binary loses cross-file inlining, so it runs slower (not measured).
  - `-Onone` builds 4.6× faster, but its binary is much slower. That risks the 180 s suite limit, so use it at most for planted builds, after measuring their run time.
  - Swift has no fast-math, so none of these flags changes floating-point results.
- **Recommendations, in order:**
  1. **One machine-wide build cache** (for example `~/.cache/dragon/native/{swift,kotlin,ios-app,apk}/<existing key>`). The key already covers sources, flags and compiler version, and `publish()` already renames atomically. Most PRs don't touch packages/layout or packages/translate, so planted-swift (14 swiftc calls), planted-kotlin (7 kotlinc calls), native-*, native-dpr-*, and the app builds all become cache hits after the first worktree builds them. Planted-swift drops from 400 s to its run time.
  2. **Build the 7 planted faults concurrently.** `-num-threads` measured no gain. Batch mode (`-O -j 8`) or `-Onone` builds faster, but only for planted builds, and only after their suites' run time is measured.
  3. **Judge the 180 s suite timeout on CPU time, or give native suites their own vitest project with low concurrency.** A load spike then stops failing them, and a real infinite loop is still caught.
- **Keeping a JVM warm, or a kotlinc daemon:**
  - kotlinc cold is about 12 s of fixed cost per compile, and there are 7–10 compiles per suite run, so a daemon (Kotlin build-tools API or Gradle) would save about 1–2 min per cold run. The shared cache removes most of those compiles anyway.
  - A long-lived harness process saves about 0.08 s per suite, which is nothing.

### 3.6 Chrome capture

- Keep Playwright 1.58.2 and the pinned headless-shell (chromium-1208). `launchChrome` already checks the version.
- Switching between headless-shell and "new headless", or between Playwright and puppeteer-core, would change the browser binary, which is a risk to the pixel proofs. It would also gain only about 1.3× over the fixes in 2.2.
- The multipliers are:
  - return JSON strings from `evaluate` (5.5×);
  - run 4–8 pages or contexts in parallel per browser (3–5× more);
  - run the DPRs' browsers concurrently.

  The byte-compare in capture-proof and `--recheck` already prove the outputs identical.

### 3.7 Device lanes

Measured from logs; I booted nothing.

| Change | Saving |
|---|---|
| Start device boots while the host lanes run; only the vectors verdict needs the host result | 3–6 min per devices run |
| Machine-wide app build cache | 1–4 min on a worktree's first run |
| Android quickboot from a golden snapshot (`-snapshot golden -no-snapshot-save`) instead of `-no-snapshot`, invalidated on image, config or provisioning change, with `prepareAvd` and `liveProblems` still run | about 40 s per emulator |
| Keep the iOS sims booted between runs, or `simctl clone` a prepared golden sim; the app is reinstalled every run anyway | 16–85 s |
| Install once per device instead of 3 times | 10–40 s per device |
| Split the vectors suites across a target's idle devices | 1–2 min; changes the record format (`VECTOR_DEVICES`) |

Keep `-gpu swiftshader_indirect`: changing the renderer changes the pixel evidence.

### 3.8 CI platforms

| Option | Cost | What it gives Dragon |
|---|---|---|
| GitHub standard runners, public repo, free plan | $0 | Up to 20 concurrent jobs: ubuntu 4 vCPU / 16 GB, with KVM, so the Android emulator runs accelerated on Linux x64. At most 5 macOS jobs, each a 3-core M1 / 7 GB, about 1.7× slower than this Mac. The macOS arm64 runners have no nested virtualization, so no Android emulator; the iOS sim works. |
| GitHub larger runners | Linux 16-core $0.042/min; macOS M2 Pro 5-core xlarge $0.102/min | Billed even on public repos. |
| Blacksmith | Linux about $0.03/min at 16 vCPU (unverified); macOS M4 $0.08/min | Has an **open-source sponsorship program**, the best paid fit: Linux KVM plus M4 macOS. |
| Namespace / Depot / WarpBuild | macOS $0.08–0.18/min | No open-source program found. |
| Cirrus Runners, BuildJet | | Both shut down (2026). |
| Scaleway M4 Pro (dedicated) | €0.49/h | |
| MacStadium open-source program | free Mac mini | Only for projects without commercial funding. |
| This Mac as a self-hosted runner | $0 | 18 cores / 48 GB, the fastest macOS available. The repo is public, so it must run only on `push` to this repo's branches (never `pull_request` from forks), in a restricted runner group, ideally ephemeral and inside Tart VMs (at most 2 macOS VMs per host). It competes with the lanes for the same cores, the problem section 1 measured. |

**reactnativefeel.com/deploy** ("React Native Deploy", `rnd build` / `rnd submit`) reimplements EAS Build and Submit as GitHub Actions workflows, so a public repo builds for free on GitHub's standard runners. Dragon doesn't use EAS or Expo. The only lesson that carries over is the one CI-FULLTEST is already applying: free standard runners on a public repo. It adds no cores and no macOS concurrency.

**How the work splits:**
- **Linux (20 free jobs):** the platform-free suites and everything that doesn't compare against darwin captures. This includes the Android emulator lanes, which get KVM there.
- **macOS:** the 5 free macOS jobs (slow), plus this Mac or Blacksmith M4 for swiftc, the iOS sim and the reference Chrome captures. The pixels must match the macOS 26 reference byte for byte; capture-proof already showed that the xcode-27 image differs.

## 4. Ranked recommendations

Effort: S is under a day, M is 1–3 days, L is more.

| # | Change | Expected speedup (evidence) | Effort | Risk to proof strictness | Owner |
|---:|---|---|:---:|---|---|
| 1 | **Patch A: fast compile digest.** Precomputed sort keys, native SHA-256 with the JS fallback, profile row index, bytes-JSON memo. | Compile 9.5–16× faster. parity.test 587→177 s, fonts-wiring 99→9 s, CI set 210→141 CPU-s and 162→41 s, tw-sweep compile phase about 168→20 s. (2.1) | S | None: digests are byte-identical and every suite passed. Add a test that cross-checks the native and JS hashes, surrogates included. The memo assumes asset bytes are never mutated after a compile, so drop it if that can't be guaranteed: it is only worth about 2× on fonts-wiring. | native-hash part: REGEN-SPEED (`digest-native-hash`, in flight); sort keys and row index: same lane, a second small PR |
| 2 | **Stop oversubscribing the Mac.** Run `pnpm test` with the native/planted/Chrome files in their own vitest project with `maxWorkers` 2–4. Count each test run as more than one lease slot. Judge the 180 s suite timeout on CPU time. | The same tree runs in 445 s quiet and 916–2,328 s loaded, and 9 of 26 land runs needed a quiet rerun of 435–2,028 s. (1) | S–M | None if the timeout still bounds CPU. A wall-clock cap can stay as a far backstop (for example 15 min). | CI-FULLTEST (test config), LAND-BATCH (lease) |
| 3 | **Machine-wide native build cache** for the Swift and Kotlin harnesses and the iOS and Android app builds, under the existing keys, outside the worktree. | planted-swift is the longest file at 400 s solo and becomes a cache hit on most PRs. Saves 1–4 min of app builds per worktree, and 6–8 min of CPU per test run when warm. | S | None: the key already covers sources, flags and compiler version. | DEVICE-SHARD (apps), SLOW-SPLIT (host harness) |
| 4 | **Chrome: return JSON strings from large `page.evaluate` calls** (lossless replacer), and use 4–8 pages per browser in tw-sweep and media-sweep. | 53→9.8 ms per capture, and 3.1 ms with 8 pages, 200/200 identical. tw-sweep's Chrome phase about 214→15–40 s. Together with #1: tw-sweep 366 s → about 40–60 s (estimate), and sweep.test.ts likewise. | S | Low. The replacer keeps `-0`, `NaN` and `±Infinity`, and the tw-sweep snapshot compare still gates. | REGEN-SPEED |
| 5 | **Parallel pixel, dpr and break captures:** 4–8 contexts per browser, and the 3 DPR browsers concurrently. | 70→14 ms per screenshot, 43/43 byte-identical. pixel-capture 193 s → about 40 s (estimate). Also cuts capture-proof's 338–352 s on GitHub macOS. | S–M | Low. capture-proof and `--recheck` already byte-compare. Keep the zoom guard and the software-raster check per browser. | REGEN-SPEED |
| 6 | **Patch B: digest profiles by hash** instead of full text. | Compile 20→3.6 ms on top of #1 (53× over the baseline). | S | None. Digest values change once (regen commit), and no check changes. | same lane as #1 |
| 7 | **Device run overlap:** boot devices during the host phase; Android quickboot from a golden snapshot; keep iOS sims booted; install once per device. | 3–6 min overlap, plus about 40 s per emulator, plus 16–85 s per sim. A devices run of 7–17 min → about 4–10 min (estimate). | M | Low. Snapshot state is re-proven by `prepareAvd` and `liveProblems`. Keep swiftshader. | DEVICE-SHARD |
| 8 | **Algorithmic fixes in the slow oracles:** p6a-dash-oracle geometry (per-op polygon precompute plus bbox early-out ahead of the same predicate), `decodePng` unfilter, and a cached corpus build across the 11 translate test files. | p6a-dash-oracle 328 s solo → about 40–60 s (estimate; 77% of its time is that geometry). corpus about 10 s per file × 11. | S–M | None if the predicates are unchanged. Add a test that the fast path agrees with the old one on every pixel of the corpus. | SLOW-SPLIT |
| 9 | **Vitest native module runner** (`experimental.viteModuleRunner: false`, `execArgv: ['--conditions=dragon-internal']`), with emulator-log in a project on the default loader. | About 5% CPU. Import per heavy file 3.5→1.0 s, inline.test 4.6→2.6 s. Not a multiplier. | S | None: the same tests and assertions. | CI-FULLTEST |
| 10 | **CI capacity:** shard the platform-free suites across up to 15 free Linux jobs, keep 5 for macOS, and ask Blacksmith's open-source program for M4 macOS minutes. Use this Mac as a push-only, ephemeral self-hosted runner only if the lease is made to count it. | Today's CI set is 146 s on one 4-vCPU job. After #1 it is about 41 CPU-s per 4-vCPU shard set. Darwin steps on M4 run about 2× faster than on the free 3-core M1 runners (estimate). | M | None. Keep the reference platform (macOS 26 arm64) for byte-compared captures, and prove a new runner image with capture-proof first. | CI-FULLTEST |

**Not recommended**, each with the measurement above:
- Bun or `node --test` (3.2): float and runtime risk, and a migration effort.
- Yuku or Oxc in translate (3.3): it needs the type checker, and saves at most 35 ms.
- Lightning CSS or a native CSS parser (2.4): under 2% of a compile, and a risk to Chrome-exact parsing.
- Rust, Zig, WASM or napi ports (3.4): no hot loop needs one.
- Raw CDP or puppeteer-core instead of Playwright (2.2): 1.3× more than the JSON fix, and a new protocol layer.
- `isolate: false` (3.1): module-state leakage.
- tsgo (3.3): saves 5 s; revisit when stable.

### Quick wins doable today (each one small PR, outputs byte-identical)

1. **Patch A** (#1): open `digest-native-hash` as a PR, then add the `project.ts` sort keys and the `profiles/types.ts` row index.
2. **JSON-string `evaluate`** in `tailwind-sweep/src/chrome.ts` (#4), with a lossless replacer. Without it, `tw-sweep-parallel`'s 8 pages measured no faster than 1 page.
3. **8 parallel pages** in the tw-sweep Chrome loop, and contexts in pixel-capture (#4, #5).
4. **`OUT` and the app caches moved to a machine-wide directory** (#3).
5. **The vitest native runner** (#9).
