// line-break (css-text-3 §5.3): auto | loose | normal | strict | anywhere, inherited, initial auto. The four strictness levels differ
// only in which breaks they allow around CJK characters, small kana, iteration marks and CJK punctuation; over ASCII letters, digits,
// spaces and the punctuation the text-line-break fixtures cover, Chrome breaks them all as auto, which is how the engine lays them
// out (analysis/line-break.ts refuses any other text, and text in a real face). anywhere, a break between every typographic letter
// unit, is refused on every target until the engine breaks there.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const LINE_BREAK_LONGHANDS = ['line-break'] as const;
export const LINE_BREAK_SHORTHANDS = [] as const;
export const LINE_BREAK_INHERITED: readonly (typeof LINE_BREAK_LONGHANDS)[number][] = ['line-break'];
export const LINE_BREAK_CONTAINER: readonly (typeof LINE_BREAK_LONGHANDS)[number][] = [];
export const LINE_BREAK_TEXT_ROLE: readonly (typeof LINE_BREAK_LONGHANDS)[number][] = ['line-break'];

export const LINE_BREAK_ASPECTS: { readonly [P in (typeof LINE_BREAK_LONGHANDS)[number]]: PropertyAspect } = {
  'line-break': { layout: true, paint: false },
};

/** The strictness levels the engine lays out as auto over the text analysis/line-break.ts admits. */
const AS_AUTO: ReadonlySet<string> = new Set(['auto', 'loose', 'normal', 'strict']);

/** One keyword of the grammar; anywhere is refused. */
function parseLineBreak(tokens: readonly CssNode[], base: Span): ParsedValue {
  const t = tokens[0];
  const k = tokens.length === 1 && t !== undefined && t.type === 'Identifier' ? asciiLower(String(t['name'])) : null;
  if (k === 'anywhere' && t !== undefined) {
    return {
      kind: 'refused',
      diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: authored(spanOf(t, base)),
        message: 'line-break: anywhere is unsupported: the engine does not break between every typographic letter unit yet',
        manual: 'Remove line-break: anywhere, or use overflow-wrap: anywhere, which breaks there only when a word overflows.',
      }),
    };
  }
  if (k === null || !AS_AUTO.has(k)) return { kind: 'invalid', reason: 'line-break is one of auto, loose, normal, strict and anywhere' };
  return { kind: 'ok', longhands: [{ property: 'line-break', value: { kind: 'keyword', value: k }, explicit: true }] };
}

/** The value parser of the line-break family (the value hook, css/paint-parsers.ts). */
export const LINE_BREAK_VALUE_PARSERS: { readonly [P in (typeof LINE_BREAK_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'line-break': parseLineBreak,
};
