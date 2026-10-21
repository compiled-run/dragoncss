// text-wrap-style (css-text-4 §5.1): auto | balance | stable | pretty, inherited, initial auto; and the text-wrap shorthand
// (shorthands/text-wrap.ts) of text-wrap-mode and text-wrap-style. auto and stable lay lines out greedily, as the engine does
// (stable differs from auto only while the text is edited); balance and pretty, which Chrome lays out with its own line-breaking
// passes, are refused on every target until those passes are ported.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
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

/** The text-wrap-style keywords Dragon lays out: Chrome's greedy line breaking. */
const GREEDY: ReadonlySet<string> = new Set(['auto', 'stable']);

/** The refusal of a text-wrap-style keyword the engine does not lay out (balance, pretty), or null; property names the declaration. */
export function wrapStyleRefusal(tokens: readonly CssNode[], base: Span, property: string): Diagnostic | null {
  for (const t of tokens) {
    if (t.type !== 'Identifier') continue;
    const k = asciiLower(String(t['name']));
    if (k !== 'balance' && k !== 'pretty') continue;
    return diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(spanOf(t, base)),
      message: `${property}: ${k} is unsupported: Dragon breaks lines greedily, as text-wrap-style: auto does; ${k} line breaking is not ported yet`,
      manual: `Remove ${k}, or use text-wrap-style: auto.`,
    });
  }
  return null;
}

/** One keyword of the grammar (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES); balance and pretty are refused. */
function parseTextWrapStyle(tokens: readonly CssNode[], base: Span): ParsedValue {
  const refused = wrapStyleRefusal(tokens, base, 'text-wrap-style');
  if (refused !== null) return { kind: 'refused', diagnostic: refused };
  const t = tokens[0];
  const k = tokens.length === 1 && t !== undefined && t.type === 'Identifier' ? asciiLower(String(t['name'])) : null;
  if (k === null || !GREEDY.has(k)) return { kind: 'invalid', reason: 'text-wrap-style is one of auto, balance, stable and pretty' };
  return { kind: 'ok', longhands: [{ property: 'text-wrap-style', value: { kind: 'keyword', value: k }, explicit: true }] };
}

/** The value parser of the text-wrap family (the value hook, css/paint-parsers.ts). */
export const TEXT_WRAP_VALUE_PARSERS: { readonly [P in (typeof TEXT_WRAP_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'text-wrap-style': parseTextWrapStyle,
};
