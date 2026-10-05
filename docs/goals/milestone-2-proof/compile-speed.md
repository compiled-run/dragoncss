# COMPILE-SPEED: compile time per target, measured and driven down (running results)

**Lane:** COMPILE-SPEED, 2026-10-04/05. Owner request: research the target compile times and cut them until the next change is a marginal gain.
**Stop rule:** a target stops when its next candidate change would save under about 10% of that target's remaining time.
**Machine:** the shared 18-core Mac, every number from one heavy-lease job. The load average was 20–65, so compare numbers within a row (both columns come from the same job), not across rows.

## Benchmarks (reproducible)

- **Dragon compile:** `node --conditions=dragon-internal scripts/bench-compile.ts [small|large|music|all|web-only|ios-only|android-only] [--reps N]` (added in #156). Prints the wall time per suite and a digest over every output file, asset, target state and diagnostic. A change that should be byte-identical must keep the digest.
  - `small`: the smallest layout fixture, ltr and rtl.
  - `large`: the 10 largest fixtures by source size, every direction (17 compiles).
  - `music`: the music player, web + ios + android, 7 font assets.
  - `all`: every parity fixture in every direction, 506 compiles (the "507 cases").
- **Swift and Kotlin harness builds:** a scratch script builds the committed harness with each flag set in /tmp, runs both corpora, and checks every suite passes.
- **App builds:** `buildIos()` and `buildAndroid()` from `packages/parity/src/native-host.ts` (no device run), then the same sources rebuilt with each flag set, comparing the class bytes for Kotlin.

## 1. Dragon compile (createProject / compile, web + ios + android)

| Suite | master | + #156 (sort keys, row index) | + #160 (digest by hash) | + native SHA-256 (REGEN-SPEED) and both |
|---|---:|---:|---:|---:|
| small, median of 3 | 119–137 ms | 112 ms | 14 ms | **3 ms** |
| large (17 compiles), median of 3 | 1,638–2,169 ms | 594 ms | 1,279 ms | **200–257 ms** |
| music player, median of 3 | 570–735 ms | 185 ms | 182 ms | **15–16 ms** |
| all 506 parity compiles | 19.4–26.4 s | 13.0 s | 7.6 s | **1.05–1.14 s** |

The PR columns are each one PR on master, measured back to back with master in the same job (the master range covers the two jobs). The last column has all three changes.

**Where the time went** (`--cpu-prof`, the 10 largest fixtures, native SHA-256 already in):
- `statusOf` / `provenContexts`: 51% (a linear scan of ~3,900 profile rows per lookup). #156 indexes the rows by feature.
- The `canonicalInput` sort: 19% (`canonicalJson` of font bytes on both sides of every comparison). #156 serialises each entry once.
- Profile text and font bytes as JSON in every digest: the rest of the digest cost. #160 digests them by SHA-256 (digest values change once; regen commit).

**Remaining profile** (all 506 compiles, all changes in, ~1 s of compile): no function above 13% of the compile. The largest are `resolveTree`'s per-element loop over every longhand (`resolve.ts` visit, 13% self), stylesheet parsing (14% inclusive), and web CSS emit (7%). The fixture reader in the parity pipeline (`fontFaceUrls`, outside the compiler) costs about as much as the compile itself.

**Stopped: marginal.** A compile is now 2 ms on average. The next candidate (`resolve.ts` visit) would save at most about 10% of the remaining ~1 s across 506 compiles, under the threshold. The CSS front end (parse, cascade, selector matching, values) is under 2% each in the music player profile, as the research found.

## 2. Swift harness build (packages/translate, host)

| Flags | Build | Run (both corpora) | Note |
|---|---:|---:|---|
| `-O -wmo` (today) | 19.0 s (+2.3 s engine typecheck) | 68 s | best total |
| `-O -j 8` (batch, no WMO) | 6.0 s | 150 s | run 2.2x slower |
| `-Onone -wmo` | 3.4 s | 389 s | run 5.7x slower |
| `-Onone -j 8` | 1.9 s | 445 s | |

The research measured `-num-threads 8` as no gain (87 vs 88 s).

| Files (cold = a new checkout today; warm = shared cache hit) | cold | warm (#158) |
|---|---:|---:|
| planted-swift + native-swift | 741 s | 262 s |
| planted-kotlin + native-kotlin | 270 s | 138 s |

**#158:** the harness builds move to one machine-wide cache (`~/.cache/dragon-native`, or `DRAGON_NATIVE_CACHE`, which CI can point at `actions/cache`). The key is the same as before (sources, flags, compiler version). Every PR that doesn't change the engine or the translator now gets a hit in every worktree and land checkout.

**Stopped: marginal** for the common case. After #158 a build happens only when the engine or translator changes. On such a PR, `-O -wmo` is still the fastest build plus run. The candidates left:
- Overlapping the 2.3 s engine `-typecheck` with the build: about 10%, at the threshold.
- `-Onone` for the 9 planted builds only: about 9 × 16 s on an engine PR. It changes how the binary under test is built, so it is listed under design decisions, not done.

## 3. Kotlin harness build

Two repetitions of each flag set, back to back in one job. The class bytes were identical across every flag set.

| Flags | Harness build, rep 1 / rep 2 | Android app kotlinc, rep 1 / rep 2 |
|---|---:|---:|
| today (`-nowarn -include-runtime`; app `-J-Xmx8g`) | 31.7 / 8.6 s | 94.6 / 29.6 s |
| `-Xbackend-threads=0` (parallel codegen) | 19.7 / 7.8 s | 75.3 / 31.0 s |
| `-J-XX:TieredStopAtLevel=1` (C1 only) | 14.5 / 7.7 s | 51.0 / 50.7 s |
| both | 5.8 / 6.6 s | 41.0 / 42.8 s |

Rep 1 ran under heavy load and rep 2 on a quieter machine. Read rep 2:
- Harness: the flags save 1–2 s of 8.6 s, about the size of the run-to-run noise.
- App: C1-only makes the large compile slower (29.6 → 50.7 s), and parallel codegen is neutral.

Running the harness (`java -jar`, 0.08 s per suite) is not the cost.

**Stopped: marginal.** After #158 a Kotlin harness build happens only on engine or translator PRs, and the best flag set saves about 2 s per build there. A warm compiler daemon (the Kotlin build-tools API) would save kotlinc's ~5–10 s start-up per build on those PRs only, for a new long-lived process to manage. Not worth it.

## 4. App builds for the device lanes (packages/parity/src/native-host.ts)

There is no xcodebuild and no Gradle here. The iOS host app is one `swiftc -O -j <cores>` call. The Android APK is aapt2, kotlinc, d8, zipalign and apksigner, run directly. Both are already reused by a source stamp, but only inside one worktree. Sources: 124 Swift files, 19 MB, of which **18 MB is generated case code** (507 cases of `LayoutBox(...)` construction expressions). The engine is 0.66 MB.

| Build | Time | Note |
|---|---:|---|
| iOS `swiftc -O -j 18` (today) | 94–119 s | |
| iOS `swiftc -O -wmo -num-threads 18` | 784 s | much worse |
| iOS `swiftc -Onone -j 18` | 11 s | 8.5x faster to build; see design decisions |
| Android kotlinc (today) | 23–30 s quiet, 95–188 s under load | |
| Android kotlinc `-Xbackend-threads=0` | 19.6–31 s | identical class bytes; neutral within noise |
| Android d8 `--release` with kotlin-stdlib | 15 s | |

## Design decisions left (large wins this lane did not take)

1. **iOS host app: the case code at `-Onone`, the engine at `-O`.** Build 94–119 s → about 11–15 s. The 18 MB of case code is straight-line construction that `-O` gains nothing on. There are two ways to do it:
   - put the cases in their own module (the engine imported with `@testable`, or made public); or
   - compile the case files at `-Onone` and the rest at `-O`, then link.

   Swift has no fast-math, so float results don't change. But it changes how the binary on the device is built, so it needs DEVICE-SHARD and the owner.
2. **Planted harness builds at `-Onone`:** 9 builds, about 16 s each, only on engine or translator PRs. The planted check (each fault fails at least one case) stays as strict, but the binary it checks is built differently.
3. **A machine-wide cache for the app builds** (as #158 does for the harness): 1–4 min on each worktree's first device run. The device lanes are owned by DEVICE-SHARD.

## PRs

| PR | Change | Status |
|---|---|---|
| #156 | Sort keys serialised once and the profile row index; adds scripts/bench-compile.ts | CI green, UNREVIEWED (Macroscope limit), clean head dbc6f38887 |
| #158 | Machine-wide Swift/Kotlin harness build cache. After review: atomic prune (rename to trash, then delete), a 3 GB LRU cap, OS/arch in the Swift key, merged with #164 | CI green, UNREVIEWED, clean head 1a40baf383 (cap never evicts an entry used in the last 2 h; invalid DRAGON_NATIVE_CACHE_MAX_MB throws) |
| #160 | Digest profiles and asset bytes by SHA-256 (regen commit; device step pending) | CI green, UNREVIEWED, clean head 1a85b27d5e |
| #164 | Fix: a stale harness cache entry (the landing driver's ignored-file cleanup deletes the artifacts but keeps the directories) is replaced, never returned without its artifact. This was the root cause of land-147's "Unable to access jarfile" | merged |

## Where each target stopped

| Target | Baseline | Now (all PRs) | Next candidate and its share of what remains |
|---|---:|---:|---|
| Dragon compile, 506 parity cases | 19.4–26.4 s | 1.05 s (25x) | `resolve.ts` visit, ≤10%: marginal |
| Dragon compile, music player | 570–735 ms | 15 ms (46x) | none above 10% |
| Swift harness, a new checkout (planted + native files) | 741 s | 262 s (warm cache) | the remaining time is suite run time at `-O`. Engine `-typecheck` overlap ≈10%. Planted `-Onone` needs a decision |
| Kotlin harness, a new checkout (planted + native files) | 270 s | 138 s (warm cache) | JVM flags save ~2 s per build, only on engine PRs: marginal |
| iOS host app | 94–119 s | unchanged | `-Onone` for the case code, 8.5x. Needs a design decision (above) |
| Android host APK (kotlinc + d8) | 38–203 s | unchanged | kotlinc flags neutral. A d8-dexed kotlin-stdlib cache saves ≤15 s (<10% under load). A cases/engine split needs a design decision |
