# Native strategy: translator, device DPR and lanes at parity

Judge T003, milestone 2, 2026-09-27. Inputs: goal.md (parity requirement), notes/T001-engine-strategy.md, notes/T002-device-lanes.md, docs/decisions.md, docs/api.md sections 4 and 7, milestone-1 notes T038-slice-5 and T999-final-audit-1, and the code under packages/layout, packages/parity and packages/dragon.

The engine is already decided (decisions.md, Native engine strategy, 2026-09-27). TypeScript is translated to each target by a Dragon-owned translator, and generated engines are never hand-edited. This document does not reopen that. It fixes how the translator works, how device pixel ratios are added, how the lanes are built so iOS and Android get the same proof, what the owner must decide, and the order of work.

## 0. Summary

- `packages/layout` stays the only hand-written engine. A new internal package, `packages/translate`, reads it with the TypeScript compiler API and writes Swift (iOS, macOS) and Kotlin (Android). A subset checker makes sure the engine only uses what the translator can translate exactly.
- All numbers are doubles on every platform. Every JavaScript Math function and every library behaviour the engine relies on (rounding, `fround`, stable sort, ordered maps, code-point strings) becomes one audited helper per language. Platform shortcuts are not used.
- Every generated engine must reproduce the 258 shared vectors and a seeded differential corpus bit for bit. Planted translator faults must make those checks fail.
- Chrome lays out differently at real device pixel ratios. New Chrome captures and engine vectors are added at DPR 2 and 3 for both platforms, plus 2.625 for Android. The milestone-1 DPR 1 corpus stays byte-identical.
- Both platforms write one dump format, snap frames with one rule, set line boxes from the engine's data, take paint evidence from the compositor, and are checked by one lane-parity rule that fails if either platform gets less.
- Every package does the Swift and the Kotlin halves together. Where Android tooling is missing, the Android half is a blocked check, never a later package.

## 1. Translator

### 1.1 What is translated and what is not

| Code | Written in | On device as |
|---|---|---|
| Layout engine (`packages/layout/src`, all files except `validate.ts`) | TS subset | Translated Swift and Kotlin |
| `snapEdges` pixel-snap reference (new, section 3.3) | TS subset in packages/layout | Translated |
| Runtime helpers (playbook section 5: balance search, sticky clamps and so on) when they arrive | TS subset | Translated by the same tool |
| Harness JSON reader and writer for vectors and corpus | TS subset in packages/translate | Translated (test harness only) |
| Blink rounding rules used by native text measurers | Already in `units.ts` and `text.ts` | Translated; the native bridge supplies only raw font data |
| `validate.ts` | TS | Not translated. Devices get typed input from generated code. Every vector and corpus input passes the TS validator before any native run. |
| Lowering to native property writes, view construction, text-view hooks, host apps, dump writers | TS emitters and templates in packages/dragon and packages/parity | Generated source from the compiler's emitters, not translated. They call the translated engine and `snapEdges`. |
| Compiler, CSS analysis, web emitter, comparison and reports | TS | Never on device (api.md 4.4) |

Rule: no hand-maintained `.swift` or `.kt` file exists in the repo. Every native file comes from the translator or from a TS emitter or template, and carries a generated header.

### 1.2 The checked subset

`pnpm run layout:subset` (also run inside `pnpm test`, and by the translator before it emits) walks every file under packages/layout/src except validate.ts. It fails with file:line on anything outside this list:

- **Types:** `number`, `boolean`, `string`, string-literal unions, `readonly` arrays and arrays, `Map` and `ReadonlyMap` with string or object-reference keys, named object type aliases, discriminated unions of named object types on a string `kind`, branded numbers (`LU`, `FactorSum`), `T | null` or `T | undefined` (never both on one value), and generic functions over these.
- **Statements:** `const`, `let`, `if`, `switch` on a string discriminant, `for`, `for...of` over arrays, `while`, `return`, `throw`, `try/catch` with `instanceof` of a subset class.
- **Expressions:** arithmetic, comparisons, `===` and `!==` (identity on objects, value on primitives), boolean `&&`, `||` and `!` on booleans only, ternaries, closures and arrow functions (captured variables by reference), array spread, object spread into a named type, template strings interpolating strings (plus integer `toString(16)`), and object literals whose contextual type is a named type.
- **Library:** `Math.fround`, `trunc`, `floor`, `ceil`, `round`; `Number.isNaN`, `isFinite`, `isInteger`; array `length`, `push`, `map`, `filter`, `find`, `some`, `forEach`, `slice`, `reverse`, `flatMap`, `sort` (with a comparator); string for...of and `codePointAt(0)`; `Map` `get`, `set`, `has`, iteration.
- **Class:** only `class X extends Error` with readonly fields.
- **Forbidden:** `any`, `unknown` outside validate.ts, `?.`, `??`, truthiness of numbers or strings, numeric `||`, RegExp, `Date`, `Math.random`, `JSON`, `globalThis`, `process`, bitwise operators, string `length` and index access, `in`, `delete`, `typeof` outside validate.ts, getters and setters, and declaration merging.

