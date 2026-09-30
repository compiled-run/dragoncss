// Declared values: the CssValue model, token-to-value conversion, and the support-profile feature key of a value.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { ColorSyntax, Rgba8 } from './color.ts';
import { parseColorNode } from './color.ts';
import { asciiLower, decodeName, serializeString } from './escapes.ts';
import type { Longhand } from './properties.ts';
import { foldNumber, mathContextFor, parseMath, V1_MATH_FUNCTIONS } from './math.ts';
import { CANONICAL_LENGTH_UNIT, lengthFeatureType, normalizeUnit } from './units.ts';

export type CssValue =
  | { readonly kind: 'keyword'; readonly value: string }
  | { readonly kind: 'length'; readonly value: number; readonly unit: string }
  | { readonly kind: 'percentage'; readonly value: number }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'family'; readonly value: string }
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

/** A font-family value: one family name, or the whole list kept as text. */
export function familyValue(tokens: readonly CssNode[]): CssValue {
  const text = tokens.map((t) => (t.type === 'String' ? serializeString(String(t['value'])) : generate(t))).join(' ');
  if (tokens.length === 1 && (tokens[0]?.type === 'Identifier' || tokens[0]?.type === 'String')) {
    const t = tokens[0];
    return { kind: 'family', value: t.type === 'Identifier' ? decodeName(String(t['name'])) : String(t['value']) };
  }
  return { kind: 'other', type: 'family-list', text };
}

/** Feature key for the support profile: a keyword, or the value type with its unit. */
export function featureOf(property: Longhand, v: CssValue): string {
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
    case 'other':
      return `${property}:<${v.type}>`;
  }
}
