// font-size-adjust (css-fonts-5 §2.6): none | [ ex-height | cap-height | ch-width | ic-width | ic-height ]? [ from-font |
// <number [0,∞]> ], inherited, initial none, reset by the font shorthand. Any value but none scales the used font size so the
// chosen metric of the first available face is that number times the computed size (Blink FontBuilder::UpdateAdjustedSize); the
// computed font-size, and so em, is unchanged. Dragon accepts none only (TXT-FSA, docs/research/font-size-adjust.md): the engine
// lays out each text run at its computed size and has no adjusted size, so every other value Chrome parses is refused with
// DRAGON_UNSUPPORTED_VALUE, and what Chrome drops (a negative number, two numbers) is invalid, as the grammar says.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const FONT_SIZE_ADJUST_LONGHANDS = ['font-size-adjust'] as const;
export const FONT_SIZE_ADJUST_SHORTHANDS = [] as const;
export const FONT_SIZE_ADJUST_INHERITED: readonly (typeof FONT_SIZE_ADJUST_LONGHANDS)[number][] = ['font-size-adjust'];
export const FONT_SIZE_ADJUST_CONTAINER: readonly (typeof FONT_SIZE_ADJUST_LONGHANDS)[number][] = [];
export const FONT_SIZE_ADJUST_TEXT_ROLE: readonly (typeof FONT_SIZE_ADJUST_LONGHANDS)[number][] = ['font-size-adjust'];

export const FONT_SIZE_ADJUST_ASPECTS: { readonly [P in (typeof FONT_SIZE_ADJUST_LONGHANDS)[number]]: PropertyAspect } = {
  'font-size-adjust': { layout: true, paint: false },
};

/** font-size-adjust as Chrome 145 parses it, after the grammar: none is accepted, and every other value Chrome keeps is refused. */
export function parseFontSizeAdjust(tokens: readonly CssNode[], base: Span): ParsedValue {
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only !== undefined && only.type === 'Identifier' && asciiLower(String(only['name'])) === 'none') {
    return { kind: 'ok', longhands: [{ property: 'font-size-adjust', value: { kind: 'keyword', value: 'none' }, explicit: true }] };
  }
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (first === undefined || last === undefined) return { kind: 'invalid', reason: 'font-size-adjust takes none, or a metric keyword and from-font or a number' };
  const span: Span = { ...spanOf(first, base), end: spanOf(last, base).end };
  return {
    kind: 'refused',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(span),
      message: 'font-size-adjust other than none is unsupported: Chrome lays the text out at an adjusted font size, and the engine lays each text run out at its computed font-size (TXT-FSA)',
      manual: 'Remove the declaration, or set the font-size you want directly.',
    }),
  };
}

/** The value parser of the font-size-adjust family (the value hook, css/paint-parsers.ts). */
export const FONT_SIZE_ADJUST_VALUE_PARSERS: { readonly [P in (typeof FONT_SIZE_ADJUST_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'font-size-adjust': parseFontSizeAdjust,
};
