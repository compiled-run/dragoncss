// Fixture group text-transform (TXT2-e, notes/T149-txt2-spec.md R7): none, uppercase, lowercase and capitalize, folded into the
// text at build time, in blocks, flex items, anonymous flex items and inline boxes, with the previous character carried across
// text nodes. Ahem only, so every transformed string is printable ASCII without the apostrophe (the engine's Ahem glyphs):
// text-transform-text holds ß, whose uppercase SS breaks the line where groß does not, and punctuation, so it runs left-to-right
// only; text-transform-keywords is letters and spaces and runs both ways. The rejects are math-auto (refused until
// TXT2-e2) and full-width, which Chrome 145 does not parse.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_TRANSFORM: readonly FixtureSpec[] = [
  layout('text-transform-keywords', ['ltr', 'rtl']),
  layout('text-transform-text', ['ltr']),
  reject('reject-text-transform-math-auto', 'DRAGON_UNSUPPORTED_VALUE', 'math-auto', 'text-transform: math-auto is unsupported until TXT2-e2'),
  reject('reject-text-transform-full-width', 'DRAGON_CSS_INVALID_VALUE', 'uppercase full-width', '"uppercase full-width" is not a valid value for text-transform'),
];
