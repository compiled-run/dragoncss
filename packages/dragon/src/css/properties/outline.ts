// Outlines (css-ui-4 §3): outline-color, outline-style, outline-width and outline-offset, with Chrome 145's parsing beyond the
// webref grammar: outline-color takes a <color> (auto and invert are invalid), outline-style takes hidden as invalid, outline-width
// takes a non-negative length or thin, medium or thick (hairline is invalid), and outline-offset takes a length.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { parseColorNode } from '../color.ts';
import { asciiLower } from '../escapes.ts';
import { V1_MATH_FUNCTIONS } from '../math.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import { normalizeUnit, unitEntry } from '../units.ts';
import type { CssValue } from '../values.ts';
import { COLOR_FIX } from '../values.ts';

export const OUTLINE_LONGHANDS = ['outline-color', 'outline-style', 'outline-width', 'outline-offset'] as const;
export const OUTLINE_SHORTHANDS = ['outline'] as const;
export const OUTLINE_INHERITED: readonly (typeof OUTLINE_LONGHANDS)[number][] = [];
export const OUTLINE_CONTAINER: readonly (typeof OUTLINE_LONGHANDS)[number][] = [];
export const OUTLINE_TEXT_ROLE: readonly (typeof OUTLINE_LONGHANDS)[number][] = [];

export type OutlineLonghand = (typeof OUTLINE_LONGHANDS)[number];

export const OUTLINE_ASPECTS: { readonly [P in OutlineLonghand]: PropertyAspect } = {
  'outline-color': { layout: false, paint: true },
  'outline-style': { layout: false, paint: true },
  'outline-width': { layout: false, paint: true },
  'outline-offset': { layout: false, paint: true },
};

/** css-ui-4 §3.3: <outline-line-style>; hidden is not one. */
export const OUTLINE_STYLES: ReadonlySet<string> = new Set(['none', 'auto', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
/** The line-width keywords Chrome 145 accepts, and their px (css-backgrounds-3 §3.3). */
export const OUTLINE_WIDTH_KEYWORDS: { readonly [k: string]: number } = { thin: 1, medium: 3, thick: 5 };

const WIDTH_FIX = 'Write the outline width as px, em, rem or an absolute length, or thin, medium or thick.';
const OFFSET_FIX = 'Write the outline offset as px, em, rem or an absolute length.';

type Read = { readonly ok: CssValue } | { readonly refused: ParsedValue } | { readonly invalid: string };

const refused = (property: string, t: CssNode, base: Span, why: string, manual: string): Read => ({
  refused: { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `${property}: ${generate(t)} is unsupported: ${why}`, manual }) },
});

/** A length token of an outline width or offset: 0, or a unit with a build-time px value; null for a token that is not one. */
function lengthToken(property: string, t: CssNode, base: Span, nonNegative: boolean, manual: string): Read | null {
  if (t.type === 'Number') return Number(t['value']) === 0 ? { ok: { kind: 'length', value: 0, unit: 'px' } } : { invalid: 'a length other than 0 needs a unit' };
  if (t.type === 'Function' && V1_MATH_FUNCTIONS.has(asciiLower(String(t['name'])))) return refused(property, t, base, 'a calculation in an outline is not supported (PNT1 takes lengths)', manual);
  if (t.type !== 'Dimension') return null;
  const value = Number(t['value']);
  const unit = normalizeUnit(String(t['unit']));
  const c = unitEntry(unit)?.conversion;
  if (c === undefined) return { invalid: `${unit} is not a length unit` };
  if (nonNegative && value < 0) return { invalid: 'an outline width may not be negative' };
  if (c.kind === 'refused') return refused(property, t, base, c.reason, manual);
  if (c.kind === 'viewport') return refused(property, t, base, 'an outline length in a viewport unit would need the device viewport on the native side (PNT1 takes px, em, rem and absolute lengths)', manual);
  return { ok: { kind: 'length', value, unit } };
}

function widthToken(t: CssNode, base: Span): Read | null {
  if (t.type === 'Identifier') {
    const k = asciiLower(String(t['name']));
    return OUTLINE_WIDTH_KEYWORDS[k] === undefined ? null : { ok: { kind: 'keyword', value: k } };
  }
  return lengthToken('outline-width', t, base, true, WIDTH_FIX);
}

