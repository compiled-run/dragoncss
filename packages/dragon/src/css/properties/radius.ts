// Border radii (css-backgrounds-3 §5.1): the four corner longhands, each one or two <length-percentage [0,∞]>. Chrome 145 computes
// each length to px (em and rem included), keeps percentages, and serializes a corner whose two components are equal as one. A
// calculation (calc(), min(), max(), clamp()) computes as css/math.ts nonNegativeLengthMath: to px, to a percentage, or, mixing
// both, to calc(<percentage> + <px>).
// The flow-relative corners (css-logical-1 §7) are surrogates of one physical corner per direction, as properties/logical.ts's are,
// so they are shorthands here: Chrome resolves them at cascade time (CSSDirectionAwareResolver), with the value copied unchanged.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { MathContext, MathNode } from '../math.ts';
import { foldableUnits, mathInvalidity, nonNegativeLengthMath, parseMath, V1_MATH_FUNCTIONS } from '../math.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import { normalizeUnit, unitEntry } from '../units.ts';
import type { CssValue } from '../values.ts';

export const RADIUS_LONGHANDS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] as const;
export const RADIUS_SHORTHANDS = ['border-radius', '-webkit-border-radius', 'border-start-start-radius', 'border-start-end-radius', 'border-end-start-radius', 'border-end-end-radius'] as const;
export const RADIUS_INHERITED: readonly (typeof RADIUS_LONGHANDS)[number][] = [];
export const RADIUS_CONTAINER: readonly (typeof RADIUS_LONGHANDS)[number][] = [];
export const RADIUS_TEXT_ROLE: readonly (typeof RADIUS_LONGHANDS)[number][] = [];

export type RadiusLonghand = (typeof RADIUS_LONGHANDS)[number];
export type LogicalRadius = Exclude<(typeof RADIUS_SHORTHANDS)[number], 'border-radius' | '-webkit-border-radius'>;

/**
 * css-logical-1 §7 in horizontal-tb: the physical corner of each flow-relative corner, per direction. Block start and end are top
 * and bottom; inline start is left in ltr and right in rtl.
 */
export const LOGICAL_CORNERS: { readonly [P in LogicalRadius]: { readonly ltr: RadiusLonghand; readonly rtl: RadiusLonghand } } = {
  'border-start-start-radius': { ltr: 'border-top-left-radius', rtl: 'border-top-right-radius' },
  'border-start-end-radius': { ltr: 'border-top-right-radius', rtl: 'border-top-left-radius' },
  'border-end-start-radius': { ltr: 'border-bottom-left-radius', rtl: 'border-bottom-right-radius' },
  'border-end-end-radius': { ltr: 'border-bottom-right-radius', rtl: 'border-bottom-left-radius' },
};
export const LOGICAL_CORNER_PROPERTIES = Object.keys(LOGICAL_CORNERS) as LogicalRadius[];

export const RADIUS_ASPECTS: { readonly [P in RadiusLonghand]: PropertyAspect } = {
  'border-top-left-radius': { layout: false, paint: true },
  'border-top-right-radius': { layout: false, paint: true },
  'border-bottom-right-radius': { layout: false, paint: true },
  'border-bottom-left-radius': { layout: false, paint: true },
};

/** The CssValue type of a corner with two different components ("<h> <v>"); its text holds the two components as written. */
export const RADIUS_PAIR = 'radius-pair';
/** The CssValue type of a corner with two different components, at least one a calculation; its own feature key. */
export const RADIUS_CALC_PAIR = 'radius-calc-pair';
/** The CssValue types of a corner that is one calculation: its function's name, the feature key layout calculations use. */
const RADIUS_MATH_TYPES: ReadonlySet<string> = new Set([...V1_MATH_FUNCTIONS].map((f) => `${f}()`));

/**
 * One component of a corner radius: a length in a unit with a build-time px value, a percentage of the border box axis, or a
 * calculation, as written (specified) or as calc(<percentage> + <px>) once computed (a computed one of px or % alone is a length
 * or a percentage).
 */
export type RadiusComponent = { readonly kind: 'length'; readonly value: number; readonly unit: string } | { readonly kind: 'percentage'; readonly value: number } | { readonly kind: 'calc'; readonly text: string };

const RADIUS_FIX = 'Write each radius as px, em, rem, an absolute length, a percentage, or a calculation of them.';

/** css-values-4 §10: a calculation in a radius, with its constants (calc(infinity * 1px) is the pill shape). */
export const RADIUS_MATH: MathContext = { type: 'length', percent: true, constants: true };

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

export const componentText = (c: RadiusComponent): string => (c.kind === 'calc' ? c.text : c.kind === 'percentage' ? `${numberText(c.value)}%` : `${numberText(c.value)}${c.unit}`);

/** A calculation's text written with every number in full (no exponent), so a computed one reads back to the same doubles. */
export const exactNumberText = numberText;

