# T057 INL-BF: blockified span, a and label (Worker note)

- **Where the work is:** worktree `/tmp/dragon-inl-bf`, branch `inl-bf` (the task named it; the spec's `inl-blockified-phrasing` is not used). BASE is origin/master **1211f422**, which has casc-logical (#22, T022) and INL-U (#13, T055). Local commits only, nothing pushed.
- **Spec:** notes/T044-inl-spec.md §3 INL-BF (binding), T055 (the UA data), T054 (probe; nothing in it covers blockification).

## What landed

- **`analysis/elements.ts`:** `span`, `a` and `label` are appended to `SUPPORTED_TAGS`. A new `UNSTYLED_TAGS` set and `uaTagOf(tag)` map them to the `dragon-unstyled` UA row (ruling 1).
- **`analysis/blockify.ts` (new):** css-display-3 §2.7 as Blink 145 does it.
  - `blockify(props, parentProps, faults)` runs once per element from resolve.ts, right after `blockifyRoot`. It blockifies the root, flex and grid items, and `position: absolute | fixed` boxes. The layout parent skips `display: contents`, and `contents` itself is never blockified.
  - `blockifiedDisplay` holds the whole table, keyword and multi-keyword forms, each checked against Chrome (ruling 2).
  - `checkInlineLevel` refuses a box that stays inline-level when no author declaration set its display (ruling 3).
- **`analysis/resolve.ts`:** 3 changed lines: the `uaTagOf` lookup, the `blockify` call, and the two imports.
- **`analysis/computed-checks.ts`:** the UA context and text-font lookups go through `uaTagOf`, and one call to `checkInlineLevel` (ruling 4).
- **`faults.ts`:** plants `blockifySkipped` and `inlineFlexToBlock` are appended.
- **Fixtures:** the new group `phrasing-blockified` (fixture-groups/phrasing-blockified.ts, appended last in fixtures.ts), ltr and rtl:
  - `phrasing-blockified-flex-row`: span, a and label as padded, bordered flex-row items (grow, fixed width, empty, centred), and a span between anonymous text items.
  - `phrasing-blockified-flex-column`: the same in flex-column, with stretch and flex-start.
  - `phrasing-blockified-abspos`: absolutely positioned span, a and label in a block container, and an abspos span in a flex container.
  - `phrasing-blockified-inline-flex`: `inline-flex` flex items and an abspos `inline-flex`, each with its own blockified span, a and label flex items.
  - `phrasing-blockified-inline-flex-blocks`: `inline-flex` span and a with div children. This fixture measures the `inlineFlexToBlock` plant.
  - `phrasing-blockified-inline-block`: `inline-block` flex items with wrapping text, an authored `display: inline` flex item, and an abspos `inline-block`.
  - Rejects:
    - `reject-phrasing-inline-span`: an unstyled span in a block, DRAGON_UNSUPPORTED_VALUE `display: inline on <span> s makes it an inline-level box`;
    - `reject-phrasing-a-href`: `a[href]` as a flex item, DRAGON_UNSUPPORTED_ATTRIBUTE (R6, unchanged);
    - `reject-phrasing-inline-block`: an authored `inline-block` in a block, DRAGON_UNPROVEN_CONTEXT on `inline-block`.
- **Tests:**
  - `packages/dragon/test/blockify.test.ts` (new, 14 tests):
    - the captured light and dark tables that make `dragon-unstyled` right;
    - the whole blockification table as probed;
    - the resolver cases (flex, grid, abspos, fixed, contents, nested);
    - the refusal;
    - both plants at compiler level;
    - the unregistered-parent error.
  - `packages/parity/test/phrasing-blockified.test.ts` (new, 3 tests): the plants through `runFixture` against the committed captures (below).

## Rulings (decided by research; for the PM to record)

1. **span, a (no href) and label use `dragon-unstyled`'s UA row.** They are not in `CapturedTag`: INL-U and ELB-2 put them in the `elementKey*` and `phrasingKey*` tables.
   - In both light and dark, those tables give them no modelled declared value, no longhand, no context, no text font and no forced value.
   - Every `LONGHANDS` computed value equals `dragon-unstyled`'s.
   - label's only UA rule is the unmodelled `cursor: default`, and `cursor` is not a Dragon longhand.
   - blockify.test.ts pins all of this against the generated tables, so a recapture that changes it fails the test.
   - Divs carry an unmodelled `unicode-bidi: isolate` and these tags do not. That has no effect, because `checkBidi` already allows only strong-L text in rtl.
2. **The blockification table is Chrome's, probed on 145.0.7632.6** (a span as a flex item and as `position: absolute`; `/tmp/inl-bf-probe/probe*.ts`, not committed). The probed values match Blink's EquivalentBlockDisplay:
   - inline, inline-block, `inline flow`, `inline flow-root` and math become block;
   - inline-flex and `inline flex` become flex; inline-grid becomes grid; inline-table becomes table;
   - ruby becomes `block ruby`; `-webkit-inline-box` becomes `-webkit-box`;
   - `inline list-item` and `inline flow list-item` become list-item; `inline flow-root list-item` becomes `flow-root list-item`;
   - every table-internal display, ruby-base and ruby-text becomes block;
   - contents, none and block-level values are unchanged;
   - a `display: contents` flex child's own child is blockified, because the layout parent skips contents;
   - `position: relative` does not blockify;
   - `float` blockifies in Chrome, but Dragon has no `float` longhand.

   The root goes through the same table: `blockifyRoot` still runs first, so its output is unchanged. Grid items are blockified because Chrome does it. `display: grid` itself stays refused by the profile (no rows), so no grid case compiles.
3. **Fail-closed for inline-level boxes.**
   - The profile keys a display only when an author declared it (`usedKeys` skips undeclared values).
   - So an unstyled span in a block container has no row to fail. Before this package, the element table was what refused it.
   - `checkInlineLevel` refuses it on every target with DRAGON_UNSUPPORTED_VALUE (basis `computed-value`), following the precedent of the UA list-item refusal.
   - A declared display is left to the profile. With the new rows, `inline`, `inline-block` and `inline-flex` are proven only in `flex-row/*` and `absolute-in-block/*`. So an authored `inline-block` in a block is DRAGON_UNPROVEN_CONTEXT, and in a context with no row at all it is DRAGON_UNSUPPORTED_VALUE.
4. **Files beyond the spec's allowed list, and why.**
   - **`computed-checks.ts`** (3 lines plus imports). `checkUserAgentDefaults` indexes `ua.userAgentContexts[tag]` and `ua.userAgentTextFonts[tag]` by the raw tag. That throws for span, so the check has to map the tag. The spec kept computed-checks.ts out to stay disjoint from V1 Phase B and V2a. T009 is done and T026 is still queued, so no in-flight package shares the file.
   - **resolve.ts** gets 2 lines beyond the one call site: the tag lookup.
   - **`packages/dragon/test/block-elements.test.ts`** and **`packages/dragon/test/compile.test.ts`**: pinned `span` refusals, retargeted to still-refused tags. See the table below.
   - **`packages/translate/corpus-dpr.json`**: native:gen output (counts and digests for the 12 new DPR cases).
   - **`packages/parity/test/phrasing-blockified.test.ts`**: new, the plant proof.
   - computed.ts, context.ts, values.ts, the engine and the emitters are unchanged.
5. **href stays refused (R6).** The attribute message still names "the inline and link package INL1". Changing it would change the existing `reject-attr-href` fixture's prefix, which the spec keeps unchanged. TDEC should reword it when it lifts the refusal.
6. **`a` and `label` are accepted with their existing attribute gate.** `for`, `href` and the like stay refused by attributes.ts, and the neutral attributes are accepted as before.

## Pinned tests changed (each keeps its intent)

| test | change | reason |
|---|---|---|
| block-elements.test.ts "the element table" | renamed "… plus the tags that resolve as it"; SUPPORTED_TAGS minus UNSTYLED_TAGS must equal the captured tags, and every UNSTYLED_TAG must be supported and absent from `computed` | span, a and label are supported with no `computed` row (ruling 1); the pin still ties every supported tag to captured data. `pre` is still pinned as refused |
| compile.test.ts:159 "rejects unsupported elements…" | tag `span` → `pre` | span is supported now; the test needs an unsupported element |
| tree.test.ts:257 "both branch arms…" | `span` → `pre` | the same; this is the spec's declared retarget |
| wpt translate.test.ts:84-85 | `<span>` → `<pre>`, and the test name follows | the same; this is the spec's declared retarget. An empty span in a block is now refused by `checkInlineLevel` rather than by the element table |

Two test names changed (block-elements, translate), so BASE's `vitest list` is a subset of HEAD's except for those two renames.

## Planted faults

| plant | layer | caught by | how |
|---|---|---|---|
| `blockifySkipped` | compiler (faults.ts) | `phrasing-blockified-flex-row` and `phrasing-blockified-abspos`, ltr and rtl (parity test) and blockify.test.ts | the flex item or abspos span stays `display: inline`; `checkInlineLevel` blocks ios and web with `display: inline on <span> s1 makes it an inline-level box`, and the fixture fails. No lane can measure an inline box, so the refusal is the catch |
| `inlineFlexToBlock` | compiler | `phrasing-blockified-inline-flex-blocks`, ltr and rtl (parity test) and blockify.test.ts | the inline-flex item becomes a block and its div children stack. Both linux-dragon-layout and chrome-dual fail on s1b and s2b |

Unfaulted, all three parity runs pass.

## Verification (env export before each command; worktree /tmp/dragon-inl-bf)

| step | result |
|---|---|
| S1-S4 `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` | see the final report |
| S2 `pnpm run layout:subset` | 0 violations |
| S5 native:gen, native:swift, native:kotlin | pass; P1 digest ae0f4087… unchanged; extended corpus 76871e2e… (vectors-dpr 1125 → 1161) |
| S5 native:planted swift and kotlin | 8/8 planted faults caught on each |
| S6 layout:vectors, layout:dpr-vectors | new files only: 12 vectors, plus 12 per DPR and 12 snap per DPR. 1161 DPR vectors |
| S7 parity:capture, parity:dpr-capture | new files only in expected/ and expected-dpr/ (12 per DPR); no existing capture modified |
| S8 parity:report | 243/243 fixtures, 387/387 cases, layout 10866/10866 exact, dual boxes 10886/10886, values 525800/525800, channels 47705/47705, failed 0 |
| S8 parity:dpr-report | 1161/1161 cases; exact 10866/10866 at 2, 3 and 2.625; failed 0 |
| S9 profile:rows | 1765 → 1788 rows per target (details below) |
| S11 native:build | see the device step |
| S12 native:encoders swift and kotlin | 387/387 valid and equal; 4/4 planted faults caught |
| S13 layout:break-vectors | 387 cases × 3 DPRs; new files only |
| S15 north-star:check | details below |
| S15 wpt:run, wpt:update-expectations, wpt:check `--target web` | 5 pass of 38054 (unchanged); every entry matches. 5 entries change only their `missing` reason and stay not-runnable (details below) |
| fixed point | parity:capture then profile:rows, run twice: the shasum of expected/, emitted/ and profiles/ is identical after the second run (0618725d…) |

**Profile rows.** The 23 added row keys are identical on ios, web and android (android's are unsupported):
- `display:inline@flex-row/{ltr,rtl}`
- `display:inline-block@flex-row/{ltr,rtl}` and `@absolute-in-block/{ltr/cb-ltr,rtl/cb-rtl}`
- `display:inline-flex@` the same four contexts
- `top:auto` and `left:auto` in the absolute-in-block and absolute-in-flex-row contexts (7 keys)
- `border-{left,right,top}-{style:solid,width:<length-px>}@flex-column/rtl` (6 keys)

No existing row lost a key or changed status or proof shape. Existing proofs only gained `phrasing-blockified-*` case ids (226 on ios, 384 on web), checked by script against BASE. `PROFILE_REVISION` stays `m1-s5`. Every emitted CSS file changes only its compilation-digest header (271 files; the digest covers the profiles).

**North star (BASE → HEAD).**
- DRAGON_UNSUPPORTED_ELEMENT: **21 → 10**. The 9 span elements and 2 a elements are gone; button 7, img 2 and input 1 remain.
- Web errors: UNPROVEN_CONTEXT 27 → 30, UNSUPPORTED_VALUE 36 → 33. The total stays at 811 diagnostics.
- Declarations supported on web and ios: 160 → 159; on android: 21 → 20. This is not lost support. The spans and links used to be dropped by the element table, so their declarations were only checked context-free. Now they reach the per-element context checks:
  - `.youtube-disclosure span { flex: 1 1 100% }` resolves in a block/ltr context in the checked cases, so it is unproven there;
  - `.youtube-disclosure a { color }` meets android's all-unsupported profile;
  - `.play-icon { display: inline-flex }` and `.youtube-disclosure a { display: inline-block }` stay refused (in-block contexts, now UNPROVEN_CONTEXT), as T044 §1.4 expects: they are INL2.

**WPT.** No pass is added or lost, and no status changes. 5 refusal reasons move past the element gate:
- justify-self-block-in-inline → `justify-self:start`;
- align-self-014 → UNPROVEN_CONTEXT `display:inline-block`;
- flex-direction-column-overlap-001 and position-relative-percentage-top-001 → the inline-level refusal;
- flexbox_justifycontent-center-overflow → a non-Ahem font.
