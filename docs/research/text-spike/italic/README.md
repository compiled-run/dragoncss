# Italic gate cases (TXT1a-1 R6)

R6 of docs/goals/milestone-2-proof/notes/T056-txt1a-spec.md: Chrome gate cases for Inter Italic and Bold Italic
(`vendor/fonts/Inter/Inter-Italic.ttf`, `Inter-BoldItalic.ttf`) with the Lato method (`../lato/`) and the spike's Latin corpus,
at the spike's sizes 12, 16, 17 and 24 px plus 23.3 px, and its five widths: 2 faces × 8 paragraphs × 5 sizes × 5 widths = 400
cases, wrapped and nowrap.

- `cases.mjs`, `measure.mjs`, `opps.mjs` and `page.html` are the Lato files with each case's font-style (italic) added.
- `import.mjs` writes the gate reference `out/chrome-145-italic.json` as `packages/text-shaper/scripts/import-spike.ts` writes
  the Lato one. `loaded-fonts.sha256` holds the SHA-256 of the files Chrome loaded, the vendored ones.
- Re-run from the repo root: `node docs/research/text-spike/italic/cases.mjs`, then `measure.mjs`, `opps.mjs` and `import.mjs`
  in the same directory. Chromium must be 145.0.7632.6.
- `packages/text-shaper/test/gate.test.ts` runs the 400 cases (all exact) and `packages/layout/test/shaping-gate.test.ts` has the
  engine decide their lines. They are kept out of `GATE_REFERENCES`, whose cases TXT1-N's committed transcript records.
