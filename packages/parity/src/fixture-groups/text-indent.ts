// Fixture group text-indent (TXT2-h, notes/T149-txt2-spec.md R12): text-indent on the first formatted line of a block container,
// in both directions. Ahem: px, negative, a percentage of the width, em, a calculation, no indent after a <br>, text-align center
// and end, an inline box on the first line, the -9999px hiding idiom, a block child that inherits it, and shrink-to-fit boxes (an
// inline-block with a length and with a percentage, which counts as 0 in its intrinsic size; min-content; a flex item). Real-font
// Latin paragraphs in the reference sans-serif. The rejects: hanging and each-line (invalid in Chrome 145), and the combinations
// no Chrome case proves yet (justify, text in anonymous blocks).
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_INDENT: readonly FixtureSpec[] = [
  layout('text-indent-ahem', ['ltr', 'rtl']),
  layout('text-indent-latin', ['ltr', 'rtl']),
  reject('reject-text-indent-hanging', 'DRAGON_CSS_INVALID_VALUE', '2em hanging'),
  reject('reject-text-indent-each-line', 'DRAGON_CSS_INVALID_VALUE', '2em each-line'),
  reject('reject-text-indent-justify', 'DRAGON_UNSUPPORTED_VALUE', '20px', 'text-indent: 20px on'),
  reject('reject-text-indent-anonymous', 'DRAGON_UNSUPPORTED_VALUE', '20px', 'text-indent: 20px on'),
];
