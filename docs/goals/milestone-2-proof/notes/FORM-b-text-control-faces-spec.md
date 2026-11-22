# FORM-b: text controls in a bundled web face (proposed 2026-11-22)

Who needs it: the Markless notes form, whose `<input>` and `<textarea>` are in the app's bundled face, "Que Grotesque".

- **Today:** `computed-checks.ts` refuses a text field or textarea natively in any face but Ahem: "Chrome sizes a text control by the face's average character width, which Dragon proves only for Ahem". The engine's `textFieldInlineSize` (and the textarea's `cols` width) uses the advance of 0 (`lengths().zeroWidth`), which equals the average width only in Ahem.
- **Chrome 145's rule** (Blink `HasValidAvgCharWidth` / `AvgCharWidth`; LGPL, reference only; pinned by fixtures):
  - The average character width is the primary face's OS/2 `xAvgCharWidth`, scaled to the font size, when the face has an OS/2 table and the value is above 0.
  - Otherwise it is the advance of '0'.
  - Chrome then uses max(avg, roundf(avg)), and the field's content width is `size` × that, rounded up to a whole px.
  - A textarea is `cols` × the same width, plus Chrome's scrollbar-gutter rule, which #575 already handles.
- **Change:**
  1. **Font data:** `FontData` and `FontLengths` gain the OS/2 `xAvgCharWidth`, with 0 meaning absent. It is read where `capHeight` already reads OS/2: in TS (`fonts/sfnt.ts`, `metrics.ts`), and in the device bridges that build `FontData` from the bundled file (`emit/native-support.ts` `dragonMetricUnits`/`dragonFontData`, for Swift and Kotlin). The shim checks extend to the new field.
  2. **Engine:** `controls.ts` `textFieldInlineSize`, and the textarea's equivalent, take `avgCharWidth` when it is above 0, else `zeroWidth`.
  3. **Compiler:** the Ahem-only refusal is lifted for a bundled static face the font map resolves, which is the same set the engine already lays text out in (TXT1a-2). A system face or a synthesized style stays refused, as for text.
- **Proof:**
  - A Chrome fixture with text fields at several `size` values, at `width: auto`, `min-content` and `max-content`, and textareas at several `cols` values, in two bundled WOFF2 faces whose `xAvgCharWidth` differs from their '0' advance, in both directions. One of the faces should be Lato from `packages/dragon/test/fonts`.
  - A planted fault `avgCharFromZero` that keeps the '0' advance must fail that fixture.
  - Unit tests of the OS/2 read: present, absent, and 0.

## Judge ruling and a Chrome probe (2026-11-22)
- **Judge:** approved with amendments. The Blink rule above is incomplete, and the Judge recalled the corrections from memory, to be confirmed:
  - an `<input>` adds `roundf(maxCharWidth) - avg`;
  - a zero `xAvgCharWidth` falls back to the 'x' advance;
  - validity excludes ascent == descent and a denylist of family names;
  - the work splits into two PRs: font data, then the engine with its fixture.
- **Probe:** Chrome 145 on darwin-arm64, Lato Regular WOFF2 at 16px, padding and border 0.
  - The face: unitsPerEm 2000, OS/2 `xAvgCharWidth` 1108 (8.864 px), head xMin -1093 and xMax 2685 (30.2 px), the 'x' advance 7.97 px, the '0' advance 9.28 px.
  - `<input size=1>` is 16 px, `size=5` is 48 px and `size=20` is 168 px. That is 8 px a character plus 8 px once.
  - `<textarea cols=1>` is 8 px and `cols=10` is 80 px: 8 px a character, with no extra.
  - So the character width is 8 = roundf of the 'x' advance, not the OS/2 value (8.864) and not the '0' advance. The input's extra 8 px equals the font size minus that width.
  - My reading is that on macOS the face's average width comes from the 'x' glyph and its maximum width from something font-size-like, unlike the Windows/OS/2 path. That makes the rule platform-dependent, so a Linux capture may differ.
- **Status:** on hold. Modelling it needs the per-platform rule, captured on both platforms. A cheaper slice is the next proposal: lift the refusal only where no width reads the control's natural size, such as notes' `width: 100%` field in a grid column, where the min-content contribution is compressed and the auto track stretches. Chrome proves that by laying it out identically in faces of different widths.