Current code needs three behaviour-preserving refactors. The Worker makes these, proving byte-identical outputs:
- `inline.ts:34` `RTL_SAFE` is a RegExp, which T001 missed. It becomes a code-point predicate (A-Z, a-z, space, U+200B), tested equal to the regex over every BMP code point and a set of astral ones.
- `flex.ts:134` uses a numeric `||` in the order comparator. It becomes an explicit comparison. `order` is validated as finite, so the result is identical.
- Anonymous object literals, such as `{ b, i }` in that sort, get named types.

### 1.3 How translation works

```
program  = ts.createProgram(layout files, repo tsconfig)
checker  = program.getTypeChecker()
fail if subsetCheck(program) has violations
ir       = lower(program, checker, roots)   // one typed IR, shared by all emitters
for emitter in [swift, kotlin]:
  files  = emitter.emit(ir) + emitter.prelude + emitter.harness(ir)
  write files in sorted order, with a header naming the TS file, its sha256 and the translator digest
```

- **Roots:** `layout`, `layoutWithFaults`, `absoluteRects`, `measurerFor`, `ahemMeasurer`, the exported `units.ts` functions (for the units corpus) and later `snapEdges`. Everything they reach is translated.
- **Emission is type-directed.** At every expression the emitter asks the checker for the narrowed type, and inserts the cast a narrowed union member needs. Swift uses `as!` to the member class; Kotlin uses a smart cast or `as`. Object literals take their class from the contextual type.
- **Deterministic output:** stable ordering, a fixed format, and a `// ts: file.ts:line` comment on each function and statement block, which is the source map back to TypeScript.

### 1.4 Value model

| TypeScript | Swift | Kotlin |
|---|---|---|
| `number`, `LU`, `FactorSum` | `Double` (typealias for brands) | `Double` (typealias) |
| `string` | `JsString` (UTF-16 code units; equality and hashing by code unit) | `String` (already UTF-16 code-unit equality) |
| string-literal union | `JsString` constants | `String` constants |
| named object type | `final class`, identity `==` and hash | `class` (never `data class`; identity equality) |
| discriminated union | protocol plus one final class per member | `sealed interface` plus classes |
| array | `JsArray<T>` reference class (JS arrays alias) | `ArrayList<T>` |
| `Map` | `JsMap<K, V>`, insertion-ordered reference map | `LinkedHashMap<K, V>` |
| `null` / `undefined` | `Optional` | nullable type |
| `throw` / `catch` | every generated function `throws`; `JsError` and subclasses | exceptions (`RuntimeException` subclasses) |
| closure | closure (captures by reference) | lambda (captures by reference) |
| array index | `jsIndex(Double) -> Int`, traps if not an integer in range | same helper |

The only integer type anywhere is the checked array-index conversion. Mapping LU to Int needs its own proof (T001: `2*total*k+parts` overflows Int32).

### 1.5 Numbers and rounding

All three languages use IEEE 754 binary64 for `+ - * /`. Float32 narrowing rounds to nearest-even and overflows to infinity. So only library functions differ, and each becomes a helper with the exact ECMA-262 behaviour:

| JS | Swift helper | Kotlin helper | Trap it avoids |
|---|---|---|---|
| `Math.fround(x)` | `Double(Float(x))` | `x.toFloat().toDouble()` | none; identical by IEEE |
| `Math.trunc(x)` | `x.rounded(.towardZero)` | `kotlin.math.truncate(x)` | keeps -0 |
| `Math.floor`, `Math.ceil` | `.rounded(.down)`, `.rounded(.up)` | `floor`, `ceil` | none |
| `Math.round(x)` | `jsRound` | `jsRound` | Swift `.rounded()` rounds halves away from zero; `kotlin.math.round` rounds half to even; JS rounds halves toward +infinity |
| `Number.isInteger(x)` | `x.isFinite && x.rounded(.towardZero) == x` | same | none |
| `Number.isNaN`, `isFinite` | `.isNaN`, `.isFinite` | same | none |