/** The function name of a calculation's text ("calc", "min", "max" or "clamp"). */
const mathName = (text: string): string => asciiLower(text.slice(0, text.indexOf('(')));

/** The CssValue of a corner from its two components: one value when they are the same, else a radius pair. */
export function cornerValue(h: RadiusComponent, v: RadiusComponent): CssValue {
  if (h.kind === 'calc' || v.kind === 'calc') {
    if (h.kind === 'calc' && v.kind === 'calc' && h.text === v.text) return { kind: 'other', type: `${mathName(h.text)}()`, text: h.text };
    return { kind: 'other', type: RADIUS_CALC_PAIR, text: `${componentText(h)} ${componentText(v)}` };
  }
  const same = h.kind === v.kind && h.value === v.value && (h.kind === 'percentage' || (v.kind === 'length' && h.unit === v.unit));
  if (same) return h.kind === 'percentage' ? { kind: 'percentage', value: h.value } : { kind: 'length', value: h.value, unit: h.unit };
  return { kind: 'other', type: RADIUS_PAIR, text: `${componentText(h)} ${componentText(v)}` };
}

/** The text split at its top-level spaces (outside parentheses). */
function topLevelParts(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ' ' && depth === 0) {
      out.push(text.slice(from, i));
      from = i + 1;
    }
  }
  out.push(text.slice(from));
  return out;
}

/** The two components of a corner value (a length, a percentage, a calculation or a radius pair); null for any other value. */
export function cornerComponents(v: CssValue): readonly [RadiusComponent, RadiusComponent] | null {
  if (v.kind === 'length') return [{ kind: 'length', value: v.value, unit: v.unit }, { kind: 'length', value: v.value, unit: v.unit }];
  if (v.kind === 'percentage') return [{ kind: 'percentage', value: v.value }, { kind: 'percentage', value: v.value }];
  if (v.kind !== 'other') return null;
  if (RADIUS_MATH_TYPES.has(v.type)) return [{ kind: 'calc', text: v.text }, { kind: 'calc', text: v.text }];
  if (v.type !== RADIUS_PAIR && v.type !== RADIUS_CALC_PAIR) return null;
  const parts = topLevelParts(v.text).map(parseComponentText);
  const [h, w] = parts;
  if (parts.length !== 2 || h === undefined || h === null || w === undefined || w === null) throw new Error(`radius pair ${JSON.stringify(v.text)} is not two components`);
  return [h, w];
}

/** A computed calculation component's PixelsAndPercent (zoom-1 css px, and %); null for a specified one that reads em or rem. */
export function calcParts(c: RadiusComponent & { readonly kind: 'calc' }): { readonly pixels: number; readonly percent: number } | null {
  const parsed = parseMath(c.text, RADIUS_MATH);
  if (!parsed.ok) throw new Error(`radius calculation ${JSON.stringify(c.text)} does not parse: ${parsed.reason}`);
  if (!computedUnits(parsed.node)) return null;
  const r = nonNegativeLengthMath(parsed.node, { em: 0, rem: 0 }, exactNumberText);
  return r.kind === 'pixels-and-percent' ? { pixels: r.pixels, percent: r.percent } : null;
}

/** Whether a calculation holds only numbers, px and percentages, as a computed one does. */
function computedUnits(n: MathNode): boolean {
  return n.t === 'lit' ? n.unit === '' || n.unit === '%' || n.unit === 'px' : n.args.every(computedUnits);
}

/**
 * Whether a component may be above 0: a length or percentage above 0, or a calculation (a computed one when its pixels or its
 * percentage is above 0). Blink's style keeps a calculated radius as a calculation, so its corner counts as rounded.
 */
export function componentMayRound(c: RadiusComponent): boolean {
  if (c.kind !== 'calc') return c.value > 0;
  const parts = calcParts(c);
  return parts === null || parts.pixels > 0 || parts.percent > 0;
}

/** Whether a component is 0 whatever the box: a zero length or percentage (a calculation never is, as Blink's style keeps it). */
export const componentZero = (c: RadiusComponent): boolean => c.kind !== 'calc' && c.value === 0;

function parseComponentText(t: string): RadiusComponent | null {
  if (V1_MATH_FUNCTIONS.has(mathName(t)) && t.endsWith(')')) return { kind: 'calc', text: t };
  const m = /^(-?(?:\d+\.?\d*|\.\d+))(%|[a-z]+)$/.exec(t);
  if (m === null) return null;
  const value = Number(m[1]);
  return m[2] === '%' ? { kind: 'percentage', value } : { kind: 'length', value, unit: m[2] as string };
}

/** The outcome of reading one radius token: a component, a refusal, or invalid. */
type TokenResult = { readonly ok: RadiusComponent } | { readonly refused: ParsedValue } | { readonly invalid: string };

/**
 * A math function token of a radius: invalid where Chrome drops it (mathInvalidity); refused when it reads a unit with no
 * build-time px value (viewport, safe-area, font-metric or container units) or keeps an expression Dragon does not compute
 * (nonNegativeLengthMath); otherwise the calculation as written, which analysis/paint-values/radius.ts computes per element.
 */
