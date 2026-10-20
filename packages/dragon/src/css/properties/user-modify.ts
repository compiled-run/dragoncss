// TOUCH: -webkit-user-modify (Chrome's legacy editing property): read-only | read-write | read-write-plaintext-only, inherited,
// initial read-only. read-only is what every element Dragon resolves already is: nothing is editable, so the property has no layout
// or paint aspect. Chrome 145 parses one of the three keywords in any case and computes it as written, in lower case; the two
// read-write keywords make the content editable, which Dragon does not model, so they are refused. Pinned against Chrome by
// packages/parity/test/user-modify-parse.test.ts.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import { spanOf } from '../ast.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const USER_MODIFY_LONGHANDS = ['-webkit-user-modify'] as const;
export const USER_MODIFY_SHORTHANDS = [] as const;
export const USER_MODIFY_INHERITED: readonly (typeof USER_MODIFY_LONGHANDS)[number][] = ['-webkit-user-modify'];
export const USER_MODIFY_CONTAINER: readonly (typeof USER_MODIFY_LONGHANDS)[number][] = [];
export const USER_MODIFY_TEXT_ROLE: readonly (typeof USER_MODIFY_LONGHANDS)[number][] = [];

export const USER_MODIFY_ASPECTS: { readonly [P in (typeof USER_MODIFY_LONGHANDS)[number]]: PropertyAspect } = {
  '-webkit-user-modify': { layout: false, paint: false },
};

/** -webkit-user-modify as Chrome 145 parses it, any ASCII case: one keyword. read-only is accepted, the read-write ones refused. */
export function parseUserModify(tokens: readonly CssNode[], base: Span): ParsedValue {
  const only = tokens[0];
  if (tokens.length !== 1 || only === undefined || only.type !== 'Identifier') return { kind: 'invalid', reason: '-webkit-user-modify takes one keyword' };
  const word = asciiLower(String(only['name']));
  if (word === 'read-only') return { kind: 'ok', longhands: [{ property: '-webkit-user-modify', value: { kind: 'keyword', value: word }, explicit: true }] };
  if (word !== 'read-write' && word !== 'read-write-plaintext-only') return { kind: 'invalid', reason: `Chrome 145 does not parse -webkit-user-modify: ${word}` };
  return {
    kind: 'refused',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(spanOf(only, base)),
      message: `-webkit-user-modify: ${word} is unsupported: it makes the content editable, which Dragon does not model`,
      manual: 'Remove -webkit-user-modify, or set it to read-only.',
    }),
  };
}

/** The value parser of the user-modify family (the value hook, css/paint-parsers.ts). */
export const USER_MODIFY_VALUE_PARSERS: { readonly [P in (typeof USER_MODIFY_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  '-webkit-user-modify': parseUserModify,
};
