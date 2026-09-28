# T004: TXT1-C specification (Judge, 2026-09-28)

Decision: **approved**, as a new-files-only package, **TXT1-C core** (T005). The hooks that connect it to compile() have to edit
files that T002's branches are rewriting, so they are split out as **TXT1-C wiring** (proposed T005b). T005b starts after T002
has fast-forwarded master.

## 1. Base and concurrency

- **Base:** master `8df7574` (T001's docs commit), in worktree `/tmp/dragon-fonts` on branch `txt1c-fonts`. T005 does not need
  to wait for T002: no branch T002 is merging adds or edits a file under `packages/dragon/src/fonts/`, `packages/dragon/test/fonts/`,
  `scripts/capture-font-data.ts` or `vendor/fonts/`. I checked this with `git diff --name-only master...<branch>` for
  feat-block-elements, feat-cascade-var, feat-units, wpt-breadth, engine-linebreak and t014-p4-backends.
- **T003 (text lane)** writes `vendor/harfbuzz/**`, `packages/text-shaper/**`, `pnpm-workspace.yaml`, `package.json`,
  `pnpm-lock.yaml` and `docs/research/text-spike/gate-*.md`. T005 touches none of these.
- **P5 (T015 §4)** writes `packages/parity/src/**`, `packages/dragon/src/internal.ts`, `emit/native-support.ts`,
  `packages/layout/**` and `package.json`. T005 touches none of these either.
- **Disjoint in practice:** T005 adds no `package.json` script, no dependency and no lockfile change. The capture runs as
  `node --conditions=dragon-internal scripts/capture-font-data.ts`, and it only imports
  `packages/parity/src/chrome.ts`, `paths.ts` and `platform.ts`.
- **Merge:** the integrator merges `txt1c-fonts` after T002's chain. It is a trivial merge (new files plus appended README
  sections), nothing is regenerated, and no emitted, vector or profile file changes.

## 2. Scope of T005 (TXT1-C core, compiler-side, not wired)

All of this goes under `packages/dragon/src/fonts/`. It is pure TypeScript with no `node:` imports, so it stays usable in the
compiler core (the digest.ts precedent).

1. **`sfnt.ts`.** A read-only reader for TrueType and OpenType tables:
   - head, hhea, OS/2 (all versions), maxp, hmtx, cmap formats 4 and 12, name (postScriptName and family), post, and glyf/loca
     glyph bounds;
   - detection of fvar (variable) and CFF.
   - **Typed refusals:**
     - WOFF or WOFF2 containers: `unsupported-container`;
     - CFF or CFF2 outlines, when a metric needs glyph bounds: `cff-bounds`;
     - variable fonts, for metrics: `variable-font`, deferred to TXT1b.
   - The manifest still hashes the bytes of every refused file.
2. **`font-face.ts`.** Parses the descriptors of one `@font-face` block from its css-tree node (the AtRuleContext node shape, so
   that T005b can plug it in directly):
   - `font-family`, `src`, `font-weight` (a single value or a range), `font-style` (normal, italic, `oblique <angle>{1,2}`),
     `font-stretch` (keyword, percentage or range), `unicode-range`, `font-display`, `size-adjust`, `ascent-override`,
     `descent-override`, `line-gap-override`, `font-feature-settings` and `font-variation-settings`.
   - Invalid and missing descriptors follow css-fonts-4 as Chrome 145 behaves. The whole rule is dropped when `font-family` or
     `src` is missing or invalid.
   - `font-feature-settings` and `font-variation-settings` produce a typed `descriptor-not-applied` result, never a silent
     ignore. `font-display` is recorded as no-effect, because bundled faces are present at the first frame.
   - **src selection matches Chrome:**
     - The src Dragon uses is the first entry whose `format()` and `tech()` Chrome 145 supports, because Chrome falls through
       only when a load fails.
     - If that entry is a format Dragon cannot read, the result is a typed error. Dragon never skips ahead to a later src.
     - **Typed build errors:**
       - `remote-url`: `http:`, `https:`, protocol-relative, or any scheme other than `data:`;
       - `unresolved-asset`: a relative URL with no resolution of kind `asset` in the snapshot;
       - `local-font`: `local()`, because it names a platform font; point the author at the font map.
     - `data:` URLs are allowed. They are decoded and treated as bundled bytes.
