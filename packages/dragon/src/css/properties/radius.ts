// Border radii (css-backgrounds-3 §5.1): the four corner longhands, each one or two <length-percentage [0,∞]>. Chrome 145 computes
// each length to px (em and rem included), keeps percentages, and serializes a corner whose two components are equal as one.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import { normalizeUnit, unitEntry } from '../units.ts';
import type { CssValue } from '../values.ts';

export const RADIUS_LONGHANDS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] as const;
export const RADIUS_SHORTHANDS = ['border-radius', '-webkit-border-radius'] as const;
export const RADIUS_INHERITED: readonly (typeof RADIUS_LONGHANDS)[number][] = [];
export const RADIUS_CONTAINER: readonly (typeof RADIUS_LONGHANDS)[number][] = [];
export const RADIUS_TEXT_ROLE: readonly (typeof RADIUS_LONGHANDS)[number][] = [];

export type RadiusLonghand = (typeof RADIUS_LONGHANDS)[number];

export const RADIUS_ASPECTS: { readonly [P in RadiusLonghand]: PropertyAspect } = {
  'border-top-left-radius': { layout: false, paint: true },
  'border-top-right-radius': { layout: false, paint: true },
  'border-bottom-right-radius': { layout: false, paint: true },
  'border-bottom-left-radius': { layout: false, paint: true },
};

/** The CssValue type of a corner with two different components ("<h> <v>"); its text holds the two components as written. */
export const RADIUS_PAIR = 'radius-pair';

/** One component of a corner radius: a length in a unit with a build-time px value, or a percentage of the border box axis. */
export type RadiusComponent = { readonly kind: 'length'; readonly value: number; readonly unit: string } | { readonly kind: 'percentage'; readonly value: number };

const RADIUS_FIX = 'Write each radius as px, em, rem, an absolute length or a percentage.';

