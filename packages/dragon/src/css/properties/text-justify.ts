// text-justify (css-text-3 §7.4): auto | none | inter-word | inter-character, inherited, initial auto, as Chrome 145 parses it
// (longhands_custom.cc TextJustify::ParseSingleValue, CssTextJustify stable): the legacy distribute is inter-character, and css-text-4's
// ruby and no-compress are invalid. It picks the justification opportunities of a justified line per text (justification_opportunity.cc
// CheckJustificationOpportunity): the engine lays each value out over the text analysis/computed-checks.ts admits (inline.ts
// justifyLine), and refuses the rest.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const TEXT_JUSTIFY_LONGHANDS = ['text-justify'] as const;
export const TEXT_JUSTIFY_SHORTHANDS = [] as const;
export const TEXT_JUSTIFY_INHERITED: readonly (typeof TEXT_JUSTIFY_LONGHANDS)[number][] = ['text-justify'];
export const TEXT_JUSTIFY_CONTAINER: readonly (typeof TEXT_JUSTIFY_LONGHANDS)[number][] = [];
export const TEXT_JUSTIFY_TEXT_ROLE: readonly (typeof TEXT_JUSTIFY_LONGHANDS)[number][] = ['text-justify'];

export const TEXT_JUSTIFY_ASPECTS: { readonly [P in (typeof TEXT_JUSTIFY_LONGHANDS)[number]]: PropertyAspect } = {
  'text-justify': { layout: true, paint: false },
};

/** The computed values, in Chrome's keyword order (css_properties.json5). */
export const TEXT_JUSTIFY_VALUES = ['auto', 'none', 'inter-word', 'inter-character'] as const;

/** One keyword; distribute computes to inter-character. */
function parseTextJustify(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const t = tokens[0];
  const k = tokens.length === 1 && t !== undefined && t.type === 'Identifier' ? asciiLower(String(t['name'])) : null;
  const value = k === 'distribute' ? 'inter-character' : k;
  if (value === null || !(TEXT_JUSTIFY_VALUES as readonly string[]).includes(value)) return { kind: 'invalid', reason: 'text-justify is one of auto, none, inter-word, inter-character and distribute' };
  return { kind: 'ok', longhands: [{ property: 'text-justify', value: { kind: 'keyword', value }, explicit: true }] };
}

/** The value parser of the text-justify family (the value hook, css/paint-parsers.ts). */
export const TEXT_JUSTIFY_VALUE_PARSERS: { readonly [P in (typeof TEXT_JUSTIFY_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'text-justify': parseTextJustify,
};
