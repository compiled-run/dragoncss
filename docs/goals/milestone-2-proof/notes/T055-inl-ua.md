# T055 INL-U: UA data for the phrasing tags (Worker note)

- **Where the work is:** worktree `/tmp/dragon-inl-ua`, branch `inl-ua-phrasing`. BASE is master df93c92b, which already has ELB-2 and REPL-0. The commit is **c82058a4**, local only and not pushed.
- **Spec:** notes/T044-inl-spec.md §3 INL-U. The font-size rules come from notes/T054-inl-probe.md rule 7.

## What landed

- **`scripts/capture-ua-defaults.ts`** adds `PHRASING_KEY_SPECS`: br, strong, b, em, i, code, small, sub, sup and label, each with no attributes.
  - They are captured with ELB-2's method: computed, initial, declared ltr and rtl at 100px and 200px, contexts, text fonts, unmodelled, forced, and dark.
  - Every phrasing key except br (a void element) is also a candidate ancestor for every tag.
- **New tables in both generated files.** They are appended after `replacedKeyForced`:
  - `PhrasingKey`
  - `phrasingKey{Specs,Computed,Longhands,Declared,Contexts,TextFonts,Unmodelled,Forced}`
  - `elementKeyFontSizes`
- **Existing tables are unchanged.** Both files have 699 lines added and 0 removed. `--compare` against BASE gives: `compared 297 entries present in both; 0 differ; 0 gain new-key ancestor contexts`.
- **`elementKeyFontSizes`** records each phrasing key's computed font-size under a parent `div` with `font-family: Ahem | monospace` and `font-size` set to each of 10px, 16px, 17.5px, 23.3px, `medium`, `2em` and `larger`.
- **Self-consistency covers the new table.** In light and dark, a `dragon-unstyled` given the key's declared and text-font values under every such parent must reproduce each entry.
- **New plant `drop-font-size-small`.** It deletes small's declared font-size.
- **`datasets.ts`** gains appended exports only:
  - `PhrasingKey` (re-exported);
  - `PhrasingUaData`;
  - `PhrasingUaDataChoice`;
  - `phrasingDataFor(platform, scheme = 'light')`, which is refused like `uaDatasetFor` on other platforms.
- **Tests:**
  - `packages/dragon/test/ua-inl.test.ts` is new, with 10 tests.
  - `ua.test.ts` gains one import line and a describe block at the end that pins `phrasingKeyLonghands`.
  - No test was retargeted.

## Captured values (light; dark is identical for every phrasing table)

| key | declared (ltr = rtl) | text fonts | unmodelled | forced | contexts |
|---|---|---|---|---|---|
| br | none | none | none | none | none |
| strong, b | none | font-weight 700 | none | none | none |
| em, i | none | font-style italic | none | none | none |
| code | font-family monospace | none | none | none | none |
| small | font-size `smaller` | none | none | none | none |
| sub | font-size `smaller` | none | vertical-align sub | none | none |
| sup | font-size `smaller` | none | vertical-align super | none | none |
| label | none | none | cursor default | none | none |

`elementKeyFontSizes`:
- **small, sub and sup** are the parent's computed size ÷ 1.2 in every column.
  - Ahem gives 8.33333, 13.3333, 14.5833, 19.4167, 13.3333, 26.6667 and 16px.
  - Monospace gives the same for the px parents, then 10.8333 (medium), 21.6667 (2em) and 13px (larger).
- **code** equals the parent for px parents. Under a size relative to the medium keyword it is 13px × the factor: 13, 26 and 15.6px, under both Ahem and monospace parents.
- **br, strong, b, em, i and label** inherit the parent's size.

## Rulings (decided by research; for the PM to record)

1. **The keys get their own `phrasingKey*` tables, not the ELB-2 `elementKey*` tables.**
   - Appending to `elementKey*` would change existing tables, which the spec forbids.
   - It would also break the `elementKeyLonghands` `toEqual` pin in ua.test.ts and the `Object.keys(table) === KEYS` pin in ua-elb2.test.ts. ua-elb2.test.ts is outside allowed_files.
   - This follows the REPL-0 `replacedKey*` precedent. The spec's own name `elementKeyFontSizes` is kept for the new table.
