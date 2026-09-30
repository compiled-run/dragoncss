# Writing-mode probe corpus (WM-P)

Chrome 145.0.7632.6 (Playwright 1.58.2) measurements of writing modes, for WM-0, WM-1a/1b, WM-2, WM-3 and WM-4 to cite. Every case uses Ahem only. Each case runs in every writing mode Chrome accepts (all five: `horizontal-tb`, `vertical-rl`, `vertical-lr`, `sideways-rl`, `sideways-lr`; see `probe/support.json`), in ltr and rtl, at DPR 1, 2, 3 and 2.625. That is 40 environments per case, except the computed-value family, which runs under `horizontal-tb` and `vertical-rl` containers only (16 environments). There are 193 cases and 6,568 measured environments. The Blink source reading that explains each measured rule, and the native rotated-run plan, are in [blink-notes.md](blink-notes.md).

## Running

```text
node --conditions=dragon-internal scripts/capture-writing-mode-probe.ts          # writes probe/*.json
node --conditions=dragon-internal scripts/capture-writing-mode-probe.ts --check  # recaptures and exits 1 unless every file is byte-identical
```

The script imports `packages/parity/src/chrome.ts` unchanged. `launchChrome(dpr)` refuses any Chrome other than 145.0.7632.6. `openPage` injects the harness style: Ahem as the root font, and `direction: rtl` on the root for rtl. Each case is a `<div id="c" style="writing-mode:<mode>; ...">` at the top-left of a 400x300 viewport (some orthogonal cases use 250x180), with `body{margin:0}` and `#c{font-size:10px}`. The body stays `horizontal-tb`, so a vertical `#c` is itself an orthogonal flow root.

- **`childWm` cases** (family 2) keep `#c` horizontal-tb and put the environment's mode on a child through `{wm}` in the HTML.
- **Sideways modes.** Before capturing, the script asks Chrome `CSS.supports('writing-mode', m)` for each mode and drops any mode Chrome rejects. Chrome 145 accepts both `sideways-rl` and `sideways-lr`, so nothing was dropped. `-webkit-writing-mode` rejects both.

## Files

| File | Family | Cases |
| --- | --- | --- |
| `probe/support.json` | `CSS.supports` for every mode, the legacy `writing-mode` values, `-webkit-writing-mode`, `text-orientation: sideways-right` and `text-combine-upright: digits 2`; the modes captured and the modes dropped | - |
| `probe/family1-block-flow.json` | 1. block flow per mode: fixed and auto sizes, logical sizes, block-axis margin collapsing, physical margins, auto margins, padding and border, percentages, auto block size, min and max, text paragraphs, nested parallel modes, BFC, collapse-through, fractional sizes, inline-block children | 17 |
| `probe/family2-orthogonal.json` | 2. orthogonal flows and the fallback inline size: parent auto, fixed, max, min, min+max, border-box, percent padding, percent height, a smaller viewport, fixed child, short child, child margins, shrink-to-fit parents, orthogonal inline, orthogonal flex items (row and column), the reverse direction (horizontal child in a vertical parent), and a vertical `#c` with auto height | 22 |
| `probe/family3-flex.json` | 3. flex in each mode: 9 `justify-content` values (including `left` and `right`), 9 `align-items` values, the four directions, wrap and wrap-reverse with gaps, grow and shrink with fractional leftovers, text items, an orthogonal item, auto margins, `align-self`, inline-flex baselines | 30 |
| `probe/family4-abspos.json` | 4. abspos static positions: block-level and inline-level static positions, one inset set on either axis, right and bottom, logical insets, shrink-to-fit, stretch, auto-margin centring, an orthogonal abspos, a padded container, a centred flex parent, margins | 14 |
| `probe/family5-inline.json` | 5. inline line boxes with Ahem rotated sideways (all cases record per-character rects): wrapping, line-height number and px, mixed and fractional font sizes, six `text-align` values, `text-indent`, `<br>`, decorated spans, nine `vertical-align` values on an inline-block, 0x0 baseline markers under `mixed` and `sideways`, inline-block baselines, an embedded `bdo` | 27 |
| `probe/family6-orientation-combine.json` | 6. `text-orientation` (`mixed`, `upright`, `sideways`) over Latin, CJK (Ahem covers 水火金一) and upright-in-mixed symbols (§ © × ÷); upright and CJK advances at 10, 13, 17.5 and 23.3 px; spans with their own orientation; `text-combine-upright: all` on 1 to 4 characters, at 20px, under an underline, with a tall line-height, inside wrapping text; `digits 2`; `upright` in a sideways mode | 30 |
| `probe/family7-glyphs.json` | 7. screenshot glyph grids: 40px `p` (ink in the descent only), `É` (ink in the ascent only) and `水` (whole em box) under each orientation; a combined `12`; a mixed run `p水É` | 5 |
| `probe/family8-computed.json` | 8. computed and specified values: `writing-mode` and `-webkit-writing-mode` for all five modes, `lr`, `lr-tb`, `rl`, `rl-tb`, `tb`, `tb-rl`, `initial`, `inherit` and an invalid value; `text-orientation` and `-webkit-text-orientation` including `sideways-right`, `vertical-right` and `use-glyph-orientation`; `text-combine-upright` and `-webkit-text-combine`; `writing-mode` on a table row group and row | 48 |

