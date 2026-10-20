// Fixture group text-word-break (TXT2-d, notes/T149-txt2-spec.md R15): word-break break-all and keep-all over Ahem, laid out by the
// engine and compared with Chrome. break-all breaks between any two ASCII letters or digits on top of the spaces (in a line, across
// an inline box, and in min-content, where a flex item shrinks to one glyph); nowrap keeps it whole; keep-all is normal outside CJK,
// including at hyphens, solidi and full stops. Letters in both directions; digits and punctuation left to right (an rtl block takes
// letters and spaces only). The reject is what every target refuses: word-break: auto-phrase.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_WORD_BREAK: readonly FixtureSpec[] = [
  layout('text-word-break-ahem', ['ltr', 'rtl']),
  layout('text-word-break-digits-ahem'),
  reject('reject-text-word-break-auto-phrase', 'DRAGON_UNSUPPORTED_VALUE', 'auto-phrase'),
];
