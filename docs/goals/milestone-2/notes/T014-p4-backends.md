# T014 P4 native backends: BLOCKED (stop_if: a file outside allowed_files is needed)

Worker, 2026-09-28, claude-code. Board: `docs/goals/milestone-2/state.yaml`, task T014. Branch `t014-p4-backends` from 4c1331c, worktree `/tmp/dragon-p4`. Local commit only; nothing pushed.

**Result: blocked.** Nothing was implemented. This note is the only change on the branch. I stopped before writing any code because the binding spec needs a file outside `allowed_files`.

## The blocker

Spec section 2 item 3 requires "`text.ts` gains a font-data measurer" and "`ahemMeasurerWith` becomes that measurer over the Ahem constants". The fallback split keeps this in P4a ("measurer data path"). So `packages/layout/src/text.ts` must change in either half.

Any byte change to an engine source under `packages/layout/src` rewrites the header of three generated files:
- `packages/layout/generated/swift/Sources/DragonLayout/Unions.swift`
- `packages/layout/generated/swift/Sources/DragonLayout/Strings.swift`
- `packages/layout/generated/kotlin/src/main/kotlin/dev/dragon/layout/Unions.kt`

The cause is in the translator:
- `packages/translate/src/generate.ts` writes `sources <sourcesDigest(engine)>` into those three headers.
- `sourcesDigest` hashes the sha256 of **every** engine file (`lower.ts` `lower()`: `sources = this.opts.files.map(...)`).

None of the three files is in T014 `allowed_files`. Verify item 6 also requires that the generated diff "lists only the Text and Inline files". The translator is protected (digest 4069ea1701e109e4), so the header cannot be changed at the source. This matches two stop_if entries: "A file outside allowed_files is needed" and "needs a translator change".

## Evidence (ran in /tmp/dragon-p4 at 4c1331c, JAVA_HOME and ANDROID_HOME exported)

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass; lockfile unchanged |
| Probe: add one trailing newline to `packages/layout/src/text.ts`, run `pnpm run native:gen` | Corpus counts and both digests unchanged (ae0f4087...48af38e, b9b2fb6b...10a8037). `git status` shows 5 generated files changed: Text.swift, Text.kt, **Unions.swift, Strings.swift, Unions.kt**. Each changes one header line. The three shared files go from `sources 84d76dca1e16b970` to `sources 12a5ed9f96c1da4b` |
| Revert text.ts, re-run `pnpm run native:gen`, then `git diff --exit-code 4c1331c -- packages/layout` | exit 0 (clean) |

Changing `inline.ts` would hit the same headers, because they hash every engine file.

## Resolution options for the PM (the PM or owner rules; the Worker does not choose)

1. **Header-only ruling, following the T011 precedent (recommended).** Add `Unions.swift`, `Strings.swift` and `Unions.kt` to T014 allowed_files. The condition: only their `sources <digest>` header line may change, and their bodies must stay byte-identical to 4c1331c. Verify item 6 would then name these five files. This needs no translator change.
2. Allow a translator change so the shared headers stop hashing every engine source. This changes the translator digest and every generated header. The Worker does not recommend it.
3. Move the font-data measurer out of P4. This drops the spec's R4 bridge path and the self-check that rests on it.

## Design constraints for the re-run (found while reading)

1. **New string literals.** `Strings.swift` numbers the engine literals in sorted order (`S.s0`, `S.s1`, ...), and 13 generated Swift files reference `S.sN`. Adding one new literal to text.ts or inline.ts would renumber them all and put far more files outside allowed_files. So the measurer refactor must add no string literal. It must reuse the existing `U+... is not an Ahem full-advance glyph` reason text.
2. **Only reachable code is translated.** The translator emits only what the fixed roots reach (`generate.ts` `engineRoots`: layout, layoutWithFaults, absoluteRects, measurerFor, ahemMeasurer, snapEdges, snapRect, and the units.ts exports). Every helper the device needs must therefore be reached from `ahemMeasurer` or `measurerFor`. That covers the font-data measurer constructor, the covered-glyph predicate and any list of covered code points. An unreached export is simply not emitted, and changing the roots would be a translator change.
3. **The line-box helper may not need an inline.ts change.** `buildRun` is already translated and public: Swift `inline_buildRun`, and a top-level Kotlin function in the same module as the host app. It returns the exact `lineHeight`, `ascent`, `descent` and `halfLeading` the engine uses. The same is true of `zoomInput` (layout.ts). If the PM prefers the named helper the spec describes, inline.ts falls under the same header ruling as option 1.
4. **The shared metric maps have no number keys.** The subset allows only string or object-reference keys. A per-code-point advance table must be keyed by `cp.toString(16)`, which the subset allows, or held as parallel arrays.
5. **Ahem line gap.** `roundFontMetricToWholePx(fontMetricPx(size, 1000, 0))` evaluates `ceil(-0.5)`, which is -0 in JS, where the current code returns `ZERO`. The measurer must return `ZERO` for a zero line gap to stay bit-identical under the harness's IEEE bit-pattern compare.
6. **Existing test pins stay compatible.** These pins already agree with the planned android config: compile.test.ts:153 (`{ android: {} }` gives exactly one DRAGON_CONFIG_INVALID), s5.test.ts:86 (`{ kind: 'android' }` without minSdk gives an invalid query) and types.test-d.ts:18-19, 33-34, 39 and 87-88. The only test that must change is the native-projection.test.ts P3 pin at lines 27-31, as the spec allows.

## Not done

Every T014 objective item, 1 to 10, on both platforms. Nothing was split by platform. Beyond the probe above, no verify command was run against changed code, because there is none.
