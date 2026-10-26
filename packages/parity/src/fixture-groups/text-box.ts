// Fixture group text-box (css-inline-3 §5.1-§5.2): text-box-trim on a block of Ahem text and inline boxes, at the start, the end
// and both, with text-box-edge text and text alphabetic (own, from the shorthand, and inherited), line heights above and below the
// glyphs, padding and borders, an inline box taller than the strut, a <br>, centred text, and the no-op text-box: normal, laid out
// by the engine and compared with Chrome in both directions. The rejects are what native targets refuse: a trim that reaches a
// nested block, a cap over edge (which Ahem cannot tell from text), and a trimmed flex item.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_BOX: readonly FixtureSpec[] = [
  layout('text-box-ahem', ['ltr', 'rtl']),
  reject('reject-text-box-nested', 'DRAGON_UNSUPPORTED_VALUE', 'trim-both', 'text-box-trim: trim-both on <div> d '),
  reject('reject-text-box-cap', 'DRAGON_UNSUPPORTED_VALUE', 'trim-both cap alphabetic', 'text-box-trim: trim-both on <div> d '),
  reject('reject-text-box-flex-item', 'DRAGON_UNSUPPORTED_VALUE', 'trim-start', 'text-box-trim: trim-start on <div> d '),
];
