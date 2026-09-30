# T071 EMS: the emitter split and paint seams (Worker receipt notes)

Branch `ems-paint-seams` (worktree /tmp/dragon-ems), stacked on `pr/v1-value-model`. BASE is bb87f427. Head is 3148ee26, in three commits:

- 2beb89b2: the code;
- 91ba78fa: `native:gen` output;
- 3148ee26: lanes.json.

Nothing was pushed.

## Result

EMS changes no output.

- Expected dumps, applied keys, captures, vectors, profiles and web emissions are byte-identical to BASE.
- The native case sources are identical except for the relaxed `support <digest>` header field:
  - iOS 6468026796b25e79 → 61b923ad2f7b1367;
  - Android a4551ecc1a82d920 → c8797f9ec7cc3253.
- The generated engine differs only in its translator-digest headers. The harness gains the paint routing.
- On both leases, every device record equals BASE: states, compared counts, failuresByKind, firstFailures, trust and dump faults. A node script that ignores only timing and run digests exits 0.
- The full `device-failures-{ios,android}.json` lists are byte-identical to BASE:
  - iOS 546 (253 at DPR 3, 293 at DPR 2);
  - Android 1397 (284 at DPR 2, 882 at DPR 2.625, 231 at DPR 3).
- `--require-all` names exactly the two device-pixels lanes, as at BASE.

## Module layout

**Lowering (`packages/dragon/src/lower/paint/`)**
- `types.ts` defines:
  - `PAINT_MODULE_NAMES`, the one registry order: background, border, clip, radius, shadow, effects, stacking, outline, transform, gradient, scroll, fixed, scrollbar, image, foreign-view, control;
  - `PaintLowering` and `BoxPaintContext` (which carries a mutable `facts` record);
  - `ProgramError`.
- `colors.ts` holds `usedColors` and `colorChannels`.
- `background.ts`, `border.ts` and `clip.ts` hold the moved writes, with their `VOCABULARY` entries, `WRITE_CSS` and the old `boxPaint` logic.
- The other 13 modules are stubs.
- `registry.ts` holds `PAINT_LOWERINGS`, `lowerBoxPaint`, `paintVocabulary` and `paintWriteCss`.

`native-program.ts` keeps the orchestration and the font and text-color writes, and re-exports every moved name. `ProgramNode` gains:
- `host`, equal to the DOM parent for every node;
- `facts`, set to `{}` and never projected.

**Emission (`packages/dragon/src/emit/paint/`)**
- `types.ts` defines:
  - `PaintEmitter`: per backend, the case lines, the applied projection and `NativePaint`;
  - `NativePaint`: box members, the support file, stage painters, the afterLayout, applied, roundedPath and container hooks, and plants;
  - `PAINT_STAGES` in CSS order: outer-shadow, background, background-layers, inset-shadow, border, outline.
- `background.ts`, `border.ts` and `clip.ts` hold the Swift and Kotlin moved out of native-support.ts: `dragonDrawBorders`, `dragonBackground`, the border and clip members, and the readback.
- The other 13 modules are stubs.
- `registry.ts` dispatches `uikit.ts`, `android-views.ts` and `expected-dump.ts`.

**native-support.ts**
- `DragonBoxShape`: edges, borders and 8 radii, all zero.
- `DragonBoxView`: its body is spliced from the module members. `draw`/`onDraw` call `dragonPaintBox`, and `dragonApplied` calls `dragonPaintApplied`.
- `DragonTree`:
  - `host(id, host)` and `companion(id, view)` (hosting and companion views);
  - `node(id)` for runtime writers;
  - apply sets the shape, then calls `dragonAfterLayout`.
- A generated `DragonPaintStages.swift`/`.kt` holds the registration points: `dragonPaintBox`, `dragonAfterLayout`, `dragonPaintApplied`, `dragonRoundedPath` (nil by default) and `dragonMakeContainer` (the clip view by default).
- Per-module files go to `Support/Paint/DragonPaint<Name>.swift` and `kotlin/dev/dragon/views/paint/DragonPaint<Name>.kt`.
- The plant list is generalised. `SUPPORT_PLANTS` is still `['glyph-offset-1']`.

**CSS and paint values**
- `css/properties/{radius,shadow,effects,outline,transform,background-layers,scrollbar}.ts` and `css/shorthands/{radius,outline}.ts` are empty, and are spread last in every aggregate.
- `analysis/paint-values/` has `index.ts`, `types.ts` and 16 stubs. `computePaintValues` is the last statement of `computeLengths`.

**Engine and translator**
- `packages/layout/src/paint.ts` (the `BoxShape` type) and `paint-{radius,shadow,gradient,transform,dash,scrollbar}.ts` are stubs; `index.ts` gains one export line.
- `generate.ts` gets an RT-13 hunk: `PAINT_ROOT_FILES`, whose exported functions are all engine roots.
- `harness.ts` gets an RT-13 hunk: `paintResult`, routed through units mode with `paint:<feature>:<fn>` names.
- `layout:paint-vectors` (`packages/parity/src/cli/paint-vectors.ts`) writes `packages/layout/paint-vectors/<feature>/vectors.json` from `inputs.jsonl`. The six suites are empty.

