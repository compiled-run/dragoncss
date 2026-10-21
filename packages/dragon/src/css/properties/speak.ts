// NA-NATIVE-2: speak, Chrome's legacy aural property: none | normal | spell-out | digits | literal-punctuation | no-punctuation,
// inherited, initial normal. Chrome 145 parses one of those keywords in any case, computes it as written in lower case, and draws
// nothing with it on any target, so every keyword is accepted and the property has no layout or paint aspect. css-speech-1's
// auto | never | always are not Chrome's grammar (it drops them), so the grammar takes any value and parseSpeak decides; pinned
// against Chrome by packages/parity/test/speak-parse.test.ts.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const SPEAK_LONGHANDS = ['speak'] as const;
export const SPEAK_SHORTHANDS = [] as const;
export const SPEAK_INHERITED: readonly (typeof SPEAK_LONGHANDS)[number][] = ['speak'];
export const SPEAK_CONTAINER: readonly (typeof SPEAK_LONGHANDS)[number][] = [];
export const SPEAK_TEXT_ROLE: readonly (typeof SPEAK_LONGHANDS)[number][] = [];

export const SPEAK_ASPECTS: { readonly [P in (typeof SPEAK_LONGHANDS)[number]]: PropertyAspect } = {
  speak: { layout: false, paint: false },
};

/** The keywords Chrome 145 parses for speak. */
export const SPEAK_KEYWORDS: readonly string[] = ['none', 'normal', 'spell-out', 'digits', 'literal-punctuation', 'no-punctuation'];

/** speak as Chrome 145 parses it, any ASCII case: one of SPEAK_KEYWORDS; anything else is dropped. */
export function parseSpeak(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const only = tokens[0];
  if (tokens.length !== 1 || only === undefined || only.type !== 'Identifier') return { kind: 'invalid', reason: 'speak takes one keyword' };
  const word = asciiLower(String(only['name']));
  if (!SPEAK_KEYWORDS.includes(word)) return { kind: 'invalid', reason: `Chrome 145 does not parse speak: ${word}` };
  return { kind: 'ok', longhands: [{ property: 'speak', value: { kind: 'keyword', value: word }, explicit: true }] };
}

/** The value parser of the speak family (the value hook, css/paint-parsers.ts). */
export const SPEAK_VALUE_PARSERS: { readonly [P in (typeof SPEAK_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  speak: parseSpeak,
};