function mathToken(property: string, t: CssNode, refuse: (message: string) => TokenResult): TokenResult {
  const text = generate(t);
  const name = asciiLower(String(t['name']));
  if (!V1_MATH_FUNCTIONS.has(name)) return refuse(`${property}: ${text} is unsupported: ${name}() in a border radius is not supported (PNT1 takes calc(), min(), max() and clamp())`);
  const invalid = mathInvalidity(text, 'length-percentage');
  if (invalid !== null) return { invalid };
  const parsed = parseMath(text, RADIUS_MATH);
  if (!parsed.ok) return refuse(`${property}: ${text} is unsupported: ${parsed.reason}`);
  if (!foldableUnits(parsed.node)) return refuse(`${property}: ${text} is unsupported: a calculation in a border radius takes px, %, em, rem and absolute lengths; a viewport, safe-area or container unit there would need the device's sizes on the native side (PNT1)`);
  // em and rem change no refusal (nonNegativeLengthMath judges the tree), so any font size checks it here.
  const computed = nonNegativeLengthMath(parsed.node, { em: 16, rem: 16 }, exactNumberText);
  if (computed.kind === 'refused') return refuse(`${property}: ${text} is unsupported: ${computed.reason}`);
  return { ok: { kind: 'calc', text } };
}

/**
 * One <length-percentage [0,∞]> token: a negative value is invalid (Chrome drops the declaration); a unit with no build-time px
 * value (viewport, font-metric and container units) is refused, since the native side needs px or a percentage; a calculation is
 * mathToken's.
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
  if (t.type === 'Function') return mathToken(property, t, refuse);
  return { invalid: `${generate(t)} is not a length or percentage` };
}

/** css-backgrounds-3 §5.1: a corner is one or two components; one component sets both. property names it in a refusal. */
function cornerOf(property: RadiusLonghand | LogicalRadius, tokens: readonly CssNode[], base: Span): { readonly value: CssValue } | ParsedValue {
  if (tokens.length < 1 || tokens.length > 2) return { kind: 'invalid', reason: 'a corner radius is one or two lengths or percentages' };
  const parts: RadiusComponent[] = [];
  for (const t of tokens) {
    const r = radiusToken(property, t, base);
    if ('refused' in r) return r.refused;
    if ('invalid' in r) return { kind: 'invalid', reason: r.invalid };
    parts.push(r.ok);
  }
  const h = parts[0] as RadiusComponent;
  return { value: cornerValue(h, parts[1] ?? h) };
}

/** A corner longhand's value. */
export function parseCorner(property: RadiusLonghand, tokens: readonly CssNode[], base: Span): ParsedValue {
  const c = cornerOf(property, tokens, base);
  if (!('value' in c)) return c;
  const longhands: LonghandValue[] = [{ property, value: c.value, explicit: true }];
  return { kind: 'ok', longhands };
}

/** A flow-relative corner's value: one tagged value per direction, the cascade keeping the element's own (analysis/logical.ts). */
export function parseLogicalCorner(property: LogicalRadius, tokens: readonly CssNode[], base: Span): ParsedValue {
  const c = cornerOf(property, tokens, base);
  if (!('value' in c)) return c;
  const { ltr, rtl } = LOGICAL_CORNERS[property];
  const longhands: LonghandValue[] = [{ property: ltr, value: c.value, explicit: true, direction: 'ltr' }, { property: rtl, value: c.value, explicit: true, direction: 'rtl' }];
  return { kind: 'ok', longhands };
}

/** The value parsers of the radius longhands (the paint value hook, css/paint-parsers.ts). */
export const RADIUS_VALUE_PARSERS: { readonly [P in RadiusLonghand]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'border-top-left-radius': (tokens, base) => parseCorner('border-top-left-radius', tokens, base),
  'border-top-right-radius': (tokens, base) => parseCorner('border-top-right-radius', tokens, base),
  'border-bottom-right-radius': (tokens, base) => parseCorner('border-bottom-right-radius', tokens, base),
  'border-bottom-left-radius': (tokens, base) => parseCorner('border-bottom-left-radius', tokens, base),
};

/** The value parsers of the flow-relative corners (the paint value hook, css/paint-parsers.ts). */
export const LOGICAL_RADIUS_VALUE_PARSERS: { readonly [P in LogicalRadius]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'border-start-start-radius': (tokens, base) => parseLogicalCorner('border-start-start-radius', tokens, base),
  'border-start-end-radius': (tokens, base) => parseLogicalCorner('border-start-end-radius', tokens, base),
  'border-end-start-radius': (tokens, base) => parseLogicalCorner('border-end-start-radius', tokens, base),
  'border-end-end-radius': (tokens, base) => parseLogicalCorner('border-end-end-radius', tokens, base),
};
