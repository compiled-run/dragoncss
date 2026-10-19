// text-transform (css-text-3 §2.1, TXT2-e): none | capitalize | uppercase | lowercase, inherited, initial none, computed as
// specified. Chrome 145 also parses math-auto, which Dragon refuses (R7, TXT2-e2); full-width and full-size-kana are behind
// CSSTextTransformFullWidth, which is off, so the grammar override (scripts/gen-css-grammar.ts) leaves them invalid as in Chrome.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const TEXT_TRANSFORM_LONGHANDS = ['text-transform'] as const;
export const TEXT_TRANSFORM_SHORTHANDS = [] as const;
export const TEXT_TRANSFORM_INHERITED: readonly (typeof TEXT_TRANSFORM_LONGHANDS)[number][] = ['text-transform'];
export const TEXT_TRANSFORM_CONTAINER: readonly (typeof TEXT_TRANSFORM_LONGHANDS)[number][] = [];
export const TEXT_TRANSFORM_TEXT_ROLE: readonly (typeof TEXT_TRANSFORM_LONGHANDS)[number][] = ['text-transform'];

export const TEXT_TRANSFORM_ASPECTS: { readonly [P in (typeof TEXT_TRANSFORM_LONGHANDS)[number]]: PropertyAspect } = {
  'text-transform': { layout: true, paint: false },
};

/** One keyword, any ASCII case; math-auto is refused on every target. */
export function parseTextTransform(tokens: readonly CssNode[], base: Span): ParsedValue {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined || t.type !== 'Identifier') return { kind: 'invalid', reason: 'text-transform is one keyword in Chrome 145' };
  const k = asciiLower(String(t['name']));
  if (k === 'math-auto') {
    return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: 'text-transform: math-auto is unsupported until TXT2-e2: Chrome italicises a single math letter with it', manual: 'Write the letter in its mathematical italic form, or use text-transform: none.' }) };
  }
  if (k !== 'none' && k !== 'capitalize' && k !== 'uppercase' && k !== 'lowercase') return { kind: 'invalid', reason: `Chrome 145 does not parse text-transform: ${k}` };
  return { kind: 'ok', longhands: [{ property: 'text-transform', value: { kind: 'keyword', value: k }, explicit: true }] };
}

/** The value parser of the text-transform family (the value hook, css/paint-parsers.ts). */
export const TEXT_TRANSFORM_VALUE_PARSERS: { readonly [P in (typeof TEXT_TRANSFORM_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'text-transform': parseTextTransform,
};
