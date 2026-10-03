// opacity (css-color-4 §14.1), z-index (CSS2 §9.9.1, css-position-3) and color-scheme (css-color-adjust-1 §2), with Chrome 145's
// parsing: opacity is a number or a percentage, kept as written and clamped to [0, 1] at computed-value time; z-index is auto or
// an integer, clamped to the 32-bit range at parse time as Chrome does; color-scheme is normal, or light, dark and custom idents
// with at most one only, which Chrome serializes last (light and dark lowercase, custom idents as written).
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower, decodeName } from '../escapes.ts';
import { foldNumber, parseMath, V1_MATH_FUNCTIONS } from '../math.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const EFFECTS_LONGHANDS = ['opacity', 'z-index', 'color-scheme'] as const;
export const EFFECTS_SHORTHANDS = [] as const;
export const EFFECTS_INHERITED: readonly (typeof EFFECTS_LONGHANDS)[number][] = ['color-scheme'];
export const EFFECTS_CONTAINER: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];
export const EFFECTS_TEXT_ROLE: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];

export const EFFECTS_ASPECTS: { readonly [P in (typeof EFFECTS_LONGHANDS)[number]]: PropertyAspect } = {
  opacity: { layout: false, paint: true },
  'z-index': { layout: false, paint: true },
  'color-scheme': { layout: false, paint: true },
};

/** The CssValue type of an integer z-index; its text is the clamped integer. */
export const Z_INDEX_INTEGER = 'integer';
/** The CssValue type of a color-scheme list; its text is Chrome's serialization. */
export const COLOR_SCHEME_LIST = 'color-scheme-list';

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

const single = (property: string, value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property, value, explicit: true } as LonghandValue] });

function refuse(property: string, t: CssNode, base: Span, why: string, manual: string): ParsedValue {
  return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `${property}: ${generate(t)} is unsupported: ${why}`, manual }) };
}

/** A number calculation folded now (css-values-4 §10), or the refusal; null for a token that is not a math function. */
function numberCalc(property: string, t: CssNode, base: Span, manual: string): { readonly value: number } | ParsedValue | null {
  if (t.type !== 'Function' || !V1_MATH_FUNCTIONS.has(asciiLower(String(t['name'])))) return null;
  const parsed = parseMath(generate(t), { type: 'number' });
  if (!parsed.ok) return refuse(property, t, base, parsed.reason, manual);
  return { value: foldNumber(parsed.node) };
}

const OPACITY_FIX = 'Write opacity as a number or a percentage, or a calc() of numbers.';

/** css-color-4 §14.1: <opacity-value> is a number or a percentage; any value parses, and the computed value is clamped. */
export function parseOpacity(tokens: readonly CssNode[], base: Span): ParsedValue {
  if (tokens.length !== 1) return { kind: 'invalid', reason: 'opacity is one number or percentage' };
  const t = tokens[0] as CssNode;
  if (t.type === 'Number') return single('opacity', { kind: 'number', value: Number(t['value']) });
  if (t.type === 'Percentage') return single('opacity', { kind: 'percentage', value: Number(t['value']) });
  const calc = numberCalc('opacity', t, base, OPACITY_FIX);
  if (calc === null) return { kind: 'invalid', reason: 'opacity is one number or percentage' };
  return 'value' in calc ? single('opacity', { kind: 'number', value: calc.value }) : calc;
}

/** The computed opacity of a declared value: the number, or the percentage / 100, clamped to [0, 1]; null for any other value. */
export function opacityOf(v: CssValue): number | null {
  const n = v.kind === 'number' ? v.value : v.kind === 'percentage' ? v.value / 100 : null;
  if (n === null || !Number.isFinite(n)) return null;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

const Z_FIX = 'Write z-index as auto or an integer.';

/** Chrome clamps an integer outside the 32-bit range to its bounds when it parses it. */
const clampInt = (n: number): number => (n < INT_MIN ? INT_MIN : n > INT_MAX ? INT_MAX : n);

/** An integer z-index value. */
export const zIndexValue = (n: number): CssValue => ({ kind: 'other', type: Z_INDEX_INTEGER, text: String(n === 0 ? 0 : n) });

/** CSS2 §9.9.1: auto or an <integer>; a calculation must give a whole number (Chrome rounds others, which Dragon refuses). */
export function parseZIndex(tokens: readonly CssNode[], base: Span): ParsedValue {
  if (tokens.length !== 1) return { kind: 'invalid', reason: 'z-index is auto or one integer' };
  const t = tokens[0] as CssNode;
  if (t.type === 'Identifier' && asciiLower(String(t['name'])) === 'auto') return single('z-index', { kind: 'keyword', value: 'auto' });
  if (t.type === 'Number') {
    const text = String(t['value']);
    if (!/^[+-]?\d+$/.test(text)) return { kind: 'invalid', reason: 'z-index takes an integer' };
    return single('z-index', zIndexValue(clampInt(Number(text))));
  }
  const calc = numberCalc('z-index', t, base, Z_FIX);
  if (calc === null) return { kind: 'invalid', reason: 'z-index is auto or one integer' };
  if (!('value' in calc)) return calc;
  if (!Number.isInteger(calc.value)) return refuse('z-index', t, base, 'the calculation is not a whole number, which Chrome rounds and Dragon does not', Z_FIX);
  return single('z-index', zIndexValue(clampInt(calc.value)));
}

/** The z-index of a computed value: null for auto, else the integer. */
export function zIndexOf(v: CssValue): number | null {
  if (v.kind === 'keyword' && v.value === 'auto') return null;
  if (v.kind !== 'other' || v.type !== Z_INDEX_INTEGER) throw new Error(`z-index ${JSON.stringify(v)} is neither auto nor an integer`);
  const n = Number(v.text);
  if (!Number.isInteger(n)) throw new Error(`z-index ${v.text} is not an integer`);
  return n;
}

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
  opacity: parseOpacity,
  'z-index': parseZIndex,
  'color-scheme': parseColorScheme,
};
