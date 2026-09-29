# Dragon Blackletter

Dragon CSS's own blackletter display face, drawn from the "Dragon·CSS" wordmark in the homepage hero.

- `DragonBlackletter-Regular.woff2`: for the web
- `DragonBlackletter-Regular.otf`: desktop / source of the woff2

```css
@font-face {
  font-family: "Dragon Blackletter";
  src: url(assets/fonts/dragon-blackletter/DragonBlackletter-Regular.woff2) format("woff2");
  font-display: swap;
}
```

**Coverage:** A-Z, a-z, 0-9, `. , : ; ! ? ' " - ( ) & / @ # * + = < > [ ] { } ·`, space and no-break space. The curly quotes, en dash and bullet reuse the drawn marks.
**Metrics:** 1000 UPM, x-height 470, cap height 720, ascent 820 / descent 230 (hhea, typo and win are all equal), line gap 150.
**Kerning:** GPOS `kern` feature, about 2000 optically measured pairs, clamped to between -70 and +20 units.
**Use:** display sizes (headings, 24px and up). The ink specks in the heavy strokes are intentional (the hero's printed-ink texture) and disappear below about 18px.

## Licence

MIT License, the same as the Dragon CSS project.

Copyright (c) 2026 the Dragon CSS project

Permission is hereby granted, free of charge, to any person obtaining a copy of this software (the font files) and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Source and rebuild

Everything is in `assets/font-src/` (see `glyph-log.md` there):

1. `tools/gen.sh`: generates glyph sheets with Codex image generation, using `wordmark-ref.png` and the hero as references (writes to `sheets/`).
2. `tools/segment.py`: splits the sheets into glyphs (writes `glyphs/`).
3. `ROUGH=1 tools/trace.py`: normalises each glyph to font units and traces it with potrace, adding a seeded ink texture (writes `traced/`). `sources.json` maps each glyph to its sheet.
4. `fontforge -lang=py -script tools/build_font.py`: builds the OTF and WOFF2. Spacing is in `tools/spacing.json`, kerning settings in `tools/kerning.json`.

The Python steps need numpy and pillow, e.g. `python3 -m venv /tmp/v && /tmp/v/bin/pip install numpy pillow`.
