// Counters and quotes (css-lists-3 §4, css-content-3 §3): counter-reset, counter-increment, counter-set and quotes. Each changes
// what renders only through content's counter(), counters() and quote keywords, or through a list marker, all of which Dragon
// refuses (properties/lists.ts, analysis/computed-checks.ts); so on every box Dragon builds they change nothing, and every value
// Chrome 145 parses compiles. A value is kept as written, so the web output hands Chrome the same declaration.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const COUNTERS_LONGHANDS = ['counter-reset', 'counter-increment', 'counter-set', 'quotes'] as const;
export const COUNTERS_SHORTHANDS = [] as const;
export const COUNTERS_INHERITED: readonly (typeof COUNTERS_LONGHANDS)[number][] = ['quotes'];
export const COUNTERS_CONTAINER: readonly (typeof COUNTERS_LONGHANDS)[number][] = [];
export const COUNTERS_TEXT_ROLE: readonly (typeof COUNTERS_LONGHANDS)[number][] = [];

export type CountersLonghand = (typeof COUNTERS_LONGHANDS)[number];

export const COUNTERS_ASPECTS: { readonly [P in CountersLonghand]: PropertyAspect } = {
  'counter-reset': { layout: false, paint: false },
  'counter-increment': { layout: false, paint: false },
  'counter-set': { layout: false, paint: false },
  quotes: { layout: false, paint: false },
};

/** The value type of a counter list or a quote pair list, kept as written (featureOf key <longhand>:<counters-value>). */
export const COUNTERS_VALUE_TYPE = 'counters-value';

/**
 * One longhand after the grammar matched: none or auto as a keyword, anything else as written. Chrome takes none only alone, so a
 * counter list that starts with none is invalid, though a later counter may be named none (probed: "none x" is dropped, "x none" kept).
 */
function parseLonghand(property: CountersLonghand): (tokens: readonly CssNode[], base: Span) => ParsedValue {
  return (tokens) => {
    const first = tokens[0];
    if (first === undefined) return { kind: 'invalid', reason: `${property} needs a value` };
    const keyword = first.type === 'Identifier' ? asciiLower(String(first['name'])) : null;
    if (tokens.length === 1 && (keyword === 'none' || (property === 'quotes' && keyword === 'auto'))) {
      return { kind: 'ok', longhands: [{ property, value: { kind: 'keyword', value: keyword }, explicit: true }] };
    }
    if (property !== 'quotes' && keyword === 'none') return { kind: 'invalid', reason: `Chrome 145 takes ${property}: none only alone` };
    return { kind: 'ok', longhands: [{ property, value: { kind: 'other', type: COUNTERS_VALUE_TYPE, text: tokens.map((t) => generate(t)).join(' ') }, explicit: true }] };
  };
}

/** The value parsers of the counters family (the value hook, css/paint-parsers.ts). */
export const COUNTERS_VALUE_PARSERS: { readonly [P in CountersLonghand]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'counter-reset': parseLonghand('counter-reset'),
  'counter-increment': parseLonghand('counter-increment'),
  'counter-set': parseLonghand('counter-set'),
  quotes: parseLonghand('quotes'),
};