```
jsRound(x):
  if x is NaN or infinite: return x
  if -0.5 <= x < 0: return -0.0          // JS keeps the sign
  r = floor(x)
  return (x - r >= 0.5) ? r + 1 : r      // x - r is exact for |x| < 2^52; larger x is already integral
```

- **Build flags:** Swift `-O`, never `-Ounchecked`. Swift has no fast-math mode. Kotlin/JVM has been always-strict since Java 17 (JEP 306), and ART on arm64 and x86_64 uses IEEE doubles. C, Zig or Rust backends are out of scope; if one is ever added it must ban `-ffast-math` and contraction.
- **Output compare:** the harnesses write every double as its 16-hex-digit IEEE bit pattern, and the comparison is bitwise. So -0 and NaN payload differences surface, and no float formatting is involved. Vector outputs are LU integers and are compared as the vector file states them.

### 1.6 Strings, maps, sort and errors

- **Strings:** code units are UTF-16 as in JS.
  - Swift `String` compares by canonical equivalence (e + combining acute equals e-acute) and iterates grapheme clusters. So Swift uses `JsString`, and iteration uses `unicodeScalars` to match JS for...of.
  - Well-formed input only: lone surrogates are rejected by the harness decoders. The corpus generator never produces them.
- **Maps:** JS `Map` iterates in insertion order. Swift `Dictionary` does not, so it is never used for a TS Map. Keys are strings (by value) or objects (by identity).
- **Sort:** both preludes carry one stable merge sort with a numeric comparator. It equals ECMAScript's stable sort for consistent comparators. Platform sorts are not used.
- **Errors:** `UnsupportedSignal` and its caught result are compared field by field: code, nodeId, specSection and detail. Details interpolate only strings and hex integers (`U+` + `toString(16).toUpperCase()`), which has a helper. Internal invariant errors (`throw new Error`) are compared only as a threw-invariant outcome.

### 1.7 Differential corpus

It has one seed, one size and one generator, committed in packages/translate. The same N runs on every target. Inputs are generated into a gitignored out directory, and the corpus digest (sha256 of inputs plus TS-reference outputs) is committed and printed.

- **Units corpus:** 320,000 cases, 20,000 per exported `units.ts` function. They are edge-heavy: halves, 1/64 steps, +/-4e7 saturation, fractional percentages, NaN, infinity, -0. This is T001's shape.
- **Engine corpus:**
  - (a) each of the 258 vector inputs, with one seeded mutation of a length, percentage, flex factor, direction or DPR;
  - (b) 20,000 generated trees: 1-12 boxes, block and flex, the full 41-field style space with edge values, Ahem text leaves (including non-Ahem code points and combining marks), and DPR from {1, 2, 2.625, 3}.

  Every input must pass `validateLayoutInput`. At least 50% must lay out `ok`, so the corpus is not all refusals, and the split is reported. The TS engine's result is the expected value.
- **Oracle clause 1:** it counts as 258 vectors plus both corpora, exact, on every native engine, on the host and again on device (section 3.1).

### 1.8 Generated code in the repo

- **Paths:** `packages/layout/generated/swift/` (a SwiftPM package `DragonLayout`, platforms iOS 15 and macOS 13, plus a harness executable) and `packages/layout/generated/kotlin/` (`dev.dragon.layout` sources plus a harness `Main.kt`).
- **Header on every file:** `GENERATED by @dragon/translate from packages/layout/src/<file>.ts (sha256 ...), translator <digest>. Do not edit.`
- **Freshness:** `pnpm test` regenerates in memory and requires byte equality with the committed files. That catches both a stale translation and a hand edit. `pnpm run native:gen` rewrites them.
- **Build output** goes to gitignored directories. Any build cache is keyed on the generated sources, flags and compiler version.

### 1.9 Planted translator faults

