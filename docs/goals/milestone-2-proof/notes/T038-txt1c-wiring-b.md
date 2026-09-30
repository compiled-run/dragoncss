# T038: TXT1-C wiring, Phase B (Worker, 2026-09-29)

Spec: notes/T033-txt1c-wiring-spec.md Phase B (binding). Phase A: notes/T011-txt1c-wiring.md. Rulings: decisions.md "Pinned generic
fonts", "The north star bundles Lato", "Variable fonts are fenced".

- **Worktree:** /tmp/dragon-fonts-wire.
- **BASE_B:** origin/master 1211f422. Phase A (3a733a28) was already on master, so the merge of origin/master was a fast-forward.
- **Gates (§2):** P5 (T007), casc-logical and TREE (T015) are merged on master. MQ-a B (T030) and V2a (T026) are queued, not in flight.
- **Two stacked branches.** Phase B as a whole is about 184 KB reviewable, over the 150 KB limit, so it is split by theme:
  1. `txt1c-wiring` at 05d94e17: the compiler, the public API, docs/api.md, the north-star font map. 109 KB reviewable.
  2. `txt1c-wiring-parity` at b2a05240, on top of 1: the fonts fixtures, the web-only lane, the report, and the regenerated outputs.
     75 KB reviewable.

## What changed

### Branch 1, `txt1c-wiring` (compiler)

