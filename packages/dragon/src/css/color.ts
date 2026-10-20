// Colour resolution for the milestone subset (css-color-4). This is the only file in the core that converts or rounds colours.
// Chrome 145 keeps legacy sRGB colours (named, hex, rgb(), hsl()) as 8-bit channels; each rule below was measured against it.
import { generate, parse } from 'css-tree';
import type { CssNode, List } from 'css-tree';
import type { ColorSpace, HueMethod } from './color-space.ts';
import { BlinkColor, isLegacySpace } from './color-space.ts';
import { asciiLower } from './escapes.ts';

/** 8-bit sRGB channels and alpha, each an integer in [0, 255], as Chrome stores legacy colours. */
export type Rgba8 = { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };

/** The authored notation, which names the support-profile feature. */
export type ColorSyntax =
  | 'hex-color' | 'named-color' | 'rgb()' | 'rgba()' | 'hsl()' | 'hsla()'
  | 'hwb()' | 'lab()' | 'lch()' | 'oklab()' | 'oklch()' | 'color()' | 'color-mix()' | 'relative-color';

export type ColorParse =
  /** css is Chrome's computed serialization when it is not the rgb()/rgba() of the 8-bit value (COL4 colour functions). */
  /**
   * css: Chrome's computed serialization, when it is not the 8-bit rgb() one; web: that colour to nine significant digits, which web
   * output writes so Chrome paints the same bytes. oklab: Chrome animates it in oklab (Color::GetColorInterpolationSpace).
   * fractional: an hsl() or hwb() colour Chrome interpolates in float sRGB between 8-bit steps.
   */
  | { readonly ok: true; readonly kind: 'rgba'; readonly value: Rgba8; readonly syntax: ColorSyntax; readonly css?: string; readonly web?: string; readonly oklab?: true; readonly fractional?: true }
  | { readonly ok: true; readonly kind: 'keyword'; readonly keyword: 'transparent' | 'currentcolor' }
  | { readonly ok: false; readonly reason: string };

// css-color-4 §6.1 named colours.
const NAMED: { readonly [name: string]: number } = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4, azure: 0xf0ffff, beige: 0xf5f5dc,
  bisque: 0xffe4c4, black: 0x000000, blanchedalmond: 0xffebcd, blue: 0x0000ff, blueviolet: 0x8a2be2, brown: 0xa52a2a,
  burlywood: 0xdeb887, cadetblue: 0x5f9ea0, chartreuse: 0x7fff00, chocolate: 0xd2691e, coral: 0xff7f50,
  cornflowerblue: 0x6495ed, cornsilk: 0xfff8dc, crimson: 0xdc143c, cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b, darkgray: 0xa9a9a9, darkgreen: 0x006400, darkgrey: 0xa9a9a9, darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b, darkolivegreen: 0x556b2f, darkorange: 0xff8c00, darkorchid: 0x9932cc, darkred: 0x8b0000,
  darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f, darkslateblue: 0x483d8b, darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f,
  darkturquoise: 0x00ced1, darkviolet: 0x9400d3, deeppink: 0xff1493, deepskyblue: 0x00bfff, dimgray: 0x696969,
  dimgrey: 0x696969, dodgerblue: 0x1e90ff, firebrick: 0xb22222, floralwhite: 0xfffaf0, forestgreen: 0x228b22,
  fuchsia: 0xff00ff, gainsboro: 0xdcdcdc, ghostwhite: 0xf8f8ff, gold: 0xffd700, goldenrod: 0xdaa520, gray: 0x808080,
  green: 0x008000, greenyellow: 0xadff2f, grey: 0x808080, honeydew: 0xf0fff0, hotpink: 0xff69b4, indianred: 0xcd5c5c,
  indigo: 0x4b0082, ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa, lavenderblush: 0xfff0f5, lawngreen: 0x7cfc00,
  lemonchiffon: 0xfffacd, lightblue: 0xadd8e6, lightcoral: 0xf08080, lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2,
  lightgray: 0xd3d3d3, lightgreen: 0x90ee90, lightgrey: 0xd3d3d3, lightpink: 0xffb6c1, lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa, lightskyblue: 0x87cefa, lightslategray: 0x778899, lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de, lightyellow: 0xffffe0, lime: 0x00ff00, limegreen: 0x32cd32, linen: 0xfaf0e6, magenta: 0xff00ff,
  maroon: 0x800000, mediumaquamarine: 0x66cdaa, mediumblue: 0x0000cd, mediumorchid: 0xba55d3, mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee, mediumspringgreen: 0x00fa9a, mediumturquoise: 0x48d1cc,
  mediumvioletred: 0xc71585, midnightblue: 0x191970, mintcream: 0xf5fffa, mistyrose: 0xffe4e1, moccasin: 0xffe4b5,
  navajowhite: 0xffdead, navy: 0x000080, oldlace: 0xfdf5e6, olive: 0x808000, olivedrab: 0x6b8e23, orange: 0xffa500,
  orangered: 0xff4500, orchid: 0xda70d6, palegoldenrod: 0xeee8aa, palegreen: 0x98fb98, paleturquoise: 0xafeeee,
  palevioletred: 0xdb7093, papayawhip: 0xffefd5, peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb, plum: 0xdda0dd,
  powderblue: 0xb0e0e6, purple: 0x800080, rebeccapurple: 0x663399, red: 0xff0000, rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1, saddlebrown: 0x8b4513, salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57,
  seashell: 0xfff5ee, sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb, slateblue: 0x6a5acd, slategray: 0x708090,
  slategrey: 0x708090, snow: 0xfffafa, springgreen: 0x00ff7f, steelblue: 0x4682b4, tan: 0xd2b48c, teal: 0x008080,
  thistle: 0xd8bfd8, tomato: 0xff6347, turquoise: 0x40e0d0, violet: 0xee82ee, wheat: 0xf5deb3, white: 0xffffff,
  whitesmoke: 0xf5f5f5, yellow: 0xffff00, yellowgreen: 0x9acd32,
};

