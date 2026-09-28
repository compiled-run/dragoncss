# Real-font text spike (2026-09-28)

These results decide the text strategy (docs/decisions.md, "Text strategy").

- `tables.md`: the measured results, 620 cases.
- Scripts: `corpus.mjs` (cases), `compare.mjs`, `diff.mjs`, `classify.mjs`, `summarize.mjs`. The Core Text / TextKit CLI is in `coretext/` and the Android StaticLayout APK source in `android/`. The APK is built Gradle-free: see `build.sh`.
- Chrome capture (`chrome/`): `measure.mjs` (per-line Range client rects and nowrap span widths), `opps.mjs` (break opportunities from a `width: 0` layout) and `page.html` (the `@font-face` page both load). They are committed as run, so they still name `/tmp/text-spike/...` paths: to re-run them, place this directory's files there, with the fonts in `/tmp/text-spike/fonts/`.
- Raw output (`out/`): `cases.json` (from `corpus.mjs`), `chrome.json` (`measure.mjs`) and `chrome-opps.json` (`opps.mjs`), byte for byte as written at 11:42–11:45. `android/apk/assets/` holds the same `cases.json` and `chrome-opps.json`.
- `chrome/loaded-fonts.sha256`: the SHA-256 of the font files Chrome loaded, taken in the capture's `fonts/` directory.
- Fonts: open-licence, committed in `fonts/` (see `fonts/README.md`): Roboto, Noto Sans, Inter variable and Noto Sans JP. Inter Regular is byte-identical to `vendor/fonts/Inter/Inter-Regular.ttf` and is kept only there. To rebuild the APK, put Roboto-Regular.ttf, NotoSans-Regular.ttf and Inter-Regular.ttf in `android/apk/assets/fonts/`.
- References: Chrome 145.0.7632.6 on macOS, macOS Core Text and TextKit 1 (as a stand-in for iOS), and Android 16 (SDK 36) StaticLayout on the `dragon-smoke` emulator at 1x, 2.625x and 3x.

## TXT1-0 gate

- `gate/chrome-145.json` is the gate's reference. `node packages/text-shaper/scripts/import-spike.ts docs/research/text-spike/out` regenerates it byte for byte from `out/` and `chrome/loaded-fonts.sha256`.
- `gate-report.md` is the gate result (`node packages/text-shaper/scripts/report.ts`). The gate runs in `pnpm test` and in `node packages/text-shaper/scripts/gate.ts`.
- Not committed: the Core Text, Android and other Chrome variant outputs (`coretext.json`, `android-*.json`, `chrome-dpr2.json`, `chrome-noopsz.json`, `chrome-spaceall.json`, `tokens-android.json`, `tokens-chrome.json`, `tst.json`) and the exploratory Chrome scripts (`debug.mjs`, `prefix.mjs`, `tokens.mjs`, `tst.mjs`). They fed `tables.md` only, not the gate.
