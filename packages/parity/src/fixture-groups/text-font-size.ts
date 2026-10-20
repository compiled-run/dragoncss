// Fixture group text-font-size (css-fonts-4 §2.5): font-size percentages of the parent's size and the <absolute-size> keywords at
// Chrome's table, in blocks, inline boxes and the font shorthand, under a px size and under a keyword, laid out by the engine and
// compared with Chrome in both directions. The reject is what every target refuses: a percentage under a keyword size that falls
// below Chrome's minimum logical font size, which Chrome clamps. CALC-2: text-font-size-calc-ahem holds calc(), min(), max() and
// clamp() in font-size (em and % of the parent's size, rem of the root's) and line-height (of the element's own size, and a number
// calculation that inherits as a number), which the compiler folds to px.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_FONT_SIZE: readonly FixtureSpec[] = [
  layout('text-font-size-values-ahem', ['ltr', 'rtl']),
  layout('text-font-size-calc-ahem', ['ltr', 'rtl']),
  reject('reject-text-font-size-minimum', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="q" class="q">XX</div>', 'font-size: 5px on <div> q is below'),
];
