// Fixture group text-break (TXT2-a, notes/T149-txt2-spec.md §0): overflow-wrap anywhere and break-word, word-break: break-word and the
// word-wrap alias, laid out by the engine and compared with Chrome. An overflowing word breaks at grapheme clusters only when no
// earlier opportunity fits (Blink's break_anywhere_if_overflow), its trailing space stays on its line, nowrap keeps it whole, and
// in min-content (flex items) anywhere and word-break: break-word break at every cluster while break-word does not. Ahem in both
// directions, Lato left to right. text-break-all-ahem, -letters and -lato (TXT-BREAK-2) lay out word-break: break-all, which breaks
// between letters by Chrome's pair table, and keep-all, which breaks as normal over the Latin set. The rejects are what every target
// refuses: word-break: break-all over a character outside the Latin set (TXT-BREAK-2), breaking preserved white space, and two
// overflow-wrap values in one inline formatting context.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_BREAK: readonly FixtureSpec[] = [
  layout('text-break-ahem', ['ltr', 'rtl']),
  layout('text-break-lato'),
  layout('text-break-all-ahem'),
  layout('text-break-all-letters', ['ltr', 'rtl']),
  layout('text-break-all-lato'),
  reject('reject-text-break-all', 'DRAGON_UNSUPPORTED_VALUE', 'break-all', 'word-break: break-all on '),
  reject('reject-text-break-preserved', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="d" class="a">XXXXXXXXXX  XX</div>', 'overflow-wrap: break-word on '),
  reject('reject-text-break-mixed', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="d" class="a">XX <span data-dragon-id="s" class="s">XXXXXXXX</span></div>', 'overflow-wrap: normal; word-break: normal ('),
];

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const TEXT_BREAK_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['text-break-lato', { a: 'Lato-Regular', b: 'Lato-Regular', c: 'Lato-Regular', d: 'Lato-Regular', e: 'Lato-Regular', e1: 'Lato-Regular', r1: 'Lato-Regular', r2: 'Lato-Regular' }],
  ['text-break-all-lato', { a: 'Lato-Regular', b: 'Lato-Regular', c: 'Lato-Regular', d: 'Lato-Regular', r1: 'Lato-Regular', r2: 'Lato-Regular' }],
]);
