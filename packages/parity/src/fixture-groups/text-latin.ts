// Fixture group text-latin (TXT1a, notes/T056-txt1a-spec.md §3, amended by notes/T083-txt1a-1.md and notes/T084-txt1a-2.md):
// real-font Latin text, laid out by the engine and the native targets and compared with Chrome. Each compiles with the reference
// font map (Dragon Sans, Dragon Mono and Lato pinned, fonts.ts MAPS) at 400x300; weights and styles come from the UA (h1 to h3 bold,
// address italic). Fixtures whose text is only letters and spaces also run right-to-left (the inline core's bidi limit). Chrome must
// draw each listed element's text with the named face (TEXT_LATIN_FACES, checked in pipeline.ts runFixture).
// text-ahem-fractional holds Ahem runs at the six fractional sizes where float accumulation misses Chrome by 1 LU (notes/T082).
import type { FixtureSpec } from '../fixtures.ts';
import { layout } from './define.ts';

const LATO = 'Lato-Regular';
const INTER = 'Inter-Regular';

export const TEXT_LATIN: readonly FixtureSpec[] = [
  layout('text-latin-lato', ['ltr']),
  layout('text-latin-punct', ['ltr']),
  layout('text-latin-faces', ['ltr']),
  layout('text-latin-flex', ['ltr']),
  layout('text-latin-words', ['ltr', 'rtl']),
  layout('text-latin-metrics', ['ltr']),
  layout('text-ahem-fractional', ['ltr']),
];

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const TEXT_LATIN_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['text-latin-lato', { prose: LATO, kern: LATO, small: LATO, label: LATO, title: LATO, big: LATO, sum: LATO }],
  ['text-latin-punct', { punct: LATO, hyphen: LATO, shy: LATO, nbsp: LATO, numbers: LATO }],
  ['text-latin-faces', {
    sans: INTER, 'sans-bold': 'Inter-Bold', 'sans-italic': 'Inter-Italic', 'sans-bold-italic': 'Inter-BoldItalic', 'lato-bold': 'Lato-Bold',
    mono: 'NotoSansMono-Regular', 'mixed-a': INTER, 'mixed-lato': LATO, 'mixed-b': INTER, 'mixed-mono': 'NotoSansMono-Regular', 'mixed-c': INTER,
    'mixed-d': INTER, 'mixed-lead': INTER, 'mixed-e': INTER,
  }],
  ['text-latin-flex', { 'row-a': LATO, 'row-b': LATO, 'col-a': LATO, 'col-b': LATO }],
  ['text-latin-words', { a: LATO, b: LATO, c: INTER, d: LATO, e: LATO }],
  ['text-latin-metrics', { r1: LATO, r2: LATO, r3: INTER, r4: INTER }],
]);

/**
 * Fixture files only the text-latin tests compile, never a lane: a Lato case with an error that is not a font refusal, Lato in a UA
 * italic (synthetic oblique) and a face the test swaps for a variable font (native and engine mode refuse both).
 */
export const TEXT_LATIN_PROBES: readonly string[] = ['text-latin-negative', 'text-latin-synthetic', 'text-latin-variable'];
