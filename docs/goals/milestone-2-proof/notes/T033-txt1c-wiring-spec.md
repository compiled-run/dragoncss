# T033: TXT1-C wiring (T011) specification (Judge, 2026-09-28)

Read-only review. The only file written is this note.

**Read:** state.yaml (T004, T005, T011, T015, T016, T021, T022, T026, T028, T030, T031, T032, T033, T007), goal.md, notes/T004,
notes/T005, notes/T025 §0 and §5, notes/T012 rulings 5 and 8 and the V2a allowed files, notes/T006 §1, notes/T010 §1-§3 and §5 item 3,
docs/decisions.md (lines 49, 109-171, 187-189), AGENTS.md, milestone-2 notes/T015 §4 (the P5 allowed files).

**Code read on master f16b457:** project.ts (InternalOptions, validateConfig, checkFonts, analyze and its digest), css/at-rules.ts,
css/stylesheet.ts (`refuseNode`), css/values.ts (`familyValue`, `featureOf`), analysis/context.ts (`usedKeys`), lower/ios-layout.ts
(`textFontProblem`), emit/web-css.ts, types.ts (`SourceSnapshot.assets`, `GeneratedFile`), parity/src/pipeline.ts (`compileFixture`,
the web CSS read), test/seams.test.ts (the at-rule refusal pin), layout/src/platform-rules.ts (`ahem-metric-half-down`).
On txt1c-fonts a343dd0: fonts/index.ts, font-map.ts, manifest.ts, metrics.ts (the rounding), and captures/pinned.json and platform.json.

**Branch state checked:** `git diff --name-only master...casc-logical` (2e3d86e) edits stylesheet.ts, cascade.ts, resolve.ts,
computed.ts, computed-checks.ts, faults.ts, support.ts, seams.test.ts and the profiles. `/tmp/dragon-p5` (t016-p5-device-lanes),
`/tmp/dragon-tree` (ns-tree) and `/tmp/dragon-mq` (mq-a-media) are all still at 12af7cb with no commits.

## 0. Decision

**Approved, in two phases on one branch.**

- **Phase A (preparatory, new files only).** It starts as soon as T032 has put txt1c-fonts on master.
- **Phase B (the wiring).** It edits shared files and waits for the gates in §2.

T011 is not on the critical path. TXT1a waits on INL1, which waits on V2a. So wherever T011 Phase B competes for a file, it goes last.

## 1. The pinned `sans-serif` face, and how Chrome is made to use it (T010 §5 item 3)

### 1.1 The pinned face

`sans-serif` is pinned to the family **"Dragon Sans"**. Its faces are the five vendored static faces of **Inter 4.1**:

| Face file | Descriptors |
|---|---|
| Inter-Light.ttf | 300 |
| Inter-Regular.ttf | 400 |
| Inter-Italic.ttf | 400 italic |
| Inter-Bold.ttf | 700 |
| Inter-BoldItalic.ttf | 700 italic |

The SHA-256 values are the ones in `vendor/fonts/README.md`. `monospace` is pinned to **"Dragon Mono"**, which is Noto Sans Mono Regular.

This is exactly the map in `packages/dragon/test/fonts/captures/pinned.json`. Chrome 145 already chose these faces by postScriptName in all 11 pinned requests (T005 (d)).

**Why Inter:**
- It is OFL.
- Every face is already captured for matching, parsing and metrics, with 1,040 metric rows.
- It is static, so it is outside the variable-font fence (T028). The fence admits only Inter VF at its default instance.
- It covers the weights the north star uses: 400 authored, and 700 from the UA bold on h1-h3.

The italic faces carry the T005 B1 caveat: `ch` on the italic-trait faces is `caveat`, and the enforced 4-row mismatch set stays. T011 does not consume `ch`, `ex`, `cap` or any other metric. Those reach computed values in V2a (Ahem only) and TXT1a (real fonts). Any later consumer must read `faceMetrics(...).chSupport` and must never report italic `ch` as exact.

### 1.2 Chrome and the compiled web output

The compiled web output uses the pinned face the same way in every browser:
- `emit/web-css.ts` writes each pinned generic as `"Dragon Sans"`, using `rewriteFamilyList`.
- It emits the `@font-face` rules for the pinned faces that are used, and for every accepted author `@font-face`.
- Each rule has `src: url("fonts/<sha256-hex-16>.<ext>")`.
- The bytes are returned as web output assets (§3 B6).