Each fault is planted in the emitter output, and each must make at least one vector or corpus case fail. They are defined for both emitters and run for every target whose tools exist:
- missing inner `fround` in `fromCssPx`;
- the platform round instead of `jsRound`;
- an unordered map;
- an unstable sort;
- iterating characters instead of code points;
- canonical-equivalent string equality (Swift);
- a narrowed Int32 in `cumulativeShareRounded`.

## 2. Device DPR

The Chrome captures and engine model must match the pixel ratio the device actually runs at. T002 measured that Chrome's layout changes with a real device scale factor, while Playwright's `deviceScaleFactor` alone hides the change.

- **Shared set:** DPR 2 and 3 on both platforms, with identical case lists.
  - iOS: iPhone 17 (scale 3) and the iPad Pro 11-inch M5 simulator (scale 2, to be verified at lane setup).
  - Android: AVDs at density 480 and 320.
- **Android extra:** 2.625 (density 420). It is listed by name as an extra, because iOS has no fractional scale. It is additional Android proof, never a replacement for a shared case.
- **Chrome captures:**
  - `chrome.ts` stops hardcoding `--force-device-scale-factor=1`. Each capture sets the flag to N and `deviceScaleFactor` to N, and keeps the `devicePixelRatio` guard.
  - A new guard asserts that the zoom really applied: a 0.5px border computes to 0.333333px at 3, 0.380952px at 2.625 and 0.5px at 2.
  - New capture sets `expected/darwin-arm64/dpr-2`, `dpr-3` and `dpr-2.625` cover the full milestone-1 corpus, about 774 new cases.
- **Engine model:**
  - Chrome zooms CSS values by the DPR and lays out in zoomed units. At DPR N, a LayoutUnit is 1/64 of a device pixel.
  - The TS engine adopts this: lengths and font sizes are multiplied by the DPR on entry, the font rules apply to the zoomed size, and output LU are in zoomed units, converted to CSS px as LU / (64 * DPR).
  - At DPR 1 this is the identity, so every existing vector is unchanged. The vector README gets a section defining this.
  - New vectors go under `packages/layout/vectors/dpr-2/`, `dpr-3/` and `dpr-2.625/`. The vectors test reads them too.
  - Every native engine runs every vector at every DPR, including 2.625 on iOS. Engines are platform-free, so only device configurations differ.
- **Not weakening milestone 1:**
  - The 258 top-level vectors, the DPR 1 captures, emitted files, profile rows and reports stay byte-identical. The regeneration and report cmp checks from T038 stay in every package's verify.
  - DPR cases are added, never substituted.
  - Profile rows for web keep their DPR 1 proofs.

## 3. Lane architecture at parity

### 3.1 One pipeline per case

For each (fixture, DPR) case and each native target:
1. `compileBackend` gives the files, the expected dump and the layout input (api.md 4.1).
2. The TS engine lays out the input at the case DPR. This is the reference.
3. **Lane `layout-vectors`:** the generated engine reproduces all vectors and both corpora, on the host (swiftc on macOS; kotlinc on the JVM) and inside the simulator or emulator app process.
4. The device lane builds the generated view code into the host app, lays out with the generated engine, waits for the explicit settle signals, and writes a `dragon.native-dump/1` file.
5. `packages/parity` compares the dump:
   - (a) frames and lines against Chrome at the same DPR, with `|delta css px| * dpr <= GATE_DEVICE_PX` (1, unchanged);
   - (b) `applied` against `expected`, exactly;
   - (c) pixel samples against Chrome's pixels;
   - (d) frames against the TS engine frames after the shared snap, exactly. This separates engine faults from view-application faults.

### 3.2 One dump schema

`dragon.native-dump/1` is T002 section 1.2 as written. The TS types and validator live in packages/parity, and both harness templates are emitted from one TS description, so neither platform can omit a field.
- Required fields: `schema`, `lane`, `case` (fixture, dpr, viewport, direction, digests), `device` (platform, os, model, abi, scale, toolchain, renderer), `units`, `nodes` (`id`, `kind`, `native`, `frame`, integer `deviceEdges`, `applied`, `lines`), `pixels` (capture, colorSpace, size, sha256, samples with rule) and `timing`.
- Frames are read back from the live native tree, never from what the code intended to write.
- A missing node id fails the case.

### 3.3 One pixel-snap rule

