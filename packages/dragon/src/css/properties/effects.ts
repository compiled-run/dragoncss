// opacity (css-color-4 §14.1) and z-index (CSS2 §9.9.1, css-position-3), with Chrome 145's parsing: opacity is a number or a
// percentage, kept as written and clamped to [0, 1] at computed-value time; z-index is auto or an integer, clamped to the 32-bit
// range at parse time as Chrome does.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import { BLINK_MATH_FUNCTIONS, foldNumber, parseMath, V1_MATH_FUNCTIONS } from '../math.ts';
import { mathFunctionRefusal } from '../units.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const EFFECTS_LONGHANDS = ['opacity', 'z-index'] as const;
export const EFFECTS_SHORTHANDS = [] as const;
export const EFFECTS_INHERITED: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];
export const EFFECTS_CONTAINER: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];
export const EFFECTS_TEXT_ROLE: readonly (typeof EFFECTS_LONGHANDS)[number][] = [];

export const EFFECTS_ASPECTS: { readonly [P in (typeof EFFECTS_LONGHANDS)[number]]: PropertyAspect } = {
  opacity: { layout: false, paint: true },
  'z-index': { layout: false, paint: true },
};

/** The CssValue type of an integer z-index; its text is the clamped integer. */
export const Z_INDEX_INTEGER = 'integer';

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

const single = (property: string, value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property, value, explicit: true } as LonghandValue] });

function refuse(property: string, t: CssNode, base: Span, why: string, manual: string): ParsedValue {
  return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `${property}: ${generate(t)} is unsupported: ${why}`, manual }) };
}

/** A number calculation folded now (css-values-4 §10), or the refusal; null for a token that is not a math function. */
function numberCalc(property: string, t: CssNode, base: Span, manual: string): { readonly value: number } | ParsedValue | null {
  if (t.type !== 'Function') return null;
  const name = asciiLower(String(t['name']));
  if (!BLINK_MATH_FUNCTIONS.has(name)) return null;
  // A math function Chrome accepts and Dragon does not evaluate (round(), abs(), sin(), ...) is refused, never dropped.
  if (!V1_MATH_FUNCTIONS.has(name)) return refuse(property, t, base, mathFunctionRefusal(name)?.reason ?? `${name}() is not supported`, manual);
  const text = generate(t);
  const parsed = parseMath(text, { type: 'number' });
  // parseMath's number context reads a percentage as a type error; Chrome resolves one in opacity, which Dragon does not yet.
  if (!parsed.ok) return refuse(property, t, base, text.includes('%') ? 'a percentage inside a calculation is not supported' : parsed.reason, manual);
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

/** The value parsers of the effects longhands (stylesheet.ts parseValue). */
export const EFFECTS_VALUE_PARSERS: { readonly [P in (typeof EFFECTS_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  opacity: parseOpacity,
  'z-index': parseZIndex,
};
