# T025: TREE (T015), MQ-a (T016) and ELB-2 (T017) Worker packages

Judge note, 2026-09-28. This review is read-only; the only file written is this note.

**Read for this review:**
- goal.md, state.yaml (T002, T020, T021, T022, T004/T005/T011, T006/T009, T007, T013, T014, T015–T017);
- notes/T010-north-star-plan.md in full, notes/T004-txt1c-spec.md, notes/T006-value-model-spec.md;
- milestone-2 notes/T015-p4-review-p5-plan.md §4 (the P5 allowed files, protected paths and merge rule);
- docs/decisions.md "Selectors and scrollbars".

**Code read, at 184d6ff (integration HEAD, which is feat-block-elements merged) and the branches:**
- css/selectors.ts, analysis/match.ts, css/at-rules.ts, css/stylesheet.ts (parseRule and the at-rule driver) and analysis/cascade.ts;
- project.ts (checkTemplates, InternalOptions), analysis/link.ts (attributes as element data) and emit/web-css.ts;
- ua/datasets.ts, the ua generated file, scripts/capture-ua-defaults.ts and test/ua.test.ts;
- diagnostics/codes.ts and faults.ts;
- parity fixture-reader.ts, tree-fixture.ts, fixtures.ts (t014) and fixture-groups/selectors.ts;
- examples/music-player tools/check.ts and snapshot.ts (ns-lane-ref) and styles.css;
- internal.ts Environment (t014).

**Branch diffs checked with `git diff --name-only master...<branch>`:** feat-block-elements, feat-cascade-var, feat-units, wpt-breadth, engine-linebreak, t014-p4-backends, ns-contexts, ns-lane-ref and casc-logical. casc-logical is still at 184d6ff with no commits.

## 0. Rulings

1. **TREE can start from master as soon as T020 fast-forwards it. It runs in parallel with P5, V1 Phase A, ELB-2 and MQ-a Phase A.** It can run in parallel with T021 only once T021's allowed_files exclude TREE's files (board update 1). This is safe because T021 has no reason to touch selectors or matching, and casc-logical has no commits yet.
2. **MQ-a: the evaluator can start now, but the wiring must wait for T022.**
   - **The cascade hook can be written without touching cascade.ts.** Media conditions only decide which rules exist for an environment band, so the fold filters the rule list in project.ts before `resolveTree`. cascade.ts is not edited. This also keeps MQ-a clear of the `beats`, `customs` and substitution rewrite in feat-cascade-var.
   - **The wiring cannot be written in a way that avoids T021.** Accepting `@media` means changing the parse driver (`refuseNode` and `Rule` in css/stylesheet.ts). feat-cascade-var rewrites that file, and T021 owns `css/**`.
   - **So MQ-a is split in two:**
     - **Phase A (now):** new files only. These are the media query parser and evaluator, the band partition and a Chrome 145 `matchMedia` corpus. It runs alongside everything.
     - **Phase B (after T022 and after TREE is on master):** the at-rules.ts entry, the stylesheet.ts driver, per-band resolution in project.ts, the band blocks in web-css.ts, the parity fold and fixtures.
3. **ELB-2 is data only. It can start from master after T020 and run alongside every other lane.**
   - It changes no compiler source, fixture or support row.
   - The UA dataset does not enter the compilation digest. project.ts digests only `chromeVersion` and `platform`, so no emitted header, expectedDigest or lanes digest moves.
   - Its only overlap is the generated file `ua/chrome-145.darwin-arm64.generated.ts`, which T021 may also regenerate. The integrator reruns `pnpm run ua:capture` after merging both and never hand-merges the file.
   - It may merge at any time, including while P5 is in flight, because P5's fixture set and digests are unchanged.
4. **Merge timing for TREE and MQ-a Phase B.** Both add parity layout fixtures. That changes the set of cases on master, and P5 must prove every fixture that is on master when it starts (the rule in T015 §4 and T004 §4). So they merge **before P5 starts or after P5 lands, never while P5 is in flight**. In practice that means after P5.
   - Each then has a **device step**, like V1 Phase B: merge master, regenerate, add break vectors, Chrome breaks and pixels for the new cases only, and run `parity:lanes --run-host --run-device` while holding the device lease.
   - The device steps of V1, TREE, MQ-a and NS-LANE are serial, because there is one device lease.
5. **TXT1-C wiring (T011) is serial with TREE and MQ-a Phase B.** Once it has its Judge spec, T011 edits:
   - project.ts, which TREE and MQ-a-B also edit;
   - at-rules.ts, stylesheet.ts and web-css.ts, which MQ-a-B also edits.

   The order is TREE, then MQ-a-B, then T011. The PM may put T011 before MQ-a-B, but never run them at the same time. T011 must also not edit `scripts/capture-ua-defaults.ts` or `ua/datasets.ts` while ELB-2 is in flight, and must not claim `packages/dragon/src/media/**`.
