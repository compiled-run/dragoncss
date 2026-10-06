// Declared values: the CssValue model, token-to-value conversion, and the support-profile feature key of a value.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { ColorSyntax, Rgba8 } from './color.ts';
import { parseColorNode } from './color.ts';
import { asciiLower, decodeName, serializeString } from './escapes.ts';
import type { Longhand } from './properties.ts';
import { foldNumber, mathContextFor, mathHasEnv, parseMath, V1_MATH_FUNCTIONS } from './math.ts';
import { CANONICAL_LENGTH_UNIT, lengthFeatureType, normalizeUnit } from './units.ts';
import { GENERIC_FAMILY_KEYWORDS } from '../fonts/font-face.ts';
import type { FontMap } from '../fonts/font-map.ts';
import { familySupport } from '../fonts/wire.ts';

export type CssValue =
  | { readonly kind: 'keyword'; readonly value: string }
  | { readonly kind: 'length'; readonly value: number; readonly unit: string }
  | { readonly kind: 'percentage'; readonly value: number }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'family'; readonly value: string }
  /** css-sizing-4 §5.1 aspect-ratio: a <ratio> of non-negative numbers, with the auto keyword (`auto && <ratio>`) or without it. */
  | { readonly kind: 'ratio'; readonly auto: boolean; readonly width: number; readonly height: number }
  /** css-images-3 §5.6 object-position as Chrome computes it: each axis an offset from the left or top edge, in px or %. */
  | { readonly kind: 'position'; readonly x: PositionOffset; readonly y: PositionOffset }
  /** A resolved legacy sRGB colour; transparent and currentcolor stay keywords. */
  | { readonly kind: 'color'; readonly value: Rgba8; readonly syntax: ColorSyntax }
  | { readonly kind: 'other'; readonly type: string; readonly text: string };

/** One computed <position> axis: px or a percentage of the free space. */
export type PositionOffset = { readonly unit: 'px' | '%'; readonly value: number };

export const CSS_WIDE: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
export const LINE_STYLES: ReadonlySet<string> = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
export const LINE_WIDTH_KEYWORDS: ReadonlySet<string> = new Set(['thin', 'medium', 'thick', 'hairline']);
/** Properties whose unitless numbers stay numbers; elsewhere a unitless zero is a length. */
const NUMBER_PROPERTIES: ReadonlySet<string> = new Set<string>(['flex-grow', 'flex-shrink', 'order', 'line-height']);

export const kw = (value: string): CssValue => ({ kind: 'keyword', value });

