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

| Flags | Build | Note |
|---|---:|---|
| `-nowarn -include-runtime` (today) | 10.9 s | |
| + `-J-XX:TieredStopAtLevel=1` | 7.6 s | single run; repeat pending |
| + `-J-XX:+UseParallelGC` | 9.2 s | single run |

Run time is the JVM's (`java -jar`, 0.08 s startup per suite), so it is not the cost. The research measured a hello-world kotlinc at 12 s: kotlinc's own JVM start-up and JIT warm-up are most of a small compile. #158 removes the build on most PRs. A warm compiler daemon would save about the same again, only on engine PRs.

## 4. App builds for the device lanes (packages/parity/src/native-host.ts)

There is no xcodebuild and no Gradle here. The iOS host app is one `swiftc -O -j <cores>` call. The Android APK is aapt2, kotlinc, d8, zipalign and apksigner, run directly. Both are already reused by a source stamp, but only inside one worktree. Sources: 124 Swift files, 19 MB, of which **18 MB is generated case code** (507 cases of `LayoutBox(...)` construction expressions). The engine is 0.66 MB.

| Build | Time | Note |
|---|---:|---|
| iOS `swiftc -O -j 18` (today) | 94–119 s | |
| iOS `swiftc -O -wmo -num-threads 18` | 784 s | much worse |
| iOS `swiftc -Onone -j 18` | 11 s | 8.5x faster to build; see design decisions |
| Android kotlinc (today) | 23 s quiet, 188 s under load | |
| Android kotlinc `-Xbackend-threads=0` | 19.6 s | identical class bytes |
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
| #158 | Machine-wide Swift/Kotlin harness build cache | CI green, UNREVIEWED, clean head d72d0fe415 |
| #160 | Digest profiles and asset bytes by SHA-256 (regen commit; device step pending) | CI green, UNREVIEWED, clean head 1a85b27d5e |
