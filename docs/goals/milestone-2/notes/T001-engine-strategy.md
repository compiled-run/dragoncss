# T001: native layout engine strategy (TypeScript, translation, Rust, Zig, embedded JS)

Scout, harness claude-code, 2026-09-27. Read-only except this note. Every probe ran under `/tmp/m2t001` and nothing was installed.

## 1. Short answer for the owner

**What stays TypeScript:** everything that stays TypeScript today. That is the compiler, the CSS analysis, the web emitter, the test lanes and the layout engine as the one reference (api.md 4.4). Nothing in this research argues for moving any of it.

**What cannot be TypeScript:** the code that runs on the phone. An iOS or Android app cannot sensibly run the TypeScript engine itself:
- iOS has JavaScriptCore built in. Android has no embeddable system JS engine, so it would have to ship Hermes or QuickJS. That is exactly the "iOS works, Android is worse" asymmetry the owner rejected.
- Generated view code, runtime helpers and layout bridges must be emitted as Swift and Kotlin source anyway (api.md 4.4).

So on-device code is Swift on iOS and macOS, and Kotlin on Android. The question is only how that code gets there.

**Is Rust or Zig worth it?** Not for this. Both would compile fine; I built the same arithmetic in Rust and Zig and both matched the TypeScript bit for bit (section 3). But a Rust or Zig core does not remove the hard parts, and it adds new ones:
1. **It adds a second source of truth.** If the TypeScript engine stays the reference (the owner decision), then a Rust or Zig core is a hand port of ~2,950 lines. That is the exact drift the goal forbids. If instead WASM from Rust or Zig replaces the TypeScript engine, the reference is no longer TypeScript. That reverses the owner decision and the "pure TypeScript" test path.
2. **It does not remove Swift and Kotlin work.** Generated view code, helpers (playbook §5: balance search, sticky offsets, radius clamping and others) and text-measure callbacks into TextKit and StaticLayout are still Swift and Kotlin. A translator from TypeScript is needed for the helpers anyway.
3. **It adds toolchains and glue on every platform:** rustup targets or Zig, the Android NDK, JNI bindings, an XCFramework, and FFI marshalling of a 41-field style tree plus measure callbacks. Each piece of glue is platform-specific code, which is more room for one platform to be worse.

**Recommendation:** option (a). Write a Dragon-owned translator, TypeScript to Swift and Kotlin, over a checked TypeScript subset. The TypeScript engine stays the only hand-written engine. The generated engines are checked on every target against all 258 vectors, plus a shared differential fuzz corpus. The arithmetic already translates exactly: the Swift probe matched 320,000/320,000 values from `units.ts`.

## 2. What I ran versus what I read

**Ran (all in /tmp/m2t001):**

| Probe | Result |
|---|---|
| Engine size (`wc -l packages/layout/src/*.ts`, excluding tests) | 16 files, 2,950 lines. flex.ts has 779, validate.ts 363, block.ts 320, units.ts 252. Tests: 1,134 lines. Vectors: 258 JSON files, 17 MB. |
| TS construct census (grep) | 116 type aliases, 1 interface, 1 class, 3 `switch`, 12 `throw`, 47 arrows, 7 `new Map`, 1 `new Set`, 15 spreads, 14 `typeof`, 30 `for…of`. There are no `?.` or `??`. There is one `RegExp` (validate.ts). Math use is limited to `fround` (26), `trunc` (5), `floor` (4), `ceil` (2) and `round` (2). |
| Differential corpus: `gen.mjs` runs 16 `units.ts` functions from `packages/layout/build/units.js` on 320,000 seeded edge-heavy inputs (halves, 1/64 steps, ±4e7 saturation, fractional %). | 320,000 expected values |
| **Swift** mechanical translation of units.ts (`number`→`Double`, `Math.fround`→`Double(Float(x))`, an ECMA `Math.round` helper). swiftc 6.4 -O. | **320,000 pass, 0 fail**. It also compiles for `arm64-apple-ios15.0-simulator`. |
| **C** translation behind a C-ABI harness (clang -O2) | **320,000 / 0** |
| C with `-ffp-contract=fast` | 320,000 / 0 (these formulas happen to be FMA-safe) |
| C with **`-ffast-math`** | **2,520 fail** (`platformFontSize` and saturating `fromCssPx`). Compiler float flags are a real determinism hazard. |
| Planted fault: C `fromCssPx` without the inner `fround` | **1,609 fail**. The corpus catches a one-token translation slip. |
| **Zig 0.16** core, `export fn` C ABI, host ReleaseFast | **320,000 / 0**. A host `.a` failed to link with Apple ld ("not 8-byte aligned"); `build-obj` works. |
| Zig cross-compile | `aarch64-linux-android` `.a`, `.o` and a 4.5 KB `.so` all build with no NDK. So do `x86_64-linux-android` and `aarch64-ios-simulator` (Mach-O, platform 7, minos 15.0). Not run on a device. |
| Zig `wasm32-freestanding` | 2,048 bytes; **320,000 / 0** in Node 24 |
| **Rust 1.98** `no_std` staticlib, host | **320,000 / 0** |
| Rust `wasm32-wasip1` | 3,725 bytes; **320,000 / 0** in Node |
| Rust iOS and Android targets | **Not installed** (no ios or android targets in `rustup target list --installed`). Adding them is an install, so I did not. There is no NDK. |
| **Full engine in JavaScriptCore:** bun bundles the engine as an IIFE (44,644 B minified, 15,468 B gzip) and a Swift host runs it via `JSContext` | **258/258 vectors exact** |
| JSC timing, layout plus validate only, 258 vectors | ~231–244 ms warm, **~0.9 ms per vector**, the same with `JSC_useJIT=false`. Node (V8 JIT): 29 ms warm, **~0.11 ms per vector**. JSON bridging per vector adds 10–50 ms in total. |
| JDK, Kotlin, Hermes, QuickJS, Porffor | None present (`/usr/bin/java` is the stub: "Unable to locate a Java Runtime"). No Kotlin probe was possible. |