No browser setting is involved.

### 1.3 Chrome and the authored CSS (the stated reference)

Pinning a generic is an **approved web change** (decisions.md "Pitfalls handled by design" 1). Its stated reference is Chrome rendering the author's document with two changes:
1. The pinned faces are injected as `@font-face` rules for "Dragon Sans", with the same bytes as the compiled output.
2. Every unquoted generic keyword that is pinned in the fixture's map is replaced by `"Dragon Sans"` in Chrome's own CSSOM. That means Chrome's parse and Chrome's `style.fontFamily` serialisation, rewritten in the page.

This rewrite is independent of Dragon's `family-list.ts` and `font-map.ts`, so the reference is not self-referential.

**Rejected mechanism:** CDP `Page.setFontFamilies({ sansSerif: 'Dragon Sans' })`. Blink's `CSSFontSelector::GetFontData` sends the family name from settings to the platform `FontCache`, not to the `@font-face` cache. So this would need Inter installed on the host, which is not hermetic. Phase A commits a probe that records Chrome's actual behaviour for it. If the probe shows Chrome **does** use the web font through settings, the Worker reports that; the decision stays the CSSOM rewrite unless the PM rules otherwise.

**The platform-mode generics** (`{ mode: 'platform' }`) get no transform. They are `caveat` on web, and `platform.json` records the host font. They have no pass claim beyond the dual comparison on the host.

### 1.4 What this does not decide: 'Lato' in the north star (owner question)

`styles.css` says `font-family: 'Lato', sans-serif`. Lato is neither declared nor bundled. Under the font map rule ("Dragon never silently uses a machine font"), 'Lato' is an `unmapped-family` build error, and T011 keeps it one.

Today's Chrome reference shows Helvetica, because Lato is not installed on the host.

The owner picks one of these:
- **(a) Bundle Lato.** Lato is OFL. Vendor Regular and Bold and add them to T005's capture set. This is a fonts-lane data package. TXT1a must then prove Lato as well as Inter. This is the recommendation if the design intent is Lato.
- **(b) Drop 'Lato' from styles.css,** so the demo means the pinned sans-serif.
- **(c) `families: { Lato: { mode: 'platform' } }`.** This is `caveat`, so it can never satisfy checkpoint 3's exact lanes. Not recommended.

Until the owner decides, the NS-REF font key keeps the north-star reference marked stale.

## 2. What T011 waits for

| Gate | Blocks | Why |
|---|---|---|
| **T032** (txt1c-fonts on master) | Phase A and Phase B | Phase A imports the fonts module. |
| **T007 P5 merged** | Phase B | index.ts and internal.ts are P5's. Fixtures may not land while P5 is in flight (T004 §4, T025 ruling 4). |
| **T022** (casc-logical merged) | Phase B | stylesheet.ts is rewritten by T021, and seams.test.ts, faults.ts and the profiles are edited there. |
| **T015 TREE merged, device step included** | Phase B | project.ts, parity/src/fixture-reader.ts and tree-fixture.ts. T025 ruling 5: TREE comes before T011. |
| **T030 MQ-a B:** either merged, or not yet started and held until T011 merges | Phase B | at-rules.ts, stylesheet.ts, project.ts, web-css.ts and pipeline.ts. The two are never concurrent. The default order is MQ-a B, then T011. |
| **T026 V2a:** either merged, or not yet started and held until T011 merges | Phase B | css/values.ts, internal.ts and the diagnostics and fault registries. T012 ruling 5 puts V2a first by default, because it is on the critical path. V2a's stop_if names T011. |
| **T028** (variable-font fence) | nothing | T028 edits existing `fonts/*.ts`. T011 Phase A only adds files there. At Phase B, T011 surfaces whatever typed refusals the fonts module then has. |
| **T017 ELB-2** | nothing | T011 never touches `scripts/capture-ua-defaults.ts`, `ua/**` or `media/**`. |
| **Device lease** | the Phase B device step only | Needed only if a new case enters a native lane (§3 B9). |

**Phase B start rule.** Phase B starts only when all of these are on master: T032, T007, T022 and T015. In addition, neither T030 nor T026 may be in flight. If T030 or T026 is in flight, T011 waits for it to merge and then merges master.

## 3. The package

