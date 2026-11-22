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