**Read:**
- the T001 card and goal.md;
- docs/decisions.md;
- api.md 4.1–4.4;
- `packages/layout/src/units.ts`, `text.ts`, `index.ts`, `vectors/README.md` and `test/vectors.test.ts`;
- T022 notes (the engine is pure and portable, and native ports go through the vectors);
- platform-playbook.md §5, line 36: every runtime helper has a TypeScript reference, and "the Swift and Kotlin ports must agree with the reference to the last device pixel".

## 3. Facts that decide the comparison

1. **The engine's numeric model is IEEE 754 binary64 with explicit binary32 rounding (`Math.fround`), confined to units.ts.** LU values are integers held in doubles. Every candidate language (Swift, Kotlin/JVM, C, Rust, Zig, WASM) has identical IEEE add, sub, mul, div, sqrt and f64→f32 rounding. So 1/64 px determinism is achievable in all of them, and the probes show it.
2. **Rounding helpers are the real translation trap:**
   - JS `Math.round` rounds halves toward +∞.
   - Swift `.rounded()` rounds halves away from zero.
   - Kotlin `kotlin.math.round` rounds halves to even.

   Any hand port that "just uses round" drifts at negative halves or at even halves. A translator emits one audited helper per JS `Math` function instead. Also needed:
   - C and Zig must forbid fast-math and contraction flags; the fast-math result above shows why.
   - Kotlin/JVM float semantics are strict since Java 17 (JEP 306).
   - Mapping `number` to `Int`/`Int32` is not mechanical. `cumulativeShareRounded` computes `2*total*k+parts`, which overflows Int32, so the safe default is Double everywhere.
3. **Text measurement is injected** (`TextMeasurer`, text.ts). On device, the measurer is the platform text engine (TextKit, StaticLayout) with Dragon owning the line box (decision 7). Each option must call native text measurement from inside the engine:
   - With Swift and Kotlin engines this is a normal protocol or interface call.
   - With a C-ABI core it is an FFI upcall per text run (C function pointers on iOS, a JNI upcall on Android).
   - With embedded JS it is a JS→native bridge call.
4. **api.md 4.4** allows only the layout engine as an on-device library. Helpers and bridges are emitted as source. So a TS→Swift/Kotlin translator (or hand ports) must exist for helpers in every option. That makes the translator's cost shared, not specific to option (a).
5. **Android has no built-in, synchronous, in-process JS engine for apps.** The AndroidX JavaScriptEngine (`androidx.javascriptengine`) is async and out of process, and depends on the installed WebView. iOS has `JavaScriptCore.framework` in the SDK (confirmed in the local iPhoneOS SDK). iOS apps get no JIT in JSContext; JIT is reserved for WKWebView and Safari (read, not verified here). The macOS CLI timing above did not change with the JIT switches, so treat ~0.9 ms per vector as roughly interpreter speed.

## 4. Option table

Legend: ++ strong, + good, 0 neutral, − weak, −− disqualifying. Sections 2 and 3 give the evidence.

