# Inline probe corpus (INL-P)

Chrome 145.0.7632.6 (Playwright 1.58.2) measurements of inline formatting, for INL1a, INL1b and INL2 to cite. Every case uses Ahem only and is captured at DPR 1, 2, 3 and 2.625, in ltr and rtl (8 environments per case, 162 cases). The Blink source reading that explains each measured rule is in [blink-notes.md](blink-notes.md).

## Running

```text
node --conditions=dragon-internal scripts/capture-inline-probe.ts          # writes probe/<family>.json
node --conditions=dragon-internal scripts/capture-inline-probe.ts --check  # recaptures and exits 1 unless every file is byte-identical
```

The script imports `packages/parity/src/chrome.ts` unchanged: `launchChrome(dpr)` refuses any Chrome other than 145.0.7632.6, and `openPage` injects the harness style (Ahem root font, `direction: rtl` on the root for rtl). Each case is a `<div id="c" style="width:Wpx; ...">` at the top-left of a 400x300 viewport with `body{margin:0}` and `#c{font-size:10px}`.

## Files

| File | Family | Cases |
| --- | --- | --- |
| `probe/family1-mixed-sizes.json` | 1. mixed sizes and line-heights per line (numbers, px, `normal`, strut larger or smaller, empty inline boxes, fractional sizes) | 16 |
| `probe/family2-br.json` | 2. `<br>`: leading, trailing, consecutive, br-only lines, in a span, br with its own font-size and line-height | 11 |
| `probe/family3-breaks.json` | 3. break opportunities at `- ? ! \| / ( ) , . ; : % $ + " { } [ ]` (after letters, before digits, after a space), hyphen before digits, U+200B, inline box boundaries, trailing spaces inside a closing span | 69 |
| `probe/family4-decorations.json` | 4. inline box margin, border and padding: fragments, slicing, lines wider than available, nested boxes, block-axis padding, paint order (screenshot samples) | 10 |
| `probe/family5-atomic.json` | 5. inline-block (text, empty, `overflow: hidden`, block child), inline-flex (row, column, empty, `align-items: baseline`), every `vertical-align` keyword plus `5px`, `-5px`, `50%`, `-50%` on a span and on an inline-block, nested sub/super, `<sub>`/`<sup>`, top/bottom with tall atomics, breaks around U+FFFC, shrink-to-fit widths | 46 |
| `probe/family6-font-size.json` | 6. computed font-size of `small`, `sub`, `sup`, `code`, `larger`, `smaller` under Ahem and `monospace` parents at 10, 16, 17.5, 23.3 px and `medium` | 10 |

## Record format

Each file holds `cases[id] = { note, width, style, html, results }`, and `results["dpr<N>-<dir>"]` holds:

- `container`: the container's border box, `[x, y, width, height]`.
- `lines[]`: one entry per line box, in block order.
  - `top`, `height`: the line box.
  - `text`: the line's content in logical order. `\n` is a `<br>` and U+FFFC is an atomic inline.
  - `baseline`: the baseline, relative to the line top.
  - `baselineParent`: the `data-p` label of the inline box the baseline marker sat in (`root` for the block container).
  - `baselineSkipped`: why no baseline is recorded (`marker moves content`, `marker off the line`), otherwise `null`.
- `leaves[]`: each text node's Range `getClientRects()`, keyed by the nearest `data-p` owner and its index under that owner.
- `elements[label]`: every `data-p` element (inline boxes, `<br>`, atomics, authored markers) and `#c`.
  - `rects`: `getClientRects()`.
  - `bounding`: `getBoundingClientRect()`.
  - `computed`: display, font-family, font-size, line-height, vertical-align, white-space, overflow-x, horizontal margins and padding, vertical padding, the four border widths, width and height.
- `samples` (paint-order cases only): the colour of named points of a full-page screenshot, read at device pixel `floor(css * dpr)`.

Every coordinate is in CSS px, relative to the container's border box.

## Measurement method

- **Line top.** An empty `position:absolute; display:inline` element is inserted, one at a time, in the gap before and after every rendered item (character with a client rect, `<br>`, atomic). An inline-level abspos box's static position is the top of the line it sits on (`inline_layout_algorithm.cc:774-786`). Abspos items add no text, so they add no break opportunity (`inline_items_builder.cc:1306-1310`) and never change layout.
- **Line of each item.**
  - If an item's two gaps agree, the item is on that line.
  - If they disagree, the item is at a line boundary. It goes on the line whose box contains the centre of its first client rect.
  - A space goes on the earliest line its gaps or rect allow, because a soft wrap never starts a line with a space.
  - The capture fails if no line contains the item.
- **Line height.** The next line's top minus this top. For the last line, the container's content height minus this top.
- **Baseline.**
  - A 0x0 `display:inline-block` marker is inserted in a gap inside the line. It has no line box, so its baseline is its bottom margin edge (`logical_box_fragment.cc:52-62`), which sits on the baseline of the inline box it is in.
  - The marker is kept only if every character, `<br>` and atomic rect and the container height are unchanged. Otherwise the line records `baselineSkipped`.
  - Three families of lines are skipped:
    - negative-leading lines, where the marker's zero descent raises the line's negative descent (`font_height.cc:21-24`);
    - overflowing words and shrink-to-fit-min cases, where the marker adds a break opportunity (`line_breaker.cc:1127-1150`);
    - rtl pre-wrap hanging spaces, where the marker falls off the line.
- **Pristine values.** Leaf, element and computed values are read before any marker mutates the DOM.
  - After a DOM mutation, Chrome drops the zero-width `<br>` piece from a span's `getClientRects()` (f2-in-span; see blink-notes.md, open question 1).
  - So the check that the DOM was restored compares characters, `<br>` and atomics, never inline-box rects.
- **Determinism.** Two full runs are byte-identical (`--check`).
- **Scope.** Line texts are identical across all 8 environments for all 162 cases. Only geometry varies with the DPR, because Chrome lays out at device scale.

## Draft fixtures

None are committed. INL1a, INL1b and INL2 take their fixtures from the case HTML recorded in each file (`html`, `style`, `width`).
