# T036: bundle Lato (Worker)

Branch `lato-font` in /tmp/dragon-lato, commit 71dbdf4 (on master 3a345c5). Not pushed.

## 1. Vendored files

- Pinned google/fonts commit: `5d3b76120a319730fda218cc7410174a462b32cb`, the latest commit touching `ofl/lato`. Its
  `METADATA.pb` names `source { commit: "080cb69711ca050d91e9c866e58df7a73095c69a", repository_url: googlefonts/LatoGFVersion }`.
  The TTF bytes are unchanged since `f3b885d5` ("lato: v2.015 added", 2016). I downloaded them at both commits: the bytes are identical.
- Lato-Regular.ttf `d636e468…b251` (656,568 bytes) and Lato-Bold.ttf `8a0aace7…6be1` (656,544 bytes) match the expected values.
  OFL.txt is `74ba064d…e59e` (4,407 bytes).
- Provenance is appended to `vendor/fonts/README.md` as a new "Lato (Lato/)" section with the standard table.

## 2. Font captures (scripts/capture-font-data.ts)

- `FONT_FILES` gains Lato Regular and Bold, appended at the end.
- Metrics: the `plain` variant covers every face, so Lato gets 10 sizes × 4 DPRs × 2 faces = 80 rows, and each row carries
  ex, ch, cap, line-height normal and baseline.
- Matching: four new cases (233 requests), all exact:
  - `lato-regular-bold` has faces 400/700, the form a font map will declare. It has 180 requests over 20 weights,
    stretches 75/100/125 and normal/italic/oblique 10deg.
  - `lato-no-descriptors` has 8 requests.
  - `lato-with-inter` mixes Lato with Inter Light and Inter BoldItalic in one family (40 requests).
  - `lato-family-list` covers `"Lato", "Dragon Sans"` in both orders and `Nope, Lato` (5 requests).
- Parsing and platform do not depend on the face; only their headers list the two new hashes.
- The pinned map is unchanged. `wire.test.ts` uses `'Lato'` as its example of an unmapped family, so T038 owns that change (see §5).
- Existing rows are unchanged. The old files equal the new ones with the Lato font hashes, the `lato-*` cases and the Lato
  metric rows removed; I checked this by script. `--check` is byte-identical.

## 3. HarfBuzz gate

- Method: `docs/research/text-spike/lato/{measure,opps}.mjs` are the spike's `chrome/{measure,opps}.mjs`. The only differences:
  - repo-relative paths instead of /tmp/text-spike;
  - `font-family: Lato` plus `font-weight` per case;
  - a check that Chromium is 145.0.7632.6.

  The spike used plain `chromium.launch()`, with no parity flags, and so do these scripts. `page.html` declares Lato 400 and
  700 from `vendor/fonts/Lato`.
- Corpus (`lato/cases.mjs`): the 8 Latin spike paragraphs, including `kernlig` with its kerning pairs, in both weights.
  - Sizes: 11.2, 12, 12.48, 16, 17, 21.6, 24 and 32. These are the spike's sizes plus the demo's 0.7rem, 0.78rem, 1.35rem
    and 2rem.
  - Widths: 120, 177, 240, 333 and 480, wrapped plus nowrap.
  - Total: 640 cases, 320 per weight.
- Result: **640/640 exact** on the first run, with no model change. `node packages/text-shaper/scripts/gate.ts` prints
  `gate: 1260/1260 cases exact, 9855 lines`.
- `gate/chrome-145.json` (the 620), `out/` and the WASM are byte-identical to master, so no zig build was needed.
- A second Chrome run of `measure.mjs` and `opps.mjs` reproduced `lato/out/*.json` byte for byte.
- The Lato break opportunities equal the spike's `en` ones, and a test asserts this.
- Reference: `docs/research/text-spike/gate/chrome-145-lato.json`, written by `import-spike.ts`. It now takes optional
  `<reference> <loaded-fonts>` arguments, and with no extra arguments it still regenerates the 620 file byte for byte.
- Raw output is in `lato/out/`, and `lato/loaded-fonts.sha256` holds the loaded fonts' hashes.

## 4. Rulings and retargets

- **Retarget (pinned test), `packages/dragon/test/fonts/vendored.test.ts`:**
  - "lists the eight OFL faces of the spec" now lists the eight faces plus the two Lato faces.
  - The "about 4 MB" total is now applied to the spec's eight capture faces (still 3,304,372 bytes, unchanged), and Lato
    is pinned at exactly 1,313,112 bytes.
  - Reason: the vendored total is 4,617,484 bytes with Lato. The 4 MB bound in notes/T004 §3 budgets the fonts module's
    eight capture faces. The T035 ruling accepted Lato's ~1.3 MB as the north star's own bundle.
  - Intent kept: the capture set's budget is unchanged, and Lato's size is pinned, so neither can grow silently.
- **Ruling:** the Lato gate test's planted faults cover float accumulation, whole-pixel positions and kerning off. All three
  flip Lato cases.
  - "No reshaping at line start" flips no Lato case. Lato's Latin shaping has no context at line starts that changes these
    widths.
  - It stays covered on the 620 cases. It is left out of the Lato list rather than asserted.
- `docs/research/text-spike/gate-report.md` (report.ts) still reports only the 620. The report needs a full zig build for
  its size table, so I left it alone. The Lato cases run in `pnpm test` and in `gate.ts`.

## 5. What T038 needs (the north-star wiring, not done here)

- Add a `families` entry to the north-star font map:
  `Lato: { mode: 'pinned', family: <e.g. 'Lato'>, faces: [{ src: 'fonts/Lato/Lato-Regular.ttf', weight: '400' }, { src: 'fonts/Lato/Lato-Bold.ttf', weight: '700' }] }`.
  - Use `'fonts/Lato/…'`, or the example's asset path convention.
  - Keep `sans-serif` → Dragon Sans.
  - `matching.json` `lato-regular-bold` proves this face set's selection at every weight, stretch and slope.
    `lato-family-list` proves `Lato, "Dragon Sans"` resolution per character for ‹ ›, which Lato has.
- The fonts module's matching does not model cmap fallback: `candidates` checks only unicode-range. So ♪ and ▶ (not in
  Lato, but in Inter) falling from Lato to Dragon Sans is not proven by these captures. That is TXT1d symbol-fallback
  work, together with ❚ U+275A, which neither font has.
- `packages/dragon/test/fonts/wire.test.ts` uses `'Lato', sans-serif` and `Lato` as its `font-family:<unmapped>` examples,
  against `pinned.json`'s map. If T038 adds Lato to that capture map, those two cases need retargeting to another unmapped
  name. Otherwise, leave `pinned.json` alone and map Lato only in the north-star config.
- Recapture `examples/music-player/chrome/` (T034). Today's captures are Helvetica.
- Italic is not needed (the demo has none). Requests for Lato italic get synthetic oblique of the upright face in Chrome,
  and the captures already match that for selection.

## Verification (in /tmp/dragon-lato)

- `pnpm typecheck`: pass.
- `pnpm test`: 74 files, 1,508 tests passed. The first full run had one load timeout, the parity.test.ts determinism case at
  120 s with a load average of about 27. The file passed alone on rerun (237/237), and a second full run passed clean.
- `node --conditions=dragon-internal scripts/capture-font-data.ts --check`: byte-identical (5 files).
- `node packages/text-shaper/scripts/gate.ts`: 620/620 plus 640/640, 1260/1260 exact.
- zig build: not needed, because the WASM is unchanged.
