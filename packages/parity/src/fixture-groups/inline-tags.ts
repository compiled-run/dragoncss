// Fixture group inline-tags (T133, INL1a-tags): b, strong, em and i (notes/T044-inl-spec.md R7, taken over by
// notes/T056-txt1a-spec.md R7). Their only UA rule is a text font (font-weight 700, font-style italic); native draws them only where a
// real bundled face has that weight and style, so the layout fixture compiles with the reference font map (fonts.ts MAPS) and Chrome
// must draw each listed element's text with the named face. Synthetic styles and Ahem stay refused on native (test/inl1a-tags.test.ts,
// fonts-tags in the web-only lane). The captured text font holds only under a parent at the initial font-weight and font-style.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

const INTER = 'Inter-Regular';
const LATO = 'Lato-Regular';

export const INLINE_TAGS: readonly FixtureSpec[] = [
  layout('inline-tags-faces', ['ltr', 'rtl']),
  reject('reject-inline-tags-bold-in-heading', 'DRAGON_UNSUPPORTED_ELEMENT', '<strong data-dragon-id="s">XX</strong>', '<strong> s inside <h2> h'),
  reject('reject-inline-tags-italic-in-italic', 'DRAGON_UNSUPPORTED_ELEMENT', '<i data-dragon-id="s">XX</i>', '<i> s inside <em> o'),
];

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const INLINE_TAGS_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['inline-tags-faces', {
    r1: INTER, b: 'Inter-Bold', r2: INTER, strong: 'Inter-Bold', r3: INTER, em: 'Inter-Italic', r4: INTER, i: 'Inter-Italic',
    bo: 'Inter-BoldItalic', bi: 'Inter-BoldItalic', r5: INTER, r6: LATO, lb: 'Lato-Bold', r7: LATO, ls: 'Lato-Bold', he: 'Inter-BoldItalic',
  }],
]);
