# T015: TREE, Worker note

Worker, 2026-09-28. Spec: notes/T025-tree-mq-elb2-spec.md §2 (binding), with the PM rulings of 2026-09-28 (1 to 5) and the standing Throughput and Decision rules.

- **Branch:** ns-tree, in /tmp/dragon-tree.
- **BASE:** 12af7cb.
- **Commit:** 2d812f1. It is local only; there is no remote.
- **Scope:** everything except the device step. That step waits for P5 on master and the device lease. No simulator or emulator was booted.

## Result

Every verify item from 1 to 17 passes, with the exceptions and findings listed below. `pnpm typecheck` passes, and so does `pnpm test`: 68 files and 1458 tests.

## What changed

### 1. Attributes are element data

**Matching.** link.ts already carried every attribute, and matching now uses all of them.

**The neutral table.** `checkTemplates` asks the new `packages/dragon/src/attributes.ts`. The rendering-neutral table holds:
- `id`, `data-*`, `aria-*`, `role`, `title` and `ui-*`;
- `rel` and `target`, except on `a`, `area` and `link`.

Each entry cites HTML and names its proof fixture.

**The proof pairs.** Each `attr-neutral-<name>` fixture carries its attribute on html, body, div, p, section, h1, h2 and h4. `attributes.test.ts` checks two things:
- removing the attribute gives exactly `attr-neutral-none`;
- the committed Chrome captures of the pair are byte-identical, apart from the fixture id, in ltr and in rtl.

All 8 pairs are identical in Chrome, so no attribute was left unproven.

**Headings carry no text in the pairs.** Heading text inherits the UA `font-weight: 700`, which Dragon refuses with `DRAGON_UNSUPPORTED_FONT`.

**Refused attributes.** Every other attribute raises `DRAGON_UNSUPPORTED_ATTRIBUTE`, and the message names the package that owns its effect:

| Attributes | Owner package |
|---|---|
| type, min, max, value | FORM-a |
| src, alt, width, height | REPL |
| href, and rel or target on a hyperlink tag | INL1 |
| lang | TXT1-C |
| dir | bidi |
| hidden | display |
| style | SOV |

Any other attribute gets "not proven neutral".

### 2. Selectors

**Attribute names.** Any name is accepted. Namespaced names are still refused.

**`#id`.** It has specificity [1,0,0] and matches the `id` attribute exactly and case-sensitively. Every element that carries the id matches.

**Case-insensitive values.** match.ts holds `HTML_CASE_INSENSITIVE_ATTRIBUTES`. These are the 46 names of Blink 145 `HTMLDocument::IsCaseSensitiveAttribute`, the same list as HTML §4.16.2.

This list is also observed in Chrome. The capture script sets `attr="foo"` on a div and tests `[attr="FOO"]` against it:
- all 46 names fold the case;
- 15 control names do not fold it: alt, aria-label, class, data-x, href, id, max, min, name, role, src, style, title, ui-x and value.

`attributes.test.ts` pins the list to that observation. The `i` flag keeps its meaning.

### 3. Chrome-equal dropping of invalid selectors

**The table.** `css/selector-validity.generated.ts` is written by `scripts/capture-selector-validity.ts` and supports `--check`. It covers:
- every non-functional pseudo in `examples/music-player/styles.css`;
- a fixed corpus of 37 pseudo-elements and 40 pseudo-classes.

**The drop.** A selector list that holds a pseudo Chrome does not parse drops the whole rule. Dragon then:
- emits one `DRAGON_SELECTOR_DROPPED` warning, a new code appended to the list;
- suppresses the list's `UNSUPPORTED_SELECTOR` errors, because Chrome never applies the rule;
- still returns the list's valid selectors, marked `dropped`, and `selectorMatches` refuses them.

**Pseudos Chrome parses stay errors, naming their owner:**
- `::-webkit-slider-thumb` and `::-webkit-slider-runnable-track` name FORM-a;
- `::-webkit-scrollbar*` names OVFL-s.

**Inside `:is()` and `:where()`.** A pseudo Chrome does not parse is refused as an error there. Chrome's lists are forgiving and drop only that argument, and Dragon does not model forgiving lists.

**How validity is measured (a deviation, with evidence).** The spec names `CSS.supports('selector(...)')` as the test. That API disagrees with rule survival in one case, `::-webkit-outer-spin-button`:
- `CSS.supports` returns false;
- `insertRule` keeps the rule;
- an authored `.probe, .probe::-webkit-outer-spin-button {…}` still styles `.probe`.

