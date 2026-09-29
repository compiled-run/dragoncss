# T028: variable-font fence (T024 condition 2)

Branch `vf-fence` in /tmp/dragon-vf, based on master 2347a15. The ruling is in docs/decisions.md ("Variable fonts are fenced", PM T024): refuse until proven.

## What is refused

Both layers refuse three kinds of input:

1. **A variable font without HVAR.** A variable font is any font with an `fvar` table. Without HVAR the shim silently uses default-instance advances; see T024 §4.
2. **A variable font outside the validated set.** Fonts are identified by SHA-256.
3. **A validated font at an instance outside its validated axis ranges.**

The validated set is in `packages/text-shaper/validated-variable-fonts.json`:

- It has one font, InterVF: `docs/research/text-spike/fonts/Inter-VF.ttf`, sha256 `29160a80…559031`.
- Its axes are `wght` [400, 400] and `opsz` [14, 24].
- The evidence is the 60 exact InterVF gate cases.

### How the opsz range was decided (decision rule: researched and made the call)

The ruling says "Inter VF at its default instance". T024 §4 says what the gate actually validates: "default wght with auto opsz", at sizes 12, 16, 17 and 24.

A literal default instance (opsz 14) would refuse the gate's own 16, 17 and 24 px cases. So the validated instance is:

- **wght:** the default, 400.
- **opsz:** automatic optical sizing. The resolved opsz must lie in the range the Chrome cases reach, [14, 24]. Size 12 clamps to 14, which is the full default instance, with every coordinate 0.

The range is closed and interpolated, because the Chrome cases cover points spread across it (14, 16, 17, 24). An opsz above 24, at a specified size of 25 px or more, is refused. So is any wght other than 400. `font-optical-sizing: none` gives the default instance and is accepted.

A test derives this set from the gate reference, `chrome-145.json`: the font, its sha256, and each axis's min and max over the InterVF cases. It must be equal to the JSON, so the set cannot widen without new Chrome cases.

## Shim / TS API (packages/text-shaper)

- **`src/fence.ts` (new):**
  - `faceFacts` reads fvar presence, HVAR, the fvar axes and the SHA-256.
  - `fenceFace` and `fenceInstance` return a typed `VariableFontRefusal`. The kinds are `variable-font-without-hvar`, `variable-font-not-validated` and `variable-instance-not-validated`; the last carries the font, axis, value and validated range.
  - `instanceAxisValues` mirrors `dhb_font_create`:
    - wght, wdth and slnt come from the request;
    - then settings, where a later entry wins;
    - then automatic opsz from the specified size, unless a setting names opsz;
    - every value is clamped to its axis and kept as f32.
- **`src/wasm.ts` (hook):**
  - `createFace` throws `VariableFontRefused`, which carries `.refusal`, for face-level refusals.
  - `createFont` throws it for instance refusals. Both throw before any HarfBuzz font exists, so before shaping.
  - `checkFont(face, options)` returns the typed refusal without throwing.
  - Planted fault: `DragonHB.load(path, { fenceDisabled: true })`.
- **`test/fence.test.ts` (new, 9 tests):**
  - The validated set is derived from the gate reference.
  - Inter VF's axes are read correctly.
  - Each refusal kind is checked.
  - Validated instances are accepted: 8, 12, 16, 17, 20 and 24 px, opsz off, and wght 400 given explicitly.
  - Static fonts are untouched.
  - A table of 8 inputs that must be refused all are.
  - `fenceDisabled` lets all 8 through, and the test catches it. The same test shows the trap: a no-HVAR copy of Inter VF at wght 700 shapes with the same advance as at 400, while real Inter VF at 700 does not.
- **Gate:** 620/620, run with the fence active. `runGate` goes through `createFace` and `createFont`.
- **WASM:** unchanged. The fence is TypeScript, and dragon_hb.zig was not touched. `zig build wasm` reproduces the committed `wasm/dragon_hb.wasm` (sha256 `1ad2e484…fdf092`).

## Compiler (packages/dragon/src/fonts)

### `variable-fence.ts` (new)

