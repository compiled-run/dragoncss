// Fixture group text-font-variant (TXT-FONTFEAT, css-fonts-4 §6.4-§6.11): the font-variant feature longhands and the font-variant
// shorthand over Ahem, which has no OpenType features, so Chrome draws its glyphs as at normal; the font shorthand resets them (f1).
// Each numeric keyword also stands alone, as authors write it (tabular-nums). Laid out by the engine and compared with Chrome in both
// directions. text-font-variant-caps-ahem is small-caps, which Chrome synthesizes over Ahem: lowercase runs uppercased at the rounded
// 70% size (layout text.ts smallCapsFontSize), at 10px to 20px, through font-variant-caps, font-variant and font, with synthesis off,
// in block, inline, flex-item and min-content contexts; native draws each run at its size, which text-font-variant-caps-ahem.test
// proves against Chrome's pixels. The reject is what every target refuses: the other capitals (all-small-caps).
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_FONT_VARIANT: readonly FixtureSpec[] = [
  layout('text-font-variant-ahem', ['ltr', 'rtl']),
  layout('text-font-variant-caps-ahem', ['ltr', 'rtl']),
  reject('reject-text-font-variant-caps', 'DRAGON_UNSUPPORTED_VALUE', 'all-small-caps', 'font-variant-caps: all-small-caps is unsupported'),
];
