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
const NUMBER_PROPERTIES: ReadonlySet<string> = new Set<string>(['flex-grow', 'flex-shrink', 'order', 'line-height', 'font-weight']);

export const kw = (value: string): CssValue => ({ kind: 'keyword', value });

/** The shorthands that set a border's width, style and colour together (css-backgrounds-3 §3.1, css-logical-1 §6.3). */
const BORDER_SHORTHAND = /^border(-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/;

/** A math function value (calc(), min(), max(), clamp(), or one V1 refuses), which a border shorthand assigns to the width. */
export function isMathValue(v: CssValue): boolean {
  if (v.kind !== 'other') return false;
  const name = v.type.startsWith(REFUSED_MATH_PREFIX) ? v.type.slice(REFUSED_MATH_PREFIX.length) : v.type;
  return name.endsWith('()') && V1_MATH_FUNCTIONS.has(name.slice(0, -2));
}

export const COLOR_FIX = 'Use a named colour, a 3, 4, 6 or 8 digit hex colour, rgb(), rgba(), hsl(), hsla(), transparent or currentcolor.';

function isColorBearing(property: string): boolean {
  return property === 'color' || property === 'text-decoration-color' || property === 'text-decoration' || property === 'background-color' || property.startsWith('border') && (property.endsWith('-color') || !property.endsWith('-width') && !property.endsWith('-style'));
}

/**
 * css-color-4 §4: <color> tokens resolve to 8-bit channels here (color.ts); anything outside the subset is refused. Returns the
 * value, or the reason a colour token is unsupported.
 */
export function tokenValue(node: CssNode, property: string): CssValue | string {
  if (!isColorBearing(property)) return toValue(node, property);
  // The text-decoration shorthand's line, style and thickness tokens are not colours (css-text-decor-4 §2.6).
  if (property === 'text-decoration') {
    if (node.type === 'Identifier' && TEXT_DECORATION_KEYWORDS.has(asciiLower(String(node['name'])))) return toValue(node, property);
    if (node.type === 'Function' && V1_MATH_FUNCTIONS.has(asciiLower(String(node['name'])))) return toValue(node, 'text-decoration-thickness');
  }
  // css-backgrounds-3 §3.1: a calculation in a border shorthand is its <line-width>, typed as the border-*-width longhands are.
  if (node.type === 'Function' && V1_MATH_FUNCTIONS.has(asciiLower(String(node['name']))) && BORDER_SHORTHAND.test(property)) {
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
      if (V1_MATH_FUNCTIONS.has(name)) return mathValue(node, name, property);
      return { kind: 'other', type: `${name}()`, text: generate(node) };
    }
    default:
      return { kind: 'other', type: node.type, text: generate(node) };
  }
}

/**
 * A css-values-4 §10 math function (css/math.ts). A number calculation (flex-grow, flex-shrink, order, or a number in the flex
 * shorthand) is folded to its number now, order unrounded (the engine rounds it, environment.ts); a length calculation keeps its
 * text, with feature key <calc()>, <min()>, <max()> or <clamp()>, and is lowered per element (lower/ios-layout.ts). A calculation V1 refuses keeps its text with the reason as a
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
  return { kind: 'other', type: `${name}()`, text };
}

/** The properties whose value may be a two-keyword <baseline-position>. */
export const BASELINE_PROPERTIES: ReadonlySet<string> = new Set<string>(['align-items', 'align-self', 'align-content']);

/** The decoration longhands whose values Chrome 145 parses more narrowly than the grammar or Dragon refuses (textDecorationValue). */
const TEXT_DECORATION_RULED = ['text-decoration-line', 'text-decoration-style', 'text-decoration-thickness', 'text-underline-position', 'text-decoration-skip-ink'];

/** The properties one of whose single values spans two tokens (<baseline-position>, font-style's oblique <angle>), or that Chrome parses more narrowly than the grammar. */
export const PAIR_VALUE_PROPERTIES: ReadonlySet<string> = new Set<string>([...BASELINE_PROPERTIES, 'font-style', 'font-synthesis-style', ...TEXT_DECORATION_RULED]);

/** A two-token value, why Chrome's parser drops it (invalid), why Dragon cannot express it (refused), or null when it is not one. */
export type PairValue = CssValue | { readonly invalid: string } | { readonly refused: string } | null;

export function pairValue(property: string, tokens: readonly CssNode[]): PairValue {
  const decoration = textDecorationValue(property, tokens);
  if (decoration !== undefined) return decoration;
  if (property === 'font-synthesis-style') {
    // Chrome 145 does not parse css-fonts-4's oblique-only.
    const only = tokens.length === 1 && tokens[0]?.type === 'Identifier' ? asciiLower(String(tokens[0]['name'])) : '';
    return only === 'oblique-only' ? { invalid: 'Chrome 145 does not parse font-synthesis-style: oblique-only' } : null;
  }
  return property === 'font-style' ? fontStyleValue(tokens) : baselinePosition(tokens);
}