**Setup.**
- **Worktree:** `/tmp/dragon-fonts-wire`.
- **Branch:** `txt1c-wiring`.
- **Phase A base:** master after T032 fast-forwards it. This is BASE_A.
- **Phase B:** merge master once the §2 start rule holds. That commit is BASE_B, and it is recorded in the note.
- **No separate merge of Phase A.** The branch merges once, after Phase B. Phase A adds no fixtures or outputs, so the PM may merge it early, but that is not required.

### Phase A (now, after T032): new files only

1. **`packages/dragon/src/fonts/wire.ts` (new).** Pure TypeScript with no `node:` imports. It contains the glue Phase B calls:
   - **`collectFontFaces(contexts, resolveUrl)`.** Takes `AtRuleContext`-shaped nodes and a resolver from url to snapshot asset (id and bytes). It returns `FontFaceResult[]` plus typed problems, using `font-face.ts` unchanged.
   - **`projectFonts(rawMap, faces, assets)`.** Runs `validateFontMap`, then `buildManifest`. It resolves each pinned face `src` as a snapshot asset id or a `data:` URL; an unknown id is `unresolved-asset`. It returns `{ map, manifest, digestInput | null, problems }`, where `digestInput` is null when there are no faces and no map.
   - **`familySupport(listText, map, declared)`.** Returns the `EntryResolution[]` and a **resolution-kind feature key**: one of `font-family:<pinned>`, `font-family:<declared>`, `font-family:<platform>` or `font-family:<unmapped>`. The key never contains an author family name. The Ahem single-family case returns null, so the existing `font-family:Ahem` keys are untouched.
   - **`webFontOutput(usedPinned, declaredFaces, manifest)`.** Returns the `@font-face` text and the asset list `{ path: 'fonts/<sha256-hex-16>.<ext>', hash, bytes }`. The output is deterministic, sorted by path.
2. **`packages/dragon/test/fonts/wire.test.ts` (new).** Unit tests for everything above:
   - one changed byte changes `digestInput`;
   - reordering the rules does not;
   - an empty input gives null;
   - every problem kind is reachable;
   - the feature key never contains an author name;
   - `familySupport` equals Chrome's resolution on the rows of `pinned.json` and `parsing.json` (read, not recaptured).
3. **The stated-reference tooling.**
   - **`scripts/capture-font-reference.ts` (new).** It uses `launchChrome`, `chromeArgsAt` and `openPage` from parity/src/chrome.ts, imported unchanged. It implements §1.3 in the page, then commits `packages/dragon/test/fonts/reference/*.json` with the Chrome version, flags, font SHA-256 values and DPR. It has a `--check` mode.
   - **Probe P1:** the `Page.setFontFamilies` behaviour of §1.3, recorded as data.
   - **Probe P2:** the CSSOM rewrite on a corpus of family lists, covering:
     - unquoted `sans-serif`;
     - quoted `"sans-serif"`, which must **not** be rewritten;
     - `'Lato', sans-serif`;
     - `monospace`;
     - `system-ui` as a platform generic;
     - the case-folded `SANS-SERIF`;
     - `font` shorthands.

     For each text node, Chrome's `CSS.getPlatformFontsForNode` must give the pinned postScriptName: Inter-Regular at 400, Inter-Bold at 700, and Inter-Italic under italic.
   - **Probe P3, the control:** on a document without pinned generics, the rewrite leaves every computed value and every box byte-identical.
   - **Planted:** `--plant quoted-generic-rewritten` and `--plant generic-not-rewritten` must each fail `--check`.
4. **Note:** `docs/goals/milestone-2-proof/notes/T011-txt1c-wiring.md`.

### Phase B (after the §2 gates): the wiring

- **B1. at-rules.ts.** `font-face` gets its own handler and a new accepting `AtRuleOutcome` kind, `font-face`, which carries the context. Every other entry is unchanged.
- **B2. stylesheet.ts.** One branch in `refuseNode`: an accepted `font-face` outcome goes to a collector returned beside the rules, with no diagnostic and no enclosed rules. Nothing else in the driver changes.
- **B3. project.ts.**
  - `validateConfig` accepts an optional top-level `fonts` key. Validation problems are typed `DRAGON_FONT_MAP_INVALID` errors.
  - `analyze()` calls `projectFonts`.
  - The manifest's `digestInput` enters the digest object **only when it is not null**, so every existing digest, header and expectedDigest stays byte-identical. `config.fonts` is already covered, because `config` is digested.
  - A new `checkFamilies` runs per case on web. It reports each font-family declaration's resolution:
    - `unmapped-family`: `DRAGON_FONT_UNMAPPED_FAMILY` (error, web), whose fix names the map and `@font-face`;
    - `remote-url`, `local-font`, `unresolved-asset`, `unreadable-font` and `unsupported-descriptor`: their own codes;
    - `descriptor-not-applied`: a warning.
  - Native targets are unchanged: `textFontProblem` still refuses non-Ahem fonts with `DRAGON_UNSUPPORTED_FONT` until TXT1a.