| Criterion | (a) TS → Swift + Kotlin by Dragon translator | (a′) TS → C by translator, one C core | (b) Rust core, C ABI, WASM | (c) Zig core, same shape | (d) TS in embedded JS (JSC / Hermes / QuickJS) | (e1) Kotlin Multiplatform core | (e2) Static Hermes / Porffor / AssemblyScript |
|---|---|---|---|---|---|---|---|
| **Drift impossibility** | + One hand-written source. Generated code can only be wrong if the translator is, and 258 vectors plus the 320k fuzz corpus per target catch it (planted fault: 1,609 failures). | + Same, with one generated output. | −− If TS stays the reference, this is a hand port. If WASM replaces TS, there is no drift, but the reference is no longer TS (reverses a decision). | −− Same as (b) | ++ The same code runs everywhere (258/258 in JSC measured). | − A hand port unless translated, then as in (a). | − The toolchains are the translators, but they are immature or not faithful to JS semantics (AssemblyScript is a different language). |
| **Parity iOS / Android / macOS / web tests / future** | ++ Swift covers iOS and macOS, Kotlin covers Android (and desktop JVM). Both come from the same translator run and the same vectors. Future targets (C#, Dart, C) are more backends. | + One core everywhere, but the glue differs per platform (Swift wrapper, JNI). | + One core; per-platform glue (XCFramework, JNI, wasm-bindgen). | + Same; Zig cross-compiles Android and iOS-sim without the NDK (measured). | −− iOS has JSC built in; Android must bundle an engine. Asymmetric by nature. | + JVM plus Kotlin/Native iOS framework; iOS goes through an ObjC bridge. | − |
| **Toolchain weight** | + Contributors: TS only. CI: swiftc plus JDK/Kotlin, which the Android lane needs anyway. | 0 Adds NDK and JNI. | − rustup plus iOS and Android targets, NDK (cargo-ndk), wasm target; none installed. | 0 One ~50 MB binary cross-compiles everything; still needs JNI and Kotlin. Zig is pre-1.0, and 0.16 had an archive-link bug with Apple ld (measured). | − Hermes or QuickJS build per Android ABI (CMake, NDK). | − Gradle plus the Kotlin/Native toolchain; heavy macOS builds. | −− Experimental |
| **Binary size, startup** | ++ Native code, estimated ~100–300 KB per platform (not measured for the full engine). No startup cost. | ++ | + Rust units core: 3.7 KB wasm. Full engine unmeasured. | ++ Zig units core: 2 KB wasm, 4.5 KB Android .so (measured). | − JS bundle 44.6 KB (15.5 KB gz) plus an engine: 0 on iOS (system JSC), MBs per ABI on Android (Hermes or QuickJS, not measured). ~10 ms script load (measured, macOS). | − The Kotlin/Native runtime adds size on iOS. | ? |
| **On-device speed** | ++ AOT native. Expected ≥ V8's ~0.11 ms per vector (not measured). | ++ | ++ | ++ | − ~0.9 ms per vector in JSC without effective JIT (measured, macOS), roughly 8× V8. Plus bridge costs for input and every text measure. | + | ? |
| **1/64 px determinism** | ++ Proven for units.ts in Swift (and C). Needs audited Math helpers and no Int narrowing. | + Needs fp flags pinned (fast-math breaks 2,520/320k). | ++ Rust never contracts; proven. | ++ Proven (ReleaseFast). | ++ Same JS semantics. | + JVM strict. | ? |
| **Debuggability** | + Readable generated Swift and Kotlin in Xcode and Android Studio, with a source map back to the TS line (translator feature). | − C in a debugger, across JNI. | − Two languages per stack, FFI boundaries. | − Same | − A JS VM inside the app; JSC can be inspected from Safari, Hermes via Chrome DevTools; bridge stacks are opaque. | 0 | −− |
| **Fit with owner decisions** | ++ TS stays the reference; Dragon owns the translator; the sync pure-TS compiler is untouched; matches decisions.md "generated or ported" and api.md 4.4. | + Same, but C adds a C-ABI surface across 4.4's "one library". | − Keeping TS makes Rust a port; replacing TS with WASM breaks "TS is the reference" and adds WASM to the test path (4.4 bans hidden WASM init in the compiler; tests are allowed, but it is an owner call). | − Same as (b). yuku being Zig is a reason to like Zig for the analyzer (decisions.md), not for layout. | − On-device JS is not "compile straight to native"; asymmetric Android. | 0 A new build-time language. | −− |
| **Cost to milestone-2 parity** | Medium. Translator for the checked subset, estimated 1.5–3k lines of TS over the TypeScript compiler API (typescript ^5.9.3 is already a devDependency). Two emitters and the Math helpers. Validator not translated: devices get typed generated input, and the TS validator guards the compiler side. Kotlin needs the JDK install that Android needs anyway. | Medium-high: C memory for trees, Maps and strings. | High: hand port of 2,950 lines plus FFI plus 3 build systems, and still a translator for helpers. | High: same as (b), plus a pre-1.0 language. | Low for iOS, medium-high for Android (embed an engine, bridge measure callbacks). Fails parity and speed. | High | Unknown or high |

## 5. Recommended strategy

1. **Keep `packages/layout` (TS) as the only hand-written engine.** Add a *subset checker* that fails `pnpm typecheck` on any construct the translator does not support. The allowlist starts from the census in section 2: discriminated unions, `switch`, Map/Set, arrays, closures, `throw`, template strings, and the Math functions `fround`, `trunc`, `floor`, `ceil` and `round`. Keep `validate.ts` TS-only, since its RegExp is out of the subset.
2. **Build `dragon-translate` (internal, TS) with two emitters, Swift and Kotlin,** from one typed IR:
   - `number` → Double; `LU` stays Double unless a later proof allows Int64.
   - Math → audited helpers such as `jsRound`, `jsTrunc` and `fround`.
   - Discriminated unions → Swift enums with payloads, Kotlin sealed classes.
   - `throw` → typed errors; `TextMeasurer` → protocol or interface.
   - Output is deterministic, with `// ts:file:line` comments.
3. **Proof on every native target, identical by construction** (supports the lane-parity check in oracle item 3):
   - (i) all 258 vectors bit for bit;
   - (ii) the shared differential corpus: the `gen.mjs` shape, one committed seed, the same N on every target;
   - (iii) planted translator faults that must fail. The fuzz corpus catches a missing `fround` (1,609 fails in the probe).

   These run on the host (swiftc on macOS; Kotlin/JVM on macOS or Linux) and again inside the simulator and emulator lanes.
4. **The same translator later emits runtime helpers** (playbook §5), so there is one mechanism for all on-device code.
5. **Keep options open:**
   - A C emitter is a later backend if a C-ABI target appears.
   - Zig or Rust stays in reserve only if measurement shows generated Swift or Kotlin is too slow; that is unlikely, given native AOT.
   - Record the reason: not preference, but drift, glue and parity.

## 6. Risks and unknowns

- The Kotlin path is **unmeasured**: there is no JDK. The first Worker package should include the owner-installed JDK and a Kotlin run of the same units corpus before the full engine.
- The swiftc cross-compile to the iOS simulator warned about the sysroot ("using sysroot for macOS"). The binary was built but not run in a simulator; T002 owns simulator execution.
- The JSC timing may not reflect device JIT policy exactly. Its direction, slower than V8 plus bridge costs, is enough to reject (d) on parity grounds alone.
- A translator bug affects Swift and Kotlin the same way only when it lives in shared IR code. Emitter-specific bugs are caught per target by the same vectors and corpus.
- Full-engine binary size and speed in Swift and Kotlin are estimated, not measured.

## 7. Owner decisions needed

1. **Engine strategy:** approve (a): the TS reference plus a Dragon-owned TS→Swift/Kotlin translator. Rust and Zig are rejected for layout, with the reasons in section 1.
2. **Is the WASM-as-reference variant of (b)/(c) permanently out?** It would mean the TS engine is no longer the reference.
3. **Android toolchain install:** a JDK (17+) and Kotlin compiler for the host Kotlin engine tests, plus the Android SDK and emulator (T002 lists commands). This is needed under every option. The NDK is needed only for (a′), (b), (c) or (d).
4. **The TS subset checker becomes a blocking rule on `packages/layout`** (and later on helper sources).
5. **Numeric policy:** generated engines use Double for all numbers (the TS model). Any Int or LU narrowing needs its own proof.
6. **Is a differential fuzz corpus (a committed seed and size) part of the native proof** alongside the 258 vectors, and does it count toward oracle item 1?
7. **Is Kotlin also the macOS/desktop JVM path, or is macOS Swift only?** The recommendation is Swift for macOS, per decision 10.

## 8. Sources

I had no web access in this session, so none of these was fetched. The URLs are given for T003 or the owner to verify, and no access dates are claimed.
- JavaScriptCore on iOS: https://developer.apple.com/documentation/javascriptcore. Local confirmation: the framework is present in the iPhoneOS SDK (run).
- AndroidX JavaScriptEngine (async, sandboxed, WebView-backed): https://developer.android.com/develop/ui/views/layout/webapps/jsengine
- Hermes: https://github.com/facebook/hermes. Static Hermes: https://github.com/facebook/hermes (static_h branch).
- QuickJS: https://bellard.org/quickjs/. Porffor: https://porffor.dev. AssemblyScript: https://www.assemblyscript.org
- JEP 306, restoring always-strict floating point in Java 17: https://openjdk.org/jeps/306
- Kotlin `round` (half to even): https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.math/round.html
- Swift `FloatingPointRoundingRule`: https://developer.apple.com/documentation/swift/floatingpointroundingrule
- ECMA-262 `Math.round`: https://tc39.es/ecma262/#sec-math.round
- Rust platform support (tiers for the ios-sim and android targets): https://doc.rust-lang.org/rustc/platform-support.html
- Blink LayoutUnit: third_party/blink/renderer/platform/geometry/layout_unit.h, as cited in units.ts.