/** The shorthands that set a border's width, style and colour together (css-backgrounds-3 §3.1, css-logical-1 §6.3). */
const BORDER_SHORTHAND = /^border(-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/;

/** The functions whose value is a calculation: the math functions and env() (css/env.ts), whose inset is a px length. */
export const MATH_VALUE_FUNCTIONS: ReadonlySet<string> = new Set([...V1_MATH_FUNCTIONS, 'env']);

/**
 * The feature type of a calculation that reads a safe-area inset, alone or inside a math function: support for env() is proven by
 * its own profile rows, never by those of calc().
 */
export const ENV_VALUE_TYPE = 'env()';

/** A math function value (calc(), min(), max(), clamp(), env(), or one V1 refuses), which a border shorthand assigns to the width. */
export function isMathValue(v: CssValue): boolean {
  if (v.kind !== 'other') return false;
  const name = v.type.startsWith(REFUSED_MATH_PREFIX) ? v.type.slice(REFUSED_MATH_PREFIX.length) : v.type;
  return name.endsWith('()') && MATH_VALUE_FUNCTIONS.has(name.slice(0, -2));
}

export const COLOR_FIX = 'Use a named colour, a 3, 4, 6 or 8 digit hex colour, rgb(), rgba(), hsl(), hsla(), transparent or currentcolor.';

function isColorBearing(property: string): boolean {
  return property === 'color' || property === 'fill' || property === 'stroke' || property === 'background-color' || property.startsWith('border') && (property.endsWith('-color') || !property.endsWith('-width') && !property.endsWith('-style'));
}

/**
 * css-color-4 §4: <color> tokens resolve to 8-bit channels here (color.ts); anything outside the subset is refused. Returns the
 * value, or the reason a colour token is unsupported.
 */
export function tokenValue(node: CssNode, property: string): CssValue | string {
  if (!isColorBearing(property)) return toValue(node, property);
  // css-backgrounds-3 §3.1: a calculation in a border shorthand is its <line-width>, typed as the border-*-width longhands are.
  if (node.type === 'Function' && MATH_VALUE_FUNCTIONS.has(asciiLower(String(node['name']))) && BORDER_SHORTHAND.test(property)) {
    return mathValue(node, asciiLower(String(node['name'])), 'border-top-width');
  }
  if (node.type === 'Identifier') {
    const name = asciiLower(String(node['name']));
    if (!property.endsWith('color') && (LINE_STYLES.has(name) || LINE_WIDTH_KEYWORDS.has(name))) return toValue(node, property);
  } else if (node.type !== 'Hash' && node.type !== 'Function') {
    return toValue(node, property);
  }
  const c = parseColorNode(node);
  if (!c.ok) return c.reason;
  return c.kind === 'keyword' ? { kind: 'keyword', value: c.keyword } : { kind: 'color', value: c.value, syntax: c.syntax };
}

export function toValue(node: CssNode, property: string): CssValue {
  switch (node.type) {
    case 'Identifier':
      return { kind: 'keyword', value: asciiLower(String(node['name'])) };
    case 'Dimension':
      return { kind: 'length', value: Number(node['value']), unit: normalizeUnit(String(node['unit'])) };
    case 'Percentage':
      return { kind: 'percentage', value: Number(node['value']) };
    case 'Number': {
      const n = Number(node['value']);
      if (!NUMBER_PROPERTIES.has(property) && property !== 'flex' && n === 0) return { kind: 'length', value: 0, unit: CANONICAL_LENGTH_UNIT };
      return { kind: 'number', value: n };
    }
    case 'String':
      return { kind: 'family', value: String(node['value']) };
    case 'Hash':
      return { kind: 'other', type: 'color', text: generate(node) };
    case 'Function': {
      const name = asciiLower(String(node['name']));
      if (MATH_VALUE_FUNCTIONS.has(name)) return mathValue(node, name, property);
      return { kind: 'other', type: `${name}()`, text: generate(node) };
    }
    default:
      return { kind: 'other', type: node.type, text: generate(node) };
  }
}

/**
 * A css-values-4 §10 math function (css/math.ts). A number calculation (flex-grow, flex-shrink, order, or a number in the flex
 * shorthand) is folded to its number now, order unrounded (the engine rounds it, environment.ts); a length calculation keeps its
 * text, with feature key <calc()>, <min()>, <max()> or <clamp()>, or <env()> when it reads a safe-area inset (env() alone is
 * parsed as a calculation of one inset), and is lowered per element (lower/ios-layout.ts). A calculation V1 refuses keeps its text with the reason as a
 * comment and the feature type "refused <name>()", which no profile row supports, so the declaration is refused with the reason.
 */
export const REFUSED_MATH_PREFIX = 'refused ';

function mathValue(node: CssNode, name: string, property: string): CssValue {
  const text = generate(node);
  const refused = (reason: string): CssValue => ({ kind: 'other', type: `${REFUSED_MATH_PREFIX}${name}()`, text: `${text} /* ${reason} */` });
  // css-values-4 §10.10: a top-level result is clamped to the property's range; flex-grow and flex-shrink take [0,∞].
  const nonNegative = (v: number): number => (v < 0 ? 0 : v);
  if (property === 'flex') {
    const n = parseMath(text, { type: 'number' });
    if (n.ok) return { kind: 'number', value: nonNegative(foldNumber(n.node)) };
  }
  const context = mathContextFor(property);
  if ('refused' in context) return refused(context.refused);
  const parsed = parseMath(text, context);
  if (!parsed.ok) return refused(parsed.reason);
  if (context.type === 'number') {
    const folded = foldNumber(parsed.node);
    const value = property === 'flex-grow' || property === 'flex-shrink' ? nonNegative(folded) : folded;
    return { kind: 'number', value };
  }
  return { kind: 'other', type: mathHasEnv(parsed.node) ? ENV_VALUE_TYPE : `${name}()`, text };
}

/** The properties whose value may be a two-keyword <baseline-position>. */
export const BASELINE_PROPERTIES: ReadonlySet<string> = new Set<string>(['align-items', 'align-self', 'align-content']);

/** css-align-3 §4.2: <baseline-position> is one keyword value, [ first | last ]? baseline. */
export function baselinePosition(tokens: readonly CssNode[]): CssValue | null {
  const names = tokens.map((t) => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : ''));
  if (names.length === 2 && (names[0] === 'first' || names[0] === 'last') && names[1] === 'baseline') return { kind: 'keyword', value: `${names[0]} baseline` };
  return null;
}