export const NAMED_COLORS: readonly string[] = Object.keys(NAMED);

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Blink lround over a clamped channel: halves away from zero (measured: rgb(10.5 0 0) is 11). */
function round8(v: number): number {
  return clamp(Math.round(clamp(v, 0, 255)), 0, 255);
}

function list(node: CssNode, key: string): CssNode[] {
  const v = node[key] as List<CssNode> | null | undefined;
  return v === null || v === undefined ? [] : v.toArray();
}

type Arg =
  | { readonly t: 'number'; readonly v: number }
  | { readonly t: 'percent'; readonly v: number }
  | { readonly t: 'angle'; readonly v: number; readonly unit: string }
  | { readonly t: 'none' }
  | { readonly t: 'comma' }
  | { readonly t: 'slash' };

function args(fn: CssNode): Arg[] | string {
  const out: Arg[] = [];
  for (const c of list(fn, 'children')) {
    if (c.type === 'WhiteSpace') continue;
    if (c.type === 'Number') out.push({ t: 'number', v: Number(c['value']) });
    else if (c.type === 'Percentage') out.push({ t: 'percent', v: Number(c['value']) });
    else if (c.type === 'Dimension') out.push({ t: 'angle', v: Number(c['value']), unit: asciiLower(String(c['unit'])) });
    else if (c.type === 'Identifier' && asciiLower(String(c['name'])) === 'none') out.push({ t: 'none' });
    else if (c.type === 'Operator' && c['value'] === ',') out.push({ t: 'comma' });
    else if (c.type === 'Operator' && c['value'] === '/') out.push({ t: 'slash' });
    else return `unsupported token ${c.type} in a colour function`;
  }
  return out;
}

/** Splits legacy (comma) or modern (space, optional "/ alpha") arguments into channels and an optional alpha. */
function channelsOf(all: Arg[]): { readonly channels: readonly Arg[]; readonly alpha: Arg | null } | string {
  if (all.some((a) => a.t === 'comma')) {
    const values = all.filter((a) => a.t !== 'comma');
    if (all.some((a) => a.t === 'slash' || a.t === 'none')) return 'mixed legacy and modern colour syntax';
    return { channels: values.slice(0, 3), alpha: values[3] === undefined ? null : values[3] };
  }
  const slash = all.findIndex((a) => a.t === 'slash');
  if (slash < 0) return { channels: all, alpha: null };
  const alpha = all[slash + 1];
  return { channels: all.slice(0, slash), alpha: alpha === undefined ? null : alpha };
}

// css-color-4 §5.2: <alpha-value> clamps to [0, 1]; Blink stores round(alpha * 255) (measured on 1001 steps each of number and %).
function alpha8(a: Arg | null): number | string {
  if (a === null) return 255;
  if (a.t === 'none') return 0;
  if (a.t === 'number') return round8(clamp(a.v, 0, 1) * 255);
  if (a.t === 'percent') return round8(clamp(a.v / 100, 0, 1) * 255);
  return 'alpha must be a number or percentage';
}

// css-color-4 §5.1 rgb(): numbers are 0-255 channels, percentages scale 255; none is 0. Measured on 1001 % steps and 511 numbers.
function rgbChannel(a: Arg): number | string {
  if (a.t === 'none') return 0;
  if (a.t === 'number') return round8(a.v);
  if (a.t === 'percent') return round8((a.v / 100) * 255);
  return 'rgb() channels are numbers or percentages';
}

// css-values-4 §7.1 <angle> to degrees.
function hueDegrees(a: Arg): number | string {
  if (a.t === 'none') return 0;
  if (a.t === 'number') return a.v;
  if (a.t !== 'angle') return 'hue must be a number or angle';
  if (a.unit === 'deg') return a.v;
  if (a.unit === 'turn') return a.v * 360;
  if (a.unit === 'grad') return (a.v * 360) / 400;
  if (a.unit === 'rad') return (a.v * 180) / Math.PI;
  return `unknown angle unit ${a.unit}`;
}

/**
 * css-color-4 §7.1 hslToRgb as Chromium gfx::HSLToSRGB computes it in float, then Blink's legacy serialization
 * (Color::SerializeLegacyColorAsCSSColor) adds 1e-7f before lround(x * 255). Matched Chrome 145 on 4080 sampled hsl() values.
 */
function hslTo8(hDeg: number, sPct: number, lPct: number): [number, number, number] {
  const f = Math.fround;
  const h = f(((f(hDeg) % 360) + 360) % 360);
  const s = f(clamp(sPct, 0, 100) / 100);
  const l = f(clamp(lPct, 0, 100) / 100);
  const channel = (n: number): number => {
    if (s === 0) return l;
    const k = f(f(n + f(h / 30)) % 12);
    const a = f(s * Math.min(l, f(1 - l)));
    return f(l - f(a * Math.max(-1, Math.min(f(k - 3), f(9 - k), 1))));
  };
  const to8 = (x: number): number => round8(f(f(x + f(1e-7)) * 255));
  return [to8(channel(0)), to8(channel(8)), to8(channel(4))];
}

function pctOrNumber(a: Arg): number | string {
  if (a.t === 'none') return 0;
  if (a.t === 'percent' || a.t === 'number') return a.v;
  return 'hsl() saturation and lightness are percentages or numbers';
}

