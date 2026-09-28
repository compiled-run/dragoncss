# T035: Lato in the north-star demo (Scout, read-only)

Question: should Dragon (a) bundle Lato, (b) drop Lato so the demo uses "Dragon Sans" (Inter 4.1), or (c) leave it to the platform (caveat)?

## 1. Did the original demo load Lato?

No. It never has.
- `markless/demos/music-player-ssr/src/styles.css:32` is `font-family: 'Lato', sans-serif;`. No `@import`, `@font-face`, Google Fonts `<link>` or `fonts.googleapis.com` reference exists anywhere in the demo (`document.tsrx`, `src/`, `pages/`, `public/`, the built `.output` CSS). `document.tsrx:11` links only the app stylesheet.
- Markless git history: the demo first appears in `840b5113` (2026-06-26, "Consolidate packages and move demos"), already with the bare `'Lato'` and no loader, in both `demos/music-player` and `demos/music-player-ssr`. `git log -S googleapis` finds no commit touching the demo.
- Dragon already records this: `examples/music-player/README.md:146` ("names a font the demo never loads, so Chrome uses the host's `sans-serif`"), `GAPS.md:124` ("Pin an open `sans-serif` (the demo never loads Lato)"), `GAPS.md:222` ("Bundle one OFL font as `sans-serif`").
- Reading of intent: the author named Lato, but every rendering anyone has seen (Markless, the Dragon Chrome captures) is the host fallback, Helvetica on darwin. Unverified guess: the "Waves" screen resembles a public React music-player tutorial that did load Lato from Google Fonts; the loader was lost before Markless. Not evidenced on disk.

## 2. Weights and styles used

- `body`: `font-family: 'Lato', sans-serif` (400, normal). `button, input, iframe { font: inherit }`.
- `h1, h2`: UA bold (700). There is no `font-weight` override on them.
- `h3, h4 { font-weight: 400 }` (styles.css:60) cancels UA bold on h3.
- No `font-style`, `<em>`, `<i>`, `<b>` or `<strong>` in the CSS or `snapshot.html`.
- So the demo needs exactly two faces: Regular 400 and Bold 700. No italic.

## 3. Lato availability, licence, versions

Both sources are OFL 1.1 and both are Lato **2.015** (2015-08-06). Google Fonts no longer serves Lato 1.x: its `ofl/lato` is built from `googlefonts/LatoGFVersion` at commit `080cb69711ca050d91e9c866e58df7a73095c69a` (METADATA.pb).

| Source | URL | Regular sha256 | Bold sha256 | Size (R/B) |
| --- | --- | --- | --- | --- |
| latofonts.com | https://www.latofonts.com/files/Lato2OFL.zip (zip sha256 `42b54e96c07e299d967fc3227c7bd63a20d6cfb1dc8fd6dae83628091e20a5b8`) | `6f6940be0835c3ddec9199e5fc42be4cbc61ebcfd58c623fdf719366253f1780` | `bf1b8130069b44b9148eeece35e5423bedac49777ba746615b826b8276574a7b` | 657,212 / 657,188 |
| Google Fonts | https://github.com/google/fonts/raw/main/ofl/lato/Lato-Regular.ttf and `Lato-Bold.ttf` | `d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251` | `8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1` | 656,568 / 656,544 |

(Italic and BoldItalic were also fetched, but the demo does not need them. latofonts: `8c863f83…`, `e2f9244f…`; GF: `e399c44e…`, `62c1b7f0…`.) The documented URL `https://www.latofonts.com/download/lato2ofl-zip/` now returns 404.

