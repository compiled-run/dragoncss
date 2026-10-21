// Fixture group text-font-size (css-fonts-4 §2.5): font-size percentages of the parent's size and the <absolute-size> keywords at
// Chrome's table, in blocks, inline boxes and the font shorthand, under a px size and under a keyword, laid out by the engine and
// compared with Chrome in both directions. The reject is what every target refuses: a percentage under a keyword size that falls
// below Chrome's minimum logical font size, which Chrome clamps. CALC-2: text-font-size-calc-ahem holds calc(), min(), max() and
// clamp() in font-size (em and % of the parent's size, rem of the root's) and line-height (of the element's own size, and a number
// calculation that inherits as a number), which the compiler folds to px. text-font-size-vw-ahem holds font sizes that follow the
// viewport (vw, vh and vmin, alone and in calc(), min(), max() and clamp() with em, % and rem), with em margins and padding and %,
// em, calculated and number line heights beneath them, which the engine resolves. text-font-size-vw-boxes holds the same sizes
// on em-sized boxes without text, so its resize script (media-runtime.ts) proves them as the viewport changes.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_FONT_SIZE: readonly FixtureSpec[] = [
  layout('text-font-size-values-ahem', ['ltr', 'rtl']),
  layout('text-font-size-calc-ahem', ['ltr', 'rtl']),
  layout('text-font-size-vw-ahem', ['ltr', 'rtl']),
  layout('text-font-size-vw-boxes', ['ltr', 'rtl']),
  reject('reject-text-font-size-minimum', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="q" class="q">XX</div>', 'font-size: 5px on <div> q is below'),
];
