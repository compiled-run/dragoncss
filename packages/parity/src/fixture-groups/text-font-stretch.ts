// Fixture group text-font-stretch (TXT-FONTFEAT, css-fonts-4 §2.4): font-stretch in Ahem, both directions: width keywords at both
// ends, percentages (0% included), inherited by a child, set by the font shorthand's width keyword and reset by a font shorthand
// without one, and on a flex row. Ahem is one face at 100% and Chrome synthesizes no width, so every target lays the text out; a
// width over a real face is refused (packages/dragon/test/font-stretch.test.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

export const TEXT_FONT_STRETCH: readonly FixtureSpec[] = [
  layout('text-font-stretch-ahem', ['ltr', 'rtl']),
];