- **The quoted-generic fix (the board's first item).** In `font-map.ts` `rewriteFamilyList`, a family entry whose name is one of
  Chrome's parser generics (`sans-serif`, `monospace`, ...) was quoted, so it names a family and is never pinned. Evidence: P2 and a
  new `pinned.json` request. `"sans-serif", monospace` renders NotoSansMono-Regular, not Inter. `wire.test.ts` now runs Dragon's
  rewrite over every P2 visit and must equal Chrome's CSSOM result. Before the fix, 3 tests fail.
- **Lato (T036 constraint).** The pinned capture's map gains `Lato` (vendor/fonts/Lato, 400 and 700) and four requests, recaptured.
  Chrome renders Lato-Regular and Lato-Bold. The north-star check's font map pins `Lato` and `sans-serif` (Dragon Sans), with the
  font files as snapshot assets. `wire.test.ts`'s unmapped examples move from `Lato` to `Nope`.
- **B1 and B2.** `@font-face` has its own handler, `acceptFontFace`, which returns the new `font-face` outcome. `refuseNode` passes it
  to a `fontFaces` collector, which is a new optional argument of `parseStylesheet`.
- **B3.** The configuration takes an optional `fonts` key. Every map problem is `DRAGON_FONT_MAP_INVALID`, and so is an unknown key
  on a pinned entry (audit fix).
  - `analyze` collects the faces. Each src URL is resolved through the snapshot's asset resolutions from the stylesheet that holds it.
  - `projectFonts` runs, and every problem gets its own code.
  - The digest is now computed after parsing. The manifest enters it under `fonts` only when the project has fonts.
  - `checkFamilies` is context-free over every applying declaration. A value holding `var()` is checked per case, after substitution.
- **B4.** `featureOf` and `usedKeys` take an optional font context, which is additive, so every existing call site is unchanged.
  `project.ts` and `support.ts` (resolved queries) pass it. `font-family:Ahem` is unchanged.
- **B5.** `emitWebCss` takes an optional `WebFontContext`. With it, font-family values are rewritten through the map, and after the
  header come the `@font-face` rules of the pinned families used and of every declared face. Without it (no `@font-face` and no
  map), the output is byte-identical.
- **B6.** Additive public types:
  - `ProjectConfig`, `FontMap`, `FontMapEntry`, `GenericKey`, `PinnedFace`, `GeneratedAsset`;
  - the ready output's `assets`;
  - docs/api.md §2.3 Fonts, and §7.1 for the stated reference.
- **B7.** Nine codes, appended, and four compiler faults:
  - **Codes:** the spec's eight, plus `DRAGON_FONT_VARIABLE_REFUSED` (ruling 7).
  - **Faults:** `pinnedGenericNotRewritten`, `fontFaceNotEmitted`, `fontManifestOutOfDigest` and `unmappedFamilyAccepted`.
- **The T028 constraint.** `fenceVariableInstance` runs at style resolution (`checkCaseFonts`) on the faces Chrome selects. For each
  text node that is the best capability group of every declared or pinned family its list names, at the node's size and at the
  node's UA weight and style.

### Branch 2, `txt1c-wiring-parity`

- **Fixture group `fonts`.** Six reject fixtures join the corpus (one import and one concatenation in `fixtures.ts`):
  - unmapped `'Nope', sans-serif`;
  - quoted `"sans-serif"`;
  - a remote URL;
  - `local()`;
  - an unresolved asset;
  - an invalid map.
- **Five web-only layout fixtures** (`FONT_FIXTURES`), each at 400x300, in ltr and rtl, on the UA-default root font:
  - `fonts-pinned-sans`: Inter-Regular, Inter-Bold (h1), Inter-Italic (address), Inter-BoldItalic (h2 in address);
  - `fonts-pinned-mono`: NotoSansMono-Regular, for `monospace` and for `monospace, sans-serif`;
  - `fonts-lato`: Lato-Regular, Lato-Bold, and synthetic italic from Lato-Regular;
  - `fonts-declared`: two `@font-face` faces of one family, Roboto-Regular and Inter-Bold at 700;
  - `fonts-platform`: `system-ui` in platform mode, so a platform face.
- **The web-only lane** (`fonts-run.ts`). It runs chrome-dual exactly: authored under the stated reference against Dragon's web CSS
  with its font assets inlined. Every element that has text must also render the expected face in both documents, read with
  `CSS.getPlatformFontsForNode`. linux-dragon-layout is `not-run`.
- **Harness hooks:**
  - `font-reference.ts` (new): the in-page CSSOM rewrite, moved out of `scripts/capture-font-reference.ts` unchanged (`--check` is
    byte-identical);
  - `fixture-reader.ts`: an `@font-face` `url()` that names a file under vendor/fonts becomes a snapshot asset and a resolution;
  - `pipeline.ts` `compileFixture`: passes the fixture's font map, with its faces added as assets;
  - `webCssOf`: inlines the font assets as `data:` URLs, and is unchanged when there are none;
  - `capture.ts`: an optional `prepare` hook for the stated reference;
  - `cli/capture.ts`: also captures the fonts fixtures;
  - `gen-profile-rows.ts`: derives rows from them too;
  - `report.ts` and `cli/report.ts`: the web-only cases count apart from the two-lane cases (`summary.webOnly`, `webOnlyCases`, one
    row in summary.md), and a row they prove links to them;
  - `parity.test.ts`: runs each fonts fixture, and its registry, profile-proof and direction checks read the corpus and the fonts
    cases.
- **Regenerated outputs:**
  - `packages/parity/expected-fonts/**` (new): the captures and emitted CSS;
  - `profiles/web.ts`: six new web rows;
  - `packages/parity/emitted/**`: header digests only;
  - `north-star-check.json`.

## Rulings (decided by research; the reasons are recorded here)

1. **Quoted generic names** (above). A family entry named like a parser generic is a family. `ui-*`, `emoji` and `fangsong` keep
   their behaviour: Chrome 145 treats them as family names whether or not they are quoted (T011).
2. **`DRAGON_FONT_UNMAPPED_FAMILY` blocks every target (target null), not web only.**
   - The spec says "error, web". But the font map is target-independent, and "Dragon never silently uses a machine font" applies on
     every target: a native target has no bytes for an unmapped family either.
   - A target-null error is also what lets the reject fixtures pass. The harness's reject check requires a code with target null or
     ios, and both outputs blocked.
   - The `@font-face` source errors are target null for the same reason.
3. **Invalid and unknown `@font-face` descriptors, and rules with no family or src, are `DRAGON_CSS_INVALID_VALUE`.**
   - Chrome drops all of them, and Dragon's policy is that an invalid declaration is an error.
   - A nested rule inside `@font-face` is `DRAGON_CSS_PARSE`.
   - `font-display` gets the `DRAGON_FONT_DESCRIPTOR_NOT_APPLIED` warning, because it has no effect on bundled faces.
4. **`@font-face` is accepted only at the top level of a stylesheet, with no prelude and a block.**
   - Chrome ignores it inside a style rule.
   - Inside `@media` or `@supports` it is refused together with that rule, until MQ-a.
   - The seams byte pin (4c1331c) still holds with `font-face` and `Font-Face` in it, because the pinned sheets are exactly the
     invalid forms. The test "every registered name is refused today" became "every registered name but font-face is refused today",
     and an acceptance test was added. It is the only name missing from the BASE_B `vitest list` when compared with HEAD.
5. **A lone unquoted generic keyword stays a family list** (`values.ts` `familyValue`). Before this, `font-family: sans-serif` became
   the family `sans-serif`, and the web output wrote it quoted (`"sans-serif"`), which Chrome reads as a different family. This is
   one line outside the "featureOf branches only" allowance, and the rewrite needs it.
6. **`featureOf(property, v, fonts?)`: an optional third argument, not a signature change.**
   - The spec's stop_if is about a signature change at more than the two call sites. The existing callers compile unchanged.
   - `computed-checks.ts` (a "Never" file) still keys a `var()`-substituted font-family the legacy way, so such a value stays
     `DRAGON_UNSUPPORTED_VALUE`, never silently accepted. `checkCaseFonts` adds the unmapped check after substitution.
7. **`DRAGON_FONT_VARIABLE_REFUSED` (new code).** T028's `variable-font-refused` issue and the instance fence needed a code; the
   spec's list predates T028.
8. **Fence weight and style come from the UA.** Dragon has no `font-weight` or `font-style` longhand. An author declaration of either
   is `DRAGON_UNSUPPORTED_PROPERTY`. So a text node's weight and style are the UA's, inherited (`userAgentTextFonts`: h1 to h6 bold,
   address italic). Test: Inter VF at 16px in a div passes; in an h1 its wght 700 instance is refused.
9. **`checkValues` skips `font-family:<unmapped>`.** `checkFamilies` reports it once, as `DRAGON_FONT_UNMAPPED_FAMILY`, so it is not
   also `DRAGON_UNSUPPORTED_VALUE`.
10. **The web-only fonts fixtures stay out of `FIXTURES`.**
    - Every layout case in `FIXTURES` must pass linux-dragon-layout, have a vector and derive native cases (vectors.ts, dpr.ts,
      break-vectors, lanes, native:build). Native refuses non-Ahem text until TXT1a.
    - So the fonts layout fixtures are their own registry. Their captures are kept apart in `packages/parity/expected-fonts`. The
      platform-neutrality guard and the "every capture has a vector" check are about the two-lane corpus, where a pinned face and the
      UA `Times` on html would otherwise trip them.
    - The rejects, which need no lane, are in `FIXTURES`.
    - This deviates from "fixtures.ts: one import and one concatenation" only in what the concatenation holds.
11. **Weights.** There is no `font-weight` longhand, so 300 (Inter Light) cannot be reached. 700 comes from the UA's h1 to h3 and
    italic from the UA's address. The spec's "300, 400, 700 and italic" becomes 400, 700, italic and 700 italic.
12. **`font-family:<platform>` web rows are `caveat`** (`profile-rows.ts`, following the font map's `supportOf`). Every other web row
    is exact. `parity.test`'s "every web row is exact" carries that one exception.
13. **The monospace size quirk.** Chrome gives a lone `font-family: monospace` a 13px default size. The stated reference rewrites
    `monospace` to "Dragon Mono" in the CSSOM, which removes the quirk, so both documents compute 16px. This follows §1.3, where
    pinning a generic is an approved change. It is recorded because it is a visible difference from the unpinned document.
14. **Emitted headers.** Every existing `packages/parity/emitted/*.css` changes only in its header digest, because the digest covers
    the web profile, which gained six rows. The allowed files say "headers relaxed". Every body and every capture is byte-identical.
15. **B10 (north star).** Lato is mapped (T036), so the Lato declaration is never `DRAGON_FONT_UNMAPPED_FAMILY`.
    - Its web `DRAGON_UNSUPPORTED_VALUE` rows (2) become `DRAGON_UNPROVEN_CONTEXT` rows (2) for text-in-flex-item row and column. The
      pinned web rows prove text-in-block only.
    - ios and android are unchanged, since native still refuses non-Ahem fonts.
    - Per-target error totals are unchanged: web 185, ios 219, android 690.

## Verify

Every command ran with the required `export`, on `txt1c-wiring-parity`, unless noted.

- **Phase A:**
  1. Covered by the full suite below.
  2. The fonts tests are green (115 with fonts-wiring).
  3. `capture-font-data.ts --check`: byte-identical (5 files).
  4. `capture-font-reference.ts --check`: byte-identical (3 files), every probe holds.
  5. Both `--plant` runs exit 1.
  6. `grep "from 'node:" packages/dragon/src/fonts`: nothing.
- **B1:** `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` on `txt1c-wiring-parity`: 109 files, 2319 tests passed, and
  nothing is skipped. The `fonts-run` face-coverage commit (b2a05240) came after that run; `fonts-fixtures.test.ts` passes 19/19 on it.
  On `txt1c-wiring` alone, 108 files and 2284 tests. 10 tests in 7 files hit the 120 s and 900 s timeouts at load 60 to 90 (dpr,
  lanes, lanes-records, native-compare, native-host, native-kotlin, planted-kotlin), and each of the 7 files passes when rerun alone.
  - `vitest list`: BASE_B has 2259 tests and HEAD has 2319. The only BASE_B name missing at HEAD is the renamed seams test (ruling 4).
  - The first runs timed out at 120 s in lanes, lanes-records and native-compare while the host load average was 60 to 90. They
    pass on rerun, and they are untouched by this work.
- **B2:** `parity:capture` and `parity:dpr-capture` ran twice, and the second run changed nothing.
  `git diff --diff-filter=MD --exit-code 1211f422 -- packages/parity/expected packages/parity/expected-dpr packages/layout/vectors`
  exits 0. Emitted files: see ruling 14.
- **B3:** `layout:vectors` and `layout:dpr-vectors`: no file changed. No new two-lane case exists.
- **B4:** `parity:report` has 240/240 fixtures (183 layout, 375 cases) passing, failed 0, and the web-only fonts cases 10/10.
  `parity:dpr-report`: 1125/1125 cases, failed 0, at 2, 3 and 2.625.
- **B5:** `profile:rows`, twice. It added six web rows: `font-family:<pinned|declared|platform>` at text-in-block ltr and rtl. No ios
  or android row changed, and the `font-family:Ahem` rows are unchanged.
- **B6:** `layout:subset`, `native:gen` (`git diff --exit-code packages/layout/generated` exits 0), `native:swift` and
  `native:kotlin`: all exit 0.
- **B7:** `native:build`: 375 cases on each target (`layoutCases()` 375), and the source sha256 is identical to a BASE_B build of
  the same worktree state:
  - ios c157fa19…;
  - android 74345a3a….
- **B8:** `parity:lanes -- --run-host` exits 1 only because of the device-pixels lane (ios 568 and android 1422 pixel failures).
  `out/lanes.json` is byte-identical to master's, which records the same pixel failures, so the failure is not from this work.
  - Every other lane passes on both targets.
  - The case lists are unchanged (375 per DPR).
- **B9, device step:** no new native case (the derived counts are unchanged), so no lease was needed and none was taken.
- **B10:** see ruling 15.
- **B11:** `wpt:run -- --target web`, then `wpt:update-expectations -- --target web`: no file changed.
- **B12 (protected paths):** no "Never" path changed, apart from `examples/music-player/tools/check.ts`, which the T036 constraint
  requires.
- **B13 (files outside the Phase B list):** each is required by a constraint, a ruling or a retarget:
  - `fonts/font-map.ts` (T038);
  - `scripts/capture-font-data.ts` with `pinned.json` (T036);
  - `support.ts` (ruling 6);
  - the `android-target` and `ua` test retargets (below);
  - `report.ts`, `cli/report.ts`, `profile-rows.ts`, `gen-profile-rows.ts`, `cli/capture.ts`, `fonts-run.ts`, `parity.test.ts` and
    `expected-fonts/**` (ruling 10);
  - `values.ts` `familyValue` (ruling 5).

  `git remote -v` in the worktree is the shared clone's.
- **Planted faults:**
  - `pinnedGenericNotRewritten` fails `fonts-pinned-sans`;
  - `fontFaceNotEmitted` fails `fonts-declared`;
  - `unmappedFamilyAccepted` fails `reject-fonts-unmapped`;
  - `fontManifestOutOfDigest` fails its unit test in `fonts-wiring.test.ts`.

  Every earlier plant is still caught, because the whole suite is green.

## Changed tests, with reasons

- **`android-target.test.ts`, "font and lowering diagnostics are reported for every configured native target".** `serif` on its own
  is now an unmapped family (a target-null error that stops per-case analysis). The test maps serif to `{ mode: 'platform' }`, so
  it again reaches the native font refusal it checks.
- **`ua.test.ts`, the web emitter's import pin.** It gains the four fonts-rewrite imports. The test's point is unchanged: no lowering,
  no layout, no selector matching.
- **`seams.test.ts`.** Ruling 4.
- **`wire.test.ts`.** Its unmapped examples use `Nope`, because Lato is mapped. A P2 comparison test was added.
- **`parity.test.ts`.** Rulings 10 and 12:
  - fonts cases are added to the checks that derive profile rows;
  - the "committed captures" check reads the corpus only;
  - one web row is caveat.

## Findings for the PM

1. **`computed-checks.ts`** reports `DRAGON_UNSUPPORTED_FONT` with target `ios` for UA-bold text ("inherits font-weight: 700 ...")
   even when ios is not a configured target, as in a web-only `createProjectWith`. It is outside this package, which may not touch
   that file.
2. **The pinned web rows prove text-in-block only.** The north star's Lato text in flex items stays `DRAGON_UNPROVEN_CONTEXT` on web
   until a fonts fixture covers text-in-flex-item. That fixture needs flex declarations, which would add fonts cases to existing
   rows' proofs.
3. **The spec's "headers included" (verify B2) conflicts with its own "headers relaxed" (allowed files)** whenever a package adds
   profile rows, because the digest covers the profiles.
4. **`var()` in font-family keeps its legacy feature key** in `computed-checks.ts`, so such a value is never supported until that
   file keys it through the font context.