3. **`manifest.ts`.** Builds the bundled-font manifest:
   - one entry per face: family, descriptors, asset id, `sha256:<hex>` taken from `sha256HexBytes` (the same format
     `analysis/input.ts` validates), postScriptName and table facts;
   - `canonicalJson`, independent of order;
   - `manifestDigestInput(manifest)`, the exact value T005b adds to `analyze()`'s digest object.
   - Tests prove that changing one byte changes the digest, that reordering the rules does not, and that a remote URL never
     produces a manifest.
4. **`font-map.ts`.** The project font map:
   - Generic keys: `serif`, `sans-serif`, `monospace`, `cursive`, `fantasy`, `system-ui`, `ui-serif`, `ui-sans-serif`,
     `ui-monospace`, `ui-rounded`, `math`, `emoji` and `fangsong`, plus optional named platform families.
   - Each entry is either `{ mode: 'pinned', family, faces }` (bundled faces, support `exact`) or `{ mode: 'platform' }`
     (support `caveat`).
   - Validation errors are typed.
   - `rewriteFamilyList(list, map)` returns the web family list with each pinned generic replaced by its bundled family
     (quoted), plus the `@font-face` rules the web output must carry. It is pure data; emit/web-css.ts uses it in T005b.
   - A family name that is neither declared with `@font-face` nor present in the map gives the typed result `unmapped-family`.
     Dragon never silently uses a font installed on the machine.
5. **`family-list.ts`.** Parses a `font-family` value into a list: quoted strings, identifier sequences, and the generic
   keywords as css-fonts-4 and Chrome 145 treat them. Proven against Chrome's computed serialisation.
6. **`selection.ts`.** A port of Blink's font selection:
   - **Source:** `third_party/blink/renderer/platform/fonts/font_selection_algorithm.{h,cc}` and `font_selection_types.h`,
     at Chromium tag `145.0.7632.6`. It includes FontSelectionValue's fixed-point representation and clamping,
     FontSelectionRange and FontSelectionCapabilities.
   - **Order:** stretch, then style (including the italic and oblique thresholds and the angle rules), then weight (including
     the 400–500 rule).
   - **Face grouping, the part of `FontFaceCache` / `CSSSegmentedFontFace` that sits above fallback:** faces are grouped by
     their exact capabilities. Within a group, faces are ordered by declaration, later first, and filtered by `unicode-range`.
     The result is `candidates(family, request, codePoint)`, an ordered list of faces.
   - **Out of scope:** per-character fallback through missing glyphs (the reshape queue) belongs to the engine (TXT1a).
   - Every function and constant cites its Blink source location in one line.
7. **`metrics.ts`.** Blink's metric rules, per text-plan-summary:
   - hhea ascent, descent and lineGap on darwin, with the macOS half-down rounding in font_metrics.cc (AscentDescentWithHacks);
   - x-height from the bounds of glyph `x`;
   - ch from WidthForGlyph('0') as a float, without the 16.16 step;
   - cap height from OS/2;
   - `line-height: normal` = round(ascent) + round(descent) + round(lineGap);
   - `size-adjust`, `ascent-override`, `descent-override` and `line-gap-override` applied as Blink applies them.
   - The inputs are the face, the computed font size and the DPR, if the captures show that DPR matters.