function fromFunction(fn: CssNode): ColorParse {
  const name = asciiLower(String(fn['name']));
  if (name !== 'rgb' && name !== 'rgba' && name !== 'hsl' && name !== 'hsla') {
    return { ok: false, reason: `${name}() colours are not supported in milestone 1` };
  }
  const all = args(fn);
  if (typeof all === 'string') return { ok: false, reason: all };
  const split = channelsOf(all);
  if (typeof split === 'string') return { ok: false, reason: split };
  if (split.channels.length !== 3) return { ok: false, reason: `${name}() needs three channels` };
  const a = alpha8(split.alpha);
  if (typeof a === 'string') return { ok: false, reason: a };
  const [c0, c1, c2] = split.channels as [Arg, Arg, Arg];
  if (name === 'rgb' || name === 'rgba') {
    const r = rgbChannel(c0);
    const g = rgbChannel(c1);
    const b = rgbChannel(c2);
    if (typeof r === 'string') return { ok: false, reason: r };
    if (typeof g === 'string') return { ok: false, reason: g };
    if (typeof b === 'string') return { ok: false, reason: b };
    return { ok: true, kind: 'rgba', value: { r, g, b, alpha: a }, syntax: name === 'rgb' ? 'rgb()' : 'rgba()' };
  }
  const h = hueDegrees(c0);
  const s = pctOrNumber(c1);
  const l = pctOrNumber(c2);
  if (typeof h === 'string') return { ok: false, reason: h };
  if (typeof s === 'string') return { ok: false, reason: s };
  if (typeof l === 'string') return { ok: false, reason: l };
  const [r, g, b] = hslTo8(h, s, l);
  return { ok: true, kind: 'rgba', value: { r, g, b, alpha: a }, syntax: name === 'hsl' ? 'hsl()' : 'hsla()' };
}

// css-color-4 §5.2 <hex-color>: 3, 4, 6 or 8 digits; short forms repeat each digit.
function fromHex(hex: string): ColorParse {
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return { ok: false, reason: `#${hex} is not a hex colour` };
  const full = hex.length <= 4 ? Array.from(hex, (c) => c + c).join('') : hex;
  const byte = (i: number): number => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return { ok: true, kind: 'rgba', value: { r: byte(0), g: byte(1), b: byte(2), alpha: full.length === 8 ? byte(3) : 255 }, syntax: 'hex-color' };
}

/** Resolves one parsed <color> component value; anything outside the milestone subset is refused with a reason. */
export function parseColorNode(node: CssNode): ColorParse {
  if (node.type === 'Hash') return fromHex(String(node['value']));
  if (node.type === 'Function') return fromFunction(node);
  if (node.type === 'Identifier') {
    const name = asciiLower(String(node['name']));
    if (name === 'transparent' || name === 'currentcolor') return { ok: true, kind: 'keyword', keyword: name };
    const hex = NAMED[name];
    if (hex !== undefined) return { ok: true, kind: 'rgba', value: { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255, alpha: 255 }, syntax: 'named-color' };
    return { ok: false, reason: `the colour keyword ${name} is not supported in milestone 1 (system colours depend on the platform)` };
  }
  return { ok: false, reason: `${node.type} is not a supported colour` };
}

// ---------------------------------------------------------------------------------------------------------------------
// COL4 colour functions: color-mix(), relative colours (<function>(from <color> ...)), hwb(), lab(), lch(), oklab(), oklch() and
// color(), parsed as Chrome 145 parses them (third_party/blink/renderer/core/css/properties/css_color_function_parser.cc,
// css_parsing_utils.cc ConsumeColorMixFunction) and resolved in the Blink colour model of css/color-space.ts.

type Refusal = { readonly refused: string };
const refusal = (refused: string): Refusal => ({ refused });
const isRefusal = (v: unknown): v is Refusal => typeof v === 'object' && v !== null && 'refused' in v;

const FUNCTION_SPACE: { readonly [name: string]: ColorSpace } = { rgb: 'rgb', rgba: 'rgb', hsl: 'hsl', hsla: 'hsl', hwb: 'hwb', lab: 'lab', lch: 'lch', oklab: 'oklab', oklch: 'oklch' };
// ColorSpaceFromColorSpaceArgument; rec2100-linear sits behind a runtime flag that Chrome 145 leaves off (display-p3-linear does not).
const PREDEFINED_SPACE: { readonly [name: string]: ColorSpace } = {
  srgb: 'srgb', 'srgb-linear': 'srgb-linear', 'display-p3': 'display-p3', 'display-p3-linear': 'display-p3-linear', 'a98-rgb': 'a98-rgb', 'prophoto-rgb': 'prophoto-rgb', rec2020: 'rec2020',
  xyz: 'xyz-d65', 'xyz-d50': 'xyz-d50', 'xyz-d65': 'xyz-d65',
};
const MIX_SPACE: { readonly [name: string]: ColorSpace } = { ...PREDEFINED_SPACE, lab: 'lab', oklab: 'oklab', lch: 'lch', oklch: 'oklch', hsl: 'hsl', hwb: 'hwb' };
const POLAR: ReadonlySet<ColorSpace> = new Set(['hsl', 'hwb', 'lch', 'oklch']);
const HUE_METHODS: ReadonlySet<string> = new Set(['shorter', 'longer', 'increasing', 'decreasing']);

/** ColorFunction::MetadataForColorSpace: each channel's keyword and the number 100% stands for (NaN: percentages do not apply). */
function channelMetadata(space: ColorSpace): { readonly names: readonly [string, string, string]; readonly percent: readonly [number, number, number] } {
  switch (space) {
    case 'rgb':
      return { names: ['r', 'g', 'b'], percent: [255, 255, 255] };
    case 'xyz-d50':
    case 'xyz-d65':
      return { names: ['x', 'y', 'z'], percent: [1, 1, 1] };
    case 'lab':
      return { names: ['l', 'a', 'b'], percent: [100, 125, 125] };
    case 'oklab':
      return { names: ['l', 'a', 'b'], percent: [1, 0.4, 0.4] };
    case 'lch':
      return { names: ['l', 'c', 'h'], percent: [100, 150, NaN] };
    case 'oklch':
      return { names: ['l', 'c', 'h'], percent: [1, 0.4, NaN] };
    case 'hsl':
      return { names: ['h', 's', 'l'], percent: [NaN, 100, 100] };
    case 'hwb':
      return { names: ['h', 'w', 'b'], percent: [NaN, 100, 100] };
    default:
      return { names: ['r', 'g', 'b'], percent: [1, 1, 1] };
  }
}

