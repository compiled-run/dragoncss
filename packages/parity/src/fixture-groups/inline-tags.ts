// Fixture group inline-tags (T133, INL1a-tags): b, strong, em and i (notes/T044-inl-spec.md R7, taken over by
// notes/T056-txt1a-spec.md R7). Their only UA rule is a text font (font-weight: bolder, font-style: italic); native draws them only
// where a real bundled face has that weight and style, so the layout fixture compiles with the reference font map (fonts.ts MAPS) and
// Chrome must draw each listed element's text with the named face. Synthetic styles and Ahem stay refused on native
// (test/inl1a-tags.test.ts, fonts-tags in the web-only lane). Nested tags are text-weight cases (TXT-W1).
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

const INTER = 'Inter-Regular';
const LATO = 'Lato-Regular';

export const INLINE_TAGS: readonly FixtureSpec[] = [
  layout('inline-tags-faces', ['ltr', 'rtl']),
];

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const INLINE_TAGS_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['inline-tags-faces', {
    r1: INTER, b: 'Inter-Bold', r2: INTER, strong: 'Inter-Bold', r3: INTER, em: 'Inter-Italic', r4: INTER, i: 'Inter-Italic',
    bo: 'Inter-BoldItalic', bi: 'Inter-BoldItalic', r5: INTER, r6: LATO, lb: 'Lato-Bold', r7: LATO, ls: 'Lato-Bold', he: 'Inter-BoldItalic',
  }],
]);
