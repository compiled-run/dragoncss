// font-feature-settings (css-fonts-4 §6.12): normal | <feature-tag-value>#, and font-variation-settings (§7.2): normal |
// [ <opentype-tag> <number> ]#, both inherited, initial normal, and both reset by the font shorthand. They select OpenType
// features and variation axes of the used face. Dragon accepts them over text drawn in a face that has neither (Ahem, where
// Chrome draws the same glyphs whatever they say) and refuses them over a real face (computed-checks.ts checkFontFeatures).
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower, serializeString } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const FONT_FEATURES_LONGHANDS = ['font-feature-settings', 'font-variation-settings'] as const;
export const FONT_FEATURES_SHORTHANDS = [] as const;
export const FONT_FEATURES_INHERITED: readonly (typeof FONT_FEATURES_LONGHANDS)[number][] = ['font-feature-settings', 'font-variation-settings'];
export const FONT_FEATURES_CONTAINER: readonly (typeof FONT_FEATURES_LONGHANDS)[number][] = [];
export const FONT_FEATURES_TEXT_ROLE: readonly (typeof FONT_FEATURES_LONGHANDS)[number][] = ['font-feature-settings', 'font-variation-settings'];

export const FONT_FEATURES_ASPECTS: { readonly [P in (typeof FONT_FEATURES_LONGHANDS)[number]]: PropertyAspect } = {
  'font-feature-settings': { layout: true, paint: false },
  'font-variation-settings': { layout: true, paint: false },
};

/** The CssValue type of a non-normal settings list; its text is the list as Chrome serializes it. */
export const FEATURE_SETTINGS = 'feature-settings';

type Longhand = (typeof FONT_FEATURES_LONGHANDS)[number];

/** Blink's OpenType tag check (font_feature_settings and font_variation_settings parsing): exactly four characters U+20 to U+7E. */
const validTag = (s: string): boolean => [...s].length === 4 && [...s].every((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7e);

/** A number in CSS text as Chrome writes it (no exponent for the values a setting takes). */
const numberText = (n: number): string => String(n === 0 ? 0 : n);

function settings(property: Longhand, tokens: readonly CssNode[], base: Span): ParsedValue {
  const ok = (value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property, value, explicit: true }] });
  if (tokens.length === 1 && tokens[0]?.type === 'Identifier' && asciiLower(String(tokens[0]['name'])) === 'normal') return ok({ kind: 'keyword', value: 'normal' });
  const items: CssNode[][] = [[]];
  for (const t of tokens) {
    if (t.type === 'Operator' && t['value'] === ',') items.push([]);
    else (items[items.length - 1] as CssNode[]).push(t);
  }
  const out: string[] = [];
  for (const item of items) {
    const [tag, value, extra] = item;
    if (tag === undefined || tag.type !== 'String' || extra !== undefined) return { kind: 'invalid', reason: `each ${property} item is a four-character tag and a value` };
    const name = String(tag['value']);
    if (!validTag(name)) return { kind: 'invalid', reason: `${serializeString(name)} is not an OpenType tag: Chrome takes exactly four characters from U+20 to U+7E` };
    if (value !== undefined && value.type === 'Function') {
      return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(value, base)), message: `${property}: a calculation in a setting is not supported yet`, manual: 'Write each setting value as a plain number.' }) };
    }
    if (property === 'font-feature-settings') {
      // <feature-tag-value>: the tag, then an optional non-negative integer, on (1) or off (0); Chrome omits a value of 1.
      let n = 1;
      if (value !== undefined) {
        const k = value.type === 'Identifier' ? asciiLower(String(value['name'])) : null;
        if (k === 'on') n = 1;
        else if (k === 'off') n = 0;
        else if (value.type === 'Number' && /^[+]?\d+$/.test(String(value['value']))) n = Number(value['value']);
        else return { kind: 'invalid', reason: 'a feature value is a non-negative integer, on or off' };
      }
      out.push(n === 1 ? serializeString(name) : `${serializeString(name)} ${n}`);
    } else {
      if (value === undefined || value.type !== 'Number') return { kind: 'invalid', reason: 'a variation setting is a tag and a number' };
      out.push(`${serializeString(name)} ${numberText(Number(value['value']))}`);
    }
  }
  return ok({ kind: 'other', type: FEATURE_SETTINGS, text: out.join(', ') });
}

/** The value parsers of the font-features family (the value hook, css/paint-parsers.ts). */
export const FONT_FEATURES_VALUE_PARSERS: { readonly [P in Longhand]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'font-feature-settings': (tokens, base) => settings('font-feature-settings', tokens, base),
  'font-variation-settings': (tokens, base) => settings('font-variation-settings', tokens, base),
};
