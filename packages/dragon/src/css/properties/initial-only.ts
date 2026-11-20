// The value parsers of the families Dragon accepts at their initial values alone (containment.ts, container-query.ts, multicol.ts,
// anchor-position.ts, svg-extra.ts, view-transition.ts and animation-extra.ts). A value that spells the initial value parses to it; any other value is kept as written and refused where it
// applies (analysis/scroll-containment.ts, analysis/multicol.ts). Their grammar takes any value (scripts/gen-css-grammar.ts), so Dragon never drops a
// declaration Chrome keeps; packages/parity/test/scroll-containment-parse.test.ts pins the accepted spellings against Chrome 145.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower, decodeName } from '../escapes.ts';
import type { Longhand } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import { CANONICAL_LENGTH_UNIT } from '../units.ts';
import type { CssValue } from '../values.ts';

export type InitialOnlyParser = (tokens: readonly CssNode[], base: Span) => ParsedValue;

/** The value type of a value other than the initial one (featureOf key <longhand>:<non-initial-value>); the family check refuses it. */
export const NON_INITIAL_VALUE_TYPE = 'non-initial-value';

export const kwInitial = (value: string): CssValue => ({ kind: 'keyword', value });
/** The zero length, as the initial value "0" computes (analysis/computed.ts parseValueText). */
export const ZERO_LENGTH: CssValue = { kind: 'length', value: 0, unit: CANONICAL_LENGTH_UNIT };
/** A number initial value, as stop-opacity's 1. */
export const numInitial = (value: number): CssValue => ({ kind: 'number', value });

/** Whether a computed value is the initial one: the same keyword or number, or a zero px length. */
export function isInitialValue(initial: CssValue, v: CssValue): boolean {
  if (initial.kind === 'keyword') return v.kind === 'keyword' && v.value === initial.value;
  if (initial.kind === 'number') return v.kind === 'number' && v.value === initial.value;
  return initial.kind === 'length' && v.kind === 'length' && v.value === 0 && v.unit === CANONICAL_LENGTH_UNIT;
}

/** Whether one token spells the initial value: its keyword in any ASCII case, its number, or for a zero length 0 or 0px. */
export function spellsInitial(initial: CssValue, t: CssNode | undefined): boolean {
  if (t === undefined) return false;
  if (initial.kind === 'keyword') return t.type === 'Identifier' && asciiLower(String(t['name'])) === initial.value;
  if (initial.kind === 'number') return t.type === 'Number' && Number(t['value']) === initial.value;
  if (t.type === 'Number') return Number(t['value']) === 0;
  return t.type === 'Dimension' && Number(t['value']) === 0 && asciiLower(String(t['unit'])) === 'px';
}

/** A value other than the initial one, as written. */
export const nonInitial = (tokens: readonly CssNode[]): CssValue => ({ kind: 'other', type: NON_INITIAL_VALUE_TYPE, text: tokens.map((t) => generate(t)).join(' ') });

/** A longhand: its initial spelling alone is its initial value; any other value is kept as written. */
export function initialOnlyLonghand(property: Longhand, initial: CssValue): InitialOnlyParser {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${property} needs a value` };
    const value = tokens.length === 1 && spellsInitial(initial, tokens[0]) ? initial : nonInitial(tokens);
    return { kind: 'ok', longhands: [{ property, value, explicit: true }] };
  };
}

/**
 * A one-keyword longhand: one of Chrome 145's keywords for it, in any ASCII case, is its initial value or kept as written; any other
 * value is invalid, as Chrome drops it (packages/parity/test/render-anchor-parse.test.ts pins each keyword list against Chrome).
 */
export function keywordLonghand(property: Longhand, initial: CssValue, keywords: readonly string[]): InitialOnlyParser {
  return (tokens) => {
    const t = tokens[0];
    const k = tokens.length === 1 && t !== undefined && t.type === 'Identifier' ? asciiLower(String(t['name'])) : null;
    if (k === null || !keywords.includes(k)) return { kind: 'invalid', reason: `${property} takes ${keywords.join(', ')} (Chrome 145 drops any other value)` };
    return { kind: 'ok', longhands: [{ property, value: spellsInitial(initial, t) ? initial : nonInitial(tokens), explicit: true }] };
  };
}

/** The value type of a comma-separated list of <dashed-ident> names (featureOf key <longhand>:<dashed-ident-list>). */
export const DASHED_IDENT_LIST_TYPE = 'dashed-ident-list';

/**
 * A longhand of the grammar <initial keyword> | <keyword>* | <dashed-ident>#: a keyword alone in any ASCII case, or names joined by
 * commas, kept as written (Chrome 145 serializes them so); any other value is invalid, as Chrome drops it
 * (packages/parity/test/render-anchor-parse.test.ts pins the spellings against Chrome).
 */
export function dashedIdentListLonghand(property: Longhand, initial: CssValue, keywords: readonly string[] = []): InitialOnlyParser {
  return (tokens) => {
    const invalid: ParsedValue = { kind: 'invalid', reason: `${property} takes ${[valueToText(initial), ...keywords].join(', ')} or a comma-separated list of <dashed-ident> names (Chrome 145 drops any other value)` };
    const first = tokens[0];
    if (tokens.length === 1 && spellsInitial(initial, first)) return { kind: 'ok', longhands: [{ property, value: initial, explicit: true }] };
    const k = tokens.length === 1 && first !== undefined && first.type === 'Identifier' ? asciiLower(String(first['name'])) : null;
    if (k !== null && keywords.includes(k)) return { kind: 'ok', longhands: [{ property, value: { kind: 'keyword', value: k }, explicit: true }] };
    if (tokens.length % 2 === 0) return invalid;
    const names: string[] = [];
    for (const [i, t] of tokens.entries()) {
      if (i % 2 === 1) {
        if (!(t.type === 'Operator' && t['value'] === ',')) return invalid;
        continue;
      }
      // Chrome serializes a name with its escapes decoded (--\61 is --a); -- alone is a name too.
      const name = t.type === 'Identifier' ? decodeName(String(t['name'])) : '';
      if (!name.startsWith('--')) return invalid;
      names.push(name);
    }
    return { kind: 'ok', longhands: [{ property, value: { kind: 'other', type: DASHED_IDENT_LIST_TYPE, text: names.join(', ') }, explicit: true }] };
  };
}

const valueToText = (v: CssValue): string => (v.kind === 'keyword' ? v.value : '');

/**
 * A shorthand of one to max values over longhands that share one initial value: when every value spells it, each longhand takes
 * it; otherwise each longhand keeps the whole value as written, so the family check refuses it.
 */
export function initialOnlyShorthand(name: string, longhands: readonly Longhand[], initial: CssValue, max: number): InitialOnlyParser {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${name} needs a value` };
    const initialAll = tokens.length <= max && tokens.every((t) => spellsInitial(initial, t));
    return { kind: 'ok', longhands: longhands.map((p): LonghandValue => ({ property: p, value: initialAll ? initial : nonInitial(tokens), explicit: true })) };
  };
}
