// Fixture group text-latin (TXT1a-1, notes/T056-txt1a-spec.md §3, amended by notes/T083-txt1a-1.md): real-font Latin text laid
// out by the engine and compared with Chrome. The registry TEXT_LATIN_FIXTURES is kept out of FIXTURES (the T038 ruling 10
// pattern): native targets keep refusing every face but Ahem until TXT1a-2, so these cases run the engine lane on the engine
// projection (engineLayoutProjection) and chrome-dual (text-latin-run.ts), never a native lane. Each compiles with the reference
// font map (Dragon Sans, Dragon Mono and Lato pinned) at 400x300; weights and styles come from the UA (h1 to h3 bold, address
// italic). Fixtures whose text is only letters and spaces also run right-to-left (the inline core's bidi limit).
import type { FixtureSpec } from '../fixtures.ts';
import type { FontFixture } from './fonts.ts';
import { FONT_REFERENCE_MAP } from '../font-reference.ts';
import { layout } from './define.ts';

/** The group's FIXTURES entries: none, since the registry stays out of FIXTURES until TXT1a-2 moves its cases in. */
export const TEXT_LATIN: readonly FixtureSpec[] = [];

/** A text-latin fixture: the fonts-fixture shape (its map and the face Chrome must draw each element's text with). */
export type TextLatinFixture = FontFixture;

const fixture = (id: string, directions: readonly ('ltr' | 'rtl')[], faces: TextLatinFixture['faces']): TextLatinFixture => ({ spec: layout(id, directions, 'ahem'), map: FONT_REFERENCE_MAP, faces });

const LATO = 'Lato-Regular';
const INTER = 'Inter-Regular';

export const TEXT_LATIN_FIXTURES: readonly TextLatinFixture[] = [
  fixture('text-latin-lato', ['ltr'], { prose: LATO, kern: LATO, small: LATO, label: LATO, title: LATO, big: LATO, sum: LATO }),
  fixture('text-latin-punct', ['ltr'], { punct: LATO, hyphen: LATO, shy: LATO, nbsp: LATO, numbers: LATO }),
  fixture('text-latin-faces', ['ltr'], {
    sans: INTER, 'sans-bold': 'Inter-Bold', 'sans-italic': 'Inter-Italic', 'sans-bold-italic': 'Inter-BoldItalic', 'lato-bold': 'Lato-Bold',
    mono: 'NotoSansMono-Regular', 'mixed-a': INTER, 'mixed-lato': LATO, 'mixed-b': INTER, 'mixed-mono': 'NotoSansMono-Regular', 'mixed-c': INTER,
    'mixed-d': INTER, 'mixed-lead': INTER, 'mixed-e': INTER,
  }),
  fixture('text-latin-flex', ['ltr'], { 'row-a': LATO, 'row-b': LATO, 'col-a': LATO, 'col-b': LATO }),
  fixture('text-latin-words', ['ltr', 'rtl'], { a: LATO, b: LATO, c: INTER, d: LATO, e: LATO }),
  fixture('text-latin-metrics', ['ltr'], { r1: LATO, r2: LATO, r3: INTER, r4: INTER }),
];

/**
 * Fixture files only the text-latin tests compile, never a lane: a Lato case with an error that is not a font refusal (the guard
 * refuses it), Lato in a UA italic (synthetic oblique) and a face the test swaps for a variable font (engine mode refuses both).
 */
export const TEXT_LATIN_PROBES: readonly string[] = ['text-latin-negative', 'text-latin-synthetic', 'text-latin-variable'];