2. **`font-size: smaller` is recorded as the keyword `smaller`, not an em factor.**
   - The capture's em check requires the values at 100px and 200px to scale within 1e-9. Chrome serializes 83.3333px and 166.667px, whose ratios are 0.833333 and 0.833335, so the capture threw.
   - The fallback is used only when the em check fails, so existing rows cannot change. It records `smaller` or `larger` only when an unstyled element with that authored keyword gives Chrome's value at both parent sizes.
   - T054 (font_builder.cc) confirms the rule is ÷1.2 exactly, with no em approximation.
   - The consumer contract is widened: a declared value may now be a relative keyword. This is documented on `PhrasingUaData.phrasingKeyDeclared`.
3. **A keyword-relative font-size difference is not an ancestor context.**
   - On the first capture, `code` had 37 "contexts": every ancestor, including div.
   - The cause: the stand-in div carries the parent's px size. Chrome instead keeps a size relative to the medium keyword (inherited medium, em, %, smaller, larger) keyword-relative, so code's generic-family change rescales it to 13px × factor.
   - Measured with an ad hoc probe: code is 13px under div, 26px under h1, 10.8333px under small, 16px under `large`, 20px under a 20px parent, and 16px under `calc(1em + 0px)`, where calc breaks keyword tracking.
   - **The fix:** when font-size is the only differing longhand, the check rebuilds the ancestor chain as `dragon-unstyled` elements given each ancestor's declared ltr values. If that chain reproduces Chrome's size, no UA rule keys on the ancestor.
   - The fix can only remove font-size-only false contexts. `--compare` shows no existing context changed.
   - The rule itself is pinned by the new `medium`, `2em` and `larger` columns of `elementKeyFontSizes`.
4. **Extra columns.** The table adds `medium`, `2em` and `larger` to the spec's four px parents. Without them, the table cannot show code's 13px behaviour. T054 says code is 13px only from a medium keyword.
5. **What INL-BF must reproduce for `code` (R7).**
   - Under px-sized parents, code equals the parent size.
   - Under a keyword-relative parent, code is 13/16 of the proportional size, including the root case (13px).
   - INL-BF must track keyword-relativity through em, % and smaller/larger, and stop tracking at calc and px. Otherwise it must refuse `code` in those cases.
   - `small` needs `smaller` = ÷1.2, including 13/1.2 = 10.8333px inside code.
   - This package makes no compiler change and refuses nothing. Refusals are INL-BF's job.
6. **label's `cursor: default`** is unmodelled and has no layout effect. sub and sup `vertical-align` are unmodelled here and go to INL2.

## Verification (env export before every command; worktree /tmp/dragon-inl-ua)

| command | result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` | exit 0: 85 files, 1847 tests passed, at load average 30, with no timeouts |
| `pnpm run ua:capture -- --check` | exit 0: byte-identical recapture, and self-consistency holds for 46 elements, ltr and rtl, light and dark (plus the font-size table) |
| `pnpm run ua:capture -- --compare /tmp/inl-ua-base/light.ts` (BASE copy) | exit 0: 297 compared, 0 differ, 0 ancestor gains |
| `--check --plant drop-declared` | exit 1: `FAULT light button ltr: padding-left is "6px" in Chrome but "0px"…` |
| `--check --plant drop-unmodelled` | exit 1: `FAULT light button ltr: appearance is "auto" in Chrome but "none"…` |
| `--check --plant dark-as-light` | exit 1: `FAULT dark button ltr: background-color…`, plus the `dark capture is not dark` fault |
| `--check --plant drop-font-size-small` | exit 1: `FAULT light small ltr: font-size is "13.3333px" in Chrome but "16px"…` and `FAULT light small under Ahem 10px: font-size is "8.33333px"…` |
| `pnpm run parity:report && pnpm run parity:dpr-report` | exit 0, failed 0; dpr 966/966; no tracked file changed |
| `git diff --exit-code df93c92b -- packages/parity packages/layout packages/translate packages/dragon/src/{analysis,emit,lower} package.json` | exit 0 |
| `git remote -v` | shows `origin` (compiled-run/dragoncss), the shared remote. The Throughput Rules allow it, and nothing was pushed or fetched |

The changed files are all in allowed_files:
- `scripts/capture-ua-defaults.ts`
- the two `ua/*.generated.ts` files (generator output)
- `ua/datasets.ts` (append only)
- `test/ua.test.ts` (append only, plus one import line)
- `test/ua-inl.test.ts` (new)

## For the integrator

Merge after P5, then run `pnpm run ua:capture`. Never hand-merge the generated files.
