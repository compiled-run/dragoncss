// The font-family property value as Chrome 145 parses and serializes it: css_parsing_utils.cc ConsumeFontFamily for parsing;
// serialization follows CSSOM (serialize a string, a family name as an identifier when it is one), and matches what Chrome
// 145.0.7632.6 prints (Chrome does this in css_markup.cc; checked by escapes.test.ts and fonts/wire.test.ts).
import { asciiLower, tokenize, TokenStream } from './css-tokens.ts';
import { consumeFamilyName, consumeGenericFamily } from './font-face.ts';

/** One entry of a font-family list: a generic keyword (unquoted, from Blink's generic range) or a family name. */
export type FamilyEntry = { readonly kind: 'generic'; readonly keyword: string } | { readonly kind: 'family'; readonly name: string };
export type FamilyList = readonly FamilyEntry[];

/** css_parsing_utils.cc ConsumeFontFamily: a comma list of generics and family names; null when the value is invalid. */
export function parseFamilyList(text: string): FamilyList | null {
  const s = new TokenStream(tokenize(text));
  s.consumeWhitespace();
  const out: FamilyEntry[] = [];
  do {
    const generic = consumeGenericFamily(s);
    if (generic !== null) out.push({ kind: 'generic', keyword: generic });
    else {
      const name = consumeFamilyName(s);
      if (name === null) return null;
      out.push({ kind: 'family', name });
    }
  } while (s.consumeCommaIncludingWhitespace());
  return s.atEnd() ? out : null;
}

const CSS_WIDE = ['initial', 'inherit', 'unset', 'revert', 'revert-layer'];
/** font_family.cc FontFamily::InferredTypeFor: the names Blink infers as generic (case-sensitive). */
const INFERRED_GENERIC = ['cursive', 'fantasy', 'monospace', 'sans-serif', 'serif', 'system-ui', 'math'];

const isNameStart = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c >= 0x80;
const isNameChar = (c: number): boolean => isNameStart(c) || (c >= 0x30 && c <= 0x39) || c === 0x2d;

/** Whether s is one CSS ident (css-syntax-3: it would start an ident sequence and holds only ident code points), as Chrome's css_markup.cc tests it. */
function isTokenizerIdentifier(s: string): boolean {
  const cps = [...s].map((c) => c.codePointAt(0) as number);
  let i = 0;
  if (cps[i] === 0x2d) i++;
  if (i === cps.length || !isNameStart(cps[i] as number)) return false;
  for (i++; i < cps.length; i++) if (!isNameChar(cps[i] as number)) return false;
  return true;
}

/** css_parsing_utils.cc IsInvalidFontFamily. */
export function isInvalidFontFamily(name: string): boolean {
  return CSS_WIDE.includes(asciiLower(name)) || asciiLower(name) === 'default' || INFERRED_GENERIC.includes(name) || !isTokenizerIdentifier(name);
}

/** CSSOM "serialize a string": control characters as hex escapes, quote and backslash escaped (Chrome's css_markup.cc prints the same). */
export function serializeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c <= 0x1f || c === 0x7f) out += `\\${c.toString(16)} `;
    else if (c === 0x22 || c === 0x5c) out += `\\${ch}`;
    else out += ch;
  }
  return `${out}"`;
}

/** A family name as CSSOM serializes it: bare when it is a valid family identifier, else a quoted string (as Chrome's css_markup.cc does). */
export function serializeFamilyName(name: string): string {
  return isInvalidFontFamily(name) ? serializeString(name) : name;
}

/** The computed font-family serialization: entries joined by ", ". */
export function serializeFamilyList(list: FamilyList): string {
  return list.map((e) => (e.kind === 'generic' ? e.keyword : serializeFamilyName(e.name))).join(', ');
}
