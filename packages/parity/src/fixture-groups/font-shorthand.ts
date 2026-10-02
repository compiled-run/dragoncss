// Fixture group font-shorthand (TXT-W2, T147 part 2, notes/T147J-txt-weight.md): the font shorthand (style, weight, size, line
// height and family, with font: inherit) and font-synthesis over the reference font map's real faces. With font-synthesis off,
// Chrome draws the base face unsynthesized, so native lays it out. The rejects are values Dragon refuses or Chrome does not parse.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

const INTER = 'Inter-Regular';
const LATO = 'Lato-Regular';
const MONO = 'NotoSansMono-Regular';

export const FONT_SHORTHAND: readonly FixtureSpec[] = [
  layout('font-shorthand-faces', ['ltr', 'rtl']),
  layout('font-shorthand-synthesis', ['ltr', 'rtl']),
  reject('reject-font-shorthand-small-caps', 'DRAGON_UNSUPPORTED_VALUE', 'small-caps', 'font: small-caps sets font-variant-caps'),
  reject('reject-font-shorthand-stretch', 'DRAGON_UNSUPPORTED_VALUE', 'condensed', 'font: condensed sets font-stretch'),
  reject('reject-font-shorthand-system', 'DRAGON_UNSUPPORTED_VALUE', 'caption', 'font: caption is a system font'),
  reject('reject-font-shorthand-left', 'DRAGON_CSS_INVALID_VALUE', 'left', 'Chrome 145 does not parse font-style: left in the font shorthand'),
  reject('reject-font-shorthand-synthesis-position', 'DRAGON_CSS_INVALID_VALUE', 'position', 'Chrome 145 does not parse font-synthesis: position'),
  reject('reject-font-shorthand-oblique-only', 'DRAGON_CSS_INVALID_VALUE', 'oblique-only', '"oblique-only" is not a valid value for font-synthesis-style: Chrome 145 does not parse'),
];

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const FONT_SHORTHAND_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['font-shorthand-faces', { a: INTER, b: 'Inter-BoldItalic', c: 'Lato-Bold', d: 'Inter-Light', e: 'Inter-BoldItalic', f: 'Lato-Bold', g: INTER, h: LATO, i: 'Inter-Bold', j: INTER }],
  ['font-shorthand-synthesis', { a: LATO, b: LATO, c: MONO, d: MONO, e: MONO, g: LATO, h: LATO }],
]);
