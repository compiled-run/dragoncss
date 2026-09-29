# Dragon Blackletter: glyph log

Style reference: `wordmark-ref.png` (hero crop), with `../hero.png` as a second reference on every generation.
Sheets live in `sheets/` (prompts in `sheets/prompts/`, rejected sheets in `sheets/rejected/`).
Generator: `tools/gen.sh <sheet> "<glyph list>" [extra refs...]` (Codex CLI image generation).

## Sheets used

| Sheet | Glyphs | Extra refs attached | Result |
|---|---|---|---|
| sample | "Dragon CSS" word sample | - | Accepted. Very close to the hero; used as a style ref for every later sheet and for calibration |
| up1 (v2) | A B C D E F G | sample | Accepted |
| up2 (v2) | H I J K L M N | sample | Accepted |
| up3 | O P Q R S T U | sample | Accepted |
| up4 | V W X Y Z | sample, up3 | Accepted |
| low1 | a b c d e f g | - | Accepted |
| low2 | h i j k l m n | sample, low1 | Accepted |
| low3 | o p q r s t u | sample, low2 | Accepted |
| low4 | v w x y z | sample, low2 | Accepted |
| dig1 | 0 1 2 3 4 | sample, low2 | Accepted except 0 |
| dig2 | 5 6 7 8 9 | sample, dig1 | Accepted |
| dig3 | 0 (1 and 8 only as height anchors) | sample, dig1, dig2 | 0 taken from here |
| pun1 | . , : ; ! ? ' " | sample, low2 | Accepted |
| pun2 | - ( ) & / @ # * | sample, low2 | Accepted (hyphen narrowed to 60% width in the build) |
| pun3 | + = < > [ ] { } · | sample, low2 | Accepted |

## Regenerated glyphs and why

| Glyph(s) | Why | Fix |
|---|---|---|
| A B C D E F G (up1 v1) | Glossy highlights: white streaks and specks all through the strokes, which would trace as noise | Regenerated with a "solid flat black fill, no gloss" rule and sample.png attached |
| H I J K L M N (up2 v1) | Wrong style: plain Textura capitals, inconsistent with the hero's Old English D/C/S and with up1 | Regenerated with an explicit style rule (Old English capitals like the reference D, C and S) and sample.png attached |
| 0 (dig1) | Read as a slashed zero / O-with-stroke because of a diagonal hairline in the counter | Regenerated alone (dig3) with the approved digits attached; only the 0 is used |

## Build-time fixes (no regeneration)

- `hyphen`: generated about 500 units wide; scaled horizontally to 60% (`tools/spacing.json` `_xscale`).
- `Y`: FontForge `simplify()` corrupted the outline (a 9000-unit-wide contour). The build no longer calls simplify. A bbox guard reverts any glyph whose outline changes during cleanup.

## Verification

Every sheet was split by column projection (`tools/segment.py`, keeping the N-1 widest gaps so i j ; : " = stay whole). Each glyph crop was reviewed on a contact sheet: right character, legible, same weight and style. Stem widths after normalisation (`tools/trace.py` output) all fall between 104 and 120 units (target 106).
