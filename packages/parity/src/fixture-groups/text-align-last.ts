// Fixture group text-align-last (TXT2-tal, css-text-3 §7.2): text-align-last values that put a block's last line, and each line before
// a forced break, where text-align-last: auto does (start in a justified block, the text-align side otherwise, inherited through a
// nested block and an inline box), laid out by the engine and compared with Chrome in both directions. The rejects are what every target
// refuses: a last line justified in a left-aligned block; a centred last line that holds only an atomic inline (Chrome centres the
// box at 17.5px, the engine puts it at 0); and a block's right last line under an inline box whose own text-align-last is center,
// which Chrome ignores (it puts XX at 25px, the engine at 0).
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_ALIGN_LAST: readonly FixtureSpec[] = [
  layout('text-align-last-ahem', ['ltr', 'rtl']),
  reject('reject-text-align-last-justify', 'DRAGON_UNSUPPORTED_VALUE', 'justify', 'text-align-last: justify on '),
  reject('reject-text-align-last-atomic', 'DRAGON_UNSUPPORTED_VALUE', 'center', 'text-align-last: center on d,'),
  reject('reject-text-align-last-inline', 'DRAGON_UNSUPPORTED_VALUE', 'right', 'text-align-last: right on d,'),
];