- **`VALIDATED_VARIABLE_FONTS`:** a test keeps it equal to the shaper's JSON. The compiler core cannot read files and has no dependency on the shaper, so the set is copied rather than imported.
- **`fvarAxes`.**
- **`fenceVariableFace(bytes, font, faults)`:** the face-level fence, for HVAR and the validated set.
- **`fenceVariableInstance(face, request, faults)`:**
  - The request is weight, stretch, style, specified size, optical sizing and the `font-variation-settings` property.
  - It checks conservatively. For each axis it takes every value Chrome could use: the request clamped to the face's descriptor range, and the request clamped to the axis range. All of them must be inside the validated range, so the fence does not depend on details of font_custom_platform_data.cc that were not available here.
  - A validated variable face that has the `font-variation-settings` descriptor is refused as `variable-descriptor-settings`. Dragon does not apply that descriptor, so its instance is not the validated one.
- **Wiring:** `fenceVariableInstance` is exported but not called yet, because the fonts module is not wired into `compile()` (T005b). Style resolution must call it when it is wired.

### Hooks in existing files

- **`font-face.ts`:**
  - `sourceOf` runs `fenceVariableFace` after `readSfnt`.
  - A new `FontFaceIssue` kind, `variable-font-refused`, carries the url and refusal.
  - That kind is added to `FONT_FACE_ERRORS`, so it stops the build: no manifest.
- **`faults.ts`:** the `fenceDisabled` unit fault is added to `FontFaults`, `NO_FONT_FAULTS` and `UNIT_FAULTS`.
- **`index.ts`:** exports the new module.

### Tests: `test/fonts/variable-fence.test.ts` (new, 9 tests)

- The validated set equals the shaper JSON and the Inter VF file hash.
- `fvarAxes` is checked.
- A no-HVAR font is a build error, and so is an unvalidated font from an asset or a `data:` URL.
- Inter VF and static fonts pass.
- Validated and refused instances are checked, including the reported candidate values.
- A table of 7 inputs that must be refused all are.
- `fenceDisabled` lets all 7 through and builds a manifest for the no-HVAR font, and the test catches it.

## Retargeted test (throughput rule 1)

- `packages/dragon/test/fonts/units.test.ts`, "records the typed metrics refusal of a variable face".
- Its fake variable font (Inter-Regular with `gasp` renamed to `fvar`) has no HVAR, so the fence now refuses it and no manifest is built.
- It now uses the real Inter VF, which the fence accepts, and still asserts `metricsRefusal: { kind: 'variable-font' }` in the manifest. The intent is kept.
- The no-HVAR refusal is now covered in variable-fence.test.ts.

## Decisions and deviations

- **The shim fence is in the TypeScript API, not in dragon_hb.zig.** Reasons:
  - It avoids a WASM and native rebuild. The `.so` is not repeatable from /tmp, per T024 condition 4.
  - Native hosts get only compiler-approved faces and instances, because the compiler resolves every style at build time.
  - A C-level check can be added when TXT1a wires the shim on device.
- **The fence treats any font with fvar as variable.** This is broader than the shim's `fvar + (glyf|CFF2)`, and it follows the task wording.
- **Instances are compared by resolved axis values.** An explicit `'wght' 400` or `'opsz' 20` that resolves inside the validated ranges is accepted.

## Widening later

To widen the set, first add Chrome cases for more weights and widths, and a second variable font with avar (T024 condition 2). Then extend the JSON and the compiler copy. The derivation test forces the JSON to match the gate reference.

## Verification (commit 6618040 on vf-fence)

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm test` | pass: 70 files, 1449 tests |
| `node packages/text-shaper/scripts/gate.ts` | 620/620 cases exact, 5000 lines |
| `node --conditions=dragon-internal scripts/capture-font-data.ts --check` | 5 files byte-identical |
| `zig build wasm` | sha256 `1ad2e484…fdf092`, equal to the committed file, so the WASM did not change |

### Earlier `pnpm test` failures (environmental)

- Two earlier `pnpm test` runs failed. Each time, the same 4 parity tests hit the 120 s test timeout (lanes, native-compare, native-host, and parity determinism).
- Those runs were at a machine load average of 38–55 from other agents.
- None of those tests reach the fonts module: nothing outside `src/fonts`, its tests and `capture-font-data.ts` imports it.
- `parity.test.ts` passed 237/237 with `--testTimeout=900000`, a diagnostic run only.
- A clean 2347a15 worktree passed at load about 6, and the branch passed at the same load.
