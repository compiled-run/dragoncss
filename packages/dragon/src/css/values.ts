// Declared values: the CssValue model, token-to-value conversion, and the support-profile feature key of a value.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { ColorSyntax, Rgba8 } from './color.ts';
import { parseColorNode } from './color.ts';
import { asciiLower, decodeName, serializeString } from './escapes.ts';
import type { Longhand } from './properties.ts';
import { foldNumber, mathContextFor, parseMath, V1_MATH_FUNCTIONS } from './math.ts';
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
  /** A resolved legacy sRGB colour; transparent and currentcolor stay keywords. */
  | { readonly kind: 'color'; readonly value: Rgba8; readonly syntax: ColorSyntax }
  | { readonly kind: 'other'; readonly type: string; readonly text: string };

export const CSS_WIDE: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
export const LINE_STYLES: ReadonlySet<string> = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
export const LINE_WIDTH_KEYWORDS: ReadonlySet<string> = new Set(['thin', 'medium', 'thick', 'hairline']);
/** Properties whose unitless numbers stay numbers; elsewhere a unitless zero is a length. */
const NUMBER_PROPERTIES: ReadonlySet<string> = new Set<string>(['flex-grow', 'flex-shrink', 'order', 'line-height']);

export const kw = (value: string): CssValue => ({ kind: 'keyword', value });

export const COLOR_FIX = 'Use a named colour, a 3, 4, 6 or 8 digit hex colour, rgb(), rgba(), hsl(), hsla(), transparent or currentcolor.';

function isColorBearing(property: string): boolean {
  return property === 'color' || property === 'background-color' || property.startsWith('border') && (property.endsWith('-color') || !property.endsWith('-width') && !property.endsWith('-style'));
}

/**
 * css-color-4 §4: <color> tokens resolve to 8-bit channels here (color.ts); anything outside the subset is refused. Returns the
 * value, or the reason a colour token is unsupported.
 */
export function tokenValue(node: CssNode, property: string): CssValue | string {
  if (!isColorBearing(property)) return toValue(node, property);
  // The border shorthands assign a token that is neither a length nor a keyword to the colour, so a calculation there is refused.
  if (node.type === 'Function' && V1_MATH_FUNCTIONS.has(asciiLower(String(node['name']))) && !property.endsWith('color')) {
    return `a calculation in the ${property} shorthand is not supported; set it with ${property === 'border' ? 'border-width' : `${property}-width`}`;
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
      if (V1_MATH_FUNCTIONS.has(name)) return mathValue(node, name, property);
      return { kind: 'other', type: `${name}()`, text: generate(node) };
    }
    default:
      return { kind: 'other', type: node.type, text: generate(node) };
  }
}

/**
 * A css-values-4 §10 math function (css/math.ts). A number calculation (flex-grow, flex-shrink, order, or a number in the flex
 * shorthand) is folded to its number now; a length calculation keeps its text, with feature key <calc()>, <min()>, <max()> or
 * <clamp()>, and is lowered per element (lower/ios-layout.ts). A calculation V1 refuses keeps its text with the reason as a
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
    if (property === 'order' && !Number.isInteger(value)) return refused('order takes an integer, and this calculation is not a whole number');
    return { kind: 'number', value };
  }
  return { kind: 'other', type: `${name}()`, text };
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
    case 'other':
      return `${property}:<${v.type}>`;
  }
}
