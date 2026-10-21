# TXT-FSA: font-size-adjust

The text lane's spec for `font-size-adjust` (css-fonts-5 §2.6) in Chrome 145. Slice A is this package. Slice B is the follow-up that lays text out at an adjusted size.

## Chrome 145

- **Grammar:** `none | [ ex-height | cap-height | ch-width | ic-width | ic-height ]? [ from-font | <number [0,∞]> ]`. The property is inherited, its initial value is `none`, and the font shorthand resets it to `none`.
- **Effect:** any value but `none` scales the font size used to lay out and draw text. The chosen metric of the first available face becomes the given number times the computed size (Blink `FontBuilder::UpdateAdjustedSize`). These stay unadjusted:
  - The computed `font-size`, and so `em` units.
  - `getComputedStyle().fontSize`.
  - `line-height: <number>`, which multiplies the computed size.
- **What reads the adjusted size:** `line-height: normal`, `ex` and `ch` (font metrics of the adjusted face), glyph advances, and decoration thickness.

## Slice A (this package): `none` only

- `font-size-adjust` is a registered longhand (`css/properties/font-size-adjust.ts`): inherited, layout aspect, `UNADMITTED` for animation, and in the grammar subset.
- The font shorthand resets it to `none`. The `sizeAdjustNotReset` plant is caught by `font-shorthand.test.ts` against a parent with `font-size-adjust: 0.5`. `FONT_RESET_LONGHANDS` is now empty.
- **Accepted:** `none` in any ASCII case, and the CSS-wide keywords. Everything resolves to `none`, so layout, native output and paint are unchanged.
- **Refused:** every other value Chrome parses, with `DRAGON_UNSUPPORTED_VALUE` at parse time on every target. That covers a number, `from-font`, either one after a metric keyword, and a calculation (math grammar `number`).
- **Invalid:** what Chrome drops, with `DRAGON_CSS_INVALID_VALUE`.
- **Web output:** never writes it, like `-webkit-user-modify`: the only accepted value is the initial one, and no Chrome UA rule sets it. So the emitted CSS does not change.
- **Proof against Chrome 145:**
  - `test/text-font-size-adjust.test.ts`, against a live capture:
    - `text-font-size-adjust-ahem` passes chrome-dual and linux-dragon-layout in ltr and rtl.
    - The derived rows allow `font-size-adjust:none` in text-in-block on every target.
    - Every box computes `none` and lays out as its twin without the declaration.
  - `test/font-size-adjust-parse.test.ts`: the validity matrix, with plants.
  - Reject fixture `reject-text-font-size-adjust-number`.

## Migration (docs/decisions.md, "Adding engine fields and CSS longhands")

- **Captures:** they gain `"font-size-adjust": "none"` on every node. The additive-only check is the existing pins:
  - `text-weight.test.ts` ADDED_KEYS and `font-shorthand.test.ts` ADDED (via `FONT_SIZE_ADJUST_LONGHANDS`);
  - the hit identity strip (`hit-capture.ts` TEXT_SINCE_BASE: `font-size-adjust: none`).
- **Engine:** there is no engine field and no vector change.
- **Emitted CSS:** there is no change, because the declaration is never written.
- **Regen must produce:**
  - the UA datasets (`ua:capture`), which gain `font-size-adjust: none` per tag, until when `ua.test.ts` fails;
  - the captures for every fixture (the key above);
  - the profile rows for `font-size-adjust:none`, until when enforced profiles refuse an authored `none`;
  - the expected outputs of `text-font-size-adjust-ahem` and its rtl case.

## Slice B (follow-up, not built)

A number over Ahem, where the x-height and cap-height are 0.8em, so `0.4` lays out at half the computed size. It needs:

- An engine input field on `FontSpec`, for example `sizeAdjust: number | null`, required and `null` when unused. That means a vector migration by the generators, with its own checker.
- The environment pass deriving the adjusted size after zoom and text scale, ported from Blink's `UpdateAdjustedSize` (including the minimum font size).
- `line-height: normal`, `ex` and `ch` from the adjusted face, while `em` and `line-height: <number>` stay on the computed size.
- Native lowering at the adjusted size, and refusals for paint consumers that read `font-size` (text-shadow, decoration thickness, stroke) until each reads the adjusted size.
