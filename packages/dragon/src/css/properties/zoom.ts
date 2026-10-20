// zoom (css-viewport-1 §5): <number [0,∞]> | <percentage [0,∞]>, and normal, which Chrome 145 also parses (Zoom::ParseSingleValue:
// normal, a non-negative number or percentage, a calculation of them); initial 1, not inherited, though it multiplies into the
// descendants' effective zoom. Chrome computes a percentage to its number and 0 and normal to 1. Dragon scales no subtree yet
// (ZOOM), so it accepts the values whose zoom is 1 alone, where zoom changes nothing: 1, normal, 100%, 0 and a calculation of them.
// computed-checks refuses every other value on every target (checkZoom). zoom: 1 is the common legacy hasLayout hack.
import type { CssNode } from 'css-tree';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import type { Span } from '../../types.ts';
import type { CssValue } from '../values.ts';
import { numberCalc } from './effects.ts';

export const ZOOM_LONGHANDS = ['zoom'] as const;
export const ZOOM_SHORTHANDS = [] as const;
export const ZOOM_INHERITED: readonly (typeof ZOOM_LONGHANDS)[number][] = [];
export const ZOOM_CONTAINER: readonly (typeof ZOOM_LONGHANDS)[number][] = [];
export const ZOOM_TEXT_ROLE: readonly (typeof ZOOM_LONGHANDS)[number][] = [];

// Only zoom 1 is accepted, which neither lays out nor paints anything differently.
export const ZOOM_ASPECTS: { readonly [P in (typeof ZOOM_LONGHANDS)[number]]: PropertyAspect } = {
  zoom: { layout: false, paint: false },
};

const ZOOM_FIX = 'Write zoom as a number or a percentage, or a calc() of numbers.';
const single = (value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property: 'zoom', value, explicit: true } as LonghandValue] });

/** normal, a non-negative number or percentage, or a number calculation (folded; a negative result is dropped as Chrome drops it). */
export function parseZoom(tokens: readonly CssNode[], base: Span): ParsedValue {
  const invalid: ParsedValue = { kind: 'invalid', reason: 'zoom is normal or one non-negative number or percentage' };
  if (tokens.length !== 1) return invalid;
  const t = tokens[0] as CssNode;
  if (t.type === 'Identifier') return asciiLower(String(t['name'])) === 'normal' ? single({ kind: 'keyword', value: 'normal' }) : invalid;
  if (t.type === 'Number') return Number(t['value']) < 0 ? invalid : single({ kind: 'number', value: Number(t['value']) });
  if (t.type === 'Percentage') return Number(t['value']) < 0 ? invalid : single({ kind: 'percentage', value: Number(t['value']) });
  const calc = numberCalc('zoom', t, base, ZOOM_FIX);
  if (calc === null) return invalid;
  return 'value' in calc ? single({ kind: 'number', value: calc.value < 0 ? 0 : calc.value }) : calc;
}

/** The computed zoom of a value: the number, or the percentage / 100, with 0 and normal as 1; null for any other value. */
export function zoomOf(v: CssValue): number | null {
  if (v.kind === 'keyword') return v.value === 'normal' ? 1 : null;
  const n = v.kind === 'number' ? v.value : v.kind === 'percentage' ? v.value / 100 : null;
  if (n === null || !Number.isFinite(n)) return null;
  return n === 0 ? 1 : n;
}

export const ZOOM_VALUE_PARSERS: { readonly [P in (typeof ZOOM_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = { zoom: parseZoom };
