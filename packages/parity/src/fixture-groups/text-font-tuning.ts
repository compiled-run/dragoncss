// Fixture group text-font-tuning (TXT-FONTFEAT, css-fonts-4 §6.3, §6.13, §7.1): font-kerning, font-optical-sizing and
// font-language-override over Ahem, which has no kerning, optical-size axis or language systems, so Chrome draws its glyphs as at the
// initial values; the font shorthand resets them (e1). Laid out by the engine and compared with Chrome in both directions.
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

export const TEXT_FONT_TUNING: readonly FixtureSpec[] = [layout('text-font-tuning-ahem', ['ltr', 'rtl'])];
