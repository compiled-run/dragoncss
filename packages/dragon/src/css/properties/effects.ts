// color-scheme (css-color-adjust-1 §2), with Chrome 145's parsing: normal, or light, dark and custom idents with at most one only,
// which Chrome serializes last (light and dark lowercase, custom idents as written). opacity and z-index join this family with the
// stacking package.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower, decodeName } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const EFFECTS_LONGHANDS = ['color-scheme'] as const;
export const EFFECTS_SHORTHANDS = [] as const;
export const EFFECTS_INHERITED: readonly (typeof EFFECTS_LONGHANDS)[number][] = ['color-scheme'];
export const EFFECTS_CONTAINER: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];
export const EFFECTS_TEXT_ROLE: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];

export const EFFECTS_ASPECTS: { readonly [P in (typeof EFFECTS_LONGHANDS)[number]]: PropertyAspect } = {
  'color-scheme': { layout: false, paint: true },
};

/** The CssValue type of a color-scheme list; its text is Chrome's serialization. */
export const COLOR_SCHEME_LIST = 'color-scheme-list';

const single = (property: string, value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property, value, explicit: true } as LonghandValue] });

/** The idents a color-scheme ident list may not hold (css-color-adjust-1 §2: normal, default and the CSS-wide keywords). */
const RESERVED = new Set(['normal', 'default', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/** A parsed color-scheme: normal, or the listed idents (light and dark lowercase, custom idents as written) and only. */
export type ColorScheme = { readonly kind: 'normal' } | { readonly kind: 'list'; readonly idents: readonly string[]; readonly only: boolean };

/** Chrome's serialization of a color-scheme: the idents in order, then only. */
export function colorSchemeText(s: ColorScheme): string {
  return s.kind === 'normal' ? 'normal' : [...s.idents, ...(s.only ? ['only'] : [])].join(' ');
}

/** The CssValue of a color-scheme: a keyword for normal, light or dark alone, else a list. */
export function colorSchemeValue(s: ColorScheme): CssValue {
  const text = colorSchemeText(s);
  return text === 'normal' || text === 'light' || text === 'dark' ? { kind: 'keyword', value: text } : { kind: 'other', type: COLOR_SCHEME_LIST, text };
}

function readColorScheme(tokens: readonly CssNode[]): ColorScheme | string {
  const names: string[] = [];
  for (const t of tokens) {
    if (t.type !== 'Identifier') return 'color-scheme takes idents';
    names.push(decodeName(String(t['name'])));
  }
  if (names.length === 1 && asciiLower(names[0] as string) === 'normal') return { kind: 'normal' };
  const idents: string[] = [];
  let only = false;
  for (const n of names) {
    const lower = asciiLower(n);
    if (lower === 'only') {
      if (only) return 'only appears twice';
      only = true;
      continue;
    }
    if (RESERVED.has(lower)) return `${lower} is not a color-scheme ident`;
    idents.push(lower === 'light' || lower === 'dark' ? lower : n);
  }
  if (idents.length === 0) return 'only needs a scheme';
  return { kind: 'list', idents, only };
}

/** css-color-adjust-1 §2: normal | [ light | dark | <custom-ident> ]+ && only? */
export function parseColorScheme(tokens: readonly CssNode[], base: Span): ParsedValue {
  // A custom ident holding white space (an escaped space) would not read back from the list text, which is space-separated.
  const spaced = tokens.find((t) => t.type === 'Identifier' && /\s/.test(decodeName(String(t['name']))));
  if (spaced !== undefined) {
    return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(spaced, base)), message: 'color-scheme: a custom ident holding white space is unsupported', manual: 'Name the custom color scheme without escaped white space.' }) };
  }
  const s = readColorScheme(tokens);
  if (typeof s === 'string') return { kind: 'invalid', reason: s };
  return single('color-scheme', colorSchemeValue(s));
}

/** The scheme of a computed color-scheme value (a keyword or a list). */
export function colorSchemeOf(v: CssValue): ColorScheme {
  if (v.kind === 'keyword' && v.value === 'normal') return { kind: 'normal' };
  const text = v.kind === 'keyword' ? v.value : v.kind === 'other' && v.type === COLOR_SCHEME_LIST ? v.text : null;
  if (text === null) throw new Error(`color-scheme ${JSON.stringify(v)} is not a scheme`);
  const words = text.split(' ');
  const only = words[words.length - 1] === 'only';
  return { kind: 'list', idents: only ? words.slice(0, -1) : words, only };
}

/**
 * css-color-adjust-1 §2.1 as Chrome 145 applies it: the used scheme is dark when the list holds dark and either holds no light or
 * the user prefers dark (measured: "dark light" is light under a light preference, "foo dark" is dark).
 */
export function usedColorSchemeOf(s: ColorScheme, prefersDark: boolean): 'light' | 'dark' {
  if (s.kind === 'normal') return 'light';
  const dark = s.idents.includes('dark');
  const light = s.idents.includes('light');
  return dark && (!light || prefersDark) ? 'dark' : 'light';
}

/** The value parsers of the effects longhands (the paint value hook, css/paint-parsers.ts). */
export const EFFECTS_VALUE_PARSERS: { readonly [P in (typeof EFFECTS_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'color-scheme': parseColorScheme,
};