const isHueChannel = (space: ColorSpace, i: number): boolean => ((space === 'hsl' || space === 'hwb') && i === 0) || ((space === 'lch' || space === 'oklch') && i === 2);
const ident = (n: CssNode | undefined): string | null => (n !== undefined && n.type === 'Identifier' ? asciiLower(String(n['name'])) : null);
// css-tree keeps the whitespace around + and - in calc() (" + "), which CSS requires there.
const isOperator = (n: CssNode | undefined, op: string): boolean => n !== undefined && n.type === 'Operator' && String(n['value']).trim() === op;

const isRelative = (n: CssNode): boolean => n.type === 'Function' && ident(list(n, 'children').find((c) => c.type !== 'WhiteSpace')) === 'from';

/**
 * A value's text with each relative colour (a function whose first argument is from) replaced by #000, for the webref grammar check:
 * the grammar's rgb()/hsl()/lab() productions do not name the channel keywords, so the relative colour is validated by parseColorValue
 * as Blink's css_color_function_parser.cc does. Null when the value has no relative colour.
 */
export function relativeColorGrammarText(node: CssNode): string | null {
  let found = false;
  const text = (n: CssNode): string => {
    if (isRelative(n)) {
      found = true;
      return '#000';
    }
    if (n.type === 'Function') return `${String(n['name'])}(${list(n, 'children').map(text).join(' ')})`;
    if (n.type === 'Parentheses') return `(${list(n, 'children').map(text).join(' ')})`;
    if (n.type === 'Value') return list(n, 'children').map(text).join(' ');
    return generate(n);
  };
  const out = text(node);
  return found ? out : null;
}

// The canonical angle units of css-values-4 §7.1, as CSSPrimitiveValue::ComputeDegrees applies them (css_primitive_value.cc).
function degreesOf(n: CssNode): number | null {
  const v = Number(n['value']);
  switch (asciiLower(String(n['unit']))) {
    case 'deg':
      return v;
    case 'rad':
      return v * (180 / Math.PI);
    case 'grad':
      return v * 0.9;
    case 'turn':
      return v * 360;
    default:
      return null;
  }
}

/**
 * A relative colour channel as Blink's CalculationValue evaluates it (calculation_value.cc, calculation_expression_node.cc): float32
 * at every step, channel keywords replaced by the origin's parameters. Supports numbers, channel keywords, + - * /, parentheses and
 * calc(), min(), max() and clamp(); percentages, angles and other math functions inside a calculation are refused.
 */
type Calc = (keywords: ReadonlyMap<string, number>) => number;

function calcExpression(nodes: readonly CssNode[], names: ReadonlySet<string>): Calc | Refusal {
  const items = nodes.filter((n) => n.type !== 'WhiteSpace');
  let at = 0;
  const value = (): Calc | Refusal => {
    const n = items[at++];
    if (n === undefined) return refusal('a calculation in a relative colour ends early');
    if (n.type === 'Number') {
      const v = f32(Number(n['value']));
      return () => v;
    }
    if (n.type === 'Identifier') {
      const name = asciiLower(String(n['name']));
      if (!names.has(name)) return refusal(`${name} is not a channel keyword of this relative colour`);
      return (k) => k.get(name) as number;
    }
    if (n.type === 'Parentheses') return calcExpression(list(n, 'children'), names);
    if (n.type === 'Function') return mathFunction(n, names);
    return refusal(`${n.type} inside a relative colour calculation is not supported yet (COL4 takes numbers and channel keywords)`);
  };
  const product = (): Calc | Refusal => {
    let left = value();
    while (!isRefusal(left) && (isOperator(items[at], '*') || isOperator(items[at], '/'))) {
      const divide = isOperator(items[at++], '/');
      const right = value();
      if (isRefusal(right)) return right;
      const l = left;
      // css_math_expression_node.cc rewrites a / b as a * (1 / b); kInvert evaluates 1.0 / b in double and returns a float.
      left = divide ? (k) => f32(l(k) * f32(1 / right(k))) : (k) => f32(l(k) * right(k));
    }
    return left;
  };
  let sum = product();
  while (!isRefusal(sum) && (isOperator(items[at], '+') || isOperator(items[at], '-'))) {
    const minus = isOperator(items[at++], '-');
    const right = product();
    if (isRefusal(right)) return right;
    const l = sum;
    sum = minus ? (k) => f32(l(k) - right(k)) : (k) => f32(l(k) + right(k));
  }
  if (!isRefusal(sum) && at !== items.length) return refusal('a relative colour calculation has a token it cannot read');
  return sum;
}

function mathFunction(fn: CssNode, names: ReadonlySet<string>): Calc | Refusal {
  const name = asciiLower(String(fn['name']));
  const args: CssNode[][] = [[]];
  for (const c of list(fn, 'children')) {
    if (isOperator(c, ',')) args.push([]);
    else (args[args.length - 1] as CssNode[]).push(c);
  }
  const parts = args.map((a) => calcExpression(a, names));
  const bad = parts.find(isRefusal);
  if (bad !== undefined) return bad;
  const f = parts as Calc[];
  if (name === 'calc' && f.length === 1) return f[0] as Calc;
  if (name === 'min') return (k) => f.reduce((m, g) => Math.min(m, g(k)), (f[0] as Calc)(k));
  if (name === 'max') return (k) => f.reduce((m, g) => Math.max(m, g(k)), (f[0] as Calc)(k));
  if (name === 'clamp' && f.length === 3) return (k) => Math.max((f[0] as Calc)(k), Math.min((f[1] as Calc)(k), (f[2] as Calc)(k)));
  return refusal(`${name}() in a relative colour channel is not supported yet (COL4 takes calc(), min(), max() and clamp())`);
}