**Parity**
- `paint-samples/` has types, a registry and 16 stubs. `withPaintSamples` keeps the base points that every module keeps, then appends module points.
- `casePoints` calls it after the existing points.
- `SAMPLE_RULES` gains `shadow` and `gradient`.
- `checkPixels` looks up `CHANNEL_DELTA_BY_KIND`. Every kind is `GATE_CHANNEL_DELTA`; shadow and gradient get theirs from `allowances/{shadow,gradient}.ts`.
- `lanes.ts` gets an RT-13 hunk: `LANE_FILES` covers both allowance files.

## Verification (on 91ba78fa, then lanes on 3148ee26)

Every command ran with the ENV prefix.

- **C1**
  - install, typecheck, and `pnpm test`: 2417/2417 passed (109 files).
  - The BASE `vitest list` is a subset of HEAD's.
  - No `.skip`, `.only` or `.todo`.
  - Modified tests are only the listed pins.
- **C2:** 0 violations.
- **C3:** native:gen. native:swift and native:kotlin pass on both corpora. Planted faults: 8/8 caught on Swift and 8/8 on Kotlin.
- **C4:** 6 empty suites. The rerun is byte-identical.
- **C5:** no diff.
- **C6:** two captures of each set, no diff at all.
- **C7:** failed 0. The DPR report is 1263/1263 at 2, 3 and 2.625.
- **C8:** profiles byte-identical.
- **C9:**
  - iOS build: 75 files. Android build: 74 files.
  - Floors pass.
  - Encoders: 421/421 on both, with 4/4 plants caught.
- **Expected dumps:** expected-dump.test.ts and native-backends.test.ts are green.
- **Snapshot check:** a script covered every case, both backends and DPRs 2, 3 and 2.625. Against BASE, the full expected dumps, the `casePoints` output and the case bodies (headers stripped) were all byte-identical.
- **C10:** break-vectors, break-capture and pixel-capture: no diff.
- **C11:**
  - smoke 3/3 on both platforms;
  - `parity:lanes -- --run-host --run-device`: equal to BASE (see Result);
  - `--require-all` gives BASE's verdict.
- **C12:** north-star-check.json unchanged.
- **C13:** wpt web expectations unchanged.
- **C14:** every changed file is inside allowed_files. The animator grep prints nothing.
- **RT-13:** `git diff -U0 BASE` shows only `+` lines:

| File | Lines removed | Lines added |
|---|---|---|
| generate.ts | 0 | 14 |
| harness.ts | 0 | 14 |
| lanes.ts | 0 | 3 |
| host.ts | untouched | untouched |

- **package.json:** exactly one added line.

## Device contention (not an EMS fault)

The first device run (about 11:14 to 11:27) failed on Android. Between about 11:25 and 11:30 another lane installed its app and
pushed its harness on the emulators this lane had booted; /tmp/dragon-pr-v1a was running its lanes at that time. A second
lane, /tmp/dragon-grid-g0, then ran `parity:lanes --run-host --run-device` on the same devices (11:34 to 11:42). This lane
waited for it to finish before rerunning.

The first overlap produced two failures:

- **layout-vectors-device.** The harness.jar on dragon-smoke was replaced mid-suite by an older, pre-V1 harness ("$.faults: expected keys 15, got 23" and "unknown function viewportUnitBase" from case 2648 of engine-calc).
- **Capture trust.** It failed on dragon-480 after a foreign app install (lastUpdateTime 11:30:08).

After those runs ended, the full run was repeated (11:43 to 11:52) with no other device user, and it gave the equal result above. The PM should serialise device leases across lanes.

The three AVDs this lane booted (dragon-320, dragon-smoke, dragon-480) were stopped. iPhone 17 was already booted and was left running; Dragon Viewer was not touched.

## Deviations

1. **Paint roots are an explicit list.** `PAINT_ROOT_FILES` holds paint.ts plus the six seam files, not every `paint-*.ts`.
   - paint-blur.ts and paint-dither.ts (and paint-aa.ts on origin/master) declare themselves reference-only, and T109 and T086 keep them unrooted.
   - They get translated when a seam file imports them.
   - A test pins that they stay unrooted.
2. **The writers are the setters the case code already calls.** The runtime-callable writer rule is met without new wrapper calls, which keeps the case sources byte-identical:
   - `backgroundColor`/`dragonBackground`;
   - the border `didSet` or `set` setters, which now invalidate so a runtime write repaints;
   - `dragonEnableClip`.
3. **Kotlin paint files keep the old package.** They sit under `views/paint/` but keep `package dev.dragon.views`, so the case files need no new import.
4. **`computePaintValues` also runs in the font-size pre-pass.** The call sits at the end of `computeLengths`, because resolve.ts, where computeLengths is called, is outside allowed_files. So it also runs in the font-size-only pre-pass; modules must ignore maps without their longhands (documented in types.ts).
5. **The harness suite hunk is in harness.ts only.** It routes through units mode, because the harness mode list lives in templates.ts, which is not allowed. host.ts is untouched.
   - The native run of the suites is in the new `packages/translate/test/paint-roots.test.ts`, which uses runTarget with a paint corpus and a routing probe. Swift and Kotlin both pass.
   - native:swift and native:kotlin do not include the empty suites. That change would need corpus-dpr.ts, which is also outside allowed_files.

Pinned test retargets:
- `samples.test.ts`: the SAMPLE_RULES pin has shadow and gradient appended.
- `samples.test.ts`: the generateSamples rule-kind filter now excludes shadow and gradient, which the box generator never emits.