Parsed from the files (node table reader, /tmp/lato/insp.mjs):
- Both builds: 3,023 glyphs, upem 2000, **not variable** (no `fvar`/`HVAR`), TrueType `glyf`, hinted (`fpgm` present), no `hdmx`, kerning in `GPOS` only (no `kern` table), and `GSUB`.
- hhea is identical in the two builds: ascender 1974, descender -426, lineGap 0. hmtx is identical too: the same advance sum for the demo's title string. x-height is 1013 (Regular) and 1026 (Bold); cap height 1433 and 1446.
- **The only difference is the OS/2 vertical metrics.** latofonts has typo 1610/-390/400, win 1974/426 and USE_TYPO_METRICS off. GF has typo = hhea = 1974/-426/0, win 2233/599 and USE_TYPO_METRICS on. Chrome on darwin reads hhea (text-plan-summary "Metrics: hhea on darwin"), so line boxes are the same with either file. The GF build is self-consistent across hhea and typo, which removes a platform-divergence trap if a native path ever reads OS/2.
- Symbol coverage for the demo's ♪ ▶ ❚ ‹ ›: Lato has only ‹ ›. Inter 4.1 has ♪ ▶ ‹ › and lacks ❚ (U+275A). With `'Lato', sans-serif` mapped to Lato plus Dragon Sans, ♪ and ▶ fall back within the author's own family list to bundled Inter, so they stay exact. ❚ needs further fallback either way, so there is no new gap.

## 4. Cost for the proof pipeline

- The text plan's proof uses fixtures "with vendored OFL fonts at every DPR", plus the spike corpus as a fixture group (text-plan-summary.md:50-54). The step-0 gate is 620 spike paragraphs over the four vendored fonts. T024 §52 says the static advance model `units*size/upem` is "validated on 560 cases across 4 fonts" (Inter, Roboto, Noto Sans, Noto Sans Mono; T005 table).
- The proof is not structurally per family: static fonts share one advance path (hmtx units through 16.16 into HarfBuzz GPOS). But the evidence is per font, and the T024 principle is to extend scope only with Chrome cases before widening.
- Adding Lato means:
  - vendoring 2 files (~1.31 MB) plus OFL.txt;
  - rerunning `scripts/capture-font-data.ts` (T005 font data and matching);
  - adding Lato 400/700 paragraphs to the Chrome capture set and gate;
  - adding fixtures.
  This is capture and fixture work, not new engine code.
- New risk is low:
  - static font, so it is outside the variable-font fence (decision "Variable fonts are fenced");
  - GPOS-only kerning, like Inter;
  - upem 2000 is not a power of two, but Noto (upem 1000) already covers non-power-of-two scaling;
  - hinting (`fpgm`) is present in Inter 4.1 too, and does not affect advances (Dragon takes hmtx units; "Native glyph advances"); it only affects rasterisation, which the text pixel lane compares by ink bounds with a measured allowance.
  - The residual risk is a Lato-specific GPOS/GSUB feature interaction that the gate has not seen. The fix is the same Chrome cases.
- Italic `ch` caveat (T005) does not apply: the demo uses no italic.
- Every option recaptures Chrome anyway. The committed captures in `examples/music-player/chrome/` were rendered in Helvetica, and the font key (README.md:143) changes under (a), (b) or a pinned (c).

## 5. Visual fidelity: Lato vs Inter

- Width: the song-title string is 17.80 em in Lato Regular and 19.31 em in Inter Regular, so Inter is about 8.5% wider. Wrapping of long titles (h2 at `width: 20rem`, `overflow-wrap: anywhere` at ≤640px, which covers both device viewports) will differ.
- x-height: Lato 0.507 em, Inter 0.546 em. Inter looks larger and more "UI"; Lato is rounder and more humanist.
- `line-height: normal`: Lato 1.200 em ((1974+426)/2000), Inter 1.2099 em ((1984+494)/2048).
- The demo relies on `normal` widely. Only `.play-control button` (1), `.youtube-disclosure` (1.4) and the ≤640px `.song-container h2` (1.15) set it. `nav h1`, the desktop song-title h2, every h3/h4, `.library h2`, `.time-control p` and the library button use `normal`.

## 6. Precedent in decisions.md

- Course correction 4 (decisions.md:88): the north star "must run end to end ... verified visually against Chrome"; "Nothing it uses is dropped because a platform lacks it".
- "Pinned generic fonts (PM, T033)": `sans-serif` → Dragon Sans (Inter 4.1). "There is no built-in default map: an unmapped generic or family is a build error with a fix." So an unmapped `'Lato'` cannot silently pass through. It must be mapped, or removed from the CSS.
- Fonts (text-plan-summary): "Bundled `@font-face` files are the only exact source"; "platform: the system font is used, and the result is caveat".
- GAPS.md:124 and GAPS.md:222 (earlier Scout planning) leaned towards "pin an open sans-serif" and treated Lato as absent. This predates CC4's no-drop wording.