6. **A finding T021 must carry.** feat-cascade-var's cascade.ts predates feat-selectors. Its diff replaces `specificityFor(sel, faults)` with `sel.specificity` and drops the import. Taking that side of the merge would silently disable the planted fault `isSpecificityFirstArgument`. T021 must keep `specificityFor`, and the selectors-specificity plant must still be caught (board update 2).

## 1. Parallelism matrix

| | P5 (T007) | V1 Phase A (T009) | TXT1-C wiring (T011) | T021 casc-logical | TREE | MQ-a A | MQ-a B | ELB-2 |
|---|---|---|---|---|---|---|---|---|
| **TREE** | yes: disjoint writes; merge after P5 plus the device step | yes | **no**: project.ts. T011 goes after TREE | yes, only with the T021 exclusions (update 1) | — | yes | **no**: MQ-a B needs TREE merged | yes |
| **MQ-a A** | yes | yes | yes, if T011 does not claim media/** | yes, with test/media/** excluded from T021 | yes | — | precedes | yes |
| **MQ-a B** | yes: disjoint writes; merge after P5 plus the device step | yes | **no**: at-rules, stylesheet, project, web-css | **no**: waits for T022 | after TREE | after A | — | yes |
| **ELB-2** | yes, and may merge during P5 | yes | yes, if T011 leaves the UA sources alone | yes: generated UA file regenerated at merge | yes | yes | yes | — |

**Shared append-only registries.** These files are already an integrator-resolved union under the T010 §2 and T006 precedent, never a reason to serialise:
- `packages/parity/src/fixtures.ts`: one import and one concatenation each;
- `packages/dragon/src/faults.ts`: fields and `NO_FAULTS` entries appended;
- `packages/dragon/src/diagnostics/codes.ts` and `catalogue.ts`: entries appended;
- `packages/dragon/test/diagnostic-codes.json`;
- the case-count pin tests. feat-cascade-var introduces `packages/parity/src/case-count.ts`, so after T022 the pins are derived. Any literal a pre-T022 package bumps is replaced by the derivation at merge.

Everything else in the three packages is provably disjoint from P5 (T015 §4), V1 (T006 §4) and T021 (once update 1 is applied).

**Worker count.** TREE, MQ-a A and ELB-2 bring the running writers to 6: T020, T021, T005 and these three. When T020 finishes, P5 and V1 A both become dispatchable, and that is one more than `max_write_workers: 6` allows. The PM either queues V1 A behind the first finisher, or raises the limit with a recorded reason.

## 2. Package T015: TREE

**Setup.**
- **Base:** master after T020 fast-forwards it (BASE). It contains feat-block-elements, feat-units, wpt-breadth, engine-linebreak, t014-p4-backends with M1 and M2, ns-contexts (fc87851) and ns-lane-ref (e1068c5). If T022 has landed by dispatch time, use that commit.
- **Worktree:** `/tmp/dragon-tree`.
- **Branch:** `ns-tree`.

**Objective.** Attributes become element data, and the north star becomes a tree fixture.
1. **Attributes as element data.**
   - Every attribute is carried into matching; link.ts already keeps them in `LinkedElement.attributes`.
   - `checkTemplates` in project.ts accepts an attribute without a diagnostic only if it is in a *rendering-neutral* table: `id`, `data-*`, `aria-*`, `role`, `title`, `ui-*`, and `rel` or `target` on tags other than a, area and link.
   - The table lives in a new file, `packages/dragon/src/attributes.ts`. Every entry cites HTML §15 and is proven neutral by a Chrome fixture pair: the same tree with and without the attribute, on each supported tag family (root, body, block elements, headings), must give identical Chrome captures in both directions.
   - Every other attribute stays refused as `DRAGON_UNSUPPORTED_ATTRIBUTE`, and the message names the package that owns its rendering effect:
     - `type`, `min`, `max`, `value`: FORM-a;
     - `src`, `alt`, `width`, `height`: REPL;
     - `href`: INL1 (it makes the `:link` UA rules apply);
     - `lang`: TXT1-C (it feeds locale font fallback);
     - `dir`: bidi;
     - `hidden`: display;
     - `style`: SOV.
   - An attribute whose neutrality cannot be proven stays refused and is listed in the note. That is not a stop.
2. **Selectors.**
   - **Attribute names:** css/selectors.ts accepts any attribute name. Namespaced names stay refused.
   - **Case sensitivity:** match.ts applies HTML's list of attributes whose values compare ASCII case-insensitively in selectors, cited from Blink's `HTMLDocument` or `IsCaseSensitiveAttribute` at 145.0.7632.6. The list is keyed by attribute name, whatever the element. The `i` flag keeps its current meaning.
   - **`#id`:** `IdSelector` is parsed with specificity [1,0,0] and matched against the `id` attribute, case-sensitively (fixtures are no-quirks). Every element carrying the id matches, as in Chrome. The rule that a component sheet needs an owner class on the subject is unchanged.
3. **Chrome-equal invalid-selector drop.**
   - A new committed generated table, `css/selector-validity.generated.ts`, is written by `scripts/capture-selector-validity.ts`. It records, for every pseudo-element and pseudo-class name the compiler meets (the styles.css inventory plus a fixed corpus), whether Chrome 145 parses it. The test is `CSS.supports('selector(...)')` in Chrome, and the script has `--check`.
   - A selector that Chrome finds invalid, such as `::-moz-range-thumb`, drops the whole rule, as Chrome does. The rule gets a new warning code, `DRAGON_SELECTOR_DROPPED`, which is appended.
   - Chrome-valid pseudo-elements stay refused as errors: `::-webkit-slider-thumb` belongs to FORM-a and `::-webkit-scrollbar*` to OVFL-s.
   - Suppressing the diagnostics of declarations inside a dropped rule needs a change to `parseRule` in stylesheet.ts, and that is MQ-a B's job (§3 B item 7). TREE leaves stylesheet.ts alone and lists the residual `-webkit-appearance` diagnostic.
4. **The fixture reader.**
   - fixture-reader.ts accepts HTML void elements (`img`, `input`, `br`, `meta`, `link`, `hr`), both without an end tag and with an immediate explicit end tag. The existing `<hr ...></hr>` fixtures use the second form.
   - `<link rel="stylesheet" href>` in `<head>` is resolved through an optional resolver callback into a snapshot source and a document style use, with spans into the CSS file.
   - The `FrontEndResult` of every fixture present at BASE must stay byte-identical.
   - tree-fixture.ts gains an additive reader for a fixture directory outside `packages/parity/fixtures`.
5. **The north star as a tree.**
   - `examples/music-player/tree/fixture.json` models the demo's components, with `libraryStatus` and `isPlaying` as free states. Classes are conditional bindings, and the play-icon text is a branch.
   - `expected` is hand-declared: the free states, `cases: 4`, the initial assignment and the text topology.
   - A test renders each of the 4 cases and requires equality with `freeStateHtml(html, id)` from ns-lane-ref's snapshot.ts, so the tree and the Chrome reference cannot drift apart.
6. **north-star:check moves onto the tree.**
   - tools/check.ts compiles the single tree input through the public `createProject` with targets web, ios (15.0) and android (`minSdk` 31). The A/B/C pass method is kept, applied to the tree.
   - The JSON is regenerated and records per-target counts.
   - The web and ios errors for UNSUPPORTED_ATTRIBUTE, UNSUPPORTED_SELECTOR and UNSUPPORTED_ELEMENT only shrink. The android counts are new and listed.
7. **Planted compiler faults**, appended:
   - `idSpecificityAsClass`;
   - `attributeCaseAlwaysSensitive`;
   - `invalidSelectorListKept`.

   Each must fail its named fixture through the existing planted-fault test path, the one that runs `isSpecificityFirstArgument`.
8. **Fixture group `attributes`.** It covers each of the following in ltr and rtl, with each fixture in both directions of its facet (matches / does not match, boundary cases):
   - an `#id` versus classes specificity contest;
   - `[rel=FOO]` on a div against `rel="foo"` (case-insensitive by name);
   - `[data-x=FOO]` (case-sensitive);
   - `[title]` presence;
   - the neutrality pairs;
   - `.a, .b::-moz-range-thumb {}`, where Chrome drops the rule;
   - rejects for `href`, `lang`, `style` and void `<img>`, each naming its owner package.

**Allowed files.**
- `packages/dragon/src/project.ts` (the `checkTemplates` attribute check only)
- `packages/dragon/src/css/selectors.ts`
- `packages/dragon/src/analysis/match.ts`
- `packages/dragon/src/attributes.ts` (new)
- `packages/dragon/src/css/selector-validity.generated.ts` (new; script output only)
- `scripts/capture-selector-validity.ts` (new)
- `packages/dragon/src/faults.ts`, `packages/dragon/src/diagnostics/codes.ts`, `packages/dragon/src/diagnostics/catalogue.ts`, `packages/dragon/test/diagnostic-codes.json` (append only)
- `packages/dragon/test/selectors.test.ts`: the `[data-x]` refusal row (line 68) is replaced by an acceptance assertion; other additions are appended
- `packages/dragon/test/attributes.test.ts` (new)
- `packages/parity/src/fixture-reader.ts`
- `packages/parity/src/tree-fixture.ts` (additive)
- `packages/parity/src/fixture-groups/attributes.ts` (new)
- `packages/parity/src/fixtures.ts` (one import and one concatenation)
- `packages/parity/fixtures/attr-*.html`, `packages/parity/fixtures/reject-attr-*.html`, `packages/parity/fixtures/tree-attr-*/**` (new)
- `packages/parity/test/fixture-reader.test.ts`, `packages/parity/test/north-star-tree.test.ts` (new)
- Case-count pins in the parity, layout and translate tests: converted to derived counts or bumped only where the new fixtures move them
- `packages/parity/expected/**`, `packages/parity/expected-dpr/**`, `packages/layout/vectors/**` (new files only)
- `packages/parity/emitted/**` (new bodies; headers relaxed)
- `packages/dragon/src/profiles/*.ts` (profile:rows output; existing rows may only gain proof case ids)
- `packages/parity/out/lanes.json`, `packages/translate/corpus-dpr.json`, `packages/wpt/expectations/**` (generator output)
- `examples/music-player/tools/check.ts`
- `examples/music-player/tools/snapshot.ts` (additive exports only)
- `examples/music-player/tree/**` (new)
- `examples/music-player/dragon/north-star-check.json` (regenerated)
- `docs/goals/milestone-2-proof/notes/T015-tree.md`
- **Device step (after P5 is on master, with the lease):** `packages/layout/break-vectors/**`, `packages/parity/expected-breaks/**`, `packages/parity/expected-pixels/**` (new cases only), `packages/parity/out/lanes.json`

**Verify.** Every command is prefixed with `export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools DRAGON_WPT_DIR=/Users/jacksm5pro/dev/open-source/dragon/vendor/wpt &&`.
1. `pnpm install --frozen-lockfile`, then `pnpm typecheck` and `pnpm test`: all green.
   - `vitest list` at BASE is a subset of HEAD's.
   - Nothing is skipped, `.only` or `.todo`.
   - `git diff --diff-filter=MD --name-only BASE -- '*/test/*'` lists only the pinned files.
2. The reader-identity test pins the sha256 of the canonical-JSON `FrontEndResult` of every fixture present at BASE. The digests are computed at BASE before any edit. The test passes.
3. `pnpm run parity:capture` and `pnpm run parity:dpr-capture`, each twice: the second run leaves no diff.
4. `git diff --diff-filter=MD --name-only BASE -- packages/parity/expected packages/parity/expected-dpr packages/layout/vectors` is empty. Under emitted/, existing files differ in header lines only.
5. `pnpm run layout:vectors && pnpm run layout:dpr-vectors`: new files only.
6. `pnpm run parity:report`: failed 0. `pnpm run parity:dpr-report`: failed 0 at 2, 3 and 2.625.
7. `pnpm run profile:rows`: no status changes. Existing rows gain proof ids only.
8. `pnpm run layout:subset`: 0 violations. `pnpm run native:gen`, then `git diff --exit-code packages/layout/generated`. `pnpm run native:swift` and `pnpm run native:kotlin`: equal.
9. `pnpm run native:build -- --target ios` and `-- --target android`: exit 0 at the derived case count. The emitted case sources of existing cases are byte-identical to a BASE build.
10. `pnpm run parity:lanes -- --run-host`: exit 0.
11. Planted faults: each of the 3 new faults fails its named fixture, and `isSpecificityFirstArgument` is still caught.
12. `node --conditions=dragon-internal scripts/capture-selector-validity.ts --check`: exit 0.
13. `pnpm run north-star:check`:
    - web and ios refusals only shrink;
    - android is recorded;
    - the note lists the before and after counts per code and target.
14. `git diff --exit-code BASE -- examples/music-player/chrome examples/music-player/lane examples/music-player/covers`. `pnpm exec vitest run packages/parity/test/north-star-reference.test.ts packages/parity/test/north-star-tree.test.ts`: both green.
15. `pnpm run wpt:update-expectations`: no pass becomes a fail, and every new fail has a written reason.
16. Protected paths: `git diff --exit-code BASE --` on each of these:
    - `packages/dragon/src/css/stylesheet.ts`, `analysis/cascade.ts`, `resolve.ts`, `computed.ts`, `elements.ts`;
    - `internal.ts`, `types.ts`, `emit`, `lower` and `ua`;
    - `packages/layout/src` and `packages/translate`;
    - `packages/parity/src/pipeline.ts`, `chrome.ts`, `lanes.ts`, `native-*.ts` and `targets.ts`;
    - `package.json` and `.github`.
17. `git diff --name-only BASE..HEAD` lies inside allowed_files. `git remote -v` is empty.
18. **Device step** (P5 on master, lease held):
    - merge master and regenerate;
    - rerun 1–17;
    - `pnpm run layout:break-vectors`, `pnpm run parity:break-capture` and `pnpm run parity:pixel-capture` add new cases only;
    - `pnpm run parity:lanes -- --run-host --run-device`: no lane is `not run`, and no non-pixel lane fails on a new case;
    - device-pixels has no new failure beyond master's recorded list.

**Stop if.**
- Chrome disagrees with Dragon on a new case after the Blink 145 source (selector_checker.cc and the case-insensitive attribute list) has been checked. Report it; never add a special case.
- A file outside allowed_files is needed. In particular: stylesheet.ts, cascade.ts, resolve.ts, computed.ts, the element table, internal.ts, types.ts, emit, lower, packages/layout, a P5 or V1 file, or package.json.
- Any existing `FrontEndResult`, capture, vector, emitted body, profile status, native case source or WPT pass changes.
- Chrome's selector validity cannot be observed exactly.
- A planted fault is not caught.
- A tolerance, case, DPR or direction would be loosened.
- T021's allowed_files still claim selectors.ts or match.ts at dispatch.
- Verification fails twice.
- **Device step:** P5 is not merged, or the lease is not held.

## 3. Package T016: MQ-a

**Setup.**
- **Worktree:** `/tmp/dragon-mq`.
- **Branch:** `mq-a-media`.
- **Phase A base:** master after T020.
- **Phase B:** merge master once T022 **and** TREE are on master.

### Phase A (now): new files only

**Objective.** `packages/dragon/src/media/` is pure TypeScript with no `node:` imports, like the fonts module. It provides:
1. **A Media Queries 4 parser over css-tree's prelude**, covering:
   - the media types all, screen and print, and `only`;
   - `not`, `and`, `or` and the comma list;
   - the range syntax;
   - `width`, `height`, `min-*` and `max-*`, `aspect-ratio` and `orientation`;
   - lengths in px, em and rem (for media, em and rem use the initial 16px, not the root), and `calc()` over those.
   - **Features classed as environment-dependent**, parsed and marked refused until MQ-R: `prefers-*`, `hover`, `pointer`, `resolution` and `-webkit-device-pixel-ratio`.
   - **Unknown features** use MQ4's three-valued logic. An invalid query becomes `not all`, as Chrome treats it.
   - **Serialisation** matches Chrome's `mediaText`.
2. **An evaluator** over `{ width, height }` in CSS px.
3. **A band partition.** From every width and height atom in a sheet, derive the ordered bands, where each band is one assignment of truth values to all atoms. It also produces the band condition text, built only from the authored atoms and their negations, such as `(max-width: 768px) and (not (max-width: 640px))`. There is a cap of 16 bands; above it the result is a typed refusal.

**Proof.** `scripts/capture-media-data.ts` uses chrome.ts, `launchChrome` and `openPage` unchanged.
- **Corpus and widths:** a committed query corpus, evaluated with `matchMedia` at the viewport widths derived from each corpus threshold: equal, ±1 px and band midpoints, with fractional thresholds bracketed.
- **Pages:** the root font size is set to 16px and to 20px, which proves that em in media ignores the root.
- **Band test:** for every band that `band()` derives, Chrome evaluates the band condition text at a sample width inside the band, and the result must be exactly that band.
- **Serialisation:** it is also captured.
- **Output and determinism:** the captures are committed under `packages/dragon/test/media/captures/`, and `--check` requires a byte-identical recapture.
- **Planted faults**, local to the module:
  - `maxWidthExclusive`;
  - `emFromRoot`;
  - `unknownAsTrue`;
  - `notBindsTighterThanAnd`;
  - `bandGapAtBoundary`.

  Each must flip at least one captured comparison.

**Allowed files.**
- `packages/dragon/src/media/**` (new)
- `packages/dragon/test/media/**` (new)
- `scripts/capture-media-data.ts` (new)
- `docs/goals/milestone-2-proof/notes/T016-mq-a.md`

**Verify.** Every command uses the same env prefix.
1. `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`: all green.
2. `pnpm exec vitest run packages/dragon/test/media`: all green.
3. `node --conditions=dragon-internal scripts/capture-media-data.ts --check`: exit 0.
4. `grep -rn "from 'node:" packages/dragon/src/media` finds nothing.
5. The planted-fault test is green, with every fault flipping at least one comparison and the unfaulted run passing every case.
6. `git diff --name-only BASE..HEAD` lies inside allowed_files. `git remote -v` is empty.

**Stop if.**
- Chrome's `matchMedia` or `mediaText` disagrees with the MQ4 reading after the Blink 145 source (media_query_evaluator.cc, media_query_exp.cc) has been checked.
- A quantity cannot be observed exactly.
- A file outside allowed_files is needed.
- Verification fails twice.

### Phase B (after T022 and TREE are on master): wiring

**Objective.**
1. **Registration.** at-rules.ts gives `media` its own handler and a new `AtRuleOutcome` kind, `conditional`, that carries the parsed condition.
2. **Driver.** The stylesheet.ts driver parses the block of a conditional at-rule as real rules, with `Rule.condition` set. Nested `@media` conjoins the conditions.
3. **Fold, the cascade hook.** project.ts resolves every case once per band, with the rule list filtered by the band before `resolveTree`. cascade.ts is not edited.
4. **Single-band sheets.** A sheet with no conditions has exactly one band. Its resolution, digest and outputs stay byte-identical.
5. **Web output.** web-css.ts writes the base band as it does today, plus one `@media <band condition>` block per extra band for each element whose resolved values differ. Web becomes correct at every width.
6. **Native.**
   - **With a fold environment:** `InternalOptions` gains an optional fold viewport. `compileFixture` in pipeline.ts passes `ENVIRONMENT.viewport`. The native output is then the band that contains that viewport, which is exact for the fixed-root parity environment.
   - **Public compile, no fold viewport:** ios and android get a target-scoped `DRAGON_UNSUPPORTED_AT_RULE` naming MQ-R. Native support rows stay unsupported.
   - **Other features:** environment-dependent features other than width and height are refused on every target until MQ-R.
7. **Dropped rules.** Rules that TREE drops as Chrome-invalid do not diagnose their declarations. This is one guarded branch in `parseRule`.
8. **The web band sweep.**
   - A new `packages/parity/src/media-sweep.ts` and `cli/media-sweep.ts`, run with `node --conditions=dragon-internal`; no package.json change.
   - For every fixture in the `media` group, Chrome renders the authored fixture and the compiled web output at each derived band sample width and at each boundary.
   - Computed values and boxes of every element must be equal.
   - The data is committed under `packages/parity/expected-media/**`, with `--check`.
9. **Fixture group `media`** (400x300, ltr and rtl). It contains:
   - max-width, min-width and range syntax true, false, and equal to 400 (both directions of each atom);
   - `em` thresholds under a 20px root;
   - `not`, `or` and the comma list;
   - nested `@media`;
   - two overlapping breakpoints, as in the north star;
   - rejects for `prefers-color-scheme` and `resolution`, and the native refusal checked with the public entry.
10. **Planted compiler faults:**
    - `mediaConditionIgnored`: every rule applies;
    - `mediaBandOffByOne`.

    Each fails a named fixture or a sweep case.

**Allowed files.**
- `packages/dragon/src/css/at-rules.ts` (the media entry and the new outcome kind)
- `packages/dragon/src/css/stylesheet.ts` (driver: the conditional outcome, `Rule.condition`, the dropped-rule guard in `parseRule`)
- `packages/dragon/src/project.ts` (`InternalOptions` fold viewport, band loop, digest input only when there are more than 1 band)
- `packages/dragon/src/emit/web-css.ts` (band blocks)
- `packages/dragon/src/media/**`
- `packages/dragon/src/faults.ts`, `diagnostics/catalogue.ts`, `diagnostics/codes.ts`, `packages/dragon/test/diagnostic-codes.json` (append only)
- `packages/dragon/test/media/**`, `packages/dragon/test/media-*.test.ts` (new)
- `packages/parity/src/pipeline.ts` (`compileFixture` passes the fold viewport; nothing else)
- `packages/parity/src/media-sweep.ts`, `packages/parity/src/cli/media-sweep.ts`, `packages/parity/test/media-sweep.test.ts` (new)
- `packages/parity/src/fixture-groups/media.ts` (new)
- `packages/parity/src/fixtures.ts` (one import and one concatenation)
- `packages/parity/fixtures/media-*.html`, `packages/parity/fixtures/reject-media-*.html` (new)
- `packages/parity/expected/**`, `packages/parity/expected-dpr/**`, `packages/parity/expected-media/**`, `packages/layout/vectors/**` (new files)
- `packages/parity/emitted/**` (new bodies)
- `packages/dragon/src/profiles/*.ts` (profile:rows output)
- `packages/parity/out/lanes.json`, `packages/translate/corpus-dpr.json`, `packages/wpt/expectations/**` (generator output)
- `examples/music-player/dragon/north-star-check.json` (regenerated)
- `docs/goals/milestone-2-proof/notes/T016-mq-a.md`
- **Device step:** the same new-case data paths as TREE, plus `packages/parity/out/lanes.json`

**Verify.** Every command uses the same env prefix.
1. `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test` (the vitest list rules as for TREE).
2. Rerun Phase A verify 3.
3. `pnpm run parity:capture` and `pnpm run parity:dpr-capture`, each twice with no diff on the second run. Existing expected, expected-dpr and vectors are unchanged. Every existing emitted file is **byte-identical, headers included**, because single-band digests do not change.
4. `pnpm run layout:vectors && pnpm run layout:dpr-vectors`: new files only.
5. `pnpm run parity:report` and `pnpm run parity:dpr-report`: failed 0, at 2, 3 and 2.625.
6. `node --conditions=dragon-internal packages/parity/src/cli/media-sweep.ts`, then again with `--check`: all equal and byte-identical.
7. `pnpm run profile:rows`: new web rows only. No ios or android row is promoted.
8. `pnpm run layout:subset`, `pnpm run native:gen` with `git diff --exit-code packages/layout/generated`, `pnpm run native:swift` and `pnpm run native:kotlin`.
9. `pnpm run native:build -- --target ios` and `-- --target android`: derived counts, and existing case sources byte-identical.
10. `pnpm run parity:lanes -- --run-host`: exit 0.
11. Planted faults caught, including TREE's and `isSpecificityFirstArgument`.
12. `pnpm run north-star:check`:
    - the two `@media` rules are accepted on web;
    - native refusals name MQ-R;
    - no other count rises.
13. `pnpm run wpt:update-expectations`: no pass becomes a fail.
14. Protected paths, `git diff --exit-code BASE --` on each of these:
    - `analysis/cascade.ts`, `resolve.ts`, `computed.ts`;
    - `internal.ts`, `types.ts`, `emit/uikit.ts`, `emit/android-views.ts`, `emit/native-support.ts`, `emit/expected-dump.ts` and `lower`;
    - `packages/layout/src` and `packages/translate`;
    - every parity src file except `pipeline.ts` and the new files;
    - `package.json`.
15. The scope diff lies inside allowed_files. `git remote -v` is empty.
16. **Device step:** as for TREE item 18.

**Stop if.**
- The wiring needs cascade.ts, resolve.ts, computed.ts, internal.ts or types.ts.
- A public API or `types.ts` change is needed.
- Any existing emitted file, header included, capture, vector, native case source or profile row changes.
- Chrome disagrees on a band after the evaluator has been re-checked.
- More than 16 bands are needed for a fixture.
- A planted fault is not caught.
- A tolerance, case, DPR or direction would be loosened.
- T022 or TREE is not on master.
- Verification fails twice.
- **Device step:** P5 is not merged, or the lease is not held.

## 4. Package T017: ELB-2

**Setup.**
- **Base:** master after T020.
- **Worktree:** `/tmp/dragon-elb2`.
- **Branch:** `elb2-ua-defaults`.

**Objective.** This is data only. No element-table entry, no resolver change and no fixture.
1. **New capture keys.** `scripts/capture-ua-defaults.ts` captures these keys in both directions, with the same method as the existing tags:
   - `button` (type=button);
   - `input` (text);
   - `input[type=range]`;
   - `a` and `a[href]`: the `:link` UA rules apply only with an href, in a fresh profile, so the link is unvisited;
   - `img` (no src);
   - `span`.

   Existing tags gain entries only where a new key is an ancestor context. Every existing entry stays byte-identical otherwise.
2. **`userAgentUnmodelled` per key.** This is a new export. It lists every property from Chrome's full `getComputedStyle` list that differs from `dragon-unstyled` under the same parent and is not modelled by LONGHANDS, their logical aliases or `userAgentTextFonts`. Examples are `text-align`, `cursor`, `appearance`, `letter-spacing` and `list-style-type`. Any finding on an existing tag is listed in the note and not fixed.
3. **Self-consistency.** For each key, in each direction, a `dragon-unstyled` element given `userAgentDeclared` plus `userAgentTextFonts` plus the unmodelled values must reproduce Chrome's computed values for every captured property.
4. **The dark UA dataset.**
   - The same capture under `html{color-scheme:dark}`, written to a new file, `ua/chrome-145.darwin-arm64.dark.generated.ts`.
   - A `systemColors` table for light and dark, covering Canvas, CanvasText, LinkText, VisitedText, ActiveText, ButtonFace, ButtonText, ButtonBorder, Field, FieldText, Highlight, HighlightText, SelectedItem, SelectedItemText, Mark, MarkText, GrayText, AccentColor and AccentColorText.
   - datasets.ts gains an additive `darkDatasetFor(platform)`. The existing signatures are unchanged.
5. **Script modes.**
   - `--check`: a byte-identical recapture.
   - `--compare <file>`: for keys present in both, it reports the entries that differ.
   - `--plant <name>` for three plants: `drop-declared` (button padding-left), `drop-unmodelled` (button text-align) and `dark-as-light`.

**Allowed files.**
- `scripts/capture-ua-defaults.ts`
- `packages/dragon/src/ua/datasets.ts` (additive)
- `packages/dragon/src/ua/chrome-145.darwin-arm64.generated.ts` (ua:capture output)
- `packages/dragon/src/ua/chrome-145.darwin-arm64.dark.generated.ts` (new; output)
- `packages/dragon/test/ua.test.ts` (pins appended for the new keys; existing assertions unchanged)
- `packages/dragon/test/ua-elb2.test.ts` (new)
- `docs/goals/milestone-2-proof/notes/T017-elb2.md`

**Verify.** Every command uses the same env prefix.
1. `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`: all green.
2. `pnpm run ua:capture` twice. The second run gives `git diff --exit-code packages/dragon/src/ua`.
3. `node --conditions=dragon-internal scripts/capture-ua-defaults.ts --check`: exit 0. Self-consistency passes for every key in ltr and rtl, light and dark.
4. `git show BASE:packages/dragon/src/ua/chrome-145.darwin-arm64.generated.ts > /tmp/elb2-base-ua.ts && node --conditions=dragon-internal scripts/capture-ua-defaults.ts --compare /tmp/elb2-base-ua.ts`: 0 differing entries for the BASE keys, apart from `userAgentContexts` gaining new-key ancestors, each listed in the note.
5. Each of `--check --plant drop-declared`, `--check --plant drop-unmodelled` and `--check --plant dark-as-light` exits 1 and names its fault.
6. No compiled output moves:
   - `pnpm run parity:capture`, then `git diff --exit-code packages/parity/expected packages/parity/emitted`;
   - `pnpm run profile:rows`, then `git diff --exit-code packages/dragon/src/profiles`;
   - `pnpm run parity:report`: failed 0;
   - `pnpm run parity:lanes -- --run-host`, then `git diff --exit-code packages/parity/out/lanes.json`;
   - `pnpm run north-star:check`, then `git diff --exit-code examples/music-player/dragon/north-star-check.json`.
7. `git diff --name-only BASE..HEAD` lies inside allowed_files. `git remote -v` is empty.

**Stop if.**
- An existing key's entry changes, other than a listed new-key ancestor context.
- A key cannot be reproduced by self-consistency and the reason is not a property Chrome exposes.
- A capture is not byte-identical.
- Anything under packages/parity, the profiles, analysis, css or elements.ts would change.
- A plant is not caught.
- Verification fails twice.

## 5. Required board updates (PM)

1. **T021 allowed_files.** Add these explicit exclusions: `packages/dragon/src/css/selectors.ts`, `packages/dragon/src/analysis/match.ts`, `packages/dragon/src/css/selector-validity.generated.ts`, `packages/dragon/src/media/**`, `packages/dragon/test/media/**`, `packages/dragon/test/attributes.test.ts`, and the `attr-*` and `tree-attr-*` fixtures. T021 stops if it needs any of them. casc-logical has no commits yet, so this costs nothing.
2. **T021 must-fix.** Keep `specificityFor(sel, faults)` in cascade.ts. The `isSpecificityFirstArgument` plant must still fail selectors-specificity after the merge.
3. **Cards.** Fill T015, T016 (split into T016 A and T016 B) and T017 from this note. Dispatch these at once:
   - T015 and T017 when T020 lands;
   - T016 A now.

   T016 B is blocked on T022 and T015 being on master.
4. **Merge rules.**
   - T015 and T016 B merge after P5 lands (or before P5 starts), each followed by its device step on the lease.
   - T017 may merge at any time. The integrator reruns `pnpm run ua:capture` after merging T017 with T021.
5. **T011 (TXT1-C wiring) spec constraints.**
   - It is serial after T015 on project.ts.
   - It is not concurrent with T016 B on at-rules.ts, stylesheet.ts, project.ts and web-css.ts.
   - It must not claim `media/**` or the UA sources.
6. **Worker count.** With T015, T016 A and T017 dispatched, writers reach 6. Record whether P5 and V1 A wait or the limit is raised.
