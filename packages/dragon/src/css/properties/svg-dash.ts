// SVG-dash: stroke-dasharray (css-fill-stroke-3 §7.5, Blink StrokeDasharray::ParseSingleValue) is none or a list of non-negative
// lengths, percentages or (SVG attribute mode) numbers, each followed by an optional comma. Chrome computes a number to px and
// serializes the list comma-separated ("4px, 2px", "10%"). Dragon keeps the list as that text; a length in any unit but px, and a
// calculation, are refused until SVG-units resolves them, and a percentage parses here and is refused on the shape
// (computed-checks.ts checkSvg), as a percentage stroke-width is.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { chromeNumber } from '../chrome-number.ts';
import { asciiLower } from '../escapes.ts';
import type { ParsedValue } from '../stylesheet.ts';
import { normalizeUnit } from '../units.ts';
import type { CssValue } from '../values.ts';

/** The CssValue type of a stroke-dasharray list; its text is the list as Chrome serializes the computed value. */
export const DASH_ARRAY = 'dash-array';

const DASH_FIX = 'Write each stroke-dasharray value as a number or in px.';

function parseDashArray(tokens: readonly CssNode[], base: Span): ParsedValue {
  const ok = (value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property: 'stroke-dasharray', value, explicit: true }] });
  if (tokens.length === 1 && tokens[0]?.type === 'Identifier' && asciiLower(String(tokens[0]['name'])) === 'none') return ok({ kind: 'keyword', value: 'none' });
  const out: string[] = [];
  for (const t of tokens) {
    if (t.type === 'Operator' && t['value'] === ',') continue;
    const refuse = (why: string): ParsedValue => ({ kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `stroke-dasharray: ${generate(t)} is unsupported: ${why}`, manual: DASH_FIX }) });
    if (t.type === 'Number') out.push(`${chromeNumber(Number(t['value']))}px`);
    else if (t.type === 'Percentage') out.push(`${chromeNumber(Number(t['value']))}%`);
    else if (t.type === 'Dimension' && normalizeUnit(String(t['unit'])) === 'px') out.push(`${chromeNumber(Number(t['value']))}px`);
    else if (t.type === 'Dimension') return refuse(`a dash in ${String(t['unit'])} is not resolved yet (package SVG-units)`);
    else if (t.type === 'Function') return refuse('a calculated dash is not resolved yet (package SVG-units)');
    else return { kind: 'invalid', reason: 'stroke-dasharray is none or a list of lengths, percentages or numbers' };
  }
  return ok({ kind: 'other', type: DASH_ARRAY, text: out.join(', ') });
}

/**
 * The dashes of a computed stroke-dasharray: [] for none, the px lengths of a list, or 'percentage' when one is a percentage (of the
 * viewport diagonal, not resolved yet).
 */
export function dashArrayOf(v: CssValue): readonly number[] | 'percentage' {
  if (v.kind === 'keyword' && v.value === 'none') return [];
  if (v.kind !== 'other' || v.type !== DASH_ARRAY) throw new Error(`stroke-dasharray computed to ${v.kind}`);
  const items = v.text.split(', ');
  if (items.some((d) => d.endsWith('%'))) return 'percentage';
  return items.map((d) => Number(d.slice(0, -2)));
}

/** The value parser of stroke-dasharray (the value hook, css/paint-parsers.ts). */
export const SVG_DASH_VALUE_PARSERS: { readonly 'stroke-dasharray': (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'stroke-dasharray': parseDashArray,
};
