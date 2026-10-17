// SVG-paint-order: paint-order (css-fill-stroke-3 §9, Blink PaintOrder::ParseSingleValue) is normal or fill, stroke and markers,
// each at most once, in any order. Chrome keeps only the canonical prefix of the list: the first item, and the second when it is
// not the one the default order (fill, stroke, markers) puts next ("fill stroke markers" computes to fill, "stroke markers fill"
// to stroke markers). Dragon keeps that prefix as text; no shape has markers, so a shape reads only whether its stroke paints
// before its fill (paintsStrokeFirst).
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

/** The CssValue type of a paint-order list; its text is the list as Chrome serializes the computed value. */
export const PAINT_ORDER = 'paint-order';

const ITEMS = ['fill', 'stroke', 'markers'] as const;

function parsePaintOrder(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const ok = (value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property: 'paint-order', value, explicit: true }] });
  const invalid: ParsedValue = { kind: 'invalid', reason: 'paint-order is normal or fill, stroke and markers, each at most once' };
  const words = tokens.map((t) => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : null));
  if (words.length === 1 && words[0] === 'normal') return ok({ kind: 'keyword', value: 'normal' });
  if (words.length === 0 || words.length > 3) return invalid;
  const list: (typeof ITEMS)[number][] = [];
  for (const w of words) {
    if (w === null || !(ITEMS as readonly string[]).includes(w) || (list as string[]).includes(w)) return invalid;
    list.push(w as (typeof ITEMS)[number]);
  }
  const first = list[0] as (typeof ITEMS)[number];
  const second = list[1];
  // The item the default order puts after the first: fill and stroke are followed by the earliest remaining of the default order.
  const next = ITEMS.find((i) => i !== first);
  const kept = second !== undefined && second !== next ? [first, second] : [first];
  return ok({ kind: 'other', type: PAINT_ORDER, text: kept.join(' ') });
}

/** Whether a computed paint-order paints the stroke before the fill: the full order is the list, then the rest in default order. */
export function paintsStrokeFirst(v: CssValue): boolean {
  if (v.kind === 'keyword' && v.value === 'normal') return false;
  if (v.kind !== 'other' || v.type !== PAINT_ORDER) throw new Error(`paint-order computed to ${v.kind}`);
  const listed = v.text.split(' ');
  const full = [...listed, ...ITEMS.filter((i) => !listed.includes(i))];
  return full.indexOf('stroke') < full.indexOf('fill');
}

/** The value parser of paint-order (the value hook, css/paint-parsers.ts). */
export const SVG_PAINT_ORDER_VALUE_PARSERS: { readonly 'paint-order': (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'paint-order': parsePaintOrder,
};