/** One parsed channel: none, a resolved number (angles in degrees), a percentage, or a relative channel (keyword or calculation). */
type Channel =
  | { readonly t: 'none' }
  | { readonly t: 'number'; readonly v: number }
  | { readonly t: 'percent'; readonly v: number }
  | { readonly t: 'relative'; readonly calc: Calc };

function channel(n: CssNode | undefined, hue: boolean, relative: ReadonlySet<string> | null): Channel | Refusal {
  if (n === undefined) return refusal('a colour function is missing a channel');
  if (ident(n) === 'none') return { t: 'none' };
  if (n.type === 'Number') return { t: 'number', v: Number(n['value']) };
  if (hue && n.type === 'Dimension') {
    const d = degreesOf(n);
    return d === null ? refusal(`${String(n['unit'])} is not an angle unit`) : { t: 'number', v: d };
  }
  if (!hue && n.type === 'Percentage') return { t: 'percent', v: Number(n['value']) };
  if (relative !== null && n.type === 'Identifier' && relative.has(asciiLower(String(n['name'])))) {
    const name = asciiLower(String(n['name']));
    return { t: 'relative', calc: (k) => k.get(name) as number };
  }
  if (n.type === 'Function' && ['calc', 'min', 'max', 'clamp'].includes(asciiLower(String(n['name'])))) {
    if (relative === null) return refusal('calc() in a colour channel is not supported yet (COL4)');
    const calc = mathFunction(n, relative);
    return isRefusal(calc) ? calc : { t: 'relative', calc };
  }
  return refusal(`${n.type === 'Identifier' ? String(n['name']) : n.type} is not a valid colour channel here`);
}

/** ColorFunctionParser::MakePerColorSpaceAdjustments. */
function adjust(relative: boolean, legacy: boolean, space: ColorSpace, channels: (number | null)[], alpha: number | null): number | null {
  for (let i = 0; i < 3; i++) {
    const v = channels[i];
    if (v === null || v === undefined || !isHueChannel(space, i)) continue;
    const finite = Number.isFinite(v) ? v : 0;
    channels[i] = (((finite % 360) + 360) % 360);
  }
  let a = alpha;
  if (space === 'rgb') {
    for (let i = 0; i < 3; i++) {
      const v = channels[i];
      if (v === null || v === undefined) continue;
      if (!Number.isFinite(v)) channels[i] = v > 0 ? 255 : 0;
      else if (!relative) channels[i] = clamp(v, 0, 255);
    }
    if (!relative && a !== null) a = Math.round(a * 255) / 255;
  }
  if (space === 'hsl' || space === 'hwb') {
    for (const i of [1, 2]) {
      const v = channels[i];
      if (v === null || v === undefined) continue;
      const val = v / 100;
      channels[i] = legacy ? clamp(val, 0, 1) : relative ? val : Math.max(0, val);
    }
  }
  return a;
}

type Parsed = { readonly color: BlinkColor; readonly relative: boolean; readonly mix: boolean };

/** ColorFunctionParser::ConsumeFunctionalSyntaxColor and, for relative colours, StyleColor::UnresolvedRelativeColor::Resolve. */
function functionalColor(fn: CssNode, name: string): Parsed | Refusal {
  const items = list(fn, 'children').filter((c) => c.type !== 'WhiteSpace');
  let at = 0;
  let origin: BlinkColor | null = null;
  if (ident(items[0]) === 'from') {
    const o = blinkColor(items[1]);
    if (isRefusal(o)) return o;
    origin = o.color;
    at = 2;
  }
  let space: ColorSpace | undefined = FUNCTION_SPACE[name];
  if (name === 'color') {
    const arg = ident(items[at++]);
    space = arg === null ? undefined : PREDEFINED_SPACE[arg];
    if (space === undefined) return refusal(`color() needs a predefined colour space, not ${arg ?? 'that'}`);
  }
  if (space === undefined) return refusal(`${name}() is not a colour function`);
  const meta = channelMetadata(space);
  const keywords = origin === null ? null : new Set([...meta.names, 'alpha']);
  const channels: Channel[] = [];
  let legacy = false;
  for (let i = 0; i < 3; i++) {
    const c = channel(items[at++], isHueChannel(space, i), keywords);
    if (isRefusal(c)) return c;
    channels.push(c);
    if (i < 2 && isOperator(items[at], ',')) {
      if (i === 1 && !legacy) return refusal(`${name}() mixes commas and spaces`);
      if (origin !== null) return refusal('a relative colour cannot use commas');
      legacy = true;
      at++;
    } else if (i < 2 && legacy) {
      return refusal(`${name}() mixes commas and spaces`);
    }
  }
  let alpha: Channel | null = null;
  if (legacy ? isOperator(items[at], ',') : isOperator(items[at], '/')) {
    if (legacy && space !== 'rgb' && space !== 'hsl' && space !== 'hwb') return refusal(`${name}() has no comma syntax`);
    at++;
    const a = items[at++];
    const c = a !== undefined && a.type === 'Percentage' ? ({ t: 'percent', v: Number(a['value']) } as Channel) : channel(a, false, keywords);
    if (isRefusal(c)) return c;
    alpha = c;
  }
  if (at !== items.length) return refusal(`${name}() has more arguments than a colour takes`);
  if (legacy) {
    if (channels.some((c) => c.t === 'none') || alpha?.t === 'none') return refusal('none is not part of the legacy comma syntax');
    if (space === 'rgb' && channels.some((c) => c.t === 'percent') && channels.some((c) => c.t === 'number')) return refusal('rgb() with commas takes all numbers or all percentages');
    if (space === 'hwb') return refusal('hwb() has no comma syntax');
    if (space === 'hsl' && (channels[1]?.t === 'number' || channels[2]?.t === 'number')) return refusal('hsl() with commas takes percentages for saturation and lightness');
  }

  if (origin === null) {
    const values = channels.map((c, i) => (c.t === 'none' ? null : c.t === 'percent' ? (c.v / 100) * (meta.percent[i] as number) : (c as { v: number }).v));
    let a: number | null = 1;
    if (alpha !== null) a = alpha.t === 'none' ? null : alpha.t === 'percent' ? clamp(alpha.v / 100, 0, 1) : clamp((alpha as { v: number }).v, 0, 1);
    a = adjust(false, legacy, space, values, a);
    return { color: BlinkColor.of(space, values[0] as number | null, values[1] as number | null, values[2] as number | null, a), relative: false, mix: false };
  }

  const resolved = origin.copy();
  resolved.convert(space);
  const values = new Map<string, number>([
    [meta.names[0], resolved.p[0]],
    [meta.names[1], space === 'hsl' || space === 'hwb' ? f32(resolved.p[1] * 100) : resolved.p[1]],
    [meta.names[2], space === 'hsl' || space === 'hwb' ? f32(resolved.p[2] * 100) : resolved.p[2]],
    ['alpha', resolved.alpha],
  ]);
  const evaluate = (c: Channel, percent: number): number | null => {
    if (c.t === 'none') return null;
    const max = f32(Number.isNaN(percent) ? 3.4028234663852886e38 : percent);
    if (c.t === 'relative') return f32(c.calc(values));
    if (c.t === 'percent') return f32(f32(f32(f32(c.v) / 100) * max));
    return f32(c.v);
  };
  const params = channels.map((c, i) => evaluate(c, meta.percent[i] as number));
  const alphaParam = alpha === null ? resolved.alpha : evaluate(alpha, 1);
  // Probed on Chrome 145: calc(1 / 0) in a relative channel computes to a huge finite value (1.33444e+36), not infinity.
  if ([...params, alphaParam].some((v) => v !== null && !Number.isFinite(v))) return refusal('a relative colour channel calculation is infinite or NaN (it divides by zero), which Dragon does not carry (COL4)');
  const a = adjust(true, false, space, params, alphaParam);
  return { color: BlinkColor.of(space, params[0] as number | null, params[1] as number | null, params[2] as number | null, a), relative: true, mix: false };
}

