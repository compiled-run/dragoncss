// Fixture group text-font-features (TXT-FONTFEAT, css-fonts-4 §6.12 and §7.2): font-feature-settings and font-variation-settings
// in Ahem, both directions: one feature, a list with on, off and integers, a variation axis inherited by a child, both at once,
// the font shorthand resetting a setting, and a flex row. Ahem has no OpenType features or axes, so Chrome draws the same glyphs
// and every target lays the text out; a setting over a real face is refused (packages/dragon/test/font-features.test.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

export const TEXT_FONT_FEATURES: readonly FixtureSpec[] = [
  layout('text-font-features-ahem', ['ltr', 'rtl']),
];
