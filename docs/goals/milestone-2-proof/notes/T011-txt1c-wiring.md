# T011: TXT1-C wiring, Phase A (Worker, 2026-09-28)

Spec: notes/T033-txt1c-wiring-spec.md. Phase A only (new files only). Phase B was not started because its §2 gates are not met.

- **Worktree:** /tmp/dragon-fonts-wire, branch `txt1c-wiring`.
- **BASE_A:** master 2347a15.
- **Phase A commit:** 3a733a2 (local, not pushed; no remotes).

## Files (all new)

- `packages/dragon/src/fonts/wire.ts`: pure TypeScript with no `node:` imports.
- `packages/dragon/test/fonts/wire.test.ts`: 26 tests.
- `packages/dragon/test/fonts/reference/p1-set-font-families.json`, `p2-cssom-rewrite.json`, `p3-control.json`.
- `scripts/capture-font-reference.ts`: imports `launchChrome`, `chromeArgsAt` and `openPage` unchanged from parity/src/chrome.ts. Its flags are `--check` and `--plant quoted-generic-rewritten|generic-not-rewritten`. `--plant` works only with `--check`, so a planted capture can never be committed.

No existing `fonts/*.ts` file was edited: `git diff --exit-code 2347a15 -- packages/dragon/src/fonts ':!…/wire.ts'` exits 0.

## wire.ts API (what Phase B calls)

- **`collectFontFaces(contexts, resolveUrl)`**
  - Takes `AtRuleContext`s. Only `font-face` contexts are parsed, ASCII case-insensitively, in document order; other contexts are skipped.
  - Returns `{ results: FontFaceResult[], problems }`.
  - Each `FontFaceIssue` becomes a `{ kind: 'font-face', blocking, source: { kind: 'rule', context, order }, issue }` problem.
- **`projectFonts(rawMap, faces, assets)`**
  - Runs `validateFontMap`. Each pinned face is parsed as a `@font-face` of the pinned family through `parseFontFace`, with src resolved as a snapshot asset id or a `data:` URL. Anything else is `unresolved-asset`, and remote URLs are `remote-url`.
  - Then runs `buildManifest` over the authored and pinned faces.
  - Returns `{ map, manifest, digestInput, pinned, problems }`.
  - `digestInput` is null when there are no faces and no map. It is also null when the map is invalid or a face has a build error, because that build fails and there is no manifest.
- **`familySupport(listText, map, declared)`**
  - Returns `{ kind: 'resolved', list, resolutions, key }`, `{ kind: 'invalid' }` for a list Chrome rejects, or `null` for the single family Ahem (any quoting or case), so `font-family:Ahem` stays untouched.
  - `key` is one of `font-family:<pinned|declared|platform|unmapped>`.
- **`pinnedFacesOf(projected, families)`**: the pinned faces of the used pinned families, in map order.
- **`webFontOutput(usedPinned, declaredFaces, manifest)`**
  - Returns `{ css, assets, problems }`.
  - Rules are written in this order: the used pinned faces in map order, then the authored faces in declaration order. Chrome's ties depend on that order, so it is deterministic for any input order.
  - Each src is `url("fonts/<sha256-hex-16>.<ttf|otf>")`. Every non-src descriptor is written with Chrome's CSSOM text (`cssom.ts`).
  - Assets are `{ path, hash, bytes }`, de-duplicated and sorted by path.
  - A face whose hash is not in the manifest is reported as `face-not-in-manifest`. This gives Phase B's `fontFaceNotEmitted` and `fontManifestOutOfDigest` faults a check to trip.

## Probe results

All captures use Chrome 145.0.7632.6 at DPR 1 with the parity flags. The font SHA-256 values are in each file.

### P1: `Page.setFontFamilies({ sansSerif: 'Dragon Sans' })` does **not** reach the web font

| Variant | Face Chrome used |
|---|---|
| No setting | Helvetica (platform) |
| Setting `Dragon Sans`, with the "Dragon Sans" `@font-face` rules injected | **Times-Roman** (platform, `isCustomFont: false`) |
| Setting `Dragon Sans`, with no `@font-face` | Times-Roman |

- **Finding:** the settings family goes to the platform FontCache, not to the `@font-face` cache. Chrome finds no installed "Dragon Sans" and falls back to the standard font.
- This confirms the rejection in §1.3. The decision stays the CSSOM rewrite.

### P2: the in-page CSSOM rewrite — 22 of 22 cases give the expected face

**Pinned faces (`isCustomFont: true`):**

| Case | Face |
|---|---|
| Unquoted `sans-serif` | Inter-Regular |
| At 300 | Inter-Light |
| At 700 | Inter-Bold |
| Italic | Inter-Italic |
| 700 italic | Inter-BoldItalic |
| UA-bold `h1` | Inter-Bold |
| `'Lato', sans-serif` | Inter-Regular (Lato is not installed on this host) |
| `Unknown Family, sans-serif` | Inter-Regular |
| `monospace` | NotoSansMono-Regular |
| `monospace, sans-serif` at 700 | NotoSansMono-Regular |
| `SANS-SERIF` | Inter-Regular |
| `font: 700 16px sans-serif` | Inter-Bold |
| `font: italic 16px/1.25 sans-serif` | Inter-Italic |
| `font: 300 13px monospace` | NotoSansMono-Regular |
| Style attribute | Inter-Bold |
| Inside `@media` | Inter-Italic |
| `!important` over a style attribute | Inter-Regular (priority kept) |
| Inherited | Inter-Regular |

