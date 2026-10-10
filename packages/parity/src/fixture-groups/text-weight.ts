// Fixture group text-weight (TXT-W1, T147 part 1, notes/T147J-txt-weight.md): font-weight and font-style over the reference font
// map's real faces, Dragon Sans (Inter 300, 400, 700, italic and bold italic) and Lato (400, 700), reached through numbers, keywords,
// bolder and lighter across every band edge, html.css's bold, bolder and italic (nesting included), and oblique angles. None is
// synthesized, so native lays every case out; Chrome must draw each listed element's text with the named face. Synthesized text is
// in the web-only lane (fonts-weight-synthetic, fonts.ts); the rejects are values every target refuses.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

const LIGHT = 'Inter-Light';
const REGULAR = 'Inter-Regular';
const BOLD = 'Inter-Bold';
const ITALIC = 'Inter-Italic';
const BOLD_ITALIC = 'Inter-BoldItalic';
const LATO = 'Lato-Regular';
const LATO_BOLD = 'Lato-Bold';

export const TEXT_WEIGHT: readonly FixtureSpec[] = [
  layout('text-weight-numeric', ['ltr', 'rtl']),
  layout('text-weight-relative', ['ltr', 'rtl']),
  layout('text-weight-styles', ['ltr', 'rtl']),
  layout('text-weight-nested-bold', ['ltr', 'rtl']),
  layout('text-weight-nested-italic', ['ltr', 'rtl']),
  // The text contexts the north star's h3 and h4 font-weight sits in: flex items, anonymous flex items and inline boxes.
  layout('text-weight-contexts', ['ltr', 'rtl']),
  reject('reject-text-weight-style-left', 'DRAGON_CSS_INVALID_VALUE', 'left', '"left" is not a valid value for font-style: Chrome 145 does not parse font-style: left'),
  reject('reject-text-weight-zero', 'DRAGON_CSS_INVALID_VALUE', '0', '"0" is not a valid value for font-weight'),
  reject('reject-text-weight-oblique-range', 'DRAGON_CSS_INVALID_VALUE', 'oblique 91deg', '"oblique 91deg" is not a valid value for font-style: Chrome parses an oblique angle only when its number is in [-90, 90]'),
  reject('reject-text-weight-oblique-turn', 'DRAGON_UNSUPPORTED_VALUE', '2turn', 'font-style: the oblique angle 2turn is 720deg, beyond 90deg'),
  reject('reject-text-weight-oblique-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(10deg + 5deg)', 'font-style: the oblique angle calc(10deg + 5deg) is a calculation'),
];

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const TEXT_WEIGHT_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['text-weight-numeric', {
    w1: LIGHT, w100: LIGHT, w250: LIGHT, w300: LIGHT, w350: LIGHT, w400: REGULAR, w450: REGULAR, w500: REGULAR, w550: BOLD, w599: BOLD, w600: BOLD, w800: BOLD, w1000: BOLD,
    kni: REGULAR, kin: REGULAR, kb: BOLD, l100: LATO, l599: LATO_BOLD, l1000: LATO_BOLD,
  }],
  ['text-weight-relative', {
    a1u: REGULAR, a1d: LIGHT, a99d: LIGHT, a100d: LIGHT, a349u: REGULAR, a349d: LIGHT, a350u: BOLD, a549u: BOLD, a549d: LIGHT, a550u: BOLD, a550d: REGULAR,
    a749d: REGULAR, a750d: BOLD, a900u: BOLD, a900d: BOLD, a1000u: BOLD, a1000i: BOLD, ccc: BOLD,
  }],
  ['text-weight-styles', {
    it: ITALIC, ob: ITALIC, o14: ITALIC, o20: ITALIC, o10: REGULAR, on20: REGULAR, o0: REGULAR, orad: ITALIC, ograd: ITALIC, oturn: ITALIC,
    bi: BOLD_ITALIC, li: ITALIC, nni: REGULAR, lo: LATO, lbn: LATO_BOLD,
  }],
  ['text-weight-nested-bold', { s: BOLD, bb: BOLD, lb: REGULAR, mb: BOLD, h1b: BOLD }],
  ['text-weight-nested-italic', { s: ITALIC, ae: ITALIC, he: BOLD_ITALIC }],
  ['text-weight-contexts', { ra: REGULAR, rb: BOLD_ITALIC, ch: REGULAR, cb: ITALIC, arow: BOLD, arb: BOLD, acol: ITALIC, acb: ITALIC, pa: LIGHT, pb: BOLD }],
]);