```
snapEdge(lu):        return floor((lu + 32) / 64)      // zoomed LU to device px, halves toward +infinity (Blink LayoutUnit::Round)
snapRect(absRectLU): left = snapEdge(x); top = snapEdge(y)
                     right = snapEdge(x + width); bottom = snapEdge(y + height)   // sizes come from snapped edges
```

- Edges are absolute from the fixture root, which sits at an integer device origin.
- It is written once in the TS subset, has shared vectors and is translated for both platforms.
  - Android passes the ints to `View.layout(l, t, r, b)`.
  - iOS sets `frame` to `CGFloat(edge) / scale`.
- Both dumps carry integer `deviceEdges`. Snapping moves an edge at most 0.5 device px, which is inside the 1 device px gate.
- The planted fault 'snap disabled on one platform' must fail.

### 3.4 Text line boxes

The line box comes from the engine, as data. Glyph breaking and drawing stay native (decision 7).

- **iOS:** a Dragon text view owns `NSTextStorage`, `NSLayoutManager` and `NSTextContainer`. This is TextKit 1, constructed explicitly, never TextKit 2 in this milestone. Settings: `lineFragmentPadding = 0`, `hyphenationFactor = 0`, `lineBreakStrategy = []`.
  - The `NSLayoutManagerDelegate` per-line hook sets each fragment's rect and baseline offset from the engine's snapped line edges and baseline. T002 measured this as exact.
- **Android:** a Dragon text view owns a `StaticLayout` built with `BREAK_STRATEGY_SIMPLE`, `HYPHENATION_FREQUENCY_NONE` and `setIncludePad(false)`.
  - A `LineHeightSpan.chooseHeight` over the whole text looks up the line by its start offset. It writes `fm.top = fm.ascent = snappedTop - snappedBaseline` and `fm.bottom = fm.descent = snappedBottom - snappedBaseline` from the same engine data.
- **Measurer bridge (both):** the engine's `TextMeasurer` on device reads raw font data from Core Text or the Android font APIs (units per em, ascent, descent, advances) and applies the translated Blink rounding rules. It never uses the platform's rounded line metrics.
  - The platform-rule key is the Chrome reference platform (`darwin-arm64`) on both devices, because both are judged against the same Chrome. Check (d) proves the bridge reproduces the Ahem-measurer vectors.
  - Ahem is bundled and registered on both, and its sha256 is recorded.
- **Break offsets** (`start`/`end` per line) come from `enumerateLineFragments` or `getLineStart`/`getLineEnd`. They are compared with Chrome's per-line ranges, and a break mismatch is its own failure kind.

### 3.5 Numeric paint evidence

- **Captures:**
  - iOS uses `drawHierarchy(in:afterScreenUpdates: true)` of a windowed root into a declared sRGB RGBA8 `CGContext`. `layer.render` is banned, because it measured wrong for shadows.
  - Android uses `PixelCopy.request(window, rect, bitmap)` (ARGB_8888, sRGB). `View.draw(Canvas)` is banned. A probe must first show that PixelCopy equals `adb exec-out screencap` on one fixture.
  - Chrome uses `page.screenshot` at the real DPR with `--force-color-profile=srgb`.
- **Samples** are generated from snapped geometry by one TS generator (interior, border, outside, radius, clip, edge; T002 section 6). Colours must match exactly (channel delta 0); edge positions use the 1 device px gate.
- **Scope:** only colours, borders, backgrounds and overflow clipping are promoted this way. Rows that depend on antialiasing (dashes, shadows, gradients) need an owner-approved fuzzy pair and are not in the first promotion.
- **Promotion:** a profile row becomes `exact` on a platform only through that platform's passing native case (oracle 4).

### 3.6 Lane-parity check

`pnpm run parity:lanes` reads `packages/parity/src/targets.ts`. It also runs inside pnpm test. It fails unless every configured native target (ios, android, later macos) has:
- the same lanes: `layout-vectors-host`, `layout-vectors-device`, `device-frames`, `device-applied`, `device-lines`, `device-pixels`;
- the same case list: all vectors and corpora, and the full corpus at the shared DPRs;
- tolerances imported from the one `compare.ts` constant, with no numeric literal in lane code;
- the same sample rules and the same planted faults.

Extras (Android 2.625) must be named.

Lane status is one of `pass`, `fail`, `blocked (owner tooling)` or `not run`. `pnpm test` stays green with a blocked lane, but the report and summary show it as not met. `parity:lanes --require-all`, used by the final audit, fails on any lane that did not pass.

