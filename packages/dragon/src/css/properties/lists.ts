// Generated content and lists (css-content-3 §2, css-lists-3 §3): content, and the list-style longhands. GEN-b (notes/T151-gen-spec.md
// R13) generates no box from any of them: content on an element has no effect, and a list item is accepted only when its marker
// generates no box (analysis/computed-checks.ts). Their layout aspect is what the layout lane proves: no box changes.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower, serializeString } from '../escapes.ts';
import type { Longhand, PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import { kw } from '../values.ts';

export const LISTS_LONGHANDS = ['content', 'list-style-type', 'list-style-position', 'list-style-image'] as const;
export const LISTS_SHORTHANDS = ['list-style'] as const;
export const LISTS_INHERITED: readonly (typeof LISTS_LONGHANDS)[number][] = ['list-style-type', 'list-style-position', 'list-style-image'];
export const LISTS_CONTAINER: readonly (typeof LISTS_LONGHANDS)[number][] = [];
export const LISTS_TEXT_ROLE: readonly (typeof LISTS_LONGHANDS)[number][] = [];

export const LISTS_ASPECTS: { readonly [P in (typeof LISTS_LONGHANDS)[number]]: PropertyAspect } = {
  content: { layout: true, paint: false },
  'list-style-type': { layout: true, paint: false },
  'list-style-position': { layout: true, paint: false },
  'list-style-image': { layout: true, paint: false },
};

/** The properties whose values this module parses (stylesheet.ts parseValue). */
export const LISTS_VALUE_PROPERTIES: ReadonlySet<string> = new Set<string>(['content', 'list-style-type', 'list-style-image']);

/** The value type of a computed string (featureOf keys content:<string> and list-style-type:<string>). */
export const STRING_VALUE_TYPE = 'string';

/** A computed <string>: Chrome serializes it double-quoted (css/escapes.ts serializeString). */
export const stringValue = (s: string): CssValue => ({ kind: 'other', type: STRING_VALUE_TYPE, text: serializeString(s) });

/** The package that owns each kind of content Dragon does not generate yet (notes/T151-gen-spec.md R3, R15). */
const IMAGE_OWNER = 'images in generated content and list-style-image (GEN-d4)';
/** The <image> functions Chrome 145 parses (probed by packages/parity/test/list-style-parse.test.ts); a url token is one too. */
const IMAGE_FUNCTIONS: ReadonlySet<string> = new Set(['url', 'image-set', '-webkit-image-set', 'cross-fade', '-webkit-cross-fade',
  'linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
  '-webkit-linear-gradient', '-webkit-radial-gradient', '-webkit-repeating-linear-gradient', '-webkit-repeating-radial-gradient', '-webkit-gradient']);
const CONTENT_FUNCTIONS: { readonly [name: string]: string } = {
  counter: 'counters and their scopes (GEN-d1)',
  counters: 'counters and their scopes (GEN-d1)',
  attr: 'attr() (GEN-d3)',
};
const QUOTES: ReadonlySet<string> = new Set(['open-quote', 'close-quote', 'no-open-quote', 'no-close-quote']);

/** Whether a token is an <image> Chrome parses: a url token or an image function. */
export function isImageToken(t: CssNode): boolean {
  return t.type === 'Url' || (t.type === 'Function' && IMAGE_FUNCTIONS.has(asciiLower(String(t['name']))));
}

/**
 * Why a content token is not generated yet, naming its owner package; null for a <string>, and 'invalid' for a token Chrome's
 * content parser (Blink Content::ParseSingleValue) does not take though webref's grammar does (a bare identifier, content(),
 * leader(), string(), element()).
 */
function contentRefusal(t: CssNode): string | null | 'invalid' {
  if (t.type === 'String') return null;
  if (isImageToken(t)) return `an image in content: ${IMAGE_OWNER}`;
  if (t.type === 'Operator' && String(t['value']) === '/') return 'alternative text after "/": the accessible name of generated content (GEN-d5)';
  if (t.type === 'Identifier' && QUOTES.has(asciiLower(String(t['name'])))) return 'quotes and the quote depth (GEN-d2)';
  if (t.type === 'Function') return CONTENT_FUNCTIONS[asciiLower(String(t['name']))] ?? 'invalid';
  return 'invalid';
}

/**
 * The predefined counter styles (css-counter-styles-3 §6, §7, and disclosure-open / disclosure-closed): Chrome matches these names
 * ASCII case-insensitively and computes them in lowercase, and keeps any other counter-style name as written (probed: Disc computes
 * disc, Foo computes Foo; packages/parity/test/list-style-parse.test.ts).
 */
const PREDEFINED_COUNTER_STYLES: ReadonlySet<string> = new Set([
  'decimal', 'decimal-leading-zero', 'arabic-indic', 'armenian', 'upper-armenian', 'lower-armenian', 'bengali', 'cambodian', 'khmer',
  'cjk-decimal', 'devanagari', 'georgian', 'gujarati', 'gurmukhi', 'hebrew', 'kannada', 'lao', 'malayalam', 'mongolian', 'myanmar',
  'oriya', 'persian', 'lower-roman', 'upper-roman', 'tamil', 'telugu', 'thai', 'tibetan', 'lower-alpha', 'lower-latin', 'upper-alpha',
  'upper-latin', 'lower-greek', 'hiragana', 'hiragana-iroha', 'katakana', 'katakana-iroha', 'disc', 'circle', 'square',
  'disclosure-open', 'disclosure-closed', 'cjk-earthly-branch', 'cjk-heavenly-stem', 'japanese-informal', 'japanese-formal',
  'korean-hangul-formal', 'korean-hanja-informal', 'korean-hanja-formal', 'simp-chinese-informal', 'simp-chinese-formal',
  'trad-chinese-informal', 'trad-chinese-formal', 'ethiopic-numeric',
]);

/** The computed list-style-type of a counter-style name token: a predefined name in lowercase, any other as written. */
export function counterStyleName(t: CssNode): CssValue {
  const written = String(t['name']);
  const lower = asciiLower(written);
  return kw(PREDEFINED_COUNTER_STYLES.has(lower) || lower === 'none' ? lower : written);
}

const ok = (property: Longhand, value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property, value, explicit: true }] });