Blink's `selector()` support test refuses some UA-internal pseudo-elements that a style rule still accepts. The script therefore takes rule survival as validity. Two observations of it must agree, or the script throws:
- `insertRule` keeps the rule;
- the authored list keeps applying to its other selector.

`CSS.supports` is recorded next to them. For every name in styles.css, all three agree. `attributes.test.ts` pins the only disagreement.

**Residual diagnostics (as the spec says).** Suppressing the declarations of a dropped rule needs `parseRule` (stylesheet.ts) and is MQ-a B's job. For styles.css:315 (`input[type='range']::-moz-range-thumb`) these remain:
- `-webkit-appearance` gives `DRAGON_UNSUPPORTED_PROPERTY`, which applies to every target;
- 13 android-only `DRAGON_UNSUPPORTED_VALUE` diagnostics, from `background` and `border`.

### 4. The fixture reader

**Void elements.** `VOID_ELEMENTS` is img, input, br, meta, link and hr. Each may be written with no end tag or with an immediate end tag.

**Linked stylesheets.** `<link rel="stylesheet" href>` is resolved through the optional `resolveStylesheet` into a second snapshot source and the document style use, spanning the whole CSS file. A fixture needs exactly one `<style>` or one link.

**Additive reader.** `tree-fixture.ts` gains `readTreeFixtureDir` and `readTreeFixtureFile`, which support source text and spec transforms. `readTreeFixture` now shares their core.

**Reader identity (verify 2).** `fixture-reader.test.ts` pins the sha256 of the canonical-JSON `FrontEndResult` of all 195 BASE fixtures. The digests were computed at BASE before any edit, and they still hold.

### 5. The north star as a tree

**Sources.** `examples/music-player/tree/src/` holds the Markless demo's `document.tsrx`, `pages/index.tsrx` and six components, copied verbatim from Markless 7da890b4. They are covered by LICENSE-markless. Every tree origin is a span in those sources, and the stylesheet is `../styles.css`.

**The component model.** `fixture.json` follows the demo's own components:
- **Document:** html with `lang`, body, and `{children}` calling App.
- **App:** holds the free states `libraryStatus` and `isPlaying`. It aliases them into Nav, Library, Song and Player.
- **Classes:** they are conditional bindings.
- **The play icon:** it is an `@if (isPlaying)` branch with ❚❚ and ▶ arms.
- **LibrarySong:** called 4 times with parameters `song` and `selected`. Its texts and img attributes are choices on `song`.

**`expected`.** It holds:
- the 2 free states at `doc/page`;
- `cases: 4`;
- the initial assignment, both states false;
- 22 text-topology entries. The pause-icon and play-icon entries are gated by `when`.

**`north-star-tree.test.ts`** checks three things:
- **Case counts.** `caseCountProblems` finds no problem: the renderer and Dragon agree with the declaration.
- **Structure.** Each of the 4 rendered cases equals `freeStateHtml(html, id)` in structure: tag, classes, attributes, text and order, without the dragon ids. A one-token negative check fails as expected.
- **Topology.** The declared topology equals an independent walk of the tree in every case. Each ltr context is recomputed from the Chrome reference dumps in `chrome/ios-390x844/dpr-3/<state>-top.json`, using Dragon's `textContext` rule over Chrome's computed values. Each rtl context is the ltr one with the direction facet swapped; styles.css sets no `direction`.
  - The topology entries were derived once, by script, from the tree and those dumps. They are committed, and the test re-derives them independently.

**Divergence recorded.** `YouTubePlayer`'s `data-playing` is fixed at "false", because snapshot.html and `freeStateHtml` fix it there. The demo writes `data-playing={isPlaying}`. The attribute is `data-*` and rendering-neutral.

### 6. north-star:check on the tree

**Method.** `tools/check.ts` reads the tree, and one compile covers all 4 cases. It uses the public `createProject` with web, ios 15.0 and android `minSdk` 31.

**Passes.**
- A, B and C are kept.
- B and C replace the styles.css text through the reader's text override, so offsets are kept.
- C projects the tree to supported tags. It keeps only the attributes that `attributeRefusal` accepts on the projected tag.

**Output.** The JSON uses schema 2. It records `perTarget` error and warning counts, adds android to the per-declaration status, and adds `cases: 4`. A second run is byte-identical.

**Error counts before and after.** Target-less errors count on every target. BASE had no per-target split, and all three of these codes were target-less there.

| Code | web and ios before | web after | ios after | android after (new) |
|---|---|---|---|---|
| UNSUPPORTED_ATTRIBUTE | 40 | 22 | 22 | 22 |
| UNSUPPORTED_SELECTOR | 14 | 9 | 9 | 9 |
| UNSUPPORTED_ELEMENT | 29 | 21 | 21 | 21 |