Planted faults the check must catch: a target missing a lane, one case dropped, a tolerance literal of 2, and an extra DPR not named.

### 3.7 Local and CI runs

- **iOS:** local on this Mac (iPhone 17 and iPad simulators, runtime 26.5 / 23F77, pinned device types, `simctl erase` per run, Xcode recorded). The host is a minimal UIKit app built with swiftc and driven by `simctl launch`, with an output path passed through `SIMCTL_CHILD_DRAGON_OUT`. CI is a `macos-26` runner.
- **Android:** local on arm64-v8a AVDs using Hypervisor.framework. The harness writes the AVDs' `config.ini` (density, panel size, `swiftshader_indirect`). It drives avdmanager and the emulator directly, not Gradle Managed Devices. Boots use `-no-snapshot -wipe-data`, animations are off, and it polls `sys.boot_completed`. CI is `ubuntu-latest` with KVM and x86_64 images.
  - Cross-check: frames, lines and applied values from arm64 and x86_64 must be byte-equal apart from the `device` block. Pixel samples are judged per run against Chrome.
- **Symmetry:** both use one process per DPR with all fixtures, explicit settle signals, no sleeps and one boot retry. A new fixture must pass 20 consecutive runs on both before merging.
- **CI:** the workflow files are written, not pushed. Until the owner approves a remote, CI and the ABI cross-check are `not run` on both platforms. Local runs are the oracle proof.

### 3.8 Floor-OS runs

- The current OS on both platforms (iOS 26.5, Android 36) gates promotion.
- Floor-OS runs (iOS 15 or the oldest installable runtime; Android API 29) are a second configuration required on both. If one platform cannot get its floor runtime, it is reported as blocked (owner tooling). The other platform's floor run is then reported but not counted as extra proof.
- Claims name the OS they ran on.

### 3.9 Rulings on T001 and T002 ambiguities

1. **WASM as the reference:** ruled out. The TS engine is the reference.
2. **Differential corpus:** required, and part of oracle clause 1, on host and device.
3. **Numbers:** Double everywhere; any Int narrowing needs its own proof.
4. **macOS:** uses the Swift output. Kotlin/JVM is Android only for now.
5. **validate.ts:** stays TS-only. Native harness decoders are generated from `input.ts` types and reject missing or extra keys.
6. **RegExp in inline.ts, numeric || in flex.ts:** refactored into the subset, with byte-identical outputs required.
7. **iOS host:** the minimal swiftc app, for every device lane including `layout-vectors-device`. Package XCTest is not used for proof. Android uses an Activity plus instrumentation, which is the counterpart.
8. **Text:** line boxes are taken from the engine, not recomputed from UIFont or FontMetrics.
9. **Chrome reference:** one reference for both natives, macOS Chrome 145 at the device DPR (owner to confirm).
10. **Robolectric or any JVM fake of Android:** never a proof lane.
11. **Dragon-owned paint:** no such row is promoted from `applied` alone on either platform; it needs pixel samples.
12. **Colour delta of 1** between Skia and Core Animation: measure first. Any nonzero tolerance needs owner approval.
13. **Android profile:** it is added to the support profiles with no exact row until a native case passes. Both backends share one native layout projection. The condition is met (T137a): in packages/parity/out/lanes.json the android lanes layout-vectors-host and layout-vectors-device pass on 560875 vector cases, and device-frames, device-applied and device-lines pass on all 460 layout cases at DPR 2, 3 and 2.625 (device-pixels fails on both platforms, and no iOS row rests on it). So Android rows follow the iOS rule, with the same keys: a layout aspect needs a passing linux-dragon-layout case, which uses the shared nativeLayoutProjection, and a paint aspect needs a passing chrome-dual case and is capped at caveat. The rows are derived from the parity run, not from the live lanes.json; the lanes tests keep the device lanes honest. A value the Android output refuses stays unsupported: packages/parity/test/android-profile.test.ts requires every case that proves a promoted row to compile for android unblocked and through the Android Views emitter, and no android-only refusal in any enforced native compile.

## 4. Owner decisions

