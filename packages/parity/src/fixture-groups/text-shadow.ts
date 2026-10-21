// Fixture group text-shadow (TXT-FX): text-shadow: none in Ahem, both directions, on a block, inherited by a child, in another ASCII
// case and on a flex row, so every target proves none. text-shadow-blur: blurred and unblurred shadows on single lines of 40px Ahem
// (the coverage-rank probe 0 1px 2px rgba(0, 0, 0, 0.5) among them), one and two shadows, offsets, inherited, over an ancestor's
// background and on a nowrap line, both directions; iOS and Android draw them (paint-samples/text-shadow.ts, the text-shadow
// points; packages/parity/test/text-shadow-native.test.ts). text-shadow-wrap: the same kinds of shadow on Ahem text that wraps onto
// two to four lines, far enough apart (line-height 40px and 1.6) that no line's shadow reaches the line above, one over an
// ancestor's background, both directions; iOS and Android draw each line's shadow beneath the text (packages/parity/test/
// text-shadow-wrap.test.ts). The reject: a shadow length in em, which no target takes.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_SHADOW: readonly FixtureSpec[] = [
  layout('text-shadow-none', ['ltr', 'rtl']),
  layout('text-shadow-blur', ['ltr', 'rtl']),
  layout('text-shadow-wrap', ['ltr', 'rtl']),
  reject('reject-text-shadow-list', 'DRAGON_UNSUPPORTED_VALUE', '0 1px 0.2em rgba(0, 0, 0, 0.5)', 'text-shadow: rgba(0, 0, 0, 0.5) 0px 1px 0.2em'),
];