**Not rewritten, platform face:**

| Case | Face |
|---|---|
| Quoted `"sans-serif"` | Times-Roman |
| `font: 16px "sans-serif"` | Times-Roman |
| `system-ui` | .SFNS-Regular |
| `system-ui, sans-serif` | .SFNS-Regular |

### P3: the control document is byte-identical

- **Size:** 11 elements, 4,543 computed values, plus boxes and text rects.
- **Before:** the snapshot is taken before the faces are injected and the rewrite runs.
- **After:** the snapshot SHA-256 is identical, and 8 declarations were visited with 0 changed.

### Planted faults

Both plants fail `--check` (exit 1):
- `quoted-generic-rewritten`: P2 `quoted` and `shorthand-quoted` fail, P3 differs, and the files differ.
- `generic-not-rewritten`: the 18 pinned P2 cases fail, and p2 differs.

## Finding for Phase B (outside Phase A's files): `rewriteFamilyList` pins a quoted generic name

Chrome's stated reference does not rewrite quoted `"sans-serif"` (P2, and §3 says it must not be). But the existing `font-map.ts` `rewriteFamilyList` does:
- `parseFamilyList('"sans-serif"')` gives `{ kind: 'family', name: 'sans-serif' }`.
- The family-entry branch then maps any bare-ident name in `GENERIC_KEYS` to the map. The result is `"Dragon Sans"` and a `pinned` resolution.

So on `"sans-serif"`, Dragon's rewrite and `familySupport` (key `<pinned>`) disagree with Chrome, which renders Times-Roman. This is the `quoted-generic-rewritten` plant, built into `font-map.ts`.

**My call (Decision Rule):** it is not a Phase A stop.
- The §6 stop is about Chrome's face choice disagreeing with the pinned map. On every unquoted node, Chrome used exactly the mapped face.
- Phase A needs no change to an existing file, and wire.ts does not special-case it.
- It **must be fixed before Phase B** (B4 and B5 use `rewriteFamilyList`). It needs an edit to the existing `font-map.ts`, which is outside T011's allowed files. It belongs to the fonts lane (T028 already edits `fonts/*.ts`) or to a PM-widened Phase B.

**Recommended fix.** In the family-entry branch, exclude the names in `GENERIC_FAMILY_KEYWORDS`. Chrome's parser makes those names generic when they are unquoted, so a family entry with such a name was quoted. Then add a P2-style comparison to the capture tests: Dragon's rewrite of each Chrome-serialized `before` must equal Chrome's `after`.

**Related limit (no action for T011).** `ui-serif`, `ui-sans-serif`, `ui-monospace`, `ui-rounded`, `emoji` and `fangsong` are family names to Chrome 145 whether they are quoted or not. Chrome's CSSOM serializes both forms the same way, so no CSSOM rewrite can tell them apart. A pinned `ui-*` key therefore has no Chrome stated reference. T033's reference map pins only `sans-serif` and `monospace`, which is unaffected. Phase B fixtures should not pin `ui-*` keys.

**Transform limit.** The in-page rewrite reads `getPropertyValue('font-family')`. A `var()` in font-family would come back unresolved, so Phase B fixtures should not use `var()` in font-family.

## Verify (Phase A, §5)

Every command ran after the required `export`.

1. `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`:
   - **Final result:** 69 files and 1,457 tests passed, with no skip, `.only` or `.todo`.
   - **First run:** it failed in two ways.
     - The `ua.test.ts` catalogue boundary matched a `severity: 'error'` literal in wire.ts. Fixed: problems carry `blocking`, and the catalogue decides severity.
     - Three parity tests timed out at 120 s while the host load average was about 50 (other agents). They passed on the rerun.
2. `pnpm exec vitest run packages/dragon/test/fonts`: 80 passed.
3. `scripts/capture-font-data.ts --check`: byte-identical (5 files).
4. `scripts/capture-font-reference.ts`, then `--check`: byte-identical (3 files), and every probe expectation holds.
5. Both `--check --plant …` runs exit 1.
6. `grep -rn "from 'node:" packages/dragon/src/fonts`: nothing.
7. `git diff --exit-code BASE_A -- fonts ':!wire.ts'`: exit 0. `git diff --name-only 2347a15..HEAD` lists only the Phase A files. `git remote -v` is empty.

## Deviations from the spec text

- **`webFontOutput(usedPinned, …)`** takes the used pinned faces as `DeclaredFace[]` (from the new `pinnedFacesOf`), because the bytes live on the faces, not in the manifest. The manifest is used to check that every emitted face is in it.
- **`projectFonts`** also returns `pinned` (the parsed pinned faces), so `webFontOutput` can emit them.
- **`familySupport`** returns a tagged union that also carries the parsed `list` and an `invalid` case, instead of only the resolutions and key. When a list mixes kinds, the key is the least-supported kind: unmapped, then platform, then declared, then pinned.
- **Two added problem kinds:**
  - `pinned-family-declared`: an authored `@font-face` uses a pinned family name, which would merge the two in the rewritten web CSS.
  - `face-not-in-manifest`.
- **Problems carry `blocking`** (from `FONT_FACE_ERRORS`) instead of a severity, to respect the catalogue boundary test.
- **The reference is three files,** one per probe. The P2 corpus goes beyond the minimum: 300, bold italic, UA `h1`, `@media`, `!important`, inherited, and a generic after another family.
