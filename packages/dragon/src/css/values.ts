// Declared values: the CssValue model, token-to-value conversion, and the support-profile feature key of a value.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { ColorSyntax, Rgba8 } from './color.ts';
import { parseColorNode } from './color.ts';
import { asciiLower, decodeName, serializeString } from './escapes.ts';
import type { Longhand } from './properties.ts';
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
    case 'Function':
      return { kind: 'other', type: `${asciiLower(String(node['name']))}()`, text: generate(node) };
    default:
      return { kind: 'other', type: node.type, text: generate(node) };
  }
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
    case 'other':
      return `${property}:<${v.type}>`;
  }
}
