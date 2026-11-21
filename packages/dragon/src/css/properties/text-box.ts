// text-box-trim and text-box-edge (css-inline-3 §5.1, §5.2) as Chrome 145 parses them (Blink ConsumeTextBoxTrim and
// ConsumeTextBoxEdge, css_parsing_utils.cc), and the text-box shorthand (shorthands/text-box.ts). text-box-trim is none, trim-start,
// trim-end or trim-both, not inherited, initial none; text-box-edge is auto, or an over edge (text, cap, ex) and an under edge
// (text, alphabetic), inherited, initial auto. cap and ex take no default under edge, so a lone cap or ex is invalid; text text
// computes to text. An edge is kept as one keyword as Chrome serialises it (text, text alphabetic, cap text). The engine trims a
// block of inline content at the text edges and at the alphabetic baseline (analysis/text-box.ts); the rest is refused there.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';

export const TEXT_BOX_LONGHANDS = ['text-box-trim', 'text-box-edge'] as const;
export const TEXT_BOX_SHORTHANDS = ['text-box'] as const;
export const TEXT_BOX_INHERITED: readonly (typeof TEXT_BOX_LONGHANDS)[number][] = ['text-box-edge'];
export const TEXT_BOX_CONTAINER: readonly (typeof TEXT_BOX_LONGHANDS)[number][] = ['text-box-trim'];
export const TEXT_BOX_TEXT_ROLE: readonly (typeof TEXT_BOX_LONGHANDS)[number][] = ['text-box-edge'];

export const TEXT_BOX_ASPECTS: { readonly [P in (typeof TEXT_BOX_LONGHANDS)[number]]: PropertyAspect } = {
  'text-box-trim': { layout: true, paint: false },
  'text-box-edge': { layout: true, paint: false },
};

/** The text-box-trim keywords (Blink ConsumeTextBoxTrim). */
export const TEXT_BOX_TRIMS: ReadonlySet<string> = new Set(['none', 'trim-start', 'trim-end', 'trim-both']);

/** The ASCII-lowercase identifiers of tokens, or null when one is not an identifier. */
export function textBoxIdentifiers(tokens: readonly CssNode[]): string[] | null {
  const names = tokens.map((t) => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : null));
  return names.every((n): n is string => n !== null) ? names : null;
}

/**
 * Blink ConsumeTextBoxEdge on names from index at: the edge as Chrome serialises it and the names it takes, or null. auto; or an
 * over edge (text, cap, ex) and an optional under edge (text, alphabetic), which cap and ex require (TextBoxEdge::UnderForOver);
 * an under edge equal to the over edge's default (text after text) is dropped.
 */
export function consumeTextBoxEdge(names: readonly string[], at: number): { readonly edge: string; readonly taken: number } | null {
  const over = names[at];
  if (over === 'auto') return { edge: 'auto', taken: 1 };
  if (over !== 'text' && over !== 'cap' && over !== 'ex') return null;
  const under = names[at + 1];
  if (under === 'text' || under === 'alphabetic') return { edge: over === 'text' && under === 'text' ? 'text' : `${over} ${under}`, taken: 2 };
  return over === 'text' ? { edge: 'text', taken: 1 } : null;
}

const single = (property: (typeof TEXT_BOX_LONGHANDS)[number], value: string): ParsedValue => ({ kind: 'ok', longhands: [{ property, value: { kind: 'keyword', value }, explicit: true } as LonghandValue] });

function parseTextBoxTrim(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const names = textBoxIdentifiers(tokens);
  const k = names !== null && names.length === 1 ? (names[0] as string) : '';
  return TEXT_BOX_TRIMS.has(k) ? single('text-box-trim', k) : { kind: 'invalid', reason: 'text-box-trim is one of none, trim-start, trim-end and trim-both' };
}

function parseTextBoxEdge(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const names = textBoxIdentifiers(tokens);
  const e = names === null ? null : consumeTextBoxEdge(names, 0);
  if (names === null || e === null || e.taken !== names.length) return { kind: 'invalid', reason: 'text-box-edge is auto, or text, cap or ex and an optional text or alphabetic (required after cap and ex)' };
  return single('text-box-edge', e.edge);
}

/** The value parsers of the text-box family (the value hook, css/paint-parsers.ts). */
export const TEXT_BOX_VALUE_PARSERS: { readonly [P in (typeof TEXT_BOX_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'text-box-trim': parseTextBoxTrim,
  'text-box-edge': parseTextBoxEdge,
};
