// color-scheme (css-color-adjust-1 §2.1): normal | [ light | dark | <custom-ident> ]+ && only?, inherited, initial normal, computed as
// specified. Chrome 145's parse (ColorScheme::ParseSingleValue): normal alone, or one or more scheme names with only once at either end;
// a name may repeat, and it may be any identifier but normal, only, default and the CSS-wide keywords. Chrome lowercases light, dark and
// only, keeps the names in order, and moves only to the end ("only dark" computes to "dark only"). The used scheme is light unless the
// list names dark: Chrome picks the preferred scheme when the list names it, else the first of light and dark that it names.
//
// A dark scheme changes only what the UA colours with system colours: the root's canvas and text colour, links, form controls and
// scrollbars (measured against Chrome 145; ua/datasets.ts holds the root capture under html{color-scheme:dark}). Author colours never
// depend on it, since Dragon refuses light-dark() and system colours (css/color.ts). So a value that names no dark scheme changes
// nothing, and one that names dark changes nothing on a subtree with none of those boxes; computed-checks refuses the rest
// (analysis/color-scheme.ts). Nothing is emitted for it on any target.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const COLOR_SCHEME_LONGHANDS = ['color-scheme'] as const;
export const COLOR_SCHEME_SHORTHANDS = [] as const;
export const COLOR_SCHEME_INHERITED: readonly (typeof COLOR_SCHEME_LONGHANDS)[number][] = ['color-scheme'];
export const COLOR_SCHEME_CONTAINER: readonly (typeof COLOR_SCHEME_LONGHANDS)[number][] = [];
export const COLOR_SCHEME_TEXT_ROLE: readonly (typeof COLOR_SCHEME_LONGHANDS)[number][] = [];

// Only the values that change nothing are accepted, so neither layout nor paint reads it.
export const COLOR_SCHEME_ASPECTS: { readonly [P in (typeof COLOR_SCHEME_LONGHANDS)[number]]: PropertyAspect } = {
  'color-scheme': { layout: false, paint: false },
};

const RESERVED: ReadonlySet<string> = new Set(['normal', 'only', 'default', 'initial', 'inherit', 'unset', 'revert', 'revert-layer']);
const KNOWN: ReadonlySet<string> = new Set(['light', 'dark']);

/** Chrome 145's parse: normal alone, or scheme names with only once at either end, as one keyword in Chrome's serialization. */
export function parseColorScheme(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const invalid = (reason: string): ParsedValue => ({ kind: 'invalid', reason });
  if (tokens.length === 0 || tokens.some((t) => t.type !== 'Identifier')) return invalid('color-scheme is normal or a list of scheme names');
  const raw = tokens.map((t) => String(t['name']));
  const lower = raw.map(asciiLower);
  if (lower.length === 1 && lower[0] === 'normal') return single('normal');
  const only = lower.flatMap((n, i) => (n === 'only' ? [i] : []));
  if (only.length > 1 || (only.length === 1 && only[0] !== 0 && only[0] !== lower.length - 1)) return invalid('only appears once, before or after the scheme names');
  const names = raw.flatMap((n, i) => (lower[i] === 'only' ? [] : [KNOWN.has(lower[i] as string) ? (lower[i] as string) : n]));
  if (names.length === 0) return invalid('color-scheme: only names no scheme');
  const bad = names.find((n) => RESERVED.has(asciiLower(n)));
  if (bad !== undefined) return invalid(`${bad} is not a scheme name`);
  return single([...names, ...(only.length === 1 ? ['only'] : [])].join(' '));
}

const single = (value: string): ParsedValue => ({ kind: 'ok', longhands: [{ property: 'color-scheme', value: { kind: 'keyword', value }, explicit: true }] });

/** Whether a computed color-scheme names dark, so its used scheme can be dark (the preferred one, or the only one it names). */
export function namesDark(v: CssValue): boolean {
  if (v.kind !== 'keyword') throw new Error(`color-scheme ${JSON.stringify(v)} is not a keyword`);
  return v.value.split(' ').includes('dark');
}

export const COLOR_SCHEME_VALUE_PARSERS: { readonly [P in (typeof COLOR_SCHEME_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = { 'color-scheme': parseColorScheme };