/** A number in CSS text, without exponent notation (JavaScript writes 1e-7 and 1e+21 with one). */
function numberText(n: number): string {
  const s = String(n === 0 ? 0 : n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (m === null) return s;
  const sign = m[1] as string;
  const frac = m[3] === undefined ? '' : m[3];
  const digits = `${m[2] as string}${frac}`;
  const exp = Number(m[4]);
  return exp < 0 ? `${sign}0.${'0'.repeat(-exp - 1)}${digits}` : `${sign}${digits}${'0'.repeat(exp - frac.length)}`;
}

export const componentText = (c: RadiusComponent): string => (c.kind === 'percentage' ? `${numberText(c.value)}%` : `${numberText(c.value)}${c.unit}`);

/** The CssValue of a corner from its two components: one value when they are the same, else a radius pair. */
export function cornerValue(h: RadiusComponent, v: RadiusComponent): CssValue {
  const same = h.kind === v.kind && h.value === v.value && (h.kind === 'percentage' || (v.kind === 'length' && h.unit === v.unit));
  if (same) return h.kind === 'percentage' ? { kind: 'percentage', value: h.value } : { kind: 'length', value: h.value, unit: h.unit };
  return { kind: 'other', type: RADIUS_PAIR, text: `${componentText(h)} ${componentText(v)}` };
}

/** The two components of a corner value (a length, a percentage or a radius pair); null for any other value. */
export function cornerComponents(v: CssValue): readonly [RadiusComponent, RadiusComponent] | null {
  if (v.kind === 'length') return [{ kind: 'length', value: v.value, unit: v.unit }, { kind: 'length', value: v.value, unit: v.unit }];
  if (v.kind === 'percentage') return [{ kind: 'percentage', value: v.value }, { kind: 'percentage', value: v.value }];
  if (v.kind !== 'other' || v.type !== RADIUS_PAIR) return null;
  const parts = v.text.split(' ').map(parseComponentText);
  const [h, w] = parts;
  if (parts.length !== 2 || h === undefined || h === null || w === undefined || w === null) throw new Error(`radius pair ${JSON.stringify(v.text)} is not two components`);
  return [h, w];
}

function parseComponentText(t: string): RadiusComponent | null {
  const m = /^(-?(?:\d+\.?\d*|\.\d+))(%|[a-z]+)$/.exec(t);
  if (m === null) return null;
  const value = Number(m[1]);
  return m[2] === '%' ? { kind: 'percentage', value } : { kind: 'length', value, unit: m[2] as string };
}

/** The outcome of reading one radius token: a component, a refusal, or invalid. */
type TokenResult = { readonly ok: RadiusComponent } | { readonly refused: ParsedValue } | { readonly invalid: string };

/**
 * One <length-percentage [0,∞]> token: a negative value is invalid (Chrome drops the declaration); a calculation, and a unit with
 * no build-time px value (viewport, font-metric and container units), are refused, since the native side needs px or a percentage.
 */
export function radiusToken(property: string, t: CssNode, base: Span): TokenResult {
  const refuse = (message: string): TokenResult => ({ refused: { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message, manual: RADIUS_FIX }) } });
  if (t.type === 'Percentage') {
    const value = Number(t['value']);
    return value < 0 ? { invalid: 'a radius may not be negative' } : { ok: { kind: 'percentage', value } };
  }
  if (t.type === 'Number') {
    const value = Number(t['value']);
    return value === 0 ? { ok: { kind: 'length', value: 0, unit: 'px' } } : { invalid: 'a radius other than 0 needs a unit' };
  }
  if (t.type === 'Dimension') {
    const value = Number(t['value']);
    const unit = normalizeUnit(String(t['unit']));
    if (value < 0) return { invalid: 'a radius may not be negative' };
    const c = unitEntry(unit)?.conversion;
    if (c === undefined) return { invalid: `${unit} is not a length unit` };
    if (c.kind === 'refused') return refuse(`${property}: ${generate(t)} is unsupported: ${c.reason}`);
    if (c.kind === 'viewport') return refuse(`${property}: ${generate(t)} is unsupported: a border radius in a viewport unit would need the device viewport on the native side (PNT1 takes px and percentages)`);
    return { ok: { kind: 'length', value, unit } };
  }
  if (t.type === 'Function') return refuse(`${property}: ${generate(t)} is unsupported: a calculation in a border radius is not supported (PNT1 takes one length or percentage per component)`);
  return { invalid: `${generate(t)} is not a length or percentage` };
}

/** css-backgrounds-3 §5.1: a corner longhand is one or two components; one component sets both. */
export function parseCorner(property: RadiusLonghand, tokens: readonly CssNode[], base: Span): ParsedValue {
  if (tokens.length < 1 || tokens.length > 2) return { kind: 'invalid', reason: 'a corner radius is one or two lengths or percentages' };
  const parts: RadiusComponent[] = [];
  for (const t of tokens) {
    const r = radiusToken(property, t, base);
    if ('refused' in r) return r.refused;
    if ('invalid' in r) return { kind: 'invalid', reason: r.invalid };
    parts.push(r.ok);
  }
  const h = parts[0] as RadiusComponent;
  const longhands: LonghandValue[] = [{ property, value: cornerValue(h, parts[1] ?? h), explicit: true }];
  return { kind: 'ok', longhands };
}

/** The value parsers of the radius longhands (the paint value hook, css/paint-parsers.ts). */
export const RADIUS_VALUE_PARSERS: { readonly [P in RadiusLonghand]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'border-top-left-radius': (tokens, base) => parseCorner('border-top-left-radius', tokens, base),
  'border-top-right-radius': (tokens, base) => parseCorner('border-top-right-radius', tokens, base),
  'border-bottom-right-radius': (tokens, base) => parseCorner('border-bottom-right-radius', tokens, base),
  'border-bottom-left-radius': (tokens, base) => parseCorner('border-bottom-left-radius', tokens, base),
};