- **B4. Feature keys.**
  - `css/values.ts` `featureOf`: the `family` and `family-list` branches only.
  - `analysis/context.ts` `usedKeys`: the font-family feature only.
  - Both take the resolution-kind key from `familySupport` through the case's font context. `font-family:Ahem` and every existing row key stay byte-identical.
  - If a context-free `featureOf` cannot carry this without a signature change at more than these call sites, stop and report (stop_if).
- **B5. web-css.ts.**
  - Resolved family values are rewritten through `rewriteFamilyList`.
  - The `@font-face` rules go first in `dragon.css`, after the header.
  - With no fonts, the output is byte-identical.
- **B6. Public API.**
  - `types.ts`: `ProjectConfig.fonts?`, the public `FontMap` types, and an additive `assets` on the ready web output, typed `readonly GeneratedAsset[]` (`{ path, hash, bytes }`) and empty when there are no fonts.
  - `index.ts` and `internal.ts`: exports only.
  - `docs/api.md`: the font map, the codes, the assets, and the pinned "Dragon Sans" recommendation.
- **B7. Diagnostics and faults (append only).**
  - **Codes:** `DRAGON_FONT_MAP_INVALID`, `DRAGON_FONT_UNMAPPED_FAMILY`, `DRAGON_FONT_REMOTE_URL`, `DRAGON_FONT_LOCAL`, `DRAGON_FONT_UNRESOLVED_ASSET`, `DRAGON_FONT_UNREADABLE`, `DRAGON_FONT_UNSUPPORTED_DESCRIPTOR` and `DRAGON_FONT_DESCRIPTOR_NOT_APPLIED` (warning).
  - **Compiler faults:** `pinnedGenericNotRewritten`, `fontFaceNotEmitted`, `fontManifestOutOfDigest` and `unmappedFamilyAccepted`. Each must fail a named fixture or unit test.
- **B8. Parity.**
  - **Fixture group `fonts`** (new), 400x300, ltr and rtl, `rootFont: 'ua-default'` with explicit families. It contains:
    - declared `@font-face` families, which Chrome renders natively, with no stated reference;
    - pinned `sans-serif` and `monospace` at 300, 400, 700 and italic, against the §1.3 stated reference;
    - a platform-mode `system-ui` (caveat);
    - `'Lato', sans-serif` rejected as unmapped;
    - rejects for remote URLs, `local()`, `unresolved-asset` and the map-invalid case.

    The comparisons are computed values, boxes, and the font key per text node (postScriptName from `CSS.getPlatformFontsForNode`).
  - **Harness hooks:**
    - `fixture-reader.ts`: `@font-face` `url()` resolves to vendor/fonts snapshot assets;
    - `pipeline.ts` `compileFixture`: passes the fixture's font map, and inlines web assets as `data:` URLs in the CSS text it renders. The CSS is byte-identical when there are no assets;
    - `capture.ts`: one hook that applies a fixture's stated-reference transform, and does nothing when the fixture has none;
    - `packages/parity/src/font-reference.ts` (new): the in-page transform shared with Phase A's script.
  - `seams.test.ts`: `font-face` and `Font-Face` leave the refusal pin and gain an acceptance assertion.