**The other codes after the change.**
- **Same on web and ios:**
  - CSS_INVALID_VALUE: 27
  - UNPROVEN_CONTEXT: 27
  - UNSUPPORTED_AT_RULE: 3
  - UNSUPPORTED_PROPERTY: 81
  - UNSUPPORTED_VALUE: 36
- **ios only:** UNSUPPORTED_FONT 34, which was 33 before.
- **android:**
  - CSS_INVALID_VALUE: 27
  - UNSUPPORTED_AT_RULE: 3
  - UNSUPPORTED_FONT: 22
  - UNSUPPORTED_PROPERTY: 81
  - UNSUPPORTED_VALUE: 519
- **Warnings:** SELECTOR_DROPPED 1 on each target.

**Support.** 125 of 291 declarations are supported on both web and ios, 43%; it was 42.3%. Android supports 0 of 291, because every android row is unsupported until P5.

**Reading the counts.** Tree diagnostics are per template node, while the old snapshot check counted per element instance. That also shrinks the counts; for example, LibrarySong's button, img and span count once instead of four times. Per instance in the main case:
- **Refused attributes: 40 → 31.** The 6 `data-*` attributes and 3 `aria-label` attributes are now accepted. What remains:
  - type ×11
  - alt ×5
  - src ×5
  - href ×2
  - rel ×2
  - target ×2
  - lang, min, max and value ×1 each
- **Unsupported elements: 29 → 29.** No element support changed.
- **Selectors: 14 → 9.**
  - `#root` and the three `[type='range']` selectors are now accepted.
  - `::-moz-range-thumb` became the dropped-rule warning.
  - The 9 that remain are 4 `:hover`, 1 `:focus`, `::-webkit-slider-thumb` (FORM-a) and 3 `::-webkit-scrollbar*` (OVFL-s).
- **UNSUPPORTED_FONT on ios: 33 → 34.** This code is not one of the three that must only shrink. The tree has separate template nodes for the pause and play icon texts, so each gets its own diagnostic.

### 7. Planted compiler faults

The three faults are appended to `faults.ts`. `tree-faults.test.ts` runs them through `runFixture`, the path that also runs `isSpecificityFirstArgument`, with the committed captures as the authored side (PM ruling 3). Each fails chrome-dual in both ltr and rtl, and the unfaulted run has no failure reason.

| Fault | Fixture | Named nodes that must fail |
|---|---|---|
| `idSpecificityAsClass` | attr-id-specificity | x1, x5, y1, z1 |
| `attributeCaseAlwaysSensitive` | attr-value-case | g1, r1 |
| `invalidSelectorListKept` | attr-drop-invalid | a, b |

- **Why the assertion allows extra nodes.** It requires the named nodes to fail and allows others. A changed height moves every later box, so exact lists would pin knock-on positions.
- **attr-value-case in rtl.** r4 fails only in ltr, because an over-constrained margin-left has no effect on a right-aligned block.
- **`isSpecificityFirstArgument`** is still caught by parity.test.ts.

### 8. Fixture group `attributes`

It is registered in fixtures.ts. All layout fixtures run in ltr and rtl, and each covers both sides of its facet.

**Layout fixtures:**
- **attr-id-specificity:**
  - `#x` beats `.t.a.b.c`;
  - `id="X"` and `id="x y"` do not match `#x`;
  - two elements carry the same id;
  - `#y.t` beats `#y`;
  - `div#z` beats four classes.
- **attr-value-case:**
  - `[rel=FOO]` and `[rel~=BAR]` fold case;
  - `[target=_BLANK]` folds case;
  - `[data-x=FOO]`, `[title=T]` and `[aria-label^=AB]` are case-sensitive, while `[data-x=foo i]` folds.
- **attr-presence:** `[title]` matches an empty value and a set value, but not a missing attribute or `data-title`; `[role]` is also tested.
- **attr-drop-invalid:**
  - `.a, .b::-moz-range-thumb` and `.a, .b:-moz-focusring` are dropped;
  - `.c, .a` still applies.
- The 9 `attr-neutral-*` fixtures.

**Rejects.** Each checks the start-tag span and a message prefix that names the owner:
- reject-attr-href (INL1);
- reject-attr-lang (TXT1-C);
- reject-attr-style (SOV);
- reject-attr-img-src, a void `<img>` whose `src` names REPL (PM ruling 4).

**Case count.** The group adds 13 layout fixtures and 26 cases, which takes the total from 322 to 348. Every count is derived, so no pin needed a bump.

## Retargets and scope