/** ConsumeColorMixFunction, CSSColorMixValue::NormalizePercentages and Color::FromColorMix. */
function colorMix(fn: CssNode): Parsed | Refusal {
  const items = list(fn, 'children').filter((c) => c.type !== 'WhiteSpace');
  let at = 0;
  let space: ColorSpace = 'oklab';
  let hue: HueMethod = 'shorter';
  if (ident(items[0]) === 'in') {
    const name = ident(items[1]);
    const s = name === null ? undefined : MIX_SPACE[name];
    if (s === undefined) return refusal(`color-mix() cannot interpolate in ${name ?? 'that'}`);
    space = s;
    at = 2;
    const method = ident(items[at]);
    if (POLAR.has(space) && method !== null && HUE_METHODS.has(method)) {
      if (ident(items[at + 1]) !== 'hue') return refusal(`color-mix() needs hue after ${method}`);
      hue = method as HueMethod;
      at += 2;
    }
    if (!isOperator(items[at++], ',')) return refusal('color-mix() needs a comma after its interpolation method');
  }
  const operand = (): { readonly color: BlinkColor; readonly percent: number | null } | Refusal => {
    let percent: number | null = null;
    let color: BlinkColor | null = null;
    for (let k = 0; k < 2 && at < items.length && !isOperator(items[at], ','); k++) {
      const n = items[at++] as CssNode;
      if (n.type === 'Percentage' && percent === null) {
        percent = Number(n['value']);
        if (percent < 0 || percent > 100) return refusal('a color-mix() percentage must be between 0% and 100%');
      } else if (color === null) {
        const c = blinkColor(n);
        if (isRefusal(c)) return c;
        color = c.color;
      } else {
        return refusal('a color-mix() operand is one colour and an optional percentage');
      }
    }
    return color === null ? refusal('a color-mix() operand needs a colour') : { color, percent };
  };
  const first = operand();
  if (isRefusal(first)) return first;
  if (!isOperator(items[at++], ',')) return refusal('color-mix() takes two colours separated by a comma');
  const second = operand();
  if (isRefusal(second)) return second;
  if (at !== items.length) return refusal('color-mix() takes two colours');
  if (first.percent === 0 && second.percent === 0) return refusal('color-mix() percentages cannot both be 0%');
  let p1 = first.percent === null ? 0.5 : first.percent / 100;
  let p2 = second.percent === null ? 0.5 : second.percent / 100;
  if (first.percent !== null && second.percent === null) p2 = 1 - p1;
  else if (second.percent !== null && first.percent === null) p1 = 1 - p2;
  let alphaMultiplier = 1;
  const scale = p1 + p2;
  if (scale !== 0) {
    p1 /= scale;
    p2 /= scale;
    if (scale <= 1) alphaMultiplier = scale;
  }
  const amount = p1 === 0 ? 1 : p2;
  return { color: BlinkColor.mix(space, hue, first.color, second.color, amount, alphaMultiplier), relative: false, mix: true };
}

