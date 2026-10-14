// Fixture group text-spacing (TXT2-b, notes/T149-txt2-spec.md R4 and R5): letter-spacing in px and em, negative and fractional, at
// the fit boundary (65 and 64), on a span inside unspaced text, normal and 0 (which computes to normal), over Ahem and over the
// reference font map's Lato and Dragon Sans (Inter), where nonzero spacing turns liga, clig and calt off (font_features.cc) and keeps
// kerning. A percentage or calculation is refused until the engine's environment pass carries it through the native lowering.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

const LATO = 'Lato-Regular';
const INTER = 'Inter-Regular';

export const TEXT_SPACING: readonly FixtureSpec[] = [
  layout('text-spacing-ahem', ['ltr', 'rtl']),
  layout('text-spacing-lato', ['ltr', 'rtl']),
  reject('reject-text-spacing-percent', 'DRAGON_UNSUPPORTED_VALUE', '10%'),
  reject('reject-text-spacing-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(1px + 0.1em)'),
];

/** data-dragon-id to postScriptName: the face Chrome must draw each listed element's text with, in both documents. */
export const TEXT_SPACING_FACES: ReadonlyMap<string, { readonly [id: string]: string }> = new Map([
  ['text-spacing-lato', { liga: LATO, 'liga-on': LATO, kern: LATO, neg: LATO, wrap: LATO, sans: INTER, mixed: LATO, spaced: LATO }],
]);