**Retargeted tests.** Each keeps its intent:
1. **`packages/dragon/test/compile.test.ts:158`** (PM ruling 1): `#x { width: 1px; }` became `.a:hover { width: 1px; }`, which is still refused, so the four-code assertion is unchanged.
2. **`packages/dragon/test/selectors.test.ts` lines 68 and 69** (the `[data-x]` and `#x` refusal rows, PM ruling 2): replaced by one acceptance test that checks no diagnostics and specificities [0,1,0] and [1,0,0]. New tests are appended at the end.
3. **`packages/dragon/test/seams.test.ts`**, "diagnostics and enclosed rules are byte-identical to 4c1331c" (standing rule 1): its strip list follows the selectors-package precedent (`pseudos`, `anchor`) and now also strips `ids` and `dropped`, whose defaults must be `[]` and `false`. The 4c1331c hash is unchanged.

**Vitest list.** The BASE list minus HEAD's has two groups:
- the two replaced selectors.test.ts rows;
- test names that embed derived counts. "322 case ids" is now 348, and "DPR lane: 966 cases" is now 1044.

## Verify results

1. **Install, typecheck and test.**
   - Install and typecheck pass.
   - `pnpm test` passes 1458 of 1458 in 68 files.
   - No test is skipped, `.only` or `.todo`.
   - The test files modified since BASE are compile, selectors and seams, plus the diagnostic-codes.json append.
   - **Load-dependent timeout.** In an earlier full run under load average 36, parity.test.ts "determinism (S5 (c))" hit its 120 s timeout. The test covers the whole corpus in one `it`.
     - Run alone, it passes in 101 s.
     - The final full run passes, at a load average of about 10 to 27.
     - Its time grows with the fixture count, so it will run closer to the limit as fixtures are added. The timeout was not changed.
2. **Reader identity:** passes.
3. **Captures.** Each capture was run twice or more, with no diff on the last run.
   - `parity:capture`: after the first `profile:rows`, the compilation digest in existing emitted headers moved. A second `profile:rows` changed nothing, and a third capture was byte-stable.
   - `parity:dpr-capture` was also run twice, with no diff on the second run.
4. **Existing data:** no existing expected, expected-dpr or vector file changed. Under emitted/, 224 existing files differ in the header line only.
5. **Vectors:** new files only.
6. **Reports.**
   - `parity:report`: 212 of 212 fixtures pass, 348 of 348 cases, failed 0.
   - `parity:dpr-report`: 1044 of 1044 cases, exact at 2, 3 and 2.625, failed 0.
7. **Profile rows:** no status changed. 92 rows in ios.ts and web.ts only gained case ids; this was checked by script.
8. **Native generation.**
   - `layout:subset`: 0 violations.
   - `native:gen` leaves `packages/layout/generated` clean.
   - `native:swift` and `native:kotlin` pass.
   - `native:gen` rewrote `packages/translate/corpus-dpr.json`, which is allowed generator output. Verify 16 names `packages/translate` as protected, so the spec conflicts with itself here.
9. **Native builds.**
   - ios and android both build with 348 cases.
   - The case sources were compared with a BASE build from a temporary worktree at 12af7cb, which has since been removed.
   - In every existing case, the only difference is the `compilerDigest` field of each `DragonCase` line. That is the same compilation digest as the emitted CSS headers, and it moved because the profile rows gained proof ids.
   - Otherwise the new cases are appended, and the case tables gain entries.
   - **Deviation:** existing case sources are therefore byte-identical except for that header-like field, not fully byte-identical.
10. **`parity:lanes -- --run-host`:** exit 0. lanes.json was regenerated.
11. **Planted faults:** all 3 are caught, and `isSpecificityFirstArgument` is still caught.
12. **`capture-selector-validity.ts --check`:** exit 0.
13. **north-star:check:** the counts are in §6.
14. **Chrome reference:** chrome, lane and covers are unchanged since BASE, and north-star-reference and north-star-tree pass.
15. **WPT.**
    - `wpt:update-expectations` needs `--target web` and a prior `wpt:run --target web`.
    - `wpt:run --target web` passes 5 of 38054.
    - The expectations and snapshots are unchanged: no pass became a fail, and there are no new fails.
16. **Protected paths:** unchanged, except the corpus-dpr.json conflict noted in item 8.
17. **Scope:** `git remote -v` is empty. The diff lies inside allowed_files, the PM rulings and the rule-1 retargets.

## Left for others

- **The device step (verify 18):** after P5 lands on master, with the device lease.
- **Declarations of a dropped rule:** diagnostics inside `::-moz-range-thumb` remain until MQ-a B adds the `parseRule` guard.