8. **`faults.ts` (fonts-local)** and **`index.ts`** (the fonts module's barrel only).
   - The shared `src/faults.ts` and `src/internal.ts` are **not** touched: `internal.ts` belongs to P5, and exports are
     added in T005b.

## 3. Proof (AGENTS.md: numbers decide; no tolerance)

- **Chrome 145 captures** come from `scripts/capture-font-data.ts`, which uses `launchChrome` and `chromeArgsAt` from chrome.ts
  unchanged and embeds the vendored fonts as data URIs. They are committed under `packages/dragon/test/fonts/captures/`, each
  with the Chrome version, flags, font SHA-256 values and DPR.
  - **(a) Matching.** Each case is a family whose `@font-face` rules put distinct vendored files on descriptor sets, and a
    request for weight, style and stretch. Chrome's choice is read with the CDP call `CSS.getPlatformFontsForNode`
    (postScriptName and glyph count). This also covers the unicode-range and declaration-order cases, whose text spans
    several ranges.
    - Required coverage: every branch of stretch, style and weight, including the 400–500 band, oblique angles on both sides
      of the threshold, ranges, and ties.
    - Selection must agree with Chrome in every case.
  - **(b) Metrics.** Each vendored static font is measured at sizes 1, 7, 10, 13, 16, 17.5, 23.3, 37, 64 and 100 px, and at
    DPR 1, 2, 2.625 and 3.
    - **Values captured:**
      - ex, ch and cap, through `computedStyleMap()` on a length property, so each is a float32 computed value and not a
        LayoutUnit;
      - the height of a one-line block with `line-height: normal`;
      - the baseline offset;
      - the same measures under ascent-, descent- and line-gap-override and size-adjust.
    - Dragon must equal Chrome exactly after `Math.fround` where Blink stores a float.
  - **(c) Parsing.** Chrome's CSSOM for `@font-face` descriptors, covering valid, invalid and dropped rules, and the computed
    `font-family` serialisation for the family-list parser.
  - **(d) The pinned rewrite.** Chrome renders the rewritten CSS and uses the pinned face, read by postScriptName. This is the
    "stated reference" of pitfall 1 for an approved web change.
  - **(e) The platform-mode reference.** A record of what Chrome maps each generic to on darwin. It is data for the `caveat`
    label only, with no pass claim.
- **`--check` mode:** `scripts/capture-font-data.ts --check` captures again into a temporary directory and requires committed
  captures to be byte-identical.
- **Case counts** are derived from the capture files, never written as literals.
- **Planted faults** are fonts-local, and each is caught by a Chrome capture unless marked (unit):
  - `weightBandUpwardFirst`, `obliqueAsItalic`, `weightBeforeStretch`, `firstDeclaredWins`, `unicodeRangeIgnored`;
  - `metricsRoundHalfUp`, `xHeightFromOs2`, `chWith16_16`, `capHeightFromBounds`, `overridesIgnored`;
  - `remoteUrlAccepted` (unit), `manifestOrderSensitive` (unit), `skipUnreadableSrc` (unit).
  - A test runs every fault and asserts that it flips at least one comparison, and that the unfaulted run passes every case.
- **Vendored fonts:**
  - OFL static TTF faces, total at most about 4 MB: Inter Light, Regular, Italic, Bold and BoldItalic (distinct
    postScriptNames for matching), Roboto Regular, Noto Sans Regular, and Noto Sans Mono Regular for a pinned monospace.
  - They go under `vendor/fonts/<Family>/`, each with its `OFL.txt`.
  - For each, `vendor/fonts/README.md` gets an appended section with the source URL, the version, the SHA-256 and the byte
    count. A test recomputes each SHA-256.
  - Copies already exist in `/tmp/text-spike/fonts/` (Inter-Regular, Roboto-Regular, NotoSans-Regular). They are usable
    only if their provenance can be stated. Otherwise download them from the upstream release.

## 4. Deferred to T005b (TXT1-C wiring): these files wait for T002 to fast-forward master

- `packages/dragon/src/css/at-rules.ts`: the `font-face` handler. No in-flight branch touches this file.
- `packages/dragon/src/css/stylesheet.ts`: an accepting AtRuleOutcome kind. Touched by feat-cascade-var and feat-units.
- `packages/dragon/src/project.ts`: the manifest and font map in the digest, and the option. Touched by feat-block-elements
  and t014.
- `packages/dragon/src/types.ts`, `index.ts` and `internal.ts`: the public font map configuration and exports. types.ts is
  touched by t014; internal.ts belongs to P5.
- `docs/api.md`: touched by t014.
- `packages/dragon/src/diagnostics/codes.ts`, `catalogue.ts` and `test/diagnostic-codes.json`: the codes for remote URLs,
  local fonts, unmapped families and unreadable fonts. catalogue.ts is touched by feat-block-elements.
- `analysis/resolve.ts` and `analysis/computed.ts` (family resolution), and `emit/web-css.ts` (the pinned rewrite and
  `@font-face` emission).
- Profile rows, and parity fixtures plus a `fixture-groups/fonts.ts`.

Web can become `exact` in T005b. Native rows stay unsupported until TXT1a proves device-lines with real fonts. T005b does not
touch text.ts or inline.ts. It lands after T002, and it should merge either before P5 starts or after P5 lands, so that P5's
set of "every master fixture at P5 start" does not move under it.

## 5. Stop conditions (T005)

- A needed file is outside allowed_files. In particular, any file listed in §4, package.json, the lockfile, or
  `packages/parity/src/**`.
- Chrome's selection or metrics disagree with the faithful port after the Blink source at 145.0.7632.6 has been re-read.
  Report the cases; never add a tolerance or a special case.
- `CSS.getPlatformFontsForNode` or `computedStyleMap` cannot observe a quantity exactly. Report it and propose a different
  exact observable; do not substitute a LayoutUnit-rounded proxy silently.
- Macro-level: a font licence is not OFL or public domain, or the vendored total exceeds about 4 MB.
- Verification fails twice.
