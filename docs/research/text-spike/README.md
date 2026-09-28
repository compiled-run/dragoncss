# Real-font text spike (2026-09-28)

These results decide the text strategy (docs/decisions.md, "Text strategy").

- `tables.md`: the measured results, 620 cases.
- Scripts: `corpus.mjs` (cases), `compare.mjs`, `diff.mjs`, `classify.mjs`, `summarize.mjs`. The Core Text / TextKit CLI is in `coretext/` and the Android StaticLayout APK source in `android/`. The APK is built Gradle-free: see `build.sh`.
- Fonts are open-licence and were downloaded, not committed: Inter, Roboto, Noto Sans, Inter variable, Noto Sans JP. Put them in `android/apk/assets/fonts/` to rebuild.
- References: Chrome 145.0.7632.6 on macOS, macOS Core Text and TextKit 1 (as a stand-in for iOS), and Android 16 (SDK 36) StaticLayout on the `dragon-smoke` emulator at 1x, 2.625x and 3x.