- **B9. Device step.** The fonts fixtures are web-only, because native refuses non-Ahem fonts. If `parity:lanes` derives no new native case, the note records that from the derived counts, and no lease is needed. If any new case enters a native lane, run the device step as in T025 TREE item 18, holding the lease.
- **B10. The north star.** `pnpm run north-star:check` is regenerated. The error total per target must not rise. The 'Lato' rows move from `UNSUPPORTED_VALUE` to `FONT_UNMAPPED_FAMILY` on web, and the note lists the per-code moves. examples/** is not edited otherwise (§1.4).

## 4. Allowed files

**Phase A:**
- `packages/dragon/src/fonts/wire.ts` (new; no existing `fonts/*.ts` is edited)
- `packages/dragon/test/fonts/wire.test.ts` (new)
- `packages/dragon/test/fonts/reference/**` (new)
- `scripts/capture-font-reference.ts` (new)
- `docs/goals/milestone-2-proof/notes/T011-txt1c-wiring.md`

**Phase B:** everything in Phase A, plus:
- `packages/dragon/src/css/at-rules.ts` (the font-face entry and the new outcome kind)
- `packages/dragon/src/css/stylesheet.ts` (the one accepted-outcome branch in `refuseNode`, and the collector in the return)
- `packages/dragon/src/project.ts` (the `fonts` config key, `projectFonts`, the conditional digest input, `checkFamilies`, and passing the web assets)
- `packages/dragon/src/css/values.ts` (the `featureOf` family and family-list branches only)
- `packages/dragon/src/analysis/context.ts` (the `usedKeys` font-family feature only)
- `packages/dragon/src/emit/web-css.ts` (the family rewrite and the `@font-face` prelude)
- `packages/dragon/src/types.ts`, `packages/dragon/src/index.ts`, `packages/dragon/src/internal.ts` (the additive public types and exports only)
- `docs/api.md`
- Append only: `packages/dragon/src/faults.ts`, `packages/dragon/src/diagnostics/codes.ts`, `packages/dragon/src/diagnostics/catalogue.ts`, `packages/dragon/test/diagnostic-codes.json`
- `packages/dragon/test/seams.test.ts` (the at-rule refusal pin only)
- `packages/dragon/test/fonts-wiring.test.ts` (new)
- `packages/parity/src/fixture-reader.ts` (`@font-face` asset resolution only)
- `packages/parity/src/pipeline.ts` (in `compileFixture`, the font map and the inlining of assets into the rendered CSS only)
- `packages/parity/src/capture.ts` (the stated-reference hook only)
- `packages/parity/src/font-reference.ts` (new)
- `packages/parity/src/fixture-groups/fonts.ts` (new)
- `packages/parity/src/fixtures.ts` (one import and one concatenation)
- `packages/parity/fixtures/fonts-*.html`, `packages/parity/fixtures/reject-fonts-*.html` (new)
- `packages/parity/test/fonts-fixtures.test.ts` (new)
- Case-count pins: converted to derived counts, or bumped only where the new fixtures move them
- `packages/parity/expected/**`, `packages/parity/expected-dpr/**`, `packages/layout/vectors/**` (new files only)
- `packages/parity/emitted/**` (new bodies; headers relaxed)
- `packages/dragon/src/profiles/*.ts` (`profile:rows` output; new web rows only)
- Generator output: `packages/parity/out/lanes.json`, `packages/translate/corpus-dpr.json`, `packages/wpt/expectations/**`
- `examples/music-player/dragon/north-star-check.json` (regenerated)
- **Device step, only if B9 applies, with the lease:** `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**`, `packages/parity/expected-pixels/**` (new cases only)

**Never:**
- `packages/dragon/src/media/**`, `ua/**`, `scripts/capture-ua-defaults.ts`;
- `analysis/cascade.ts`, `resolve.ts`, `computed.ts`, `computed-checks.ts`;
- `lower/**`, and `emit/` other than web-css.ts;
- `packages/layout/src/**`, `packages/translate/src/**`;
- `parity/src/chrome.ts`, `compare.ts`, `render.ts`, `lanes.ts`, `native-*.ts`, `targets.ts`;
- existing `fonts/*.ts`;
- `package.json`, the lockfile, `examples/**` (apart from the regenerated JSON), `design/`, and the GoalBuddy control files.

## 5. Verify

Every command runs after `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`.

**Phase A:**
1. `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`. Everything is green, and nothing is skipped, `.only` or `.todo`.
2. `pnpm exec vitest run packages/dragon/test/fonts`: green.
3. `node --conditions=dragon-internal scripts/capture-font-data.ts --check`: exit 0, unchanged.
4. `node --conditions=dragon-internal scripts/capture-font-reference.ts`, then run it again with `--check`: byte-identical. P2 finds the pinned postScriptName on every node, and P3 is identical.
5. Each of `scripts/capture-font-reference.ts --check --plant quoted-generic-rewritten` and `--check --plant generic-not-rewritten` exits 1.
6. `grep -rn "from 'node:" packages/dragon/src/fonts` finds nothing.
7. `git diff --exit-code BASE_A -- packages/dragon/src/fonts ':!packages/dragon/src/fonts/wire.ts'`. `git diff --name-only BASE_A..HEAD` lies inside the Phase A files. `git remote -v` is empty.

**Phase B** (also rerun Phase A 1-6):
1. `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`. `vitest list` at BASE_B is a subset of HEAD's.
2. `pnpm run parity:capture && pnpm run parity:dpr-capture`, twice, with no diff on the second run. Then `git diff --diff-filter=MD --exit-code BASE_B -- packages/parity/expected packages/parity/expected-dpr packages/layout/vectors`. Every existing emitted file is **byte-identical, headers included**.
3. `pnpm run layout:vectors && pnpm run layout:dpr-vectors`: new files only.
4. `pnpm run parity:report`: failed 0. `pnpm run parity:dpr-report`: failed 0 at 2, 3 and 2.625.
5. `pnpm run profile:rows`: new web rows only. No ios or android row changes. `font-family:Ahem` rows are unchanged.
6. `pnpm run layout:subset`. `pnpm run native:gen && git diff --exit-code packages/layout/generated`. `pnpm run native:swift`, `pnpm run native:kotlin`.
7. `pnpm run native:build -- --target ios && pnpm run native:build -- --target android`: exit 0 at the derived counts, with existing case sources byte-identical to a BASE_B build.
8. `pnpm run parity:lanes -- --run-host`: exit 0.
9. Planted faults: each of the 4 new compiler faults fails its named case. Every earlier plant is still caught, including `isSpecificityFirstArgument` and TREE's and MQ-a's.
10. `pnpm run north-star:check`: the total per target does not rise, and the per-code moves are listed.
11. `pnpm run wpt:update-expectations`: no pass becomes a fail, and every new fail has a written reason.
12. Protected paths: `git diff --exit-code BASE_B --` on every path in the §4 "Never" list.
13. `git diff --name-only BASE_B..HEAD` lies inside the Phase B files. `git remote -v` is empty.
14. **Device step, only if B9 applies, with the lease:** `pnpm run layout:break-vectors && pnpm run parity:break-capture && pnpm run parity:pixel-capture`, adding new cases only. Then `pnpm run parity:lanes -- --run-host --run-device`: no lane is `not run`, and no non-pixel lane fails on a new case.

## 6. Stop if

- A Phase B gate in §2 is not met at Phase B start, or T030 or T026 is in flight.
- A file outside the phase's allowed files is needed. In particular:
  - cascade.ts, resolve.ts, computed.ts, `lower/**`, the native emitters, `media/**`, the UA sources;
  - chrome.ts, compare.ts, render.ts;
  - an existing `fonts/*.ts`;
  - `package.json`;
  - a `featureOf` signature change beyond the two call sites.
- Chrome's font choice in the stated reference disagrees with the pinned map after `font_selection_algorithm.cc` and `CSSFontSelector` at 145.0.7632.6 have been re-read. Report it; never add a special case.
- The stated reference cannot be produced by Chrome's own CSSOM. Report P1 and P2 to the PM; do not substitute Dragon's rewrite.
- Any existing digest, emitted file (header included), capture, vector, profile row, native case source or WPT pass changes.
- The north-star error total rises for any target.
- A planted fault is not caught.
- A tolerance, case, DPR or direction would be loosened.
- A consumer of `ch` would report italic-trait faces as exact.
- Verification fails twice.
- **Device step:** the lease is not held.

## 7. Findings for the PM (not T011 blockers)

1. **Rounding.** decisions.md line 49 and `platform-rules.ts` (`ahem-metric-half-down`, "inferred, not traced") say macOS metric halves round down. T005 measured Skia's half-up `floorf(x + 0.5f)` on the float values Core Text returns; for example, Inter at 16px has ascent 15.5, and Chrome gives 16. The two can both hold, if Core Text's Ahem descents sit just below n.5, but that is unproven. Record T005's finding in decisions.md, and have TXT1a reconcile the Ahem rule with it before real-font metrics reach the engine.
2. **Spike font bytes.** T023 must confirm that the text-spike Inter bytes used by the HarfBuzz gate equal the vendored Inter 4.1 Regular. Otherwise TXT1a's shaping proof and the pinned face are on different bytes.
3. **decisions.md** should record §1 ("Dragon Sans" = Inter 4.1 static; the CSSOM-rewrite stated reference; no built-in default map, so an unmapped generic is a build error with a fix).
4. **The NS-REF recapture** with the §1.3 transform, and the font key refresh, follow T011 B and the owner's Lato ruling. That work belongs to the north-star lane.
