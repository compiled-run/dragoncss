// Fixture group white-space (TXT2-c, notes/T149-txt2-spec.md R3): white-space pre, pre-wrap, pre-line and break-spaces
// (white-space-collapse preserve, preserve-breaks and break-spaces), laid out by the engine and compared with Chrome: preserved
// line feeds as forced breaks with their own empty fragment, pre-wrap spaces that hang at a soft wrap (or at a forced break where
// the line would not fit with them) as a fragment of their own, the break opportunity and fragment after a paragraph's leading
// preserved spaces, break-spaces' opportunity after every space, and max-content counting trailing preserved spaces. Ahem and Lato,
// left to right only: Chrome splits preserved spaces and line feeds at the paragraph level in rtl (UAX #9 L1), which is refused.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const WHITE_SPACE: readonly FixtureSpec[] = [
  layout('white-space-preserve'),
  layout('white-space-wrap'),
  layout('white-space-lato'),
  reject('reject-white-space-control', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="a" class="a">XX&#12;XX</div>', 'U+000C in '),
  reject('reject-white-space-rtl', 'DRAGON_UNSUPPORTED_BIDI', 'XX  XX', null),
];

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const WHITE_SPACE_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['white-space-lato', { a: 'Lato-Regular', b: 'Lato-Regular', c: 'Lato-Regular', d: 'Lato-Regular' }],
]);