/** The keywords of the text-decoration shorthand that are not colours. */
const TEXT_DECORATION_KEYWORDS: ReadonlySet<string> = new Set(['none', 'underline', 'overline', 'line-through', 'blink', 'spelling-error', 'grammar-error', 'solid', 'double', 'dotted', 'dashed', 'wavy', 'auto', 'from-font', 'thin', 'medium', 'thick']);


/** The decoration lines Chrome 145 serializes, in its order. */
const LINE_ORDER = ['underline', 'overline', 'line-through'];

/**
 * css-text-decor-4 as Chrome 145 parses it, and the values TDEC-a draws (notes/T148J-tdec.md): text-decoration-line is one value
 * of up to three lines, kept in Chrome's order; blink, spelling-error and grammar-error, styles other than solid, from-font, and an
 * underline position other than auto are refused; <line-width> thickness keywords and skip-ink all are not Chrome values. undefined
 * when the property is not a decoration longhand this rules on.
 */
export function textDecorationValue(property: string, tokens: readonly CssNode[]): PairValue | undefined {
  if (!TEXT_DECORATION_RULED.includes(property)) return undefined;
  const names = tokens.map((t) => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : ''));
  const one = tokens.length === 1 ? names[0] : '';
  switch (property) {
    case 'text-decoration-line': {
      const refused = names.find((n) => n === 'blink' || n === 'spelling-error' || n === 'grammar-error');
      if (refused !== undefined) return { refused: `${refused} is not drawn by Chrome as a decoration line Dragon reproduces` };
      if (tokens.length < 2) return null;
      return { kind: 'keyword', value: LINE_ORDER.filter((l) => names.includes(l)).join(' ') };
    }
    case 'text-decoration-style':
      return one !== '' && one !== 'solid' ? { refused: `text-decoration-style: ${one} is drawn by TDEC-c` } : null;
    case 'text-decoration-thickness':
      if (one === 'thin' || one === 'medium' || one === 'thick') return { invalid: `Chrome 145 does not parse text-decoration-thickness: ${one}` };
      return one === 'from-font' ? { refused: 'text-decoration-thickness: from-font reads the font\'s underline metrics, which TDEC-c measures' } : null;
    case 'text-underline-position':
      return names.length > 0 && names.join(' ') !== 'auto' ? { refused: `text-underline-position: ${names.join(' ')} is drawn by TDEC-c` } : null;
    case 'text-decoration-skip-ink':
      return one === 'all' ? { invalid: 'Chrome 145 does not parse text-decoration-skip-ink: all' } : null;
    default:
      return null;
  }
}

/** The angle units of an oblique angle, in degrees per unit (css-values-4 §7.1). */
export const ANGLE_DEGREES: { readonly [unit: string]: number } = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };

/** The declared value type of font-style: oblique <angle>; its text is "oblique <number><unit>". */
export const OBLIQUE_ANGLE_TYPE = 'oblique-angle';

/**
 * css-fonts-4 §2.3 as Chrome 145 parses font-style (css_parsing_utils.cc ConsumeFontStyle): left and right are not values, and the
 * oblique angle's number must lie in [-90,90] whatever its unit, so 1.6rad parses (91.5deg) and 100grad does not. An angle beyond
 * 90deg after conversion is refused: no Chrome case shows how it is drawn.
 */
function fontStyleValue(tokens: readonly CssNode[]): PairValue {
  const head = tokens[0];
  const name = head?.type === 'Identifier' ? asciiLower(String(head['name'])) : '';
  if (tokens.length === 1 && (name === 'left' || name === 'right')) return { invalid: `Chrome 145 does not parse font-style: ${name}` };
  if (tokens.length !== 2 || name !== 'oblique') return null;
  const angle = tokens[1] as CssNode;
  if (angle.type !== 'Dimension') return { refused: `the oblique angle ${generate(angle)} is a calculation, which Dragon does not compute` };
  const unit = asciiLower(String(angle['unit']));
  const value = Number(angle['value']);
  const perUnit = ANGLE_DEGREES[unit];
  if (perUnit === undefined) return null;
  if (Math.abs(value) > 90) return { invalid: `Chrome parses an oblique angle only when its number is in [-90, 90] (${value}${unit})` };
  if (Math.abs(value * perUnit) > 90) return { refused: `the oblique angle ${value}${unit} is ${value * perUnit}deg, beyond 90deg, which no Chrome case proves` };
  return { kind: 'other', type: OBLIQUE_ANGLE_TYPE, text: `oblique ${value}${unit}` };
}

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
