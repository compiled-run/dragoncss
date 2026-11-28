// Fixture group text-font-variant (TXT-FONTFEAT, css-fonts-4 §6.4-§6.11): the font-variant feature longhands and the font-variant
// shorthand over Ahem, which has no OpenType features, so Chrome draws its glyphs as at normal; the font shorthand resets them (f1).
// Each numeric keyword also stands alone, as authors write it (tabular-nums). Laid out by the engine and compared with Chrome in both
// directions. text-font-variant-caps-ahem is small-caps, which Chrome synthesizes over Ahem: lowercase runs uppercased at the rounded
// 70% size (layout text.ts smallCapsFontSize), at 10px to 20px, through font-variant-caps, font-variant and font, with synthesis off,
// in block, inline, flex-item and min-content contexts; native draws each run at its size, which text-font-variant-caps-ahem.test
// proves against Chrome's pixels. text-synthesis-small-caps-ahem sets font-synthesis-small-caps: auto explicitly (the longhand in any
// case, the font-synthesis shorthand with small-caps alone, with weight and with weight and style, initial, unset and inherit), over
// small capitals and plain text, under a parent that turns synthesis off and over a child that turns it off again, in block,
// min-content and flex-item contexts: auto is the initial value, so Chrome synthesizes exactly as text-font-variant-caps-ahem does.
// The reject is what every target refuses: the other capitals (all-small-caps). text-font-variant-numeric is font-variant-numeric in
// real faces, which the engine shapes with each keyword's OpenType feature (layout shaping.ts numericFeatures): Lato, whose
// default figures are tabular lining, under pnum, onum, frac and ordn; Dragon Sans (Inter), whose default figures are
// proportional, under tnum and zero; every keyword together; the shorthand; a tabular span inside proportional text (its own
// shaping run); flex items at min-content; and plain text beside them. ltr only: an rtl block refuses digits (DRAGON_UNSUPPORTED_BIDI).
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_FONT_VARIANT: readonly FixtureSpec[] = [
  layout('text-font-variant-ahem', ['ltr', 'rtl']),
  layout('text-font-variant-numeric', ['ltr']),
  layout('text-font-variant-caps-ahem', ['ltr', 'rtl']),
  layout('text-synthesis-small-caps-ahem', ['ltr', 'rtl']),
  reject('reject-text-font-variant-caps', 'DRAGON_UNSUPPORTED_VALUE', 'all-small-caps', 'font-variant-caps: all-small-caps is unsupported'),
];

const LATO = 'Lato-Regular';
const INTER = 'Inter-Regular';

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const TEXT_FONT_VARIANT_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['text-font-variant-numeric', { pn: LATO, on: LATO, df: LATO, ord: LATO, all: LATO, sh: LATO, tn: INTER, tz: INTER, mixed: INTER, mixed1: INTER, r1: INTER, r2: INTER, plain: INTER }],
]);
