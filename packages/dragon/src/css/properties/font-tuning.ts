// font-kerning (css-fonts-4 §6.3): auto | normal | none, font-optical-sizing (§7.1): auto | none, and font-language-override (§6.13):
// normal | <string>, each inherited and reset by the font shorthand. They turn the face's kerning, optical-size axis and language
// system on or off, none of which Ahem has, so Chrome draws Ahem the same whatever they say: Dragon accepts every value, as Chrome
// computes it, and refuses a value other than the initial one over text in a real face (analysis/font-tuning.ts), where Dragon's
// shaping applies the face's defaults.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower, serializeString } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const FONT_TUNING_LONGHANDS = ['font-kerning', 'font-optical-sizing', 'font-language-override'] as const;
export const FONT_TUNING_SHORTHANDS = [] as const;
export const FONT_TUNING_INHERITED: readonly FontTuningLonghand[] = [...FONT_TUNING_LONGHANDS];
export const FONT_TUNING_CONTAINER: readonly FontTuningLonghand[] = [];
export const FONT_TUNING_TEXT_ROLE: readonly FontTuningLonghand[] = [...FONT_TUNING_LONGHANDS];

export type FontTuningLonghand = (typeof FONT_TUNING_LONGHANDS)[number];

export const FONT_TUNING_ASPECTS: { readonly [P in FontTuningLonghand]: PropertyAspect } = {
  'font-kerning': { layout: true, paint: false },
  'font-optical-sizing': { layout: true, paint: false },
  'font-language-override': { layout: true, paint: false },
};

/** Each longhand's initial value, as Chrome computes it: the value Dragon's shaping of a real face matches. */
export const FONT_TUNING_INITIAL: { readonly [P in FontTuningLonghand]: string } = {
  'font-kerning': 'auto',
  'font-optical-sizing': 'auto',
  'font-language-override': 'normal',
};

/** The CssValue type of a font-language-override string; its text is the string as Chrome serializes it. */
export const LANGUAGE_OVERRIDE = 'language-override';

/** font-language-override: normal, or one string naming an OpenType language system: up to four printable ASCII characters, of
 * which Chrome drops the trailing spaces; any other string is refused. */
function parseLanguageOverride(tokens: readonly CssNode[], base: Span): ParsedValue {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined) return { kind: 'invalid', reason: 'font-language-override is normal or a string' };
  if (t.type === 'Identifier' && asciiLower(String(t['name'])) === 'normal') return { kind: 'ok', longhands: [{ property: 'font-language-override', value: { kind: 'keyword', value: 'normal' }, explicit: true }] };
  if (t.type !== 'String') return { kind: 'invalid', reason: 'font-language-override is normal or a string' };
  const tag = String(t['value']);
  if (!/^[\x20-\x7e]{1,4}$/.test(tag)) {
    return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `font-language-override: ${serializeString(tag)} is unsupported: Dragon takes a language system tag of one to four printable ASCII characters`, manual: 'Write the OpenType language system tag, such as "TRK", or normal.' }) };
  }
  return { kind: 'ok', longhands: [{ property: 'font-language-override', value: { kind: 'other', type: LANGUAGE_OVERRIDE, text: serializeString(tag.replace(/ +$/, '')) }, explicit: true }] };
}

/** The value parser of the font-tuning family (the value hook, css/paint-parsers.ts); the keyword longhands take the generic path. */
export const FONT_TUNING_VALUE_PARSERS: { readonly 'font-language-override': (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'font-language-override': parseLanguageOverride,
};