/**
 * A font-family value: one family name, or the whole list kept as text. A lone unquoted generic keyword (sans-serif) stays a list,
 * so it is never written back as the quoted family name "sans-serif", which Chrome reads as a different family.
 */
export function familyValue(tokens: readonly CssNode[]): CssValue {
  const text = tokens.map((t) => (t.type === 'String' ? serializeString(String(t['value'])) : generate(t))).join(' ');
  const genericKeyword = tokens[0]?.type === 'Identifier' && (GENERIC_FAMILY_KEYWORDS as readonly string[]).includes(asciiLower(decodeName(String(tokens[0]['name']))));
  if (tokens.length === 1 && !genericKeyword && (tokens[0]?.type === 'Identifier' || tokens[0]?.type === 'String')) {
    const t = tokens[0];
    return { kind: 'family', value: t.type === 'Identifier' ? decodeName(String(t['name'])) : String(t['value']) };
  }
  return { kind: 'other', type: 'family-list', text };
}

/**
 * css-sizing-4 §5.1 as Chrome 145 parses aspect-ratio (AspectRatio::ParseSingleValue): auto || <ratio>, where <ratio> is
 * <number [0,∞]> [ / <number [0,∞]> ]? and a single number n is n / 1. The tokens have matched the grammar already. A negative
 * part is invalid, as Chrome drops it; a math function is refused, because Dragon does not evaluate one inside a ratio.
 */
export function ratioValue(tokens: readonly CssNode[]): CssValue | 'invalid' | { readonly token: CssNode; readonly reason: string } {
  // css-syntax-3 §4.3.11: an escaped identifier is its decoded name, so \61uto is auto.
  const autos = tokens.filter((t) => t.type === 'Identifier' && asciiLower(decodeName(String(t['name']))) === 'auto');
  const rest = tokens.filter((t) => !autos.includes(t));
  if (autos.length > 1) return 'invalid';
  if (rest.length === 0) return autos.length === 1 ? { kind: 'keyword', value: 'auto' } : 'invalid';
  // auto goes before or after the whole <ratio>, never inside it.
  if (autos.length === 1 && tokens[0] !== autos[0] && tokens[tokens.length - 1] !== autos[0]) return 'invalid';
  const math = rest.find((t) => t.type === 'Function');
  if (math !== undefined) return { token: math, reason: 'a calculation inside aspect-ratio is not supported' };
  const slash = rest.length === 3 && rest[1]?.type === 'Operator' && rest[1]['value'] === '/';
  if (rest.length !== 1 && !slash) return 'invalid';
  const parts = slash ? [rest[0], rest[2]] : [rest[0]];
  if (!parts.every((t) => t !== undefined && t.type === 'Number')) return 'invalid';
  const [width, height] = parts.map((t) => Number((t as CssNode)['value']));
  if (width === undefined || !Number.isFinite(width) || width < 0) return 'invalid';
  const h = height === undefined ? 1 : height;
  if (!Number.isFinite(h) || h < 0) return 'invalid';
  return { kind: 'ratio', auto: autos.length === 1, width, height: h };
}

const POSITION_EDGES: { readonly [k: string]: { readonly axis: 'x' | 'y' | 'center'; readonly percent: number } } = {
  left: { axis: 'x', percent: 0 },
  right: { axis: 'x', percent: 100 },
  top: { axis: 'y', percent: 0 },
  bottom: { axis: 'y', percent: 100 },
  center: { axis: 'center', percent: 50 },
};

type PositionPart = { readonly edge: string } | { readonly offset: PositionOffset } | { readonly refused: CssNode; readonly reason: string } | null;

