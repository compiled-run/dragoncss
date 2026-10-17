// Fixture group text-style (TXT-W, synthetic oblique on native): font-style and font-synthesis over Ahem, whose one regular face
// Chrome draws sheared by Skia's skewX(-1/4) from a slope of 14deg (italic, bare oblique, oblique 14deg to 90deg, em and i) unless
// font-synthesis-style is none, and upright below it; font-synthesis-weight none keeps bold upright too. Advances never change, so
// every target lays the text out; native shears the glyphs (native-program.ts synthetic-oblique), which text-style-ahem.test proves.
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

export const TEXT_STYLE: readonly FixtureSpec[] = [layout('text-style-ahem', ['ltr', 'rtl'])];