## Record format

Each family file holds `cases[id] = { note, style, html, results }`. It also holds `childWm`, `viewport` and `glyphs` when the case sets them. `results[mode][dir]["dpr<N>"]` holds:

- `container`: `#c`'s border box, `[x, y, width, height]`. All rects are CSS px relative to `#c`'s border box.
- `leaves[]`: each text node's Range `getClientRects()`, keyed by the nearest `data-p` owner and its index under that owner. In vertical modes there is one rect per line fragment.
- `elements[label]`: every `data-p` element and `#c`.
  - `rects`: `getClientRects()`.
  - `bounding`: `getBoundingClientRect()`.
  - `computed`: display, position, writing-mode, direction, text-orientation, text-combine-upright, font-size, line-height, vertical-align, width, height, inline-size, block-size, and the four margins and paddings.
  - `specified`: the element's inline-style value for writing-mode, -webkit-writing-mode, text-orientation, -webkit-text-orientation, text-combine-upright and -webkit-text-combine, only where the declaration parsed. A missing key means Chrome dropped the declaration.
- `chars[]` (families 5 to 7): one entry per character in document order.
  - `owner`, `ch`, `rects`: the character's Range rects.
  - `lineStart`: the static position `[x, y]` of a 0x0 `position:absolute` inline marker inserted before the character. Its block-axis coordinate is the line's block-start edge: x in vertical and sideways modes, y in horizontal-tb. Its inline coordinate is the marker's inline position, which follows bidi. It is `null` inside a `text-combine-upright` box, where a marker would join the combined text. The script checks that the layout is unchanged after the markers are removed.
- `glyphs[label]` (family 7): `rect` (the first character's Range rect) and `rows`, an n x n grid sampled at cell centres from a full-page screenshot, top to bottom. `#` is dark (R+G+B < 384) and `.` is light.

**Compaction.**
- A DPR entry equal to the `dpr1` entry of the same mode and direction is stored as the string `"=dpr1"`.
- In any other DPR entry, an element whose `computed` and `specified` equal the `dpr1` entry's omits them.
- Arrays of numbers and strings are written on one line.

## What the corpus shows (details and source lines in blink-notes.md)

- **Logical to physical mapping.** Every mode follows WritingModeConverter. `sideways-lr` puts inline-start at the bottom in ltr and at the top in rtl (b1-fixed-children).
- **Fallback inline size.** An orthogonal child of an indefinite-height parent uses min(ICB block-axis size, the parent's fixed height, max-height or min-height, as a content box). Its auto inline size is fit-content in that size, not stretch (o2-*, c8-writing-mode-horizontal-tb under vertical-rl: a 20x20 box).
- **Vertical text advance.** An upright (or mixed CJK) Ahem glyph advances by the integer font height round(0.8·S·N)+round(0.2·S·N) device px, not by 1em. At DPR 1, 17.5px advances 17px and 23.3px advances 24px. A rotated glyph keeps its horizontal advance (t6-upright-size-*, t6-mixed-cjk-size-*, l5-fractional-size).
- **Baselines.** Vertical `mixed` and `upright` use the central baseline, and `sideways` uses alphabetic. Line-over is the right side in both `vertical-rl` and `vertical-lr`, and the left side in `sideways-lr` (l5-baseline-marker*, f3-align-baseline).
- **Glyph rotation.** In `vertical-*` and `sideways-rl`, rotated glyphs turn 90° clockwise. In `sideways-lr` they turn 90° counter-clockwise. Upright glyphs are not rotated (g7-*).
- **`text-orientation` in sideways modes.** It has no effect there: they are horizontal typographic modes (t6-sideways-mode-orientation).
- **`text-combine-upright: all`.**
  - It applies only in `vertical-*`. In `sideways-*` and `horizontal-tb` the text flows normally, although the computed value is `all`.
  - The combined box is 1em in the inline axis and the font height in the block axis.
  - Wider content is scaled to 1.1em, or to 1em under an underline or overline.
  - `digits` and `digits 2` are rejected.
- **Legacy values.** `lr`, `lr-tb`, `rl` and `rl-tb` compute to `horizontal-tb`, and `tb` and `tb-rl` compute to `vertical-rl`. `-webkit-writing-mode` rejects the legacy values and both `sideways-*` values. `text-orientation: sideways-right` computes to `sideways`. `-webkit-text-orientation` rejects `mixed` but accepts `vertical-right`, which computes to `mixed`. `-webkit-text-combine: horizontal` computes to `all`. A row group's or row's own writing-mode is replaced by its parent's.
