// text-wrap-style (css-text-4 §5.1): auto | balance | stable | pretty, inherited, initial auto; and the text-wrap shorthand
// (shorthands/text-wrap.ts) of text-wrap-mode and text-wrap-style. auto and stable lay lines out greedily (stable differs from auto
// only while the text is edited); balance and pretty lay lines out with the engine's port of Chrome's own line-breaking passes
// (packages/layout/src/inline.ts wrapStyleLines), in the contexts analysis/computed-checks.ts checkTextWrapStyle accepts.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const TEXT_WRAP_LONGHANDS = ['text-wrap-style'] as const;
export const TEXT_WRAP_SHORTHANDS = ['text-wrap'] as const;
export const TEXT_WRAP_INHERITED: readonly (typeof TEXT_WRAP_LONGHANDS)[number][] = ['text-wrap-style'];
export const TEXT_WRAP_CONTAINER: readonly (typeof TEXT_WRAP_LONGHANDS)[number][] = [];
export const TEXT_WRAP_TEXT_ROLE: readonly (typeof TEXT_WRAP_LONGHANDS)[number][] = ['text-wrap-style'];

export const TEXT_WRAP_ASPECTS: { readonly [P in (typeof TEXT_WRAP_LONGHANDS)[number]]: PropertyAspect } = {
  'text-wrap-style': { layout: true, paint: false },
};

/** The text-wrap-style keywords (Blink TextWrapStyle). */
const KEYWORDS: ReadonlySet<string> = new Set(['auto', 'balance', 'stable', 'pretty']);

/** One keyword of the grammar (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES). */
function parseTextWrapStyle(tokens: readonly CssNode[]): ParsedValue {
  const t = tokens[0];
  const k = tokens.length === 1 && t !== undefined && t.type === 'Identifier' ? asciiLower(String(t['name'])) : null;
  if (k === null || !KEYWORDS.has(k)) return { kind: 'invalid', reason: 'text-wrap-style is one of auto, balance, stable and pretty' };
  return { kind: 'ok', longhands: [{ property: 'text-wrap-style', value: { kind: 'keyword', value: k }, explicit: true }] };
}

/** The value parser of the text-wrap family (the value hook, css/paint-parsers.ts). */
export const TEXT_WRAP_VALUE_PARSERS: { readonly [P in (typeof TEXT_WRAP_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'text-wrap-style': parseTextWrapStyle,
};