/** One <position> token: an edge keyword, a px length or 0, or a percentage; null when it is none of these. */
function positionPart(t: CssNode): PositionPart {
  if (t.type === 'Identifier') {
    // css-syntax-3 §4.3.11: an escaped keyword (\6c eft) is the keyword; keywords match ASCII case-insensitively.
    const name = asciiLower(decodeName(String(t['name'])));
    return Object.hasOwn(POSITION_EDGES, name) ? { edge: name } : null;
  }
  // A number past the double range (1e999px) is Infinity, which no offset holds; Dragon has no Chrome proof of how it clamps it.
  const overflow = { refused: t, reason: 'an offset past the range of a number is not supported in object-position' } as const;
  if (t.type === 'Percentage') return Number.isFinite(Number(t['value'])) ? { offset: { unit: '%', value: Number(t['value']) } } : overflow;
  if (t.type === 'Number' && Number(t['value']) === 0) return { offset: { unit: 'px', value: 0 } };
  if (t.type === 'Dimension') {
    if (normalizeUnit(String(t['unit'])) === 'px') return Number.isFinite(Number(t['value'])) ? { offset: { unit: 'px', value: Number(t['value']) } } : overflow;
    return { refused: t, reason: 'only px and % offsets are supported in object-position' };
  }
  if (t.type === 'Function') return { refused: t, reason: 'a calculation in object-position is not supported' };
  return null;
}

/** An offset from a far edge (right or bottom) as Chrome computes it: 100% - p% for a percentage, 100% for 0; any other length is a calc(), which Dragon refuses. */
function fromFarEdge(edgePercent: number, o: PositionOffset): PositionOffset | null {
  if (edgePercent === 0) return o;
  if (o.unit === '%') return { unit: '%', value: 100 - o.value };
  return o.value === 0 ? { unit: '%', value: 100 } : null;
}

/**
 * css-values-4 §9.1 <position> as Chrome 145 parses and computes object-position (probed): one value (the other axis is center),
 * two values (keywords in either order, or x then y), or four values (an edge and an offset per axis). Chrome rejects three
 * values. Keywords compute to percentages; an offset from right or bottom computes to calc() unless it is 0 or a percentage.
 */
export function positionValue(tokens: readonly CssNode[]): CssValue | 'invalid' | { readonly token: CssNode; readonly reason: string } {
  const parts = tokens.map(positionPart);
  for (const p of parts) {
    if (p === null) return 'invalid';
    if ('refused' in p) return { token: p.refused, reason: p.reason };
  }
  const ps = parts as ({ readonly edge: string } | { readonly offset: PositionOffset })[];
  const pct = (value: number): PositionOffset => ({ unit: '%', value });
  const edge = (p: (typeof ps)[number]): (typeof POSITION_EDGES)[string] | null => ('edge' in p ? (POSITION_EDGES[p.edge] as (typeof POSITION_EDGES)[string]) : null);
  if (ps.length === 1) {
    const a = ps[0] as (typeof ps)[number];
    const e = edge(a);
    if (e === null) return { kind: 'position', x: (a as { offset: PositionOffset }).offset, y: pct(50) };
    return e.axis === 'y' ? { kind: 'position', x: pct(50), y: pct(e.percent) } : { kind: 'position', x: pct(e.percent), y: pct(50) };
  }
  if (ps.length === 2) {
    const [a, b] = ps as [(typeof ps)[number], (typeof ps)[number]];
    const ea = edge(a);
    const eb = edge(b);
    if (ea !== null && eb !== null) {
      // Two keywords: in either order, as long as the axes differ (center fills either).
      const swap = ea.axis === 'y' || eb.axis === 'x';
      const [x, y] = swap ? [eb, ea] : [ea, eb];
      if (x.axis === 'y' || y.axis === 'x') return 'invalid';
      return { kind: 'position', x: pct(x.percent), y: pct(y.percent) };
    }
    // An offset with a keyword or another offset: x first, then y; a vertical keyword cannot come first.
    if (ea !== null && ea.axis === 'y') return 'invalid';
    if (eb !== null && eb.axis === 'x') return 'invalid';
    const x = ea !== null ? pct(ea.percent) : (a as { offset: PositionOffset }).offset;
    const y = eb !== null ? pct(eb.percent) : (b as { offset: PositionOffset }).offset;
    return { kind: 'position', x, y };
  }
  if (ps.length === 4) {
    const [k1, o1, k2, o2] = ps as [(typeof ps)[number], (typeof ps)[number], (typeof ps)[number], (typeof ps)[number]];
    const e1 = edge(k1);
    const e2 = edge(k2);
    if (e1 === null || e2 === null || !('offset' in o1) || !('offset' in o2) || e1.axis === 'center' || e2.axis === 'center' || e1.axis === e2.axis) return 'invalid';
    const [ex, ox, ey, oy] = e1.axis === 'x' ? [e1, o1.offset, e2, o2.offset] : [e2, o2.offset, e1, o1.offset];
    const x = fromFarEdge(ex.percent, ox);
    const y = fromFarEdge(ey.percent, oy);
    if (x === null || y === null) return { token: tokens[0] as CssNode, reason: 'an offset from right or bottom computes to a calculation, which object-position does not support' };
    return { kind: 'position', x, y };
  }
  return 'invalid';
}