function refuse(property: string, node: CssNode, base: Span, reason: string, manual: string): ParsedValue {
  return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(node, base)), message: `${property}: ${generate(node)} is not supported yet: ${reason}`, manual }) };
}

/**
 * The value of content, list-style-type or list-style-image after the grammar matched (stylesheet.ts parseValue). content: normal
 * and none are keywords, and a list of strings is one string (css-content-3 §2; Blink joins adjacent strings into one item,
 * longhands_custom.cc Content::ApplyValue); counters, quotes, attr(), images and alt text are refused at their first token, naming
 * their owner, and a token Chrome does not parse is invalid. list-style-type: a keyword or a string. list-style-image: none, or an
 * image, which is refused.
 */
export function parseListsValue(property: Longhand, tokens: readonly CssNode[], base: Span): ParsedValue {
  const only = tokens.length === 1 ? (tokens[0] as CssNode) : null;
  const keyword = only !== null && only.type === 'Identifier' ? asciiLower(String(only['name'])) : null;
  if (property === 'content') {
    if (keyword === 'normal' || keyword === 'none') return ok(property, kw(keyword));
    const reasons = tokens.map(contentRefusal);
    if (reasons.includes('invalid')) return { kind: 'invalid' };
    for (const [i, reason] of reasons.entries()) {
      if (reason !== null) return refuse(property, tokens[i] as CssNode, base, reason, 'Write content as normal, none or strings.');
    }
    return ok(property, stringValue(tokens.map((t) => String(t['value'])).join('')));
  }
  if (property === 'list-style-image') {
    if (keyword === 'none') return ok(property, kw('none'));
    if (only === null || !isImageToken(only)) return { kind: 'invalid' };
    return refuse(property, only, base, IMAGE_OWNER, 'Set list-style-image: none.');
  }
  // list-style-type: the grammar (Chrome's, scripts/gen-css-grammar.ts) admits one keyword or one string.
  if (only !== null && only.type === 'String') return ok(property, stringValue(String(only['value'])));
  if (only !== null && only.type === 'Identifier') return ok(property, counterStyleName(only));
  return { kind: 'invalid' };
}