function styleToken(t: CssNode): Read | null {
  if (t.type !== 'Identifier') return null;
  const k = asciiLower(String(t['name']));
  return OUTLINE_STYLES.has(k) ? { ok: { kind: 'keyword', value: k } } : null;
}

function colorToken(t: CssNode, base: Span): Read | null {
  if (t.type === 'Identifier' && ['auto', 'invert'].includes(asciiLower(String(t['name'])))) return { invalid: `${asciiLower(String(t['name']))} is not an outline colour in Chrome 145` };
  if (t.type !== 'Identifier' && t.type !== 'Hash' && t.type !== 'Function') return null;
  const c = parseColorNode(t);
  // The grammar check has run, so a colour that does not parse is one outside the subset (a system colour, lab()), not a typo.
  if (!c.ok) return refused('outline-color', t, base, c.reason, COLOR_FIX);
  return { ok: c.kind === 'keyword' ? { kind: 'keyword', value: c.keyword } : { kind: 'color', value: c.value, syntax: c.syntax } };
}

function one(property: OutlineLonghand, tokens: readonly CssNode[], read: (t: CssNode) => Read | null): ParsedValue {
  if (tokens.length !== 1) return { kind: 'invalid', reason: `${property} is one value` };
  const r = read(tokens[0] as CssNode);
  if (r === null) return { kind: 'invalid', reason: `${generate(tokens[0] as CssNode)} is not a value of ${property}` };
  if ('refused' in r) return r.refused;
  if ('invalid' in r) return { kind: 'invalid', reason: r.invalid };
  const longhands: LonghandValue[] = [{ property, value: r.ok, explicit: true }];
  return { kind: 'ok', longhands };
}

/** css-ui-4 §3.1: outline is a width, a style and a colour in any order, each at most once; an omitted one takes its initial value. */
export function parseOutline(tokens: readonly CssNode[], base: Span): ParsedValue {
  if (tokens.length < 1 || tokens.length > 3) return { kind: 'invalid', reason: 'outline is at most a width, a style and a colour' };
  const got: { width?: CssValue; style?: CssValue; color?: CssValue } = {};
  for (const t of tokens) {
    for (const [slot, read] of [['style', styleToken], ['width', (x: CssNode) => widthToken(x, base)], ['color', (x: CssNode) => colorToken(x, base)]] as const) {
      const r = read(t);
      if (r === null) continue;
      if ('refused' in r) return r.refused;
      if ('invalid' in r) return { kind: 'invalid', reason: r.invalid };
      if (got[slot] !== undefined) return { kind: 'invalid', reason: `outline has two ${slot}s` };
      got[slot] = r.ok;
      break;
    }
    if (got.style === undefined && got.width === undefined && got.color === undefined) return { kind: 'invalid', reason: `${generate(t)} is not a value of outline` };
  }
  if (tokens.length !== Object.keys(got).length) return { kind: 'invalid', reason: 'a value of outline is not a width, a style or a colour' };
  const lh = (property: OutlineLonghand, v: CssValue | undefined, initial: CssValue): LonghandValue => ({ property, value: v ?? initial, explicit: v !== undefined });
  return {
    kind: 'ok',
    longhands: [
      lh('outline-color', got.color, { kind: 'keyword', value: 'currentcolor' }),
      lh('outline-style', got.style, { kind: 'keyword', value: 'none' }),
      lh('outline-width', got.width, { kind: 'keyword', value: 'medium' }),
    ],
  };
}

/** The value parsers of the outline longhands and shorthand (stylesheet.ts parseValue). */
export const OUTLINE_VALUE_PARSERS: { readonly [P in OutlineLonghand | 'outline']: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'outline-color': (tokens, base) => one('outline-color', tokens, (t) => colorToken(t, base)),
  'outline-style': (tokens) => one('outline-style', tokens, styleToken),
  'outline-width': (tokens, base) => one('outline-width', tokens, (t) => widthToken(t, base)),
  'outline-offset': (tokens, base) => one('outline-offset', tokens, (t) => lengthToken('outline-offset', t, base, false, OFFSET_FIX)),
  outline: parseOutline,
};
