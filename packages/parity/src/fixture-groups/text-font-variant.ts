// Fixture group text-font-variant (TXT-FONTFEAT, css-fonts-4 §6.4-§6.11): the font-variant feature longhands and the font-variant
// shorthand over Ahem, which has no OpenType features, so Chrome draws its glyphs as at normal; the font shorthand resets them (f1).
// Each numeric keyword also stands alone, as authors write it (tabular-nums). Laid out by the engine and compared with Chrome in both
// directions. The reject is what every target refuses: small capitals.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_FONT_VARIANT: readonly FixtureSpec[] = [
  layout('text-font-variant-ahem', ['ltr', 'rtl']),
  reject('reject-text-font-variant-caps', 'DRAGON_UNSUPPORTED_VALUE', 'small-caps', 'font-variant-caps: small-caps is unsupported'),
];
