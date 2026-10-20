// Fixture group text-line-break (TXT2-lb, css-text-3 §5.3): line-break auto, loose, normal and strict over Ahem, laid out by the
// engine with auto's line breaking and compared with Chrome: the strictness levels differ only around CJK text, so over ASCII letters,
// digits, spaces and . , - / ( ) ! ? : ; Chrome breaks them all as auto, in lines, across an inline box and in min-content. Letters in
// both directions; digits and punctuation left to right (an rtl block takes letters and spaces only). The rejects are what every target
// refuses: line-break: anywhere, and a strictness level over a character no case covers.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_LINE_BREAK: readonly FixtureSpec[] = [
  layout('text-line-break-ahem', ['ltr', 'rtl']),
  layout('text-line-break-punct-ahem'),
  reject('reject-text-line-break-anywhere', 'DRAGON_UNSUPPORTED_VALUE', 'anywhere', 'line-break: anywhere is unsupported'),
  reject('reject-text-line-break-char', 'DRAGON_UNSUPPORTED_VALUE', 'strict', 'line-break: strict on '),
];