1. **Install the Android toolchain** (about 3 GB of downloads). These are T002's commands:
   - `brew install --cask temurin@17`, then `export JAVA_HOME=$(/usr/libexec/java_home -v 17)`.
   - Install cmdline-tools rev 23.0, either with `brew install --cask android-commandlinetools` or by unzipping `commandlinetools-mac_arm64-16111833_latest.zip` into `~/Library/Android/sdk/cmdline-tools/latest`.
   - `export ANDROID_HOME=~/Library/Android/sdk`, and put its `cmdline-tools/latest/bin`, `platform-tools` and `emulator` on PATH.
   - `yes | sdkmanager --licenses`.
   - `sdkmanager platform-tools emulator 'platforms;android-36' 'build-tools;36.0.0' 'system-images;android-36;default;arm64-v8a' 'system-images;android-29;default;arm64-v8a'`.
   - Added by this plan: `brew install kotlin` for the host Kotlin engine run, and `brew install gradle` for the Android host project.

   Dragon creates the AVDs itself. Until you install these, every Android lane is reported as not met.
2. **Chrome reference:** judge both iOS and Android against the same macOS Chrome 145, captured at each device's pixel ratio.
3. **Pixel ratios:** DPR 2 and 3 on both, plus 2.625 on Android. That adds three capture and vector sets of about 17 MB each to the repo.
4. **Oldest iOS:** may Dragon download the oldest iOS simulator runtime Xcode 27 offers for the floor-OS run (several GB)?
5. **CI:** may Dragon add a remote and push workflow files later, to run CI and the Android arm64 vs x86_64 check? Until then both platforms' CI is not run.
6. **Report-only start:** the Android lane starts report-only, like iOS (decision 14), and blocks after two quiet weeks.
7. **Subset checker:** it blocks. A change to packages/layout that the translator cannot translate fails the tests.

## 5. Package sequence to the oracle

Every package does the Swift and the Kotlin halves together. Where Android tooling is missing, the Kotlin or Android half is generated, committed and freshness-checked, and its run is reported as blocked (owner tooling) inside the same package.

| # | Package | iOS half | Android half |
|---|---|---|---|
| P1 | Translator, subset checker, generated engines, corpus | Swift proven on the host | Kotlin emitted; run blocked |
| P1K | Kotlin host run (as soon as JDK and kotlinc exist) | n/a (already proven) | 258 + corpora + planted faults |
| P2 | Device DPR: Chrome captures at 2, 3 and 2.625, zoom model, snapEdges, new vectors | Swift passes all | Kotlin passes all, or blocked |
| P3 | Shared lane core: dump schema, targets.ts, parity:lanes, sample generator, compare (a)-(d), report states, android profile and projection | same code | same code |
| P4 | Backends: view emitters, expected dumps, text hooks, measurer bridges, host app sources | UIKit + TextKit 1; compiles | Views + StaticLayout; build blocked until install |
| P5 | Device lanes over the full corpus: engine on device, frames, applied, lines | Simulator at DPR 2 and 3 | Emulator at 2, 3 and 2.625, or blocked |
| P6 | Paint lanes and profile promotion | drawHierarchy | PixelCopy (after the screencap probe) |
| P7 | CI files, floor OS, 20-run flake check, ABI cross-check | macos-26 | ubuntu KVM x86_64 |
| T999 | Final audit per platform | | |

The blocked task is P1K and the Android execution in P4-P6, which depend on T004. The Kotlin emission, Gradle project generation, schema, parity config and every freshness test continue locally meanwhile, so installing the tools unblocks runs, not design work.

## 6. First Worker package (T005)

P1 is the one in this T003 receipt's `worker_package`: the subset checker, the translator with the Swift and Kotlin emitters and preludes, the translated harness, the corpus, the generated Swift and Kotlin committed, and Swift proven on the Mac:
- 258/258 vectors, 320,000 units cases and at least 20,258 engine cases, all bit for bit;
- every planted translator fault fails;
- Kotlin reported as blocked until tools exist;
- all milestone-1 guards unchanged.

## 7. What this does not claim

- Kotlin, ART and the Android lanes are unmeasured until the owner installs the toolchain.
- The DPR zoom model is inferred from a 5-value Chrome probe, and P2 proves or refutes it.
- The simulator and emulator do not show device GPU or OEM font behaviour, and claims name the simulator or emulator and the OS they ran on.
- Line breaks with real fonts, CJK and emoji stay caveat. Ahem proves the geometry and line-box path, not shaping.