/** Any <color> as a Blink colour; currentcolor and system colours are refused. */
function blinkColor(node: CssNode | undefined): Parsed | Refusal {
  if (node === undefined) return refusal('a colour is missing');
  if (node.type === 'Hash') {
    const h = fromHex(String(node['value']));
    return h.ok && h.kind === 'rgba' ? { color: BlinkColor.rgba32(h.value.r, h.value.g, h.value.b, h.value.alpha), relative: false, mix: false } : refusal(h.ok ? 'not a colour' : h.reason);
  }
  if (node.type === 'Identifier') {
    const name = asciiLower(String(node['name']));
    if (name === 'transparent') return { color: BlinkColor.rgba32(0, 0, 0, 0), relative: false, mix: false };
    if (name === 'currentcolor') return refusal('currentcolor inside a colour function resolves on each element; Dragon does not resolve it there yet (COL4)');
    const hex = NAMED[name];
    if (hex === undefined) return refusal(`the colour keyword ${name} is not supported (system colours depend on the platform)`);
    return { color: BlinkColor.rgba32((hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255), relative: false, mix: false };
  }
  if (node.type === 'Function') {
    const name = asciiLower(String(node['name']));
    if (name === 'color-mix') return colorMix(node);
    if (name === 'color' || FUNCTION_SPACE[name] !== undefined) return functionalColor(node, name);
    return refusal(`${name}() colours are not supported yet`);
  }
  return refusal(`${node.type} is not a colour`);
}

const syntaxOf = (node: CssNode, p: Parsed): ColorSyntax =>
  p.mix ? 'color-mix()' : p.relative ? 'relative-color' : node.type === 'Function' ? (`${asciiLower(String(node['name']))}()` as ColorSyntax) : 'named-color';

/**
 * A property's <color>: the legacy forms as parseColorNode resolves them, and the COL4 colour functions in Chrome's colour model,
 * carrying Chrome's computed serialization (css) and the 8-bit colour Chrome paints.
 */
export function parseColorValue(node: CssNode): ColorParse {
  if (node.type !== 'Function') return parseColorNode(node);
  const name = asciiLower(String(node['name']));
  const relative = ident(list(node, 'children').find((c) => c.type !== 'WhiteSpace')) === 'from';
  if (!relative && (name === 'rgb' || name === 'rgba' || name === 'hsl' || name === 'hsla')) {
    const legacy = parseColorNode(node);
    if (!legacy.ok || legacy.kind !== 'rgba') return legacy;
    // color.cc GetColorInterpolationSpace: a legacy colour with a none component animates in oklab.
    if (list(node, 'children').some((c) => ident(c) === 'none')) return { ...legacy, oklab: true };
    const hsl = name === 'hsl' || name === 'hsla' ? blinkColor(node) : null;
    return hsl !== null && !isRefusal(hsl) && fractionalSrgb(hsl.color) ? { ...legacy, fractional: true } : legacy;
  }
  const p = blinkColor(node);
  if (isRefusal(p)) return { ok: false, reason: p.refused };
  const color = p.color.copy();
  // style_builder_converter.cc ResolveColorValue: a relative colour or color-mix() that resolves to a legacy space is color(srgb ...);
  // rgb() carries its missing components across, hsl() and hwb() resolve them.
  if ((p.relative || p.mix) && (color.space === 'rgb' || color.space === 'hsl' || color.space === 'hwb')) color.convert('srgb', color.space !== 'rgb');
  if (!color.finite()) return { ok: false, reason: 'the colour has an infinite or NaN channel, which Dragon does not carry (COL4)' };
  // Probed on Chrome 145: a translucent colour outside the sRGB gamut blends before it clamps, so its 8-bit colour paints differently.
  if (color.alpha < 1 && color.alpha > 0 && color.toSrgb().some((v) => v < 0 || v > 1)) {
    return { ok: false, reason: `${color.serialize()} is translucent and outside the sRGB gamut; Chrome blends it before clamping, which an 8-bit colour cannot reproduce (COL4)` };
  }
  const value = { ok: true, kind: 'rgba', value: color.paintChannels(), syntax: syntaxOf(node, p), css: color.serialize(), web: color.serialize(9) } as const;
  if (!isLegacySpace(color.space) || color.none.some((n) => n) || color.alphaNone) return { ...value, oklab: true };
  return fractionalSrgb(color) ? { ...value, fractional: true } : value;
}

/**
 * An hsl() or hwb() colour whose sRGB channels fall between 8-bit steps: Chrome keeps and interpolates them in float (hwb(10 20% 30%)
 * has red 178.5), so an animation between its 8-bit bytes differs from Chrome's at a step.
 */
const fractionalSrgb = (c: BlinkColor): boolean =>
  (c.space === 'hsl' || c.space === 'hwb') && c.toSrgb().some((v) => Math.abs(v * 255 - Math.round(v * 255)) > 1e-3);

export const TRANSPARENT: Rgba8 = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * CSSOM §6.7.2 serialization of an 8-bit alpha, as Blink does it: two decimals when they round-trip to the same byte, else three.
 */
export function serializeAlpha(alpha: number): string {
  if (alpha === 255) return '1';
  const a = alpha / 255;
  const two = Math.round(a * 100) / 100;
  if (Math.round(two * 255) === alpha) return String(two);
  return String(Math.round(a * 1000) / 1000);
}

/** The CSSOM serialization Chrome reports for a legacy sRGB colour: rgb(r, g, b) or rgba(r, g, b, a). */
export function serializeColor(c: Rgba8): string {
  return c.alpha === 255 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${serializeAlpha(c.alpha)})`;
}

/**
 * Parses Chrome's computed colour string back into the 8-bit colour it paints: a legacy rgb()/rgba(), or (COL4) the color(), lab(),
 * lch(), oklab() and oklch() forms Chrome computes the colour functions to, through Chrome's colour model; null for anything else, and
 * for a colour function text that is not its own computed serialization.
 */
export function parseComputedColor(text: string): Rgba8 | null {
  const m = /^rgba?\((\d{1,3}), (\d{1,3}), (\d{1,3})(?:, (0|1|0?\.\d+))?\)$/.exec(text);
  if (m === null) return /^(color|lab|lch|oklab|oklch)\(/.test(text) ? parseComputedColorFunction(text) : null;
  const alphaText = m[4];
  const alpha = alphaText === undefined ? 255 : Math.round(Number(alphaText) * 255);
  if (alphaText !== undefined && serializeAlpha(alpha) !== alphaText) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), alpha };
}

/** A computed colour function text as the 8-bit colour it reparses to, and per channel whether its float sits at a .5 step of 255. */
function computedColorFunction(text: string): { readonly paint: Rgba8; readonly halfStep: readonly boolean[] } | null {
  let node: CssNode | undefined;
  try {
    node = (parse(text, { context: 'value' })['children'] as { toArray(): CssNode[] }).toArray()[0];
  } catch {
    return null;
  }
  if (node === undefined || node.type !== 'Function') return null;
  // Not parseColorValue: six digits can put a translucent colour Chrome holds in gamut a hair outside it, which Dragon would refuse.
  const p = blinkColor(node);
  if (isRefusal(p) || !p.color.finite() || p.color.serialize() !== text) return null;
  const half = (v: number): boolean => Math.abs(((Math.min(1, Math.max(0, v)) * 255) % 1) - 0.5) < 0.01;
  return { paint: p.color.paintChannels(), halfStep: [...p.color.toSrgb(), p.color.alpha].map(half) };
}

const parseComputedColorFunction = (text: string): Rgba8 | null => computedColorFunction(text)?.paint ?? null;

/**
 * Whether Chrome's computed colour text is the 8-bit colour Dragon paints. A legacy rgb()/rgba() text is exact. A colour function
 * text carries six significant digits, so a channel Chrome holds at a .5 step of 255 can reparse one step off what Chrome paints
 * (color(srgb 0.5 0.75098 0.5) is 191.5 for green, painted 192): such a channel may differ by one, and every other must be exact.
 * The painted bytes are proven exactly by the pixel lanes and test/color-functions.test.ts.
 */
export function computedColorMatches(text: string, mine: Rgba8): boolean {
  if (text.startsWith('rgb')) {
    const got = parseComputedColor(text);
    return got !== null && got.r === mine.r && got.g === mine.g && got.b === mine.b && got.alpha === mine.alpha;
  }
  const f = computedColorFunction(text);
  if (f === null) return false;
  const pairs = [[f.paint.r, mine.r], [f.paint.g, mine.g], [f.paint.b, mine.b], [f.paint.alpha, mine.alpha]] as const;
  return pairs.every(([got, want], i) => got === want || (f.halfStep[i] === true && Math.abs(got - want) === 1));
}

/** The colour-only planted fault: moves every red channel by one step without touching anything else. */
export function perturbColor(c: Rgba8): Rgba8 {
  return { r: c.r === 255 ? 254 : c.r + 1, g: c.g, b: c.b, alpha: c.alpha };
}

// PNT1 outline 3D tones. Blink 145 Color::Dark and Color::Light (platform/graphics/color.cc:1138-1182) on a legacy sRGB colour, and
// CalculateInsetOutsetColor (core/paint/box_border_painter.cc:616-641) with color_utils::GetContrastRatio (ui/gfx/color_utils.cc
// :58-64, :392-413). Float steps use Math.fround.
const f32 = Math.fround;

/** QuantizeTo8Bit (color.cc:156-159) as the 8-bit channel it draws: the float times the largest float below 256, truncated. */
const quantize = (v: number): number => Math.trunc(f32(v * f32(256 - 2 ** -16)));

function scaled(c: Rgba8, multiplier: (v: number) => number): Rgba8 {
  const ch = [c.r, c.g, c.b].map((x) => f32(x / 255));
  const v = Math.max(...ch);
  const m = multiplier(v);
  const [r, g, b] = ch.map((x) => quantize(f32(x * m))) as [number, number, number];
  return { r, g, b, alpha: c.alpha };
}

/** Color::Dark: white is (171, 171, 171); otherwise each channel times max(0, (v - 0.33) / v) for v its largest channel. */
export function darkColor(c: Rgba8): Rgba8 {
  if (c.r === 255 && c.g === 255 && c.b === 255) return { r: 171, g: 171, b: 171, alpha: c.alpha };
  return scaled(c, (v) => (v === 0 ? 0 : Math.max(0, f32(f32(v - f32(0.33)) / v))));
}

/** Color::Light: black is (84, 84, 84); otherwise each channel times min(1, v + 0.33) / v. */
export function lightColor(c: Rgba8): Rgba8 {
  if (c.r === 0 && c.g === 0 && c.b === 0) return { r: 84, g: 84, b: 84, alpha: c.alpha };
  return scaled(c, (v) => f32(Math.min(1, f32(v + f32(0.33))) / v));
}

const linearize = (x: number): number => (x <= f32(0.04045) ? f32(x / f32(12.92)) : f32(Math.pow(f32(f32(x + f32(0.055)) / f32(1.055)), f32(2.4))));
const luminance = (c: Rgba8): number => {
  const [r, g, b] = [c.r, c.g, c.b].map((x) => linearize(f32(x / 255))) as [number, number, number];
  return f32(f32(f32(f32(0.2126) * r) + f32(f32(0.7152) * g)) + f32(f32(0.0722) * b));
};

/** GetContrastRatio of two colours' relative luminances. */
export function contrastRatio(a: Rgba8, b: Rgba8): number {
  const la = f32(luminance(a) + f32(0.05));
  const lb = f32(luminance(b) + f32(0.05));
  return la > lb ? f32(la / lb) : f32(lb / la);
}

/**
 * A 3D style's two colours (CalculateInsetOutsetColor): the darker is Color::Dark; the lighter is the colour itself, or Color::Light
 * when the colour is dark (red under 150 and green under 92) and contrasts with its darker colour by less than 1.75.
 */
export function insetOutsetTones(c: Rgba8): [Rgba8, Rgba8] {
  const dark = darkColor(c);
  const bright = f32(c.r / 255) >= f32(150 / 255) || f32(c.g / 255) >= f32(92 / 255);
  return [bright || contrastRatio(c, dark) >= f32(1.75) ? c : lightColor(c), dark];
}

/**
 * SVG-opacity: a shape's fill or stroke alpha byte with its fill-opacity or stroke-opacity applied as Chrome does
 * (SVGObjectPainter::PreparePaint, svg_object_painter.cc): the colour's alpha times the opacity in float, which Skia rounds to the
 * alpha byte it blits.
 */
export function svgPaintAlpha(alpha: number, opacity: number): number {
  return Math.round(Math.fround(Math.fround(alpha / 255) * Math.fround(opacity)) * 255);
}