/** The computed serialisation of a <position> axis. */
export function positionOffsetText(o: PositionOffset): string {
  return `${o.value}${o.unit}`;
}

/** Raw LayoutUnit parts at most 2^24, so a part that is a whole number of 64ths is also exact as the float Blink stores. */
const MAX_EXACT_RATIO_RAW = 16777216;

/**
 * The layout ratio of a <ratio> that needs no float arithmetic (Blink LayoutRatioFromSizeF): a part of zero makes it degenerate
 * (auto for layout); parts that are whole 64ths are kept as raw LayoutUnits; equal parts are 1 / 1. null for any other ratio,
 * which Chrome converts by a float continued fraction (packages/layout/src/units.ts layoutRatio) that the compiler does not run.
 */
export function exactLayoutRatio(width: number, height: number): { readonly width: number; readonly height: number } | 'degenerate' | null {
  if (width === 0 || height === 0) return 'degenerate';
  const rw = width * 64;
  const rh = height * 64;
  if (Number.isInteger(rw) && Number.isInteger(rh) && rw <= MAX_EXACT_RATIO_RAW && rh <= MAX_EXACT_RATIO_RAW) return { width: rw, height: rh };
  if (width === height) return { width: 64, height: 64 };
  return null;
}

/** What a font-family feature key is resolved against: the project's font map and the families its @font-face rules declare. */
export type FamilyKeyContext = { readonly map: FontMap | null; readonly declared: ReadonlySet<string> };

/** The font-family list text of a family or family-list value; null for any other value. */
export function familyListText(v: CssValue): string | null {
  if (v.kind === 'family') return serializeString(v.value);
  return v.kind === 'other' && v.type === 'family-list' ? v.text : null;
}

/**
 * Feature key for the support profile: a keyword, or the value type with its unit. With a font context, a font-family value is
 * keyed by how it resolves (fonts/wire.ts familySupport: pinned, declared, platform or unmapped); the single family Ahem keeps
 * font-family:Ahem.
 */
export function featureOf(property: Longhand, v: CssValue, fonts?: FamilyKeyContext): string {
  const list = property === 'font-family' && fonts !== undefined ? familyListText(v) : null;
  if (list !== null && fonts !== undefined) {
    const support = familySupport(list, fonts.map, fonts.declared);
    if (support !== null && support.kind === 'resolved') return support.key;
  }
  switch (v.kind) {
    case 'keyword':
      return `${property}:${v.value}`;
    case 'length':
      return `${property}:${lengthFeatureType(v.unit)}`;
    case 'percentage':
      return `${property}:<percentage>`;
    case 'number':
      return property === 'order' ? `${property}:<integer>` : `${property}:<number>`;
    case 'family':
      return `${property}:${v.value}`;
    case 'color':
      return `${property}:<${v.syntax}>`;
    case 'ratio':
      return v.auto ? `${property}:auto && <ratio>` : `${property}:<ratio>`;
    case 'position':
      return `${property}:<position>`;
    case 'other':
      return `${property}:<${v.type}>`;
  }
}