## Options assessed

- **(a) Bundle Lato 2.015, Regular and Bold.**
  - Keeps the demo's CSS byte-for-byte and honours the named family (CC4).
  - Exact on every side, because a bundled `@font-face` is the only exact source.
  - Also exercises Blink family-list fallback (Lato → Dragon Sans for ♪ ▶).
  - Cost: ~1.3 MB, font-data capture, and gate and fixture Chrome cases. No new engine path.
  - Visible change from today's Helvetica look, but towards what the CSS says.
- **(b) Drop Lato.**
  - Edits the north-star CSS, so the demo no longer "runs as designed". That is a precedent CC4 forbids in spirit, even though the cause is a missing asset rather than a missing platform feature.
  - Cheapest, because Inter is already gated.
- **(c) Platform.**
  - The Chrome reference would be Helvetica (darwin host) while natives use SF or Roboto: unprovable, permanent caveat.
  - It also conflicts with the T033 rule that unmapped families are build errors.
  - It contradicts "verified visually against Chrome".

## Recommendation: (a), decisive (owner delegated the ruling; not an owner question)

Bundle Lato 2.015 Regular and Bold, and map the family `Lato` to them in the project font map. Keep the demo CSS unchanged. `sans-serif` → Dragon Sans stays as the fallback in the author's family list.

Vendor exactly these files, as `vendor/fonts/Lato/`:

| File | Version | Source URL | sha256 | Bytes |
| --- | --- | --- | --- | --- |
| `Lato-Regular.ttf` | 2.015 (name ID 5: "Version 2.015; 2015-08-06; http://www.latofonts.com/") | https://github.com/google/fonts/raw/main/ofl/lato/Lato-Regular.ttf | `d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251` | 656,568 |
| `Lato-Bold.ttf` | 2.015 | https://github.com/google/fonts/raw/main/ofl/lato/Lato-Bold.ttf | `8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1` | 656,544 |
| `OFL.txt` | from google/fonts `ofl/lato/OFL.txt` | https://github.com/google/fonts/raw/main/ofl/lato/OFL.txt | record on download | |

Provenance to record in `vendor/fonts/README.md`:
- the google/fonts file is built from `googlefonts/LatoGFVersion` at commit `080cb69711ca050d91e9c866e58df7a73095c69a` (per `ofl/lato/METADATA.pb`);
- the Worker should pin the download to a google/fonts commit, not `main`, and re-verify the sha256 above;
- the latofonts.com reference build, `https://www.latofonts.com/files/Lato2OFL.zip` (sha256 `42b54e96c07e299d967fc3227c7bd63a20d6cfb1dc8fd6dae83628091e20a5b8`; Regular `6f6940be0835c3ddec9199e5fc42be4cbc61ebcfd58c623fdf719366253f1780`, Bold `bf1b8130069b44b9148eeece35e5423bedac49777ba746615b826b8276574a7b`), has identical glyphs, hmtx and hhea. It differs only in OS/2 typo and win metrics.

Why the GF build:
- Chrome on darwin reads hhea, which is equal in both builds.
- The GF build sets typo = hhea with USE_TYPO_METRICS, so no native path can read different vertical metrics.
- It is the file a web author writing `'Lato'` gets.

Do not vendor Italic or BoldItalic: the demo uses neither.

Why not (b) or (c):
- (b) edits the north star's CSS, against CC4's "runs as designed / nothing dropped".
- (c) is unprovable against Chrome, and T033 makes an unmapped family a build error.

Conditions before any Lato row is labelled exact:
- add Lato 400/700 Chrome cases (spike-corpus paragraphs) to the TXT1a gate and fixtures;
- rerun `scripts/capture-font-data.ts`;
- recapture `examples/music-player/chrome/` (the font key changes; the captures there today are Helvetica).
